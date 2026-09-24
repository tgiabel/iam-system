"""SOFA-Proxy der Zeitkorrektur: Der Bearbeiter kommt immer aus der Sitzung, nie aus dem Browser."""
from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import Response

from app.api_client import api_client
from app.authz import AuthorizationContext, require_permission

router = APIRouter(prefix="/time-corrections")
PERMISSION = "SOFA-TOOL-ZK"
# Genesys-GUID; das Muster verhindert, dass ein Pfadsegment wie ".." den SD-API-Pfad verlässt.
GENESYS_USER_ID = Path(pattern=r"^[A-Za-z0-9-]{1,64}$")
# Wer anlegt oder zurücknimmt, bestimmt die SD-API aus X-User-Id. Solche Felder aus dem Browser fallen weg.
ACTOR_FIELDS = ("created_by", "revoked_by")

require_tool = require_permission(PERMISSION)


def without_actor_fields(payload):
    if not isinstance(payload, dict):
        return payload
    body = {key: value for key, value in payload.items() if key not in ACTOR_FIELDS}
    if isinstance(body.get("create"), list):
        body["create"] = [
            {key: value for key, value in item.items() if key not in ACTOR_FIELDS} if isinstance(item, dict) else item
            for item in body["create"]
        ]
    return body


async def forward(request: Request, authz: AuthorizationContext, method: str, path: str) -> Response:
    if not authz.user_id:
        raise HTTPException(status_code=401, detail="Keine aktive Identität.")
    try:
        payload = without_actor_fields(await request.json()) if method == "POST" else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiger JSON-Body.") from None
    try:
        response = await api_client.time_corrections_request(
            method,
            path,
            authz.user_id,
            params=request.query_params.multi_items(),
            payload=payload,
        )
    except httpx.HTTPStatusError as exc:
        response = exc.response
    except Exception:
        raise HTTPException(status_code=502, detail="Zeitkorrektur-Daten konnten nicht geladen werden.") from None
    return Response(content=response.content, status_code=response.status_code,
                    media_type=response.headers.get("content-type", "application/json"),
                    headers={"Cache-Control": "no-store"})


def day_path(business_date: date, user_id: str) -> str:
    return f"/days/{business_date.isoformat()}/users/{user_id}"


@router.get("/days")
async def days(request: Request, authz=Depends(require_tool)):
    return await forward(request, authz, "GET", "/days")


@router.get("/users")
async def users(request: Request, authz=Depends(require_tool)):
    return await forward(request, authz, "GET", "/users")


# Mitarbeiter mit Buchung am Tag samt Log- und Pausenzeit (Anforderung A2 an die SD-API).
@router.get("/days/{business_date}/users")
async def day_users(request: Request, business_date: date, authz=Depends(require_tool)):
    return await forward(request, authz, "GET", f"/days/{business_date.isoformat()}/users")


@router.get("/days/{business_date}/users/{user_id}")
async def day_view(request: Request, business_date: date, user_id: str = GENESYS_USER_ID, authz=Depends(require_tool)):
    return await forward(request, authz, "GET", day_path(business_date, user_id))


@router.post("/days/{business_date}/users/{user_id}/preview")
async def preview(request: Request, business_date: date, user_id: str = GENESYS_USER_ID, authz=Depends(require_tool)):
    return await forward(request, authz, "POST", day_path(business_date, user_id) + "/preview")


@router.post("/days/{business_date}/users/{user_id}")
async def save(request: Request, business_date: date, user_id: str = GENESYS_USER_ID, authz=Depends(require_tool)):
    return await forward(request, authz, "POST", day_path(business_date, user_id))
