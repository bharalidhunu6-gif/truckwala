"""
Iteration 4 backend regression: shipment photos (base64), booking live location
endpoints (POST/GET), location auth guards, history cap, legacy-truck migration,
response hygiene, and a happy-path booking spot-regression.
"""
import os
import uuid
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

# Load backend URL from frontend .env
load_dotenv(Path("/app/frontend/.env"))
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

# Load Mongo config for legacy truck injection
load_dotenv(Path("/app/backend/.env"))
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASSWORD = "admin1234"


def _rand():
    return uuid.uuid4().hex[:8]


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- Shared session ----------------
@pytest.fixture(scope="session")
def s():
    return requests.Session()


# ---------------- Auth helpers ----------------
@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _register(s, role, tag):
    body = {
        "name": f"TEST_{role}_{tag}",
        "email": f"test_{role}_{tag}@example.com",
        "phone": "+919000000000",
        "password": "test1234",
        "role": role,
    }
    r = s.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    return j["token"], j["user"]


# ---------------- End-to-end scenario fixture ----------------
@pytest.fixture(scope="session")
def scenario(s, admin_token):
    """Full booking scenario: customer, driver1 (assigned), driver2 (extra), truck approved, shipment, quote, accepted booking."""
    tag = _rand()
    c_tok, c_user = _register(s, "customer", tag)
    d1_tok, d1_user = _register(s, "driver", f"d1_{tag}")
    d2_tok, d2_user = _register(s, "driver", f"d2_{tag}")

    # Driver1 creates truck
    truck_body = {
        "reg_number": f"KA01TEST{tag[:4].upper()}",
        "truck_type": "14 Feet Truck",
        "body_type": "Open",
        "load_capacity_kg": 3500.0,
        "dimensions": "14x6x6",
        "base_lat": 12.9716,
        "base_lng": 77.5946,
        "base_city": "Bangalore",
    }
    r = s.post(f"{API}/trucks", json=truck_body, headers=_auth(d1_tok))
    assert r.status_code == 200, r.text
    truck_id = r.json()["id"]

    # Admin approves truck
    r = s.post(f"{API}/admin/trucks/{truck_id}/verify", headers=_auth(admin_token))
    assert r.status_code == 200
    assert r.json()["verification_status"] == "approved"

    # Customer creates shipment WITH photos
    photos = [
        "data:image/jpeg;base64,AAAA",
        "data:image/png;base64,BBBB",
    ]
    ship = {
        "goods_category": "Electronics",
        "weight_kg": 500.0,
        "packages": 3,
        "pickup_address": "Test Pickup",
        "pickup_city": "Bangalore",
        "pickup_lat": 12.9716,
        "pickup_lng": 77.5946,
        "drop_address": "Test Drop",
        "drop_city": "Chennai",
        "drop_lat": 13.0827,
        "drop_lng": 80.2707,
        "loading_date": "2026-01-25",
        "photos": photos,
        "instructions": "handle with care",
    }
    r = s.post(f"{API}/shipments", json=ship, headers=_auth(c_tok))
    assert r.status_code == 200, r.text
    shipment = r.json()
    sid = shipment["id"]

    # Driver1 quotes
    r = s.post(f"{API}/quotes", json={
        "shipment_id": sid, "truck_id": truck_id,
        "price_inr": 15000.0, "eta_hours": 8.0, "note": "ok"
    }, headers=_auth(d1_tok))
    assert r.status_code == 200, r.text
    qid = r.json()["id"]

    # Customer accepts
    r = s.post(f"{API}/bookings/accept/{qid}", headers=_auth(c_tok))
    assert r.status_code == 200, r.text
    booking = r.json()

    return {
        "customer": (c_tok, c_user),
        "driver1": (d1_tok, d1_user),
        "driver2": (d2_tok, d2_user),
        "truck_id": truck_id,
        "shipment_id": sid,
        "shipment": shipment,
        "photos": photos,
        "booking": booking,
        "quote_id": qid,
    }


# ================== 1. SHIPMENT PHOTOS ==================
class TestShipmentPhotos:
    def test_post_shipment_stores_photos(self, scenario):
        s_doc = scenario["shipment"]
        assert isinstance(s_doc.get("photos"), list)
        assert len(s_doc["photos"]) == 2
        assert s_doc["photos"] == scenario["photos"]

    def test_get_shipment_returns_photos(self, s, scenario):
        c_tok = scenario["customer"][0]
        sid = scenario["shipment_id"]
        r = s.get(f"{API}/shipments/{sid}", headers=_auth(c_tok))
        assert r.status_code == 200
        j = r.json()
        assert j["photos"] == scenario["photos"]
        assert "_id" not in j
        assert "password_hash" not in j

    def test_empty_photos_ok(self, s):
        tag = _rand()
        c_tok, _ = _register(s, "customer", f"nopho_{tag}")
        ship = {
            "goods_category": "Parcels", "weight_kg": 50.0, "packages": 1,
            "pickup_address": "A", "pickup_city": "Bangalore",
            "pickup_lat": 12.97, "pickup_lng": 77.59,
            "drop_address": "B", "drop_city": "Mysore",
            "drop_lat": 12.29, "drop_lng": 76.63,
            "loading_date": "2026-01-25",
            "photos": [],
        }
        r = s.post(f"{API}/shipments", json=ship, headers=_auth(c_tok))
        assert r.status_code == 200
        assert r.json()["photos"] == []


# ================== 2. LOCATION UPDATE (driver) ==================
class TestLocationUpdate:
    def test_assigned_driver_can_post_location(self, s, scenario):
        d1_tok = scenario["driver1"][0]
        bid = scenario["booking"]["id"]
        r = s.post(f"{API}/bookings/{bid}/location",
                   json={"lat": 12.9720, "lng": 77.5950},
                   headers=_auth(d1_tok))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert "at" in j

    def test_booking_get_shows_current_location(self, s, scenario):
        c_tok = scenario["customer"][0]
        bid = scenario["booking"]["id"]
        r = s.get(f"{API}/bookings/{bid}", headers=_auth(c_tok))
        assert r.status_code == 200
        b = r.json()
        assert b["current_lat"] == pytest.approx(12.9720)
        assert b["current_lng"] == pytest.approx(77.5950)
        assert b.get("location_updated_at")
        assert isinstance(b.get("location_history"), list)
        assert len(b["location_history"]) >= 1


# ================== 3. LOCATION GUARDS ==================
class TestLocationGuards:
    def test_customer_cannot_post_location(self, s, scenario):
        c_tok = scenario["customer"][0]
        bid = scenario["booking"]["id"]
        r = s.post(f"{API}/bookings/{bid}/location",
                   json={"lat": 1.0, "lng": 2.0}, headers=_auth(c_tok))
        assert r.status_code in (400, 403), r.text

    def test_other_driver_cannot_post_location(self, s, scenario):
        d2_tok = scenario["driver2"][0]
        bid = scenario["booking"]["id"]
        r = s.post(f"{API}/bookings/{bid}/location",
                   json={"lat": 1.0, "lng": 2.0}, headers=_auth(d2_tok))
        assert r.status_code == 403, r.text

    def test_cannot_update_after_delivered(self, s, admin_token):
        """Fresh booking flow, mark delivered, then try posting location."""
        tag = _rand()
        c_tok, _ = _register(s, "customer", f"del_c_{tag}")
        d_tok, _ = _register(s, "driver", f"del_d_{tag}")
        # truck
        r = s.post(f"{API}/trucks", json={
            "reg_number": f"KA02DEL{tag[:4].upper()}", "truck_type": "Mini Truck",
            "body_type": "Open", "load_capacity_kg": 1000.0,
        }, headers=_auth(d_tok))
        tid = r.json()["id"]
        s.post(f"{API}/admin/trucks/{tid}/verify", headers=_auth(admin_token))
        # shipment
        r = s.post(f"{API}/shipments", json={
            "goods_category": "Parcels", "weight_kg": 10.0, "packages": 1,
            "pickup_address": "A", "pickup_city": "Bangalore",
            "pickup_lat": 12.97, "pickup_lng": 77.59,
            "drop_address": "B", "drop_city": "Mysore",
            "drop_lat": 12.29, "drop_lng": 76.63,
            "loading_date": "2026-01-25", "photos": [],
        }, headers=_auth(c_tok))
        sid = r.json()["id"]
        # quote + accept
        r = s.post(f"{API}/quotes", json={
            "shipment_id": sid, "truck_id": tid,
            "price_inr": 500.0, "eta_hours": 2.0,
        }, headers=_auth(d_tok))
        qid = r.json()["id"]
        r = s.post(f"{API}/bookings/accept/{qid}", headers=_auth(c_tok))
        booking = r.json()
        bid = booking["id"]
        otp = booking["otp"]
        # in_transit
        r = s.post(f"{API}/bookings/{bid}/status?status=in_transit", headers=_auth(d_tok))
        assert r.status_code == 200
        # delivered with OTP
        r = s.post(f"{API}/bookings/{bid}/status?status=delivered&otp={otp}", headers=_auth(d_tok))
        assert r.status_code == 200
        # now location should be rejected
        r = s.post(f"{API}/bookings/{bid}/location",
                   json={"lat": 1.0, "lng": 2.0}, headers=_auth(d_tok))
        assert r.status_code == 400, r.text


# ================== 4. GET LOCATION AUTH ==================
class TestGetLocation:
    def test_customer_owner_gets_location(self, s, scenario):
        c_tok = scenario["customer"][0]
        bid = scenario["booking"]["id"]
        r = s.get(f"{API}/bookings/{bid}/location", headers=_auth(c_tok))
        assert r.status_code == 200
        j = r.json()
        assert "current_lat" in j and "current_lng" in j
        assert "location_updated_at" in j
        assert "_id" not in j and "password_hash" not in j

    def test_assigned_driver_gets_location(self, s, scenario):
        d1_tok = scenario["driver1"][0]
        bid = scenario["booking"]["id"]
        r = s.get(f"{API}/bookings/{bid}/location", headers=_auth(d1_tok))
        assert r.status_code == 200

    def test_third_party_cannot_get_location(self, s, scenario):
        # Register a fresh 3rd party customer
        tag = _rand()
        tp_tok, _ = _register(s, "customer", f"tp_{tag}")
        bid = scenario["booking"]["id"]
        r = s.get(f"{API}/bookings/{bid}/location", headers=_auth(tp_tok))
        assert r.status_code == 403

    def test_admin_can_get_location(self, s, scenario, admin_token):
        bid = scenario["booking"]["id"]
        r = s.get(f"{API}/bookings/{bid}/location", headers=_auth(admin_token))
        assert r.status_code == 200


# ================== 5. HISTORY CAP ==================
class TestLocationHistory:
    def test_multiple_updates_appended(self, s, scenario):
        d1_tok = scenario["driver1"][0]
        c_tok = scenario["customer"][0]
        bid = scenario["booking"]["id"]
        # Post 5 updates
        for i in range(5):
            r = s.post(f"{API}/bookings/{bid}/location",
                       json={"lat": 12.97 + i * 0.001, "lng": 77.59 + i * 0.001},
                       headers=_auth(d1_tok))
            assert r.status_code == 200
        # Fetch full booking and verify history has >=5 entries
        r = s.get(f"{API}/bookings/{bid}", headers=_auth(c_tok))
        assert r.status_code == 200
        hist = r.json().get("location_history", [])
        assert len(hist) >= 5
        # cap enforcement: <=100
        assert len(hist) <= 100
        # each entry structure
        for e in hist[:5]:
            assert "lat" in e and "lng" in e and "at" in e


# ================== 6. LEGACY TRUCK MIGRATION ==================
class TestLegacyMigration:
    """Insert a truck doc via Mongo WITHOUT verification_status, restart backend,
    then verify migrate_trucks hook backfilled it to approved."""

    def test_migration_backfills_legacy_truck(self, s, admin_token):
        legacy_id = f"legacy-{uuid.uuid4()}"
        legacy_reg = f"TESTLEG{_rand().upper()}"

        async def _insert():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            # Insert legacy-shaped truck WITHOUT verification_status
            await db.trucks.insert_one({
                "id": legacy_id,
                "owner_id": "legacy-owner",
                "owner_name": "TEST_legacy",
                "reg_number": legacy_reg,
                "truck_type": "Trailer",
                "body_type": "Open",
                "load_capacity_kg": 5000.0,
                "dimensions": "",
                "insurance_expiry": None,
                "base_lat": 12.97, "base_lng": 77.59, "base_city": "Bangalore",
                "active": True,
                "created_at": "2020-01-01T00:00:00Z",
            })
            client.close()

        async def _cleanup():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            await db.trucks.delete_one({"id": legacy_id})
            client.close()

        asyncio.get_event_loop().run_until_complete(_insert()) if False else asyncio.run(_insert())

        try:
            # Restart backend to trigger migrate_trucks
            os.system("sudo supervisorctl restart backend >/dev/null 2>&1")
            # Wait for backend to come up
            for _ in range(30):
                try:
                    r = s.get(f"{API}/", timeout=2)
                    if r.status_code == 200:
                        break
                except Exception:
                    pass
                time.sleep(1)

            # Re-login admin (token still valid but ensure fresh session)
            r = s.post(f"{API}/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
            assert r.status_code == 200
            fresh_admin_tok = r.json()["token"]

            # Query approved trucks and find our legacy truck
            r = s.get(f"{API}/admin/trucks?status=approved",
                      headers=_auth(fresh_admin_tok))
            assert r.status_code == 200
            trucks = r.json()
            match = next((t for t in trucks if t["id"] == legacy_id), None)
            assert match is not None, "Legacy truck not migrated to approved"
            assert match["verification_status"] == "approved"
            assert match["verified_by"] == "system-migration"
            assert match.get("verified_at")
            # response hygiene
            assert "_id" not in match
        finally:
            asyncio.run(_cleanup())


# ================== 7. RESPONSE HYGIENE ==================
class TestResponseHygiene:
    def test_no_mongo_id_or_pw_in_shipment(self, s, scenario):
        c_tok = scenario["customer"][0]
        sid = scenario["shipment_id"]
        r = s.get(f"{API}/shipments/{sid}", headers=_auth(c_tok))
        assert r.status_code == 200
        j = r.json()
        assert "_id" not in j and "password_hash" not in j

    def test_no_mongo_id_in_location_endpoints(self, s, scenario):
        d1_tok = scenario["driver1"][0]
        bid = scenario["booking"]["id"]
        r = s.post(f"{API}/bookings/{bid}/location",
                   json={"lat": 12.98, "lng": 77.60}, headers=_auth(d1_tok))
        assert "_id" not in r.json()
        r = s.get(f"{API}/bookings/{bid}/location", headers=_auth(d1_tok))
        assert "_id" not in r.json()


# ================== 8. SPOT REGRESSION: happy path ==================
class TestSpotRegression:
    def test_full_booking_happy_path(self, s, admin_token):
        tag = _rand()
        c_tok, _ = _register(s, "customer", f"hp_c_{tag}")
        d_tok, d_user = _register(s, "driver", f"hp_d_{tag}")

        r = s.post(f"{API}/trucks", json={
            "reg_number": f"HP{tag.upper()}", "truck_type": "Mini Truck",
            "body_type": "Open", "load_capacity_kg": 800.0,
        }, headers=_auth(d_tok))
        assert r.status_code == 200
        tid = r.json()["id"]

        r = s.post(f"{API}/admin/trucks/{tid}/verify", headers=_auth(admin_token))
        assert r.status_code == 200

        r = s.post(f"{API}/shipments", json={
            "goods_category": "FMCG", "weight_kg": 200.0, "packages": 5,
            "pickup_address": "P", "pickup_city": "Bangalore",
            "pickup_lat": 12.97, "pickup_lng": 77.59,
            "drop_address": "D", "drop_city": "Mysore",
            "drop_lat": 12.29, "drop_lng": 76.63,
            "loading_date": "2026-01-25", "photos": [],
        }, headers=_auth(c_tok))
        assert r.status_code == 200
        sid = r.json()["id"]

        r = s.post(f"{API}/quotes", json={
            "shipment_id": sid, "truck_id": tid,
            "price_inr": 800.0, "eta_hours": 3.0,
        }, headers=_auth(d_tok))
        assert r.status_code == 200
        qid = r.json()["id"]

        r = s.post(f"{API}/bookings/accept/{qid}", headers=_auth(c_tok))
        assert r.status_code == 200
        booking = r.json()
        bid = booking["id"]
        otp = booking["otp"]

        r = s.post(f"{API}/bookings/{bid}/status?status=in_transit", headers=_auth(d_tok))
        assert r.status_code == 200

        r = s.post(f"{API}/bookings/{bid}/status?status=delivered&otp={otp}",
                   headers=_auth(d_tok))
        assert r.status_code == 200

        # Rate
        r = s.post(f"{API}/ratings", json={
            "booking_id": bid, "rating": 5, "review": "great",
        }, headers=_auth(c_tok))
        assert r.status_code == 200
        assert r.json()["rating"] == 5
