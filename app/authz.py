from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import json

from fastapi import Cookie, Depends
from fastapi.exceptions import HTTPException  # type: ignore


def _coerce_role_id(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


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


# Role-to-pages mapping: primary_role_id or normalized role_name -> frozenset of accessible pages
FULL_ACCESS_PAGES = frozenset(("dashboard", "tasks", "tools", "users", "systems", "roles", "iks", "console"))
POWER_USER_PAGES = frozenset(("dashboard", "tasks", "tools", "users"))
BASE_PAGES = frozenset(("dashboard", "tasks", "tools"))

# Full access: by role_id or normalized role name
FULL_ACCESS_ROLE_IDS = frozenset({19, 21, 23})
FULL_ACCESS_ROLE_NAMES = frozenset({"sd-it", "sd-vv-leitung", "it", "verwaltung-und-vertrieb-leitung"})

# Mid-tier access: by role_id or normalized role name
MID_ACCESS_ROLE_IDS = frozenset({13})
MID_ACCESS_ROLE_NAMES = frozenset({
    "sd-teamleiter", "sd-produktionsleitung", "sd-akademie-leitung", "sd-personal",
    "sd-steuerung", "sd-controlling", "sd-produktmanagement",
    "teamleiter", "produktionsleitung", "akademie-leitung", "personal",
    "steuerung", "controlling", "produktmanagement",
})


@dataclass(frozen=True)
class AuthorizationContext:
    """Authorization context: primary role determines page access."""
    user_id: int | None
    pnr: str
    primary_role_name: str
    primary_role_id: int | None
    pages: frozenset[str]
    raw_user: dict[str, Any]

    def has_page(self, page_key: str) -> bool:
        return page_key in self.pages

    def has_admin_access(self) -> bool:
        admin_pages = frozenset({"systems", "roles", "iks", "console"})
        return bool(self.pages.intersection(admin_pages))


def _resolve_pages_for_primary_role(
    primary_role_id: int | None,
    primary_role_name: str
) -> frozenset[str]:
    """Map primary role to accessible pages. No fallbacks or scopes."""
    if primary_role_id in FULL_ACCESS_ROLE_IDS:
        return FULL_ACCESS_PAGES
    
    role_slug = _normalize_role_slug(primary_role_name)
    if role_slug in FULL_ACCESS_ROLE_NAMES:
        return FULL_ACCESS_PAGES
    
    if primary_role_id in MID_ACCESS_ROLE_IDS:
        return POWER_USER_PAGES
    
    if role_slug in MID_ACCESS_ROLE_NAMES:
        return POWER_USER_PAGES
    
    # Default: base pages for any known role
    if primary_role_id is not None or primary_role_name:
        return BASE_PAGES
    
    # No role: no access
    return frozenset()


def build_authorization_context_from_user(user: dict[str, Any]) -> AuthorizationContext:
    """Build authorization context from primary role only."""
    primary_role = user.get("primary_role") or {}
    primary_role_id = _coerce_role_id(primary_role.get("role_id", primary_role.get("id")))
    primary_role_name = str(primary_role.get("name") or primary_role.get("role_name") or "")

    pages = _resolve_pages_for_primary_role(primary_role_id, primary_role_name)

    return AuthorizationContext(
        user_id=user.get("user_id"),
        pnr=str(user.get("pnr") or "").strip(),
        primary_role_name=primary_role_name,
        primary_role_id=primary_role_id,
        pages=pages,
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




def get_authz_payload_for_template(authz: AuthorizationContext | None) -> dict[str, Any]:
    """Provide authorization context for templates: pages and admin access only."""
    if not authz:
        return {
            "pages": [],
            "has_admin_access": False,
        }

    return {
        "pages": sorted(authz.pages),
        "has_admin_access": authz.has_admin_access(),
    }
