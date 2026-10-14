import base64
import os
import re
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.authz import AuthorizationContext, build_authorization_context
from app.main import app
from app.workspace_catalog import CATALOG, visible_items

SECRET = base64.b64encode(b'workspace-catalog-test-secret-is-long-enough').decode()


def authz(*permissions, user_id=42):
    return AuthorizationContext(user_id=user_id, pnr='42', primary_role_name='Agent',
                                permissions=frozenset(permissions), accessible_backlogs=frozenset(),
                                has_all_backlog_access=False, raw_user={'user_id': user_id})


def ids(sections):
    return {kind: [item.id for item in items] for kind, items in sections.items()}


class CatalogTests(unittest.TestCase):
    def test_entries_are_complete_and_unique(self):
        self.assertEqual(len({item.id for item in CATALOG}), len(CATALOG))
        for item in CATALOG:
            with self.subTest(item=item.id):
                self.assertIn(item.kind, ('tool', 'report'))
                self.assertTrue(item.title and item.copy and item.icon)
                prefix = '/tools/' if item.kind == 'tool' else '/reports/'
                self.assertTrue(item.href.startswith(prefix))

    def test_every_entry_points_to_a_page_route(self):
        paths = {getattr(route, 'path', None) for route in app.routes}
        for item in CATALOG:
            with self.subTest(item=item.id):
                self.assertIn(item.href, paths)

    def test_visibility_follows_permissions(self):
        self.assertEqual(ids(visible_items(authz(), False)), {'tools': [], 'reports': []})
        self.assertEqual(ids(visible_items(authz(), True))['reports'], ['genesys-live', 'agent-stats'])
        tool = ids(visible_items(authz('SOFA-TOOL-ZK'), False))
        self.assertEqual(tool, {'tools': ['zeitkorrektur'], 'reports': []})
        wildcard = ids(visible_items(authz('SOFA-TOOL-ALL'), False))
        self.assertIn('datex', wildcard['tools'])
        self.assertIn('iks', wildcard['reports'])
        self.assertNotIn('media-blocking', wildcard['tools'])

    def test_admin_sees_demo_tool(self):
        self.assertIn('media-blocking', ids(visible_items(authz('SOFA-PAGE-USER'), False))['tools'])

    def test_presence_permission_shows_both_genesys_reports(self):
        reports = ids(visible_items(authz('SOFA-RPRT-PRSNC'), False))['reports']
        self.assertEqual(reports, ['presence-report', 'token-deletion-report'])


class RenderedCardTests(unittest.TestCase):
    def setUp(self):
        secret = patch.dict(os.environ, {'SOFA_AGENT_STATS_SECRET_B64': SECRET})
        secret.start()
        self.addCleanup(secret.stop)
        self.context = authz('SOFA-TOOL-ALL', 'SOFA-RPRT-ALL', 'SOFA-PAGE-USER')
        app.dependency_overrides[build_authorization_context] = lambda: self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def cards(self):
        html = self.client.get('/workspace').text
        return re.findall(r'<article class="ws-item".*?</article>', html, re.S)

    def test_all_cards_share_the_same_parts(self):
        cards = self.cards()
        self.assertEqual(len(cards), len(CATALOG))
        for card in cards:
            with self.subTest(card=card[:120]):
                for part in ('ws-item-icon', 'ws-item-title', 'ws-item-pin',
                             'ws-item-popout', 'ws-item-link', 'data-workspace-id=', 'title="'):
                    self.assertIn(part, card)
                self.assertEqual(card.count('<a '), 1)

    def test_card_is_not_wrapped_in_a_link(self):
        html = self.client.get('/workspace').text
        self.assertEqual(len(re.findall(r'<a href="/(?:tools|reports)/', html)), len(CATALOG))

    def test_both_lists_are_shown_without_tabs(self):
        html = self.client.get('/workspace').text
        self.assertNotIn('overview-tab', html)
        self.assertIn('workspace-tools-title', html)
        self.assertIn('workspace-reports-title', html)

    def test_list_without_entries_is_omitted(self):
        self.context = authz('SOFA-RPRT-LL')
        html = self.client.get('/workspace').text
        self.assertNotIn('workspace-tools-title', html)
        self.assertIn('workspace-reports-title', html)

    def test_pin_row_has_four_slots_and_user_key(self):
        html = self.client.get('/workspace').text
        self.assertEqual(html.count('data-pin-slot'), 4)
        self.assertIn('data-user-id="42"', html)
        self.assertIn('/static/js/workspace_pins.js', html)

    def test_page_has_a_title(self):
        self.assertIn('<h1 class="ui-section-title workspace-title">Workspace</h1>', self.client.get('/workspace').text)

    def test_descriptions_are_not_shown_as_text(self):
        html = self.client.get('/workspace').text
        for item in CATALOG:
            self.assertNotIn('>' + item.copy + '<', html)

    def test_pin_row_keeps_four_slots_without_one_column(self):
        self.context = authz('SOFA-RPRT-LL')
        self.assertEqual(self.client.get('/workspace').text.count('data-pin-slot'), 4)


class LegacyPathTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def location(self, path):
        response = self.client.get(path, follow_redirects=False)
        self.assertEqual(response.status_code, 307, path)
        return response.headers['location']

    def test_old_overview_path_redirects_to_workspace(self):
        self.assertEqual(self.location('/tools'), '/workspace')

    def test_old_report_paths_redirect_with_query(self):
        for item in CATALOG:
            if item.kind != 'report':
                continue
            with self.subTest(item=item.id):
                old = item.href.replace('/reports/', '/tools/', 1)
                self.assertEqual(self.location(old), item.href)
                self.assertEqual(self.location(old + '?view=widget&date=2026-10-14'),
                                 item.href + '?view=widget&date=2026-10-14')

    def test_old_iks_shortcut_points_to_report(self):
        self.assertEqual(self.location('/iks'), '/reports/iks')


class PinModelTests(unittest.TestCase):
    def test_pin_logic_in_node(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([os.environ.get('SOFA_NODE_BINARY', 'node'), 'tests/workspace_pins_checks.js'],
                                cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
