from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import json

from fastapi import Cookie, Depends
from fastapi.exceptions import HTTPException  # type: ignore


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
    task_count: int = 0

    def has_permission(self, sofa_identifier: str) -> bool:
        if sofa_identifier in self.permissions:
            return True
        parts = sofa_identifier.split("-", 2)
        if len(parts) >= 2:
            return f"SOFA-{parts[1]}-ALL" in self.permissions
        return False

    def has_admin_access(self) -> bool:
        return any(self.has_permission(p) for p in ("SOFA-PAGE-USER", "SOFA-PAGE-SYS", "SOFA-PAGE-ROLE"))

    def has_any_tool(self) -> bool:
        return any(
            self.has_permission(p) for p in self.permissions
            if p.startswith("SOFA-TOOL-")
        ) or "SOFA-TOOL-ALL" in self.permissions


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

    try:
        task_count = int(perms.get("task_count") or 0)
    except (TypeError, ValueError):
        task_count = 0

    return AuthorizationContext(
        user_id=user.get("user_id"),
        pnr=str(user.get("pnr") or "").strip(),
        primary_role_name=primary_role_name,
        permissions=frozenset(permissions),
        accessible_backlogs=accessible_backlogs,
        has_all_backlog_access=has_all_backlog_access,
        raw_user=user,
        task_count=task_count,
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


def require_permission(sofa_identifier: str, redirect_to: str | None = None):
    if not sofa_identifier.startswith("SOFA-"):
        raise ValueError(f"Invalid SOFA identifier: {sofa_identifier!r}")

    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not authz.has_permission(sofa_identifier):
            _forbidden(
                detail=f"Kein Zugriff auf '{sofa_identifier}'.",
                code="page_access_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


def require_any_permission(*sofa_identifiers: str, redirect_to: str | None = None):
    for identifier in sofa_identifiers:
        if not identifier.startswith("SOFA-"):
            raise ValueError(f"Invalid SOFA identifier: {identifier!r}")

    async def dependency(
        authz: AuthorizationContext = Depends(build_authorization_context),
    ) -> AuthorizationContext:
        if not any(authz.has_permission(sid) for sid in sofa_identifiers):
            _forbidden(
                detail=f"Kein Zugriff auf '{', '.join(sofa_identifiers)}'.",
                code="page_access_denied",
                redirect_to=redirect_to,
            )
        return authz

    return dependency


class PermissionSet(list):
    """list-Unterklasse mit Wildcard-aware 'in'-Operator für Jinja2-Templates."""
    def __init__(self, permissions: frozenset[str]):
        super().__init__(sorted(permissions))
        self._pset = permissions

    def __contains__(self, identifier: object) -> bool:
        if super().__contains__(identifier):
            return True
        parts = str(identifier).split("-", 2)
        if len(parts) >= 2:
            return f"SOFA-{parts[1]}-ALL" in self._pset
        return False


def get_authz_payload_for_template(authz: AuthorizationContext | None) -> dict[str, Any]:
    if not authz:
        return {
            "permissions": PermissionSet(frozenset()),
            "backlogs": [],
            "has_admin_access": False,
            "has_all_backlog_access": False,
            "has_any_tool": False,
            "task_count": 0,
        }

    return {
        "permissions": PermissionSet(authz.permissions),
        "backlogs": sorted(b for b in authz.accessible_backlogs if b != "SOFA-BKLG-ALL"),
        "has_admin_access": authz.has_admin_access(),
        "has_all_backlog_access": authz.has_all_backlog_access,
        "has_any_tool": authz.has_any_tool(),
        "task_count": authz.task_count,
    }
