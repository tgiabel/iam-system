import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_computers import AsyncMock, json_body, make_http_error, run_async

from app.api_client import SOFA_BASE_URL, api_client
from app.routes.api import api_complete_task, api_preview_rehire, api_start_rehire, router


ROOT = Path(__file__).resolve().parents[1]

FORM_INPUT = {
    "pnr": " 123456 ",
    "first_name": "Ina",
    "last_name": "Neu",
    "primary_role_id": "17",
    "telephone": "+49 30 123",
    "entry_date": "2026-10-01",
    "weekly_hours": "40",
}

FORM_FORWARDED = {
    "pnr": "123456",
    "first_name": "Ina",
    "last_name": "Neu",
    "primary_role_id": 17,
    "telephone": "+49 30 123",
    "entry_date": "2026-10-01",
    "weekly_hours": 40,
}


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


def required_permissions(path):
    """SOFA-Identifier, die require_permission fuer eine Route prueft."""
    identifiers = set()
    for route in router.routes:
        if getattr(route, "path", "") != path:
            continue
        for dependency in route.dependant.dependencies:
            for cell in getattr(dependency.call, "__closure__", None) or ():
                if isinstance(cell.cell_contents, str) and cell.cell_contents.startswith("SOFA-"):
                    identifiers.add(cell.cell_contents)
    return identifiers


def run_node(script):
    try:
        return subprocess.run(
            [os.environ.get("SOFA_NODE_BINARY", "node"), "-e", script],
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
        )
    except FileNotFoundError as exc:
        raise AssertionError("Node.js ist Pflicht für die JavaScript-Logiktests: {}".format(exc))


class RehireApiTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)

    def test_rehire_routes_are_protected_by_the_onboarding_permission(self):
        self.assertEqual(required_permissions("/api/processes/rehire/preview"), {"SOFA-FN-ONB"})
        self.assertEqual(required_permissions("/api/processes/rehire"), {"SOFA-FN-ONB"})

    @patch("app.routes.api.api_client.preview_rehire", new_callable=AsyncMock)
    def test_preview_forwards_only_form_data_and_the_server_side_user(self, preview_mock):
        preview_mock.return_value = {"status": "rehire_candidate", "state_fingerprint": "abc"}

        response = run_async(api_preview_rehire(
            {**FORM_INPUT, "initiator_user_id": 999, "account_decisions": [{"resource_id": 1}]},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["state_fingerprint"], "abc")
        preview_mock.assert_awaited_once_with(FORM_FORWARDED, 42)

    @patch("app.routes.api.api_client.start_rehire", new_callable=AsyncMock)
    def test_start_sends_form_fingerprint_confirmation_and_reference(self, start_mock):
        start_mock.return_value = {"process_id": 8123, "status": "started"}

        response = run_async(api_start_rehire(
            {
                **FORM_INPUT,
                "state_fingerprint": "abc",
                "confirmed": True,
                "business_reference": " INC-4711 ",
                "initiator_user_id": 999,
            },
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response), {"process_id": 8123, "status": "started"})
        start_mock.assert_awaited_once_with({
            **FORM_FORWARDED,
            "state_fingerprint": "abc",
            "confirmed": True,
            "business_reference": "INC-4711",
        }, 42)

    @patch("app.routes.api.api_client.start_rehire", new_callable=AsyncMock)
    def test_start_only_confirms_with_a_real_boolean(self, start_mock):
        start_mock.return_value = {"process_id": 1}

        run_async(api_start_rehire({**FORM_INPUT, "confirmed": "true"}, current_user=self.current_user))

        forwarded = start_mock.await_args[0][0] if start_mock.await_args else None
        self.assertIs(forwarded["confirmed"], False)

    @patch("app.routes.api.api_client.start_rehire", new_callable=AsyncMock)
    def test_structured_rejections_are_passed_through(self, start_mock):
        detail = {
            "code": "open_process",
            "message": "Für die Person läuft noch ein Prozess.",
            "context": {"processes": [{"process_id": 7}]},
        }
        start_mock.side_effect = make_http_error(409, {"detail": detail})

        response = run_async(api_start_rehire(dict(FORM_INPUT), current_user=self.current_user))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json_body(response), {"detail": detail})

    @patch("app.api_client.APIClient._post", new_callable=AsyncMock)
    def test_client_sends_the_user_only_as_header(self, post_mock):
        run_async(api_client.preview_rehire(FORM_FORWARDED, 42))
        run_async(api_client.start_rehire({**FORM_FORWARDED, "confirmed": True}, 42))

        calls = post_mock.await_args_list
        self.assertEqual(len(calls), 2)
        for call, path in zip(calls, ("/processes/rehire/preview", "/processes/rehire")):
            args, kwargs = call
            self.assertEqual(args, (SOFA_BASE_URL, path))
            self.assertEqual(kwargs["headers"], {"X-User-Id": "42"})
            self.assertNotIn("initiator_user_id", kwargs["payload"])


class ArchivedAccountCompletionTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)

    @patch("app.routes.api.api_client.complete_task", new_callable=AsyncMock)
    @patch("app.routes.api._get_relevant_task_or_raise", new_callable=AsyncMock)
    def test_restore_forwards_the_history_id(self, _scope_mock, complete_mock):
        complete_mock.return_value = {"status": "COMPLETED"}

        response = run_async(api_complete_task(
            55,
            {"reactivate_user_account_history_id": "9", "comment": "Konto entsperrt"},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        complete_mock.assert_awaited_once_with(
            55, 42, None, "Konto entsperrt", reactivate_user_account_history_id=9,
        )

    @patch("app.routes.api.api_client.complete_task", new_callable=AsyncMock)
    @patch("app.routes.api._get_relevant_task_or_raise", new_callable=AsyncMock)
    def test_regular_completion_sends_no_history_id(self, _scope_mock, complete_mock):
        complete_mock.return_value = {}

        run_async(api_complete_task(55, {"account_identifier": "ina.neu"}, current_user=self.current_user))

        complete_mock.assert_awaited_once_with(
            55, 42, "ina.neu", None, reactivate_user_account_history_id=None,
        )

    @patch("app.routes.api.api_client.complete_task", new_callable=AsyncMock)
    @patch("app.routes.api._get_relevant_task_or_raise", new_callable=AsyncMock)
    def test_invalid_history_id_is_rejected_before_upstream(self, _scope_mock, complete_mock):
        response = run_async(api_complete_task(
            55, {"reactivate_user_account_history_id": "abc"}, current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(complete_mock.await_count, 0)

    @patch("app.routes.api.api_client.complete_task", new_callable=AsyncMock)
    @patch("app.routes.api._get_relevant_task_or_raise", new_callable=AsyncMock)
    def test_identifier_conflict_is_passed_through(self, _scope_mock, complete_mock):
        detail = {"code": "account_identifier_in_use", "message": "Die Kennung gehört einer anderen Person."}
        complete_mock.side_effect = make_http_error(409, {"detail": detail})

        response = run_async(api_complete_task(
            55, {"reactivate_user_account_history_id": 9}, current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json_body(response), {"detail": detail})

    @patch("app.api_client.APIClient._post", new_callable=AsyncMock)
    def test_client_adds_history_id_only_when_restoring(self, post_mock):
        run_async(api_client.complete_task(55, 42, None, None, reactivate_user_account_history_id=9))
        self.assertEqual(post_mock.await_args[1]["payload"], {"reactivate_user_account_history_id": 9})

        run_async(api_client.complete_task(55, 42, "ina.neu", None))
        self.assertEqual(post_mock.await_args[1]["payload"], {"account_identifier": "ina.neu"})


class RehireBrowserContractTests(unittest.TestCase):
    def test_rehire_and_archived_account_rules(self):
        completed = run_node(r"""
const assert = require('assert');
const c = require('./app/static/js/sofa_contract.js');

const draft = {pnr: ' 123456 ', first_name: 'Ina', last_name: 'Neu', primary_role_id: '17',
               telephone: '+49 30 123', entry_date: '2026-10-01', weekly_hours: '40'};
assert.deepStrictEqual(c.buildRehireForm(draft), {ok: true, payload: {
  pnr: '123456', first_name: 'Ina', last_name: 'Neu', primary_role_id: 17,
  telephone: '+49 30 123', entry_date: '2026-10-01', weekly_hours: 40
}});
assert.strictEqual(c.buildRehireForm({...draft, last_name: '  '}).ok, false);
assert.strictEqual(c.buildRehireForm({...draft, primary_role_id: ''}).ok, false);
assert.strictEqual(c.buildRehireForm({...draft, entry_date: '2026-02-30'}).ok, false);
assert.strictEqual(c.buildRehireForm({...draft, weekly_hours: '0'}).ok, false);

const form = c.buildRehireForm(draft).payload;
assert.deepStrictEqual(c.buildRehireStartPayload(form, 'fp', ' INC-4711 ', true), {ok: true, payload: {
  ...form, state_fingerprint: 'fp', confirmed: true, business_reference: 'INC-4711'
}});
assert.strictEqual(c.buildRehireStartPayload(form, 'fp', '   ', true).ok, false);
assert.strictEqual(c.buildRehireStartPayload(form, 'fp', 'x'.repeat(100), true).ok, true);
assert.strictEqual(c.buildRehireStartPayload(form, 'fp', 'x'.repeat(101), true).ok, false);
assert.strictEqual(c.buildRehireStartPayload(form, 'fp', 'INC-1', false).ok, false);
assert.strictEqual(c.buildRehireStartPayload(form, '', 'INC-1', true).ok, false);
assert.strictEqual('account_decisions' in c.buildRehireStartPayload(form, 'fp', 'INC-1', true).payload, false);

const kinds = {
  invalid_request: 'form', entry_before_exit: 'form', primary_role_invalid: 'form', empty_role_package: 'form',
  preview_stale: 'stale', state_fingerprint_missing: 'stale',
  user_not_found: 'blocked', user_active: 'blocked', open_process: 'blocked', no_completed_offboarding: 'blocked',
  exit_date_missing: 'blocked', remaining_role_assignments: 'blocked', remaining_resource_assignments: 'blocked',
  remaining_user_accounts: 'blocked',
  business_reference_missing: 'review', business_reference_too_long: 'review', confirmation_missing: 'review'
};
for (const [code, kind] of Object.entries(kinds)) {
  assert.strictEqual(c.classifyRehireError({code, message: 'M'}, 'F').kind, kind, code);
}
const blocked = c.classifyRehireError({code: 'open_process', message: 'Läuft', context: {processes: [{process_id: 7}]}}, 'F');
assert.strictEqual(blocked.message, 'Läuft');
assert.deepStrictEqual(blocked.context, {processes: [{process_id: 7}]});
assert.deepStrictEqual(c.classifyRehireError('Interner Fehler', 'F'),
  {code: '', kind: 'review', message: 'Interner Fehler', context: {}});
assert.strictEqual(c.classifyRehireError(null, 'Fallback').message, 'Fallback');

const task = {task_type: 'ASSIGNMENT', resource_type_id: 1, archived_accounts: [
  {user_account_history_id: 3, account_identifier: 'ina.alt', archived_at: '2026-07-31T18:00:00', identifier_in_use_by_other: false},
  {user_account_history_id: 2, account_identifier: 'ina.frueh', archived_at: '2019-12-31', identifier_in_use_by_other: true},
  {account_identifier: 'ohne-id'}
]};
assert.deepStrictEqual(c.getArchivedAccounts(task), [
  {userAccountHistoryId: 3, accountIdentifier: 'ina.alt', archivedAt: '2026-07-31T18:00:00', restorable: true},
  {userAccountHistoryId: 2, accountIdentifier: 'ina.frueh', archivedAt: '2019-12-31', restorable: false}
]);
assert.deepStrictEqual(c.getArchivedAccounts({...task, task_type: 'REVOCATION'}), []);
assert.deepStrictEqual(c.getArchivedAccounts({...task, resource_type_id: 2}), []);
assert.deepStrictEqual(c.getArchivedAccounts({task_type: 'ASSIGNMENT', resource_type_id: 1}), []);
""")
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_pages_expose_rehire_entry_and_restore_notice(self):
        user_template = read("app/templates/userverwaltung.html")
        user_script = read("app/static/js/userverwaltung.js")
        task_script = read("app/static/js/tasks.js")

        onboarding_block = user_template[user_template.index('{% if "SOFA-FN-ONB" in authz.permissions %}\n                <button type="button" class="btn btn-sm btn-primary" id="rehire-action-btn"'):]
        self.assertIn('id="rehire-action-btn"', onboarding_block[:400])
        self.assertIn(" hidden>Wiedereintritt</button>", onboarding_block[:400])
        self.assertIn('id="rehire-overlay"', user_template)
        self.assertIn("DOM.rehireActionBtn.hidden = !isInactiveUser(user);", user_script)
        self.assertIn('result.detail?.code === "rehire_required"', user_script)
        self.assertNotIn("account_decisions", user_script)
        self.assertNotIn("X-User-Id", user_script)

        render_actions = task_script[task_script.index("function renderTaskActions(task) {"):]
        self.assertLess(
            render_actions.index("createArchivedAccountNotice(task)"),
            render_actions.index('id: "task-comment"'),
        )
        self.assertIn("reactivate_user_account_history_id: account.userAccountHistoryId", task_script)
        self.assertNotIn("account_identifier_deviation", task_script)


if __name__ == "__main__":
    unittest.main()
