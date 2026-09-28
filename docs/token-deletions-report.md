# Tokenlöschungs-Report

Der zusätzliche Report unter `/tools/token-deletion-report` bildet die kompakte Funktion des
früheren Token-Dashboards im SOFA-Design ab. Der allgemeine Presence-Report bleibt unverändert.

## Inhalt

- KPI für heute und gestern; der Datenstand stammt aus dem Presence-Wasserstand
- Jahresansicht mit zwölf Monatssummen
- Wochenansicht mit sieben Tagessummen
- unabhängige Navigation für Jahr und ISO-Woche
- ausschließlich die rollierende Presence-Historie, kein Zugriff auf `Reporting.user_status`

Gezählt werden nur abgeschlossene, nicht als fehlend markierte Einträge der Organisations-Presence
`c75ef493-3b3d-4d90-88f6-bcb848e8c16f`. Maßgeblich ist der Berliner Kalendertag des Beginns.

## Zugriff und API

Seite, SOFA-Proxy und SD-API verwenden ausschließlich `SOFA-RPRT-PRSNC`. Es gibt keine
personenbezogenen Daten, Detailfunktionen oder zusätzlichen Rechte.

SOFA proxyt `GET /api/reporting/token-deletions/overview` auf
`GET /reporting/token-deletions/overview` der SD-API. `year` und `week_start` werden als
URL-Parameter verwendet; ungültige oder nicht mehr verfügbare Direktlinks fallen in der Oberfläche
auf das aktuelle Jahr und die aktuelle Woche zurück.
