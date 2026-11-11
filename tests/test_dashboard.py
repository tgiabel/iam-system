import os
import re
import subprocess
import unittest
from datetime import date, datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app import dashboard, dashboard_mock
from app.authz import AuthorizationContext
from app.main import app
from app.routes import dashboard as dashboard_route, service_level
from tests.session_helpers import sign_in

ROOT = Path(__file__).resolve().parents[1]


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

    def test_real_sources_without_mock(self):
        # Genesys-Bereiche kommen ueber die Sitzung; jede angemeldete Person hat sie.
        with patch.object(dashboard, 'app_env', 'production'):
            context = dashboard.build_dashboard_context(self.authz(), None)
        self.assertEqual(context['dashboard_sources'], {
            'events': '/api/events', 'live': '/api/reporting/genesys-live',
            'service_level': '/api/reporting/service-level', 'my_day': '/api/dashboard/my-day'})


class RenderedDashboardTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def page(self, *permissions, mock=None):
        sign_in(self, self.client, *permissions, first_name='Test')
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

    def test_live_panel_for_every_signed_in_user(self):
        self.assertTrue('id="dash-live"' in self.page('SOFA-TOOL-ZK'))
        self.assertTrue('id="dash-live"' in self.page())

    def test_without_session_the_dashboard_sends_to_login(self):
        response = TestClient(app).get('/', follow_redirects=False)
        self.assertEqual((response.status_code, response.headers['location']), (303, '/login'))

    def pin_ids(self, html):
        template = html.split('<template id="dash-pin-source">', 1)[1].split('</template>', 1)[0]
        return re.findall(r'data-workspace-id="([^"]+)"', template)

    def test_pin_source_lists_only_visible_entries(self):
        self.assertEqual(self.pin_ids(self.page('SOFA-TOOL-ZK')), ['zeitkorrektur', 'genesys-live', 'agent-stats'])
        self.assertEqual(self.pin_ids(self.page()), ['genesys-live', 'agent-stats'])

    @unittest.skipIf(os.getenv('APP_ENV') == 'development', 'Mock-Routen sind in der Entwicklungsinstanz aktiv')
    def test_mock_routes_exist_only_in_development(self):
        # Die Testumgebung laeuft ohne APP_ENV=development.
        sign_in(self, self.client, 'SOFA-PAGE-TODO')
        self.assertEqual(self.client.get('/api/dashboard-mock/events').status_code, 404)
        self.assertFalse('data-mock' in self.page('SOFA-PAGE-TODO', mock='busy'))


if __name__ == '__main__':
    unittest.main()


class DashboardDataRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def login(self, *permissions):
        sign_in(self, self.client, *permissions)

    def test_events_need_only_a_login(self):
        async def events(from_date, to_date):
            return [{'event_id': 1, 'event_type': 'RETRAIN', 'title': 'Nachschulung', 'user_name': 'Mia Hoffmann'}]

        anonymous = self.client.get('/api/events', follow_redirects=False)
        self.assertEqual((anonymous.status_code, anonymous.json()['detail']['code']), (401, 'session_missing'))
        self.login()
        with patch('app.routes.api.api_client.get_events', events):
            response = self.client.get('/api/events')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]['user_name'], 'Mia Hoffmann')

    def test_service_level_forwards_only_the_scope(self):
        calls = []

        async def backend(params=None):
            calls.append(params)
            return httpx.Response(200, json={'scope': {'type': 'queue'}})

        with patch.object(service_level.api_client, 'service_level_request', backend):
            self.login()
            response = self.client.get('/api/reporting/service-level', params={'queue_id': 'q1'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(calls, [[('queue_id', 'q1')]])

    def test_my_day_counts_own_tasks_of_that_day_and_calls(self):
        overview_calls = []

        async def overview(user_id, completed_since=None):
            overview_calls.append((user_id, completed_since))
            return {'completed_tasks': [
                {'task_id': 1, 'assigned_to_user_id': 42, 'completed_at': '2026-10-14T09:00:00'},
                {'task_id': 2, 'assigned_to_user_id': 42, 'completed_at': '2026-10-15T08:00:00'},
                {'task_id': 3, 'assigned_to_user_id': 7, 'completed_at': '2026-10-14T10:00:00'},
            ]}

        async def stats(params=None):
            self.assertEqual(params, [('period', 'day'), ('anchor', '2026-10-14')])
            return httpx.Response(200, json={'phone': {'available': True, 'summary': {'answered': 31}}},
                                  request=httpx.Request('GET', 'http://sd-api.test'))

        with patch.object(dashboard_route.api_client, 'get_task_overview', overview), \
                patch.object(dashboard_route.api_client, 'agent_stats_request', stats):
            self.login('SOFA-PAGE-TODO')
            both = self.client.get('/api/dashboard/my-day', params={'date': '2026-10-14'}).json()
            self.login()
            calls_only = self.client.get('/api/dashboard/my-day', params={'date': '2026-10-14'}).json()
        self.assertEqual(both, {'date': '2026-10-14', 'tasks_completed': 1, 'calls_answered': 31})
        self.assertEqual(calls_only, {'date': '2026-10-14', 'calls_answered': 31})
        self.assertEqual(overview_calls, [(42, '2026-10-14')])

    def test_my_day_drops_a_failing_part(self):
        async def broken(*args, **kwargs):
            raise RuntimeError('sd-api down')

        with patch.object(dashboard_route.api_client, 'get_task_overview', broken), \
                patch.object(dashboard_route.api_client, 'agent_stats_request', broken):
            self.login('SOFA-PAGE-TODO')
            response = self.client.get('/api/dashboard/my-day', params={'date': '2026-10-14'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'date': '2026-10-14'})
