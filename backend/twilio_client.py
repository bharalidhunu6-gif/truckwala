from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from random import randint
from typing import Optional

import httpx


log = logging.getLogger(__name__)

_PHONE_RE = re.compile(r"[^\d+]")


# ============================================================
# PHONE NORMALIZATION
# ============================================================

def normalize_phone(raw: str, default_cc: Optional[str] = None) -> str:
    """Return an E.164-style Indian phone number."""

    if not raw:
        return ""

    s = _PHONE_RE.sub("", raw.strip())

    if not s.startswith("+"):
        s = s.lstrip("0")

        cc = (
            default_cc
            or os.getenv("DEFAULT_COUNTRY_CODE")
            or "+91"
        ).strip()

        if not cc.startswith("+"):
            cc = "+" + cc

        s = cc + s

    return s


# ============================================================
# CONFIG
# ============================================================

@dataclass
class TwilioConfig:
    account_sid: str
    auth_token: str
    verify_service_sid: str
    from_number: str
    default_cc: str

    @property
    def has_credentials(self) -> bool:
        return bool(
            os.getenv("RENFLAIR_API_KEY", "").strip()
        )

    @property
    def use_verify(self) -> bool:
        return False

    @property
    def use_messages(self) -> bool:
        return bool(
            os.getenv("RENFLAIR_API_KEY", "").strip()
        )


def load_config() -> TwilioConfig:
    return TwilioConfig(
        account_sid="",
        auth_token="",
        verify_service_sid="",
        from_number="",
        default_cc=os.getenv(
            "DEFAULT_COUNTRY_CODE",
            "+91",
        ).strip(),
    )


# ============================================================
# OTP GENERATOR
# ============================================================

def gen_code(length: int = 6) -> str:
    n = randint(0, 10**length - 1)
    return str(n).zfill(length)


# ============================================================
# ERROR
# ============================================================

class TwilioSendError(Exception):
    """SMS sending error."""


# ============================================================
# TWILIO VERIFY - DISABLED
# ============================================================

def twilio_send_verify(
    phone: str,
    cfg: Optional[TwilioConfig] = None,
) -> str:
    raise TwilioSendError(
        "Twilio Verify is disabled. Renflair SMS is being used."
    )


def twilio_check_verify(
    phone: str,
    code: str,
    cfg: Optional[TwilioConfig] = None,
) -> bool:
    raise TwilioSendError(
        "Twilio Verify is disabled. OTP is verified from MongoDB."
    )


# ============================================================
# RENFLAIR SMS
# ============================================================

def twilio_send_sms(
    phone: str,
    body: str,
    cfg: Optional[TwilioConfig] = None,
) -> str:
    """Send OTP through Renflair SMS API."""

    api_key = os.getenv(
        "RENFLAIR_API_KEY",
        "",
    ).strip()

    api_url = os.getenv(
        "RENFLAIR_URL",
        "https://sms.renflair.in/V1.php",
    ).strip()

    if not api_key:
        raise TwilioSendError(
            "RENFLAIR_API_KEY is not configured"
        )

    clean_phone = normalize_phone(phone)

    # +91XXXXXXXXXX -> XXXXXXXXXX
    if clean_phone.startswith("+91"):
        clean_phone = clean_phone[3:]

    if len(clean_phone) != 10 or not clean_phone.isdigit():
        raise TwilioSendError(
            "Invalid Indian mobile number"
        )

    match = re.search(
        r"\b(\d{4,6})\b",
        body,
    )

    if not match:
        raise TwilioSendError(
            "OTP could not be extracted from SMS message"
        )

    otp = match.group(1)

    params = {
        "API": api_key,
        "PHONE": clean_phone,
        "OTP": otp,
    }

    log.info(
        "Sending Renflair OTP to ******%s",
        clean_phone[-4:],
    )

    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                api_url,
                params=params,
            )

        response.raise_for_status()

    except Exception as e:
        log.exception(
            "Renflair SMS request failed"
        )

        raise TwilioSendError(
            f"Renflair SMS failed: {e}"
        ) from e

    log.info(
        "Renflair response: %s",
        response.text,
    )

    return response.text