"""Driver subscription management (₹499 / ₹999 per month).

- `GET  /subscriptions/tiers`         → list of subscription tiers.
- `GET  /subscriptions/mine`          → all subscriptions owned by caller.
- `GET  /subscriptions/truck/{tid}`   → current status for one truck.
- `POST /subscriptions/order`         → create a Razorpay order for a truck.
- `POST /subscriptions/verify`        → verify signature + activate 30 days.

We always create a subscription row in `db.subscriptions` up-front with
status='pending' when the order is created, so admins can trace payment
attempts too.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import hmac
import hashlib
import logging
import uuid
from deps import (
    db, current_user, now_iso,
    rzp_client, is_mock_pay, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
    SUBSCRIPTION_TIERS, tier_for, truck_subscription_status,
)
from models import SubscriptionOrderIn, SubscriptionVerifyIn

router = APIRouter(tags=["subscriptions"])
log = logging.getLogger(__name__)


@router.get("/subscriptions/tiers")
async def get_tiers():
    return SUBSCRIPTION_TIERS


@router.get("/subscriptions/mine")
async def my_subscriptions(user=Depends(current_user)):
    return await db.subscriptions.find({"driver_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/subscriptions/truck/{truck_id}")
async def truck_status(truck_id: str, user=Depends(current_user)):
    t = await db.trucks.find_one({"id": truck_id}, {"_id": 0, "vehicle_photo": 0, "rc_photo": 0})
    if not t:
        raise HTTPException(404, "Truck not found")
    if user.get("role") != "admin" and t["owner_id"] != user["id"]:
        raise HTTPException(403, "Not your truck")
    st = await truck_subscription_status(truck_id)
    return {
        "truck_id": truck_id,
        "reg_number": t.get("reg_number"),
        "active": st["active"],
        "expires_at": st["expires_at"],
        "tier": tier_for(t.get("load_capacity_kg") or 0),
        "latest_subscription": st["sub"],
    }


@router.post("/subscriptions/order")
async def create_order(body: SubscriptionOrderIn, user=Depends(current_user)):
    t = await db.trucks.find_one({"id": body.truck_id, "owner_id": user["id"]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Truck not found")
    if t.get("banned"):
        raise HTTPException(403, "Vehicle is banned; contact support")
    tier = tier_for(t.get("load_capacity_kg") or 0)
    amount_paise = int(tier["amount_inr"]) * 100

    sub_id = str(uuid.uuid4())
    order_id = None
    if rzp_client and not is_mock_pay():
        try:
            order = rzp_client.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "receipt": sub_id[:40],
                "payment_capture": 1,
                "notes": {"truck_id": body.truck_id, "tier": tier["id"], "driver_id": user["id"]},
            })
            order_id = order["id"]
        except Exception:
            log.exception("Razorpay subscription order create failed")
            raise HTTPException(502, "Payment gateway unavailable")
    else:
        order_id = f"order_mock_{uuid.uuid4().hex[:12]}"

    doc = {
        "id": sub_id,
        "driver_id": user["id"],
        "driver_name": user.get("name"),
        "truck_id": body.truck_id,
        "reg_number": t.get("reg_number"),
        "tier_id": tier["id"],
        "amount_inr": tier["amount_inr"],
        "razorpay_order_id": order_id,
        "razorpay_payment_id": None,
        "status": "pending",
        "created_at": now_iso(),
        "activated_at": None,
        "expires_at": None,
    }
    await db.subscriptions.insert_one(doc)
    doc.pop("_id", None)
    return {
        "subscription_id": sub_id,
        "order_id": order_id,
        "amount_paise": amount_paise,
        "amount_inr": tier["amount_inr"],
        "currency": "INR",
        "key_id": RAZORPAY_KEY_ID,
        "tier": tier,
        "truck": {"id": t["id"], "reg_number": t.get("reg_number"), "truck_type": t.get("truck_type")},
        "customer_name": user.get("name"),
        "customer_email": user.get("email"),
        "customer_phone": user.get("phone"),
        "mock_mode": is_mock_pay(),
    }


@router.post("/subscriptions/verify")
async def verify_order(body: SubscriptionVerifyIn, user=Depends(current_user)):
    sub = await db.subscriptions.find_one({"id": body.subscription_id, "driver_id": user["id"]})
    if not sub:
        raise HTTPException(404, "Subscription not found")
    if sub["truck_id"] != body.truck_id:
        raise HTTPException(400, "Truck mismatch")
    if is_mock_pay():
        valid = True  # Mock signature check bypass.
    else:
        msg = f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode()
        expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        valid = hmac.compare_digest(expected, body.razorpay_signature)
    if not valid:
        await db.subscriptions.update_one({"id": sub["id"]}, {"$set": {"status": "failed"}})
        raise HTTPException(400, "Signature mismatch")

    # Extend existing active subscription (if any) rather than truncate — grace.
    now = datetime.now(timezone.utc)
    base = now
    existing = await db.subscriptions.find_one(
        {"truck_id": body.truck_id, "status": "active"},
        sort=[("expires_at", -1)],
    )
    if existing and existing.get("expires_at"):
        exp = existing["expires_at"]
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp > now:
            base = exp
    expires_at = base + timedelta(days=30)

    await db.subscriptions.update_one(
        {"id": sub["id"]},
        {"$set": {
            "razorpay_payment_id": body.razorpay_payment_id,
            "status": "active",
            "activated_at": now.isoformat(),
            "expires_at": expires_at,
        }},
    )
    updated = await db.subscriptions.find_one({"id": sub["id"]}, {"_id": 0})
    return {"ok": True, "subscription": updated}
