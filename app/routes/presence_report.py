"""SOFA-Proxy des Presence-Reports: Identität aus der Sitzung, Rechte wie in der SD-API.

Mitarbeiter werden nur über Tag und Pseudonym angesprochen. Klarname und Einzeldatensätze sind je
Zeile eigene Abrufe mit eigenem Funktionsrecht; die SD-API protokolliert sie.
"""
from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import Response

from app.api_client import api_client
from app.authz import AuthorizationContext, require_login

router = APIRouter(prefix="/reporting/presence")
REPORT, NAME, DETAIL = "SOFA-RPRT-PRSNC", "SOFA-FN-PRSNC-NAME", "SOFA-FN-PRSNC-DETAIL"
# Wie in der SD-API; das Muster verhindert zugleich, dass ein Pfadsegment den SD-API-Pfad verlässt.
PSEUDONYM = Path(pattern=r"^MA-[A-Z2-7]{5,52}$")


def authorize(authz: AuthorizationContext, function: str | None = None) -> None:
    for permission in (REPORT, function):
        if permission and not authz.has_permission(permission):
            raise HTTPException(status_code=403, detail={"code": "permission_denied", "message": f"Berechtigung {permission} erforderlich."})
    if not authz.user_id:
        raise HTTPException(status_code=401, detail="Keine aktive Identität.")


async def forward(request: Request, authz: AuthorizationContext, path: str, function: str | None = None) -> Response:
    authorize(authz, function)
    try:
        response = await api_client.presence_report_request(path, authz.user_id, params=request.query_params.multi_items())
    except httpx.HTTPStatusError as exc:
        response = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail="Presence-Daten konnten nicht geladen werden.") from None
    headers = {"Cache-Control": "no-store"}
    if "content-disposition" in response.headers:
        headers["Content-Disposition"] = response.headers["content-disposition"]
    return Response(content=response.content, status_code=response.status_code,
                    media_type=response.headers.get("content-type", "application/json"), headers=headers)


@router.get("/day")
async def day(request: Request, authz=Depends(require_login)):
    return await forward(request, authz, "/day")


@router.get("/day/{business_date}/users/{pseudonym}/name")
async def name(request: Request, business_date: date, pseudonym: str = PSEUDONYM, authz=Depends(require_login)):
    return await forward(request, authz, f"/day/{business_date.isoformat()}/users/{pseudonym}/name", NAME)


@router.get("/day/{business_date}/users/{pseudonym}")
async def details(request: Request, business_date: date, pseudonym: str = PSEUDONYM, authz=Depends(require_login)):
    return await forward(request, authz, f"/day/{business_date.isoformat()}/users/{pseudonym}", DETAIL)


@router.get("/export")
async def export(request: Request, authz=Depends(require_login)):
    return await forward(request, authz, "/export")
