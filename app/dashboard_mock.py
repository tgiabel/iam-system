"""Mock-Daten fuer das Dashboard (nur Entwicklungsinstanz).

Die Formen entsprechen den echten Antworten (`/api/tasks/overview`, `/api/events`,
`/api/reporting/genesys-live`). Felder, die es dort noch nicht gibt, sind mit
"Wunsch" markiert und stehen in docs/dashboard-redesign.md. Alles ist relativ zum
heutigen Tag und je Szenario und Tag deterministisch, damit Design-Iterationen
vergleichbar bleiben.
"""
from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
SCENARIOS = ("normal", "busy", "quiet")
_LIVE_SAMPLE = Path(__file__).parent / "mock_data" / "genesys_live.sample.json"


def normalize_scenario(value: str | None) -> str:
    return value if value in SCENARIOS else "normal"


def berlin_now() -> datetime:
    return datetime.now(BERLIN)


def _rng(scenario: str, today: date, salt: str) -> random.Random:
    return random.Random(f"{scenario}:{today.isoformat()}:{salt}")


# ---------- Tasks ----------

# Verteilung: (ueberfaellig, heute, morgen, spaeter, ohne Datum) je Liste
_TASK_PROFILE = {
    "normal": {"open": (3, 6, 4, 18, 5), "blocked": (1, 1, 1, 3, 0), "mine": 4, "in_progress": 11, "deferred": 14},
    "busy": {"open": (8, 14, 9, 22, 6), "blocked": (3, 3, 2, 4, 1), "mine": 9, "in_progress": 21, "deferred": 31},
    "quiet": {"open": (0, 1, 2, 4, 1), "blocked": (0, 0, 0, 1, 0), "mine": 1, "in_progress": 2, "deferred": 3},
}
_SYSTEMS = ("Microsoft", "Genesys", "SAP", "Opcyc", "VPN", "Telefonie")
_PEOPLE = ("Hoffmann, Mia", "Brandt, Jonas", "Keller, Lea", "Vogel, Tim", "Neumann, Sara", "Lorenz, Ben")


def _due_dates(today: date, counts: tuple[int, int, int, int, int], rng: random.Random) -> list[str | None]:
    overdue, due_today, due_tomorrow, later, undated = counts
    dates: list[str | None] = []
    dates += [(today - timedelta(days=rng.randint(1, 6))).isoformat() for _ in range(overdue)]
    dates += [today.isoformat()] * due_today
    dates += [(today + timedelta(days=1)).isoformat()] * due_tomorrow
    dates += [(today + timedelta(days=rng.randint(2, 21))).isoformat() for _ in range(later)]
    dates += [None] * undated
    return dates


def mock_tasks_overview(scenario: str = "normal", today: date | None = None) -> dict:
    scenario = normalize_scenario(scenario)
    today = today or berlin_now().date()
    profile = _TASK_PROFILE[scenario]
    rng = _rng(scenario, today, "tasks")
    deferred_left = profile["deferred"]
    counter = 1000

    def build(dates: list[str | None], status: str) -> list[dict]:
        nonlocal counter, deferred_left
        tasks = []
        for target in dates:
            counter += 1
            deferred = deferred_left > 0 and rng.random() < 0.4
            if deferred:
                deferred_left -= 1
            tasks.append({
                "task_id": counter,
                "status": status,
                "target_date": target,
                "system_name": rng.choice(_SYSTEMS),
                "target_user_name": rng.choice(_PEOPLE),
                "provisioning_requirement": "DEFERRED" if deferred else "REQUIRED",
                "backlog_identifier": "IT",
            })
        return tasks

    open_tasks = build(_due_dates(today, profile["open"], rng), "OPEN")
    blocked_tasks = build(_due_dates(today, profile["blocked"], rng), "BLOCKED")
    # Rest der nachgelagerten Tasks landet in den offenen, damit die Zahl stimmt.
    for task in open_tasks:
        if deferred_left <= 0:
            break
        if task["provisioning_requirement"] != "DEFERRED":
            task["provisioning_requirement"] = "DEFERRED"
            deferred_left -= 1
    user_tasks = build(_due_dates(today, (0, min(2, profile["mine"]), 1, max(0, profile["mine"] - 3), 0), rng), "IN_PROGRESS")
    return {
        "open_tasks": open_tasks,
        "blocked_tasks": blocked_tasks,
        "user_tasks": user_tasks,
        # Wunsch: Gesamtzahl aller Tasks in Bearbeitung (heute nur die eigenen in user_tasks).
        "in_progress_total": profile["in_progress"],
    }


# ---------- Servicelevel ----------

_SERVICE_LEVEL = {
    "normal": {"offered": 1240, "in_time": 1022, "answered": 1201, "yesterday": 79.1},
    "busy": {"offered": 1860, "in_time": 1175, "answered": 1604, "yesterday": 74.3},
    "quiet": {"offered": 214, "in_time": 203, "answered": 211, "yesterday": 91.8},
}


def mock_service_level(scenario: str = "normal", now: datetime | None = None) -> dict:
    scenario = normalize_scenario(scenario)
    now = now or berlin_now()
    base = _SERVICE_LEVEL[scenario]
    return {
        # Wunsch: Route fuer den Gesamt-Servicelevel des Tages aus Genesys (noch nicht in der SD-API).
        "as_of": now.isoformat(),
        "date": now.date().isoformat(),
        "target_percent": 80,
        "threshold_seconds": 20,
        "today": {
            "offered": base["offered"],
            "answered": base["answered"],
            "answered_in_time": base["in_time"],
            "abandoned": base["offered"] - base["answered"],
            "percent": round(base["in_time"] / base["offered"] * 100, 1),
        },
        "yesterday": {"percent": base["yesterday"]},
    }


# ---------- Genesys Live ----------

def mock_genesys_live(scenario: str = "normal", now: datetime | None = None) -> dict:
    scenario = normalize_scenario(scenario)
    now = now or berlin_now()
    data = json.loads(_LIVE_SAMPLE.read_text(encoding="utf-8"))
    data["as_of"] = now.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    data["stale"] = scenario == "busy"
    if scenario == "quiet":
        total = data["total"]
        total["voice"] = {"interacting": 2, "waiting": 0}
        people = total["people"]
        people["present"] = 14
        people["on_queue"] = {"total": 9, "idle": 6, "interacting": 3, "communicating": 0, "not_responding": 0}
        people["pause"] = {"total": 2, "by_status": {key: 1 if index < 2 else 0 for index, key in enumerate(people["pause"]["by_status"])}}
        people["busy"] = {"total": 1, "by_status": {key: 1 if index == 0 else 0 for index, key in enumerate(people["busy"]["by_status"])}}
        people["away"] = 0
    return data


# ---------- Kalender-Events ----------

_SKILLS = ((11, "Retouren"), (12, "Kündigung"), (13, "Technik 2nd Level"), (14, "Beschwerde"))
_NAMES = (
    "Mia Hoffmann", "Jonas Brandt", "Lea Keller", "Tim Vogel", "Sara Neumann", "Ben Lorenz",
    "Nora Fuchs", "Paul Winter", "Emma Schreiber", "Luca Roth", "Hanna Kurz", "Finn Albrecht",
)
_EVENT_COPY = {
    "ONBOARDING": ("Onboarding", "Onboarding-Termin für {name}."),
    "OFFBOARDING": ("Offboarding", "Offboarding-Termin für {name}."),
    "ROLE_ASSIGNMENT": ("Rollenzuweisung", "{role} für {name}."),
    "ROLE_REMOVAL": ("Rollenentzug", "{role} für {name}."),
    "TRAINING_SCHEDULE": ("Schulung", "{role} Schulung für {name}."),
    "RETRAIN": ("Event", "Geplantes Event für {name}."),
}


def _event(event_type: str, day: date, hour: int | None, name_index: int, process_id: int, today: date,
           role: tuple[int, str] | None = None, change: str | None = None, status: str | None = None) -> dict:
    title, description = _EVENT_COPY[event_type]
    name = _NAMES[name_index % len(_NAMES)]
    role_id, role_name = role or (None, None)
    process_type = {"ONBOARDING": "ONBOARDING", "OFFBOARDING": "OFFBOARDING", "TRAINING_SCHEDULE": "TRAINING_SCHEDULE", "RETRAIN": "RETRAIN"}.get(event_type, "TEMPORARY_ROLE")
    if change:
        process_type = "CHANGE"
        title = "Abteilungswechsel: neue Rolle" if change == "new" else "Abteilungswechsel: Altrolle entziehen"
    scheduled = datetime(day.year, day.month, day.day, hour or 0, 0, 0)
    executed = status in (None, "EXECUTED") and day < today
    return {
        "title": title,
        "description": description.format(name=name, role=role_name or "Rolle"),
        "event_type": event_type,
        "event_status": status or ("EXECUTED" if executed else "PLANNED"),
        "blocks_process_completion": True,
        "scheduled_at": scheduled.isoformat(),
        "executed_at": scheduled.isoformat() if executed else None,
        "display_at": scheduled.isoformat(),
        "user_id": 500 + (name_index % len(_NAMES)),
        "process_id": process_id,
        "role_id": role_id,
        # Wunsch (siehe docs/backend-request-event-summary.md):
        "role_name": role_name,
        "process_type": process_type,
        "user_name": name,
    }


def mock_events(scenario: str = "normal", today: date | None = None) -> list[dict]:
    scenario = normalize_scenario(scenario)
    today = today or berlin_now().date()
    monday = today - timedelta(days=today.weekday())
    events: list[dict] = []
    pid = 7000
    cursor = 0
    heavy = scenario == "busy"
    for week in range(-1, 3):
        week_start = monday + timedelta(weeks=week)
        day = lambda offset: week_start + timedelta(days=offset)  # noqa: E731
        rng = _rng(scenario, week_start, "events")
        if scenario == "quiet" and week != 0:
            continue
        # Onboardings (mehrere Personen an zwei Tagen)
        for offset, count in ((0, 2 if not heavy else 4), (2, 1 if not heavy else 3)):
            for _ in range(count):
                pid += 1
                cursor += 1
                events.append(_event("ONBOARDING", day(offset), 8 if offset == 0 else 9, cursor, pid, today))
        # Schulungen: je Skill ein Tag, mehrere Mitarbeiter
        for skill_index, (offset, size) in enumerate(((1, 5), (3, 3), (4, 2))):
            skill = _SKILLS[(skill_index + week) % len(_SKILLS)]
            pid += 1
            for _ in range(size + (3 if heavy else 0)):
                cursor += 1
                events.append(_event("TRAINING_SCHEDULE", day(offset), 13, cursor, pid, today, role=skill))
        # Rollenzuweisung und -entzug
        for _ in range(4 if not heavy else 7):
            pid += 1
            cursor += 1
            events.append(_event("ROLE_ASSIGNMENT", day(rng.randint(0, 4)), None, cursor, pid, today, role=rng.choice(_SKILLS)))
        for _ in range(2):
            pid += 1
            cursor += 1
            events.append(_event("ROLE_REMOVAL", day(rng.randint(0, 4)), None, cursor, pid, today, role=rng.choice(_SKILLS)))
        # Abteilungswechsel: zwei Events je Vorgang
        pid += 1
        cursor += 1
        events.append(_event("ROLE_ASSIGNMENT", day(3), None, cursor, pid, today, role=_SKILLS[0], change="new"))
        events.append(_event("ROLE_REMOVAL", day(3), None, cursor, pid, today, role=_SKILLS[1], change="old"))
        # Offboarding und Nachschulung
        pid += 1
        cursor += 1
        events.append(_event("OFFBOARDING", day(4), 16, cursor, pid, today))
        pid += 1
        cursor += 1
        events.append(_event("RETRAIN", day(2), 10, cursor, pid, today))
        if week == 0:
            pid += 1
            cursor += 1
            events.append(_event("ROLE_ASSIGNMENT", day(min(today.weekday(), 4)), None, cursor, pid, today,
                                 role=_SKILLS[2], status="FAILED"))
    return events


def filter_events(events: list[dict], from_date: str | None, to_date: str | None) -> list[dict]:
    """Wie `GET /sofa/events` mit from_date/to_date (ISO, inklusive)."""
    def parse(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None

    start, end = parse(from_date), parse(to_date)
    result = []
    for event in events:
        moment = datetime.fromisoformat(event["display_at"])
        if start and moment < start:
            continue
        if end and moment > end:
            continue
        result.append(event)
    return result
