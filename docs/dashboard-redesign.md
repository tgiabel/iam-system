# Dashboard neu aufbauen

Vorgemerkt am 14.10.2026, noch nicht geplant. Teil 3 von drei UI-Aufwertungen (Workspace: [workspace-redesign.md](workspace-redesign.md), Aufgaben: [tasks-kanban.md](tasks-kanban.md)). Platzierung und Inhalte müssen gebrainstormt werden.

## Ideen des Nutzers

- Das Dashboard wurde lange mitgeschleppt; Teile der Workspace-Funktionen sollen direkt dort stehen.
- **Genesys Cloud Live:** nur die Seitenleiste (das Panel) ohne Filterfunktion, über alle Queues, damit man beim Start sofort sieht, was los ist.
- **Kalender:** bleibt, wird aber stärker nach Ereignisart zusammengefasst, zum Beispiel „x Onboardings geplant“ oder „eine <Skill>-Schulung für x Mitarbeiter geplant“. Jede Ereignisart bekommt ihre eigene sinnvolle Zusammenfassung.
- **Tageszusammenfassung** des aktuellen Tages oben, eventuell.
- **Pins aus dem Workspace** (bis zu 4 Tools und Reports) erscheinen im Dashboard.

## Ausgangslage im Code

- `app/templates/dashboard.html` mit Stör-Banner, Kachel „Tasks“ (zwei Zahlen), statischer „Pinnwand“ mit drei fest eingetragenen Einträgen und deaktivierter Kachel „Neues Element“, und dem Wochenkalender aus `console.js`.
- Der Wochenkalender kennt „+ N weitere“ mit Modal pro Tag.
- Das Genesys-Live-Panel ist in `app/static/js/reports/genesys_live.js` und `genesys_live.css` gebaut; für die Wiederverwendung müsste der Panel-Teil ohne Kartenstreifen und Queue-Filter herauslösbar sein. Datenquelle ist `GET /api/reporting/genesys-live`; Abruf alle 15 Sekunden, nur bei sichtbarem Tab. Es ist ein persönlicher Report mit signiertem Cookie (`sofa_agent_stats`), die Anzeige hängt also an der Genesys-Einrichtung des Nutzers.
- Pins kommen aus dem Workspace-Umbau: `localStorage`-Menge von Katalog-IDs (`sofa.workspace.pins.v1.<user_id>`), gemeinsames Modul `workspace_pins.js`. Der Katalog muss dazu im Browser des Dashboards vorliegen (JSON im Template oder kleine Route).

## Offene Fragen für das Brainstorming

1. **Aufbau.** Welche Bereiche, in welcher Reihenfolge? Was gehört nach oben (Störung, Tageszusammenfassung, Live-Lage)? Geteilte Bereiche mit eigener Scrollung wie im Workspace, oder eine ruhige Seite mit Seitenscroll?
2. **Live-Panel für alle.** Nicht jeder hat die Genesys-Einrichtung. Was sehen Nutzer ohne? Standard „Alle Queues“ ist bereits beim Report offen als Feedbackpunkt („Alle“ vs. „Meine“).
3. **Tageszusammenfassung.** Welche Zahlen: eigene offene Tasks, Termine heute, Störungen, Besetzung? Pro Rolle verschieden?
4. **Kalender nach Ereignisart.** Welche Ereignisarten gibt es (aus den Prozessen: Onboarding, Schulung, Austritt …)? Pro Art eine Zusammenfassungsregel und eine Detailansicht beim Klick. Benötigte Felder (Anzahl Personen, Skill, Zeitraum) müssen die Prozess-Events liefern; das ist vorab am Payload zu prüfen.
5. **Pinnwand.** Anzeige als Kachel-Reihe; Verhalten ohne Pins (leer ausblenden oder Hinweis auf den Workspace).
6. **Tasks-Kachel.** Bleibt sie, oder wird sie durch die Kanban-Zusammenfassung ersetzt?
7. **Rechte.** Jede Kachel nur für Nutzer mit dem jeweiligen Recht.

## Regeln

Knappe UI-Texte (keine erklärenden Untertitel), deckende Flächen ohne Transparenz. Die bisherigen erklärenden Untertitel im Dashboard (`ui-section-copy`) sind bei der Überarbeitung zu streichen. Das Live-Panel erst einbauen, wenn die SD-API-Route `GET /reporting/genesys-live` in Prod deployt ist.
