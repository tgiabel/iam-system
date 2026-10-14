"""Signed-in agent's read-only Genesys queue overview."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.agent_stats_token import verify
from app.api_client import api_client
from app.authz import require_login

router = APIRouter(prefix='/reporting/genesys-live')


@router.get('')
async def report(request: Request, authz=Depends(require_login)):
    token = request.cookies.get('sofa_agent_stats', '')
    try:
        actor_id = verify(token)
    except RuntimeError:
        raise HTTPException(status_code=503, detail='Genesys Live ist noch nicht eingerichtet.',
                            headers={'Cache-Control': 'no-store'}) from None
    except ValueError:
        raise HTTPException(status_code=401, detail='Bitte neu anmelden, um Genesys Live zu öffnen.',
                            headers={'Cache-Control': 'no-store'}) from None
    if actor_id != authz.user_id:
        raise HTTPException(status_code=401, detail='Bitte neu anmelden, um Genesys Live zu öffnen.',
                            headers={'Cache-Control': 'no-store'})
    try:
        backend = await api_client.genesys_live_request(token)
    except httpx.HTTPStatusError as exc:
        backend = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail='Genesys-Daten konnten nicht geladen werden.',
                            headers={'Cache-Control': 'no-store'}) from None
    return Response(content=backend.content, status_code=backend.status_code,
                    media_type=backend.headers.get('content-type', 'application/json'),
                    headers={'Cache-Control': 'no-store'})
