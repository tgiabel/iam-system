import json

from fastapi import APIRouter, Cookie, Depends, Form, Request  # type: ignore
from fastapi.responses import HTMLResponse, RedirectResponse  # type: ignore

from app.api_client import api_client
from app.authz import (
    require_login,
    require_page_access,
    get_current_user,
)
from app.routes.shared import _build_session_user_from_login, _build_template_context, templates


router = APIRouter()


def _request_uses_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        primary_proto = forwarded_proto.split(",")[0].strip().lower()
        return primary_proto == "https"
    return request.url.scheme.lower() == "https"


@router.get("/", response_class=HTMLResponse)
def index(request: Request, sofa_user: str | None = Cookie(default=None)):
    user = get_current_user(sofa_user)
    return templates.TemplateResponse("dashboard.html", _build_template_context(request, user=user))


@router.get("/login", name="login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", _build_template_context(request))


@router.post("/login")
async def login(request: Request, pnr: str = Form(...), password: str = Form(...)):
    try:
        user_data = await api_client.login_user(pnr, password)
        session_user = await _build_session_user_from_login(user_data)
    except Exception as exc:
        flash_messages = [("failure", str(exc))]
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
    return response


@router.get("/logout")
def logout(request: Request):
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie(
        "sofa_user",
        samesite="lax",
        secure=_request_uses_https(request),
    )
    return response


@router.get("/tasks", response_class=HTMLResponse)
def tasks(request: Request, authz=Depends(require_login)):
    return templates.TemplateResponse("tasks.html", _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/tools", response_class=HTMLResponse)
def tools(request: Request, authz=Depends(require_login)):
    return templates.TemplateResponse("tools.html", _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/console", response_class=HTMLResponse)
def console(request: Request, authz=Depends(require_page_access("console", redirect_to="/"))):
    return templates.TemplateResponse("console.html", _build_template_context(request, user=authz.raw_user, authz=authz))


@router.get("/users", response_class=HTMLResponse)
async def users(request: Request, authz=Depends(require_page_access("users", redirect_to="/"))):
    return templates.TemplateResponse(
        "userverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/systems", response_class=HTMLResponse)
async def systems(request: Request, authz=Depends(require_page_access("systems", redirect_to="/"))):
    return templates.TemplateResponse(
        "systemverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/systems/{system_id}", response_class=HTMLResponse)
async def system_details(request: Request, system_id: str, authz=Depends(require_page_access("systems", redirect_to="/"))):
    return templates.TemplateResponse(
        "systemdetails.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, system_id=system_id),
    )


@router.get("/roles", response_class=HTMLResponse)
async def roles(request: Request, authz=Depends(require_page_access("roles", redirect_to="/"))):
    return templates.TemplateResponse(
        "rollenmanagement.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/roles/{role_id}", response_class=HTMLResponse)
async def role_details(request: Request, role_id: str, authz=Depends(require_page_access("roles", redirect_to="/"))):
    return templates.TemplateResponse(
        "rollendetails.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, role_id=role_id),
    )


@router.get("/iks", response_class=HTMLResponse)
async def iks(request: Request, authz=Depends(require_page_access("iks", redirect_to="/"))):
    return templates.TemplateResponse(
        "iks.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/tools/iks", response_class=HTMLResponse)
async def iks_tool(request: Request, authz=Depends(require_page_access("iks", redirect_to="/"))):
    return templates.TemplateResponse(
        "tools/iks_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@router.get("/tools/datex", response_class=HTMLResponse)
async def datex_tool(request: Request, authz=Depends(require_login)):
    return templates.TemplateResponse(
        "tools/datex_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )
