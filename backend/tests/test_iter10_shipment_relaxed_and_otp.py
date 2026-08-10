"""Iteration 10 verification:
- Shipment with address==city, pincodes null (frontend-relaxed payload)
- Same with pincodes provided — round-trip on GET
- OTP flow (register + reset) — re-verify iter 8 pass
- Notifications WebSocket: ready frame + 4401 close on invalid token
- Response hygiene
- Regression spot-checks
"""
import os
import asyncio
import json
import secrets
from urllib.parse import urlparse

import pytest
import requests
import websockets
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
_parsed = urlparse(BASE_URL)
WS_BASE = f"{'wss' if _parsed.scheme == 'https' else 'ws'}://{_parsed.netloc}"

ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASSWORD = "S6bMgyCbE-1fao9IRcw6HWOmi8eldTD_"


def _rand():
    return secrets.token_hex(4)


def _hash_coord(city: str, base: float) -> float:
    """Deterministic pseudo-coord like the frontend synthesizes."""
    return base + (sum(ord(c) for c in city) % 1000) / 10000.0


def _register(role: str, password: str = "test1234") -> dict:
    payload = {
        "name": f"TEST_{role}_{_rand()}",
        "email": f"TEST_{role}_{_rand()}@test.com",
        "phone": f"+9198{secrets.randbelow(100000000):08d}",
        "password": password,
        "role": role,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    d["_email"] = payload["email"]
    d["_phone"] = payload["phone"]
    d["_password"] = password
    return d


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --------- 1. Relaxed shipment payload (frontend now sends city as address, null pincodes) ---------
class TestShipmentRelaxed:
    def _relaxed_payload(self, pincodes=False):
        p_lat = _hash_coord("Bangalore", 12.9)
        p_lng = _hash_coord("Bangalore", 77.5)
        d_lat = _hash_coord("Chennai", 13.0)
        d_lng = _hash_coord("Chennai", 80.2)
        body = {
            "goods_category": "Household shifting",
            "weight_kg": 500,
            "packages": 1,
            "pickup_address": "Bangalore",   # falls back to city
            "pickup_city": "Bangalore",
            "pickup_pincode": None,
            "pickup_lat": p_lat,
            "pickup_lng": p_lng,
            "drop_address": "Chennai",
            "drop_city": "Chennai",
            "drop_pincode": None,
            "drop_lat": d_lat,
            "drop_lng": d_lng,
            "loading_date": "2026-05-20",
            "truck_type_preferred": None,
            "instructions": "",
            "photos": [],
        }
        if pincodes:
            body["pickup_pincode"] = "560001"
            body["drop_pincode"] = "600001"
        return body

    def test_create_relaxed_no_pincodes(self):
        c = _register("customer")
        payload = self._relaxed_payload(pincodes=False)
        r = requests.post(f"{API}/shipments", json=payload, headers=_h(c["token"]), timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        # Basic echo
        assert s["pickup_city"] == "Bangalore"
        assert s["drop_city"] == "Chennai"
        assert s["pickup_address"] == "Bangalore"
        assert s["drop_address"] == "Chennai"
        # Pincode either null or absent
        assert s.get("pickup_pincode") in (None,)
        assert s.get("drop_pincode") in (None,)
        # Hygiene
        assert "_id" not in s
        assert "expires_at" not in s
        assert s.get("photos", []) == []
        # GET reflects
        g = requests.get(f"{API}/shipments/{s['id']}", headers=_h(c["token"]))
        assert g.status_code == 200
        gd = g.json()
        assert gd["id"] == s["id"]
        assert gd.get("pickup_pincode") in (None,)
        assert gd.get("drop_pincode") in (None,)
        assert gd.get("photos", []) == []
        assert "expires_at" not in gd
        assert "_id" not in gd

    def test_create_relaxed_with_pincodes(self):
        c = _register("customer")
        payload = self._relaxed_payload(pincodes=True)
        r = requests.post(f"{API}/shipments", json=payload, headers=_h(c["token"]), timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["pickup_pincode"] == "560001"
        assert s["drop_pincode"] == "600001"
        g = requests.get(f"{API}/shipments/{s['id']}", headers=_h(c["token"]))
        assert g.status_code == 200
        gd = g.json()
        assert gd["pickup_pincode"] == "560001"
        assert gd["drop_pincode"] == "600001"


# --------- 2. OTP flow re-verification ---------
class TestOTP:
    def test_otp_send_register_returns_dev_otp(self):
        ident = f"TEST_otp_reg_{_rand()}@test.com"
        r = requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "register"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert isinstance(d.get("dev_otp"), str) and d["dev_otp"].isdigit()

    def test_otp_send_reset_returns_dev_otp(self):
        ident = f"TEST_otp_res_{_rand()}@test.com"
        r = requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "reset"})
        assert r.status_code == 200
        assert r.json()["dev_otp"].isdigit()

    def test_verify_then_reuse_fails(self):
        ident = f"TEST_otp_rr_{_rand()}@test.com"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": ident, "purpose": "register"}).json()["dev_otp"]
        r1 = requests.post(f"{API}/auth/otp/verify", json={"identifier": ident, "code": code, "purpose": "register"})
        assert r1.status_code == 200 and r1.json()["verified"] is True
        r2 = requests.post(f"{API}/auth/otp/verify", json={"identifier": ident, "code": code, "purpose": "register"})
        assert r2.status_code == 400

    def test_register_after_verified_email_otp(self):
        email = f"TEST_v_{_rand()}@test.com"
        phone = f"+9199{secrets.randbelow(100000000):08d}"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": email, "purpose": "register"}).json()["dev_otp"]
        requests.post(f"{API}/auth/otp/verify", json={"identifier": email, "code": code, "purpose": "register"})
        r = requests.post(f"{API}/auth/register", json={
            "name": "verify", "email": email, "phone": phone,
            "password": "test1234", "role": "customer",
        })
        assert r.status_code == 200
        u = r.json()["user"]
        assert u.get("email_verified") is True
        assert "_id" not in u
        assert "password_hash" not in u

    def test_reset_full_flow(self):
        c = _register("customer")
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": c["_email"], "purpose": "reset"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/reset-password",
                         json={"email": c["_email"], "code": code, "new_password": "newpass123"})
        assert r.status_code == 200 and r.json()["ok"] is True
        # New password works
        r1 = requests.post(f"{API}/auth/login", json={"email": c["_email"], "password": "newpass123"})
        assert r1.status_code == 200
        # Old fails
        r2 = requests.post(f"{API}/auth/login", json={"email": c["_email"], "password": c["_password"]})
        assert r2.status_code == 401

    def test_reset_wrong_code(self):
        c = _register("customer")
        requests.post(f"{API}/auth/otp/send", json={"identifier": c["_email"], "purpose": "reset"})
        r = requests.post(f"{API}/auth/reset-password",
                         json={"email": c["_email"], "code": "0000", "new_password": "newpass123"})
        if r.status_code == 200:
            r = requests.post(f"{API}/auth/reset-password",
                             json={"email": c["_email"], "code": "9999", "new_password": "newpass123"})
        assert r.status_code == 400

    def test_reset_short_password(self):
        c = _register("customer")
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": c["_email"], "purpose": "reset"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/reset-password",
                         json={"email": c["_email"], "code": code, "new_password": "abc"})
        assert r.status_code == 400

    def test_reset_unknown_email_returns_400(self):
        email = f"TEST_none_{_rand()}@test.com"
        code = requests.post(f"{API}/auth/otp/send", json={"identifier": email, "purpose": "reset"}).json()["dev_otp"]
        r = requests.post(f"{API}/auth/reset-password",
                         json={"email": email, "code": code, "new_password": "newpass123"})
        assert r.status_code == 400
        # Spec: does NOT reveal account existence — either "invalid or expired code" or generic message.
        # We accept anything that doesn't literally say "account not found" is preferred, but this test
        # only enforces the status.


# --------- 3. Notifications WebSocket ---------
class TestNotificationsWS:
    def test_invalid_token_closes_4401(self):
        async def run():
            try:
                async with websockets.connect(
                    f"{WS_BASE}/api/ws/notifications?token=not-a-real-jwt",
                    open_timeout=10,
                ) as ws:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                    return None
            except websockets.ConnectionClosed as e:
                return e.code
            except Exception as e:
                return f"err:{e}"

        loop = asyncio.new_event_loop()
        try:
            code = loop.run_until_complete(run())
        finally:
            loop.close()
        assert code == 4401, f"expected 4401, got {code}"

    def test_valid_token_ready_frame(self):
        driver = _register("driver")

        async def run():
            async with websockets.connect(
                f"{WS_BASE}/api/ws/notifications?token={driver['token']}",
                open_timeout=10,
            ) as ws:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                return json.loads(msg)

        loop = asyncio.new_event_loop()
        try:
            data = loop.run_until_complete(run())
        finally:
            loop.close()
        assert data["type"] == "ready"
        assert data["user_id"] == driver["user"]["id"]


# --------- 4. Regression spot-checks ---------
class TestRegression:
    def test_admin_login(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_h(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "admin"
        assert "_id" not in d and "password_hash" not in d

    def test_users_me_location_roundtrip(self):
        driver = _register("driver")
        r = requests.post(f"{API}/users/me/location", headers=_h(driver["token"]),
                          json={"lat": 12.9716, "lng": 77.5946})
        assert r.status_code == 200
        g = requests.get(f"{API}/users/me/location", headers=_h(driver["token"]))
        assert g.status_code == 200
        gb = g.json()
        assert gb["current_lat"] == 12.9716
        assert gb["current_lng"] == 77.5946

    def test_open_shipments_lat_lng_distance_sorted(self, admin_token):
        # Create two shipments at different distances from a probe point.
        cust = _register("customer")
        # Near Bangalore
        s1 = requests.post(f"{API}/shipments", headers=_h(cust["token"]), json={
            "goods_category": "Parcels", "weight_kg": 10, "packages": 1,
            "pickup_address": "MG", "pickup_city": "Bangalore",
            "pickup_lat": 12.9716, "pickup_lng": 77.5946,
            "drop_address": "X", "drop_city": "X",
            "drop_lat": 13.0, "drop_lng": 77.6,
            "loading_date": "2026-05-01",
        }).json()
        # Farther
        s2 = requests.post(f"{API}/shipments", headers=_h(cust["token"]), json={
            "goods_category": "Parcels", "weight_kg": 10, "packages": 1,
            "pickup_address": "MY", "pickup_city": "Mysore",
            "pickup_lat": 12.30, "pickup_lng": 76.65,
            "drop_address": "X", "drop_city": "X",
            "drop_lat": 12.5, "drop_lng": 76.9,
            "loading_date": "2026-05-01",
        }).json()

        # Register driver + approve truck
        drv = _register("driver")
        t = requests.post(f"{API}/trucks", headers=_h(drv["token"]), json={
            "reg_number": f"KA-{_rand().upper()[:4]}", "truck_type": "Mini Truck",
            "body_type": "Open", "load_capacity_kg": 800,
            "base_lat": 12.97, "base_lng": 77.59, "base_city": "Bangalore",
        }).json()
        v = requests.post(f"{API}/admin/trucks/{t['id']}/verify", headers=_h(admin_token))
        assert v.status_code == 200

        r = requests.get(f"{API}/shipments/open",
                         params={"lat": 12.9716, "lng": 77.5946, "radius_km": 200},
                         headers=_h(drv["token"]))
        assert r.status_code == 200
        items = r.json()
        ids = [i["id"] for i in items]
        assert s1["id"] in ids
        dists = [i["distance_from_you_km"] for i in items]
        assert dists == sorted(dists)
        for it in items:
            assert "customer_phone" not in it
            assert "_id" not in it
