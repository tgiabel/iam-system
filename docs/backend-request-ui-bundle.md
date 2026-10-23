# Anfrage an die SD-API: Aufgaben-Board und Dashboard

Stand 23.10.2026, **Entwurf, noch nicht versendet**. Bündelt alle offenen Wünsche aus dem Umbau der Aufgabenseite (Kanban) und des Dashboards. Ersetzt [backend-request-kanban-visibility.md](backend-request-kanban-visibility.md), [backend-request-event-summary.md](backend-request-event-summary.md) und Punkt 2 aus [backend-request-task-grouping.md](backend-request-task-grouping.md). Die Bulk-Endpunkte bleiben in [backend-request-bulk-tasks.md](backend-request-bulk-tasks.md).

Grundlage ist die SD-API-Arbeitskopie vom 17.09.2026 (`ec2adf6`). Bitte gegen den aktuellen Stand prüfen; was es inzwischen gibt, einfach streichen.

Alles ist additiv: bestehende Felder, Endpunkte und Texte bleiben, damit ein Rollback der SD-API SOFA nicht bricht.

## Überblick

| # | Wunsch | Priorität | Aufwand (Einschätzung SOFA) |
|---|---|---|---|
| A1 | Fremde Tasks in Bearbeitung im Overview, Sichtbarkeit je Backlog | Muss | mittel |
| A2 | Erledigte Tasks im Overview (`completed_since`) | Muss | klein |
| A3 | Felder `assigned_to_user_name`, `assigned_at`, `completed_at` | Muss | klein (Joins auf `users`/`task_logs`) |
| A4 | Feld `blocked_by` auf blockierten Tasks | Soll | mittel |
| B1 | Freigeben mit Kommentar | Muss | klein |
| B2 | Notiz ohne Statuswechsel (`COMMENTED`) | Soll | klein |
| B3 | Automatisierung schließt bei Erfolg selbst ab | Muss | klein |
| C1 | Name zum Verlaufseintrag (`user_name`) | Muss | klein |
| C2 | Feste Reihenfolge im Verlauf | Muss | trivial |
| C3 | Mail-Snapshot mit den tatsächlich verwendeten Feldern | Soll | klein |
| D1 | Event-Felder `role_name`, `process_type`, `user_name` | Muss | klein |
| D2 | Servicelevel-Route fertigstellen | Muss | klein (Branch existiert) |

„Muss“ heißt: ohne den Punkt geht die jeweilige Seite nicht mit echten Daten live.

## A. Aufgabenübersicht `GET /sofa/tasks/overview`

Heute liefert der Endpunkt `open_tasks`, `blocked_tasks` (beide nur aktive, `active_at <= NOW()`) und `user_tasks` (eigene in Bearbeitung) als `TaskContext`. `system_id`, `system_name`, `process_id`, `process_type` und `archived_accounts` sind bereits enthalten und reichen uns; `process_name` brauchen wir nicht mehr.

### A1. Fremde Tasks in Bearbeitung

Neue Liste `others_in_progress_tasks`: Tasks mit `status = IN_PROGRESS`, einem anderen Bearbeiter als `user_id` und einem Backlog, den `user_id` sehen darf. Fremde Tasks sind nur lesbar; Übernehmen, Freigeben und Abschließen bleiben für sie verboten.

Sichtbarkeitsregel, bitte in der SD-API durchsetzen (SOFA filtert zusätzlich, verlässt sich aber nicht allein darauf):

- Wer Mitglied eines Backlogs ist, sieht alle Tasks dieses Backlogs.
- Tasks **ohne** Backlog (`backlog_identifier` leer) sieht jeder mit `SOFA-PAGE-TODO`, auch fremde. Darüber laufen einfache Aufgaben, die alle bearbeiten dürfen.
- `SOFA-BKLG-ALL` sieht alles. Im Zielbild hat diese Berechtigung nur noch ein Admin-Konto auf Abruf; bitte keine weitere Logik daran hängen.

### A2. Erledigte Tasks

Neue Liste `completed_tasks` mit Parameter `completed_since` (Datum, Berliner Ortszeit; SOFA fragt höchstens den laufenden Monat ab). Sortiert nach `completed_at` absteigend, gleiche Sichtbarkeitsregel wie A1. Eine Obergrenze (z. B. 500) ist in Ordnung, dann bitte mit einem Hinweis wie `completed_truncated: true`.

Die eigenen erledigten Tasks daraus nutzt auch das Dashboard („Mein Tag“); dafür braucht es keinen eigenen Endpunkt.

### A3. Zusätzliche Felder je Task

| Feld | Quelle (Vorschlag) | Zweck |
|---|---|---|
| `assigned_to_user_name` | `users` über `assigned_to_user_id`, Format „Nachname, Vorname“ wie `target_user_name` | Gruppenkopf „In Bearbeitung“, „erledigt von“ |
| `assigned_at` | jüngster `ASSIGNED`-Eintrag in `task_logs` | Sortierung, „seit 3 T in Bearbeitung“ |
| `completed_at` | jüngster `COMPLETED`-Eintrag in `task_logs` | Spalte „Erledigt“, „Mein Tag“ |

Eine neue Spalte in `tasks` ist nicht nötig, es sei denn, ihr haltet sie für einfacher. Falls ihr ableitet: ein Index auf `task_logs (task_id, action)` dürfte reichen.

### A4. `blocked_by` (Soll)

Blockierte Tasks sollen nennen, worauf sie warten (heute „Elternressource derselben Person“, z. B. Genesys-Konto vor Genesys-Gruppe):

```json
"blocked_by": { "task_id": 5101, "resource_name": "Genesys-Benutzer", "status": "IN_PROGRESS" }
```

`null`, wenn nicht ermittelbar. Ohne das Feld zeigt SOFA nur „Blockiert“.

## B. Aktionen

### B1. Freigeben mit Kommentar

`DELETE /sofa/tasks/{id}/assign` nimmt optional `comment` an (Query oder Body, wie es für euch passt) und schreibt ihn in den `RELEASED`-Eintrag. Heute geht ein Kommentar beim Freigeben verloren.

### B2. Notiz ohne Statuswechsel (Soll)

Neue `TaskAction.COMMENTED` und `POST /sofa/tasks/{id}/comments` mit `{ "user_id": 42, "comment": "…" }`. Erlaubt nur für eigene Tasks in Bearbeitung; leerer Kommentar → 422.

### B3. Automatisierung schließt selbst ab

`integrate_user_in` (heute synchron, nur Genesys): bei Erfolg den Task im selben Ablauf abschließen. Account-Kennung ist die `user_id` aus dem Ergebnis, sofern es eine Konto-Zuweisung ist. Bei Fehlschlag bleibt der Task in Bearbeitung, der Fehler steht wie bisher im `BOT_RESPONSE`-Eintrag.

Der Text „Integration gestartet - Warten auf Antwort“ im `BOT_DISPATCHED`-Eintrag passt dann nicht mehr; bitte auf „Integration gestartet“ kürzen.

Nicht gewünscht: ein Abschluss direkt aus „Offen“ im Backend. SOFA ruft dafür erst Übernehmen und dann Abschließen auf.

## C. Verlauf `GET /sofa/tasks/{id}/history`

Der Verlauf wird immer komplett geladen, Paginierung brauchen wir nicht.

- **C1.** `user_name` je Eintrag (Join auf `users`, `null` bei Systemeinträgen). Heute zeigt SOFA nur IDs.
- **C2.** `ORDER BY timestamp, log_id`. Bei gleichen Zeitstempeln ist die Reihenfolge heute nicht festgelegt.
- **C3 (Soll).** `send_mail` protokolliert in `MAIL_SENT.details` heute den ursprünglichen Request. Bitte stattdessen die tatsächlich eingestellten Werte: `recipient`, `cc` nach `_merge_cc` (inklusive automatisch ergänzter Adresse), `bcc`, `subject`, `body`, `sender`, `initiator_user_id`. Dafür die zusammengeführte CC einmal berechnen und an `queue_mail` und ins Log geben. Alte Einträge bleiben, wie sie sind.

## D. Dashboard

### D1. Event-Felder `GET /sofa/events`

`EventListItem` um drei Felder ergänzen, die `event_service.list_events` schon kennt und nach `_build_event_copy` verwirft:

| Feld | Typ | Inhalt |
|---|---|---|
| `role_name` | `string \| null` | Rollenname (Skill bei Schulungen) |
| `process_type` | `string \| null` | `CHANGE`, `ONBOARDING`, … |
| `user_name` | `string \| null` | „Vorname Nachname“ |

Ohne die Felder liest SOFA Skill und Namen aus dem Beschreibungstext und erkennt den Abteilungswechsel am Titel; das bricht bei der nächsten Textänderung. Optional: ein eigener Titel für `RETRAIN` („Nachschulung“) statt „Event“.

### D2. Servicelevel `GET /reporting/service-level`

Liegt auf `feature/service-level-reporting` (`f4ec0dc`, nicht deployt). Vor dem Merge:

- Bug: Tagesgrenzen über `P1D` ohne Zeitzone, an Sommerzeit-Wechseln falsch. Bitte mit `Europe/Berlin` rechnen.
- Antwort wie besprochen: `target_ratio`, `queues[{queue_id,label}]`, `scope{type,id,label}`, `day{date,…}`, `month{month,…}`, `previous_month{month,…}`, `days[7]{date,…}` (die sieben Tage vor heute), jeweils `ratio, numerator, denominator`. Ohne Parameter alle `[PROD]_`-Queues, mit `queue_id` eine Queue. Grundlage `oServiceLevel` aus den Genesys-Aggregaten.
- Gruppen (`group_id`, `groups[]`) erst mit dem Servicelevel-Report; jetzt nicht nötig.

## Nicht mehr nötig

- `in_progress_total` (Dashboard-Kacheln entfallen).
- Paginierter Verlauf (siehe C).
- Eigener Endpunkt für „Mein Tag“ (siehe A2); Tickets entfallen mangels Quelle.
- `process_name` auf Overview-Items (der Typ reicht).
- Strukturierter Abschlusskontext (auslösende Task-ID bei mit abgeschlossenen Entzügen): kommt mit dem Sammelabschluss. Bis dahin vermerkt SOFA den Zusammenhang im Abschlusskommentar.
- `ETag`/`updated_since` für das Nachladen: SOFA lädt die Übersicht zunächst komplett neu (alle 30–60 Sekunden bei sichtbarem Tab).

## Fragen

1. Wie groß wird `tasks/overview` bei großen Backlogs mit A1 und A2 (Tasks und Bytes)? Davon hängt ab, ob wir doch `updated_since` brauchen.
2. Ist `process_id = null` bei einem Teil der Tasks gewollt (z. B. nachgelagerte Tasks) oder ein Altbestand? (aus [backend-request-task-grouping.md](backend-request-task-grouping.md))
3. Darf `GET /sofa/tasks/{id}/history` für fremde Tasks desselben Backlogs aufgerufen werden? Wir würden es gern erlauben (nur lesend).
4. `CANCELLED` blendet SOFA im Board aus. Gibt es Fälle, in denen ein abgebrochener Task sichtbar bleiben sollte?

## Danach auf SOFA-Seite

- Proxy `/api/tasks/overview`: neue Listen durchreichen, Filter um die Backlog-Regel aus A1 ergänzen.
- Board an echte Daten anschließen, Mock bleibt nur in der Entwicklungsinstanz.
- `/api/events` von `SOFA-PAGE-CNSL` auf Login umstellen (Kalender für alle).
- Dashboard: Servicelevel und „Mein Tag“ an echte Quellen.
