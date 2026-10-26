"""Mock-Daten fuer den Kanban-Entwurf der Aufgabenseite (nur Entwicklungsinstanz, `/tasks?mock=`).

Jeder Task hat die Form von `TaskView` aus der SD-API (`GET /sofa/tasks/view`) plus der Felder, die
docs/tasks-kanban.md als Backend-Wunsch fuehrt: Bearbeitername, `assigned_at`, `completed_at`,
Prozess und System. Zeitstempel sind naiv in Berliner Ortszeit, wie die SD-API sie liefert.
"""
from __future__ import annotations

import os
import json
import random
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

SCENARIOS = ("normal", "busy", "quiet")

BERLIN = ZoneInfo("Europe/Berlin")

BACKLOGS = (
    {"technical_identifier": "IT", "display_name": "IT-Service"},
    {"technical_identifier": "TEL", "display_name": "Telefonie"},
    {"technical_identifier": "HR", "display_name": "Personal"},
)

ACCOUNT, GROUP, OTHER = 1, 2, 3

# Gleicher Text wie RELATED_REVOCATION_NOTE in tasks_board_model.js.
RELATED_REVOCATION_NOTE = "Mit dem Kontoentzug erledigt."

# system_id, Name, Backlog, Bearbeitungsart fuer Konto und Gruppen, weitere Ressourcen
_SYSTEMS = (
    (10, "Microsoft", "IT", "INTERNAL", ("M365-Gruppe Service", "M365-Gruppe Vertrieb"), ()),
    (20, "Genesys", "TEL", "BOT", ("Queue Vertrieb", "Queue Service", "Queue Störung"), ("WebRTC-Telefon",)),
    (30, "SAP", "HR", "EXTERNAL", ("SAP-Rolle Personalakte",), ()),
    (40, "Opcyc", "TEL", "EXTERNAL", ("Opcyc-Planungsgruppe",), ()),
    (50, "VPN", "IT", "INTERNAL", (), ("VPN-Token",)),
)

_ACCOUNT_NAMES = {
    "Microsoft": "Microsoft-Konto",
    "Genesys": "Genesys-Benutzer",
    "SAP": "SAP-Benutzer",
    "Opcyc": "Opcyc-Benutzer",
    "VPN": "VPN-Zugang",
}

_TARGETS = (
    "Maria Musterfrau", "Lukas Schneider", "Elif Öztürk", "Jonas Weber", "Sophie Krüger",
    "Tim Neumann", "Hannah Schwarz", "Paul Zimmermann", "Lea Braun", "Noah Hartmann",
    "Mia Lange", "Ben Schulz", "Emilia Wolf", "Finn Koch", "Clara Richter", "David Klein",
    "Lina Fischer", "Elias Vogel", "Ida Bauer", "Deniz Kaya",
)

_COLLEAGUES = (
    (9101, "Jonas Becker"),
    (9102, "Leonie Schmitt"),
    (9103, "Murat Yilmaz"),
    (9104, "Anna Hoffmann"),
    (9105, "Felix Wagner"),
)

_PROCESS_MIX = (
    ("ONBOARDING", 5), ("OFFBOARDING", 3), ("SKILL_ASSIGNMENT", 3), ("CHANGE", 2), ("SKILL_REMOVAL", 1),
)

# Anzahl Prozesse je Szenario; aeltere, erledigte Prozesse fuellen den Monat in "Erledigt".
_PROFILE = {
    "normal": {"active": 26, "finished": 30, "me_share": 0.3, "deferred": 0.35},
    "busy": {"active": 70, "finished": 80, "me_share": 0.25, "deferred": 0.6},
    "quiet": {"active": 2, "finished": 4, "me_share": 0.5, "deferred": 0.0},
}


def mock_scenario(query_value: str | None) -> str | None:
    """`?mock=normal|busy|quiet` (oder `1`) zeigt in der Entwicklungsinstanz den Kanban-Entwurf."""
    if os.getenv("APP_ENV", "production") != "development" or not query_value or query_value == "0":
        return None
    return query_value if query_value in SCENARIOS else "normal"


def berlin_now() -> datetime:
    return datetime.now(BERLIN).replace(tzinfo=None, microsecond=0)


def _stamp(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat()


def _work_time(rng: random.Random, day: date) -> datetime:
    return datetime.combine(day, datetime.min.time()) + timedelta(hours=rng.randint(7, 16), minutes=rng.randint(0, 59))


def _weighted(rng: random.Random, pairs):
    values, weights = zip(*pairs)
    return rng.choices(values, weights=weights, k=1)[0]


def _detail_fixtures(tasks: list[dict], now: datetime) -> dict:
    """Verlauf je Task in der Form von GET /sofa/tasks/{id}/logs (details als JSON-Text), dazu der
    Mock-Schalter automation_fails_once fuer tasks_board_mock.js."""
    details = {}
    for task in tasks:
        task_id = task["task_id"]
        created = datetime.fromisoformat(task["created_at"])
        history = []

        def event(action, stamp, name=None, user_id=None, comment=None, details=None):
            history.append({"action": action, "timestamp": _stamp(stamp), "user_name": name, "user_id": user_id,
                            "comment": comment,
                            "details": json.dumps(details, ensure_ascii=False) if details is not None else None})

        event("CREATED", created)
        if task["assigned_at"]:
            assigned = datetime.fromisoformat(task["assigned_at"])
            event("ASSIGNED", assigned, task["assigned_to_user_name"], task["assigned_to_user_id"])
            note_at = min(now, assigned + timedelta(minutes=2))
            if task["completed_at"]:
                note_at = min(note_at, datetime.fromisoformat(task["completed_at"]))
            event("COMMENTED", note_at, task["assigned_to_user_name"], task["assigned_to_user_id"],
                  "Mit dem Fachbereich abgestimmt. Die Zuordnung ist geprüft.")
        elif task["status"] == "OPEN":
            note_at = min(now, created + timedelta(minutes=5))
            event("ASSIGNED", min(now, created + timedelta(minutes=2)), *reversed(_COLLEAGUES[0]))
            event("RELEASED", note_at, *reversed(_COLLEAGUES[0]),
                  "Bitte die Umsetzung zum Stichtag mit dem Fachbereich abstimmen.")

        identifier = f"user{task['target_user_id']}" if task["resource_type_id"] == ACCOUNT else None
        if task["completed_at"]:
            completed = datetime.fromisoformat(task["completed_at"])
            if task["handling_type"] == "EXTERNAL":
                mail = {"recipient": "service@example.test", "cc": "team@example.test", "bcc": "",
                        "subject": f"{task['resource_name']} · {task['target_user_name']}",
                        "body": f"Bitte die folgende Aufgabe umsetzen:\n\n{task['resource_name']}\nFür {task['target_user_name']}\n\nVielen Dank.",
                        "initiator_user_id": task["assigned_to_user_id"]}
                event("MAIL_SENT", max(datetime.fromisoformat(task["assigned_at"]), completed - timedelta(minutes=1)),
                      task["assigned_to_user_name"], task["assigned_to_user_id"], "Mailbeauftragung versendet",
                      details=mail)
            if task["handling_type"] == "BOT":
                # Die SD-API schreibt den Bearbeiter auch an Systemeintraege.
                event("BOT_RESPONSE", completed, task["assigned_to_user_name"], task["assigned_to_user_id"],
                      "Erfolgreich ausgeführt", {"status": "success", "summary": "Erfolgreich ausgeführt", "user_id": identifier})
            event("COMPLETED", completed, task["assigned_to_user_name"], task["assigned_to_user_id"],
                  "Entzug im Zielsystem geprüft." if task["task_type"] == "REVOCATION" else "Einrichtung im Zielsystem geprüft.",
                  {"resource": task["resource_name"], "account_identifier": identifier} if identifier else None)

        details[str(task_id)] = {"history": history, "automation_fails_once": task_id % 3 == 0}

    completed_accounts = {
        (task["process_id"], task["system_id"], task["target_user_id"]): task
        for task in tasks if task["status"] == "COMPLETED" and task["task_type"] == "REVOCATION"
        and task["resource_type_id"] == ACCOUNT
    }
    for task in tasks:
        if task["status"] != "COMPLETED" or task["task_type"] != "REVOCATION" or task["resource_type_id"] == ACCOUNT:
            continue
        source = completed_accounts.get((task["process_id"], task["system_id"], task["target_user_id"]))
        if not source or source["completed_at"] > task["completed_at"]:
            continue
        completed_entry = next(entry for entry in details[str(task["task_id"])]["history"] if entry["action"] == "COMPLETED")
        # Bis zum strukturierten Abschlusskontext steht der Zusammenhang nur als Hinweis im Kommentar.
        completed_entry["comment"] = RELATED_REVOCATION_NOTE

    # Ein langer Beispielverlauf macht das Nachladen beim Hochscrollen pruefbar.
    long_task = next((task for task in tasks if task["status"] == "OPEN"
                      and task["handling_type"] == "INTERNAL"), None)
    if long_task:
        start = datetime.fromisoformat(long_task["created_at"])
        notes = ("Rückmeldung des Fachbereichs steht aus.", "Zuordnung mit dem Fachbereich geprüft.",
                 "Rückfrage zur benötigten Berechtigung gestellt.", "Bearbeitung zum vereinbarten Stichtag abgestimmt.")
        history = details[str(long_task["task_id"])]["history"]
        for index in range(44):
            history.append({"action": "COMMENTED", "timestamp": _stamp(start + (now - start) * ((index + 1) / 45)),
                            "user_name": _COLLEAGUES[index % len(_COLLEAGUES)][1],
                            "user_id": _COLLEAGUES[index % len(_COLLEAGUES)][0], "comment": notes[index % len(notes)],
                            "details": None})
    return details


def mock_board(scenario: str = "normal", me: dict | None = None, now: datetime | None = None) -> dict:
    scenario = scenario if scenario in SCENARIOS else "normal"
    now = now or berlin_now()
    today = now.date()
    profile = _PROFILE[scenario]
    rng = random.Random(f"tasks-board:{scenario}:{today.isoformat()}")
    me = me or {}
    me_id = me.get("user_id") or 4242
    me_name = me.get("name") or "Ich"
    workers = [(me_id, me_name)] + list(_COLLEAGUES)

    tasks: list[dict] = []
    task_id = 5000
    process_id = 700

    def pick_worker() -> tuple[int, str]:
        if rng.random() < profile["me_share"]:
            return workers[0]
        return rng.choice(_COLLEAGUES)

    def add(process: dict, system: tuple, resource_id: int, resource_type_id: int, resource_name: str,
            handling: str, status: str, deferred: bool = False) -> dict:
        nonlocal task_id
        task_id += 1
        system_id, system_name, backlog = system[0], system[1], system[2]
        task = {
            "task_id": task_id,
            "task_type": process["task_type"],
            "status": status,
            "handling_type": handling,
            "provisioning_requirement": "DEFERRED" if deferred else "REQUIRED",
            "target_user_id": process["target_user_id"],
            "target_user_name": process["target_user_name"],
            "resource_id": resource_id,
            "resource_type_id": resource_type_id,
            "resource_name": resource_name,
            "assigned_to_user_id": None,
            "assigned_to_user_name": None,
            "assigned_at": None,
            "completed_at": None,
            "created_at": _stamp(process["created_at"]),
            "backlog_identifier": backlog,
            "target_date": process["target_date"],
            "process_id": process["process_id"],
            "process_type": process["process_type"],
            "system_id": system_id,
            "system_name": system_name,
            "blocked_by": None,
            "archived_accounts": [],
        }
        tasks.append(task)
        return task

    def set_progress(task: dict, created_at: datetime) -> None:
        user_id, name = pick_worker()
        hours = rng.choice((1, 2, 4, 20, 26, 50, 75, 120))
        assigned = max(created_at + timedelta(minutes=30), now - timedelta(hours=hours, minutes=rng.randint(0, 50)))
        task.update(assigned_to_user_id=user_id, assigned_to_user_name=name, assigned_at=_stamp(assigned))

    def set_completed(task: dict, created_at: datetime, max_age_days: int) -> None:
        user_id, name = pick_worker()
        age = min(max_age_days, int(rng.expovariate(1 / 9)))
        day = today - timedelta(days=age)
        done = _work_time(rng, day)
        if done > now:
            done = now - timedelta(minutes=rng.randint(5, 90))
        done = max(done, created_at + timedelta(hours=1))
        task.update(
            assigned_to_user_id=user_id,
            assigned_to_user_name=name,
            assigned_at=_stamp(done - timedelta(minutes=rng.randint(5, 240))),
            completed_at=_stamp(done),
        )

    def new_process(active: bool) -> dict:
        nonlocal process_id
        process_id += 1
        process_type = _weighted(rng, _PROCESS_MIX)
        revocation = process_type in ("OFFBOARDING", "SKILL_REMOVAL")
        age_days = rng.randint(0, 9) if active else rng.randint(2, 30)
        created_at = _work_time(rng, today - timedelta(days=age_days))
        if created_at > now:
            created_at = now - timedelta(hours=1)
        if active:
            offset = _weighted(rng, ((None, 3), (-6, 1), (-2, 2), (0, 2), (3, 2), (12, 1)))
        else:
            offset = _weighted(rng, ((None, 2), (-age_days, 3)))
        target_date = None if offset is None else (today + timedelta(days=offset)).isoformat()
        target_index = (process_id * 7) % len(_TARGETS)
        return {
            "process_id": process_id,
            "process_type": process_type,
            "task_type": "REVOCATION" if revocation else "ASSIGNMENT",
            "target_user_id": 600 + target_index,
            "target_user_name": _TARGETS[target_index],
            "created_at": created_at,
            "target_date": target_date,
        }

    def build_process(active: bool) -> None:
        process = new_process(active)
        onboarding = process["process_type"] == "ONBOARDING"
        with_account = process["process_type"] in ("ONBOARDING", "OFFBOARDING")
        systems = rng.sample(_SYSTEMS, k=rng.randint(1, 3))

        for system in systems:
            system_id, system_name, _backlog, handling, groups, others = system
            # Konto zuerst; Gruppen eines neuen Kontos warten, bis das Konto erledigt ist.
            if active:
                account_status = _weighted(rng, (("OPEN", 5), ("IN_PROGRESS", 4), ("COMPLETED", 2)))
            else:
                account_status = "COMPLETED"

            if with_account:
                account = add(process, system, system_id * 100 + 1, ACCOUNT, _ACCOUNT_NAMES[system_name],
                              handling, account_status)
                if account_status == "IN_PROGRESS":
                    set_progress(account, process["created_at"])
                elif account_status == "COMPLETED":
                    set_completed(account, process["created_at"], 4 if active else 30)

            picked_groups = rng.sample(groups, k=min(len(groups), rng.randint(0, 2) if with_account else 1)) if groups else []
            for index, group_name in enumerate(picked_groups):
                waits = onboarding and account_status != "COMPLETED"
                if waits:
                    status = "BLOCKED"
                elif active:
                    status = _weighted(rng, (("OPEN", 5), ("IN_PROGRESS", 2), ("COMPLETED", 2)))
                else:
                    status = "COMPLETED"
                group_handling = "INTERNAL" if handling == "EXTERNAL" else handling
                task = add(process, system, system_id * 100 + 10 + index, GROUP, group_name, group_handling, status)
                if waits:
                    task["blocked_by"] = {
                        "task_id": account["task_id"],
                        "resource_name": account["resource_name"],
                        "status": account["status"],
                    }
                if status == "IN_PROGRESS":
                    set_progress(task, process["created_at"])
                elif status == "COMPLETED":
                    set_completed(task, process["created_at"], 30)

            if onboarding:
                for index, other_name in enumerate(others):
                    deferred = rng.random() < profile["deferred"] * 2
                    status = "OPEN" if active else "COMPLETED"
                    task = add(process, system, system_id * 100 + 50 + index, OTHER, other_name,
                               "BOT" if system_name == "Genesys" else "INTERNAL", status, deferred=deferred)
                    if status == "COMPLETED":
                        set_completed(task, process["created_at"], 30)

    for _ in range(profile["active"]):
        build_process(active=True)
    for _ in range(profile["finished"]):
        build_process(active=False)

    # Nachlieferungen auch ausserhalb von Onboardings (z. B. Gruppen, die spaeter nachgezogen werden).
    for task in tasks:
        if (task["status"] == "OPEN" and task["resource_type_id"] == GROUP
                and rng.random() < profile["deferred"] / 2):
            task["provisioning_requirement"] = "DEFERRED"

    # Archivierte Konten wie in der Task-Antwort der SD-API (sofa_contract.getArchivedAccounts).
    for task in tasks:
        if task["task_type"] == "ASSIGNMENT" and task["resource_type_id"] == ACCOUNT and task["task_id"] % 4 == 0:
            task["archived_accounts"] = [{
                "user_account_history_id": task["task_id"] + 10000,
                "account_identifier": f"alt{task['target_user_id']}",
                "archived_at": _stamp(datetime.fromisoformat(task["created_at"]) - timedelta(days=90)),
                "identifier_in_use_by_other": False,
            }]

    # In der ruhigen Variante bleibt "In Bearbeitung" fuer einen selbst leer.
    if scenario == "quiet":
        for task in tasks:
            if task["status"] == "IN_PROGRESS" and task["assigned_to_user_id"] == me_id:
                task.update(status="OPEN", assigned_to_user_id=None, assigned_to_user_name=None, assigned_at=None)

    return {
        "scenario": scenario,
        "generated_at": _stamp(now),
        "today": today.isoformat(),
        "me": {"user_id": me_id, "name": me_name},
        "backlogs": list(BACKLOGS),
        "tasks": tasks,
        "task_details": _detail_fixtures(tasks, now),
    }
