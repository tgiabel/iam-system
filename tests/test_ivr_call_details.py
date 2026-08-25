from __future__ import annotations

import asyncio
from datetime import date, timedelta
import inspect
import json
from pathlib import Path
import shutil
import subprocess
import unittest
from unittest.mock import patch

try:
    import fastapi
    if not hasattr(fastapi, "APIRouter") or not hasattr(fastapi, "UploadFile"):
        raise ImportError("Incomplete FastAPI test double")
except (ModuleNotFoundError, ImportError):
    from tests import test_iks as _compat  # noqa: F401

from app.api_client import APIClient, REPORTING_BASE_URL
from app.authz import AuthorizationContext
from app.routes import api, pages


PERMISSION = "SOFA-RPRT-TIVR"


class AsyncRecorder:
    def __init__(self, return_value):
        self.return_value = return_value
        self.calls = []

    async def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.return_value


def make_authz(*permissions: str) -> AuthorizationContext:
    return AuthorizationContext(
        user_id=1,
        pnr="00001",
        primary_role_name="test",
        permissions=frozenset(permissions),
        accessible_backlogs=frozenset(),
        has_all_backlog_access=False,
        raw_user={"user_id": 1},
    )


def permission_dependency(endpoint, parameter: str):
    depends = inspect.signature(endpoint).parameters[parameter].default
    return getattr(depends, "dependency", depends)


class TestIvrCallDetailsAuthorization(unittest.TestCase):
    def test_page_requires_tivr_permission(self):
        dependency = permission_dependency(pages.ivr_call_details_tool, "authz")
        allowed = make_authz(PERMISSION)
        self.assertIs(asyncio.run(dependency(allowed)), allowed)

        with self.assertRaises(Exception) as denied:
            asyncio.run(dependency(make_authz()))
        self.assertEqual(denied.exception.status_code, 303)
        self.assertEqual(denied.exception.headers["Location"], "/tools")

    def test_proxy_requires_tivr_permission(self):
        dependency = permission_dependency(api.api_get_ivr_call_details, "current_user")
        allowed = make_authz(PERMISSION)
        self.assertIs(asyncio.run(dependency(allowed)), allowed)

        with self.assertRaises(Exception) as denied:
            asyncio.run(dependency(make_authz()))
        self.assertEqual(denied.exception.status_code, 403)

    def test_report_permission_exposes_workspace_navigation(self):
        self.assertTrue(make_authz(PERMISSION).has_any_tool())

    def test_tool_card_uses_same_permission(self):
        template = (Path(__file__).parents[1] / "app/templates/tools.html").read_text(encoding="utf-8")
        self.assertIn('href="/tools/ivr-call-details"', template)
        self.assertIn('{% if "SOFA-RPRT-TIVR" in authz.permissions %}', template)


class TestIvrCallDetailsProxy(unittest.TestCase):
    def test_api_client_uses_reporting_call_details_contract(self):
        client = APIClient()
        backend = AsyncRecorder({"data": []})
        client._get = backend

        result = asyncio.run(client.get_ivr_call_details("2026-08-23"))

        self.assertEqual(result, {"data": []})
        self.assertEqual(backend.calls, [(
            (REPORTING_BASE_URL, "/ivr/call-details"),
            {"params": {"day": "2026-08-23"}},
        )])

    def test_proxy_forwards_resolved_day(self):
        report_day = (date.today() - timedelta(days=2)).isoformat()
        payload = {"day": report_day, "data": []}
        backend = AsyncRecorder(payload)

        with patch.object(api.api_client, "get_ivr_call_details", backend):
            response = asyncio.run(
                api.api_get_ivr_call_details(day=report_day, current_user=make_authz(PERMISSION))
            )

        self.assertEqual(json.loads(response.body), payload)
        self.assertEqual(backend.calls, [((), {"day": report_day})])

    def test_missing_day_defaults_to_yesterday(self):
        expected = (date.today() - timedelta(days=1)).isoformat()
        self.assertEqual(api._resolve_ivr_report_day(None), expected)

    def test_today_future_and_invalid_days_are_rejected(self):
        rejected = (date.today().isoformat(), (date.today() + timedelta(days=1)).isoformat(), "24.08.2026")
        for value in rejected:
            with self.subTest(value=value), self.assertRaises(Exception) as raised:
                api._resolve_ivr_report_day(value)
            self.assertEqual(raised.exception.status_code, 400)


class TestIvrCallDetailsFrontendContract(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).parents[1]
        self.script = (root / "app/static/js/reports/ivr_call_details.js").read_text(encoding="utf-8")
        self.template = (root / "app/templates/reports/ivr_call_details.html").read_text(encoding="utf-8")

    def test_search_filter_pagination_and_lazy_details_are_call_scoped(self):
        self.assertIn("const IVR_CALL_PAGE_SIZE = 100", self.script)
        self.assertIn("...sections.flatMap(section => [section.target, section.targetLabel, section.result])", self.script)
        self.assertIn("!isConnectedResult(call.finalResult)", self.script)
        self.assertIn("ivrCallState.expandedKeys.has(call.key)", self.script)
        self.assertIn("if (!expanded)", self.script)

    def test_export_is_complete_section_based_and_formula_safe(self):
        self.assertIn("const calls = getFilteredSortedCalls()", self.script)
        self.assertIn("call.sections.length ? call.sections : [null]", self.script)
        self.assertIn("/^[\\t\\r\\n ]*[=+\\-@]/", self.script)

    def test_template_exposes_accessible_controls_and_data_note(self):
        self.assertIn('id="ivrCallIssueOnly"', self.template)
        self.assertIn('id="ivrCallExportCsv"', self.template)
        self.assertIn('aria-live="polite"', self.template)
        self.assertIn("bis einschließlich Vortag", self.template)


@unittest.skipUnless(shutil.which("node"), "Node.js ist für die JavaScript-Logiktests nicht verfügbar")
class TestIvrCallDetailsUiLogic(unittest.TestCase):
    def test_call_level_derivation_search_and_csv(self):
        javascript_path = Path(__file__).parents[1] / "app/static/js/reports/ivr_call_details.js"
        script = r"""
            const assert = require('assert');
            const ui = require(process.argv[1]);
            const call = ui.normalizeCall({
                call_id: '=danger',
                started_at: '2026-08-23T12:34:56',
                service_number: '03040504050',
                calling_party_number: '+4912345',
                origin: 'Mobilfunk',
                final_result: 'should-not-win',
                total_duration_seconds: 999,
                sections: [
                    { sequence: 2, target: '493040504050123', target_label: 'Fehlerziel', result: 'Sonstiges(15)', duration_seconds: 145 },
                    { sequence: 1, target: 'Sprachdialog', target_label: null, result: 'Verbunden', duration_seconds: 42 }
                ]
            });
            assert.deepStrictEqual(call.sections.map(section => section.sequence), [1, 2]);
            assert.strictEqual(call.finalTarget, '493040504050123');
            assert.strictEqual(call.finalResult, 'Sonstiges(15)');
            assert.strictEqual(call.sectionCount, 2);
            assert.strictEqual(call.totalDurationSeconds, 187);
            assert.strictEqual(ui.callMatchesSearch(call, 'Fehlerziel'), true);
            assert.strictEqual(ui.callMatchesSearch(call, 'verbunden'), true);
            assert.strictEqual(ui.callMatchesSearch(call, 'nicht vorhanden'), false);
            assert.strictEqual(ui.isConnectedResult(' Verbunden '), true);
            assert.strictEqual(ui.isConnectedResult('Sonstiges(15)'), false);
            assert.strictEqual(ui.isConnectedResult(''), false);
            const csv = ui.buildCsv([call]);
            assert.strictEqual(csv.trim().split('\r\n').length, 3);
            assert.ok(csv.includes("'=danger"));
            assert.ok(csv.includes('Sonstiges(15)'));
        """

        completed = subprocess.run(
            ["node", "-e", script, str(javascript_path)],
            cwd=Path(__file__).parents[1],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
