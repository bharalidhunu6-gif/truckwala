from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from random import randint
import uuid
from deps import db, current_user, now_iso
from models import AcceptQuoteIn
from routers.notifications import notify_user

router = APIRouter(tags=["bookings"])


def _is_participant(user: dict, b: dict) -> bool:
    return user["id"] in (b["customer_id"], b["driver_id"]) or user.get("role") == "admin"


def _mask_for_driver(b: dict) -> dict:
    """Drivers must never see the pickup/delivery OTPs — the shipper does.
    We hide them and expose only whether they've been verified."""
    b = dict(b)  # shallow copy so we don't mutate the DB doc reference
    b["pickup_verified"] = bool(b.get("pickup_verified"))
    b["delivery_verified"] = bool(b.get("delivery_verified"))
    b.pop("pickup_otp", None)
    b.pop("delivery_otp", None)
    # Legacy single-OTP field, in case any old bookings still have it.
    b.pop("otp", None)
    return b


def _gen_otp() -> str:
    return f"{randint(0, 9999):04d}"


@router.post("/bookings/accept/{quote_id}")
async def accept_quote(quote_id: str, body: AcceptQuoteIn | None = None, user=Depends(current_user)):
    q = await db.quotes.find_one({"id": quote_id})
    if not q:
        raise HTTPException(404, "Quote not found")
    s = await db.shipments.find_one({"id": q["shipment_id"]})
    if not s or s["customer_id"] != user["id"]:
        raise HTTPException(403, "Not your shipment")
    if s["status"] != "open":
        raise HTTPException(400, "Shipment not open")

    payment_method = "cod"  # Truck Wala runs COD-only for shippers. Drivers pay a monthly subscription instead of per-booking commission.

    booking = {
        "id": str(uuid.uuid4()),
        "shipment_id": s["id"],
        "quote_id": q["id"],
        "customer_id": s["customer_id"],
        "customer_name": s["customer_name"],
        "customer_phone": s.get("customer_phone"),
        "driver_id": q["driver_id"],
        "driver_name": q["driver_name"],
        "truck_id": q["truck_id"],
        "truck_snapshot": q["truck_snapshot"],
        "price_inr": q["price_inr"],
        "eta_hours": q["eta_hours"],
        "pickup_address": s["pickup_address"],
        "drop_address": s["drop_address"],
        "pickup_city": s["pickup_city"],
        "drop_city": s["drop_city"],
        "distance_km": s["distance_km"],
        "goods_category": s["goods_category"],
        "weight_kg": s["weight_kg"],
        # Two OTPs — shipper receives BOTH. Driver never sees them; they only
        # enter them (verbally / on paper handoff) at pickup and drop-off.
        "pickup_otp": _gen_otp(),
        "delivery_otp": _gen_otp(),
        "pickup_verified": False,
        "delivery_verified": False,
        "status": "confirmed",
        "payment_method": payment_method,          # 'razorpay' or 'cod'
        "payment_status": "cod_pending" if payment_method == "cod" else "unpaid",
        "timeline": [{"status": "confirmed", "at": now_iso(), "note": "Booking confirmed"}],
        "created_at": now_iso(),
    }
    await db.bookings.insert_one(booking)
    await db.shipments.update_one(
        {"id": s["id"]},
        {
            "$set": {"status": "booked", "assigned_driver_id": q["driver_id"], "booking_id": booking["id"]},
            "$unset": {"expires_at": ""},  # a booked shipment is no longer subject to the 24h TTL
        },
    )
    await db.quotes.update_one({"id": q["id"]}, {"$set": {"status": "accepted"}})
    await db.quotes.update_many(
        {"shipment_id": s["id"], "id": {"$ne": q["id"]}},
        {"$set": {"status": "rejected"}},
    )
    booking.pop("_id", None)
    # Notify the driver that their quote was accepted (WITHOUT OTPs).
    try:
        await notify_user(q["driver_id"], {
            "type": "booking_accepted",
            "booking_id": booking["id"],
            "shipment_id": s["id"],
            "customer_name": s["customer_name"],
            "price_inr": booking["price_inr"],
            "payment_method": payment_method,
            "at": booking["created_at"],
        })
    except Exception:
        pass
    return booking


@router.get("/bookings/mine")
async def my_bookings(user=Depends(current_user)):
    q = {"customer_id": user["id"]} if user["role"] == "customer" else {"driver_id": user["id"]}
    items = await db.bookings.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    if user["role"] == "driver":
        items = [_mask_for_driver(i) for i in items]
    return items


@router.get("/bookings/{bid}")
async def get_booking(bid: str, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Not found")
    if not _is_participant(user, b):
        raise HTTPException(403, "Not a participant")
    if user["role"] == "driver":
        return _mask_for_driver(b)
    return b


@router.post("/bookings/{bid}/status")
async def update_status(bid: str, status: str, otp: Optional[str] = None, user=Depends(current_user)):
    """Driver-driven status transitions.

    - `in_transit`  → requires the **pickup** OTP (from the shipper at pickup).
    - `delivered`   → requires the **delivery** OTP (from the shipper at drop-off).

    The driver never sees these OTPs — they must ask the shipper on the ground.
    """
    b = await db.bookings.find_one({"id": bid})
    if not b:
        raise HTTPException(404, "Not found")
    if user.get("role") != "admin" and (user["role"] != "driver" or b["driver_id"] != user["id"]):
        raise HTTPException(403, "Only the assigned driver can change trip status")
    if status not in ["in_transit", "delivered"]:
        raise HTTPException(400, "Invalid status")

    # Backfill legacy bookings that pre-date the two-OTP model.
    pickup_expected = b.get("pickup_otp") or b.get("otp") or ""
    delivery_expected = b.get("delivery_otp") or b.get("otp") or ""

    update_fields: dict = {"status": status}

    if status == "in_transit":
        if not otp or otp != pickup_expected:
            raise HTTPException(400, "Invalid pickup OTP")
        update_fields["pickup_verified"] = True
        update_fields["pickup_verified_at"] = now_iso()
    elif status == "delivered":
        if not otp or otp != delivery_expected:
            raise HTTPException(400, "Invalid delivery OTP")
        update_fields["delivery_verified"] = True
        update_fields["delivery_verified_at"] = now_iso()
        # For COD, we mark it paid once the driver has confirmed cash on delivery.
        if b.get("payment_method") == "cod":
            update_fields["payment_status"] = "paid_cod"
        # Increment driver's completed_trips counter (drives the 50-trip verified badge).
        try:
            await db.users.update_one(
                {"id": b["driver_id"]},
                {"$inc": {"completed_trips": 1}, "$set": {"last_delivery_at": now_iso()}},
            )
        except Exception:
            pass

    entry = {"status": status, "at": now_iso(), "note": f"Status → {status}"}
    await db.bookings.update_one({"id": bid}, {"$set": update_fields, "$push": {"timeline": entry}})
    ship_status = "in_transit" if status == "in_transit" else "delivered"
    await db.shipments.update_one({"id": b["shipment_id"]}, {"$set": {"status": ship_status}})

    try:
        for uid in (b["customer_id"], b["driver_id"]):
            await notify_user(uid, {
                "type": "booking_status",
                "booking_id": bid,
                "status": status,
                "at": entry["at"],
            })
    except Exception:
        pass
    return {"ok": True}


@router.post("/bookings/{bid}/cancel")
async def cancel_booking(bid: str, user=Depends(current_user)):
    """Either party (customer or driver) may cancel a booking BEFORE pickup.
    Once the pickup OTP has been verified, cancellation must go through admin."""
    b = await db.bookings.find_one({"id": bid})
    if not b:
        raise HTTPException(404, "Not found")
    if not _is_participant(user, b):
        raise HTTPException(403, "Not a participant")
    if b.get("pickup_verified") and user.get("role") != "admin":
        raise HTTPException(400, "Trip already picked up — contact support to cancel")
    if b["status"] in ("delivered", "cancelled"):
        raise HTTPException(400, f"Cannot cancel a {b['status']} booking")

    entry = {"status": "cancelled", "at": now_iso(), "note": f"Cancelled by {user.get('role')}"}
    await db.bookings.update_one({"id": bid}, {"$set": {"status": "cancelled"}, "$push": {"timeline": entry}})
    # Return the shipment to the marketplace so the customer can re-post it.
    await db.shipments.update_one({"id": b["shipment_id"]}, {"$set": {"status": "cancelled"}})
    try:
        for uid in (b["customer_id"], b["driver_id"]):
            await notify_user(uid, {"type": "booking_cancelled", "booking_id": bid, "at": entry["at"]})
    except Exception:
        pass
    return {"ok": True}
