# Aufgabenseite als Kanban

Vorgemerkt am 14.10.2026, noch nicht geplant. Teil 2 von drei UI-Aufwertungen (Workspace: [workspace-redesign.md](workspace-redesign.md), Dashboard: [dashboard-redesign.md](dashboard-redesign.md)). Muss vor der Umsetzung ausgearbeitet und gebrainstormt werden.

## Idee des Nutzers

- Kanban-Struktur statt der bisherigen Liste, übersichtlicher.
- Jede Spalte bekommt eigene Gruppierung und Sortierung, je nachdem, was in der Spalte sinnvoll ist.
- Beispiel Spalte „In Bearbeitung“: gruppiert nach Bearbeiter. Ganz oben stehen die eigenen Aufgaben, darunter die Bearbeiter mit aktiven Aufgaben, leicht ausgegraut, damit klar ist, dass es nicht die eigenen sind. Man kann den Fortschritt eines Prozesses mitverfolgen.
- Einsicht in fremde Tasks richtet sich nach der Backlog-Zugehörigkeit: Backlog-Mitglieder sehen auch die Tasks, die ein Kollege im selben Backlog übernommen hat.

## Ausgangslage im Code

- `app/static/js/tasks.js` (rund 3000 Zeilen) und `app/static/js/task_view_model.js` mit Facetten `status`, `handling`, `taskType`, `backlog` und Gruppierung nach Person, Prozess, System, Backlog (`GROUP_DIMENSIONS`). Das Ansichtsmodell ist getestet und kann wiederverwendet werden.
- Die Filterleiste nutzt die geteilte Komponente `.ui-filter-*`.
- Gruppenschlüssel entstehen im Frontend aus `GET /sofa/tasks/overview`; offene Backend-Fragen stehen in [backend-request-task-grouping.md](backend-request-task-grouping.md) und [backend-request-bulk-tasks.md](backend-request-bulk-tasks.md).
- Aktuell gibt es die Tabs „Offen“ und „Meine“ (`task_view_model.js`, `activeTab`).

## Offene Fragen für das Brainstorming

1. **Spalten.** Welche? Naheliegend: Offen / In Bearbeitung / Erledigt. Muss aus den echten Task-Status des Backends abgeleitet werden; was ist mit blockierten, nachgelagerten (`DEFERRED`) und fehlgeschlagenen Tasks?
2. **Pro Spalte Gruppierung und Sortierung.** Vorschlag zum Diskutieren: Offen nach Priorität/Fälligkeit, In Bearbeitung nach Bearbeiter (eigene zuerst), Erledigt nach Abschlusszeit absteigend und zeitlich begrenzt.
3. **Fremde Tasks.** Backlog-Sichtbarkeit braucht eine Backend-Aussage: Liefert `tasks/overview` künftig auch fremde Tasks des Backlogs, oder gibt es eine eigene Abfrage? Welche Aktionen sind an fremden Tasks erlaubt (vermutlich keine)?
4. **Eigene Tasks.** Bleibt der Unterschied zwischen „Offen“ und „Meine“ als Filter, oder ergibt er sich aus der Gruppierung?
5. **Bestehende Funktionen.** Sammelaktionen (Bulk), Filter, Gruppierung nach Prozess/System: wohin in der Kanban-Ansicht? Die vorhandenen Gruppierungen dürfen nicht verloren gehen.
6. **Mengen.** Wie viele Tasks pro Spalte sind realistisch? Ab wann braucht eine Spalte Begrenzung oder „weitere“?
7. **Mobil.** Spalten als umschaltbare Streifen oder untereinander?
8. **Ausgegraut.** Nur Optik, oder auch eingeklappt? Barrierefreiheit: Grau allein reicht nicht, ein Bearbeitername steht ohnehin als Gruppenkopf.
9. **Aktualisierung.** Fremde Fortschritte sollen mitverfolgt werden können; reicht Neuladen, oder braucht es periodisches Nachladen wie beim Genesys-Live-Report?

## Regeln

Knappe UI-Texte (keine erklärenden Untertitel), deckende Flächen ohne Transparenz. Layout-Technik mit getrennt scrollenden Bereichen kann aus dem Workspace-Umbau übernommen werden.
