from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import json

from fastapi import Cookie, Depends
from fastapi.exceptions import HTTPException  # type: ignore


PERMISSION_MAP: dict[str, str] = {
    "tasks":        "SOFA-PAGE-TODO",
    "users":        "SOFA-PAGE-USER",
    "systems":      "SOFA-PAGE-SYS",
    "roles":        "SOFA-PAGE-ROLE",
    "console":      "SOFA-PAGE-CNSL",
    "form":         "SOFA-TOOL-FORM",
    "datex":        "SOFA-TOOL-DATX",
    "iks":          "SOFA-TOOL-IKS",
    "gq":           "SOFA-TOOL-GQ",
    "slog":         "SOFA-TOOL-SLOG",
    "onboarding":   "SOFA-FN-ONB",
    "offboarding":  "SOFA-FN-OFFB",
    "training":     "SOFA-FN-TRNG",
    "tmprole":      "SOFA-FN-TMPR",
    "rolechange":   "SOFA-FN-ROLE",
    "access_setup": "SOFA-FN-ACC",
}

ALL_TOOL_IDENTIFIERS: frozenset[str] = frozenset({
    "SOFA-TOOL-FORM", "SOFA-TOOL-GQ", "SOFA-TOOL-DATX", "SOFA-TOOL-IKS", "SOFA-TOOL-SLOG",
})
ALL_FN_IDENTIFIERS: frozenset[str] = frozenset({
    "SOFA-FN-ONB", "SOFA-FN-OFFB", "SOFA-FN-TRNG", "SOFA-FN-TMPR", "SOFA-FN-ROLE", "SOFA-FN-ACC",
})
ALL_BKLG_IDENTIFIERS: frozenset[str] = frozenset({
    "SOFA-BKLG-IT", "SOFA-BKLG-AKAD", "SOFA-BKLG-STRG", "SOFA-BKLG-PROD",
})


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


@dataclass(frozen=True)
class AuthorizationContext:
    """Authorization context: permissions derived directly from backend /sofa/me response."""
    user_id: int | None
    pnr: str
    primary_role_name: str
    permissions: frozenset[str]
    accessible_backlogs: frozenset[str]
    has_all_backlog_access: bool
    raw_user: dict[str, Any]

    def has_permission(self, sofa_identifier: str) -> bool:
        if sofa_identifier in self.permissions:
            return True
        parts = sofa_identifier.split("-", 2)
        if len(parts) >= 2:
            return f"SOFA-{parts[1]}-ALL" in self.permissions
        return False

    def has_page(self, short_key: str) -> bool:
        sofa_id = PERMISSION_MAP.get(short_key)
        return self.has_permission(sofa_id) if sofa_id else False

    def has_admin_access(self) -> bool:
        return any(self.has_permission(p) for p in ("SOFA-PAGE-USER", "SOFA-PAGE-SYS", "SOFA-PAGE-ROLE"))


def _extract_identifiers(items: list[dict] | None) -> frozenset[str]:
    if not items:
        return frozenset()
    return frozenset(item["identifier"] for item in items if item.get("identifier"))


def build_authorization_context_from_user(
    user: dict[str, Any],
    sofa_permissions: dict[str, Any] | None = None,
) -> AuthorizationContext:
    primary_role = user.get("primary_role") or {}
    primary_role_name = str(primary_role.get("name") or primary_role.get("role_name") or "")

    perms = sofa_permissions or {}
    permissions: set[str] = set()
    for key in ("accessible_pages", "accessible_functions", "accessible_tools", "accessible_reports"):
        permissions.update(_extract_identifiers(perms.get(key)))

    accessible_backlogs = _extract_identifiers(perms.get("accessible_backlogs"))
    has_all_backlog_access = bool(perms.get("has_all_backlog_access")) or "SOFA-BKLG-ALL" in accessible_backlogs

    return AuthorizationContext(
        user_id=user.get("user_id"),
        pnr=str(user.get("pnr") or "").strip(),
        primary_role_name=primary_role_name,
        permissions=frozenset(permissions),
        accessible_backlogs=accessible_backlogs,
        has_all_backlog_access=has_all_backlog_access,
        raw_user=user,
    )


async def build_authorization_context(
    user: dict[str, Any] = Depends(get_current_user_dep),
) -> AuthorizationContext:
    return build_authorization_context_from_user(user, user.get("sofa_permissions"))


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


def require_page_access(short_key: str, redirect_to: str | None = None):
    sofa_identifier = PERMISSION_MAP.get(short_key)
    if sofa_identifier is None:
        raise ValueError(f"Unknown permission key: {short_key!r}")

    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not authz.has_permission(sofa_identifier):
            _forbidden(
                detail=f"Kein Zugriff auf '{short_key}'.",
                code="page_access_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


def require_any_page_access(*short_keys: str, redirect_to: str | None = None):
    resolved: list[str] = []
    for key in short_keys:
        sofa_id = PERMISSION_MAP.get(key)
        if sofa_id is None:
            raise ValueError(f"Unknown permission key: {key!r}")
        resolved.append(sofa_id)

    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not any(authz.has_permission(sofa_id) for sofa_id in resolved):
            _forbidden(
                detail=f"Kein Zugriff auf '{', '.join(short_keys)}'.",
                code="page_access_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


def _expand_category(permissions: frozenset[str], prefix: str, all_identifiers: frozenset[str]) -> list[str]:
    """Return explicit identifier list, expanding SOFA-<CAT>-ALL to all known members."""
    if f"SOFA-{prefix}-ALL" in permissions:
        return sorted(all_identifiers)
    return sorted(p for p in permissions if p.startswith(f"SOFA-{prefix}-") and not p.endswith("-ALL"))


def get_authz_payload_for_template(authz: AuthorizationContext | None) -> dict[str, Any]:
    if not authz:
        return {
            "pages": [],
            "tools": [],
            "functions": [],
            "backlogs": [],
            "has_admin_access": False,
            "has_all_backlog_access": False,
        }

    # Build short-key pages list (backward compat with JS + base.html)
    granted_pages = sorted(
        key for key, sofa_id in PERMISSION_MAP.items()
        if authz.has_permission(sofa_id)
    )

    tools = _expand_category(authz.permissions, "TOOL", ALL_TOOL_IDENTIFIERS)
    functions = _expand_category(authz.permissions, "FN", ALL_FN_IDENTIFIERS)

    if authz.has_all_backlog_access:
        backlogs = sorted(ALL_BKLG_IDENTIFIERS)
    else:
        backlogs = sorted(b for b in authz.accessible_backlogs if b != "SOFA-BKLG-ALL")

    return {
        "pages": granted_pages,
        "tools": tools,
        "functions": functions,
        "backlogs": backlogs,
        "has_admin_access": authz.has_admin_access(),
        "has_all_backlog_access": authz.has_all_backlog_access,
    }
