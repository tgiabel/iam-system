"""Phase C: Fehlerantworten verraten keine Exception-Texte (Backend-URLs, Hostnamen, Interna)."""
import pathlib
import re
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.api_client import api_client
from app.main import app
from app.routes import shared
from tests.session_helpers import sign_in

INTERNAL_URL = "http://api:8080/access/users?is_active=true"


def wrapped(cause):
    try:
        raise Exception(f"Request Error: {cause}") from cause
    except Exception as exc:
        return exc


def status_error(status, **kwargs):
    request = httpx.Request("GET", INTERNAL_URL)
    response = httpx.Response(status, request=request, **kwargs)
    return httpx.HTTPStatusError(f"Server error '{status}' for url '{INTERNAL_URL}'", request=request, response=response)


class InternalErrorTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")
        sign_in(self, self.client, "SOFA-PAGE-USER")

    def get_users(self, error):
        with patch.object(api_client, "list_users", AsyncMock(side_effect=error)), \
                self.assertLogs("uvicorn.error", level="ERROR") as logs:
            response = self.client.get("/api/users")
        return response, "\n".join(logs.output)

    def test_unreachable_backend_says_so_without_internals(self):
        response, log = self.get_users(wrapped(httpx.ConnectError("[Errno -3] Temporary failure in name resolution")))
        body = response.json()
        self.assertEqual(response.status_code, 500)
        self.assertTrue(body["error"].startswith(shared.BACKEND_UNREACHABLE))
        self.assertIn(body["error_id"], body["error"])
        for leak in ("Errno", "Request Error", "api:8080", "name resolution"):
            self.assertNotIn(leak, response.text)
        self.assertIn(body["error_id"], log, "dieselbe ID steht mit Details im Log")
        self.assertIn("Errno", log)

    def test_unexpected_errors_get_a_neutral_text(self):
        for error in (status_error(500, text="Traceback (most recent call last): ..."), KeyError("password_hash")):
            with self.subTest(error=type(error).__name__):
                response, _ = self.get_users(error)
                self.assertEqual(response.status_code, 500)
                self.assertTrue(response.json()["error"].startswith(shared.INTERNAL_ERROR))
                for leak in ("api:8080", "Traceback", "password_hash", "Server error"):
                    self.assertNotIn(leak, response.text)

    def test_non_json_backend_errors_are_not_passed_through(self):
        response = httpx.Response(502, text="<html>Proxy Error at api:8080</html>")
        self.assertEqual(shared._error_content_from_response(response), {"detail": "Die Anfrage ist fehlgeschlagen."})


class NoExceptionTextInRoutesTests(unittest.TestCase):
    """Nur selbst geschriebene Validierungsmeldungen (ValueError -> 400) duerfen str(exc) nutzen."""

    def test_str_exc_only_in_validation_branches(self):
        for path in pathlib.Path("app/routes").glob("*.py"):
            lines = path.read_text(encoding="utf-8").splitlines()
            for number, line in enumerate(lines):
                if not re.search(r"str\((exc|e|err|error)\)|detail=f?[\"'].*\{(exc|e|err)\}", line):
                    continue
                handler = next(lines[i] for i in range(number, -1, -1) if lines[i].strip().startswith("except"))
                with self.subTest(file=str(path), line=number + 1):
                    self.assertIn("except ValueError", handler)
                    window = "\n".join(lines[number:number + 3])
                    self.assertIn("status_code=400", window)


if __name__ == "__main__":
    unittest.main()
