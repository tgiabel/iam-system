# Anfrage an die SD-API: Listen für Systemverwaltung und Rollenmanagement

Stand 17.11.2026. SOFA baut die Verwaltungsseiten Userverwaltung, Rollenmanagement und Systemverwaltung neu.
Die Seiten sind in [table-pages.md](table-pages.md) beschrieben. Diese Anfrage fasst zusammen, was SOFA dafür von
der SD-API braucht. Die Fragen aus der Vorrunde sind beantwortet und hier schon eingearbeitet.

> **Umgesetzt** in SD-API `7bc2533` auf `master` (17.11.2026), noch nicht deployt. Abweichungen siehe
> [Antwort der SD-API](#antwort-der-sd-api-17112026) am Ende.

Alle Änderungen sind **additiv**. Bestehende Felder bleiben in Form und Bedeutung gleich, vor allem
`resources` in der Rollenliste: Das bleibt eine Liste von Namen.

## 1. `GET /access/systems/`: neue Felder je System

| Feld | Inhalt |
|---|---|
| `default_handling_type` | Die Spalte gibt es schon, sie fehlt nur in `SystemListItem`. |
| `resources` | `[{resource_id, display_name, type_name, handling}]`. `handling` ist der wirksame Wert `COALESCE(r.override_handling_type, s.default_handling_type)`. |
| `user_count` | `COUNT(DISTINCT user_id)` über `resource_assignments` mit Status ACTIVE, verbunden über `resources.system_id`. |
| `open_tasks` | Aufgaben mit Status OPEN, IN_PROGRESS oder BLOCKED. |
| `blocked_tasks` | Davon die mit Status BLOCKED. |
| `overdue_tasks` | Davon die überfälligen: Der Datumsanteil von `process_milestones.scheduled_at` liegt vor dem heutigen lokalen Datum. Aufgaben ohne Meilenstein sind nie überfällig. Das entspricht `dueInfo` auf der Aufgabenseite. |

- `resource_names` bleibt erhalten.
- Bitte über wenige Sammelabfragen umsetzen, nicht über eine Abfrage je System.

### Aufgabenzahlen je Betrachter

Die Zahlen sollen zu dem passen, was der Betrachter auf seiner Aufgabenseite sieht. Die Systemverwaltung springt
aus dem Zeilenmenü direkt dorthin (`/tasks?system=<id>`).

Die SD-API braucht dafür **keinen Sitzungskontext**. SOFA schickt die sichtbaren Backlogs als Parameter mit:

- `task_backlogs=<id>,<id>,…`: zählt nur Aufgaben aus diesen Backlogs.
- Ohne Parameter: zählt alle Aufgaben. So ruft SOFA den Endpunkt bei `SOFA-BKLG-ALL` auf.

Ein anderer Weg, der dasselbe Ergebnis bringt, ist auch in Ordnung. Bitte sag dann kurz Bescheid.

## 2. `GET /access/roles/`: neue Felder je Rolle

| Feld | Inhalt |
|---|---|
| `parent_role_id` | `fetch_roles` liest die Spalte schon, sie fehlt nur in `RoleListItem`. |
| `resource_items` | `[{resource_id, display_name, system_id, system_short_name}]`, dieselbe wirksame Menge wie `resources`, also mit den geerbten Ressourcen. |

Den Vorschlag `resource_items` haben wir übernommen. Eine Zuordnung über den Namen wäre nicht eindeutig, weil
`display_name` keinen Unique-Key hat.

## 3. `POST /access/roles/{id}`: Sperre beim Deaktivieren

SOFA bietet „Deaktivieren“ nur für Rollen an, die keine User haben und keine aktiven Kindrollen. Beim Speichern
schickt SOFA die vollständige aktuelle Rolle mit, inklusive `parent_role_id` und `description`, und setzt
`status` auf INACTIVE.

Bitte zusätzlich in der API absichern: Für `status: INACTIVE` antwortet der Endpunkt mit **409**, solange es
noch eines davon gibt:

- aktive Zuweisungen der Rolle,
- aktive Kindrollen.

Die Antwort soll eine Meldung enthalten, die SOFA anzeigen kann.

## Für später, nicht Teil dieses Changes

- User je System, für den Sprung `/users?system=<id>` aus der Systemverwaltung.

## Nebenbefunde, getrennt zu behandeln

- `GET /access/logs/assignments` joint die nicht existierende Tabelle `resource_assignment`
  (`app/modules/access/api/log_router.py:33`).
- Die System-Routen prüfen keine Rechte. Sie sind nur über die SOFA-BFF geschützt.
- `GET /access/users/?is_active=false` liefert **alle** User, nicht nur die inaktiven. SOFA nutzt das so. Der
  Parametername führt aber in die Irre, deshalb bitte das Verhalten wenigstens in der API-Doku festhalten.

## Antwort der SD-API (17.11.2026)

Umgesetzt wie angefragt, mit diesen Abweichungen und Details:

- **Neuer Parameter `task_unbacklogged=true`.** Wer `SOFA-PAGE-TODO` hat, sieht auf der Aufgabenseite auch Aufgaben
  ohne Backlog. So ruft SOFA auf:
  - bei `SOFA-BKLG-ALL` ohne Parameter;
  - sonst mit `task_backlogs=<sichtbare Backlogs>`, dazu `&task_unbacklogged=true`, wenn der Betrachter
    `SOFA-PAGE-TODO` hat.

  Ein leeres `task_backlogs=` heißt „kein Backlog sichtbar“, nicht „alle“.
- **Ab wann OPEN und BLOCKED zählen:** erst ab `active_at`, wie auf der Aufgabenseite. IN_PROGRESS zählt
  immer.
- **Die Sperre beim Deaktivieren** greift nur beim Wechsel von ACTIVE auf INACTIVE.
  - Als laufende Zuweisung gilt ACTIVE, REQUESTED oder REVOCATION_REQUESTED. `assigned_to` zeigt nur ACTIVE, die
    Sperre ist also strenger.
  - SOFA kann deshalb selten „Deaktivieren“ anbieten und trotzdem eine 409 bekommen. Die Meldung in `detail` wird
    direkt angezeigt.
- **`resource_items`** hat dieselbe Reihenfolge und Menge wie `resources`, inklusive der geerbten Ressourcen.
- **`resource_names`** in der Systemliste bleibt unverändert.
