import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app import login_errors
from app.login_errors import login_error_message
from app.main import app


def status_error(status):
    request = httpx.Request("POST", "http://api:8080/access/users/login")
    response = httpx.Response(status, request=request, json={"detail": "x"})
    return httpx.HTTPStatusError("raw", request=request, response=response)


def wrapped(cause):
    try:
        raise Exception(f"Request Error: {cause}") from cause
    except Exception as exc:
        return exc


class LoginErrorMessageTests(unittest.TestCase):
    def test_wrong_password_and_unknown_user_look_the_same(self):
        self.assertEqual(login_error_message(status_error(401)), login_errors.BAD_CREDENTIALS)
        self.assertEqual(login_error_message(status_error(404)), login_errors.BAD_CREDENTIALS)

    def test_forbidden_and_server_errors(self):
        self.assertEqual(login_error_message(status_error(403)), login_errors.NOT_ALLOWED)
        self.assertEqual(login_error_message(status_error(500)), login_errors.SERVER_ERROR)
        self.assertEqual(login_error_message(status_error(503)), login_errors.SERVER_ERROR)

    def test_rate_limit_has_its_own_text(self):
        self.assertEqual(login_error_message(status_error(429)), login_errors.RATE_LIMITED)

    def test_preview_uses_the_real_login_texts(self):
        texts = {login_errors.BAD_CREDENTIALS, login_errors.NOT_ALLOWED, login_errors.UNAVAILABLE, login_errors.RATE_LIMITED}
        self.assertEqual(set(login_errors.PREVIEW_MESSAGES.values()), texts)

    def test_network_failures_are_wrapped_by_the_api_client(self):
        dns = wrapped(httpx.ConnectError("[Errno -3] Temporary failure in name resolution"))
        self.assertEqual(login_error_message(dns), login_errors.UNAVAILABLE)
        timeout = wrapped(httpx.ReadTimeout("timed out"))
        self.assertEqual(login_error_message(timeout), login_errors.TIMEOUT)

    def test_unknown_errors_get_the_generic_text(self):
        self.assertEqual(login_error_message(ValueError("boom")), login_errors.GENERIC)


def login_client():
    """Client wie im Browser: Loginseite abrufen (setzt das Login-CSRF-Cookie), Token aus dem Formular."""
    client = TestClient(app, base_url="https://testserver")
    page = client.get("/login").text
    token = page.split('name="csrf_token" value="', 1)[1].split('"', 1)[0]
    return client, token


class LoginPageTests(unittest.TestCase):
    def post(self, error):
        async def login(*args, **kwargs):
            raise error
        client, token = login_client()
        with patch("app.routes.pages.api_client.login_user", login):
            return client.post("/login", data={"pnr": "42", "password": "x", "csrf_token": token})

    def test_dns_failure_shows_plain_text_without_internals(self):
        error = wrapped(httpx.ConnectError("[Errno -3] Temporary failure in name resolution"))
        page = self.post(error).text
        self.assertIn(login_errors.UNAVAILABLE, page)
        self.assertNotIn("Errno", page)
        self.assertNotIn("Request Error", page)

    def test_rejected_login_does_not_leak_backend_url(self):
        response = self.post(status_error(401))
        self.assertEqual(response.status_code, 401)
        self.assertIn(login_errors.BAD_CREDENTIALS, response.text)
        self.assertIn('value="42"', response.text, "Personalnummer bleibt stehen")
        self.assertNotIn("api:8080", response.text)
        self.assertNotIn("Client error", response.text)

    def test_real_client_connect_error_reaches_the_page(self):
        client, token = login_client()
        with patch("httpx.AsyncClient.request", side_effect=httpx.ConnectError("[Errno -3] x")):
            page = client.post("/login", data={"pnr": "42", "password": "x", "csrf_token": token}).text
        self.assertIn(login_errors.UNAVAILABLE, page)


if __name__ == "__main__":
    unittest.main()
