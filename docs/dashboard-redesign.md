# Dashboard-Umbau

Plan vom 14.10.2026. Teil 3 von drei UI-Aufwertungen (Workspace: [workspace-redesign.md](workspace-redesign.md), Aufgaben: [tasks-kanban.md](tasks-kanban.md)). Das Dashboard soll beim Start zeigen, was gerade los ist.

## Ideen des Nutzers

- **Genesys Cloud Live:** nur das Panel ohne Filter, über alle Queues.
- **Kalender:** bleibt, aber je Ereignisart zusammengefasst („x Onboardings geplant“, „<Skill>-Schulung für x Mitarbeiter“).
- **Tageszusammenfassung** des aktuellen Tages oben, eventuell.
- **Pins** aus dem Workspace ersetzen die statische Pinnwand.

## Befunde im Code

### Kalender-Events

Quelle ist `GET /sofa/events` der SD-API (`event_service.list_events`), in SOFA `GET /api/events` über `_normalize_events_payload`.

- **Ereignisarten:** `ONBOARDING`, `OFFBOARDING`, `ROLE_ASSIGNMENT`, `ROLE_REMOVAL`, `TRAINING_SCHEDULE`, `RETRAIN`. Ein Abteilungswechsel (Prozesstyp `CHANGE`) besteht aus zwei Events mit den Typen `ROLE_ASSIGNMENT` und `ROLE_REMOVAL`; er ist nur am Titel „Abteilungswechsel: …“ erkennbar. `RETRAIN` hat keinen eigenen Text und heißt „Event“.
- **Status:** `PLANNED`, `EXECUTED`, `SKIPPED`, `FAILED`, `CANCELED`.
- **Felder im SOFA-Payload:** `title`, `description`, `event_type`, `event_status`, `blocks_process_completion`, `scheduled_at`, `executed_at`, `display_at`, `user_id`, `process_id`, `role_id`. Die SD-API liefert zusätzlich `event_id`, `task_id`, Fehlerfelder; SOFA verwirft sie.
- **Personenzahl:** über verschiedene `user_id` möglich (kann `null` sein, dann Events zählen).
- **Skill:** nur als `role_id` und im Beschreibungstext („<Rolle> Schulung für <Name>.“). Der Rollenname steht nicht als Feld im Payload (`role_name` und `process_type` werden in der SD-API nur für den Text verwendet und dann verworfen). Text parsen ist fragil; Namen über `/api/roles` auflösen braucht `SOFA-PAGE-ROLE`. Siehe [backend-request-event-summary.md](backend-request-event-summary.md).
- **Zeitraum:** ein einzelner Zeitpunkt `scheduled_at`, kein Von/Bis. „Zeitraum“ ist die sichtbare Woche.
- **Menge:** SOFA ruft ohne `from_date`/`to_date` ab, also alle Events aller Zeiten. Die SD-API kennt beide Parameter.
- **Rechte:** `/api/events` verlangt `SOFA-PAGE-CNSL` und liefert alle Events der Organisation, nicht nur eigene. Das Dashboard zeigt den Kalender heute jedem Nutzer; ohne das Recht kommt ein Fehler, und die Überschrift „Deine Prozess-Events“ stimmt nicht. Dasselbe gilt für die Tasks-Kachel (`SOFA-PAGE-TODO`).
- Die Dev-Datenbank enthält derzeit keine Events; Tests und Sichtprüfung brauchen eine Fixture.

### Genesys-Live-Panel

- `genesys_live.js` ist ein Skript mit globalem Zustand und festen Element-IDs (`panelContent`, `panelTitle`, …). Das Panel (`renderPanel`, `kpiRow`, `kpiGroup`, `infoTip`) hängt an `live`, `selectedId` und `panelOpen`. Karten, Karussell und Filter sind getrennt davon.
- `genesys_live.css` ist komplett unter `.gl-page` gescoped, auch die Farb-Token (inklusive dunkel/servodata). Ein Wrapper `.gl-page` im Dashboard reicht für die Token; seitenspezifische Regeln (`body:has(#genesysLive)`, `.page`, `.dashboard-layout`) bleiben außen vor.
- `tests/genesys_live_checks.js` schneidet den Quelltext bei `for(const scroller …` ab und führt ihn im `vm` aus. Eine Aufteilung braucht eine Anpassung dieses Tests.
- **Ohne Einrichtung:** Fehlt das Secret (`is_configured()` falsch), blenden Workspace und Seite Genesys aus. Ist das Secret da, aber das Cookie `sofa_agent_stats` fehlt oder passt nicht (Login vor der Einrichtung), liefert die BFF-Route 401 und die Seite leitet auf `/login`. Ein nicht verknüpftes Genesys-Konto (`account_linked=false`) betrifft nur `mine`; `total` kommt trotzdem. Das Panel „alle Queues“ braucht also kein persönliches Genesys-Konto.
- Die Route `/api/reporting/genesys-live` verlangt nur Login. Die SD-API mit `GET /reporting/genesys-live` ist im Prod-Container vorhanden.

### Katalog und Pins

- `visible_items(authz, is_configured())` liefert je Nutzer die sichtbaren Einträge. Die Workspace-Kachel ist ein Klon der Listenzeile (`workspace_item`), das Dock stylt sie per CSS zur quadratischen Kachel.
- `dashboard.html` kennt heute nur `user`; `index()` erzeugt `authz` nicht selbst, `_build_template_context` baut es aus der Sitzung.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Rolle der Seite | Lagebild: oben, was jetzt wichtig ist (Störung, heute), daneben die Live-Lage, darunter Schnelleinstieg und Kalender. Keine erklärenden Texte, keine Badges, keine Kicker; alle `ui-section-copy` entfallen. |
| Titel | „Dashboard“ mit Akzentstrich wie „Workspace“. Keine Begrüßung, keine Rollen- und PNR-Chips. |
| Layout breit (ab 1100 px) | Kein Seitenscroll (Technik wie Workspace und Genesys Live). Links ein Hauptbereich, rechts das Live-Panel in fester Breite `clamp(340px, 27vw, 430px)`. Der Hauptbereich scrollt bei Bedarf für sich, das Panel für sich. |
| Layout schmal | Eine Spalte mit Seitenscroll. Reihenfolge: Störung, Heute, Live, Pins, Kalender. |
| Reihenfolge links | Störung (nur wenn aktiv, volle Breite), Heute-Leiste, Pins, Kalender. |
| Fehlt ein Bereich | Er entfällt samt Spalte; der Rest nutzt die Breite (mit Maximalbreite). Kein Platzhalter, keine Fehlermeldung für fehlende Rechte. |
| Heute-Leiste | Eine schmale Zeile „Heute · Mi, 14.10.“ mit bis zu drei Zahlen, jede ein Link: **Meine Aufgaben** (mit „davon überfällig“ in Warnfarbe, wenn > 0; Recht `SOFA-PAGE-TODO`), **Offen** (offen plus blockiert; `SOFA-PAGE-TODO`), **Termine** heute (aus den Kalenderdaten; `SOFA-PAGE-CNSL`). Ersetzt die Tasks-Kachel. Die Besetzung steht im Live-Panel und wird nicht doppelt gezeigt. Die Kanban-Zusammenfassung bleibt bis zum Aufgaben-Umbau offen. |
| Störung | Banner bleibt, aber ohne Inline-Styles, im Stil der übrigen Flächen, deckend. Fehlt `SOFA-TOOL-SLOG`, entfällt der Button, die Meldung bleibt. |
| Pins | Zeile mit bis zu vier Kacheln wie im Workspace-Dock, kleiner (`--ws-tile` ca. 7,5 rem), Art-Linie (Tools blau, Reports orange). Freie Plätze werden nicht gezeigt. Ohne Pins steht eine einzige gestrichelte Kachel „Workspace“ (Link). Daneben ein Link „Workspace“ im Kopf. Kein Pin-Button und kein Pop-out auf dem Dashboard; angeheftet wird im Workspace. |
| Katalog im Browser | Kein JSON und keine Route: Das Dashboard rendert die sichtbaren Einträge mit demselben Makro in ein `<template>`; `dashboard.js` klont die angehefteten (wie `tools.js`). Rechte sind damit serverseitig aufgelöst, verwaiste IDs fallen über `WorkspacePins.load(…, visibleIds)` heraus. Pop-out, Pin und Beschreibungs-Tooltip kommen aus dem Makro und werden per CSS ausgeblendet oder bleiben nur als Tooltip. |
| Live-Panel | Das Panel wird aus `genesys_live.js` in ein gemeinsames Modul gelöst (reine Funktion, die aus `live` und dem Aufklappzustand HTML liefert); die Report-Seite nutzt es weiter, Filter und Karten bleiben dort. Auf dem Dashboard immer „Alle Queues“, ohne Filterleiste, ohne Queue-Zähler im Kopf. Kopf: „Live“ mit Stand-Zeit und „veraltet“-Kennzeichen, Klick auf den Titel öffnet `/reports/genesys-live`. Aufklappzustand und 15-Sekunden-Takt (nur bei sichtbarem Tab) wie dort, derselbe `localStorage`-Schlüssel. |
| Live-Panel nur wenn | Secret gesetzt **und** Cookie `sofa_agent_stats` gültig für die angemeldete Person (dieselbe Prüfung wie die Seite). Sonst erscheint der Bereich nicht. Fällt der Abruf später mit 401/503 aus, wird er ausgeblendet; bei anderen Fehlern bleibt der letzte Stand sichtbar mit „veraltet“, ohne Stand „Live-Daten nicht verfügbar“. |
| Kalender: Aufbau | Kopf „Kalender“ mit KW-Navigation (← KW 42 / 2026 → Heute). Darunter ein schlankes Wochenband (7 Tage, je Tag eine Zahl, heute markiert); Klick wählt einen Tag, erneuter Klick hebt auf. Darunter die Zusammenfassungen je Ereignisart für Woche oder gewählten Tag. |
| Kalender: Zusammenfassung | Je Art eine Zeile mit Art-Linie links, Zahl und Text. Zahlen zählen Personen (verschiedene `user_id`), sonst Events. Regeln unten. Klick auf eine Zeile öffnet das bestehende Tages-Modal mit den zugehörigen Events (Beschreibung mit Namen, Tag, Uhrzeit, Status). |
| Kalender: Status | Gezählt wird nach Status der Woche: `PLANNED` ist „geplant“, `EXECUTED` „erledigt“ (gedämpft, hinten), `FAILED` als „x Fehler“ in Warnfarbe und immer sichtbar. `SKIPPED` und `CANCELED` zählen nicht. |
| Kalender: Leerzustand | „Keine Termine“ in einer Zeile. Kein Wochenband-Rauschen. |
| Kalender: Daten | `/api/events` nimmt `from_date` und `to_date` entgegen und reicht sie an die SD-API durch. Das Dashboard lädt die sichtbare Woche und lädt bei Navigation nach. Der Aufruf ohne Parameter bleibt für `/console` unverändert. |
| Rechte | Jeder Bereich nur mit seinem Recht (Heute-Zahlen, Kalender, Live-Panel, Pins). Keine Fehlerflashes für fehlende Rechte. `/console` behält den alten Kalender. |
| Themes | Hell, dunkel, servodata; deckende Flächen (`--ui-surface-card`), keine Transparenz auf `main`. |

### Zusammenfassungsregeln je Ereignisart

| Art | Zeile | Zählung |
|---|---|---|
| Onboarding | „3 Onboardings geplant“ | verschiedene Personen |
| Offboarding | „2 Offboardings geplant“ | verschiedene Personen |
| Schulung (`TRAINING_SCHEDULE`) | „<Skill>-Schulung für 5 Mitarbeiter“, je Skill und Tag eine Zeile mit Wochentag („Mi“) | Personen je Rolle und Tag |
| Rollenzuweisung | „4 Rollen zugewiesen, 3 Mitarbeiter“ | Events und Personen |
| Rollenentzug | „2 Rollen entzogen, 2 Mitarbeiter“ | Events und Personen |
| Abteilungswechsel | „1 Abteilungswechsel“ | verschiedene `process_id` (zwei Events je Vorgang) |
| Nachschulung (`RETRAIN`) | „2 Nachschulungen“ | verschiedene Personen |
| Unbekannte Art | „3 Termine“ | Events |

Ohne `role_name` im Payload steht bei Schulungen „Schulung für 5 Mitarbeiter“ und der Skill erst im Modal; der Abteilungswechsel wird bis dahin am Titelpräfix erkannt.

## Umsetzung

### D1 – Gerüst, Pins, Aufräumen

- `index()` baut `authz`; Sichtbarkeit je Bereich im Template (`workspace_tools`/`workspace_reports` über `visible_items`, Live-Gate, Rechteflags).
- `dashboard.html` neu: Titel, Störbanner (ohne Inline-Styles), Raster, Pin-Zeile mit `<template>`, Platzhalter für die übrigen Bereiche. Statische Pinnwand, `ui-section-copy`, Chips und Tasks-Kachel (vorerst durch die Heute-Leiste in D4 ersetzt, bis dahin ohne Zahlen) fallen weg.
- `dashboard.js`: Pins mit `WorkspacePins` laden, `storage`-Ereignis, Störbanner. Das Makro bekommt eine schlanke Variante für das Dashboard (ohne Pin und Pop-out).
- Test: Python (Rendering mit Rechtekombinationen, Pins im `<template>`), Node (Pin-Auswahl bleibt in `workspace_pins_checks.js`).

### D2 – Live-Panel

- `app/static/js/reports/genesys_live_panel.js` (UMD wie `workspace_pins.js`): `renderPanelHtml(live, {open})` und die KPI-Helfer; `genesys_live.js` ruft es auf. CSS-Aufteilung: Token und Panelregeln in `genesys_live_panel.css`, Seitenregeln bleiben in `genesys_live.css`.
- Dashboard bindet Modul, CSS, Abruf und Takt ein; Gate wie oben.
- `genesys_live_checks.js` anpassen, Fixture `genesys_live.sample.json` nutzen. Report-Seite danach unverändert prüfen (Karten, Filter, Widget-Ansicht).

### D3 – Kalender

- Request an die SD-API ([backend-request-event-summary.md](backend-request-event-summary.md)); Frontend arbeitet bis dahin mit dem Fallback.
- `app/static/js/calendar_summary.js` (reines Modell, getestet): Filter nach Woche und Tag, Gruppierung je Art, Statusregeln, Texte mit Plural. Fixture mit allen Arten, Abteilungswechsel, `user_id = null`, Fehlerstatus.
- `/api/events` mit `from_date`/`to_date`. Rendering, Navigation und Modal im Dashboard; `console.js` bleibt für `/console`.

### D4 – Heute-Leiste

- Zahlen aus `/api/tasks/overview` und dem Kalendermodell (Termine heute); je Zahl nur mit Recht. Überfällig über `target_date`. Link-Ziele: `/tasks`, Kalender-Tag.

### D5 – Abschluss

- Drei Themes (auch servodata mit Hintergrundbild), 1366×768 und 1920×1080 ohne Seitenscroll, schmal bis 800 px, Tastaturbedienung, Rechtekombinationen (nur Pins, nur Live, Admin ohne Genesys, ohne alles).
- Playwright-Sichtprüfung, `docs/` kurz ergänzen (`genesys-live.md`, `workspace-redesign.md` verlinken).

## Nicht Teil dieses Laufs

- Kanban-Zusammenfassung der Aufgaben (Aufgaben-Umbau).
- Persönliche Terminfilter („nur meine“) im Kalender; die Events sind nicht nach Person gefiltert.
- Anpassbares Dashboard (Bereiche verschieben oder ausblenden).
- Eigene Rechte für den Kalender; bis zur Entscheidung gilt `SOFA-PAGE-CNSL`.
