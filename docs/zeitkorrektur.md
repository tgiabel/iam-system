# Zeitkorrektur – Konzept der Oberfläche in SOFA

Stand 23.09.2026 · Recht `SOFA-TOOL-ZK` · Backend: SD-API `/time-corrections`, in SOFA als `/api/time-corrections/...`

Maßgeblich für den Vertrag ist `docs/time-correction-api.md` in der SD-API (Branch `feature/time-correction`). Dieses Dokument beschreibt die Oberfläche. Wo es dem Vertrag widerspricht, gilt der Vertrag.

## Abweichungen vom ersten Entwurf

Diese Punkte gelten vor dem restlichen Text.

- **Nichts in der Zukunft.** Beginn und Ende einer Korrektur dürfen höchstens „jetzt“ sein (sonst 422 `correction_in_future`). Am heutigen Tag zeigt die Zeitachse eine Linie „jetzt“. Anlegen, Ziehen und die Zeitfelder im Formular enden an dieser Linie, und das Einrasten rundet nie darüber hinaus. Ein offener Wechsel (ohne Ende) bleibt erlaubt.
- **Kein `editable`.** Die SD-API liefert nur heute und gestern aus. Ältere Tage und Tage, die über Mitternacht zu alt geworden sind, beantwortet sie mit 422 `day_not_allowed`. Dann wird die Seite schreibgeschützt und bietet „Neu laden“ an.
- **Tage aus der API.** `GET /time-corrections/days` liefert heute und gestern (Berlin). SOFA rechnet die Tage nicht selbst aus.
- **Standardansicht** ist die eine kanonische Zeile, also die zusammengeführte Zeitleiste, die an Opcyc ginge.
- **Zurücknehmen** darf jeder mit dem Recht jede Korrektur.
- **Zeitbuchung statt Ergebnis.** Die kanonische Zeile heißt „Zeitbuchung“ und ist höher als die Ebenen. Im Bearbeitungsmodus liegt sie in der Mitte: oben Genesys, unten die Korrekturen, Pfeile ↓ und ↑ zeigen das Zusammenführen.
- **Opcyc-Datensätze unter dem Panel.** Aufklapper direkt auf der Seite, deckende Tabelle ohne eigenen Wrapper.
- **Kacheln des Tages, eine Zeitleiste.** Zwischen Leiste und Zeitleiste stehen Kacheln aller Mitarbeiter mit Buchung am Tag (Name, Logzeit mit Uhr, dezenter die Pause mit Besteck; Logzeit = alles außer HOME, Pause = BIPAU + PAUSE). Aktiv ist immer nur einer: Eine Kachel wechselt die Zeitleiste, ein zweiter Klick auf die aktive blendet sie aus. Ganz links, dezent abgetrennt, steht immer die Kachel des aktiven Mitarbeiters; kommt er aus der Tagesliste, ist er dort ebenfalls hervorgehoben. Die Suche (mit `date`, damit auch seither aus Genesys entfernte gefunden werden) macht einen Mitarbeiter aktiv; seine Kachel bleibt nicht stehen, wenn ein anderer aktiv wird. Kein Überwachungswerkzeug: keine Zeitleisten mehrerer Mitarbeiter nebeneinander. Log- und Pausenzeit geladener Mitarbeiter sind Summen über `merged` bis „jetzt“, keine Zusammenführung.
- **Kennzahlen.** Über der Zeitleiste Karten mit der Dauer je Status: links „Genesys“ je Genesys-Bezeichnung (aus `genesys`), rechts „Opcyc“ je Opcyc-Status ONLINE/BIPAU/PAUSE (aus `merged`, ohne Lieferung keine), jeweils ohne HOME und am laufenden Tag bis „jetzt“. Im Bearbeiten zeigen sie die Vorschau.
- **Seitenaufbau.** Die Seite füllt die Höhe: oben Kopf, Leiste und Kacheln, in der Mitte (im oberen Drittel des freien Raums) Name, Kennzahlen, Zeitleiste und Korrektur-Kacheln, unten die Opcyc-Datensätze.
- **Mitarbeiter-Kacheln** sind einheitlich quadratisch, lange Namen enden mit „…“; unten steht „1 Korrektur“ bzw. „x Korrekturen“, wenn es aktive Korrekturen gibt (Zeile immer reserviert, damit die Zeiten gleich sitzen; aus der Tagesansicht, sonst aus der Tagesliste – A3). Ein Sortier-Icon (waagrechte Pfeile, ohne Fläche) unten rechts an der Leiste öffnet ein Menü „Name“/„Logzeit“ (absteigend); die Wahl steht nur im Menü und wird im Browser gemerkt.
- **Tage blättern.** Pfeile links und rechts der Datumswahl springen einen Tag zurück bzw. vor; nach heute gibt es keinen.
- **Nachfrage als Modal.** Ungespeicherte Änderungen verwerfen fragt ein eigenes Modal (mit den Änderungen als Liste, „Weiter bearbeiten“/„Verwerfen“), nicht der Browser. Nur beim Schließen des Tabs bleibt die Browser-Meldung.
- **Kachel im Bearbeiten** ist ein kompakter Block: Status über die volle Breite, Zeitspanne, Grund; Bearbeiten/Entfernen in einer schmalen Spalte rechts.
- **Kopf und Leiste.** Rechts im Kopf „Neu laden“ mit „Stand hh:mm“ darunter. Darunter eine Leiste, bündig mit dem Panel: Suche links, Tage mittig, Ausschnitt (Arbeitszeit/Ganzer Tag) rechts.
- **Datumswahl.** Von links „Datum wählen“ (Kalender, höchstens heute; danach steht dort der gewählte Tag), gestern, heute. Ältere Tage sind schreibgeschützt (lesen seit A1).
- **Aufklappen.** Ein Pfeil oben rechts im Panel klappt Genesys, Zeitbuchung, Korrekturen und die Kacheln (mit zurückgenommenen) lesend auf, ohne Bearbeiten.
- **Panel nur mit Zeitleiste.** Rechts neben dem Panel: Stift zum Bearbeiten, im Bearbeitungsmodus stattdessen Speichern (mit Anzahl der Änderungen) und Abbrechen.
- **Kacheln statt Formular.** Im Bearbeitungsmodus stehen unter dem Panel alle Korrekturen als horizontale Kacheln, nach Beginn sortiert; vorn eine ausgehöhlte Kachel „+“ für eine neue Korrektur. Eingeklappt: Status, „08:00 bis 09:00“ bzw. „ab 08:00“, Zeitpunkt und Bearbeiter. Ein Klick klappt die Kachel in der Breite aus: dazu Grund, Bearbeiten und Entfernen. Bearbeiten macht Status (Auswahl), Beginn, Ende und Grund änderbar; ein leeres Ende ist ein Wechsel ab Zeitpunkt. Kachel und Block in der Zeitleiste sind dieselbe Auswahl.
- **Keine Verlaufstabelle.** Zurückgenommene Korrekturen stehen abgetrennt am Ende der Kacheln, ausgehöhlt und durchgestrichen, nur lesend. Korrekturen, die beim Speichern zurückgenommen werden, sehen bis dahin genauso aus und lassen sich wiederherstellen.
- Die Anforderungen aus Abschnitt 6 sind in der SD-API umgesetzt: Vorschau, `pieces`, `applied_to`, `delivered`, `revision` nur über Korrekturen, `revoked_by` mit Namen, `loc` in fachlichen 422-Fehlern, zweite Rechteprüfung.

## Stand der Umsetzung

| Schritt | Inhalt | Stand |
|---|---|---|
| 1.1 | Proxy-Router `app/routes/time_corrections.py` und `api_client.time_corrections_request` | erledigt |
| 1.2 | Seite `/tools/zeitkorrektur` und Kachel „Zeitkorrektur“ (Tools, Kicker „Genesys Cloud“) | erledigt |
| 1.3 | Mitarbeitersuche (Combobox, ab 2 Zeichen, 250 ms) und Tagesumschalter aus `GET /days`; Auswahl in der URL, Stand und Neu laden | erledigt |
| 1.4 | Kanonische Ergebniszeile mit Zeitachse (Berlin, 23/25 h), Ausschnitt Arbeitszeit/ganzer Tag, Linie „jetzt“; Zeilen-HTML ohne ids in `time_correction_timeline.js` | erledigt |
| 1.5 | Liste „Opcyc-Datensätze“ (aufklappbar): je Segment aus `merged` Uhrzeit hh:mm:ss (Berlin, abgeschnitten wie `strftime`), Status, Herkunft; bei `delivered=false` leer mit „Keine Opcyc-Datensätze entstanden.“ | erledigt |
| 1.6 | Verlauf „Zurückgenommene Korrekturen“ (aufklappbar, nur wenn vorhanden): Nr., Zeitraum, Status, Grund, angelegt und zurückgenommen (Name · Zeit) | erledigt |
| 1.7 | Hinweis Schattenbetrieb | entfällt: keine Betriebsinfo für Steuerer |
| 1.8 | Hinweis bei `delivered=false` | entfällt; wirkt nur in der Liste „Opcyc-Datensätze“ (siehe 1.5) |
| 2.1 | Bearbeitungsmodus: Genesys (jeder Eintrag einzeln), Korrekturen (aktive als Blöcke, Unterzeilen, der spätere oben), Ergebnis; Klammer „zusammengeführt“ | erledigt |
| 2.2 | Formular: „+ Korrektur“ (08:00 bzw. jetzt, offen, zuletzt gewählter Status), Block per Klick/Enter wählen, Status/Von/Bis/offen/Grund, Entfernen/Wiederherstellen; Zeitfelder enden bei „jetzt“; Nachfrage bei ungespeicherten Änderungen; `buildChangeRequest` | erledigt |
| 2.3 | Vorschau nach jeder Änderung (300 ms entprellt, nicht bei reinen Grund-Änderungen), wirksames Ende neuer Blöcke aus `create_index`; Ergebnis überdeckt, solange die Vorschau fehlt; Speichern mit `revision`, danach kanonische Zeile und „n angelegt · m zurückgenommen“ | erledigt |
| 2.4 | 409 und `day_not_allowed`: Modal mit den eigenen Änderungen als Text, nur „Neu laden“, Seite schreibgeschützt; übrige 422 (fachlich mit `loc`, Schemafehler als Liste) am Block: rot, gewählt, Meldung im Formular | erledigt |
| 3.1 | Direkte Bedienung: auf leerer Zeile zeichnen (Bereich) oder klicken (Wechsel ab Zeitpunkt), am Körper verschieben, an den Griffen Beginn/Ende ziehen (rechte Kante macht einen offenen Wechsel zum Bereich), Esc bricht ab; Vorschau nach dem Loslassen | erledigt |
| 3.2 | Einrasten (5 min, Shift 1 min) und magnetische Kanten | offen |
| 3.3 | Grenze „jetzt“ | offen |
| 3.4 | Tastaturbedienung | offen |

### Proxy

`/api/time-corrections/...` leitet an die SD-API `/time-corrections/...` weiter:

| SOFA | SD-API |
|---|---|
| `GET /api/time-corrections/days` | `GET /time-corrections/days` |
| `GET /api/time-corrections/users?q=` | `GET /time-corrections/users?q=` |
| `GET /api/time-corrections/days/{date}/users/{user_id}` | Tagesansicht |
| `POST /api/time-corrections/days/{date}/users/{user_id}/preview` | Vorschau, speichert nichts |
| `POST /api/time-corrections/days/{date}/users/{user_id}` | Speichern |

- Alle Routen stehen hinter `require_permission("SOFA-TOOL-ZK")`. Ohne aktive Identität antwortet SOFA mit 401.
- `X-User-Id` kommt immer aus der Sitzung. Ein gleichnamiger Header aus dem Browser wird nicht weitergegeben.
- Felder `created_by` und `revoked_by` im Browser-Body (oben und in `create[]`) entfernt der Proxy. Die SD-API bestimmt den Bearbeiter nur aus `X-User-Id`.
- Status und Body der SD-API gehen unverändert zurück, auch 409 und 422, immer mit `Cache-Control: no-store`. Ist die SD-API nicht erreichbar, antwortet SOFA mit 502.
- `{date}` muss ein Datum `YYYY-MM-DD` sein, `{user_id}` darf nur Buchstaben, Ziffern und `-` enthalten. Andernfalls antwortet SOFA selbst mit 422, ohne die SD-API aufzurufen. So kann kein Pfadsegment den SD-API-Pfad verlassen.

## Kurzfassung

- **Ein Mitarbeiter je Ansicht (Variante 1).** Die Datenmenge spricht nicht gegen „alle“ – ein ganzer Tag hat nur etwa 0,3–0,7 MB. Gegen „alle“ sprechen die Bedienbarkeit, veraltete Anzeigen und der Datenschutz. Eine reine Lese-Übersicht aller Mitarbeiter lässt sich später ergänzen, ohne dass etwas umgebaut werden muss.
- **Drei Zeilen im Bearbeitungsmodus:** Genesys (fest), Korrekturen (bearbeitbar), Ergebnis (Vorschau). Außerhalb des Bearbeitungsmodus steht nur das Ergebnis, also genau das, was Opcyc bekäme.
- **Korrekturen gibt es in zwei Formen:** als Bereich mit Ende und als „Wechsel ab Zeitpunkt“ ohne Ende. Die offene Form wird gebraucht, denn der Auftrag verlangt „Zeitpunkt oder Bereich“, und am laufenden Tag ist das Ende oft noch unbekannt.
- **Keine Zusammenführung in JavaScript.** Die Vorschau liefert die SD-API über einen Vorschau-Aufruf, der nichts speichert. So gibt es die Regel weiterhin an zwei Stellen, nicht an drei.
- **Vanilla-JS mit absolut positionierten `div`s und Pointer Events, keine Bibliothek.** SOFA bindet bisher keine einzige Fremdbibliothek ein, nur Google Fonts.
- **Umsetzung in 3 Schritten**, die sich jeweils einzeln abnehmen lassen: Lesen → Bearbeiten per Formular → Ziehen/Verschieben. Insgesamt etwa 1 500 Zeilen einschließlich Tests.

---

## 1. Entscheidungsvorlage: ein Mitarbeiter oder alle eines Tages

Ausgangsdaten vom 22.09.2026: 1 692 Presence-Einträge und etwa 1 240 Statuswechsel an Opcyc, verteilt auf 100–200 Mitarbeiter. Das sind im Schnitt etwa 10 Genesys-Abschnitte und 8 Wechsel je Person, bei sehr aktiven Agenten bis etwa 40.

Geschätzte Antwortgröße für einen Mitarbeiter (JSON, unkomprimiert):

| Teil | Anzahl | Größe |
|---|---|---|
| Genesys-Abschnitte | 10 × ca. 110 B | 1,1 KB |
| Ergebnis-Segmente (mit Teilstücken, siehe Abschnitt 6) | 8 × ca. 180 B | 1,4 KB |
| Korrekturen | 0–3 × ca. 350 B | ≤ 1 KB |
| Kopfdaten | | 0,4 KB |
| **Summe** | | **ca. 3 KB** (ein sehr aktiver Agent: ca. 10 KB) |

| Kriterium | (1) Ein Mitarbeiter | (2) Alle eines Tages |
|---|---|---|
| Payload je Laden | ca. 3 KB | 100–200 × 3 KB = **0,3–0,7 MB** |
| Aufwand in der SD-API | 1 indizierte Abfrage je Tabelle, eine Zeitleiste | 1 Abfrage über ca. 1 700 Presence-Zeilen, 200 Zeitleisten. Beides liegt im Bereich von Millisekunden |
| Requests | Suche (entprellt, 2–4 Aufrufe), 1 × GET, je Bearbeitungsschritt 1 × Vorschau, 1 × Speichern | 1 × GET für alle. Nach dem Speichern wird nur die eigene Zeile ersetzt. Aktualisieren heißt, den ganzen Tag erneut zu laden |
| DOM-Elemente | ca. 50 | ca. 2 000–4 000 (200 Zeilen × Segmente und Wechselmarken). Mit DOM noch unkritisch, Canvas ist nicht nötig |
| Genauigkeit | Die Zeitachse nutzt die volle Breite, bei 10 h auf 1 100 px ca. 1,8 px/min | Man müsste dieselbe Achse für alle zoomen. Über 24 h ergibt das 0,8 px/min, der typische 7-Minuten-Fehler (08:00 statt 08:07) ist dann nur **6 px** breit |
| Aktualität | Die Vorschau liefert ohnehin frische Genesys-Daten mit | Am laufenden Tag aktualisiert sich Genesys alle 2 min, 200 Zeilen veralten also sichtbar. Ein Neuladen kostet jedes Mal 0,5 MB |
| Gleichzeitiges Bearbeiten | Revision je Mitarbeiter und Tag, 409 selten | Gleiche Revision. Das Risiko, auf einem veralteten Stand zu bearbeiten, ist höher, aber ebenfalls nur je Zeile |
| Benutzersuche | nötig | **trotzdem nötig**: Wer den ganzen Tag keinen Wechsel hatte (zum Beispiel vergessen einzuloggen, ein ausdrücklich gewollter Anwendungsfall), steht in keiner Tagesliste |
| Datenschutz | zweckgebunden, man sieht eine Person | Eine Tagesübersicht der Anwesenheit aller Mitarbeiter ist eine Verhaltens- und Leistungsübersicht. Das ist ein Mitbestimmungsthema und hängt an der offenen Frage aus dem Auftrag „wer darf für wen korrigieren“ |

**Empfehlung: Variante (1).** Die Performance entscheidet die Frage nicht, beide Varianten sind billig. Den Ausschlag geben die Genauigkeit beim Ziehen, veraltete Anzeigen, die ohnehin nötige Suche und die ungeklärte Rechtefrage. Wenn später eine Übersicht gewünscht ist, kommt sie als **Lese-Übersicht** dazu: `GET /days/{date}`, N schreibgeschützte Ergebniszeilen, und ein Klick öffnet den Editor aus Variante (1). Einen Bearbeitungsmodus je Zeile braucht es dafür nicht. Die Zeilenkomponente wird deshalb von Anfang an so gebaut, dass sie N-mal gerendert werden kann.

---

## 2. Aufbau der Seite und Interaktionen

```
┌ Zeitkorrektur ───────────────────────────────────────────────────────────────┐
│ Mitarbeiter [ Erika Beispiel      ▾]   [Heute Di 23.09.][Gestern Mo 22.09.]    │
│ Stand 10:42 ⟳    Ausschnitt: (•) Arbeitszeit ( ) ganzer Tag      [Bearbeiten]  │
├───────────────────────────────────────────────────────────────────────────────┤
│             06    07    08    09    10    11    12    13    14                 │
│ ── Bearbeitungsmodus ─────────────────────────────────────────────────────────│
│ Genesys     ░HOME░░░░░░░░░░░│ONLINE·Verfügbar│ONLINE·Besprechung│PAUSE│ONLINE…  │
│ Korrekturen        ◆ONLINE 08:00 ⇢⇢                        + ziehen = Bereich  │
│             ─────────── ⊕ zusammengeführt · spätere Korrektur gewinnt ↓ ─────│
│ Ergebnis    ░HOME░░░░░│▲ONLINE▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔│PAUSE│ONLINE…  (Vorschau) │
├───────────────────────────────────────────────────────────────────────────────┤
│ Auswahl: Status [ONLINE|BIPAU|PAUSE|HOME]  Von [08:00]  Bis [    ] ☑ offen      │
│          Grund* [Dienstbeginn laut Teamleitung 08:00           ]  [Entfernen]  │
│ Änderungen: 1 neu · 0 geändert · 0 entfernt           [Verwerfen] [Speichern]  │
├───────────────────────────────────────────────────────────────────────────────┤
│ ▸ Opcyc-Datensätze (8)     ▸ Zurückgenommene Korrekturen (2)                   │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Kopf**
- **Keine Betriebsinfos:** Die Seite richtet sich an Steuerer. Hinweise zu Schattenbetrieb oder Lieferstatus gibt es nicht, auch keine erklärenden Untertitel.
- **Mitarbeitersuche:** Combobox auf `GET /users?q=`, ab 2 Zeichen, 250 ms entprellt. Auswahl und Tag stehen in der URL (`?user=u-1&date=2026-09-22`, per `history.replaceState`), damit Neuladen und Links funktionieren.
- **Tagesumschalter:** genau zwei Knöpfe, „heute“ und „gestern“ aus `GET /time-corrections/days`. Ältere Tage bietet die Seite gar nicht an. Ein Tag in der URL, den die API nicht anbietet, fällt auf heute zurück.
- **Stand:** Uhrzeit des letzten Ladens und ein Knopf ⟳. Es wird nicht automatisch abgefragt.

**Zeitachse**
- Die Achse ist linear in UTC von `day_start` bis `day_end`, beide Werte kommen aus der API. Die Beschriftung setzt `Intl.DateTimeFormat(…, {timeZone:"Europe/Berlin"})`. An den Umstellungstagen entstehen so automatisch 23 bzw. 25 Stunden, und bei 25 Stunden erscheint die Beschriftung „02“ zweimal.
- **Ausschnitt „Arbeitszeit“** (Standard): vom ersten bis zum letzten Nicht-HOME-Abschnitt im Ergebnis, erweitert um alle Korrekturen (im Bearbeitungsmodus die Bearbeitungsblöcke, auch HOME und neue), je 1 h Rand, mindestens 8 h. Beim Ziehen bleibt die Skala stehen. Umschaltbar auf „ganzer Tag“.

**Standardansicht (kanonisch)**
- Es gibt nur die Zeile **Ergebnis**. Ohne Korrekturen ist das schlicht Genesys, mit Korrekturen die zusammengeführte Zeitleiste, die an Opcyc ginge.
- Darunter lässt sich eine Liste **„Opcyc-Datensätze“** aufklappen: Uhrzeit (hh:mm:ss), Status, Herkunft. Sie entspricht Zeile für Zeile der Snapshot-CSV von genesys-sync und ist damit Abnahmehilfe und barrierearme Alternative zur Grafik.
- Hatte der Mitarbeiter keinen Wechsel und hat keine Korrektur (`delivered=false`), entstehen keine Datensätze: Die Liste zeigt (0) und aufgeklappt „Keine Opcyc-Datensätze entstanden.“ Einen eigenen Hinweis gibt es nicht.

**Bearbeitungsmodus** (Knopf „Bearbeiten“; entfällt, sobald die SD-API den Tag mit `day_not_allowed` ablehnt)
- Es erscheinen die Zeilen **Genesys** (fest) und **Korrekturen** (bearbeitbar). Die Ergebniszeile wird zur Vorschau.
- Die Korrekturzeile enthält **alle aktiven Korrekturen als Blöcke**, damit man sie bearbeiten kann. Sie ist nur leer, wenn es keine aktiven Korrekturen gibt.
- **Anlegen:** In der Korrekturzeile erzeugt Ziehen einen **Bereich**, ein einfacher Klick einen **Wechsel ab Zeitpunkt** (offen). Der Status des neuen Blocks ist der zuletzt gewählte, voreingestellt ONLINE. Alternativ legt der Knopf „+ Korrektur“ einen Block nur über das Formular an. Damit ist alles auch ohne Maus bedienbar, und genau diese Formularvariante ist Schritt 2 der Umsetzung.
- **Ändern:** Ein Bereich lässt sich verschieben (am Körper ziehen) und an beiden Kanten in der Länge ändern. Bei einem Wechsel ab Zeitpunkt lässt sich nur der Beginn verschieben. Wer an seiner rechten Kante zieht, gibt ihm ein festes Ende und macht ihn so zum Bereich. Die Checkbox „offen“ im Formular schaltet in beide Richtungen um.
- **Entfernen:** Block wählen, dann `Entf` oder „Entfernen“. Der Block bleibt bis zum Speichern als durchgestrichener Geist stehen.
- **Einrasten:** intern auf die Minute genau. Beim Ziehen rastet der Block auf 5 Minuten ein, mit gehaltener `Shift`-Taste auf 1 Minute. Vorrang haben Genesys-Wechsel und andere Blockkanten im Umkreis von 6 px (magnetisch). Die Zeitfelder im Formular (`type="time"`, `step=60`) erlauben die genaue Eingabe. Am 25-Stunden-Tag gilt eine eingetippte 02:xx als erste Stunde, die zweite erreicht man durch Ziehen.
- **Überlappungen** sind erlaubt, die Regel löst sie auf. Überlappende Blöcke weichen in Unterzeilen der Korrekturzeile aus. Oben liegt der jüngere, also der, der gewinnt. Neue und geänderte Blöcke liegen immer oben, weil sie beim Speichern die höchste `id` bekommen.
- **Grund:** Pflichtfeld je neuem oder geändertem Block, höchstens 255 Zeichen. Bei einem geänderten Block ist der alte Grund vorbelegt. Blöcke ohne Grund sind rot umrandet, „Speichern“ bleibt gesperrt. Für das Zurückziehen allein ist kein Grund nötig, denn das Datenmodell hat dafür keine Spalte.
- **Hinweis bei offener Korrektur bis Tagesende:** Reicht ein offener Wechsel bis `day_end`, weil darunter kein Wechsel mehr kommt, erscheint ein Hinweis: „wirkt bis Tagesende, solange Genesys keinen Wechsel meldet“. Das ist der Fall „ONLINE ab 08:00“ für jemanden, der seit gestern HOME ist.

**Abbildung auf die API** (reine Funktion `buildChangeRequest`, testbar in Node)

| Bedienung | Request |
|---|---|
| neuer Block | `create` |
| bestehender Block verschoben, gezogen, Status/Grund/offen geändert | `revoke:[id]` + `create` |
| bestehender Block entfernt | `revoke:[id]` |

Die Reihenfolge in `create` folgt der Reihenfolge in den Unterzeilen, von unten nach oben. Innerhalb eines Speichervorgangs gewinnt so der Block, der oben liegt.

**Speichern und Verwerfen**
- Die Speicherleiste zählt die Änderungen und listet sie als Text auf, zum Beispiel „neu: ONLINE ab 08:00 – Dienstbeginn … · zurückziehen: #12 PAUSE 12:00–12:30“.
- **Speichern** schickt `POST` mit `revision`. Bei 200 enthält die Antwort die neue Tagesansicht: Die Seite verlässt den Bearbeitungsmodus, zeigt das kanonische Ergebnis und meldet „1 angelegt, 1 zurückgezogen“.
- **Verwerfen** stellt ohne Request den Stand vom letzten Laden wieder her.
- Wechselt der Nutzer mit ungespeicherten Änderungen den Tag oder den Mitarbeiter oder verlässt er die Seite (`beforeunload`), fragt die Seite nach.
- **409 (Revision veraltet):** Ein Modal meldet „Diese Zeitleiste wurde inzwischen geändert.“, zeigt die eigenen Änderungen als Textliste zum Abschreiben und bietet nur „Neu laden“ an. Die Änderungen werden nicht automatisch neu angewendet: Bei 1–3 Bearbeitern ist dieser Fall selten, und ein automatischer Rebase wäre fehleranfällig.
- **422:** Die Meldung erscheint am betroffenen Block (Zuordnung über den Index in `create`, siehe Abschnitt 6). Ein typischer Fall: Die Seite war über Mitternacht offen, und „gestern“ ist nicht mehr korrigierbar. Dann zeigt die Seite „Tag nicht mehr korrigierbar“ und wird schreibgeschützt.

**Verlauf:** Eine aufklappbare Tabelle zeigt die zurückgezogenen Korrekturen des Tages (`id`, Zeitraum, Status, Grund, angelegt von/am, zurückgezogen von/am). Das dient der Nachvollziehbarkeit, ohne die Grafik zu überladen.

---

## 3. Visuelle Unterscheidung: zwei Ebenen und das Ergebnis

Farben je Status, jeweils mit Textlabel im Block, sobald er breit genug ist; die Farbe ist also nie die einzige Information. Verwendet werden die vorhandenen Tokens aus `ui.css`: **ONLINE** grün, **BIPAU** blau, **PAUSE** orange, **HOME** grau schraffiert. **Lila** (`--ui-purple-*`) bedeutet überall „Korrektur“.

| Zeile | Darstellung | Tooltip |
|---|---|---|
| **Genesys** | Statusfarbe blass, ohne Rahmen. **Jeder einzelne Genesys-Eintrag bleibt sichtbar getrennt**, auch bei gleichem Status: Ein offener Wechsel endet genau an der nächsten solchen Kante, ohne diese Kanten ließe sich sein Ende nicht erklären | Genesys-Label (z. B. „Besprechung“) → Opcyc-Status, Beginn–Ende |
| **Korrekturen** | Statusfarbe kräftig, 2 px lila Rahmen, Griffe an den Kanten, Kennzeichen `#12` oder „neu“. **Offener Wechsel:** lila Fähnchen ◆ am Beginn, Fläche bis zum tatsächlich wirksamen Ende (`applied_to`, von der API), rechte Kante gestrichelt ⇢. **Geändert:** gestrichelter Rahmen. **Entfernt:** Geist, durchgestrichen. **Ohne Wirkung** (vollständig von einer jüngeren überdeckt): halbtransparent | `#12 · Grund · Erika Beispiel · 23.09. 08:15` |
| **Ergebnis** | Statusfarbe kräftig, gleiche Status zusammengefasst. **Lila Streifen oben** genau über den Teilstücken, die aus Korrekturen stammen. **Wechselmarke ▲** am Beginn jedes Segments: grau bei Herkunft Genesys, lila bei Herkunft Korrektur | `Wechsel 08:00 → ONLINE · Korrektur #12 · Grund · Urheber` bzw. `Wechsel 12:03 → PAUSE · Genesys (Mittagspause)` |

Genesys und Korrekturen sind links mit einer Klammer zusammengefasst: „⊕ zusammengeführt · spätere Korrektur gewinnt ↓“. Darunter folgt das Ergebnis mit dem Kennzeichen „Vorschau“. So ist zu sehen, dass zwei getrennte Ebenen zusammengeführt werden, und das Ergebnis bleibt trotzdem eine einzige, kanonische Zeile. Während des Ziehens und bis die Vorschau-Antwort eintrifft, ist die Ergebniszeile abgeblendet und trägt den Hinweis „Vorschau wird aktualisiert“. Sie zeigt nie einen Stand, den die SD-API nicht berechnet hat.

---

## 4. Vorschau der Zusammenführung: in JavaScript oder im Backend?

| | Zusammenführung in JS (dritte Implementierung) | **Vorschau-Aufruf der SD-API** |
|---|---|---|
| Drift | Hoch. Die Regel ist klein, aber voller Feinheiten: Offene Enden hängen an **ungemergten** Kanten und an bereits angewandten Korrekturen, dazu die `id`-Reihenfolge, neue Korrekturen nach den bestehenden und das Zusammenfassen am Schluss. Die Tests aus `test_opcyc.py` müssten nach JS portiert werden, und jede Regeländerung wäre dreimal nötig. Gerade der Hauptzweck des Tools, zu zeigen, was Opcyc bekommt, würde darunter leiden | Keine. Es ist derselbe Code wie beim Speichern, nur ohne Commit |
| Latenz | 0 ms, Live-Vorschau schon während des Ziehens möglich | Ein Request **nach dem Loslassen** bzw. nach einer Formularänderung (entprellt), ca. 3 KB hin und zurück, Antwort im LAN im Bereich von Millisekunden |
| Nebeneffekte | keine | Validierungsfehler (Tag, Mitternacht, Status) zeigen sich schon vor dem Speichern |
| Aufwand | ca. 150 Zeilen JS plus portierte Tests | ca. 20 Zeilen in der SD-API (Rollback statt Commit), im Frontend derselbe Aufruf wie beim Speichern |

**Empfehlung: Vorschau-Aufruf im Backend, keine Zusammenführung in JS.** Beim Ziehen bewegt sich nur der Block in der Korrekturzeile, das Ergebnis wird nach dem Loslassen nachgeladen. Der Verzicht auf eine Live-Vorschau während der Ziehbewegung ist ein kleiner Komfortverlust. Dafür gibt es keine dritte Kopie der Regel.

---

## 5. Technische Umsetzung in SOFA

**Muster:** Als Proxy-Muster dient **LogonLog** (`app/routes/logon_log.py`), nicht der Queue Manager. Der Q-Manager-Proxy (`app/routes/api.py`, `/q-manager/...`) reicht keine Identität weiter. Das Zeitkorrektur-Tool braucht aber `created_by`, und das muss aus dem Authentifizierungskontext kommen. LogonLog leitet genau so weiter: eigener Router, `forward()` mit `X-User-Id` aus der Session, Body und Status unverändert durchgereicht, dazu `Cache-Control: no-store`.

| Datei | Inhalt | ca. Zeilen |
|---|---|---|
| `app/routes/time_corrections.py` (neu) | Router `/time-corrections` nach dem Muster von LogonLog: `GET /days`, `GET /users`, `GET /days/{date}/users/{user_id}`, `POST …/preview`, `POST …`. Alle hinter `SOFA-TOOL-ZK`, `X-User-Id` aus der Session, nie aus dem Body | 60 |
| `app/api_client.py` | `TIME_CORRECTIONS_BASE_URL`, eine Methode `time_corrections_request(method, path, user_id, …)` | 15 |
| `app/main.py` | `include_router(..., prefix="/api")` | 2 |
| `app/routes/pages.py` | `/tools/zeitkorrektur` hinter `require_permission("SOFA-TOOL-ZK", redirect_to="/tools")`. Außerdem `SOFA-TOOL-ZK` in die Rechteliste von `tools()` aufnehmen | 15 |
| `app/templates/tools.html` | Kachel „Zeitkorrektur“ (Kicker „Genesys Cloud“) | 15 |
| `app/templates/tools/time_correction_tool.html` (neu) | Kopf, Container für die Zeilen, Formular, Speicherleiste, Modals | 120 |
| `app/static/js/tools/time_correction_model.js` (neu) | **reine Funktionen**, ohne DOM, wie `task_view_model.js`: Zeit↔Prozent, Achsenbeschriftung (Berlin, 23/25 h), Einrasten, Unterzeilen-Layout, Arbeitszeit-Ausschnitt, `buildChangeRequest`, Prüfung „Grund fehlt“ | 250 |
| `app/static/js/tools/time_correction.js` (neu) | DOM, Pointer Events (`pointerdown/move/up` + `setPointerCapture`), Fetch, Zustand (Server-Stand + Liste der Bearbeitungsblöcke) | 550 |
| `app/static/css/time_correction.css` (neu) | Zeilen, Statusfarben über vorhandene Tokens, Rahmen, Streifen, Griffe | 200 |
| `tests/time_correction_model_checks.js` (neu) | Node-Checks der reinen Funktionen, darunter Umstellungstage und Diff → Request | 180 |
| `tests/test_time_corrections.py` (neu) | Proxy: 403 ohne Recht, `X-User-Id` aus der Session, 409 und 422 werden unverändert durchgereicht | 100 |

**Rendering:** absolut positionierte `div`s mit `left/width` in Prozent der Tageslänge innerhalb einer relativ positionierten Zeile. Das ist einfacher als SVG, weil Textlabels, Ellipsen, Fokus, `title`-Tooltips und die vorhandenen CSS-Tokens ohne Umweg funktionieren. Bei etwa 50 Elementen ist Canvas unnötig. **Keine Bibliothek:** SOFA lädt bisher kein einziges Fremdskript. Gängige Timeline-Bibliotheken (z. B. vis-timeline) wären die erste externe Abhängigkeit, mehrere hundert KB groß, und sie kennen das Modell „zwei Ebenen plus Ergebnis vom Server“ ohnehin nicht.

**Rechte:** Eine Zeile `SOFA-TOOL-ZK` in `SOFA.resources` plus Zuweisung an eine Rolle. Das ist eine Datenbankaktion des Nutzers und gehört nicht zum Code. `sofa_permissions.json` braucht keinen Eintrag, denn die Tool-Optionen sind dort leer.

**Schritte (je einzeln deploybar und abnehmbar):**
1. **Lesen:** Proxy, Seite, Kachel, Suche, Tagesumschalter, Ergebniszeile, Liste „Opcyc-Datensätze“, Verlauf. *Abnahme:* Die Liste stimmt für einen Testmitarbeiter mit der `snapshot`-CSV von genesys-sync überein. Umfang ca. 45 % der Summe.
2. **Bearbeiten per Formular:** Bearbeitungsmodus mit drei Zeilen. Blöcke werden nur über das Formular angelegt, geändert und entfernt. Dazu Vorschau, Speichern, 409 und 422. Damit ist der Auftrag fachlich vollständig („Zeitpunkt oder Bereich anlegen, zurücknehmen“). Umfang ca. 35 %.
3. **Direkte Bedienung:** In der Zeile zeichnen, verschieben und ziehen, dazu Einrasten und magnetische Kanten. Umfang ca. 20 %.

Summe: ca. 1 500 Zeilen, davon ca. 280 Tests.

---

## 6. Anforderungen an die SD-API

**Umgesetzt (SD-API 047e1ac)**

- **A1 – Ältere Tage lesen.** `GET /time-corrections/days/{date}/users/{user_id}` für Tage vor gestern, nur lesend (Speichern und Vorschau bleiben auf heute und gestern beschränkt). Heute lehnt `_checked` jeden anderen Tag mit 422 `day_not_allowed` ab. Dazu müsste die Mitarbeitersuche auch Mitarbeiter finden, die vor gestern aus Genesys entfernt wurden (`removed_since`), zumindest für den gewählten Tag.

- **A2 – Mitarbeiter mit Buchung am Tag.** `GET /time-corrections/days/{date}/users` →
  `{"users": [{"user_id": "…", "name": "…", "logged_seconds": 28800, "pause_seconds": 2700}]}`: alle, die an dem Tag in der Lieferung stehen (`delivered`), mit Logzeit (alles außer HOME) und Pause (BIPAU + PAUSE) über `merged`, am laufenden Tag bis „jetzt“. SOFA leitet den Aufruf schon weiter (`/api/time-corrections/days/{date}/users`) und zeigt bei 404 nur die Kacheln aus der Suche.

**Offen**

- **A3 – Korrekturen in der Tagesliste.** In `GET /time-corrections/days/{date}/users` je Mitarbeiter `corrections`: Anzahl der aktiven (nicht zurückgenommenen) Korrekturen an dem Tag. SOFA zeigt sie in der Kachel an, sobald das Feld da ist.

**Aus dem Entwurf**

**Umgesetzt** bis auf `editable` aus Punkt 7 (entfällt, siehe „Abweichungen“) und Punkt 10 (bewusst später).

Abgeglichen mit dem Entwurf und mit dem Stand in `app/modules/time_correction/` (Branch `feature/time-correction`).

1. **Vorschau ohne Speichern:** `POST /time-corrections/days/{date}/users/{user_id}/preview` mit demselben Body wie beim Speichern. Gleiche Validierung, gleiche Zusammenführung, Rollback statt Commit, Antwort = Tagesansicht. Unterschiede zum Speichern: `reason` darf leer sein, `revision` wird nicht geprüft. Noch nicht angelegte Korrekturen erscheinen in `corrections`, `merged` und `pieces` mit `id/correction_id: null` und `create_index` (Position in `create`).
2. **`genesys[]` ungemergt**, also genau die Ausgabe von `base_segments`, einschließlich aufeinanderfolgender Einträge mit gleichem Status. Das `label` ist nie `null` (Ersatz: `system_presence`). Ohne diese Kanten lässt sich das Ende offener Korrekturen nicht darstellen.
3. **Wirksames Ende je aktiver Korrektur:** `corrections[].applied_to`. Das ist das `end`, das `apply_correction` tatsächlich verwendet hat, bei offenen Korrekturen also die aufgelöste nächste Kante. Ist es `null`, blieb die Korrektur ohne Wirkung (`end <= start`). Das Frontend soll dieses Ende nicht selbst ausrechnen.
4. **Herkunft eindeutig machen:** `_merge_equal` übernimmt die `correction_id` des *ersten* Teilstücks. Damit gilt `merged[].source/correction_id` nur für den **Wechsel am Segmentbeginn**, und genau das sieht Opcyc. Das bitte so dokumentieren. Zusätzlich `pieces:[{start,end,status,source,correction_id}]` liefern, also den Stand nach `apply_correction` und vor `_merge_equal`, damit die Ergebniszeile die korrigierten Strecken exakt markieren kann. Das sind ca. 1 KB mehr je Mitarbeiter.
5. **`revision` nur über `presence_correction`** des Nutzers und Tages (so scheint es mit `FOR UPDATE` auch angelegt). Genesys-Aktualisierungen alle 2 min dürfen die Revision **nicht** ändern, sonst endet am laufenden Tag fast jedes Speichern mit einem 409.
6. **`revoked_by` wie `created_by`** als `{user_id, name}` (heute im Entwurf nur eine ID).
7. **`editable: bool`** (Tag ist heute oder gestern, Berliner Zeit) und **`delivered: bool`** (`is_delivered`) in der Tagesansicht.
8. **Fachliche 422-Fehler mit Bezug auf den Eintrag:** Die Fehler aus den Schreibregeln (Mitternacht, falscher Tag, unbekannte ID in `revoke`, Tag nicht mehr korrigierbar) bitte im FastAPI-Format mit `loc: ["body","create",i]` bzw. `["body","revoke",i]` melden. Dann kann die Oberfläche sie dem Block zuordnen.
9. **Autorisierung auch in der SD-API:** `created_by`/`revoked_by` nur aus `X-User-Id`. Die SD-API prüft `SOFA-TOOL-ZK` ein zweites Mal, wie bei `SOFA-FN-EDITACC`.
10. **Nicht nötig für den Start:** `GET /time-corrections/days/{date}` (alle Mitarbeiter). Dieser Aufruf kommt erst mit einer späteren Lese-Übersicht und liefert dann dieselbe Struktur als Liste.
