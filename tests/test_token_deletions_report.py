import asyncio
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.api_client import APIClient, REPORTING_BASE_URL
from app.authz import AuthorizationContext
from app.routes import token_deletions_report as report


def authz(*permissions, user_id=42):
    return AuthorizationContext(
        user_id=user_id,
        pnr="00042",
        primary_role_name="Fachbereich",
        permissions=frozenset(permissions),
        accessible_backlogs=frozenset(),
        has_all_backlog_access=False,
        raw_user={"user_id": user_id},
    )


class ClientTests(unittest.TestCase):
    def test_client_sends_server_actor_to_dedicated_reporting_base(self):
        client = APIClient()
        calls = []

        async def request(*args, **kwargs):
            calls.append((args, kwargs))
            return "ok"

        client._request = request
        params = [("year", "2025"), ("week_start", "2026-09-21")]
        result = asyncio.run(client.token_deletions_report_request("/overview", 42, params=params))
        self.assertEqual(result, "ok")
        self.assertEqual(calls[0][0], ("GET", REPORTING_BASE_URL, "/token-deletions/overview"))
        self.assertEqual(calls[0][1]["headers"], {"X-User-Id": "42"})
        self.assertEqual(calls[0][1]["params"], params)


class ProxyTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context

        self.context = authz(report.REPORT)
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.calls = []
        self.backend_response = httpx.Response(200, json={"totals": {"today": 2, "yesterday": 1}})

    def backend(self):
        async def request(*args, **kwargs):
            self.calls.append((args, kwargs))
            response = self.backend_response
            if response.status_code >= 400:
                response.request = httpx.Request("GET", "http://sd-api/reporting/token-deletions" + args[0])
                raise httpx.HTTPStatusError("Fehler", request=response.request, response=response)
            return response

        return patch.object(report.api_client, "token_deletions_report_request", request)

    def test_requires_only_presence_report_permission_and_supports_wildcard(self):
        with self.backend():
            self.context = authz("SOFA-FN-PRSNC-NAME", "SOFA-FN-PRSNC-DETAIL")
            self.assertEqual(self.client.get("/api/reporting/token-deletions/overview").status_code, 403)
            self.context = authz(report.REPORT)
            self.assertEqual(self.client.get("/api/reporting/token-deletions/overview").status_code, 200)
            self.context = authz("SOFA-RPRT-ALL")
            self.assertEqual(self.client.get("/api/reporting/token-deletions/overview").status_code, 200)
        self.assertEqual(len(self.calls), 2)

    def test_missing_identity_is_rejected_before_backend(self):
        self.context = authz(report.REPORT, user_id=None)
        with self.backend():
            self.assertEqual(self.client.get("/api/reporting/token-deletions/overview").status_code, 401)
        self.assertEqual(self.calls, [])

    def test_actor_comes_from_session_and_query_is_forwarded(self):
        with self.backend():
            response = self.client.get(
                "/api/reporting/token-deletions/overview?year=2025&week_start=2026-09-21",
                headers={"X-User-Id": "999"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, [
            (("/overview", 42), {"params": [("year", "2025"), ("week_start", "2026-09-21")]})
        ])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_backend_error_is_preserved_and_connection_failure_is_502(self):
        self.backend_response = httpx.Response(
            422, json={"detail": {"code": "week_not_available", "message": "x"}}
        )
        with self.backend():
            response = self.client.get("/api/reporting/token-deletions/overview")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "week_not_available")
        self.assertEqual(response.headers["cache-control"], "no-store")

        async def broken(*args, **kwargs):
            raise Exception("connection refused")

        with patch.object(report.api_client, "token_deletions_report_request", broken):
            self.assertEqual(self.client.get("/api/reporting/token-deletions/overview").status_code, 502)


class PageTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context

        self.context = authz(report.REPORT)
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_page_contains_compact_report_views(self):
        response = self.client.get("/tools/token-deletion-report")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/static/css/token_deletions_report.css", response.text)
        model = response.text.index("/static/js/reports/token_deletions_report_model.js")
        controller = response.text.index("/static/js/reports/token_deletions_report.js")
        self.assertLess(model, controller)
        for element in (
            'id="tdrReport"', 'id="tdrReload"', 'id="tdrTodayValue"', 'id="tdrYesterdayValue"',
            'id="tdrYearPrev"', 'id="tdrYearNext"', 'id="tdrMonthsHead"', 'id="tdrMonthsBody"',
            'id="tdrWeekPrev"', 'id="tdrWeekNext"', 'id="tdrDaysHead"', 'id="tdrDaysBody"',
        ):
            self.assertIn(element, response.text)
        for excluded in ("Klarnamen", "Details anzeigen", "CSV exportieren", 'data-source="opcyc"'):
            self.assertNotIn(excluded, response.text)

    def test_page_and_card_follow_presence_report_permission(self):
        tools = self.client.get("/tools").text
        self.assertIn('href="/tools/token-deletion-report"', tools)
        self.context = authz("SOFA-RPRT-LL")
        denied = self.client.get("/tools/token-deletion-report", follow_redirects=False)
        self.assertEqual(denied.status_code, 303)
        self.assertEqual(denied.headers["location"], "/tools")
        self.assertNotIn('href="/tools/token-deletion-report"', self.client.get("/tools").text)


class FrontendModelTests(unittest.TestCase):
    def test_model_checks_in_node(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [os.environ.get("SOFA_NODE_BINARY", "node"), "tests/token_deletions_report_model_checks.js"],
            cwd=str(root),
            env=dict(os.environ, TZ="America/Los_Angeles"),
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("token deletions report model checks ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
