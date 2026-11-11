"""Sitzungsrouten fuer das Browser-Skript (static/js/session.js) und die gemeinsame Anmeldung.

- GET  /api/session/authz     Poll, rein lesend: Rechte, Fristen, gueltiges CSRF-Token
- POST /api/session/activity  echte Bedienaktivitaet, verlaengert die Sitzung (SD-API drosselt)
- POST /api/session/login     Wiederanmeldung im Tab, ohne die Seite zu verlassen

`open_session` nutzen diese Route und `POST /login` (app/routes/pages.py).
"""
from __future__ import annotations

import logging

import httpx  # type: ignore
from fastapi import APIRouter, Depends, Request  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from app.api_client import api_client
from app.authz import build_authorization_context_from_user, get_authz_payload_for_template, require_login
from app.login_errors import MISSING_FIELDS, UNAVAILABLE, LoginFailure, classify_login_error
from app.routes.shared import _error_content_from_response, _normalize_session_user
from app.session import SESSION_COOKIE, client_ip, public_session_info, request_session, set_session_cookie
from app.session_gate import csrf_rejection, same_origin, session_error

router = APIRouter(prefix="/api/session")
logger = logging.getLogger("uvicorn.error")


class LoginRejected(Exception):
    def __init__(self, failure: LoginFailure):
        super().__init__(failure.code)
        self.failure = failure


async def open_session(request: Request, pnr: str, password: str) -> dict:
    """Anmeldung bei SD-API. Liefert die Login-Antwort mit `session` (inkl. `token` und `csrf_token`);
    das Cookie setzt der Aufrufer. Eine mitgeschickte alte Sitzung widerruft SD-API (REPLACED).
    Fehlschlag: `LoginRejected` mit Code, Status und Text aus app.login_errors."""
    try:
        result = await api_client.login_user(
            pnr, password,
            client_ip=client_ip(request.headers),
            previous_token=request.cookies.get(SESSION_COOKIE),
        )
        session = result["session"]
        if not session.get("token") or not session.get("csrf_token"):
            raise ValueError("Login-Antwort ohne Sitzungs- oder CSRF-Token")
    except Exception as exc:
        failure = classify_login_error(exc)
        if failure.status == 503:
            logger.warning("Anmeldung fehlgeschlagen: %r", exc, exc_info=exc)
        raise LoginRejected(failure) from exc
    return result


def _csrf_token(request: Request) -> str:
    """Aktuelles CSRF-Token der Sitzung. Hat ein anderer Tab neu angemeldet, ist das in der Seite
    stehende Token veraltet; Poll und Aktivitaet liefern das gueltige (nur same-origin lesbar, wie das Meta-Tag)."""
    state = request_session(request)
    return state.csrf_token if state is not None else ""


@router.get("/authz")
async def api_session_authz_refresh(request: Request, authz=Depends(require_login)):
    """Rein lesend: Rechte stehen schon frisch aus /users/me im Request (Session-Middleware).
    Verlaengert die Sitzung nicht und setzt keine Cookies."""
    user = dict(authz.raw_user or {})
    permissions = dict(user.get("sofa_permissions") or {})
    try:
        sofa_me = await api_client.get_sofa_me(authz.user_id)
        permissions["task_count"] = (sofa_me or {}).get("task_count") or 0
        refreshed = True
    except Exception:
        refreshed = False
    user["sofa_permissions"] = permissions
    state = request_session(request)
    return JSONResponse(content={
        "user": user,
        "authz": get_authz_payload_for_template(build_authorization_context_from_user(user, permissions)),
        "session": public_session_info(state.info if state is not None else None),
        "csrf_token": _csrf_token(request),
        "refreshed": refreshed,
    })


@router.post("/activity")
async def api_session_activity(request: Request, authz=Depends(require_login)):
    """Echte Bedienaktivitaet aus dem Browser (gedrosselt). Belebt keine abgelaufene Sitzung."""
    try:
        result = await api_client.session_activity()
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        logger.warning("Aktivitaetsmeldung nicht erreichbar: %r", exc)
        return session_error("service_unavailable", UNAVAILABLE, 503)
    return JSONResponse(content={
        "session": public_session_info((result or {}).get("session")),
        "csrf_token": _csrf_token(request),
    })


@router.post("/login")
async def api_session_login(request: Request):
    """Wiederanmeldung im selben Tab, ohne die Seite (und ungespeicherte Eingaben) zu verlassen.

    Kein Formular-Token: Der Request kommt nur per fetch mit JSON und muss einen Origin des eigenen
    Hosts tragen. Fremde Seiten koennen JSON nicht ohne CORS-Preflight senden, den SOFA nie erlaubt.
    """
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if not request.headers.get("origin") or not same_origin(request) or content_type != "application/json":
        return csrf_rejection()
    try:
        payload = await request.json()
    except Exception:
        payload = None
    if not isinstance(payload, dict):
        payload = {}
    pnr = str(payload.get("pnr") or "").strip()
    password = payload.get("password") if isinstance(payload.get("password"), str) else ""
    if not pnr or not password:
        return session_error("missing_fields", MISSING_FIELDS, 400)

    try:
        result = await open_session(request, pnr, password)
    except LoginRejected as rejected:
        failure = rejected.failure
        return session_error(failure.code, failure.message, failure.status)

    session = result["session"]
    user = _normalize_session_user(result)
    response = JSONResponse(content={
        "user": {"user_id": user.get("user_id"), "pnr": user.get("pnr"), "first_name": user.get("first_name")},
        "session": public_session_info(session),
        "csrf_token": session["csrf_token"],
    })
    set_session_cookie(response, session)
    return response
