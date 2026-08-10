"""
FreightOS iter-6 regression tests — verifies backend still works after monolith→routers refactor.
Covers all 15 areas requested by main agent.
"""
import os
import time
import uuid
import json
import asyncio
import websockets
import requests
import pytest

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"] if "EXPO_PUBLIC_BACKEND_URL" in os.environ else None
if not BASE:
    # read from /app/frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip()
                break
BASE = BASE.rstrip("/")
API = BASE + "/api"
WS_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/chat"

ADMIN_EMAIL = "admin@freightos.app"
ADMIN_PASS = "admin1234"

TAG = uuid.uuid4().hex[:8]


def _h(tok): return {"Authorization": f"Bearer {tok}"}


# ---------- shared session-level fixture: builds full chain ----------
@pytest.fixture(scope="module")
def ctx():
    s = requests.Session()

    # 1. Admin login
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"admin login {r.status_code} {r.text}"
    admin_tok = r.json()["token"]
    admin_user = r.json()["user"]

    # 2. Register customer
    cust_email = f"TEST_cust_{TAG}@t.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "TEST Cust", "email": cust_email, "phone": "+911111111111",
        "password": "test1234", "role": "customer"
    }, timeout=15)
    assert r.status_code == 200, f"cust reg {r.status_code} {r.text}"
    cust_tok = r.json()["token"]
    cust = r.json()["user"]
    assert "password_hash" not in cust and "_id" not in cust

    # 3. Register driver
    drv_email = f"TEST_drv_{TAG}@t.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "TEST Drv", "email": drv_email, "phone": "+912222222222",
        "password": "test1234", "role": "driver"
    }, timeout=15)
    assert r.status_code == 200
    drv_tok = r.json()["token"]
    drv = r.json()["user"]

    # 4. Register a third-party (customer2) for negative ACL tests
    other_email = f"TEST_other_{TAG}@t.com"
    r = s.post(f"{API}/auth/register", json={
        "name": "TEST Other", "email": other_email, "phone": "+913333333333",
        "password": "test1234", "role": "customer"
    }, timeout=15)
    assert r.status_code == 200
    other_tok = r.json()["token"]
    other = r.json()["user"]

    return {
        "s": s, "admin_tok": admin_tok, "admin": admin_user,
        "cust_tok": cust_tok, "cust": cust,
        "drv_tok": drv_tok, "drv": drv,
        "other_tok": other_tok, "other": other,
    }


# ---------- 1. Auth ----------
def test_auth_me_customer(ctx):
    r = ctx["s"].get(f"{API}/auth/me", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "customer"
    assert "password_hash" not in body and "_id" not in body


def test_auth_me_driver(ctx):
    r = ctx["s"].get(f"{API}/auth/me", headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200 and r.json()["role"] == "driver"


def test_auth_me_admin(ctx):
    r = ctx["s"].get(f"{API}/auth/me", headers=_h(ctx["admin_tok"]))
    assert r.status_code == 200 and r.json()["role"] == "admin"


def test_auth_login_existing_customer(ctx):
    # re-login the customer we just registered
    r = ctx["s"].post(f"{API}/auth/login", json={
        "email": ctx["cust"]["email"], "password": "test1234"
    })
    assert r.status_code == 200
    assert "token" in r.json()


# ---------- 2. Catalog ----------
def test_catalog(ctx):
    r = ctx["s"].get(f"{API}/catalog")
    assert r.status_code == 200
    body = r.json()
    for k in ("truck_types", "goods_categories", "body_types"):
        assert k in body and isinstance(body[k], list) and len(body[k]) > 0


# ---------- 3. Trucks ----------
def test_truck_create_pending(ctx):
    r = ctx["s"].post(f"{API}/trucks", headers=_h(ctx["drv_tok"]), json={
        "reg_number": f"TEST-{TAG}", "truck_type": "Mini Truck", "body_type": "Open",
        "load_capacity_kg": 1000, "dimensions": "10x6x6", "base_city": "Bangalore",
    })
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["verification_status"] == "pending"
    assert "_id" not in t
    ctx["truck_id"] = t["id"]


def test_trucks_mine(ctx):
    r = ctx["s"].get(f"{API}/trucks/mine", headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    assert ctx["truck_id"] in ids


def test_truck_delete_and_recreate(ctx):
    # create a throwaway truck to test DELETE, then recreate primary if needed
    r = ctx["s"].post(f"{API}/trucks", headers=_h(ctx["drv_tok"]), json={
        "reg_number": f"TEST-DEL-{TAG}", "truck_type": "Mini Truck", "body_type": "Open",
        "load_capacity_kg": 500,
    })
    assert r.status_code == 200
    tid = r.json()["id"]
    r = ctx["s"].delete(f"{API}/trucks/{tid}", headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200 and r.json()["ok"] is True


# ---------- 4. Shipments ----------
def test_shipment_create(ctx):
    r = ctx["s"].post(f"{API}/shipments", headers=_h(ctx["cust_tok"]), json={
        "goods_category": "Furniture", "weight_kg": 500, "packages": 5,
        "pickup_address": "A", "pickup_city": "Bangalore", "pickup_lat": 12.97, "pickup_lng": 77.59,
        "drop_address": "B", "drop_city": "Chennai", "drop_lat": 13.08, "drop_lng": 80.27,
        "loading_date": "2026-02-01",
    })
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "open" and s["distance_km"] > 0
    assert "_id" not in s
    ctx["sid"] = s["id"]


def test_shipment_open_includes_it_for_driver(ctx):
    r = ctx["s"].get(f"{API}/shipments/open", headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert ctx["sid"] in ids


def test_shipment_open_403_for_customer(ctx):
    r = ctx["s"].get(f"{API}/shipments/open", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 403


def test_shipment_get_by_id(ctx):
    r = ctx["s"].get(f"{API}/shipments/{ctx['sid']}", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 200 and r.json()["id"] == ctx["sid"]


def test_shipment_create_403_for_driver(ctx):
    r = ctx["s"].post(f"{API}/shipments", headers=_h(ctx["drv_tok"]), json={
        "goods_category": "Furniture", "weight_kg": 1, "packages": 1,
        "pickup_address": "A", "pickup_city": "X", "pickup_lat": 1, "pickup_lng": 1,
        "drop_address": "B", "drop_city": "Y", "drop_lat": 2, "drop_lng": 2,
        "loading_date": "2026-02-01",
    })
    assert r.status_code == 403


# ---------- 5. Quotes ----------
def test_quote_blocked_when_truck_pending(ctx):
    r = ctx["s"].post(f"{API}/quotes", headers=_h(ctx["drv_tok"]), json={
        "shipment_id": ctx["sid"], "truck_id": ctx["truck_id"],
        "price_inr": 5000, "eta_hours": 10,
    })
    assert r.status_code == 400
    assert "approv" in r.text.lower()


def test_admin_approve_truck(ctx):
    r = ctx["s"].post(f"{API}/admin/trucks/{ctx['truck_id']}/verify",
                      headers=_h(ctx["admin_tok"]))
    assert r.status_code == 200
    assert r.json()["verification_status"] == "approved"


def test_quote_after_approve_ok(ctx):
    # submit two quotes to check sorting
    r = ctx["s"].post(f"{API}/quotes", headers=_h(ctx["drv_tok"]), json={
        "shipment_id": ctx["sid"], "truck_id": ctx["truck_id"],
        "price_inr": 6000, "eta_hours": 12,
    })
    assert r.status_code == 200, r.text
    ctx["q_hi"] = r.json()["id"]

    r = ctx["s"].post(f"{API}/quotes", headers=_h(ctx["drv_tok"]), json={
        "shipment_id": ctx["sid"], "truck_id": ctx["truck_id"],
        "price_inr": 4500, "eta_hours": 15,
    })
    assert r.status_code == 200
    ctx["q_lo"] = r.json()["id"]


def test_quote_list_sorted_asc(ctx):
    r = ctx["s"].get(f"{API}/quotes/shipment/{ctx['sid']}", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 200
    prices = [q["price_inr"] for q in r.json()]
    assert prices == sorted(prices)
    assert prices[0] == 4500


# ---------- 6. Bookings ----------
def test_accept_quote(ctx):
    r = ctx["s"].post(f"{API}/bookings/accept/{ctx['q_lo']}", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "confirmed"
    ctx["bid"] = b["id"]
    ctx["otp"] = b["otp"]

    # shipment now booked
    r = ctx["s"].get(f"{API}/shipments/{ctx['sid']}", headers=_h(ctx["cust_tok"]))
    assert r.json()["status"] == "booked"


def test_bookings_mine(ctx):
    r = ctx["s"].get(f"{API}/bookings/mine", headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200
    ids = [b["id"] for b in r.json()]
    assert ctx["bid"] in ids


def test_status_in_transit(ctx):
    r = ctx["s"].post(f"{API}/bookings/{ctx['bid']}/status?status=in_transit",
                      headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200


def test_status_delivered_bad_otp(ctx):
    r = ctx["s"].post(f"{API}/bookings/{ctx['bid']}/status?status=delivered&otp=0000",
                      headers=_h(ctx["drv_tok"]))
    assert r.status_code == 400


def test_status_delivered_ok(ctx):
    r = ctx["s"].post(
        f"{API}/bookings/{ctx['bid']}/status?status=delivered&otp={ctx['otp']}",
        headers=_h(ctx["drv_tok"])
    )
    assert r.status_code == 200


# ---------- 7. Location ----------
def test_location_delivered_400(ctx):
    # after delivery, location POST should 400
    r = ctx["s"].post(f"{API}/bookings/{ctx['bid']}/location",
                      headers=_h(ctx["drv_tok"]), json={"lat": 12.9, "lng": 77.6})
    assert r.status_code == 400


def test_location_get_participant_ok(ctx):
    r = ctx["s"].get(f"{API}/bookings/{ctx['bid']}/location", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 200


def test_location_get_third_party_403(ctx):
    r = ctx["s"].get(f"{API}/bookings/{ctx['bid']}/location", headers=_h(ctx["other_tok"]))
    assert r.status_code == 403


def test_location_third_party_post_403(ctx):
    r = ctx["s"].post(f"{API}/bookings/{ctx['bid']}/location",
                      headers=_h(ctx["other_tok"]), json={"lat": 1, "lng": 1})
    assert r.status_code == 403


# ---------- 8. Ratings ----------
def test_rating_recomputes_avg(ctx):
    r = ctx["s"].post(f"{API}/ratings", headers=_h(ctx["cust_tok"]), json={
        "booking_id": ctx["bid"], "rating": 5, "review": "Great TEST"
    })
    assert r.status_code == 200, r.text

    # driver's avg_rating should now be 5.0
    r = ctx["s"].get(f"{API}/ratings/user/{ctx['drv']['id']}")
    assert r.status_code == 200 and len(r.json()) >= 1

    # re-login driver → user object has updated avg
    r = ctx["s"].get(f"{API}/auth/me", headers=_h(ctx["drv_tok"]))
    assert abs(r.json().get("avg_rating", 0) - 5.0) < 0.01


# ---------- 9. Earnings ----------
def test_earnings_driver(ctx):
    r = ctx["s"].get(f"{API}/earnings/summary", headers=_h(ctx["drv_tok"]))
    assert r.status_code == 200
    body = r.json()
    assert body["trips_completed"] >= 1
    assert body["total_earned_inr"] >= 4500


def test_earnings_customer_403(ctx):
    r = ctx["s"].get(f"{API}/earnings/summary", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 403


# ---------- 10. Pay ----------
def test_pay_order_mock(ctx):
    # need a fresh booking for payment (since prior one is delivered — pay still allowed
    # since /pay/order only checks ownership; test on existing bid)
    r = ctx["s"].post(f"{API}/pay/order", headers=_h(ctx["cust_tok"]),
                      json={"booking_id": ctx["bid"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mock_mode"] is True
    assert body["order_id"].startswith("order_mock_")
    ctx["order_id"] = body["order_id"]


def test_pay_verify(ctx):
    r = ctx["s"].post(f"{API}/pay/verify", headers=_h(ctx["cust_tok"]), json={
        "booking_id": ctx["bid"],
        "razorpay_order_id": ctx["order_id"],
        "razorpay_payment_id": "pay_TEST_" + TAG,
        "razorpay_signature": "sig_TEST",
    })
    assert r.status_code == 200
    assert r.json()["payment_status"] == "paid"

    # booking has payment_status=paid
    r = ctx["s"].get(f"{API}/bookings/{ctx['bid']}", headers=_h(ctx["cust_tok"]))
    assert r.json()["payment_status"] == "paid"


# ---------- 11. Admin ----------
def test_admin_stats(ctx):
    r = ctx["s"].get(f"{API}/admin/stats", headers=_h(ctx["admin_tok"]))
    assert r.status_code == 200
    body = r.json()
    for k in ("trucks_pending", "trucks_approved", "trucks_rejected", "total_users", "total_bookings"):
        assert k in body


def test_admin_stats_403_non_admin(ctx):
    r = ctx["s"].get(f"{API}/admin/stats", headers=_h(ctx["cust_tok"]))
    assert r.status_code == 403


def test_admin_verify_unknown_truck_404(ctx):
    r = ctx["s"].post(f"{API}/admin/trucks/DOES_NOT_EXIST_{TAG}/verify",
                      headers=_h(ctx["admin_tok"]))
    assert r.status_code == 404


def test_admin_reject_unknown_truck_404(ctx):
    r = ctx["s"].post(f"{API}/admin/trucks/NOPE_{TAG}/reject",
                      headers=_h(ctx["admin_tok"]), json={"reason": "x"})
    assert r.status_code == 404


def test_admin_reject_flow(ctx):
    # create a pending truck, reject it, verify status
    r = ctx["s"].post(f"{API}/trucks", headers=_h(ctx["drv_tok"]), json={
        "reg_number": f"TEST-REJ-{TAG}", "truck_type": "LCV", "body_type": "Open",
        "load_capacity_kg": 800,
    })
    assert r.status_code == 200
    tid = r.json()["id"]
    r = ctx["s"].post(f"{API}/admin/trucks/{tid}/reject",
                      headers=_h(ctx["admin_tok"]), json={"reason": "TEST"})
    assert r.status_code == 200
    assert r.json()["verification_status"] == "rejected"
    assert r.json()["rejection_reason"] == "TEST"


def test_admin_trucks_list_approved_migration(ctx):
    # legacy trucks (from startup migration) should show up as approved
    r = ctx["s"].get(f"{API}/admin/trucks?status=approved", headers=_h(ctx["admin_tok"]))
    assert r.status_code == 200
    lst = r.json()
    # our approved truck must be present, and none should be missing verification_status
    ids = [t["id"] for t in lst]
    assert ctx["truck_id"] in ids
    for t in lst:
        assert t["verification_status"] == "approved"
        assert "_id" not in t


# ---------- 12. Chat REST ----------
def test_chat_send_and_get(ctx):
    # send from customer
    r = ctx["s"].post(f"{API}/chat/{ctx['bid']}/messages",
                      headers=_h(ctx["cust_tok"]), json={"text": "hello TEST"})
    assert r.status_code == 200
    assert r.json()["text"] == "hello TEST"

    # send from driver
    r = ctx["s"].post(f"{API}/chat/{ctx['bid']}/messages",
                      headers=_h(ctx["drv_tok"]), json={"text": "hi TEST"})
    assert r.status_code == 200

    # admin allowed
    r = ctx["s"].post(f"{API}/chat/{ctx['bid']}/messages",
                      headers=_h(ctx["admin_tok"]), json={"text": "admin here"})
    assert r.status_code == 200

    r = ctx["s"].get(f"{API}/chat/{ctx['bid']}/messages",
                     headers=_h(ctx["cust_tok"]))
    assert r.status_code == 200
    msgs = r.json()
    assert len(msgs) >= 3
    for m in msgs:
        assert "_id" not in m


def test_chat_third_party_403(ctx):
    r = ctx["s"].get(f"{API}/chat/{ctx['bid']}/messages",
                     headers=_h(ctx["other_tok"]))
    assert r.status_code == 403
    r = ctx["s"].post(f"{API}/chat/{ctx['bid']}/messages",
                     headers=_h(ctx["other_tok"]), json={"text": "sneaky"})
    assert r.status_code == 403


def test_chat_empty_400(ctx):
    r = ctx["s"].post(f"{API}/chat/{ctx['bid']}/messages",
                     headers=_h(ctx["cust_tok"]), json={"text": "   "})
    assert r.status_code == 400


def test_chat_truncation(ctx):
    txt = "x" * 2500
    r = ctx["s"].post(f"{API}/chat/{ctx['bid']}/messages",
                     headers=_h(ctx["cust_tok"]), json={"text": txt})
    assert r.status_code == 200
    assert len(r.json()["text"]) == 2000


# ---------- 13. Chat WebSocket ----------
@pytest.mark.asyncio
async def test_ws_history_echo_and_broadcast(ctx):
    url_cust = f"{WS_BASE}/{ctx['bid']}?token={ctx['cust_tok']}"
    url_drv = f"{WS_BASE}/{ctx['bid']}?token={ctx['drv_tok']}"

    async with websockets.connect(url_cust) as ws_c, websockets.connect(url_drv) as ws_d:
        # both should receive history frame
        hist_c = json.loads(await asyncio.wait_for(ws_c.recv(), timeout=5))
        hist_d = json.loads(await asyncio.wait_for(ws_d.recv(), timeout=5))
        assert hist_c["type"] == "history"
        assert hist_d["type"] == "history"

        # customer sends message → both should receive it
        await ws_c.send(json.dumps({"text": "ws-hello TEST"}))
        m_c = json.loads(await asyncio.wait_for(ws_c.recv(), timeout=5))
        m_d = json.loads(await asyncio.wait_for(ws_d.recv(), timeout=5))
        assert m_c["type"] == "message" and m_c["text"] == "ws-hello TEST"
        assert m_d["type"] == "message" and m_d["text"] == "ws-hello TEST"


@pytest.mark.asyncio
async def test_ws_invalid_token_4401(ctx):
    url = f"{WS_BASE}/{ctx['bid']}?token=garbage"
    try:
        async with websockets.connect(url) as ws:
            await ws.recv()
        assert False, "should have closed"
    except websockets.exceptions.InvalidStatus as e:
        # server may reject at handshake with 403 or 401
        assert e.response.status_code in (401, 403)
    except websockets.exceptions.ConnectionClosed as e:
        assert e.code == 4401


@pytest.mark.asyncio
async def test_ws_third_party_4403(ctx):
    url = f"{WS_BASE}/{ctx['bid']}?token={ctx['other_tok']}"
    try:
        async with websockets.connect(url) as ws:
            await ws.recv()
        assert False, "should have closed"
    except websockets.exceptions.InvalidStatus as e:
        assert e.response.status_code in (401, 403)
    except websockets.exceptions.ConnectionClosed as e:
        assert e.code == 4403


# ---------- 14. Response hygiene: no _id / no password_hash anywhere ----------
def test_hygiene_no_id_leak(ctx):
    endpoints = [
        ("GET", f"{API}/auth/me", _h(ctx["cust_tok"]), None),
        ("GET", f"{API}/trucks/mine", _h(ctx["drv_tok"]), None),
        ("GET", f"{API}/shipments/mine", _h(ctx["cust_tok"]), None),
        ("GET", f"{API}/shipments/open", _h(ctx["drv_tok"]), None),
        ("GET", f"{API}/quotes/shipment/{ctx['sid']}", _h(ctx["cust_tok"]), None),
        ("GET", f"{API}/quotes/mine", _h(ctx["drv_tok"]), None),
        ("GET", f"{API}/bookings/mine", _h(ctx["cust_tok"]), None),
        ("GET", f"{API}/bookings/{ctx['bid']}", _h(ctx["cust_tok"]), None),
        ("GET", f"{API}/chat/{ctx['bid']}/messages", _h(ctx["cust_tok"]), None),
        ("GET", f"{API}/admin/trucks", _h(ctx["admin_tok"]), None),
    ]
    for m, u, h, j in endpoints:
        r = ctx["s"].request(m, u, headers=h)
        assert r.status_code == 200, f"{u} → {r.status_code}"
        blob = r.text
        assert '"_id"' not in blob, f"_id leak at {u}"
        assert '"password_hash"' not in blob, f"password_hash leak at {u}"
