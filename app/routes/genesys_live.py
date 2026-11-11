"""Signed-in agent's read-only Genesys queue overview."""

from fastapi import APIRouter, Depends, Request

from app.api_client import api_client
from app.authz import require_login
from app.report_proxy import forward_report

router = APIRouter(prefix='/reporting/genesys-live')


@router.get('')
async def report(request: Request, authz=Depends(require_login)):
    return await forward_report(lambda: api_client.genesys_live_request())
