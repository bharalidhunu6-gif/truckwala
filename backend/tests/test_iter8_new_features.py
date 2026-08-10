"""Iteration 8 backend regression + new features.

Covers:
 - OTP send / verify (register + reset purposes)
 - Register uses verified OTP → email_verified / phone_verified flags
 - Forgot-password full flow + failure paths
 - Shipment PIN code fields
 - 100 km radius filter using driver's CURRENT GPS
 - customer_phone visibility rules for open-browse vs assigned driver
 - 72-hour auto-expire: `expires_at` present in DB, absent from API,
   $unset on booking, TTL index existence
 - Response hygiene (no _id, no password_hash)
 - Regression spot-checks: auth login/me, admin verify, bookings ACL, Razorpay mock
"""
import os
import secrets
import time
import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASSWORD = "S6bMgyCbE-1fao9IRcw6HWOmi8eldTD_"


def _rand() -> str:
    return secrets.token_hex(4)


def _register(role: str, email: str = None, phone: str = None, password: str = "test1234") -> dict:
    payload = {
        "name": f"TEST_{role}_{_rand()}",
        "email": email or f"TEST_{role}_{_rand()}@test.com",
        "phone": phone or f"+9198{secrets.randbelow(100000000):08d}",
        "password": password,
        "role": role,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    d["_password"] = password
    d["_email"] = payload["email"]
    d["_phone"] = payload["phone"]
    return d


def _headers(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return r.json()["token"]


# ---------------- OTP endpoints ----------------
class TestOTP:
    def test_otp_send_returns_dev_otp(self):
        ident = f"TEST_otp_{_rand()}@test.com"
        r = requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "register"}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert isinstance(d["dev_otp"], str) and len(d["dev_otp"]) == 4 and d["dev_otp"].isdigit()
        assert d["expires_in_seconds"] == 600

    def test_otp_send_reset_unknown_email_no_leak(self):
        # Even for a non-existent account we still return an OTP (no existence leak).
        ident = f"TEST_nobody_{_rand()}@test.com"
        r = requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "reset"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["dev_otp"].isdigit()

    def test_otp_verify_success_then_reuse_fails(self):
        ident = f"TEST_otp_{_rand()}@test.com"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "register"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/otp/verify", json={"identifier": ident, "code": code, "purpose": "register"})
        assert r.status_code == 200 and r.json()["verified"] is True
        r2 = requests.post(f"{API}/auth/otp/verify", json={"identifier": ident, "code": code, "purpose": "register"})
        assert r2.status_code == 400

    def test_otp_verify_wrong_code(self):
        ident = f"TEST_otp_{_rand()}@test.com"
        requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "register"})
        r = requests.post(f"{API}/auth/otp/verify", json={"identifier": ident, "code": "9999", "purpose": "register"})
        # A 4-digit random collision is 1/10000; retry once if it happens.
        if r.status_code == 200:
            r = requests.post(f"{API}/auth/otp/verify", json={"identifier": ident, "code": "0000", "purpose": "register"})
        assert r.status_code == 400

    def test_register_after_verified_email_otp_sets_email_verified(self):
        email = f"TEST_verify_{_rand()}@test.com"
        phone = f"+9199{secrets.randbelow(100000000):08d}"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": email, "purpose": "register"}).json()["dev_otp"]
        requests.post(f"{API}/auth/otp/verify", json={"identifier": email, "code": code, "purpose": "register"})
        r = requests.post(f"{API}/auth/register", json={
            "name": "verify", "email": email, "phone": phone, "password": "test1234", "role": "customer",
        })
        assert r.status_code == 200
        u = r.json()["user"]
        assert u.get("email_verified") is True
        assert u.get("phone_verified") is False
        # hygiene
        assert "_id" not in u
        assert "password_hash" not in u

    def test_register_after_verified_phone_otp_sets_phone_verified(self):
        email = f"TEST_verify_p_{_rand()}@test.com"
        phone = f"+9198{secrets.randbelow(100000000):08d}"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": phone, "purpose": "register"}).json()["dev_otp"]
        requests.post(f"{API}/auth/otp/verify", json={"identifier": phone, "code": code, "purpose": "register"})
        r = requests.post(f"{API}/auth/register", json={
            "name": "verify p", "email": email, "phone": phone, "password": "test1234", "role": "customer",
        })
        assert r.status_code == 200
        u = r.json()["user"]
        assert u.get("phone_verified") is True
        assert u.get("email_verified") is False


# ---------------- Forgot-password ----------------
class TestForgotPassword:
    def _prep_customer(self):
        return _register("customer")

    def test_full_reset_flow(self):
        c = self._prep_customer()
        email = c["_email"]
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": email, "purpose": "reset"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/reset-password", json={"email": email, "code": code, "new_password": "newpass123"})
        assert r.status_code == 200 and r.json()["ok"] is True
        # new works
        r1 = requests.post(f"{API}/auth/login", json={"email": email, "password": "newpass123"})
        assert r1.status_code == 200
        # old fails
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": c["_password"]})
        assert r2.status_code == 401

    def test_reset_wrong_code(self):
        c = self._prep_customer()
        requests.post(f"{API}/auth/otp/send", json={"identifier": c["_email"], "purpose": "reset"})
        r = requests.post(f"{API}/auth/reset-password", json={"email": c["_email"], "code": "0000", "new_password": "newpass123"})
        # if random collision, try alt
        if r.status_code == 200:
            r = requests.post(f"{API}/auth/reset-password", json={"email": c["_email"], "code": "9999", "new_password": "newpass123"})
        assert r.status_code == 400

    def test_reset_short_password(self):
        c = self._prep_customer()
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": c["_email"], "purpose": "reset"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/reset-password", json={"email": c["_email"], "code": code, "new_password": "abc"})
        assert r.status_code == 400

    def test_reset_unknown_email(self):
        email = f"TEST_none_{_rand()}@test.com"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": email, "purpose": "reset"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/reset-password", json={"email": email, "code": code, "new_password": "newpass123"})
        assert r.status_code == 400
        assert "not found" in r.text.lower()

    def test_reset_reused_code(self):
        c = self._prep_customer()
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": c["_email"], "purpose": "reset"}).json()["dev_otp"]
        r1 = requests.post(f"{API}/auth/reset-password", json={"email": c["_email"], "code": code, "new_password": "newpass123"})
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/reset-password", json={"email": c["_email"], "code": code, "new_password": "another123"})
        assert r2.status_code == 400


# ---------------- Shipment PIN codes ----------------
def _make_shipment(tok: str, pickup_lat=12.9716, pickup_lng=77.5946,
                   drop_lat=13.0827, drop_lng=80.2707, pincodes=True):
    body = {
        "goods_category": "Electronics",
        "weight_kg": 500,
        "packages": 5,
        "pickup_address": "Addr A",
        "pickup_city": "Bangalore",
        "pickup_lat": pickup_lat,
        "pickup_lng": pickup_lng,
        "drop_address": "Addr B",
        "drop_city": "Chennai",
        "drop_lat": drop_lat,
        "drop_lng": drop_lng,
        "loading_date": "2026-02-01",
    }
    if pincodes:
        body["pickup_pincode"] = "560001"
        body["drop_pincode"] = "600001"
    r = requests.post(f"{API}/shipments", json=body, headers=_headers(tok))
    assert r.status_code == 200, r.text
    return r.json()


class TestShipmentPincodes:
    def test_create_with_pincodes(self):
        c = _register("customer")
        s = _make_shipment(c["token"], pincodes=True)
        assert s["pickup_pincode"] == "560001"
        assert s["drop_pincode"] == "600001"
        assert "_id" not in s
        assert "expires_at" not in s
        # GET reflects it
        g = requests.get(f"{API}/shipments/{s['id']}", headers=_headers(c["token"]))
        assert g.status_code == 200
        gd = g.json()
        assert gd["pickup_pincode"] == "560001" and gd["drop_pincode"] == "600001"
        assert "expires_at" not in gd

    def test_create_without_pincodes_backcompat(self):
        c = _register("customer")
        s = _make_shipment(c["token"], pincodes=False)
        assert s.get("pickup_pincode") in (None,)
        assert s.get("drop_pincode") in (None,)


# ---------------- Helper: approved truck for a driver ----------------
def _make_approved_truck(driver: dict, admin_tok: str, base_lat=12.9716, base_lng=77.5946):
    body = {
        "reg_number": f"KA-{_rand().upper()[:4]}",
        "truck_type": "Mini Truck",
        "body_type": "Open",
        "load_capacity_kg": 1000,
        "base_lat": base_lat,
        "base_lng": base_lng,
        "base_city": "Bangalore",
    }
    r = requests.post(f"{API}/trucks", json=body, headers=_headers(driver["token"]))
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    v = requests.post(f"{API}/admin/trucks/{tid}/verify", headers=_headers(admin_tok))
    assert v.status_code == 200, v.text
    return tid


# ---------------- 100 km radius filter ----------------
class TestOpenShipmentsRadius:
    def test_radius_filter_and_distance_from_gps(self, admin_token):
        customer = _register("customer")
        # Post shipment at Bangalore
        s = _make_shipment(customer["token"], pickup_lat=12.9716, pickup_lng=77.5946)
        driver = _register("driver")
        # Ensure driver has an approved truck (base far away — but filter uses GPS supplied)
        _make_approved_truck(driver, admin_token, base_lat=28.7041, base_lng=77.1025)  # Delhi base

        # Driver near Bangalore reports current GPS ~50km away — should include the shipment
        r = requests.get(
            f"{API}/shipments/open",
            params={"lat": 12.5, "lng": 77.5946, "radius_km": 100},
            headers=_headers(driver["token"]),
        )
        assert r.status_code == 200
        items = r.json()
        ids = [i["id"] for i in items]
        assert s["id"] in ids, f"our shipment not in radius result: {ids}"
        picked = next(i for i in items if i["id"] == s["id"])
        assert "distance_from_you_km" in picked
        assert picked["distance_from_you_km"] < 100
        # customer_phone must be stripped
        assert "customer_phone" not in picked
        # sorted ascending by distance_from_you_km
        dists = [i["distance_from_you_km"] for i in items]
        assert dists == sorted(dists)

    def test_tiny_radius_returns_empty(self, admin_token):
        customer = _register("customer")
        _make_shipment(customer["token"], pickup_lat=12.9716, pickup_lng=77.5946)
        driver = _register("driver")
        _make_approved_truck(driver, admin_token)
        r = requests.get(
            f"{API}/shipments/open",
            params={"lat": 40.0, "lng": -74.0, "radius_km": 1},
            headers=_headers(driver["token"]),
        )
        assert r.status_code == 200
        assert r.json() == []

    def test_no_gps_fallback_truck_base(self, admin_token):
        customer = _register("customer")
        s = _make_shipment(customer["token"], pickup_lat=12.9716, pickup_lng=77.5946)
        driver = _register("driver")
        _make_approved_truck(driver, admin_token, base_lat=13.0, base_lng=77.6)
        r = requests.get(f"{API}/shipments/open", headers=_headers(driver["token"]))
        assert r.status_code == 200
        items = r.json()
        picked = next((i for i in items if i["id"] == s["id"]), None)
        assert picked is not None
        assert picked["distance_from_you_km"] is not None
        assert "customer_phone" not in picked

    def test_non_driver_forbidden(self):
        c = _register("customer")
        r = requests.get(f"{API}/shipments/open", headers=_headers(c["token"]))
        assert r.status_code == 403


# ---------------- Shipper phone visibility to assigned driver ----------------
class TestShipperPhoneVisibility:
    def _full_booking(self, admin_token):
        customer = _register("customer")
        s = _make_shipment(customer["token"])
        driver = _register("driver")
        truck_id = _make_approved_truck(driver, admin_token)
        q = requests.post(f"{API}/quotes", json={
            "shipment_id": s["id"], "truck_id": truck_id, "price_inr": 5000, "eta_hours": 6,
        }, headers=_headers(driver["token"]))
        assert q.status_code == 200, q.text
        qid = q.json()["id"]
        b = requests.post(f"{API}/bookings/accept/{qid}", headers=_headers(customer["token"]))
        assert b.status_code == 200, b.text
        return customer, driver, s, b.json()

    def test_assigned_driver_sees_phone_on_booking(self, admin_token):
        customer, driver, s, booking = self._full_booking(admin_token)
        r = requests.get(f"{API}/bookings/{booking['id']}", headers=_headers(driver["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d.get("customer_phone") == customer["_phone"]
        assert "_id" not in d

    def test_assigned_driver_sees_phone_on_shipment(self, admin_token):
        customer, driver, s, booking = self._full_booking(admin_token)
        r = requests.get(f"{API}/shipments/{s['id']}", headers=_headers(driver["token"]))
        assert r.status_code == 200
        assert r.json().get("customer_phone") == customer["_phone"]

    def test_other_driver_browsing_open_gets_phone_stripped(self, admin_token):
        # New open shipment, and a random OTHER driver GETs it
        customer = _register("customer")
        s = _make_shipment(customer["token"])
        other = _register("driver")
        _make_approved_truck(other, admin_token)
        r = requests.get(f"{API}/shipments/{s['id']}", headers=_headers(other["token"]))
        assert r.status_code == 200
        assert "customer_phone" not in r.json()


# ---------------- Auto-expire (TTL + $unset on booking) ----------------
class TestExpiresAt:
    @pytest.fixture(scope="class")
    def mongo(self):
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        yield db
        client.close()

    def test_expires_at_present_in_db_absent_from_api(self, mongo):
        db = mongo
        c = _register("customer")
        s = _make_shipment(c["token"])
        # API response shouldn't have expires_at
        assert "expires_at" not in s
        # But Mongo should have it, 72h from creation (± a few min)
        doc = db.shipments.find_one({"id": s["id"]})
        assert doc is not None
        assert "expires_at" in doc
        from datetime import datetime, timezone, timedelta
        exp = doc["expires_at"]
        if isinstance(exp, str):
            exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        delta = exp - datetime.now(timezone.utc)
        assert timedelta(hours=71) < delta < timedelta(hours=73)

    def test_expires_at_unset_after_booking(self, mongo, admin_token):
        db = mongo
        customer = _register("customer")
        s = _make_shipment(customer["token"])
        driver = _register("driver")
        tid = _make_approved_truck(driver, admin_token)
        q = requests.post(f"{API}/quotes", json={
            "shipment_id": s["id"], "truck_id": tid, "price_inr": 5000, "eta_hours": 6,
        }, headers=_headers(driver["token"]))
        assert q.status_code == 200
        b = requests.post(f"{API}/bookings/accept/{q.json()['id']}", headers=_headers(customer["token"]))
        assert b.status_code == 200
        doc = db.shipments.find_one({"id": s["id"]})
        assert doc is not None
        assert "expires_at" not in doc

    def test_ttl_index_exists(self, mongo):
        db = mongo
        idx = db.command("listIndexes", "shipments")
        specs = idx.get("cursor", {}).get("firstBatch", [])
        ttl_specs = [i for i in specs if "expires_at" in i.get("key", {}) and i.get("expireAfterSeconds") == 0]
        assert ttl_specs, f"no TTL index on shipments.expires_at found — got {specs}"


# ---------------- Regression spot-checks ----------------
class TestRegression:
    def test_auth_login_and_me(self):
        c = _register("customer")
        r = requests.get(f"{API}/auth/me", headers=_headers(c["token"]))
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == c["user"]["id"]
        assert "password_hash" not in d and "_id" not in d

    def test_admin_verify_and_reject(self, admin_token):
        driver = _register("driver")
        # add two trucks
        t1 = requests.post(f"{API}/trucks", json={
            "reg_number": f"KA-{_rand().upper()[:4]}", "truck_type": "Mini Truck",
            "body_type": "Open", "load_capacity_kg": 800,
        }, headers=_headers(driver["token"])).json()["id"]
        t2 = requests.post(f"{API}/trucks", json={
            "reg_number": f"KA-{_rand().upper()[:4]}", "truck_type": "Mini Truck",
            "body_type": "Open", "load_capacity_kg": 800,
        }, headers=_headers(driver["token"])).json()["id"]
        vr = requests.post(f"{API}/admin/trucks/{t1}/verify", headers=_headers(admin_token))
        assert vr.status_code == 200
        rj = requests.post(f"{API}/admin/trucks/{t2}/reject",
                           json={"reason": "docs missing"}, headers=_headers(admin_token))
        assert rj.status_code == 200

    def test_bookings_acl_random_user(self, admin_token):
        customer = _register("customer")
        s = _make_shipment(customer["token"])
        driver = _register("driver")
        tid = _make_approved_truck(driver, admin_token)
        q = requests.post(f"{API}/quotes", json={
            "shipment_id": s["id"], "truck_id": tid, "price_inr": 5000, "eta_hours": 6,
        }, headers=_headers(driver["token"])).json()
        b = requests.post(f"{API}/bookings/accept/{q['id']}", headers=_headers(customer["token"])).json()
        other = _register("customer")
        r = requests.get(f"{API}/bookings/{b['id']}", headers=_headers(other["token"]))
        assert r.status_code == 403

    def test_razorpay_mock_flow(self, admin_token):
        customer = _register("customer")
        s = _make_shipment(customer["token"])
        driver = _register("driver")
        tid = _make_approved_truck(driver, admin_token)
        q = requests.post(f"{API}/quotes", json={
            "shipment_id": s["id"], "truck_id": tid, "price_inr": 5000, "eta_hours": 6,
        }, headers=_headers(driver["token"])).json()
        b = requests.post(f"{API}/bookings/accept/{q['id']}", headers=_headers(customer["token"])).json()
        # create order via mock razorpay
        o = requests.post(f"{API}/pay/order", json={"booking_id": b["id"]}, headers=_headers(customer["token"]))
        assert o.status_code == 200, o.text
        od = o.json()
        assert "order_id" in od
        # verify — mock accepts any signature payload while placeholders present
        v = requests.post(f"{API}/pay/verify", json={
            "booking_id": b["id"],
            "razorpay_order_id": od["order_id"],
            "razorpay_payment_id": "pay_mock",
            "razorpay_signature": "sig_mock",
        }, headers=_headers(customer["token"]))
        assert v.status_code == 200, v.text
