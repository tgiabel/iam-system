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
     "email": "a@example.org", "primary_role": {"role_id": 5, "name": "Agent", "role_type": "PRIMARY"}},
    {"user_id": 2, "first_name": "Anna", "last_name": "Müller", "is_active": False, "pnr": "4002",
     "primary_role": {"role_id": 8, "name": "IT"}},
]
# Wie `/access/users/?is_active=false`: alle Felder, die die SD-API je User liefert.
FULL_USERS = [
    {"user_id": 1, "pnr": "4001", "racf": "MUE1234", "xde": None, "first_name": "Anna", "last_name": "Müller",
     "email": "a@example.org", "birth_date": "1990-01-01", "telephone": "0711", "weekly_hours": 40,
     "is_active": True, "entry_date": "2020-01-01", "exit_date": "2026-11-29", "has_sofa_access": True,
     "primary_role": {"role_id": 5, "name": "Agent", "role_type": "PRIMARY", "role_status": "ACTIVE"},
     "secondary_roles": [{"role_id": 31, "name": "Chat", "role_type": "SKILL", "role_status": "ACTIVE",
                          "assignment_status": "active"}],
     "derived_statuses": [{"code": "offboarding_planned", "label": "Offboarding geplant", "severity": "warning",
                           "is_overdue": False, "reference_date": "2026-11-29T00:00:00", "process_id": 77,
                           "process_type": "offboarding", "started_at": "2026-11-01T08:00:00", "role_id": None,
                           "role_name": None, "source_role_name": None, "target_role_name": None,
                           "event_id": 5, "last_error": None}]},
    {"user_id": 2, "pnr": "4002", "racf": None, "xde": "XDE1", "first_name": "Ben", "last_name": "Wolf",
     "email": None, "is_active": False, "entry_date": "2019-01-01", "exit_date": "2024-06-30",
     "primary_role": {"role_id": 8, "name": "IT", "role_type": "PRIMARY"}, "secondary_roles": [],
     "derived_statuses": [{"code": "user_inactive", "label": "Inaktiv", "severity": "low",
                           "is_overdue": False, "reference_date": None}]},
]
ALL_ROLES = ROLES + [{"role_id": 31, "name": "Chat", "role_type": "SKILL", "role_status": "ACTIVE",
                      "resources": [], "resource_items": [], "assigned_to": ["Anna Müller"]},
                     {"role_id": 40, "name": "Arbeitsgruppe Alt", "role_type": "SECONDARY",
                      "role_status": "INACTIVE", "resources": [], "resource_items": [], "assigned_to": []}]
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

    def test_users_shape(self):
        sign_in(self, self.client, "SOFA-PAGE-USER")
        self.stubs["list_users"].return_value = FULL_USERS
        self.stubs["get_role_overview"].return_value = ALL_ROLES
        response = self.client.get("/api/views/users")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(set(data), {"mock", "users", "roles"})
        self.assertEqual(data["users"][0], {
            "user_id": 1, "pnr": "4001", "racf": "MUE1234", "xde": None, "first_name": "Anna", "last_name": "Müller",
            "is_active": True, "entry_date": "2020-01-01", "exit_date": "2026-11-29",
            "primary_role": {"role_id": 5, "name": "Agent"},
            "secondary_roles": [{"role_id": 31, "name": "Chat", "role_type": "SKILL"}],
            "derived_statuses": [{"process_type": "offboarding", "label": "Offboarding geplant", "is_overdue": False,
                                  "reference_date": "2026-11-29T00:00:00", "role_name": None,
                                  "source_role_name": None, "target_role_name": None}],
        })
        # Der Inaktiv-Eintrag ist kein Prozess und entfällt.
        self.assertEqual(data["users"][1]["derived_statuses"], [])
        self.assertFalse(data["users"][1]["is_active"])
        # Rollen nur mit ID, Name, Typ und Status, auch die inaktiven.
        self.assertEqual(data["roles"][-1], {"role_id": 40, "name": "Arbeitsgruppe Alt", "role_type": "SECONDARY",
                                             "role_status": "INACTIVE"})
        self.assertEqual({tuple(role) for role in data["roles"]}, {("role_id", "name", "role_type", "role_status")})

    def test_users_come_from_one_call(self):
        sign_in(self, self.client, "SOFA-PAGE-USER")
        self.assertEqual(self.client.get("/api/views/users").status_code, 200)
        # is_active=false liefert alle User, aktive und inaktive; "Inaktive" filtert nur im Browser.
        self.stubs["list_users"].assert_awaited_once_with(is_active=False)
        self.stubs["get_role_overview"].assert_awaited_once_with()

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
        self.assertEqual(self.client.get("/api/views/users").status_code, 403)
        self.assertEqual(self.client.get("/api/views/systems").status_code, 200)

        client = TestClient(app, base_url="https://testserver")
        sign_in(self, client, "SOFA-PAGE-USER")
        # Die Rollen fuer die Facetten brauchen kein SOFA-PAGE-ROLE.
        self.assertEqual(client.get("/api/views/users").status_code, 200)
        self.assertEqual(client.get("/api/views/roles").status_code, 403)

        client = TestClient(app, base_url="https://testserver")
        sign_in(self, client, "SOFA-PAGE-ROLE")
        self.assertEqual(client.get("/api/views/systems").status_code, 403)
        # Die Userliste braucht hier kein SOFA-PAGE-USER.
        self.assertEqual(client.get("/api/views/roles").status_code, 200)

    def test_mock_only_in_development(self):
        sign_in(self, self.client, "SOFA-PAGE-USER", "SOFA-PAGE-ROLE", "SOFA-PAGE-SYS")
        paths = ("/api/views/users?mock=busy", "/api/views/roles?mock=busy", "/api/views/systems?mock=busy")
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            for path in paths:
                self.assertEqual(self.client.get(path).json()["mock"], "busy", path)
        self.stubs["list_users"].assert_not_awaited()
        self.stubs["get_role_overview"].assert_not_awaited()
        self.stubs["get_system_overview"].assert_not_awaited()
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            for path in paths:
                self.assertIsNone(self.client.get(path).json()["mock"], path)
        self.stubs["list_users"].assert_awaited()
        self.stubs["get_role_overview"].assert_awaited()

    def test_mock_users_are_cut_like_live_users(self):
        sign_in(self, self.client, "SOFA-PAGE-USER")
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            data = self.client.get("/api/views/users?mock=normal").json()
        users = data["users"]
        self.assertEqual((sum(user["is_active"] for user in users), sum(not user["is_active"] for user in users)), (97, 21))
        # Der Inaktiv-Eintrag des Mocks faellt wie bei der SD-API weg.
        self.assertTrue(all(status["process_type"] for user in users for status in user["derived_statuses"]))
        self.assertFalse(any(user["derived_statuses"] for user in users if not user["is_active"]))
        self.assertTrue(all(role["role_type"] for user in users for role in user["secondary_roles"]))

    def test_mock_has_the_same_form(self):
        sign_in(self, self.client, "SOFA-PAGE-USER", "SOFA-PAGE-ROLE", "SOFA-PAGE-SYS")
        self.stubs["list_users"].return_value = FULL_USERS
        live_users = self.client.get("/api/views/users").json()
        self.stubs["list_users"].return_value = USERS
        live_roles = self.client.get("/api/views/roles").json()
        live_systems = self.client.get("/api/views/systems").json()
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            mock_users = self.client.get("/api/views/users?mock=busy").json()
            mock_roles = self.client.get("/api/views/roles?mock=1").json()
            mock_systems = self.client.get("/api/views/systems?mock=1").json()
        mock_user = next(user for user in mock_users["users"] if user["derived_statuses"] and user["secondary_roles"])
        self.assertEqual(set(live_users["users"][0]), set(mock_user))
        self.assertEqual(set(live_users["users"][0]["derived_statuses"][0]), set(mock_user["derived_statuses"][0]))
        self.assertEqual(set(live_users["users"][0]["secondary_roles"][0]), set(mock_user["secondary_roles"][0]))
        for live, mock in ((live_users, mock_users), (live_roles, mock_roles), (live_systems, mock_systems)):
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
        self.assertEqual(admin_views.users_payload(None, None), {"mock": None, "users": [], "roles": []})
        user = admin_views.users_payload([{"user_id": 1, "derived_statuses": [None, {"code": "x"}]}], [])["users"][0]
        self.assertEqual((user["primary_role"], user["secondary_roles"], user["derived_statuses"]),
                         ({"role_id": None, "name": None}, [], []))
        self.assertEqual(admin_views.roles_payload(None, None, None),
                         {"mock": None, "roles": [], "systems": [], "users": []})
        system = admin_views.systems_payload([{"system_id": 1, "name": "X", "short_name": "X"}], [])["systems"][0]
        self.assertEqual((system["resources"], system["open_tasks"], system["protection_need"]), ([], 0, {}))


if __name__ == "__main__":
    unittest.main()
