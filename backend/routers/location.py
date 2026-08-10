from fastapi import APIRouter, HTTPException, Depends
from deps import db, current_user, now_iso
from models import LocationIn

router = APIRouter(tags=["location"])


@router.post("/bookings/{bid}/location")
async def update_location(bid: str, body: LocationIn, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": bid})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] != "driver" or b["driver_id"] != user["id"]:
        raise HTTPException(403, "Only the assigned driver can share location")
    if b["status"] not in ("confirmed", "in_transit"):
        raise HTTPException(400, "Trip not active")
    entry = {"lat": body.lat, "lng": body.lng, "at": now_iso()}
    await db.bookings.update_one(
        {"id": bid},
        {
            "$set": {
                "current_lat": body.lat,
                "current_lng": body.lng,
                "location_updated_at": entry["at"],
            },
            "$push": {"location_history": {"$each": [entry], "$slice": -100}},
        },
    )
    return {"ok": True, "at": entry["at"]}


@router.get("/bookings/{bid}/location")
async def get_location(bid: str, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["id"] not in (b["customer_id"], b["driver_id"]) and user.get("role") != "admin":
        raise HTTPException(403, "Not authorized")
    return {
        "current_lat": b.get("current_lat"),
        "current_lng": b.get("current_lng"),
        "location_updated_at": b.get("location_updated_at"),
    }
