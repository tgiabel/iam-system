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


DEFAULT_POLICY_KEY = "basic_user"
DEFAULT_SCOPES = {
    "tasks": "none",
    "tools": "none",
    "reports": "none",
    "users": "none",
}
ALL_PAGE_KEYS = ("dashboard", "tasks", "tools", "users", "systems", "roles", "iks", "console")
POWER_USER_PAGE_KEYS = ("dashboard", "tasks", "tools", "users")
BASE_PAGE_KEYS = ("dashboard", "tasks", "tools")

ADMIN_PAGE_KEYS = frozenset({"users", "systems", "roles", "iks", "console"})


INACTIVE_ROLE_STATUSES = {
    "inactive",
    "revoked",
    "removed",
    "deleted",
    "disabled",
    "expired",
}

FULL_ACCESS_ROLE_IDS = frozenset({19, 21})
MID_ACCESS_ROLE_IDS = frozenset({13})
FULL_ACCESS_ROLE_NAMES = frozenset({"sd-it", "sd-vv-leitung", "it", "verwaltung & vertrieb leitung"})
MID_ACCESS_ROLE_NAMES = frozenset(
    {
        "sd-teamleiter",
        "sd-produktionsleitung",
        "sd-akademie-leitung",
        "sd-personal",
        "sd-steuerung",
        "sd-controlling",
        "sd-produktmanagement",
        "teamleiter",
        "produktionsleitung",
        "akademie-leitung",
        "personal",
        "steuerung",
        "controlling",
        "produktmanagement",
    }
)


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
    if not isinstance(user, dict):
        return []

    primary_role = user.get("primary_role")
    if not isinstance(primary_role, dict) or not _role_is_active(primary_role):
        return []

    role_id = _coerce_role_id(primary_role.get("role_id", primary_role.get("id")))
    if role_id is None:
        return []

    return [
        {
            "role_id": role_id,
            "name": str(primary_role.get("name") or primary_role.get("role_name") or f"Rolle #{role_id}"),
        }
    ]


def _normalize_role_slug(role_name: Any) -> str:
    normalized = str(role_name or "").strip().lower()
    for source, target in {
        "ä": "ae",
        "ö": "oe",
        "ü": "ue",
        "ß": "ss",
        "&": "und",
        "/": "-",
    }.items():
        normalized = normalized.replace(source, target)
    return "-".join(part for part in normalized.replace("_", " ").split() if part)


def _resolve_pages_for_primary_role(primary_role_id: int | None, primary_role_name: str) -> frozenset[str]:
    role_slug = _normalize_role_slug(primary_role_name)

    if primary_role_id in FULL_ACCESS_ROLE_IDS or role_slug in FULL_ACCESS_ROLE_NAMES:
        return frozenset(ALL_PAGE_KEYS)
    if primary_role_id in MID_ACCESS_ROLE_IDS or role_slug in MID_ACCESS_ROLE_NAMES:
        return frozenset(POWER_USER_PAGE_KEYS)
    if primary_role_id is not None:
        return frozenset(BASE_PAGE_KEYS)
    return frozenset()


def build_authorization_context_from_user(user: dict[str, Any]) -> AuthorizationContext:
    primary_role = user.get("primary_role") or {}
    primary_role_id = _coerce_role_id(primary_role.get("role_id"))
    primary_role_name = str(primary_role.get("name") or "")

    effective_roles = _collect_effective_roles(user)
    pages = _resolve_pages_for_primary_role(primary_role_id, primary_role_name)
    role_key = _normalize_role_slug(primary_role_name) or DEFAULT_POLICY_KEY
    resolved_policy_keys = (role_key,)

    data_scopes = dict(DEFAULT_SCOPES)
    if "tasks" in pages:
        data_scopes["tasks"] = "all"
    if "tools" in pages:
        data_scopes["tools"] = "all"
        data_scopes["reports"] = "all"
    if "users" in pages:
        data_scopes["users"] = "all"

    return AuthorizationContext(
        user_id=user.get("user_id"),
        pnr=str(user.get("pnr") or "").strip(),
        primary_role_name=primary_role_name,
        primary_role_id=primary_role_id,
        role_key=role_key,
        pages=pages,
        capabilities=frozenset(),
        data_scopes=data_scopes,
        visible_task_backlog_ids=(),
        can_view_all_task_backlogs=False,
        effective_role_ids=tuple(role["role_id"] for role in effective_roles),
        effective_role_names=tuple(str(role["name"]) for role in effective_roles),
        effective_policy_keys=resolved_policy_keys,
        permission_keys=(),
        grants=(),
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
