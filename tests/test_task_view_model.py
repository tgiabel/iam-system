import os
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TaskViewModelTests(unittest.TestCase):
    def _run_node_checks(self, script):
        # Zeitzone bewusst weit weg von Europe/Berlin: die Sortierung haengt am
        # Berliner Kalendertag, nicht an der Zeitzone des Servers.
        env = dict(os.environ, TZ="America/Los_Angeles")
        result = subprocess.run(
            [os.environ.get("SOFA_NODE_BINARY", "node"), script],
            cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_task_view_model_logic(self):
        self._run_node_checks("tests/task_view_model_checks.js")

    def test_tasks_page_rendering_and_group_modal(self):
        self._run_node_checks("tests/tasks_view_checks.js")


if __name__ == "__main__":
    unittest.main()
