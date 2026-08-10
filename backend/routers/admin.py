from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from deps import db, current_admin, now_iso, tier_for, truck_subscription_status
from models import RejectIn, ComplaintResolveIn

router = APIRouter(tags=["admin"])


async def _augment_truck(t: dict) -> dict:
    st = await truck_subscription_status(t["id"])
    owner = await db.users.find_one({"id": t.get("owner_id")}, {"_id": 0, "completed_trips": 1, "phone": 1, "email": 1, "name": 1})
    complaints_count = await db.complaints.count_documents({"truck_id": t["id"]})
    open_complaints = await db.complaints.count_documents({"truck_id": t["id"], "status": "open"})
    trips = int((owner or {}).get("completed_trips", 0) or 0)
    t["owner_phone"] = (owner or {}).get("phone")
    t["owner_email"] = (owner or {}).get("email")
    t["subscription_active"] = st["active"]
    t["subscription_expires_at"] = st["expires_at"]
    t["subscription"] = st["sub"]
    t["subscription_tier"] = tier_for(t.get("load_capacity_kg") or 0)
    t["completed_trips"] = trips
    t["verified_badge"] = trips >= 50 and t.get("verification_status") == "approved"
    t["complaints_total"] = complaints_count
    t["complaints_open"] = open_complaints
    return t


@router.get("/admin/trucks")
async def admin_list_trucks(status: Optional[str] = None, q: Optional[str] = None, _admin=Depends(current_admin)):
    query: dict = {}
    if status:
        query["verification_status"] = status
    if q:
        # Case-insensitive substring search over registration number and owner name.
        query["$or"] = [
            {"reg_number": {"$regex": q.strip(), "$options": "i"}},
            {"owner_name": {"$regex": q.strip(), "$options": "i"}},
        ]
    items = await db.trucks.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await _augment_truck(t) for t in items]


@router.get("/admin/trucks/{truck_id}")
async def admin_truck_detail(truck_id: str, _admin=Depends(current_admin)):
    t = await db.trucks.find_one({"id": truck_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Truck not found")
    return await _augment_truck(t)


@router.get("/admin/stats")
async def admin_stats(_admin=Depends(current_admin)):
    pending = await db.trucks.count_documents({"verification_status": "pending"})
    approved = await db.trucks.count_documents({"verification_status": "approved"})
    rejected = await db.trucks.count_documents({"verification_status": "rejected"})
    banned = await db.trucks.count_documents({"banned": True})
    total_users = await db.users.count_documents({})
    total_bookings = await db.bookings.count_documents({})
    open_complaints = await db.complaints.count_documents({"status": "open"})
    active_subs = await db.subscriptions.count_documents({"status": "active"})
    return {
        "trucks_pending": pending,
        "trucks_approved": approved,
        "trucks_rejected": rejected,
        "trucks_banned": banned,
        "total_users": total_users,
        "total_bookings": total_bookings,
        "open_complaints": open_complaints,
        "active_subscriptions": active_subs,
    }


@router.post("/admin/trucks/{truck_id}/verify")
async def admin_verify_truck(truck_id: str, admin=Depends(current_admin)):
    r = await db.trucks.update_one(
        {"id": truck_id},
        {"$set": {
            "verification_status": "approved",
            "verified_at": now_iso(),
            "verified_by": admin["id"],
            "rejection_reason": None,
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Truck not found")
    return await _augment_truck(await db.trucks.find_one({"id": truck_id}, {"_id": 0}))


@router.post("/admin/trucks/{truck_id}/reject")
async def admin_reject_truck(truck_id: str, body: RejectIn, admin=Depends(current_admin)):
    r = await db.trucks.update_one(
        {"id": truck_id},
        {"$set": {
            "verification_status": "rejected",
            "verified_at": now_iso(),
            "verified_by": admin["id"],
            "rejection_reason": body.reason or "Rejected by admin",
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Truck not found")
    return await _augment_truck(await db.trucks.find_one({"id": truck_id}, {"_id": 0}))


@router.post("/admin/trucks/{truck_id}/ban")
async def admin_ban_truck(truck_id: str, body: RejectIn, admin=Depends(current_admin)):
    """Ban a vehicle. Also flips it offline immediately so it stops receiving traffic."""
    r = await db.trucks.update_one(
        {"id": truck_id},
        {"$set": {
            "banned": True,
            "ban_reason": body.reason or "Banned by admin",
            "banned_at": now_iso(),
            "banned_by": admin["id"],
            "online": False,
            "online_device_id": None,
            "online_since": None,
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Truck not found")
    return await _augment_truck(await db.trucks.find_one({"id": truck_id}, {"_id": 0}))


@router.post("/admin/trucks/{truck_id}/unban")
async def admin_unban_truck(truck_id: str, admin=Depends(current_admin)):
    r = await db.trucks.update_one(
        {"id": truck_id},
        {"$set": {"banned": False, "ban_reason": None, "banned_at": None, "banned_by": None}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Truck not found")
    return await _augment_truck(await db.trucks.find_one({"id": truck_id}, {"_id": 0}))


@router.delete("/admin/trucks/{truck_id}")
async def admin_delete_truck(truck_id: str, _admin=Depends(current_admin)):
    """Hard-delete a truck. Related subscriptions & complaints are preserved
    for audit; we don't cascade."""
    r = await db.trucks.delete_one({"id": truck_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Truck not found")
    return {"ok": True}


# ------- Subscriptions & complaints (admin views) -------

@router.get("/admin/subscriptions")
async def admin_list_subscriptions(status: Optional[str] = None, q: Optional[str] = None, _admin=Depends(current_admin)):
    query: dict = {}
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"reg_number": {"$regex": q.strip(), "$options": "i"}},
            {"driver_name": {"$regex": q.strip(), "$options": "i"}},
            {"razorpay_payment_id": {"$regex": q.strip(), "$options": "i"}},
            {"razorpay_order_id": {"$regex": q.strip(), "$options": "i"}},
        ]
    return await db.subscriptions.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/admin/complaints")
async def admin_list_complaints(status: Optional[str] = None, q: Optional[str] = None, _admin=Depends(current_admin)):
    query: dict = {}
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"reg_number": {"$regex": q.strip(), "$options": "i"}},
            {"driver_name": {"$regex": q.strip(), "$options": "i"}},
            {"customer_name": {"$regex": q.strip(), "$options": "i"}},
            {"subject": {"$regex": q.strip(), "$options": "i"}},
        ]
    return await db.complaints.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/admin/complaints/{cid}/resolve")
async def admin_resolve_complaint(cid: str, body: ComplaintResolveIn, admin=Depends(current_admin)):
    r = await db.complaints.update_one(
        {"id": cid},
        {"$set": {
            "status": "resolved" if body.action == "resolve" else "dismissed",
            "resolution": body.resolution or "",
            "resolved_by": admin["id"],
            "resolved_at": now_iso(),
        }},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Complaint not found")
    return await db.complaints.find_one({"id": cid}, {"_id": 0})
