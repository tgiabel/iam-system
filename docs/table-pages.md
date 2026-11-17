# Tabellenseiten der Verwaltung (Userverwaltung, Rollenmanagement, Systemverwaltung)

Stand 17.11.2026. Branch `feature/table-pages` im Live-Checkout.
- Alle drei Seiten sind umgesetzt: Rollenmanagement und Systemverwaltung in Session 1, die Userverwaltung in
  Session 2. `/users`, `/roles` und `/systems` laden echte Daten über `/api/views/*`, mit
  `?mock=normal|busy|quiet` (nur Dev) die Mock-Daten.
- Die alten Seiten (`userverwaltung.*`, `rollenmanagement.*`, `systemverwaltung.*`) sind gelöscht.

Dieses Dokument beschreibt die drei abgenommenen Mocks und den Plan (Abschnitt „Umsetzung“) mit dem Stand der
Umsetzung.

## Dateien

| Datei | Inhalt |
|---|---|
| `app/admin_lists_mock.py` | Mock-Daten in der Form der SD-API-Listen (Stand 7bc2533), Mengen wie Prod (16.11.2026) |
| `app/admin_views.py` | Datenquellen `GET /api/views/users`, `/api/views/roles` und `/api/views/systems` |
| `app/routes/pages.py` | `/users`, `/roles`, `/systems` rendern die neuen Seiten und reichen `mock` weiter |
| `app/templates/admin/{users,roles,systems}.html` | Neue Seiten |
| `app/templates/admin/user_actions.html` | User-Panel und Prozessdialoge (Include der Userverwaltung) |
| `app/static/js/user_actions.js`, `app/static/css/user_actions.css` | Panel und Dialoge, `window.SofaUserActions` |
| `app/static/js/list_page.js` | `window.SofaList`: Suche, Sortiermenü, Popover, Zeilenmenü, Tooltips, Filter mit drei Zuständen |
| `app/static/js/admin_{users,roles,systems}.js` | Seitenlogik |
| `app/static/css/ui.css` | Abschnitt „Listenseiten“ (gemeinsame Bausteine) und Sortierköpfe |
| `app/static/css/admin_lists.css` | Seitenspezifisches der drei Seiten |
| `tests/test_admin_lists_mock.py` | Mengen, Vererbung, `resource_items`, Inaktiv-Eintrag |
| `tests/test_admin_views.py` | Form der Datenquellen, Rechte, Mock nur in Entwicklung, Aufgabenzahlen je Betrachter |
| `tests/test_admin_pages.py`, `tests/list_page_checks.js` | Seiten, Deep-Links, Vorfilter; Node-Checks für `list_page.js` |
| `tests/user_actions_checks.js` | Node-Checks der Schnittstelle von `user_actions.js` (Rechte, Regel, Details vor Dialog, `afterChange`) |

## Userverwaltung

Stand 17.11.2026, vom Nutzer abgenommen („passt fürs Erste“).

### Aufbau

- **Werkzeugleiste:** Titel, Suche (Name, Kennung, Rolle), „Filter“ mit Popover,
  Schalter „Inaktive“ (aktiv rot, `.ui-tool-btn--danger`), Anzahl („97 User“ bzw. „x von 97“), „Schulung planen“
  (`SOFA-FN-TRNG`) und „Onboarding“ (`SOFA-FN-ONB`).
- **Schnellfilter je laufendem Prozess:**
  - Es gibt einen Schnellfilter je Prozesstyp, sofern dazu mindestens ein User gehört: Onboarding, Offboarding,
    Wechsel, Neue Rolle, Rollenentzug, Schulung, Temp. Rolle.
  - Dahinter steht „Überfällig“ (rot).
  - Nur einer ist zur Zeit aktiv.
  - Gesetzte Filter stehen als Marken nach einem Trenner in derselben Zeile und lassen sich dort entfernen.
  - Rechts in der Zeile steht dezent die aktive Sortierung (`.ui-list-meta`, `.ui-sort-label`).
- **Filter-Popover:**
  - Facetten Funktion, Nebenrolle, Skill und Prozess nebeneinander.
  - Jeder Wert hat drei Zustände: aus → nur diese (✓) → ohne diese (✕).
- **Tabelle** (`ui-table-card ui-list-card`, `ui-table-compact`), einzeilig:

| Spalte | Inhalt |
|---|---|
| Kennung | PNR, RACF und XDE übereinander. Oben und fett steht die Kennung, nach der sortiert wird (sonst die PNR); die anderen stehen darunter, klein und grau. Fehlende entfallen; fehlt genau die oberste, steht dort „–“. Normale Schrift mit gleich breiten Ziffern, weil Mono keinen fetten Schnitt hat (`.al-ids`). |
| Name | Nachname fett, Vorname |
| Funktion | Hauptrolle |
| Rollen | erste Nebenrolle ausgeschrieben (Nebenrollen vor Skills, je alphabetisch), Rest als „+N“; Tooltip mit zwei Spalten Nebenrollen und Skills. Ist die Tabelle schmaler als 1250 px, steht nur die Zahl da (Container-Query). |
| Eintritt, Austritt | Datum; ein künftiger Austritt bei aktiven Usern orange |
| Status | Marke mit Kurzlabel und Datum, z. B. „Offboarding · 29.11.“: überfällig rot, Offboarding orange, sonst blau. Weitere als „+N“, Tooltip mit Prozess, Rolle, Datum und „überfällig“. Inaktive: Marke „Inaktiv“. Leer, wenn nichts läuft. |
| ⋯ | Zeilenmenü |

- **Hinweis auf Hover:** Unterstrichen (`.ui-hint`, gepunktet) heißt, beim Hover gibt es mehr.
- **Sortierung:** Menü am Spaltenkopf (`SofaList.bindSortMenu`), die aktive Option hat einen Haken.
  - Kennung: PNR, RACF, XDE, je auf- und absteigend.
  - Name: Nachname und Vorname, je A–Z und Z–A.
  - Funktion: A–Z und Z–A.
  - Rollen: meiste oder wenigste zuerst.
  - Eintritt: neueste oder älteste zuerst.
  - Austritt: nächster oder spätester zuerst.
  - Status: „Dringende zuerst“ und „Nächster Termin zuerst“.
- **Schmale Breiten:** Unter 900 px bleibt die Tabelle sichtbar und scrollt seitlich.

### Zeilenmenü ⋯

| User | Einträge |
|---|---|
| aktiv | Details öffnen · Funktion wechseln · Neue Rolle · Schulung planen · Rolle entziehen · Offboarding (rot) |
| inaktiv | Details öffnen · Wiedereintritt |

- Zeilenklick öffnet das User-Panel.
- Temp. Rolle steht nicht im Menü, weil der Prozess in Prod nie genutzt wurde. Sie bleibt im Panel.
- Im Mock zeigen alle Aktionen nur eine Meldung „(Mock)“.

### Vorfilter

`/users?role=<id>`, z. B. aus dem Rollenmanagement: Die Rolle wird je nach Typ als Filter Funktion, Nebenrolle
oder Skill gesetzt und erscheint als normale Marke.

### Offen aus den Mock-Runden (so belassen)

- Schnellfilter nach Prozess statt nach Eintritten und Austritten der letzten 30 Tage.
- Temp. Rolle nur im Panel.
- „Erbt von“ im Dialog „Neue Rolle“ nur mit Templates zur Auswahl.

## Rollenmanagement

### Aufbau

- **Werkzeugleiste** wie in der Userverwaltung: Titel, Suche (Rolle, Ressource, User), Schalter „Inaktive“,
  Anzahl, „Neue Rolle“. Darunter die Schnellfilter „ohne User“ und „ohne Ressourcen“. Kein
  Sortierlabel, denn sortiert wird nur die rechte Tabelle über ihre Spaltenköpfe.
- **Zwei Panels nebeneinander** (unter 900 px untereinander). Sie passen sich ihrem Inhalt an und scrollen
  erst, wenn der Platz nicht reicht. Baum und Tabelle teilen die Spaltenbreiten.
- **Links: Funktionen als Vererbungsbaum** (Templates + Hauptrollen).
  - Hauptrollen fett, Templates normal mit blauer Outline-Marke „Template“.
  - Templates lassen sich auf- und zuklappen (eingeklappt mit „+N“ dahinter).
  - Führungslinien je Ebene; Hover färbt den Namen in Primärfarbe.
  - Hauptrollen ohne Elternrolle und ohne Kinder (Prod: „Externer Dienstleister“) stehen abgesetzt unter
    „Ohne Vererbung“.
  - Spalten: Systeme, Ressourcen, User, ⋯. Templates zeigen gedämpft die User aller Funktionen darunter.
- **Rechts: Neben- und Skillrollen als Tabelle.**
  - Umschalter „Alle | Nebenrollen | Skills“ mit Anzahl, Standard „Alle“.
  - Spalten: Name (fett), Typ (nur bei „Alle“), Systeme, Ressourcen, User, ⋯. Feste Spaltenbreiten,
    der Name nimmt den Rest und wird bei Bedarf gekürzt.
  - Sortierung über das Menü am Spaltenkopf (`SofaList.bindSortMenu`): Name, Typ, Ressourcen, User.
- **Systeme** als Kürzel-Marken, die mit den meisten Ressourcen zuerst, höchstens drei plus „+N“.
  Ausgeblendet, wenn das Panel schmal ist (Baum unter 640 px, Tabelle unter 680 px); Typ unter 460 px.

### Tooltips (`SofaList.bindTips`, gemeinsamer `.ui-tip`)

- **Ressourcen** (an Zahl und Systemen): nach System gruppiert. Hat die Rolle eine Elternrolle, getrennt in
  „Eigene · n“ und „Geerbt von <Elternrolle> · m“.
- **User**: Hauptrollen zeigen bis zu 12 Namen plus „+N weitere“. Templates, Neben- und Skillrollen zeigen die
  Verteilung nach Funktion („16 Agent“, „3 Externer Dienstleister“ …). Neu dafür: `.ui-tip-num` in ui.css.
- Die Zahlen sind `.ui-hint`, die gepunktete Unterstreichung erscheint aber erst beim Hover der Zeile.

### Suche

- Trifft Name, ID, Ressourcen und User.
- Im Baum zählen nur die **eigenen** Ressourcen einer Funktion. Sonst trifft jede Funktion, die etwas nur
  erbt. Vorfahren von Treffern bleiben abgeschwächt als Kontext sichtbar.
- Trifft eine Rolle nicht über den Namen, zeigt eine Marke hinter dem Namen den Grund, z. B. „SAP Queue 1 +2“.

### Zeilenmenü ⋯

| Rolle | Einträge |
|---|---|
| Template | Details öffnen · Hauptrolle darunter anlegen · Template darunter anlegen · Deaktivieren |
| Haupt-, Neben-, Skillrolle | Details öffnen · User anzeigen · Deaktivieren |
| inaktiv | statt „Deaktivieren“: Aktivieren |

- Zeilenklick und Enter öffnen die Detailseite (im Mock nur eine Meldung).
- „Hauptrolle/Template darunter anlegen“ öffnet den Dialog mit Typ und „Erbt von“ vorausgefüllt.
- **„User anzeigen“** springt nach `/users?role=<id>`. Die Userverwaltung setzt die Rolle dann je nach Typ
  als Filter (Funktion, Nebenrolle oder Skill); er erscheint als normaler Filter-Chip.

### Dialog „Neue Rolle“

Name, Typ, Beschreibung; „Erbt von“ nur bei Haupt- und Template-Rollen, zur Auswahl nur aktive Templates.
Das entspricht der gelebten Praxis in Prod (offene Entscheidung aus Runde 1, so belassen).

### Datenquellen für die Umsetzung

| Anzeige | Quelle heute | Bedarf |
|---|---|---|
| Rollen, Typ, Status, Elternrolle | `GET /access/roles/` | `parent_role_id` fehlt in der Liste (nur `parent_role_name`); Auflösung über den Namen geht, die ID wäre sauberer |
| Ressourcen je Rolle | `GET /access/roles/` liefert die **wirksamen** Ressourcen (geerbte eingerechnet) als Namen | Eigene/geerbt leitet SOFA ab: geerbt ist, was die Elternrolle hat |
| System je Ressource (Kürzel, Tooltip-Gruppen) | in der Rollenliste nicht enthalten | **SD-API: System je Ressource in der Rollenliste** (bevorzugt). Notlösung: Systemliste mitladen und über den Namen zuordnen (Namen sind nicht systemübergreifend eindeutig) |
| User je Rolle | `assigned_to` (Namen) | – |
| Verteilung nach Funktion im User-Tooltip | nicht in der Rollenliste | Userliste mitladen (`/access/users`) und über den Namen zuordnen, oder die SD-API liefert die Funktion je Inhaber |

Der Mock bildet das schon so ab: `resources` ist die wirksame Menge, Systeme und Funktionen kommen aus den
mitgelieferten System- und Userlisten.

### Gemeinsame Änderungen über das Rollenmanagement hinaus

- **Sortierköpfe app-weit** (`ui.css`, `.ui-table-sort-button`): kein Rahmen mehr beim Hover, nur noch bei
  Tastaturfokus. Unsortierte Spalten zeigen beim Hover „▾“, wenn der Kopf ein Sortiermenü öffnet
  (`aria-haspopup="menu"`), sonst „↕“. Betrifft auch Rechnerverwaltung und Presence-Report.
- **Userverwaltung** nimmt `?role=<id>` als Vorfilter an.
- **Klassenkollision behoben:** Die Rollenseite hieß `al-roles`, das ist zugleich die Rollen-Zelle der
  Userverwaltung. Seitenklasse jetzt `al-rolemgmt`, Rollennamen `.al-role-name` (nicht `.al-name`, das
  belegt die Userverwaltung).

### Bewusst nicht umgesetzt

- **„Gilt für“ (Geltungsbereich für Neben- und Skillrollen)**: zurückgestellt, wird in einer eigenen Session
  geklärt. Bewertung der SD-API: nur als eigenes Feld `scope_role_id` vertretbar (Schema ca. 1 Tag),
  niemals über `parent_role_id`, weil mindestens 7 Baumläufer die Elternrolle als Vererbung lesen und sonst
  Rechte vergeben oder Entzüge beim Abteilungswechsel verhindern. Offen sind u. a. Nebenrolle als Ziel
  (Voraussetzung), mehrere Geltungen (n:m), Verhalten bei Abteilungswechsel, Umhängen und Deaktivieren
  sowie „für alle“ (Externer Dienstleister hängt nicht unter „Servodata Mitarbeiter“).
- **Rollenstatus in der Liste** („nicht aktuell“ nach Paketänderung, laufende Zuweisungen): verworfen. „Nicht
  aktuell“ ist kein gespeicherter Zustand, sondern ein Dry Run von `POST /roles/{id}/resources/reevaluate` je
  Rolle; für 42 Rollen würde das den Seitenaufbau belasten.

### Für die Detailseiten vorgemerkt

- „Nicht aktuell“ (Dry Run) bleibt auf der Rollendetailseite, wie heute.
- Neu dort: **letzte Paketänderung mit Datum und Person** (Quelle `role_resource_logs`, die der IKS-Bericht
  schon liest; im Detail-Endpunkt noch nicht enthalten).

## Systemverwaltung

Stand 17.11.2026, vom Nutzer abgenommen. Kacheln wurden ausprobiert und verworfen: Bei 23 Systemen mit acht
vergleichbaren Merkmalen ist die Tabelle übersichtlicher.

### Aufbau

- **Werkzeugleiste:** Titel, Suche (System, Kürzel, Ressource, Backlog), Anzahl, „Neues System“. Es gibt keinen
  Schalter „Inaktive“, weil alle Systeme aktiv sind und die SD-API den Status nicht schreiben kann.
- **Schnellfilter:**
  - Schutzbedarf: Kritisch, Erhöht, Gering, ohne Schutzbedarf.
  - Nach einem Trenner: „mit überfälligen Aufgaben“ (rot), „ohne Ressourcen“.
  - Filter mit Anzahl 0 werden ausgeblendet.
- **Tabelle** wie in der Userverwaltung (`ui-table-card ui-list-card`, `ui-table-compact`), gruppiert nach
  **Standard-Backlog**:
  - Jedes Backlog bekommt eine Zwischenzeile mit Anzahl (`.al-group-row`). Die Backlogs stehen alphabetisch, „Ohne
    Standard-Backlog“ am Ende.
  - Der Backlog ersetzt das Merkmal „Verantwortlich“. Laut Nutzer ist er damit deckungsgleich, ein Owner-Feld
    entfällt.
  - Prod: IT 8, Produktion 13, Akademie 1, Steuerung 1.

| Spalte | Inhalt |
|---|---|
| System | Name fett, dahinter das Kürzel als Marke `.al-sys`; die Marke entfällt, wenn das Kürzel dem Namen gleicht (BFOR, GANS). Bei einer Suche zusätzlich der Treffergrund `.al-hit`. |
| Inhalt | Ressourcen nach Typ, z. B. „Konto · Queue 24 · Gruppe 3“: Konto zuerst, dann nach Anzahl; gedämpft, wird gekürzt |
| Schutzbedarf | Marke Kritisch/Erhöht/Gering (Gesamtwert), Tooltip mit Vertraulichkeit, Integrität und Verfügbarkeit. Ungepflegt: gestrichelte Marke „fehlt“, nicht grau, denn grau heißt „blockiert“. |
| Bearbeitung | „Intern“ gedämpft; abweichende Bearbeitung als Marke („Bot“, „Extern“, bei gemischten Systemen mit Anzahl, z. B. „Extern 3“), Tooltip mit der Verteilung |
| Ressourcen | Anzahl, Tooltip nach Typ mit Namen (je Typ höchstens 8, dann „+N weitere“) |
| User | User mit aktiver Zuweisung auf mindestens eine Ressource des Systems |
| Aufgaben | offene Aufgaben (OPEN, IN_PROGRESS, BLOCKED), Tooltip mit blockiert/überfällig |
| Überfällig | rot; überfällig = offen und Termin vor heute, gleiche Regel wie die Aufgabenseite |
| ⋯ | Zeilenmenü |

- **Leere Werte** zeigen „–“. Die Zahlen sind `.ui-hint`, gepunktet erst beim Hover über der Zeile.
- **Sortierung:** Menü am Spaltenkopf (`SofaList.bindSortMenu`). Es sortiert innerhalb der Gruppen und hat kein
  Sortierlabel.
  - Optionen: Name A–Z/Z–A, Kürzel A–Z, Kritisch/Gering zuerst, meiste/wenigste Ressourcen, User, Aufgaben,
    Überfällige.
  - Standard ist Name A–Z.
- **Schmale Breiten** über Container-Queries an `.ui-list-card`:
  - „Inhalt“ schrumpft mit der Kartenbreite (höchstens 22rem) und fällt unter 1120 px weg;
  - unter 960 px „Bearbeitung“;
  - unter 600 px auch Ressourcen, User und Aufgaben, und der Name darf umbrechen.
  - Grenzen in Session 1 angepasst, siehe „Abweichungen“ unter „Umsetzung“.

### Zeilenmenü ⋯ und Ziele

Zeilenklick und Enter öffnen `/systems/<id>`. Im Mock zeigen alle Einträge nur eine Meldung „(Mock)“.

| Eintrag | Ziel für die Umsetzung | Aufwand |
|---|---|---|
| Details öffnen | `/systems/<id>` | vorhanden |
| Stammdaten bearbeiten | Stammdaten-Dialog der Systemdetailseite wiederverwenden (oder Detailseite mit Parameter, der den Dialog öffnet) | klein |
| Ressource anlegen | Detailseite mit Parameter, der das Ressourcen-Panel im Anlegemodus öffnet | klein |
| Offene Aufgaben (nur wenn > 0) | `/tasks?system=<id>` als Vorfilter; die Aufgabenseite kann schon nach System gruppieren, ein URL-Parameter fehlt | klein bis mittel |
| Rollen anzeigen (nur mit Ressourcen) | `/roles?system=<id>` als Vorfilter im Rollenmanagement. Es zählen nur Rollen mit **eigener** Zuordnung einer Ressource des Systems; geerbte zählen nicht, sonst träfe jede Funktion unter einem Template | klein |
| User anzeigen (nur wenn > 0) | `/users?system=<id>`; braucht die Zuweisungen je User, dafür gibt es heute keinen Sammel-Endpunkt (siehe unten) | mittel, kann später kommen |

### Dialog „Neues System“

Felder: Name, Kürzel, Standard-Backlog (Pflicht, Auswahl aus `/api/backlogs`), Schutzbedarf für Vertraulichkeit,
Integrität und Verfügbarkeit.
- Der Schutzbedarf soll für alle Systeme gepflegt werden. Die fachliche Abstimmung dazu steht noch aus; in Prod ist
  er bisher nur bei AD gesetzt.
- `POST /access/systems/` nimmt nur `name`, `short_name` und `default_backlog_identifier` an.
- Den Schutzbedarf schreibt danach `POST /access/systems/{id}` mit `protection_need` (Objekt mit c/i/a).
- Die Bearbeitung setzt die SD-API beim Anlegen fest auf INTERNAL.

### Datenquellen für die Umsetzung

| Anzeige | Quelle heute | Bedarf |
|---|---|---|
| Name, Kürzel, Status, Backlog, Schutzbedarf | `GET /access/systems/` | – (`overall` ist das Maximum der drei Werte und nur gesetzt, wenn alle drei gepflegt sind) |
| Backlog-Namen | `/api/backlogs` (Backlog-Ressourcen des Systems SOFA) | – |
| Ressourcen je Typ (Spalte Inhalt, Tooltip) | Liste liefert nur `resource_names` | Typ je Ressource: `GET /access/resources/` hat ihn bereits |
| Bearbeitung | `default_handling_type` fehlt in der Liste, `override_handling_type` fehlt in `/access/resources/` | **SD-API:** wirksame Bearbeitung je Ressource oder die Verteilung je System liefern. In Prod hat jede Ressource einen Override: GC 29 Bot, AD 17 Extern, CGST/TMB Extern, sonst Intern |
| User mit Zugriff | kein Sammel-Endpunkt (nur `/access/users/{id}/details` je User) | **SD-API:** `user_count` per COUNT-Subquery in `fetch_system_rows` |
| Offene, blockierte, überfällige Aufgaben | `/sofa/tasks/view` filtert nur einen Status und hat kein `system_id` | **SD-API:** `open_tasks`, `blocked_tasks`, `overdue_tasks` per Subquery |

- **Empfehlung:** Die SD-API erweitert `GET /access/systems/` um `default_handling_type`, die Verteilung der
  Bearbeitung, `user_count` und die drei Aufgabenzahlen. Das ist ein Aufruf statt vieler, laut SD-API-Lese-Agent
  etwa 1–2 h.
- **Mock:** Der Mock zeigt die Zielform:
  - je System `resources` mit `display_name`, `type_name` und `handling`;
  - `user_count`, `open_tasks`, `blocked_tasks`, `overdue_tasks`;
  - `backlogs` auf oberster Ebene.
- **Mock-Daten:** Sie folgen Prod (IDs, Namen, Kürzel, Backlogs, 153 Ressourcen, Zahlen vom 17.11.2026). Nur der
  Schutzbedarf ist erfunden, TCKR bleibt absichtlich ungepflegt.

### Gemeinsame Änderungen aus der Systemverwaltung

- **`SofaList`** hat drei neue Helfer. Userverwaltung und Rollenmanagement nutzen sie schon, ihre eigenen Kopien
  sind entfernt:
  - `menuButton(id, label)`: der ⋯-Button;
  - `tipGroup(title, items)`;
  - `tipCounts(map)` für Listen wie „12 Agent“.
- **Labels für Schutzbedarf und Bearbeitung** kommen aus `DetailShared.PROTECTION` und `DetailShared.HANDLING`.
  `detail_shared.js` wird auf der Seite mitgeladen, es gibt keine eigene Zuordnung mehr. Die alte Seite
  `systemverwaltung.js` bildete noch deutsche Altwerte ab („hoch“ → Kritisch); die SD-API liefert
  LOW/ELEVATED/CRITICAL.
- **Klassenkollision behoben:** Die Seite hieß `al-systems`. Das ist zugleich die Kürzelgruppe im
  Rollenmanagement (`inline-flex`, `overflow:hidden`), die Seite fiel dadurch einspaltig zusammen. Seitenklasse
  jetzt `al-sysmgmt`. Weitere neue Klassen: `.al-sysname`, `.al-composition`, `.al-tags`, `.al-tag--handling`
  (Stil wie `.al-tag--template`), `.al-tag--todo`, `.al-overdue`, `.al-group-row`, `.al-col-*`.
- **ui.css:**
  - Sortierköpfe von Zahlenspalten (`.ui-table-num`) stehen bündig über den Zahlen, der Pfeil sitzt links vom Label.
  - `.ui-quick-filters` schrumpft nicht mehr (`flex: none`). Unter 900 px hat die Tabelle eine umgebrochene
    zweite Filterzeile überdeckt; das betraf alle drei Seiten.

### Nebenbefunde (SD-API-Lese-Agent, nicht Teil des Refactors)

- `GET /access/logs/assignments` joint die nicht existierende Tabelle `resource_assignment`
  (`app/modules/access/api/log_router.py:33`); der Endpunkt dürfte nicht funktionieren.
- SOFA `app/routes/api.py:1437` liest `system.get("type")` aus der System-Map, das Feld gibt es nicht (immer `None`).
- Die System-Routen der SD-API prüfen keine Rechte; geschützt sind sie nur über die SOFA-BFF (`SOFA-PAGE-SYS`).
- Das Kürzel lässt sich nicht mehr ändern, sobald ein System Ressourcen hat (409).

## Umsetzung (abgestimmt 17.11.2026)

### Stand nach Session 1 (17.11.2026, abgenommen)

Commits auf `feature/table-pages`: `58151e6` (Fix System-Map), `bf6c63b` (Systemdetail per URL), `b491c36`
(Aufgaben nach System), `482d19c` (Datenquellen), `cb1e852` (Seiten), danach die Doku. Der Nutzer hat Dev grob
getestet, ohne Auffälligkeiten. `482d19c` braucht die SD-API-Felder aus `7bc2533`; die sind noch nicht released,
deshalb fehlt ein `Requires:`-Trailer (beim Release nachziehen).

Erledigt:

- [x] **Datenschicht** `app/admin_views.py`: `GET /api/views/roles` (SOFA-PAGE-ROLE) und `GET /api/views/systems`
  (SOFA-PAGE-SYS), `?mock=` nur bei `APP_ENV=development`. Beide schneiden echte und Mock-Daten gleich zu.
  - **Rollen:** `roles` mit `role_id`, `name`, `role_type`, `role_status`, `parent_role_id`,
    `resource_items` (`resource_id`, `display_name`, `system_id`) und `assigned_to`. Dazu `systems` (ID, Name,
    Kürzel aus `/access/systems/`) und `users` (nur Vor-, Nachname und Funktion aus `?is_active=false`).
    `assigned_to` nennt nur Namen; bei gleichen Namen gewinnt der aktive User.
  - **Systeme:** `systems` mit Stammdaten, Schutzbedarf, `resources` (`resource_id`, `display_name`, `type_name`,
    `handling`), `user_count` und den drei Aufgabenzahlen. Dazu `backlogs` ohne `SOFA-BKLG-ALL`.
    Die Aufgabenzahlen kommen je Betrachter (`task_visibility_params`); `task_backlogs` nimmt technische Kennungen.
- [x] **Seiten umgestellt:** `/roles` und `/systems` rendern nur die neuen Templates, ohne eingebettete Daten.
  Lade- und Fehlerzustand: eine Zeile „Lädt …“ bzw. die Meldung der API mit „Erneut laden“.
- [x] **Rollenmanagement:**
  - Neue Rolle über `POST /api/roles`, danach lädt die Liste neu.
  - „Hauptrolle/Template darunter anlegen“ füllt Typ und „Erbt von“ vor.
  - Deaktivieren/Aktivieren nur ohne User und ohne aktive Kindrollen.
    - Deaktivieren fragt vorher in einer Zeile nach (Entscheidung des Nutzers).
    - Beides lädt erst die Rolle und schickt sie ganz mit `status` zurück.
    - Eine 409 zeigt ihr `detail` als Meldung.
  - Detailseite `/roles/<id>` (Klick, Enter, jetzt auch in der Tabelle), „User anzeigen“ → `/users?role=<id>`.
  - **Vorfilter `/roles?system=<id>`:** nur eigene Zuordnungen, über `system_id`. Er erscheint als entfernbare
    Marke mit dem Systemnamen nach einem Trenner in der Schnellfilterzeile (Muster Userverwaltung).
- [x] **Systemverwaltung:**
  - Neues System: `POST /api/systems`, dann (nur wenn gesetzt) `POST /api/systems/{id}` mit `protection_need`;
    danach weiter auf `/systems/<id>` (Entscheidung des Nutzers).
  - Zeilenklick → `/systems/<id>`; `?edit=1` öffnet dort den Stammdaten-Dialog, `?resource=new` das
    Ressourcen-Panel im Anlegemodus.
  - „Offene Aufgaben“ → `/tasks?system=<id>`, „Rollen anzeigen“ → `/roles?system=<id>`, „User anzeigen“ ausgeblendet.
  - Im Mock zeigen Detailseite, Stammdaten, Ressource und Aufgaben nur eine Meldung. „Rollen anzeigen“ springt mit
    `mock` ins Rollenmanagement, das dieselben Mock-Daten hat.
- [x] **Aufgabenseite `?system=<id>`:** neue Facette „System“ im Filter-Popover (`TasksBoardModel.FACETS`).
  Der Parameter setzt sie, sie wird wie die anderen gespeichert, danach fällt er aus der URL
  (Entscheidung des Nutzers).
- [x] **`list_page.js`:**
  - Tooltips auch bei Tastaturfokus; die Ziele tragen `tabindex="0"`.
  - Pfeiltasten, Pos1 und Ende in Sortier- und ⋯-Menü; Tab schließt das Menü und führt zum Auslöser zurück.
  - Node-Checks in `tests/list_page_checks.js`.
- [x] **Aufgeräumt:**
  - `rollenmanagement.*` und `systemverwaltung.*` gelöscht; `page_w_table.css` bleibt.
  - `/api/systems/map` liefert nur noch `name`.
  - Eintrag in `docs/frontend-backlog.md` angepasst.
- [x] **Tests:** `test_admin_views`, `test_admin_pages`, `test_admin_lists_mock` angepasst, Facette in
  `tasks_board_model_checks.js`. Die ganze Suite läuft grün (416 Tests).

Abweichungen und Befunde:

- **Systemliste im Rollenmanagement über `/access/systems/`, nicht `/systems/map`:** Die Map hat kein Kürzel.
  Dafür entfällt `system_short_name` aus `resource_items`, das Kürzel kommt aus der Systemliste.
- **Menüs gingen sofort wieder zu (Fehler aus dem Mock):** Der Fokus auf dem ⋯-Button scrollte seine Zelle
  (`overflow: hidden`) um wenige Pixel, und das Scroll-Ereignis schloss das Menü. Jetzt schließt Scrollen ein
  Menü nur, wenn sich sein Auslöser um mehr als 4 px bewegt hat.
- **Systemtabelle lief zwischen ca. 950 und 1450 px Fensterbreite seitlich über** (bis 232 px, der ⋯-Button war
  abgeschnitten).
  - „Inhalt“ schrumpft deshalb mit der Karte (`clamp(8rem, 100cqw - 62rem, 22rem)`) und fällt unter 1120 statt
    1050 px weg.
  - „Bearbeitung“ fällt unter 960 statt 760 px weg.
  - Unter 950 px Fensterbreite scrollt die Tabelle weiter seitlich, wie in der Userverwaltung.
- **Leere Rollentabelle:** Ausgeblendete Spalten zählen im festen Tabellenlayout mit. Zeilen über die ganze Breite
  („Keine Treffer“) spannen deshalb nur die sichtbaren Spalten.

Offen:

- **Datenprüfung mit echten Dev-Daten durch den Nutzer**, angemeldet auf sofa-dev:
  - `/api/roles`: `parent_role_id`, Reihenfolge von `resource_items`.
  - `/api/systems`: Bearbeitung, `user_count`.
  - `/api/views/systems`: Aufgabenzahlen gegen `/tasks`.
- Anlegen, Deaktivieren (inkl. 409) und die Deep-Links sind nur offline und per Test geprüft, nicht gegen die
  SD-API auf Dev.

### Stand nach Session 2 (17.11.2026)

Der Nutzer hat die Daten in Prod und alle Aktionen auf Dev durchgeklickt, ohne Befund.

Erledigt:

- [x] **Datenquelle `GET /api/views/users`** (SOFA-PAGE-USER), `?mock=` nur bei `APP_ENV=development`.
  - **User:** ein Aufruf `GET /access/users/?is_active=false` (alle User). Je User `user_id`, `pnr`, `racf`, `xde`,
    Vor- und Nachname, `is_active`, Ein- und Austritt, `primary_role` (ID, Name), `secondary_roles` (ID, Name,
    `role_type`) und `derived_statuses` mit `process_type`, `label`, `is_overdue`, `reference_date`, `role_name`,
    `source_role_name`, `target_role_name`.
  - **Inaktiv-Eintrag:** Die SD-API hängt bei inaktiven Usern `{code: "user_inactive", label: "Inaktiv"}` ohne
    `process_type` an. Der Zuschnitt behält nur Einträge mit `process_type`, so zählt er nicht als Prozess. Der Mock
    trägt den Eintrag jetzt auch, damit derselbe Zuschnitt greift.
  - **Rollen über `GET /access/roles/`, nicht `/roles/map`:** Die Map liefert nur aktive Rollen und keinen Status.
    `?role=<id>` braucht aber Name und Typ auch für inaktive Rollen (Marke, Facette); die Facetten zeigen nur aktive,
    dafür braucht es den Status. Die Rollenliste ist schwerer (Ressourcen, `assigned_to`), läuft aber parallel zur
    Userliste, und der Zuschnitt gibt nur ID, Name, Typ und Status weiter.
  - `/users` rendert nur noch `admin/users.html`; `_admin_list_mock` und das eingebettete `list-data` sind entfernt.
    Die Seite lädt per Fetch, mit Lade- und Fehlerzustand wie Rollen und Systeme. `?role=` greift nach dem Laden.
  - Datenprüfung des Nutzers in Prod (17.11.2026): 97 aktive, 21 inaktive User; alle Inaktiven mit `user_inactive`,
    keine E-Mail, kein Eintrag ohne `role_type`. `process_type` kommt groß (`OFFBOARDING`); die Seite normalisiert,
    der Mock liefert jetzt ebenfalls groß.
- [x] **`userverwaltung.js` aufgeteilt:** Panel und Dialoge stehen nahezu unverändert in `user_actions.js`,
  das Markup in `admin/user_actions.html` (Include), die Stile in `user_actions.css`.
  - Entfallen: `filterController`, `tableController`, gespeicherte Filter (`sofaUserverwaltungFilters`) und die
    Hilfen, die nur die alte Liste nutzte (Sortierung, Status-Marke, Rollenvorschau, Filteroptionen).
  - **Schnittstelle** `window.SofaUserActions`: `init({ reload, visibleUsers })`, `openUser(id)`,
    `run(action, userId)` und zusätzlich `allowed(action, user)` für das Zeilenmenü.
  - **Ein Hook `afterChange(userId)`** nach jeder erfolgreichen Aktion (Entscheidung des Nutzers): aktualisiert
    das Panel, falls es für diesen User offen ist, und lädt danach still die Liste neu. Er ersetzt die 6
    `tableController.loadUsers()` außerhalb der Liste (2 weitere lagen im entfallenen `filterController`) und die
    `refreshCurrentUser()` nach Erfolgen. `refreshCurrentUser()` bleibt nur im Fehlerfall „Kennung inzwischen
    geändert“ der Kontozeile.
  - `getFilteredUsers()` heißt jetzt `visibleUsers()` und kommt von der Seite (Suche, Filter, Schnellfilter, Inaktive).
  - Die Role Map lädt `init` vor, wie vorher der Filter; der Deep-Link `?user_id=` öffnet beim `init` das Panel.
- [x] **Neue Seite angebunden:**
  - Zeilenklick öffnet das Panel.
  - ⋯-Menü laut Tabelle „Zeilenmenü ⋯“. Ein Eintrag erscheint nur mit dem Recht des Panel-Buttons (Funktion
    wechseln SOFA-FN-ROLE, Neue Rolle SOFA-FN-RL, Schulung planen SOFA-FN-TRNG, Rolle entziehen SOFA-FN-RMRL,
    Offboarding SOFA-FN-OFFB, Wiedereintritt SOFA-FN-ONB) und nach `sofaContract.getUserPanelActions(user)`.
    Die Regel steht einmal in `user_actions.js` (`USER_ACTIONS`); `run` prüft sie noch einmal an den Details.
  - Menüeinträge laden erst die Details, dann öffnet der Dialog mit dem Detail-Objekt.
  - „Schulung planen“ und „Onboarding“ in der Werkzeugleiste tragen die alten IDs (`training-action-btn`,
    `onboard-action-btn`), `user_actions.js` bindet sie wie bisher.
  - Im Mock (`?mock=`) bleibt es bei der Meldung „(Mock)“: Die Mock-User gibt es in der SD-API nicht, und echte
    Dialoge würden auf Dev Prozesse starten. Das Menü filtert aber schon nach `allowed`.
  - Prozesslabel „Rücknahme“ (`rollback`) ergänzt, wie auf der alten Seite.
  - „Schulung planen“ bietet nur aktive User an, auch wenn die Liste mit „Inaktive“ Ausgetretene zeigt
    (Entscheidung des Nutzers, Filter im Hook).
- [x] **Aufgeräumt:** `userverwaltung.html`, `.js` und `.css` gelöscht; `_admin_list_mock` entfernt. Die nur dort
  genutzten Bilder `filter-icon-*.png` und `no-user-icon-*.png` sind ebenfalls gelöscht (eigener Commit). Einträge in
  `docs/frontend-backlog.md` nachgezogen (Statusliste jetzt in `user_actions.js`, die Kopie `.users-filter-*` und
  der „+N weitere“-Helfer der alten Liste sind weg), Pfade in `docs/idea-process-priority-controls.md` angepasst.
- [x] **Tests:** neu `tests/user_actions_checks.js`, Datenquelle und Deep-Links in `test_admin_views` und
  `test_admin_pages`; die fünf Testdateien der alten Seite lesen die neuen Pfade. Die ganze Suite läuft grün
  (422 Tests).
- [x] **Screenshots** offline (hell, dunkel, Servodata; 1600, 1100 und 820 px; Panel, Dialog „Offboarding“ aus dem
  ⋯-Menü, Filter-Popover, Lade- und Fehlerzustand, Leerzustand). Überlauf gemessen von 880 bis 1600 px, mit und
  ohne „Inaktive“, mit den Mock-Daten `busy`: überall 0.

Abweichungen und Befunde:

- **Usertabelle lief zwischen 900 und 1100 px über** (bei 950 px um 132 px, Fehler aus dem Mock). Acht Spalten
  brauchen mit den längsten Werten rund 980 px; Kürzen und engere Abstände reichen bis 900 px nicht. Unter 1040 px
  Kartenbreite fallen deshalb **Eintritt und Austritt** weg (`.al-col-date`, Muster der Systemverwaltung). Laufende
  Ein- und Austritte zeigt die Statusmarke mit Datum.
- **Filter-Popover ragte unter ca. 1400 px Fensterbreite rechts aus dem Fenster** (bei 1100 px um 271 px, die Seite
  scrollte seitlich; Fehler aus dem Mock). `SofaList.bindPopover` rückt das Popover jetzt um den Überstand nach
  links, `.ui-pop` ist höchstens fensterbreit und bricht seine Spalten dann um (unter 900 px einspaltig).

- **Keine E-Mail in der Liste:** `UserListContext` der SD-API hat kein `email` (erst die Details). Die Suche findet
  deshalb keine E-Mail-Adressen; das war auf der alten Seite genauso. `email` ist aus dem Zuschnitt entfernt.
- **Schulung planen lädt jetzt auch neu:** Der Dialog hat vorher weder Panel noch Liste aktualisiert. Er läuft jetzt
  wie die anderen über `afterChange`, damit die neue Schulung in der Statusspalte erscheint.
- **`userverwaltung.css` → `user_actions.css`:** Der Teil für Panel und Dialoge ist unter dem neuen Namen
  übernommen, ohne die Listenregeln und ohne die `main`-Regel der alten Seite. Die alte Datei fällt mit der alten
  Seite weg.
- **Keine neuen SD-API-Felder für die Userverwaltung:** `role_type` in `secondary_roles` gibt es seit v2.0.0, der
  Inaktiv-Eintrag seit v2.8.0.
- **`Requires: sd-api >= 3.3.1`** trägt der Doku-Commit von Session 2. Er holt den fehlenden Trailer von `482d19c`
  nach (Felder aus SD-API `7bc2533`, laut `release_notes.py version` dort 3.3.1), damit der Release-Eintrag die
  Mindestversion sammelt.

Offen:

- **Deploy:** Release `v1.7.0` ist vorbereitet (`Bump: minor` am Doku-Commit, Release-Commit am Ende des Branches).
  Merge auf `main` und Deploy macht der Nutzer, erst nach dem Deploy von SD-API 3.3.1.
- Wie nach Session 1: `/users?system=` und „Gilt für“ kommen später.

### Ablauf

- **Zwei Sessions.**
  - **Session 1:** Datenschicht, Rollenmanagement und Systemverwaltung. Danach sind beide Seiten deploybar.
  - **Session 2:** Userverwaltung, Aufräumen, Doku und Release-Notes.
- **Voraussetzung für Session 1:** Die SD-API-Erweiterung aus
  [backend-request-table-pages.md](backend-request-table-pages.md) läuft auf Dev.

### Datenschicht

- **Eine Datenquelle je Seite:** `GET /api/views/users|roles|systems`. Sie steht in `app/admin_views.py`.
  - Sie baut serverseitig genau die Form, die der Mock liefert: `{systems, roles, users, backlogs}`.
  - Je Seite enthält sie nur die verdichteten Felder, die die Seite braucht.
  - Mit `?mock=` liefert sie in der Entwicklung die Daten aus `admin_lists_mock.py`.
- **Die Seiten-Routen** rendern nur noch die neuen Templates. Das JS lädt seine Daten über die Datenquelle. Die
  Mock-Weiche `_admin_list_mock` in `pages.py` und das eingebettete `list-data` entfallen.
- **Rechte:** Jede Datenquelle prüft nur das Recht ihrer Seite.
  - Hintergrund: Rollenmanagement und Systemverwaltung brauchen Daten aus anderen Listen (Funktion je User,
    Rollen).
  - Über `/api/users` bzw. `/api/roles` bekämen Nutzer ohne das jeweilige Seitenrecht dafür 403.
- **User:**
  - Ein Aufruf `GET /access/users/?is_active=false` liefert **alle** User. Der Schalter „Inaktive“ filtert nur im
    Browser.
  - Inaktive User haben in `derived_statuses` einen eigenen Inaktiv-Eintrag. Er zählt nicht als Prozess.
- **`secondary_roles[]`** enthält `role_type` und nur aktive Rollen mit aktiver Zuweisung. Der Fallback über die
  Rollenliste entfällt.
- **Ressourcen eindeutig über die ID zuordnen:** Rollen ↔ Systeme über `resource_items`, nicht über
  Namen.
  - Im Mock und in `admin_roles.js`/`admin_systems.js` heute über `resource_names` gelöst. Das wird umgestellt.
- **Aufgabenzahlen der Systemverwaltung je Betrachter:**
  - Bei `has_all_backlog_access` ohne Parameter.
  - Sonst `task_backlogs=<accessible_backlogs>`, dazu `&task_unbacklogged=true`, wenn der Betrachter
    `SOFA-PAGE-TODO` hat. Ein leeres `task_backlogs=` heißt „kein Backlog“.
  - OPEN und BLOCKED zählen erst ab `active_at`, so wie auf der Aufgabenseite.
- **SD-API-Stand:** `7bc2533` (siehe [backend-request-table-pages.md](backend-request-table-pages.md)).
  Die Dev-Instanz `sd-api-dev` muss vor Session 1 neu gebaut werden.

### Rollenmanagement

- **„Deaktivieren“:**
  - Erscheint nur bei Rollen ohne User und ohne aktive Kindrollen.
  - Vor dem Speichern lädt SOFA die vollständige Rolle (`GET /roles/{id}`) und schickt sie mit `status:
    INACTIVE` an `POST /roles/{id}`.
    - Achtung: Der Endpunkt ersetzt die ganze Rolle. Fehlt `parent_role_id`, entfernt er die Elternrolle.
  - Eine 409 der SD-API wird mit ihrem `detail` als Meldung angezeigt.
  - Das kann trotz leerem `assigned_to` passieren, weil die Sperre auch beantragte Zuweisungen und Entzüge zählt.
- **„Aktivieren“** läuft genauso, nur mit `status: ACTIVE`.
- **Neu: Vorfilter `/roles?system=<id>`.** Er zählt nur eigene Zuordnungen einer Ressource des Systems.

### Systemverwaltung

- **Anlegen:** zuerst `POST /api/systems` mit Name, Kürzel und Backlog, danach `POST /api/systems/{id}` mit
  `protection_need`.
- **Ziele im ⋯-Menü:**
  - `/systems/<id>?edit=1` öffnet den Stammdaten-Dialog der Detailseite.
  - `/systems/<id>?resource=new` öffnet das Ressourcen-Panel im Anlegemodus.
  - `/tasks?system=<id>` braucht nur einen neuen URL-Parameter auf der Aufgabenseite.
  - „User anzeigen“ bleibt ausgeblendet, bis die SD-API die User je System liefert.

### Userverwaltung

- **Das alte `userverwaltung.js` wird aufgeteilt**, nicht neu geschrieben.
  - Panel und Dialoge ziehen nahezu unverändert nach `user_actions.js`.
  - Die Liste mit `filterController`, `tableController` und den gespeicherten Filtern entfällt.
- **Schnittstelle nach außen:** `SofaUserActions.init({ reload, visibleUsers })`, `openUser(id)` und
  `run(action, userId)`.
- **Kopplung an die Liste:**
  - `tableController.loadUsers()` wird `reload()`: 8 Aufrufe, davon 2 im `filterController`, der mit der Liste
    entfällt.
  - `getFilteredUsers()` (Schulung planen) wird `visibleUsers()`.
- **Die Dialoge erwarten das Detail-Objekt des Users.** Ein Eintrag im ⋯-Menü lädt deshalb zuerst die
  Details und öffnet dann den Dialog, also derselbe Weg wie aus dem Panel.
- **Markup:** Panel und Dialoge (Zeilen 110–487 in `userverwaltung.html`) wandern in ein Include. Von
  `userverwaltung.css` bleibt nur der Teil für Panel und Dialoge.
- **Deep-Links:** `?user_id=` bleibt, `?role=` kommt neu dazu. Temp. Rolle steht nur im Panel.
- **Tests:** Fünf Testdateien lesen `userverwaltung.js`/`.html` direkt und bekommen die neuen Pfade:
  - `test_planned_process_contract`
  - `test_sofa_access`
  - `test_account_identifier_panel`
  - `test_rehire`
  - `test_sd_api_sync`

### Gemeinsam

- **Tastatur in `list_page.js`:** Tooltips erscheinen auch bei Tastaturfokus, in Sortier- und ⋯-Menü navigieren
  die Pfeiltasten.
- **Node-Checks für `list_page.js`:** Sortierung, Filter mit drei Zuständen und `compareValues`.
- **Löschen:** Templates, JS und CSS der alten Seiten. `page_w_table.css` bleibt, weil IKS und Tools es nutzen.
  Ein Schalter zurück auf die alten Seiten wird nicht eingebaut.
- **Fix:** `api.py:1437` liest `system.get("type")`, das Feld gibt es nicht.
- **Nicht Teil dieses Refactors:**
  - Umzug der Aufgabenseite von `tb-*` auf die gemeinsamen Bausteine.
  - „Gilt für“.
  - Detailseiten.
  - `/users?system=`.

## Prüfen

- Screenshots offline: Seiten per TestClient rendern, mit Playwright aufnehmen (hell, dunkel, Servodata-Theme,
  breit, 1100 px, unter 900 px). Theme über `localStorage.sofaTheme`.
  - Seit Session 1 laden die Seiten ihre Daten per Fetch. Das Harness rendert deshalb auch die Antworten von
    `/api/views/*?mock=normal` als Dateien.
  - Lade- und Fehlerzustand entstehen über `page.route` (Anfrage hängt bzw. 503).
  - Den Überlauf der Tabellen misst `scrollWidth - clientWidth` des `.table-wrapper` über mehrere Breiten.
- Testsuite: siehe Memory `reference_test_runner` (Image `sofa-app` mit Host-`node`).
