"""FreightOS Admin verification workflow + Razorpay mock re-check + spot regression.

Covers review items 1-16:
- Razorpay mock re-verify (1)
- Admin seed + register-as-admin (2, 3)
- Admin stats endpoint + guard (4, 5)
- Truck default verification_status (6)
- Admin list trucks with filters (7, 13)
- Quote blocked while truck pending / rejected (8, 12)
- Approve truck + then quote succeeds (9, 10)
- Reject truck with reason (11)
- 404 on unknown truck (14)
- Non-admin 403 on admin endpoints (15)
- Spot regression: register/login/me, catalog, no _id/password_hash leaks (16)
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

STATE = {}


def _rand_email(prefix: str) -> str:
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Spot regression: catalog + register + me (item 16) ----------
class TestRegression:
    def test_01_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_02_catalog(self, session):
        r = session.get(f"{API}/catalog")
        assert r.status_code == 200
        data = r.json()
        assert "truck_types" in data and len(data["truck_types"]) > 0
        assert "goods_categories" in data and len(data["goods_categories"]) > 0
        assert "body_types" in data and len(data["body_types"]) > 0

    def test_03_register_customer(self, session):
        email = _rand_email("cust")
        r = session.post(f"{API}/auth/register", json={
            "name": "Cust One", "email": email, "phone": "9990000001",
            "password": "Passw0rd!", "role": "customer",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "customer"
        assert "_id" not in data["user"]
        assert "password_hash" not in data["user"]
        STATE["customer"] = {"email": email, "password": "Passw0rd!", "token": data["token"], "user": data["user"]}

    def test_04_login_and_me(self, session):
        c = STATE["customer"]
        r = session.post(f"{API}/auth/login", json={"email": c["email"], "password": c["password"]})
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        r2 = session.get(f"{API}/auth/me", headers=_auth(tok))
        assert r2.status_code == 200
        me = r2.json()
        assert me["email"] == c["email"].lower()
        assert "password_hash" not in me and "_id" not in me


# ---------- Admin seed + register-as-admin (items 2, 3) ----------
class TestAdminAuth:
    def test_05_admin_seed_login(self, session):
        r = session.post(f"{API}/auth/login", json={
            "email": "admin@freightos.app", "password": "admin1234"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "admin"
        assert data["user"]["email"] == "admin@freightos.app"
        STATE["admin_token"] = data["token"]
        STATE["admin_user"] = data["user"]

    def test_06_register_admin_role_accepted(self, session):
        email = _rand_email("adm")
        r = session.post(f"{API}/auth/register", json={
            "name": "Extra Admin", "email": email, "phone": "9990000099",
            "password": "Passw0rd!", "role": "admin",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "admin"

    def test_07_admin_me(self, session):
        r = session.get(f"{API}/auth/me", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 200
        assert r.json()["role"] == "admin"


# ---------- Setup a driver + truck for later tests ----------
class TestSetupActors:
    def test_08_register_driver_A(self, session):
        email = _rand_email("drv_a")
        r = session.post(f"{API}/auth/register", json={
            "name": "Driver A", "email": email, "phone": "9990000010",
            "password": "Passw0rd!", "role": "driver",
        })
        assert r.status_code == 200, r.text
        STATE["driver_a"] = {"email": email, "token": r.json()["token"], "user": r.json()["user"]}

    def test_09_register_driver_B(self, session):
        email = _rand_email("drv_b")
        r = session.post(f"{API}/auth/register", json={
            "name": "Driver B", "email": email, "phone": "9990000011",
            "password": "Passw0rd!", "role": "driver",
        })
        assert r.status_code == 200, r.text
        STATE["driver_b"] = {"email": email, "token": r.json()["token"], "user": r.json()["user"]}

    def test_10_create_truck_A_pending(self, session):
        """Item 6: truck default verification_status='pending', verified_at=None, rejection_reason=None."""
        r = session.post(f"{API}/trucks", headers=_auth(STATE["driver_a"]["token"]), json={
            "reg_number": f"TEST_KA05AB{uuid.uuid4().hex[:4].upper()}",
            "truck_type": "Tata Ace", "body_type": "Open", "load_capacity_kg": 1000,
        })
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["verification_status"] == "pending"
        assert t.get("verified_at") is None
        assert t.get("rejection_reason") is None
        STATE["truck_a"] = t

    def test_11_create_truck_B_pending(self, session):
        r = session.post(f"{API}/trucks", headers=_auth(STATE["driver_b"]["token"]), json={
            "reg_number": f"TEST_KA06CD{uuid.uuid4().hex[:4].upper()}",
            "truck_type": "Bolero Pickup", "body_type": "Open", "load_capacity_kg": 1200,
        })
        assert r.status_code == 200, r.text
        assert r.json()["verification_status"] == "pending"
        STATE["truck_b"] = r.json()

    def test_12_create_shipment(self, session):
        r = session.post(f"{API}/shipments", headers=_auth(STATE["customer"]["token"]), json={
            "goods_category": "Furniture", "weight_kg": 500, "packages": 2,
            "pickup_address": "Bangalore Whitefield", "pickup_city": "Bangalore",
            "pickup_lat": 12.9716, "pickup_lng": 77.5946,
            "drop_address": "Chennai Central", "drop_city": "Chennai",
            "drop_lat": 13.0827, "drop_lng": 80.2707,
            "loading_date": "2026-06-01",
        })
        assert r.status_code == 200, r.text
        STATE["shipment"] = r.json()


# ---------- Admin stats + guard (items 4, 5) ----------
class TestAdminStats:
    def test_13_admin_stats_ok(self, session):
        r = session.get(f"{API}/admin/stats", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("trucks_pending", "trucks_approved", "trucks_rejected", "total_users", "total_bookings"):
            assert k in d, f"missing {k}"
            assert isinstance(d[k], int)
        assert d["trucks_pending"] >= 2  # at least truck_a + truck_b

    def test_14_admin_stats_forbidden_for_customer(self, session):
        r = session.get(f"{API}/admin/stats", headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 403, r.text

    def test_15_admin_stats_forbidden_for_driver(self, session):
        r = session.get(f"{API}/admin/stats", headers=_auth(STATE["driver_a"]["token"]))
        assert r.status_code == 403, r.text


# ---------- Admin list trucks + filters (items 7, 13) ----------
class TestAdminTrucksList:
    def test_16_pending_list_contains_new_truck(self, session):
        r = session.get(f"{API}/admin/trucks?status=pending", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 200, r.text
        ids = [t["id"] for t in r.json()]
        assert STATE["truck_a"]["id"] in ids
        assert STATE["truck_b"]["id"] in ids
        for t in r.json():
            assert t["verification_status"] == "pending"

    def test_17_admin_trucks_forbidden_non_admin(self, session):
        for who in ("customer", "driver_a"):
            r = session.get(f"{API}/admin/trucks", headers=_auth(STATE[who]["token"]))
            assert r.status_code == 403, f"{who}: {r.text}"


# ---------- Quote blocked while pending (item 8) ----------
class TestQuoteBlockedPending:
    def test_18_pending_truck_cannot_quote(self, session):
        r = session.post(f"{API}/quotes", headers=_auth(STATE["driver_a"]["token"]), json={
            "shipment_id": STATE["shipment"]["id"],
            "truck_id": STATE["truck_a"]["id"],
            "price_inr": 12000, "eta_hours": 8, "note": "TEST",
        })
        assert r.status_code == 400, r.text
        assert "approv" in r.json()["detail"].lower()


# ---------- Approve truck A + verify quote now succeeds (items 9, 10) ----------
class TestApproveFlow:
    def test_19_verify_forbidden_non_admin(self, session):
        r = session.post(
            f"{API}/admin/trucks/{STATE['truck_a']['id']}/verify",
            headers=_auth(STATE["customer"]["token"]),
        )
        assert r.status_code == 403

    def test_20_reject_forbidden_non_admin(self, session):
        r = session.post(
            f"{API}/admin/trucks/{STATE['truck_a']['id']}/reject",
            headers=_auth(STATE["driver_a"]["token"]),
            json={"reason": "x"},
        )
        assert r.status_code == 403

    def test_21_admin_approve_truck_a(self, session):
        r = session.post(
            f"{API}/admin/trucks/{STATE['truck_a']['id']}/verify",
            headers=_auth(STATE["admin_token"]),
        )
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["verification_status"] == "approved"
        assert t["verified_at"] is not None
        assert t.get("rejection_reason") is None

    def test_22_driver_a_can_quote_now(self, session):
        r = session.post(f"{API}/quotes", headers=_auth(STATE["driver_a"]["token"]), json={
            "shipment_id": STATE["shipment"]["id"],
            "truck_id": STATE["truck_a"]["id"],
            "price_inr": 12000, "eta_hours": 8, "note": "TEST",
        })
        assert r.status_code == 200, r.text
        STATE["quote"] = r.json()


# ---------- Reject truck B (items 11, 12) ----------
class TestRejectFlow:
    def test_23_admin_reject_truck_b(self, session):
        r = session.post(
            f"{API}/admin/trucks/{STATE['truck_b']['id']}/reject",
            headers=_auth(STATE["admin_token"]),
            json={"reason": "License expired"},
        )
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["verification_status"] == "rejected"
        assert t["rejection_reason"] == "License expired"
        assert t["verified_at"] is not None

    def test_24_rejected_truck_cannot_quote(self, session):
        # need a fresh open shipment (previous one still open since not yet accepted)
        r = session.post(f"{API}/quotes", headers=_auth(STATE["driver_b"]["token"]), json={
            "shipment_id": STATE["shipment"]["id"],
            "truck_id": STATE["truck_b"]["id"],
            "price_inr": 11000, "eta_hours": 9, "note": "TEST",
        })
        assert r.status_code == 400, r.text
        assert "approv" in r.json()["detail"].lower()


# ---------- Filter approved/rejected (item 13) ----------
class TestAdminFilters:
    def test_25_filter_approved(self, session):
        r = session.get(f"{API}/admin/trucks?status=approved", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 200
        items = r.json()
        assert all(t["verification_status"] == "approved" for t in items)
        assert STATE["truck_a"]["id"] in [t["id"] for t in items]

    def test_26_filter_rejected(self, session):
        r = session.get(f"{API}/admin/trucks?status=rejected", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 200
        items = r.json()
        assert all(t["verification_status"] == "rejected" for t in items)
        assert STATE["truck_b"]["id"] in [t["id"] for t in items]

    def test_27_no_filter_returns_all(self, session):
        r = session.get(f"{API}/admin/trucks", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 200
        items = r.json()
        statuses = {t.get("verification_status") for t in items}
        # Should contain at least approved & rejected among all
        assert "approved" in statuses
        assert "rejected" in statuses
        # Total count should be >= filtered counts (sanity)
        assert len(items) >= 2


# ---------- 404 on unknown truck (item 14) ----------
class TestAdminNotFound:
    def test_28_verify_nonexistent_404(self, session):
        r = session.post(f"{API}/admin/trucks/nonexistent-xyz/verify", headers=_auth(STATE["admin_token"]))
        assert r.status_code == 404, r.text

    def test_29_reject_nonexistent_404(self, session):
        r = session.post(f"{API}/admin/trucks/nonexistent-xyz/reject",
                         headers=_auth(STATE["admin_token"]),
                         json={"reason": "n/a"})
        assert r.status_code == 404, r.text


# ---------- Razorpay mock re-check (item 1) ----------
class TestRazorpayMock:
    def test_30_accept_quote_creates_booking(self, session):
        r = session.post(
            f"{API}/bookings/accept/{STATE['quote']['id']}",
            headers=_auth(STATE["customer"]["token"]),
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["payment_status"] == "unpaid"
        assert b["status"] == "confirmed"
        STATE["booking"] = b

    def test_31_pay_order_mock_mode(self, session):
        r = session.post(f"{API}/pay/order",
                         headers=_auth(STATE["customer"]["token"]),
                         json={"booking_id": STATE["booking"]["id"]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("mock_mode") is True, data
        assert data["order_id"].startswith("order_mock_"), data
        STATE["order_id"] = data["order_id"]

    def test_32_pay_verify_accepts_any_signature(self, session):
        r = session.post(f"{API}/pay/verify",
                         headers=_auth(STATE["customer"]["token"]),
                         json={
                             "booking_id": STATE["booking"]["id"],
                             "razorpay_order_id": STATE["order_id"],
                             "razorpay_payment_id": "pay_mock_anything",
                             "razorpay_signature": "totally_fake_signature",
                         })
        assert r.status_code == 200, r.text
        assert r.json()["payment_status"] == "paid"

    def test_33_booking_now_paid(self, session):
        r = session.get(f"{API}/bookings/{STATE['booking']['id']}",
                        headers=_auth(STATE["customer"]["token"]))
        assert r.status_code == 200
        assert r.json()["payment_status"] == "paid"
