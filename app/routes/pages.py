from __future__ import annotations

import json
import logging
import secrets

from fastapi import APIRouter, Depends, Form, Request  # type: ignore
from fastapi.responses import HTMLResponse, RedirectResponse  # type: ignore

from app.api_client import api_client
from app.authz import (
    require_admin_access,
    require_login,
    require_permission,
    get_current_user,
)
from app import tasks_board_mock
from app.dashboard import build_dashboard_context
from app.helpers.time_utils import today_local
from app.login_errors import FORM_EXPIRED, MISSING_FIELDS, NOTICES
from app.session import (
    LOGIN_CSRF_COOKIE,
    LOGIN_CSRF_MAX_AGE,
    clear_session_cookie,
    request_session,
    safe_next,
    set_session_cookie,
    tokens_match,
)
from app.session_gate import same_origin
from app.routes.session_api import LoginRejected, open_session
from app.workspace_catalog import visible_items
from app.routes.shared import _build_template_context, templates


router = APIRouter()
logger = logging.getLogger("uvicorn.error")


@router.get("/", response_class=HTMLResponse)
def index(request: Request, authz=Depends(require_login), mock: str | None = None):
    extra = build_dashboard_context(authz, mock)
    return templates.TemplateResponse(
        "dashboard.html", _build_template_context(request, user=authz.raw_user, authz=authz, **extra))


def _login_page(request: Request, *, next_path: str = "/", pnr: str = "", error: str | None = None,
                credentials_error: bool = False, notice: str | None = None, notice_kind: str | None = None,
                status_code: int = 200) -> HTMLResponse:
    """Loginseite mit frischem Login-CSRF-Token (Cookie und Formularfeld)."""
    csrf_token = secrets.token_urlsafe(32)
    response = templates.TemplateResponse(
        "login.html",
        {"request": request, "csrf_token": csrf_token, "next_path": next_path, "pnr": pnr,
         "error": error, "credentials_error": credentials_error, "notice": notice, "notice_kind": notice_kind},
        status_code=status_code,
    )
    response.set_cookie(LOGIN_CSRF_COOKIE, csrf_token, max_age=LOGIN_CSRF_MAX_AGE, path="/",
                        secure=True, httponly=True, samesite="strict")
    return response


@router.get("/login", name="login", response_class=HTMLResponse)
def login_page(request: Request, next: str | None = None, reason: str | None = None):
    next_path = safe_next(next)
    if get_current_user(request):
        return RedirectResponse(url=next_path, status_code=303)
    problem = getattr(request.state, "session_problem", None)
    if problem == "unavailable":
        return _login_page(request, next_path=next_path, error=NOTICES["unavailable"], status_code=503)
    kind = reason or problem or ""
    return _login_page(request, next_path=next_path, notice=NOTICES.get(kind),
                       notice_kind="success" if kind == "logged_out" else None)


@router.post("/login")
async def login(
    request: Request,
    pnr: str = Form(""),
    password: str = Form(""),
    csrf_token: str = Form(""),
    next: str = Form("/"),
):
    next_path = safe_next(next)
    pnr = pnr.strip()
    if not same_origin(request) or not tokens_match(request.cookies.get(LOGIN_CSRF_COOKIE), csrf_token):
        return _login_page(request, next_path=next_path, pnr=pnr, error=FORM_EXPIRED, status_code=403)
    if not pnr or not password:
        return _login_page(request, next_path=next_path, pnr=pnr, error=MISSING_FIELDS, status_code=400)

    try:
        result = await open_session(request, pnr, password)
    except LoginRejected as rejected:
        failure = rejected.failure
        return _login_page(request, next_path=next_path, pnr=pnr, error=failure.message,
                           credentials_error=failure.code == "invalid_credentials", status_code=failure.status)

    response = RedirectResponse(url=next_path, status_code=303)
    set_session_cookie(response, result["session"])
    response.delete_cookie(LOGIN_CSRF_COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    return response


@router.post("/logout")
async def logout(request: Request, csrf_token: str = Form("")):
    """Widerruf bei SD-API, dann Cookie loeschen. Ohne gueltige Sitzung nur aufraeumen."""
    state = request_session(request)
    if state is not None:
        if not tokens_match(state.csrf_token, csrf_token):
            return RedirectResponse(url="/", status_code=303)
        try:
            await api_client.session_logout()
        except Exception as exc:
            # Cookie wird trotzdem geloescht; die Sitzung laeuft dann serverseitig regulaer ab.
            logger.warning("Logout bei SD-API fehlgeschlagen: %r", exc)
    response = RedirectResponse(url="/login?reason=logged_out", status_code=303)
    clear_session_cookie(response)
    return response


@router.get("/tasks", response_class=HTMLResponse)
def tasks(
    request: Request,
    mock: str | None = None,
    authz=Depends(require_permission("SOFA-PAGE-TODO", redirect_to="/")),
):
    user = authz.raw_user or {}
    me = {"user_id": authz.user_id, "name": " ".join(part for part in (user.get("first_name"), user.get("last_name")) if part)}
    # Die Aufgaben laedt das Board selbst; nur der Mock (Entwicklungsinstanz) bringt sie mit.
    scenario = tasks_board_mock.mock_scenario(mock)
    board = tasks_board_mock.mock_board(scenario, me) if scenario else {"me": me, "today": today_local().isoformat()}
    board["mock"] = scenario
    # "</" escapen, damit der JSON-Block das <script>-Element nicht beenden kann.
    board_json = json.dumps(board, ensure_ascii=False).replace("</", "<\\/")
    return templates.TemplateResponse(
        "tasks_board.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, board_json=board_json, board_mock=scenario),
    )


@router.get("/workspace", response_class=HTMLResponse)
def workspace(request: Request, authz=Depends(require_login)):
    # Fuer alle Angemeldeten: der persoenliche Genesys-Report liegt hier.
    sections = visible_items(authz)
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
    return templates.TemplateResponse("reports/agent_stats_report.html",
                                      _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/reports/genesys-live", response_class=HTMLResponse)
def genesys_live_page(request: Request, authz=Depends(require_login)):
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
