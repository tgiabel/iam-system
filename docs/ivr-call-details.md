# IVR Call-Detailreport

Der SOFA-Report ist unter `/tools/ivr-call-details` erreichbar und lädt seine Daten ausschließlich über den geschützten Proxy `GET /api/reporting/ivr/call-details?day=YYYY-MM-DD`. Beide Routen sowie die Tool-Karte verwenden `SOFA-RPRT-TIVR`.

## Backend-Abhängigkeit

Der Proxy erwartet im SD-API den Endpunkt `GET /reporting/ivr/call-details?day=YYYY-MM-DD` (im Reporting-Client: Basis-URL `/reporting` plus Pfad `/ivr/call-details`) mit dem im Arbeitsauftrag definierten Call-/Abschnittsvertrag. Dieser Endpunkt und seine Datenbankableitung sind nicht Teil dieses Frontend-Repositories. SOFA greift nicht direkt auf MariaDB zu und erzeugt keine Ersatzdaten. Solange der SD-API-Endpunkt nicht bereitsteht, zeigt der Report einen technischen Fehlerzustand mit Reload-Möglichkeit.

Der Proxy setzt bei fehlendem `day` gestern ein und lehnt heute, zukünftige Tage sowie ungültige Datumswerte ab.

## UX- und Exportentscheidungen

- Pagination, Suche und Sortierung arbeiten auf Call-Ebene. Detailabschnitte werden nur für geöffnete Calls der sichtbaren Seite in das DOM gerendert.
- Ein Ergebnis ist nur dann positiv klassifiziert, wenn sein getrimmter Wert `Verbunden` lautet. Jeder andere, leere oder künftig neue Wert wird mit Text und Warnsymbol als abweichend dargestellt, aber fachlich nicht umgedeutet.
- Der CSV-Export enthält alle aktuell gefilterten Calls, unabhängig von der sichtbaren Seite. Er verwendet eine Zeile pro Routingabschnitt und wiederholt die Call-Felder. Calls ohne gelieferte Abschnitte bleiben durch eine Summary-Zeile erhalten.
- `rufdauer` wird nicht angezeigt oder exportiert. Der Rohwert ist laut Datenbeschreibung keine Abschnittsdauer und derzeit fachlich nicht eindeutig genug, um ihn missverständnisfrei anzubieten.
- Abschnittsfolge, finales Ziel und finales Ergebnis sowie Gesamt- und Abschnittsdauern werden beim Einlesen tolerant aus den gelieferten Abschnitten normalisiert. Einzelne Abschnittszeiten werden ausdrücklich nicht aus dem Callstart errechnet.
