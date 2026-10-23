# Dashboard-Umbau

Plan vom 14.10.2026. Teil 3 von drei UI-Aufwertungen (Workspace: [workspace-redesign.md](workspace-redesign.md), Aufgaben: [tasks-kanban.md](tasks-kanban.md)). Das Dashboard soll beim Start zeigen, was gerade los ist.

## Stand

Erste Version am 14.10.2026 auf `feature/dashboard-redesign`, **nur mit Mock-Daten** zum Ansehen und Entscheiden in der Dev-Instanz (:8001). Es gibt noch keine SD-API-Änderung und keinen Deploy. Die Mock-Daten liefern dieselben Formen wie die echten Antworten; Felder, die es dort noch nicht gibt, stehen unter „Wunschliste SD-API“.

- **Mock-Schalter:** Nur mit `APP_ENV=development` (Dev-Instanz) gibt es die Routen `/api/dashboard-mock/…` (`app/routes/dashboard_mock.py`, Daten in `app/dashboard_mock.py`). `/?mock=normal` ist der Standard in Dev, `?mock=busy` (Servicelevel unter Ziel, viele Aufgaben, Live „veraltet“, Fehler im Kalender), `?mock=quiet` (ruhiger Tag), `?mock=0` zeigt die echten Quellen. In Prod werden die Routen nicht eingebunden, und `mock` wird ignoriert.
- **Echtmodus (Prod, `?mock=0`):** Aufgaben über `/api/tasks/overview` (Recht `SOFA-PAGE-TODO`), Live-Panel über die echte Route (nur mit Secret und gültigem Cookie), Kalender über `/api/events` (bei 401/403 ohne Meldung ausgeblendet), Servicelevel und „Termine“ entfallen ohne Quelle.
- **Genesys-Live-Panel** liegt jetzt als `genesys_live_panel.js` (reine Funktionen, UMD) vor; Report-Seite und Dashboard teilen es. Das CSS bleibt vorerst in `genesys_live.css` (Dashboard bindet es mit ein und überschreibt die Außenmaße in `dashboard.css`); die Aufteilung folgt, wenn das Design steht.
- **Tests:** `tests/calendar_summary_checks.js` (Kalender-Zusammenfassung), `tests/test_dashboard.py` (Mock-Daten, Kontext, Rendering je Rechtekombination), `tests/genesys_live_checks.js` angepasst.

### Umbau nach der ersten Rückmeldung (14.10.2026)

Gefiel nicht: Titel, KPI-Kacheln, Kalenderkarte. Jetzt: **kein Seitentitel**, **keine KPI-Kacheln** (entfernt; `dashboard_model.js` und die Mock-Route für Aufgaben sind seit dem Review am 23.10.2026 gelöscht), der **Kalender entfällt** und wird durch eine **Seitenleiste links** ersetzt. Dreiteiliges Layout: Seitenleiste | Mitte (Angeheftet als Kachelkarte, Platz für spätere Inhalte) | Live-Panel.

- **Seitenleiste:** oben „Heute“ (Tagesansicht, detailliert), darunter „Woche“ (KW-Navigation, Wochentage, Wochenzusammenfassung).
- **Tagesansicht:** je Art (bei Schulung und Rollen je Rolle) eine Zeile mit Namen: „Onboarding für Jonas Brandt, Ben Lorenz + 3 weitere“, „Retouren-Schulung für Tim Vogel, Sara Neumann + 1 weitere“, „Rollenzuweisung Technik für Luca Roth“. Darunter Uhrzeit, Chip „erledigt“ oder „Fehler“. Namen aus `user_name`, sonst aus dem Beschreibungstext.
- **Wochenansicht:** zusammengefasst wie bisher („5 Onboardings geplant“, „Retouren-Schulung für 3 Mitarbeiter geplant“) mit Tagen und Uhrzeit darunter.
- **Wochentage:** nur Text ohne Rahmen, heute fett, Auswahl in Akzentfarbe mit Unterstrich, ein kleiner Punkt unter Tagen mit Terminen, Wochenende blasser. Ein Klick auf einen Tag zeigt ihn im Tagesbereich (Überschrift wird „Donnerstag, 15.10.“, daneben ein Link „Heute“). Die Wochenzusammenfassung bleibt dabei die ganze Woche. Beim Wochenwechsel wählt die Leiste den Montag (aktuelle Woche: heute).
- Jede Zeile öffnet den Dialog mit allen zugehörigen Events (auch die „weitere“).
- Die Leiste entfällt ohne Meldung, wenn `/api/events` 401/403 liefert.

Die folgenden Entscheidungen zu Titel, Heute-Kacheln, Pins und Kalender sind durch diesen Umbau überholt; sie bleiben als Verlauf stehen.

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
| Rolle der Seite | Lagebild: oben, was jetzt wichtig ist (Störung, heute), daneben die Live-Lage, darunter der Kalender; Schnelleinstieg in der Kopfzeile. Keine erklärenden Texte, keine Badges, keine Kicker; alle `ui-section-copy` entfallen. |
| Titel | „Dashboard“ mit Akzentstrich wie „Workspace“. Keine Begrüßung, keine Rollen- und PNR-Chips. |
| Layout breit (ab 1100 px) | Kein Seitenscroll (Technik wie Workspace und Genesys Live), geprüft bei 1366×768, 1600×900 und 1920×1080. Links der Hauptbereich, rechts das Live-Panel in fester Breite `clamp(320px, 26vw, 420px)`, Oberkante bündig mit den Kacheln. Kalenderzeilen und Panel scrollen bei Bedarf für sich. |
| Layout schmal | Eine Spalte mit Seitenscroll (bis 1100 px). Reihenfolge: Kopfzeile mit Pins, Heute, Live, Kalender. |
| Reihenfolge links | Kopfzeile (Titel, Pins), Störung (nur wenn aktiv), Heute-Kacheln, Kalender. |
| Fehlt ein Bereich | Er entfällt samt Spalte; der Rest nutzt die Breite (mit Maximalbreite). Kein Platzhalter, keine Fehlermeldung für fehlende Rechte. |
| Heute-Kacheln | Eine Zeile „Heute · Mi., 14.10.“ mit vier Kacheln. **Servicelevel** (Prozent des Tages, Ziel und Tendenz zum Vortag; grün ab Ziel, orange bis 10 Punkte darunter, rot darunter; nur für heute, ein „morgen“ gibt es hier nicht). **Aufgaben aktiv** (offen plus in Bearbeitung plus blockiert, ohne nachgelagerte; Chips „meine“, „heute fällig“ in Orange, „morgen“ gedämpft, „überfällig“ in Rot, nur wenn > 0; darunter die Aufteilung offen · in Bearbeitung · blockiert; Link zu `/tasks`). **Nachgelagert** (gedämpft, ab 25 orange hervorgehoben; Schwelle `DEFERRED_HIGH` in `dashboard_model.js`). **Termine** (heute, dezent „morgen n“; Klick wählt den heutigen Tag im Kalender). Aufgaben-Kacheln nur mit `SOFA-PAGE-TODO`, ersetzen die alte Tasks-Kachel. |
| Störung | Banner bleibt, aber ohne Inline-Styles, im Stil der übrigen Flächen, deckend. Fehlt `SOFA-TOOL-SLOG`, entfällt der Button, die Meldung bleibt. |
| Pins | Schmale Pillen rechts neben dem Titel (Icon, Titel, farbige Unterkante: Tools blau, Reports orange), bis zu vier, in Anheftreihenfolge. Das nutzt den freien Platz der Titelzeile und gibt dem Kalender die ganze Breite (erste Fassung mit Kachelkarte links ließ viel leere Fläche). Ohne Pins steht eine gestrichelte Pille „Workspace“. Kein Pin-Button und kein Pop-out; angeheftet wird im Workspace. |
| Katalog im Browser | Kein JSON und keine Route: Das Dashboard rendert die sichtbaren Einträge mit demselben Makro in ein `<template>`; `dashboard.js` klont die angehefteten (wie `tools.js`). Rechte sind damit serverseitig aufgelöst, verwaiste IDs fallen über `WorkspacePins.load(…, visibleIds)` heraus. Pin und Pop-out aus dem Makro werden per CSS ausgeblendet, der Beschreibungs-Tooltip bleibt. |
| Live-Panel | Das Panel wird aus `genesys_live.js` in ein gemeinsames Modul gelöst (reine Funktion, die aus `live` und dem Aufklappzustand HTML liefert); die Report-Seite nutzt es weiter, Filter und Karten bleiben dort. Auf dem Dashboard immer „Alle Queues“, ohne Filterleiste, ohne Queue-Zähler im Kopf. Kopf: „Genesys Live“ (Link zum Report) mit Stand-Zeit und „veraltet“-Kennzeichen. Aufklappzustand und 15-Sekunden-Takt (nur bei sichtbarem Tab) wie dort, derselbe `localStorage`-Schlüssel. |
| Live-Panel nur wenn | Secret gesetzt **und** Cookie `sofa_agent_stats` gültig für die angemeldete Person (dieselbe Prüfung wie die Seite). Sonst erscheint der Bereich nicht. Fällt der Abruf später mit 401/503 aus, wird er ausgeblendet; bei anderen Fehlern bleibt der letzte Stand sichtbar mit „veraltet“, ohne Stand „Live-Daten nicht verfügbar“. |
| Kalender: Aufbau | Kopf „Kalender“ mit KW-Navigation (← KW 42 · 12.10.–18.10. → Heute). Darunter ein Wochenband (7 Tage, je Tag die Zahl der Einheiten, heute umrandet); Klick wählt einen Tag, erneuter Klick hebt auf. Darunter die Zusammenfassungen je Ereignisart für Woche oder gewählten Tag als mehrspaltiges Raster (Art-Linie links, Text, darunter Tage/Uhrzeit und Chips). Klick auf eine Zeile öffnet das bestehende Tages-Dialogfenster mit den zugehörigen Events (Tag, Uhrzeit, Beschreibung mit Namen, Status). |
| Kalender: Status | Gezählt wird nach Status: `PLANNED` ist „geplant“, `EXECUTED` „erledigt“ (Zusatzchip, nur erledigt: gedämpfte Zeile), `FAILED` als Chip „x Fehler“ in Rot und rote Umrandung. `SKIPPED` und `CANCELED` zählen nicht. |
| Kalender: Leerzustand | „Keine Termine“ in einer Zeile. |
| Kalender: Daten | `/api/events` nimmt `from_date` und `to_date` entgegen und reicht sie an die SD-API durch (umgesetzt); das Dashboard lädt die sichtbare Woche und die nächste, Wochen werden im Browser zwischengespeichert, Aktualisierung alle zwei Minuten bei sichtbarem Tab. |
| Rechte | Aufgaben-Kacheln mit `SOFA-PAGE-TODO`, Live-Panel mit Secret und gültigem Cookie, Pins nach Katalog. **Kalender: für alle angemeldeten Nutzer, kein eigenes Recht** (Entscheidung des Nutzers). Dafür muss `/api/events` beim Anschluss an echte Daten von `SOFA-PAGE-CNSL` auf Login umgestellt werden; das ist bewusst noch nicht geschehen, weil die Antwort die Namen aller Prozessbeteiligten enthält. Bis dahin blendet das Dashboard den Kalender bei 401/403 ohne Meldung aus. `/console` behält den alten Kalender. |
| Themes | Hell, dunkel, servodata; deckende Flächen (`--ui-surface-card`), keine Transparenz auf `main`. |

### Zusammenfassungsregeln je Ereignisart

| Art | Zeile | Zählung |
|---|---|---|
| Onboarding | „3 Onboardings geplant“ | verschiedene Personen |
| Offboarding | „2 Offboardings geplant“ | verschiedene Personen |
| Schulung (`TRAINING_SCHEDULE`) | „<Skill>-Schulung für 5 Mitarbeiter“, je Skill und Tag eine Zeile, darunter Wochentag und Uhrzeit; Skill mit Leerzeichen als „Schulung „Technik 2nd Level“ für …“ | Personen je Rolle und Tag |
| Rollenzuweisung | „4 Rollenzuweisungen geplant“ | Events |
| Rollenentzug | „2 Rollenentzüge geplant“ | Events |
| Abteilungswechsel | „1 Abteilungswechsel“ | verschiedene `process_id` (zwei Events je Vorgang) |
| Nachschulung (`RETRAIN`) | „2 Nachschulungen“ | verschiedene Personen |
| Unbekannte Art | „3 Termine geplant“ | Events |

Ohne `role_name` im Payload steht bei Schulungen „Schulung für 5 Mitarbeiter“ und der Skill erst im Modal; der Abteilungswechsel wird bis dahin am Titelpräfix erkannt.

## Wunschliste SD-API (zurückgestellt bis das Zielbild steht)

Nichts davon ist angefragt. Es wird gesammelt und erst nach der Design-Abnahme gebündelt geschickt.

1. **Events:** `role_name`, `process_type`, `user_name` in `GET /sofa/events` ([backend-request-event-summary.md](backend-request-event-summary.md), Entwurf, nicht versendet). Das Frontend fällt ohne die Felder auf Beschreibungstext und Titelpräfix zurück.
2. ~~**Tasks:** `in_progress_total`~~ entfällt mit den KPI-Kacheln (Review 23.10.2026).
3. **Servicelevel:** `GET /reporting/service-level?queue_id=|group_id=` mit Cache, für die Dashboard-Card und den künftigen Servicelevel-Report. Ohne Parameter alle `[PROD]_`-Queues zusammen. Antwort (wie im Mock `app/dashboard_mock.py`): `target_ratio` (vorerst 0.8), `queues[{queue_id,label}]`, `groups[{group_id,label}]`, `scope{type,id,label}`, `day{date,…}`, `month{month,…}`, `previous_month{month,…}`, `days[7]{date,…}` (die sieben Tage vor heute), jeweils `ratio,numerator,denominator`. Die Card zeigt den laufenden Monat und darunter ausgeschrieben den Vormonat, den Trend unter „Heute“. Grundlage `oServiceLevel` aus den Genesys-Aggregaten (Tag gibt es schon in `q-manager/queues/overview`); nicht aus genesys-sync berechnen, dort fehlen in der Queue abgebrochene Anrufe. Gruppen pflegt später der Servicelevel-Report.
4. **Events-Recht:** `/api/events` auf Login umstellen (SOFA-seitig), wenn echte Daten angeschlossen werden. Bestätigt am 23.10.2026: Alle Angemeldeten sehen den Kalender mit Namen, der Betriebsrat ist informiert.
5. **Mein Tag:** kein eigener Endpunkt. Anrufe aus dem bestehenden agent-stats, erledigte Aufgaben aus `completed_tasks` (sobald mit `completed_at` geliefert). Die Zeile „Tickets“ entfällt, weil es keine Quelle gibt.

## Umsetzung

Die Schritte D1 bis D4 sind als erste Version mit Mock-Daten umgesetzt (Branch `feature/dashboard-redesign`). Offen ist die Abnahme des Designs.

- **D1 Gerüst, Pins:** erledigt (Kontext in `app/dashboard.py`, Template, Pins aus `<template>`).
- **D2 Live-Panel:** erledigt (`genesys_live_panel.js`, Report-Seite weiter getestet). CSS-Aufteilung offen.
- **D3 Kalender:** erledigt (`calendar_summary.js`, Dialog, Wochenband, `/api/events` mit Zeitraum).
- **D4 Heute-Kacheln:** gebaut und wieder verworfen (Code am 23.10.2026 entfernt).
- **D5 Abschluss:** Themes hell, dunkel, servodata, 1366×768, 1600×900, 1920×1080 ohne Seitenscroll und 420 px geprüft (Playwright, Dev-Instanz). Offen: Design-Iterationen nach Rückmeldung, Tastaturbedienung gezielt prüfen, CSS-Aufteilung, Entscheidung zu den Wunschlisten-Punkten, dann Anschluss an echte Daten (Mock-Schalter bleibt nur in Dev).

## Nicht Teil dieses Laufs

- Kanban-Zusammenfassung der Aufgaben (Aufgaben-Umbau).
- Persönliche Terminfilter („nur meine“) im Kalender; die Events sind nicht nach Person gefiltert.
- Anpassbares Dashboard (Bereiche verschieben oder ausblenden).
- Eigene Rechte für den Kalender (gilt für alle Angemeldeten).
