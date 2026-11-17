import os
import unittest
from collections import Counter
from datetime import date
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import admin_lists_mock
from app.main import app
from session_helpers import sign_in

TODAY = date(2026, 11, 17)
PERMS = ("SOFA-PAGE-USER", "SOFA-PAGE-ROLE", "SOFA-PAGE-SYS")


class AdminListsMockTest(unittest.TestCase):
    def test_amounts_follow_prod(self):
        data = admin_lists_mock.mock_lists("normal", TODAY)
        self.assertEqual(len(data["systems"]), 23)
        self.assertEqual(sum(len(system["resource_names"]) for system in data["systems"]), 153)
        self.assertEqual(max(len(system["resource_names"]) for system in data["systems"]), 44)
        backlogs = {item["technical_identifier"] for item in data["backlogs"]}
        self.assertTrue(all(system["default_backlog_identifier"] in backlogs for system in data["systems"]))
        active = Counter(role["role_type"] for role in data["roles"] if role["role_status"] == "ACTIVE")
        self.assertEqual(active, {"PRIMARY": 11, "SECONDARY": 12, "SKILL": 16, "TEMPLATE": 3})
        self.assertEqual(sum(user["is_active"] for user in data["users"]), 97)

    def test_inheritance_only_between_functions(self):
        roles = admin_lists_mock.mock_lists("normal", TODAY)["roles"]
        for role in roles:
            if role["role_type"] in ("SECONDARY", "SKILL"):
                self.assertIsNone(role["parent_role_name"])

    def test_one_lifecycle_process_per_user(self):
        for scenario in admin_lists_mock.SCENARIOS:
            for user in admin_lists_mock.mock_lists(scenario, TODAY)["users"]:
                lifecycle = [s for s in user["derived_statuses"] if s["process_type"] in ("onboarding", "offboarding", "change")]
                self.assertLessEqual(len(lifecycle), 1)

    def test_deterministic(self):
        self.assertEqual(admin_lists_mock.mock_lists("busy", TODAY), admin_lists_mock.mock_lists("busy", TODAY))


class AdminListsRouteTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")
        sign_in(self, self.client, *PERMS)

    def test_mock_draft_only_in_development(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            response = self.client.get("/users?mock=1")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('id="list-data"', response.text)

    def test_mock_draft_users_page(self):
        # Bis Session 2 bringt nur noch die Userverwaltung ihre Mock-Daten im Template mit.
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            response = self.client.get("/users?mock=busy")
        self.assertEqual(response.status_code, 200)
        self.assertIn('id="list-data"', response.text)
        self.assertIn("ui-page-toolbar", response.text)

    def test_resource_items_follow_resources(self):
        data = admin_lists_mock.mock_lists("normal", TODAY)
        systems = {system["system_id"]: system for system in data["systems"]}
        ids = [item["resource_id"] for system in data["systems"] for item in system["resources"]]
        self.assertEqual(len(ids), len(set(ids)))
        for role in data["roles"]:
            self.assertEqual([item["display_name"] for item in role["resource_items"]], role["resources"])
            for item in role["resource_items"]:
                system = systems[item["system_id"]]
                self.assertEqual(item["system_short_name"], system["short_name"])
                self.assertIn(item["resource_id"], [res["resource_id"] for res in system["resources"]])
            parent = next((other for other in data["roles"] if other["role_id"] == role["parent_role_id"]), None)
            if parent:
                # Wirksame Menge: alles der Elternrolle ist enthalten.
                own = {item["resource_id"] for item in role["resource_items"]}
                self.assertTrue({item["resource_id"] for item in parent["resource_items"]} <= own, role["name"])


if __name__ == "__main__":
    unittest.main()
