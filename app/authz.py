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


POLICY_DEFINITIONS = {
    "basic_user": {
        "pages": set(),
        "capabilities": set(),
        "scopes": {
            "tasks": "relevant_only",
            "tools": "own_only",
            "reports": "own_only",
            "users": "none",
        },
    },
    "people_admin": {
        "pages": {"users"},
        "capabilities": {
            "onboarding.start",
            "onboarding.external.start",
            "training.schedule",
            "primary_role.change",
            "temporary_role.assign",
            "skill.assign",
            "skill.revoke",
            "offboarding.start",
        },
        "scopes": {
            "tasks": "relevant_only",
            "tools": "own_only",
            "reports": "own_only",
            "users": "all",
        },
    },
    "operations_admin": {
        "pages": {"console", "users", "iks"},
        "capabilities": {
            "onboarding.start",
            "onboarding.external.start",
            "training.schedule",
            "primary_role.change",
            "temporary_role.assign",
            "skill.assign",
            "skill.revoke",
            "offboarding.start",
        },
        "scopes": {
            "tasks": "relevant_only",
            "tools": "own_only",
            "reports": "own_only",
            "users": "all",
        },
    },
    "it_admin": {
        "pages": {"console", "users", "systems", "roles", "iks"},
        "capabilities": {
            "onboarding.start",
            "onboarding.external.start",
            "training.schedule",
            "primary_role.change",
            "temporary_role.assign",
            "skill.assign",
            "skill.revoke",
            "offboarding.start",
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
    },
}


ROLE_POLICY_BY_ID = {
    21: "it_admin",
}


# Compatibility fallback until the remaining role ids are wired explicitly.
ROLE_POLICY_BY_NAME = {
    "sd-it": "it_admin",
    "it": "it_admin",
    "sd-personal": "people_admin",
    "personal": "people_admin",
    "sd-vv-leitung": "people_admin",
    "vv-leitung": "people_admin",
    "sd-teamleiter": "operations_admin",
    "teamleiter": "operations_admin",
    "sd-produktionsleitung": "operations_admin",
    "produktionsleitung": "operations_admin",
    "sd-steuerung": "operations_admin",
    "steuerung": "operations_admin",
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


def _resolve_policy_key_for_role(role: dict[str, Any]) -> str | None:
    role_id = _coerce_role_id(role.get("role_id"))
    if role_id is not None and role_id in ROLE_POLICY_BY_ID:
        return ROLE_POLICY_BY_ID[role_id]

    role_name = _normalize_text(role.get("name") or role.get("role_name"))
    return ROLE_POLICY_BY_NAME.get(role_name)


def _merge_scopes(base_scopes: dict[str, str], additional_scopes: dict[str, str]) -> dict[str, str]:
    merged = dict(base_scopes)
    for scope_key, scope_value in additional_scopes.items():
        current_priority = SCOPE_PRIORITY.get(merged.get(scope_key, "none"), -1)
        next_priority = SCOPE_PRIORITY.get(scope_value, -1)
        if next_priority > current_priority:
            merged[scope_key] = scope_value
    return merged


def build_authorization_context_from_user(user: dict[str, Any]) -> AuthorizationContext:
    primary_role = user.get("primary_role") or {}
    primary_role_id = _coerce_role_id(primary_role.get("role_id"))
    primary_policy_key = _resolve_policy_key_for_role(primary_role) if isinstance(primary_role, dict) else None

    effective_roles = _collect_effective_roles(user)
    effective_policy_keys: list[str] = []
    seen_policy_keys: set[str] = set()

    pages: set[str] = set()
    capabilities: set[str] = set()
    data_scopes = dict(POLICY_DEFINITIONS["basic_user"]["scopes"])

    for role in effective_roles:
        policy_key = _resolve_policy_key_for_role(role)
        if not policy_key or policy_key not in POLICY_DEFINITIONS:
            continue

        if policy_key not in seen_policy_keys:
            seen_policy_keys.add(policy_key)
            effective_policy_keys.append(policy_key)

        policy = POLICY_DEFINITIONS[policy_key]
        pages.update(policy["pages"])
        capabilities.update(policy["capabilities"])
        data_scopes = _merge_scopes(data_scopes, policy["scopes"])

    if primary_policy_key and primary_policy_key in POLICY_DEFINITIONS:
        role_key = primary_policy_key
    elif effective_policy_keys:
        role_key = effective_policy_keys[0]
    else:
        role_key = "basic_user"

    debug_policy_keys = tuple(effective_policy_keys) or ("basic_user",)

    return AuthorizationContext(
        user_id=user.get("user_id"),
        pnr=str(user.get("pnr") or "").strip(),
        primary_role_name=str(primary_role.get("name") or ""),
        primary_role_id=primary_role_id,
        role_key=role_key,
        pages=frozenset(pages),
        capabilities=frozenset(capabilities),
        data_scopes=data_scopes,
        effective_role_ids=tuple(role["role_id"] for role in effective_roles),
        effective_role_names=tuple(str(role["name"]) for role in effective_roles),
        effective_policy_keys=debug_policy_keys,
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
        "has_admin_access": bool(authz.pages),
    }
