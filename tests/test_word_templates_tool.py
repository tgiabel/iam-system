import asyncio
import json
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

try:
    import httpx
    from fastapi import HTTPException
except ModuleNotFoundError:
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
            self.headers = headers or {}

    class HTMLResponse:
        pass

    class RedirectResponse:
        def __init__(self, url="", status_code=303):
            self.url = url
            self.status_code = status_code

    class APIRouter:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

        def _decorator(self, *args, **kwargs):
            def register(func):
                return func

            return register

        get = post = delete = patch = put = _decorator

    class Jinja2Templates:
        def __init__(self, directory=None):
            self.directory = directory

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
        content_type = None

        async def read(self):
            return b""

        async def close(self):
            return None

    class Response:
        def __init__(self, status_code=500, payload=None, text="", content=None, headers=None):
            self.status_code = status_code
            self._payload = payload
            self.text = text
            self.content = content if content is not None else json.dumps(payload or {}).encode("utf-8")
            self.headers = headers or {}

        def json(self):
            if self._payload is not None:
                return self._payload
            raise ValueError("No JSON payload")

    class HTTPStatusError(Exception):
        def __init__(self, *args, response=None, **kwargs):
            super().__init__("HTTP status error")
            self.response = response or Response()

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
    httpx_module.RequestError = Exception

    sys.modules.setdefault("fastapi", fastapi_module)
    sys.modules.setdefault("fastapi.exceptions", fastapi_exceptions_module)
    sys.modules.setdefault("fastapi.responses", fastapi_responses_module)
    sys.modules.setdefault("fastapi.templating", fastapi_templating_module)
    sys.modules.setdefault("httpx", httpx_module)

    import httpx

from app.routes.api import (
    api_create_word_template,
    api_download_word_document,
    api_get_word_template,
    api_list_word_templates,
    api_list_word_template_users,
    api_prefill_word_template,
    api_render_word_template,
    api_render_download_word_template,
    api_update_word_template,
)
from app.routes.pages import word_templates_tool


def run_async(awaitable):
    return asyncio.run(awaitable)


def json_body(response):
    body = getattr(response, "body", b"")
    if isinstance(body, bytes):
        return json.loads(body.decode("utf-8"))
    if isinstance(body, str):
        return json.loads(body)
    return body


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


def make_binary_response(content, headers):
    return SimpleNamespace(content=content, headers=headers)


class FakeUploadFile:
    def __init__(self, filename, payload, content_type="application/octet-stream"):
        self.filename = filename
        self._payload = payload
        self.content_type = content_type
        self.closed = False

    async def read(self):
        return self._payload

    async def close(self):
        self.closed = True


class WordTemplatesPageTests(unittest.TestCase):
    def test_word_templates_page_uses_expected_template(self):
        request = SimpleNamespace(headers={}, url=SimpleNamespace(scheme="http"))
        authz = SimpleNamespace(raw_user={"user_id": 7})

        with patch("app.routes.pages._build_template_context", return_value={"request": request, "user": authz.raw_user}) as context_mock:
            with patch("app.routes.pages.templates.TemplateResponse", side_effect=lambda name, context: {"name": name, "context": context}):
                response = run_async(word_templates_tool(request, authz=authz))

        self.assertEqual(response["name"], "tools/word_templates_tool.html")
        context_mock.assert_called_once()


class WordTemplatesApiTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)

    @patch("app.routes.api.api_client.list_word_templates", new_callable=AsyncMock)
    def test_list_templates_returns_json_payload(self, list_mock):
        list_mock.return_value = [{"template_id": "tpl-1", "name": "Angebot"}]

        response = run_async(api_list_word_templates(current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response), [{"template_id": "tpl-1", "name": "Angebot"}])
        list_mock.assert_awaited_once_with()

    @patch("app.routes.api.api_client.get_word_template", new_callable=AsyncMock)
    def test_get_template_propagates_not_found_error(self, get_mock):
        get_mock.side_effect = make_http_error(404, {"detail": "Template nicht gefunden"})

        response = run_async(api_get_word_template("missing", current_user=self.current_user))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(json_body(response), {"detail": "Template nicht gefunden"})

    @patch("app.routes.api.api_client.list_users", new_callable=AsyncMock)
    def test_list_word_template_users_returns_minimal_tool_payload(self, users_mock):
        users_mock.return_value = [
            {"user_id": 2, "first_name": "Berta", "last_name": "Zimmer", "email": "berta@example.org", "pnr": "2002", "racf": "bz", "is_active": True},
            {"user_id": 1, "first_name": "Anna", "last_name": "Becker", "email": "anna@example.org", "pnr": "1001", "racf": "ab", "is_active": True},
        ]

        response = run_async(api_list_word_template_users(current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json_body(response),
            [
                {"user_id": 1, "pnr": "1001", "racf": "ab", "first_name": "Anna", "last_name": "Becker", "email": "anna@example.org", "is_active": True},
                {"user_id": 2, "pnr": "2002", "racf": "bz", "first_name": "Berta", "last_name": "Zimmer", "email": "berta@example.org", "is_active": True},
            ],
        )
        users_mock.assert_awaited_once_with(is_active=True)

    @patch("app.routes.api.api_client.create_word_template", new_callable=AsyncMock)
    def test_create_template_forwards_multipart_payload(self, create_mock):
        create_mock.return_value = {"template_id": "tpl-2", "name": "Vertrag"}
        upload = FakeUploadFile("vertrag.dotx", b"template-bytes", content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.template")

        response = run_async(
            api_create_word_template(
                name="Vertrag",
                description="Testvorlage",
                schema_json='{"version": 1, "fields": []}',
                template_file=upload,
                current_user=self.current_user,
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response), {"template_id": "tpl-2", "name": "Vertrag"})
        self.assertTrue(upload.closed)
        create_mock.assert_awaited_once_with(
            name="Vertrag",
            description="Testvorlage",
            schema_json='{"version": 1, "fields": []}',
            template_filename="vertrag.dotx",
            template_content=b"template-bytes",
            template_content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.template",
        )

    @patch("app.routes.api.api_client.update_word_template", new_callable=AsyncMock)
    def test_update_template_uses_put_proxy(self, update_mock):
        payload = {"name": "Neu", "description": "", "schema": {"version": 1, "fields": []}}
        update_mock.return_value = {"template_id": "tpl-3", "name": "Neu"}

        response = run_async(api_update_word_template("tpl-3", payload, current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response), {"template_id": "tpl-3", "name": "Neu"})
        update_mock.assert_awaited_once_with("tpl-3", payload)

    @patch("app.routes.api.api_client.render_word_template", new_callable=AsyncMock)
    def test_render_template_returns_document_metadata(self, render_mock):
        render_mock.return_value = {
            "document_id": "doc-5",
            "template_id": "tpl-9",
            "output_filename": "angebot.docx",
        }

        response = run_async(
            api_render_word_template(
                "tpl-9",
                {"values": {"kunde_name": "Acme GmbH", "agb_ok": True}},
                current_user=self.current_user,
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json_body(response),
            {
                "document_id": "doc-5",
                "template_id": "tpl-9",
                "output_filename": "angebot.docx",
            },
        )
        render_mock.assert_awaited_once_with("tpl-9", {"values": {"kunde_name": "Acme GmbH", "agb_ok": True}})

    @patch("app.routes.api.api_client.prefill_word_template", new_callable=AsyncMock)
    def test_prefill_template_adds_initiator_user_id(self, prefill_mock):
        prefill_mock.return_value = {
            "template_id": "tpl-9",
            "user_id": 77,
            "fields": [{"key": "first_name", "label": "Vorname", "type": "text", "required": True, "value": "Anna"}],
        }

        response = run_async(
            api_prefill_word_template(
                "tpl-9",
                {"user_id": 77},
                current_user=self.current_user,
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json_body(response),
            {
                "template_id": "tpl-9",
                "user_id": 77,
                "fields": [{"key": "first_name", "label": "Vorname", "type": "text", "required": True, "value": "Anna"}],
            },
        )
        prefill_mock.assert_awaited_once_with(
            "tpl-9",
            {"user_id": 77, "initiator_user_id": self.current_user.user_id},
        )

    @patch("app.routes.api.api_client.render_download_word_template", new_callable=AsyncMock)
    def test_render_download_streams_binary_docx_response(self, render_download_mock):
        headers = {
            "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content-disposition": 'attachment; filename="formular.docx"',
        }
        render_download_mock.return_value = make_binary_response(b"docx-binary", headers)

        response = run_async(
            api_render_download_word_template(
                "tpl-9",
                {"user_id": 77, "values": {"first_name": "Anna"}},
                current_user=self.current_user,
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.media_type, headers["content-type"])
        self.assertEqual(response.headers.get("Content-Disposition"), headers["content-disposition"])
        render_download_mock.assert_awaited_once_with(
            "tpl-9",
            {"user_id": 77, "values": {"first_name": "Anna"}, "initiator_user_id": self.current_user.user_id},
        )

    @patch("app.routes.api.api_client.download_word_document", new_callable=AsyncMock)
    def test_download_template_streams_docx_response(self, download_mock):
        headers = {
            "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content-disposition": 'attachment; filename="angebot.docx"',
        }
        download_mock.return_value = make_binary_response(b"docx-bytes", headers)

        response = run_async(api_download_word_document("doc-1", current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.media_type, headers["content-type"])
        self.assertEqual(response.headers.get("Content-Disposition"), headers["content-disposition"])
        download_mock.assert_awaited_once_with("doc-1")

    @patch("app.routes.api.api_client.list_word_templates", new_callable=AsyncMock)
    def test_list_templates_returns_500_for_unexpected_errors(self, list_mock):
        list_mock.side_effect = Exception("boom")

        response = run_async(api_list_word_templates(current_user=self.current_user))

        self.assertEqual(response.status_code, 500)
        self.assertEqual(json_body(response), {"error": "boom"})


if __name__ == "__main__":
    unittest.main()
