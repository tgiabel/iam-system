# Aufgabenseite als Kanban

Vorgemerkt am 14.10.2026, noch nicht geplant. Teil 2 von drei UI-Aufwertungen (Workspace: [workspace-redesign.md](workspace-redesign.md), Dashboard: [dashboard-redesign.md](dashboard-redesign.md)). Muss vor der Umsetzung ausgearbeitet und gebrainstormt werden.

## Idee des Nutzers

- Kanban-Struktur statt der bisherigen Liste, übersichtlicher.
- Jede Spalte bekommt eigene Gruppierung und Sortierung, je nachdem, was in der Spalte sinnvoll ist.
- Beispiel Spalte „In Bearbeitung“: gruppiert nach Bearbeiter. Ganz oben stehen die eigenen Aufgaben, darunter die Bearbeiter mit aktiven Aufgaben, leicht ausgegraut, damit klar ist, dass es nicht die eigenen sind. Man kann den Fortschritt eines Prozesses mitverfolgen.
- Einsicht in fremde Tasks richtet sich nach der Backlog-Zugehörigkeit: Backlog-Mitglieder sehen auch die Tasks, die ein Kollege im selben Backlog übernommen hat.

## Ausgangslage im Code

- `app/static/js/tasks.js` (rund 3000 Zeilen) und `app/static/js/task_view_model.js` mit Facetten `status`, `handling`, `taskType`, `backlog` und Gruppierung nach Person, Prozess, System, Backlog (`GROUP_DIMENSIONS`). Das Ansichtsmodell ist getestet und kann wiederverwendet werden.
- Die Filterleiste nutzt die geteilte Komponente `.ui-filter-*`.
- Gruppenschlüssel entstehen im Frontend aus `GET /sofa/tasks/overview`; offene Backend-Fragen stehen in [backend-request-task-grouping.md](backend-request-task-grouping.md) und [backend-request-bulk-tasks.md](backend-request-bulk-tasks.md).
- Aktuell gibt es die Tabs „Offen“ und „Meine“ (`task_view_model.js`, `activeTab`).

## Entscheidungen (Brainstorm 15.10.2026)

### Board

- Spalten: links eine schmale, standardmäßig eingeklappte Leiste **Zurückgestellt** mit den Abschnitten Blockiert und Nachgelagert | **Offen** | **In Bearbeitung** | **Erledigt**.
- Blockiert ist ein echter Status (`BLOCKED`, wird bei erfüllter Ressourcenabhängigkeit automatisch `OPEN`), nicht übernehmbar. Nachgelagert ist nur ein Merkmal offener Tasks (`provisioning_requirement: DEFERRED`) und bleibt übernehmbar, auch aus der Leiste heraus.
- Sichtbar sind alle Tasks der erlaubten Backlogs, auch fremde in Bearbeitung und fremde erledigte. Fremde Tasks: gedämpfte, deckende Fläche, Initialen des Bearbeiters, kein Ziehgriff und keine Auswahl, Details nur lesend.
- Sichtbarkeit (Entscheidung 23.10.2026): Tasks ohne Backlog sieht jeder mit `SOFA-PAGE-TODO`, auch fremde; das ist der Weg für einfache Aufgaben, die alle bearbeiten dürfen. Im Zielbild läuft aber möglichst alles im Kontext eines Backlogs, und `SOFA-BKLG-ALL` hat dann kein Nutzer mehr, nur ein Admin-Konto auf Abruf. Bis dahin darf die Berechtigung vergeben werden. Logik daher nie darauf bauen, dass Nutzer `SOFA-BKLG-ALL` haben.
- Die Tabs „Offen“ und „Meine“ entfallen, dafür gibt es den globalen Schalter „Nur meine“.
- Jede Spalte scrollt für sich, kein Seitenscroll. Mobil: Spalten als Reiter.

### Ansichtsoptionen

Filter (Suche, Backlog, Typ, Bearbeitungsart, „Nur meine“) gelten fürs ganze Board. Pro Spalte nur Darstellung, als Dropdown im Spaltenkopf, je Nutzer gespeichert:

| Spalte | Optionen | Standard |
|---|---|---|
| Zurückgestellt | keine, fest nach Person | eingeklappt |
| Offen | Gruppierung (keine/Prozess/Person/System/Backlog), Sortierung Stichtag oder Alter | Stichtag, ungruppiert |
| In Bearbeitung | keine; fest nach Bearbeiter, eigene oben, innerhalb einer Person die am längsten übernommenen oben; Kollegen blendet „Nur meine“ aus | Kollegen-Gruppen zugeklappt |
| Erledigt | Zeitraum Heute / Diese Woche / Dieser Monat, ab Woche nach Tagen gruppiert | Heute |

### Aktionen

- Mehrfachauswahl per Strg-/Shift-Klick, Auswahlleiste unten (Übernehmen, Freigeben, Erledigen). Drag & Drop später als Bequemlichkeit auf demselben Fundament; ein Drop ändert nur den Status, keine Position.
- Offen → Erledigt ist erlaubt (übernimmt automatisch), aber immer mit Bestätigungsdialog, auch ohne Kontoeingabe.
- Sammel-Abschluss als flache Checkliste: fehlende Eingaben (Kennung, archiviertes Konto, Entzug vor Stichtag) inline je Zeile, Zeilen per ✕ herausnehmbar, gemeinsamer Kommentar, verwandte Konto-Entzüge vorab als Vorschlagszeilen, Ergebnis je Zeile, Fehlschläge bleiben stehen. Verwandte Entzüge nur aus offenen und eigenen Tasks, nie aus fremden.

### Bot (Genesys)

- Genesys ist derzeit die einzige automatisierbare Integration. `dispatch_bot` läuft in der SD-API schon synchron über `integration_service.integrate_user_in`.
- Diese Version: bei Erfolg schließt die SD-API den Task selbst ab (Kennung = `user_id` aus dem Ergebnis). Bei Misserfolg bleibt er in Bearbeitung, das freie Kennungsfeld erscheint erst danach („Manuell erfassen“). Der Log-Text „Warten auf Antwort“ entfällt.
- Manueller Abschluss ohne Fehlschlag (18.11.2026): Bei eigenen BOT-Tasks in Bearbeitung bietet „⋯“ im Kopf des Details „Manuell abschließen …“ an (nur im Detail-Schritt, nicht bei Offen/„Direkt erledigen“). Es führt in denselben Abschluss-Schritt wie „Manuell erfassen“; alle Sonderregeln aus `completionPlan` gelten. Ohne vorherigen Fehlschlag ist eine Abschlussnotiz Pflicht, nach einem Fehlschlag nicht (Grund steht im Verlauf). Die Pflicht prüft nur das Frontend; die SD-API kennt keine Markierung „manuell statt automatisiert“, im Verlauf steht „Erledigt“ mit der Notiz. Mail-Tasks (EXTERNAL) bleiben unverändert, „Erledigen …“ geht dort weiter ohne Mail.
- Zielbild später: automatische Tasks laufen ohne Bearbeiter, sobald sie freigeschaltet sind; Bearbeiter ist ein System-User; bei Misserfolg wird der Task `OPEN` mit der Fehlermeldung im Log.

### Reihenfolge

1. Draft 1: Board, Cards, Fremd-Kennzeichnung, Spaltenoptionen, Auswahlleiste mit Übernehmen/Freigeben. Nur Mock-Daten in der Form von `TaskView` plus fehlender Felder (siehe unten).
2. Draft 2: Abschluss-Dialog (einzeln und Sammel, inkl. Offen → Erledigt).
3. Historie als eigener Schritt: Zeitleiste, System-Einträge gedämpft ohne JSON, Bearbeiter-Kommentare hervorgehoben mit Name, Notizen ohne Aktion, Kommentar auch beim Freigeben (heute geht er verloren).
4. Drag & Drop, falls es sich dann noch lohnt.

### Stand Draft 1 (15.10.2026)

Nur auf Dev: `/tasks?mock=normal|busy|quiet`, die bisherige Seite bleibt ohne Parameter (seit 26.10.2026 überholt, siehe Echtbetrieb). Neue Dateien: `app/tasks_board_mock.py` (Mock in `TaskView`-Form plus Wunschfelder), `app/templates/tasks_board.html`, `app/static/js/tasks_board_model.js` (Logik, getestet in `tests/tasks_board_model_checks.js`), `app/static/js/tasks_board.js`, `app/static/css/tasks_board.css`; Weiche in `app/routes/pages.py`. Übernehmen/Freigeben sind im Entwurf nur simuliert.

### Design-Runde 1 (16.10.2026)

- Karten quadratisch im Raster (meist zwei nebeneinander), größere Schrift; ist eine Spalte nur eine Karte breit, werden sie kompakt in voller Breite.
- Schmalere Spalten (Seite max. 1320px, mit offener Leiste breiter). Zwischen den Spalten Pfeile mit Verbindungslinie als Arbeitsfluss.
- Farbstufen nur an Spaltenrahmen, -kopf und Zähler: Offen blau, In Bearbeitung orange, Erledigt grün; Karten bleiben neutral. Töne werden mit der deckenden Kartenfläche gemischt (keine Transparenz).
- Leiste „Zurückgestellt“: gestrichelt umrandet und durch eine gestrichelte Linie vom Ablauf getrennt. Aufgeklappt zwei Bereiche als Akkordeon, Blockiert (lila) immer oben, Nachgelagert (grau) immer unten, genau einer offen (animiert); leere Bereiche entfallen.

### Design-Runde 2 (16.10.2026)

- Eine Karte pro Zeile, etwas größer (Spalten ca. 15,5rem, quadratisch); dazwischen breitere Lücken mit flachen Doppelpfeilen „>>“ ohne Verbindungslinie. Board und Werkzeugleiste gleich breit und zentriert.
- Karteninhalt: oben System, darunter „<Ressource> einrichten“ (grün) bzw. „<Ressource> entziehen“ (rot), dann Person; der Chip „Entzug“ entfällt.
- Leiste „Zurückgestellt“ am linken Fensterrand angedockt, ohne Pfeil zum Ablauf; gestrichelte Trennlinie nur aufgeklappt; Blockiert und Nachgelagert als eigene Karten ohne gemeinsamen Hintergrund.

### Design-Runde 3 (16.10.2026)

- Farben getauscht: Blockiert grau, Nachgelagert lila.
- Doppelpfeile vertikal mittig zwischen den Spalten, größere Lücken (7,5rem, bis 1280px 4rem).
- Leiste zugeklappt nur so hoch wie ihr Inhalt: drei überlappende Reiter am Fensterrand, oben weiß „Zurückgestellt“, darunter halb verdeckt Blockiert (grau gefüllt) und Nachgelagert (lila gefüllt) mit Zähler; Klick auf einen Bereichsreiter öffnet direkt diesen Bereich. Aufgeklappt volle Höhe.

### Design-Runde 4 (22.10.2026)

- Blockiert und Nachgelagert dürfen gleichzeitig zugeklappt sein; höchstens ein Bereich ist offen. Der Zustand bleibt beim Neuladen erhalten.
- Der senkrechte Reiter „Zurückgestellt“ bleibt beim Öffnen bestehen und rückt leicht nach links. Rechts schließt ein deckendes Panel mit gleicher Oberkante an; die beiden farbigen Reiter bleiben an ihrem Platz und werden überdeckt. Öffnen und Schließen animieren ohne Austausch des Reiters.

### Design-Runde 5 (22.10.2026)

- Alle drei Reiter bleiben beim Öffnen links sichtbar und bedienbar. Der Hauptreiter und der aktive Bereichsreiter gehen ohne Trennkante in das weiße Panel über; inaktive Bereiche behalten ihre gefüllten Reiter.
- Im Panel wird ausschließlich der aktive Bereich mit Überschrift und Aufgaben angezeigt. Die zusätzlichen Akkordeon-Schalter entfallen. Ein erneuter Klick auf den aktiven Bereichsreiter schließt diesen, der Hauptreiter schließt das gesamte Panel. Mobil stehen die beiden Bereichsreiter nebeneinander über dem Inhalt.

### Design-Runde 6 (22.10.2026)

- Die geöffnete Panelfläche reicht hinter und unter den Reitern bis zum linken Bildschirmrand. Alle angedockten Reiter haben dann gerade Ecken.
- Der aktive Bereich übernimmt die volle graue bzw. lila Farbe seines Reiters, die Karten behalten ihre neutrale Fläche. Inaktive Reiter sind aufgehellt; ein kleiner Pfeil vom aktiven Reiter zum Inhalt markiert die Auswahl zusätzlich.

### Design-Runde 7 (22.10.2026)

- Das Panel bleibt weiß, einschließlich der Fläche unter den Reitern. Darin steht der aktive Bereich als eigene Kanban-Spalte mit kräftiger Akzentkante und derselben hellen Füllung wie die übrigen Board-Spalten (4 % im Körper, 11 % im Kopf).
- Die Spalte hat links gerade Ecken und dockt ohne Abstand an die Reiter an. Der aktive Reiter bleibt kräftig gefüllt; seine Farbe entspricht der Rahmenfarbe der Spalte.
- Oben, unten und rechts schließt die Spalte bündig mit dem Sidepanel ab und bildet dessen gemeinsamen Rand.

### Design-Runde 8 (22.10.2026)

- Ein geöffnetes Sidepanel hat immer genau einen aktiven Bereich. Ein Klick auf dessen Reiter schließt das gesamte Panel; ein Klick auf den anderen wechselt direkt den Inhalt. Beim erneuten Öffnen bleibt der zuletzt gewählte Bereich aktiv.
- Entfällt der aktive Bereich durch einen Filter oder eine Aktion, wird der verbleibende Bereich angezeigt. Sind beide leer, schließt das Panel und lässt sich ohne Inhalt nicht öffnen. Alte gespeicherte Ansichten ohne aktive Auswahl erhalten wieder einen gültigen Bereich.

### Design-Runde 9 (22.10.2026)

- Unter „Offen“ lassen sich die Gruppen nach Prozess, Person, System und Backlog wie die Kollegen-Gruppen unter „In Bearbeitung“ einzeln auf- und zuklappen. Sie starten geschlossen; geöffnete Gruppen werden je Gruppierungsart für die Sitzung gemerkt. Ohne Gruppierung bleiben alle Karten direkt sichtbar.
- Prozesslabels zeigen zuerst Prozess und Person, die Prozess-ID steht am Ende. Die Gruppenköpfe zeigen beim Überfahren mit der Maus das vollständige Label als Tooltip.
- Beim Zuklappen fällt die Auswahl der versteckten Karten weg. Shift-Auswahl berücksichtigt nur Karten aus aufgeklappten Gruppen.

### Design-Runde 10 (22.10.2026)

- Einheitliche Karten in allen Spalten mit inhaltsabhängiger Höhe statt festem Quadrat. System als ruhige Kopfzeile, Ressource als dunkler Haupttitel, Aktion separat grün/rot, Person größer und mit „für“. Ressourcen und Namen werden vollständig umgebrochen.
- Der Fußbereich zeigt den Stichtag auch in Bearbeitung; nur überfällige und heute fällige Aufgaben erhalten eine farbige Zeitmarkierung. Mail/Bot und Übernahmedauer bleiben nachrangige Textangaben.
- Erledigte Karten zeigen Abschlusszeit und Bearbeiter statt Bearbeitungsart und zusätzlichem Initialen-Avatar. Die Bearbeiter-Gruppierung unter „In Bearbeitung“ bleibt bestehen.
- Blockierte Karten nennen die blockierende Ressource statt eines redundanten Status-Chips. Der Mock liefert dafür `blocked_by` mit Task-ID, Ressource und Status; die Backend-Anforderung bleibt offen. Das Modal ist unverändert.

### Modal-Entwurf (22.10.2026)

- Nur im Dev-Mock: eigener Modal-Controller `tasks_board_detail.js`, Beispieldaten fuer Verlauf, Ergebnisse und archivierte Konten getrennt unter `task_details`. Alle Aktionen werden lokal simuliert; es gibt keine API-, Integrations- oder Mail-Aufrufe.
- Gleicher Kopf wie auf der Karte: System, dunkler Ressourcentitel, farbige Aktion, Person. Status und ein Hilfe-Button stehen rechts; der Hilfe-Button ist ein Platzhalter fuer spaetere Ressourcenanleitungen, gegebenenfalls mit dynamischen Platzhaltern.
- Kompakter Kontext mit Stichtag, Bearbeiter, Uebernahmedauer bzw. Abschluss, Bearbeitungsart; Prozess, Backlog und Task-ID nachrangig. Ein gemeinsamer scrollender Inhaltsbereich, feste Kopf- und Aktionsleiste.
- Arbeitsbereich je Status: Uebernahme fuer offene/nachgelagerte Tasks, Kommentar und passende Aktionen fuer eigene Tasks, Abhaengigkeit bei blockierten, reine Leseansicht fuer fremde, Ergebnis und Kennung bei erledigten Tasks. Freigeben hat eine rote Kontur und Beschriftung; Tooltip: „Zurueck zu den offenen Aufgaben“ (auch in der Auswahlleiste).
- Verlauf als Zeitleiste, neueste zuerst, die letzten drei Eintraege direkt sichtbar; gesamter Verlauf aufklappbar. Kommentare mit Name und eigener dezenter Flaeche, Systemereignisse ruhig, Automationsergebnisse lesbar und Kennungen kopierbar. Aktion und Kommentar erscheinen gemeinsam, ohne JSON.
- Notiz speichern ohne Statuswechsel, Kommentar beim Freigeben und Abschliessen. Kommentarentwuerfe bleiben beim Wechsel der Ansicht und beim erneuten Oeffnen innerhalb der Sitzung erhalten.
- Abschluss als eigener Schritt **im selben Modal**, mit Zurueck, expliziter Bestaetigung, bedarfsabhaengiger Kennung, Wahl zwischen archiviertem und neuem Konto sowie ausdruecklicher Bestaetigung eines Entzugs vor Stichtag. Verwandte Entzuege werden vorher optional angeboten, ausschliesslich offene und eigene Tasks derselben Person und desselben Systems. Der Sammelabschluss vom Board bleibt ein spaeterer Schritt.
- Automatisierung ist allgemein formuliert und nicht auf Genesys beschraenkt. Erfolg schliesst im Mock ab; bei einem simulierten Fehlschlag bleibt die Aufgabe uebernommen, erneuter Versuch und manuelle Erfassung werden angeboten. Das Kennungsfeld erscheint dort erst bei manueller Erfassung nach dem Fehlschlag. Wiederherstellung eines archivierten Kontos bleibt ein eigener bestaetigter Weg.
- Mail-Vorschau ebenfalls als Schritt im selben Modal; simulierte Beauftragung erzeugt einen Verlaufseintrag, schliesst die Aufgabe aber nicht ab.
- Backend-Anforderungen bleiben offen, einschliesslich Notizen, Freigabekommentar, Namen, Automatisierungsabschluss, Historienberechtigung fuer fremde Tasks und Abschluss aus Offen (das Backend akzeptiert derzeit nur In Bearbeitung). Der produktive Dialog ist unveraendert; die Ursache fehlender gespeicherter Abschlusskommentare muss anhand der tatsaechlichen Log-Antwort separat geklaert werden.

### Modal-Runde 2 (23.10.2026)

- Breiteres Modal mit zwei Bereichen: links Kontext und Bearbeitung, rechts eine eigenstaendig scrollende Zeitleiste. Der linke Aktionsbereich bleibt unten erreichbar; mobil stehen beide Bereiche untereinander.
- Erklaerende Standardtexte (z. B. „Bereit zur Uebernahme“, Uebernahme-Anleitung und allgemeine Bearbeitungshinweise) entfallen. Fachliche Fehler, Account-Entscheidungen und Bestaetigungen vor Stichtag bleiben sichtbar. Buttons sind kraeftiger, Person und wichtige Kontextwerte groesser gesetzt.
- Offene Aufgaben zeigen direkt grosse Uebernahme-/Abschlussaktionen. Bei Uebernahme erscheint ein orange akzentuierter Bearbeitungsblock mit Stift; Abschluss/Mail bekommen einen blauen Block, das Ergebnis einen gruenen mit Haekchen. Ein kurzer Uebergang und gezielter Fokus markieren neue Optionen ohne zusaetzliche Erklaertexte.
- Der Verlauf laeuft chronologisch von oben nach unten, mit Datumstrennern und dem neuesten Eintrag unten. Beim Oeffnen wird zum Ende gescrollt. Eigene Aktionen fuehren zum neuen, kurz hervorgehobenen Eintrag; reine Ansichtswechsel erhalten die Leseposition.
- Statt der letzten drei Eintraege und Aufklappschalter werden zunaechst 20 Eintraege gerendert. Beim Hochscrollen werden automatisch je 20 aeltere ergaenzt, unter Erhalt des sichtbaren Ankers. Ein Sprungknopf fuehrt bei Bedarf zurueck zum neuesten Eintrag. Ein laengerer Beispielverlauf im Mock macht dies pruefbar.
- Im Mock liegt der Verlauf bereits lokal vor; fuer echtes serverseitiges Nachladen wird ein paginierter Log-Vertrag (Cursor fuer aeltere Eintraege und Limit) benoetigt. Die produktive Seite bleibt unveraendert.

### Modal-Runde 3 (23.10.2026)

- Modalhoehe folgt dem Inhalt (`fit-content`) mit einer Maximalhoehe; kurze Aufgaben fuellen nicht mehr die gesamte verfuegbare Hoehe. Lange Inhalte bleiben scrollbar. Der Verlauf ist horizontal schmaler (rund 38 % der Breite).
- Der dynamische Arbeitsbereich liegt ohne Kartenrahmen, Fuellung oder abgerundeten Container direkt auf der Modaloberflaeche. Eine farbige Trennlinie unter den Kontextinfos sowie Icon und Ueberschrift kennzeichnen Bearbeitung, Abschluss und Ergebnis.
- Alle Statusaktionen sitzen unten und nutzen jeweils die volle Breite, primaere Aktion zuerst. Das gilt auch fuer offene Aufgaben und die Abschluss-/Mail-Schritte.
- Die Zeitleistenlinie laeuft ohne Unterbrechung durch Datumsabschnitte und endet in der Mitte des neuesten Punkts, auch bei hervorgehobenen Eintraegen und langen Kommentaren.
- Der Sprung zum neuesten Verlaufseintrag erscheint beim Hochscrollen als runder Chevron-Button unten rechts. Normale und hervorgehobene Timeline-Punkte sind ueber dieselbe Linienbreite exakt zentriert.
- Hintergrund-Schliessen verlangt, dass sowohl Pointer-Druck als auch Loslassen ausserhalb der Modalgrenzen stattfinden. Textauswahl mit anschliessendem Loslassen ausserhalb sowie Klicks auf den Modalrand schliessen nicht; Hintergrundklick, Schliessen-Button und Escape bleiben erhalten.

### Sidepanel-Farbprobe und Timeline-Korrektur (23.10.2026)

- Nur die Hintergrundflaeche hinter den Reitern und der geoeffnete Hauptreiter „Zurueckgestellt“ uebernehmen die blasse Listenfuellung des aktiven Bereichs (4 % Akzent auf Kartenflaeche), die Raender dessen Bereichsfarbe. Der gesamte Inhalt rechts der Reiter behaelt seine bisherige Gestaltung: Liste 4 %, Kopf 11 %, unveraenderte Beschriftungen und Karten. Zugeklappt bleibt der Hauptreiter neutral.
- Die obere 4-px-Kante und die untere 1-px-Kante laufen auch unter den Reitern bis zum linken Bildschirmrand weiter. Die untere Trennkante des Hauptreiters bleibt neutral; seine obere Kante gehoert zum durchgehenden Panelrand.
- Timeline-Punkte nutzen feste Groessen (8 px, hervorgehoben 10 px) ohne prozentuale Transformation, auf einer gemeinsamen 2-px-Achse. Der zuvor trotz rechnerisch gleicher Mittelpunkte sichtbare Rasterversatz ist damit auch im gerenderten Bild beseitigt.

### Mailinhalt im Verlauf (23.10.2026)

- Versandbutton „Mail senden“, Verlaufstext „Per Mail beauftragt“. Ein dezenter Brief-Button am jeweiligen Eintrag klappt Empfaenger, vorhandene CC/BCC, Betreff und Nachricht lesend auf. Ausgabe als Text mit erhaltenen Zeilenumbruechen.
- Der Mock legt pro Beauftragung einen eigenen Snapshot ab; spaetere Entwurfs-Aenderungen veraendern ihn nicht. Die Ansicht versteht auch das vorhandene Backend-Format: JSON in `MAIL_SENT.details`. Fehlen verwertbare Maildaten, wird kein Inhaltsbutton angeboten.
- Befund im SD-API-Checkout: `task_service.send_mail` speichert bereits `json.dumps(payload.model_dump())` im Tasklog, inklusive Empfaenger, Betreff und Body. Queue-Insert und Log entstehen in derselben Transaktion. Der bestehende Verlauf liefert `details` bereits aus; fuer die Inhaltsansicht sind weder neue Tabelle noch neuer Endpunkt erforderlich. Die bisherige Darstellung `comment || details` verdeckt diese Daten durch den Log-Kommentar.
- Kleine Backend-Ergaenzung fuer einen exakten Snapshot: die tatsaechlich normalisierten Queue-Felder einschliesslich automatisch ergaenzter CC und Absender protokollieren, statt nur den urspruenglichen Request. Der bestehende Log belegt die Beauftragung (`queued`), nicht den spaeteren Zustellerfolg. Backend hier nur gelesen, keine Aenderung daran.

### Abschluss im Kontext einer Konto-Aufgabe (Mock, 23.10.2026)

- Mit abgeschlossene Entzuege erhalten einen strukturierten `completion_context` im JSON-Feld `COMPLETED.details`: Grund `ACCOUNT_REVOCATION`, ausloesende Task-ID und Ressourcenname als Snapshot. Die Konto-Aufgabe selbst bekommt keinen Selbstverweis; nicht ausgewaehlte Aufgaben bleiben unberuehrt.
- Timeline und Ergebnisansicht zeigen „Mit Entzug von … erledigt“ als dezenten grauen Statustext. Ein Icon-Button mit Tooltip oeffnet die ausloesende Aufgabe, sofern diese im sichtbaren Datenbestand enthalten ist.
- Der Bearbeiterkommentar bleibt unveraendert im eigenen `comment`-Feld und wird getrennt dargestellt. Vorhandene Verlaufseintraege werden nicht geaendert. Zusaetzliche abgeschlossene Mock-Beispiele zeigen den Zusammenhang bereits beim Oeffnen.
- Nur im Mock umgesetzt. Produktiv reicht eine kleine Erweiterung des Abschluss-Requests um die optionale Ausloeser-ID, deren serverseitige Pruefung und das Speichern des Zusammenhangs im bestehenden Log-JSON. Keine neue Tabelle erforderlich.

### Spaltenbreiten und Freigeben (Mock, 23.10.2026)

- Die drei Board-Spalten wachsen mit dem verfuegbaren Platz bis jeweils 20rem. Die grosszuegigen Zwischenraeume bleiben bei 7,5rem; bei Platzmangel schrumpfen zuerst die Luecken bis 1rem, danach die Spalten bis mindestens 250px. So passt das 224px breite Ansichts-Dropdown samt seitlichem Abstand in die offene Spalte. Wird der Board-Bereich etwa durch das Sidepanel noch schmaler, bleiben alle Spalten ueber horizontales Scrollen erreichbar. Board und Werkzeugleiste bleiben gemeinsam zentriert und in der Breite begrenzt.
- Desktop-Karten bleiben mit maximal 14rem mittig in ihrer Spalte. Auf schmalen Ansichten passen sie sich weiterhin dem verfuegbaren Platz an.
- Freigeben ist im Modal und in der Auswahlleiste rot umrandet und beschriftet, mit dem Tooltip „Zurueck zu den offenen Aufgaben“.

### Später

- **Blockierte Tasks sagen, was blockiert.** In der SD-API entsteht „blockiert“ aus der Ressourcenabhängigkeit (Elternressource derselben Person, z. B. Genesys-Konto vor Genesys-Gruppe; `unblock` bei Abschluss des Eltern-Tasks). Die Karte soll den blockierenden Task nennen (Ressource, Status, ggf. Bearbeiter). Backend-Wunsch: Feld wie `blocked_by` (Task-ID, Ressourcenname, Status) auf blockierten Tasks.

### Backend-Wunschliste (gebündelt, erst nach Design-Abnahme)

Gebündelt und mit dem SD-API-Stand abgeglichen in [backend-request-ui-bundle.md](backend-request-ui-bundle.md) (23.10.2026); die Liste unten ist der Verlauf.

- `GET /sofa/tasks/view`: Felder `assigned_to_user_name`, `assigned_at`, `completed_at`, `process_id`/`process_name`, `system_id`/`system_name`; Parameter `completed_since`; Backlog-Sichtbarkeit serverseitig.
- `integrate_user_in`: bei Erfolg Task abschließen, Log-Text korrigieren.
- Freigeben mit optionalem `comment`; Notiz-Endpunkt (`TaskAction.COMMENTED`); Name statt nur `user_id` in den Logs.
- Verlauf wird immer komplett geladen, keine Paginierung (Entscheidung 23.10.2026). Das Modal rendert weiterhin in Schritten von 20 Eintraegen aus den geladenen Daten. Gewuenscht bleibt nur eine stabile Reihenfolge bei identischen Zeitstempeln.
- Mail-Snapshot im vorhandenen `MAIL_SENT.details` auf die effektiven Queue-Felder erweitern (normalisierte Empfaenger inklusive automatisch ergaenzter CC, Absender); bestehende JSON-Payloads bleiben lesbar. Aufwand klein: in `task_service.send_mail` die zusammengefuehrte CC einmal berechnen und dieselben Werte an `queue_mail` und ins Log geben, dazu ein Test.
- Abschlusskontext zurueckgestellt (Entscheidung 23.10.2026). Bis dahin erhalten mit abgeschlossene Entzuege einen generischen Hinweis ohne Verlinkung der ausloesenden Aufgabe. Er laeuft ohne Backend-Aenderung ueber den Abschlusskommentar. Die strukturierte Variante mit ausloesender Task-ID kommt mit dem Sammelabschluss.

## Echtbetrieb (26.10.2026)

Setzt SD-API Release 2 voraus (Freigeben mit Kommentar, Notiz-Endpunkt, Abschluss nach Integration); erst danach deployen.

- `/tasks` zeigt immer das Board, die alte Aufgabenseite (`tasks.html`, `tasks.js`, `tasks.css`) ist entfernt.
- Datenzugang: `tasks_board_data.js` spricht die SOFA-API, `tasks_board_mock.js` bietet dieselben Funktionen lokal und wird nur mit `?mock=` (Entwicklungsinstanz) geladen. Board und Modal haben damit einen Codepfad.
- Laden: `GET /api/tasks/overview?completed_since=` mit dem Beginn des Erledigt-Zeitraums (Tag, Woche, Monat), alle Listen in einer (`tasksFromOverview`). Neu laden jede Minute bei sichtbarer Seite, beim Zurückkehren in den Tab und nach jeder Aktion. Mehr als 1000 erledigte: Hinweis „Nur die neuesten 1000“.
- Der SOFA-Proxy wendet die Backlog-Regel auf alle fünf Listen an, auch auf die beiden, die die SD-API schon selbst filtert.
- Aktionen: Übernehmen und Sammel-Übernehmen über `bulk-assign`, Freigeben einzeln mit Kommentar über `DELETE …/assign?comment=`, sonst `bulk-release`; Notiz `POST /api/tasks/{id}/comments`; Abschluss `…/complete` (Kennung oder Wiederherstellung); Mail aus `resources/mail_template` und `…/send_mail`; Automatisierung über `tasks/dispatch_bot`. Offene Aufgaben werden vor dem Abschluss übernommen; verwandte Entzüge erst, wenn der Haupt-Task abgeschlossen ist.
- Verlauf: `GET /api/tasks/{id}/history`, immer komplett; `historyEntry` liest `details` (JSON), Systemeinträge (Erstellt, Automatisierung, Voraussetzung erfüllt) stehen ohne Bearbeiter. Mail-Snapshot, Account-Kennung des Abschlusses und eine gescheiterte Automatisierung (jüngster `BOT_RESPONSE` mit `status: error`) kommen aus dem Verlauf (`historyFacts`).
- Dev hat derzeit keine Aufgaben in der Datenbank; geprüft sind die Abläufe im Mock und das Laden gegen die echte Dev-API.

## Offene Fragen für das Brainstorming

1. **Spalten.** Welche? Naheliegend: Offen / In Bearbeitung / Erledigt. Muss aus den echten Task-Status des Backends abgeleitet werden; was ist mit blockierten, nachgelagerten (`DEFERRED`) und fehlgeschlagenen Tasks?
2. **Pro Spalte Gruppierung und Sortierung.** Vorschlag zum Diskutieren: Offen nach Priorität/Fälligkeit, In Bearbeitung nach Bearbeiter (eigene zuerst), Erledigt nach Abschlusszeit absteigend und zeitlich begrenzt.
3. **Fremde Tasks.** Backlog-Sichtbarkeit braucht eine Backend-Aussage: Liefert `tasks/overview` künftig auch fremde Tasks des Backlogs, oder gibt es eine eigene Abfrage? Welche Aktionen sind an fremden Tasks erlaubt (vermutlich keine)? Anfrage an das Backend steht in [backend-request-kanban-visibility.md](backend-request-kanban-visibility.md).
4. **Eigene Tasks.** Bleibt der Unterschied zwischen „Offen“ und „Meine“ als Filter, oder ergibt er sich aus der Gruppierung?
5. **Bestehende Funktionen.** Sammelaktionen (Bulk), Filter, Gruppierung nach Prozess/System: wohin in der Kanban-Ansicht? Die vorhandenen Gruppierungen dürfen nicht verloren gehen.
6. **Mengen.** Wie viele Tasks pro Spalte sind realistisch? Ab wann braucht eine Spalte Begrenzung oder „weitere“?
7. **Mobil.** Spalten als umschaltbare Streifen oder untereinander?
8. **Ausgegraut.** Nur Optik, oder auch eingeklappt? Barrierefreiheit: Grau allein reicht nicht, ein Bearbeitername steht ohnehin als Gruppenkopf.
9. **Aktualisierung.** Fremde Fortschritte sollen mitverfolgt werden können; reicht Neuladen, oder braucht es periodisches Nachladen wie beim Genesys-Live-Report?

## Regeln

Knappe UI-Texte (keine erklärenden Untertitel), deckende Flächen ohne Transparenz. Layout-Technik mit getrennt scrollenden Bereichen kann aus dem Workspace-Umbau übernommen werden.

### Karten-Raster, Farben und Prozessnamen (23.10.2026)

- Spalten wachsen stufenlos mit dem Fenster und sind immer gleich breit; die Karten füllen die Spaltenbreite. Die Zahl der Karten je Zeile gilt fürs ganze Board (alle Spalten gleich): zwei ab 101,6rem, drei ab 145,6rem Board-Breite (Container-Abfrage auf `.tb-main`). Die Schwellen sind so gewählt, dass keine Karte schmaler als 14rem wird; dafür schrumpfen die Lücken zwischen den Spalten kurz nach der Schwelle bis 4rem. `scrollbar-gutter: stable` hält die Innenbreite aller Spalten gleich. Mobil und in der Leiste immer eine Karte.
- Karten in Bearbeitung zeigen „seit … in Bearbeitung“.
- Spaltenköpfe gleich hoch: Der Zeitraum-Umschalter unter „Erledigt“ steht kompakt rechts neben dem Titel und bricht nur bei Platzmangel um (vom Nutzer bestätigt).
- Globale Statusfarben: Grau = blockiert, Lila = nachgelagert (`--ui-status-blocked-*`, `--ui-status-deferred-*` in `ui.css`). Gilt auch für die bisherige Aufgabenseite.
- Prozesstyp `CHANGE` heißt überall „Abteilungswechsel“; die Namen stehen einmal in `SofaContract.PROCESS_TYPE_LABELS`.
- Spalten-Mindestbreite 18rem: Der Kopf von „Erledigt“ (Titel, dreistelliger Zähler, Heute/Woche/Monat) braucht rund 285 px und bricht nicht mehr um (`flex-wrap: nowrap`).
- Prozessgruppen unter „Offen“ zeigen rechts eine graue Schloss-Pille mit der Zahl blockierter Tasks desselben Prozesses (gezählt mit den aktiven Filtern, ohne Suche). Ein Klick setzt die Suche auf `#<Prozess-ID>`, klappt die Gruppe auf und öffnet das Sidepanel auf „Blockiert“. Die Suche nach `#<Zahl>` trifft genau diese Prozess-ID (`#71` findet nicht `#712`) und filtert wie jede Suche das ganze Board.
