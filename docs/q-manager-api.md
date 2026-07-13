# Q-Manager API — Frontend-Referenz

Backend-Routen des Queue-Managers (Live-Allokieren & Monitoren von Agenten zu Genesys-Queues).
Stand: Rework `refactor/edge-case-handling`.

## Grundlagen

- **Base-Path:** `/q-manager` (FastAPI-Router-Prefix). Im Deployment hinter dem Proxy als `/api/q-manager/...` erreichbar.
- **IDs sind Genesys-GUIDs.** `queue_id` und `user_id` in den Routen sind die Genesys-GUIDs. Die `user_id` bekommt das Frontend bereits aus der Memberliste (`GET /queues/{id}/members` → `user_id`); es ist kein separater User-Lookup nötig.
- **Immer volle Listen, keine serverseitige Filterung.** GET-Routen liefern die komplette Liste; jedes Item trägt das `joined`-Feld. Das Filtern (z. B. „nur joined") macht das Frontend. Paging (pageSize 100) wird serverseitig vollständig aufgelöst — der Client bekommt alles in einem Response.
- **Eventual Consistency bei PATCH.** Genesys verarbeitet Join/Unjoin **asynchron**; die PATCH-Response spiegelt die **angeforderte Absicht**, nicht zwingend den finalen Stand. Für den echten Zustand nach einer Mutation den passenden GET (ggf. nach kurzer Verzögerung) erneut aufrufen.
- **Fehler-Codes:** `400` (Validierung/Konfiguration), `502` (Upstream-Fehler von Genesys), `500` (unerwartet). Fehlerbody im FastAPI-Standard: `{"detail": "..."}`.

---

## Endpunkte

### 1. `GET /q-manager/queues/all`
Alle Queues mit Mitglieder- und Joined-Zähler (für die Übersicht/KPIs).

**Response** `200` — `QueueSummary[]`:
```json
[
  { "queue_id": "d6836bb6-d81e-4639-b100-591fad3a4838", "name": "[INT]_Apple_Pay", "member_count": 12, "joined_member_count": 5 },
  { "queue_id": "2aaba505-9b97-421c-9a92-058aebb26572", "name": "[INT]_DZ_3D_Secure", "member_count": 8,  "joined_member_count": 8 }
]
```
- `member_count` = Mitglieder gesamt, `joined_member_count` = davon aktuell aktiv (joined). Kommt direkt aus dem Queue-Objekt — kein Per-Queue-Member-Fetch nötig.

---

### 2. `GET /q-manager/queues/{queue_id}/members`
Komplette Mitgliederliste einer Queue inkl. Live-Status. Bildet beide „Panes" ab: aktiv = `joined:true`, verfügbar/inaktiv = `joined:false`.

**Response** `200` — `QueueMember[]`:
```json
[
  {
    "user_id": "ee39973a-2646-4542-8842-4e2106473818",
    "name": "Abel Tesfe",
    "joined": true,
    "ring_number": 1,
    "routing_status": "IDLE",
    "presence": { "system_presence": "Available", "message": "Still Loading ..." }
  }
]
```
- `routing_status`: `IDLE` | `INTERACTING` | `OFF_QUEUE` | `COMMUNICATING` | … (kann `null` sein).
- `presence.system_presence`: `Available` | `Busy` | `Away` | `Offline` | … `presence` kann `null` sein, wenn keine Präsenz vorliegt.

---

### 3. `PATCH /q-manager/queues/{queue_id}/members`
Mehrere User für **eine** Queue joinen/unjoinen (Einzelaktion = Liste mit einem Element). Es geht **nur** um joined-Toggle, nicht um Membership-Verwaltung — der User muss bereits Mitglied der Queue sein.

**Request:**
```json
{ "user_ids": ["ee39973a-...", "a1b2c3d4-..."], "joined": true }
```

**Response** `200` — `QueueOperationResult`:
```json
{
  "accepted": true,
  "joined": true,
  "requested_ids": ["ee39973a-...", "a1b2c3d4-..."],
  "note": "Genesys verarbeitet Join/Unjoin asynchron; aktuellen Stand per GET nachladen."
}
```
- `joined:true` = joinen, `joined:false` = unjoinen.
- **Nach dem PATCH** Queue-Member (Route 2) erneut laden, um den echten Stand zu zeigen (siehe Eventual Consistency).

---

### 4. `GET /q-manager/users/{user_id}/queues`
Alle Queue-Mitgliedschaften eines Users inkl. joined-Status.

**Response** `200` — `UserQueueMembership[]`:
```json
[
  { "queue_id": "d6836bb6-...", "name": "[INT]_Apple_Pay", "joined": true },
  { "queue_id": "df36fc8c-...", "name": "[Playground] Fax", "joined": false }
]
```

---

### 5. `PATCH /q-manager/users/{user_id}/queues`
Mehrere Queues für **einen** User joinen/unjoinen.

**Request:**
```json
{ "queue_ids": ["d6836bb6-...", "2aaba505-..."], "joined": false }
```

**Response** `200` — `QueueOperationResult` (analog Route 3).
- Nach dem PATCH die User-Queues (Route 4) erneut laden.

---

## Datenmodelle

| Modell | Felder |
|---|---|
| `QueueSummary` | `queue_id: str`, `name: str?`, `member_count: int`, `joined_member_count: int` |
| `QueueMember` | `user_id: str`, `name: str?`, `joined: bool`, `ring_number: int?`, `routing_status: str?`, `presence: QueueMemberPresence?` |
| `QueueMemberPresence` | `system_presence: str?`, `message: str?` |
| `UserQueueMembership` | `queue_id: str`, `name: str?`, `joined: bool` |
| `QueueOperationResult` | `accepted: bool`, `joined: bool`, `requested_ids: str[]`, `note: str` |

## Typische Flows

- **Übersicht/Equalizer:** `GET /queues/all` → `member_count` / `joined_member_count` rendern.
- **Queue-Detail (Member verwalten):** `GET /queues/{id}/members` → nach `joined` aufteilen (aktiv vs. verfügbar) → Änderungen sammeln → `PATCH /queues/{id}/members` (je Richtung ein Call mit `joined:true`/`false`) → `GET /queues/{id}/members` neu laden.
- **User-Detail (Queues eines Agenten):** `GET /users/{guid}/queues` → filtern nach `joined` → `PATCH /users/{guid}/queues` → neu laden.

> Hinweis: Das Tool ist bewusst zustandslos/live — kein Caching, keine DB. Für Monitoring einfach die GET-Routen (ggf. per Refresh/Intervall) neu abrufen.
