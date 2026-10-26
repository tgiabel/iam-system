"""Gemeinsame Teile der SOFA-Proxys fuer die tokengeschuetzten SD-API-Reports (Genesys)."""
from typing import Awaitable, Callable

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import Response

from app.agent_stats_token import verify

NO_STORE = {'Cache-Control': 'no-store'}


def signed_report_token(request: Request, user_id: int | None, *, unavailable: str, invalid: str) -> str:
    """Signierter Report-Token aus dem Cookie, nur wenn er dieser angemeldeten Person gehoert."""
    token = request.cookies.get('sofa_agent_stats', '')
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
