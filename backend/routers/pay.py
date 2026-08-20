from fastapi import APIRouter, HTTPException, Depends
import logging
import uuid
import os
import httpx

from deps import db, current_user, now_iso, is_mock_pay
from models import OrderIn, PaymentVerifyIn

router = APIRouter(tags=["payments"])

CASHFREE_CLIENT_ID = os.environ.get("CASHFREE_CLIENT_ID", "")
CASHFREE_CLIENT_SECRET = os.environ.get("CASHFREE_CLIENT_SECRET", "")
CASHFREE_API_VERSION = os.environ.get(
    "CASHFREE_API_VERSION",
    "2025-01-01"
)

CASHFREE_ENV = os.environ.get(
    "CASHFREE_ENV",
    "PRODUCTION"
).upper()

if CASHFREE_ENV == "SANDBOX":
    CASHFREE_BASE_URL = "https://sandbox.cashfree.com/pg"
else:
    CASHFREE_BASE_URL = "https://api.cashfree.com/pg"


@router.post("/pay/order")
async def create_order(
    body: OrderIn,
    user=Depends(current_user)
):
    b = await db.bookings.find_one({"id": body.booking_id})

    if not b or b["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")

    amount = float(b["price_inr"])

    # Mock payment for local testing
    if is_mock_pay():
        order_id = f"order_mock_{uuid.uuid4().hex[:12]}"

        await db.bookings.update_one(
            {"id": b["id"]},
            {
                "$set": {
                    "cashfree_order_id": order_id
                }
            }
        )

        return {
            "order_id": order_id,
            "payment_session_id": None,
            "amount": amount,
            "currency": "INR",
            "booking_id": b["id"],
            "customer_name": user["name"],
            "customer_email": user["email"],
            "customer_phone": user["phone"],
            "mock_mode": True,
        }

    if not CASHFREE_CLIENT_ID or not CASHFREE_CLIENT_SECRET:
        raise HTTPException(
            500,
            "Cashfree API credentials are not configured"
        )

    order_id = f"truckwala_{uuid.uuid4().hex[:20]}"

    headers = {
        "x-client-id": CASHFREE_CLIENT_ID,
        "x-client-secret": CASHFREE_CLIENT_SECRET,
        "x-api-version": CASHFREE_API_VERSION,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

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
            "return_url": (
                "https://truckwala.tech/"
                "?payment=success&order_id={order_id}"
            )
        }
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{CASHFREE_BASE_URL}/orders",
                headers=headers,
                json=payload,
            )

        if response.status_code not in (200, 201):
            logging.error(
                "Cashfree order failed: %s %s",
                response.status_code,
                response.text,
            )
            raise HTTPException(
                502,
                "Cashfree order creation failed"
            )

        data = response.json()

    except HTTPException:
        raise
    except Exception:
        logging.exception("Cashfree order create failed")
        raise HTTPException(
            502,
            "Payment gateway unavailable"
        )

    payment_session_id = data.get("payment_session_id")

    if not payment_session_id:
        logging.error("Cashfree response missing payment_session_id: %s", data)
        raise HTTPException(
            502,
            "Cashfree payment session not received"
        )

    await db.bookings.update_one(
        {"id": b["id"]},
        {
            "$set": {
                "cashfree_order_id": order_id,
                "payment_gateway": "cashfree",
            }
        }
    )

    return {
        "order_id": order_id,
        "payment_session_id": payment_session_id,
        "amount": amount,
        "currency": "INR",
        "booking_id": b["id"],
        "customer_name": user["name"],
        "customer_email": user["email"],
        "customer_phone": user["phone"],
        "mock_mode": False,
    }


@router.post("/pay/verify")
async def verify_payment(
    body: PaymentVerifyIn,
    user=Depends(current_user)
):
    booking_id = body.booking_id
    order_id = body.cashfree_order_id

    b = await db.bookings.find_one({"id": booking_id})

    if not b or b["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")

    if is_mock_pay():
        await db.bookings.update_one(
            {"id": b["id"]},
            {
                "$set": {
                    "payment_status": "paid",
                    "paid_at": now_iso(),
                }
            }
        )

        return {
            "ok": True,
            "payment_status": "paid"
        }

    if not CASHFREE_CLIENT_ID or not CASHFREE_CLIENT_SECRET:
        raise HTTPException(
            500,
            "Cashfree API credentials are not configured"
        )

    headers = {
        "x-client-id": CASHFREE_CLIENT_ID,
        "x-client-secret": CASHFREE_CLIENT_SECRET,
        "x-api-version": CASHFREE_API_VERSION,
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{CASHFREE_BASE_URL}/orders/{order_id}/payments",
                headers=headers,
            )

        if response.status_code != 200:
            logging.error(
                "Cashfree payment status failed: %s %s",
                response.status_code,
                response.text,
            )
            raise HTTPException(
                502,
                "Unable to verify payment"
            )

        payments = response.json()

    except HTTPException:
        raise
    except Exception:
        logging.exception("Cashfree payment verification failed")
        raise HTTPException(
            502,
            "Payment verification failed"
        )

    if not isinstance(payments, list):
        payments = [payments]

    success = any(
        p.get("payment_status") == "SUCCESS"
        for p in payments
    )

    if not success:
        return {
            "ok": False,
            "payment_status": "pending"
        }

    payment_id = None

    for p in payments:
        if p.get("payment_status") == "SUCCESS":
            payment_id = (
                p.get("cf_payment_id")
                or p.get("payment_id")
            )
            break

    await db.bookings.update_one(
        {"id": b["id"]},
        {
            "$set": {
                "payment_status": "paid",
                "cashfree_order_id": order_id,
                "cashfree_payment_id": payment_id,
                "paid_at": now_iso(),
            }
        }
    )

    return {
        "ok": True,
        "payment_status": "paid",
        "cashfree_payment_id": payment_id,
    }