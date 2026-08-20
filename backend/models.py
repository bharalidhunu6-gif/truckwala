"""Pydantic request/response models."""
from pydantic import BaseModel, EmailStr, field_validator
from typing import List, Optional, Literal

# Kept in sync with deps.MAX_PHOTO_* limits.
_MAX_PHOTOS = 5
_MAX_PHOTO_STR_LEN = 2_800_000  # ~2MB after base64 expansion + data URI prefix

Role = Literal["customer", "driver", "admin"]


class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    phone: str
    password: str
    role: Role


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    token: str
    user: dict


class TruckIn(BaseModel):
    reg_number: str
    truck_type: str
    body_type: str
    load_capacity_kg: float
    dimensions: str = ""
    insurance_expiry: Optional[str] = None
    base_lat: float = 12.9716
    base_lng: float = 77.5946
    base_city: str = "Bangalore"
    # Photos are base64 strings (data URI OK). Both are REQUIRED at registration time.
    vehicle_photo: str
    rc_photo: str

    @field_validator("reg_number")
    @classmethod
    def _norm_reg(cls, v: str) -> str:
        v = (v or "").strip().upper().replace(" ", "").replace("-", "")
        if len(v) < 4:
            raise ValueError("Registration number too short")
        return v

    @field_validator("vehicle_photo", "rc_photo")
    @classmethod
    def _check_size(cls, v: str) -> str:
        if not v:
            raise ValueError("Photo is required")
        if len(v) > _MAX_PHOTO_STR_LEN:
            raise ValueError("Photo too large (max ~2MB)")
        return v


class ShipmentIn(BaseModel):
    goods_category: str
    weight_kg: float
    packages: int
    pickup_address: str
    pickup_city: str
    pickup_pincode: Optional[str] = None
    pickup_lat: float
    pickup_lng: float
    drop_address: str
    drop_city: str
    drop_pincode: Optional[str] = None
    drop_lat: float
    drop_lng: float
    loading_date: str
    delivery_deadline: Optional[str] = None
    truck_type_preferred: Optional[str] = None
    photos: List[str] = []
    instructions: str = ""

    @field_validator("photos")
    @classmethod
    def _check_photos(cls, v: List[str]) -> List[str]:
        if len(v) > _MAX_PHOTOS:
            raise ValueError(f"Too many photos (max {_MAX_PHOTOS})")
        for i, p in enumerate(v):
            if len(p) > _MAX_PHOTO_STR_LEN:
                raise ValueError(f"Photo #{i + 1} too large (max ~2MB)")
        return v

    @field_validator("instructions")
    @classmethod
    def _cap_instructions(cls, v: str) -> str:
        return (v or "")[:2000]


class OTPRequestIn(BaseModel):
    identifier: str  # email or phone
    purpose: Literal["register", "reset"] = "register"


class OTPVerifyIn(BaseModel):
    identifier: str
    code: str
    purpose: Literal["register", "reset"] = "register"


class ForgotResetIn(BaseModel):
    phone: str
    code: str
    new_password: str


class PhoneOTPRequestIn(BaseModel):
    phone: str
    purpose: Literal["login", "register","reset"] = "login"


class PhoneOTPVerifyIn(BaseModel):
    phone: str
    code: str
    # Optional profile fields for first-time signup via phone.
    name: Optional[str] = None
    role: Optional[Role] = None
    email: Optional[EmailStr] = None


class QuoteIn(BaseModel):
    shipment_id: str
    truck_id: str
    price_inr: float
    eta_hours: float
    note: str = ""


class RatingIn(BaseModel):
    booking_id: str
    rating: int
    review: str = ""


class OrderIn(BaseModel):
    booking_id: str


class AcceptQuoteIn(BaseModel):
    # 'cashfree' -> online prepay; 'cod' -> pay driver on delivery in cash.
    payment_method: Literal["cashfree", "cod"] = "cashfree"


class PaymentVerifyIn(BaseModel):
    booking_id: str
    order_id: str
   


class LocationIn(BaseModel):
    lat: float
    lng: float


class ChatIn(BaseModel):
    text: str


class RejectIn(BaseModel):
    reason: str = ""


# ==== New in iter 12: online toggle, subscriptions, complaints ====

class TruckOnlineIn(BaseModel):
    device_id: str  # a stable client-generated identifier per install


class SubscriptionOrderIn(BaseModel):
    truck_id: str


class SubscriptionVerifyIn(BaseModel):
    truck_id: str
    subscription_id: str
    order_id: str


class ComplaintIn(BaseModel):
    booking_id: str
    subject: str
    message: str

    @field_validator("subject", "message")
    @classmethod
    def _trim(cls, v: str) -> str:
        return (v or "").strip()[:2000]


class ComplaintResolveIn(BaseModel):
    resolution: str = ""
    action: Literal["resolve", "dismiss"] = "resolve"
