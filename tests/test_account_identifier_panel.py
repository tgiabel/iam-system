import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_computers import AsyncMock, json_body, make_http_error, run_async
from tests.test_rehire import read, required_permissions, run_node

from app.api_client import ACCESS_BASE_URL, api_client
from app.routes.api import api_set_user_account_identifier, api_user_account_logs


class AccountIdentifierApiTests(unittest.TestCase):
    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)

    def test_permissions(self):
        self.assertEqual(
            required_permissions("/api/users/{user_id}/resources/{resource_id}/account-identifier"),
            {"SOFA-FN-EDITACC"},
        )
        self.assertEqual(required_permissions("/api/users/{user_id}/account-logs"), {"SOFA-PAGE-USER"})

    def forward(self, payload, set_mock):
        set_mock.return_value = {"action": "CORRECTED", "account_identifier": "ina.neu"}
        response = run_async(api_set_user_account_identifier(11, 27, payload, current_user=self.current_user))
        self.assertEqual(response.status_code, 200)
        args, _kwargs = set_mock.await_args
        self.assertEqual(args[:2], (11, 27))
        self.assertEqual(args[3], 42)
        return args[2]

    @patch("app.routes.api.api_client.set_user_account_identifier", new_callable=AsyncMock)
    def test_expected_identifier_is_only_sent_when_the_key_is_present(self, set_mock):
        base = {"account_identifier": "ina.neu", "comment": "Tippfehler", "initiator_user_id": 999}

        self.assertEqual(self.forward(dict(base), set_mock), {"account_identifier": "ina.neu", "comment": "Tippfehler"})
        self.assertEqual(
            self.forward({**base, "expected_account_identifier": None}, set_mock)["expected_account_identifier"],
            None,
        )
        self.assertEqual(
            self.forward({**base, "expected_account_identifier": "ina.alt"}, set_mock)["expected_account_identifier"],
            "ina.alt",
        )

    @patch("app.routes.api.api_client.set_user_account_identifier", new_callable=AsyncMock)
    def test_adopt_flag_is_only_sent_as_real_true(self, set_mock):
        base = {"account_identifier": "ina.neu", "comment": "Übernahme"}

        self.assertEqual(self.forward({**base, "adopt_unlinked_account": True}, set_mock)["adopt_unlinked_account"], True)
        self.assertNotIn("adopt_unlinked_account", self.forward({**base, "adopt_unlinked_account": "true"}, set_mock))

    @patch("app.routes.api.api_client.set_user_account_identifier", new_callable=AsyncMock)
    def test_structured_conflicts_are_passed_through(self, set_mock):
        detail = {
            "code": "unlinked_system_account",
            "message": "Im System liegt ein Konto ohne Ressourcenbindung.",
            "context": {"candidate": {"user_account_id": 5, "account_identifier": "i.neu"}},
        }
        set_mock.side_effect = make_http_error(409, {"detail": detail})

        response = run_async(api_set_user_account_identifier(
            11, 27, {"account_identifier": "ina.neu", "comment": "abc"}, current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json_body(response), {"detail": detail})

    @patch("app.routes.api.api_client.get_user_account_logs", new_callable=AsyncMock)
    def test_account_logs_are_paged_through(self, logs_mock):
        logs_mock.return_value = {"items": [{"log_id": 1, "action": "CORRECTED"}], "total": 1}

        response = run_async(api_user_account_logs(11, limit=20, offset=40, current_user=self.current_user))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["total"], 1)
        logs_mock.assert_awaited_once_with(11, limit=20, offset=40)

    @patch("app.api_client.APIClient._post", new_callable=AsyncMock)
    def test_client_sends_the_editor_as_header(self, post_mock):
        payload = {"account_identifier": "ina.neu", "comment": "abc", "expected_account_identifier": None}
        run_async(api_client.set_user_account_identifier(11, 27, payload, 42))

        post_mock.assert_awaited_once_with(
            ACCESS_BASE_URL,
            "/users/11/resources/27/account-identifier",
            payload=payload,
            headers={"X-User-Id": "42"},
        )

    @patch("app.api_client.APIClient._get", new_callable=AsyncMock)
    def test_client_reads_account_logs(self, get_mock):
        run_async(api_client.get_user_account_logs(11, limit=20, offset=0))

        get_mock.assert_awaited_once_with(
            ACCESS_BASE_URL, "/users/11/account-logs", params={"limit": 20, "offset": 0},
        )


class AccountPanelBrowserTests(unittest.TestCase):
    def test_account_rows_and_payload_rules(self):
        completed = run_node(r"""
const assert = require('assert');
const c = require('./app/static/js/sofa_contract.js');

const detail = {
  resources: [
    {resource_id: 27, type_id: 1, display_name: 'Genesys Konto', system_id: 9, system_name: 'Genesys', assignment_status: 'ACTIVE'},
    {resource_id: 28, type_id: 1, display_name: 'Citrix Konto', system_id: 10, system_name: 'Citrix', assignment_status: 'REVOCATION_REQUESTED'},
    {resource_id: 29, type_id: 1, display_name: 'Webex Konto', system_id: 11, system_name: 'Webex', assignment_status: 'ACTIVE'},
    {resource_id: 30, type_id: 1, display_name: 'Jira Konto', system_id: 12, system_name: 'Jira', assignment_status: 'REQUESTED'},
    {resource_id: 31, type_id: 1, display_name: 'Altes Konto', system_id: 13, system_name: 'Alt', assignment_status: 'REVOKED'},
    {resource_id: 32, type_id: 2, display_name: 'Gruppe', system_id: 9, system_name: 'Genesys', assignment_status: 'ACTIVE'},
    {resource_id: 33, type_id: 1, display_name: 'Requested + Active', system_id: 14, system_name: 'X', assignment_status: 'REQUESTED'},
    {resource_id: 33, type_id: 1, display_name: 'Requested + Active', system_id: 14, system_name: 'X', assignment_status: 'ACTIVE'}
  ],
  accounts: [
    {user_account_id: 1, resource_id: 27, system_id: 9, account_identifier: 'ina.neu'},
    {user_account_id: 2, resource_id: 28, system_id: 10, account_identifier: 'ina.n'},
    {user_account_id: 3, resource_id: null, system_id: 11, account_identifier: 'i.neu'},
    {user_account_id: 4, resource_id: 99, system_id: 15, account_identifier: 'ohne.zuweisung'}
  ]
};

const rows = c.buildAccountRows(detail);
const byKey = Object.fromEntries(rows.map(r => [`${r.kind}:${r.resourceId ?? r.accountIdentifier}`, r]));

assert.deepStrictEqual(rows.map(r => r.kind), ['account', 'account', 'account', 'missing', 'missing', 'missing', 'legacy']);
assert.strictEqual(byKey['account:27'].canEdit, true);
assert.strictEqual(byKey['account:27'].resourceName, 'Genesys Konto');
assert.strictEqual(byKey['account:28'].status, 'revocation_requested');
assert.strictEqual(byKey['account:28'].canEdit, true);
assert.strictEqual(byKey['account:99'].status, null);
assert.strictEqual(byKey['account:99'].canEdit, false);
assert.strictEqual(byKey['missing:29'].canEdit, true);
assert.deepStrictEqual(byKey['missing:29'].legacyAccountIdentifiers, ['i.neu']);
assert.strictEqual(byKey['missing:30'].status, 'requested');
assert.strictEqual(byKey['missing:30'].canEdit, false);
assert.strictEqual(byKey['missing:33'].status, 'active');
assert.strictEqual('missing:31' in byKey, false);
assert.strictEqual(byKey['legacy:i.neu'].canEdit, false);
assert.deepStrictEqual(c.buildAccountRows({}), []);

assert.deepStrictEqual(
  c.buildAccountIdentifierPayload({accountIdentifier: ' ina.neu ', comment: ' Tippfehler ', expectedAccountIdentifier: 'ina.alt'}),
  {ok: true, payload: {account_identifier: 'ina.neu', comment: 'Tippfehler', expected_account_identifier: 'ina.alt'}}
);
assert.deepStrictEqual(
  c.buildAccountIdentifierPayload({accountIdentifier: 'ina.neu', comment: 'abc', expectedAccountIdentifier: null, adoptUnlinkedAccount: true}).payload,
  {account_identifier: 'ina.neu', comment: 'abc', expected_account_identifier: null, adopt_unlinked_account: true}
);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: '  ', comment: 'abc'}).ok, false);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: 'x'.repeat(255), comment: 'abc'}).ok, true);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: 'x'.repeat(256), comment: 'abc'}).ok, false);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: 'ina\tneu', comment: 'abc'}).ok, false);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: 'ina neu-1', comment: 'abc'}).ok, true);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: 'ina', comment: 'ab'}).ok, false);
assert.strictEqual(c.buildAccountIdentifierPayload({accountIdentifier: 'ina', comment: 'x'.repeat(501)}).ok, false);

assert.strictEqual(c.accountIdentifierOutcomeMessage({action: 'CORRECTED', account_identifier: 'ina.neu'}), 'Kennung korrigiert: ina.neu');
assert.strictEqual(c.accountIdentifierOutcomeMessage({action: 'LINKED', account_identifier: 'i.neu'}), 'Bestandskonto verknüpft: i.neu');
assert.strictEqual(c.accountIdentifierOutcomeMessage({action: 'UNCHANGED', account_identifier: 'ina'}), 'Kennung war bereits gesetzt, keine Änderung');
""")
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_panel_exposes_editor_and_account_log_history(self):
        template = read("app/templates/userverwaltung.html")
        script = read("app/static/js/userverwaltung.js")

        self.assertIn('data-history-category="accountLogs"', template)
        self.assertIn('hasPerm("SOFA-FN-EDITACC")', script)
        self.assertIn("sofaContract.buildAccountRows(detail)", script)
        self.assertIn('code === "unlinked_system_account"', script)
        self.assertIn("Bitte an die IT-Administration wenden.", script)
        self.assertIn("api.getUserAccountLogs(userId, offset)", script)
        self.assertNotIn("X-User-Id", script)


if __name__ == "__main__":
    unittest.main()
