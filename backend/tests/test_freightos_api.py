"""FreightOS backend API tests - covers auth, trucks, shipments, quotes, bookings, ratings, earnings, payments."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://freight-match-34.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Shared state across tests
STATE = {}


def _rand_email(prefix: str) -> str:
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_01_register_customer(self, session):
        email = _rand_email("cust")
        r = session.post(f"{API}/auth/register", json={
            "name": "Test Customer", "email": email, "phone": "9999900001",
            "password": "Passw0rd!", "role": "customer",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "user" in data
        assert data["user"]["role"] == "customer"
        assert data["user"]["email"] == email.lower()
        assert "_id" not in data["user"]
        assert "password_hash" not in data["user"]
        STATE["customer"] = {"email": email, "password": "Passw0rd!", "token": data["token"], "user": data["user"]}

    def test_02_register_driver(self, session):
        email = _rand_email("drv")
        r = session.post(f"{API}/auth/register", json={
            "name": "Test Driver", "email": email, "phone": "9999900002",
            "password": "Passw0rd!", "role": "driver",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "driver"
        STATE["driver"] = {"email": email, "password": "Passw0rd!", "token": data["token"], "user": data["user"]}

    def test_03_login_customer(self, session):
        c = STATE["customer"]
        r = session.post(f"{API}/auth/login", json={"email": c["email"], "password": c["password"]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data
        assert data["user"]["id"] == c["user"]["id"]
        STATE["customer"]["token"] = data["token"]

    def test_04_login_driver(self, session):
        d = STATE["driver"]
        r = session.post(f"{API}/auth/login", json={"email": d["email"], "password": d["password"]})
        assert r.status_code == 200
        STATE["driver"]["token"] = r.json()["token"]

    def test_05_auth_me(self, session):
        r = session.get(f"{API}/auth/me", headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200
        u = r.json()
        assert u["id"] == STATE["customer"]["user"]["id"]
        assert "password_hash" not in u
        assert "_id" not in u

    def test_06_invalid_token_401(self, session):
        r = session.get(f"{API}/auth/me", headers={"Authorization": "Bearer garbage.token.here"})
        assert r.status_code == 401

    def test_07_missing_auth_401(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------- Catalog ----------
class TestCatalog:
    def test_08_catalog(self, session):
        r = session.get(f"{API}/catalog")
        assert r.status_code == 200
        data = r.json()
        assert "Mini Truck" in data["truck_types"]
        assert "Tata Ace" in data["truck_types"]
        assert "Household shifting" in data["goods_categories"]
        assert isinstance(data["body_types"], list) and len(data["body_types"]) > 0


# ---------- Trucks ----------
class TestTrucks:
    def test_09_customer_cannot_create_truck(self, session):
        r = session.post(f"{API}/trucks", json={
            "reg_number": "KA01AB1234", "truck_type": "Tata Ace",
            "body_type": "Open", "load_capacity_kg": 750,
        }, headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 403

    def test_10_driver_create_truck(self, session):
        r = session.post(f"{API}/trucks", json={
            "reg_number": f"KA01TEST{uuid.uuid4().hex[:4].upper()}",
            "truck_type": "Tata Ace", "body_type": "Open",
            "load_capacity_kg": 750, "dimensions": "8x5x5",
            "base_lat": 12.9716, "base_lng": 77.5946, "base_city": "Bangalore",
        }, headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200, r.text
        t = r.json()
        assert "id" in t
        assert t["truck_type"] == "Tata Ace"
        assert t["load_capacity_kg"] == 750
        assert "_id" not in t
        STATE["truck_id"] = t["id"]

    def test_11_get_my_trucks(self, session):
        r = session.get(f"{API}/trucks/mine", headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200
        items = r.json()
        assert any(t["id"] == STATE["truck_id"] for t in items)


# ---------- Shipments ----------
class TestShipments:
    def test_12_driver_cannot_create_shipment(self, session):
        r = session.post(f"{API}/shipments", json={
            "goods_category": "Furniture", "weight_kg": 200, "packages": 5,
            "pickup_address": "A", "pickup_city": "Bangalore",
            "pickup_lat": 12.9716, "pickup_lng": 77.5946,
            "drop_address": "B", "drop_city": "Mysore",
            "drop_lat": 12.2958, "drop_lng": 76.6394,
            "loading_date": "2026-02-01",
        }, headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 403

    def test_13_customer_create_shipment(self, session):
        r = session.post(f"{API}/shipments", json={
            "goods_category": "Household shifting", "weight_kg": 500, "packages": 10,
            "pickup_address": "MG Road, Bangalore", "pickup_city": "Bangalore",
            "pickup_lat": 12.9716, "pickup_lng": 77.5946,
            "drop_address": "Palace Rd, Mysore", "drop_city": "Mysore",
            "drop_lat": 12.2958, "drop_lng": 76.6394,
            "loading_date": "2026-02-01",
            "truck_type_preferred": "Tata Ace",
        }, headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["status"] == "open"
        assert s["distance_km"] > 0
        # BLR-Mysore ~ 130-140 km
        assert 100 < s["distance_km"] < 200
        assert "_id" not in s
        STATE["shipment_id"] = s["id"]

    def test_14_get_my_shipments_customer(self, session):
        r = session.get(f"{API}/shipments/mine", headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200
        items = r.json()
        assert any(s["id"] == STATE["shipment_id"] for s in items)

    def test_15_open_shipments_driver(self, session):
        r = session.get(f"{API}/shipments/open", headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200
        items = r.json()
        found = [s for s in items if s["id"] == STATE["shipment_id"]]
        assert found, "Open shipment not visible to driver"
        assert "distance_from_you_km" in found[0]
        assert found[0]["distance_from_you_km"] is not None

    def test_16_customer_cannot_see_open_shipments(self, session):
        r = session.get(f"{API}/shipments/open", headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 403


# ---------- Quotes & Bookings ----------
class TestQuotesBookings:
    def test_17_driver_submit_quote(self, session):
        r = session.post(f"{API}/quotes", json={
            "shipment_id": STATE["shipment_id"], "truck_id": STATE["truck_id"],
            "price_inr": 8000, "eta_hours": 5, "note": "Available",
        }, headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["status"] == "pending"
        assert q["price_inr"] == 8000
        STATE["quote_id"] = q["id"]

    def test_18_list_quotes_sorted_by_price(self, session):
        # Add a 2nd higher-priced quote to verify sorting
        session.post(f"{API}/quotes", json={
            "shipment_id": STATE["shipment_id"], "truck_id": STATE["truck_id"],
            "price_inr": 12000, "eta_hours": 4, "note": "Faster",
        }, headers=_auth(STATE["driver"]["token"]))
        r = session.get(f"{API}/quotes/shipment/{STATE['shipment_id']}",
                        headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200
        quotes = r.json()
        assert len(quotes) >= 2
        prices = [q["price_inr"] for q in quotes]
        assert prices == sorted(prices)

    def test_19_accept_quote_creates_booking(self, session):
        r = session.post(f"{API}/bookings/accept/{STATE['quote_id']}",
                         headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "confirmed"
        assert b["price_inr"] == 8000
        assert b.get("otp")
        STATE["booking_id"] = b["id"]
        STATE["otp"] = b["otp"]

        # Verify shipment is booked, quote is accepted
        sh = session.get(f"{API}/shipments/{STATE['shipment_id']}",
                         headers=_auth(STATE["customer"]["token"])).json()
        assert sh["status"] == "booked"

    def test_20_bookings_mine_customer_and_driver(self, session):
        r_cust = session.get(f"{API}/bookings/mine", headers=_auth(STATE["customer"]["token"]))
        r_drv = session.get(f"{API}/bookings/mine", headers=_auth(STATE["driver"]["token"]))
        assert r_cust.status_code == 200 and r_drv.status_code == 200
        assert any(b["id"] == STATE["booking_id"] for b in r_cust.json())
        assert any(b["id"] == STATE["booking_id"] for b in r_drv.json())

    def test_21_in_transit_status(self, session):
        r = session.post(f"{API}/bookings/{STATE['booking_id']}/status",
                         params={"status": "in_transit"},
                         headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200, r.text

    def test_22_delivered_without_otp_fails(self, session):
        r = session.post(f"{API}/bookings/{STATE['booking_id']}/status",
                         params={"status": "delivered"},
                         headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 400

    def test_23_delivered_with_otp_succeeds(self, session):
        r = session.post(f"{API}/bookings/{STATE['booking_id']}/status",
                         params={"status": "delivered", "otp": STATE["otp"]},
                         headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200, r.text


# ---------- Ratings & Earnings ----------
class TestRatingsEarnings:
    def test_24_customer_rates_driver(self, session):
        r = session.post(f"{API}/ratings", json={
            "booking_id": STATE["booking_id"], "rating": 5, "review": "Great service",
        }, headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200, r.text
        # Verify driver avg_rating updated
        drv_id = STATE["driver"]["user"]["id"]
        # Login as driver and fetch profile
        r2 = session.get(f"{API}/auth/me", headers=_auth(STATE["driver"]["token"]))
        assert r2.status_code == 200
        assert r2.json().get("avg_rating") == 5.0

    def test_25_earnings_summary(self, session):
        r = session.get(f"{API}/earnings/summary", headers=_auth(STATE["driver"]["token"]))
        assert r.status_code == 200
        e = r.json()
        assert e["trips_completed"] >= 1
        assert e["total_earned_inr"] >= 8000


# ---------- Payments (Razorpay mock) ----------
class TestPayments:
    def test_26_create_pay_order_mock(self, session):
        r = session.post(f"{API}/pay/order", json={"booking_id": STATE["booking_id"]},
                         headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["mock_mode"] is True
        assert data["order_id"].startswith("order_mock_")
        assert data["amount_paise"] == 8000 * 100
        STATE["order_id"] = data["order_id"]

    def test_27_verify_payment_mock(self, session):
        r = session.post(f"{API}/pay/verify", json={
            "booking_id": STATE["booking_id"],
            "razorpay_order_id": STATE["order_id"],
            "razorpay_payment_id": "pay_mock_" + uuid.uuid4().hex[:12],
            "razorpay_signature": "mock_signature",
        }, headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200, r.text
        assert r.json()["payment_status"] == "paid"

        # Verify persisted
        b = session.get(f"{API}/bookings/{STATE['booking_id']}",
                        headers=_auth(STATE["customer"]["token"])).json()
        assert b["payment_status"] == "paid"


# ---------- No _id leakage ----------
class TestNoIdLeak:
    def test_28_no_mongo_id_leakage_across_endpoints(self, session):
        endpoints = [
            (f"{API}/auth/me", STATE["customer"]["token"]),
            (f"{API}/trucks/mine", STATE["driver"]["token"]),
            (f"{API}/shipments/mine", STATE["customer"]["token"]),
            (f"{API}/shipments/open", STATE["driver"]["token"]),
            (f"{API}/quotes/shipment/{STATE['shipment_id']}", STATE["customer"]["token"]),
            (f"{API}/bookings/mine", STATE["customer"]["token"]),
        ]
        for url, tok in endpoints:
            r = session.get(url, headers=_auth(tok))
            assert r.status_code == 200, url
            text = r.text
            assert '"_id"' not in text, f"_id leaked at {url}"
            assert '"password_hash"' not in text, f"password_hash leaked at {url}"
