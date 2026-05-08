# Authz in `app/authz.py`

## Uebersicht
- Die lokale AuthZ-Schicht liest keine festen `role_id`-Policies mehr.
- Kanonische Quelle ist `user.sofa_authorization` aus dem Backend.
- Erwartetes Payload:

```json
{
  "user_id": 42,
  "primary_role": { "role_id": 21, "name": "IT" },
  "secondary_roles": [],
  "sofa_authorization": {
    "version": 1,
    "grants": [
      { "permission": "tasks.view" },
      {
        "permission": "tasks.backlog.view",
        "resources": {
          "task_backlogs": { "all": false, "ids": [1, 2, 3] }
        }
      }
    ]
  }
}
```

## Permission-Registry
- Die technische Registry liegt in [app/config/sofa_permissions.json](/var/www/sofa/app/config/sofa_permissions.json).
- Fachliche Profil-Vorlagen liegen in [app/config/sofa_profiles.json](/var/www/sofa/app/config/sofa_profiles.json).
- `docs/SOFA-POLICIES.MD` bleibt die fachliche Quelle; die JSON-Registry ist die technische Ableitung fuer Implementierung und UI.

## Grant-Modell
- Es gibt nur `allow`-Grants, keine expliziten Denies.
- Ein Grant hat immer einen `permission`-Key und optional `resources`.
- Mehrere Grants werden per Union zusammengefuehrt.
- `all=true` schlaegt eine ID-Liste fuer denselben Ressourcentyp.
- Ohne passenden Resource-Scope gibt es keinen Zugriff auf diese Ressource.

## Lokale Projektion auf bestehende Templates
- `AuthorizationContext` projiziert Grants weiterhin auf:
  - `pages`
  - `capabilities`
  - `scopes`
  - `visible_task_backlog_ids`
  - `can_view_all_task_backlogs`
- Diese Projektion ist nur fuer Legacy-Template- und Route-Checks da.
- Neue fachliche Entscheidungen sollen ueber Permission-Keys und Resource-Scopes getroffen werden, nicht ueber `role_id`.

## Aktuelle Laufzeitregeln
- Seitenzugriffe wie `/roles` oder `/users` laufen ueber Page-Keys, die aus den Grants projiziert werden.
- Prozessaktionen wie Onboarding oder Passwort-Reset laufen ueber projizierte `capabilities`.
- Task-Sichtbarkeit wird aus `tasks.backlog.view` abgeleitet:
  - `all=true` bei `task_backlogs` erlaubt alle Backlogs
  - sonst duerfen nur die explizit freigegebenen `backlog_id`s gesehen werden
- Fehlt `sofa_authorization` oder ist `grants` leer, entstehen Minimalrechte.

## Profil-Mapping spaeter pflegen
- Rollen-zu-Profil-Mapping wird nicht mehr in `authz.py` verdrahtet.
- Die spaetere Zuordnung wird in [app/config/sofa_profiles.json](/var/www/sofa/app/config/sofa_profiles.json) gepflegt:
  - `mapped_role_ids`
  - oder `mapped_role_names`
- Danach die Mapping-Faelle in `tests/test_authz.py` ergaenzen.
