# Backend-Vertrag für die Rechnerverwaltung

Die SOFA-BFF erwartet den neuen Upstream-Bereich `/inventory`. Alle technischen
Inventardaten sind dort systemgeführt; SOFA darf ausschließlich `comment`
ändern und Verwaltungsaufträge auslösen.

## Übersicht und Details

`GET /inventory/computers/overview` liefert höchstens etwa 500 Rechner sowie
den Softwarekatalog:

```json
{
  "computers": [
    {
      "id": "pc-42",
      "hostname": "SD-PC-0042",
      "asset_tag": "INV-0042",
      "device_type": "Notebook",
      "model": "Latitude 5550",
      "fsv": {"version": "24.8", "installed_at": "2026-08-10T08:15:00Z"},
      "efix": {"version": "12.3", "installed_at": "2026-08-11T09:20:00Z"},
      "tranche": "B",
      "connectivity": {"status": "online", "last_seen_at": "2026-08-17T08:42:00Z"},
      "session": {"user_id": 805, "display_name": "Erika Muster", "logged_in_at": "2026-08-17T07:55:00Z"},
      "vpn_enabled": true,
      "comment": "Austausch im Q4",
      "location": {"kind": "home_office", "label": "Homeoffice", "room": null, "owner": {"user_id": 805, "display_name": "Erika Muster"}},
      "software": [{"software_id": "firefox", "version": "131.0"}],
      "open_job_count": 1
    }
  ],
  "software_catalog": [
    {"software_id": "firefox", "name": "Mozilla Firefox", "available_versions": ["131.0", "132.0"]}
  ]
}
```

- `connectivity.status`: `online`, `offline` oder `unknown`.
- `location.kind`: `office`, `warehouse`, `home_office` oder `unknown`.
- FSV-/EFix-Datum ist das Installationsdatum der gemeldeten Version.
- `session` und alle optionalen Werte dürfen `null` sein.

`GET /inventory/computers/{id}` ergänzt insbesondere `serial_number`,
`operating_system`, `architecture`, `ip_addresses`, `mac_addresses` und
`installed_software`. Softwareeinträge enthalten `software_id`, `name`,
`version`, `publisher` und `installed_at`.

## Kommentar und Power-Aktionen

`PATCH /inventory/computers/{id}/comment`:

```json
{"comment": "Freitext", "initiator_user_id": 42}
```

`POST /inventory/computers/{id}/power-actions`:

```json
{"action": "reboot", "confirm_active_session": true, "initiator_user_id": 42}
```

- `action`: `reboot` oder `shutdown`.
- Offline-/unbekannte Rechner werden für Power-Aktionen abgelehnt.
- Bei aktiver Sitzung muss `confirm_active_session=true` vorliegen.
- Erfolg liefert mindestens `job_id` und `status`.

## Softwareaufträge und Status

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
- Offline-Rechner erhalten `waiting_for_device` und werden beim nächsten
  Kontakt verarbeitet.
- Bei Deinstallation bereits nicht betroffene Rechner erhalten `skipped`.
- Request-Level-Fehler verwenden einen passenden HTTP-Status und
  `{"detail": "..."}`. Fehler einzelner Ziele stehen im `results`-Array.

```json
{
  "batch_id": "batch-17",
  "status": "running",
  "results": [
    {"computer_id": "pc-42", "job_id": "job-1", "status": "queued"},
    {"computer_id": "pc-43", "job_id": "job-2", "status": "waiting_for_device"}
  ]
}
```

`GET /inventory/computer-job-batches/{batch_id}` liefert dieselbe Struktur
mit dem jeweils aktuellen Status. `GET /inventory/computers/{id}/jobs?limit=50`
liefert `{"jobs": [...]}`. Gültige Statuswerte sind `queued`,
`waiting_for_device`, `running`, `succeeded`, `failed` und `skipped`.

Jeder Historieneintrag enthält soweit vorhanden `action`, `software_id`,
`software_name`, `status`, `initiator_name`, `created_at`, `started_at`,
`finished_at` und `message`.

## Berechtigungen

Das Berechtigungsbackend muss folgende SOFA-Identifier ausgeben:

- `SOFA-PAGE-COMPUTER`
- `SOFA-FN-COMPUTER-COMMENT`
- `SOFA-FN-COMPUTER-POWER`
- `SOFA-FN-COMPUTER-SOFTWARE`
