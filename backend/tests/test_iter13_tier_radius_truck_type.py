"""Iter 13 backend tests: truck-type + tier-radius filtering on /shipments/open,
new response shape {items, context}, tier max_radius_km, and customer_phone
disclosure rules.
"""
import os
import uuid
import base64
import pytest
import requests
from pathlib import Path
from dotenv import dotenv_values

# Resolve BASE_URL from frontend/.env EXPO_PUBLIC_BACKEND_URL (source of truth)
_env = dotenv_values(Path("/app/frontend/.env"))
BASE_URL = (_env.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BASE_URL}/api"

# Tiny 1x1 PNG (base64 data URI) for vehicle_photo / rc_photo
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(role: str, name: str = "T13 User"):
    email = f"TEST_iter13_{role}_{_uid()}@t.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": name,
        "email": email,
        "phone": f"+9198{uuid.uuid4().int % 100000000:08d}",
        "password": "test1234",
        "role": role,
    })
    r.raise_for_status()
    d = r.json()
    return d["token"], d["user"]


def _create_truck(driver_token: str, truck_type: str, capacity_kg: float, lat=12.9716, lng=77.5946):
    r = requests.post(f"{API}/trucks", headers=_auth(driver_token), json={
        "reg_number": f"KA01T{uuid.uuid4().hex[:5].upper()}",
        "truck_type": truck_type,
        "body_type": "Open",
        "load_capacity_kg": capacity_kg,
        "dimensions": "10x6x6",
        "base_city": "Bangalore",
        "base_lat": lat,
        "base_lng": lng,
        "vehicle_photo": TINY_PNG,
        "rc_photo": TINY_PNG,
    })
    assert r.status_code == 200, f"POST /trucks failed: {r.status_code} {r.text}"
    return r.json()


def _approve_truck_via_mongo(truck_id: str):
    """Directly flip verification_status to approved via pymongo (admin approval
    endpoint also works but avoids admin token round-trip)."""
    try:
        from pymongo import MongoClient
        beenv = dotenv_values(Path("/app/backend/.env"))
        mc = MongoClient(beenv["MONGO_URL"])
        db = mc[beenv["DB_NAME"]]
        db.trucks.update_one({"id": truck_id}, {"$set": {"verification_status": "approved"}})
        mc.close()
        return True
    except Exception as e:
        pytest.skip(f"MongoDB not reachable to approve truck: {e}")


def _post_shipment(customer_token: str, truck_type: str, pickup_lat=12.9716, pickup_lng=77.5946):
    r = requests.post(f"{API}/shipments", headers=_auth(customer_token), json={
        "pickup_city": "Bangalore",
        "pickup_address": "Test pickup addr",
        "pickup_lat": pickup_lat,
        "pickup_lng": pickup_lng,
        "drop_city": "Mysore",
        "drop_address": "Test drop addr",
        "drop_lat": 12.2958,
        "drop_lng": 76.6394,
        "weight_kg": 500,
        "packages": 2,
        "goods_category": "FMCG",
        # NOTE: model field is `truck_type_preferred`; router code also
        # references `body.truck_type` (extra) — send both so we cover
        # both consumers.
        "truck_type_preferred": truck_type,
        "truck_type": truck_type,
        "loading_date": "2026-02-15",
        "photos": [],
    })
    assert r.status_code == 200, f"POST /shipments failed: {r.status_code} {r.text}"
    return r.json()


# ---------- Subscription tiers ----------
class TestSubscriptionTiers:
    def test_tiers_carry_max_radius_km(self):
        r = requests.get(f"{API}/subscriptions/tiers")
        assert r.status_code == 200
        tiers = r.json()
        assert isinstance(tiers, list) and len(tiers) == 2
        by_id = {t["id"]: t for t in tiers}
        assert by_id["tier_small"]["max_radius_km"] == 20
        assert by_id["tier_large"]["max_radius_km"] == 100
        assert by_id["tier_small"]["amount_inr"] == 499
        assert by_id["tier_large"]["amount_inr"] == 999


# ---------- /shipments/open shape + truck-type + radius ----------
class TestOpenShipmentsShapeAndFilters:
    @pytest.fixture(scope="class")
    def ctx(self):
        # Driver-small: Tata Ace only (500 kg)
        drv_small_token, drv_small = _register("driver", "SmallDrv")
        t_small = _create_truck(drv_small_token, "Tata Ace", 500)
        _approve_truck_via_mongo(t_small["id"])

        # Driver-large: Eicher 14ft (1500 kg+ → 100km tier)
        drv_large_token, drv_large = _register("driver", "LargeDrv")
        t_large = _create_truck(drv_large_token, "Eicher 14ft", 3500)
        _approve_truck_via_mongo(t_large["id"])

        # Customer
        cust_token, _ = _register("customer", "Cust13")

        # Shipment A: Tata Ace at pickup (12.9716, 77.5946) — same as driver base
        ship_ace_close = _post_shipment(cust_token, "Tata Ace", 12.9716, 77.5946)

        # Shipment B: Eicher 14ft same location
        ship_eicher_close = _post_shipment(cust_token, "Eicher 14ft", 12.9716, 77.5946)

        # Shipment C: Tata Ace ~25km away (roughly 0.22 deg lat ~= 24 km)
        ship_ace_far = _post_shipment(cust_token, "Tata Ace", 13.20, 77.5946)

        return {
            "drv_small_token": drv_small_token,
            "drv_large_token": drv_large_token,
            "cust_token": cust_token,
            "ship_ace_close_id": ship_ace_close["id"],
            "ship_eicher_close_id": ship_eicher_close["id"],
            "ship_ace_far_id": ship_ace_far["id"],
        }

    def test_response_is_object_with_items_and_context(self, ctx):
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946},
        )
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict), f"Expected dict, got {type(body)}"
        assert "items" in body and "context" in body
        c = body["context"]
        for k in ("max_radius_km", "effective_radius_km", "truck_types", "show_all_types"):
            assert k in c, f"context missing {k}"
        assert isinstance(c["truck_types"], list)
        assert isinstance(c["show_all_types"], bool)

    def test_small_tier_radius_20(self, ctx):
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946},
        )
        c = r.json()["context"]
        assert c["max_radius_km"] == 20
        assert c["effective_radius_km"] == 20
        assert "Tata Ace" in c["truck_types"]

    def test_large_tier_radius_100(self, ctx):
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_large_token"]),
            params={"lat": 12.9716, "lng": 77.5946},
        )
        c = r.json()["context"]
        assert c["max_radius_km"] == 100
        assert c["effective_radius_km"] == 100
        assert "Eicher 14ft" in c["truck_types"]

    def test_truck_type_filter_hides_non_matching(self, ctx):
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946},
        )
        items = r.json()["items"]
        ids = {s["id"] for s in items}
        assert ctx["ship_ace_close_id"] in ids, "Tata Ace shipment should be visible to small driver"
        assert ctx["ship_eicher_close_id"] not in ids, "Eicher shipment should be hidden from Tata-Ace-only driver"

    def test_show_all_types_reveals_all(self, ctx):
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946, "show_all_types": "true"},
        )
        body = r.json()
        assert body["context"]["show_all_types"] is True
        ids = {s["id"] for s in body["items"]}
        assert ctx["ship_ace_close_id"] in ids
        assert ctx["ship_eicher_close_id"] in ids

    def test_25km_shipment_visible_only_to_large_tier(self, ctx):
        # Small driver at Bangalore center should NOT see the ~25km Tata Ace shipment
        r_small = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946},
        )
        small_ids = {s["id"] for s in r_small.json()["items"]}
        assert ctx["ship_ace_far_id"] not in small_ids, "25km shipment must be outside 20km radius"

        # Large driver at same origin — she has only Eicher 14ft. Need show_all_types
        # to see the Tata Ace @ 25km. Verifies radius=100 filters it in.
        r_large = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_large_token"]),
            params={"lat": 12.9716, "lng": 77.5946, "show_all_types": "true"},
        )
        large_ids = {s["id"] for s in r_large.json()["items"]}
        assert ctx["ship_ace_far_id"] in large_ids, "Large-tier driver must see the 25km shipment"

    def test_radius_override_clamped_to_tier(self, ctx):
        # Client requests 1000 km; small driver still clamped to 20 km.
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946, "radius_km": 1000},
        )
        c = r.json()["context"]
        assert c["effective_radius_km"] == 20, "override must be clamped to tier max"

    def test_customer_phone_stripped_on_open_shipments(self, ctx):
        r = requests.get(
            f"{API}/shipments/open",
            headers=_auth(ctx["drv_small_token"]),
            params={"lat": 12.9716, "lng": 77.5946, "show_all_types": "true"},
        )
        for s in r.json()["items"]:
            assert "customer_phone" not in s, "customer_phone must be stripped for un-assigned drivers"


# ---------- Booking retains customer_phone for assigned driver ----------
class TestBookingCustomerPhoneDisclosure:
    def test_booking_shows_customer_phone_to_assigned_driver_only(self):
        # Setup: customer + driver + approved truck + shipment + quote + accept
        drv_token, drv = _register("driver", "TapCallDrv")
        truck = _create_truck(drv_token, "Tata Ace", 500)
        _approve_truck_via_mongo(truck["id"])

        # Give driver an active subscription so quotes go through
        try:
            from pymongo import MongoClient
            from datetime import datetime, timezone, timedelta
            beenv = dotenv_values(Path("/app/backend/.env"))
            mc = MongoClient(beenv["MONGO_URL"])
            db = mc[beenv["DB_NAME"]]
            db.subscriptions.insert_one({
                "id": f"sub_seed_{_uid()}",
                "driver_id": drv["id"],
                "truck_id": truck["id"],
                "tier_id": "tier_small",
                "amount_inr": 499,
                "razorpay_order_id": f"order_seed_{_uid()}",
                "razorpay_payment_id": f"pay_seed_{_uid()}",
                "status": "active",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "activated_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=30),
            })
            mc.close()
        except Exception as e:
            pytest.skip(f"MongoDB seed failed: {e}")

        cust_token, _ = _register("customer", "TapCallCust")
        shipment = _post_shipment(cust_token, "Tata Ace")

        # Driver submits quote
        r_q = requests.post(f"{API}/quotes", headers=_auth(drv_token), json={
            "shipment_id": shipment["id"],
            "truck_id": truck["id"],
            "price_inr": 5000,
            "eta_hours": 6,
            "notes": "test",
        })
        assert r_q.status_code == 200, f"POST /quotes failed: {r_q.status_code} {r_q.text}"
        quote = r_q.json()

        # Customer accepts quote → booking
        r_b = requests.post(f"{API}/bookings/accept/{quote['id']}", headers=_auth(cust_token), json={
            "payment_method": "cod",
        })
        assert r_b.status_code == 200, f"POST /bookings/accept failed: {r_b.status_code} {r_b.text}"
        booking = r_b.json()

        # Assigned driver should see customer_phone
        r_get = requests.get(f"{API}/bookings/{booking['id']}", headers=_auth(drv_token))
        assert r_get.status_code == 200
        got = r_get.json()
        assert got.get("customer_phone"), "assigned driver MUST see customer_phone for tap-to-call"

        # Another driver (not assigned) on /shipments/{sid} must NOT see phone.
        other_drv_token, _ = _register("driver", "OtherDrv")
        other_truck = _create_truck(other_drv_token, "Tata Ace", 500)
        _approve_truck_via_mongo(other_truck["id"])
        # Shipment is now booked (not "open") — non-assigned driver should get 403 or no phone.
        r_ship = requests.get(f"{API}/shipments/{shipment['id']}", headers=_auth(other_drv_token))
        # Either 403 (no longer open) or 200 without phone — both acceptable regression.
        if r_ship.status_code == 200:
            assert "customer_phone" not in r_ship.json() or not r_ship.json().get("customer_phone")


# ---------- POST /shipments still creates row for matching truck_type ----------
class TestCreateShipmentPersists:
    def test_create_shipment_tata_ace_returns_200(self):
        cust_token, _ = _register("customer", "CreateCust")
        r = requests.post(f"{API}/shipments", headers=_auth(cust_token), json={
            "pickup_city": "Bangalore",
            "pickup_address": "addr",
            "pickup_lat": 12.9716,
            "pickup_lng": 77.5946,
            "drop_city": "Mysore",
            "drop_address": "addr",
            "drop_lat": 12.2958,
            "drop_lng": 76.6394,
            "weight_kg": 400,
            "packages": 1,
            "goods_category": "FMCG",
            "truck_type_preferred": "Tata Ace",
            "truck_type": "Tata Ace",
            "loading_date": "2026-02-15",
            "photos": [],
        })
        assert r.status_code == 200
        d = r.json()
        assert d.get("truck_type_preferred") == "Tata Ace" or d.get("truck_type") == "Tata Ace"
        assert d["status"] == "open"
        assert d["id"]
