# Genesys Cloud Live

Lesende Live-Übersicht unter `/tools/genesys-live` für alle angemeldeten SOFA-Nutzer. Die Workspace-Karte erscheint, wenn das gemeinsame Secret für den persönlichen Genesys-Report eingerichtet ist. Seite und BFF-Route verwenden `require_login`; ein eigenes Report-Recht gibt es nicht.

## Daten und Oberfläche

Die SD-API liefert `GET /reporting/genesys-live` ohne Parameter. Karten zeigen die Queues mit `mine.member`; aktive Karten haben `mine.joined`. In der breiten Ansicht stehen drei aktive Kartenzeilen oder, bei geöffneten inaktiven Queues, zwei aktive und eine inaktive Zeile. Pfeile blättern ganze Kartenseiten. Bis 800 px stehen alle Karten in einem horizontalen Streifen; inaktive Karten folgen am Ende. Ein Kartenklick filtert das Panel auf diese Queue. Ohne Auswahl zeigt es die deduplizierten Werte aus `total` für alle Queues.

Das Panel zeigt Voice-Interaktionen und Anwesenheit. „In Warteschleife“ umfasst `people.on_queue`; „Davon frei“ ist `idle`. „Sonstige“ teilt sich im Tooltip in `communicating` und `not_responding` auf. Die Zeilen unter „Pause“ und „Beschäftigt“ folgen `statuses` und `by_status` der Antwort, einschließlich Nullwerten. `unspecified` erhält den Sonstige-Tooltip. „Außer Haus“ erscheint nur bei einem Wert größer null. Queue-Personenzahlen und Voice-Anrufe können voneinander abweichen; eine Person kann in mehreren Queues angemeldet sein.

## Aktualisierung

Die Seite lädt beim Öffnen und danach alle 15 Sekunden, solange der Tab sichtbar ist. „Stand“ stammt aus `as_of` und wird in Berliner Uhrzeit dargestellt. Bei `stale=true` oder einem Abruffehler bleiben die letzten Werte sichtbar und werden mit „Daten veraltet“ markiert. Ein fehlgeschlagenes manuelles Neuladen erzeugt zusätzlich eine Flash-Meldung. Ohne vorherige Antwort erscheint „Live-Daten nicht verfügbar“. Fehlendes Genesys-Konto und keine aktivierten Queues haben eigene Leerzustände.

Aufklappzustand der inaktiven Queues und der drei Panel-Gruppen liegt im Browser-`localStorage` mit Fehlerbehandlung. Standardmäßig sind die inaktiven Queues geschlossen und nur „In Warteschleife“ geöffnet.

## Identität und Betrieb

Die BFF-Route `/api/reporting/genesys-live` prüft das signierte HttpOnly-Cookie `sofa_agent_stats` gegen die User-ID der SOFA-Sitzung und reicht es als Bearer-Token weiter. Browser und BFF senden keine frei wählbare User-ID an die SD-API. Antworten der BFF haben `Cache-Control: no-store`. Es gilt dasselbe Secret und dieselbe erneute Anmeldung nach Einrichtung wie bei [Meine Genesys-Zahlen](agent-stats-report.md).

Der API-Vertrag steht in der SD-API unter `docs/genesys-live-api.md`. Die Produktivseite nutzt die deployte SD-API. SOFA wurde vor der Freigabe mit der synthetischen Antwort in `tests/fixtures/genesys_live.sample.json` und gemockten Backend-Antworten getestet; dabei gab es keine produktiven Genesys-Abfragen.
