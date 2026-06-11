# Anfrage an Backend-Team: Bulk-Endpoints für Task Assign/Release

## Hintergrund

Auf der Aufgaben-Seite gibt es "Alle übernehmen" (offene Tasks) und "Alle
freigeben" (eigene Tasks). Aktuell feuert das Frontend dafür pro Task einen
einzelnen Request, sequentiell nacheinander (`handleBulkTaskAction()` in
`app/static/js/tasks.js`). Bei größeren gefilterten Listen sind das N
Round-Trips statt einem. Ziel dieser Anfrage: zwei neue Bulk-Endpoints, die
das Frontend in einem einzigen Request abdecken.

Die bestehenden Einzel-Endpoints, an denen sich die neuen Bulk-Endpoints
orientieren sollen:

- `PATCH /sofa/tasks/{id}/assign?user_id={user_id}` – Task übernehmen
- `DELETE /sofa/tasks/{id}/assign?user_id={user_id}` – Task freigeben

Beide validieren aktuell pro Task:
- Task muss im Scope des Users liegen (sonst `403`,
  `{"code": "task_scope_denied", "message": "Kein Zugriff auf diesen Task oder dessen Backlog."}`)
- Assign nur für sich selbst (sonst `403`,
  `{"code": "assignment_denied", "message": "Tasks koennen nur an den aktuellen User uebernommen werden."}`)
- Konflikt (z.B. Task bereits übernommen) → `409`

## Neue Endpoints

### `POST /sofa/tasks/bulk-assign`

Request-Body:

```json
{
  "task_ids": [123, 456, 789],
  "user_id": 42
}
```

- Pro `task_id` gelten dieselben Regeln wie bei `PATCH /sofa/tasks/{id}/assign`
  (Task muss `OPEN` und im Scope von `user_id` sein, Assign nur für sich
  selbst).
- `task_ids` sollten serverseitig dedupliziert werden. Eine sinnvolle
  Obergrenze (z.B. 200 IDs pro Request) wäre gut.

Response `200`:

```json
{
  "results": [
    {
      "task_id": 123,
      "success": true,
      "task": { "...": "aktualisierter Task wie bisher von PATCH .../assign" }
    },
    {
      "task_id": 456,
      "success": false,
      "code": "assignment_denied",
      "message": "Task wurde bereits übernommen"
    },
    {
      "task_id": 789,
      "success": false,
      "code": "task_scope_denied",
      "message": "Kein Zugriff auf diesen Task oder dessen Backlog."
    }
  ]
}
```

- Einzelne fehlgeschlagene Tasks führen **nicht** zu einem Fehlerstatus für
  den ganzen Request – sie erscheinen einfach mit `success: false` im
  `results`-Array. Das Frontend zeigt dann eine Sammel-Meldung
  ("X übernommen, Y fehlgeschlagen").
- Request-level-Fehler (leeres/fehlendes `task_ids`, gar keine Berechtigung)
  weiterhin als `400`/`403` mit `{"code": ..., "message": ...}`, wie bisher.

### `POST /sofa/tasks/bulk-release`

Gleiches Schema, orientiert an `DELETE /sofa/tasks/{id}/assign`:

Request-Body:

```json
{
  "task_ids": [123, 456],
  "user_id": 42
}
```

Response `200`:

```json
{
  "results": [
    { "task_id": 123, "success": true, "task": { "...": "..." } },
    { "task_id": 456, "success": false, "code": "task_scope_denied", "message": "..." }
  ]
}
```

- Pro `task_id` gilt: nur eigene `IN_PROGRESS`-Tasks können freigegeben
  werden, gleiche Fehlercodes wie bei `DELETE /sofa/tasks/{id}/assign`.

## Abstimmung / Ergänzungen

Rückmeldung vom Backend-Team, abgestimmt mit dem User:

- Der "aktuelle User" für den `assignment_denied`-Check bei
  `POST /sofa/tasks/bulk-assign` wird über den `X-User-Id`-Header bestimmt
  (gleiches Muster wie `GET /sofa/me`). Er muss mit `user_id` im Body
  übereinstimmen.
- Die Checks `task_scope_denied` (403, Backlog-Scope) und `assignment_denied`
  (403, "nur für sich selbst") existieren aktuell nirgends im Code – auch
  nicht in den bestehenden Single-Endpoints (`assign_task`/`unassign_task`).
  Diese prüfen heute nur: Task existiert (404), Task-Status (409
  `InvalidTaskState`), User existiert (404), bei Release zusätzlich
  Eigentümer-Check (409 `TaskAssignmentError`).
- Die neuen Scope-/Self-Assign-Checks werden **nur für die neuen
  Bulk-Endpoints** neu eingeführt – kein Retrofit der bestehenden
  Single-Endpoints in diesem Schritt.
- `{"code": ..., "message": ...}`-Fehlerbodies kommen bei der BFF als
  `{"detail": {"code": ..., "message": ...}}` an (Standard-FastAPI-Wrapping
  von `HTTPException(detail=...)`, analog zu `detail=str(e)` bei den
  bestehenden Endpoints, nur strukturiert). Es gibt aktuell keinen globalen
  Exception-Handler, der `detail` flach macht – das wäre ein größerer,
  app-weiter Eingriff und ist hier nicht vorgesehen.

## Stand auf unserer Seite

Die BFF-Seite ist bereits umgesetzt und wartet auf die dev-api-Endpoints:

- `app/api_client.py`: `bulk_assign_tasks()` / `bulk_release_tasks()` rufen
  `POST /sofa/tasks/bulk-assign` bzw. `POST /sofa/tasks/bulk-release` auf
  (Body `{"task_ids": [...], "user_id": ...}`, bei bulk-assign zusätzlich
  `X-User-Id`-Header).
- `app/routes/api.py`: `POST /api/tasks/bulk-assign` und
  `POST /api/tasks/bulk-release` als dünne Proxy-Routen (Body
  `{"task_ids": [...]}`, `user_id` aus `current_user`, gleiche
  `require_permission("SOFA-PAGE-TODO")`-Prüfung wie bei den Einzel-Routen).
- `app/static/js/tasks.js`: `handleBulkTaskAction()` ruft
  `api.bulkAssignTasks(taskIds)` bzw. `api.bulkReleaseTasks(taskIds)` auf. Das
  `results`-Array wird direkt in die bestehende
  `buildBulkActionSummary()`-Logik gespeist (success/failed Aufteilung bleibt
  gleich).

Sobald `POST /sofa/tasks/bulk-assign` / `bulk-release` live sind, kann die
Funktion end-to-end über die "Alle übernehmen" / "Alle freigeben" Buttons
getestet werden.
