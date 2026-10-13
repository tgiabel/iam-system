import asyncio
import base64
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.agent_stats_token import issue, verify
from app.api_client import APIClient, REPORTING_BASE_URL
from app.authz import AuthorizationContext, build_authorization_context
from app.main import app
from app.routes import agent_stats_report as report_route

SECRET = base64.b64encode(b'agent-stats-test-secret-is-long-enough-0001').decode()


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

    def test_malformed_token_fails_closed(self):
        with patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': SECRET}):
            with self.assertRaises(ValueError):
                verify('a.a')

    def test_client_forwards_signed_token_without_user_header(self):
        client = APIClient()
        calls = []

        async def request(*args, **kwargs):
            calls.append((args, kwargs))
            return 'ok'

        client._request = request
        self.assertEqual(asyncio.run(client.agent_stats_request('signed-token', params=[('period', 'day')])), 'ok')
        self.assertEqual(calls[0][0], ('GET', REPORTING_BASE_URL, '/agent-stats'))
        self.assertEqual(calls[0][1]['headers'], {'Authorization': 'Bearer signed-token'})


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.secret = patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': SECRET})
        self.secret.start()
        self.addCleanup(self.secret.stop)
        self.context = authz()
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)
        self.token = issue(42)

    def test_all_logged_in_users_see_workspace_and_report_card(self):
        page = self.client.get('/tools')
        self.assertEqual(page.status_code, 200)
        self.assertIn('/tools/agent-stats', page.text)
        self.assertIn('data-tab="reports"', page.text)

    def test_report_is_not_advertised_before_key_is_configured(self):
        with patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': ''}):
            self.assertEqual(self.client.get('/tools', follow_redirects=False).status_code, 303)
            self.assertEqual(self.client.get('/tools/agent-stats', follow_redirects=False).status_code, 303)

    def test_report_page_requires_signed_identity_matching_session(self):
        self.assertEqual(self.client.get('/tools/agent-stats', follow_redirects=False).status_code, 303)
        page = self.client.get('/tools/agent-stats', cookies={'sofa_agent_stats': self.token})
        self.assertEqual(page.status_code, 200)
        self.assertIn('Anwesenheit', page.text)
        self.context = authz(99)
        self.assertEqual(self.client.get('/tools/agent-stats', cookies={'sofa_agent_stats': self.token},
                                         follow_redirects=False).status_code, 303)

    def test_proxy_rejects_forged_unsigned_session_and_forwards_only_safe_parameters(self):
        calls = []

        async def backend(token, *, params):
            calls.append((token, params))
            return httpx.Response(200, json={'account_linked': True})

        with patch.object(report_route.api_client, 'agent_stats_request', backend):
            self.assertEqual(self.client.get('/api/reporting/agent-stats').status_code, 401)
            response = self.client.get('/api/reporting/agent-stats?period=month&anchor=2026-09-20&user_id=999',
                                       cookies={'sofa_agent_stats': self.token}, headers={'X-User-Id': '999'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(calls, [(self.token, [('period', 'month'), ('anchor', '2026-09-20')])])
            self.context = authz(99)
            self.assertEqual(self.client.get('/api/reporting/agent-stats',
                                             cookies={'sofa_agent_stats': self.token}).status_code, 401)
            self.assertEqual(len(calls), 1)

    def test_login_issues_and_logout_clears_report_cookie(self):
        async def login(*args):
            return {'user_id': 42, 'pnr': '42', 'primary_role': {'role_id': 1}, 'secondary_roles': []}
        async def build(*args):
            return {'user_id': 42, 'pnr': '42', 'primary_role': {'role_id': 1}, 'secondary_roles': []}
        with patch('app.routes.pages.api_client.login_user', login), \
             patch('app.routes.pages._build_session_user_from_login', build):
            response = self.client.post('/login', data={'pnr': '42', 'password': 'test'},
                                        follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIn('sofa_agent_stats=', response.headers['set-cookie'])
        self.assertIn('httponly', response.headers['set-cookie'].lower())
        logout = self.client.get('/logout', follow_redirects=False)
        self.assertIn('sofa_agent_stats=', logout.headers['set-cookie'])
