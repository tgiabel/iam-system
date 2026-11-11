import asyncio
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.api_client import APIClient, REPORTING_BASE_URL
from app.authz import AuthorizationContext, build_authorization_context
from app.main import app
from app.routes import agent_stats_report as report_route
from app.session import SessionState, current_session


def authz(user_id=42):
    return AuthorizationContext(user_id=user_id, pnr='42', primary_role_name='Agent',
                                permissions=frozenset(), accessible_backlogs=frozenset(),
                                has_all_backlog_access=False, raw_user={'user_id': user_id})


class ClientTests(unittest.TestCase):
    def test_day_month_partial_ranges_and_empty_states_in_browser_code(self):
        root = Path(__file__).resolve().parents[1]
        for script in ('tests/agent_stats_model_checks.js', 'tests/agent_stats_ui_checks.js'):
            with self.subTest(script):
                result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), script],
                                        cwd=root, env=dict(os.environ, TZ='America/Los_Angeles'),
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_client_sends_the_session_instead_of_a_report_token(self):
        client = APIClient()
        calls = []

        async def request(*args, **kwargs):
            calls.append((args, kwargs))
            return 'ok'

        client._request = request
        self.assertEqual(asyncio.run(client.agent_stats_request(params=[('period', 'day')])), 'ok')
        self.assertEqual(calls[0][0], ('GET', REPORTING_BASE_URL, '/agent-stats'))
        self.assertNotIn('headers', calls[0][1])
        reset = current_session.set(SessionState(token='T' * 43, csrf_token='C' * 43))
        try:
            headers = APIClient._session_headers('GET', None)
        finally:
            current_session.reset(reset)
        self.assertEqual(headers['X-SOFA-Session'], 'T' * 43)
        self.assertNotIn('Authorization', headers)
        self.assertNotIn('X-CSRF-Token', headers)


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.context = authz()
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_all_logged_in_users_see_workspace_and_report_card(self):
        page = self.client.get('/workspace')
        self.assertEqual(page.status_code, 200)
        self.assertIn('/reports/agent-stats', page.text)
        self.assertIn('workspace-reports-title', page.text)

    def test_report_page_opens_for_the_signed_in_user(self):
        page = self.client.get('/reports/agent-stats')
        self.assertEqual(page.status_code, 200)
        self.assertIn('Anwesenheit', page.text)

    def test_proxy_forwards_only_safe_parameters(self):
        calls = []

        async def backend(*, params):
            calls.append(params)
            return httpx.Response(200, json={'account_linked': True})

        with patch.object(report_route.api_client, 'agent_stats_request', backend):
            response = self.client.get('/api/reporting/agent-stats?period=month&anchor=2026-09-20&user_id=999',
                                       headers={'X-User-Id': '999'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(calls, [[('period', 'month'), ('anchor', '2026-09-20')]])

    def test_proxy_needs_a_session(self):
        app.dependency_overrides.clear()
        response = self.client.get('/api/reporting/agent-stats')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()['detail']['code'], 'session_missing')
