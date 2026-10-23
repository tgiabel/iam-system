"""Kontext der Startseite: sichtbare Bereiche, Datenquellen und Mock-Schalter."""
from __future__ import annotations

import os

from app import dashboard_mock
from app.agent_stats_token import is_configured, verify
from app.authz import AuthorizationContext
from app.workspace_catalog import WorkspaceItem, visible_items

app_env = os.getenv("APP_ENV", "production")


def mock_scenario(query_value: str | None) -> str | None:
    """`?mock=busy|quiet|1` schaltet in der Entwicklungsinstanz Mock-Daten ein, `?mock=0` die echten Quellen."""
    if app_env != "development" or query_value == "0":
        return None
    return dashboard_mock.normalize_scenario(query_value)


def live_available(authz: AuthorizationContext, agent_stats_cookie: str) -> bool:
    """Live-Panel nur mit eingerichtetem Secret und gueltigem Cookie dieser Person (wie die Report-Seite)."""
    if not is_configured():
        return False
    try:
        return authz.user_id is not None and verify(agent_stats_cookie) == authz.user_id
    except (ValueError, RuntimeError):
        return False


def build_dashboard_context(authz: AuthorizationContext, agent_stats_cookie: str, mock_query: str | None) -> dict:
    scenario = mock_scenario(mock_query)
    sections = visible_items(authz, is_configured())
    items: list[WorkspaceItem] = sections["tools"] + sections["reports"]
    suffix = f"?scenario={scenario}" if scenario else ""
    if scenario:
        sources = {
            "events": f"/api/dashboard-mock/events{suffix}",
            "live": f"/api/dashboard-mock/genesys-live{suffix}",
            "service_level": f"/api/dashboard-mock/service-level{suffix}",
            "my_day": f"/api/dashboard-mock/my-day{suffix}",
        }
    else:
        # Servicelevel und "Mein Tag" haben noch keine echte Quelle; die Bereiche entfallen dann.
        sources = {"events": "/api/events", "live": "/api/reporting/genesys-live",
                   "service_level": "", "my_day": ""}
    return {
        "dashboard_items": items,
        "dashboard_sources": sources,
        "dashboard_mock": scenario,
        "dashboard_live": bool(scenario) or live_available(authz, agent_stats_cookie),
        "dashboard_slog": authz.has_permission("SOFA-TOOL-SLOG"),
    }
