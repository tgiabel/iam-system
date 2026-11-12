import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import release_notes
from app.authz import AuthorizationContext

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import release_notes as rn  # noqa: E402  (scripts/release_notes.py, Kopie aus SD-API)


def authz(user_id=42):
    return AuthorizationContext(
        user_id=user_id,
        pnr="00042",
        primary_role_name="Agent",
        permissions=frozenset(),
        accessible_backlogs=frozenset(),
        has_all_backlog_access=False,
        raw_user={"user_id": user_id, "first_name": "Erika"},
    )


def api_notes(version="3.1.0", date="2026-11-13"):
    return {
        "schema": 1,
        "app": "sd-api",
        "version": version,
        "scopes": {"sofa/tasks": "SOFA · Aufgaben", "ticketing": "Ticket-Eingang"},
        "releases": [
            {
                "version": version, "date": date, "scopes": ["sofa/tasks", "ticketing"], "requires": [],
                "notes": [
                    {"scope": "sofa/tasks", "text": "API-Aufgaben schneller."},
                    {"scope": "ticketing", "text": "Tickets kommen sofort an."},
                ],
                "changes": [],
            },
        ],
    }


def reset_caches():
    release_notes._own_cache.update(mtime=None, notes=None)
    release_notes._api_cache.update(at=0.0, notes=None)


class NotesFileTests(unittest.TestCase):
    def setUp(self):
        with open(ROOT / "app" / "release_notes.json", encoding="utf-8") as handle:
            self.document = json.load(handle)

    def test_notes_file_is_valid_for_the_shared_tool(self):
        self.assertEqual(rn.document_problems(self.document), [])
        self.assertEqual(self.document["app"], "sofa")
        self.assertEqual(self.document["minor_if_added"], [])

    def test_backfill_spans_from_first_stand_to_the_session_release(self):
        versions = [release["version"] for release in self.document["releases"]]
        self.assertEqual(versions[-5:], ["1.5.0", "1.4.0", "1.3.0", "1.2.0", "1.1.3"])
        oldest = self.document["releases"][-1]["changes"]
        self.assertEqual(oldest[-1]["version"], "1.0.0")

    def test_scopes_mirror_the_sofa_scopes_of_sd_api(self):
        for scope in ("tasks", "workspace", "login", "ops", "internal"):
            self.assertIn(scope, self.document["scopes"])
        self.assertFalse([scope for scope in self.document["scopes"] if scope.startswith("sofa/")])


class ModuleTests(unittest.TestCase):
    def setUp(self):
        reset_caches()
        self.addCleanup(reset_caches)

    def test_own_notes_omit_tool_configuration(self):
        notes = release_notes.load_own()
        self.assertEqual(notes["app"], "sofa")
        self.assertNotIn("trailers_required_after", notes)
        self.assertNotIn("minor_if_added", notes)
        self.assertEqual(release_notes.current_version(), notes["releases"][0]["version"])

    def test_unreadable_notes_do_not_break_sofa(self):
        with tempfile.TemporaryDirectory() as directory:
            broken = Path(directory) / "release_notes.json"
            broken.write_text("{", encoding="utf-8")
            with patch.object(release_notes, "NOTES_PATH", broken), \
                    self.assertLogs(release_notes.logger, "ERROR"):
                self.assertEqual(release_notes.current_version(), "unbekannt")

    def test_changed_file_is_read_again(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "release_notes.json"
            path.write_text(json.dumps({"app": "sofa", "releases": [{"version": "1.0.0"}]}), encoding="utf-8")
            with patch.object(release_notes, "NOTES_PATH", path):
                self.assertEqual(release_notes.current_version(), "1.0.0")
                path.write_text(json.dumps({"app": "sofa", "releases": [{"version": "1.0.1"}]}), encoding="utf-8")
                stat = path.stat()
                import os
                os.utime(path, (stat.st_atime, stat.st_mtime + 5))
                self.assertEqual(release_notes.current_version(), "1.0.1")

    def test_requires_warns_only_for_a_known_older_version(self):
        requires = ["sd-api >= 3.1.0"]
        self.assertEqual(release_notes.unmet_requires(requires, {"sd-api": "3.0.9"}), requires)
        self.assertEqual(release_notes.unmet_requires(requires, {"sd-api": "3.1.0"}), [])
        self.assertEqual(release_notes.unmet_requires(requires, {"sd-api": "3.10.0"}), [])
        self.assertEqual(release_notes.unmet_requires(requires, {"sd-api": None}), [])
        self.assertEqual(release_notes.unmet_requires(requires, {}), [])

    def test_page_merges_both_apps_newest_first_with_sofa_scope_labels(self):
        own = release_notes.load_own()
        page = release_notes.build_page(own, api_notes())
        first = page["entries"][0]
        self.assertEqual((first["app"], first["version"]), ("sd-api", "3.1.0"))
        self.assertEqual([note["scope"] for note in first["notes"]], ["Aufgaben", "Ticket-Eingang"])
        self.assertEqual({entry["app"] for entry in page["entries"]}, {"sofa", "sd-api"})
        self.assertEqual(release_notes.build_page(own, api_notes(), "sd-api")["app_filter"], "sd-api")
        self.assertEqual({e["app"] for e in release_notes.build_page(own, api_notes(), "sofa")["entries"]}, {"sofa"})
        self.assertIsNone(release_notes.build_page(own, None, "bogus")["app_filter"])

    def test_unmet_requires_mark_only_the_running_entry(self):
        own = {"app": "sofa", "scopes": {}, "releases": [
            {"version": "1.6.0", "date": "2026-11-20", "requires": ["sd-api >= 3.1.0"], "notes": []},
            {"version": "1.5.0", "date": "2026-11-12", "requires": ["sd-api >= 9.0.0"], "notes": []},
        ]}
        entries = release_notes.build_page(own, api_notes("3.0.0"))["entries"]
        unmet = {entry["version"]: entry["unmet"] for entry in entries if entry["app"] == "sofa"}
        self.assertEqual(unmet, {"1.6.0": ["sd-api >= 3.1.0"], "1.5.0": []})

    def test_api_notes_are_cached_and_failures_are_not(self):
        fetch = AsyncMock(side_effect=[Exception("404"), api_notes(), api_notes("9.9.9")])
        with patch.object(release_notes.api_client, "get_release_notes", fetch), \
                self.assertLogs(release_notes.logger, "WARNING"):
            self.assertIsNone(asyncio.run(release_notes.load_api()))
            self.assertEqual(asyncio.run(release_notes.load_api())["version"], "3.1.0")
            self.assertEqual(asyncio.run(release_notes.load_api())["version"], "3.1.0")
        self.assertEqual(fetch.await_count, 2)

    def test_client_reads_meta_releases_with_service_key(self):
        seen = {}

        def handler(request):
            seen["url"] = str(request.url)
            seen["key"] = request.headers.get("X-SOFA-Service-Key")
            return httpx.Response(200, json=api_notes())

        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def client_factory(*args, **kwargs):
            return real_client(*args, transport=transport, **kwargs)

        from app import api_client as module
        with patch.object(module.httpx, "AsyncClient", client_factory), \
                patch.object(module, "service_key", lambda: "K" * 43):
            result = asyncio.run(module.APIClient().get_release_notes())
        self.assertEqual(result["app"], "sd-api")
        self.assertTrue(seen["url"].endswith("/meta/releases"))
        self.assertEqual(seen["key"], "K" * 43)


class PageTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.authz import build_authorization_context
        from app.main import app

        reset_caches()
        self.addCleanup(reset_caches)
        app.dependency_overrides[build_authorization_context] = lambda: authz()
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def _fetch(self, result):
        mock = AsyncMock(side_effect=result) if isinstance(result, Exception) else AsyncMock(return_value=result)
        return patch.object(release_notes.api_client, "get_release_notes", mock)

    def test_page_shows_both_apps_for_any_signed_in_user(self):
        with self._fetch(api_notes()):
            response = self.client.get("/releases")
        self.assertEqual(response.status_code, 200)
        text = response.text
        self.assertIn("/static/css/releases.css", text)
        self.assertIn('data-release="sd-api-3.1.0"', text)
        self.assertIn('data-release="sofa-1.5.0"', text)
        self.assertIn("SD-API 3.1.0", text)
        self.assertIn("Tickets kommen sofort an.", text)
        self.assertIn("12.11.2026", text)
        self.assertIn("<details", text)

    def test_page_stays_up_without_sd_api_notes(self):
        with self._fetch(Exception("404")), self.assertLogs(release_notes.logger, "WARNING"):
            response = self.client.get("/releases?app=sd-api")
        self.assertEqual(response.status_code, 200)
        self.assertIn("SD-API nicht erreichbar", response.text)
        self.assertIn("Keine Einträge", response.text)

    def test_profile_menu_links_the_page(self):
        with self._fetch(api_notes()):
            text = self.client.get("/releases").text
        self.assertIn('href="/releases" role="menuitem"', text)

    def test_page_requires_a_session(self):
        from app.main import app
        app.dependency_overrides.clear()
        response = self.client.get("/releases", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertTrue(response.headers["location"].startswith("/login"))

    def test_own_notes_as_json_and_version_in_health(self):
        data = self.client.get("/api/meta/releases").json()
        self.assertEqual(data["app"], "sofa")
        self.assertEqual(data["version"], data["releases"][0]["version"])
        self.assertIn("release_sha", data)
        self.assertNotIn("trailers_required_after", data)
        self.assertEqual(self.client.get("/health").json()["version"], data["version"])


if __name__ == "__main__":
    unittest.main()
