# Idee: Force-Priority Controls für abgeleitete Status

> Status: Idee / noch nicht umgesetzt. Backend-Unterstützung fehlt noch (siehe
> Abschnitt "Anfrage an Backend-Team" unten).

## Hintergrund

In der User-Detailansicht (`app/static/js/userverwaltung.js`,
`renderDerivedStatuses()`, ~Zeile 1608-1665) werden die "abgeleiteten Status"
eines Users (prozessgebundene Badges wie "Onboarding läuft", "Schulung
überfällig") angezeigt. Jede Karte hat bereits einen optionalen
"Prozess abbrechen"-Button (×), sichtbar nur mit Berechtigung
`SOFA-FN-PCNCL` und wenn der Status eine `processId` hat.

## Vorschlag

Zusätzlich zum Abbrechen-Button zwei kleine, vertikal gestapelte
Pfeil-Buttons (▲ Priorität erhöhen / ▼ Priorität senken) darunter anzeigen,
für Status, deren verknüpfter Prozess manuelle Prioritäts-Overrides
unterstützt. Damit könnte Ops-Personal die Reihenfolge eines Prozesses in
einer Backend-Queue manuell anpassen.

Anforderungen:
- Auth-gated über neue Berechtigung `SOFA-FN-PRIO` (analog zu
  `SOFA-FN-PCNCL` / `SOFA-FN-RMRL` / `SOFA-FN-ACC` — kommt vom Backend über
  `accessible_functions`, nicht aus `app/config/sofa_permissions.json`).
- Nur sichtbar, wenn der Prozess "prioritizable" ist (neues Feld
  `is_prioritizable` auf `derived_statuses[]`).
- ▲ deaktiviert bei `priority >= priority_max`, ▼ deaktiviert bei
  `priority <= priority_min`.
- Komplett ausgeblendet, wenn `!isPrioritizable` oder keine `processId`.
- Kein Bestätigungsdialog (anders als Cancel) — Buttons werden während des
  Requests deaktiviert, um Doppelklicks zu verhindern.

## Frontend-Umsetzung (BFF + UI), wenn Backend bereit ist

1. **`normalizeDerivedStatus`** (~Zeile 658-690) — neue Felder, defensiv
   gelesen:
   ```javascript
   priority: status.priority ?? null,
   priorityMin: status.priority_min ?? null,
   priorityMax: status.priority_max ?? null,
   isPrioritizable: Boolean(status.is_prioritizable)
   ```

2. **`api.setProcessPriority(processId, direction)`** — neue Methode neben
   `cancelProcess` (~Zeile 395-422), mirrored auf
   `POST /api/processes/{id}/priority` mit Body `{ direction: "up" | "down" }`.

3. **`renderDerivedStatuses`** (~Zeile 1608-1665):
   - `const canPrioritize = hasPerm("SOFA-FN-PRIO");`
   - Cancel-Button und neue Pfeil-Buttons in gemeinsamen Container
     `.user-derived-status-actions` innerhalb von `.user-derived-status-top`
     wrappen.
   - Pfeil-Buttons (`&#9650;` / `&#9660;`) nur rendern, wenn
     `canPrioritize && status.processId && status.isPrioritizable`, mit
     `disabled`, wenn `priority` an `priorityMax`/`priorityMin` anliegt.
   - Click-Handler: Buttons während Request deaktivieren, `setProcessPriority`
     aufrufen, danach `tableController.loadUsers()` +
     `sidebarController.refreshCurrentUser()`. Kein `window.confirm`.

4. **CSS** (`app/static/css/userverwaltung.css`):
   - `.user-derived-status-actions` (flex column container für Cancel +
     Priority-Group), nach `.user-derived-status-head` (~Zeile 739).
   - `.user-derived-status-priority-group` (flex column, kleine Pfeil-Buttons)
     und `.user-derived-status-priority-btn` (inkl. `:hover`/`:disabled`),
     nach `.user-derived-status-cancel-btn:hover` (~Zeile 778).
   - Mobile (`@media (max-width: 720px)`, ~Zeile 1342): `.user-derived-status-top`
     ist bereits `flex-direction: column`; zusätzlich
     `.user-derived-status-actions { align-self: flex-end; }`.

5. **`app/api_client.py`** — neue Methode nach `cancel_process` (~Zeile 220-221):
   ```python
   async def set_process_priority(self, process_id: int, payload: dict) -> dict:
       return await self._post(SOFA_BASE_URL, f"/processes/{process_id}/priority", payload=payload)
   ```

6. **`app/routes/api.py`** — neue Route nach `api_cancel_process` (~Zeile 1322-1335):
   ```python
   @router.post("/processes/{process_id}/priority")
   async def api_set_process_priority(process_id: int, payload: dict, current_user=Depends(require_permission("SOFA-FN-PRIO"))):
       direction = (payload or {}).get("direction")
       if direction not in ("up", "down"):
           return JSONResponse(content={"error": "Invalid direction; must be 'up' or 'down'"}, status_code=400)
       try:
           request_payload = {
               "initiator_user_id": current_user.user_id,
               "direction": direction,
           }
           result = await api_client.set_process_priority(process_id, request_payload)
           return JSONResponse(content=result)
       except httpx.HTTPStatusError as exc:
           return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
       except Exception as exc:
           return JSONResponse(content={"error": str(exc)}, status_code=500)
   ```
   Keine Änderungen an `app/authz.py` oder `app/config/sofa_permissions.json`
   nötig — legacy `SOFA-FN-*` Codes kommen aus `accessible_functions`
   (`app/authz.py:70`).

## Anfrage an Backend-Team

**Neue Felder auf `derived_statuses[]`-Einträgen:**

| Feld | Typ | Bedeutung |
|---|---|---|
| `priority` | int \| null | Aktuelle Priorität/Rang des verknüpften Prozesses. `null` = nicht anwendbar. |
| `priority_min` | int \| null | Untere Grenze — ▼ deaktiviert bei `priority <= priority_min`. |
| `priority_max` | int \| null | Obere Grenze — ▲ deaktiviert bei `priority >= priority_max`. |
| `is_prioritizable` | bool | Ob dieser Prozesstyp Prioritäts-Anpassung unterstützt. Default/Fehlen = `false` — abwärtskompatibel, kann pro Prozesstyp schrittweise eingeführt werden. |

**Neuer Endpunkt:** `POST /sofa/processes/{process_id}/priority`

Request-Body (vom BFF weitergeleitet):
```json
{ "initiator_user_id": 42, "direction": "up" | "down" }
```

Response: Frontend lädt nach erfolgreichem Request den User neu (`loadUsers()`
+ `refreshCurrentUser()`), der Response-Body selbst ist daher nicht
kritisch — 2xx mit parsebarem JSON reicht. Fehler analog zu
`/processes/{process_id}/cancel` (HTTP-Error-Status, JSON mit `detail` oder
`error`).

**Neuer Permission-Code:** `SOFA-FN-PRIO`, in `accessible_functions` für die
relevanten Rollen ergänzen (analog zu `SOFA-FN-PCNCL`/`SOFA-FN-RMRL`/`SOFA-FN-ACC`
— backend-seitig, nicht in `app/config/sofa_permissions.json`).

**Offene Fragen für Backend:**

1. **Ordinal vs. unabhängiger Score** — wenn `priority` eine Position in einer
   gemeinsamen Queue ist: verschiebt das Erhöhen eines Prozesses implizit
   andere? Falls ja, müssten ggf. auch andere User-Karten aktualisierte
   `priority`-Werte bekommen (aktuelles Frontend refresht nur den
   bearbeiteten User).
2. **Scope** — ist `priority` pro User oder global/queue-weit über mehrere
   User geteilt? Relevant für Konsistenz zwischen mehreren offenen
   Admin-Sichten.
3. **Audit-Logging** — analog Cancel: `initiator_user_id`, `direction`,
   Priorität vorher/nachher loggen. Bewusst kein `reason`-Feld (kein
   Confirm-Dialog) — bitte Feedback, falls das ein Problem ist.
4. **Stabilität der Grenzen** — `priority_min`/`priority_max` sollten sich
   zwischen Render und Klick nicht so verändern, dass der Disabled-Zustand
   vor dem Post-Action-Refresh sichtbar falsch wirkt.

## Betroffene Dateien (bei Umsetzung)

- `app/static/js/userverwaltung.js` — `normalizeDerivedStatus` (~658-690),
  `api`-Objekt (~395-422), `renderDerivedStatuses` (~1608-1665)
- `app/static/css/userverwaltung.css` — Card/Button-Styles (~717-788),
  Mobile-Media-Query (~1342)
- `app/api_client.py` — neue `set_process_priority` (~nach 221)
- `app/routes/api.py` — neue `POST /processes/{process_id}/priority` Route
  (~nach 1335)