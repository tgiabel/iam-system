"""Gemeinsame Teile der SOFA-Proxys fuer die Genesys-Reports der SD-API (Person aus der Sitzung)."""
from typing import Awaitable, Callable

import httpx
from fastapi import HTTPException
from fastapi.responses import Response

NO_STORE = {'Cache-Control': 'no-store'}


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
