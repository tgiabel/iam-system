import base64
import json
import os
import re
import subprocess
import unittest
from datetime import date, datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import dashboard, dashboard_mock
from app.agent_stats_token import issue
from app.authz import AuthorizationContext
from app.main import app

SECRET = base64.b64encode(b'dashboard-test-secret-is-long-enough!').decode()
ROOT = Path(__file__).resolve().parents[1]


def user_cookie(*identifiers, user_id=42):
    permissions = {'accessible_pages': [{'identifier': item} for item in identifiers if item.startswith('SOFA-PAGE')],
                   'accessible_tools': [{'identifier': item} for item in identifiers if item.startswith('SOFA-TOOL')],
                   'accessible_reports': [{'identifier': item} for item in identifiers if item.startswith('SOFA-RPRT')]}
    return json.dumps({'user_id': user_id, 'pnr': '42', 'first_name': 'Test', 'primary_role': {'name': 'Agent'},
                       'secondary_roles': [], 'sofa_permissions': permissions})


class CalendarSummaryTests(unittest.TestCase):
    def test_calendar_summary_in_node(self):
        result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), 'tests/calendar_summary_checks.js'],
                                cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class MockDataTests(unittest.TestCase):
    TODAY = date(2026, 10, 14)  # Mittwoch

    def test_mock_is_deterministic_per_day(self):
        self.assertEqual(dashboard_mock.mock_events('normal', self.TODAY), dashboard_mock.mock_events('normal', self.TODAY))

    def test_events_cover_all_kinds_and_filter_by_window(self):
        events = dashboard_mock.mock_events('normal', self.TODAY)
        self.assertEqual({e['event_type'] for e in events},
                         {'ONBOARDING', 'OFFBOARDING', 'ROLE_ASSIGNMENT', 'ROLE_REMOVAL', 'TRAINING_SCHEDULE', 'RETRAIN'})
        self.assertIn('CHANGE', {e['process_type'] for e in events})
        self.assertIn('FAILED', {e['event_status'] for e in events})
        week = dashboard_mock.filter_events(events, '2026-10-12T00:00:00', '2026-10-18T23:59:59')
        self.assertTrue(week)
        self.assertTrue(all('2026-10-12' <= e['display_at'][:10] <= '2026-10-18' for e in week))
        self.assertLess(len(week), len(events))

    def test_my_day_follows_the_day(self):
        now = datetime(2026, 10, 15, 17, 0, tzinfo=ZoneInfo('Europe/Berlin'))
        tuesday = dashboard_mock.mock_my_day('normal', date(2026, 10, 13), now)
        self.assertEqual(set(tuesday), {'date', 'tasks_completed', 'calls_answered'})
        self.assertEqual(tuesday['date'], '2026-10-13')
        self.assertGreater(tuesday['calls_answered'], 0)
        self.assertNotEqual(tuesday, dashboard_mock.mock_my_day('normal', date(2026, 10, 14), now))
        empty = {'tasks_completed': 0, 'calls_answered': 0}
        for day in (date(2026, 10, 16), date(2026, 10, 11)):
            data = dashboard_mock.mock_my_day('normal', day, now)
            self.assertEqual({k: data[k] for k in empty}, empty, 'Zukunft und Wochenende leer')

    def test_live_and_service_level(self):
        live = dashboard_mock.mock_genesys_live('normal')
        self.assertIn('total', live)
        self.assertTrue(live['as_of'].endswith('Z'))
        self.assertEqual(dashboard_mock.mock_genesys_live('quiet')['total']['people']['present'], 14)
        now = datetime(2026, 10, 15, 11, 0, tzinfo=ZoneInfo('Europe/Berlin'))
        total = dashboard_mock.mock_service_level('normal', now)
        self.assertEqual(total['scope'], {'type': 'all', 'id': None, 'label': 'Gesamt'})
        self.assertEqual((len(total['queues']), total['target_ratio']), (24, 0.8))
        self.assertEqual((total['day']['date'], total['month']['month'], total['previous_month']['month']),
                         ('2026-10-15', '2026-10', '2026-09'))
        self.assertEqual([d['date'] for d in total['days']][::6], ['2026-10-08', '2026-10-14'])
        self.assertIsNone(total['days'][3]['ratio'], 'Sonntag 11.10. ohne Anrufe')
        queue_id = total['queues'][0]['queue_id']
        single = dashboard_mock.mock_service_level('normal', now, queue_id=queue_id)
        self.assertEqual(single['scope']['id'], queue_id)
        group = dashboard_mock.mock_service_level('normal', now, group_id='vrp')
        self.assertEqual((group['scope']['type'], group['scope']['label']), ('group', 'VRP-Queues'))
        self.assertLess(single['day']['denominator'], group['day']['denominator'])
        self.assertLess(group['day']['denominator'], total['day']['denominator'])
        self.assertGreater(total['previous_month']['denominator'], total['month']['denominator'])
        self.assertAlmostEqual(total['day']['ratio'], total['day']['numerator'] / total['day']['denominator'], places=4)
        busy = dashboard_mock.mock_service_level('busy', now)
        self.assertLess(busy['month']['ratio'], total['month']['ratio'])


class DashboardContextTests(unittest.TestCase):
    def authz(self, *permissions):
        return AuthorizationContext(user_id=42, pnr='42', primary_role_name='Agent', permissions=frozenset(permissions),
                                    accessible_backlogs=frozenset(), has_all_backlog_access=False, raw_user={'user_id': 42})

    def test_mock_only_in_development(self):
        with patch.object(dashboard, 'app_env', 'production'):
            self.assertIsNone(dashboard.mock_scenario('busy'))
        with patch.object(dashboard, 'app_env', 'development'):
            self.assertEqual(dashboard.mock_scenario(None), 'normal')
            self.assertEqual(dashboard.mock_scenario('busy'), 'busy')
            self.assertEqual(dashboard.mock_scenario('quatsch'), 'normal')
            self.assertIsNone(dashboard.mock_scenario('0'))

    def test_live_needs_secret_and_matching_cookie(self):
        with patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': SECRET}):
            self.assertTrue(dashboard.live_available(self.authz(), issue(42)))
            self.assertFalse(dashboard.live_available(self.authz(), issue(43)))
            self.assertFalse(dashboard.live_available(self.authz(), ''))
            self.assertFalse(dashboard.live_available(self.authz(), 'kaputt'))
        with patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': ''}):
            self.assertFalse(dashboard.live_available(self.authz(), 'egal'))

    def test_real_sources_without_mock(self):
        with patch.object(dashboard, 'app_env', 'production'):
            context = dashboard.build_dashboard_context(self.authz('SOFA-PAGE-TODO'), '', None)
        self.assertEqual(context['dashboard_sources']['events'], '/api/events')
        self.assertEqual(context['dashboard_sources']['service_level'], '')
        self.assertEqual(context['dashboard_sources']['my_day'], '')
        self.assertFalse(context['dashboard_live'])


class RenderedDashboardTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': SECRET})
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app)

    def page(self, *permissions, mock=None, cookies=None):
        self.client.cookies.clear()
        self.client.cookies.set('sofa_user', user_cookie(*permissions))
        for key, value in (cookies or {}).items():
            self.client.cookies.set(key, value)
        response = self.client.get('/', params={'mock': mock} if mock else None)
        self.assertEqual(response.status_code, 200)
        return response.text

    def main_of(self, html):
        return html.split('<main>', 1)[1].split('</main>', 1)[0]

    def test_dashboard_has_no_explanatory_copy(self):
        main = self.main_of(self.page('SOFA-PAGE-TODO'))
        self.assertFalse('ui-section-copy' in main or 'ui-chip' in main or 'ui-section-kicker' in main)

    def test_page_has_greeting_and_week_calendar_but_no_kpi_cards(self):
        main = self.main_of(self.page('SOFA-TOOL-ZK'))
        self.assertTrue('id="dash-days"' in main and 'id="dash-badges"' in main and 'id="dash-day-lines"' in main)
        self.assertIn('Hallo Test</h1>', main)
        self.assertFalse('dash-stat' in main)

    def test_live_panel_only_with_valid_cookie(self):
        self.assertFalse('id="dash-live"' in self.page('SOFA-TOOL-ZK'))
        self.assertTrue('id="dash-live"' in self.page('SOFA-TOOL-ZK', cookies={'sofa_agent_stats': issue(42)}))
        self.assertFalse('id="dash-live"' in self.page('SOFA-TOOL-ZK', cookies={'sofa_agent_stats': issue(7)}))

    def pin_ids(self, html):
        template = html.split('<template id="dash-pin-source">', 1)[1].split('</template>', 1)[0]
        return re.findall(r'data-workspace-id="([^"]+)"', template)

    def test_pin_source_lists_only_visible_entries(self):
        self.assertEqual(self.pin_ids(self.page('SOFA-TOOL-ZK')), ['zeitkorrektur', 'genesys-live', 'agent-stats'])
        with patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': ''}):
            self.assertEqual(self.pin_ids(self.page('SOFA-TOOL-ZK')), ['zeitkorrektur'])
            self.assertEqual(self.pin_ids(self.page()), [])

    @unittest.skipIf(os.getenv('APP_ENV') == 'development', 'Mock-Routen sind in der Entwicklungsinstanz aktiv')
    def test_mock_routes_exist_only_in_development(self):
        # Die Testumgebung laeuft ohne APP_ENV=development.
        self.client.cookies.set('sofa_user', user_cookie('SOFA-PAGE-TODO'))
        self.assertEqual(self.client.get('/api/dashboard-mock/events').status_code, 404)
        self.assertFalse('data-mock' in self.page('SOFA-PAGE-TODO', mock='busy'))


if __name__ == '__main__':
    unittest.main()
