"""Gemeinsame Teile der SOFA-Proxys fuer die tokengeschuetzten SD-API-Reports (Genesys)."""
from typing import Awaitable, Callable

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import Response

from app.agent_stats_token import MAX_AGE, issue, verify

NO_STORE = {'Cache-Control': 'no-store'}
REPORT_COOKIE = 'sofa_agent_stats'


def set_report_cookie(response: Response, user_id: int, *, secure: bool) -> None:
    """Signierter Report-Token als Cookie. Ohne Secret bleibt der Report zu, die Anmeldung laeuft weiter."""
    try:
        token = issue(user_id)
    except RuntimeError:
        return
    response.set_cookie(key=REPORT_COOKIE, value=token, httponly=True, max_age=MAX_AGE,
                        samesite='lax', secure=secure)


def renew_report_cookie(request: Request, response: Response, user_id: int | None, *, secure: bool) -> None:
    """Gleitend wie die Sitzung, aber nur aus einem noch gueltigen Token dieser Person: das Sitzungs-Cookie
    ist nicht signiert und darf allein keinen Token ausstellen. Mit signierter Sitzung entfaellt die Bedingung."""
    try:
        valid = user_id is not None and verify(request.cookies.get(REPORT_COOKIE, '')) == user_id
    except (ValueError, RuntimeError):
        valid = False
    if valid:
        set_report_cookie(response, user_id, secure=secure)


def signed_report_token(request: Request, user_id: int | None, *, unavailable: str, invalid: str) -> str:
    """Signierter Report-Token aus dem Cookie, nur wenn er dieser angemeldeten Person gehoert."""
    token = request.cookies.get(REPORT_COOKIE, '')
    try:
        actor_id = verify(token)
    except RuntimeError:
        raise HTTPException(status_code=503, detail=unavailable, headers=NO_STORE) from None
    except ValueError:
        raise HTTPException(status_code=401, detail=invalid, headers=NO_STORE) from None
    if actor_id != user_id:
        raise HTTPException(status_code=401, detail=invalid, headers=NO_STORE)
    return token


async def forward_report(call: Callable[[], Awaitable[httpx.Response]]) -> Response:
    """Antwort der SD-API unveraendert durchreichen, auch Fehlerstatus; nur Verbindungsfehler werden 502."""
    try:
        backend = await call()
    except httpx.HTTPStatusError as exc:
        backend = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail='Genesys-Daten konnten nicht geladen werden.',
                            headers=NO_STORE) from None
    return Response(content=backend.content, status_code=backend.status_code,
                    media_type=backend.headers.get('content-type', 'application/json'),
                    headers=NO_STORE)
