# Authz in `app/authz.py`

## Quelle der Rechte
- Beim Login holt die BFF `GET /sofa/me` (Header `X-User-Id`) und legt die Antwort als `sofa_permissions` in der Session ab.
- `build_authorization_context_from_user` sammelt daraus die `identifier` aus `accessible_pages`, `accessible_functions`,
  `accessible_tools` und `accessible_reports` sowie die Backlog-Freigaben (`accessible_backlogs`, `has_all_backlog_access`).
- `/sofa/me` liefert nur Ressourcen, die der Person tatsaechlich zugewiesen sind.
- Fehlt die Antwort, entstehen Minimalrechte (leere Menge).

## Pruefung
- BFF-Routen pruefen mit `require_permission(...)`, `require_any_permission(...)` bzw. `require_admin_access(...)`.
- `AuthorizationContext.has_permission` beachtet Wildcards: `SOFA-FN-ALL` deckt jedes `SOFA-FN-*` ab.
- Templates pruefen ueber `authz.permissions` (`PermissionSet`), das Frontend ueber `hasPerm` in `base.js`.
  Beide beachten dieselbe Wildcard-Regel.

## Neue Rechte
- Ein Recht existiert erst, wenn es als Zeile in `SOFA.resources` angelegt und einer Rolle zugewiesen ist.
- `app/config/sofa_permissions.json` enthaelt nur Metadaten fuer den Picker und vergibt keine Rechte.
