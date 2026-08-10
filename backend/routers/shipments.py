from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
from deps import db, current_user, now_iso, haversine_km, driver_search_context, tier_for
from models import ShipmentIn
from routers.notifications import notify_user

router = APIRouter(tags=["shipments"])


@router.post("/shipments")
async def create_shipment(body: ShipmentIn, user=Depends(current_user)):
    if user["role"] != "customer":
        raise HTTPException(403, "Only customers can post shipments")
    dist = haversine_km(body.pickup_lat, body.pickup_lng, body.drop_lat, body.drop_lng)
    doc = {
        "id": str(uuid.uuid4()),
        "customer_id": user["id"],
        "customer_name": user["name"],
        "customer_phone": user["phone"],
        **body.dict(),
        "distance_km": round(dist, 2),
        "status": "open",
        "created_at": now_iso(),
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=24),
    }
    await db.shipments.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("expires_at", None)

    # Push a "new_load" ping to matching drivers only:
    #   - lat/lng is within THEIR tier radius (20 km small / 100 km large)
    #   - they've registered a truck of the same `truck_type`
    try:
        cursor = db.users.find(
            {"role": "driver", "current_lat": {"$exists": True}},
            {"_id": 0, "id": 1, "current_lat": 1, "current_lng": 1},
        )
        target_type = (body.truck_type_preferred or "").strip()
        async for d in cursor:
            if d.get("current_lat") is None:
                continue
            ctx = await driver_search_context(d["id"])
            # Truck-type must be registered by this driver (case-insensitive).
            if target_type and not any(
                (tt or "").strip().lower() == target_type.lower() for tt in ctx["truck_types"]
            ):
                continue
            km = haversine_km(d["current_lat"], d["current_lng"], body.pickup_lat, body.pickup_lng)
            if km <= ctx["max_radius_km"]:
                await notify_user(d["id"], {
                    "type": "new_load",
                    "shipment_id": doc["id"],
                    "pickup_city": doc["pickup_city"],
                    "drop_city": doc["drop_city"],
                    "distance_km": round(km, 1),
                    "truck_type": target_type,
                    "at": now_iso(),
                })
    except Exception:
        pass
    return doc


@router.get("/shipments/mine")
async def my_shipments(user=Depends(current_user)):
    q = {"customer_id": user["id"]} if user["role"] == "customer" else {"assigned_driver_id": user["id"]}
    return await db.shipments.find(q, {"_id": 0, "expires_at": 0}).sort("created_at", -1).to_list(200)


@router.get("/shipments/open")
async def open_shipments(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_km: Optional[float] = None,
    show_all_types: bool = False,
    user=Depends(current_user),
):
    """Return open shipments to a driver, filtered by:

    - **Distance**: within the driver's tier radius (or an explicit
      `radius_km` if the client insists on overriding it; the effective
      radius is still clamped to the tier maximum).
    - **Truck type**: only shipments requesting a truck the driver has
      registered. Set `show_all_types=true` to see every load in the
      radius (used by the "Browse all" toggle in the driver home).

    Returned rows include `distance_from_you_km` + the effective search
    context so the client can render "Small tier · 20 km" chips.
    """
    if user["role"] != "driver":
        raise HTTPException(403, "Drivers only")

    ctx = await driver_search_context(user["id"])
    # Effective radius = tier max, or a smaller client override.
    effective_radius = ctx["max_radius_km"]
    if radius_km is not None:
        effective_radius = min(effective_radius, float(radius_km))

    # Auto-fallback: if the driver hasn't passed lat/lng, use whatever their
    # background task last posted to /users/me/location.
    if lat is None or lng is None:
        u = await db.users.find_one(
            {"id": user["id"]},
            {"_id": 0, "current_lat": 1, "current_lng": 1},
        ) or {}
        if u.get("current_lat") is not None and u.get("current_lng") is not None:
            lat = u["current_lat"]
            lng = u["current_lng"]

    items = await db.shipments.find({"status": "open"}, {"_id": 0, "expires_at": 0}).sort("created_at", -1).to_list(500)

    def strip(s: dict) -> dict:
        s.pop("customer_phone", None)  # never expose PII to un-assigned drivers
        return s

    type_set = {(tt or "").strip().lower() for tt in ctx["truck_types"] if tt}

    def type_ok(s: dict) -> bool:
        if show_all_types:
            return True
        st = (s.get("truck_type_preferred") or "").strip().lower()
        if not st:
            return True  # shipment left it unspecified — allow all matches
        return st in type_set

    if lat is not None and lng is not None:
        filtered = []
        for s in items:
            if not type_ok(s):
                continue
            d = haversine_km(lat, lng, s["pickup_lat"], s["pickup_lng"])
            if d <= effective_radius:
                s["distance_from_you_km"] = round(d, 2)
                filtered.append(strip(s))
        filtered.sort(key=lambda x: x["distance_from_you_km"])
        # Return context alongside so the client can render a chip like
        # "Showing loads for Tata Ace within 20 km".
        return {
            "items": filtered,
            "context": {**ctx, "effective_radius_km": effective_radius, "show_all_types": show_all_types},
        }

    # No GPS at all → nearest of the driver's truck bases (best-effort).
    trucks = await db.trucks.find({"owner_id": user["id"]}, {"_id": 0}).to_list(50)
    out = []
    for s in items:
        if not type_ok(s):
            continue
        if trucks:
            dmin = min(
                haversine_km(s["pickup_lat"], s["pickup_lng"], t["base_lat"], t["base_lng"])
                for t in trucks
            )
            s["distance_from_you_km"] = round(dmin, 2)
        else:
            s["distance_from_you_km"] = None
        out.append(strip(s))
    return {
        "items": out,
        "context": {**ctx, "effective_radius_km": effective_radius, "show_all_types": show_all_types},
    }


@router.get("/shipments/{sid}")
async def get_shipment(sid: str, user=Depends(current_user)):
    s = await db.shipments.find_one({"id": sid}, {"_id": 0, "expires_at": 0})
    if not s:
        raise HTTPException(404, "Not found")
    role = user.get("role")
    is_owner = s.get("customer_id") == user["id"]
    is_assigned_driver = role == "driver" and s.get("assigned_driver_id") == user["id"]
    is_open_for_drivers = role == "driver" and s.get("status") == "open"
    if not (is_owner or role == "admin" or is_assigned_driver or is_open_for_drivers):
        raise HTTPException(403, "Not authorized")
    if role == "driver" and not is_assigned_driver:
        s.pop("customer_phone", None)
    return s
