"""SOFA proxy for the signed-in user's Genesys statistics."""
from datetime import date
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.agent_stats_token import verify
from app.api_client import api_client
from app.authz import require_login

router = APIRouter(prefix='/reporting/agent-stats')


@router.get('')
async def report(request: Request, period: Literal['day', 'month'] = 'day', anchor: date | None = None,
                 authz=Depends(require_login)):
    token = request.cookies.get('sofa_agent_stats', '')
    try:
        actor_id = verify(token)
    except RuntimeError:
        raise HTTPException(status_code=503, detail='Persönlicher Report ist noch nicht eingerichtet.') from None
    except ValueError:
        raise HTTPException(status_code=401, detail='Bitte neu anmelden, um den persönlichen Report zu öffnen.') from None
    if actor_id != authz.user_id:
        raise HTTPException(status_code=401, detail='Bitte neu anmelden, um den persönlichen Report zu öffnen.')
    params = [('period', period)]
    if anchor:
        params.append(('anchor', anchor.isoformat()))
    try:
        backend = await api_client.agent_stats_request(token, params=params)
    except httpx.HTTPStatusError as exc:
        backend = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail='Genesys-Daten konnten nicht geladen werden.') from None
    return Response(content=backend.content, status_code=backend.status_code,
                    media_type=backend.headers.get('content-type', 'application/json'),
                    headers={'Cache-Control': 'no-store'})
