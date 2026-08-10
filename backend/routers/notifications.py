"""Real-time notifications router.

Each authenticated user can open ONE (or more) WebSocket(s) at
`/api/ws/notifications?token=<jwt>`.  The `notify_user(user_id, payload)`
helper is imported by other routers to broadcast events (new quote,
booking accepted, new nearby load, status changes, etc.).
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import jwt as pyjwt
from typing import Dict, Set, Any
from deps import db, JWT_SECRET, JWT_ALGO, now_iso as _now_iso

router = APIRouter(tags=["notifications"])

# user_id -> set of active WebSockets
_user_rooms: Dict[str, Set[WebSocket]] = {}


async def notify_user(user_id: str, payload: dict) -> None:
    """Fan-out helper; safe to call from any router. Silently no-ops if the
    user has no connected sockets."""
    room = _user_rooms.get(user_id)
    if not room:
        return
    dead = []
    for ws in list(room):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for d in dead:
        room.discard(d)


async def notifications_websocket(websocket: WebSocket, token: str = ""):
    """Mounted directly on the FastAPI app from server.py."""
    # Must accept() BEFORE close() to deliver a WebSocket-level close code (4401)
    # to the client. Closing pre-accept in ASGI yields an HTTP 403 handshake
    # rejection with NO WS close code — which breaks the client contract.
    await websocket.accept()
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        await websocket.close(code=4401)
        return
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        await websocket.close(code=4401)
        return

    uid = user["id"]
    room = _user_rooms.setdefault(uid, set())
    room.add(websocket)
    # Mark online now that they have a live socket.
    try:
        await db.users.update_one({"id": uid}, {"$set": {"is_online": True, "last_seen_at": _now_iso()}})
    except Exception:
        pass
    try:
        await websocket.send_json({"type": "ready", "user_id": uid})
        while True:
            # Keep-alive: we don't require client messages, but drain them to
            # detect disconnects promptly.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.discard(websocket)
        # Only flip to offline if this was their LAST live socket.
        if not room:
            try:
                await db.users.update_one({"id": uid}, {"$set": {"is_online": False, "last_seen_at": _now_iso()}})
            except Exception:
                pass
