from fastapi import APIRouter, HTTPException, Depends
import uuid
from deps import db, current_user, now_iso
from models import RatingIn

router = APIRouter(tags=["ratings"])


@router.post("/ratings")
async def rate(body: RatingIn, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": body.booking_id})
    if not b:
        raise HTTPException(404, "Booking not found")
    if b["status"] != "delivered":
        raise HTTPException(400, "Rate after delivery only")
    # Only the booking's participants may rate, and each rater once per booking.
    if user["id"] == b["customer_id"]:
        rated_id = b["driver_id"]
    elif user["id"] == b["driver_id"]:
        rated_id = b["customer_id"]
    else:
        raise HTTPException(403, "Not a participant of this booking")
    if await db.ratings.find_one({"booking_id": body.booking_id, "rater_id": user["id"]}):
        raise HTTPException(409, "You have already rated this booking")
    doc = {
        "id": str(uuid.uuid4()),
        "booking_id": body.booking_id,
        "rater_id": user["id"],
        "rater_name": user["name"],
        "rated_user_id": rated_id,
        "rating": max(1, min(5, body.rating)),
        "review": body.review[:1000],
        "created_at": now_iso(),
    }
    await db.ratings.insert_one(doc)
    agg = await db.ratings.aggregate(
        [{"$match": {"rated_user_id": rated_id}}, {"$group": {"_id": None, "avg": {"$avg": "$rating"}}}]
    ).to_list(1)
    if agg:
        await db.users.update_one({"id": rated_id}, {"$set": {"avg_rating": round(agg[0]["avg"], 2)}})
    doc.pop("_id", None)
    return doc


@router.get("/ratings/user/{uid}")
async def user_ratings(uid: str):
    return await db.ratings.find({"rated_user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(50)
