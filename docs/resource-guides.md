# Ressourcen-Anleitungen

Vertrag: SD-API `docs/resource-guides.md` (ab sd-api 3.4.0). Je Ressource gibt es eine optionale
Anleitung für Zuweisung und Entzug, mit Platzhaltern für Werte des Ziel-Users.

## Entscheidungen (17.11.2026)

- Die Anleitung ist für Vertretungen gedacht; wer die Ressource kennt, braucht sie nicht. Deshalb
  erscheint sie in der Task-Card nur auf ausdrücklichen Klick: Hilfe-Button im Kopf, Popover darunter. Der Button erscheint nur, wenn eine Anleitung gepflegt ist.
- Nur eigene Tasks in Bearbeitung (wie die API). Offene Tasks und „Direkt erledigen …“ zeigen keine
  Anleitung; der Vertrag bleibt so.
- Sichtbar in Bearbeitung und im Abschluss-Schritt (auch manuelle Erfassung nach Bot-Fehlschlag),
  nicht im Mail-Schritt. Unabhängig vom Handling-Typ.
- Runde 2 (18.11.2026): Hilfe-Button oben rechts links vom Schließen-Button, gleicher Button-Look,
  Icon nur „?“. Status-Badge darunter rechts unten im Kopf. Kopieren zeigt kurz einen Haken (Chip grün,
  Kennungs-Button ebenso).
- Zurückgestellt (18.11.2026): Hinweis auf eine archivierte Kennung bei fehlendem Kontowert (Klick auf
  „… fehlt“ zeigt Kennung und Archivierungsdatum). Braucht in `missing` je Eintrag `reason`
  (`none`/`archived`/`ambiguous`) und `archived: [{identifier, archived_at, in_use_by_other}]`.
  Bei Zuweisungen auf die Wiederherstellung über den Konto-Task verweisen, Kennung nicht als
  Kopier-Chip; Infozeile in der Anleitung statt zweitem Popover.
- Editor mit Platzhalter-Auswahl und Vorschau; lesende Ressourcenansicht (System- und Rollendetail)
  zeigt die Anleitung, wenn eine gepflegt ist.

## Umsetzung

| Teil | Ort |
|---|---|
| Renderer (escapen, dann `**fett**`, Listen, Links, Absätze, `Code` als Kopier-Chip) | `app/static/js/resource_guide.js`, Checks `tests/resource_guide_checks.js` |
| Task-Card: Abruf, Hilfe-Button, Popover, Kopieren | `tasks_board_detail.js`, `tasks_board_data.js`, Mock in `tasks_board_mock.js` |
| Editor im Ressourcen-Formular | `systemdetails.js` (`renderGuideFields`, `buildGuides`) |
| Lesende Ansicht | `detail_shared.js` (`renderResourceView`), `rollendetails.js` |
| Proxy | `GET /api/tasks/{id}/guide` (SOFA-PAGE-TODO, `X-User-Id`), `GET /api/resources/guide-placeholders` (SOFA-PAGE-SYS oder -ROLE) |

- Abruf beim Öffnen der Task-Card und nach dem Übernehmen; beim Freigeben verworfen. 403, 409, Fehler
  und `guide: null` heißen: kein Button.
- Warnungen nur für Schlüssel aus `missing`/`unknown` („Genesys-ID fehlt“); ein `{{…}}` aus einem
  eingesetzten Wert bleibt Text. Ein Chip mit fehlendem Wert ist nicht kopierbar. Links nur `http(s)`,
  nackte Links nur `https://`; ein Link mit offenem Platzhalter in der URL wird nicht verlinkt.
- Der Editor schickt in `guides` nur geänderte Vorgänge (fehlender Schlüssel = unverändert, leer = `null`).
  Unbekannte Platzhalter zeigt das Feld sofort; bei 422 wechselt das Formular zum genannten Vorgang.
- Mock: `/tasks?mock=normal`, jeder dritte Task ohne Anleitung, jeder zweite mit fehlender Genesys-ID.
