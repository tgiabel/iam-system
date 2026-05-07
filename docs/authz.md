# Authz in `app/authz.py`

## Uebersicht
- Die Authz-Logik wird in `build_authorization_context_from_user()` aufgebaut.
- Erhoehte Rechte werden ausschliesslich ueber `role_id` aufgeloest.
- Unbekannte oder nicht gemappte Rollen erhalten bewusst nur die Default-Policy `basic_user`.
- Mehrere aktive Rollen werden zusammengefuehrt:
  - `pages`: Vereinigungsmenge
  - `capabilities`: Vereinigungsmenge
  - `scopes`: hoechste Prioritaet gewinnt (`none` < `own_only` < `relevant_only` < `all`)
  - `task_backlogs`: `all=True` gewinnt, sonst werden explizite IDs vereinigt

## Gemappte Role-IDs
Stand der Backend-Role-Map vom 2026-05-07 via `http://sd-web-01:8089/access/roles/map`.

| Role ID | Backend-Rolle | Policy-Key |
| --- | --- | --- |
| `11` | Produktion Leitung | `operations_admin` |
| `13` | Teamleiter | `operations_admin` |
| `19` | Verwaltung & Vertrieb Leitung | `people_admin` |
| `21` | IT | `it_admin` |
| `23` | Steuerung | `operations_admin` |

## Policies
| Policy | Pages | Capabilities | Scopes | Task-Backlogs |
| --- | --- | --- | --- | --- |
| `basic_user` | keine | keine | `tasks=relevant_only`, `tools=own_only`, `reports=own_only`, `users=none` | kein Zugriff |
| `people_admin` | `users` | `onboarding.start`, `onboarding.external.start`, `training.schedule`, `primary_role.change`, `temporary_role.assign`, `skill.assign`, `skill.revoke`, `offboarding.start` | `tasks=relevant_only`, `tools=own_only`, `reports=own_only`, `users=all` | kein Zugriff |
| `operations_admin` | `console`, `users`, `iks` | wie `people_admin` | `tasks=relevant_only`, `tools=own_only`, `reports=own_only`, `users=all` | kein Zugriff |
| `it_admin` | `console`, `users`, `systems`, `roles`, `iks` | wie `people_admin` plus `sofa_access.setup`, `sofa_access.reset`, `sofa_access.revoke` | `tasks=all`, `tools=all`, `reports=all`, `users=all` | alle Backlogs |

## Wirkung im System

### Pages
| Page | Wirkung |
| --- | --- |
| `console` | erlaubt Seite `/console`, zeigt Konsole im Admin-Menue |
| `users` | erlaubt `/users` und User-APIs, zeigt Userverwaltung im Admin-Menue |
| `systems` | erlaubt `/systems`, `/systems/{id}` und System-APIs, zeigt Systemverwaltung im Admin-Menue |
| `roles` | erlaubt `/roles`, `/roles/{id}` und Rollen-APIs, zeigt Rollenmanagement im Admin-Menue |
| `iks` | erlaubt `/iks`, `/tools/iks` und IKS-APIs, zeigt Kontrollsystem im Admin-Menue |

### Capabilities
| Capability | Wirkung |
| --- | --- |
| `onboarding.start` | erlaubt `/api/processes/onboarding` und `/api/processes/onboarding/lookup` |
| `onboarding.external.start` | erlaubt `/api/processes/onboarding-ext` |
| `training.schedule` | erlaubt `/api/processes/training` und blendet "Schulung planen" ein |
| `primary_role.change` | erlaubt `/api/processes/primary-role-change` |
| `temporary_role.assign` | erlaubt `/api/processes/temporary-role` |
| `skill.assign` | erlaubt `/api/processes/skill-assignment` |
| `skill.revoke` | erlaubt `/api/processes/skill-removal` |
| `offboarding.start` | erlaubt `/api/processes/offboarding` |
| `sofa_access.setup` | erlaubt `/api/users/{user_id}/sofa-access/setup` |
| `sofa_access.reset` | erlaubt `/api/users/{user_id}/sofa-access/reset-password` |
| `sofa_access.revoke` | erlaubt `/api/users/{user_id}/sofa-access/revoke` |

### Scopes
| Scope | Aktuelle Laufzeitwirkung |
| --- | --- |
| `tasks` | `relevant_only` filtert Tasks/Prozesse auf zugewiesen, Zielperson oder Initiator; andere Werte lassen alles durch |
| `users` | `none` fuehrt in `/api/users` zu einer leeren Liste; `all` liefert die Benutzerliste |
| `tools` | aktuell nur im Payload vorhanden, noch ohne Laufzeitlogik |
| `reports` | aktuell nur im Payload vorhanden, noch ohne Laufzeitlogik |

### Task-Backlogs
- Der Backlog-Filter laeuft vor dem `tasks`-Scope.
- Wenn `can_view_all_task_backlogs=True` ist, sind alle Task-Backlogs sichtbar.
- Ohne `all=True` und ohne explizite Backlog-ID-Freigabe sind Tasks aus dem Backlog nicht sichtbar.
- Aktuell hat nur `it_admin` Backlog-Zugriff; die anderen Policies sehen dadurch keine Tasks, auch wenn der `tasks`-Scope sonst passen wuerde.

## Payload fuer Templates und Frontend
`get_authz_payload_for_template()` liefert weiterhin unveraendert:

- `pages`
- `capabilities`
- `scopes`
- `primary_role_name`
- `primary_role_id`
- `role_key`
- `effective_role_ids`
- `effective_role_names`
- `effective_policy_keys`
- `visible_task_backlog_ids`
- `can_view_all_task_backlogs`
- `has_admin_access`
