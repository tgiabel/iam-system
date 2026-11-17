import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import admin_views
from app.api_client import api_client
from app.main import app
from session_helpers import api_error, sign_in

ROLES = [{
    "role_id": 5, "name": "Agent", "role_type": "PRIMARY", "role_status": "ACTIVE", "description": "intern",
    "parent_role_id": 2, "parent_role_name": "Servodata Mitarbeiter", "resources": ["Genesys Konto"],
    "resource_items": [{"resource_id": 71, "display_name": "Genesys Konto", "system_id": 9, "system_short_name": "GC"}],
    "assigned_to": ["Anna Müller"],
}]
SYSTEMS = [{
    "system_id": 9, "name": "Genesys Cloud", "short_name": "GC", "status": "ACTIVE",
    "default_backlog_identifier": "SOFA-BKLG-IT", "default_handling_type": "INTERNAL",
    "protection_need": {"confidentiality": "LOW", "integrity": "LOW", "availability": "LOW", "overall": "LOW"},
    "resource_names": ["Genesys Konto"],
    "resources": [{"resource_id": 71, "display_name": "Genesys Konto", "type_name": "Konto", "handling": "BOT"}],
    "user_count": 80, "open_tasks": 9, "blocked_tasks": 3, "overdue_tasks": 1,
}]
USERS = [
    {"user_id": 1, "first_name": "Anna", "last_name": "Müller", "is_active": True, "pnr": "4001",
     "email": "a@example.org", "primary_role": {"role_id": 5, "name": "Agent"}},
    {"user_id": 2, "first_name": "Anna", "last_name": "Müller", "is_active": False, "pnr": "4002",
     "primary_role": {"role_id": 8, "name": "IT"}},
]
BACKLOGS = [{"technical_identifier": "SOFA-BKLG-ALL", "display_name": "Alle Backlogs", "resource_id": 1},
            {"technical_identifier": "SOFA-BKLG-IT", "display_name": "IT-Backlog", "resource_id": 2}]


class AdminViewsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")
        self.stubs = {}
        for name, value in (("get_role_overview", ROLES), ("get_system_overview", SYSTEMS),
                            ("list_users", USERS), ("get_backlogs", BACKLOGS)):
            patcher = patch.object(api_client, name, AsyncMock(return_value=value))
            self.stubs[name] = patcher.start()
            self.addCleanup(patcher.stop)

    def test_roles_shape(self):
        sign_in(self, self.client, "SOFA-PAGE-ROLE")
        response = self.client.get("/api/views/roles")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(set(data), {"mock", "roles", "systems", "users"})
        self.assertEqual(data["roles"], [{
            "role_id": 5, "name": "Agent", "role_type": "PRIMARY", "role_status": "ACTIVE", "parent_role_id": 2,
            "resource_items": [{"resource_id": 71, "display_name": "Genesys Konto", "system_id": 9}],
            "assigned_to": ["Anna Müller"],
        }])
        self.assertEqual(data["systems"], [{"system_id": 9, "name": "Genesys Cloud", "short_name": "GC"}])
        # Nur Name und Funktion; bei Namensgleichheit der aktive User.
        self.assertEqual(data["users"], [{"first_name": "Anna", "last_name": "Müller", "primary_role": {"name": "Agent"}}])
        self.stubs["list_users"].assert_awaited_once_with(is_active=False)

    def test_systems_shape(self):
        sign_in(self, self.client, "SOFA-PAGE-SYS", backlogs=("SOFA-BKLG-ALL",))
        data = self.client.get("/api/views/systems").json()
        self.assertEqual(set(data), {"mock", "systems", "backlogs"})
        self.assertEqual(data["systems"], [{
            "system_id": 9, "name": "Genesys Cloud", "short_name": "GC", "default_backlog_identifier": "SOFA-BKLG-IT",
            "protection_need": SYSTEMS[0]["protection_need"],
            "resources": [{"resource_id": 71, "display_name": "Genesys Konto", "type_name": "Konto", "handling": "BOT"}],
            "user_count": 80, "open_tasks": 9, "blocked_tasks": 3, "overdue_tasks": 1,
        }])
        self.assertEqual(data["backlogs"], [{"technical_identifier": "SOFA-BKLG-IT", "display_name": "IT-Backlog"}])

    def test_each_view_checks_only_its_page(self):
        sign_in(self, self.client, "SOFA-PAGE-SYS")
        self.assertEqual(self.client.get("/api/views/roles").status_code, 403)
        self.assertEqual(self.client.get("/api/views/systems").status_code, 200)

        client = TestClient(app, base_url="https://testserver")
        sign_in(self, client, "SOFA-PAGE-ROLE")
        self.assertEqual(client.get("/api/views/systems").status_code, 403)
        # Die Userliste braucht hier kein SOFA-PAGE-USER.
        self.assertEqual(client.get("/api/views/roles").status_code, 200)

    def test_mock_only_in_development(self):
        sign_in(self, self.client, "SOFA-PAGE-ROLE", "SOFA-PAGE-SYS")
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            for path in ("/api/views/roles?mock=busy", "/api/views/systems?mock=busy"):
                self.assertEqual(self.client.get(path).json()["mock"], "busy", path)
        self.stubs["get_role_overview"].assert_not_awaited()
        self.stubs["get_system_overview"].assert_not_awaited()
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            self.assertIsNone(self.client.get("/api/views/roles?mock=busy").json()["mock"])
            self.assertIsNone(self.client.get("/api/views/systems?mock=busy").json()["mock"])
        self.stubs["get_role_overview"].assert_awaited()

    def test_mock_has_the_same_form(self):
        sign_in(self, self.client, "SOFA-PAGE-ROLE", "SOFA-PAGE-SYS")
        live_roles = self.client.get("/api/views/roles").json()
        live_systems = self.client.get("/api/views/systems").json()
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            mock_roles = self.client.get("/api/views/roles?mock=1").json()
            mock_systems = self.client.get("/api/views/systems?mock=1").json()
        for live, mock in ((live_roles, mock_roles), (live_systems, mock_systems)):
            self.assertEqual(set(live), set(mock))
            for key, items in live.items():
                if isinstance(items, list):
                    self.assertEqual(set(items[0]), set(mock[key][0]), key)
        self.assertEqual(set(live_roles["roles"][0]["resource_items"][0]), set(mock_roles["roles"][0]["resource_items"][0]))
        self.assertEqual(set(live_systems["systems"][0]["resources"][0]), set(mock_systems["systems"][0]["resources"][0]))

    def test_task_counts_follow_the_viewer(self):
        cases = (
            # Alle Backlogs: ohne Parameter.
            ((("SOFA-BKLG-ALL",), ("SOFA-PAGE-SYS",)), {}),
            # Sichtbare Backlogs; Aufgaben ohne Backlog nur mit Aufgabenseite.
            ((("SOFA-BKLG-PROD", "SOFA-BKLG-IT"), ("SOFA-PAGE-SYS",)), {"task_backlogs": "SOFA-BKLG-IT,SOFA-BKLG-PROD"}),
            ((("SOFA-BKLG-IT",), ("SOFA-PAGE-SYS", "SOFA-PAGE-TODO")),
             {"task_backlogs": "SOFA-BKLG-IT", "task_unbacklogged": "true"}),
            # Kein Backlog: leerer Parameter heisst "keins", nicht "alle".
            (((), ("SOFA-PAGE-SYS",)), {"task_backlogs": ""}),
            (((), ("SOFA-PAGE-ALL",)), {"task_backlogs": "", "task_unbacklogged": "true"}),
        )
        for (backlogs, perms), expected in cases:
            with self.subTest(backlogs=backlogs, perms=perms):
                client = TestClient(app, base_url="https://testserver")
                sign_in(self, client, *perms, backlogs=backlogs)
                self.stubs["get_system_overview"].reset_mock()
                self.assertEqual(client.get("/api/views/systems").status_code, 200)
                self.stubs["get_system_overview"].assert_awaited_once_with(expected)

    def test_backend_errors_pass_through(self):
        sign_in(self, self.client, "SOFA-PAGE-ROLE")
        self.stubs["get_role_overview"].side_effect = api_error(503, "SD-API nicht bereit")
        response = self.client.get("/api/views/roles")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "SD-API nicht bereit")
        self.stubs["get_role_overview"].side_effect = RuntimeError("http://api:8080/intern")
        response = self.client.get("/api/views/roles")
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("api:8080", response.text)

    def test_payload_tolerates_missing_lists(self):
        self.assertEqual(admin_views.roles_payload(None, None, None),
                         {"mock": None, "roles": [], "systems": [], "users": []})
        system = admin_views.systems_payload([{"system_id": 1, "name": "X", "short_name": "X"}], [])["systems"][0]
        self.assertEqual((system["resources"], system["open_tasks"], system["protection_need"]), ([], 0, {}))


if __name__ == "__main__":
    unittest.main()
