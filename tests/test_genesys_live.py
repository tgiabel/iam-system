import asyncio
import json
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
from app.routes import genesys_live


def authz(user_id=42):
    return AuthorizationContext(user_id=user_id, pnr='42', primary_role_name='Agent',
                                permissions=frozenset(), accessible_backlogs=frozenset(),
                                has_all_backlog_access=False, raw_user={'user_id': user_id})


class GenesysLiveTests(unittest.TestCase):
    def setUp(self):
        self.context = authz()
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_client_relies_on_the_session(self):
        client = APIClient()
        calls = []

        async def request(*args, **kwargs):
            calls.append((args, kwargs))
            return 'ok'

        client._request = request
        self.assertEqual(asyncio.run(client.genesys_live_request()), 'ok')
        self.assertEqual(calls[0][0], ('GET', REPORTING_BASE_URL, '/genesys-live'))
        self.assertNotIn('headers', calls[0][1])

    def test_page_opens_for_the_signed_in_user(self):
        self.assertIn('/reports/genesys-live', self.client.get('/workspace').text)
        page = self.client.get('/reports/genesys-live')
        self.assertEqual(page.status_code, 200)
        self.assertIn('Genesys Cloud Live', page.text)
        self.assertNotIn('preview-switch', page.text)

    def test_proxy_ignores_browser_identity_and_disables_cache(self):
        calls = []
        sample = json.loads((Path(__file__).parent / 'fixtures' / 'genesys_live.sample.json').read_text())

        async def backend():
            calls.append(1)
            return httpx.Response(200, json=sample)

        with patch.object(genesys_live.api_client, 'genesys_live_request', backend):
            response = self.client.get('/api/reporting/genesys-live?user_id=999', headers={'X-User-Id': '999'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.json()['total']['queue_count'], 24)
            app.dependency_overrides.clear()
            missing = self.client.get('/api/reporting/genesys-live')
            self.assertEqual(missing.status_code, 401)
            self.assertEqual(missing.headers['cache-control'], 'no-store')
        self.assertEqual(calls, [1])

    def test_proxy_preserves_backend_503_and_handles_transport_failure(self):
        async def unavailable():
            raise httpx.HTTPStatusError('unavailable', request=httpx.Request('GET', 'http://example.test'),
                                        response=httpx.Response(503, json={'detail': 'genesys_unavailable'}))

        with patch.object(genesys_live.api_client, 'genesys_live_request', unavailable):
            response = self.client.get('/api/reporting/genesys-live')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.headers['cache-control'], 'no-store')

        async def broken():
            raise RuntimeError('connection')

        with patch.object(genesys_live.api_client, 'genesys_live_request', broken):
            response = self.client.get('/api/reporting/genesys-live')
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_browser_logic(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), 'tests/genesys_live_checks.js'],
                                cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
