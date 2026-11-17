"""Mock-Daten der Verwaltungsseiten (nur Entwicklungsinstanz): `/api/views/users|roles|systems?mock=`.

Die Formen folgen den Listen-Endpunkten der SD-API (`/access/users`, `/access/roles/`, `/access/systems/`, Stand 7bc2533),
die Mengen den Prod-Zahlen vom 16./17.11.2026: 23 Systeme wie in Prod (153 Ressourcen), 42 aktive Rollen
(11 PRIMARY, 12 SECONDARY, 16 SKILL, 3 TEMPLATE, Vererbung nur bei PRIMARY/TEMPLATE), rund 120 User.
"""
from __future__ import annotations

import os
import random
from datetime import date, timedelta

SCENARIOS = ("normal", "busy", "quiet")


def mock_scenario(query_value: str | None) -> str | None:
    if os.getenv("APP_ENV", "production") != "development" or not query_value or query_value == "0":
        return None
    return query_value if query_value in SCENARIOS else "normal"


# ---------- Systeme ----------

# Wie Prod am 17.11.2026: Kuerzel, Name, Standard-Backlog, Bearbeitung der Ressourcen, User mit aktiver
# Zuweisung, Aufgaben (offen, davon blockiert, davon ueberfaellig) und die Ressourcen je Typ.
# Erfunden ist nur der Schutzbedarf (V/I/A); in Prod ist er erst bei AD gepflegt, soll aber fuer alle kommen.
_SYSTEMS = (
    (7, "AD", "Windows/ ActiveDirectory", "IT", "EXTERNAL", 88, (6, 2, 0), ("CRITICAL", "LOW", "ELEVATED"),
     (("Konto", ["RACF Konto"]), ("Gruppe", ["AD-Gruppe SD-Agent", "AD-Gruppe SD-Teamleiter", "AD-Gruppe SD-Admin",
      "AD-Gruppe SD-Akademie", "AD-Gruppe SD-Controlling", "AD-Gruppe SD-Personalmanagement", "AD-Gruppe SD-Steuerung",
      "AD-Gruppe SD-IT", "AD-Gruppe SD-Backoffice", "AD-Gruppe SD-Führung", "AD-Gruppe SD-Produktion",
      "AD-Gruppe SD-Vertrieb", "AD-Gruppe SD-Extern", "AD-Gruppe SD-Coach"]), ("Lizenz", ["VPN Lizenz"]),
      ("Drucker", ["Officedrucker"]))),
    (9, "GC", "Genesys Cloud", "IT", "BOT", 80, (9, 3, 0), ("ELEVATED", "ELEVATED", "CRITICAL"),
     (("Konto", ["Genesys Konto"]), ("Gruppe", ["Genesys Gruppe Agent", "Genesys Gruppe Supervisor", "Genesys Gruppe Admin"]),
      ("Telefon", ["WebRTC-Telefon"]),
      ("Queue", ["Queue 116116", "Queue Apple Pay", "Queue DZ Sperre", "Queue MLP 3D Secure", "Queue Helpline",
                 "Queue Sperre Inland", "Queue Sperre Ausland", "Queue Rückruf", "Queue Business", "Queue Chat",
                 "Queue E-Mail", "Queue Social Media", "Queue Beschwerde", "Queue Technik 1st", "Queue Technik 2nd",
                 "Queue Englisch", "Queue Französisch", "Queue Türkisch", "Queue Outbound", "Queue Overflow",
                 "Queue Nachtdienst", "Queue Notfall", "Queue Kartenservice", "Queue Störung"]))),
    (11, "MS365", "Microsoft 365", "IT", "INTERNAL", 88, (12, 3, 0), ("CRITICAL", "ELEVATED", "ELEVATED"),
     (("Konto", ["Microsoft-Konto"]), ("Lizenz", ["Business Premium Lizenz", "Exchange Online Lizenz"]),
      ("Verteiler", ["Verteiler SD-Produktion-Agenten", "Verteiler Störungsinfo intern", "Verteiler Krank",
                     "Verteiler Teamleitung", "Verteiler Steuerung", "Verteiler IT", "Verteiler Akademie",
                     "Verteiler Personal", "Verteiler Controlling", "Verteiler Führung", "Verteiler Backoffice",
                     "Verteiler Coaches", "Verteiler Betriebsrat", "Verteiler Alle", "Verteiler Extern",
                     "Verteiler Schicht Früh", "Verteiler Schicht Spät"]),
      ("Freigegebenes Postfach", ["Freigegebenes Postfach Info", "Freigegebenes Postfach Zeitkorrektur",
                                  "Freigegebenes Postfach FiBu", "Freigegebenes Postfach Ticket",
                                  "Freigegebenes Postfach Personal", "Freigegebenes Postfach IT",
                                  "Freigegebenes Postfach Akademie", "Freigegebenes Postfach Steuerung",
                                  "Freigegebenes Postfach Bewerbung", "Freigegebenes Postfach Einkauf",
                                  "Freigegebenes Postfach Qualität", "Freigegebenes Postfach Kunden"]))),
    (13, "HLX", "Helix", "IT", "INTERNAL", 88, (3, 0, 0), ("LOW", "ELEVATED", "LOW"),
     (("Modul", ["Digitales Unternehmenshandbuch"]),)),
    (15, "OPC", "Opcyc", "STRG", "INTERNAL", 88, (3, 0, 0), ("ELEVATED", "ELEVATED", "ELEVATED"),
     (("Konto", ["myOpcyc Konto"]), ("Anwendung", ["Admin Tool", "Workforceplanner"]))),
    (17, "WIKI", "Servodata Wiki", "AKAD", "INTERNAL", 88, (6, 2, 0), ("LOW", "LOW", "ELEVATED"),
     (("Konto", ["Wiki Konto"]), ("Gruppe", ["Wiki Rolle Admin", "Wiki Rolle Agent", "Wiki Rolle Akademie"]))),
    (19, "OUS", "OutSystems", "IT", "INTERNAL", 77, (6, 2, 0), ("ELEVATED", "ELEVATED", "LOW"),
     (("Konto", ["OutSystems Konto"]), ("Gruppe", ["OutSystems Gruppe Admin", "OutSystems Gruppe CallCenter",
                                                    "OutSystems Gruppe Tools"]))),
    (21, "SECA", "Servodata Security Awareness", "IT", "INTERNAL", 88, (3, 0, 0), ("LOW", "LOW", "LOW"),
     (("Anwendung", ["Security-Awareness Training"]), ("Modul", ["Security-Awareness Supervisor"]))),
    (23, "TCKR", "Servodata Ticketrecherche", "IT", "INTERNAL", 0, (0, 0, 0), None, ()),
    (25, "VRP", "VR-Payment Systeme", "PROD", "INTERNAL", 68, (6, 0, 0), ("CRITICAL", "CRITICAL", "ELEVATED"),
     (("Konto", ["XDE-Konto"]), ("Systemzugriff", ["KKA Zugriff", "VRP Remedy Zugriff", "WebKKV Zugriff"]))),
    (27, "CGST", "Congstar", "PROD", "EXTERNAL", 63, (1, 0, 0), ("ELEVATED", "ELEVATED", "LOW"),
     (("Konto", ["AAX4 Konto"]),)),
    (29, "TMB", "Teambank", "PROD", "EXTERNAL", 42, (3, 0, 3), ("ELEVATED", "ELEVATED", "LOW"),
     (("Konto", ["easycredit Konto"]),)),
    (31, "DGN", "DGN Systeme", "PROD", "INTERNAL", 51, (0, 0, 0), ("ELEVATED", "LOW", "LOW"),
     (("Konto", ["DGN Konto"]),)),
    (33, "PCT", "Paycenter", "PROD", "INTERNAL", 63, (1, 0, 0), ("ELEVATED", "ELEVATED", "ELEVATED"),
     (("Generisches Konto", ["Paycenter Konto (generisch)"]),)),
    (35, "C24", "C24 Systeme", "PROD", "INTERNAL", 63, (1, 0, 0), ("ELEVATED", "ELEVATED", "ELEVATED"),
     (("Generisches Konto", ["C24-Sperrportal Konto (generisch)"]),)),
    (37, "SOCA", "SocialCard Systeme", "PROD", "INTERNAL", 63, (1, 0, 0), ("ELEVATED", "ELEVATED", "LOW"),
     (("Generisches Konto", ["Socialcard Konto (generisch)"]),)),
    (51, "BFOR", "BFOR", "PROD", "INTERNAL", 63, (1, 0, 0), ("ELEVATED", "ELEVATED", "ELEVATED"),
     (("Generisches Konto", ["BFOR-Sperrportal Konto (generisch)"]),)),
    (55, "SOFA", "Servodata One For All", "IT", "INTERNAL", 15, (0, 0, 0), ("CRITICAL", "CRITICAL", "ELEVATED"),
     (("Funktion", ['SOFA "Onboarding"-Funktion', 'SOFA "Offboarding"-Funktion', "SOFA Skill-Zuweisung",
                    "SOFA Rollenpflege", "SOFA Zeitkorrektur", "SOFA Schulungsplanung", "SOFA Abteilungswechsel",
                    "SOFA Release-Details", "SOFA Rechnerpflege", "SOFA Kontenpflege", "SOFA Aufgaben zuweisen",
                    "SOFA Aufgaben abschließen", "SOFA Systempflege", "SOFA Exporte", "SOFA Alle Rechte"]),
      ("Seite", ["SOFA Userverwaltung", "SOFA Systemverwaltung", "SOFA Rollenmanagement", "SOFA Konsole",
                 "SOFA Aufgaben", "SOFA Rechnerverwaltung", "SOFA Reports"]),
      ("Tool", ["Tool Störungsprotokoll", "Tool Zeitkorrektur", "Tool Genesys-Live", "Tool IVR-Analyse",
                "Tool Schichtplan", "Tool Abwesenheiten", "Tool Kontaktsuche"]),
      ("Backlog", ["IT-Backlog", "Produktion-Backlog", "Akademie-Backlog", "Steuerung-Backlog", "Alle Backlogs"]),
      ("Report", ["SOFA Presence-Report", "Report IVR", "Report Tagesbericht", "Report Genesys", "Report Telefonie"]),
      ("IKS", ["IKS Rollen-Bericht", "IKS Zugriffe", "IKS Konten", "IKS Logins", "IKS Rechte"]))),
    (57, "POR", "Porsche Sperrportal", "PROD", "INTERNAL", 60, (8, 3, 0), ("CRITICAL", "ELEVATED", "ELEVATED"),
     (("Konto", ["myEnfuce Konto"]), ("Gruppe", ["Sperrportal - Rolle Servodata"]))),
    (59, "NETC", "Netcetera", "PROD", "INTERNAL", 63, (6, 0, 5), ("CRITICAL", "ELEVATED", "LOW"),
     (("Konto", ["Netcetera Konto"]),)),
    (61, "VISA", "VISA Online", "PROD", "INTERNAL", 35, (32, 0, 32), ("CRITICAL", "ELEVATED", "LOW"),
     (("Konto", ["VISA Online Konto"]),)),
    (63, "MCC", "Mastercard Connect", "PROD", "INTERNAL", 36, (31, 0, 31), ("CRITICAL", "ELEVATED", "LOW"),
     (("Konto", ["Mastercard Connect Konto"]),)),
    (65, "GANS", "GANS", "PROD", "INTERNAL", 21, (47, 0, 47), ("ELEVATED", "ELEVATED", "LOW"),
     (("Konto", ["GANS Konto"]),)),
)

_BACKLOGS = {"IT": "IT-Backlog", "PROD": "Produktion-Backlog", "AKAD": "Akademie-Backlog", "STRG": "Steuerung-Backlog"}
_LEVELS = ("LOW", "ELEVATED", "CRITICAL")


def _backlogs() -> list[dict]:
    """Wie `/api/backlogs` (Backlog-Ressourcen des Systems SOFA)."""
    return [{"technical_identifier": f"SOFA-BKLG-{key}", "display_name": name} for key, name in _BACKLOGS.items()]


def _systems(scenario: str) -> list[dict]:
    systems = []
    resource_id = 2000
    for system_id, short, name, backlog, handling, users, tasks, protection, groups in _SYSTEMS:
        resources = []
        for type_name, items in groups:
            for item in items:
                resource_id += 1
                resources.append({"resource_id": resource_id, "display_name": item, "type_name": type_name,
                                  "handling": handling})
        open_tasks, blocked, overdue = tasks
        need = dict(zip(("confidentiality", "integrity", "availability"), protection or (None, None, None)))
        need["overall"] = max(protection, key=_LEVELS.index) if protection else None
        systems.append({
            "system_id": system_id,
            "short_name": short,
            "name": name,
            "status": "ACTIVE",
            "default_backlog_identifier": f"SOFA-BKLG-{backlog}",
            "default_handling_type": "INTERNAL",
            "protection_need": need,
            "resource_names": [item["display_name"] for item in resources],
            "resources": resources,
            "user_count": users,
            "open_tasks": 0 if scenario == "quiet" else open_tasks,
            "blocked_tasks": 0 if scenario == "quiet" else blocked,
            "overdue_tasks": 0 if scenario == "quiet" else overdue,
        })
    return systems


# ---------- Rollen ----------

# Name, Typ, Elternrolle (Vererbungsbaum wie in Prod)
_ROLE_TREE = (
    ("Servodata Mitarbeiter", "TEMPLATE", None),
    ("Agent", "PRIMARY", "Servodata Mitarbeiter"),
    ("Servodata Backoffice", "TEMPLATE", "Servodata Mitarbeiter"),
    ("Coach/ Trainer", "PRIMARY", "Servodata Backoffice"),
    ("Controlling", "PRIMARY", "Servodata Backoffice"),
    ("IT", "PRIMARY", "Servodata Backoffice"),
    ("Personalmanagement", "PRIMARY", "Servodata Backoffice"),
    ("Steuerung", "PRIMARY", "Servodata Backoffice"),
    ("Teamleiter", "PRIMARY", "Servodata Backoffice"),
    ("Servodata Führungskraft", "TEMPLATE", "Servodata Backoffice"),
    ("Akademie Leitung", "PRIMARY", "Servodata Führungskraft"),
    ("Produktion Leitung", "PRIMARY", "Servodata Führungskraft"),
    ("Verwaltung & Vertrieb Leitung", "PRIMARY", "Servodata Führungskraft"),
    ("Externer Dienstleister", "PRIMARY", None),
)

_SECONDARY = ("Ersthelfer", "Brandschutzhelfer", "Datenschutzkoordinator", "Betriebsrat", "Mentor",
              "Qualitätsbeauftragter", "Key-User CRM", "Key-User Telefonie", "Projektteam Migration",
              "Schichtverantwortung", "Ausbilder", "Vertretung Teamleitung", "Arbeitsgruppe Alt")
_SKILLS = ("Queue Service", "Queue Vertrieb", "Queue Störung", "Queue Rückruf", "Queue Business",
           "Chat", "E-Mail-Bearbeitung", "Social Media", "Beschwerdemanagement", "Kündigerrückgewinnung",
           "Technik 1st Level", "Technik 2nd Level", "Englisch", "Französisch", "Türkisch", "Outbound")

_FIRST = ("Anna", "Ben", "Clara", "David", "Elif", "Felix", "Greta", "Hannes", "Ida", "Jonas", "Klara",
          "Lukas", "Mia", "Noah", "Olga", "Paul", "Rana", "Sven", "Tina", "Umut", "Vera", "Yusuf", "Zoe",
          "Marco", "Leonie", "Emre", "Sophie", "Tobias", "Aylin", "Niklas")
_LAST = ("Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz",
         "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Braun",
         "Zimmermann", "Krüger", "Hartmann", "Lange", "Werner", "Krause", "Lehmann", "Köhler", "Yılmaz",
         "Kaya", "Nowak", "Peters", "Jung", "Möller", "Vogel", "Friedrich", "Keller", "Günther")


def _resource_items(resources: list[dict]) -> list[dict]:
    """Wie `resource_items` in `/access/roles/`: dieselbe wirksame Menge wie `resources`, mit System."""
    return [{key: item[key] for key in ("resource_id", "display_name", "system_id", "system_short_name")}
            for item in resources]


def _roles(rng: random.Random, systems: list[dict]) -> list[dict]:
    all_resources = [{**item, "system_id": system["system_id"], "system_short_name": system["short_name"]}
                     for system in systems for item in system["resources"]]
    roles = []
    role_id = 100
    ids_by_name: dict[str, int] = {}
    for name, role_type, parent in _ROLE_TREE:
        role_id += 1
        ids_by_name[name] = role_id
        resource_count = rng.randint(2, 9) if role_type == "TEMPLATE" else rng.randint(1, 14)
        if name == "Externer Dienstleister":
            resource_count = 0
        own = rng.sample(all_resources, resource_count)
        # Wie `/access/roles/`: wirksame Ressourcen, also die der Vorfahren eingerechnet.
        inherited = next((role["_effective"] for role in roles if role["name"] == parent), [])
        effective = inherited + [item for item in own if item not in inherited]
        roles.append({
            "role_id": role_id, "name": name, "role_type": role_type, "role_status": "ACTIVE",
            "parent_role_id": ids_by_name.get(parent), "parent_role_name": parent,
            "resources": [item["display_name"] for item in effective], "resource_items": _resource_items(effective),
            "assigned_to": [], "_effective": effective,
        })
    for names, role_type in ((_SECONDARY, "SECONDARY"), (_SKILLS, "SKILL")):
        for name in names:
            role_id += 1
            effective = rng.sample(all_resources, 0 if name in ("Mentor", "Ausbilder") else rng.randint(1, 5))
            roles.append({
                "role_id": role_id, "name": name, "role_type": role_type,
                "role_status": "INACTIVE" if name == "Arbeitsgruppe Alt" else "ACTIVE",
                "parent_role_id": None, "parent_role_name": None,
                "resources": [item["display_name"] for item in effective], "resource_items": _resource_items(effective),
                "assigned_to": [],
            })
    for role in roles:
        role.pop("_effective", None)
    return roles


# ---------- User ----------

# process_type, Label wie in den derived_statuses der SD-API
_PROCESSES = {
    "onboarding": "Onboarding läuft",
    "offboarding": "Offboarding geplant",
    "change": "Abteilungswechsel läuft",
    "skill_assignment": "Rolle wird eingerichtet",
    "skill_removal": "Rolle wird entzogen",
    "training_schedule": "Schulung geplant",
}

# Wie viele User je Szenario einen laufenden Prozess haben
_PROCESS_COUNTS = {
    "quiet": {},
    "normal": {"onboarding": 2, "offboarding": 4, "change": 1, "skill_assignment": 9, "training_schedule": 3},
    "busy": {"onboarding": 6, "offboarding": 7, "change": 3, "skill_assignment": 38, "skill_removal": 4,
             "training_schedule": 8},
}
_OVERDUE = {"quiet": 0, "normal": 2, "busy": 9}
_INACTIVE_STATUS = {"code": "user_inactive", "label": "Inaktiv", "severity": "low", "is_overdue": False,
                    "reference_date": None}


def _users(rng: random.Random, roles: list[dict], scenario: str, today: date) -> list[dict]:
    primaries = [role for role in roles if role["role_type"] == "PRIMARY"]
    weights = [40 if role["name"] == "Agent" else 6 if role["name"] == "Externer Dienstleister" else 3
               for role in primaries]
    # Zwei Skills bleiben ohne User, damit der Schnellfilter "ohne User" etwas zeigt.
    extras = [role for role in roles if role["role_type"] in ("SECONDARY", "SKILL") and role["role_status"] == "ACTIVE"
              and role["name"] not in ("Türkisch", "Outbound")]
    users = []
    used_names = set()
    for index in range(118):
        while True:
            first, last = rng.choice(_FIRST), rng.choice(_LAST)
            if (first, last) not in used_names:
                used_names.add((first, last))
                break
        active = index >= 21
        primary = rng.choices(primaries, weights)[0]
        secondary = rng.sample(extras, rng.randint(0, 15)) if active else []
        entry = today - timedelta(days=rng.randint(40, 4000))
        racf = f"{last[:3].upper().replace('Ü', 'U').replace('Ö', 'O').replace('İ', 'I')}{rng.randint(1000, 9999)}"
        users.append({
            "user_id": 9000 + index,
            "pnr": str(400000 + rng.randint(1000, 99999)),
            "racf": racf,
            "xde": f"XDE{rng.randint(10000, 99999)}" if rng.random() < 0.6 else None,
            "first_name": first,
            "last_name": last,
            "email": f"{first.lower()}.{last.lower()}@servodata.example",
            "is_active": active,
            "entry_date": entry.isoformat(),
            "exit_date": (entry + timedelta(days=rng.randint(200, 1500))).isoformat() if not active else None,
            "primary_role": {"role_id": primary["role_id"], "name": primary["name"]},
            "secondary_roles": [{"role_id": role["role_id"], "name": role["name"], "role_type": role["role_type"],
                                 "assignment_status": "active"} for role in secondary],
            # Wie die SD-API: Inaktive tragen einen Status ohne Prozess (`_inactive_user_status`).
            "derived_statuses": [] if active else [dict(_INACTIVE_STATUS)],
        })
        for role in ([primary] if active else []) + secondary:
            role["assigned_to"].append(f"{first} {last}")

    active_users = [user for user in users if user["is_active"]]
    lifecycle = {"onboarding", "offboarding", "change"}
    for process_type, count in _PROCESS_COUNTS[scenario].items():
        # Eintritt, Austritt und Wechsel schliessen sich je User aus.
        pool = [user for user in active_users if process_type not in lifecycle
                or not any(status["process_type"].lower() in lifecycle for status in user["derived_statuses"])]
        for user in rng.sample(pool, count):
            reference = today + timedelta(days=rng.randint(-3, 21))
            if process_type == "onboarding":
                user["entry_date"] = reference.isoformat()
                if reference > today:
                    user["racf"] = user["xde"] = None  # Kennungen entstehen erst im Onboarding
            if process_type == "offboarding":
                user["exit_date"] = reference.isoformat()
            status = {
                "code": f"{process_type}_running", "label": _PROCESSES[process_type],
                # Die SD-API liefert den Typ gross (OFFBOARDING), wie der Enum ProcessType.
                "process_type": process_type.upper(), "process_id": rng.randint(5000, 9999),
                "severity": "warning" if process_type == "offboarding" else "info",
                "is_overdue": False, "reference_date": reference.isoformat(),
            }
            if process_type in ("skill_assignment", "skill_removal", "training_schedule"):
                role = rng.choice(extras)
                status["role_id"], status["role_name"] = role["role_id"], role["name"]
            if process_type == "change":
                target = rng.choice(primaries)
                status.update(source_role_name=user["primary_role"]["name"], target_role_name=target["name"])
            user["derived_statuses"].append(status)
    with_status = [user for user in active_users if user["derived_statuses"]]
    for user in rng.sample(with_status, min(_OVERDUE[scenario], len(with_status))):
        user["derived_statuses"][0]["is_overdue"] = True
        user["derived_statuses"][0]["severity"] = "error"
    return users


def mock_lists(scenario: str, today: date) -> dict:
    rng = random.Random(f"admin-lists-{scenario}")
    systems = _systems(scenario)
    roles = _roles(rng, systems)
    users = _users(rng, roles, scenario, today)
    return {"mock": scenario, "today": today.isoformat(), "systems": systems, "roles": roles, "users": users,
            "backlogs": _backlogs()}
