# IKS Berechtigungsreview (access_review)

## Berichtstyp

Das SD-API-Backend kennt zusaetzlich zu `process`, `role` und `system` den Typ
`access_review`. Der Bericht ist ein stichtagsbezogener Bestandsnachweis ueber die
gesamte Organisation und wird als XLSX mit fuenf Blaettern ausgeliefert: Deckblatt und
Freigabe, Person x Rolle, effektive Rollenpakete, Ist-Abgleich sowie Person x System.

Der Snapshot-Digest deckt die spaeter in Excel eingetragenen Bewertungen nicht ab. Der
technische Accountabgleich des PCI-relevanten Kundensystems bleibt ein eigener Nachweis.

## Berechtigung

Das Einzelrecht heisst `SOFA-IKS-REVIEW`. `SOFA-IKS-ALL` schliesst es ein; die
Wildcardaufloesung in `AuthorizationContext.has_permission` erledigt das ohne
Sonderfall. Bestehenden Rollen wird das Recht nicht automatisch zugewiesen.

## Endpunkte und BFF

| Kanonisch | SOFA-BFF | Status |
| --- | --- | --- |
| `GET /sofa/iks/catalog` | `GET /api/iks/catalog` | proxied |
| `POST /sofa/iks/reports` | `POST /api/iks/reports` | proxied |
| `GET /sofa/iks/reports/{report_id}` | - | bewusst nicht proxied |
| `GET /sofa/iks/reports/{report_id}/exports/xlsx` | `GET /api/iks/reports/{report_id}/exports/xlsx` | proxied |

`GET /sofa/iks/reports/{report_id}` ist Teil des Backendvertrags, hat in SOFA aber
keinen Aufrufer: der POST liefert den vollstaendigen Bericht zurueck und es gibt keine
Berichtshistorie. Ein Kommentar an `api_create_iks_report` haelt das fest, damit die
Luecke bei Aenderungen an diesen Routen bewusst bleibt. Beim Nachruesten gehoert eine
`api_client.get_iks_report()` dazu, die `_normalize_iks_export_links` anwendet.

`X-User-Id` setzt ausschliesslich die BFF aus der serverseitigen Session
(`APIClient._iks_headers`). Der Browser kann die Identitaet nicht bestimmen. Der
Download laeuft ueber die lokale BFF-Route; `getSafeExportUrl` laesst im Browser nur
Same-Origin-Pfade unterhalb von `/api/iks/` zu.

## Sichtbarkeit der Option

Die Kachel `Berechtigungsreview (PCI)` wird im Template nur fuer Traeger von
`SOFA-IKS-REVIEW` gerendert, und zwar `hidden` und `disabled`. Sichtbar wird sie erst,
wenn `GET /api/iks/catalog` in `available_report_types` den Wert `access_review`
liefert. Das Frontend baut keine eigene Berechtigungslogik nach.

Die BFF filtert `available_report_types` zusaetzlich gegen `IKS_REPORT_PERMISSIONS`,
analog zum bestehenden Filter fuer `process_types`, `roles` und `systems`. Fehlt das
Feld (aelteres Backend), faellt das Frontend auf die drei Alttypen zurueck und die
Option bleibt verborgen. Die Vorauswahl und Sichtbarkeit der drei Alttypen bleiben
unveraendert an den Templateberechtigungen haengen.

## Request

```json
{
  "report_type": "access_review",
  "target": null,
  "period": { "from": "2026-03-01", "to": "2026-08-31" },
  "timezone": "Europe/Berlin"
}
```

`target` ist zwingend `null`; ein nicht leeres Target beantwortet das Backend mit 422.
Beginn und Ende des organisatorischen Reviewzeitraums sind Pflichtfelder und nutzen die
bestehende Validierung (`from` darf nicht nach `to` liegen).

## Anzeige und Abgrenzung

Angezeigt werden Bericht-ID, Datenstand, Assessment und Kennzahlen. Die umfangreichen
Detaillisten des Snapshots werden bewusst nicht im Browser gerendert; es gibt keine
Person x Ressource-Tabelle. Kommentare, Bewertung und Managementfreigabe erfolgen
ausschliesslich in der heruntergeladenen XLSX-Datei und werden in SOFA nicht
gespeichert. Es gibt keine Reviewkampagnen, Erinnerungen oder Terminplanung.

Fuer `access_review` sind nur Kopfdaten, Assessment und Kennzahlen vertraglich
zugesichert. `findings`, `data_quality`, `details` und `integrity` prueft das Frontend
nur, wenn das Backend sie liefert - eine unerwartete Snapshotform blockiert damit weder
die Anzeige noch den Export. Fuer die drei Alttypen bleibt die Validierung streng.

## Timeout-Ausnahme

`APIClient` arbeitet mit 10 Sekunden. Fuer `create_iks_report` und
`download_iks_report_export` gilt `IKS_REPORT_TIMEOUT_SECONDS` (120 Sekunden), weil ein
organisationsweiter Snapshot samt XLSX-Erzeugung das Standardtimeout regelmaessig
reisst. Alle uebrigen Backendaufrufe bleiben unveraendert.

## Fehlerbilder

| Status | Bedeutung |
| --- | --- |
| 401 | fehlende oder ungueltige Benutzeridentitaet |
| 403 | fehlende IKS- beziehungsweise Access-Review-Berechtigung |
| 404 | Bericht oder Export nicht gefunden |
| 422 | ungueltiger Zeitraum oder nicht leeres `target` |

Die BFF prueft `SOFA-IKS-REVIEW` zusaetzlich lokal vor dem Backendaufruf und antwortet
mit 403 und dem Code `iks_report_access_denied`. Backendmeldungen reicht
`_error_content_from_response` unveraendert an die bestehende Fehlerdarstellung durch.
