from fastapi import APIRouter, HTTPException, Depends
import hmac
import hashlib
import logging
import uuid
from deps import db, current_user, now_iso, is_mock_pay, rzp_client, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
from models import OrderIn, PaymentVerifyIn

router = APIRouter(tags=["payments"])


@router.post("/pay/order")
async def create_order(body: OrderIn, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": body.booking_id})
    if not b or b["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")
    amount_paise = int(float(b["price_inr"]) * 100)
    order_id = None
    if rzp_client and not is_mock_pay():
        try:
            order = rzp_client.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "receipt": b["id"][:40],
                "payment_capture": 1,
            })
            order_id = order["id"]
        except Exception:
            logging.exception("Razorpay order create failed")
            raise HTTPException(502, "Payment gateway unavailable")
    else:
        order_id = f"order_mock_{uuid.uuid4().hex[:12]}"
    await db.bookings.update_one({"id": b["id"]}, {"$set": {"razorpay_order_id": order_id}})
    return {
        "order_id": order_id,
        "amount_paise": amount_paise,
        "currency": "INR",
        "key_id": RAZORPAY_KEY_ID,
        "booking_id": b["id"],
        "customer_name": user["name"],
        "customer_email": user["email"],
        "customer_phone": user["phone"],
        "mock_mode": is_mock_pay(),
    }


@router.post("/pay/verify")
async def verify_payment(body: PaymentVerifyIn, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": body.booking_id})
    if not b or b["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")
    # Server-side gate ONLY. Never trust order_id shape from the request body.
    if is_mock_pay():
        valid = True
    else:
        msg = f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode()
        expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        valid = hmac.compare_digest(expected, body.razorpay_signature)
    if not valid:
        raise HTTPException(400, "Signature mismatch")
    await db.bookings.update_one(
        {"id": b["id"]},
        {"$set": {
            "payment_status": "paid",
            "razorpay_payment_id": body.razorpay_payment_id,
            "paid_at": now_iso(),
        }},
    )
    return {"ok": True, "payment_status": "paid"}
