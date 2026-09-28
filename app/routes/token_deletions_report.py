"""SOFA proxy for the compact token-deletion report."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.api_client import api_client
from app.authz import AuthorizationContext, require_login

router = APIRouter(prefix="/reporting/token-deletions")
REPORT = "SOFA-RPRT-PRSNC"


def authorize(authz: AuthorizationContext) -> None:
    if not authz.has_permission(REPORT):
        raise HTTPException(
            status_code=403,
            detail={"code": "permission_denied", "message": f"Berechtigung {REPORT} erforderlich."},
        )
    if not authz.user_id:
        raise HTTPException(status_code=401, detail="Keine aktive Identität.")


@router.get("/overview")
async def overview(request: Request, authz=Depends(require_login)):
    authorize(authz)
    try:
        response = await api_client.token_deletions_report_request(
            "/overview", authz.user_id, params=request.query_params.multi_items()
        )
    except httpx.HTTPStatusError as exc:
        response = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail="Tokenlöschungs-Daten konnten nicht geladen werden.") from None
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=response.headers.get("content-type", "application/json"),
        headers={"Cache-Control": "no-store"},
    )
