import asyncio
import json
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
                raise AssertionError("Expected exactly one await, got {}".format(self.await_count))
            if self.await_args != (args, kwargs):
                raise AssertionError("Expected await args {}, got {}".format((args, kwargs), self.await_args))

try:
    import httpx
    import fastapi
    if not hasattr(fastapi, "APIRouter") or not hasattr(fastapi, "UploadFile"):
        raise ImportError("Incomplete FastAPI test double")
except (ModuleNotFoundError, ImportError):
    # Reuse the repository's Python-3.7-compatible FastAPI/httpx test doubles.
    from tests import test_word_templates_tool as _compat  # noqa: F401
    import httpx

    class _CompatRequest:
        def __init__(self, method, url):
            self.method = method
            self.url = url

    class _CompatResponse:
        def __init__(self, status_code=200, payload=None, content=None, headers=None, json=None, request=None, text=""):
            self.status_code = status_code
            self._payload = json if json is not None else payload
            self.request = request
            self.headers = {key.lower(): value for key, value in (headers or {}).items()}
            self.content = content if content is not None else __import__("json").dumps(self._payload or {}).encode("utf-8")
            self.text = text or (self.content.decode("utf-8") if isinstance(self.content, bytes) else str(self.content))

        def json(self):
            if self._payload is not None:
                return self._payload
            return __import__("json").loads(self.content.decode("utf-8"))

    class _CompatHTTPStatusError(Exception):
        def __init__(self, *args, response=None, request=None, **kwargs):
            super().__init__(args[0] if args else "HTTP status error")
            self.response = response or _CompatResponse(500, request=request)
            self.request = request

    httpx.Request = _CompatRequest
    httpx.Response = _CompatResponse
    httpx.HTTPStatusError = _CompatHTTPStatusError

from app.api_client import INVENTORY_BASE_URL, api_client
from app.routes.api import (
    api_computer_overview,
    api_create_computer_power_action,
    api_create_computer_software_action,
    api_get_computer_detail,
    api_get_computer_job_batch,
    api_get_computer_jobs,
    api_update_computer_comment,
)
from app.routes.pages import computers


def run_async(awaitable):
    return asyncio.run(awaitable)


def json_body(response):
    return json.loads(response.body.decode("utf-8"))


def make_http_error(status_code, payload):
    if hasattr(httpx, "Request"):
        request = httpx.Request("GET", "http://testserver/mock")
        response = httpx.Response(status_code, json=payload, request=request)
        return httpx.HTTPStatusError("HTTP status error", request=request, response=response)
    response = SimpleNamespace(
        status_code=status_code,
        text=json.dumps(payload),
        json=lambda: payload,
    )
    return httpx.HTTPStatusError(response=response)


class ComputerClientTests(unittest.TestCase):
    @patch.object(api_client, "_get", new_callable=AsyncMock)
    def test_overview_uses_inventory_service(self, get_mock):
        get_mock.return_value = {"computers": [], "software_catalog": []}

        result = run_async(api_client.get_computer_overview())

        self.assertEqual(result, {"computers": [], "software_catalog": []})
        get_mock.assert_awaited_once_with(INVENTORY_BASE_URL, "/computers/overview")

    @patch.object(api_client, "_get", new_callable=AsyncMock)
    def test_detail_encodes_computer_id(self, get_mock):
        get_mock.return_value = {"id": "pc/a"}

        run_async(api_client.get_computer_detail("pc/a"))

        get_mock.assert_awaited_once_with(INVENTORY_BASE_URL, "/computers/pc%2Fa")

    @patch.object(api_client, "_patch", new_callable=AsyncMock)
    def test_comment_uses_patch(self, patch_mock):
        patch_mock.return_value = {"comment": "Hinweis"}
        payload = {"comment": "Hinweis", "initiator_user_id": 42}

        run_async(api_client.update_computer_comment("pc-1", payload))

        patch_mock.assert_awaited_once_with(
            INVENTORY_BASE_URL,
            "/computers/pc-1/comment",
            payload=payload,
        )

    @patch.object(api_client, "_post", new_callable=AsyncMock)
    def test_software_action_uses_single_bulk_endpoint(self, post_mock):
        post_mock.return_value = {"batch_id": "batch-1"}
        payload = {"computer_ids": ["pc-1"], "action": "install", "software_id": "firefox"}

        run_async(api_client.create_computer_software_action(payload))

        post_mock.assert_awaited_once_with(
            INVENTORY_BASE_URL,
            "/computers/software-actions",
            payload=payload,
        )

    @patch.object(api_client, "_get", new_callable=AsyncMock)
    def test_jobs_include_limit(self, get_mock):
        get_mock.return_value = {"jobs": []}

        run_async(api_client.get_computer_jobs("pc-1", limit=25))

        get_mock.assert_awaited_once_with(
            INVENTORY_BASE_URL,
            "/computers/pc-1/jobs",
            params={"limit": 25},
        )


class ComputerApiTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)

    @patch("app.routes.api.api_client.get_computer_overview", new_callable=AsyncMock)
    def test_overview_returns_contract(self, overview_mock):
        overview_mock.return_value = {"computers": [{"id": "pc-1"}], "software_catalog": []}

        response = run_async(api_computer_overview(current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["computers"][0]["id"], "pc-1")

    @patch("app.routes.api.api_client.get_computer_detail", new_callable=AsyncMock)
    def test_detail_propagates_upstream_status(self, detail_mock):
        detail_mock.side_effect = make_http_error(404, {"detail": "Rechner nicht gefunden"})

        response = run_async(api_get_computer_detail("missing", current_user=self.current_user))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(json_body(response), {"detail": "Rechner nicht gefunden"})

    @patch("app.routes.api.api_client.update_computer_comment", new_callable=AsyncMock)
    def test_comment_is_trimmed_and_initiator_added(self, comment_mock):
        comment_mock.return_value = {"comment": "Hinweis"}

        response = run_async(api_update_computer_comment(
            "pc-1",
            {"comment": "  Hinweis  "},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        comment_mock.assert_awaited_once_with(
            "pc-1",
            {"comment": "Hinweis", "initiator_user_id": 42},
        )

    def test_comment_rejects_non_string(self):
        response = run_async(api_update_computer_comment(
            "pc-1",
            {"comment": ["ungueltig"]},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 400)

    @patch("app.routes.api.api_client.create_computer_power_action", new_callable=AsyncMock)
    def test_power_action_normalizes_payload(self, power_mock):
        power_mock.return_value = {"job_id": "job-1", "status": "queued"}

        response = run_async(api_create_computer_power_action(
            "pc-1",
            {"action": "REBOOT", "confirm_active_session": True},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        power_mock.assert_awaited_once_with(
            "pc-1",
            {"action": "reboot", "confirm_active_session": True, "initiator_user_id": 42},
        )

    @patch("app.routes.api.api_client.create_computer_software_action", new_callable=AsyncMock)
    def test_software_action_deduplicates_targets(self, software_mock):
        software_mock.return_value = {"batch_id": "batch-1", "results": []}

        response = run_async(api_create_computer_software_action(
            {
                "computer_ids": ["pc-1", "pc-1", "pc-2"],
                "action": "install",
                "software_id": "firefox",
                "version": "131.0",
            },
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        software_mock.assert_awaited_once_with({
            "computer_ids": ["pc-1", "pc-2"],
            "action": "install",
            "software_id": "firefox",
            "version": "131.0",
            "initiator_user_id": 42,
        })

    def test_software_action_rejects_empty_targets(self):
        response = run_async(api_create_computer_software_action(
            {"computer_ids": [], "action": "install", "software_id": "firefox"},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 400)

    @patch("app.routes.api.api_client.get_computer_jobs", new_callable=AsyncMock)
    def test_job_limit_is_clamped(self, jobs_mock):
        jobs_mock.return_value = {"jobs": []}

        response = run_async(api_get_computer_jobs("pc-1", limit=999, current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        jobs_mock.assert_awaited_once_with("pc-1", limit=100)

    @patch("app.routes.api.api_client.get_computer_job_batch", new_callable=AsyncMock)
    def test_job_batch_is_proxied(self, batch_mock):
        batch_mock.return_value = {"batch_id": "batch-1", "status": "running"}

        response = run_async(api_get_computer_job_batch("batch-1", current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        batch_mock.assert_awaited_once_with("batch-1")


class ComputerPageTests(unittest.TestCase):
    def test_computers_page_uses_new_template(self):
        request = SimpleNamespace(headers={}, url=SimpleNamespace(scheme="http"))
        authz = SimpleNamespace(raw_user={"user_id": 42})

        with patch("app.routes.pages._build_template_context", return_value={"request": request}):
            with patch("app.routes.pages.templates.TemplateResponse", side_effect=lambda name, context: {"name": name, "context": context}):
                response = run_async(computers(request, authz=authz))

        self.assertEqual(response["name"], "rechnerverwaltung.html")

if __name__ == "__main__":
    unittest.main()
