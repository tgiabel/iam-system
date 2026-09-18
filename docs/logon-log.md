# SOFA Anmeldeprotokoll und Finding-Prüfung

## Lieferumfang und Betriebsgrenze

Der Report unter `/tools/logon-log` liest ausschließlich über den SOFA-Proxy
`/api/reporting/logon-log` und SD-API `/reporting/logon-log`. Standard ist heute.
Die bestehende CSV-Mail bleibt unverändert. Es gibt keinen Papierimport, keine
neue Mailzustellung und keinen zusätzlichen Tagesabschluss.

LogonLog bleibt bewusst die Altquelle, bis R-8 aus der SD-MC-Bestandsaufnahme
(Sitzungshistorie des Inventory-Workers) separat entschieden und abgenommen ist.
Alle Reportabfragen bleiben lesend. Erst ein ausdrücklicher Prüfabschluss schreibt
in SOFA; offene Findings sind abgeleitete Zustände, keine gespeicherten Aufgaben.
Es gibt keine automatische Löschung von Prüfversionen.

## Fachliche Regeln

An-/Abmeldungen werden je normalisierter Kennung und Rechner rekonstruiert;
Zeitstempel plus Id bestimmen die Reihenfolge. Ohne passenden Abschluss gilt
maximal 16 h, eine Folgeanmeldung beendet die alte Sitzung angenommen. Eine echte
Abmeldung ist auch nach mehr als 16 h maßgeblich. Jede positive Überschneidung auf
verschiedenen Rechnern ist auffällig; ein IP-Wechsel ist kein zweiter Rechner.

Die aktuelle aktive Hauptrolle Agent (7) erzeugt ein Finding; Nebenrollen und
Vererbung begründen keine Prüfflicht. Widersprüchliche Hauptrollen werden als
ungeklärt behandelt. RACF-Kennungen werden ausschließlich über System 7, Ressource
29 und eindeutig zuordenbare archivierte Konten aufgelöst. Bei Konflikten zwischen
historischen und aktuellen Kontoträgern wird keine Person geraten.

Prüfeinheit: Benutzer und Tag des Überschneidungsbeginns (spätere Anmeldung).
Eine Fortsetzung nach Mitternacht verweist auf diesen Tag und erzeugt keine zweite
Prüfung. Kontext vor dem Zeitraum und Abschlüsse danach werden berücksichtigt.
Naive DB-Zeiten gelten als Europe/Berlin; die Quelle kann die doppelte Stunde der
Zeitumstellung nicht eindeutig unterscheiden.

Die stabile Überschneidungskennung verwendet beide Anmelde-IDs. Der Belegfingerabdruck
enthält IDs, Rohzeitstempel, Typ, Kennung und Rechner der beteiligten Ereignisse.
Abgeleitete Enden, Dauern und Qualitätslabels gehören nicht hinein. Eine spätere
Abmeldung oder neue Überschneidung kann erneut Prüfbedarf erzeugen; Zeitablauf nicht.

## Rechte und Schnittstellen

Alle Aufrufe benötigen SOFA-RPRT-LL und eine aktive SOFA-Identität. X-User-Id stammt
im Proxy ausschließlich aus der angemeldeten Sitzung. SD-API nutzt die bestehende
Vertrauensgrenze im internen Backend-Netz und prüft dieselben Rechte erneut.

| Schnittstelle unter /reporting/logon-log | Zusatzrecht / Vertrag |
|---|---|
| GET /day?day=YYYY-MM-DD | kein Zusatzrecht; Standard heute |
| GET /users?q=Suchtext | SOFA-FN-LL; eindeutige aktuelle/archivierte Kontoträger |
| POST /names | SOFA-FN-LL; JSON `{ "usernames": ["YC00001"] }` |
| GET /analysis?user_id=ID&start=DATE&end=DATE&include_logs=false | SOFA-FN-LL; zuerst Auffälligkeiten, Logs optional |
| GET /reviews/ID/DATE | SOFA-FN-CHECKLL; Name, aktuelle Belege, unveränderliche Historie |
| POST /reviews/ID/DATE | SOFA-FN-CHECKLL; Ursache Pflicht, Maßnahmen optional |
| GET /export?scope=day&day=DATE | kein Zusatzrecht; gefilterte Tageslogs |
| GET /export?scope=findings\|all&user_id=ID&start=DATE&end=DATE | SOFA-FN-LL; Beteiligungslogs inklusive Kontext oder reine Zeitraumlogs |

POST /reviews übermittelt `expected_fingerprint`, `expected_version`, `cause`,
`measures` und bei Folgeversionen `change_reason`. Der Bearbeiter ist kein Bodyfeld.
Konflikte und inaktiver Workflow antworten 409, fehlende Rechte 403, ungültige
Eingaben 422. Beim Konflikt muss der Prüfer die aktuellen Belege neu laden.

Antworten enthalten `data_as_of`, `workflow_enabled`, `introduction_day`, Regelversion,
Ereigniszähler, Cases und `other_open_days`. Jeder Case trennt `classification`
(finding/anomaly/unresolved), `review_state`, `quality` und `review_required`.
`retained_reviews` erhält lesbare Verweise auf gespeicherte Prüfungen, deren
Überschneidung aktuell nicht mehr zugeordnet werden kann. Es enthält nur Kennungen,
Rechner, Benutzer-ID, Prüftag und Version, keine privaten Snapshotfelder.
Normale Antworten enthalten weder Namen noch Ursachen/Maßnahmen. Private Details
sind nur im gezielt geschützten Prüfaufruf enthalten. Der Tabellen-Toggle lädt
Namen erst bei Aktivierung nach. SOFA-RPRT-ALL und SOFA-FN-ALL gelten entsprechend
der bestehenden Wildcard-Regeln; FN-ALL gewährt beide Funktionsrechte.

CSV enthält Id, TimeStamp, Computername, Username, Typ, IP, UTF-8 BOM und
Semikolon-Trennung. Gruppierung und sichtbare Seite reduzieren niemals den Export.
`search`, `event_type` und `status` sind Exportfilter; die Erkennung wird vorher
ungefiltert ausgeführt. Beteiligungslogs werden dedupliziert und dürfen außerhalb
des gewählten Zeitraums liegen. Namen und Prüftexte werden nie exportiert.

## Lokale Entwicklung und Abnahme

`make dev-migrate` führt zusätzlich den wiederholbaren
`db/init/005_logon_log_bootstrap.sh` aus. Er erzeugt nur in Dev/CI das Quellschema,
SELECT-Rechte und synthetische Ausgangsressourcen. Kein Produktionsdump ist nötig.
Integrationstests laden synthetische Logereignisse mit dem CI-Root-Benutzer; der
Laufzeitbenutzer besitzt auf der Quelltabelle ausschließlich SELECT.

Neue Migrationen sind 20260918_logon_log_permissions.sql und
20260918_logon_log_reviews.sql. Die historische baseline.sha256 bleibt unverändert.
Die Rechtemigration verlangt genau eine SOFA-RPRT-TIVR-Ausgangsressource und prüft,
dass jedes neue Recht genau einmal existiert. Fehlende Voraussetzungen führen zu
einem expliziten Fehler. Rollen erhalten keine automatischen Zuordnungen.

Die digitale Bearbeitung ist nach der Migration weiterhin gesperrt. Zur fachlichen
Abnahme einen vom Prüfer festgelegten historischen Zeitraum im Report und über die
Benutzerrecherche gegen vorhandene Papierfindings vergleichen. Zusätzliche/fehlende
Treffer, vermutete Sitzungsenden und Zuordnungslücken dokumentieren. Die SQL-Näherung
im Review begrenzt auch echte Sitzungen auf 16 h und ist kein Referenzalgorithmus.
Aktuelle fehlende Konten im bestehenden EDITACC-Prozess pflegen; ausgeschiedene
Benutzer nicht pauschal als aktuelle Konten nacherfassen.

Nach Tests/Review separat Release und produktive Migrationen autorisieren. Danach
Leserecht und Abfragezeiten prüfen; Indizes bedarfsabhängig durch den DBA anlegen.
Die Aktivierung mit unveränderlichem Einführungstag ist ein eigener ausdrücklich
freigegebener Schritt mit dokumentierter Abnahmereferenz. Sie ist weder Startup-
Hook noch HTTP-Funktion. Das Kommando steht im Docker-Betriebsrunbook.

Die SOFA-Implementierung wird in einem isolierten Checkout entwickelt, da der
laufende SOFA-Container einen Quellcode-Bind-Mount hat. Ein Merge in dessen aktiven
Checkout wäre eine produktive Änderung und gehört zur separaten Releasefreigabe.
