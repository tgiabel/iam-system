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

# Felder eines TaskContext aus GET /sofa/tasks/overview, die das Board nutzt (SD-API Release 1).
TASK_FIELDS = {
    "task_id", "task_type", "status", "handling_type", "provisioning_requirement",
    "target_user_id", "target_user_name", "resource_id", "resource_type_id", "resource_name",
    "assigned_to_user_id", "assigned_to_user_name", "assigned_at", "completed_at", "created_at",
    "backlog_identifier", "target_date", "process_id", "process_type", "system_id", "system_name", "blocked_by",
    "archived_accounts",
}


def user_cookie(*pages, user_id=42, backlogs=()):
    permissions = {"accessible_pages": [{"identifier": item} for item in pages],
                   "accessible_backlogs": [{"identifier": item} for item in backlogs]}
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

    def board_data(self, html):
        return json.loads(html.split('id="task-board-data">', 1)[1].split("</script>", 1)[0])

    def test_board_loads_its_tasks_and_mock_only_in_development(self):
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            html = self.client.get("/tasks", params={"mock": "busy"}).text
        self.assertIn('id="task-board"', html)
        self.assertNotIn("data-mock", html)
        self.assertNotIn("tasks_board_mock.js", html)
        self.assertIn("tasks_board_data.js", html)
        data = self.board_data(html)
        self.assertEqual(set(data), {"me", "today", "mock"})
        self.assertIsNone(data["mock"])
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            html = self.client.get("/tasks", params={"mock": "busy"}).text
        self.assertIn('data-mock="busy"', html)
        self.assertIn("tasks_board_mock.js", html)
        self.assertEqual(self.board_data(html)["mock"], "busy")

    def test_board_data_is_embedded_safely(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            html = self.client.get("/tasks", params={"mock": "normal"}).text
        data = self.board_data(html)
        self.assertEqual(data["me"], {"user_id": 42, "name": "Erika Test"})
        self.assertTrue(data["tasks"])

    def test_board_needs_page_permission(self):
        self.client.cookies.set("sofa_user", user_cookie())
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            response = self.client.get("/tasks", params={"mock": "normal"}, follow_redirects=False)
        self.assertIn(response.status_code, (302, 303, 307))


class TasksProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.cookies.set("sofa_user", user_cookie("SOFA-PAGE-TODO", backlogs=("IT",)))
        relevant = patch("app.routes.api._get_relevant_task_or_raise", self.relevant)
        relevant.start()
        self.addCleanup(relevant.stop)
        self.calls = []

    async def relevant(self, task_id, authz):
        self.calls.append(("relevant", task_id))
        return {"task_id": task_id}

    def test_overview_passes_completed_since_and_filters_every_list(self):
        async def overview(user_id, completed_since=None):
            self.calls.append(("overview", user_id, completed_since))
            visible, hidden = {"task_id": 1, "backlog_identifier": "IT"}, {"task_id": 2, "backlog_identifier": "HR"}
            lists = ("open_tasks", "blocked_tasks", "user_tasks", "others_in_progress_tasks", "completed_tasks")
            return {**{key: [visible, hidden] for key in lists}, "completed_truncated": True}

        with patch("app.routes.api.api_client.get_task_overview", overview):
            data = self.client.get("/api/tasks/overview", params={"completed_since": "2026-10-01"}).json()
            self.assertEqual(self.client.get("/api/tasks/overview", params={"completed_since": "kaputt"}).status_code, 422)
        self.assertEqual(self.calls, [("overview", 42, "2026-10-01")])
        for key in ("open_tasks", "blocked_tasks", "user_tasks", "others_in_progress_tasks", "completed_tasks"):
            self.assertEqual([task["task_id"] for task in data[key]], [1], key)
        self.assertTrue(data["completed_truncated"])

    def test_release_forwards_a_trimmed_comment(self):
        async def unassign(task_id, user_id, comment=None):
            self.calls.append(("release", task_id, user_id, comment))
            return {"task_id": task_id, "status": "OPEN"}

        with patch("app.routes.api.api_client.unassign_task", unassign):
            self.assertEqual(self.client.delete("/api/tasks/7/assign", params={"comment": "  Übergabe  "}).status_code, 200)
            self.client.delete("/api/tasks/8/assign", params={"comment": "   "})
            self.assertEqual(self.client.delete("/api/tasks/9/assign", params={"comment": "x" * 256}).status_code, 422)
        self.assertEqual([call for call in self.calls if call[0] == "release"],
                         [("release", 7, 42, "Übergabe"), ("release", 8, 42, None)])

    def test_comment_is_checked_and_sent_as_the_signed_in_user(self):
        async def add(task_id, user_id, comment):
            self.calls.append(("comment", task_id, user_id, comment))
            return {"status": "commented", "task_id": task_id}

        with patch("app.routes.api.api_client.add_task_comment", add):
            response = self.client.post("/api/tasks/7/comments", json={"comment": " Rückfrage gestellt ", "user_id": 999})
            self.assertEqual(response.json(), {"status": "commented", "task_id": 7})
            self.assertEqual(self.client.post("/api/tasks/7/comments", json={"comment": "  "}).status_code, 422)
            self.assertEqual(self.client.post("/api/tasks/7/comments", json={"comment": "x" * 256}).status_code, 422)
        self.assertEqual(self.calls, [("relevant", 7), ("comment", 7, 42, "Rückfrage gestellt")])

    def test_client_sends_comment_with_user_header(self):
        from app.api_client import APIClient, SOFA_BASE_URL
        import asyncio
        client = APIClient()
        calls = []

        async def request(method, base_url, path, **kwargs):
            calls.append((method, path, kwargs.get("params"), kwargs.get("payload"), kwargs.get("headers")))
            return {}

        client._request_json = request
        asyncio.run(client.add_task_comment(7, 42, "Notiz"))
        asyncio.run(client.unassign_task(7, 42, "Übergabe"))
        asyncio.run(client.unassign_task(7, 42))
        self.assertEqual(calls, [
            ("POST", "/tasks/7/comments", None, {"user_id": 42, "comment": "Notiz"}, {"X-User-Id": "42"}),
            ("DELETE", "/tasks/7/assign", {"user_id": 42, "comment": "Übergabe"}, None, None),
            ("DELETE", "/tasks/7/assign", {"user_id": 42}, None, None),
        ])


if __name__ == "__main__":
    unittest.main()
