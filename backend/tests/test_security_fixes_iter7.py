"""Iteration 7 — Security-fix validation tests for FreightOS.

Covers SEC-001..SEC-005 remediations plus regression happy path.
Runs against public BASE_URL from EXPO_PUBLIC_BACKEND_URL.
"""
import os
import time
import uuid
import pytest
import requests
from pathlib import Path

# --- BASE URL from env (frontend/.env EXPO_PUBLIC_BACKEND_URL) ---
def _load_base_url() -> str:
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL missing")

BASE = _load_base_url()
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@freightos.app"
NEW_ADMIN_PW = "S6bMgyCbE-1fao9IRcw6HWOmi8eldTD_"
OLD_ADMIN_PW = "admin1234"


def _r():
    return uuid.uuid4().hex[:8]


def _post(path, json=None, token=None):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    return requests.post(f"{API}{path}", json=json, headers=h, timeout=30)


def _get(path, token=None):
    h = {"Authorization": f"Bearer {token}"} if token else {}
    return requests.get(f"{API}{path}", headers=h, timeout=30)


def _register(role: str):
    email = f"{role}+{_r()}@test.com"
    payload = {
        "name": f"{role.title()} {_r()}",
        "email": email,
        "phone": "+9199" + str(uuid.uuid4().int)[:8],
        "password": "test1234",
        "role": role,
    }
    resp = _post("/auth/register", payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return data["token"], data["user"]


def _login(email: str, pw: str):
    return _post("/auth/login", {"email": email, "password": pw})


# ---------------- SEC-001: Admin credentials ----------------

class TestSEC001AdminCreds:
    def test_old_admin_password_rejected(self):
        r = _login(ADMIN_EMAIL, OLD_ADMIN_PW)
        assert r.status_code == 401, f"Old password should be invalid, got {r.status_code}: {r.text}"

    def test_new_admin_password_works(self):
        r = _login(ADMIN_EMAIL, NEW_ADMIN_PW)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "admin"


@pytest.fixture(scope="module")
def admin_token():
    r = _login(ADMIN_EMAIL, NEW_ADMIN_PW)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ---------------- Shared fixtures for object-level ACL ----------------

def _create_shipment(customer_token, extra=None):
    body = {
        "goods_category": "Furniture",
        "weight_kg": 500,
        "packages": 5,
        "pickup_address": "Addr A",
        "pickup_city": "Bangalore",
        "pickup_lat": 12.97,
        "pickup_lng": 77.59,
        "drop_address": "Addr B",
        "drop_city": "Chennai",
        "drop_lat": 13.08,
        "drop_lng": 80.27,
        "loading_date": "2026-02-01",
        "photos": [],
        "instructions": "handle with care",
    }
    if extra:
        body.update(extra)
    r = _post("/shipments", body, customer_token)
    return r


def _create_truck_and_approve(driver_token, admin_token):
    body = {
        "reg_number": f"KA{_r().upper()}",
        "truck_type": "Mini Truck",
        "body_type": "Open",
        "load_capacity_kg": 1500,
        "dimensions": "10x6",
    }
    r = _post("/trucks", body, driver_token)
    assert r.status_code == 200, r.text
    truck_id = r.json()["id"]
    # Admin approve
    ra = _post(f"/admin/trucks/{truck_id}/verify", token=admin_token)
    assert ra.status_code == 200, ra.text
    return truck_id


@pytest.fixture(scope="module")
def booked_setup(admin_token):
    """Produces {C1, C2, D1, D2, shipment_id, booking_id, truck_id_d1}."""
    c1_tok, c1 = _register("customer")
    c2_tok, c2 = _register("customer")
    d1_tok, d1 = _register("driver")
    d2_tok, d2 = _register("driver")
    t1 = _create_truck_and_approve(d1_tok, admin_token)
    t2 = _create_truck_and_approve(d2_tok, admin_token)

    sr = _create_shipment(c1_tok)
    assert sr.status_code == 200, sr.text
    sid = sr.json()["id"]

    # D1 and D2 both quote
    q1 = _post("/quotes", {"shipment_id": sid, "truck_id": t1, "price_inr": 5000, "eta_hours": 8, "note": ""}, d1_tok)
    assert q1.status_code == 200, q1.text
    q2 = _post("/quotes", {"shipment_id": sid, "truck_id": t2, "price_inr": 5500, "eta_hours": 9, "note": ""}, d2_tok)
    assert q2.status_code == 200, q2.text

    # C1 accepts D1's quote
    ar = _post(f"/bookings/accept/{q1.json()['id']}", token=c1_tok)
    assert ar.status_code == 200, ar.text
    bid = ar.json()["id"]
    return {
        "c1": (c1_tok, c1), "c2": (c2_tok, c2),
        "d1": (d1_tok, d1), "d2": (d2_tok, d2),
        "sid": sid, "bid": bid, "t1": t1,
        "q1_id": q1.json()["id"], "q2_id": q2.json()["id"],
    }


# ---------------- SEC-002: Object-level authorization ----------------

class TestSEC002Bookings:
    def test_get_booking_participants_ok(self, booked_setup, admin_token):
        b = booked_setup
        for tok in (b["c1"][0], b["d1"][0], admin_token):
            r = _get(f"/bookings/{b['bid']}", tok)
            assert r.status_code == 200, r.text

    def test_get_booking_outsiders_forbidden(self, booked_setup):
        b = booked_setup
        for tok in (b["c2"][0], b["d2"][0]):
            r = _get(f"/bookings/{b['bid']}", tok)
            assert r.status_code == 403, r.text

    def test_status_only_assigned_driver_or_admin(self, booked_setup, admin_token):
        b = booked_setup
        # C1 cannot
        r = _post(f"/bookings/{b['bid']}/status?status=in_transit", token=b["c1"][0])
        assert r.status_code == 403
        assert "assigned driver" in r.text.lower()
        # D2 cannot
        r = _post(f"/bookings/{b['bid']}/status?status=in_transit", token=b["d2"][0])
        assert r.status_code == 403
        # D1 can
        r = _post(f"/bookings/{b['bid']}/status?status=in_transit", token=b["d1"][0])
        assert r.status_code == 200, r.text
        # Admin can (idempotent same status)
        r = _post(f"/bookings/{b['bid']}/status?status=in_transit", token=admin_token)
        assert r.status_code == 200, r.text


class TestSEC002Shipments:
    def test_booked_shipment_visibility(self, booked_setup, admin_token):
        b = booked_setup
        sid = b["sid"]
        # Owner
        r = _get(f"/shipments/{sid}", b["c1"][0])
        assert r.status_code == 200
        # Assigned driver — customer_phone should be present
        r = _get(f"/shipments/{sid}", b["d1"][0])
        assert r.status_code == 200
        assert "customer_phone" in r.json(), "assigned driver should see customer_phone"
        # Other driver (shipment now booked, not open) -> 403
        r = _get(f"/shipments/{sid}", b["d2"][0])
        assert r.status_code == 403, r.text
        # Different customer
        r = _get(f"/shipments/{sid}", b["c2"][0])
        assert r.status_code == 403
        # Admin
        r = _get(f"/shipments/{sid}", admin_token)
        assert r.status_code == 200

    def test_open_shipment_driver_pii_stripped(self, admin_token):
        c_tok, _ = _register("customer")
        d_tok, _ = _register("driver")
        c2_tok, _ = _register("customer")
        sr = _create_shipment(c_tok)
        assert sr.status_code == 200
        sid = sr.json()["id"]
        # Owner sees phone
        r_own = _get(f"/shipments/{sid}", c_tok)
        assert r_own.status_code == 200 and "customer_phone" in r_own.json()
        # Random driver — 200 but customer_phone stripped
        r_drv = _get(f"/shipments/{sid}", d_tok)
        assert r_drv.status_code == 200
        assert "customer_phone" not in r_drv.json(), "PII must be stripped for browsing drivers"
        # Different customer forbidden
        r_c2 = _get(f"/shipments/{sid}", c2_tok)
        assert r_c2.status_code == 403
        # Admin ok
        r_ad = _get(f"/shipments/{sid}", admin_token)
        assert r_ad.status_code == 200


class TestSEC002Quotes:
    def test_quotes_visibility_matrix(self, booked_setup, admin_token):
        b = booked_setup
        sid = b["sid"]
        # Owner customer sees all quotes (2)
        r = _get(f"/quotes/shipment/{sid}", b["c1"][0])
        assert r.status_code == 200
        assert len(r.json()) == 2
        # Admin sees all
        r = _get(f"/quotes/shipment/{sid}", admin_token)
        assert r.status_code == 200
        assert len(r.json()) == 2
        # D1 (quoted) sees exactly 1 (their own)
        r = _get(f"/quotes/shipment/{sid}", b["d1"][0])
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["driver_id"] == b["d1"][1]["id"]
        # A driver who hasn't quoted -> empty list 200
        d3_tok, _ = _register("driver")
        r = _get(f"/quotes/shipment/{sid}", d3_tok)
        assert r.status_code == 200
        assert r.json() == []
        # Different customer -> 403
        r = _get(f"/quotes/shipment/{sid}", b["c2"][0])
        assert r.status_code == 403
        # Unknown shipment -> 404
        r = _get(f"/quotes/shipment/does-not-exist-{_r()}", b["c1"][0])
        assert r.status_code == 404


# ---------------- SEC-003: Payment verify (mock mode still works) ----------------

class TestSEC003Payments:
    def test_full_mock_pay_flow(self, admin_token):
        c_tok, _ = _register("customer")
        d_tok, _ = _register("driver")
        t_id = _create_truck_and_approve(d_tok, admin_token)
        sr = _create_shipment(c_tok)
        sid = sr.json()["id"]
        q = _post("/quotes", {"shipment_id": sid, "truck_id": t_id, "price_inr": 3000, "eta_hours": 5, "note": ""}, d_tok)
        assert q.status_code == 200
        ar = _post(f"/bookings/accept/{q.json()['id']}", token=c_tok)
        assert ar.status_code == 200
        bid = ar.json()["id"]
        # Create order
        ro = _post("/pay/order", {"booking_id": bid}, c_tok)
        assert ro.status_code == 200, ro.text
        j = ro.json()
        assert j["mock_mode"] is True
        assert j["order_id"].startswith("order_mock_"), j
        # Verify with the actual order_id + any signature
        rv = _post("/pay/verify", {
            "booking_id": bid,
            "razorpay_order_id": j["order_id"],
            "razorpay_payment_id": "pay_mock_anything",
            "razorpay_signature": "not-a-real-signature",
        }, c_tok)
        assert rv.status_code == 200, rv.text
        assert rv.json()["payment_status"] == "paid"

    def test_pay_source_has_generic_502_message(self):
        # Static check per request
        src = Path("/app/backend/routers/pay.py").read_text()
        assert "Payment gateway unavailable" in src
        assert "502" in src


# ---------------- SEC-004: Ratings ----------------

@pytest.fixture(scope="module")
def delivered_setup(admin_token):
    c1_tok, c1 = _register("customer")
    c2_tok, c2 = _register("customer")
    d1_tok, d1 = _register("driver")
    t_id = _create_truck_and_approve(d1_tok, admin_token)
    sr = _create_shipment(c1_tok)
    sid = sr.json()["id"]
    q = _post("/quotes", {"shipment_id": sid, "truck_id": t_id, "price_inr": 4200, "eta_hours": 6, "note": ""}, d1_tok)
    ar = _post(f"/bookings/accept/{q.json()['id']}", token=c1_tok)
    bid = ar.json()["id"]
    # in_transit
    r1 = _post(f"/bookings/{bid}/status?status=in_transit", token=d1_tok)
    assert r1.status_code == 200
    # fetch booking to get OTP
    booking = _get(f"/bookings/{bid}", d1_tok).json()
    otp = booking["otp"]
    r2 = _post(f"/bookings/{bid}/status?status=delivered&otp={otp}", token=d1_tok)
    assert r2.status_code == 200, r2.text
    return {"c1": (c1_tok, c1), "c2": (c2_tok, c2), "d1": (d1_tok, d1), "bid": bid}


class TestSEC004Ratings:
    def test_customer_rates_driver(self, delivered_setup):
        s = delivered_setup
        r = _post("/ratings", {"booking_id": s["bid"], "rating": 5, "review": "great"}, s["c1"][0])
        assert r.status_code == 200, r.text
        assert r.json()["rated_user_id"] == s["d1"][1]["id"]

    def test_customer_second_rating_conflict(self, delivered_setup):
        s = delivered_setup
        r = _post("/ratings", {"booking_id": s["bid"], "rating": 3}, s["c1"][0])
        assert r.status_code == 409, r.text

    def test_non_participant_forbidden(self, delivered_setup):
        s = delivered_setup
        r = _post("/ratings", {"booking_id": s["bid"], "rating": 5}, s["c2"][0])
        assert r.status_code == 403, r.text

    def test_driver_can_rate_customer(self, delivered_setup):
        s = delivered_setup
        r = _post("/ratings", {"booking_id": s["bid"], "rating": 4}, s["d1"][0])
        assert r.status_code == 200, r.text
        assert r.json()["rated_user_id"] == s["c1"][1]["id"]

    def test_driver_second_rating_conflict(self, delivered_setup):
        s = delivered_setup
        r = _post("/ratings", {"booking_id": s["bid"], "rating": 4}, s["d1"][0])
        assert r.status_code == 409

    def test_get_ratings_for_driver(self, delivered_setup):
        s = delivered_setup
        r = _get(f"/ratings/user/{s['d1'][1]['id']}")
        assert r.status_code == 200
        assert any(x["booking_id"] == s["bid"] for x in r.json())

    def test_rating_clamped(self, admin_token):
        # Build another delivered booking so we can test clamping fresh.
        c_tok, _ = _register("customer")
        d_tok, d = _register("driver")
        t_id = _create_truck_and_approve(d_tok, admin_token)
        sr = _create_shipment(c_tok)
        sid = sr.json()["id"]
        q = _post("/quotes", {"shipment_id": sid, "truck_id": t_id, "price_inr": 1000, "eta_hours": 2}, d_tok)
        ar = _post(f"/bookings/accept/{q.json()['id']}", token=c_tok)
        bid = ar.json()["id"]
        _post(f"/bookings/{bid}/status?status=in_transit", token=d_tok)
        otp = _get(f"/bookings/{bid}", d_tok).json()["otp"]
        _post(f"/bookings/{bid}/status?status=delivered&otp={otp}", token=d_tok)
        # rating = 0 -> clamped to 1
        r = _post("/ratings", {"booking_id": bid, "rating": 0}, c_tok)
        assert r.status_code == 200, r.text
        assert r.json()["rating"] == 1
        # driver rating = 99 -> clamped to 5
        r2 = _post("/ratings", {"booking_id": bid, "rating": 99}, d_tok)
        assert r2.status_code == 200
        assert r2.json()["rating"] == 5


# ---------------- SEC-005: Photo caps ----------------

class TestSEC005Photos:
    def test_five_photos_ok(self):
        c_tok, _ = _register("customer")
        r = _create_shipment(c_tok, {"photos": ["a" * 100] * 5})
        assert r.status_code == 200, r.text

    def test_six_photos_rejected(self):
        c_tok, _ = _register("customer")
        r = _create_shipment(c_tok, {"photos": ["a" * 100] * 6})
        assert r.status_code == 422, r.text
        assert "too many photos" in r.text.lower()

    def test_oversized_photo_rejected(self):
        c_tok, _ = _register("customer")
        r = _create_shipment(c_tok, {"photos": ["a" * 3_000_000]})
        assert r.status_code == 422, r.text[:200]
        assert "too large" in r.text.lower()

    def test_zero_photos_ok(self):
        c_tok, _ = _register("customer")
        r = _create_shipment(c_tok, {"photos": []})
        assert r.status_code == 200

    def test_instructions_truncated(self):
        c_tok, _ = _register("customer")
        long_txt = "x" * 5000
        r = _create_shipment(c_tok, {"instructions": long_txt})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        got = _get(f"/shipments/{sid}", c_tok).json()
        assert len(got["instructions"]) == 2000


# ---------------- Regression: catalog + auth/me ----------------

class TestRegression:
    def test_catalog_reachable(self):
        r = _get("/catalog")
        assert r.status_code == 200
        j = r.json()
        assert "truck_types" in j and "goods_categories" in j

    def test_auth_me(self):
        tok, u = _register("customer")
        r = _get("/auth/me", tok)
        assert r.status_code == 200
        assert r.json()["id"] == u["id"]

    def test_open_shipments_requires_driver(self):
        c_tok, _ = _register("customer")
        r = _get("/shipments/open", c_tok)
        assert r.status_code == 403
