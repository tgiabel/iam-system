import asyncio
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from tests.session_helpers import sign_in, status_error

ROOT = Path(__file__).resolve().parents[1]
GUIDE = {"task_id": 9, "task_type": "ASSIGNMENT", "resource_id": 69, "guide": "Agent `{{genesys_user_id}}`",
         "missing": [{"key": "genesys_user_id", "label": "Genesys-ID"}], "unknown": []}


class ResourceGuideRendererTests(unittest.TestCase):
    def test_renderer_in_node(self):
        result = subprocess.run([os.environ.get("SOFA_NODE_BINARY", "node"), "tests/resource_guide_checks.js"],
                                cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class TaskGuideProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.calls = []

    async def guide(self, task_id, user_id):
        self.calls.append((task_id, user_id))
        return GUIDE

    def test_guide_is_read_as_the_signed_in_user(self):
        sign_in(self, self.client, "SOFA-PAGE-TODO")
        with patch("app.routes.api.api_client.get_task_guide", self.guide):
            response = self.client.get("/api/tasks/9/guide")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), GUIDE)
        self.assertEqual(self.calls, [(9, 42)])

    def test_guide_needs_the_tasks_page(self):
        sign_in(self, self.client, "SOFA-PAGE-SYS")
        with patch("app.routes.api.api_client.get_task_guide", self.guide):
            self.assertEqual(self.client.get("/api/tasks/9/guide").status_code, 403)
        self.assertEqual(self.calls, [])

    def test_refusals_of_the_api_are_passed_on_without_internals(self):
        sign_in(self, self.client, "SOFA-PAGE-TODO")
        for status in (403, 404, 409):
            async def refuse(task_id, user_id, status=status):
                raise status_error(status, url="http://api:8080/sofa/tasks/9/guide", json={"detail": "Nicht möglich"})
            with patch("app.routes.api.api_client.get_task_guide", refuse):
                response = self.client.get("/api/tasks/9/guide")
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.json(), {"detail": "Nicht möglich"})
            self.assertNotIn("api:8080", response.text)

    def test_client_sends_user_header(self):
        from app.api_client import APIClient, ACCESS_BASE_URL, SOFA_BASE_URL
        client = APIClient()
        calls = []

        async def request(method, base_url, path, **kwargs):
            calls.append((method, base_url, path, kwargs.get("headers")))
            return {}

        client._request_json = request
        asyncio.run(client.get_task_guide(9, 42))
        asyncio.run(client.get_resource_guide_placeholders())
        self.assertEqual(calls, [
            ("GET", SOFA_BASE_URL, "/tasks/9/guide", {"X-User-Id": "42"}),
            ("GET", ACCESS_BASE_URL, "/resources/guide-placeholders", None),
        ])


class GuidePlaceholderProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_catalog_for_system_and_role_pages(self):
        catalog = [{"key": "racf", "label": "RACF-Kennung", "group": "Konten"}]

        async def placeholders():
            return catalog

        for permission in ("SOFA-PAGE-SYS", "SOFA-PAGE-ROLE"):
            sign_in(self, self.client, permission)
            with patch("app.routes.api.api_client.get_resource_guide_placeholders", placeholders):
                response = self.client.get("/api/resources/guide-placeholders")
            self.assertEqual(response.status_code, 200, permission)
            self.assertEqual(response.json(), catalog)

    def test_catalog_needs_system_or_role_page(self):
        sign_in(self, self.client, "SOFA-PAGE-TODO")
        self.assertEqual(self.client.get("/api/resources/guide-placeholders").status_code, 403)


if __name__ == "__main__":
    unittest.main()
