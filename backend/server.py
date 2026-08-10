"""Truck Wala API — main app entry.

Owns:
- FastAPI app instance
- CORS + logging middleware
- Router mounting under /api
- WebSocket route for chat (raw ws, not APIRouter)
- Startup hooks (admin seed, truck migration)
- Shutdown hook

All business logic lives under `routers/*` and `deps.py`.
"""
from fastapi import FastAPI, APIRouter, WebSocket
from starlette.middleware.cors import CORSMiddleware
import logging
import uuid

from deps import db, client, hash_password, now_iso, ADMIN_EMAIL, ADMIN_PASSWORD
from routers import (
    auth, catalog, trucks, shipments, quotes, bookings,
    location, ratings, earnings, pay, chat, admin, notifications, users,
    subscriptions, complaints,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

app = FastAPI(title="Truck Wala API")

# Single /api prefix router that aggregates every sub-router
api = APIRouter(prefix="/api")
for r in (
    auth.router, catalog.router, trucks.router, shipments.router,
    quotes.router, bookings.router, location.router, ratings.router,
    earnings.router, pay.router, chat.router, admin.router,
    notifications.router, users.router,
    subscriptions.router, complaints.router,
):
    api.include_router(r)


@api.get("/")
async def root():
    return {"service": "Truck Wala API", "status": "ok"}


app.include_router(api)

# WebSocket lives on the app directly (not APIRouter) so we can control the path exactly.
@app.websocket("/api/ws/chat/{booking_id}")
async def _chat_ws(websocket: WebSocket, booking_id: str, token: str = ""):
    await chat.chat_websocket(websocket, booking_id, token)


@app.websocket("/api/ws/notifications")
async def _notifications_ws(websocket: WebSocket, token: str = ""):
    await notifications.notifications_websocket(websocket, token)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Startup hooks ----------
@app.on_event("startup")
async def ensure_indexes():
    """Defense-in-depth + TTL for auto-expiring pending shipments and OTPs."""
    try:
        await db.ratings.create_index([("booking_id", 1), ("rater_id", 1)], unique=True)
    except Exception:
        pass
    # Auto-delete OPEN shipments after their expires_at timestamp (72 h from creation).
    # Bookings clear `expires_at` so booked shipments survive.
    try:
        await db.shipments.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        pass
    # OTP codes cleaned up automatically after they expire.
    try:
        await db.otps.create_index("expires_at", expireAfterSeconds=0)
    except Exception:
        pass
    # Unique registration number across ALL trucks (case-insensitive by normalization at write-time).
    try:
        await db.trucks.create_index("reg_number", unique=True)
    except Exception:
        pass
    # Index subscriptions by truck + expiry for fast active-status lookups.
    try:
        await db.subscriptions.create_index([("truck_id", 1), ("expires_at", -1)])
    except Exception:
        pass


@app.on_event("startup")
async def seed_admin():
    """Seed a bootstrap admin ONLY when ADMIN_EMAIL and ADMIN_PASSWORD are
    set in env AND no admin with that email already exists. We NEVER overwrite
    an existing admin's password — operators must rotate out-of-band."""
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        logging.info("Admin seeding skipped — ADMIN_EMAIL / ADMIN_PASSWORD not configured")
        return
    if await db.users.find_one({"email": ADMIN_EMAIL}):
        return
    await db.users.insert_one({
        "id": str(uuid.uuid4()),
        "name": "Truck Wala Admin",
        "email": ADMIN_EMAIL,
        "phone": "+910000000000",
        "role": "admin",
        "password_hash": hash_password(ADMIN_PASSWORD),
        "verified": True,
        "avg_rating": 0.0,
        "created_at": now_iso(),
    })
    logging.info("Bootstrap admin '%s' created", ADMIN_EMAIL)


@app.on_event("startup")
async def migrate_trucks():
    """Idempotently backfill verification_status='approved' on legacy trucks."""
    res = await db.trucks.update_many(
        {"verification_status": {"$exists": False}},
        {"$set": {
            "verification_status": "approved",
            "verified_at": now_iso(),
            "verified_by": "system-migration",
            "rejection_reason": None,
        }},
    )
    if res.modified_count:
        logging.info("Backfilled verification_status on %s legacy trucks", res.modified_count)


@app.on_event("shutdown")
async def shutdown():
    client.close()
