# Backend-Vertrag für die Rechnerverwaltung

Die SOFA-BFF ruft den Upstream-Bereich `/inventory` von SD-API auf. Alle
technischen Inventardaten sind dort systemgeführt; SOFA darf ausschließlich
`comment` ändern und Verwaltungsaufträge auslösen.

Verbindlich für die Umsetzung ist
`/var/www/html/api/docs/computer-inventory-s1-plan.md`, Abschnitt 3 und 4.
Dieses Dokument ist dessen Sicht aus der BFF.

## Aufrufweg und Authentifizierung

Jeder Aufruf trägt den Kopf **`X-User-Id`** mit der serverseitig bestimmten
Benutzer-ID aus `current_user`. Der Browser übermittelt sie nie selbst.

SD-API prüft die Berechtigungen erneut — dieselbe `resources`-Tabelle, aus der
die BFF ihre Rechte bezieht, mit derselben Wildcard-Regel. Das ist keine zweite
Wahrheit, sondern ein zweites Tor an derselben: SD-API ist im Netz
`sd-api-backend` für jeden Container erreichbar, der dort hängt.

| Fall | Antwort |
|---|---|
| `X-User-Id` fehlt | `401` |
| nicht ganzzahlig oder nicht positiv | `400` |
| Benutzer unbekannt oder inaktiv | `401` |
| kein SOFA-Zugang, oder Kennung fehlt | `403` |

Fehler haben durchgehend die Form `{"detail": "..."}`. Die BFF reicht Körper und
Statuscode unverändert weiter.

## Stand der Umsetzung

| Route | Stand |
|---|---|
| `GET /inventory/computers/overview` | bedient |
| `GET /inventory/computers/{id}` | bedient |
| `PATCH /inventory/computers/{id}/comment` | bedient |
| `GET /inventory/computers/{id}/jobs` | Stummel, liefert immer `{"jobs": []}` |
| `POST /inventory/computers/{id}/power-actions` | noch nicht — Stufe S4 |
| `POST /inventory/computers/software-actions` | noch nicht — Stufe S5 |
| `GET /inventory/computer-job-batches/{batch_id}` | noch nicht — Stufe S5 |

Die Oberfläche darf Power- und Softwareaktionen deshalb nicht als
funktionsfähige Schaltflächen anbieten.

## Übersicht

`GET /inventory/computers/overview` liefert höchstens 500 Rechner.

```json
{
  "computers": [
    {
      "id": "b41b4dee-77bf-4f80-9913-f9e888543dda",
      "hostname": "FW0F489C",
      "is_disabled": false,
      "device_type": "laptop",
      "model": "Latitude 5550",
      "connectivity": {"status": "online", "last_seen_at": "2026-08-21T08:42:00.000000Z"},
      "session": {
        "user_id": null,
        "username": "SERVODATA\\muster",
        "display_name": "SERVODATA\\muster",
        "logged_in_at": "2026-08-21T07:55:00.000000Z"
      },
      "vpn_enabled": true,
      "comment": "Austausch im Q4",
      "software": [],
      "open_job_count": 0,
      "data_status": {
        "hardware":         {"status": "ok",        "observed_at": "2026-08-21T08:40:00.000000Z", "status_updated_at": "2026-08-21T08:40:01.000000Z"},
        "operating_system": {"status": "ok",        "observed_at": "2026-08-21T08:40:00.000000Z", "status_updated_at": "2026-08-21T08:40:01.000000Z"},
        "network":          {"status": "ok",        "observed_at": "2026-08-21T08:40:00.000000Z", "status_updated_at": "2026-08-21T08:40:01.000000Z"},
        "software":         {"status": "stale",     "observed_at": "2026-08-20T08:40:00.000000Z", "status_updated_at": "2026-08-21T08:40:01.000000Z"},
        "session":          {"status": "not_found", "observed_at": "2026-08-21T08:42:00.000000Z", "status_updated_at": "2026-08-21T08:42:00.000000Z"}
      },
      "asset_tag": null,
      "fsv": null,
      "efix": null,
      "tranche": null,
      "location": null
    }
  ],
  "software_catalog": [],
  "meta": {"limit": 500, "truncated": false}
}
```

- `connectivity.status`: `online`, `offline` oder `unknown`. **Berechnet, nicht
  gespeichert**: `online` bis einschließlich 90 Sekunden nach dem letzten
  Kontakt, ohne jeden Kontakt `unknown`. `unknown` ist etwas anderes als
  `offline` und darf in der Anzeige nicht damit verschmolzen werden.
- `device_type` ist technisch: `desktop`, `laptop`, `virtual`, `server` oder
  `unknown`. **SOFA übersetzt** in Desktop, Notebook, Virtuell, Server,
  Unbekannt — nur in der Anzeige und in der Filterbeschriftung; die Filterwerte
  bleiben technisch.
- `is_disabled` markiert einen stillgelegten Rechner. Er wird **mit
  ausgeliefert** und muss ausdrücklich als „Deaktiviert" erkennbar sein, nicht
  wie ein gewöhnlich offline stehender Rechner wirken.
- `meta.truncated` sagt, dass abgeschnitten wurde. Die Oberfläche zeigt dann
  einen Hinweis; stilles Abschneiden ist nicht zulässig.
- `software` ist in S1 immer `[]` und `software_catalog` ebenso: der volle
  Bestand steht im Detail, ein Katalog existiert vor dem Software-Onboarding
  nicht. Die Felder bleiben im Vertrag.
- Sortierung: aktive Rechner zuerst, dann Hostname, namenlose zuletzt.

## Datenstand

`data_status` gibt es je Rechner für `hardware`, `operating_system`, `network`,
`software` und `session`. Er ist der Ersatz für den stillen Leerwert: ein Feld
ohne Inhalt sagt sonst nicht, ob nichts vorhanden oder nichts gemeldet ist.

| `status` | Bedeutung | Nutzdaten |
|---|---|---|
| `ok` | aktuell gemeldet | vorhanden |
| `stale` | der Collector hat gemeldet, dass sein Wert veraltet ist | letzter guter Stand, weiter ausgeliefert |
| `error` | der Collector ist gescheitert | letzter guter Stand, weiter ausgeliefert |
| `not_found` | der Collector hat die Abwesenheit belegt | keine |
| `unknown` | zu diesem Rechner wurde diese Sektion noch nie gemeldet | keine |

`observed_at` ist die Beobachtungszeit der **ausgelieferten Nutzdaten**,
`status_updated_at` der Zeitpunkt des letzten Zustandswechsels. Bei `stale` und
`error` fallen die beiden auseinander, und genau daran ist das Alter ablesbar.

`stale` und `error` sind Warnungen, `not_found` und `unknown` neutrale Zustände.
Technische Fehlertexte des Collectors verlassen SD-API **nicht** und dürfen
folglich auch nicht angezeigt werden.

## Detail

`GET /inventory/computers/{id}` enthält die Felder der Übersicht — außer
`software` — und ergänzt:

```json
{
  "serial_number": "5CD1234ABC",
  "manufacturer": "Dell Inc.",
  "cpu_model": "Intel Core Ultra 7",
  "cpu_cores": 16,
  "memory_bytes": 34359738368,
  "operating_system": {"name": "Windows 11 Enterprise", "version": "10.0.26100", "build": "26100"},
  "architecture": "x64",
  "ip_addresses": ["10.0.0.42"],
  "mac_addresses": ["AA:BB:CC:DD:EE:FF"],
  "network_addresses": [
    {"interface_name": "Ethernet", "ip_address": "10.0.0.42", "mac_address": "AA:BB:CC:DD:EE:FF", "family": "ipv4", "is_vpn": false}
  ],
  "installed_software": [
    {
      "software_id": null,
      "name": "Mozilla Firefox",
      "version": "131.0",
      "publisher": "Mozilla",
      "installed_at": null,
      "installed_on": "2026-08-10",
      "source": "exe"
    }
  ]
}
```

- **`operating_system` ist ein Objekt**, kein Text. Die Oberfläche setzt die
  vorhandenen Bestandteile lesbar und ohne Dopplung zusammen.
- `memory_bytes` ist eine Zahl in Byte; die Formatierung macht SOFA.
- `ip_addresses` und `mac_addresses` sind flach und dedupliziert, in stabiler
  Reihenfolge. `network_addresses` trägt dieselben Angaben je Schnittstelle,
  inklusive `family` und `is_vpn`.
- `vpn_enabled` ist wahr, sobald mindestens eine gemeldete Adresse
  `is_vpn: true` trägt.
- **`installed_at` bleibt `null`.** Der Worker meldet ein Datum ohne Uhrzeit;
  es steht unverändert in `installed_on` (`YYYY-MM-DD`). Ein Mitternachtswert
  wäre erfunden. Die Oberfläche zeigt `installed_on`.
- **`software_id` bleibt `null`**, solange es kein Software-Onboarding gibt.
  Der Worker meldet Namen, keine stabile ID; ein selbst gebauter Ersatzschlüssel
  müsste später wieder ersetzt werden. Die Anzeige führt über `name`.
- `source` ist die technische Herkunft: `msi`, `exe`, `appx`, `fsv`, `efix` oder
  `unknown`. Das ist **keine** Softwarekategorie und ersetzt nicht die spätere
  Einteilung in selbstverwaltet, bankverwaltet und unbekannt.
- Das Detail trägt den Bestand ausschließlich als `installed_software`,
  **nicht** zusätzlich als `software`.
- `session.user_id` bleibt `null`, bis die Auflösung der Windows-Kennung auf
  einen SOFA-Benutzer steht. `username` und `display_name` tragen solange die
  Windows-Kennung. Eine Sitzung wird deswegen nicht unterdrückt — ein belegter
  Rechner darf nicht als frei erscheinen.

## Kommentar

`PATCH /inventory/computers/{id}/comment`, mit `X-User-Id`:

```json
{"comment": "Freitext", "initiator_user_id": 42}
```

- `initiator_user_id` muss mit `X-User-Id` übereinstimmen; sonst `400`.
- Der Text wird getrimmt, höchstens 4000 Zeichen. Leer heißt `null`.
- Unbekannte Felder im Körper werden abgewiesen.
- Antwort: `{"id": "...", "comment": "Freitext"}` beziehungsweise `comment: null`.
- **Wiederholbar ohne `Idempotency-Key`**: ein unveränderter Text erzeugt weder
  einen Schreibvorgang noch einen Journaleintrag. Der Verlauf enthält damit nur
  tatsächliche Änderungen, jeweils mit Initiator und Vorher/Nachher.

## Aufträge

`GET /inventory/computers/{id}/jobs?limit=50` liefert `{"jobs": []}`, solange es
kein Auftragsmodell gibt. Ein unbekannter Rechner ist auch dort `404`. Der
Stummel existiert, damit die Detailansicht keinen 404 auslöst.

Ab Stufe S4 enthält jeder Historieneintrag, soweit vorhanden: `action`,
`software_id`, `software_name`, `status`, `initiator_name`, `created_at`,
`started_at`, `finished_at` und `message`. Gültige Statuswerte sind `queued`,
`waiting_for_device`, `running`, `succeeded`, `failed` und `skipped`.

## Später: Power- und Softwareaktionen

Noch nicht bedient. Die Form steht hier, damit sie sich bis dahin nicht
unbemerkt verschiebt.

`POST /inventory/computers/{id}/power-actions`:

```json
{"action": "reboot", "confirm_active_session": true, "initiator_user_id": 42}
```

- `action`: `reboot` oder `shutdown`.
- Offline- und unbekannte Rechner werden abgelehnt.
- Bei aktiver Sitzung muss `confirm_active_session=true` vorliegen.
- Erfolg liefert mindestens `job_id` und `status`.

`POST /inventory/computers/software-actions`:

```json
{
  "computer_ids": ["pc-42", "pc-43"],
  "action": "install",
  "software_id": "firefox",
  "version": "132.0",
  "initiator_user_id": 42
}
```

- `action`: `install` oder `uninstall`; maximal 500 deduplizierte Rechner.
- Offline-Rechner erhalten `waiting_for_device`.
- Bereits nicht betroffene Deinstallationsziele erhalten `skipped`.
- Fehler einzelner Ziele stehen im `results`-Array, Request-Level-Fehler in
  `{"detail": "..."}`.

`GET /inventory/computer-job-batches/{batch_id}` liefert dieselbe Struktur mit
dem jeweils aktuellen Stand.

## Berechtigungen

Das Berechtigungsbackend gibt folgende SOFA-Identifier aus:

- `SOFA-PAGE-COMPUTER`
- `SOFA-FN-COMPUTER-COMMENT`
- `SOFA-FN-COMPUTER-POWER`
- `SOFA-FN-COMPUTER-SOFTWARE`

`SOFA-PAGE-STANDORT` bleibt übergangsweise als reines Leserecht akzeptiert. Die
Wildcards `SOFA-PAGE-ALL` und `SOFA-FN-ALL` gelten in SD-API genau wie in der
BFF.

Lesen verlangt `SOFA-PAGE-COMPUTER`, `SOFA-PAGE-STANDORT` oder `SOFA-PAGE-ALL`.
Der Kommentar verlangt `SOFA-FN-COMPUTER-COMMENT` oder `SOFA-FN-ALL` — ein
Seitenrecht allein genügt dafür nicht.

## Nicht bediente Felder

`asset_tag` ist verworfen. `tranche` und `location` sind zurückgestellt. `fsv`
und `efix` folgen in Stufe S2, `software_catalog` und `software_id` mit dem
Software-Onboarding.

Alle bleiben im Vertrag und liefern sauber `null` beziehungsweise `[]`. Die
Oberfläche zeigt sie als „–", nicht als Fehler.
