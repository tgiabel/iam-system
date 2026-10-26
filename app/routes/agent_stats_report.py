"""SOFA proxy for the signed-in user's Genesys statistics."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Request

from app.api_client import api_client
from app.authz import require_login
from app.report_proxy import forward_report, signed_report_token

router = APIRouter(prefix='/reporting/agent-stats')


@router.get('')
async def report(request: Request, period: Literal['day', 'month'] = 'day', anchor: date | None = None,
                 authz=Depends(require_login)):
    token = signed_report_token(request, authz.user_id, unavailable='Persönlicher Report ist noch nicht eingerichtet.',
                                invalid='Bitte neu anmelden, um den persönlichen Report zu öffnen.')
    params = [('period', period)]
    if anchor:
        params.append(('anchor', anchor.isoformat()))
    return await forward_report(lambda: api_client.agent_stats_request(token, params=params))
