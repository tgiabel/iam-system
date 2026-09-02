from __future__ import annotations

import asyncio
import json
from pathlib import Path
import shutil
import subprocess
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

from app.api_client import (
    APIClient,
    IKS_REPORT_TIMEOUT_SECONDS,
    SOFA_BASE_URL,
    api_client,
)
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


class IksAccessReviewContractTests(unittest.TestCase):
    def setUp(self):
        self.template = (REPO_ROOT / "app/templates/tools/iks_tool.html").read_text(encoding="utf-8")
        self.script = (REPO_ROOT / "app/static/js/tools/iks.js").read_text(encoding="utf-8")
        self.stylesheet = (REPO_ROOT / "app/static/css/iks.css").read_text(encoding="utf-8")

    def test_elements_toggled_by_script_actually_collapse(self):
        # .btn carries display: inline-flex and .iks-type-option/.iks-builder-step are
        # grid items, so the UA rule for [hidden] loses on specificity without these.
        self.assertIn(".iks-export-actions .btn[hidden]", self.stylesheet)
        self.assertIn(".iks-type-option[hidden]", self.stylesheet)
        self.assertIn(".iks-builder-step[hidden]", self.stylesheet)

    def test_option_is_revealed_by_the_backend_catalog_only(self):
        # The markup ships the option hidden and disabled; nothing but
        # available_report_types turns it on, so no permission logic is rebuilt here.
        self.assertIn('"SOFA-IKS-REVIEW" in authz.permissions', self.template)
        self.assertIn('data-requires-catalog-type="access_review"', self.template)
        self.assertIn('data-authorized="false" disabled>', self.template)
        self.assertIn("Berechtigungsreview (PCI)", self.template)
        self.assertIn("isReportTypeAvailable(state.catalog, requiredType)", self.script)
        self.assertIn("available_report_types", self.script)

    def test_no_target_is_offered_for_the_access_review(self):
        self.assertIn('id="iks-target-step"', self.template)
        self.assertIn("DOM.targetStep.hidden = targetless;", self.script)
        self.assertIn("if (type === ACCESS_REVIEW_TYPE) return;", self.script)

    def test_primary_xlsx_download_runs_through_the_local_bff(self):
        self.assertIn('class="btn btn-primary" data-iks-export="xlsx"', self.template)
        self.assertIn('data-export-label="XLSX herunterladen"', self.template)
        self.assertIn('"xlsx"', self.script)
        self.assertIn('url.pathname.startsWith("/api/iks/")', self.script)
        self.assertNotIn("/sofa/iks/", self.script)

    def test_snapshot_detail_lists_are_not_rendered_in_the_browser(self):
        self.assertIn(
            "if (report.report_type === ACCESS_REVIEW_TYPE) return renderAccessReviewDetails();",
            self.script,
        )
        self.assertIn("wird ausschließlich in der XLSX-Datei ausgeliefert", self.script)

    def test_repeated_submit_is_blocked_while_the_report_is_generated(self):
        self.assertIn("DOM.submit.disabled = loading || !getReportType();", self.script)
        self.assertIn('DOM.submit.textContent = loading ? "Bericht wird erstellt …"', self.script)
        self.assertIn("setLoading(true);", self.script)
        self.assertIn("setLoading(false);", self.script)


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
            timeout=IKS_REPORT_TIMEOUT_SECONDS,
        )

    def test_report_calls_raise_the_timeout_above_the_shared_default(self):
        self.assertEqual(self.client.timeout, 10)
        self.assertGreater(IKS_REPORT_TIMEOUT_SECONDS, self.client.timeout)

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
            timeout=IKS_REPORT_TIMEOUT_SECONDS,
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

    def test_catalog_hides_report_types_the_user_may_not_run(self):
        catalog = {
            "available_report_types": ["access_review", "process", "role", "system"],
            "process_types": [{"id": "OFFBOARDING", "name": "Offboarding"}],
            "roles": [],
            "systems": [],
        }
        process_authz = SimpleNamespace(
            user_id=18,
            has_permission=lambda permission: permission == "SOFA-IKS-PRCS",
        )

        with patch.object(api_client, "get_iks_catalog", new_callable=AsyncMock, return_value=catalog):
            response = run_async(api_get_iks_catalog(authz=process_authz))

        self.assertEqual(response_json(response)["available_report_types"], ["process"])

    def test_catalog_keeps_access_review_for_the_review_permission(self):
        catalog = {
            "available_report_types": ["access_review", "process"],
            "process_types": [],
            "roles": [],
            "systems": [],
        }
        review_authz = SimpleNamespace(
            user_id=18,
            has_permission=lambda permission: permission == "SOFA-IKS-REVIEW",
        )

        with patch.object(api_client, "get_iks_catalog", new_callable=AsyncMock, return_value=catalog):
            response = run_async(api_get_iks_catalog(authz=review_authz))

        self.assertEqual(response_json(response)["available_report_types"], ["access_review"])

    def test_access_review_is_forwarded_with_an_empty_target(self):
        backend_report = {
            "report_id": "IKS-2026-000184",
            "report_type": "access_review",
            "exports": {"xlsx": "/sofa/iks/reports/IKS-2026-000184/exports/xlsx"},
        }
        browser_payload = {
            "report_type": "access_review",
            "target": None,
            "period": {"from": "2026-03-01", "to": "2026-08-31"},
            "timezone": "Europe/Berlin",
        }

        with patch.object(api_client, "create_iks_report", new_callable=AsyncMock, return_value=backend_report) as report_mock:
            response = run_async(api_create_iks_report(browser_payload, authz=self.authz))

        self.assertEqual(response.status_code, 200)
        report_mock.assert_awaited_once_with(18, {
            "report_type": "access_review",
            "target": None,
            "period": {"from": "2026-03-01", "to": "2026-08-31"},
            "timezone": "Europe/Berlin",
        })
        self.assertEqual(
            response_json(response)["exports"]["xlsx"],
            "/api/iks/reports/IKS-2026-000184/exports/xlsx",
        )

    def test_access_review_without_review_permission_is_blocked_locally(self):
        process_authz = SimpleNamespace(
            user_id=18,
            has_permission=lambda permission: permission == "SOFA-IKS-PRCS",
        )
        payload = {
            "report_type": "access_review",
            "target": None,
            "period": {"from": "2026-03-01", "to": "2026-08-31"},
            "timezone": "Europe/Berlin",
        }

        with patch.object(api_client, "create_iks_report", new_callable=AsyncMock) as report_mock:
            response = run_async(api_create_iks_report(payload, authz=process_authz))

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response_json(response)["detail"]["code"], "iks_report_access_denied")
        report_mock.assert_not_awaited()

    def test_xlsx_export_preserves_office_mime_type_and_filename(self):
        filename = "SOFA_Access_Review_2026-08-31_IKS-2026-000184.xlsx"
        request = httpx.Request("GET", "http://dev-api:8080/sofa/iks/reports/IKS-2026-000184/exports/xlsx")
        upstream = httpx.Response(
            200,
            request=request,
            content=b"PK\x03\x04 binary-workbook",
            headers={
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

        with patch.object(api_client, "download_iks_report_export", new_callable=AsyncMock, return_value=upstream) as export_mock:
            response = run_async(
                api_download_iks_report_export("IKS-2026-000184", "xlsx", authz=self.authz)
            )

        async def consume_body():
            if not hasattr(response, "body_iterator"):
                return response.content.read()
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            return b"".join(chunks)

        self.assertEqual(run_async(consume_body()), upstream.content)
        self.assertEqual(
            response.headers["content-type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertEqual(response.headers["content-disposition"], f'attachment; filename="{filename}"')
        export_mock.assert_awaited_once_with(18, "IKS-2026-000184", "xlsx")

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


@unittest.skipUnless(shutil.which("node"), "Node.js ist für die JavaScript-Logiktests nicht verfügbar")
class IksAccessReviewUiLogicTests(unittest.TestCase):
    def test_request_building_validation_and_catalog_gate(self):
        javascript_path = REPO_ROOT / "app/static/js/tools/iks.js"
        script = r"""
            const assert = require('assert');
            const ui = require(process.argv[1]);

            // The access review always posts report_type access_review with target null.
            assert.deepStrictEqual(
                ui.buildReportRequest({ reportType: 'access_review', targetId: '5', from: '2026-03-01', to: '2026-08-31' }),
                {
                    report_type: 'access_review',
                    target: null,
                    period: { from: '2026-03-01', to: '2026-08-31' },
                    timezone: 'Europe/Berlin'
                }
            );

            // Existing controls keep their target handling unchanged.
            assert.deepStrictEqual(
                ui.buildReportRequest({ reportType: 'role', targetId: '5', from: '2026-07-01', to: '2026-07-31' }).target,
                { id: '5' }
            );
            assert.strictEqual(
                ui.buildReportRequest({ reportType: 'process', targetId: '__all_process_types__', from: '2026-07-01', to: '2026-07-31' }).target,
                null
            );
            assert.throws(
                () => ui.buildReportRequest({ reportType: 'system', targetId: '', from: '2026-07-01', to: '2026-07-31' }),
                /System/
            );

            // Shared period validation: both dates required, from must not follow to.
            assert.throws(
                () => ui.buildReportRequest({ reportType: 'access_review', targetId: null, from: '', to: '2026-08-31' }),
                /Reviewzeitraum/
            );
            assert.throws(
                () => ui.buildReportRequest({ reportType: 'access_review', targetId: null, from: '2026-08-31', to: '2026-03-01' }),
                /Startdatum/
            );
            assert.throws(
                () => ui.buildReportRequest({ reportType: 'unbekannt', targetId: null, from: '2026-03-01', to: '2026-08-31' }),
                /Kontrollart/
            );

            // The option follows available_report_types, never a locally rebuilt permission.
            const withReview = ui.normalizeCatalog({
                process_types: [], roles: [], systems: [],
                available_report_types: ['access_review', 'process', 'role', 'system']
            });
            const withoutReview = ui.normalizeCatalog({
                process_types: [], roles: [], systems: [],
                available_report_types: ['process', 'role', 'system']
            });
            assert.strictEqual(ui.isReportTypeAvailable(withReview, 'access_review'), true);
            assert.strictEqual(ui.isReportTypeAvailable(withoutReview, 'access_review'), false);

            // A backend without the field keeps the new type hidden.
            const legacy = ui.normalizeCatalog({ process_types: [], roles: [], systems: [] });
            assert.deepStrictEqual(legacy.available_report_types, ['process', 'role', 'system']);
            assert.strictEqual(ui.isReportTypeAvailable(legacy, 'access_review'), false);

            // Report validation accepts the empty target only where the contract allows it.
            const base = {
                schema_version: '1.0', ruleset_version: 'r-1', report_id: 'IKS-2026-000184',
                title: 'Berechtigungsreview', generated_at: '2026-09-01T08:00:00Z',
                generated_by: { name: 'SD-IT' }, data_as_of: '2026-08-31T22:00:00Z',
                period: { from: '2026-03-01', to: '2026-08-31' },
                assessment: { status: 'ok', label: 'Ohne Befund' }, kpis: [],
                exports: { xlsx: '/api/iks/reports/IKS-2026-000184/exports/xlsx' }
            };
            assert.deepStrictEqual(
                ui.validateReport(Object.assign({}, base, { report_type: 'access_review', target: null })),
                []
            );
            assert.ok(
                ui.validateReport(Object.assign({}, base, { report_type: 'system', target: null }))
                    .includes('target.name fehlt')
            );
            // Optional snapshot blocks are still validated once the backend sends them.
            assert.ok(
                ui.validateReport(Object.assign({}, base, {
                    report_type: 'access_review', target: null, data_quality: {}
                })).includes('data_quality ist unvollständig')
            );
        """

        completed = subprocess.run(
            ["node", "-e", script, str(javascript_path)],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
