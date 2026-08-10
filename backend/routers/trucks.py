from fastapi import APIRouter, HTTPException, Depends
import uuid
from deps import db, current_user, now_iso, tier_for, truck_subscription_status
from models import TruckIn, TruckOnlineIn

router = APIRouter(tags=["trucks"])


async def _enrich(t: dict) -> dict:
    """Attach subscription + verified-badge state to a truck dict for the client."""
    st = await truck_subscription_status(t["id"])
    trips = 0
    owner = await db.users.find_one({"id": t["owner_id"]}, {"_id": 0, "completed_trips": 1})
    if owner:
        trips = int(owner.get("completed_trips", 0) or 0)
    t["subscription_active"] = st["active"]
    t["subscription_expires_at"] = st["expires_at"]
    t["subscription_tier"] = tier_for(t.get("load_capacity_kg") or 0)
    t["completed_trips"] = trips
    t["verified_badge"] = trips >= 50 and t.get("verification_status") == "approved"
    return t


@router.post("/trucks")
async def create_truck(body: TruckIn, user=Depends(current_user)):
    if user["role"] != "driver":
        raise HTTPException(403, "Only drivers can register trucks")
    # Global uniqueness on registration number (case-insensitive, whitespace-normalized).
    existing = await db.trucks.find_one({"reg_number": body.reg_number}, {"owner_id": 1, "owner_name": 1})
    if existing:
        mine = existing.get("owner_id") == user["id"]
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_reg_number",
                "message": (
                    "This vehicle number is already registered on your account."
                    if mine else
                    "This vehicle number is already registered by another owner. "
                    "If you believe this is a mistake, please contact support."
                ),
            },
        )
    doc = {
        "id": str(uuid.uuid4()),
        "owner_id": user["id"],
        "owner_name": user["name"],
        **body.dict(),
        "active": True,
        "banned": False,
        "verification_status": "pending",
        "verified_at": None,
        "verified_by": None,
        "rejection_reason": None,
        "online": False,
        "online_device_id": None,
        "online_since": None,
        "created_at": now_iso(),
    }
    await db.trucks.insert_one(doc)
    doc.pop("_id", None)
    return await _enrich(doc)


@router.get("/trucks/mine")
async def my_trucks(user=Depends(current_user)):
    items = await db.trucks.find({"owner_id": user["id"]}, {"_id": 0}).to_list(200)
    return [await _enrich(t) for t in items]


@router.delete("/trucks/{truck_id}")
async def delete_truck(truck_id: str, user=Depends(current_user)):
    r = await db.trucks.delete_one({"id": truck_id, "owner_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ------- Online / Offline (per-device) -------

@router.post("/trucks/{truck_id}/online")
async def set_online(truck_id: str, body: TruckOnlineIn, user=Depends(current_user)):
    """Mark this truck online for the caller's device.

    Rules:
    - Truck must belong to caller and be approved.
    - Subscription must be active.
    - Truck must not be banned.
    - If ANOTHER device currently has this truck online, refuse (409).
    - If this device currently has ANOTHER truck of the same owner online,
      flip the previous truck offline first (one truck per device).
    """
    if not body.device_id or len(body.device_id) < 6:
        raise HTTPException(400, "Missing device_id")
    t = await db.trucks.find_one({"id": truck_id, "owner_id": user["id"]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Truck not found")
    if t.get("banned"):
        raise HTTPException(403, "This vehicle has been banned by admin")
    if t.get("verification_status") != "approved":
        raise HTTPException(400, "Vehicle must be admin-approved before going online")
    st = await truck_subscription_status(truck_id)
    if not st["active"]:
        raise HTTPException(402, {
            "code": "subscription_required",
            "message": "Subscription expired or not started. Please subscribe to accept bookings.",
        })
    # Refuse if some OTHER device holds this truck online.
    if t.get("online") and t.get("online_device_id") and t["online_device_id"] != body.device_id:
        raise HTTPException(409, {
            "code": "in_use_elsewhere",
            "message": "This vehicle is already active on another device. Log the other device out or pick a different vehicle.",
        })
    # Flip whichever other truck this device had online → offline.
    await db.trucks.update_many(
        {"owner_id": user["id"], "online_device_id": body.device_id, "id": {"$ne": truck_id}},
        {"$set": {"online": False, "online_device_id": None, "online_since": None}},
    )
    await db.trucks.update_one(
        {"id": truck_id},
        {"$set": {"online": True, "online_device_id": body.device_id, "online_since": now_iso()}},
    )
    fresh = await db.trucks.find_one({"id": truck_id}, {"_id": 0})
    return await _enrich(fresh)


@router.post("/trucks/{truck_id}/offline")
async def set_offline(truck_id: str, user=Depends(current_user)):
    r = await db.trucks.update_one(
        {"id": truck_id, "owner_id": user["id"]},
        {"$set": {"online": False, "online_device_id": None, "online_since": None}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Truck not found")
    fresh = await db.trucks.find_one({"id": truck_id}, {"_id": 0})
    return await _enrich(fresh)
