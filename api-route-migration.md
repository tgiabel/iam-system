# API Route Migration

Diese Datei ist die kanonische Übersicht für den Architektur-Refactor auf `experiment/architecture`.

- `Status: alias-temporary` bedeutet: alter Pfad ist noch als Übergangsalias verfügbar.
- Neue kanonische Präfixe sind `/access`, `/sofa`, `/ticketing` und `/messaging`.
- Die historische Datei `docs/sofa-routes` bleibt als Alt-Referenz bestehen, wird aber nicht mehr fortgeführt.

## Access

| Methode | Alt | Neu | Status |
| --- | --- | --- | --- |
| `GET` | `/dev/users/` | `/access/users/` | `alias-temporary` |
| `GET` | `/dev/users/{user_id}/details` | `/access/users/{user_id}/details` | `alias-temporary` |
| `POST` | `/dev/users/login` | `/access/users/login` | `alias-temporary` |
| `GET` | `/dev/users/me` | `/access/users/me` | `alias-temporary` |
| `GET` | `/dev/resources/` | `/access/resources/` | `alias-temporary` |
| `POST` | `/dev/resources/` | `/access/resources/` | `alias-temporary` |
| `POST` | `/dev/resources/mail_template` | `/access/resources/mail_template` | `alias-temporary` |
| `POST` | `/dev/resources/{resource_id}` | `/access/resources/{resource_id}` | `alias-temporary` |
| `GET` | `/dev/resources/{resource_id}` | `/access/resources/{resource_id}` | `alias-temporary` |
| `POST` | `/dev/resources/{resource_id}/assign` | `/access/resources/{resource_id}/assign` | `alias-temporary` |
| `GET` | `/dev/roles/` | `/access/roles/` | `alias-temporary` |
| `GET` | `/dev/roles/map` | `/access/roles/map` | `alias-temporary` |
| `GET` | `/dev/roles/{role_id}` | `/access/roles/{role_id}` | `alias-temporary` |
| `POST` | `/dev/roles/` | `/access/roles/` | `alias-temporary` |
| `POST` | `/dev/roles/{role_id}` | `/access/roles/{role_id}` | `alias-temporary` |
| `POST` | `/dev/roles/{role_id}/resources/add` | `/access/roles/{role_id}/resources/add` | `alias-temporary` |
| `POST` | `/dev/roles/{role_id}/resources/remove` | `/access/roles/{role_id}/resources/remove` | `alias-temporary` |
| `POST` | `/dev/roles/{role_id}/resources/reevaluate` | `/access/roles/{role_id}/resources/reevaluate` | `alias-temporary` |
| `GET` | `/dev/systems/` | `/access/systems/` | `alias-temporary` |
| `GET` | `/dev/systems/map` | `/access/systems/map` | `alias-temporary` |
| `GET` | `/dev/systems/{system_id}` | `/access/systems/{system_id}` | `alias-temporary` |
| `GET` | `/dev/systems/{system_id}/resources` | `/access/systems/{system_id}/resources` | `alias-temporary` |
| `POST` | `/dev/systems/` | `/access/systems/` | `alias-temporary` |
| `POST` | `/dev/systems/{system_id}` | `/access/systems/{system_id}` | `alias-temporary` |
| `GET` | `/dev/logs/assignments` | `/access/logs/assignments` | `alias-temporary` |

## SOFA

| Methode | Alt | Neu | Status |
| --- | --- | --- | --- |
| `POST` | `/dev/processes/iks` | `/sofa/processes/iks` | `alias-temporary` |
| `POST` | `/dev/processes/onboarding` | `/sofa/processes/onboarding` | `alias-temporary` |
| `POST` | `/dev/processes/onboarding/lookup` | `/sofa/processes/onboarding/lookup` | `alias-temporary` |
| `POST` | `/dev/processes/onboarding-ext` | `/sofa/processes/onboarding-ext` | `alias-temporary` |
| `POST` | `/dev/processes/offboarding` | `/sofa/processes/offboarding` | `alias-temporary` |
| `POST` | `/dev/processes/skill_assignment` | `/sofa/processes/skill_assignment` | `alias-temporary` |
| `POST` | `/dev/processes/training_schedule` | `/sofa/processes/training_schedule` | `alias-temporary` |
| `POST` | `/dev/processes/skill_removal` | `/sofa/processes/skill_removal` | `alias-temporary` |
| `POST` | `/dev/processes/change` | `/sofa/processes/change` | `alias-temporary` |
| `POST` | `/dev/processes/tmp_role` | `/sofa/processes/tmp_role` | `alias-temporary` |
| `GET` | `/dev/processes/overview` | `/sofa/processes/overview` | `alias-temporary` |
| `GET` | `/dev/tasks/{task_id}/logs` | `/sofa/tasks/{task_id}/logs` | `alias-temporary` |
| `GET` | `/dev/tasks/view` | `/sofa/tasks/view` | `alias-temporary` |
| `GET` | `/dev/tasks/overview` | `/sofa/tasks/overview` | `alias-temporary` |
| `PATCH` | `/dev/tasks/{task_id}/assign` | `/sofa/tasks/{task_id}/assign` | `alias-temporary` |
| `DELETE` | `/dev/tasks/{task_id}/assign` | `/sofa/tasks/{task_id}/assign` | `alias-temporary` |
| `POST` | `/dev/tasks/{task_id}/dispatch_bot` | `/sofa/tasks/{task_id}/dispatch_bot` | `alias-temporary` |
| `POST` | `/dev/tasks/{task_id}/send_mail` | `/sofa/tasks/{task_id}/send_mail` | `alias-temporary` |
| `POST` | `/dev/tasks/{task_id}/complete` | `/sofa/tasks/{task_id}/complete` | `alias-temporary` |
| `POST` | `/dev/tasks/{task_id}/callback` | `/sofa/tasks/{task_id}/callback` | `alias-temporary` |
| `GET` | `/dev/task_backlogs/` | `/sofa/task_backlogs/` | `alias-temporary` |
| `GET` | `/dev/events` | `/sofa/events` | `alias-temporary` |
| `POST` | `/dev/users/{user_id}/sofa-access/setup` | `/sofa/users/{user_id}/sofa-access/setup` | `alias-temporary` |
| `POST` | `/dev/users/{user_id}/sofa-access/reset-password` | `/sofa/users/{user_id}/sofa-access/reset-password` | `alias-temporary` |
| `POST` | `/dev/users/{user_id}/sofa-access/change-password` | `/sofa/users/{user_id}/sofa-access/change-password` | `alias-temporary` |
| `POST` | `/dev/users/{user_id}/sofa-access/revoke` | `/sofa/users/{user_id}/sofa-access/revoke` | `alias-temporary` |

## Ticketing

| Methode | Alt | Neu | Status |
| --- | --- | --- | --- |
| `POST` | `/v1/ticket/vrp` | `/ticketing/ticket/vrp` | `alias-temporary` |
| `POST` | `/v1/ticket/applepay` | `/ticketing/ticket/applepay` | `alias-temporary` |
| `POST` | `/v1/ticket/token` | `/ticketing/ticket/token` | `alias-temporary` |
| `GET` | `/v1/ticket/{ticket_type}/open` | `/ticketing/ticket/{ticket_type}/open` | `alias-temporary` |
| `POST` | `/v1/ticket/{ticket_type}/{ticket_id}/done` | `/ticketing/ticket/{ticket_type}/{ticket_id}/done` | `alias-temporary` |
| `GET` | `/v1/ticket/{ticket_type}/open/count` | `/ticketing/ticket/{ticket_type}/open/count` | `alias-temporary` |
| `DELETE` | `/v1/ticket/{ticket_type}/{ticket_id}/lock` | `/ticketing/ticket/{ticket_type}/{ticket_id}/lock` | `alias-temporary` |
| `GET` | `/v1/ticket/{ticket_type}/report` | `/ticketing/ticket/{ticket_type}/report` | `alias-temporary` |
| `GET` | `/v1/ticket/summary` | `/ticketing/ticket/summary` | `alias-temporary` |

## Messaging

| Methode | Alt | Neu | Status |
| --- | --- | --- | --- |
| `POST` | `/v1/mail/send` | `/messaging/mail/send` | `alias-temporary` |
