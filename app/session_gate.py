"""Je Request: Sitzung bei SD-API pruefen, CSRF zentral pruefen, alte Cookies entfernen.

Ergebnis steht in `request.state.session_user` (normalisierter Benutzer mit
`sofa_permissions`) bzw. `request.state.session_problem`:

- "expired", "revoked", "logged_out", "invalid": Sitzung endgueltig weg, Cookie wird geloescht.
- "unavailable": SD-API nicht erreichbar oder Dienstnachweis abgelehnt. Kein Logout,
  das Cookie bleibt; Seiten antworten mit 503.
"""
from __future__ import annotations

import logging
from urllib.parse import urlsplit

import httpx  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore

from app.api_client import api_client
from app.session import (
    LEGACY_COOKIES,
    SESSION_COOKIE,
    SessionState,
    clear_session_cookie,
    current_session,
    is_token,
    tokens_match,
)

logger = logging.getLogger("uvicorn.error")

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# Diese Routen pruefen ihren CSRF-Schutz selbst: /login und /logout tragen das Token im Formularfeld,
# die Wiederanmeldung im Tab kommt ohne gueltige Sitzung (Origin-Pflicht plus JSON).
SELF_CSRF_PATHS = frozenset({"/login", "/logout", "/api/session/login"})
NO_STORE = "no-store"


class SessionUnavailable(Exception):
    pass


def _problem_from_error(exc: httpx.HTTPStatusError) -> str:
    response = exc.response
    try:
        detail = response.json().get("detail") or {}
    except Exception:
        detail = {}
    code = detail.get("code") if isinstance(detail, dict) else None
    if response.status_code == 401 and isinstance(code, str) and code.startswith("session_"):
        if code == "session_expired":
            return "expired"
        if code == "session_revoked":
            reason = (detail.get("context") or {}).get("reason")
            return "logged_out" if reason == "LOGOUT" else "revoked"
        return "invalid"
    # service_unauthorized, 5xx, Unerwartetes: kein Logout.
    logger.warning("Sitzungspruefung fehlgeschlagen: %s %s", response.status_code, code or "")
    return "unavailable"


async def resolve_session(token: str | None) -> tuple[dict | None, SessionState | None, str | None]:
    """(Benutzer, Sitzung, Problem). Benutzer und Rechte nur aus der Antwort von SD-API."""
    from app.routes.shared import _normalize_session_user

    if not token:
        return None, None, None
    if not is_token(token):
        return None, None, "invalid"
    try:
        me = await api_client.session_me(token)
    except httpx.HTTPStatusError as exc:
        return None, None, _problem_from_error(exc)
    except Exception as exc:  # Netzwerk, Timeout
        logger.warning("Sitzungspruefung nicht erreichbar: %r", exc)
        return None, None, "unavailable"

    info = me.get("session") if isinstance(me, dict) else None
    if not isinstance(info, dict) or not info.get("csrf_token"):
        logger.warning("Sitzungspruefung ohne session-Block")
        return None, None, "unavailable"
    user = _normalize_session_user(me)
    user["sofa_permissions"] = me.get("permissions") or {}
    return user, SessionState(token=token, csrf_token=str(info["csrf_token"]), info=info), None


def same_origin(request) -> bool:
    """Origin (ersatzweise Referer) muss der eigene Host sein. Ohne beide Koepfe kein Browser-CSRF."""
    source = request.headers.get("origin") or request.headers.get("referer")
    if not source:
        return True
    if source == "null":
        return False
    return urlsplit(source).netloc.lower() == request.headers.get("host", "").lower()


def session_error(code: str, message: str, status: int) -> JSONResponse:
    """JSON-Fehler der Sitzungsschicht im Format der SD-API: {"detail": {"code", "message"}}.
    503 traegt Retry-After wie im Vertrag (Abschnitt 6)."""
    headers = {"Cache-Control": NO_STORE}
    if status == 503:
        headers["Retry-After"] = "30"
    return JSONResponse({"detail": {"code": code, "message": message}}, status_code=status, headers=headers)


def csrf_rejection() -> JSONResponse:
    return session_error("csrf_failed", "Die Anfrage wurde abgelehnt. Bitte lade die Seite neu.", 403)


class SessionGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if path.startswith("/static/") or path == "/health":
            return await call_next(request)

        user, state, problem = await resolve_session(request.cookies.get(SESSION_COOKIE))
        request.state.session_user = user
        request.state.session = state
        request.state.session_problem = problem

        if request.method not in SAFE_METHODS:
            if not same_origin(request):
                return csrf_rejection()
            if state is not None and path not in SELF_CSRF_PATHS:
                if not tokens_match(state.csrf_token, request.headers.get("x-csrf-token")):
                    return csrf_rejection()

        reset = current_session.set(state)
        try:
            response = await call_next(request)
        finally:
            current_session.reset(reset)

        # Hat die Route (Login) gerade ein neues Cookie gesetzt, darf das Loeschen es nicht ueberschreiben.
        sets_session = any(
            key == b"set-cookie" and value.startswith(SESSION_COOKIE.encode() + b"=")
            for key, value in response.raw_headers
        )
        if problem in ("expired", "revoked", "logged_out", "invalid") and not sets_session:
            clear_session_cookie(response)
        for legacy in LEGACY_COOKIES:
            if legacy in request.cookies:
                response.delete_cookie(legacy, path="/")
        response.headers.setdefault("Cache-Control", NO_STORE)
        return response
