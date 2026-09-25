# Presence-Report – Anforderungen und Plan

Stand 25.09.2026 · Rechte `SOFA-RPRT-PRSNC`, `SOFA-FN-PRSNC-NAME`, `SOFA-FN-PRSNC-DETAIL` · Backend: SD-API `/reporting/presence`, in SOFA als `/api/reporting/presence/...`

Ein allgemeiner Report über die Genesys-Presence aller Mitarbeiter je Tag. Er ist der Nachfolger der Daten, die der Altdienst `purecloudhandler` für das Dashboard gesammelt hat, aber **kein Tokenreport**: Es gibt keine Sonderlogik, keine Shortcuts und keine Namen für einzelne Status. Ob token-spezifische Funktionen dazukommen, wird nach dem ersten Schritt entschieden.

Vorgaben aus genesys-sync: [`/var/www/genesys-sync/docs/auftrag-presence-bericht.md`](../../genesys-sync/docs/auftrag-presence-bericht.md). Wo dieses Dokument davon abweicht, ist das unten begründet.

## Stand der Umsetzung (25.09.2026)

| Teil | Stand |
|---|---|
| SD-API (A1–A5) | deployt als `sd-api:96f3804`, Migrationen angewendet, Grants gesetzt. Vertrag: `docs/presence-report-api.md` in der SD-API |
| SOFA (B1–B4) | Branch `feature/presence-report` im Live-Checkout, noch nicht nach `main` gemergt |
| Sichtprüfung | Playwright gegen eine lokale SOFA-Instanz mit synthetischen API-Antworten: Hell, Dunkel, Servodata, 390 px. Mit Echtdaten erst nach der Rechtevergabe |
| Rechte | angelegt, noch keiner Rolle zugewiesen (C3) |

## Entscheidungen (25.09.2026)

| Thema | Entscheidung |
|---|---|
| Umfang | Allgemeiner Presence-Report, alle Status gleich behandelt. Keine token-spezifische Logik oder Nomenklatur (Route, Rechte, Klassen, Texte) |
| Datenquelle | `Genesys.user_presence` (genesys-sync), Aufbewahrung **365 Tage** nach dem Ende des Eintrags. Keine Verdichtungstabelle: Alle Werte werden live aus den Rohdaten gerechnet |
| Historie | Am 25.09.2026 aus Genesys nachgeladen: 364 abgeschlossene Tage ab **26.09.2025**, ohne Lücke. Der früheste Tag kommt aus den Daten und wandert mit der Aufbewahrung mit. Er ist nicht fest eingebaut |
| Zeitraum | Nur **ein Tag** je Ansicht. Woche/Monat/Jahr folgen bei Bedarf später |
| Grundansicht | Recht `SOFA-RPRT-PRSNC`: eine Zeile je Mitarbeiter mit **Pseudonym**, je Status Anzahl und summierte Dauer |
| Personenbezug | **Zwei** eigene Rechte (Vorgabe des Auftrags, bestätigt): `SOFA-FN-PRSNC-NAME` für den Klarnamen, `SOFA-FN-PRSNC-DETAIL` für die Einzeldatensätze. Beides wird **je Zeile** abgerufen, über ein Menü „⋯“ am Zeilenende. Es gibt **keinen** Schalter für Klarnamen aller Zeilen, auch nicht für einen ganzen Tag. `SOFA-FN-ALL` schließt beide Rechte nach der Wildcard-Regel ein |
| Protokoll | Sparsam: nur die beiden Abrufe je Zeile („Klartext anzeigen“, „Details anzeigen“), je Abruf eine Zeile mit wer, wann, welcher Tag, welcher Mitarbeiter. Normale Ansichten und Exporte werden nicht protokolliert |
| Mitbestimmung | Mit dem Betriebsrat geklärt (25.09.2026). Die Rechte können vergeben werden |
| Quelle umschalten | Toggle **Genesys** (Presence wie erfasst) / **Opcyc** (berechnete Zeitbuchung inklusive Zeitkorrekturen, wie sie an Opcyc geht) |
| Zählweise | Wie der Altdienst: jeder **abgeschlossene** Eintrag zählt, auch sehr kurze, am Berliner Tag seines Beginns. Laufende Einträge werden gesondert gekennzeichnet |
| Datumswahl | Wie in der Zeitkorrektur, in Funktion und Aussehen (siehe Oberfläche) |
| Gemeinsamer Code | Vorhandenes nutzen, wo es ohne Umbau geht. Eine Vereinheitlichung der Reports folgt später, jetzt wird nichts erzwungen |
| Altbericht | `/dashboard/token/`, `api/token/*.php` und `Reporting.user_status` bleiben eingefroren und unangetastet. Übernahme und Abschaltung gehören zur späteren Token-Entscheidung |
| Teams | Keine Einschränkung der Sichtbarkeit nach Team oder Abteilung im ersten Schritt |

## Fachliche Regeln

**Tag.** Berliner Kalendertag `[00:00, 24:00)` über `ZoneInfo("Europe/Berlin")`, also 23 bzw. 25 Stunden an den Umstellungstagen (29.03.2026, 25.10.2026). Die Berechnung liegt in Python (`time_correction.timeline.day_bounds`): In MariaDB sind keine Zeitzonentabellen geladen, `CONVERT_TZ(…, 'Europe/Berlin')` liefert NULL.

**Genesys-Sicht.** Grundlage sind alle Einträge, die den Tag überlappen (`start_time < bis AND (end_time IS NULL OR end_time > von)`) und nicht als fehlend markiert sind (`missing_since IS NULL`). Status ist die Organisations-Presence (`organization_presence_id`) mit der deutschen Bezeichnung aus `dim_presence.label_de`, nicht `system_presence`. Sonst fielen z. B. „Ticket“ und „Rückfrage“ unter `Busy` zusammen. Deaktivierte Status bleiben auflösbar.

- **Anzahl:** abgeschlossene Einträge, die im Tag **beginnen**. Ein Eintrag über Mitternacht zählt nur am Tag seines Beginns.
- **Laufend:** Einträge ohne Ende, die im Tag beginnen, werden getrennt gezählt und gekennzeichnet („+1 laufend“), nicht in der Anzahl.
- **Dauer:** Überschneidung mit dem Tag. Ein Eintrag über Mitternacht wird anteilig verteilt. Offene Einträge zählen bis „jetzt“ (heute) bzw. bis zum Tagesende, sind als laufend markiert und werden nie als 0 gezählt.
- **Logzeit (Summenspalte):** alles außer „Offline“.

**Opcyc-Sicht.** Die zusammengeführte Zeitleiste aus der Zeitkorrektur (`layers(...)[1]`, dieselbe Regel wie in `day_users`), also Genesys-Presence, übersetzt auf ONLINE/BIPAU/PAUSE/HOME, plus aktive Korrekturen. Die SD-API rechnet sie mit ihrem vorhandenen Code, **ohne eine dritte Kopie** der Zusammenführungsregel.

- **Anzahl:** Opcyc-Datensätze wie geliefert, einschließlich der Zeile um 00:00.
- **Dauer:** Segmentlänge bis „jetzt“ bzw. bis zum Tagesende.
- **Logzeit:** alles außer HOME, Pause = BIPAU + PAUSE (wie die Kacheln der Zeitkorrektur).
- Mitarbeiter ohne Lieferung (`is_delivered` = false) haben in dieser Sicht keine Werte.

**Zeilen.** Ein Mitarbeiter erscheint, wenn er am Tag Zeit außerhalb von „Offline“ (Genesys) bzw. HOME (Opcyc) hat. Wer ganztägig offline war, steht nicht in der Liste.

**Stand.** Nur am laufenden Tag: `sync_state.watermark` des Stroms `presence`. genesys-sync ruft alle 2 Minuten ab, der Stand liegt also höchstens rund 3 Minuten zurück. Vergangene Tage sind abgeschlossen und zeigen keinen Stand.

**Abnahmewert.** Die Summe der Tagesanzahlen „Tokenlöschung“ (`c75ef493-…`) je Monat muss der Tabelle „Abgleich Tokenlöschungen“ im Auftrag entsprechen (Spalte `Genesys.user_presence`, z. B. 2025-10: 5 124, 2026-08: 7 664). Geprüft wird das per Skript gegen `GET /day`, nicht über eine eigene Ansicht im Report. **Ergebnis 25.09.2026:** 10/2025 bis 08/2026 identisch. 09/2025 ergibt 919 statt 920: Ein Eintrag beginnt am 25.09.2025 um 23:59:02 Berliner Zeit und endet nach Mitternacht. Er gehört nach der Regel zum 25.09., die Tabelle im Auftrag hat ihn über die Überlappung mitgezählt. Der Altbestand hat ebenfalls 919.

## Rechte und Datenschutz

| Recht | Darf |
|---|---|
| `SOFA-RPRT-PRSNC` | Kachel, Seite, Tagesansicht mit Pseudonymen, Summen, CSV-Export |
| `SOFA-FN-PRSNC-NAME` | zusätzlich „Klartext anzeigen“ für eine Zeile |
| `SOFA-FN-PRSNC-DETAIL` | zusätzlich „Details anzeigen“ für eine Zeile (Einzeldatensätze) |

- **Pseudonym:** `MA-` plus 5 Zeichen Base32 aus HMAC-SHA256(Schlüssel, Tag + `user_id`). Innerhalb eines Tages ist es stabil, damit Neuladen, Sortieren und Suchen zusammenpassen. Von Tag zu Tag wechselt es, so lässt sich eine Person nicht über Tage verfolgen. Der Schlüssel wird per HMAC mit fester Zweckkennung aus dem vorhandenen Pflichtgeheimnis `INVENTORY_SECRET_PEPPER_B64` abgeleitet, eine neue Einstellung gibt es nicht. Gebildet wird über alle User aus `dim_user`, bei einer Kollision werden alle Pseudonyme des Tages länger.
- **Keine `user_id` im Browser** (bestätigt). Auch mit den FN-Rechten nicht: Name und Einzeldatensätze werden über Tag + Pseudonym angefragt, die SD-API löst das Pseudonym selbst auf. Die Genesys-ID wäre ein dauerhaftes Pseudonym über alle Tage.
- **Nur je Zeile.** Jeder Name und jede Detailansicht ist ein eigener, bewusster Abruf für genau einen Mitarbeiter. Die SD-API bietet keinen Aufruf für mehrere Namen auf einmal. Ein aufgedeckter Name bleibt nur bis zum Neuladen oder Tageswechsel stehen (beim Wechsel der Quelle bleibt er, das Pseudonym ist dasselbe) und wird nirgends gespeichert.
- **Serverseitig geprüft:** Ohne das jeweilige FN-Recht liefert die SD-API weder Namen noch Einzeldatensätze (403). Der SOFA-Proxy prüft zusätzlich, `X-User-Id` kommt nur aus der Sitzung.
- **Protokoll** in der SD-API-Datenbank (neue Tabelle `presence_report_access_log`): `actor_user_id`, `action` (`name` | `details`), `business_date`, `target_user_id`, `created_at`. Genau eine Zeile je erfolgreichem Abruf. Ein Wechsel der Quelle Genesys/Opcyc klappt geöffnete Detailansichten zu; erneutes Öffnen ist ein neuer Abruf. Nichts wird ohne Klick nachgeladen. Die Tabelle wird nur ergänzt, nie geändert oder gelöscht. Eine Oberfläche dafür gibt es im ersten Schritt nicht.
- **CSV** enthält nur Pseudonyme und Summen, nie Namen oder Einzeldatensätze (wie im Anmeldeprotokoll).

## Schnittstellen

SD-API unter `/reporting/presence`, im SOFA-Proxy unter `/api/reporting/presence` (Muster `app/routes/logon_log.py`):

| Aufruf | Recht | Inhalt |
|---|---|---|
| `GET /day?day=YYYY-MM-DD&source=genesys\|opcyc` | RPRT | Tagesansicht samt Kalender (`today`, `yesterday`, `first_day`, Berlin; SOFA rechnet die Tage nicht selbst). Standard: heute, `genesys` |
| `GET /day/{day}/users/{pseudonym}/name` | NAME | Klarname aus `dim_user`, wird protokolliert |
| `GET /day/{day}/users/{pseudonym}?source=genesys\|opcyc` | DETAIL | Einzeldatensätze, wird protokolliert |
| `GET /export?day=YYYY-MM-DD&source=genesys\|opcyc` | RPRT | CSV (UTF-8 BOM, Semikolon), pseudonym |

Antwort von `/day` (verbindlich ist der Vertrag `docs/presence-report-api.md` in der SD-API):

```json
{
  "day": "2026-09-24", "source": "genesys",
  "today": "2026-09-25", "yesterday": "2026-09-24", "first_day": "2025-09-26",
  "data_as_of": null
  "statuses": [{"key": "c75ef493-…", "label": "Tokenlöschung", "system_presence": "Busy"}],
  "totals": {"c75ef493-…": {"count": 208, "running": 0, "seconds": 19840, "users": 31}},
  "users": [{
    "pseudonym": "MA-7K3QD",
    "logged_seconds": 27100,
    "statuses": {"c75ef493-…": {"count": 12, "running": 0, "seconds": 1130, "open": false}}
  }],
  "can_view_name": false, "can_view_details": false
}
```

- `first_day` ist der früheste Tag mit abgeschlossenem Abruf (`MIN(sync_day.business_date)` für `presence` mit `closed_at`). Heute ist das der 26.09.2025.
- Die Status-Reihenfolge ist fest: nach `system_presence` (Verfügbar/Warteschleife vor Busy-Varianten vor Pausen vor Offline), innerhalb davon nach Bezeichnung. Für Opcyc gilt ONLINE, BIPAU, PAUSE, HOME.
- Fehler: 403 ohne Recht, 404 bei unbekanntem Pseudonym, 422 bei ungültigem Tag oder Tag nach heute. Tage vor `first_day` beantwortet der Endpunkt mit 200 und leeren Listen („Keine Daten“).
- **Datenbankrechte** für `SoapAPI`: `SELECT` auf `user_presence`, `dim_presence`, `dim_user` und `presence_correction` ist schon vergeben (Zeitkorrektur). Neu dazu kommt `SELECT` auf `sync_state` und `sync_day` (freigegeben 25.09.2026, keine Personendaten). Kein Zugriff auf `conversation`/`agent_session`.
- **Laufzeit:** Die Tagesabfrage (dieselbe wie `fetch_day_presence`) läuft bei älteren Tagen als vollständiger Scan über rund 500 000 Zeilen, gemessen 0,1 s (aktuelle Tage 4 ms). Das genügt. Wird es spürbar langsamer, kommt eine Umformulierung als `UNION` über die Indizes auf `end_time`.

## Oberfläche

Seite `/tools/presence-report`, Kachel in der Tool-Übersicht (Kicker „Genesys Cloud“, Titel „Presence-Report“, Chip „Presence“, Muster der Report-Kacheln). Keine erklärenden Untertitel oder Betriebshinweise.

```
Genesys Cloud
Presence-Report                                                        ⟳ Neu laden
                                                                        Stand 10:42
[Kennzahlen: je Status Dauer · Anzahl · Mitarbeiter        | Mitarbeiter 44 ]
[‹] [Datum wählen] [Gestern · Mi 24.09.] [Heute · Do 25.09.] [›]     [ Genesys | Opcyc ]
[Suche…            ] [Status ▾]                              44 Mitarbeiter  [CSV]
┌────────────┬─────────┬──────────────┬─────────────┬───────┬─────┬───┐
│ Mitarbeiter│ Logzeit │ Warteschleife│ Tokenlösch. │ Pause │ …   │   │
│ MA-7K3QD   │ 7:31:40 │ 4:02:10  38× │ 0:18:50  12×│ 0:45  │     │ ⋯ │
└────────────┴─────────┴──────────────┴─────────────┴───────┴─────┴───┘
                                        ⋯ → Klartext anzeigen · Details anzeigen
```

- **Datumswahl wie in der Zeitkorrektur:** von links „Datum wählen“ (Kalender, `min` = `first_day`, `max` = heute; nach der Wahl steht dort der gewählte Tag), „Gestern“, „Heute“ (Tage aus `GET /days`). Pfeile links und rechts springen einen Tag zurück bzw. vor. Sie erscheinen nur, wenn es in die Richtung weitergeht, also nicht nach heute und nicht vor `first_day`. Ohne Ziel sind sie unsichtbar, behalten aber ihren Platz, damit nichts verrutscht. Aussehen wie `.tc-days`, `.tc-pick`, `.tc-day-nav` (runde Icon-Knöpfe mit SVG-Chevron, `ui-flat-button` mit `aria-pressed`).
- **Kopf:** rechts „Neu laden“, am laufenden Tag mit „Stand hh:mm“ darunter, wie in der Zeitkorrektur.
- **Kennzahlen:** Team-Summen je Status (Dauer, Anzahl, Zahl der Mitarbeiter) und die Zahl der Mitarbeiter, deckende Karten.
- **Leiste:** Datumswahl links, Umschalter Genesys/Opcyc rechts. Tag und Quelle stehen in der URL (`?day=&source=`).
- **Filter:** Suche (Pseudonym oder ein bereits aufgedeckter Name), Auswahl der sichtbaren Status-Spalten (die Wahl merkt sich der Browser), Zähler-Chip, CSV-Export.
- **Tabelle:** eine Zeile je Mitarbeiter. Erste Spalte fixiert, dann Logzeit, dann eine Spalte je Status mit Einträgen am Tag. Zelle: Dauer `h:mm:ss`, darunter dezent die Anzahl `12×`, laufende Einträge markiert. Letzte Spalte: Knopf „⋯“, nur wenn mindestens eines der FN-Rechte vorliegt. Jede Spalte ist sortierbar (Dauer, bei Gleichstand Anzahl), Standard Logzeit absteigend. Keine Seitennummerierung, ein Tag hat unter 200 Zeilen.
- **Menü „⋯“ je Zeile:** „Klartext anzeigen“ (NAME-Recht) ersetzt in dieser Zeile das Pseudonym durch den Namen, das Pseudonym bleibt dezent daneben. „Details anzeigen“ (DETAIL-Recht) klappt die Zeile auf. Einträge erscheinen nur mit dem jeweiligen Recht. Beide Aktionen laden erst beim Klick und werden dann protokolliert. Ein erneuter Klick auf „Details“ klappt nur zu, ohne neuen Abruf.
- **Detailansicht:** Einzeldatensätze des Tages mit Beginn, Ende, Dauer und Status. In der Opcyc-Sicht zusätzlich die Herkunft (Genesys/Korrektur). Einträge über Mitternacht zeigen den echten Beginn und den Anteil am Tag.
- **Zustände:** Laden, „Keine Daten“, Fehler mit „Erneut laden“. Deckende Flächen auf `main`.

## Gemeinsamer Code

Genutzt wird, was ohne Umbau geht:

- `ui.css` für Überschrift, Chips, Eingaben, `ui-flat-button` und Modal, `base.js` für `hasPerm` und `showFlash`
- Tabellenkarte, Toolbar-Maße und Sortierköpfe nach dem Vorbild des IVR-Call-Detailreports. Die Klassen sind dort mit `ivr-call-details-` präfixiert und werden daher im eigenen `presence_report.css` nachgebaut, nicht geteilt
- **Datumswahl:** Die Tagesfunktionen `dayLabel`, `isPickableDay`, `shiftDay` und `orderDays` sind reine Funktionen in `time_correction_model.js`. Sie wandern in eine kleine gemeinsame Datei `static/js/day_picker.js` (UMD wie das Modell, mit Node-Tests), dazu kommen die zugehörigen Klassen als `.day-picker*` in `ui.css`. `isPickableDay`/`shiftDay` bekommen zusätzlich eine Untergrenze (`first_day`), die Zeitkorrektur braucht keine. Der Presence-Report nutzt nur diese Datei. Die Zeitkorrektur bleibt vorerst bei ihrem eigenen Code und wird bei der späteren Vereinheitlichung umgestellt

## Umsetzung

Entwickelt wird auf Branches bzw. in Worktrees (SD-API `feature/presence-report`, SOFA-Worktree), nie im laufenden Checkout. Jeder Schritt wird einzeln abgenommen. Freigabe, Migrationen, Deploy und Rechtevergabe macht der Nutzer.

| Schritt | Inhalt |
|---|---|
| **SD-API** | |
| A1 | Migration `…_presence_report_permissions.sql`: `SOFA-RPRT-PRSNC`, `SOFA-FN-PRSNC-NAME`, `SOFA-FN-PRSNC-DETAIL` (Muster `20260923_time_correction_permission.sql`), keine Rollenzuweisung. Migration `…_presence_report_access_log.sql` für das Protokoll |
| A2 | Grants `SoapAPI` auf `Genesys.sync_state`, `Genesys.sync_day` (freigegeben, einmalig in Prod). Dev/CI: `db/init/006_genesys_bootstrap.sh` um beide Tabellen erweitern |
| A3 | Modul `reporting/presence`: Repository (nutzt `fetch_day_presence`, `fetch_day_corrections`, `fetch_mapping` aus `time_correction.repository`), Service (Genesys- und Opcyc-Summen, Pseudonym, Rechte), Router mit `/day` samt Kalender |
| A4 | Name und Einzeldatensätze je Pseudonym samt Protokoll, CSV-Export |
| A5 | Tests: Mitternacht, 29.03. und 25.10.2026, offene Einträge heute und gestern, `missing_since`, Korrekturen in der Opcyc-Sicht, Pseudonym (stabil am Tag, anders am Folgetag, nie `user_id` in der Antwort), 403 je Recht, genau eine Protokollzeile je Abruf und keine bei 403/404, 422, leere Tage vor `first_day`. Abnahmeskript Monatssummen. Vertrag `docs/presence-report-api.md`, Testbaseline nachziehen |
| **SOFA** | |
| B1 | Proxy `app/routes/presence_report.py` und `api_client.presence_report_request`, Seite, Kachel, Recht in `tools()` aufnehmen (`sofa_permissions.json` führt Reports nicht einzeln, dort nichts zu tun) |
| B2 | `day_picker.js` mit Node-Tests und `.day-picker*` in `ui.css`, reine Logik in `presence_report_model.js`. Tagesansicht: Datumswahl, Kennzahlen, Tabelle (`ui-table-card`), Sortierung, Suche, Statusauswahl, Umschalter Genesys/Opcyc, CSV |
| B3 | Menü „⋯“ je Zeile: Klartext anzeigen, Details anzeigen |
| B4 | Tests für Proxy und Rechte, dieses Dokument auf den Stand der Umsetzung bringen |
| **Betrieb** | |
| C1 | SD-API: Image, Freigabe, Migrationen A1, Grants A2, Schlüssel in `.env`, Deploy |
| C2 | SOFA: ff-Merge nach `main` |
| C3 | Rechtevergabe an Rollen |

## Später bzw. außerhalb dieses Vorhabens

- Token-spezifische Funktionen (Einstieg, Kennzahlen, Woche/Jahr), Übernahme des Altbestands aus `Reporting.user_status` (für das letzte Jahr durch den Backfill ersetzt, davor nur Anzahlen ab 07/2025), Abschaltung von `/dashboard/token/`. Danach kann `purecloudhandler` endgültig entfernt werden
- Zeiträume Woche/Monat/Jahr, Einschränkung nach Team/Abteilung
- Oberfläche für das Zugriffsprotokoll
- Vereinheitlichung der Reports (Tagesnavigation, Toolbar, Tabellenkarte), Zeitkorrektur auf `day_picker.js` umstellen
