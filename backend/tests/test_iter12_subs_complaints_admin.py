"""Iteration 12 backend tests for Truck Wala.

Covers:
- Truck creation with mandatory vehicle_photo + rc_photo
- Duplicate reg_number returns 409 with code=duplicate_reg_number
- /trucks/mine returns subscription + verified_badge fields
- Subscriptions: tiers endpoint (₹499 / ₹999), /order returns key_id, /verify HMAC negative path
- Online toggle: 402 without subscription, 409 in_use_elsewhere, one-truck-per-device
- Quotes: 402 subscription_required, 403 vehicle_banned, 409 duplicate
- Bookings: always cod, delivered increments completed_trips, payment_status=paid_cod
- Complaints: only customer can file
- Admin: /trucks?q, ban/unban/delete, /subscriptions?q, /complaints, /stats
"""
import os
import re
import uuid
import time
import pytest
import requests
import hmac
import hashlib
from pathlib import Path
from datetime import datetime, timezone, timedelta


def _load_base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        env_file = Path("/app/frontend/.env")
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                m = re.match(r"^EXPO_PUBLIC_BACKEND_URL=(.+)$", line.strip())
                if m:
                    url = m.group(1).strip().strip('"')
                    break
    assert url, "EXPO_PUBLIC_BACKEND_URL not found"
    return url.rstrip("/")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASSWORD = "S6bMgyCbE-1fao9IRcw6HWOmi8eldTD_"

# 1x1 transparent PNG data URI (small enough to pass photo validation)
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(headers, token):
    headers["Authorization"] = f"Bearer {token}"
    return headers


def _register(api, role: str):
    tag = uuid.uuid4().hex[:8]
    payload = {
        "name": f"TEST_{role}_{tag}",
        "email": f"TEST_{role}_{tag}@example.com",
        "phone": f"+9199999{tag[:5]}",
        "password": "test1234",
        "role": role,
    }
    r = api.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    return d["token"], d["user"]


def _admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _mongo_db():
    try:
        from pymongo import MongoClient
        c = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"), serverSelectionTimeoutMS=2000)
        return c[os.environ.get("DB_NAME", "freightos_db")]
    except Exception as e:
        pytest.skip(f"MongoDB unavailable: {e}")


# -------------------- Subscription tiers --------------------

def test_subscription_tiers(api):
    r = api.get(f"{BASE_URL}/api/subscriptions/tiers", timeout=10)
    assert r.status_code == 200, r.text
    tiers = r.json()
    assert isinstance(tiers, list) and len(tiers) == 2
    amounts = sorted(t["amount_inr"] for t in tiers)
    assert amounts == [499, 999], amounts
    small = next(t for t in tiers if t["amount_inr"] == 499)
    large = next(t for t in tiers if t["amount_inr"] == 999)
    assert small.get("max_gvw_kg") == 1500
    assert large.get("max_gvw_kg") in (None, 0)


# -------------------- Truck create: photos + duplicate --------------------

@pytest.fixture(scope="module")
def driver_ctx(api):
    token, user = _register(api, "driver")
    return {"token": token, "user": user}


@pytest.fixture(scope="module")
def customer_ctx(api):
    token, user = _register(api, "customer")
    return {"token": token, "user": user}


def _make_reg():
    return f"KA01T{uuid.uuid4().hex[:5].upper()}"


def test_truck_requires_photos(api, driver_ctx):
    reg = _make_reg()
    # Missing vehicle_photo
    payload = {"reg_number": reg, "truck_type": "Mini Truck", "body_type": "Open", "load_capacity_kg": 1000, "rc_photo": TINY_PNG}
    r = api.post(f"{BASE_URL}/api/trucks", json=payload, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 422, r.text
    # Missing rc_photo
    payload = {"reg_number": reg, "truck_type": "Mini Truck", "body_type": "Open", "load_capacity_kg": 1000, "vehicle_photo": TINY_PNG}
    r = api.post(f"{BASE_URL}/api/trucks", json=payload, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 422, r.text
    # Empty photo string is rejected too
    payload = {"reg_number": reg, "truck_type": "Mini Truck", "body_type": "Open", "load_capacity_kg": 1000, "vehicle_photo": "", "rc_photo": ""}
    r = api.post(f"{BASE_URL}/api/trucks", json=payload, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 422, r.text


@pytest.fixture(scope="module")
def small_truck(api, driver_ctx):
    """A GVW < 1500 kg truck (subscription tier ₹499)."""
    reg = _make_reg()
    payload = {
        "reg_number": reg,
        "truck_type": "Tata Ace",
        "body_type": "Open",
        "load_capacity_kg": 1000,
        "vehicle_photo": TINY_PNG,
        "rc_photo": TINY_PNG,
    }
    r = api.post(f"{BASE_URL}/api/trucks", json=payload, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 200, r.text
    t = r.json()
    return t


@pytest.fixture(scope="module")
def large_truck(api, driver_ctx):
    """A GVW ≥ 1500 kg truck (subscription tier ₹999)."""
    reg = _make_reg()
    payload = {
        "reg_number": reg,
        "truck_type": "17 Feet Truck",
        "body_type": "Closed Container",
        "load_capacity_kg": 5000,
        "vehicle_photo": TINY_PNG,
        "rc_photo": TINY_PNG,
    }
    r = api.post(f"{BASE_URL}/api/trucks", json=payload, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_duplicate_reg_number(api, driver_ctx, small_truck):
    payload = {
        "reg_number": small_truck["reg_number"],
        "truck_type": "Tata Ace",
        "body_type": "Open",
        "load_capacity_kg": 1000,
        "vehicle_photo": TINY_PNG,
        "rc_photo": TINY_PNG,
    }
    r = api.post(f"{BASE_URL}/api/trucks", json=payload, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 409, r.text
    detail = r.json().get("detail") or {}
    assert isinstance(detail, dict), f"expected structured detail, got {detail!r}"
    assert detail.get("code") == "duplicate_reg_number"


def test_trucks_mine_enriched(api, driver_ctx, small_truck):
    r = api.get(f"{BASE_URL}/api/trucks/mine", headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    t = next((x for x in items if x["id"] == small_truck["id"]), None)
    assert t is not None
    for key in ("subscription_active", "subscription_expires_at", "subscription_tier", "completed_trips", "verified_badge"):
        assert key in t, f"{key} missing from /trucks/mine"
    assert t["subscription_tier"]["amount_inr"] in (499, 999)
    assert t["subscription_tier"]["amount_inr"] == 499, "small truck should be ₹499 tier"
    assert t["subscription_active"] is False
    assert t["verified_badge"] is False


# -------------------- Online toggle & subscription gate --------------------

def _approve_truck(api, admin_token, truck_id):
    r = api.post(f"{BASE_URL}/api/admin/trucks/{truck_id}/verify", headers=_auth({}, admin_token), timeout=10)
    assert r.status_code == 200, r.text


def _activate_subscription_directly(truck_id, driver_id, reg):
    """Bypass Razorpay: seed an active subscription row directly in Mongo."""
    db = _mongo_db()
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "driver_id": driver_id,
        "driver_name": "TEST_seed",
        "truck_id": truck_id,
        "reg_number": reg,
        "tier_id": "tier_small",
        "amount_inr": 499,
        "razorpay_order_id": f"order_seed_{uuid.uuid4().hex[:10]}",
        "razorpay_payment_id": f"pay_seed_{uuid.uuid4().hex[:10]}",
        "status": "active",
        "created_at": now.isoformat(),
        "activated_at": now.isoformat(),
        "expires_at": now + timedelta(days=30),
    }
    db.subscriptions.insert_one(doc)
    return doc


def test_online_requires_subscription(api, driver_ctx, small_truck):
    # Admin approves first
    admin_token = _admin_token(api)
    _approve_truck(api, admin_token, small_truck["id"])
    device_a = f"deviceA_{uuid.uuid4().hex[:10]}"
    r = api.post(
        f"{BASE_URL}/api/trucks/{small_truck['id']}/online",
        json={"device_id": device_a},
        headers=_auth({}, driver_ctx["token"]),
        timeout=10,
    )
    assert r.status_code == 402, r.text
    d = r.json().get("detail") or {}
    assert isinstance(d, dict) and d.get("code") == "subscription_required", d


def test_subscriptions_order_returns_test_key(api, driver_ctx, small_truck):
    r = api.post(
        f"{BASE_URL}/api/subscriptions/order",
        json={"truck_id": small_truck["id"]},
        headers=_auth({}, driver_ctx["token"]),
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["key_id"].startswith("rzp_test_"), d["key_id"]
    assert d["amount_inr"] == 499
    assert d["amount_paise"] == 49900
    assert d["currency"] == "INR"
    assert d["mock_mode"] is False
    assert d["tier"]["amount_inr"] == 499
    # Verify pending row created
    db = _mongo_db()
    row = db.subscriptions.find_one({"id": d["subscription_id"]})
    assert row is not None
    assert row["status"] == "pending"


def test_verify_bad_signature_rejected(api, driver_ctx, small_truck):
    order = api.post(
        f"{BASE_URL}/api/subscriptions/order",
        json={"truck_id": small_truck["id"]},
        headers=_auth({}, driver_ctx["token"]),
        timeout=15,
    ).json()
    r = api.post(
        f"{BASE_URL}/api/subscriptions/verify",
        json={
            "truck_id": small_truck["id"],
            "subscription_id": order["subscription_id"],
            "razorpay_order_id": order["order_id"],
            "razorpay_payment_id": "pay_TEST_bad",
            "razorpay_signature": "definitely_wrong_signature",
        },
        headers=_auth({}, driver_ctx["token"]),
        timeout=15,
    )
    assert r.status_code == 400, r.text
    # Row should be marked failed
    db = _mongo_db()
    row = db.subscriptions.find_one({"id": order["subscription_id"]})
    assert row and row["status"] == "failed"


def test_online_toggle_one_device(api, driver_ctx, small_truck, large_truck):
    # Seed active subscription for BOTH trucks
    _activate_subscription_directly(small_truck["id"], driver_ctx["user"]["id"], small_truck["reg_number"])
    _activate_subscription_directly(large_truck["id"], driver_ctx["user"]["id"], large_truck["reg_number"])
    # Approve large truck
    admin_token = _admin_token(api)
    _approve_truck(api, admin_token, large_truck["id"])

    device_a = f"deviceA_{uuid.uuid4().hex[:10]}"
    device_b = f"deviceB_{uuid.uuid4().hex[:10]}"

    # device_A brings small_truck online
    r = api.post(f"{BASE_URL}/api/trucks/{small_truck['id']}/online", json={"device_id": device_a}, headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["online"] is True
    assert r.json()["online_device_id"] == device_a

    # device_B tries to grab same truck → 409 in_use_elsewhere
    r = api.post(f"{BASE_URL}/api/trucks/{small_truck['id']}/online", json={"device_id": device_b}, headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 409, r.text
    d = r.json().get("detail") or {}
    assert d.get("code") == "in_use_elsewhere"

    # Same device_A brings large_truck online → small truck must go offline
    r = api.post(f"{BASE_URL}/api/trucks/{large_truck['id']}/online", json={"device_id": device_a}, headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["online"] is True
    # Verify small truck is now offline
    r2 = api.get(f"{BASE_URL}/api/trucks/mine", headers=_auth({}, driver_ctx["token"]), timeout=10)
    small = next(x for x in r2.json() if x["id"] == small_truck["id"])
    assert small["online"] is False


# -------------------- Full end-to-end flow --------------------

@pytest.fixture(scope="module")
def booked_flow(api, driver_ctx, customer_ctx, large_truck):
    """Create shipment → driver quote → customer accepts → booking (COD)."""
    # Ensure large truck is approved + subscribed (idempotent)
    admin_token = _admin_token(api)
    _approve_truck(api, admin_token, large_truck["id"])
    db = _mongo_db()
    if not db.subscriptions.find_one({"truck_id": large_truck["id"], "status": "active"}):
        _activate_subscription_directly(large_truck["id"], driver_ctx["user"]["id"], large_truck["reg_number"])

    ship = api.post(
        f"{BASE_URL}/api/shipments",
        json={
            "goods_category": "Furniture",
            "weight_kg": 500,
            "packages": 3,
            "pickup_address": "Test pickup",
            "pickup_city": "Bangalore",
            "pickup_lat": 12.9716,
            "pickup_lng": 77.5946,
            "drop_address": "Test drop",
            "drop_city": "Mysore",
            "drop_lat": 12.2958,
            "drop_lng": 76.6394,
            "loading_date": "2026-02-01",
        },
        headers=_auth({}, customer_ctx["token"]),
        timeout=15,
    )
    assert ship.status_code == 200, ship.text
    sid = ship.json()["id"]

    quote = api.post(
        f"{BASE_URL}/api/quotes",
        json={"shipment_id": sid, "truck_id": large_truck["id"], "price_inr": 5000, "eta_hours": 6},
        headers=_auth({}, driver_ctx["token"]),
        timeout=15,
    )
    assert quote.status_code == 200, quote.text
    qid = quote.json()["id"]

    booking = api.post(
        f"{BASE_URL}/api/bookings/accept/{qid}",
        json={"payment_method": "razorpay"},  # deliberately send razorpay; server MUST override to cod
        headers=_auth({}, customer_ctx["token"]),
        timeout=15,
    )
    assert booking.status_code == 200, booking.text
    b = booking.json()
    return {"shipment_id": sid, "quote_id": qid, "booking": b}


def test_booking_always_cod(booked_flow):
    b = booked_flow["booking"]
    assert b["payment_method"] == "cod"
    assert b["payment_status"] == "cod_pending"
    assert b.get("pickup_otp") and b.get("delivery_otp")


def test_duplicate_quote_409(api, driver_ctx, large_truck, booked_flow):
    # Same driver, same shipment → 409
    r = api.post(
        f"{BASE_URL}/api/quotes",
        json={"shipment_id": booked_flow["shipment_id"], "truck_id": large_truck["id"], "price_inr": 4000, "eta_hours": 5},
        headers=_auth({}, driver_ctx["token"]),
        timeout=15,
    )
    # Shipment is already booked so status is not 'open' now — endpoint returns 400 "Shipment unavailable".
    # For duplicate-on-open-shipment we spawn a fresh scenario:
    assert r.status_code in (400, 409), r.text


def test_quotes_subscription_and_ban_gates(api, driver_ctx, customer_ctx):
    # New driver + truck with NO subscription
    tok, u = _register(api, "driver")
    admin_token = _admin_token(api)
    r = api.post(f"{BASE_URL}/api/trucks", json={
        "reg_number": _make_reg(), "truck_type": "Tata Ace", "body_type": "Open",
        "load_capacity_kg": 900, "vehicle_photo": TINY_PNG, "rc_photo": TINY_PNG,
    }, headers=_auth({}, tok), timeout=15)
    assert r.status_code == 200
    t = r.json()
    _approve_truck(api, admin_token, t["id"])

    # Fresh shipment
    ship = api.post(f"{BASE_URL}/api/shipments", json={
        "goods_category": "Parcels", "weight_kg": 200, "packages": 1,
        "pickup_address": "P", "pickup_city": "Bangalore",
        "pickup_lat": 12.97, "pickup_lng": 77.59,
        "drop_address": "D", "drop_city": "Mysore",
        "drop_lat": 12.29, "drop_lng": 76.63,
        "loading_date": "2026-02-01",
    }, headers=_auth({}, customer_ctx["token"]), timeout=15)
    sid = ship.json()["id"]

    # Quote WITHOUT subscription → 402 subscription_required
    r = api.post(f"{BASE_URL}/api/quotes", json={"shipment_id": sid, "truck_id": t["id"], "price_inr": 1000, "eta_hours": 3}, headers=_auth({}, tok), timeout=15)
    assert r.status_code == 402, r.text
    d = r.json().get("detail") or {}
    assert d.get("code") == "subscription_required"

    # Activate subscription + ban truck → 403 vehicle_banned
    _activate_subscription_directly(t["id"], u["id"], t["reg_number"])
    ban_r = api.post(f"{BASE_URL}/api/admin/trucks/{t['id']}/ban", json={"reason": "test"}, headers=_auth({}, admin_token), timeout=10)
    assert ban_r.status_code == 200
    r = api.post(f"{BASE_URL}/api/quotes", json={"shipment_id": sid, "truck_id": t["id"], "price_inr": 1000, "eta_hours": 3}, headers=_auth({}, tok), timeout=15)
    assert r.status_code == 403, r.text
    d = r.json().get("detail") or {}
    assert d.get("code") == "vehicle_banned"

    # Unban → 200
    ub = api.post(f"{BASE_URL}/api/admin/trucks/{t['id']}/unban", headers=_auth({}, admin_token), timeout=10)
    assert ub.status_code == 200
    r = api.post(f"{BASE_URL}/api/quotes", json={"shipment_id": sid, "truck_id": t["id"], "price_inr": 1000, "eta_hours": 3}, headers=_auth({}, tok), timeout=15)
    assert r.status_code == 200, r.text
    qid = r.json()["id"]

    # Duplicate quote (same driver, same shipment while OPEN) → 409
    r = api.post(f"{BASE_URL}/api/quotes", json={"shipment_id": sid, "truck_id": t["id"], "price_inr": 1200, "eta_hours": 4}, headers=_auth({}, tok), timeout=15)
    assert r.status_code == 409, r.text


def test_delivery_increments_trips(api, driver_ctx, customer_ctx, booked_flow):
    db = _mongo_db()
    driver_id = driver_ctx["user"]["id"]
    before = db.users.find_one({"id": driver_id}) or {}
    trips_before = int(before.get("completed_trips", 0) or 0)

    b = booked_flow["booking"]
    bid = b["id"]
    pickup_otp = b["pickup_otp"]
    delivery_otp = b["delivery_otp"]

    # in_transit with pickup OTP
    r = api.post(f"{BASE_URL}/api/bookings/{bid}/status?status=in_transit&otp={pickup_otp}", headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 200, r.text
    # delivered with delivery OTP
    r = api.post(f"{BASE_URL}/api/bookings/{bid}/status?status=delivered&otp={delivery_otp}", headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 200, r.text

    after = db.users.find_one({"id": driver_id}) or {}
    trips_after = int(after.get("completed_trips", 0) or 0)
    assert trips_after == trips_before + 1

    booking_db = db.bookings.find_one({"id": bid})
    assert booking_db["payment_status"] == "paid_cod"


# -------------------- Complaints --------------------

def test_complaint_customer_only(api, customer_ctx, driver_ctx, booked_flow):
    bid = booked_flow["booking"]["id"]
    # Driver cannot file
    r = api.post(f"{BASE_URL}/api/complaints", json={"booking_id": bid, "subject": "Rude", "message": "Driver was rude"}, headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 403

    # Customer can file
    r = api.post(f"{BASE_URL}/api/complaints", json={"booking_id": bid, "subject": "Late delivery", "message": "Very late"}, headers=_auth({}, customer_ctx["token"]), timeout=10)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["status"] == "open"
    assert c["reg_number"]
    assert c["driver_id"]
    assert c["subject"] == "Late delivery"


# -------------------- Admin --------------------

def test_admin_trucks_search_and_shape(api, small_truck):
    tok = _admin_token(api)
    q = small_truck["reg_number"][:4]
    r = api.get(f"{BASE_URL}/api/admin/trucks?q={q}", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert any(x["id"] == small_truck["id"] for x in rows), "search should return small_truck by reg substring"
    row = next(x for x in rows if x["id"] == small_truck["id"])
    for k in ("vehicle_photo", "rc_photo", "subscription_active", "subscription_expires_at", "subscription_tier", "complaints_open", "verified_badge"):
        assert k in row, f"admin trucks row missing key {k}"


def test_admin_ban_offline_and_delete(api, driver_ctx):
    """Standalone: ensure ban flips online:false and delete hard-removes."""
    tok = _admin_token(api)
    # Fresh truck for this test
    r = api.post(f"{BASE_URL}/api/trucks", json={
        "reg_number": _make_reg(), "truck_type": "Bolero Pickup", "body_type": "Open",
        "load_capacity_kg": 1200, "vehicle_photo": TINY_PNG, "rc_photo": TINY_PNG,
    }, headers=_auth({}, driver_ctx["token"]), timeout=15)
    assert r.status_code == 200
    t = r.json()
    _approve_truck(api, tok, t["id"])
    _activate_subscription_directly(t["id"], driver_ctx["user"]["id"], t["reg_number"])
    dev = f"devZ_{uuid.uuid4().hex[:10]}"
    r = api.post(f"{BASE_URL}/api/trucks/{t['id']}/online", json={"device_id": dev}, headers=_auth({}, driver_ctx["token"]), timeout=10)
    assert r.status_code == 200
    assert r.json()["online"] is True

    # Ban → banned true + online false
    r = api.post(f"{BASE_URL}/api/admin/trucks/{t['id']}/ban", json={"reason": "misconduct"}, headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["banned"] is True
    assert body["online"] is False

    # Unban
    r = api.post(f"{BASE_URL}/api/admin/trucks/{t['id']}/unban", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200
    assert r.json()["banned"] is False

    # Delete
    r = api.delete(f"{BASE_URL}/api/admin/trucks/{t['id']}", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200
    # Confirm 404 on subsequent detail
    r = api.get(f"{BASE_URL}/api/admin/trucks/{t['id']}", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 404


def test_admin_subscriptions_search(api, small_truck):
    tok = _admin_token(api)
    r = api.get(f"{BASE_URL}/api/admin/subscriptions?q={small_truck['reg_number'][:4]}", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    # Should find at least our seeded active row (small_truck was activated in an earlier test)
    assert any(x.get("truck_id") == small_truck["id"] for x in rows)


def test_admin_complaints_list_and_resolve(api):
    tok = _admin_token(api)
    r = api.get(f"{BASE_URL}/api/admin/complaints?status=open", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    if rows:
        cid = rows[0]["id"]
        r = api.post(f"{BASE_URL}/api/admin/complaints/{cid}/resolve", json={"resolution": "checked", "action": "resolve"}, headers=_auth({}, tok), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "resolved"


def test_admin_stats_keys(api):
    tok = _admin_token(api)
    r = api.get(f"{BASE_URL}/api/admin/stats", headers=_auth({}, tok), timeout=10)
    assert r.status_code == 200
    d = r.json()
    for k in ("trucks_banned", "open_complaints", "active_subscriptions"):
        assert k in d, f"missing stat key {k}"
