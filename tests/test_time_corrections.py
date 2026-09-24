import asyncio
import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.api_client import APIClient, TIME_CORRECTIONS_BASE_URL
from app.authz import AuthorizationContext
from app.routes import time_corrections as tc

USER = "00000000-0000-0000-0000-000000000001"
DAY_PATH = f"/api/time-corrections/days/2026-09-23/users/{USER}"


def authz(*permissions, user_id=42):
    return AuthorizationContext(user_id=user_id, pnr="00042", primary_role_name="Fachbereich",
                                permissions=frozenset(permissions), accessible_backlogs=frozenset(),
                                has_all_backlog_access=False, raw_user={"user_id": user_id})


class ClientTests(unittest.TestCase):
    def test_client_sends_server_actor_to_time_corrections_base(self):
        client = APIClient()
        calls = []

        async def request(*args, **kwargs):
            calls.append((args, kwargs))
            return "ok"

        client._request = request
        result = asyncio.run(client.time_corrections_request("GET", "/users", 42, params=[("q", "Te")]))
        self.assertEqual(result, "ok")
        self.assertEqual(calls[0][0], ("GET", TIME_CORRECTIONS_BASE_URL, "/users"))
        self.assertEqual(calls[0][1]["headers"], {"X-User-Id": "42"})
        self.assertTrue(TIME_CORRECTIONS_BASE_URL.endswith("/time-corrections"))


class RouteTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context
        self.context = authz(tc.PERMISSION)
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.calls = []
        self.backend_response = httpx.Response(200, json={"days": ["2026-09-23", "2026-09-22"]})

    def backend(self):
        async def request(*args, **kwargs):
            self.calls.append((args, kwargs))
            response = self.backend_response
            if response.status_code >= 400:
                response.request = httpx.Request(args[0], "http://sd-api/time-corrections" + args[1])
                raise httpx.HTTPStatusError("Fehler", request=response.request, response=response)
            return response
        return patch.object(tc.api_client, "time_corrections_request", request)

    def test_every_route_requires_tool_permission(self):
        self.context = authz("SOFA-TOOL-QM")
        with self.backend():
            responses = [
                self.client.get("/api/time-corrections/days"),
                self.client.get("/api/time-corrections/users?q=Te"),
                self.client.get(DAY_PATH),
                self.client.post(DAY_PATH + "/preview", json={"revoke": [], "create": []}),
                self.client.post(DAY_PATH, json={"revision": "r", "revoke": [1], "create": []}),
            ]
        self.assertEqual([r.status_code for r in responses], [403] * 5)
        self.assertEqual(self.calls, [])

    def test_missing_identity_is_rejected(self):
        self.context = authz(tc.PERMISSION, user_id=None)
        with self.backend():
            response = self.client.get("/api/time-corrections/days")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])

    def test_actor_comes_from_session_not_from_browser_header(self):
        with self.backend():
            response = self.client.get("/api/time-corrections/days", headers={"X-User-Id": "999"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"days": ["2026-09-23", "2026-09-22"]})
        self.assertEqual(response.headers["cache-control"], "no-store")
        args, _ = self.calls[0]
        self.assertEqual(args, ("GET", "/days", 42))

    def test_paths_and_query_are_forwarded(self):
        with self.backend():
            self.client.get("/api/time-corrections/users?q=Te")
            self.client.get(DAY_PATH)
            self.client.post(DAY_PATH + "/preview", json={"revoke": [], "create": []})
            self.client.post(DAY_PATH, json={"revision": "r", "revoke": [5], "create": []})
        self.assertEqual([(c[0][0], c[0][1]) for c in self.calls], [
            ("GET", "/users"),
            ("GET", f"/days/2026-09-23/users/{USER}"),
            ("POST", f"/days/2026-09-23/users/{USER}/preview"),
            ("POST", f"/days/2026-09-23/users/{USER}"),
        ])
        self.assertEqual(self.calls[0][1]["params"], [("q", "Te")])
        self.assertIsNone(self.calls[1][1]["payload"])

    def test_browser_body_loses_actor_fields(self):
        body = {
            "revision": "abc", "revoke": [5], "created_by": 999, "revoked_by": 999,
            "create": [{"effective_from": "2026-09-23T08:00:00+02:00", "status_group": "ONLINE",
                        "reason": "Dienstbeginn", "created_by": {"user_id": 999}}],
        }
        with self.backend():
            self.client.post(DAY_PATH, json=body)
            self.client.post(DAY_PATH + "/preview", json=body)
        expected = {
            "revision": "abc", "revoke": [5],
            "create": [{"effective_from": "2026-09-23T08:00:00+02:00", "status_group": "ONLINE",
                        "reason": "Dienstbeginn"}],
        }
        self.assertEqual([c[1]["payload"] for c in self.calls], [expected, expected])
        self.assertEqual([c[0][2] for c in self.calls], [42, 42])

    def test_conflict_and_validation_errors_pass_through_unchanged(self):
        errors = [
            (409, {"detail": {"code": "revision_conflict", "message": "Neu laden"}}),
            (422, {"detail": {"code": "correction_in_future", "message": "Liegt nach jetzt",
                              "loc": ["body", "create", 1]}}),
            (422, {"detail": {"code": "day_not_allowed", "message": "Nur heute und gestern"}}),
        ]
        for status, detail in errors:
            raw = json.dumps(detail, ensure_ascii=False).encode()
            self.backend_response = httpx.Response(status, content=raw, headers={"content-type": "application/json"})
            with self.backend():
                response = self.client.post(DAY_PATH, json={"revision": "r", "revoke": [5], "create": []})
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.content, raw)
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_backend_unreachable_is_502(self):
        async def broken(*args, **kwargs):
            raise Exception("Request Error: connection refused")
        with patch.object(tc.api_client, "time_corrections_request", broken):
            response = self.client.get("/api/time-corrections/days")
        self.assertEqual(response.status_code, 502)

    def test_invalid_path_parameters_never_reach_backend(self):
        with self.backend():
            bad_user = self.client.get("/api/time-corrections/days/2026-09-23/users/..%2E")
            bad_date = self.client.get(f"/api/time-corrections/days/gestern/users/{USER}")
        self.assertEqual(bad_user.status_code, 422)
        self.assertEqual(bad_date.status_code, 422)
        self.assertEqual(self.calls, [])


class PageTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context
        self.context = authz(tc.PERMISSION)
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_page_renders_with_permission(self):
        response = self.client.get("/tools/zeitkorrektur")
        self.assertEqual(response.status_code, 200)
        self.assertIn('id="tcTool"', response.text)
        self.assertIn("/static/css/time_correction.css", response.text)
        self.assertIn('id="tcUserQuery"', response.text)
        self.assertIn('id="tcDays"', response.text)
        scripts = [response.text.index(f"/static/js/tools/{name}.js")
                   for name in ("time_correction_model", "time_correction_timeline", "time_correction")]
        self.assertEqual(scripts, sorted(scripts))
        self.assertIn('id="tcTimeline"', response.text)
        self.assertIn('id="tcChangesBox"', response.text)
        self.assertIn('id="tcRevokedBox"', response.text)
        self.assertIn('id="tcEdit"', response.text)
        self.assertIn('id="tcForm"', response.text)
        self.assertIn('id="tcSave"', response.text)
        self.assertIn('id="tcModal"', response.text)
        self.assertIn('maxlength="255"', response.text)

    def test_page_redirects_without_permission(self):
        self.context = authz("SOFA-TOOL-GQ")
        response = self.client.get("/tools/zeitkorrektur", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/tools")

    def test_tools_overview_card_follows_page_permission(self):
        response = self.client.get("/tools")
        self.assertEqual(response.status_code, 200)
        self.assertIn('href="/tools/zeitkorrektur"', response.text)
        # Kachel und Seite folgen derselben Regel; die Wildcard deckt beide ab (PermissionSet).
        self.context = authz("SOFA-TOOL-ALL")
        self.assertIn('href="/tools/zeitkorrektur"', self.client.get("/tools").text)
        self.assertEqual(self.client.get("/tools/zeitkorrektur").status_code, 200)
        self.context = authz("SOFA-TOOL-GQ")
        self.assertNotIn('href="/tools/zeitkorrektur"', self.client.get("/tools").text)

class FrontendModelTests(unittest.TestCase):
    def test_model_checks_in_node(self):
        # Kein Überspringen ohne Node: Fehlt node, schlägt der Test fehl.
        # Zeitzone bewusst fern von Berlin, die Funktionen dürfen nicht von ihr abhängen.
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run(
            [os.environ.get("SOFA_NODE_BINARY", "node"), "tests/time_correction_model_checks.js"],
            cwd=str(root), env=dict(os.environ, TZ="America/Los_Angeles"), capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("time_correction_model_checks: ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
