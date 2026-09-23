# Anfrage an Backend-Team: Task-Felder für die Gruppierung auf der Aufgabenseite

## Hintergrund

Die Aufgabenseite kann ihre Karten jetzt gruppieren – nach Person, Prozess,
System oder Backlog. Die Gruppen entstehen komplett im Frontend aus dem, was
`GET /sofa/tasks/overview` je Task liefert; ein neuer Endpunkt wird dafür nicht
gebraucht. Zwei Punkte im bestehenden Payload würden das Ergebnis aber spürbar
verbessern.

Der Gruppenschlüssel wird pro Dimension so gebildet
(`app/static/js/task_view_model.js`, `GROUP_DIMENSIONS`):

| Dimension | bevorzugt | Fallback | letzter Ausweg |
|---|---|---|---|
| Person | `target_user_id` | `target_user_name` | Block "Ohne Person" |
| Prozess | `process_id` | `process_name` | Block "Ohne Prozess" |
| System | `system_id` | `system_name` | Block "Ohne System" |
| Backlog | `backlog_identifier` | – | Block "Kein Backlog" |

Der Name-Fallback ist bewusst nur die zweite Wahl: gleichnamige Einträge mit
unterschiedlicher ID würden zu einer Gruppe verschmelzen, und ein umbenannter
Eintrag würde die Gruppe spalten.

## 1. `process_id` ist bei einem Teil der Tasks `null`

Im Overview-Payload ist `process_id` nicht durchgängig gesetzt. Uns ist nicht
klar, ob das gewollt ist:

- Sind das Tasks, die fachlich zu keinem Prozess gehören? Nach unserem Eindruck
  betrifft es vor allem nachgelagerte Tasks
  (`provisioning_requirement: "DEFERRED"`) – falls das die Erklärung ist, wäre
  die Sache geklärt.
- Oder ist es ein Restbestand aus einer früheren Contract-Version, bei der die
  Prozesszuordnung noch nicht mitgeliefert wurde?

**Was wir brauchen:** eine Einordnung, welcher Fall zutrifft. Falls es echte
prozesslose Tasks gibt, ist alles gut – die landen im Block "Ohne Prozess" und
die Gruppierung funktioniert. Falls es ein Datenfehler ist, wären die
betroffenen Tasks für die Prozess-Gruppierung dauerhaft unsichtbar zugeordnet.

Die Gruppierung ist dadurch **nicht blockiert** – sie geht in beiden Fällen,
nur die Aussagekraft hängt an der Antwort.

## 2. `process_name` / `process_type` auf den Overview-Items

Das Gruppenlabel ist `"<Prozess> · <Person>"`, die Person kommt aus
`target_user_name` (pro Prozess eindeutig). Fehlt der Prozessname, baut das
Frontend den ersten Teil aus `process_type` plus ID
(`"Onboarding · #700 · Musterfrau, Maria"`) und fällt ohne beides auf
`"Prozess #700"` zurück. Das ist lesbar, aber deutlich schwächer als der echte
Prozessname, der auf der Karte ohnehin als Kicker steht.

**Bitte:** `process_name` (oder mindestens `process_type`) auf den Items von
`GET /sofa/tasks/overview` mitliefern, so wie es die Prozessliste bereits tut.

## 3. Bestätigung zu `system_id`

Wir nutzen `system_id` künftig als Gruppenschlüssel statt `system_name`. Bitte
kurz bestätigen, dass das Feld auf allen Overview-Items gesetzt ist. Falls es
Tasks ohne Systembezug gibt, ist das kein Problem (Fallback greift) – wir
wüssten es nur gern.

## Stand auf unserer Seite

Vollständig umgesetzt und ausgeliefert, ohne Abhängigkeit von dieser Anfrage:

- `app/static/js/task_view_model.js`: Gruppenschlüssel, Labels und die
  Fallback-Kette wie oben beschrieben.
- `app/static/js/tasks.js`: Stapel-Darstellung in den Streifen und das
  Gruppen-Modal mit Tabs "Offen" / "In Bearbeitung".
- `tests/task_view_model_checks.js`: deckt den `__UNGROUPED__`-Fallback für
  fehlende IDs explizit ab.

Sobald 1.–3. geklärt sind, können wir den Name-Fallback für Prozess und System
entfernen und rein über IDs gruppieren.
