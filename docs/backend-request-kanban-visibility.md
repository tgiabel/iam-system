# Anfrage an Backend-Team: Tasks anderer Bearbeiter und erledigte Tasks für die Kanban-Ansicht

> Abgelöst durch [backend-request-ui-bundle.md](backend-request-ui-bundle.md) (23.10.2026). Bleibt als Verlauf stehen.

## Hintergrund

Die Aufgabenseite wird zu einem Kanban-Board umgebaut (Spalten „Offen“, „In Bearbeitung“, „Erledigt“,
jede mit eigener Gruppierung und Sortierung, siehe `docs/tasks-kanban.md`). Zwei Wünsche gehen über das
hinaus, was die Seite heute bekommt:

1. In der Spalte „In Bearbeitung“ soll man neben den eigenen Tasks auch die Tasks sehen, die Kollegen
   **im selben Backlog** übernommen haben, um den Fortschritt eines Prozesses mitzuverfolgen. Diese Tasks
   sind lesbar, aber nicht bearbeitbar.
2. Die Spalte „Erledigt“ braucht kürzlich abgeschlossene Tasks.

Wer solche Tasks sieht, richtet sich allein nach der **Backlog-Zugehörigkeit**: Wer Mitglied eines Backlogs
ist (oder `SOFA-BKLG-ALL` hat), sieht alle Tasks dieses Backlogs, auch die, die ein anderer übernommen hat.

## Was wir heute wissen

`GET /sofa/tasks/overview?user_id={id}` liefert für uns die Listen `open_tasks`, `blocked_tasks`,
`user_tasks` und `completed_tasks`. SOFA verwirft `completed_tasks` im Proxy (`/api/tasks/overview`) und
filtert die übrigen Listen nach `backlog_identifier` gegen die Backlogs des Nutzers
(`SOFA-BKLG-*`; ohne Backlog-Zuordnung genügt `SOFA-PAGE-TODO`).

Ob dort heute Tasks mit `status = IN_PROGRESS` und fremdem `assigned_to_user_id` enthalten sind, ist uns
nicht klar. Aus den Listennamen schließen wir: nein, `user_tasks` enthält nur die eigenen.

## Fragen zum Ist-Stand

1. Welche Tasks enthält jede der vier Listen genau? Insbesondere: Taucht ein von einem Kollegen
   übernommener Task (`IN_PROGRESS`, anderer `assigned_to_user_id`) irgendwo auf?
2. Was ist die vollständige Menge der Task-Status? Wir kennen `OPEN`, `IN_PROGRESS`, `COMPLETED` und
   `BLOCKED`. Gibt es weitere (abgebrochen, fehlgeschlagen, storniert)?
3. Wie bestimmt das Backend „blockiert“: eigener Status oder abgeleitet aus Abhängigkeiten
   (`provisioning_requirement: "DEFERRED"`)?

## Wunsch 1: Tasks anderer Bearbeiter

**Vorschlag:** `GET /sofa/tasks/overview` bekommt eine weitere Liste `others_in_progress_tasks`
(Name frei wählbar) mit Tasks, die

- `status = IN_PROGRESS` haben,
- einem **anderen** User zugewiesen sind als `user_id`,
- und zu einem Backlog gehören, in dem `user_id` Mitglied ist.

Die Sichtbarkeit sollte das Backend selbst durchsetzen, nicht nur das Frontend. Wir filtern zusätzlich im
Proxy, würden uns aber nicht allein darauf verlassen.

Je Task brauchen wir zusätzlich zu den bisherigen Feldern:

| Feld | Zweck |
|---|---|
| `assigned_to_user_id` | Gruppierung nach Bearbeiter |
| `assigned_to_user_name` | Gruppenkopf (Anzeigename, nicht mehr als bisher in `target_user_name`) |
| `assigned_at` (oder `started_at`) | Sortierung innerhalb der Gruppe, älteste zuerst |
| `process_id`, `process_name` | Fortschritt eines Prozesses verfolgen |
| `backlog_identifier` | Sichtbarkeit, Gruppierung |

Fremde Tasks sind **nur lesbar**. Wir gehen davon aus, dass `PATCH`/`DELETE .../assign` und
Sammelaktionen auf fremde Tasks weiterhin mit `403` (`assignment_denied`) antworten. Bitte bestätigen.

Fragen dazu:

1. Tasks **ohne** Backlog (`backlog_identifier` leer) bleiben für alle mit `SOFA-PAGE-TODO` sichtbar,
   auch fremde in Bearbeitung und erledigte. So lassen sich einfache Aufgaben behandeln, die jeder
   bearbeiten darf. Bitte dieselbe Regel serverseitig umsetzen.
2. Darf `GET /sofa/tasks/{id}/history` für fremde Tasks desselben Backlogs aufgerufen werden, oder bleibt
   das auf eigene und offene Tasks beschränkt? (Heute prüft SOFA nur die Backlog-Sichtbarkeit.)
3. Soll der Bearbeitername im Backlog für alle Mitglieder sichtbar sein? Falls das datenschutzrechtlich
   abgestimmt werden muss, bitte Bescheid geben, bevor wir das in der Oberfläche bauen.

## Wunsch 2: Erledigte Tasks

Die Spalte „Erledigt“ soll die zuletzt abgeschlossenen Tasks zeigen, begrenzt (z. B. letzte 7 Tage oder
höchstens 50 Einträge, was für uns sinnvoll ist, sagt ihr).

**Vorschlag:** `completed_tasks` wird begrenzt und nach `completed_at` absteigend geliefert, mit
`completed_at`, `assigned_to_user_id`, `assigned_to_user_name` und den üblichen Task-Feldern. Wenn Backlog-
Mitglieder auch erledigte Tasks von Kollegen sehen sollen, gilt dieselbe Regel wie in Wunsch 1; wenn nur die
eigenen, bitte das so lassen.

Fragen dazu:

1. Gibt es schon eine Begrenzung (Zeitraum oder Anzahl) und lässt sie sich per Parameter steuern, zum
   Beispiel `completed_since` oder `completed_limit`?
2. Ab wann gilt ein Task als „erledigt“: reicht `status = COMPLETED`, oder gibt es Nacharbeiten, die ihn
   wieder öffnen können?

## Aktualisierung

Die Seite lädt heute beim Öffnen nach. Für das Mitverfolgen fremder Tasks würden wir gern periodisch
nachladen (z. B. alle 30–60 Sekunden, nur bei sichtbarem Tab). Wenn das Backend dafür etwas anbieten kann,
würden wir es nutzen, sonst laden wir die ganze Übersicht neu:

- `ETag`/`If-None-Match` oder ein `updated_since`-Parameter auf `tasks/overview`, oder
- ein leichter Endpunkt mit Zähler/Zeitstempel der letzten Änderung.

Bitte eine Einschätzung zur Antwortgröße von `tasks/overview` bei einem großen Backlog.

## Stand auf unserer Seite

Noch nichts umgesetzt. Die Kanban-Ansicht kann mit den bestehenden Listen (`open_tasks`, `blocked_tasks`,
`user_tasks`) beginnen. Die Spalten „In Bearbeitung“ (fremde Tasks) und „Erledigt“ bleiben bis zu eurer
Antwort auf die eigenen Tasks beschränkt, dort ändert sich danach nur die Datenquelle.
