# Anfrage an die SD-API: Felder für die Kalender-Zusammenfassung

Stand 14.10.2026, **Entwurf, nicht versendet** (wird erst nach der Design-Abnahme zusammen mit den übrigen Wünschen geschickt, siehe [dashboard-redesign.md](dashboard-redesign.md)). Betrifft `GET /sofa/events` (`event_router.get_events`, `EventListItem`). Hintergrund: [dashboard-redesign.md](dashboard-redesign.md).

## Problem

Das Dashboard fasst Events je Art zusammen („Vertrieb-Schulung für 5 Mitarbeiter“, „1 Abteilungswechsel“). `event_service.list_events` kennt `role_name`, `first_name`, `last_name` und `process_type`, verwirft sie aber nach `_build_event_copy`. SOFA müsste den Skill aus dem Beschreibungstext lesen und den Abteilungswechsel am Titelpräfix erkennen. Beides bricht bei der nächsten Textänderung.

## Wunsch (nur additiv, ohne neue ENUM-Werte)

Zusätzliche Felder in `EventListItem`:

| Feld | Typ | Inhalt |
|---|---|---|
| `role_name` | `string \| null` | Rollenname des Events (Skill bei Schulungen) |
| `process_type` | `string \| null` | Prozesstyp (`CHANGE`, `ONBOARDING`, …) |
| `user_name` | `string \| null` | „Vorname Nachname“ für die Detailliste |

Bestehende Felder und Texte bleiben unverändert, damit ein Rollback der SD-API SOFA nicht bricht. Optional: ein eigener Titel für `RETRAIN` („Nachschulung“) statt „Event“.

## Nutzung in SOFA

`_normalize_event_record` übernimmt die drei Felder (leer, wenn nicht vorhanden). Das Frontend nutzt sie, sonst fällt es auf Beschreibungstext und `role_id` zurück.
