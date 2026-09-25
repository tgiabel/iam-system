import asyncio
import unittest
from unittest.mock import patch

import httpx

from app.api_client import APIClient, REPORTING_BASE_URL
from app.authz import AuthorizationContext
from app.routes import presence_report as pr

PSEUDONYM = "MA-7K3QD"


def authz(*permissions, user_id=42):
    return AuthorizationContext(user_id=user_id, pnr="00042", primary_role_name="Fachbereich",
                                permissions=frozenset(permissions), accessible_backlogs=frozenset(),
                                has_all_backlog_access=False, raw_user={"user_id": user_id})


class ClientTests(unittest.TestCase):
    def test_client_sends_server_actor_to_presence_base(self):
        client = APIClient()
        calls = []

        async def request(*args, **kwargs):
            calls.append((args, kwargs))
            return "ok"

        client._request = request
        self.assertEqual(asyncio.run(client.presence_report_request("/day", 42, params=[("day", "2026-09-21")])), "ok")
        self.assertEqual(calls[0][0], ("GET", REPORTING_BASE_URL, "/presence/day"))
        self.assertEqual(calls[0][1]["headers"], {"X-User-Id": "42"})
        self.assertEqual(calls[0][1]["params"], [("day", "2026-09-21")])


class ProxyTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context
        self.context = authz(pr.REPORT, pr.NAME, pr.DETAIL)
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.calls = []
        self.backend_response = httpx.Response(200, json={"users": []})

    def backend(self):
        async def request(*args, **kwargs):
            self.calls.append((args, kwargs))
            response = self.backend_response
            if response.status_code >= 400:
                response.request = httpx.Request("GET", "http://sd-api/reporting/presence" + args[0])
                raise httpx.HTTPStatusError("Fehler", request=response.request, response=response)
            return response
        return patch.object(pr.api_client, "presence_report_request", request)

    def test_permission_matrix(self):
        routes = {
            "/api/reporting/presence/day": None,
            "/api/reporting/presence/export": None,
            f"/api/reporting/presence/day/2026-09-21/users/{PSEUDONYM}/name": pr.NAME,
            f"/api/reporting/presence/day/2026-09-21/users/{PSEUDONYM}": pr.DETAIL,
        }
        with self.backend():
            for url, function in routes.items():
                self.context = authz(pr.NAME, pr.DETAIL)
                self.assertEqual(self.client.get(url).status_code, 403, url)
                if function:
                    other = pr.DETAIL if function == pr.NAME else pr.NAME
                    self.context = authz(pr.REPORT, other)
                    self.assertEqual(self.client.get(url).status_code, 403, url)
                self.context = authz(pr.REPORT, *([function] if function else []))
                self.assertEqual(self.client.get(url).status_code, 200, url)
                self.context = authz("SOFA-RPRT-ALL", "SOFA-FN-ALL")
                self.assertEqual(self.client.get(url).status_code, 200, url)
        self.assertEqual(len(self.calls), 8)

    def test_missing_identity_is_rejected(self):
        self.context = authz(pr.REPORT, user_id=None)
        with self.backend():
            self.assertEqual(self.client.get("/api/reporting/presence/day").status_code, 401)
        self.assertEqual(self.calls, [])

    def test_actor_comes_from_session_and_paths_are_forwarded(self):
        with self.backend():
            self.client.get("/api/reporting/presence/day?day=2026-09-21&source=opcyc", headers={"X-User-Id": "999"})
            self.client.get(f"/api/reporting/presence/day/2026-09-21/users/{PSEUDONYM}?source=opcyc")
            self.client.get(f"/api/reporting/presence/day/2026-09-21/users/{PSEUDONYM}/name")
        self.assertEqual([(args, kwargs["params"]) for args, kwargs in self.calls], [
            (("/day", 42), [("day", "2026-09-21"), ("source", "opcyc")]),
            ((f"/day/2026-09-21/users/{PSEUDONYM}", 42), [("source", "opcyc")]),
            ((f"/day/2026-09-21/users/{PSEUDONYM}/name", 42), []),
        ])

    def test_invalid_path_parameters_never_reach_backend(self):
        with self.backend():
            for url in ("/api/reporting/presence/day/2026-09-21/users/00000000-0000-0000-0000-000000000001",
                        "/api/reporting/presence/day/2026-09-21/users/ma-7k3qd/name",
                        "/api/reporting/presence/day/2026-09-21/users/..%2E",
                        f"/api/reporting/presence/day/heute/users/{PSEUDONYM}"):
                self.assertEqual(self.client.get(url).status_code, 422, url)
        self.assertEqual(self.calls, [])

    def test_backend_errors_pass_through_with_no_store(self):
        self.backend_response = httpx.Response(404, json={"detail": {"code": "pseudonym_unknown", "message": "x"}})
        with self.backend():
            response = self.client.get(f"/api/reporting/presence/day/2026-09-21/users/{PSEUDONYM}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["detail"]["code"], "pseudonym_unknown")

    def test_backend_unreachable_is_502(self):
        async def broken(*args, **kwargs):
            raise Exception("connection refused")
        with patch.object(pr.api_client, "presence_report_request", broken):
            self.assertEqual(self.client.get("/api/reporting/presence/day").status_code, 502)

    def test_csv_bytes_and_filename_are_preserved(self):
        self.backend_response = httpx.Response(
            200, content="﻿Pseudonym;Logzeit\r\nMA-7K3QD;1:00:00\r\n".encode(),
            headers={"content-type": "text/csv; charset=utf-8",
                     "content-disposition": 'attachment; filename="presence-2026-09-21-genesys.csv"'})
        with self.backend():
            response = self.client.get("/api/reporting/presence/export?day=2026-09-21")
        self.assertEqual(response.content, "﻿Pseudonym;Logzeit\r\nMA-7K3QD;1:00:00\r\n".encode())
        self.assertEqual(response.headers["content-disposition"], 'attachment; filename="presence-2026-09-21-genesys.csv"')


class PageTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context
        self.context = authz(pr.REPORT)
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_page_renders_with_report_permission(self):
        response = self.client.get("/tools/presence-report")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Presence-Report", response.text)

    def test_page_redirects_without_permission(self):
        self.context = authz(pr.NAME, pr.DETAIL)
        response = self.client.get("/tools/presence-report", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/tools")

    def test_tools_overview_card_follows_report_permission(self):
        response = self.client.get("/tools")
        self.assertEqual(response.status_code, 200)
        self.assertIn('href="/tools/presence-report"', response.text)
        self.context = authz("SOFA-RPRT-LL")
        self.assertNotIn('href="/tools/presence-report"', self.client.get("/tools").text)


if __name__ == "__main__":
    unittest.main()
