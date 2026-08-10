"""Shared dependencies: env, mongo client, JWT auth, RBAC, helpers."""
from fastapi import HTTPException, Depends, Header
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
import os
import math
import bcrypt
import jwt as pyjwt
import razorpay

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = os.environ.get("JWT_ALGO", "HS256")
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower() or None
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "") or None
MAX_PHOTO_COUNT = 5
MAX_PHOTO_BYTES = 2_000_000  # ~2MB per image (base64-encoded string length approx)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


def is_mock_pay() -> bool:
    return (
        not RAZORPAY_KEY_ID
        or not RAZORPAY_KEY_SECRET
        or "PLACEHOLDER" in RAZORPAY_KEY_ID
        or "PLACEHOLDER" in RAZORPAY_KEY_SECRET
    )


try:
    rzp_client = None if is_mock_pay() else razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
except Exception:
    rzp_client = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def current_admin(user=Depends(current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def haversine_km(a_lat, a_lng, b_lat, b_lng) -> float:
    R = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lng - a_lng)
    la1 = math.radians(a_lat)
    la2 = math.radians(b_lat)
    x = math.sin(d_lat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(d_lon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


TRUCK_TYPES = [
    "Mini Truck", "Pickup Van", "Tata Ace", "Bolero Pickup", "Mahindra Jeeto",
    "Eicher", "LCV", "HCV", "14 Feet Truck", "17 Feet Truck", "20 Feet Truck",
    "22 Feet Truck", "Trailer", "Container", "Refrigerated Truck", "Tanker",
    "Dumper", "Crane",
]
GOODS_CATEGORIES = [
    "Household shifting", "Furniture", "Electronics", "Industrial machinery",
    "Construction materials", "Cement", "Steel", "Bricks", "Sand",
    "Agricultural products", "Fruits", "Vegetables", "Milk", "FMCG",
    "Pharmaceuticals", "Chemicals", "Textiles", "Automobile parts",
    "Heavy equipment", "Cold-chain products", "Parcels", "Retail goods", "Other",
]
BODY_TYPES = ["Open", "Closed Container", "Trailer", "Tanker", "Refrigerated", "Flatbed"]


# ------- Subscription tiers (INR / month) -------
# Truck Wala runs on a driver-side subscription: drivers can only bid
# on shipments if they have an ACTIVE subscription for the truck they're
# quoting from. Two tiers based on GVW / load capacity:
SUBSCRIPTION_TIERS = [
    {
        "id": "tier_small",
        "title": "Small Commercial (₹499/mo)",
        "amount_inr": 499,
        "max_gvw_kg": 1500,
        # Small trucks only see shipments whose pickup is within this many km.
        "max_radius_km": 20,
        "examples": ["Tata Ace", "Mahindra Jeeto", "Bolero Pickup", "Tata Yodha", "Maruti Carry"],
        "description": "For pickups up to 1.5 T GVW · 20 km radius",
    },
    {
        "id": "tier_large",
        "title": "Large Commercial (₹999/mo)",
        "amount_inr": 999,
        "max_gvw_kg": None,   # anything ≥ 1500 kg
        "max_radius_km": 100,
        "examples": ["Eicher 14ft", "Ashok Leyland Dost", "Bharat Benz 3T+", "17ft/22ft trucks"],
        "description": "For trucks 1.5 T GVW and above · 100 km radius",
    },
]


def tier_for(capacity_kg: float) -> dict:
    """Return the subscription tier for a given GVW / load capacity."""
    if capacity_kg is None:
        return SUBSCRIPTION_TIERS[-1]
    return SUBSCRIPTION_TIERS[0] if float(capacity_kg) < 1500 else SUBSCRIPTION_TIERS[-1]


async def driver_search_context(user_id: str) -> dict:
    """Compute the effective load-search parameters for a driver:

    - `max_radius_km`: the LARGEST radius across all their approved,
      non-banned trucks (so a driver who owns both a Tata Ace *and* a
      14ft truck gets the 100 km horizon; a driver who owns only small
      trucks gets the 20 km horizon).
    - `truck_types`: the set of truck models the driver has registered.
      Used to filter shipments to only those requesting a matching model.
    """
    truck_types: list[str] = []
    max_radius = 0
    async for t in db.trucks.find(
        {"owner_id": user_id, "verification_status": "approved", "banned": {"$ne": True}},
        {"_id": 0, "truck_type": 1, "load_capacity_kg": 1},
    ):
        tt = (t.get("truck_type") or "").strip()
        if tt and tt not in truck_types:
            truck_types.append(tt)
        r = int(tier_for(t.get("load_capacity_kg") or 0)["max_radius_km"])
        if r > max_radius:
            max_radius = r
    # Sensible fallback if the driver hasn't registered anything yet.
    return {
        "truck_types": truck_types,
        "max_radius_km": max_radius or 20,
    }


async def truck_subscription_status(truck_id: str) -> dict:
    """Return {active, expires_at, sub}. `active=True` means the driver
    is currently allowed to bid on shipments with this truck."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    sub = await db.subscriptions.find_one(
        {"truck_id": truck_id, "status": "active"},
        {"_id": 0},
        sort=[("expires_at", -1)],
    )
    active = False
    exp = None
    if sub:
        exp_raw = sub.get("expires_at")
        if exp_raw:
            exp = exp_raw if exp_raw.tzinfo else exp_raw.replace(tzinfo=timezone.utc)
            active = exp > now
    return {"active": active, "expires_at": exp.isoformat() if exp else None, "sub": sub}
