from functools import wraps
from datetime import date
from fastapi import FastAPI, Request, Cookie, Depends, Form, File, UploadFile    # type: ignore
from fastapi.templating import Jinja2Templates                  # type: ignore
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, StreamingResponse    # type: ignore
from fastapi.staticfiles import StaticFiles                     # type: ignore
from fastapi.exceptions import HTTPException                    # type: ignore
import httpx # type: ignore
from app.api_client import api_client
from app.authz import (
    AuthorizationContext,
    build_authorization_context_from_user,
    get_authz_payload_for_template,
    get_current_user,
    require_any_page_access,
    require_capability,
    require_login,
    require_page_access,
)
from app.helpers.datex import build_datex_export
import os
import json

base_dir = os.path.dirname(os.path.abspath(__file__))
static_path = os.path.join(base_dir, "static")


def _first_defined_value(record: dict, keys: list[str], fallback=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return fallback


def _normalize_text(value) -> str:
    return str(value or "").strip().lower()


def _error_content_from_response(response: httpx.Response) -> dict:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            return payload
        return {"detail": payload}
    except Exception:
        return {"detail": response.text or "Unbekannter Fehler"}


def _coerce_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        return None


def _coerce_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    normalized = _normalize_text(value)
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _normalize_session_role(role: dict | None, *, default_type: str | None = None) -> dict | None:
    if not isinstance(role, dict):
        return None

    role_id = _coerce_int(role.get("role_id", role.get("id")))
    if role_id is None:
        return None

    assignment_status = str(role.get("assignment_status") or role.get("status") or "").strip().upper()
    is_assignment_active = assignment_status in {"", "ACTIVE"}

    return {
        "role_id": role_id,
        "name": str(role.get("name") or role.get("role_name") or "").strip(),
        "role_type": str(role.get("role_type") or role.get("type") or default_type or "").strip().upper(),
        "assignment_status": assignment_status,
        "process_id": _coerce_int(role.get("process_id")),
        "is_active": bool(role.get("is_active", role.get("active", True))) and is_assignment_active,
    }


def _normalize_session_user(user_data: dict | None) -> dict:
    payload = dict(user_data or {})
    primary_role = _normalize_session_role(payload.get("primary_role"), default_type="PRIMARY")

    secondary_roles = []
    for role in payload.get("secondary_roles") or []:
        normalized_role = _normalize_session_role(role, default_type="SECONDARY")
        if normalized_role and normalized_role["is_active"]:
            secondary_roles.append(normalized_role)

    payload["user_id"] = _coerce_int(payload.get("user_id"))
    payload["pnr"] = str(payload.get("pnr") or "").strip()
    payload["first_name"] = str(payload.get("first_name") or "").strip()
    payload["last_name"] = str(payload.get("last_name") or "").strip()
    payload["racf"] = str(payload.get("racf") or "").strip()
    payload["is_active"] = bool(payload.get("is_active", True))
    payload["primary_role"] = primary_role if primary_role and primary_role["is_active"] else None
    payload["secondary_roles"] = secondary_roles
    return payload


def _is_canonical_session_user(user_data: dict | None) -> bool:
    if not isinstance(user_data, dict):
        return False
    return (
        _coerce_int(user_data.get("user_id")) is not None
        and isinstance(user_data.get("primary_role"), dict)
        and isinstance(user_data.get("secondary_roles"), list)
    )


async def _build_session_user_from_login(login_payload: dict) -> dict:
    if _is_canonical_session_user(login_payload):
        return _normalize_session_user(login_payload)

    user_id = _coerce_int(login_payload.get("user_id"))
    if user_id is None:
        return _normalize_session_user(login_payload)

    try:
        current_user = await api_client.get_current_user(user_id)
    except Exception:
        return _normalize_session_user(login_payload)

    return _normalize_session_user(current_user)


def _task_matches_target_user(task: dict, user_id: int, user_detail: dict) -> bool:
    full_name = _normalize_text(f"{user_detail.get('first_name', '')} {user_detail.get('last_name', '')}")
    user_pnr = _normalize_text(user_detail.get("pnr"))

    target_user_id = _first_defined_value(task, ["target_user_id", "user_id", "for_user_id"])
    if str(target_user_id or "") == str(user_id):
        return True

    target_pnr = _first_defined_value(task, ["target_user_pnr", "user_pnr", "pnr"])
    if user_pnr and _normalize_text(target_pnr) == user_pnr:
        return True

    target_name = _first_defined_value(task, ["target_user_name", "user_name", "target_name"])
    if full_name and _normalize_text(target_name) == full_name:
        return True

    return False


def _task_matches_initiator(task: dict, user_id: int, user_detail: dict) -> bool:
    full_name = _normalize_text(f"{user_detail.get('first_name', '')} {user_detail.get('last_name', '')}")

    initiator_user_id = _first_defined_value(task, ["initiator_user_id", "created_by_user_id", "triggered_by_user_id"])
    if str(initiator_user_id or "") == str(user_id):
        return True

    initiator_name = _first_defined_value(task, ["initiator_name", "triggered_by_name", "created_by_name", "initiator_user_name"])
    if full_name and _normalize_text(initiator_name) == full_name:
        return True

    return False


def _summarize_process(process_id: str, tasks: list[dict]) -> dict:
    sorted_tasks = sorted(
        tasks,
        key=lambda task: str(_first_defined_value(task, ["created_at", "started_at", "completed_at"], "")),
        reverse=True
    )
    head = sorted_tasks[0] if sorted_tasks else {}
    statuses = {_normalize_text(task.get("status")) for task in tasks}

    if "in_progress" in statuses:
        process_status = "in_progress"
    elif "open" in statuses:
        process_status = "requested"
    elif statuses:
        process_status = sorted(statuses)[0]
    else:
        process_status = "active"

    return {
        "process_id": process_id,
        "process_name": _first_defined_value(head, ["process_name", "name", "process_type", "type"], "Prozess"),
        "process_type": _first_defined_value(head, ["process_type", "type"], "process"),
        "status": process_status,
        "target_name": _first_defined_value(head, ["target_user_name", "user_name", "target_name"], "-"),
        "initiator_name": _first_defined_value(head, ["initiator_name", "triggered_by_name", "created_by_name", "initiator_user_name"], "-"),
        "started_at": _first_defined_value(head, ["started_at", "created_at"], None),
        "completed_at": _first_defined_value(head, ["completed_at", "finished_at"], None),
        "task_count": len(tasks)
    }


def _summarize_task_action(task: dict) -> dict:
    return {
        "task_id": task.get("task_id"),
        "action": "completed",
        "action_label": "Erledigt",
        "task_type": task.get("task_type"),
        "status": _normalize_text(task.get("status")) or "completed",
        "process_id": task.get("process_id"),
        "resource_name": task.get("resource_name"),
        "completed_at": _first_defined_value(task, ["completed_at", "updated_at", "created_at"], None)
    }


def _extract_event_records(payload) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if isinstance(payload, dict):
        for key in ("events", "items", "results", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]

    return []


def _normalize_event_record(event: dict) -> dict:
    scheduled_at = _first_defined_value(event, ["scheduled_at", "scheduled_for", "planned_at"], None)
    executed_at = _first_defined_value(event, ["executed_at", "processed_at", "last_processed_at"], None)
    display_at = scheduled_at or executed_at

    return {
        "title": str(_first_defined_value(event, ["title", "event_title", "name"], "") or "").strip(),
        "description": str(_first_defined_value(event, ["description", "detail", "message"], "") or "").strip(),
        "event_type": str(_first_defined_value(event, ["event_type", "type"], "") or "").strip().upper(),
        "event_status": str(_first_defined_value(event, ["event_status", "status"], "") or "").strip().upper(),
        "blocks_process_completion": _coerce_bool(event.get("blocks_process_completion")),
        "scheduled_at": scheduled_at,
        "executed_at": executed_at,
        "display_at": display_at,
        "user_id": _coerce_int(_first_defined_value(event, ["user_id", "target_user_id"])),
        "process_id": _coerce_int(event.get("process_id")),
        "role_id": _coerce_int(event.get("role_id")),
    }


def _normalize_events_payload(payload) -> list[dict]:
    return [_normalize_event_record(event) for event in _extract_event_records(payload)]


def _get_task_backlog_id(task: dict) -> int | None:
    return _coerce_int(_first_defined_value(task, ["backlog_id"]))


def _task_backlog_is_visible_to_user(task: dict, authz: AuthorizationContext) -> bool:
    backlog_id = _get_task_backlog_id(task)

    if authz.can_view_all_task_backlogs:
        return True

    if not authz.visible_task_backlog_ids:
        # Uebergangsmodus: Solange fuer die Rolle noch keine lokalen Backlog-IDs gepflegt sind,
        # bleibt das bisherige Verhalten erhalten.
        return True

    if backlog_id is None:
        return False

    return backlog_id in authz.visible_task_backlog_ids


def _build_template_context(
    request: Request,
    user: dict | None = None,
    authz: AuthorizationContext | None = None,
    **extra,
) -> dict:
    resolved_authz = authz or (build_authorization_context_from_user(user) if user else None)
    context = {
        "request": request,
        "user": user,
        "authz": get_authz_payload_for_template(resolved_authz),
    }
    context.update(extra)
    return context


def _task_is_relevant_to_user(task: dict, authz: AuthorizationContext) -> bool:
    user_id = authz.user_id
    user_detail = authz.raw_user

    assigned_user_id = _first_defined_value(task, ["assigned_to_user_id", "assigned_user_id"])
    if str(assigned_user_id or "") == str(user_id):
        return True

    if _task_matches_target_user(task, user_id, user_detail):
        return True

    if _task_matches_initiator(task, user_id, user_detail):
        return True

    return False


def _task_is_visible_to_user(task: dict, authz: AuthorizationContext) -> bool:
    if not _task_backlog_is_visible_to_user(task, authz):
        return False

    if authz.get_scope("tasks") != "relevant_only":
        return True

    return _task_is_relevant_to_user(task, authz)


def _filter_tasks_for_scope(tasks: list[dict], authz: AuthorizationContext) -> list[dict]:
    return [task for task in tasks if _task_is_visible_to_user(task, authz)]


def _process_is_relevant_to_user(process: dict, authz: AuthorizationContext) -> bool:
    user_id = authz.user_id
    user_detail = authz.raw_user
    full_name = _normalize_text(f"{user_detail.get('first_name', '')} {user_detail.get('last_name', '')}")
    user_pnr = _normalize_text(user_detail.get("pnr"))

    target_user_id = _first_defined_value(process, ["target_user_id", "user_id", "for_user_id"])
    if str(target_user_id or "") == str(user_id):
        return True

    initiator_user_id = _first_defined_value(process, ["initiator_user_id", "created_by_user_id", "triggered_by_user_id"])
    if str(initiator_user_id or "") == str(user_id):
        return True

    target_name = _normalize_text(_first_defined_value(process, ["target_name", "target_user_name", "user_name"], ""))
    if full_name and target_name == full_name:
        return True

    initiator_name = _normalize_text(_first_defined_value(process, ["initiator_name", "triggered_by_name", "created_by_name"], ""))
    if full_name and initiator_name == full_name:
        return True

    target_pnr = _normalize_text(_first_defined_value(process, ["target_user_pnr", "user_pnr", "pnr"], ""))
    if user_pnr and target_pnr == user_pnr:
        return True

    return False


def _filter_processes_for_scope(processes: list[dict], authz: AuthorizationContext) -> list[dict]:
    if authz.get_scope("tasks") != "relevant_only":
        return processes
    return [process for process in processes if _process_is_relevant_to_user(process, authz)]


async def _get_relevant_task_or_raise(task_id: int, authz: AuthorizationContext) -> dict:
    tasks = await api_client.list_tasks()
    for task in tasks:
        if str(task.get("task_id")) != str(task_id):
            continue
        if _task_is_visible_to_user(task, authz):
            return task

    raise HTTPException(
        status_code=403,
        detail={"code": "task_scope_denied", "message": "Kein Zugriff auf diesen Task oder dessen Backlog."},
    )

# ------------------------------
# Templates
# ------------------------------
templates = Jinja2Templates(directory=os.path.join(base_dir, "templates"))

# ------------------------------
# FastAPI App
# ------------------------------
app = FastAPI(title="SOFA Frontend")
app.mount("/static", StaticFiles(directory=static_path), name="static")

# ------------------------------
# Decorator für geschützte Routen
# ------------------------------
def login_required(func):
    @wraps(func)
    async def wrapper(request: Request, *args, sofa_user: str | None = Cookie(default=None), **kwargs):
        user = get_current_user(sofa_user)
        if not user:
            return RedirectResponse(url="/login", status_code=303)
        return await func(request, *args, user=user, **kwargs)
    return wrapper

# ------------------------------
# Offene Route: Dashboard
# ------------------------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request, sofa_user: str | None = Cookie(default=None)):
    user = get_current_user(sofa_user)
    return templates.TemplateResponse("dashboard.html", _build_template_context(request, user=user))

# ------------------------------
# Login / Logout (Overlay möglich)
# ------------------------------
@app.get("/login", name="login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", _build_template_context(request))

@app.post("/login")
async def login(request: Request, pnr: str = Form(...), password: str = Form(...)):
    try:
        user_data = await api_client.login_user(pnr, password)
        session_user = await _build_session_user_from_login(user_data)
    except Exception as e:
        flash_messages = [("failure", str(e))]
        return templates.TemplateResponse(
            "login.html",
            _build_template_context(request, flash_messages=flash_messages, pnr=pnr)
        )

    # Erfolgreiches Login → Cookie setzen
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(
        key="sofa_user",
        value=json.dumps(session_user),
        httponly=True,
        max_age=3600*8
    )
    return response

@app.get("/logout")
def logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("sofa_user")
    return response

# ------------------------------
# Beispiel geschützte Route
# ------------------------------
@app.get("/tasks", response_class=HTMLResponse)
def tasks(request: Request, authz=Depends(require_login)):
    return templates.TemplateResponse("tasks.html", _build_template_context(request, user=authz.raw_user, authz=authz))

@app.get("/tools", response_class=HTMLResponse)
def tools(request: Request, authz=Depends(require_login)):
    return templates.TemplateResponse("tools.html", _build_template_context(request, user=authz.raw_user, authz=authz))

@app.get("/console", response_class=HTMLResponse)
def console(request: Request, authz=Depends(require_page_access("console", redirect_to="/"))):
    return templates.TemplateResponse("console.html", _build_template_context(request, user=authz.raw_user, authz=authz))

# ------------------------------
# Userverwaltung-Seite
# ------------------------------
@app.get("/users", response_class=HTMLResponse)
async def users(request: Request, authz=Depends(require_page_access("users", redirect_to="/"))):
    return templates.TemplateResponse(
        "userverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )

# ------------------------------
# Systemverwaltung-Seite
# ------------------------------
@app.get("/systems", response_class=HTMLResponse)
async def systems(request: Request, authz=Depends(require_page_access("systems", redirect_to="/"))):
    return templates.TemplateResponse(
        "systemverwaltung.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )

# ------------------------------
# System-Detail-Seite
# ------------------------------
@app.get("/systems/{system_id}", response_class=HTMLResponse)
async def system_details(request: Request, system_id: str, authz=Depends(require_page_access("systems", redirect_to="/"))):
    return templates.TemplateResponse(
        "systemdetails.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, system_id=system_id),
    )

# ------------------------------
# Rollenmanagement-Seite
# ------------------------------
@app.get("/roles", response_class=HTMLResponse)
async def roles(request: Request, authz=Depends(require_page_access("roles", redirect_to="/"))):
    return templates.TemplateResponse(
        "rollenmanagement.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )

@app.get("/roles/{role_id}", response_class=HTMLResponse)
async def role_details(request: Request, role_id: str, authz=Depends(require_page_access("roles", redirect_to="/"))):
    return templates.TemplateResponse(
        "rollendetails.html",
        _build_template_context(request, user=authz.raw_user, authz=authz, role_id=role_id),
    )

@app.get("/iks", response_class=HTMLResponse)
async def iks(request: Request, authz=Depends(require_page_access("iks", redirect_to="/"))):
    return templates.TemplateResponse(
        "iks.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )

@app.get("/tools/iks", response_class=HTMLResponse)
async def iks_tool(request: Request, authz=Depends(require_page_access("iks", redirect_to="/"))):
    return templates.TemplateResponse(
        "tools/iks_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz),
    )


@app.get("/tools/datex", response_class=HTMLResponse)
async def datex_tool(request: Request, authz=Depends(require_login)):
    return templates.TemplateResponse(
        "tools/datex_tool.html",
        _build_template_context(request, user=authz.raw_user, authz=authz)
    )


@app.post("/api/tools/datex/convert")
async def convert_datex_file(
    request: Request,
    datfile: UploadFile = File(...),
    authz=Depends(require_login),
):
    try:
        if not datfile.filename:
            return templates.TemplateResponse(
                "tools/datex_tool.html",
                _build_template_context(
                    request,
                    user=authz.raw_user,
                    authz=authz,
                    flash_messages=[("failure", "Bitte waehlen Sie eine DAT-Datei aus.")],
                ),
                status_code=400,
            )

        filename, workbook = build_datex_export(await datfile.read())
    except ValueError as exc:
        return templates.TemplateResponse(
            "tools/datex_tool.html",
            _build_template_context(
                request,
                user=authz.raw_user,
                authz=authz,
                flash_messages=[("failure", str(exc))],
            ),
            status_code=400,
        )
    finally:
        await datfile.close()

    return StreamingResponse(
        workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ------------------------------
# API Routen
# ------------------------------
@app.get("/api/users")
async def api_users(
    is_active: bool = True,
    current_user=Depends(require_page_access("users")),
):
    try:
        users = await api_client.list_users(is_active=is_active)
        if current_user.get_scope("users") == "none":
            return JSONResponse(content=[])
        return JSONResponse(content=users)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/users/{user_id}/details")
async def api_user_details(user_id: int, current_user=Depends(require_page_access("users"))):
    try:
        user_detail = await api_client.get_user_details(user_id)
        return JSONResponse(content=user_detail)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.get("/api/users/{user_id}/activity")
async def api_user_activity(user_id: int, current_user=Depends(require_page_access("users"))):
    try:
        activity = await api_client.get_user_activity(user_id)
        return JSONResponse(content=activity)
    except httpx.HTTPStatusError as e:
        if e.response.status_code != 404:
            return JSONResponse(
                content=e.response.json(),
                status_code=e.response.status_code
            )
    except Exception:
        pass

    try:
        user_detail = await api_client.get_user_details(user_id)
        all_tasks = await api_client.list_tasks()
        completed_tasks = await api_client.list_tasks(status="COMPLETED", assigned_to_user_id=user_id)

        affected_buckets: dict[str, list[dict]] = {}
        initiated_buckets: dict[str, list[dict]] = {}

        for task in all_tasks:
            process_id = str(_first_defined_value(task, ["process_id", "id", "task_id"], "unknown"))

            if _task_matches_target_user(task, user_id, user_detail):
                affected_buckets.setdefault(process_id, []).append(task)

            if _task_matches_initiator(task, user_id, user_detail):
                initiated_buckets.setdefault(process_id, []).append(task)

        affected_processes = [
            _summarize_process(process_id, tasks)
            for process_id, tasks in affected_buckets.items()
        ]
        initiated_processes = [
            _summarize_process(process_id, tasks)
            for process_id, tasks in initiated_buckets.items()
        ]
        recent_task_actions = [
            _summarize_task_action(task)
            for task in sorted(
                completed_tasks,
                key=lambda item: str(_first_defined_value(item, ["completed_at", "updated_at", "created_at"], "")),
                reverse=True
            )[:5]
        ]

        return JSONResponse(content={
            "affected_processes": affected_processes,
            "initiated_processes": initiated_processes,
            "recent_task_actions": recent_task_actions
        })
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.get("/api/events")
async def api_events(current_user=Depends(require_page_access("console"))):
    try:
        events = await api_client.get_events()
        return JSONResponse(content=_normalize_events_payload(events))
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.get("/api/task_backlogs")
async def api_task_backlogs(current_user=Depends(require_login)):
    try:
        backlogs = await api_client.get_task_backlogs()
        return JSONResponse(content=backlogs)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=_error_content_from_response(e.response),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/api/users/{user_id}/sofa-access/setup")
async def api_setup_user_sofa_access(user_id: int, payload: dict, current_user=Depends(require_capability("sofa_access.setup"))):
    try:
        request_payload = {
            "password": payload.get("password"),
            "initiator_user_id": current_user.user_id
        }
        result = await api_client.setup_user_sofa_access(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/api/users/{user_id}/sofa-access/reset-password")
async def api_reset_user_sofa_password(user_id: int, payload: dict, current_user=Depends(require_capability("sofa_access.reset"))):
    try:
        request_payload = {
            "password": payload.get("password"),
            "initiator_user_id": current_user.user_id
        }
        result = await api_client.reset_user_sofa_password(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.post("/api/users/{user_id}/sofa-access/revoke")
async def api_revoke_user_sofa_access(user_id: int, current_user=Depends(require_capability("sofa_access.revoke"))):
    try:
        request_payload = {
            "initiator_user_id": current_user.user_id
        }
        result = await api_client.revoke_user_sofa_access(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/roles/{role_id}/resources")
async def api_role_resources(role_id: int, current_user=Depends(require_page_access("roles"))):
    try:
        resources = await api_client.get_role_resources(role_id)
        return JSONResponse(content=resources)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
    
@app.get("/api/tasks/view")
async def api_list_tasks(
    status: str | None = None,
    type: str | None = None,
    handling_type: str | None = None,
    assigned_to_user_id: int | None = None,
    process_id: int | None = None,
    current_user=Depends(require_login),
):
    """
    Liefert Tasks gefiltert nach Status / Typ / Handling / Assigned User.
    Nur Payload durchreichen, keine Validierung im Frontend nötig.
    """
    try:
        tasks = await api_client.list_tasks(
            status=status,
            type=type,
            handling_type=handling_type,
            assigned_to_user_id=assigned_to_user_id,
            process_id=process_id,
        )
        return JSONResponse(content=_filter_tasks_for_scope(tasks, current_user))
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.patch("/api/tasks/{task_id}/assign")
async def api_assign_task(task_id: int, user_id: int, current_user=Depends(require_login)):

    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        if int(user_id) != int(current_user.user_id):
            raise HTTPException(
                status_code=403,
                detail={"code": "assignment_denied", "message": "Tasks koennen nur an den aktuellen User uebernommen werden."},
            )
        return await api_client.assign_task(task_id, current_user.user_id)

    except httpx.HTTPStatusError as e:

        # Status + Detail vom echten Backend übernehmen
        raise HTTPException(
            status_code=e.response.status_code,
            detail=e.response.json().get("detail", "Backend error")
        )

    except HTTPException as e:
        raise e

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@app.delete("/api/tasks/{task_id}/assign")
async def api_unassign_task(task_id: int, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        task = await api_client.unassign_task(task_id, current_user.user_id)
        return JSONResponse(content=task)

    except httpx.HTTPStatusError as e:
        # Fehler vom Backend sauber weiterreichen
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )

    except HTTPException as e:
        raise e

    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/tasks/{task_id}/complete")
async def api_complete_task(task_id: int, payload: dict, current_user=Depends(require_login)):
    """
    Setzt einen Task auf COMPLETED.
    Prüft für resource_type_id = 1, dass account_identifier geliefert wird
    und legt ggf. einen UserAccount an.
    """
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        # user_id für Log/Tracking
        user_id = current_user.user_id

        # Extrahiere account_identifier falls vorhanden
        account_identifier = payload.get("account_identifier")
        comment = payload.get("comment")

        # Backend aufrufen
        task = await api_client.complete_task(task_id, user_id, account_identifier, comment)

        return JSONResponse(content=task)

    except httpx.HTTPStatusError as e:
        # Fehler vom Backend sauber weiterreichen
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/tasks/dispatch_bot")
async def api_dispatch_bot(payload: dict, current_user=Depends(require_login)):
    try:
        task_id = payload.get("task_id")
        await _get_relevant_task_or_raise(task_id, current_user)
        result = await api_client.dispatch_bot(task_id)

        return JSONResponse(content=result)

    except httpx.HTTPStatusError as e:
        # Fehler vom Backend sauber weiterreichen
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/tasks/{task_id}/send_mail")
async def api_send_task_mail(task_id: int, payload: dict, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.send_task_mail(task_id, payload)

        return JSONResponse(content=result)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/account/change-password")
async def api_change_own_password(payload: dict, current_user=Depends(require_login)):
    current_password = str(payload.get("current_password") or "").strip()
    new_password = str(payload.get("new_password") or "").strip()

    if not current_password or not new_password:
        return JSONResponse(
            content={"detail": "Aktuelles Passwort und neues Passwort sind erforderlich."},
            status_code=400
        )

    if current_password == new_password:
        return JSONResponse(
            content={"detail": "Das neue Passwort muss sich vom aktuellen Passwort unterscheiden."},
            status_code=400
        )

    user_id = current_user.user_id
    pnr = current_user.pnr

    if not pnr:
        return JSONResponse(
            content={"detail": "Die Personalnummer des aktuellen Users konnte nicht ermittelt werden."},
            status_code=400
        )

    try:
        result = await api_client.change_own_sofa_password(
            user_id=user_id,
            current_password=current_password,
            new_password=new_password
        )
        return JSONResponse(content=result or {"status": "success"})
    except httpx.HTTPStatusError as e:

        return JSONResponse(
            content=_error_content_from_response(e.response),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
    
@app.post("/api/processes/onboarding/lookup")
async def api_lookup_onboarding_candidate(
    payload: dict,
    current_user=Depends(require_capability("onboarding.start"))):
    """
    Führt den Helix-Lookup für das Mitarbeiter-Onboarding aus.
    """
    pnr = str(payload.get("pnr") or "").strip()
    if not pnr:
        return JSONResponse(
            content={"detail": "Die Personalnummer ist erforderlich."},
            status_code=400
        )

    try:
        result = await api_client.lookup_onboarding_candidate({
            "pnr": pnr,
            "initiator_user_id": current_user.user_id
        })
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=_error_content_from_response(e.response),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.post("/api/processes/onboarding")
async def api_start_onboarding_process(
    payload: dict,
    current_user=Depends(require_capability("onboarding.start"))):
    """
    Trigger den bestätigten Onboarding-Prozess für einen Mitarbeiter.
    """
    mode = str(payload.get("mode") or "").strip().lower()
    confirmed = bool(payload.get("confirmed"))

    if not confirmed:
        return JSONResponse(
            content={"detail": "Das Onboarding muss vor dem Start bestätigt werden."},
            status_code=400
        )

    forwarded_payload = {
        "mode": mode,
        "confirmed": True,
        "initiator_user_id": current_user.user_id
    }

    if mode == "helix":
        lookup_token = str(payload.get("lookup_token") or "").strip()
        telephone = str(payload.get("telephone") or "").strip()
        entry_date = str(payload.get("entry_date") or "").strip()
        weekly_hours = _coerce_int(payload.get("weekly_hours"))
        if not lookup_token:
            return JSONResponse(
                content={"detail": "Der Lookup-Token ist erforderlich."},
                status_code=400
            )
        forwarded_payload["lookup_token"] = lookup_token
        if telephone:
            forwarded_payload["telephone"] = telephone
        if entry_date:
            forwarded_payload["entry_date"] = entry_date
        if weekly_hours is not None:
            forwarded_payload["weekly_hours"] = weekly_hours
    elif mode == "manual":
        pnr = str(payload.get("pnr") or "").strip()
        first_name = str(payload.get("first_name") or "").strip()
        last_name = str(payload.get("last_name") or "").strip()
        primary_role_id = _coerce_int(payload.get("primary_role_id"))
        telephone = str(payload.get("telephone") or "").strip()
        entry_date = str(payload.get("entry_date") or "").strip()
        weekly_hours = _coerce_int(payload.get("weekly_hours"))

        if (
            not pnr
            or not first_name
            or not last_name
            or primary_role_id is None
            or not telephone
            or not entry_date
            or weekly_hours is None
        ):
            return JSONResponse(
                content={"detail": "Für das manuelle Onboarding sind alle Pflichtfelder erforderlich."},
                status_code=400
            )

        forwarded_payload.update({
            "pnr": pnr,
            "first_name": first_name,
            "last_name": last_name,
            "primary_role_id": primary_role_id,
            "telephone": telephone,
            "entry_date": entry_date,
            "weekly_hours": weekly_hours
        })
    else:
        return JSONResponse(
            content={"detail": "Unbekannter Onboarding-Modus."},
            status_code=400
        )

    try:
        result = await api_client.trigger_onboarding(forwarded_payload)
        return JSONResponse(content={
            "process_id": result.get("process_id"),
            "status": result.get("status", "started")
        })
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=_error_content_from_response(e.response),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
    
@app.post("/api/processes/onboarding-ext")
async def api_start_ext_onboarding_process(
    payload: dict,
    current_user=Depends(require_capability("onboarding.external.start"))):
    """
    Trigger den Onboarding-Prozess für einen Externen Dienstleister.
    """
    try:
        user_id = current_user.user_id
        payload["initiator_user_id"] = user_id
        result = await api_client.trigger_ext_onboarding(payload)
        return JSONResponse(content={"process_id": result["process_id"], "status": "started"})

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=_error_content_from_response(e.response),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

    
@app.get("/api/tasks/overview")
async def api_tasks_overview(current_user=Depends(require_login)):
    try:
        user_id = current_user.user_id

        tasks = await api_client.get_task_overview(user_id)
        for key in ("open_tasks", "blocked_tasks", "user_tasks", "completed_tasks"):
            if isinstance(tasks.get(key), list):
                tasks[key] = _filter_tasks_for_scope(tasks[key], current_user)
        return JSONResponse(content=tasks)

    except httpx.HTTPStatusError as e:
        # Backend-Fehler sauber weitergeben
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/api/processes/overview")
async def api_processes_overview(current_user=Depends(require_login)):
    try:
        user_id = current_user.user_id
        processes = await api_client.get_process_overview(user_id)

        for key in ("running_processes", "completed_processes"):
            if isinstance(processes.get(key), list):
                processes[key] = _filter_processes_for_scope(processes[key], current_user)

        return JSONResponse(content=processes)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/resources/mail_template")
async def api_get_mail_template(payload: dict, current_user=Depends(require_login)):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.get_mail_template(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        print(e)
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/api/tasks/{task_id}/history")
async def api_task_logs(task_id, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(int(task_id), current_user)
        history = await api_client.get_task_logs(task_id)
        return JSONResponse(content=history)
    
    except httpx.HTTPStatusError as e:
        # Backend-Fehler sauber weitergeben
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    

    
@app.get("/api/systems")
async def api_system_overview(current_user=Depends(require_page_access("systems"))):
    """
    Liefert die Systemliste für das Dashboard als JSON
    """
    try:
        systems = await api_client.get_system_overview()
        return JSONResponse(content=systems)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/systems")
async def api_create_system(payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_system(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/api/systems/map")
async def api_system_map(current_user=Depends(require_any_page_access("systems", "users"))):
    try:
        systems = await api_client.get_system_map()

        system_map = {
            system["system_id"]: {
                "name": system["name"],
                "type": system.get("type")
            }
            for system in systems
        }

        return JSONResponse(content=system_map)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
     

@app.get("/api/systems/{system_id}")
async def api_get_system_detail(system_id: int, current_user=Depends(require_page_access("systems"))):
    """
    Liefert Details + Ressourcen eines Systems für Frontend
    """
    try:
        system_detail = await api_client.get_system_detail(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/systems/{system_id}")
async def api_update_system(system_id: int, payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_system(system_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.get("/api/systems/{system_id}/resources")
async def api_get_system_resources(system_id: int, current_user=Depends(require_page_access("systems"))):
    try:
        system_detail = await api_client.get_system_resources(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/api/resources")
async def api_list_resources(
    type_id: int | None = None,
    search: str | None = None,
    limit: int | None = None,
    current_user=Depends(require_page_access("systems"))
):
    try:
        params = {}
        if type_id is not None:
            params["type_id"] = type_id
        if search:
            params["search"] = search
        if limit is not None:
            params["limit"] = limit

        resources = await api_client.list_resources(params=params or None)
        return JSONResponse(content=resources)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=_error_content_from_response(e.response),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/resources")
async def api_create_system_resource(payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_resource(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        print(e)
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/resources/{resource_id}")
async def api_update_system_resource(resource_id: int, payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_resource(resource_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        print(e)
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

    
@app.get("/api/roles")
async def api_role_overview(current_user=Depends(require_page_access("roles"))):
    try:
        systems = await api_client.get_role_overview()
        return JSONResponse(content=systems)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/roles")
async def api_create_role(payload: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.get("/api/roles/map")
async def api_role_map(current_user=Depends(require_any_page_access("roles", "users"))):
    try:
        roles = await api_client.get_role_map()

        role_map = {
            role["role_id"]: {
                "name": role["name"],
                "type": role["role_type"]
            }
            for role in roles
        }

        return JSONResponse(content=role_map)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.get("/api/roles/{role_id}")
async def api_get_role_detail(role_id: int, current_user=Depends(require_page_access("roles"))):
    try:
        system_detail = await api_client.get_role_detail(role_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/roles/{role_id}")
async def api_update_role(role_id: int, payload: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_role(role_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/roles/{role_id}/resources/reevaluate")
async def api_reevaluate_role_resources(role_id: int, payload: dict, current_user=Depends(require_page_access("roles"))):
    try:
        request_payload = {
            "initiator_user_id": current_user.user_id,
            "dry_run": _coerce_bool(payload.get("dry_run"), default=False),
        }
        result = await api_client.reevaluate_role_resources(role_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/skill_assignment")
async def api_start_skill_assignment_process(payload: dict, current_user=Depends(require_capability("skill.assign"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_skill_assignment(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/processes/change")
async def api_start_primary_role_change_process(payload: dict, current_user=Depends(require_capability("primary_role.change"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_primary_role_change(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/tmp_role")
async def api_start_temporary_role_process(payload: dict, current_user=Depends(require_capability("temporary_role.assign"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_temporary_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/offboarding")
async def api_start_offboarding_process(payload: dict, current_user=Depends(require_capability("offboarding.start"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_offboarding(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/training_schedule")
async def api_start_training_schedule_process(payload: dict, current_user=Depends(require_capability("training.schedule"))):
    user_ids = payload.get("user_ids")
    role_ids = payload.get("role_ids")
    scheduled_for = str(payload.get("scheduled_for") or "").strip()

    if not isinstance(user_ids, list) or not user_ids:
        return JSONResponse(content={"detail": "Mindestens ein User muss ausgewählt werden."}, status_code=400)

    if not isinstance(role_ids, list) or not role_ids:
        return JSONResponse(content={"detail": "Mindestens eine Nebenrolle muss ausgewählt werden."}, status_code=400)

    normalized_user_ids = [_coerce_int(value) for value in user_ids]
    normalized_role_ids = [_coerce_int(value) for value in role_ids]

    if any(value is None for value in normalized_user_ids):
        return JSONResponse(content={"detail": "Die User-Auswahl ist ungültig."}, status_code=400)

    if any(value is None for value in normalized_role_ids):
        return JSONResponse(content={"detail": "Die Rollenauswahl ist ungültig."}, status_code=400)

    if not scheduled_for:
        return JSONResponse(content={"detail": "Das Schulungsdatum ist erforderlich."}, status_code=400)

    try:
        scheduled_date = date.fromisoformat(scheduled_for)
    except ValueError:
        return JSONResponse(content={"detail": "Das Schulungsdatum ist ungültig."}, status_code=400)

    if scheduled_date < date.today():
        return JSONResponse(content={"detail": "Das Schulungsdatum darf nicht in der Vergangenheit liegen."}, status_code=400)

    try:
        request_payload = {
            "user_ids": normalized_user_ids,
            "role_ids": normalized_role_ids,
            "scheduled_for": scheduled_for,
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.trigger_training_schedule(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/processes/skill_revocation")
async def api_start_skill_removal_process(payload: dict, current_user=Depends(require_capability("skill.revoke"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_skill_removal(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/processes/iks")
async def api_start_iks_process_report(payload: dict, current_user=Depends(require_page_access("iks"))):
    try:
        request_payload = {
            "process_type": payload.get("process_type"),
            "start_date": payload.get("start_data"),
            "end_date": payload.get("end_date"),
            "initiator_user_id": current_user.user_id
        }
        result = await api_client.trigger_iks_process_report(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/roles/{role_id}/resources")
async def api_add_resources_to_role(role_id: int, resource_ids: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload: dict = {}
        payload["role_id"] = role_id
        payload["resource_ids"] = resource_ids["resource_ids"]
        payload["initiator_user_id"] = current_user.user_id

        result = await api_client.add_resources_to_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )


@app.delete("/api/roles/{role_id}/resources")
async def api_remove_resources_from_role(role_id: int, resource_ids: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload: dict = {}
        payload["role_id"] = role_id
        payload["resource_ids"] = resource_ids["resource_ids"]
        payload["initiator_user_id"] = current_user.user_id

        result = await api_client.remove_resources_from_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
