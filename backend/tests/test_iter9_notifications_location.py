"""Iteration 9 backend tests:
- User-scoped GPS endpoints (/users/me/location)
- /shipments/open stored-GPS fallback
- Real-time WebSocket notifications (/api/ws/notifications)
- Broadcast paths: new_load, new_quote, booking_accepted, booking_status
- Response hygiene (no _id / password_hash)
- Regression spot-checks for prior features
"""
import os
import asyncio
import json
import random
import string
import time
from urllib.parse import urlparse

import pytest
import requests
import websockets

# ---------- Config ----------
BASE_HTTP = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or open("/app/frontend/.env").read()
# Parse from .env-like content if needed
if "EXPO_PUBLIC_BACKEND_URL" in BASE_HTTP and "=" in BASE_HTTP:
    for line in BASE_HTTP.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_HTTP = line.split("=", 1)[1].strip().strip('"')
            break
BASE_HTTP = BASE_HTTP.rstrip("/")
API = f"{BASE_HTTP}/api"

_parsed = urlparse(BASE_HTTP)
WS_SCHEME = "wss" if _parsed.scheme == "https" else "ws"
WS_BASE = f"{WS_SCHEME}://{_parsed.netloc}"

ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASSWORD = "S6bMgyCbE-1fao9IRcw6HWOmi8eldTD_"


def _rand(n=6):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(http):
    r = http.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["user"]["role"] == "admin"
    # Response hygiene: no _id / password_hash
    assert "_id" not in data["user"]
    assert "password_hash" not in data["user"]
    return data["token"]


def _register(http, role, name_prefix="TEST"):
    tag = _rand()
    email = f"TEST_{role}_{tag}@test.com"
    payload = {
        "name": f"{name_prefix} {role} {tag}",
        "email": email,
        "phone": f"+9198{random.randint(10000000, 99999999)}",
        "password": "testpass1",
        "role": role,
    }
    r = http.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, f"register {role} failed: {r.status_code} {r.text}"
    data = r.json()
    assert "_id" not in data["user"]
    assert "password_hash" not in data["user"]
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def customer(http):
    tok, u = _register(http, "customer", "TESTC")
    return {"token": tok, "user": u}


@pytest.fixture(scope="module")
def driver_near(http, admin_token):
    tok, u = _register(http, "driver", "TESTDNEAR")
    # Approve a truck for this driver so they can submit quotes.
    t = http.post(
        f"{API}/trucks",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "reg_number": f"KA01AB{random.randint(1000, 9999)}",
            "truck_type": "Mini Truck",
            "body_type": "Open",
            "load_capacity_kg": 1000,
            "base_lat": 12.9716,
            "base_lng": 77.5946,
            "base_city": "Bangalore",
        },
    )
    assert t.status_code == 200, t.text
    truck = t.json()
    v = http.post(
        f"{API}/admin/trucks/{truck['id']}/verify",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert v.status_code == 200, v.text
    return {"token": tok, "user": u, "truck": truck}


@pytest.fixture(scope="module")
def driver_far(http):
    tok, u = _register(http, "driver", "TESTDFAR")
    return {"token": tok, "user": u}


# ---------- 1. User location endpoints ----------
class TestUserLocation:
    def test_missing_auth_401(self, http):
        r = http.post(f"{API}/users/me/location", json={"lat": 1.0, "lng": 2.0})
        assert r.status_code == 401

    def test_post_and_get_roundtrip(self, http, driver_near):
        h = {"Authorization": f"Bearer {driver_near['token']}"}
        r = http.post(f"{API}/users/me/location", headers=h, json={"lat": 12.9716, "lng": 77.5946})
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert isinstance(body["at"], str) and "T" in body["at"]

        g = http.get(f"{API}/users/me/location", headers=h)
        assert g.status_code == 200
        gb = g.json()
        assert gb["current_lat"] == 12.9716
        assert gb["current_lng"] == 77.5946
        assert gb["location_updated_at"] is not None

    def test_far_driver_location(self, http, driver_far):
        # Delhi ~ 1700km from Bangalore
        h = {"Authorization": f"Bearer {driver_far['token']}"}
        r = http.post(f"{API}/users/me/location", headers=h, json={"lat": 28.6139, "lng": 77.2090})
        assert r.status_code == 200


# ---------- 2. /shipments/open stored-GPS fallback ----------
class TestShipmentsOpenFallback:
    def test_stored_gps_used_when_no_query(self, http, driver_near, customer):
        # Ensure driver_near stored location is Bangalore (12.9716, 77.5946)
        http.post(
            f"{API}/users/me/location",
            headers={"Authorization": f"Bearer {driver_near['token']}"},
            json={"lat": 12.9716, "lng": 77.5946},
        )
        # Create shipment near Bangalore
        ship = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Parcels",
                "weight_kg": 100,
                "packages": 1,
                "pickup_address": "MG Road",
                "pickup_city": "Bangalore",
                "pickup_lat": 12.9750,
                "pickup_lng": 77.6000,
                "drop_address": "Whitefield",
                "drop_city": "Bangalore",
                "drop_lat": 12.9698,
                "drop_lng": 77.7500,
                "loading_date": "2026-02-01",
            },
        )
        assert ship.status_code == 200, ship.text
        sid = ship.json()["id"]
        # Response hygiene
        assert "_id" not in ship.json()

        # Query WITHOUT lat/lng — should use stored GPS (Bangalore) and include this shipment
        r = http.get(
            f"{API}/shipments/open",
            headers={"Authorization": f"Bearer {driver_near['token']}"},
        )
        assert r.status_code == 200
        items = r.json()
        found = [s for s in items if s["id"] == sid]
        assert len(found) == 1, "Near driver should see shipment via stored GPS fallback"
        assert "distance_from_you_km" in found[0]
        assert found[0]["distance_from_you_km"] < 50
        # customer_phone must be stripped
        assert "customer_phone" not in found[0]

    def test_query_params_override_stored(self, http, driver_near, customer):
        # Post a shipment near Bangalore
        ship = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Parcels",
                "weight_kg": 50,
                "packages": 1,
                "pickup_address": "Koramangala",
                "pickup_city": "Bangalore",
                "pickup_lat": 12.9352,
                "pickup_lng": 77.6245,
                "drop_address": "Electronic City",
                "drop_city": "Bangalore",
                "drop_lat": 12.8452,
                "drop_lng": 77.6602,
                "loading_date": "2026-02-01",
            },
        )
        assert ship.status_code == 200
        sid = ship.json()["id"]

        # Driver stored location = Bangalore, but query with lat/lng = Delhi (far) should override
        # and this shipment should NOT be returned.
        r = http.get(
            f"{API}/shipments/open?lat=28.6139&lng=77.2090&radius_km=100",
            headers={"Authorization": f"Bearer {driver_near['token']}"},
        )
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert sid not in ids, "Explicit query lat/lng must override stored GPS"

    def test_far_driver_does_not_see_bangalore_shipment(self, http, driver_far, customer):
        ship = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Parcels",
                "weight_kg": 20,
                "packages": 1,
                "pickup_address": "MG",
                "pickup_city": "Bangalore",
                "pickup_lat": 12.9716,
                "pickup_lng": 77.5946,
                "drop_address": "X",
                "drop_city": "Chennai",
                "drop_lat": 13.0827,
                "drop_lng": 80.2707,
                "loading_date": "2026-02-01",
            },
        )
        sid = ship.json()["id"]
        # Driver far already set to Delhi; ensure it stays
        http.post(
            f"{API}/users/me/location",
            headers={"Authorization": f"Bearer {driver_far['token']}"},
            json={"lat": 28.6139, "lng": 77.2090},
        )
        r = http.get(
            f"{API}/shipments/open",
            headers={"Authorization": f"Bearer {driver_far['token']}"},
        )
        ids = [s["id"] for s in r.json()]
        assert sid not in ids, "Far driver (Delhi) should not see Bangalore shipment via stored GPS"


# ---------- 3. Notifications WebSocket ----------
class TestNotificationsWS:
    def test_missing_token_closes_4401(self):
        async def run():
            try:
                async with websockets.connect(f"{WS_BASE}/api/ws/notifications", open_timeout=10) as ws:
                    # Should be closed immediately
                    await asyncio.wait_for(ws.recv(), timeout=5)
                    return None
            except websockets.ConnectionClosed as e:
                return e.code
            except Exception as e:
                return f"err:{e}"
        code = asyncio.get_event_loop().run_until_complete(run())
        assert code == 4401, f"expected close 4401, got {code}"

    def test_invalid_token_closes_4401(self):
        async def run():
            try:
                async with websockets.connect(
                    f"{WS_BASE}/api/ws/notifications?token=not-a-real-jwt", open_timeout=10
                ) as ws:
                    await asyncio.wait_for(ws.recv(), timeout=5)
                    return None
            except websockets.ConnectionClosed as e:
                return e.code
        code = asyncio.get_event_loop().run_until_complete(run())
        assert code == 4401

    def test_valid_token_ready_frame(self, driver_near):
        async def run():
            async with websockets.connect(
                f"{WS_BASE}/api/ws/notifications?token={driver_near['token']}",
                open_timeout=10,
            ) as ws:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                return json.loads(msg)
        data = asyncio.get_event_loop().run_until_complete(run())
        assert data["type"] == "ready"
        assert data["user_id"] == driver_near["user"]["id"]


# ---------- 4. Broadcast paths ----------
async def _open_ws(token):
    ws = await websockets.connect(f"{WS_BASE}/api/ws/notifications?token={token}", open_timeout=10)
    ready = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
    assert ready["type"] == "ready"
    return ws


async def _collect(ws, timeout=4.0):
    """Collect any messages arriving within `timeout` seconds."""
    out = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            remaining = max(0.05, deadline - time.time())
            msg = await asyncio.wait_for(ws.recv(), timeout=remaining)
            out.append(json.loads(msg))
        except asyncio.TimeoutError:
            break
        except Exception:
            break
    return out


class TestBroadcasts:
    def test_new_load_only_within_100km(self, http, driver_near, driver_far, customer):
        """Set driver_near @ Bangalore, driver_far @ Delhi. Open both sockets.
        POST shipment with pickup in Bangalore. Only near driver should receive."""
        # Set locations
        http.post(f"{API}/users/me/location",
                  headers={"Authorization": f"Bearer {driver_near['token']}"},
                  json={"lat": 12.9716, "lng": 77.5946})
        http.post(f"{API}/users/me/location",
                  headers={"Authorization": f"Bearer {driver_far['token']}"},
                  json={"lat": 28.6139, "lng": 77.2090})

        async def run():
            ws_near = await _open_ws(driver_near["token"])
            ws_far = await _open_ws(driver_far["token"])
            # POST shipment while both sockets are open
            r = requests.post(
                f"{API}/shipments",
                headers={"Authorization": f"Bearer {customer['token']}",
                         "Content-Type": "application/json"},
                json={
                    "goods_category": "Cement",
                    "weight_kg": 500,
                    "packages": 10,
                    "pickup_address": "Indiranagar",
                    "pickup_city": "Bangalore",
                    "pickup_lat": 12.9784,
                    "pickup_lng": 77.6408,
                    "drop_address": "Whitefield",
                    "drop_city": "Bangalore",
                    "drop_lat": 12.9698,
                    "drop_lng": 77.7500,
                    "loading_date": "2026-02-05",
                },
            )
            assert r.status_code == 200, r.text
            sid = r.json()["id"]

            near_msgs = await _collect(ws_near, timeout=4.0)
            far_msgs = await _collect(ws_far, timeout=1.0)
            await ws_near.close()
            await ws_far.close()
            return sid, near_msgs, far_msgs

        sid, near, far = asyncio.get_event_loop().run_until_complete(run())
        near_loads = [m for m in near if m.get("type") == "new_load" and m.get("shipment_id") == sid]
        far_loads = [m for m in far if m.get("type") == "new_load" and m.get("shipment_id") == sid]
        assert len(near_loads) == 1, f"near driver should get new_load, got {near}"
        assert near_loads[0]["pickup_city"] == "Bangalore"
        assert near_loads[0]["drop_city"] == "Bangalore"
        assert "distance_km" in near_loads[0]
        assert near_loads[0]["distance_km"] <= 100
        assert "at" in near_loads[0]
        assert len(far_loads) == 0, f"far driver should NOT get new_load, got {far}"

    def test_new_quote_notifies_customer(self, http, driver_near, customer):
        # Post shipment
        s = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Furniture",
                "weight_kg": 200,
                "packages": 5,
                "pickup_address": "MG Road",
                "pickup_city": "Bangalore",
                "pickup_lat": 12.9716,
                "pickup_lng": 77.5946,
                "drop_address": "HSR",
                "drop_city": "Bangalore",
                "drop_lat": 12.9082,
                "drop_lng": 77.6476,
                "loading_date": "2026-02-05",
            },
        )
        sid = s.json()["id"]

        async def run():
            ws_cust = await _open_ws(customer["token"])
            # driver submits quote
            r = requests.post(
                f"{API}/quotes",
                headers={"Authorization": f"Bearer {driver_near['token']}",
                         "Content-Type": "application/json"},
                json={"shipment_id": sid, "truck_id": driver_near["truck"]["id"],
                      "price_inr": 5000, "eta_hours": 4},
            )
            assert r.status_code == 200, r.text
            qid = r.json()["id"]
            msgs = await _collect(ws_cust, timeout=4.0)
            await ws_cust.close()
            return qid, msgs

        qid, msgs = asyncio.get_event_loop().run_until_complete(run())
        quote_msgs = [m for m in msgs if m.get("type") == "new_quote" and m.get("quote_id") == qid]
        assert len(quote_msgs) == 1, f"customer should receive new_quote, got {msgs}"
        m = quote_msgs[0]
        assert m["shipment_id"] == sid
        assert m["price_inr"] == 5000
        assert m["driver_name"] == driver_near["user"]["name"]
        assert "at" in m

        # persist for downstream tests
        TestBroadcasts._last_qid = qid
        TestBroadcasts._last_sid = sid

    def test_booking_accepted_notifies_driver(self, http, driver_near, customer):
        qid = getattr(TestBroadcasts, "_last_qid", None)
        assert qid, "prior test must have set _last_qid"

        async def run():
            ws_drv = await _open_ws(driver_near["token"])
            r = requests.post(
                f"{API}/bookings/accept/{qid}",
                headers={"Authorization": f"Bearer {customer['token']}"},
            )
            assert r.status_code == 200, r.text
            bid = r.json()["id"]
            msgs = await _collect(ws_drv, timeout=4.0)
            await ws_drv.close()
            return bid, msgs

        bid, msgs = asyncio.get_event_loop().run_until_complete(run())
        b_msgs = [m for m in msgs if m.get("type") == "booking_accepted" and m.get("booking_id") == bid]
        assert len(b_msgs) == 1, f"driver should receive booking_accepted, got {msgs}"
        assert b_msgs[0]["customer_name"] == customer["user"]["name"]
        assert b_msgs[0]["price_inr"] == 5000
        TestBroadcasts._last_bid = bid

    def test_booking_status_notifies_both(self, http, driver_near, customer):
        bid = getattr(TestBroadcasts, "_last_bid", None)
        assert bid, "prior test must have set _last_bid"

        async def run():
            ws_c = await _open_ws(customer["token"])
            ws_d = await _open_ws(driver_near["token"])
            r = requests.post(
                f"{API}/bookings/{bid}/status?status=in_transit",
                headers={"Authorization": f"Bearer {driver_near['token']}"},
            )
            assert r.status_code == 200, r.text
            c_msgs = await _collect(ws_c, timeout=4.0)
            d_msgs = await _collect(ws_d, timeout=1.0)
            await ws_c.close()
            await ws_d.close()
            return c_msgs, d_msgs

        c, d = asyncio.get_event_loop().run_until_complete(run())
        c_hit = [m for m in c if m.get("type") == "booking_status" and m.get("booking_id") == bid]
        d_hit = [m for m in d if m.get("type") == "booking_status" and m.get("booking_id") == bid]
        assert len(c_hit) == 1, f"customer missed booking_status: {c}"
        assert len(d_hit) == 1, f"driver missed booking_status: {d}"
        assert c_hit[0]["status"] == "in_transit"
        assert d_hit[0]["status"] == "in_transit"

    def test_notify_offline_user_noop(self, http, customer):
        """Posting a shipment where no nearby driver has an open socket must NOT raise."""
        r = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Sand",
                "weight_kg": 300,
                "packages": 1,
                "pickup_address": "Middle of nowhere",
                "pickup_city": "Nowhere",
                "pickup_lat": 0.0,
                "pickup_lng": 0.0,
                "drop_address": "Nowhere2",
                "drop_city": "Nowhere",
                "drop_lat": 0.5,
                "drop_lng": 0.5,
                "loading_date": "2026-02-10",
            },
        )
        assert r.status_code == 200


# ---------- 5. Regression spot-checks ----------
class TestRegression:
    def test_admin_login_rotated_secret(self, http):
        r = http.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin"

    def test_quote_gated_on_verification(self, http, admin_token, customer):
        # Register a fresh driver, add unverified truck, expect 400 on quote
        tok, _ = _register(http, "driver", "TESTDPEND")
        t = http.post(
            f"{API}/trucks",
            headers={"Authorization": f"Bearer {tok}"},
            json={
                "reg_number": f"KA02XY{random.randint(1000, 9999)}",
                "truck_type": "LCV",
                "body_type": "Open",
                "load_capacity_kg": 800,
                "base_lat": 12.9716,
                "base_lng": 77.5946,
                "base_city": "Bangalore",
            },
        )
        truck = t.json()
        # Create a shipment
        s = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Parcels",
                "weight_kg": 20,
                "packages": 1,
                "pickup_address": "A", "pickup_city": "Bangalore",
                "pickup_lat": 12.97, "pickup_lng": 77.59,
                "drop_address": "B", "drop_city": "Bangalore",
                "drop_lat": 12.98, "drop_lng": 77.60,
                "loading_date": "2026-02-10",
            },
        )
        sid = s.json()["id"]
        q = http.post(
            f"{API}/quotes",
            headers={"Authorization": f"Bearer {tok}"},
            json={"shipment_id": sid, "truck_id": truck["id"], "price_inr": 1000, "eta_hours": 3},
        )
        assert q.status_code == 400
        assert "approved" in q.text.lower()

    def test_admin_verify_reject(self, http, admin_token):
        tok, _ = _register(http, "driver", "TESTDVR")
        t = http.post(
            f"{API}/trucks",
            headers={"Authorization": f"Bearer {tok}"},
            json={
                "reg_number": f"KA03Z{random.randint(1000, 9999)}",
                "truck_type": "LCV",
                "body_type": "Open",
                "load_capacity_kg": 900,
                "base_lat": 12.97, "base_lng": 77.59, "base_city": "Bangalore",
            },
        )
        tid = t.json()["id"]
        r = http.post(f"{API}/admin/trucks/{tid}/reject",
                      headers={"Authorization": f"Bearer {admin_token}"},
                      json={"reason": "TEST"})
        assert r.status_code == 200
        v = http.post(f"{API}/admin/trucks/{tid}/verify",
                      headers={"Authorization": f"Bearer {admin_token}"})
        assert v.status_code == 200

    def test_shipments_open_explicit_lat_lng(self, http, driver_near, customer):
        s = http.post(
            f"{API}/shipments",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={
                "goods_category": "Parcels", "weight_kg": 10, "packages": 1,
                "pickup_address": "P", "pickup_city": "Bangalore",
                "pickup_lat": 12.9716, "pickup_lng": 77.5946,
                "drop_address": "D", "drop_city": "Bangalore",
                "drop_lat": 12.98, "drop_lng": 77.60,
                "loading_date": "2026-02-10",
            },
        )
        sid = s.json()["id"]
        r = http.get(f"{API}/shipments/open?lat=12.97&lng=77.59",
                     headers={"Authorization": f"Bearer {driver_near['token']}"})
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert sid in ids
        for item in r.json():
            assert "customer_phone" not in item

    def test_razorpay_mock(self, http, driver_near, customer):
        """Payment order in mock mode: should return an order-like payload w/o real Razorpay."""
        # need a booking; reuse _last_bid from broadcast tests if available
        bid = getattr(TestBroadcasts, "_last_bid", None)
        if not bid:
            pytest.skip("no booking id available")
        r = http.post(
            f"{API}/pay/order",
            headers={"Authorization": f"Bearer {customer['token']}"},
            json={"booking_id": bid},
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        # mock mode should include some order id
        assert any(k in data for k in ("order_id", "id", "mock", "razorpay_order_id"))


# ---------- 6. Response hygiene ----------
class TestResponseHygiene:
    def test_no_internal_fields_leaked(self, http, driver_near):
        # /users/me/location
        r = http.get(f"{API}/users/me/location",
                     headers={"Authorization": f"Bearer {driver_near['token']}"})
        assert "_id" not in r.text
        assert "password_hash" not in r.text
        # /shipments/open
        r2 = http.get(f"{API}/shipments/open",
                      headers={"Authorization": f"Bearer {driver_near['token']}"})
        assert "_id" not in r2.text
        assert "password_hash" not in r2.text
