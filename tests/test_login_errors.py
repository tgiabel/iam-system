import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app import login_errors
from app.api_client import api_client
from app.login_errors import LoginFailure, classify_login_error
from app.main import app
from tests.session_helpers import login_form_token, quiet_server_log, status_error, wrapped


class ClassifyLoginErrorTests(unittest.TestCase):
    def test_sd_api_answers(self):
        cases = {
            401: LoginFailure("invalid_credentials", 401, login_errors.BAD_CREDENTIALS),
            403: LoginFailure("account_not_enabled", 403, login_errors.NOT_ALLOWED),
            422: LoginFailure("invalid_request", 400, login_errors.CHECK_INPUT),
            429: LoginFailure("login_rate_limited", 429, login_errors.RATE_LIMITED),
            500: LoginFailure("service_unavailable", 503, login_errors.SERVER_ERROR),
            503: LoginFailure("service_unavailable", 503, login_errors.SERVER_ERROR),
        }
        for status, expected in cases.items():
            with self.subTest(status=status):
                self.assertEqual(classify_login_error(status_error(status)), expected)

    def test_unexpected_status_is_never_a_credentials_hint(self):
        # 404 meldete eine SD-API vor Schritt 1 fuer unbekannte PNR; API-1 ist Voraussetzung.
        failure = classify_login_error(status_error(404))
        self.assertEqual((failure.code, failure.status, failure.message),
                         ("service_unavailable", 503, login_errors.GENERIC))

    def test_network_failures_are_wrapped_by_the_api_client(self):
        dns = wrapped(httpx.ConnectError("[Errno -3] Temporary failure in name resolution"))
        self.assertEqual(classify_login_error(dns).message, login_errors.UNAVAILABLE)
        timeout = wrapped(httpx.ReadTimeout("timed out"))
        self.assertEqual(classify_login_error(timeout).message, login_errors.TIMEOUT)

    def test_unknown_errors_get_the_generic_text(self):
        self.assertEqual(classify_login_error(ValueError("boom")),
                         LoginFailure("service_unavailable", 503, login_errors.GENERIC))


class LoginPageTests(unittest.TestCase):
    def setUp(self):
        quiet_server_log(self)

    def post(self, error):
        client = TestClient(app, base_url="https://testserver")
        token = login_form_token(client)
        with patch.object(api_client, "login_user", AsyncMock(side_effect=error)):
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
        self.assertIn('aria-invalid="true"', response.text)
        self.assertNotIn("api:8080", response.text)
        self.assertNotIn("for url", response.text)

    def test_form_and_in_tab_login_answer_alike(self):
        for status in (401, 403, 404, 422, 429, 500):
            with self.subTest(status=status):
                failure = classify_login_error(status_error(status))
                form = self.post(status_error(status))
                client = TestClient(app, base_url="https://testserver")
                with patch.object(api_client, "login_user", AsyncMock(side_effect=status_error(status))):
                    tab = client.post("/api/session/login", json={"pnr": "42", "password": "x"},
                                      headers={"Origin": "https://testserver"})
                self.assertEqual((form.status_code, tab.status_code), (failure.status, failure.status))
                self.assertIn(failure.message, form.text)
                self.assertEqual(tab.json()["detail"], {"code": failure.code, "message": failure.message})
                self.assertEqual('aria-invalid="true"' in form.text, failure.code == "invalid_credentials")

    def test_real_client_connect_error_reaches_the_page(self):
        client = TestClient(app, base_url="https://testserver")
        token = login_form_token(client)
        with patch("httpx.AsyncClient.request", side_effect=httpx.ConnectError("[Errno -3] x")):
            page = client.post("/login", data={"pnr": "42", "password": "x", "csrf_token": token}).text
        self.assertIn(login_errors.UNAVAILABLE, page)


if __name__ == "__main__":
    unittest.main()
