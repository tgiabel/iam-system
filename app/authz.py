from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import json

from fastapi import Cookie, Depends
from fastapi.exceptions import HTTPException  # type: ignore


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


# Role IDs are the only source of truth for elevated access.
# Unknown or unmapped roles intentionally keep the default policy.
# Multiple active role policies are merged by unioning pages/capabilities,
# taking the highest scope priority, and combining backlog access.
DEFAULT_POLICY_KEY = "basic_user"


COMMON_ADMIN_CAPABILITIES = {
    "onboarding.start",
    "onboarding.external.start",
    "training.schedule",
    "primary_role.change",
    "temporary_role.assign",
    "skill.assign",
    "skill.revoke",
    "offboarding.start",
}


POLICY_DEFINITIONS = {
    DEFAULT_POLICY_KEY: {
        "key": DEFAULT_POLICY_KEY,
        "pages": set(),
        "capabilities": set(),
        "scopes": {
            "tasks": "relevant_only",
            "tools": "own_only",
            "reports": "own_only",
            "users": "none",
        },
        "task_backlogs": {
            "all": False,
            "ids": set(),
        },
    },
}


COMMON_ADMIN_SCOPES = {
    "tasks": "relevant_only",
    "tools": "own_only",
    "reports": "own_only",
    "users": "all",
}


POLICY_DEFINITIONS.update({
    "people_admin": {
        "key": "people_admin",
        "pages": {"users"},
        "capabilities": set(COMMON_ADMIN_CAPABILITIES),
        "scopes": dict(COMMON_ADMIN_SCOPES),
        "task_backlogs": {
            "all": False,
            "ids": set(),
        },
    },
    "operations_admin": {
        "key": "operations_admin",
        "pages": {"console", "users", "iks"},
        "capabilities": set(COMMON_ADMIN_CAPABILITIES),
        "scopes": dict(COMMON_ADMIN_SCOPES),
        "task_backlogs": {
            "all": False,
            "ids": set(),
        },
    },
    "it_admin": {
        "key": "it_admin",
        "pages": {"console", "users", "systems", "roles", "iks"},
        "capabilities": {
            *COMMON_ADMIN_CAPABILITIES,
            "sofa_access.setup",
            "sofa_access.reset",
            "sofa_access.revoke",
        },
        "scopes": {
            "tasks": "all",
            "tools": "all",
            "reports": "all",
            "users": "all",
        },
        "task_backlogs": {
            "all": True,
            "ids": set(),
        },
    },
})


DEFAULT_POLICY = POLICY_DEFINITIONS[DEFAULT_POLICY_KEY]


ROLE_POLICY_KEYS_BY_ID = {
    11: "it_admin",
    13: "it_admin",
    19: "it_admin",
    21: "it_admin",
    23: "it_admin",
}


SCOPE_PRIORITY = {
    "none": 0,
    "own_only": 1,
    "relevant_only": 2,
    "all": 3,
}


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
    raw_user: dict[str, Any]

    def has_page(self, page_key: str) -> bool:
        return page_key in self.pages

    def has_capability(self, capability_key: str) -> bool:
        return capability_key in self.capabilities

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


def _resolve_policy_for_role_id(role_id: int | None) -> dict[str, Any] | None:
    if role_id is None:
        return None
    policy_key = ROLE_POLICY_KEYS_BY_ID.get(role_id)
    if not policy_key:
        return None
    return POLICY_DEFINITIONS.get(policy_key)


def _merge_scopes(base_scopes: dict[str, str], additional_scopes: dict[str, str]) -> dict[str, str]:
    merged = dict(base_scopes)
    for scope_key, scope_value in additional_scopes.items():
        current_priority = SCOPE_PRIORITY.get(merged.get(scope_key, "none"), -1)
        next_priority = SCOPE_PRIORITY.get(scope_value, -1)
        if next_priority > current_priority:
            merged[scope_key] = scope_value
    return merged


def _resolve_task_backlog_access(policies: list[dict[str, Any]]) -> tuple[tuple[int, ...], bool]:
    visible_backlog_ids: set[int] = set()
    can_view_all = False

    effective_policies = policies or [DEFAULT_POLICY]
    for policy in effective_policies:
        access_definition = policy.get("task_backlogs", {})
        if access_definition.get("all"):
            can_view_all = True

        backlog_ids = access_definition.get("ids", set())
        for backlog_id in backlog_ids:
            if isinstance(backlog_id, int):
                visible_backlog_ids.add(backlog_id)

    return tuple(sorted(visible_backlog_ids)), can_view_all


def build_authorization_context_from_user(user: dict[str, Any]) -> AuthorizationContext:
    primary_role = user.get("primary_role") or {}
    primary_role_id = _coerce_role_id(primary_role.get("role_id"))
    primary_policy = _resolve_policy_for_role_id(primary_role_id) if isinstance(primary_role, dict) else None

    effective_roles = _collect_effective_roles(user)
    effective_policy_keys: list[str] = []
    seen_policy_keys: set[str] = set()
    effective_policies: list[dict[str, Any]] = []

    pages: set[str] = set()
    capabilities: set[str] = set()
    data_scopes = dict(DEFAULT_POLICY["scopes"])

    for role in effective_roles:
        policy = _resolve_policy_for_role_id(role["role_id"])
        if not policy:
            continue

        policy_key = str(policy["key"])
        if policy_key not in seen_policy_keys:
            seen_policy_keys.add(policy_key)
            effective_policy_keys.append(policy_key)
            effective_policies.append(policy)

        pages.update(policy["pages"])
        capabilities.update(policy["capabilities"])
        data_scopes = _merge_scopes(data_scopes, policy["scopes"])

    if primary_policy:
        role_key = str(primary_policy["key"])
    elif effective_policy_keys:
        role_key = effective_policy_keys[0]
    else:
        role_key = str(DEFAULT_POLICY["key"])

    resolved_policy_keys = tuple(effective_policy_keys) or (str(DEFAULT_POLICY["key"]),)
    visible_task_backlog_ids, can_view_all_task_backlogs = _resolve_task_backlog_access(effective_policies)

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
        "visible_task_backlog_ids": list(authz.visible_task_backlog_ids),
        "can_view_all_task_backlogs": authz.can_view_all_task_backlogs,
        "has_admin_access": bool(authz.pages),
    }
