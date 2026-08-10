from fastapi import APIRouter, HTTPException, Depends
from deps import db, current_user

router = APIRouter(tags=["earnings"])


@router.get("/earnings/summary")
async def earnings(user=Depends(current_user)):
    if user["role"] != "driver":
        raise HTTPException(403, "Drivers only")
    pipeline = [
        {"$match": {"driver_id": user["id"], "status": "delivered"}},
        {"$group": {"_id": None, "total": {"$sum": "$price_inr"}, "trips": {"$sum": 1}}},
    ]
    agg = await db.bookings.aggregate(pipeline).to_list(1)
    total = agg[0]["total"] if agg else 0
    trips = agg[0]["trips"] if agg else 0
    active = await db.bookings.count_documents({"driver_id": user["id"], "status": {"$in": ["confirmed", "in_transit"]}})
    return {"total_earned_inr": total, "trips_completed": trips, "active_trips": active}
