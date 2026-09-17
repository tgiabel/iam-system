import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_computers import AsyncMock, json_body, run_async
from app.routes.api import api_prefill_doc_template

ROOT = Path(__file__).resolve().parents[1]


class FormArchiveHintTests(unittest.TestCase):
    @patch("app.routes.api.api_client.prefill_doc_template", new_callable=AsyncMock)
    def test_unified_prefill_forwards_archive_metadata_unchanged(self, prefill):
        for doc_type in ("word", "pdf"):
            with self.subTest(doc_type=doc_type):
                upstream = {
                    "template_id": 7, "user_id": 1234, "doc_type": doc_type,
                    "fields": [{"key": "email", "value": "former@example.test",
                        "account_archived": True, "account_archived_at": "2026-09-16T17:38:07+02:00"},
                        {"key": "racf", "value": "current", "account_archived": False,
                         "account_archived_at": None}],
                }
                prefill.reset_mock()
                prefill.return_value = upstream
                response = run_async(api_prefill_doc_template(
                    "7", doc_type, {"user_id": 1234, "initiator_user_id": 999},
                    current_user=SimpleNamespace(user_id=5678),
                ))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json_body(response), upstream)
                prefill.assert_awaited_once_with("7", doc_type,
                    {"user_id": 1234, "initiator_user_id": 5678})

    def test_frontend_archive_hint_workflow(self):
        env = dict(os.environ, TZ="America/Los_Angeles")
        result = subprocess.run(
            [os.environ.get("SOFA_NODE_BINARY", "node"), "tests/form_archive_hints_checks.js"],
            cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
