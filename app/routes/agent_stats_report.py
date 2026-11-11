"""SOFA proxy for the signed-in user's Genesys statistics."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends

from app.api_client import api_client
from app.authz import require_login
from app.report_proxy import forward_report

router = APIRouter(prefix='/reporting/agent-stats')


@router.get('')
async def report(period: Literal['day', 'month'] = 'day', anchor: date | None = None,
                 authz=Depends(require_login)):
    params = [('period', period)]
    if anchor:
        params.append(('anchor', anchor.isoformat()))
    return await forward_report(lambda: api_client.agent_stats_request(params=params))
