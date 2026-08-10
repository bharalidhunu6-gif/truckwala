from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
import uuid
import jwt as pyjwt
from deps import db, current_user, now_iso, JWT_SECRET, JWT_ALGO
from models import ChatIn

router = APIRouter(tags=["chat"])

# room -> set of active WebSockets
_chat_rooms: dict = {}


async def _authorize_chat(user: dict, booking_id: str):
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["id"] not in (b["customer_id"], b["driver_id"]) and user.get("role") != "admin":
        raise HTTPException(403, "Not a participant")
    return b


@router.get("/chat/{booking_id}/messages")
async def chat_history(booking_id: str, user=Depends(current_user)):
    await _authorize_chat(user, booking_id)
    return await db.messages.find({"booking_id": booking_id}, {"_id": 0}).sort("at", 1).to_list(500)


@router.post("/chat/{booking_id}/messages")
async def chat_send(booking_id: str, body: ChatIn, user=Depends(current_user)):
    await _authorize_chat(user, booking_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Empty message")
    msg = {
        "id": str(uuid.uuid4()),
        "booking_id": booking_id,
        "sender_id": user["id"],
        "sender_name": user["name"],
        "sender_role": user["role"],
        "text": text[:2000],
        "at": now_iso(),
    }
    await db.messages.insert_one(dict(msg))
    room = _chat_rooms.get(booking_id, set())
    dead = []
    for ws in list(room):
        try:
            await ws.send_json({"type": "message", **msg})
        except Exception:
            dead.append(ws)
    for d in dead:
        room.discard(d)
    return msg


async def chat_websocket(websocket: WebSocket, booking_id: str, token: str = ""):
    """Actual WebSocket handler — mounted directly on the FastAPI app in server.py."""
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        await websocket.close(code=4401)
        return
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        await websocket.close(code=4401)
        return
    b = await db.bookings.find_one({"id": booking_id})
    if not b or (user["id"] not in (b["customer_id"], b["driver_id"]) and user.get("role") != "admin"):
        await websocket.close(code=4403)
        return

    await websocket.accept()
    room = _chat_rooms.setdefault(booking_id, set())
    room.add(websocket)
    try:
        history = await db.messages.find({"booking_id": booking_id}, {"_id": 0}).sort("at", 1).to_list(200)
        await websocket.send_json({"type": "history", "messages": history})
        while True:
            data = await websocket.receive_json()
            text = str(data.get("text", "")).strip()
            if not text:
                continue
            msg = {
                "id": str(uuid.uuid4()),
                "booking_id": booking_id,
                "sender_id": user["id"],
                "sender_name": user["name"],
                "sender_role": user["role"],
                "text": text[:2000],
                "at": now_iso(),
            }
            await db.messages.insert_one(dict(msg))
            payload_out = {"type": "message", **msg}
            for ws in list(room):
                try:
                    await ws.send_json(payload_out)
                except Exception:
                    room.discard(ws)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.discard(websocket)
