from fastapi import APIRouter, HTTPException, Depends
from deps import db, current_user, now_iso
from models import LocationIn

router = APIRouter(tags=["users"])


@router.post("/users/me/location")
async def update_my_location(body: LocationIn, user=Depends(current_user)):
    """Store the caller's most recent GPS on their user doc. Drivers use this
    so the 100 km shipment filter can auto-locate them even without an active
    booking."""
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "current_lat": body.lat,
            "current_lng": body.lng,
            "location_updated_at": now_iso(),
        }},
    )
    return {"ok": True, "at": now_iso()}


@router.get("/users/me/location")
async def my_location(user=Depends(current_user)):
    u = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, "current_lat": 1, "current_lng": 1, "location_updated_at": 1},
    ) or {}
    return {
        "current_lat": u.get("current_lat"),
        "current_lng": u.get("current_lng"),
        "location_updated_at": u.get("location_updated_at"),
    }
