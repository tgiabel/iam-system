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


# ---------- Servicelevel ----------

# Grundniveau je Szenario: Anteil rechtzeitig angenommener Anrufe und Anrufe je Queue und Werktag.
_SERVICE_LEVEL = {
    "normal": {"ratio": 0.82, "calls": 55},
    "busy": {"ratio": 0.68, "calls": 85},
    "quiet": {"ratio": 0.93, "calls": 9},
}
_SL_TARGET = 0.8
# Beispielgruppe, bis Gruppen im Servicelevel-Report gepflegt werden.
_SL_GROUPS = (("vrp", "VRP-Queues", 6),)


def _sl_bucket(numerator: int, denominator: int, **extra) -> dict:
    return {**extra, "numerator": numerator, "denominator": denominator,
            "ratio": round(numerator / denominator, 4) if denominator else None}


def _prod_queues() -> list[dict]:
    data = json.loads(_LIVE_SAMPLE.read_text(encoding="utf-8"))
    return sorted(({"queue_id": q["queue_id"], "label": q["label"]} for q in data["queues"]),
                  key=lambda q: q["label"].lower())


def _queue_day(scenario: str, queue_id: str, day: date, partial: float = 1.0) -> tuple[int, int]:
    """Rechtzeitig angenommene und gezaehlte Anrufe einer Queue an einem Tag (Wochenende ruhiger)."""
    base = _SERVICE_LEVEL[scenario]
    rng = _rng(scenario, day, f"sl|{queue_id}")
    ratio = min(0.99, max(0.35, base["ratio"] + rng.uniform(-0.18, 0.12)))
    volume = {5: 0.3, 6: 0.0}.get(day.weekday(), 1.0)
    calls = max(0, int(base["calls"] * rng.uniform(0.2, 1.6) * volume * partial))
    return round(calls * ratio), calls


def _sum_days(scenario: str, queue_ids: list[str], days: list[date], today: date, partial: float) -> tuple[int, int]:
    num = den = 0
    for day in days:
        for queue_id in queue_ids:
            n, d = _queue_day(scenario, queue_id, day, partial if day == today else 1.0)
            num += n
            den += d
    return num, den


def mock_service_level(scenario: str = "normal", now: datetime | None = None,
                       queue_id: str | None = None, group_id: str | None = None) -> dict:
    """Vorschlag fuer GET /reporting/service-level (noch nicht in der SD-API): alle Prod-Queues, eine Gruppe
    oder eine Queue; Tag, laufender Monat, Vormonat und die sieben Tage vor heute. Zaehler und Nenner wie
    oServiceLevel, damit sich Queues und Tage addieren lassen."""
    scenario = normalize_scenario(scenario)
    now = now or berlin_now()
    today = now.date()
    partial = max(0.05, min(1.0, (now.hour * 60 + now.minute - 7 * 60) / (11 * 60)))
    queues = _prod_queues()
    groups = [{"group_id": gid, "label": label, "queue_ids": [q["queue_id"] for q in queues[:size]]}
              for gid, label, size in _SL_GROUPS]
    scope = {"type": "all", "id": None, "label": "Gesamt"}
    queue_ids = [q["queue_id"] for q in queues]
    if group_id:
        group = next((g for g in groups if g["group_id"] == group_id), None)
        if group:
            scope = {"type": "group", "id": group_id, "label": group["label"]}
            queue_ids = group["queue_ids"]
    elif queue_id:
        queue = next((q for q in queues if q["queue_id"] == queue_id), None)
        if queue:
            scope = {"type": "queue", "id": queue_id, "label": queue["label"]}
            queue_ids = [queue_id]

    month_start = today.replace(day=1)
    prev_end = month_start - timedelta(days=1)
    prev_start = prev_end.replace(day=1)
    span = lambda start, end: [start + timedelta(days=i) for i in range((end - start).days + 1)]
    days = []
    for offset in range(7, 0, -1):
        day = today - timedelta(days=offset)
        days.append(_sl_bucket(*_sum_days(scenario, queue_ids, [day], today, partial), date=day.isoformat()))
    return {
        "as_of": now.isoformat(),
        "target_ratio": _SL_TARGET,
        "queues": queues,
        "groups": [{"group_id": g["group_id"], "label": g["label"]} for g in groups],
        "scope": scope,
        "day": _sl_bucket(*_sum_days(scenario, queue_ids, [today], today, partial), date=today.isoformat()),
        "month": _sl_bucket(*_sum_days(scenario, queue_ids, span(month_start, today), today, partial),
                            month=month_start.strftime("%Y-%m")),
        "previous_month": _sl_bucket(*_sum_days(scenario, queue_ids, span(prev_start, prev_end), today, partial),
                                     month=prev_start.strftime("%Y-%m")),
        "days": days,
    }


# ---------- Mein Tag ----------

_MY_DAY = {"normal": (2, 48), "busy": (5, 83), "quiet": (0, 0)}


def mock_my_day(scenario: str = "normal", day: date | None = None, now: datetime | None = None) -> dict:
    """Was die angemeldete Person an einem Tag erledigt hat. Echte Quellen: calls_answered aus
    reporting/agent-stats?period=day&anchor=<Tag> (answered); erledigte Aufgaben aus completed_tasks,
    sobald die SD-API completed_at liefert. Zukuenftige Tage und Wochenenden bleiben leer."""
    scenario = normalize_scenario(scenario)
    now = now or berlin_now()
    today = now.date()
    day = day or today
    tasks, calls = _MY_DAY[scenario]
    if day > today or day.weekday() >= 5 or not calls:
        tasks = calls = 0
    else:
        rng = _rng(scenario, day, "my-day")
        share = max(0.0, min(1.0, (now.hour * 60 + now.minute - 8 * 60) / (9 * 60))) if day == today else 1.0
        tasks, calls = (round(value * rng.uniform(0.5, 1.5) * share) for value in (tasks, calls))
    return {"date": day.isoformat(), "tasks_completed": tasks, "calls_answered": calls}


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
            events += _today_events(today, cursor, pid, 5 if heavy else 4)
    return events


def _today_events(today: date, cursor: int, pid: int, onboardings: int) -> list[dict]:
    """Ein gut gefuellter heutiger Tag, damit die Tagesansicht ("A, B + x weitere") sichtbar ist."""
    events = []
    for index in range(onboardings):
        pid += 1
        events.append(_event("ONBOARDING", today, 8, cursor + 20 + index, pid, today))
    pid += 1
    for index in range(3):
        events.append(_event("TRAINING_SCHEDULE", today, 14, cursor + 30 + index, pid, today, role=_SKILLS[0]))
    for index in range(2):
        pid += 1
        events.append(_event("ROLE_ASSIGNMENT", today, None, cursor + 40 + index, pid, today, role=_SKILLS[1]))
    pid += 1
    events.append(_event("OFFBOARDING", today, 16, cursor + 50, pid, today))
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
