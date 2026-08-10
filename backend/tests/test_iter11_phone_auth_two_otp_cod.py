"""Iteration 11 backend tests.

Coverage:
- Phone OTP auth (send/verify, dev fallback for Twilio trial)
- /auth/logout marks caller offline
- Bookings: accept with payment_method (razorpay/cod), two OTPs (pickup+delivery)
- Driver never sees pickup_otp / delivery_otp
- Status transitions require correct OTP (pickup for in_transit, delivery for delivered)
- COD → payment_status=paid_cod on delivered
- Cancellation before pickup allowed, forbidden after
- Quotes anonymized for other drivers
- Shipment TTL 24h (indirect DB check)
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASSWORD = "S6bMgyCbE-1fao9IRcw6HWOmi8eldTD_"


def _rand(n=8):
    return uuid.uuid4().hex[:n]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _register_email(role):
    payload = {
        "name": f"TEST_{role}_{_rand()}",
        "email": f"TEST_{role}_{_rand()}@example.com",
        "phone": f"+9199{uuid.uuid4().int % 100000000:08d}",
        "password": "test1234",
        "role": role,
    }
    r = requests.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --------------------------------------------------------------------
# Phone OTP auth
# --------------------------------------------------------------------
class TestPhoneAuth:
    def test_send_otp_normalizes_and_returns_dev_code_for_new_user(self):
        raw = f"999{uuid.uuid4().int % 10000000:07d}"  # 10-digit bare Indian number
        r = requests.post(f"{API}/auth/phone/send-otp", json={"phone": raw, "purpose": "login"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["phone"].startswith("+91"), f"Phone should be normalized to E.164 with +91, got {d['phone']}"
        assert d["phone"].endswith(raw)
        assert d["is_new_user"] is True
        # Trial Twilio account → dev fallback expected
        assert d["delivery"] == "dev", f"Expected dev delivery for unverified number, got {d['delivery']}"
        assert "dev_otp" in d and len(d["dev_otp"]) >= 4

    def test_verify_new_phone_without_profile_returns_422(self):
        raw = f"988{uuid.uuid4().int % 10000000:07d}"
        s = requests.post(f"{API}/auth/phone/send-otp", json={"phone": raw, "purpose": "login"}).json()
        r = requests.post(f"{API}/auth/phone/verify-otp",
                          json={"phone": s["phone"], "code": s["dev_otp"]})
        assert r.status_code == 422, r.text
        detail = r.json().get("detail", {})
        # FastAPI may wrap the detail; check the payload contains requires_profile
        if isinstance(detail, dict):
            assert detail.get("requires_profile") is True
        else:
            # possibly wrapped in list of dicts
            assert "requires_profile" in str(detail)

    def test_verify_new_phone_with_profile_creates_user(self):
        raw = f"977{uuid.uuid4().int % 10000000:07d}"
        s = requests.post(f"{API}/auth/phone/send-otp", json={"phone": raw, "purpose": "login"}).json()
        r = requests.post(f"{API}/auth/phone/verify-otp", json={
            "phone": s["phone"], "code": s["dev_otp"],
            "name": f"TEST_Phone_{_rand()}", "role": "customer",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d and "user" in d
        assert d["user"]["phone"] == s["phone"]
        assert d["user"]["role"] == "customer"
        assert d["user"].get("phone_verified") is True
        assert "password_hash" not in d["user"]

    def test_verify_existing_phone_returns_jwt(self):
        # 1. Create user via phone signup
        raw = f"966{uuid.uuid4().int % 10000000:07d}"
        s1 = requests.post(f"{API}/auth/phone/send-otp", json={"phone": raw}).json()
        create = requests.post(f"{API}/auth/phone/verify-otp", json={
            "phone": s1["phone"], "code": s1["dev_otp"],
            "name": "TEST_Existing", "role": "driver",
        })
        assert create.status_code == 200
        existing_uid = create.json()["user"]["id"]

        # 2. Send OTP again — should now report is_new_user=False
        s2 = requests.post(f"{API}/auth/phone/send-otp", json={"phone": raw}).json()
        assert s2["is_new_user"] is False

        # 3. Verify → returns JWT for the existing user (no profile needed)
        r = requests.post(f"{API}/auth/phone/verify-otp",
                          json={"phone": s2["phone"], "code": s2["dev_otp"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["id"] == existing_uid


# --------------------------------------------------------------------
# Logout marks offline
# --------------------------------------------------------------------
class TestLogout:
    def test_logout_sets_offline_and_last_seen(self):
        u = _register_email("driver")
        r = requests.post(f"{API}/auth/logout", headers=_h(u["token"]))
        assert r.status_code == 200
        # Verify via /auth/me — should still be authenticated but flags set
        me = requests.get(f"{API}/auth/me", headers=_h(u["token"]))
        assert me.status_code == 200
        body = me.json()
        assert body.get("is_online") is False
        assert body.get("last_seen_at") is not None


# --------------------------------------------------------------------
# Bookings: two OTPs, driver masking, COD
# --------------------------------------------------------------------
def _setup_booking(admin_token, payment_method="razorpay"):
    """Create customer, driver, approved truck, shipment, quote, and accept it."""
    cust = _register_email("customer")
    drv = _register_email("driver")
    # Truck + approve
    t = requests.post(f"{API}/trucks", headers=_h(drv["token"]), json={
        "reg_number": f"KA{_rand(6).upper()}", "truck_type": "Mini Truck",
        "body_type": "Open", "load_capacity_kg": 800,
        "base_lat": 12.97, "base_lng": 77.59, "base_city": "Bangalore",
    })
    assert t.status_code == 200, t.text
    truck = t.json()
    v = requests.post(f"{API}/admin/trucks/{truck['id']}/verify", headers=_h(admin_token))
    assert v.status_code == 200
    # Shipment
    s = requests.post(f"{API}/shipments", headers=_h(cust["token"]), json={
        "goods_category": "Parcels", "weight_kg": 100, "packages": 1,
        "pickup_address": "MG Road", "pickup_city": "Bangalore",
        "pickup_lat": 12.9716, "pickup_lng": 77.5946,
        "drop_address": "Bandra", "drop_city": "Mumbai",
        "drop_lat": 19.0596, "drop_lng": 72.8295,
        "loading_date": "2026-05-01",
    })
    assert s.status_code == 200, s.text
    shipment = s.json()
    # Quote
    q = requests.post(f"{API}/quotes", headers=_h(drv["token"]), json={
        "shipment_id": shipment["id"], "truck_id": truck["id"],
        "price_inr": 25000, "eta_hours": 24, "note": "",
    })
    assert q.status_code == 200, q.text
    quote = q.json()
    # Accept with payment_method
    b = requests.post(f"{API}/bookings/accept/{quote['id']}",
                      headers=_h(cust["token"]),
                      json={"payment_method": payment_method})
    assert b.status_code == 200, b.text
    booking = b.json()
    return {
        "customer": cust, "driver": drv, "truck": truck,
        "shipment": shipment, "quote": quote, "booking": booking,
    }


class TestBookingsAndOTP:
    def test_accept_razorpay_stores_two_otps(self, admin_token):
        ctx = _setup_booking(admin_token, payment_method="razorpay")
        b = ctx["booking"]
        assert b["payment_method"] == "razorpay"
        assert b["payment_status"] == "unpaid"
        assert b.get("pickup_otp") and b.get("delivery_otp")
        assert b["pickup_otp"] != b["delivery_otp"] or len(b["pickup_otp"]) == 4
        assert "otp" not in b, "Legacy single 'otp' field must not exist"
        assert b["pickup_verified"] is False
        assert b["delivery_verified"] is False

    def test_accept_cod_stores_cod_pending(self, admin_token):
        ctx = _setup_booking(admin_token, payment_method="cod")
        b = ctx["booking"]
        assert b["payment_method"] == "cod"
        assert b["payment_status"] == "cod_pending"

    def test_driver_get_booking_strips_otps(self, admin_token):
        ctx = _setup_booking(admin_token)
        bid = ctx["booking"]["id"]
        # Customer sees both OTPs
        c = requests.get(f"{API}/bookings/{bid}", headers=_h(ctx["customer"]["token"])).json()
        assert c.get("pickup_otp") and c.get("delivery_otp")
        # Driver sees NEITHER
        d = requests.get(f"{API}/bookings/{bid}", headers=_h(ctx["driver"]["token"])).json()
        assert "pickup_otp" not in d
        assert "delivery_otp" not in d
        assert "otp" not in d
        assert d.get("pickup_verified") is False
        assert d.get("delivery_verified") is False

    def test_bookings_mine_strips_otps_for_driver(self, admin_token):
        ctx = _setup_booking(admin_token)
        r = requests.get(f"{API}/bookings/mine", headers=_h(ctx["driver"]["token"]))
        assert r.status_code == 200
        for item in r.json():
            assert "pickup_otp" not in item
            assert "delivery_otp" not in item

    def test_in_transit_requires_pickup_otp_rejects_delivery(self, admin_token):
        ctx = _setup_booking(admin_token)
        bid = ctx["booking"]["id"]
        pickup = ctx["booking"]["pickup_otp"]
        delivery = ctx["booking"]["delivery_otp"]
        # Wrong OTP (delivery OTP)
        r = requests.post(f"{API}/bookings/{bid}/status",
                          headers=_h(ctx["driver"]["token"]),
                          params={"status": "in_transit", "otp": delivery})
        assert r.status_code == 400
        # No OTP
        r2 = requests.post(f"{API}/bookings/{bid}/status",
                           headers=_h(ctx["driver"]["token"]),
                           params={"status": "in_transit"})
        assert r2.status_code == 400
        # Correct pickup OTP → 200
        r3 = requests.post(f"{API}/bookings/{bid}/status",
                           headers=_h(ctx["driver"]["token"]),
                           params={"status": "in_transit", "otp": pickup})
        assert r3.status_code == 200, r3.text
        # Verify persisted
        b = requests.get(f"{API}/bookings/{bid}", headers=_h(ctx["customer"]["token"])).json()
        assert b["status"] == "in_transit"
        assert b["pickup_verified"] is True

    def test_delivered_requires_delivery_otp_rejects_pickup_and_cod_paid(self, admin_token):
        ctx = _setup_booking(admin_token, payment_method="cod")
        bid = ctx["booking"]["id"]
        pickup = ctx["booking"]["pickup_otp"]
        delivery = ctx["booking"]["delivery_otp"]
        # Advance to in_transit
        r0 = requests.post(f"{API}/bookings/{bid}/status",
                           headers=_h(ctx["driver"]["token"]),
                           params={"status": "in_transit", "otp": pickup})
        assert r0.status_code == 200
        # Wrong OTP (using pickup OTP for delivered) → 400
        r1 = requests.post(f"{API}/bookings/{bid}/status",
                           headers=_h(ctx["driver"]["token"]),
                           params={"status": "delivered", "otp": pickup})
        assert r1.status_code == 400
        # Correct delivery OTP → 200
        r2 = requests.post(f"{API}/bookings/{bid}/status",
                           headers=_h(ctx["driver"]["token"]),
                           params={"status": "delivered", "otp": delivery})
        assert r2.status_code == 200, r2.text
        b = requests.get(f"{API}/bookings/{bid}", headers=_h(ctx["customer"]["token"])).json()
        assert b["status"] == "delivered"
        assert b["delivery_verified"] is True
        # COD → payment_status flipped to paid_cod
        assert b["payment_status"] == "paid_cod"

    def test_cancel_before_pickup_ok_after_forbidden(self, admin_token):
        # Case 1: cancel before pickup verified — customer
        ctx = _setup_booking(admin_token)
        bid = ctx["booking"]["id"]
        r = requests.post(f"{API}/bookings/{bid}/cancel", headers=_h(ctx["customer"]["token"]))
        assert r.status_code == 200, r.text
        b = requests.get(f"{API}/bookings/{bid}", headers=_h(ctx["customer"]["token"])).json()
        assert b["status"] == "cancelled"

        # Case 2: cancel after pickup verified — should fail
        ctx2 = _setup_booking(admin_token)
        bid2 = ctx2["booking"]["id"]
        pickup2 = ctx2["booking"]["pickup_otp"]
        r0 = requests.post(f"{API}/bookings/{bid2}/status",
                           headers=_h(ctx2["driver"]["token"]),
                           params={"status": "in_transit", "otp": pickup2})
        assert r0.status_code == 200
        r_bad = requests.post(f"{API}/bookings/{bid2}/cancel", headers=_h(ctx2["customer"]["token"]))
        assert r_bad.status_code == 400

    def test_cancel_by_driver_ok_before_pickup(self, admin_token):
        ctx = _setup_booking(admin_token)
        bid = ctx["booking"]["id"]
        r = requests.post(f"{API}/bookings/{bid}/cancel", headers=_h(ctx["driver"]["token"]))
        assert r.status_code == 200


# --------------------------------------------------------------------
# Quotes: anonymized competing bids for drivers
# --------------------------------------------------------------------
class TestQuoteAnonymization:
    def test_driver_sees_own_full_competing_anonymized(self, admin_token):
        cust = _register_email("customer")
        drv1 = _register_email("driver")
        drv2 = _register_email("driver")

        def approved_truck(drv):
            t = requests.post(f"{API}/trucks", headers=_h(drv["token"]), json={
                "reg_number": f"KA{_rand(6).upper()}", "truck_type": "Mini Truck",
                "body_type": "Open", "load_capacity_kg": 800,
            }).json()
            requests.post(f"{API}/admin/trucks/{t['id']}/verify", headers=_h(admin_token))
            return t

        t1 = approved_truck(drv1)
        t2 = approved_truck(drv2)

        ship = requests.post(f"{API}/shipments", headers=_h(cust["token"]), json={
            "goods_category": "Parcels", "weight_kg": 100, "packages": 1,
            "pickup_address": "MG", "pickup_city": "Bangalore",
            "pickup_lat": 12.9716, "pickup_lng": 77.5946,
            "drop_address": "X", "drop_city": "Mumbai",
            "drop_lat": 19.0596, "drop_lng": 72.8295,
            "loading_date": "2026-05-01",
        }).json()

        q1 = requests.post(f"{API}/quotes", headers=_h(drv1["token"]), json={
            "shipment_id": ship["id"], "truck_id": t1["id"],
            "price_inr": 20000, "eta_hours": 20, "note": "",
        }).json()
        q2 = requests.post(f"{API}/quotes", headers=_h(drv2["token"]), json={
            "shipment_id": ship["id"], "truck_id": t2["id"],
            "price_inr": 25000, "eta_hours": 30, "note": "",
        }).json()

        # Driver 1's perspective
        r = requests.get(f"{API}/quotes/shipment/{ship['id']}", headers=_h(drv1["token"]))
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 2
        mine = [q for q in items if q.get("is_mine")]
        others = [q for q in items if not q.get("is_mine")]
        assert len(mine) == 1
        assert mine[0]["id"] == q1["id"]
        assert mine[0].get("driver_id") == drv1["user"]["id"]
        assert "truck_snapshot" in mine[0]
        assert "reg_number" in mine[0]["truck_snapshot"]
        # Competing quote must be anonymized
        assert len(others) == 1
        o = others[0]
        assert o["price_inr"] == 25000
        assert o.get("driver_name") == "Competing operator"
        assert "driver_id" not in o
        assert "driver_phone" not in o
        assert "truck_snapshot" not in o

        # Customer sees full detail for both
        rc = requests.get(f"{API}/quotes/shipment/{ship['id']}", headers=_h(cust["token"]))
        assert rc.status_code == 200
        items_c = rc.json()
        assert len(items_c) == 2
        for q in items_c:
            assert "driver_id" in q
            assert "driver_name" in q
            assert q["driver_name"] != "Competing operator"


# --------------------------------------------------------------------
# Shipment TTL 24h — via direct Mongo query
# --------------------------------------------------------------------
class TestShipmentTTL:
    def test_expires_at_roughly_24h(self):
        try:
            from pymongo import MongoClient
        except Exception:
            pytest.skip("pymongo not available")
        client = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client[os.environ.get("DB_NAME", "freightos_db")]

        cust = _register_email("customer")
        ship = requests.post(f"{API}/shipments", headers=_h(cust["token"]), json={
            "goods_category": "Parcels", "weight_kg": 100, "packages": 1,
            "pickup_address": "MG", "pickup_city": "Bangalore",
            "pickup_lat": 12.9716, "pickup_lng": 77.5946,
            "drop_address": "X", "drop_city": "Mumbai",
            "drop_lat": 19.0596, "drop_lng": 72.8295,
            "loading_date": "2026-05-01",
        }).json()
        doc = db.shipments.find_one({"id": ship["id"]})
        assert doc is not None
        assert "expires_at" in doc
        exp = doc["expires_at"]
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        delta = exp - datetime.now(timezone.utc)
        hours = delta.total_seconds() / 3600.0
        # Should be ~24h; give ±30 min tolerance
        assert 23.5 <= hours <= 24.5, f"expires_at delta = {hours}h, expected ~24h"
