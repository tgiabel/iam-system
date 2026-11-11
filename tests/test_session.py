"""Verifizierte Sitzung auf SOFA-Seite (Vertrag SD-API docs/sofa-session-contract.md, Abschnitt 9/12)."""
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.api_client import APIClient, api_client
from app.main import app
from app.session import DEV_SERVICE_KEY, LOGIN_CSRF_COOKIE, SESSION_COOKIE, SessionState, client_ip, current_session, safe_next
from tests.session_helpers import CSRF, TOKEN, me_payload, session_block, sign_in


def api_error(status, detail):
    request = httpx.Request("GET", "http://api/access/users/me")
    return httpx.HTTPStatusError("x", request=request, response=httpx.Response(status, json={"detail": detail}, request=request))


def set_cookies(response):
    return [value for key, value in response.headers.multi_items() if key == "set-cookie"]


class SafeNextTests(unittest.TestCase):
    def test_only_internal_paths_with_query(self):
        self.assertEqual(safe_next("/tasks?backlog=IT&x=1"), "/tasks?backlog=IT&x=1")
        self.assertEqual(safe_next("/users"), "/users")
        for raw in (None, "", "https://evil.test/", "//evil.test", "/\\evil.test", "javascript:alert(1)",
                    "/login?next=/x", "/logout", "/api/users", "/static/x.js", "/tasks\n", "/a b", "tasks"):
            with self.subTest(raw=raw):
                self.assertEqual(safe_next(raw), "/")

    def test_client_ip_is_the_entry_apache_appended(self):
        self.assertEqual(client_ip({"x-forwarded-for": "6.6.6.6, 10.0.0.5"}), "10.0.0.5")
        self.assertIsNone(client_ip({}))


class ClientHeaderTests(unittest.TestCase):
    def test_service_key_always_session_and_csrf_from_the_session(self):
        with patch.dict(os.environ, {"SD_API_SERVICE_KEY": "k" * 43}):
            self.assertEqual(APIClient._session_headers("GET", None), {"X-SOFA-Service-Key": "k" * 43})
            reset = current_session.set(SessionState(token=TOKEN, csrf_token=CSRF))
            try:
                get = APIClient._session_headers("GET", {"X-User-Id": "42"})
                post = APIClient._session_headers("POST", None)
            finally:
                current_session.reset(reset)
        self.assertEqual(get, {"X-SOFA-Service-Key": "k" * 43, "X-SOFA-Session": TOKEN, "X-User-Id": "42"})
        self.assertEqual(post["X-CSRF-Token"], CSRF)

    def test_dev_falls_back_to_the_fixture_key_production_never(self):
        from app import session
        with patch.dict(os.environ, {"SD_API_SERVICE_KEY": ""}):
            with patch.object(session, "APP_ENV", "development"):
                self.assertEqual(session.service_key(), DEV_SERVICE_KEY)
            with patch.object(session, "APP_ENV", "production"):
                self.assertEqual(session.service_key(), "")


class SessionGateTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")

    def test_forged_legacy_cookie_opens_nothing_and_is_removed(self):
        forged = json.dumps({"user_id": 1, "sofa_permissions": {"accessible_pages": [{"identifier": "SOFA-PAGE-USER"}]}})
        self.client.cookies.set("sofa_user", forged)
        with patch.object(api_client, "session_me", AsyncMock()) as me:
            page = self.client.get("/users", follow_redirects=False)
            api = self.client.get("/api/users", headers={"X-User-Id": "1"})
        me.assert_not_called()
        self.assertEqual((page.status_code, page.headers["location"]), (303, "/login?next=/users"))
        self.assertEqual(api.status_code, 401)
        self.assertTrue(any(cookie.startswith('sofa_user=""') for cookie in set_cookies(page)))

    def test_identity_comes_only_from_the_session_check(self):
        me = sign_in(self, self.client, "SOFA-PAGE-TODO", user_id=7)
        response = self.client.get("/api/session/authz", headers={"X-User-Id": "1"})
        me.assert_awaited_with(TOKEN)
        self.assertEqual(response.json()["user"]["user_id"], 7)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(set_cookies(response), [], "Poll setzt und verlaengert keine Cookies")
        self.assertNotIn("csrf_token", response.json()["session"])

    def test_expired_session_html_redirects_with_target_json_answers_401(self):
        self.client.cookies.set(SESSION_COOKIE, TOKEN)
        expired = api_error(401, {"code": "session_expired", "message": "x", "context": {"reason": "idle"}})
        with patch.object(api_client, "session_me", AsyncMock(side_effect=expired)):
            page = self.client.get("/tasks?backlog=IT", follow_redirects=False)
            api = self.client.get("/api/events")
        self.assertEqual(page.headers["location"], "/login?next=/tasks%3Fbacklog%3DIT&reason=expired")
        self.assertTrue(any(cookie.startswith(SESSION_COOKIE + '=""') for cookie in set_cookies(page)))
        self.assertEqual((api.status_code, api.json()["detail"]["code"]), (401, "session_expired"))

    def test_unavailable_api_is_not_a_logout(self):
        self.client.cookies.set(SESSION_COOKIE, TOKEN)
        for failure in (httpx.ConnectError("down"), api_error(503, {"code": "service_unavailable"}),
                        api_error(401, {"code": "service_unauthorized"})):
            with self.subTest(failure=type(failure).__name__), \
                    patch.object(api_client, "session_me", AsyncMock(side_effect=failure)):
                api = self.client.get("/api/events")
                self.assertEqual(api.status_code, 503)
                self.assertEqual(set_cookies(api), [])
                login = self.client.get("/login")
                self.assertEqual(login.status_code, 503)

    def test_writes_need_the_session_csrf_token_and_own_origin(self):
        sign_in(self, self.client, "SOFA-PAGE-TODO")
        with patch.object(api_client, "session_activity", AsyncMock(return_value={"session": session_block()})) as activity:
            missing = self.client.post("/api/session/activity", headers={"X-CSRF-Token": ""})
            wrong = self.client.post("/api/session/activity", headers={"X-CSRF-Token": "x" * 43})
            foreign = self.client.post("/api/session/activity", headers={"Origin": "https://evil.test"})
            ok = self.client.post("/api/session/activity", headers={"Origin": "https://testserver"})
        for response in (missing, wrong, foreign):
            self.assertEqual((response.status_code, response.json()["detail"]["code"]), (403, "csrf_failed"))
        self.assertEqual(ok.status_code, 200)
        self.assertNotIn("csrf_token", ok.json()["session"])
        activity.assert_awaited_once()

    def test_page_carries_csrf_meta_and_logout_form(self):
        sign_in(self, self.client, "SOFA-PAGE-TODO")
        html = self.client.get("/").text
        self.assertIn(f'<meta name="csrf-token" content="{CSRF}">', html)
        self.assertIn('action="/logout"', html)
        self.assertNotIn('href="/logout"', html)


class LoginLogoutTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")

    def form_token(self, url="/login"):
        page = self.client.get(url)
        return page.text.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]

    def test_login_sets_host_cookie_and_follows_the_validated_target(self):
        token = self.form_token("/login?next=/tasks%3Fbacklog%3DIT")
        result = {**me_payload(user_id=42), "session": {**session_block(), "token": TOKEN}}
        with patch.object(api_client, "login_user", AsyncMock(return_value=result)) as login:
            response = self.client.post(
                "/login", follow_redirects=False,
                data={"pnr": " 42 ", "password": "geheim", "csrf_token": token, "next": "/tasks?backlog=IT"},
                headers={"X-Forwarded-For": "6.6.6.6, 10.0.0.5"},
            )
        login.assert_awaited_once_with("42", "geheim", client_ip="10.0.0.5", previous_token=None)
        self.assertEqual((response.status_code, response.headers["location"]), (303, "/tasks?backlog=IT"))
        cookie = next(value for value in set_cookies(response) if value.startswith(SESSION_COOKIE + "="))
        lowered = cookie.lower()
        for attribute in ("httponly", "secure", "samesite=lax", "path=/", "max-age=43200"):
            self.assertIn(attribute, lowered)
        self.assertNotIn("domain", lowered)

    def test_external_target_falls_back_to_dashboard(self):
        token = self.form_token()
        result = {**me_payload(), "session": {**session_block(), "token": TOKEN}}
        with patch.object(api_client, "login_user", AsyncMock(return_value=result)):
            response = self.client.post("/login", follow_redirects=False,
                                        data={"pnr": "42", "password": "x", "csrf_token": token, "next": "//evil.test"})
        self.assertEqual(response.headers["location"], "/")

    def test_login_without_form_token_never_reaches_the_api(self):
        self.form_token()
        with patch.object(api_client, "login_user", AsyncMock()) as login:
            response = self.client.post("/login", data={"pnr": "42", "password": "x", "csrf_token": "falsch"})
            cross = self.client.post("/login", data={"pnr": "42", "password": "x", "csrf_token": "falsch"},
                                     headers={"Origin": "https://evil.test"})
        login.assert_not_called()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(cross.status_code, 403)

    def test_rate_limit_and_not_enabled_have_own_texts(self):
        from app import login_errors
        for status, code, text in ((429, "login_rate_limited", login_errors.RATE_LIMITED),
                                   (403, "account_not_enabled", login_errors.NOT_ALLOWED)):
            token = self.form_token()
            with self.subTest(code=code), patch.object(api_client, "login_user",
                                                       AsyncMock(side_effect=api_error(status, {"code": code}))):
                response = self.client.post("/login", data={"pnr": "42", "password": "x", "csrf_token": token})
                self.assertEqual(response.status_code, status)
                self.assertIn(text, response.text)

    def test_signed_in_user_skips_the_login_page(self):
        sign_in(self, self.client)
        response = self.client.get("/login?next=/workspace", follow_redirects=False)
        self.assertEqual((response.status_code, response.headers["location"]), (303, "/workspace"))

    def test_logout_revokes_at_the_api_and_clears_the_cookie(self):
        sign_in(self, self.client)
        with patch.object(api_client, "session_logout", AsyncMock()) as logout:
            forged = self.client.post("/logout", data={"csrf_token": "falsch"}, follow_redirects=False)
            logout.assert_not_called()
            response = self.client.post("/logout", data={"csrf_token": CSRF}, follow_redirects=False)
        state = logout.await_args.args[0]
        self.assertEqual((state.token, state.csrf_token), (TOKEN, CSRF))
        self.assertEqual(forged.headers["location"], "/")
        self.assertEqual(response.headers["location"], "/login?reason=logged_out")
        self.assertTrue(any(cookie.startswith(SESSION_COOKIE + '=""') for cookie in set_cookies(response)))
        self.assertEqual(self.client.get("/logout").status_code, 405)

    def test_logout_notice(self):
        page = self.client.get("/login?reason=logged_out").text
        self.assertIn('data-kind="success">Du bist abgemeldet.', page)
        self.assertIn(LOGIN_CSRF_COOKIE, "".join(set_cookies(self.client.get("/login"))))


if __name__ == "__main__":
    unittest.main()
