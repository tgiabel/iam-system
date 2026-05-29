Q-Manager API

Basis-Pfad: /q-manager

GET /q-manager/queues/all
Kurzbeschreibung: Liefert alle verfügbaren Genesys-Queues für die Auswahl im Frontend.
Response:

{
  "total_queues": 2,
  "queues": [
    {
      "queue_id": "queue-1",
      "queue_name": "Support",
      "joined": true
    },
    {
      "queue_id": "queue-2",
      "queue_name": "Sales",
      "joined": false
    }
  ]
}
GET /q-manager/queues/{queue_id}/members
Kurzbeschreibung: Liefert alle Mitglieder einer bestimmten Queue.
Path params:

{
  "queue_id": "string"
}
Response:

{
  "queue_id": "queue-1",
  "total_members": 2,
  "members": [
    {
      "id": "member-assignment-1",
      "name": "Max Mustermann"
    }
  ]
}
POST /q-manager/queues/{queue_id}/members
Kurzbeschreibung: Fügt mehrere User einer Queue hinzu.
Path params:

{
  "queue_id": "string"
}
Request:

{
  "member_ids": ["user-1", "user-2"]
}
Response:

{
  "status": "success",
  "action": "add_members",
  "queue_id": "queue-1",
  "affected_users": ["user-1", "user-2"],
  "message": "2 Benutzer zur Queue queue-1 hinzugefügt",
  "details": {}
}
POST /q-manager/queues/{queue_id}/members/remove
Kurzbeschreibung: Entfernt mehrere User aus einer Queue.
Request:

{
  "member_ids": ["user-1", "user-2"]
}
Response:

{
  "status": "success",
  "action": "remove_members",
  "queue_id": "queue-1",
  "affected_users": ["user-1", "user-2"],
  "message": "2 Benutzer aus Queue queue-1 entfernt",
  "details": {}
}
PATCH /q-manager/queues/{queue_id}/members
Kurzbeschreibung: Führt Bulk-Änderungen an Queue-Mitgliedern aus.
Request:

{
  "operations": [
    { "operation": "add", "user_id": "user-1" },
    { "operation": "remove", "user_id": "user-2" }
  ]
}
Response:

{
  "status": "success",
  "action": "bulk_update_members",
  "queue_id": "queue-1",
  "affected_users": [],
  "message": "Queue-Mitglieder aktualisiert",
  "details": {}
}
DELETE /q-manager/queues/{queue_id}/members/{member_id}
Kurzbeschreibung: Entfernt genau ein Mitglied aus einer Queue.
Path params:

{
  "queue_id": "string",
  "member_id": "string"
}
Response:

{
  "status": "success",
  "action": "delete_member",
  "queue_id": "queue-1",
  "affected_users": ["user-1"],
  "message": "Benutzer user-1 aus Queue queue-1 gelöscht",
  "details": {}
}
PATCH /q-manager/queues/{queue_id}/members/{member_id}
Kurzbeschreibung: Aktualisiert die ring_number eines Queue-Mitglieds.
Request:

{
  "ring_number": 3
}
Response:

{
  "status": "success",
  "action": "update_ring_number",
  "queue_id": "queue-1",
  "affected_users": ["user-1"],
  "message": "Ring Number für user-1 auf 3 aktualisiert",
  "details": {}
}
GET /q-manager/users/{user_id}/queues
Kurzbeschreibung: Liefert alle Queues, in denen ein User Mitglied ist.
Path params:

{
  "user_id": "string"
}
Response:

{
  "user_id": "user-1",
  "total_queues": 2,
  "queues": [
    {
      "queue_id": "queue-1",
      "queue_name": "Support"
    },
    {
      "queue_id": "queue-2",
      "queue_name": "Sales"
    }
  ]
}
PATCH /q-manager/users/{user_id}/queues
Kurzbeschreibung: Setzt die Queue-Zuordnungen eines Users gesammelt.
Request:

{
  "queue_ids": ["queue-1", "queue-2"]
}
Response:

{
  "status": "success",
  "action": "update_user_queues",
  "queue_id": null,
  "affected_users": ["user-1"],
  "message": "Queue-Mitgliedschaften für Benutzer user-1 aktualisiert",
  "details": {}
}
PATCH /q-manager/users/{user_id}/queues/{queue_id}
Kurzbeschreibung: User gezielt einer Queue beitreten lassen oder aus ihr entfernen.
Request:

{
  "joined": true
}
oder

{
  "joined": false
}
Response:

{
  "status": "success",
  "action": "join_queue",
  "queue_id": "queue-1",
  "affected_users": ["user-1"],
  "message": "Benutzer user-1 ist der Queue queue-1 beigetreten",
  "details": {}
}
Gemeinsame Response-Form für Mutationen
Die schreibenden Endpunkte liefern immer dieses Grundschema:

{
  "status": "success",
  "action": "string",
  "queue_id": "string | null",
  "affected_users": ["string"],
  "message": "string",
  "details": {}
}
Wichtige Frontend-Hinweise

queue_id und user_id kommen primär aus der URL, nicht aus dem Body.
Für Add/Remove von mehreren Mitgliedern ist member_ids das relevante Feld.
Für Bulk-Updates ist nur operations relevant.
Für Join/Leave eines Users in einer einzelnen Queue ist nur joined relevant.
Fehler kommen aktuell als 500 oder bei Validierungsfehlern als 400 mit detail.