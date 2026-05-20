import asyncio
import json
import sys
import types
import unittest
from unittest.mock import patch

try:
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

        def set_cookie(self, key, value, **kwargs):
            self.headers["set-cookie"] = f"{key}={value}"

    class HTMLResponse:
        pass

    class RedirectResponse:
        def __init__(self, url="", status_code=303):
            self.url = url
            self.status_code = status_code

        def set_cookie(self, *args, **kwargs):
            return None

        def delete_cookie(self, *args, **kwargs):
            return None

    class StreamingResponse:
        def __init__(self, content=None, status_code=200, media_type=None, headers=None):
            self.content = content
            self.status_code = status_code
            self.media_type = media_type
            self.headers = headers or {}

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
        url = types.SimpleNamespace(scheme="http")

    class UploadFile:
        filename = None

        async def read(self):
            return b""

        async def close(self):
            return None

    class Response:
        def __init__(self, status_code=500, payload=None, text=""):
            self.status_code = status_code
            self._payload = payload or {}
            self.text = text

        def json(self):
            return self._payload

    class HTTPStatusError(Exception):
        def __init__(self, response=None):
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

    sys.modules.setdefault("fastapi", fastapi_module)
    sys.modules.setdefault("fastapi.exceptions", fastapi_exceptions_module)
    sys.modules.setdefault("fastapi.responses", fastapi_responses_module)
    sys.modules.setdefault("fastapi.templating", fastapi_templating_module)
    sys.modules.setdefault("httpx", httpx_module)

from app.authz import build_authorization_context_from_user, get_authz_payload_for_template, require_page_access
from app.routes.api import api_get_role_detail, api_session_authz_refresh, api_users
from app.routes.shared import _task_is_visible_to_user


def make_role(role_id, name, **extra):
    payload = {
        "role_id": role_id,
        "name": name,
        "is_active": True,
    }
    payload.update(extra)
    return payload


def make_user(primary_role=None, **extra):
    payload = {
        "user_id": 42,
        "pnr": "10042",
        "first_name": "Max",
        "last_name": "Mustermann",
        "primary_role": primary_role,
        "secondary_roles": [],
    }
    payload.update(extra)
    return payload


def run_async(awaitable):
    return asyncio.run(awaitable)


class AuthorizationContextTests(unittest.TestCase):
    def test_full_access_roles_receive_all_pages(self):
        for role in (make_role(21, "SD-IT"), make_role(19, "SD-VV-Leitung")):
            authz = build_authorization_context_from_user(make_user(primary_role=role))

            self.assertTrue(authz.has_page("tasks"))
            self.assertTrue(authz.has_page("tools"))
            self.assertTrue(authz.has_page("users"))
            self.assertTrue(authz.has_page("systems"))
            self.assertTrue(authz.has_page("roles"))
            self.assertTrue(authz.has_page("iks"))
            self.assertTrue(authz.has_page("console"))
            self.assertEqual(authz.capabilities, frozenset())
            self.assertEqual(authz.permission_keys, ())
            self.assertEqual(authz.grants, ())

    def test_mid_access_roles_receive_users_but_not_admin_pages(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(13, "SD-Teamleiter")))

        self.assertEqual(authz.pages, frozenset({"dashboard", "tasks", "tools", "users"}))
        self.assertFalse(authz.has_page("roles"))
        self.assertFalse(authz.has_page("systems"))
        self.assertFalse(authz.has_page("console"))
        self.assertFalse(authz.has_page("iks"))

    def test_base_roles_receive_dashboard_tasks_and_tools(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(7, "SD-Agent")))

        self.assertEqual(authz.pages, frozenset({"dashboard", "tasks", "tools"}))
        self.assertTrue(authz.has_page("dashboard"))
        self.assertTrue(authz.has_page("tasks"))
        self.assertTrue(authz.has_page("tools"))
        self.assertFalse(authz.has_page("users"))

    def test_unknown_active_role_falls_back_to_base_access(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(999, "Unbekannt")))

        self.assertEqual(authz.pages, frozenset({"dashboard", "tasks", "tools"}))
        self.assertEqual(authz.role_key, "unbekannt")
        self.assertEqual(authz.effective_policy_keys, ("unbekannt",))

    def test_missing_primary_role_keeps_access_empty(self):
        authz = build_authorization_context_from_user(make_user(primary_role=None))

        self.assertEqual(authz.pages, frozenset())
        self.assertEqual(authz.capabilities, frozenset())
        self.assertEqual(authz.effective_role_ids, ())
        self.assertEqual(authz.effective_policy_keys, ("basic_user",))

    def test_secondary_roles_do_not_expand_page_access(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(7, "SD-Agent"),
                secondary_roles=[make_role(21, "SD-IT"), make_role(19, "SD-VV-Leitung")],
            )
        )

        self.assertEqual(authz.pages, frozenset({"dashboard", "tasks", "tools"}))
        self.assertEqual(authz.effective_role_ids, (7,))
        self.assertEqual(authz.effective_role_names, ("SD-Agent",))

    def test_require_page_access_denies_missing_page(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(13, "SD-Teamleiter")))
        dependency = require_page_access("roles")

        with self.assertRaises(HTTPException) as exc_info:
            run_async(dependency(authz=authz))

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(exc_info.exception.detail["code"], "page_access_denied")

    def test_tasks_are_visible_without_backlog_granularity_once_page_is_allowed(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(7, "SD-Agent")))
        task = {"task_id": 100, "backlog_id": 1}

        self.assertTrue(_task_is_visible_to_user(task, authz))

    def test_template_payload_keeps_shape_with_empty_capabilities_and_grants(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(21, "SD-IT")))
        payload = get_authz_payload_for_template(authz)

        expected_keys = {
            "pages",
            "capabilities",
            "scopes",
            "primary_role_name",
            "primary_role_id",
            "role_key",
            "effective_role_ids",
            "effective_role_names",
            "effective_policy_keys",
            "permission_keys",
            "grants",
            "visible_task_backlog_ids",
            "can_view_all_task_backlogs",
            "has_admin_access",
        }
        self.assertEqual(set(payload.keys()), expected_keys)
        self.assertEqual(payload["capabilities"], [])
        self.assertEqual(payload["permission_keys"], [])
        self.assertEqual(payload["grants"], [])
        self.assertTrue(payload["has_admin_access"])


class ApiBehaviorTests(unittest.TestCase):
    def test_api_users_returns_list_for_users_page(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(13, "SD-Teamleiter")))

        async def fake_list_users(*args, **kwargs):
            return [{"user_id": 1}]

        with patch("app.routes.api.api_client.list_users", new=fake_list_users):
            response = run_async(api_users(current_user=authz))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body), [{"user_id": 1}])

    def test_api_get_role_detail_passes_backend_payload_through_without_sofa_normalization(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(21, "SD-IT")))

        async def fake_get_role_detail(*args, **kwargs):
            return {
                "role_id": 21,
                "name": "SD-IT",
                "resources": [{"resource_id": 55}],
            }

        with patch("app.routes.api.api_client.get_role_detail", new=fake_get_role_detail):
            response = run_async(api_get_role_detail(21, current_user=authz))

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["role_id"], 21)
        self.assertNotIn("sofa_grants", payload)
        self.assertNotIn("inherited_sofa_grants", payload)

    def test_api_session_authz_refresh_updates_cookie_and_uses_primary_role_matrix(self):
        session_user = make_user(primary_role=make_role(7, "SD-Agent"))
        refreshed_user = make_user(primary_role=make_role(21, "SD-IT"))
        request = types.SimpleNamespace(headers={}, url=types.SimpleNamespace(scheme="http"))

        async def fake_get_current_user(*args, **kwargs):
            return refreshed_user

        with patch("app.routes.api.api_client.get_current_user", new=fake_get_current_user):
            response = run_async(api_session_authz_refresh(request=request, sofa_user=json.dumps(session_user)))

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["refreshed"])
        self.assertIn("roles", payload["authz"]["pages"])
        self.assertIn("console", payload["authz"]["pages"])
        self.assertEqual(payload["authz"]["capabilities"], [])
        self.assertIn("set-cookie", getattr(response, "headers", {}))

    def test_api_session_authz_refresh_returns_401_without_session(self):
        request = types.SimpleNamespace(headers={}, url=types.SimpleNamespace(scheme="http"))

        response = run_async(api_session_authz_refresh(request=request, sofa_user=None))

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Keine aktive Session", payload["detail"])


if __name__ == "__main__":
    unittest.main()
