from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
from random import randint
import uuid
import logging

from deps import (
    db,
    hash_password,
    verify_password,
    make_token,
    current_user,
    now_iso,
)

from models import (
    RegisterIn,
    LoginIn,
    TokenOut,
    OTPRequestIn,
    OTPVerifyIn,
    ForgotResetIn,
    PhoneOTPRequestIn,
    PhoneOTPVerifyIn,
)

from twilio_client import (
    load_config as twilio_load_config,
    normalize_phone,
    gen_code,
    twilio_send_verify,
    twilio_check_verify,
    twilio_send_sms,
    TwilioSendError,
)

router = APIRouter(tags=["auth"])
log = logging.getLogger(__name__)


# ============================================================
# Helpers
# ============================================================

def _gen_code() -> str:
    return f"{randint(0, 9999):04d}"


def _norm(identifier: str) -> str:
    return identifier.strip().lower()


def _phone_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=10)


# ============================================================
# EMAIL / GENERAL OTP
# ============================================================

@router.post("/auth/otp/send")
async def otp_send(body: OTPRequestIn):
    ident = _norm(body.identifier)

    code = _gen_code()

    await db.otps.insert_one({
        "id": str(uuid.uuid4()),
        "identifier": ident,
        "code": code,
        "purpose": body.purpose,
        "used": False,
        "created_at": now_iso(),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    })

    return {
        "ok": True,
        "dev_otp": code,
        "expires_in_seconds": 600,
    }


@router.post("/auth/otp/verify")
async def otp_verify(body: OTPVerifyIn):
    ident = _norm(body.identifier)

    doc = await db.otps.find_one({
        "identifier": ident,
        "code": body.code,
        "purpose": body.purpose,
        "used": False,
    })

    if not doc:
        raise HTTPException(400, "Invalid or expired code")

    exp = doc.get("expires_at")

    if exp:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)

        if exp < datetime.now(timezone.utc):
            raise HTTPException(400, "Code expired")

    await db.otps.update_one(
        {"id": doc["id"]},
        {
            "$set": {
                "used": True,
                "verified_at": now_iso(),
            }
        },
    )

    return {
        "ok": True,
        "verified": True,
    }


# ============================================================
# NORMAL REGISTER
# ============================================================

# ============================================================
# NORMAL REGISTER
# DISABLED - PHONE OTP IS REQUIRED
# ============================================================

@router.post("/auth/register", response_model=TokenOut)
async def register(body: RegisterIn):

    # Direct registration is disabled.
    # Users must create accounts through:
    # Phone -> OTP -> Verify -> Profile

    raise HTTPException(
        status_code=403,
        detail="Direct registration is disabled. Please verify your phone with OTP first."
    )
# ============================================================
# LOGIN
# ============================================================

@router.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):

    email = body.email.strip().lower()

    u = await db.users.find_one({
        "email": email
    })

    if not u:
        raise HTTPException(
            401,
            "Invalid credentials"
        )

    if not verify_password(
        body.password,
        u["password_hash"]
    ):
        raise HTTPException(
            401,
            "Invalid credentials"
        )

    u.pop("_id", None)
    u.pop("password_hash", None)

    return {
        "token": make_token(u["id"]),
        "user": u,
    }


# ============================================================
# FORGOT PASSWORD - PHONE OTP
# ============================================================

@router.post("/auth/reset-password")
async def reset_password(body: ForgotResetIn):

    phone = normalize_phone(body.phone)

    if not phone or len(phone) < 8:
        raise HTTPException(
            400,
            "Invalid phone number"
        )

    # Allow both 4-digit dev OTP and 6-digit Twilio OTP
    if not body.code or len(body.code) not in (4, 6):
        raise HTTPException(
            400,
            "Invalid OTP"
        )

    if len(body.new_password) < 6:
        raise HTTPException(
            400,
            "Password too short (min 6 chars)"
        )

    cfg = twilio_load_config()
    verified = False
    doc = None

    # ========================================================
    # 1. TWILIO VERIFY
    # ========================================================

    if cfg.use_verify:

        try:
            verified = twilio_check_verify(
                phone,
                body.code,
                cfg
            )

        except TwilioSendError as e:

            log.warning(
                "Twilio Verify reset check failed: %s",
                e
            )

            verified = False

    # ========================================================
    # 2. MONGO OTP FALLBACK
    # ========================================================

    if not verified:

        doc = await db.otps.find_one({
            "identifier": phone,
            "code": body.code,
            "purpose": "phone_reset",
            "used": False,
        })

        if not doc:
            raise HTTPException(
                400,
                "Invalid or expired OTP"
            )

        exp = doc.get("expires_at")

        if exp:

            if exp.tzinfo is None:
                exp = exp.replace(
                    tzinfo=timezone.utc
                )

            if exp < datetime.now(timezone.utc):
                raise HTTPException(
                    400,
                    "OTP expired"
                )

        await db.otps.update_one(
            {"id": doc["id"]},
            {
                "$set": {
                    "used": True,
                    "verified_at": now_iso(),
                }
            }
        )

        verified = True

    if not verified:
        raise HTTPException(
            400,
            "Invalid or expired OTP"
        )

    # ========================================================
    # FIND USER
    # ========================================================

    user = await db.users.find_one({
        "phone": phone
    })

    if not user:
        raise HTTPException(
            400,
            "No account found with this phone number"
        )

    # ========================================================
    # CHANGE PASSWORD
    # ========================================================

    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "password_hash": hash_password(
                    body.new_password
                )
            }
        }
    )

    return {
        "ok": True,
        "message": "Password reset successfully"
    }


# ============================================================
# CURRENT USER
# ============================================================

@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


# ============================================================
# LOGOUT
# ============================================================

@router.post("/auth/logout")
async def logout(user=Depends(current_user)):

    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "is_online": False,
                "last_seen_at": now_iso(),
            }
        },
    )

    return {
        "ok": True
    }


# ============================================================
# PHONE OTP - SEND
# RENFLAIR SMS - PRODUCTION
# ============================================================

@router.post("/auth/phone/send-otp")
async def phone_send_otp(body: PhoneOTPRequestIn):

    phone = normalize_phone(body.phone)

    if not phone or len(phone) < 8:
        raise HTTPException(
            400,
            "Invalid phone number"
        )

    existing = await db.users.find_one({
        "phone": phone
    })

    is_new_user = existing is None

    # Generate 6-digit OTP
    code = gen_code(6)

    otp_id = str(uuid.uuid4())

    # Save OTP in MongoDB
    await db.otps.insert_one({
        "id": otp_id,
        "identifier": phone,
        "code": code,
        "purpose": f"phone_{body.purpose}",
        "used": False,
        "created_at": now_iso(),
        "expires_at": _phone_expiry(),
    })

    try:
        # Send OTP through Renflair SMS
        twilio_send_sms(
            phone,
            f"Your Truck Wala OTP is {code}. Valid for 10 minutes.",
            None,
        )

    except TwilioSendError as e:

        log.exception(
            "Renflair OTP sending failed for %s",
            phone
        )

        # Delete OTP if SMS failed
        await db.otps.delete_one({
            "id": otp_id
        })

        raise HTTPException(
            status_code=502,
            detail="Unable to send OTP. Please try again."
        )

    return {
        "ok": True,
        "phone": phone,
        "is_new_user": is_new_user,
        "delivery": "renflair",
        "expires_in_seconds": 600,
    }
# ============================================================
# PHONE OTP - VERIFY
# ============================================================

@router.post(
    "/auth/phone/verify-otp",
)
async def phone_verify_otp(
    body: PhoneOTPVerifyIn
):

    phone = normalize_phone(body.phone)

    if not phone or len(phone) < 8:
        raise HTTPException(
            400,
            "Invalid phone number"
        )

    if not body.code or len(body.code) < 4:
        raise HTTPException(
            400,
            "Invalid OTP"
        )

    cfg = twilio_load_config()

    verified = False

    # ========================================================
    # 1. TWILIO VERIFY
    # ========================================================

    if cfg.use_verify:

        try:

            verified = twilio_check_verify(
                phone,
                body.code,
                cfg
            )

        except TwilioSendError as e:

            log.warning(
                "Twilio Verify check failed: %s",
                e
            )

            verified = False

    # ========================================================
    # 2. MONGO OTP
    # ========================================================

    if not verified:

        doc = await db.otps.find_one({
            "identifier": phone,
            "code": body.code,
            "purpose": {
                "$in": [
                    "phone_login",
                    "phone_register",
                    "phone_reset",
                ]
            },
            "used": False,
        })

        if not doc:
            raise HTTPException(
                400,
                "Invalid or expired code"
            )

        exp = doc.get("expires_at")

        if exp:

            if exp.tzinfo is None:
                exp = exp.replace(
                    tzinfo=timezone.utc
                )

            if exp < datetime.now(timezone.utc):
                raise HTTPException(
                    400,
                    "Code expired"
                )

        #OTP verified successfully.
        #Keep it available untill the new user's profile is completed.
        verified = True
    if not verified:
        raise HTTPException(
            400,
            "Invalid or expired code"
        )

    # ========================================================
    # EXISTING PHONE -> LOGIN
    # ========================================================

    existing_user = await db.users.find_one({
        "phone": phone
    })

    if existing_user:

        await db.users.update_one(
            {"id": existing_user["id"]},
            {
                "$set": {
                    "phone_verified": True,
                    "verified": True,
                }
            },
        )

        existing_user.pop("_id", None)
        existing_user.pop("password_hash", None)

        existing_user["phone_verified"] = True
        existing_user["verified"] = True

        return {
            "token": make_token(
                existing_user["id"]
            ),
            "user": existing_user,
        }

    # ========================================================
    # NEW USER -> PROFILE REQUIRED
    # ========================================================

    if not body.name or not body.role:

        return{"ok":True,"verified":True,"requires_profile":True,"phone":phone,}

    # ========================================================
    # EMAIL
    # ========================================================

    email = None

    if body.email:

        email = body.email.strip().lower()

        # ----------------------------------------------------
        # DUPLICATE EMAIL CHECK
        # ----------------------------------------------------

        existing_email = await db.users.find_one({
            "email": email
        })

        if existing_email:

            raise HTTPException(
                status_code=409,
                detail="Email already registered"
            )

    # ========================================================
    # SECOND PHONE CHECK
    # ========================================================
    # This protects against another account being created
    # between OTP verification and profile creation.

    phone_check = await db.users.find_one({
        "phone": phone
    })

    if phone_check:

        raise HTTPException(
            status_code=409,
            detail="Phone number already registered"
        )

    # ========================================================
    # CREATE NEW USER
    # ========================================================

    uid = str(uuid.uuid4())

    # If email was not supplied, create internal placeholder.
    # If supplied, the real email is saved.
    if not email:
        email = f"{uid}@phone.truckwala.app"

    doc = {
        "id": uid,
        "name": body.name.strip(),
        "email": email,
        "phone": phone,
        "role": body.role,

        "password_hash": hash_password(
            uuid.uuid4().hex
        ),

        "verified": True,
        "phone_verified": True,
        "email_verified": bool(body.email),

        "avg_rating": 0.0,
        "created_at": now_iso(),
        "auth_provider": "phone",
    }

    await db.users.insert_one(doc)
    # Mark OTP as used only after profile/account is created
    if doc:
        await db.otps.update_one(
            {"id":doc["id"]},
            {
                "$set": {
                    "used": True,
                    "verified_at": now_iso(),
                }
            },
        )

    doc.pop("_id", None)
    doc.pop("password_hash", None)

    return {
        "token": make_token(uid),
        "user": doc,
    }