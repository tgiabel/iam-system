# Geplante Rollenprozesse und Task-Mail

## Browser- und BFF-Vertraege

SOFA startet `CHANGE` und `SKILL_REMOVAL` ausschliesslich geplant. Der Browser sendet
jeweils genau `user_id`, `role_id` und `effective_date`. `effective_date` ist ein
Pflichtfeld im Format `YYYY-MM-DD`; heute und Zukunft sind erlaubt. Die BFF verwirft
zusaetzliche Felder, baut die Payload neu auf und ergaenzt `initiator_user_id` aus der
serverseitigen Session. Insbesondere sendet SOFA fuer den Rollenentzug kein `start_date`.

Der Prozessabbruch verlangt einen getrimmten Grund mit 1 bis 500 Zeichen. Der Browser
sendet genau `reason`; die BFF ergaenzt wiederum nur die Session-Identitaet. Dadurch
koennen Browserwerte weder den Initiator noch andere Upstream-Felder bestimmen.

Erfolgreiche Antworten mit `status=planned` und die Legacy-Antwort
`status=started` sind gleichwertig. Weitere Responsefelder sind additiv.

## Task-Stichtage

`target_date` ist in den oeffentlichen Tasklisten optional. Ist das Feld vorhanden,
zeigt SOFA es als `Stichtag` auf der Kachel und im Dialog. Legacy- oder prozesslose
Tasks ohne Termin bleiben unveraendert.

Datumsvergleiche verwenden lokale Kalendertage. Nur ein `REVOCATION`-Task mit einem
Stichtag nach dem heutigen lokalen Tag verlangt vor dem Abschluss eine ausdrueckliche
Warnung. Der Sammelabschluss nennt jeden vorhandenen Stichtag und kennzeichnet
zukuenftige Aufgaben; er bleibt nach ausdruecklicher Bestaetigung moeglich.

## Task-Mail

Der Browser sendet weder eine User-ID noch `X-User-Id`. Die BFF laesst nur
`recipient`, `cc`, `bcc`, `subject` und `body` durch, ergaenzt
`initiator_user_id` aus der Session und setzt dieselbe ID ueber den API-Client als
`X-User-Id`. Der Mailbutton ist nur beim eigenen `IN_PROGRESS`-Task mit
`handling_type=EXTERNAL` sichtbar.

Nur eine erfolgreiche API-Antwort schliesst den Dialog. Fehler erhalten die Eingaben.
Bei deaktiviertem Task-Mail-Schalter lautet die Meldung exakt:

> Der Mailversand ist derzeit deaktiviert. Es wurde keine Mail beauftragt.

## Rollout

SOFA wird vor der SD-API ausgerollt. Bis die SD-API mit den geplanten Prozessen aktiv
ist, bleiben `CHANGE`, `SKILL_REMOVAL` und Task-Mail organisatorisch gesperrt. Nach dem
API-Deploy koennen die beiden Prozessarten freigegeben werden. Task-Mail bleibt bis
zur gesonderten Freigabe von `TASK_MAILS_ENABLED=true` deaktiviert; `503` ist bis dahin
der erwartete Zustand.
