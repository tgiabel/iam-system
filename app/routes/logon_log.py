"""SOFA-only proxy: actor identity always comes from the authenticated session."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.api_client import LOGON_LOG_RANGE_TIMEOUT_SECONDS, api_client
from app.authz import AuthorizationContext, require_login

router = APIRouter(prefix="/reporting/logon-log")
REPORT, NAMES, CHECK = "SOFA-RPRT-LL", "SOFA-FN-LL", "SOFA-FN-CHECKLL"


def authorize(authz: AuthorizationContext, function: str | None = None) -> None:
    for permission in (REPORT, function):
        if permission and not authz.has_permission(permission):
            raise HTTPException(status_code=403, detail={"code": "permission_denied", "message": f"Berechtigung {permission} erforderlich."})
    if not authz.user_id:
        raise HTTPException(status_code=401, detail="Keine aktive Identität.")


async def forward(
    request: Request,
    authz: AuthorizationContext,
    method: str,
    path: str,
    function: str | None = None,
    *,
    timeout: float | None = None,
) -> Response:
    authorize(authz, function)
    try:
        payload = await request.json() if method == "POST" else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiger JSON-Body.") from None
    try:
        response = await api_client.logon_log_request(
            method,
            path,
            authz.user_id,
            params=request.query_params.multi_items(),
            payload=payload,
            timeout=timeout,
        )
    except httpx.HTTPStatusError as exc:
        response = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail="LogonLog-Daten konnten nicht geladen werden.") from None
    headers = {"Cache-Control": "no-store"}
    if "content-disposition" in response.headers:
        headers["Content-Disposition"] = response.headers["content-disposition"]
    return Response(content=response.content, status_code=response.status_code,
                    media_type=response.headers.get("content-type", "application/json"), headers=headers)


@router.get("/day")
async def day(request: Request, authz=Depends(require_login)):
    return await forward(request, authz, "GET", "/day")


@router.get("/users")
async def users(request: Request, authz=Depends(require_login)):
    return await forward(request, authz, "GET", "/users", NAMES)


@router.post("/names")
async def names(request: Request, authz=Depends(require_login)):
    return await forward(request, authz, "POST", "/names", NAMES)


@router.get("/analysis")
async def analysis(request: Request, authz=Depends(require_login)):
    return await forward(request, authz, "GET", "/analysis", NAMES, timeout=LOGON_LOG_RANGE_TIMEOUT_SECONDS)


@router.get("/reviews/{user_id}/{day}")
async def review_detail(request: Request, user_id: int, day: str, authz=Depends(require_login)):
    return await forward(request, authz, "GET", f"/reviews/{user_id}/{day}", CHECK)


@router.post("/reviews/{user_id}/{day}")
async def save_review(request: Request, user_id: int, day: str, authz=Depends(require_login)):
    return await forward(request, authz, "POST", f"/reviews/{user_id}/{day}", CHECK)


@router.get("/export")
async def export(request: Request, authz=Depends(require_login)):
    if request.query_params.get("scope", "day") == "day":
        return await forward(request, authz, "GET", "/export")
    return await forward(request, authz, "GET", "/export", NAMES, timeout=LOGON_LOG_RANGE_TIMEOUT_SECONDS)
