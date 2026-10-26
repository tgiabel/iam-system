"""Servicelevel der Prod-Queues fuer die Dashboard-Card (SD-API /reporting/service-level)."""

from fastapi import APIRouter, Depends, Query, Request

from app.api_client import api_client
from app.authz import require_login
from app.report_proxy import forward_report, signed_report_token

router = APIRouter(prefix='/reporting/service-level')


@router.get('')
async def report(request: Request, queue_id: str | None = Query(None), group_id: str | None = Query(None),
                 authz=Depends(require_login)):
    token = signed_report_token(request, authz.user_id, unavailable='Servicelevel ist noch nicht eingerichtet.',
                                invalid='Bitte neu anmelden, um den Servicelevel zu sehen.')
    params = [(key, value) for key, value in (('queue_id', queue_id), ('group_id', group_id)) if value]
    return await forward_report(lambda: api_client.service_level_request(token, params=params))
