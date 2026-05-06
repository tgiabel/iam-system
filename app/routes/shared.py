import os

import httpx  # type: ignore
from fastapi import HTTPException, Request  # type: ignore
from fastapi.templating import Jinja2Templates  # type: ignore

from app.api_client import api_client
from app.authz import (
    AuthorizationContext,
    build_authorization_context_from_user,
    get_authz_payload_for_template,
)


base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
static_path = os.path.join(base_dir, "static")
templates = Jinja2Templates(directory=os.path.join(base_dir, "templates"))


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
        reverse=True,
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
        "task_count": len(tasks),
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
        "completed_at": _first_defined_value(task, ["completed_at", "updated_at", "created_at"], None),
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
