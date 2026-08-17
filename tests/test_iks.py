from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

try:
    from unittest.mock import AsyncMock
except ImportError:
    class AsyncMock(MagicMock):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.await_count = 0
            self.await_args = None

        async def __call__(self, *args, **kwargs):
            self.await_count += 1
            self.await_args = (args, kwargs)
            return super().__call__(*args, **kwargs)

        def assert_awaited_once_with(self, *args, **kwargs):
            if self.await_count != 1:
                raise AssertionError(f"Expected exactly one await, got {self.await_count}")
            if self.await_args != (args, kwargs):
                raise AssertionError(f"Expected await args {(args, kwargs)}, got {self.await_args}")

        def assert_not_awaited(self):
            if self.await_count:
                raise AssertionError(f"Expected no await, got {self.await_count}")

try:
    import httpx
    from fastapi import APIRouter, HTTPException
except (ModuleNotFoundError, ImportError):
    fastapi_module = types.ModuleType("fastapi")
    fastapi_exceptions_module = types.ModuleType("fastapi.exceptions")
    fastapi_responses_module = types.ModuleType("fastapi.responses")
    fastapi_templating_module = types.ModuleType("fastapi.templating")
    httpx_module = types.ModuleType("httpx")

    class HTTPException(Exception):
        def __init__(self, status_code, detail=None, headers=None):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail
            self.headers = headers or {}

    class JSONResponse:
        def __init__(self, content=None, status_code=200):
            self.status_code = status_code
            self.body = json.dumps(content).encode("utf-8")
            self.headers = {}

    class StreamingResponse:
        def __init__(self, content=None, status_code=200, media_type=None, headers=None):
            self.content = content
            self.status_code = status_code
            self.media_type = media_type
            self.headers = {}
            for key, value in (headers or {}).items():
                self.headers[key] = value
                self.headers[key.lower()] = value

    class HTMLResponse:
        pass

    class RedirectResponse:
        pass

    class APIRouter:
        def __init__(self, *args, **kwargs):
            pass

        def _decorator(self, *args, **kwargs):
            def register(func):
                return func
            return register

        get = post = delete = patch = put = _decorator

    class Jinja2Templates:
        def __init__(self, directory=None):
            self.env = SimpleNamespace(globals={})

        def TemplateResponse(self, *args, **kwargs):
            return {"args": args, "kwargs": kwargs}

    def Cookie(default=None, **kwargs):
        return default

    def Depends(dependency):
        return dependency

    def File(value=None, **kwargs):
        return value

    def Form(value=None, **kwargs):
        return value

    class Request:
        headers = {}
        url = SimpleNamespace(scheme="http")

    class UploadFile:
        filename = None

        async def read(self):
            return b""

        async def close(self):
            return None

    class Response:
        def __init__(self, status_code=200, payload=None, content=None, headers=None, **kwargs):
            self.status_code = status_code
            self._payload = kwargs.get("json", payload)
            self.content = content if content is not None else json.dumps(self._payload or {}).encode("utf-8")
            self.headers = {key.lower(): value for key, value in (headers or {}).items()}

        def json(self):
            if self._payload is not None:
                return self._payload
            return json.loads(self.content.decode("utf-8"))

    class HTTPStatusError(Exception):
        def __init__(self, *args, response=None, **kwargs):
            super().__init__("HTTP status error")
            self.response = response or Response(500)

    class HttpxRequest:
        def __init__(self, method, url):
            self.method = method
            self.url = url

    fastapi_module.Cookie = Cookie
    fastapi_module.Depends = Depends
    fastapi_module.File = File
    fastapi_module.Form = Form
    fastapi_module.HTTPException = HTTPException
    fastapi_module.Request = Request
    fastapi_module.UploadFile = UploadFile
    fastapi_module.APIRouter = APIRouter
    fastapi_exceptions_module.HTTPException = HTTPException
    fastapi_responses_module.HTMLResponse = HTMLResponse
    fastapi_responses_module.JSONResponse = JSONResponse
    fastapi_responses_module.RedirectResponse = RedirectResponse
    fastapi_responses_module.StreamingResponse = StreamingResponse
    fastapi_templating_module.Jinja2Templates = Jinja2Templates
    httpx_module.HTTPStatusError = HTTPStatusError
    httpx_module.Response = Response
    httpx_module.Request = HttpxRequest
    httpx_module.RequestError = Exception

    sys.modules["fastapi"] = fastapi_module
    sys.modules["fastapi.exceptions"] = fastapi_exceptions_module
    sys.modules["fastapi.responses"] = fastapi_responses_module
    sys.modules["fastapi.templating"] = fastapi_templating_module
    sys.modules["httpx"] = httpx_module

    import httpx

from app.api_client import APIClient, SOFA_BASE_URL, api_client
from app.routes.api import (
    _normalize_iks_export_links,
    api_create_iks_report,
    api_download_iks_report_export,
    api_get_iks_catalog,
)


def run_async(awaitable):
    return asyncio.run(awaitable)


def response_json(response):
    return json.loads(response.body.decode("utf-8"))


REPO_ROOT = Path(__file__).parents[1]


class IksFrontendContractTests(unittest.TestCase):
    def test_frontend_uses_only_new_iks_routes_and_backend_catalog(self):
        script = (REPO_ROOT / "app/static/js/tools/iks.js").read_text(encoding="utf-8")

        self.assertIn('fetch("/api/iks/catalog"', script)
        self.assertIn('fetch("/api/iks/reports"', script)
        self.assertNotIn("/api/processes/iks", script)
        self.assertNotIn("OFFBOARDING", script)
        self.assertNotIn("TEMPORARY_ROLE", script)
        self.assertNotIn("milestone_id", script)
        self.assertNotIn("new Blob(", script)

    def test_template_uses_dedicated_theme_aware_stylesheet(self):
        template = (REPO_ROOT / "app/templates/tools/iks_tool.html").read_text(encoding="utf-8")
        stylesheet = (REPO_ROOT / "app/static/css/iks.css").read_text(encoding="utf-8")

        self.assertIn('/static/css/iks.css', template)
        self.assertNotIn('/static/css/tools.css', template)
        self.assertIn('"SOFA-IKS-PRCS" in authz.permissions', template)
        self.assertIn('"SOFA-IKS-ROLE" in authz.permissions', template)
        self.assertIn('"SOFA-IKS-SYS" in authz.permissions', template)
        self.assertIn("var(--ui-surface-card)", stylesheet)
        self.assertIn("var(--ui-text-strong)", stylesheet)
        script = (REPO_ROOT / "app/static/js/tools/iks.js").read_text(encoding="utf-8")
        self.assertIn("In SOFA dokumentierter Ist-Zugriff", script)


class IksApiClientTests(unittest.TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_catalog_uses_canonical_sofa_route_and_user_header(self):
        with patch.object(self.client, "_get", new_callable=AsyncMock, return_value={}) as get_mock:
            run_async(self.client.get_iks_catalog(18))

        get_mock.assert_awaited_once_with(
            SOFA_BASE_URL,
            "/iks/catalog",
            headers={"X-User-Id": "18"},
        )

    def test_report_creation_uses_canonical_sofa_route_and_user_header(self):
        payload = {"report_type": "process", "target": None}
        with patch.object(self.client, "_post", new_callable=AsyncMock, return_value={}) as post_mock:
            run_async(self.client.create_iks_report(18, payload))

        post_mock.assert_awaited_once_with(
            SOFA_BASE_URL,
            "/iks/reports",
            payload=payload,
            headers={"X-User-Id": "18"},
        )

    def test_export_download_uses_raw_request_for_binary_response(self):
        upstream = httpx.Response(200, content=b"snapshot")
        with patch.object(self.client, "_request", new_callable=AsyncMock, return_value=upstream) as request_mock:
            result = run_async(self.client.download_iks_report_export(18, "IKS-42", "json"))

        self.assertIs(result, upstream)
        request_mock.assert_awaited_once_with(
            "GET",
            SOFA_BASE_URL,
            "/iks/reports/IKS-42/exports/json",
            headers={"X-User-Id": "18"},
        )


class IksProxyRouteTests(unittest.TestCase):
    def setUp(self):
        self.authz = SimpleNamespace(user_id=18, has_permission=lambda _permission: True)

    def test_export_links_are_rewritten_without_mutating_backend_payload(self):
        report = {
            "report_id": "IKS-42",
            "exports": {
                "html": "/sofa/iks/reports/IKS-42/exports/html",
                "csv": None,
                "json": "http://dev-api:8080/sofa/iks/reports/IKS-42/exports/json",
            },
        }

        normalized = _normalize_iks_export_links(report)

        self.assertEqual(normalized["exports"]["html"], "/api/iks/reports/IKS-42/exports/html")
        self.assertEqual(normalized["exports"]["json"], "/api/iks/reports/IKS-42/exports/json")
        self.assertIsNone(normalized["exports"]["csv"])
        self.assertTrue(report["exports"]["html"].startswith("/sofa/"))

    def test_catalog_forwards_authenticated_user(self):
        catalog = {"process_types": [], "roles": [], "systems": []}
        with patch.object(api_client, "get_iks_catalog", new_callable=AsyncMock, return_value=catalog) as catalog_mock:
            response = run_async(api_get_iks_catalog(authz=self.authz))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response_json(response), catalog)
        catalog_mock.assert_awaited_once_with(18)

    def test_catalog_hides_unauthorized_control_types(self):
        catalog = {
            "process_types": [{"id": "OFFBOARDING", "name": "Offboarding"}],
            "roles": [{"id": "5", "name": "Agent"}],
            "systems": [{"id": "9", "name": "Genesys"}],
        }
        process_authz = SimpleNamespace(
            user_id=18,
            has_permission=lambda permission: permission == "SOFA-IKS-PRCS",
        )

        with patch.object(api_client, "get_iks_catalog", new_callable=AsyncMock, return_value=catalog):
            response = run_async(api_get_iks_catalog(authz=process_authz))

        filtered = response_json(response)
        self.assertEqual(filtered["process_types"], catalog["process_types"])
        self.assertEqual(filtered["roles"], [])
        self.assertEqual(filtered["systems"], [])

    def test_report_filters_creator_and_unknown_browser_fields(self):
        backend_report = {
            "report_id": "IKS-42",
            "exports": {"html": "/sofa/iks/reports/IKS-42/exports/html"},
        }
        browser_payload = {
            "report_type": "role",
            "target": {"id": "5", "name": "Nicht vertrauen"},
            "period": {"from": "2026-07-01", "to": "2026-07-31", "generated_by": "999"},
            "timezone": "Europe/Berlin",
            "generated_by": {"id": "999", "name": "Manipuliert"},
            "initiator_user_id": 999,
            "unexpected": True,
        }
        expected_payload = {
            "report_type": "role",
            "target": {"id": "5"},
            "period": {"from": "2026-07-01", "to": "2026-07-31"},
            "timezone": "Europe/Berlin",
        }

        with patch.object(api_client, "create_iks_report", new_callable=AsyncMock, return_value=backend_report) as report_mock:
            response = run_async(api_create_iks_report(browser_payload, authz=self.authz))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response_json(response)["exports"]["html"],
            "/api/iks/reports/IKS-42/exports/html",
        )
        report_mock.assert_awaited_once_with(18, expected_payload)

    def test_report_preserves_backend_validation_error(self):
        request = httpx.Request("POST", "http://dev-api:8080/sofa/iks/reports")
        upstream = httpx.Response(422, request=request, json={"detail": "Ungültiger Zeitraum"})
        error = httpx.HTTPStatusError("validation", request=request, response=upstream)

        with patch.object(api_client, "create_iks_report", new_callable=AsyncMock, side_effect=error):
            response = run_async(api_create_iks_report({"report_type": "process"}, authz=self.authz))

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response_json(response), {"detail": "Ungültiger Zeitraum"})

    def test_report_type_without_permission_is_blocked_locally(self):
        process_authz = SimpleNamespace(
            user_id=18,
            has_permission=lambda permission: permission == "SOFA-IKS-PRCS",
        )
        payload = {
            "report_type": "role",
            "target": {"id": "5"},
            "period": {"from": "2026-07-01", "to": "2026-07-31"},
            "timezone": "Europe/Berlin",
        }

        with patch.object(api_client, "create_iks_report", new_callable=AsyncMock) as report_mock:
            response = run_async(api_create_iks_report(payload, authz=process_authz))

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response_json(response)["detail"]["code"], "iks_report_access_denied")
        report_mock.assert_not_awaited()

    def test_unknown_export_format_is_rejected_before_backend_call(self):
        with patch.object(api_client, "download_iks_report_export", new_callable=AsyncMock) as export_mock:
            response = run_async(api_download_iks_report_export("IKS-42", "pdf", authz=self.authz))

        self.assertEqual(response.status_code, 404)
        export_mock.assert_not_awaited()

    def test_export_preserves_binary_content_and_download_headers(self):
        request = httpx.Request("GET", "http://dev-api:8080/sofa/iks/reports/IKS-42/exports/csv")
        upstream = httpx.Response(
            200,
            request=request,
            content=b"report_id;finding\nIKS-42;NO_FINDINGS\n",
            headers={
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="iks-42.csv"',
                "ETag": '"snapshot-hash"',
            },
        )

        with patch.object(api_client, "download_iks_report_export", new_callable=AsyncMock, return_value=upstream) as export_mock:
            response = run_async(api_download_iks_report_export("IKS-42", "csv", authz=self.authz))

        async def consume_body():
            if not hasattr(response, "body_iterator"):
                return response.content.read()
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            return b"".join(chunks)

        self.assertEqual(run_async(consume_body()), upstream.content)
        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(response.headers["content-disposition"], 'attachment; filename="iks-42.csv"')
        self.assertEqual(response.headers["etag"], '"snapshot-hash"')
        export_mock.assert_awaited_once_with(18, "IKS-42", "csv")


if __name__ == "__main__":
    unittest.main()
