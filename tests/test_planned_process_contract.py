import json
import os
import subprocess
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_computers import AsyncMock, json_body, run_async

from app.api_client import SOFA_BASE_URL, api_client
from app.helpers import time_utils
from app.routes.api import (
    _build_planned_role_request,
    _build_process_cancellation_request,
    _build_process_reschedule_preview,
    _build_process_reschedule_request,
    api_cancel_process,
    api_preview_process_reschedule,
    api_reschedule_process,
    api_send_task_mail,
    api_start_primary_role_change_process,
    api_start_skill_removal_process,
)


ROOT = Path(__file__).resolve().parents[1]


class PlannedProcessApiTests(unittest.TestCase):
    def test_reschedule_bff_uses_berlin_business_day(self):
        with patch("app.routes.api.today_local", return_value=date(2026, 9, 17)):
            with self.assertRaises(ValueError):
                _build_process_reschedule_preview({"effective_date": "2026-09-16"})
            self.assertEqual(_build_process_reschedule_preview({"effective_date": "2026-09-17"}), {"effective_date": "2026-09-17"})
        with patch.object(time_utils, "datetime") as clock:
            time_utils.now_local()
            clock.now.assert_called_once_with(time_utils.LOCAL_TIMEZONE)

    def setUp(self):
        self.current_user = SimpleNamespace(user_id=42)
        self.today = date.today().isoformat()
        self.future = (date.today() + timedelta(days=1)).isoformat()
        self.past = (date.today() - timedelta(days=1)).isoformat()

    def test_shared_date_validation_accepts_today_and_future(self):
        for effective_date in (self.today, self.future):
            request = _build_planned_role_request(
                {"user_id": "7", "role_id": "9", "effective_date": effective_date},
                42,
            )
            self.assertEqual(request, {
                "user_id": 7,
                "role_id": 9,
                "effective_date": effective_date,
                "initiator_user_id": 42,
            })

    def test_shared_date_validation_rejects_missing_invalid_and_past_values(self):
        for effective_date in (None, "", "31.12.2099", "2026-02-30", self.past):
            with self.subTest(effective_date=effective_date):
                with self.assertRaises(ValueError):
                    _build_planned_role_request(
                        {"user_id": 7, "role_id": 9, "effective_date": effective_date},
                        42,
                    )

    @patch("app.routes.api.api_client.trigger_primary_role_change", new_callable=AsyncMock)
    def test_change_uses_exact_allowlisted_upstream_payload(self, trigger_mock):
        trigger_mock.return_value = {"status": "planned", "additional": "tolerated"}

        response = run_async(api_start_primary_role_change_process(
            {
                "user_id": "7",
                "role_id": "9",
                "effective_date": self.future,
                "initiator_user_id": 999,
                "start_date": "1999-01-01",
                "extra": "discard",
            },
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["status"], "planned")
        trigger_mock.assert_awaited_once_with({
            "user_id": 7,
            "role_id": 9,
            "effective_date": self.future,
            "initiator_user_id": 42,
        })

    @patch("app.routes.api.api_client.trigger_skill_removal", new_callable=AsyncMock)
    def test_skill_removal_uses_effective_date_and_accepts_legacy_started(self, trigger_mock):
        trigger_mock.return_value = {"status": "started", "process_id": 123}

        response = run_async(api_start_skill_removal_process(
            {
                "user_id": 7,
                "role_id": 9,
                "effective_date": self.today,
                "start_date": "2099-01-01",
                "initiator_user_id": 999,
            },
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["status"], "started")
        trigger_mock.assert_awaited_once_with({
            "user_id": 7,
            "role_id": 9,
            "effective_date": self.today,
            "initiator_user_id": 42,
        })

    def test_invalid_process_date_returns_400_before_upstream(self):
        response = run_async(api_start_primary_role_change_process(
            {"user_id": 7, "role_id": 9, "effective_date": self.past},
            current_user=self.current_user,
        ))
        self.assertEqual(response.status_code, 400)

    def test_cancellation_reason_boundaries(self):
        for reason in (None, "", "   ", ["invalid"], "x" * 501):
            with self.subTest(reason=reason):
                with self.assertRaises(ValueError):
                    _build_process_cancellation_request({"reason": reason}, 42)

        self.assertEqual(
            _build_process_cancellation_request({"reason": "  Begründung  "}, 42),
            {"reason": "Begründung", "initiator_user_id": 42},
        )
        self.assertEqual(len(_build_process_cancellation_request({"reason": "x" * 500}, 42)["reason"]), 500)

    def test_reschedule_payloads_are_allowlisted_and_validated(self):
        self.assertEqual(
            _build_process_reschedule_preview({"effective_date": self.future, "reason": "discard"}),
            {"effective_date": self.future},
        )
        self.assertEqual(
            _build_process_reschedule_request({
                "effective_date": self.future,
                "expected_effective_date": self.today,
                "reason": "  HR-Korrektur  ",
                "initiator_user_id": 999,
                "extra": True,
            }),
            {
                "effective_date": self.future,
                "expected_effective_date": self.today,
                "reason": "HR-Korrektur",
            },
        )
        for payload in (
            {"effective_date": self.past, "expected_effective_date": self.today, "reason": "x"},
            {"effective_date": self.future, "expected_effective_date": "31.12.2026", "reason": "x"},
            {"effective_date": self.future, "expected_effective_date": self.today, "reason": " "},
        ):
            with self.assertRaises(ValueError):
                _build_process_reschedule_request(payload)

    @patch("app.routes.api.api_client.cancel_process", new_callable=AsyncMock)
    def test_cancel_discards_foreign_fields(self, cancel_mock):
        cancel_mock.return_value = {"status": "cancelled"}

        response = run_async(api_cancel_process(
            123,
            {"reason": "  Nicht mehr benötigt  ", "initiator_user_id": 999, "extra": True},
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        cancel_mock.assert_awaited_once_with(
            123,
            {"reason": "Nicht mehr benötigt", "initiator_user_id": 42},
        )

    @patch("app.routes.api.api_client.preview_process_reschedule", new_callable=AsyncMock)
    def test_reschedule_preview_uses_server_identity(self, preview_mock):
        preview_mock.return_value = {"status": "preview"}
        response = run_async(api_preview_process_reschedule(
            2055,
            {"effective_date": self.future, "initiator_user_id": 999, "extra": True},
            current_user=self.current_user,
        ))
        self.assertEqual(response.status_code, 200)
        preview_mock.assert_awaited_once_with(2055, {"effective_date": self.future}, 42)

    @patch("app.routes.api.api_client.reschedule_process", new_callable=AsyncMock)
    def test_reschedule_apply_uses_allowlist_and_server_identity(self, reschedule_mock):
        reschedule_mock.return_value = {"status": "rescheduled"}
        response = run_async(api_reschedule_process(
            2055,
            {
                "effective_date": self.future,
                "expected_effective_date": self.today,
                "reason": "  Korrektur  ",
                "initiator_user_id": 999,
            },
            current_user=self.current_user,
        ))
        self.assertEqual(response.status_code, 200)
        reschedule_mock.assert_awaited_once_with(
            2055,
            {"effective_date": self.future, "expected_effective_date": self.today, "reason": "Korrektur"},
            42,
        )

    @patch("app.routes.api._get_relevant_task_or_raise", new_callable=AsyncMock)
    @patch("app.routes.api.api_client.send_task_mail", new_callable=AsyncMock)
    def test_task_mail_allowlist_and_identity_match(self, send_mock, relevant_mock):
        relevant_mock.return_value = {"task_id": 55}
        send_mock.return_value = {"status": "queued"}

        response = run_async(api_send_task_mail(
            55,
            {
                "recipient": "user@example.test",
                "cc": "cc@example.test",
                "bcc": "",
                "subject": "Betreff",
                "body": "Text",
                "initiator_user_id": 999,
                "user_id": 999,
                "headers": {"X-User-Id": "999"},
            },
            current_user=self.current_user,
        ))

        self.assertEqual(response.status_code, 200)
        send_mock.assert_awaited_once_with(
            55,
            {
                "recipient": "user@example.test",
                "cc": "cc@example.test",
                "bcc": "",
                "subject": "Betreff",
                "body": "Text",
                "initiator_user_id": 42,
            },
            42,
        )


class PlannedProcessClientTests(unittest.TestCase):
    @patch.object(api_client, "_post", new_callable=AsyncMock)
    def test_task_mail_client_sets_server_identity_header(self, post_mock):
        post_mock.return_value = {"status": "queued"}
        payload = {"initiator_user_id": 42, "recipient": "user@example.test"}

        run_async(api_client.send_task_mail(55, payload, 42))

        post_mock.assert_awaited_once_with(
            SOFA_BASE_URL,
            "/tasks/55/send_mail",
            payload=payload,
            headers={"X-User-Id": "42"},
        )

    @patch.object(api_client, "_patch", new_callable=AsyncMock)
    def test_reschedule_client_sets_server_identity_header(self, patch_mock):
        patch_mock.return_value = {"status": "rescheduled"}
        payload = {"effective_date": "2026-09-30", "expected_effective_date": "2026-09-23", "reason": "x"}
        run_async(api_client.reschedule_process(2055, payload, 42))
        patch_mock.assert_awaited_once_with(
            SOFA_BASE_URL,
            "/processes/2055/reschedule",
            payload=payload,
            headers={"X-User-Id": "42"},
        )


class BrowserContractTests(unittest.TestCase):
    def test_reschedule_dialog_gates_preview_and_shows_in_progress(self):
        script = r"""
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const c = require('./app/static/js/sofa_contract.js');
const source = fs.readFileSync('./app/static/js/userverwaltung.js', 'utf8');
const controller = source.slice(source.indexOf('const processRescheduleModalController ='), source.indexOf('const offboardModalController ='));
const field = () => ({value: '', hidden: false, disabled: false, innerHTML: '', focus() {}});
const DOM = Object.fromEntries([
  'Description', 'CurrentDate', 'Date', 'Reason', 'Preview', 'ReasonGroup', 'SubmitBtn', 'PreviewBtn'
].map(name => ['processReschedule' + name, field()]));
const sandbox = {
  DOM, sofaContract: c, openOverlay() {}, closeOverlay() {},
  escapeHtml: String, formatDateTime: String,
  showFlash() { throw new Error('Unexpected flash'); },
  api: { async previewProcessReschedule() {
    return {new_effective_date: '2099-09-30', actual_unlock_at: '2026-09-09',
            task_counts: {open: 3, blocked: 2, in_progress: 7, assigned: 0}, warnings: []};
  }}
};
vm.runInNewContext(controller + '\nglobalThis.controller = processRescheduleModalController;', sandbox);
(async () => {
  sandbox.controller.open(2055, 'Offboarding', '2098-09-23');
  assert.strictEqual(DOM.processReschedulePreviewBtn.disabled, true);
  DOM.processRescheduleDate.value = '';
  sandbox.controller.clearPreview();
  assert.strictEqual(DOM.processReschedulePreviewBtn.disabled, true);
  DOM.processRescheduleDate.value = '2099-09-30';
  sandbox.controller.clearPreview();
  assert.strictEqual(DOM.processReschedulePreviewBtn.disabled, false);
  await sandbox.controller.loadPreview();
  assert.ok(DOM.processReschedulePreview.innerHTML.includes('In Bearbeitung</dt><dd>7'));
  assert.strictEqual(DOM.processRescheduleSubmitBtn.hidden, false);
  let resolve;
  sandbox.api.previewProcessReschedule = () => new Promise(done => {resolve = done;});
  sandbox.controller.clearPreview();
  const pending = sandbox.controller.loadPreview();
  sandbox.controller.close();
  resolve({task_counts: {}, warnings: []});
  await pending;
  assert.strictEqual(sandbox.controller.preview, null);
  assert.strictEqual(DOM.processRescheduleSubmitBtn.hidden, true);
})().catch(error => {console.error(error); process.exitCode = 1;});
"""
        completed = subprocess.run(
            [os.environ.get("SOFA_NODE_BINARY", "node"), "-e", script],
            cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_node_contract_logic(self):
        script = r"""
const assert = require('assert');
const c = require('./app/static/js/sofa_contract.js');

assert.deepStrictEqual(c.buildPlannedRolePayload('7', '9', '2026-08-31', '2026-08-31'), {
  ok: true,
  payload: {user_id: 7, role_id: 9, effective_date: '2026-08-31'}
});
assert.strictEqual(c.buildPlannedRolePayload(7, 9, '', '2026-08-31').ok, false);
assert.strictEqual(c.buildPlannedRolePayload(7, 9, '2026-02-30', '2026-08-31').ok, false);
assert.strictEqual(c.buildPlannedRolePayload(7, 9, '2026-08-30', '2026-08-31').ok, false);
assert.strictEqual(c.buildPlannedRolePayload(7, 9, '2026-09-01', '2026-08-31').ok, true);

assert.deepStrictEqual(c.buildCancelPayload('  Grund  '), {ok: true, payload: {reason: 'Grund'}});
assert.strictEqual(c.buildCancelPayload('   ').ok, false);
assert.strictEqual(c.buildCancelPayload('x'.repeat(500)).ok, true);
assert.strictEqual(c.buildCancelPayload('x'.repeat(501)).ok, false);

assert.deepStrictEqual(c.buildReschedulePayload('2026-09-30', '2026-09-23', undefined, '2026-09-15'), {
  ok: true,
  payload: {effective_date: '2026-09-30'}
});
assert.deepStrictEqual(c.buildReschedulePayload('2026-09-30', '2026-09-23', '  HR-Korrektur  ', '2026-09-15'), {
  ok: true,
  payload: {effective_date: '2026-09-30', expected_effective_date: '2026-09-23', reason: 'HR-Korrektur'}
});
assert.strictEqual(c.buildReschedulePayload('2026-09-14', '2026-09-23', 'x', '2026-09-15').ok, false);
assert.strictEqual(c.buildReschedulePayload('2026-09-30', '2026-09-23', ' ', '2026-09-15').ok, false);
assert.strictEqual(c.berlinDateKey(new Date('2026-09-16T22:30:00Z')), '2026-09-17');
assert.strictEqual(c.berlinDateKey(new Date('2026-01-16T23:30:00Z')), '2026-01-17');
assert.strictEqual(c.canPreviewReschedule('2026-09-23', '2026-09-23', '2026-09-15'), false);
assert.strictEqual(c.canPreviewReschedule('', '2026-09-23', '2026-09-15'), false);
assert.strictEqual(c.canPreviewReschedule('2026-09-30', '2026-09-23', '2026-09-15'), true);
assert.strictEqual(c.buildReschedulePayload('2026-09-23', '2026-09-23', undefined, '2026-09-15').ok, false);
assert.strictEqual(c.buildReschedulePayload('2099-09-30', '2026-09-23', 'Korrektur', '2026-09-15').ok, true);

assert.strictEqual(c.isFutureRevocationTask({task_type: 'REVOCATION'}, '2026-08-31'), false);
assert.strictEqual(c.isFutureRevocationTask({task_type: 'REVOCATION', target_date: '2026-08-30'}, '2026-08-31'), false);
assert.strictEqual(c.isFutureRevocationTask({task_type: 'REVOCATION', target_date: '2026-08-31'}, '2026-08-31'), false);
assert.strictEqual(c.isFutureRevocationTask({task_type: 'REVOCATION', target_date: '2026-09-01T00:00:00Z'}, '2026-08-31'), true);
assert.strictEqual(c.isFutureRevocationTask({task_type: 'ASSIGNMENT', target_date: '2026-09-01'}, '2026-08-31'), false);

assert.strictEqual(c.canSendTaskMail({status: 'IN_PROGRESS', handling_type: 'EXTERNAL', assigned_to_user_id: 42}, 42), true);
assert.strictEqual(c.canSendTaskMail({status: 'OPEN', handling_type: 'EXTERNAL', assigned_to_user_id: 42}, 42), false);
assert.strictEqual(c.canSendTaskMail({status: 'IN_PROGRESS', handling_type: 'EXTERNAL', assigned_to_user_id: 7}, 42), false);
assert.strictEqual(c.canSendTaskMail({status: 'IN_PROGRESS', handling_type: 'INTERNAL', assigned_to_user_id: 42}, 42), false);

assert.strictEqual(c.mailErrorMessage(503, 'backend detail'), 'Der Mailversand ist derzeit deaktiviert. Es wurde keine Mail beauftragt.');
for (const status of [400, 401, 403, 404, 409, 422]) {
  assert.ok(c.mailErrorMessage(status, '').length > 10);
  assert.strictEqual(c.mailErrorMessage(status, 'Sicheres Detail'), 'Sicheres Detail');
}
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

    def test_templates_and_scripts_expose_required_controls(self):
        user_script = (ROOT / "app/static/js/userverwaltung.js").read_text(encoding="utf-8")
        tasks_script = (ROOT / "app/static/js/tasks.js").read_text(encoding="utf-8")
        user_template = (ROOT / "app/templates/userverwaltung.html").read_text(encoding="utf-8")
        task_template = (ROOT / "app/templates/tasks.html").read_text(encoding="utf-8")

        self.assertNotIn("window.confirm", user_script)
        self.assertIn('id="process-cancel-reason"', user_template)
        self.assertIn('id="process-reschedule-date"', user_template)
        self.assertIn('id="process-reschedule-reason"', user_template)
        self.assertIn("Aufgaben aktiv", user_template)
        self.assertIn("processRescheduleModalController", user_script)
        self.assertIn('maxlength="500"', user_template)
        self.assertIn('id="primary-role-change-date"', user_script)
        self.assertIn('id="skill-revoke-effective-date"', user_script)
        self.assertNotIn("payload.start_date = startDate", user_script[user_script.index("const skillRevokeModalController"):])
        self.assertIn('id="task-modal-target-date"', task_template)
        self.assertIn("showFutureRevocationWarning", tasks_script)
        self.assertIn("sofaContract.canSendTaskMail", tasks_script)
        self.assertIn("Die Auswahl enthält zukünftige Stichtage", tasks_script)
        self.assertNotIn("X-User-Id", tasks_script)
        self.assertNotIn("X-User-Id", user_script)


if __name__ == "__main__":
    unittest.main()
