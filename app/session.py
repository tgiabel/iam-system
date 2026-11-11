"""Verifizierte Sitzung (Vertrag: SD-API docs/sofa-session-contract.md).

Der Browser haelt nur ein opakes Token im Cookie. SD-API ist der Session Store:
SOFA prueft das Token je Request ueber `GET /access/users/me` und reicht es bei
jedem API-Aufruf als `X-SOFA-Session` weiter. Identitaet und Rechte kommen nur
aus dieser Antwort, nie aus einem Cookie-Inhalt.
"""
from __future__ import annotations

import contextvars
import hmac
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import urlsplit

APP_ENV = os.getenv("APP_ENV", "production")

# __Host-: nur mit Secure, ohne Domain und mit Path=/ setzbar. Dev und Prod getrennt.
SESSION_COOKIE = "__Host-sofa_dev_session" if APP_ENV == "development" else "__Host-sofa_session"
LOGIN_CSRF_COOKIE = "__Host-sofa_login_csrf"
LOGIN_CSRF_MAX_AGE = 600
# Vor der Umstellung: unsigniertes Benutzer-JSON und Report-Token. Werden nie gelesen, nur geloescht.
LEGACY_COOKIES = ("sofa_user", "sofa_agent_stats")

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")

# Eingecheckter Fixture-Schluessel der SD-API fuer Dev/Test, kein Geheimnis (app/shared/config.py dort).
DEV_SERVICE_KEY = "c2QtYXBpIHNvZmEgZGV2IHNlcnZpY2Uga2V5IDAwMDE"


def service_key() -> str:
    configured = os.getenv("SD_API_SERVICE_KEY", "").strip()
    if configured:
        return configured
    return DEV_SERVICE_KEY if APP_ENV != "production" else ""


@dataclass(frozen=True)
class SessionState:
    token: str
    csrf_token: str = ""
    info: dict = field(default_factory=dict)


# Request-lokal fuer api_client: Token und CSRF-Token fuer jeden SD-API-Aufruf. Routen und Templates
# lesen die Sitzung ueber request_session(), nicht hieraus.
current_session: contextvars.ContextVar[SessionState | None] = contextvars.ContextVar("sofa_session", default=None)


def request_session(request) -> SessionState | None:
    """Von SD-API bestaetigte Sitzung dieses Requests (app.session_gate), sonst None."""
    return getattr(request.state, "session", None)


def is_token(value: str | None) -> bool:
    return bool(value) and TOKEN_PATTERN.fullmatch(value) is not None


def tokens_match(expected: str | None, received: str | None) -> bool:
    return bool(expected) and bool(received) and hmac.compare_digest(str(expected), str(received))


def seconds_until_absolute_expiry(info: dict) -> int | None:
    """Restlaufzeit fuer das Cookie: absolute_expires_at minus Serverzeit der SD-API."""
    try:
        end = datetime.fromisoformat(str(info["absolute_expires_at"]).replace("Z", "+00:00"))
        now = datetime.fromisoformat(str(info["server_time"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    return max(0, int((end - now).total_seconds()))


def public_session_info(info: dict | None) -> dict:
    """Fristen der Sitzung fuer den Browser, ohne Sitzungs- und CSRF-Token."""
    public = dict(info or {})
    public.pop("token", None)
    public.pop("csrf_token", None)
    return public


def set_session_cookie(response, session: dict) -> None:
    response.set_cookie(
        SESSION_COOKIE, session["token"], max_age=seconds_until_absolute_expiry(session), path="/",
        secure=True, httponly=True, samesite="lax",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="lax")


def client_ip(headers) -> str | None:
    """Letzter Eintrag aus X-Forwarded-For: den haengt Apache an, die vorderen kann der Browser faelschen."""
    forwarded = headers.get("x-forwarded-for", "")
    entries = [entry.strip() for entry in forwarded.split(",") if entry.strip()]
    return entries[-1] if entries else None


_NEXT_BLOCKED = ("/login", "/logout", "/api/", "/static/", "/health", "/dev/")


def safe_next(raw: str | None) -> str:
    """Internes Ruecksprungziel inklusive Query, sonst "/". Nie extern, nie Login/Logout/API."""
    if not raw or len(raw) > 2000:
        return "/"
    if not raw.startswith("/") or raw.startswith("//") or "\\" in raw:
        return "/"
    if any(ord(char) < 0x21 or ord(char) == 0x7F for char in raw):
        return "/"
    parts = urlsplit(raw)
    if parts.scheme or parts.netloc:
        return "/"
    path = parts.path or "/"
    if path == "/login" or path == "/logout" or path.startswith(_NEXT_BLOCKED):
        return "/"
    return path + (f"?{parts.query}" if parts.query else "")
