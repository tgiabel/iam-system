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

        get = post = delete = patch = _decorator

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

from app.authz import (
    build_authorization_context_from_user,
    get_authz_payload_for_template,
    require_capability,
    require_page_access,
)
from app.routes.api import api_users
from app.routes.api import api_get_role_detail, api_sofa_permissions
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


def make_grant(permission, resources=None):
    payload = {"permission": permission}
    if resources is not None:
        payload["resources"] = resources
    return payload


def run_async(awaitable):
    return asyncio.run(awaitable)


class AuthorizationContextTests(unittest.TestCase):
    def test_missing_sofa_authorization_uses_minimal_rights(self):
        user = make_user(primary_role=make_role(999, "Unbekannt"))

        authz = build_authorization_context_from_user(user)

        self.assertEqual(authz.role_key, "basic_user")
        self.assertEqual(authz.effective_policy_keys, ("basic_user",))
        self.assertEqual(authz.pages, frozenset())
        self.assertEqual(authz.capabilities, frozenset())
        self.assertEqual(authz.get_scope("tasks"), "none")
        self.assertEqual(authz.get_scope("users"), "none")
        self.assertFalse(authz.can_view_all_task_backlogs)
        self.assertEqual(authz.visible_task_backlog_ids, ())

    def test_grants_project_pages_capabilities_and_backlog_scope(self):
        user = make_user(
            primary_role=make_role(21, "IT"),
            sofa_authorization={
                "version": 1,
                "grants": [
                    make_grant("tasks.view"),
                    make_grant("tasks.backlog.view", {"task_backlogs": {"all": True, "ids": [7]}}),
                    make_grant("users.view"),
                    make_grant("users.primary_role.request", {"roles": {"all": True, "ids": []}}),
                    make_grant("roles.view"),
                ],
            },
        )

        authz = build_authorization_context_from_user(user)

        self.assertEqual(authz.role_key, "custom")
        self.assertEqual(authz.effective_policy_keys, ("custom",))
        self.assertTrue(authz.has_page("tasks"))
        self.assertTrue(authz.has_page("users"))
        self.assertTrue(authz.has_page("roles"))
        self.assertTrue(authz.has_capability("primary_role.change"))
        self.assertEqual(authz.get_scope("tasks"), "all")
        self.assertEqual(authz.get_scope("users"), "all")
        self.assertTrue(authz.can_view_all_task_backlogs)
        self.assertEqual(authz.visible_task_backlog_ids, (7,))

    def test_multiple_roles_keep_effective_roles_and_merge_permission_keys(self):
        user = make_user(
            primary_role=make_role(19, "Verwaltung & Vertrieb Leitung"),
            secondary_roles=[
                make_role(13, "Teamleiter"),
                make_role(21, "IT"),
            ],
            sofa_authorization={
                "version": 1,
                "profile_keys": ["operational-admin", "agent-supervisor"],
                "grants": [
                    make_grant("tasks.view"),
                    make_grant("tasks.backlog.view", {"task_backlogs": {"all": False, "ids": [3, 5]}}),
                    make_grant("tools.view"),
                    make_grant("tools.item.view", {"tools": {"all": False, "ids": [11]}}),
                    make_grant("reports.item.view", {"reports": {"all": True, "ids": []}}),
                    make_grant("console.view"),
                ],
            },
        )

        authz = build_authorization_context_from_user(user)

        self.assertEqual(authz.role_key, "operational-admin")
        self.assertEqual(authz.effective_policy_keys, ("operational-admin", "agent-supervisor"))
        self.assertTrue(authz.has_page("console"))
        self.assertEqual(authz.permission_keys, ("tasks.view", "tasks.backlog.view", "tools.view", "tools.item.view", "reports.item.view", "console.view"))
        self.assertEqual(authz.get_scope("tasks"), "relevant_only")
        self.assertEqual(authz.get_scope("tools"), "own_only")
        self.assertEqual(authz.get_scope("reports"), "all")
        self.assertFalse(authz.can_view_all_task_backlogs)
        self.assertEqual(authz.visible_task_backlog_ids, (3, 5))

    def test_inactive_and_duplicate_roles_are_ignored(self):
        user = make_user(
            primary_role=make_role(13, "Teamleiter"),
            secondary_roles=[
                make_role(13, "Teamleiter"),
                make_role(21, "IT", assignment_status="REVOKED"),
                make_role(23, "Steuerung", is_active=False),
            ],
            sofa_authorization={"version": 1, "grants": [make_grant("tasks.view")]},
        )

        authz = build_authorization_context_from_user(user)

        self.assertEqual(authz.effective_role_ids, (13,))
        self.assertEqual(authz.effective_policy_keys, ("custom",))
        self.assertEqual(authz.get_scope("tasks"), "none")
        self.assertFalse(authz.can_view_all_task_backlogs)

    def test_require_page_access_denies_missing_page(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(19, "Verwaltung & Vertrieb Leitung")))
        dependency = require_page_access("roles")

        with self.assertRaises(HTTPException) as exc_info:
            run_async(dependency(authz=authz))

        self.assertEqual(exc_info.exception.status_code, 403)
        self.assertEqual(exc_info.exception.detail["code"], "page_access_denied")

    def test_require_capability_allows_present_capability(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(21, "IT"),
                sofa_authorization={"version": 1, "grants": [make_grant("sofa_access.revoke")]},
            )
        )
        dependency = require_capability("sofa_access.revoke")

        resolved = run_async(dependency(authz=authz))

        self.assertIs(resolved, authz)

    def test_api_users_returns_empty_list_for_users_scope_none(self):
        authz = build_authorization_context_from_user(make_user(primary_role=make_role(7, "Agent")))

        async def fake_list_users(*args, **kwargs):
            return [{"user_id": 1}]

        with patch("app.routes.api.api_client.list_users", new=fake_list_users):
            response = run_async(api_users(current_user=authz))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body), [])

    def test_task_backlog_access_blocks_tasks_without_explicit_backlog_rights(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(13, "Teamleiter"),
                sofa_authorization={"version": 1, "grants": [make_grant("tasks.view")]},
            )
        )
        task = {
            "task_id": 100,
            "backlog_id": 1,
            "assigned_to_user_id": 42,
            "target_user_id": 42,
        }

        self.assertFalse(_task_is_visible_to_user(task, authz))

    def test_task_visibility_allows_any_task_from_permitted_backlog(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(21, "IT"),
                sofa_authorization={
                    "version": 1,
                    "grants": [
                        make_grant("tasks.view"),
                        make_grant("tasks.backlog.view", {"task_backlogs": {"all": False, "ids": [999]}}),
                    ],
                },
            )
        )
        task = {
            "task_id": 101,
            "backlog_id": 999,
            "assigned_to_user_id": 7,
            "target_user_id": 7,
        }

        self.assertTrue(_task_is_visible_to_user(task, authz))

    def test_template_payload_keeps_existing_shape(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(21, "IT"),
                sofa_authorization={"version": 1, "grants": [make_grant("roles.view")]},
            )
        )

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
        self.assertIsInstance(payload["pages"], list)
        self.assertIsInstance(payload["capabilities"], list)
        self.assertIsInstance(payload["scopes"], dict)
        self.assertIsInstance(payload["effective_role_ids"], list)
        self.assertIsInstance(payload["effective_policy_keys"], list)
        self.assertIsInstance(payload["permission_keys"], list)
        self.assertIsInstance(payload["grants"], list)

    def test_api_role_detail_normalizes_sofa_grants_and_profiles(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(21, "IT"),
                sofa_authorization={"version": 1, "grants": [make_grant("roles.view")]},
            )
        )

        async def fake_get_role_detail(*args, **kwargs):
            return {
                "role_id": 21,
                "name": "IT",
                "sofa_grants": [
                    {"permission": "tasks.view"},
                    {"permission": "tasks.backlog.view", "resources": {"task_backlogs": {"all": False, "ids": ["7"]}}},
                ],
                "sofa_profile_keys": ["operational-admin"],
            }

        with patch("app.routes.api.api_client.get_role_detail", new=fake_get_role_detail):
            response = run_async(api_get_role_detail(21, current_user=authz))

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["sofa_grants"][1]["resources"]["task_backlogs"]["ids"], [7])
        self.assertEqual(payload["sofa_profiles"][0]["key"], "operational-admin")
        self.assertTrue(isinstance(payload["available_sofa_profiles"], list))

    def test_api_sofa_permissions_returns_registry(self):
        authz = build_authorization_context_from_user(
            make_user(
                primary_role=make_role(21, "IT"),
                sofa_authorization={"version": 1, "grants": [make_grant("roles.view")]},
            )
        )

        response = run_async(api_sofa_permissions(current_user=authz))
        payload = json.loads(response.body)

        self.assertEqual(response.status_code, 200)
        self.assertIn("permissions", payload)
        self.assertIn("resource_types", payload)
        self.assertIn("profiles", payload)
        self.assertTrue(any(item["key"] == "tasks.view" for item in payload["permissions"]))


if __name__ == "__main__":
    unittest.main()
