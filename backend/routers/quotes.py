from fastapi import APIRouter, HTTPException, Depends
import uuid
from deps import db, current_user, now_iso, truck_subscription_status
from models import QuoteIn
from routers.notifications import notify_user

router = APIRouter(tags=["quotes"])


@router.post("/quotes")
async def submit_quote(body: QuoteIn, user=Depends(current_user)):
    if user["role"] != "driver":
        raise HTTPException(403, "Drivers only")
    s = await db.shipments.find_one({"id": body.shipment_id})
    if not s or s["status"] != "open":
        raise HTTPException(400, "Shipment unavailable")
    t = await db.trucks.find_one({"id": body.truck_id, "owner_id": user["id"]}, {"_id": 0})
    if not t:
        raise HTTPException(400, "Truck not yours")
    if t.get("banned"):
        raise HTTPException(403, {
            "code": "vehicle_banned",
            "message": "This vehicle has been banned. Contact support.",
        })
    if t.get("verification_status") != "approved":
        raise HTTPException(400, "Truck must be approved by admin before you can submit quotes")
    st = await truck_subscription_status(body.truck_id)
    if not st["active"]:
        raise HTTPException(status_code=402, detail={
            "code": "subscription_required",
            "message": "Your bidding subscription is expired. Renew to submit quotes.",
            "truck_id": body.truck_id,
        })
    # Anti-fake-bidding: driver must not exceed 1 quote per shipment.
    already = await db.quotes.find_one({"shipment_id": body.shipment_id, "driver_id": user["id"]})
    if already:
        raise HTTPException(409, "You have already submitted a quote for this shipment")
    doc = {
        "id": str(uuid.uuid4()),
        "shipment_id": body.shipment_id,
        "driver_id": user["id"],
        "driver_name": user["name"],
        "driver_phone": user["phone"],
        "truck_id": body.truck_id,
        "truck_snapshot": {
            "reg_number": t["reg_number"],
            "truck_type": t["truck_type"],
            "body_type": t["body_type"],
            "load_capacity_kg": t["load_capacity_kg"],
        },
        "price_inr": body.price_inr,
        "eta_hours": body.eta_hours,
        "note": body.note,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.quotes.insert_one(doc)
    doc.pop("_id", None)
    # Notify the shipment owner about the new quote.
    try:
        await notify_user(s["customer_id"], {
            "type": "new_quote",
            "shipment_id": s["id"],
            "quote_id": doc["id"],
            "driver_name": user["name"],
            "price_inr": doc["price_inr"],
            "at": doc["created_at"],
        })
    except Exception:
        pass
    return doc


@router.get("/quotes/shipment/{sid}")
async def list_quotes(sid: str, user=Depends(current_user)):
    s = await db.shipments.find_one({"id": sid}, {"_id": 0, "photos": 0})
    if not s:
        raise HTTPException(404, "Shipment not found")
    role = user.get("role")
    if role == "admin" or s["customer_id"] == user["id"]:
        # Owner customer or admin sees every competing quote with full detail.
        items = await db.quotes.find({"shipment_id": sid}, {"_id": 0}).sort("price_inr", 1).to_list(100)
        return items
    if role == "driver":
        # Driver sees:
        #  - their own quote in full detail
        #  - competing quotes as anonymized amount + eta (no driver PII)
        all_items = await db.quotes.find({"shipment_id": sid}, {"_id": 0}).sort("price_inr", 1).to_list(100)
        out = []
        for q in all_items:
            if q.get("driver_id") == user["id"]:
                q["is_mine"] = True
                out.append(q)
            else:
                out.append({
                    "id": q["id"],
                    "shipment_id": q["shipment_id"],
                    "price_inr": q["price_inr"],
                    "eta_hours": q["eta_hours"],
                    "status": q.get("status", "pending"),
                    "created_at": q.get("created_at"),
                    "is_mine": False,
                    "driver_name": "Competing operator",  # anonymized
                })
        return out
    raise HTTPException(403, "Not authorized")


@router.get("/quotes/mine")
async def my_quotes(user=Depends(current_user)):
    return await db.quotes.find({"driver_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
