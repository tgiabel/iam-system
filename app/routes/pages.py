from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Cookie, Depends, Form, Request  # type: ignore
from fastapi.responses import HTMLResponse, RedirectResponse  # type: ignore

from app.agent_stats_token import is_configured, issue, verify
from app.api_client import api_client
from app.authz import (
    build_authorization_context_from_user,
    require_admin_access,
    require_any_permission,
    require_login,
    require_permission,
    get_current_user,
)
from app.dashboard import build_dashboard_context
from app.login_errors import login_error_message
from app.workspace_catalog import visible_items
from app.routes.shared import _build_session_user_from_login, _build_template_context, templates


router = APIRouter()
logger = logging.getLogger("uvicorn.error")


def _request_uses_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        primary_proto = forwarded_proto.split(",")[0].strip().lower()
        return primary_proto == "https"
    return request.url.scheme.lower() == "https"


@router.get("/", response_class=HTMLResponse)
def index(
    request: Request,
    sofa_user: str | None = Cookie(default=None),
    sofa_agent_stats: str | None = Cookie(default=None),
    mock: str | None = None,
):
    user = get_current_user(sofa_user)
    extra = {}
    if user:
        authz = build_authorization_context_from_user(user, user.get("sofa_permissions"))
        extra = build_dashboard_context(authz, sofa_agent_stats or "", mock)
    return templates.TemplateResponse("dashboard.html", _build_template_context(request, user=user, **extra))


@router.get("/login", name="login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", _build_template_context(request))


@router.post("/login")
async def login(request: Request, pnr: str = Form(...), password: str = Form(...)):
    try:
        user_data = await api_client.login_user(pnr, password)
        session_user = await _build_session_user_from_login(user_data)
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status is None or status >= 500:
            logger.warning("Login fehlgeschlagen: %r", exc, exc_info=exc)
        flash_messages = [("failure", login_error_message(exc))]
        return templates.TemplateResponse(
            "login.html",
            _build_template_context(request, flash_messages=flash_messages, pnr=pnr),
        )

    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(
        key="sofa_user",
        value=json.dumps(session_user),
        httponly=True,
        max_age=3600 * 8,
        samesite="lax",
        secure=_request_uses_https(request),
    )
    # Eigene Identitaet fuer den Selbstreport. Ein fehlendes Secret laesst den
    # Report geschlossen, ohne bestehende SOFA-Anmeldungen zu unterbrechen.
    if isinstance(session_user.get("user_id"), int):
        try:
            signed = issue(session_user["user_id"])
        except RuntimeError:
            signed = None
        if signed:
            response.set_cookie(
                key="sofa_agent_stats", value=signed, httponly=True,
                max_age=3600 * 8, samesite="lax", secure=_request_uses_https(request),
            )
    return response


@router.get("/logout")
def logout(request: Request):
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie(
        "sofa_user",
        samesite="lax",
        secure=_request_uses_https(request),
    )
    response.delete_cookie(
        "sofa_agent_stats", samesite="lax", secure=_request_uses_https(request),
    )
    return response


@router.get("/tasks", response_class=HTMLResponse)
def tasks(request: Request, authz=Depends(require_permission("SOFA-PAGE-TODO", redirect_to="/"))):
    return templates.TemplateResponse("tasks.html", _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/workspace", response_class=HTMLResponse)
def workspace(request: Request, authz=Depends(require_login)):
    if not authz.has_any_tool() and not authz.has_admin_access():
        return RedirectResponse(url="/", status_code=303)
    sections = visible_items(authz, is_configured())
    return templates.TemplateResponse("tools.html", _build_template_context(
        request, user=authz.raw_user, authz=authz,
        workspace_tools=sections["tools"], workspace_reports=sections["reports"]))


# Alte Adressen vor /workspace und /reports. Bewusst temporaer (307): ein Browser merkt sich
# die Umleitung nicht, nach einem Rollback funktionieren die alten Pfade also wieder direkt.
LEGACY_REPORT_SLUGS = (
    "genesys-live", "agent-stats", "iks", "ivr-call-details",
    "presence-report", "token-deletion-report", "logon-log",
)


def _redirect_keeping_query(request: Request, path: str) -> RedirectResponse:
    query = request.url.query
    return RedirectResponse(url=f"{path}?{query}" if query else path, status_code=307)


@router.get("/tools", include_in_schema=False)
async def legacy_workspace(request: Request):
    return _redirect_keeping_query(request, "/workspace")


async def _legacy_report(request: Request):
    return _redirect_keeping_query(request, "/reports/" + request.url.path.rsplit("/", 1)[-1])


for _slug in LEGACY_REPORT_SLUGS:
    router.add_api_route(f"/tools/{_slug}", _legacy_report, methods=["GET"], include_in_schema=False)


@router.get("/reports/agent-stats", response_class=HTMLResponse)
def agent_stats_report(request: Request, authz=Depends(require_login)):
    if not is_configured():
        return RedirectResponse(url="/workspace", status_code=303)
    try:
        signed_user_id = verify(request.cookies.get("sofa_agent_stats", ""))
    except (ValueError, RuntimeError):
        signed_user_id = None
    if signed_user_id != authz.user_id:
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse("reports/agent_stats_report.html",
                                      _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/reports/genesys-live", response_class=HTMLResponse)
def genesys_live_page(request: Request, authz=Depends(require_login)):
    if not is_configured():
        return RedirectResponse(url="/workspace", status_code=303)
    try:
        signed_user_id = verify(request.cookies.get("sofa_agent_stats", ""))
    except (ValueError, RuntimeError):
        signed_user_id = None
    if signed_user_id != authz.user_id:
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse("reports/genesys_live.html",
                                      _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/console", response_class=HTMLResponse)
def console(request: Request, authz=Depends(require_permission("SOFA-PAGE-CNSL", redirect_to="/"))):
    return templates.TemplateResponse("console.html", _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/users", response_class=HTMLResponse)
async def users(request: Request, authz=Depends(require_permission("SOFA-PAGE-USER", redirect_to="/"))):
    return templates.TemplateResponse(
        "userverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/systems", response_class=HTMLResponse)
async def systems(request: Request, authz=Depends(require_permission("SOFA-PAGE-SYS", redirect_to="/"))):
    return templates.TemplateResponse(
        "systemverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/systems/{system_id}", response_class=HTMLResponse)
async def system_details(request: Request, system_id: str, authz=Depends(require_permission("SOFA-PAGE-SYS", redirect_to="/"))):
    return templates.TemplateResponse(
        "systemdetails.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, system_id=system_id),
    )


@router.get("/computers", response_class=HTMLResponse)
async def computers(
    request: Request,
    authz=Depends(require_permission("SOFA-PAGE-COMPUTER", redirect_to="/")),
):
    return templates.TemplateResponse(
        "rechnerverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/roles", response_class=HTMLResponse)
async def roles(request: Request, authz=Depends(require_permission("SOFA-PAGE-ROLE", redirect_to="/"))):
    return templates.TemplateResponse(
        "rollenmanagement.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/roles/{role_id}", response_class=HTMLResponse)
async def role_details(request: Request, role_id: str, authz=Depends(require_permission("SOFA-PAGE-ROLE", redirect_to="/"))):
    return templates.TemplateResponse(
        "rollendetails.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, role_id=role_id),
    )


@router.get("/iks")
async def iks(request: Request):
    return RedirectResponse(url="/reports/iks", status_code=307)


@router.get("/reports/iks", response_class=HTMLResponse)
async def iks_tool(request: Request, authz=Depends(require_permission("SOFA-TOOL-IKS", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "tools/iks_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/tools/datex", response_class=HTMLResponse)
async def datex_tool(request: Request, authz=Depends(require_permission("SOFA-TOOL-DATX", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "tools/datex_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/tools/request-templates", response_class=HTMLResponse)
async def request_templates_tool(request: Request, authz=Depends(require_permission("SOFA-TOOL-FORM", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "tools/request_templates_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )

@router.get("/tools/genesys-queue-manager", response_class=HTMLResponse)
async def genesys_queue_manager_tool(request: Request, authz=Depends(require_permission("SOFA-TOOL-GQ", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "tools/genesys_queue_manager_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/tools/zeitkorrektur", response_class=HTMLResponse)
async def time_correction_tool(request: Request, authz=Depends(require_permission("SOFA-TOOL-ZK", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "tools/time_correction_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/tools/stoerungsprotokoll", response_class=HTMLResponse)
async def stoerungsprotokoll_tool(request: Request, authz=Depends(require_permission("SOFA-TOOL-SLOG", redirect_to="/workspace"))):
    try:
        incidents = await api_client.list_incidents(authz)
    except Exception:
        incidents = []
    return templates.TemplateResponse(
        "tools/stoerungsprotokoll_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, incidents=incidents),
    )


@router.get("/tools/stoerungsprotokoll/{incident_id}", response_class=HTMLResponse)
async def stoerungsprotokoll_detail(request: Request, incident_id: str, authz=Depends(require_permission("SOFA-TOOL-SLOG", redirect_to="/tools/stoerungsprotokoll"))):
    try:
        incident = await api_client.get_incident(authz, incident_id)
    except Exception:
        incident = None
    return templates.TemplateResponse(
        "tools/stoerungsprotokoll_detail.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, incident=incident),
    )


@router.get("/tools/media-blocking", response_class=HTMLResponse)
async def media_blocking_tool(request: Request, authz=Depends(require_admin_access(redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "tools/media_blocking_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/reports/ivr-call-details", response_class=HTMLResponse)
async def ivr_call_details_tool(request: Request, authz=Depends(require_permission("SOFA-RPRT-TIVR", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "reports/ivr_call_details.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/reports/presence-report", response_class=HTMLResponse)
async def presence_report_tool(request: Request, authz=Depends(require_permission("SOFA-RPRT-PRSNC", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "reports/presence_report.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/reports/token-deletion-report", response_class=HTMLResponse)
async def token_deletion_report_tool(
    request: Request, authz=Depends(require_permission("SOFA-RPRT-PRSNC", redirect_to="/workspace"))
):
    return templates.TemplateResponse(
        "reports/token_deletions_report.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/reports/logon-log", response_class=HTMLResponse)
async def logon_log_tool(request: Request, authz=Depends(require_permission("SOFA-RPRT-LL", redirect_to="/workspace"))):
    return templates.TemplateResponse(
        "reports/logon_log.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )
