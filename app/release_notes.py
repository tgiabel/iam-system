"""Release Notes von SOFA und SD-API (docs/release-notes.md).

Quelle der eigenen Notes ist `app/release_notes.json`; der oberste Eintrag ist die
ausgelieferte Version. Die SD-API-Notes kommen ueber `GET /meta/releases` mit der
Sitzung des Nutzers und werden kurz zwischengespeichert, weil sie fuer alle gleich sind.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

from app.api_client import api_client

logger = logging.getLogger("uvicorn.error")

NOTES_PATH = Path(__file__).with_name("release_notes.json")
PUBLIC_KEYS = ("schema", "app", "scopes", "releases")
API_CACHE_SECONDS = 300
APP_LABELS = {"sofa": "SOFA", "sd-api": "SD-API"}
_REQUIRES = re.compile(r"^([a-z0-9-]+) >= (\d+)\.(\d+)\.(\d+)$")

_own_cache: dict = {"mtime": None, "notes": None}
_api_cache: dict = {"at": 0.0, "notes": None}


def load_own() -> dict:
    """Eigene Notes ohne Werkzeug-Felder. Liest neu, sobald sich die Datei aendert (Dev-Mount)."""
    try:
        mtime = NOTES_PATH.stat().st_mtime
        if _own_cache["mtime"] != mtime:
            with NOTES_PATH.open(encoding="utf-8") as handle:
                document = json.load(handle)
            _own_cache.update(mtime=mtime, notes={key: document.get(key) for key in PUBLIC_KEYS})
        return _own_cache["notes"]
    except (OSError, ValueError):
        # Defekte Notes duerfen SOFA nicht lahmlegen; `make image` prueft sie vorher.
        logger.exception("Release Notes nicht lesbar: %s", NOTES_PATH)
        return {"schema": None, "app": "sofa", "scopes": {}, "releases": []}


def version_of(notes: dict | None) -> str | None:
    releases = (notes or {}).get("releases") or []
    return releases[0].get("version") if releases else None


def current_version() -> str:
    return version_of(load_own()) or "unbekannt"


async def load_api() -> dict | None:
    """SD-API-Notes oder None, solange die Route fehlt oder die API nicht antwortet."""
    now = time.monotonic()
    if _api_cache["notes"] is not None and now - _api_cache["at"] < API_CACHE_SECONDS:
        return _api_cache["notes"]
    try:
        notes = await api_client.get_release_notes()
    except Exception as exc:  # 404 vor dem SD-API-Deploy, Netz, Sitzung
        logger.warning("SD-API-Release-Notes nicht verfuegbar: %s", exc)
        return None
    if not isinstance(notes, dict) or not isinstance(notes.get("releases"), list):
        return None
    _api_cache.update(at=now, notes=notes)
    return notes


def _parse_version(text: str | None) -> tuple[int, int, int] | None:
    parts = (text or "").split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    return tuple(int(part) for part in parts)  # type: ignore[return-value]


def unmet_requires(requires: list[str], running: dict[str, str | None]) -> list[str]:
    """Anforderungen, die eine laufende App nachweislich nicht erfuellt. Unbekannt warnt nicht."""
    unmet = []
    for value in requires or []:
        match = _REQUIRES.match(value)
        if not match:
            continue
        actual = _parse_version(running.get(match.group(1)))
        needed = tuple(int(part) for part in match.groups()[1:])
        if actual is not None and actual < needed:
            unmet.append(value)
    return unmet


def _scope_label(scope: str, own_scopes: dict, app_scopes: dict) -> str:
    # SD-API nennt SOFA-Bereiche `sofa/<bereich>`; SOFA fuehrt dieselben Bereiche ohne Praefix.
    if scope.startswith("sofa/") and scope[5:] in own_scopes:
        return own_scopes[scope[5:]]
    return app_scopes.get(scope) or own_scopes.get(scope) or scope


def build_page(own: dict, api: dict | None, app_filter: str | None = None) -> dict:
    """Eintraege beider Apps, neueste zuerst; bei gleichem Datum SOFA vor SD-API."""
    own_scopes = own.get("scopes") or {}
    running = {"sofa": version_of(own), "sd-api": version_of(api)}
    entries = []
    for notes in (own, api):
        if not notes:
            continue
        app = notes.get("app") or "?"
        app_scopes = notes.get("scopes") or {}
        for index, release in enumerate(notes.get("releases") or []):
            entries.append({
                "app": app,
                "app_label": APP_LABELS.get(app, app),
                "version": release.get("version"),
                "date": release.get("date") or "",
                "current": index == 0,
                "notes": [
                    {"scope": _scope_label(note.get("scope", ""), own_scopes, app_scopes), "text": note.get("text", "")}
                    for note in release.get("notes") or []
                ],
                "changes": release.get("changes") or [],
                "unmet": unmet_requires(release.get("requires") or [], running) if index == 0 else [],
            })
    order = {"sofa": 0, "sd-api": 1}
    entries.sort(key=lambda entry: (entry["date"], -order.get(entry["app"], 2)), reverse=True)
    if app_filter in APP_LABELS:
        entries = [entry for entry in entries if entry["app"] == app_filter]
    return {
        "entries": entries,
        "versions": [
            {"app": "sofa", "label": "SOFA", "version": running["sofa"]},
            {"app": "sd-api", "label": "SD-API", "version": running["sd-api"]},
        ],
        "app_filter": app_filter if app_filter in APP_LABELS else None,
    }
