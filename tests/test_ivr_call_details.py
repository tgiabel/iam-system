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
        self.assertEqual(api._resolve_ivr_call_details_day(None), expected)

    def test_today_future_and_invalid_days_are_rejected(self):
        rejected = (date.today().isoformat(), (date.today() + timedelta(days=1)).isoformat(), "24.08.2026")
        for value in rejected:
            with self.subTest(value=value), self.assertRaises(Exception) as raised:
                api._resolve_ivr_call_details_day(value)
            self.assertEqual(raised.exception.status_code, 400)


class TestIvrCallDetailsFrontendContract(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).parents[1]
        self.script = (root / "app/static/js/reports/ivr_call_details.js").read_text(encoding="utf-8")
        self.stylesheet = (root / "app/static/css/ivr_call_details.css").read_text(encoding="utf-8")
        self.template = (root / "app/templates/reports/ivr_call_details.html").read_text(encoding="utf-8")

    def test_search_filter_pagination_and_lazy_details_are_call_scoped(self):
        self.assertIn("const IVR_CALL_PAGE_SIZE = 100", self.script)
        self.assertIn("...sections.flatMap(section => [section.target, section.targetLabel, section.result])", self.script)
        self.assertIn("String(call.serviceNumber ?? \"\") === ivrCallState.serviceNumber", self.script)
        self.assertIn("!isConnectedResult(call.finalResult)", self.script)
        self.assertIn("ivrCallState.expandedKeys.has(call.key)", self.script)
        self.assertIn("if (!expanded)", self.script)

    def test_export_is_complete_section_based_and_formula_safe(self):
        self.assertIn("const calls = getFilteredSortedCalls()", self.script)
        self.assertIn("call.sections.length ? call.sections : [null]", self.script)
        self.assertIn("/^[\\t\\r\\n ]*[=+\\-@]/", self.script)

    def test_template_exposes_accessible_controls_and_data_note(self):
        self.assertIn('id="ivrCallIssueOnly"', self.template)
        self.assertIn('id="ivrCallServiceFilter"', self.template)
        self.assertIn("Alle Servicenummern", self.template)
        self.assertIn('aria-label="Servicerufnummer filtern"', self.template)
        self.assertIn('id="ivrCallExportCsv"', self.template)
        self.assertIn('aria-live="polite"', self.template)
        self.assertIn("bis einschließlich Vortag", self.template)
        self.assertIn('id="ivrCallKpiStrip"', self.template)
        self.assertIn('id="ivrCallKpiDetails"', self.template)
        self.assertIn('aria-controls="ivrCallKpiDetails"', self.script)

    def test_kpi_details_stack_without_clipping_on_narrow_screens(self):
        mobile_rules = self.stylesheet[self.stylesheet.index("@media (max-width: 420px)"):]
        self.assertIn("grid-template-columns: minmax(0, 1fr)", mobile_rules)
        self.assertIn("overflow-wrap: anywhere", mobile_rules)
        self.assertIn("text-align: left", mobile_rules)
        self.assertIn("white-space: normal", mobile_rules)
        self.assertIn("grid-column: 1", mobile_rules)


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
            assert.strictEqual(ui.callMatchesSearch(call, '03040504050'), false);
            assert.strictEqual(ui.callMatchesSearch(call, 'nicht vorhanden'), false);
            assert.strictEqual(ui.isConnectedResult(' Verbunden '), true);
            assert.strictEqual(ui.isConnectedResult('Sonstiges(15)'), false);
            assert.strictEqual(ui.isConnectedResult(''), false);
            const kpis = ui.aggregateCallDurationKpis([
                call,
                ui.normalizeCall({
                    call_id: 's-direkt',
                    total_duration_seconds: 999,
                    sections: [
                        { sequence: 1, target: 'Fehlerziel', target_label: 'Fehlerziel', result: 'Sonstiges(15)', duration_seconds: 40 },
                        { sequence: 2, target: '0691302597', target_label: 'S-Direkt', result: 'Verbunden', duration_seconds: 60 }
                    ]
                }),
                ui.normalizeCall({
                    call_id: 'rest',
                    sections: [
                        { sequence: 1, target: '18', target_label: 'Hotline', result: 'Verbunden', duration_seconds: 20 },
                        { sequence: 2, target: '18', target_label: 'Hotline', result: 'Besetzt', duration_seconds: 30 }
                    ]
                }),
                ui.normalizeCall({
                    call_id: 'fallback',
                    sections: [{ sequence: 1, target: '0691302598', result: 'Verbunden', duration_seconds: 25 }]
                }),
                ui.normalizeCall({
                    call_id: 'internal-18',
                    sections: [{ sequence: 1, target: '0691302597', target_label: 'DNIS 18', result: 'Verbunden', duration_seconds: 30 }]
                }),
                ui.normalizeCall({
                    call_id: 'internal-42',
                    sections: [{ sequence: 1, target: '0691302598', target_label: 'DNIS 42', result: 'Verbunden', duration_seconds: 20 }]
                })
            ]);
            assert.strictEqual(kpis.totalDurationSeconds, 412);
            assert.strictEqual(kpis.targets[0].label, 'S-Direkt');
            assert.strictEqual(kpis.targets[0].durationSeconds, 100);
            assert.deepStrictEqual(kpis.targets[0].detailItems, [{ label: '0691302597', secondaryLabel: null, durationSeconds: 100 }]);
            const internal = kpis.targets.find(target => target.label === 'Intern');
            assert.strictEqual(internal.durationSeconds, 50);
            assert.deepStrictEqual(internal.detailItems, [
                { label: 'DNIS 18', secondaryLabel: '0691302597', durationSeconds: 30 },
                { label: 'DNIS 42', secondaryLabel: '0691302598', durationSeconds: 20 }
            ]);
            assert.strictEqual(kpis.targets.find(target => target.label === '0691302598').durationSeconds, 25);
            assert.strictEqual(kpis.rest.durationSeconds, 237);
            assert.deepStrictEqual(kpis.rest.results, [
                { label: 'Sonstiges(15)', durationSeconds: 187 },
                { label: 'Besetzt', durationSeconds: 50 }
            ]);
            const realInternAndDnis = ui.aggregateCallDurationKpis([
                ui.normalizeCall({
                    call_id: 'dnis-internal',
                    sections: [{ sequence: 1, target: '18', target_label: 'DNIS 18', result: 'Verbunden', duration_seconds: 30 }]
                }),
                ui.normalizeCall({
                    call_id: 'real-intern',
                    sections: [{ sequence: 1, target: 'external', target_label: 'Intern', result: 'Verbunden', duration_seconds: 20 }]
                })
            ]);
            assert.strictEqual(realInternAndDnis.targets.length, 2);
            assert.strictEqual(realInternAndDnis.targets.find(target => target.key === 'group:dnis-internal').durationSeconds, 30);
            assert.strictEqual(realInternAndDnis.targets.find(target => target.key === 'target:intern').durationSeconds, 20);

            const emptyKpis = ui.aggregateCallDurationKpis([]);
            const emptyCards = ui.buildKpiCardModels(emptyKpis);
            assert.deepStrictEqual(emptyCards, [{
                key: null,
                label: 'Gesamt IVR-Zeit',
                durationSeconds: 0,
                clickable: false
            }]);
            const emptyFilterCards = ui.buildKpiCardModels(ui.aggregateCallDurationKpis([
                ui.normalizeCall({
                    call_id: 'filtered-out',
                    sections: [{ sequence: 1, target: '18', target_label: 'Hotline', result: 'Besetzt', duration_seconds: 30 }]
                })
            ].filter(candidate => ui.callMatchesSearch(candidate, 'kein Treffer'))));
            assert.deepStrictEqual(emptyFilterCards, emptyCards);
            const cardsWithRest = ui.buildKpiCardModels(ui.aggregateCallDurationKpis([
                ui.normalizeCall({
                    call_id: 'rest-card',
                    sections: [{ sequence: 1, target: '18', target_label: 'Hotline', result: 'Besetzt', duration_seconds: 30 }]
                })
            ]));
            assert.strictEqual(cardsWithRest.length, 2);
            assert.deepStrictEqual(cardsWithRest[1], {
                key: 'rest',
                label: 'Restpositionen',
                durationSeconds: 30,
                clickable: true
            });
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
