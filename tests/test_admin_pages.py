import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from session_helpers import sign_in

ROOT = Path(__file__).resolve().parents[1]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class AdminPagesTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")
        sign_in(self, self.client, "SOFA-PAGE-USER", "SOFA-PAGE-ROLE", "SOFA-PAGE-SYS")

    def test_pages_render_the_list_templates_without_data(self):
        for path, page, script in (("/users", 'id="users-page"', "admin_users.js"),
                                   ("/roles", 'id="roles-page"', "admin_roles.js"),
                                   ("/systems", 'id="systems-page"', "admin_systems.js")):
            with self.subTest(path=path), patch.dict(os.environ, {"APP_ENV": "production"}):
                response = self.client.get(f"{path}?mock=busy")
                self.assertEqual(response.status_code, 200)
                self.assertIn(page, response.text)
                self.assertIn(f"/static/js/{script}", response.text)
                self.assertNotIn('id="list-data"', response.text)
                # Der Mock gilt nur in der Entwicklung.
                self.assertNotIn("data-mock=", response.text)

    def test_mock_is_passed_to_the_page_in_development(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            self.assertIn('data-mock="busy"', self.client.get("/roles?mock=busy").text)
            self.assertIn('data-mock="normal"', self.client.get("/systems?mock=1").text)
            self.assertIn('data-mock="quiet"', self.client.get("/users?mock=quiet").text)

    def test_user_page_brings_panel_and_dialogs(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            html = self.client.get("/users?user_id=5").text
        for marker in ('id="sidebar-overlay"', 'id="offboard-overlay"', 'id="rehire-overlay"',
                       "/static/js/user_actions.js", "/static/js/sofa_contract.js", "/static/css/user_actions.css"):
            self.assertIn(marker, html)
        # Ohne die Rechte keine Werkzeugleisten-Buttons und keine Panel-Aktionen.
        self.assertNotIn('id="onboard-action-btn"', html)
        self.assertNotIn('id="offboard-action-btn"', html)

        client = TestClient(app, base_url="https://testserver")
        sign_in(self, client, "SOFA-PAGE-USER", "SOFA-FN-ONB", "SOFA-FN-TRNG", "SOFA-FN-OFFB")
        html = client.get("/users").text
        for marker in ('id="onboard-action-btn"', 'id="training-action-btn"', 'id="offboard-action-btn"', 'id="rehire-action-btn"'):
            self.assertIn(marker, html)

    def test_pages_check_their_own_permission(self):
        client = TestClient(app, base_url="https://testserver")
        sign_in(self, client, "SOFA-PAGE-SYS")
        for path in ("/roles", "/users"):
            response = client.get(path, follow_redirects=False)
            self.assertIn(response.status_code, (302, 303, 307), path)

    def test_old_pages_are_gone(self):
        for path in ("app/templates/rollenmanagement.html", "app/static/js/rollenmanagement.js",
                     "app/static/css/rollenmanagement.css", "app/templates/systemverwaltung.html",
                     "app/static/js/systemverwaltung.js", "app/static/css/systemverwaltung.css",
                     "app/templates/userverwaltung.html", "app/static/js/userverwaltung.js",
                     "app/static/css/userverwaltung.css"):
            self.assertFalse((ROOT / path).exists(), path)
        self.assertTrue((ROOT / "app/static/css/page_w_table.css").exists())


class DeepLinkTest(unittest.TestCase):
    """Ziele der Zeilenmenüs und die Vorfilter, die sie auf den Zielseiten auslösen."""

    def test_system_menu_targets(self):
        js = source("app/static/js/admin_systems.js")
        for target in ('detailUrl(system, "?edit=1")', 'detailUrl(system, "?resource=new")',
                       "`/tasks?${new URLSearchParams({ system: system.system_id })}`", "`/roles?${new URLSearchParams("):
            self.assertIn(target, js)
        self.assertNotIn('id: "users"', js, "User anzeigen bleibt ausgeblendet")
        self.assertIn("/api/views/systems", js)

    def test_system_detail_opens_from_parameters(self):
        js = source("app/static/js/systemdetails.js")
        self.assertIn('query.get("edit") === "1") openSystemEdit()', js)
        self.assertIn('query.get("resource") === "new") openPanel("new")', js)

    def test_role_page_prefilter_and_targets(self):
        js = source("app/static/js/admin_roles.js")
        self.assertIn('system: params.get("system") || null', js)
        # Nur eigene Zuordnungen zählen, über die System-ID.
        self.assertIn("ownResources(role).some(item => String(item.system_id) === view.system)", js)
        self.assertIn("`/users?${withMock({ role: roleId })}`", js)
        self.assertIn("`/roles/${encodeURIComponent(roleId)}`", js)
        self.assertIn("/api/views/roles", js)

    def test_role_status_change_sends_the_whole_role(self):
        js = source("app/static/js/admin_roles.js")
        self.assertIn("parent_role_id: current.parent_role_id ?? null", js)
        self.assertIn("description: current.description", js)
        self.assertIn("status\n", js)

    def test_user_page_deep_links(self):
        page = source("app/static/js/admin_users.js")
        actions = source("app/static/js/user_actions.js")
        # ?role=<id> setzt die Rolle nach dem Laden als Filter nach ihrem Typ.
        self.assertIn('let presetRoleId = params.get("role");', page)
        self.assertIn('{ PRIMARY: "primary", SECONDARY: "secondary", SKILL: "skill" }[role?.role_type]', page)
        self.assertIn("applyPresetRole();", page[page.index("function setData"):])
        # ?user_id=<id> öffnet das Panel; das übernimmt user_actions.js beim init.
        self.assertIn("A.init({ reload: load, visibleUsers });", page)
        self.assertIn("const linkedUserId = userIdFromSearch(location.search);", actions)
        self.assertIn("if (linkedUserId !== null) sidebarController.open(linkedUserId);", actions)
        self.assertIn("/api/views/users", page)

    def test_user_page_keeps_list_and_actions_apart(self):
        actions = source("app/static/js/user_actions.js")
        for gone in ("tableController", "filterController", "sofaUserverwaltungFilters", "state.users", "getFilteredUsers"):
            self.assertNotIn(gone, actions)
        # Ein Weg nach jeder erfolgreichen Aktion; refreshCurrentUser nur noch im Hook und im Fehlerfall der Kennung.
        self.assertEqual(actions.count("hooks.reload()"), 1)
        self.assertEqual(actions.count("refreshCurrentUser()"), 3)
        self.assertIn("const baseUsers = hooks.visibleUsers().filter(user => user.is_active);", actions)

    def test_task_page_takes_the_system_parameter(self):
        js = source("app/static/js/tasks_board.js")
        self.assertIn("Model.applyUrlFilters(view, window.location.search)", js)
        self.assertIn('query.delete("system")', js)


class ListPageChecksTest(unittest.TestCase):
    def run_checks(self, script):
        result = subprocess.run([os.environ.get("SOFA_NODE_BINARY", "node"), script],
                                cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_list_page_in_node(self):
        self.run_checks("tests/list_page_checks.js")

    def test_user_actions_in_node(self):
        self.run_checks("tests/user_actions_checks.js")


if __name__ == "__main__":
    unittest.main()
