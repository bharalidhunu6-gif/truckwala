"""Shipper-filed complaints against drivers/vehicles.

Complaints surface in the admin panel next to the offending vehicle number
so admins can review, ban the vehicle, or dismiss.
"""
from fastapi import APIRouter, HTTPException, Depends
import uuid
from deps import db, current_user, now_iso
from models import ComplaintIn

router = APIRouter(tags=["complaints"])


@router.post("/complaints")
async def file_complaint(body: ComplaintIn, user=Depends(current_user)):
    if user["role"] != "customer":
        raise HTTPException(403, "Only shippers can file complaints")
    b = await db.bookings.find_one({"id": body.booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if b["customer_id"] != user["id"]:
        raise HTTPException(403, "Not your booking")
    # Snapshot the vehicle/driver so admins have full context even if the
    # underlying records change later.
    truck = await db.trucks.find_one({"id": b.get("truck_id")}, {"_id": 0, "vehicle_photo": 0, "rc_photo": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "booking_id": b["id"],
        "shipment_id": b.get("shipment_id"),
        "customer_id": user["id"],
        "customer_name": user.get("name"),
        "driver_id": b.get("driver_id"),
        "driver_name": b.get("driver_name"),
        "truck_id": b.get("truck_id"),
        "reg_number": (truck or {}).get("reg_number") or (b.get("truck_snapshot") or {}).get("reg_number"),
        "subject": body.subject or "Complaint",
        "message": body.message,
        "status": "open",     # open | resolved | dismissed
        "resolution": None,
        "resolved_by": None,
        "resolved_at": None,
        "created_at": now_iso(),
    }
    await db.complaints.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/complaints/mine")
async def my_complaints(user=Depends(current_user)):
    q = {"customer_id": user["id"]} if user["role"] == "customer" else {"driver_id": user["id"]}
    return await db.complaints.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
