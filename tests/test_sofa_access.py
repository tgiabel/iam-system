import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_computers import AsyncMock, run_async

from app.api_client import SOFA_BASE_URL, api_client
from app.routes.api import (
    api_reset_user_sofa_password,
    api_revoke_user_sofa_access,
    api_setup_user_sofa_access,
)


ROOT = Path(__file__).resolve().parents[1]


class SofaAccessActorTests(unittest.TestCase):
    """SD-API prueft SOFA-FN-ACC selbst und kennt den Bearbeiter nur aus X-User-Id."""

    @patch("app.api_client.APIClient._post", new_callable=AsyncMock)
    def test_client_sends_the_actor_as_header(self, post_mock):
        post_mock.return_value = {}
        run_async(api_client.setup_user_sofa_access(7, {"password": "x" * 8}, 42))
        run_async(api_client.reset_user_sofa_password(7, {"password": "x" * 8}, 42))
        run_async(api_client.revoke_user_sofa_access(7, {}, 42))

        paths = ("setup", "reset-password", "revoke")
        calls = post_mock.await_args_list
        self.assertEqual(len(calls), 3)
        for call, action in zip(calls, paths):
            args, kwargs = call
            self.assertEqual(args, (SOFA_BASE_URL, f"/users/7/sofa-access/{action}"))
            self.assertEqual(kwargs["headers"], {"X-User-Id": "42"})

    def test_routes_take_the_actor_from_the_session_not_the_browser(self):
        current_user = SimpleNamespace(user_id=42)
        forged = {"password": "x" * 8, "initiator_user_id": 1}
        targets = {
            "setup_user_sofa_access": lambda: api_setup_user_sofa_access(7, forged, current_user),
            "reset_user_sofa_password": lambda: api_reset_user_sofa_password(7, forged, current_user),
            "revoke_user_sofa_access": lambda: api_revoke_user_sofa_access(7, current_user),
        }
        for name, call in targets.items():
            with self.subTest(name), patch.object(api_client, name, new_callable=AsyncMock) as mock:
                mock.return_value = {"status": "ok"}
                run_async(call())
                args = mock.await_args.args
                self.assertEqual(args[0], 7)
                self.assertEqual(args[1]["initiator_user_id"], 42)
                self.assertEqual(args[2], 42)

    def test_error_display_reads_structured_detail(self):
        script = (ROOT / "app/static/js/userverwaltung.js").read_text(encoding="utf-8")
        for fallback in (
            "SOFA Zugriff konnte nicht eingerichtet werden",
            "SOFA Passwort konnte nicht zurückgesetzt werden",
            "SOFA Zugriff konnte nicht entzogen werden",
        ):
            self.assertIn(
                f'sofaContract.extractDetailMessage(data.detail) || data.error || "{fallback}"',
                script,
            )


if __name__ == "__main__":
    unittest.main()
