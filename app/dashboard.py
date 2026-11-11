"""Kontext der Startseite: sichtbare Bereiche, Datenquellen und Mock-Schalter."""
from __future__ import annotations

import os

from app import dashboard_mock
from app.authz import AuthorizationContext
from app.workspace_catalog import WorkspaceItem, visible_items

app_env = os.getenv("APP_ENV", "production")


def mock_scenario(query_value: str | None) -> str | None:
    """`?mock=busy|quiet|1` schaltet in der Entwicklungsinstanz Mock-Daten ein, `?mock=0` die echten Quellen."""
    if app_env != "development" or query_value == "0":
        return None
    return dashboard_mock.normalize_scenario(query_value)


def build_dashboard_context(authz: AuthorizationContext, mock_query: str | None) -> dict:
    scenario = mock_scenario(mock_query)
    sections = visible_items(authz)
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
        # Genesys-Bereiche nimmt SD-API aus der Sitzung; jede angemeldete Person sieht sie.
        sources = {"events": "/api/events", "live": "/api/reporting/genesys-live",
                   "service_level": "/api/reporting/service-level",
                   "my_day": "/api/dashboard/my-day"}
    return {
        "dashboard_items": items,
        "dashboard_sources": sources,
        "dashboard_mock": scenario,
        "dashboard_slog": authz.has_permission("SOFA-TOOL-SLOG"),
    }
