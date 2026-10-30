import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_computers import AsyncMock, json_body, make_http_error, run_async

from app.api_client import api_client
from app.routes.api import (
    api_add_resources_to_role,
    api_set_role_resource_requirement,
    api_start_onboarding_process,
    router,
)


ROOT = Path(__file__).resolve().parents[1]

MANUAL_FORM = {
    "pnr": " 123456 ",
    "first_name": "Ina",
    "last_name": "Neu",
    "birth_date": "1990-04-12",
    "primary_role_id": "17",
    "telephone": "+49 30 123",
    "entry_date": "2026-10-01",
    "weekly_hours": "40",
}

FORWARDED_FORM = {
    "mode": "manual",
    "confirmed": True,
    "initiator_user_id": 42,
    "pnr": "123456",
    "first_name": "Ina",
    "last_name": "Neu",
    "birth_date": "1990-04-12",
    "primary_role_id": 17,
    "telephone": "+49 30 123",
    "entry_date": "2026-10-01",
    "weekly_hours": 40,
}


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def registered_paths():
    return {getattr(route, "path", "") for route in router.routes}


class RemovedEndpointTests(unittest.TestCase):
    def test_process_overview_and_onboarding_lookup_are_gone(self):
        paths = registered_paths()
        self.assertNotIn("/api/processes/overview", paths)
        self.assertNotIn("/api/processes/onboarding/lookup", paths)
        self.assertIn("/api/processes/onboarding", paths)

    def test_client_has_no_methods_for_removed_backend_routes(self):
        for name in (
            "get_process_overview",
            "lookup_onboarding_candidate",
            "get_sofa_authorization_catalog",
            "get_role_sofa_grants",
            "replace_role_sofa_grants",
            "get_user_by_pnr",
            "get_user_by_id",
        ):
            with self.subTest(method=name):
                self.assertFalse(hasattr(api_client, name))

    def test_console_no_longer_renders_the_process_overview(self):
        template = read("app/templates/console.html")
        script = read("app/static/js/console.js")
        styles = read("app/static/css/console.css")

        self.assertNotIn("console-process", template)
        self.assertNotIn("/api/processes/overview", script)
        self.assertNotIn("provisioning_phase", script)
        self.assertNotIn("console-sofa", script)
        self.assertNotIn("console-process", styles)
        self.assertNotIn("console-sofa", styles)
        # Kalender und Rollen-Re-Evaluierung bleiben erhalten.
        self.assertIn("loadEvents", script)
        self.assertIn("runRoleReevaluation", script)

    def test_role_detail_page_carries_no_sofa_grant_code(self):
        self.assertNotIn("Grant", read("app/static/js/rollendetails.js"))
        self.assertNotIn(".sofa-", read("app/static/css/rollendetails.css"))


class OnboardingWithoutLookupTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)

    @patch("app.routes.api.api_client.trigger_onboarding", new_callable=AsyncMock)
    def test_missing_mode_is_treated_as_manual(self, trigger_mock):
        trigger_mock.return_value = {"process_id": 8123, "status": "started"}

        response = run_async(api_start_onboarding_process(
            {**MANUAL_FORM, "confirmed": True},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response), {"process_id": 8123, "status": "started"})
        trigger_mock.assert_awaited_once_with(FORWARDED_FORM)

    @patch("app.routes.api.api_client.trigger_onboarding", new_callable=AsyncMock)
    def test_lookup_token_and_foreign_initiator_are_never_forwarded(self, trigger_mock):
        trigger_mock.return_value = {"process_id": 1}

        run_async(api_start_onboarding_process(
            {
                **MANUAL_FORM,
                "mode": "manual",
                "confirmed": True,
                "lookup_token": "abc",
                "initiator_user_id": 999,
            },
            current_user=self.current_user,
        ))

        trigger_mock.assert_awaited_once_with(FORWARDED_FORM)

    @patch("app.routes.api.api_client.trigger_onboarding", new_callable=AsyncMock)
    def test_helix_mode_is_rejected_before_upstream(self, trigger_mock):
        response = run_async(api_start_onboarding_process(
            {"mode": "helix", "lookup_token": "abc", "confirmed": True},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(trigger_mock.await_count, 0)

    @patch("app.routes.api.api_client.trigger_onboarding", new_callable=AsyncMock)
    def test_missing_confirmation_or_fields_are_rejected_before_upstream(self, trigger_mock):
        for payload in (
            dict(MANUAL_FORM),
            {**MANUAL_FORM, "confirmed": True, "telephone": "  "},
            {**MANUAL_FORM, "confirmed": True, "birth_date": ""},
            {**MANUAL_FORM, "confirmed": True, "primary_role_id": "abc"},
        ):
            with self.subTest(payload=payload):
                response = run_async(api_start_onboarding_process(payload, current_user=self.current_user))
                self.assertEqual(response.status_code, 400)
        self.assertEqual(trigger_mock.await_count, 0)

    @patch("app.routes.api.api_client.trigger_onboarding", new_callable=AsyncMock)
    def test_structured_conflict_is_passed_through_unchanged(self, trigger_mock):
        detail = {
            "code": "rehire_required",
            "message": "Die Personalnummer gehört einer ausgetretenen Person.",
            "context": {"user_id": 11},
        }
        trigger_mock.side_effect = make_http_error(409, {"detail": detail})

        response = run_async(api_start_onboarding_process(
            {**MANUAL_FORM, "confirmed": True},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json_body(response), {"detail": detail})

    def test_frontend_sends_only_form_data(self):
        script = read("app/static/js/userverwaltung.js")
        template = read("app/templates/userverwaltung.html")

        for removed in ("onboarding/lookup", "lookup_token", "helix", "Helix"):
            with self.subTest(removed=removed):
                self.assertNotIn(removed, script)
                self.assertNotIn(removed, template)
        self.assertIn("sofaContract.extractDetailMessage(data.detail)", script)


class RoleResourceRequirementTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=7)

    @patch("app.routes.api.api_client.add_resources_to_role", new_callable=AsyncMock)
    def test_add_forwards_the_selected_requirement(self, add_mock):
        add_mock.return_value = {"status": "ok"}

        response = run_async(api_add_resources_to_role(
            17,
            {"resource_ids": [27, 115], "provisioning_requirement": "DEFERRED", "initiator_user_id": 999},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        add_mock.assert_awaited_once_with({
            "role_id": 17,
            "resource_ids": [27, 115],
            "initiator_user_id": 7,
            "provisioning_requirement": "DEFERRED",
        })

    @patch("app.routes.api.api_client.add_resources_to_role", new_callable=AsyncMock)
    def test_add_without_requirement_leaves_the_backend_default(self, add_mock):
        add_mock.return_value = {}

        run_async(api_add_resources_to_role(17, {"resource_ids": [27]}, current_user=self.current_user))

        add_mock.assert_awaited_once_with({"role_id": 17, "resource_ids": [27], "initiator_user_id": 7})

    @patch("app.routes.api.api_client.add_resources_to_role", new_callable=AsyncMock)
    def test_add_rejects_unknown_requirement_before_upstream(self, add_mock):
        for value in ("OPTIONAL", "deferred", ""):
            with self.subTest(value=value):
                response = run_async(api_add_resources_to_role(
                    17,
                    {"resource_ids": [27], "provisioning_requirement": value},
                    current_user=self.current_user,
                ))
                self.assertEqual(response.status_code, 400)
        self.assertEqual(add_mock.await_count, 0)

    @patch("app.routes.api.api_client.add_resources_to_role", new_callable=AsyncMock)
    def test_add_passes_package_conflicts_through(self, add_mock):
        add_mock.side_effect = make_http_error(409, {"detail": "Paketkonflikt: Ressource 27 schliesst 115 aus."})

        response = run_async(api_add_resources_to_role(17, {"resource_ids": [27]}, current_user=self.current_user))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json_body(response), {"detail": "Paketkonflikt: Ressource 27 schliesst 115 aus."})

    def test_role_detail_page_sends_requirement_per_call(self):
        template = read("app/templates/rollendetails.html")
        script = read("app/static/js/rollendetails.js")

        self.assertLess(
            template.index("/static/js/detail_shared.js"),
            template.index("/static/js/rollendetails.js"),
        )
        # Eine Bereitstellung je Aufruf; Fehlermeldungen der API kommen über DetailShared.send.
        self.assertIn("provisioning_requirement: requirement", script)
        self.assertIn('D.send(`/api/roles/${state.role.role_id}/resources`, "POST"', script)

    def test_role_detail_page_reads_only_role_page_routes(self):
        script = read("app/static/js/rollendetails.js")

        for route in ('"/api/users"', '"/api/systems/map"', '"/api/resources"'):
            with self.subTest(route=route):
                self.assertNotIn(route, script)
        self.assertIn('"/api/resources/map"', script)
        self.assertNotIn("mock", script.lower())


class RoleResourceReclassificationTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=7)

    @patch("app.routes.api.api_client.set_role_resource_requirement", new_callable=AsyncMock)
    def test_reclassification_forwards_reason_and_server_side_initiator(self, set_mock):
        mapping = [{"map_id": 1, "role_id": 17, "resource_id": 27, "provisioning_requirement": "DEFERRED", "added_at": "2026-09-01T10:00:00"}]
        set_mock.return_value = mapping

        response = run_async(api_set_role_resource_requirement(
            17,
            {
                "resource_ids": ["27"],
                "requirement": "DEFERRED",
                "reason": "  Kundensystem, Bereitstellung dauert Wochen  ",
                "initiator_user_id": 999,
            },
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response), mapping)
        set_mock.assert_awaited_once_with(17, {
            "resource_ids": [27],
            "requirement": "DEFERRED",
            "initiator_user_id": 7,
            "reason": "Kundensystem, Bereitstellung dauert Wochen",
        })

    @patch("app.routes.api.api_client.set_role_resource_requirement", new_callable=AsyncMock)
    def test_reclassification_validates_before_upstream(self, set_mock):
        valid = {"resource_ids": [27], "requirement": "REQUIRED", "reason": "Begründung"}
        for override in (
            {"resource_ids": []},
            {"resource_ids": "27"},
            {"resource_ids": [27, "x"]},
            {"requirement": "OPTIONAL"},
            {"requirement": None},
            {"reason": "   "},
            {"reason": None},
        ):
            with self.subTest(override=override):
                response = run_async(api_set_role_resource_requirement(
                    17, {**valid, **override}, current_user=self.current_user,
                ))
                self.assertEqual(response.status_code, 400)
        self.assertEqual(set_mock.await_count, 0)

    @patch("app.routes.api.api_client.set_role_resource_requirement", new_callable=AsyncMock)
    def test_inherited_resource_conflict_is_passed_through(self, set_mock):
        detail = "Die Ressourcen [115] sind Rolle [17] nicht direkt zugeordnet."
        set_mock.side_effect = make_http_error(409, {"detail": detail})

        response = run_async(api_set_role_resource_requirement(
            17,
            {"resource_ids": [115], "requirement": "DEFERRED", "reason": "Kundensystem"},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json_body(response), {"detail": detail})

    @patch("app.api_client.APIClient._post", new_callable=AsyncMock)
    def test_client_uses_the_requirement_route(self, post_mock):
        from app.api_client import ACCESS_BASE_URL

        payload = {"resource_ids": [27], "requirement": "DEFERRED", "initiator_user_id": 7, "reason": "x"}
        run_async(api_client.set_role_resource_requirement(17, payload))

        post_mock.assert_awaited_once_with(ACCESS_BASE_URL, "/roles/17/resources/requirement", payload=payload)

    def test_role_detail_page_exposes_reclassification_controls(self):
        template = read("app/templates/rollendetails.html")
        script = read("app/static/js/rollendetails.js")

        self.assertIn('id="bulk-req-btn"', template)
        self.assertIn(">Bereitstellung</th>", template)
        self.assertIn('id="req-reason"', template)
        self.assertIn("/resources/requirement", script)


class BrowserErrorMessageTests(unittest.TestCase):
    def test_detail_message_handles_string_and_structured_detail(self):
        script = r"""
const assert = require('assert');
const c = require('./app/static/js/sofa_contract.js');

assert.strictEqual(c.extractDetailMessage('  Pflichtfeld fehlt  '), 'Pflichtfeld fehlt');
assert.strictEqual(
  c.extractDetailMessage({code: 'user_active', message: 'Die Person ist aktiv.', context: {}}),
  'Die Person ist aktiv.'
);
assert.strictEqual(c.extractDetailMessage({code: 'rehire_required', context: {user_id: 11}}), '');
assert.strictEqual(c.extractDetailMessage(undefined), '');
assert.strictEqual(c.extractDetailMessage([{msg: 'x'}]), '');
"""
        try:
            completed = subprocess.run(
                [os.environ.get("SOFA_NODE_BINARY", "node"), "-e", script],
                cwd=str(ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
            )
        except FileNotFoundError as exc:
            self.fail("Node.js ist Pflicht für die JavaScript-Logiktests: {}".format(exc))
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
