from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import json

from fastapi import Cookie, Depends
from fastapi.exceptions import HTTPException  # type: ignore
from app.sofa_permissions import get_permission_definition, normalize_grants


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _coerce_role_id(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _is_explicit_false(value: Any) -> bool:
    if value is False:
        return True
    return _normalize_text(value) in {"0", "false", "inactive", "no", "off"}


def get_current_user(sofa_user: str | None):
    if sofa_user:
        return json.loads(sofa_user)
    return None


async def get_current_user_dep(
    sofa_user: str | None = Cookie(default=None),
):
    user = get_current_user(sofa_user)
    if not user:
        raise HTTPException(status_code=303, headers={"Location": "/login"})
    return user


DEFAULT_POLICY_KEY = "basic_user"
DEFAULT_SCOPES = {
    "tasks": "none",
    "tools": "none",
    "reports": "none",
    "users": "none",
}

ADMIN_PAGE_KEYS = frozenset({"users", "systems", "roles", "iks", "console"})


INACTIVE_ROLE_STATUSES = {
    "inactive",
    "revoked",
    "removed",
    "deleted",
    "disabled",
    "expired",
}


@dataclass(frozen=True)
class AuthorizationContext:
    user_id: int | None
    pnr: str
    primary_role_name: str
    primary_role_id: int | None
    role_key: str
    pages: frozenset[str]
    capabilities: frozenset[str]
    data_scopes: dict[str, str]
    visible_task_backlog_ids: tuple[int, ...]
    can_view_all_task_backlogs: bool
    effective_role_ids: tuple[int, ...]
    effective_role_names: tuple[str, ...]
    effective_policy_keys: tuple[str, ...]
    permission_keys: tuple[str, ...]
    grants: tuple[dict[str, Any], ...]
    raw_user: dict[str, Any]

    def has_page(self, page_key: str) -> bool:
        return page_key in self.pages

    def has_capability(self, capability_key: str) -> bool:
        return capability_key in self.capabilities

    def has_permission(self, permission_key: str) -> bool:
        return permission_key in self.permission_keys

    def get_scope(self, scope_key: str, default: str = "none") -> str:
        return self.data_scopes.get(scope_key, default)


def _iter_user_roles(user: dict[str, Any] | None):
    if not isinstance(user, dict):
        return

    primary_role = user.get("primary_role")
    if isinstance(primary_role, dict):
        yield primary_role

    for field_name in ("secondary_roles", "role_assignments", "roles"):
        roles = user.get(field_name) or []
        if not isinstance(roles, list):
            continue
        for role in roles:
            if isinstance(role, dict):
                yield role


def _role_is_active(role: dict[str, Any]) -> bool:
    if _is_explicit_false(role.get("is_active")):
        return False
    if _is_explicit_false(role.get("active")):
        return False

    for field_name in ("assignment_status", "status", "lifecycle_status"):
        if _normalize_text(role.get(field_name)) in INACTIVE_ROLE_STATUSES:
            return False

    return True


def _collect_effective_roles(user: dict[str, Any] | None) -> list[dict[str, Any]]:
    effective_roles: list[dict[str, Any]] = []
    seen_role_ids: set[int] = set()

    for role in _iter_user_roles(user):
        if not _role_is_active(role):
            continue

        role_id = _coerce_role_id(role.get("role_id", role.get("id")))
        if role_id is None or role_id in seen_role_ids:
            continue

        seen_role_ids.add(role_id)
        effective_roles.append(
            {
                "role_id": role_id,
                "name": str(role.get("name") or role.get("role_name") or f"Rolle #{role_id}"),
            }
        )

    return effective_roles


def _resolve_task_backlog_access(grants: list[dict[str, Any]]) -> tuple[tuple[int, ...], bool]:
    visible_backlog_ids: set[int] = set()
    can_view_all = False

    for grant in grants:
        if str(grant.get("permission")) != "tasks.backlog.view":
            continue

        access_definition = (grant.get("resources") or {}).get("task_backlogs") or {}
        if access_definition.get("all"):
            can_view_all = True

        backlog_ids = access_definition.get("ids", [])
        for backlog_id in backlog_ids:
            if isinstance(backlog_id, int):
                visible_backlog_ids.add(backlog_id)

    return tuple(sorted(visible_backlog_ids)), can_view_all


def _resolve_scope_from_resource_grants(
    grants: list[dict[str, Any]],
    permission_key: str,
    resource_key: str,
) -> str:
    has_permission = False
    has_specific_ids = False

    for grant in grants:
        if str(grant.get("permission")) != permission_key:
            continue

        has_permission = True
        resource_scope = (grant.get("resources") or {}).get(resource_key) or {}
        if resource_scope.get("all"):
            return "all"
        if resource_scope.get("ids"):
            has_specific_ids = True

    if has_specific_ids:
        return "own_only"
    if has_permission:
        return "all"
    return "none"


def _project_pages_and_capabilities(grants: list[dict[str, Any]]) -> tuple[set[str], set[str], tuple[str, ...]]:
    pages: set[str] = set()
    capabilities: set[str] = set()
    permission_keys: list[str] = []
    seen_permission_keys: set[str] = set()

    for grant in grants:
        permission_key = str(grant.get("permission") or "").strip()
        if not permission_key:
            continue

        if permission_key not in seen_permission_keys:
            seen_permission_keys.add(permission_key)
            permission_keys.append(permission_key)

        permission_definition = get_permission_definition(permission_key) or {}
        legacy_mapping = permission_definition.get("legacy") or {}
        if not isinstance(legacy_mapping, dict):
            continue

        page_key = str(legacy_mapping.get("page") or "").strip()
        capability_key = str(legacy_mapping.get("capability") or "").strip()

        if page_key:
            pages.add(page_key)
        if capability_key:
            capabilities.add(capability_key)

    return pages, capabilities, tuple(permission_keys)


def build_authorization_context_from_user(user: dict[str, Any]) -> AuthorizationContext:
    primary_role = user.get("primary_role") or {}
    primary_role_id = _coerce_role_id(primary_role.get("role_id"))

    effective_roles = _collect_effective_roles(user)
    sofa_authorization = user.get("sofa_authorization") if isinstance(user.get("sofa_authorization"), dict) else {}
    profile_keys = sofa_authorization.get("profile_keys") if isinstance(sofa_authorization, dict) else []
    normalized_profile_keys = tuple(
        str(profile_key).strip()
        for profile_key in (profile_keys if isinstance(profile_keys, list) else [])
        if str(profile_key).strip()
    )
    grants = normalize_grants((sofa_authorization or {}).get("grants"))
    pages, capabilities, permission_keys = _project_pages_and_capabilities(grants)

    role_key = normalized_profile_keys[0] if normalized_profile_keys else (DEFAULT_POLICY_KEY if not grants else "custom")
    resolved_policy_keys = normalized_profile_keys or ((DEFAULT_POLICY_KEY,) if not grants else ("custom",))
    visible_task_backlog_ids, can_view_all_task_backlogs = _resolve_task_backlog_access(grants)

    data_scopes = dict(DEFAULT_SCOPES)
    if "users" in pages:
        data_scopes["users"] = "all"
    if "tasks" in pages:
        data_scopes["tasks"] = "all" if can_view_all_task_backlogs else ("relevant_only" if visible_task_backlog_ids else "none")
    data_scopes["tools"] = _resolve_scope_from_resource_grants(grants, "tools.item.view", "tools")
    data_scopes["reports"] = _resolve_scope_from_resource_grants(grants, "reports.item.view", "reports")

    return AuthorizationContext(
        user_id=user.get("user_id"),
        pnr=str(user.get("pnr") or "").strip(),
        primary_role_name=str(primary_role.get("name") or ""),
        primary_role_id=primary_role_id,
        role_key=role_key,
        pages=frozenset(pages),
        capabilities=frozenset(capabilities),
        data_scopes=data_scopes,
        visible_task_backlog_ids=visible_task_backlog_ids,
        can_view_all_task_backlogs=can_view_all_task_backlogs,
        effective_role_ids=tuple(role["role_id"] for role in effective_roles),
        effective_role_names=tuple(str(role["name"]) for role in effective_roles),
        effective_policy_keys=resolved_policy_keys,
        permission_keys=permission_keys,
        grants=tuple(grants),
        raw_user=user,
    )


async def build_authorization_context(
    user: dict[str, Any] = Depends(get_current_user_dep),
) -> AuthorizationContext:
    return build_authorization_context_from_user(user)


async def require_login(
    authz: AuthorizationContext = Depends(build_authorization_context),
) -> AuthorizationContext:
    return authz


def _forbidden(detail: str, code: str, redirect_to: str | None = None):
    if redirect_to:
        raise HTTPException(status_code=303, headers={"Location": redirect_to})
    raise HTTPException(
        status_code=403,
        detail={"code": code, "message": detail},
    )


def require_page_access(page_key: str, redirect_to: str | None = None):
    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not authz.has_page(page_key):
            _forbidden(
                detail=f"Kein Zugriff auf Seite '{page_key}'.",
                code="page_access_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


def require_any_page_access(*page_keys: str, redirect_to: str | None = None):
    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not any(authz.has_page(page_key) for page_key in page_keys):
            _forbidden(
                detail=f"Kein Zugriff auf Seiten {', '.join(page_keys)}.",
                code="page_access_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


def require_capability(capability_key: str, redirect_to: str | None = None):
    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not authz.has_capability(capability_key):
            _forbidden(
                detail=f"Berechtigung '{capability_key}' fehlt.",
                code="capability_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


def get_authz_payload_for_template(authz: AuthorizationContext | None) -> dict[str, Any]:
    if not authz:
        return {
            "pages": [],
            "capabilities": [],
            "scopes": {},
            "primary_role_name": "",
            "primary_role_id": None,
            "role_key": "",
            "effective_role_ids": [],
            "effective_role_names": [],
            "effective_policy_keys": [],
            "permission_keys": [],
            "grants": [],
            "visible_task_backlog_ids": [],
            "can_view_all_task_backlogs": False,
            "has_admin_access": False,
        }

    return {
        "pages": sorted(authz.pages),
        "capabilities": sorted(authz.capabilities),
        "scopes": authz.data_scopes,
        "primary_role_name": authz.primary_role_name,
        "primary_role_id": authz.primary_role_id,
        "role_key": authz.role_key,
        "effective_role_ids": list(authz.effective_role_ids),
        "effective_role_names": list(authz.effective_role_names),
        "effective_policy_keys": list(authz.effective_policy_keys),
        "permission_keys": list(authz.permission_keys),
        "grants": list(authz.grants),
        "visible_task_backlog_ids": list(authz.visible_task_backlog_ids),
        "can_view_all_task_backlogs": authz.can_view_all_task_backlogs,
        "has_admin_access": bool(authz.pages.intersection(ADMIN_PAGE_KEYS)),
    }
