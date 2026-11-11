"""Angemeldete Testclients: Sitzungs-Cookie plus simulierte Antwort von GET /access/users/me."""
from unittest.mock import AsyncMock, patch

from app.api_client import api_client
from app.session import SESSION_COOKIE

TOKEN = "T" * 43
CSRF = "C" * 43

_KINDS = {
    "accessible_pages": "SOFA-PAGE",
    "accessible_tools": "SOFA-TOOL",
    "accessible_reports": "SOFA-RPRT",
    "accessible_functions": "SOFA-FN",
}


def session_block(**overrides):
    block = {
        "created_at": "2026-11-12T07:00:00.000Z",
        "last_activity_at": "2026-11-12T07:00:00.000Z",
        "idle_expires_at": "2026-11-12T11:00:00.000Z",
        "absolute_expires_at": "2026-11-12T19:00:00.000Z",
        "server_time": "2026-11-12T07:00:00.000Z",
        "idle_timeout_seconds": 14400,
        "absolute_timeout_seconds": 43200,
        "csrf_token": CSRF,
    }
    block.update(overrides)
    return block


def me_payload(*identifiers, user_id=42, backlogs=(), first_name="Erika", last_name="Test"):
    permissions = {key: [{"identifier": item} for item in identifiers if item.startswith(prefix + "-")]
                   for key, prefix in _KINDS.items()}
    permissions["accessible_backlogs"] = [{"identifier": item} for item in backlogs]
    permissions["has_all_backlog_access"] = False
    return {
        "user_id": user_id, "pnr": str(user_id), "first_name": first_name, "last_name": last_name,
        "is_active": True, "racf": "",
        "primary_role": {"role_id": 1, "name": "Agent"}, "secondary_roles": [],
        "session": session_block(),
        "permissions": permissions,
    }


def sign_in(test, client, *identifiers, **kwargs) -> AsyncMock:
    """Meldet `client` fuer die Dauer des Tests an. Schreibende Requests tragen das CSRF-Token."""
    client.cookies.set(SESSION_COOKIE, TOKEN)
    client.headers["X-CSRF-Token"] = CSRF
    me = AsyncMock(return_value=me_payload(*identifiers, **kwargs))
    patcher = patch.object(api_client, "session_me", me)
    patcher.start()
    test.addCleanup(patcher.stop)
    return me
