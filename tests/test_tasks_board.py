import json
import os
import subprocess
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import tasks_board_mock
from app.main import app

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 14, 11, 30)  # Mittwoch
ME = {"user_id": 42, "name": "Erika Test"}

# Felder, die SOFA vom Backend erwartet: TaskView plus die Wunschliste aus docs/tasks-kanban.md.
TASK_FIELDS = {
    "task_id", "task_type", "status", "handling_type", "provisioning_requirement",
    "target_user_id", "target_user_name", "resource_id", "resource_type_id", "resource_name",
    "assigned_to_user_id", "assigned_to_user_name", "assigned_at", "completed_at", "created_at",
    "backlog_identifier", "target_date", "process_id", "process_type", "system_id", "system_name", "blocked_by",
    "archived_accounts",
}


def user_cookie(*pages, user_id=42):
    permissions = {"accessible_pages": [{"identifier": item} for item in pages]}
    return json.dumps({"user_id": user_id, "pnr": "42", "first_name": "Erika", "last_name": "Test",
                       "primary_role": {"name": "Agent"}, "secondary_roles": [], "sofa_permissions": permissions})


class TasksBoardModelTests(unittest.TestCase):
    def test_model_in_node(self):
        env = dict(os.environ, TZ="America/Los_Angeles")
        result = subprocess.run([os.environ.get("SOFA_NODE_BINARY", "node"), "tests/tasks_board_model_checks.js"],
                                cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class TasksBoardMockTests(unittest.TestCase):
    def test_scenario_only_in_development(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            self.assertIsNone(tasks_board_mock.mock_scenario("busy"))
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            self.assertIsNone(tasks_board_mock.mock_scenario(None))
            self.assertIsNone(tasks_board_mock.mock_scenario("0"))
            self.assertEqual(tasks_board_mock.mock_scenario("busy"), "busy")
            self.assertEqual(tasks_board_mock.mock_scenario("1"), "normal")

    def test_deterministic_per_day(self):
        self.assertEqual(tasks_board_mock.mock_board("normal", ME, NOW), tasks_board_mock.mock_board("normal", ME, NOW))

    def test_tasks_have_backend_shape_and_consistent_state(self):
        for scenario in tasks_board_mock.SCENARIOS:
            board = tasks_board_mock.mock_board(scenario, ME, NOW)
            self.assertEqual(board["me"], ME)
            for task in board["tasks"]:
                self.assertEqual(set(task), TASK_FIELDS, scenario)
                status = task["status"]
                self.assertIn(status, {"OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED"})
                if status in ("OPEN", "BLOCKED"):
                    self.assertIsNone(task["assigned_to_user_id"])
                else:
                    self.assertIsNotNone(task["assigned_to_user_id"])
                    self.assertLessEqual(task["assigned_at"], NOW.isoformat())
                if status == "COMPLETED":
                    self.assertLessEqual(task["completed_at"], NOW.isoformat())
                    self.assertGreaterEqual(task["completed_at"][:10], "2026-09-14")
                else:
                    self.assertIsNone(task["completed_at"])

    def test_normal_scenario_fills_every_column(self):
        tasks = tasks_board_mock.mock_board("normal", ME, NOW)["tasks"]
        statuses = {task["status"] for task in tasks}
        self.assertEqual(statuses, {"OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED"})
        in_progress = [task for task in tasks if task["status"] == "IN_PROGRESS"]
        self.assertTrue(any(task["assigned_to_user_id"] == 42 for task in in_progress))
        self.assertTrue(any(task["assigned_to_user_id"] != 42 for task in in_progress))
        self.assertTrue(any(task["provisioning_requirement"] == "DEFERRED" for task in tasks))

    def test_modal_fixtures_have_named_comments_and_consistent_archived_accounts(self):
        board = tasks_board_mock.mock_board("busy", ME, NOW)
        self.assertEqual(set(board["task_details"]), {str(task["task_id"]) for task in board["tasks"]})
        actions = set()
        archive_count = 0
        for task in board["tasks"]:
            detail = board["task_details"][str(task["task_id"])]
            for event in detail["history"]:
                actions.add(event["action"])
                self.assertLessEqual(event["timestamp"], NOW.isoformat())
                if event["comment"]:
                    self.assertTrue(event["user_name"])
                    self.assertIsNotNone(event["user_id"])
            if task.get("archived_accounts"):
                archive_count += 1
                self.assertEqual(set(task["archived_accounts"][0]),
                                 {"user_account_history_id", "account_identifier", "archived_at", "identifier_in_use_by_other"})
                self.assertEqual(task["task_type"], "ASSIGNMENT")
                self.assertEqual(task["resource_type_id"], 1)
        self.assertGreater(archive_count, 0)
        self.assertTrue({"COMMENTED", "RELEASED", "COMPLETED", "BOT_RESPONSE"}.issubset(actions))

    def test_related_revocation_note_matches_model(self):
        source = (ROOT / "app/static/js/tasks_board_model.js").read_text(encoding="utf-8")
        self.assertIn(f'const RELATED_REVOCATION_NOTE = "{tasks_board_mock.RELATED_REVOCATION_NOTE}";', source)
        board = tasks_board_mock.mock_board("busy", ME, NOW)
        comments = [entry["comment"] for detail in board["task_details"].values() for entry in detail["history"]]
        self.assertIn(tasks_board_mock.RELATED_REVOCATION_NOTE, comments)
        self.assertNotIn("completion_context", json.dumps(board))

    def test_blocked_tasks_wait_for_an_open_account(self):
        tasks = tasks_board_mock.mock_board("busy", ME, NOW)["tasks"]
        accounts = {(task["process_id"], task["system_id"]): task for task in tasks if task["resource_type_id"] == 1}
        for task in tasks:
            if task["status"] == "BLOCKED":
                account = accounts[(task["process_id"], task["system_id"])]
                self.assertNotEqual(account["status"], "COMPLETED")
                self.assertEqual(task["blocked_by"], {
                    "task_id": account["task_id"],
                    "resource_name": account["resource_name"],
                    "status": account["status"],
                })
            else:
                self.assertIsNone(task["blocked_by"])


class TasksBoardPageTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.cookies.set("sofa_user", user_cookie("SOFA-PAGE-TODO"))

    def test_board_only_with_mock_in_development(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            html = self.client.get("/tasks", params={"mock": "busy"}).text
            self.assertIn('id="task-board"', html)
            self.assertIn('data-mock="busy"', html)
            self.assertNotIn('id="task-board"', self.client.get("/tasks").text)
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            self.assertNotIn('id="task-board"', self.client.get("/tasks", params={"mock": "busy"}).text)

    def test_board_data_is_embedded_safely(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            html = self.client.get("/tasks", params={"mock": "normal"}).text
        raw = html.split('id="task-board-data">', 1)[1].split("</script>", 1)[0]
        data = json.loads(raw)
        self.assertEqual(data["me"], {"user_id": 42, "name": "Erika Test"})
        self.assertTrue(data["tasks"])

    def test_board_needs_page_permission(self):
        self.client.cookies.set("sofa_user", user_cookie())
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            response = self.client.get("/tasks", params={"mock": "normal"}, follow_redirects=False)
        self.assertIn(response.status_code, (302, 303, 307))


if __name__ == "__main__":
    unittest.main()
