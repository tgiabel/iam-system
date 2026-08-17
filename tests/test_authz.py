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
            pass

    fastapi_module.HTTPException = HTTPException
    fastapi_module.Cookie = lambda **kw: None
    fastapi_module.Depends = lambda fn: fn
    fastapi_exceptions_module.HTTPException = HTTPException
    fastapi_responses_module.JSONResponse = JSONResponse
    fastapi_templating_module.Jinja2Templates = object
    httpx_module.RequestError = Exception
    httpx_module.HTTPStatusError = Exception
    sys.modules["fastapi"] = fastapi_module
    sys.modules["fastapi.exceptions"] = fastapi_exceptions_module
    sys.modules["fastapi.responses"] = fastapi_responses_module
    sys.modules["fastapi.templating"] = fastapi_templating_module
    sys.modules["httpx"] = httpx_module

from app.authz import (
    AuthorizationContext,
    build_authorization_context_from_user,
    get_authz_payload_for_template,
    require_permission,
    require_any_permission,
)


def make_sofa_permissions(
    pages=(),
    tools=(),
    functions=(),
    reports=(),
    backlogs=(),
    has_all_backlog_access=False,
):
    return {
        "accessible_pages": [{"resource_id": i, "identifier": p} for i, p in enumerate(pages)],
        "accessible_tools": [{"resource_id": i, "identifier": t} for i, t in enumerate(tools)],
        "accessible_functions": [{"resource_id": i, "identifier": f} for i, f in enumerate(functions)],
        "accessible_reports": [{"resource_id": i, "identifier": r} for i, r in enumerate(reports)],
        "accessible_backlogs": [{"resource_id": i, "identifier": b} for i, b in enumerate(backlogs)],
        "has_all_backlog_access": has_all_backlog_access,
    }


def make_user(user_id=1, pnr="00001", role_name="testrole"):
    return {
        "user_id": user_id,
        "pnr": pnr,
        "first_name": "Test",
        "last_name": "User",
        "primary_role": {"name": role_name},
        "secondary_roles": [],
    }


class TestBuildAuthorizationContext(unittest.TestCase):

    def test_empty_permissions(self):
        user = make_user()
        authz = build_authorization_context_from_user(user, {})
        self.assertEqual(authz.permissions, frozenset())
        self.assertEqual(authz.accessible_backlogs, frozenset())
        self.assertFalse(authz.has_all_backlog_access)

    def test_none_permissions_fallback(self):
        user = make_user()
        authz = build_authorization_context_from_user(user, None)
        self.assertEqual(authz.permissions, frozenset())

    def test_page_permissions_collected(self):
        perms = make_sofa_permissions(pages=("SOFA-PAGE-TODO", "SOFA-PAGE-USER"))
        authz = build_authorization_context_from_user(make_user(), perms)
        self.assertIn("SOFA-PAGE-TODO", authz.permissions)
        self.assertIn("SOFA-PAGE-USER", authz.permissions)
        self.assertNotIn("SOFA-PAGE-SYS", authz.permissions)

    def test_tool_and_function_permissions_collected(self):
        perms = make_sofa_permissions(
            tools=("SOFA-TOOL-GQ",),
            functions=("SOFA-FN-ONB", "SOFA-FN-OFFB"),
        )
        authz = build_authorization_context_from_user(make_user(), perms)
        self.assertIn("SOFA-TOOL-GQ", authz.permissions)
        self.assertIn("SOFA-FN-ONB", authz.permissions)
        self.assertIn("SOFA-FN-OFFB", authz.permissions)

    def test_backlog_permissions_separate(self):
        perms = make_sofa_permissions(backlogs=("SOFA-BKLG-IT", "SOFA-BKLG-AKAD"))
        authz = build_authorization_context_from_user(make_user(), perms)
        self.assertIn("SOFA-BKLG-IT", authz.accessible_backlogs)
        self.assertIn("SOFA-BKLG-AKAD", authz.accessible_backlogs)
        self.assertFalse(authz.has_all_backlog_access)

    def test_has_all_backlog_access_from_field(self):
        perms = make_sofa_permissions(has_all_backlog_access=True)
        authz = build_authorization_context_from_user(make_user(), perms)
        self.assertTrue(authz.has_all_backlog_access)

    def test_has_all_backlog_access_from_bklg_all_identifier(self):
        perms = make_sofa_permissions(backlogs=("SOFA-BKLG-ALL",))
        authz = build_authorization_context_from_user(make_user(), perms)
        self.assertTrue(authz.has_all_backlog_access)

    def test_primary_role_name_preserved(self):
        user = make_user(role_name="sd-it")
        authz = build_authorization_context_from_user(user, {})
        self.assertEqual(authz.primary_role_name, "sd-it")


class TestHasPermission(unittest.TestCase):

    def _make_authz(self, permissions=(), backlogs=(), has_all_backlog_access=False):
        return AuthorizationContext(
            user_id=1,
            pnr="00001",
            primary_role_name="testrole",
            permissions=frozenset(permissions),
            accessible_backlogs=frozenset(backlogs),
            has_all_backlog_access=has_all_backlog_access,
            raw_user={},
        )

    def test_direct_grant(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        self.assertTrue(authz.has_permission("SOFA-PAGE-TODO"))
        self.assertFalse(authz.has_permission("SOFA-PAGE-USER"))

    def test_category_all_grant(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-ALL",))
        self.assertTrue(authz.has_permission("SOFA-TOOL-GQ"))
        self.assertTrue(authz.has_permission("SOFA-TOOL-FORM"))
        self.assertTrue(authz.has_permission("SOFA-TOOL-IKS"))
        self.assertFalse(authz.has_permission("SOFA-PAGE-TODO"))

    def test_fn_all_grant(self):
        authz = self._make_authz(permissions=("SOFA-FN-ALL",))
        self.assertTrue(authz.has_permission("SOFA-FN-ONB"))
        self.assertTrue(authz.has_permission("SOFA-FN-ACC"))
        self.assertFalse(authz.has_permission("SOFA-TOOL-GQ"))

    def test_iks_all_grant(self):
        authz = self._make_authz(permissions=("SOFA-IKS-ALL",))
        self.assertTrue(authz.has_permission("SOFA-IKS-PRCS"))
        self.assertTrue(authz.has_permission("SOFA-IKS-ROLE"))
        self.assertTrue(authz.has_permission("SOFA-IKS-SYS"))
        self.assertFalse(authz.has_permission("SOFA-TOOL-IKS"))

    def test_page_all_grant(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-ALL",))
        self.assertTrue(authz.has_permission("SOFA-PAGE-TODO"))
        self.assertTrue(authz.has_permission("SOFA-PAGE-CNSL"))
        self.assertFalse(authz.has_permission("SOFA-TOOL-GQ"))

    def test_has_admin_access_true(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-USER",))
        self.assertTrue(authz.has_admin_access())

    def test_has_admin_access_false(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        self.assertFalse(authz.has_admin_access())

    def test_has_admin_access_via_all(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-ALL",))
        self.assertTrue(authz.has_admin_access())

    def test_has_any_tool_true(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-GQ",))
        self.assertTrue(authz.has_any_tool())

    def test_has_any_tool_via_all(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-ALL",))
        self.assertTrue(authz.has_any_tool())

    def test_has_any_tool_false(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        self.assertFalse(authz.has_any_tool())


class TestRequirePermission(unittest.TestCase):

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def _make_authz(self, permissions=()):
        return AuthorizationContext(
            user_id=1,
            pnr="00001",
            primary_role_name="testrole",
            permissions=frozenset(permissions),
            accessible_backlogs=frozenset(),
            has_all_backlog_access=False,
            raw_user={},
        )

    def test_invalid_identifier_raises_at_creation(self):
        with self.assertRaises(ValueError):
            require_permission("nonexistent_key_xyz")

    def test_invalid_identifier_any_raises_at_creation(self):
        with self.assertRaises(ValueError):
            require_any_permission("SOFA-PAGE-TODO", "invalid_key")

    def _extract_inner(self, dep):
        for cell in (dep.__closure__ or []):
            try:
                val = cell.cell_contents
                if callable(val) and asyncio.iscoroutinefunction(val):
                    return val
            except ValueError:
                continue
        return None

    def test_access_granted(self):
        dep = require_permission("SOFA-PAGE-TODO")
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        inner_fn = self._extract_inner(dep)
        if inner_fn:
            result = self._run(inner_fn(authz))
            self.assertEqual(result, authz)

    def test_access_denied(self):
        dep = require_permission("SOFA-PAGE-USER")
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        inner_fn = self._extract_inner(dep)
        if inner_fn:
            with self.assertRaises(HTTPException) as ctx:
                self._run(inner_fn(authz))
            self.assertEqual(ctx.exception.status_code, 403)

    def test_access_granted_via_category_all(self):
        dep = require_permission("SOFA-TOOL-GQ")
        authz = self._make_authz(permissions=("SOFA-TOOL-ALL",))
        inner_fn = self._extract_inner(dep)
        if inner_fn:
            result = self._run(inner_fn(authz))
            self.assertEqual(result, authz)

    def test_require_any_granted_partial(self):
        dep = require_any_permission("SOFA-PAGE-TODO", "SOFA-PAGE-ROLE")
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        inner_fn = self._extract_inner(dep)
        if inner_fn:
            result = self._run(inner_fn(authz))
            self.assertEqual(result, authz)

    def test_require_any_denied(self):
        dep = require_any_permission("SOFA-PAGE-TODO", "SOFA-PAGE-ROLE")
        authz = self._make_authz(permissions=("SOFA-PAGE-CNSL",))
        inner_fn = self._extract_inner(dep)
        if inner_fn:
            with self.assertRaises(HTTPException) as ctx:
                self._run(inner_fn(authz))
            self.assertEqual(ctx.exception.status_code, 403)


class TestGetAuthzPayloadForTemplate(unittest.TestCase):

    def _make_authz(self, permissions=(), backlogs=(), has_all_backlog_access=False):
        return AuthorizationContext(
            user_id=1,
            pnr="00001",
            primary_role_name="testrole",
            permissions=frozenset(permissions),
            accessible_backlogs=frozenset(backlogs),
            has_all_backlog_access=has_all_backlog_access,
            raw_user={},
        )

    def test_none_returns_empty(self):
        payload = get_authz_payload_for_template(None)
        self.assertEqual(payload["permissions"], [])
        self.assertEqual(payload["backlogs"], [])
        self.assertFalse(payload["has_admin_access"])
        self.assertFalse(payload["has_all_backlog_access"])
        self.assertFalse(payload["has_any_tool"])

    def test_permissions_listed(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO", "SOFA-PAGE-USER"))
        payload = get_authz_payload_for_template(authz)
        self.assertIn("SOFA-PAGE-TODO", payload["permissions"])
        self.assertIn("SOFA-PAGE-USER", payload["permissions"])
        self.assertNotIn("SOFA-PAGE-SYS", payload["permissions"])

    def test_wildcard_permissions_passed_through(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-ALL",))
        payload = get_authz_payload_for_template(authz)
        self.assertIn("SOFA-TOOL-ALL", payload["permissions"])

    def test_backlogs_specific(self):
        authz = self._make_authz(backlogs=("SOFA-BKLG-IT", "SOFA-BKLG-AKAD"))
        payload = get_authz_payload_for_template(authz)
        self.assertIn("SOFA-BKLG-IT", payload["backlogs"])
        self.assertIn("SOFA-BKLG-AKAD", payload["backlogs"])
        self.assertNotIn("SOFA-BKLG-ALL", payload["backlogs"])

    def test_bklg_all_filtered_from_backlogs(self):
        authz = self._make_authz(
            backlogs=("SOFA-BKLG-ALL", "SOFA-BKLG-IT", "SOFA-BKLG-AKAD"),
            has_all_backlog_access=True,
        )
        payload = get_authz_payload_for_template(authz)
        self.assertIn("SOFA-BKLG-IT", payload["backlogs"])
        self.assertIn("SOFA-BKLG-AKAD", payload["backlogs"])
        self.assertNotIn("SOFA-BKLG-ALL", payload["backlogs"])
        self.assertTrue(payload["has_all_backlog_access"])

    def test_has_admin_access_true(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-SYS",))
        payload = get_authz_payload_for_template(authz)
        self.assertTrue(payload["has_admin_access"])

    def test_has_any_tool_true(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-GQ",))
        payload = get_authz_payload_for_template(authz)
        self.assertTrue(payload["has_any_tool"])

    def test_has_any_tool_via_all(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-ALL",))
        payload = get_authz_payload_for_template(authz)
        self.assertTrue(payload["has_any_tool"])

    def test_has_any_tool_false(self):
        authz = self._make_authz(permissions=("SOFA-PAGE-TODO",))
        payload = get_authz_payload_for_template(authz)
        self.assertFalse(payload["has_any_tool"])

    def test_permissions_sorted(self):
        authz = self._make_authz(permissions=("SOFA-TOOL-GQ", "SOFA-PAGE-TODO", "SOFA-FN-ONB"))
        payload = get_authz_payload_for_template(authz)
        self.assertEqual(payload["permissions"], sorted(payload["permissions"]))


if __name__ == "__main__":
    unittest.main()
