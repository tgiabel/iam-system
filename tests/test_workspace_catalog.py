import base64
import os
import re
import unittest
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
                self.assertTrue(item.title and item.kicker and item.copy and item.icon)
                self.assertTrue(item.chips)
                self.assertTrue(item.href.startswith('/tools/'))

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
        html = self.client.get('/tools').text
        return re.findall(r'<article class="overview-card.*?</article>', html, re.S)

    def test_all_cards_share_the_same_parts(self):
        cards = self.cards()
        self.assertEqual(len(cards), len(CATALOG))
        for card in cards:
            with self.subTest(card=card[:120]):
                for part in ('overview-card-icon', 'overview-card-kicker', 'overview-card-title',
                             'overview-card-copy', 'overview-card-cta', 'overview-card-popout',
                             'overview-card-main-link', 'data-workspace-id='):
                    self.assertIn(part, card)
                self.assertNotIn('<a href', card.split('overview-card-footer')[1])

    def test_card_is_not_wrapped_in_a_link(self):
        self.assertNotIn('overview-card-link', self.client.get('/tools').text)

    def test_both_lists_are_shown_without_tabs(self):
        html = self.client.get('/tools').text
        self.assertNotIn('overview-tab', html)
        self.assertIn('workspace-tools-title', html)
        self.assertIn('workspace-reports-title', html)

    def test_list_without_entries_is_omitted(self):
        self.context = authz('SOFA-RPRT-LL')
        html = self.client.get('/tools').text
        self.assertNotIn('workspace-tools-title', html)
        self.assertIn('workspace-reports-title', html)


if __name__ == '__main__':
    unittest.main()
