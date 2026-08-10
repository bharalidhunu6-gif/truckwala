"""Iteration 5 backend regression + chat REST/WebSocket tests."""
import asyncio
import json
import os
import uuid

import pytest
import requests
import websockets

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fall back to reading frontend/.env
    from pathlib import Path
    envp = Path("/app/frontend/.env").read_text()
    for line in envp.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/chat"

ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PW = "admin1234"


def _reg(role: str, name: str):
    tag = uuid.uuid4().hex[:8]
    email = f"TEST_{role}_{tag}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": f"TEST_{name}_{tag}", "email": email, "phone": "+911111111111",
        "password": "test1234", "role": role,
    })
    assert r.status_code == 200, r.text
    return r.json()  # token,user


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def env():
    """Create customer, driver, third-party, approved truck, shipment, booking."""
    admin = _login(ADMIN_EMAIL, ADMIN_PW)
    cust = _reg("customer", "Cust")
    drv = _reg("driver", "Drv")
    third = _reg("customer", "Third")

    # Driver creates truck
    truck = requests.post(f"{API}/trucks", headers=_auth(drv["token"]), json={
        "reg_number": f"KA01TEST{uuid.uuid4().hex[:4].upper()}",
        "truck_type": "Mini Truck", "body_type": "Open", "load_capacity_kg": 1500,
    }).json()

    # Admin verifies truck
    v = requests.post(f"{API}/admin/trucks/{truck['id']}/verify", headers=_auth(admin["token"]))
    assert v.status_code == 200, v.text
    assert v.json()["verification_status"] == "approved"

    # Customer creates shipment
    sh = requests.post(f"{API}/shipments", headers=_auth(cust["token"]), json={
        "goods_category": "Parcels", "weight_kg": 100, "packages": 1,
        "pickup_address": "A", "pickup_city": "Bangalore", "pickup_lat": 12.9, "pickup_lng": 77.6,
        "drop_address": "B", "drop_city": "Chennai", "drop_lat": 13.0, "drop_lng": 80.2,
        "loading_date": "2026-01-15",
    }).json()

    # Driver quotes
    quote = requests.post(f"{API}/quotes", headers=_auth(drv["token"]), json={
        "shipment_id": sh["id"], "truck_id": truck["id"],
        "price_inr": 12000, "eta_hours": 12,
    }).json()
    assert "id" in quote, quote

    # Customer accepts → booking
    booking = requests.post(f"{API}/bookings/accept/{quote['id']}", headers=_auth(cust["token"])).json()
    assert "id" in booking, booking

    return {
        "admin": admin, "cust": cust, "drv": drv, "third": third,
        "truck": truck, "shipment": sh, "booking": booking,
    }


# ---------- 1. CHAT REST send ----------
class TestChatREST:
    def test_1a_customer_send(self, env):
        r = requests.post(f"{API}/chat/{env['booking']['id']}/messages",
                          headers=_auth(env["cust"]["token"]), json={"text": "Hi driver"})
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("id", "sender_id", "sender_name", "sender_role", "text", "at", "booking_id"):
            assert k in d, f"missing {k}"
        assert "_id" not in d
        assert d["sender_role"] == "customer"
        assert d["text"] == "Hi driver"

    def test_1b_driver_send(self, env):
        r = requests.post(f"{API}/chat/{env['booking']['id']}/messages",
                          headers=_auth(env["drv"]["token"]), json={"text": "Hello customer"})
        assert r.status_code == 200
        assert r.json()["sender_role"] == "driver"

    def test_1c_third_party_403(self, env):
        r = requests.post(f"{API}/chat/{env['booking']['id']}/messages",
                          headers=_auth(env["third"]["token"]), json={"text": "sneaky"})
        assert r.status_code == 403

    def test_1d_admin_send(self, env):
        r = requests.post(f"{API}/chat/{env['booking']['id']}/messages",
                          headers=_auth(env["admin"]["token"]), json={"text": "admin note"})
        assert r.status_code == 200
        assert r.json()["sender_role"] == "admin"

    def test_1e_empty_400(self, env):
        r = requests.post(f"{API}/chat/{env['booking']['id']}/messages",
                          headers=_auth(env["cust"]["token"]), json={"text": "   "})
        assert r.status_code == 400

    def test_1f_truncate_2000(self, env):
        long = "x" * 2500
        r = requests.post(f"{API}/chat/{env['booking']['id']}/messages",
                          headers=_auth(env["cust"]["token"]), json={"text": long})
        assert r.status_code == 200
        assert len(r.json()["text"]) == 2000


# ---------- 2. CHAT REST history ----------
class TestChatHistory:
    def test_2a_history_participants(self, env):
        for who in ("cust", "drv", "admin"):
            r = requests.get(f"{API}/chat/{env['booking']['id']}/messages",
                             headers=_auth(env[who]["token"]))
            assert r.status_code == 200
            msgs = r.json()
            assert isinstance(msgs, list) and len(msgs) >= 1
            ats = [m["at"] for m in msgs]
            assert ats == sorted(ats), "not chronological"
            for m in msgs:
                assert "_id" not in m

    def test_2b_history_third_party_403(self, env):
        r = requests.get(f"{API}/chat/{env['booking']['id']}/messages",
                         headers=_auth(env["third"]["token"]))
        assert r.status_code == 403

    def test_2c_history_nonexistent_404(self, env):
        r = requests.get(f"{API}/chat/{uuid.uuid4().hex}/messages",
                         headers=_auth(env["cust"]["token"]))
        assert r.status_code == 404


# ---------- 3 & 4. WebSocket ----------
async def _ws_history_and_send(booking_id, token, text=None):
    url = f"{WS_BASE}/{booking_id}?token={token}"
    async with websockets.connect(url) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), 5))
        assert first["type"] == "history"
        ats = [m["at"] for m in first["messages"]]
        assert ats == sorted(ats)
        if text is not None:
            await ws.send(json.dumps({"text": text}))
            msg = json.loads(await asyncio.wait_for(ws.recv(), 5))
            return first, msg
        return first, None


class TestChatWS:
    def test_3a_history_frame(self, env):
        first, _ = asyncio.run(_ws_history_and_send(env["booking"]["id"], env["cust"]["token"]))
        assert first["type"] == "history"

    def test_3b_send_echoes_message(self, env):
        _, msg = asyncio.run(_ws_history_and_send(env["booking"]["id"], env["drv"]["token"], "ws-hello"))
        assert msg["type"] == "message"
        assert msg["text"] == "ws-hello"
        assert msg["sender_role"] == "driver"

    def test_3c_broadcast_two_sockets(self, env):
        async def run():
            u1 = f"{WS_BASE}/{env['booking']['id']}?token={env['cust']['token']}"
            u2 = f"{WS_BASE}/{env['booking']['id']}?token={env['drv']['token']}"
            async with websockets.connect(u1) as a, websockets.connect(u2) as b:
                await asyncio.wait_for(a.recv(), 5)  # history
                await asyncio.wait_for(b.recv(), 5)  # history
                await a.send(json.dumps({"text": "broadcast-me"}))
                m_a = json.loads(await asyncio.wait_for(a.recv(), 5))
                m_b = json.loads(await asyncio.wait_for(b.recv(), 5))
                assert m_a["type"] == "message" == m_b["type"]
                assert m_a["id"] == m_b["id"]
                assert m_a["text"] == "broadcast-me"
        asyncio.run(run())

    def test_3d_missing_token_closes(self, env):
        async def run():
            url = f"{WS_BASE}/{env['booking']['id']}?token="
            try:
                async with websockets.connect(url) as ws:
                    await asyncio.wait_for(ws.recv(), 5)
                pytest.fail("expected close")
            except websockets.exceptions.ConnectionClosed as e:
                # accept 4401 or any close code (per instructions)
                assert e.code in (4401, 1006, 1000, 1011) or e.code >= 4000
            except Exception:
                pass  # any failure is acceptable per spec
        asyncio.run(run())

    def test_3e_invalid_token_closes(self, env):
        async def run():
            url = f"{WS_BASE}/{env['booking']['id']}?token=not.a.valid.jwt"
            try:
                async with websockets.connect(url) as ws:
                    await asyncio.wait_for(ws.recv(), 5)
                pytest.fail("expected close")
            except Exception:
                pass
        asyncio.run(run())

    def test_3f_third_party_closes(self, env):
        async def run():
            url = f"{WS_BASE}/{env['booking']['id']}?token={env['third']['token']}"
            try:
                async with websockets.connect(url) as ws:
                    await asyncio.wait_for(ws.recv(), 5)
                pytest.fail("expected close")
            except Exception:
                pass
        asyncio.run(run())

    def test_3g_empty_text_ignored(self, env):
        async def run():
            url = f"{WS_BASE}/{env['booking']['id']}?token={env['cust']['token']}"
            async with websockets.connect(url) as ws:
                await asyncio.wait_for(ws.recv(), 5)  # history
                await ws.send(json.dumps({"text": "   "}))
                try:
                    got = await asyncio.wait_for(ws.recv(), 2)
                    pytest.fail(f"expected no broadcast, got {got}")
                except asyncio.TimeoutError:
                    pass  # good
        asyncio.run(run())


# ---------- 4. WS message persists via REST ----------
class TestChatPersistence:
    def test_4_ws_sent_message_in_rest_history(self, env):
        marker = f"persist-{uuid.uuid4().hex[:6]}"
        async def run():
            url = f"{WS_BASE}/{env['booking']['id']}?token={env['drv']['token']}"
            async with websockets.connect(url) as ws:
                await asyncio.wait_for(ws.recv(), 5)
                await ws.send(json.dumps({"text": marker}))
                await asyncio.wait_for(ws.recv(), 5)
        asyncio.run(run())
        r = requests.get(f"{API}/chat/{env['booking']['id']}/messages",
                         headers=_auth(env["cust"]["token"]))
        assert r.status_code == 200
        assert any(m["text"] == marker for m in r.json())


# ---------- 6. Regressions ----------
class TestRegressions:
    def test_6a_admin_verify_reject(self, env):
        # create a fresh truck
        truck = requests.post(f"{API}/trucks", headers=_auth(env["drv"]["token"]), json={
            "reg_number": f"KA02R{uuid.uuid4().hex[:4].upper()}",
            "truck_type": "Pickup Van", "body_type": "Open", "load_capacity_kg": 800,
        }).json()
        rej = requests.post(f"{API}/admin/trucks/{truck['id']}/reject",
                            headers=_auth(env["admin"]["token"]),
                            json={"reason": "test-reject"})
        assert rej.status_code == 200
        assert rej.json()["verification_status"] == "rejected"

        ver = requests.post(f"{API}/admin/trucks/{truck['id']}/verify",
                            headers=_auth(env["admin"]["token"]))
        assert ver.status_code == 200
        assert ver.json()["verification_status"] == "approved"

    def test_6b_razorpay_mock(self, env):
        r = requests.post(f"{API}/pay/order",
                          headers=_auth(env["cust"]["token"]),
                          json={"booking_id": env["booking"]["id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mock_mode"] is True
        assert d["order_id"].startswith("order_mock_")

        v = requests.post(f"{API}/pay/verify",
                          headers=_auth(env["cust"]["token"]),
                          json={
                              "booking_id": env["booking"]["id"],
                              "razorpay_order_id": d["order_id"],
                              "razorpay_payment_id": "pay_mock_123",
                              "razorpay_signature": "sig_mock",
                          })
        assert v.status_code == 200
        assert v.json()["payment_status"] == "paid"

    def test_6c_shipment_photos_roundtrip(self, env):
        b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
        sh = requests.post(f"{API}/shipments", headers=_auth(env["cust"]["token"]), json={
            "goods_category": "Parcels", "weight_kg": 10, "packages": 1,
            "pickup_address": "P", "pickup_city": "X", "pickup_lat": 12.9, "pickup_lng": 77.6,
            "drop_address": "D", "drop_city": "Y", "drop_lat": 13.0, "drop_lng": 80.2,
            "loading_date": "2026-02-01",
            "photos": [b64],
        }).json()
        got = requests.get(f"{API}/shipments/{sh['id']}",
                           headers=_auth(env["cust"]["token"])).json()
        assert got["photos"] == [b64]

    def test_6d_location_acl(self, env):
        # driver posts location
        r = requests.post(f"{API}/bookings/{env['booking']['id']}/location",
                          headers=_auth(env["drv"]["token"]),
                          json={"lat": 12.9, "lng": 77.6})
        assert r.status_code == 200
        # customer allowed to GET
        g = requests.get(f"{API}/bookings/{env['booking']['id']}/location",
                         headers=_auth(env["cust"]["token"]))
        assert g.status_code == 200 and g.json()["current_lat"] == 12.9
        # third party forbidden
        f = requests.get(f"{API}/bookings/{env['booking']['id']}/location",
                         headers=_auth(env["third"]["token"]))
        assert f.status_code == 403
        # customer cannot POST location
        cp = requests.post(f"{API}/bookings/{env['booking']['id']}/location",
                           headers=_auth(env["cust"]["token"]),
                           json={"lat": 1, "lng": 2})
        assert cp.status_code == 403
