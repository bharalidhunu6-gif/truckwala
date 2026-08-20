"""Driver subscription management (₹499 / ₹999 per month).

- GET  /subscriptions/tiers
- GET  /subscriptions/mine
- GET  /subscriptions/truck/{tid}
- POST /subscriptions/order       -> Cashfree order
- POST /subscriptions/verify      -> Cashfree payment verification
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone, timedelta
import logging
import uuid
import os
import httpx
import hmac
import hashlib
import base64

from deps import (
    db,
    current_user,
    now_iso,
    is_mock_pay,
    SUBSCRIPTION_TIERS,
    tier_for,
    truck_subscription_status,
)
from models import SubscriptionOrderIn, SubscriptionVerifyIn

router = APIRouter(tags=["subscriptions"])
log = logging.getLogger(__name__)


# =========================
# CASHFREE CONFIG
# =========================

CASHFREE_CLIENT_ID = os.environ.get("CASHFREE_CLIENT_ID", "")
CASHFREE_CLIENT_SECRET = os.environ.get("CASHFREE_CLIENT_SECRET", "")

CASHFREE_API_VERSION = os.environ.get(
    "CASHFREE_API_VERSION",
    "2025-01-01",
)

CASHFREE_ENV = os.environ.get(
    "CASHFREE_ENV",
    "PRODUCTION",
).upper()

if CASHFREE_ENV == "SANDBOX":
    CASHFREE_BASE_URL = "https://sandbox.cashfree.com/pg"
else:
    CASHFREE_BASE_URL = "https://api.cashfree.com/pg"

CASHFREE_RETURN_URL = os.environ.get(
    "CASHFREE_RETURN_URL",
    "https://truckwala.tech/?payment=subscription_success&order_id={order_id}",
)


# =========================
# TIERS
# =========================

@router.get("/subscriptions/tiers")
async def get_tiers():
    return SUBSCRIPTION_TIERS


# =========================
# MY SUBSCRIPTIONS
# =========================

@router.get("/subscriptions/mine")
async def my_subscriptions(user=Depends(current_user)):
    return await db.subscriptions.find(
        {"driver_id": user["id"]},
        {"_id": 0},
    ).sort(
        "created_at",
        -1,
    ).to_list(500)


# =========================
# TRUCK SUBSCRIPTION STATUS
# =========================

@router.get("/subscriptions/truck/{truck_id}")
async def truck_status(
    truck_id: str,
    user=Depends(current_user),
):
    t = await db.trucks.find_one(
        {"id": truck_id},
        {
            "_id": 0,
            "vehicle_photo": 0,
            "rc_photo": 0,
        },
    )

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
        "tier": tier_for(
            t.get("load_capacity_kg") or 0
        ),
        "latest_subscription": st["sub"],
    }


# =========================
# CREATE CASHFREE ORDER
# =========================

@router.post("/subscriptions/order")
async def create_order(
    body: SubscriptionOrderIn,
    user=Depends(current_user),
):
    t = await db.trucks.find_one(
        {
            "id": body.truck_id,
            "owner_id": user["id"],
        },
        {"_id": 0},
    )

    if not t:
        raise HTTPException(404, "Truck not found")

    if t.get("banned"):
        raise HTTPException(
            403,
            "Vehicle is banned; contact support",
        )

    tier = tier_for(
        t.get("load_capacity_kg") or 0
    )

    amount = float(tier["amount_inr"])

    # Unique subscription record
    sub_id = str(uuid.uuid4())

    # =========================
    # MOCK PAYMENT
    # =========================

    if is_mock_pay():
        order_id = f"order_mock_{uuid.uuid4().hex[:12]}"

        payment_session_id = None

    # =========================
    # CASHFREE LIVE/SANDBOX
    # =========================

    else:
        if (
            not CASHFREE_CLIENT_ID
            or not CASHFREE_CLIENT_SECRET
        ):
            raise HTTPException(
                500,
                "Cashfree API credentials are not configured",
            )

        order_id = f"truckwala_sub_{uuid.uuid4().hex[:20]}"

        headers = {
            "x-client-id": CASHFREE_CLIENT_ID,
            "x-client-secret": CASHFREE_CLIENT_SECRET,
            "x-api-version": CASHFREE_API_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        return_url = CASHFREE_RETURN_URL.format(
            order_id=order_id
        )

        payload = {
            "order_id": order_id,
            "order_amount": amount,
            "order_currency": "INR",
            "customer_details": {
                "customer_id": str(user["id"]),
                "customer_name": user.get("name", ""),
                "customer_email": user.get("email", ""),
                "customer_phone": user.get("phone", ""),
            },
            "order_meta": {
                "return_url": return_url,
            },
            "order_note": (
                f"Truck subscription - "
                f"{tier['title']}"
            ),
        }

        try:
            async with httpx.AsyncClient(
                timeout=30.0
            ) as client:

                response = await client.post(
                    f"{CASHFREE_BASE_URL}/orders",
                    headers=headers,
                    json=payload,
                )

            if response.status_code not in (200, 201):
                log.error(
                    "Cashfree subscription order failed: %s %s",
                    response.status_code,
                    response.text,
                )

                raise HTTPException(
                    502,
                    "Cashfree subscription order creation failed",
                )

            data = response.json()

        except HTTPException:
            raise

        except Exception:
            log.exception(
                "Cashfree subscription order create failed"
            )

            raise HTTPException(
                502,
                "Payment gateway unavailable",
            )

        payment_session_id = data.get(
            "payment_session_id"
        )

        if not payment_session_id:
            log.error(
                "Cashfree response missing payment_session_id: %s",
                data,
            )

            raise HTTPException(
                502,
                "Cashfree payment session not received",
            )

    # =========================
    # SAVE PENDING SUBSCRIPTION
    # =========================

    doc = {
        "id": sub_id,
        "driver_id": user["id"],
        "driver_name": user.get("name"),
        "truck_id": body.truck_id,
        "reg_number": t.get("reg_number"),
        "tier_id": tier["id"],
        "amount_inr": tier["amount_inr"],

        "cashfree_order_id": order_id,
        "cashfree_payment_id": None,

        "payment_gateway": "cashfree",

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
        "payment_session_id": payment_session_id,

        "amount_inr": tier["amount_inr"],
        "currency": "INR",

        "tier": tier,

        "truck": {
            "id": t["id"],
            "reg_number": t.get("reg_number"),
            "truck_type": t.get("truck_type"),
        },

        "customer_name": user.get("name"),
        "customer_email": user.get("email"),
        "customer_phone": user.get("phone"),

        "mock_mode": is_mock_pay(),
    }


# =========================
# VERIFY CASHFREE PAYMENT
# =========================

@router.post("/subscriptions/verify")
async def verify_order(
    body: SubscriptionVerifyIn,
    user=Depends(current_user),
):
    sub = await db.subscriptions.find_one(
        {
            "id": body.subscription_id,
            "driver_id": user["id"],
        }
    )

    if not sub:
        raise HTTPException(
            404,
            "Subscription not found",
        )

    if sub["truck_id"] != body.truck_id:
        raise HTTPException(
            400,
            "Truck mismatch",
        )

    # Prevent user from verifying another order
    if sub.get("cashfree_order_id") != body.order_id:
        raise HTTPException(
            400,
            "Cashfree order mismatch",
        )

    # =========================
    # MOCK
    # =========================

    if is_mock_pay():
        success = True
        payment_id = "mock_payment"

    # =========================
    # CASHFREE
    # =========================

    else:
        if (
            not CASHFREE_CLIENT_ID
            or not CASHFREE_CLIENT_SECRET
        ):
            raise HTTPException(
                500,
                "Cashfree API credentials are not configured",
            )

        headers = {
            "x-client-id": CASHFREE_CLIENT_ID,
            "x-client-secret": CASHFREE_CLIENT_SECRET,
            "x-api-version": CASHFREE_API_VERSION,
            "Accept": "application/json",
        }

        try:
            async with httpx.AsyncClient(
                timeout=30.0
            ) as client:

                response = await client.get(
                    f"{CASHFREE_BASE_URL}/orders/"
                    f"{body.order_id}/payments",
                    headers=headers,
                )

            if response.status_code != 200:
                log.error(
                    "Cashfree subscription payment status failed: %s %s",
                    response.status_code,
                    response.text,
                )

                raise HTTPException(
                    502,
                    "Unable to verify Cashfree payment",
                )

            payments = response.json()

        except HTTPException:
            raise

        except Exception:
            log.exception(
                "Cashfree subscription payment verification failed"
            )

            raise HTTPException(
                502,
                "Payment verification failed",
            )

        if not isinstance(payments, list):
            payments = [payments]

        successful_payment = next(
            (
                p
                for p in payments
                if p.get("payment_status") == "SUCCESS"
            ),
            None,
        )

        if not successful_payment:
            return {
                "ok": False,
                "payment_status": "pending",
            }

        success = True

        payment_id = (
            successful_payment.get("cf_payment_id")
            or successful_payment.get("payment_id")
        )

    if not success:
        await db.subscriptions.update_one(
            {"id": sub["id"]},
            {
                "$set": {
                    "status": "failed",
                }
            },
        )

        raise HTTPException(
            400,
            "Payment verification failed",
        )

    # =========================
    # ACTIVATE FOR 30 DAYS
    # =========================

    now = datetime.now(timezone.utc)

    base = now

    existing = await db.subscriptions.find_one(
        {
            "truck_id": body.truck_id,
            "status": "active",
        },
        sort=[("expires_at", -1)],
    )

    if existing and existing.get("expires_at"):
        exp = existing["expires_at"]

        if exp.tzinfo is None:
            exp = exp.replace(
                tzinfo=timezone.utc
            )

        if exp > now:
            base = exp

    expires_at = base + timedelta(days=30)

    await db.subscriptions.update_one(
        {"id": sub["id"]},
        {
            "$set": {
                "cashfree_payment_id": payment_id,
                "status": "active",
                "activated_at": now.isoformat(),
                "expires_at": expires_at,
            }
        },
    )

    updated = await db.subscriptions.find_one(
        {"id": sub["id"]},
        {"_id": 0},
    )

    return {
        "ok": True,
        "payment_status": "paid",
        "subscription": updated,
    }