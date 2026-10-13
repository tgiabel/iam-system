# Meine Genesys-Zahlen

Persönlicher, lesender Report unter `/tools/agent-stats`, für alle angemeldeten SOFA-Nutzer. Der Browser sendet weder eine interne User-ID noch eine Genesys-ID. Tag und Monat stehen in der URL (`period`, `anchor`); der Tagesmodus verwendet die Berliner Presence-Zeitleiste aus der Zeitkorrektur als lesende Grafik. Es gibt keine Interaktionstabelle, kein Ranking und keinen Managerzugriff.

## Kennzahlen

- Eine Agent-Session ist ein Kontakt. Zugeordnet wird sie zum Berliner Tag ihres `assigned_at` aus genesys-sync. Ein Transfer kann daher bei mehreren Agenten je einen Kontakt erzeugen.
- Die Hauptwerte zählen abgeschlossene, aktive Voice-Sessions auf Queues mit `dim_queue.opcyc_relevant = 1`. Angenommen = Alert- und Interact-Segment; bei mir nicht angenommen = Alert ohne Interact. Ausgehender Transfer = `disconnectType = transfer` im letzten Interact-Segment.
- Zeiten kommen aus `tTalk`, `tHeldComplete` und `tAcw` (Millisekunden, je Session auf Sekunden gekürzt). Durchschnittlicher Gesprächswert und Bearbeitungswert (`Talk + Held + ACW`) teilen durch angenommene Kontakte. Bei null angenommenen Kontakten steht ein Strich statt `0:00`.
- Ausgehende Sessions, direkte Sessions ohne Queue und Sessions mit ungeklärter Queue-Einstufung stehen getrennt unter den produktiven Queue-Balken. Test-Queues (`opcyc_relevant = 0`) zählen nirgends mit.
- Statuswerte sind die in Genesys erfasste Organisations-Presence. Der Block „Anwesenheit“ zeigt alle Status mit Summe und Anzahl der erfassten Abschnitte, Offline/Abwesenheit zuletzt. Die Tageszeitleiste verwendet dieselben Abschnitte, keine Zeitkorrekturen, und zeigt nur die aktive Zeit (ohne Offline/Abwesenheit) ± 2 Stunden auf volle Stunden.

## Oberfläche

Von oben nach unten: Zeitraum, dann zwei Abschnitte direkt auf dem Seitenhintergrund. „Anwesenheit“ (Badge: eingeloggte Zeit = alle Status außer Offline/Abwesenheit) zeigt im Tag zunächst nur die Zeitleiste; „Status“ klappt die Statuskarten darüber auf; ein Klick auf eine Karte hebt deren Abschnitte in der Zeitleiste hervor. Im Monat stehen die Karten immer da. „Telefonie“ (Badge: Anrufe = angenommen + verpasst) zeigt links Angenommen, Verpasst und Weitergeleitet als einzelne Kacheln mit Icon und rechts die Karte „Gesprächswerte“ (vier Durchschnitte; Klick auf die Karte zeigt Summen und Quoten). Ab mehr als einer Queue sind die drei Kacheln gemeinsam klickbar und öffnen unter einer Trennlinie je Queue eine Zeile, nach Angenommen absteigend. Ein Klick auf eine Zeile filtert Telefonie und Gesprächswerte clientseitig: `queue` in der URL, Queuename im Abschnittstitel und in der Kartenüberschrift, „Zurücksetzen“ daneben. Anwesenheit bleibt ungefiltert, weil Status nicht queuebezogen ist.

Die SD-API liefert die Statusanzahl (`statuses[].count`), die exakten Queue-Zeiten (`talk_seconds`, `hold_seconds`, `acw_seconds`) und den eigenen Trend (`phone.comparison`, Vortag/Vormonat, neutral ohne Wertung). Fehlt für den vorigen Zeitraum eine vollständige Datenabdeckung, entfällt der Trend. Ein Vergleich mit anderen Agenten ist nicht vorgesehen.

## Datenfenster und Aktualität

Presence liegt 365 Tage vor, Gespräche 90 Tage. Weil genesys-sync Gespräche nach `conversation_start` löscht, beginnt das Telefonie-Fenster erst mit dem ersten vollständig erhaltenen Berliner Tag nach dem aktuellen Löschschnitt. Der aktuelle Tag ist ein Zwischenstand. Monatsantworten nennen für Presence und Telefonie jeweils `from` und `through`; bei einem älteren Zeitraum ohne Gespräche ist `phone.available = false`, während Presence noch verfügbar sein kann. Die SD-API nutzt zusätzlich `sync_day`: Vergangene Tage erscheinen nur bis zum letzten abgeschlossenen Sync-Tag; heute kommt nur bei einem Wasserstand von heute und lückenlos abgeschlossenen Vortagen hinzu. `data_as_of` zeigt für aktuelle Zeiträume die Wasserstände von Presence und Gesprächen. Laufende Gespräche zählen nach Abschluss.

## Identität und Betrieb

Beim Login setzt SOFA zusätzlich zum bestehenden Cookie ein acht Stunden gültiges, signiertes HttpOnly-Cookie `sofa_agent_stats`. Der SOFA-Proxy prüft dessen Identität gegen die Sitzung und reicht es als Bearer-Token weiter. Die SD-API prüft Signatur, Laufzeit, Zweckbindung und den aktiven SOFA-Zugang selbst. Der Agent-Stats-Endpoint akzeptiert keinen `X-User-Id`-Header als Identität. Die Genesys-Kennung wird nur serverseitig aus `user_accounts` für Ressource 27, System 9 gelesen. Fehlt sie oder ist sie ungültig, erscheint ein eigener Leerzustand. Bereits eingeloggte Nutzer melden sich nach der Freigabe einmal neu an.

Beide Dienste brauchen denselben zufälligen, mindestens 32 Byte langen Base64-Schlüssel `SOFA_AGENT_STATS_SECRET_B64`; Dev und Produktion brauchen unterschiedliche Schlüssel. Fehlt der Schlüssel in SOFA, bleibt die Karte ausgeblendet und der Report geschlossen. SOFAs Compose-Datei liest ihn aus der Root-only-Datei `/var/www/sofa-secrets/agent-stats.env` außerhalb des Git-Repositories; die SD-API liest ihn aus ihrer ignorierten Umgebungsdatei. Beim SOFA-Rollout muss der App-Container neu erstellt werden, damit er die Datei lädt. Schlüssel nie ins Repo schreiben. Für die SD-API braucht der Runtime-Account zusätzlich `SELECT` auf `Genesys.conversation`, `Genesys.agent_session` und `Genesys.dim_queue`; Dev/CI enthält diese Tabellen und Rechte im synthetischen Bootstrap.

Der API-Vertrag steht in der SD-API unter `docs/agent-stats-report-api.md`. Rollout von Secrets, produktiven DB-Grants und Deployment ist ein eigener freizugebender Schritt.
