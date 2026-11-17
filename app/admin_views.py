"""Datenquellen der Verwaltungslisten: `GET /api/views/roles` und `GET /api/views/systems`.

Jede Quelle baut serverseitig die Form, mit der die Seite rechnet (`{systems, roles, users, backlogs}` wie
`admin_lists_mock.mock_lists`), und gibt je Seite nur die Felder weiter, die sie braucht. Geprueft wird nur das
Recht der eigenen Seite: Das Rollenmanagement braucht z. B. die Funktion je User, ohne SOFA-PAGE-USER zu haben.
Mit `?mock=` kommen in der Entwicklungsinstanz die Mock-Daten durch denselben Zuschnitt.
"""
from __future__ import annotations

import asyncio

import httpx  # type: ignore
from fastapi import APIRouter, Depends  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from app import admin_lists_mock
from app.api_client import api_client
from app.authz import AuthorizationContext, require_permission
from app.helpers.time_utils import today_local
from app.routes.shared import _error_content_from_response, internal_error

router = APIRouter(prefix="/api/views")

ALL_BACKLOGS = "SOFA-BKLG-ALL"
_RESOURCE_ITEM_FIELDS = ("resource_id", "display_name", "system_id")
_SYSTEM_RESOURCE_FIELDS = ("resource_id", "display_name", "type_name", "handling")
_TASK_FIELDS = ("user_count", "open_tasks", "blocked_tasks", "overdue_tasks")


def _pick(item: dict, fields) -> dict:
    return {field: item.get(field) for field in fields}


def _list(value) -> list:
    return value if isinstance(value, list) else []


# ---------- Rollenmanagement ----------

def _role_user(user: dict) -> dict:
    """Nur Name (fuer die Zuordnung zu `assigned_to`) und Funktion."""
    primary = user.get("primary_role") or {}
    return {"first_name": user.get("first_name"), "last_name": user.get("last_name"),
            "primary_role": {"name": primary.get("name")}}


def roles_payload(roles: list, systems: list, users: list, mock: str | None = None) -> dict:
    # `assigned_to` nennt nur Namen. Bei Namensgleichheit gewinnt der aktive User, denn nur er hat aktive Zuweisungen.
    by_name: dict[str, dict] = {}
    for user in sorted(_list(users), key=lambda item: bool(item.get("is_active"))):
        by_name[f"{user.get('first_name')} {user.get('last_name')}"] = _role_user(user)
    return {
        "mock": mock,
        "roles": [{
            **_pick(role, ("role_id", "name", "role_type", "role_status", "parent_role_id")),
            "resource_items": [_pick(item, _RESOURCE_ITEM_FIELDS) for item in _list(role.get("resource_items"))],
            "assigned_to": _list(role.get("assigned_to")),
        } for role in _list(roles)],
        "systems": [_pick(system, ("system_id", "name", "short_name")) for system in _list(systems)],
        "users": list(by_name.values()),
    }


# ---------- Systemverwaltung ----------

def task_visibility_params(authz: AuthorizationContext) -> dict:
    """Aufgabenzahlen wie auf der Aufgabenseite des Betrachters (`_task_backlog_is_visible_to_user`)."""
    if authz.has_all_backlog_access:
        return {}
    # Leer heisst fuer die SD-API "kein Backlog sichtbar", nicht "alle".
    params = {"task_backlogs": ",".join(sorted(b for b in authz.accessible_backlogs if b != ALL_BACKLOGS))}
    if authz.has_permission("SOFA-PAGE-TODO"):
        params["task_unbacklogged"] = "true"
    return params


def systems_payload(systems: list, backlogs: list, mock: str | None = None) -> dict:
    return {
        "mock": mock,
        "systems": [{
            **_pick(system, ("system_id", "name", "short_name", "default_backlog_identifier")),
            "protection_need": system.get("protection_need") or {},
            "resources": [_pick(item, _SYSTEM_RESOURCE_FIELDS) for item in _list(system.get("resources"))],
            **{field: system.get(field) or 0 for field in _TASK_FIELDS},
        } for system in _list(systems)],
        # Fuer Gruppennamen und den Dialog "Neues System"; "Alle Backlogs" ist kein Standard-Backlog.
        "backlogs": [_pick(item, ("technical_identifier", "display_name")) for item in _list(backlogs)
                     if item.get("technical_identifier") != ALL_BACKLOGS],
    }


# ---------- Routen ----------

async def _respond(build):
    try:
        return JSONResponse(content=await build())
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return internal_error(exc)


def _mock_data(mock: str | None) -> tuple[str | None, dict | None]:
    scenario = admin_lists_mock.mock_scenario(mock)
    return scenario, admin_lists_mock.mock_lists(scenario, today_local()) if scenario else None


@router.get("/roles")
async def roles_view(mock: str | None = None, authz=Depends(require_permission("SOFA-PAGE-ROLE"))):
    scenario, data = _mock_data(mock)

    async def build():
        if data:
            return roles_payload(data["roles"], data["systems"], data["users"], scenario)
        roles, systems, users = await asyncio.gather(
            api_client.get_role_overview(),
            api_client.get_system_overview(),
            # is_active=false liefert bei der SD-API alle User, aktive und inaktive.
            api_client.list_users(is_active=False),
        )
        return roles_payload(roles, systems, users)

    return await _respond(build)


@router.get("/systems")
async def systems_view(mock: str | None = None, authz=Depends(require_permission("SOFA-PAGE-SYS"))):
    scenario, data = _mock_data(mock)

    async def build():
        if data:
            return systems_payload(data["systems"], data["backlogs"], scenario)
        systems, backlogs = await asyncio.gather(
            api_client.get_system_overview(task_visibility_params(authz)),
            api_client.get_backlogs(),
        )
        return systems_payload(systems, backlogs)

    return await _respond(build)
