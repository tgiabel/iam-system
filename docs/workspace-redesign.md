# Workspace-Umbau

Plan vom 14.10.2026. Teil 1 von drei UI-Aufwertungen; Tasks siehe [tasks-kanban.md](tasks-kanban.md), Dashboard siehe [dashboard-redesign.md](dashboard-redesign.md).

## Stand

Umgesetzt am 14.10.2026 auf `feature/workspace-layout` (W1–W4). Gegenüber dem ursprünglichen Plan geändert: Einträge sind Zeilen in einer Liste je Spalte statt Karten; Beschreibung nur als Tooltip, keine Badges und Kicker; die Pin-Zeile ist ein zentriertes Dock mit quadratischen Kacheln (Pin oben rechts, Pop-out unten rechts, Titel unten angedockt); Spaltenköpfe mit farbiger Trennlinie (Tools blau, Reports orange).

Adressen: Die Übersicht liegt unter `/workspace`, Tools unter `/tools/…`, Reports unter `/reports/…`. Die alten Pfade (`/tools`, `/tools/<report>`, `/iks`) leiten mit 307 samt Query-String weiter. Die Weiterleitung ist bewusst temporär, damit nach einem Rollback keine gemerkte Umleitung ins Leere zeigt. Templates und JS der Reports bleiben in ihren bisherigen Ordnern.

## Ziel

Tools und Reports stehen gleichzeitig auf einer Seite, ohne Tab-Wechsel. Bis zu vier Einträge lassen sich anheften; sie stehen in ihrer Liste oben und sind die Grundlage für die spätere Pinnwand im Dashboard.

## Ausgangslage

- `app/templates/tools.html` enthält elf handkopierte Karten. Zwei Reports (Genesys Cloud Live, Meine Genesys-Zahlen) haben keinen Pop-out-Button, Genesys Cloud Live auch keinen Beschreibungstext; die IKS-Karte ist anders eingerückt. Das sind Abweichungen vom Kartenmuster, die bei Handkopien entstehen.
- Die Karte ist ein `<a>`, der Pop-out ein `<button>` darin (ungültiges HTML, `tools.js` muss das Klickereignis unterdrücken).
- Der aktive Tab liegt nur im Server-Zustand (`show_tools`) und wird nicht gemerkt.
- `tools.js` kennt nur Tabs und Pop-out.
- Das Dashboard hat bereits eine statische „Pinnwand“ mit drei fest verdrahteten Einträgen und einer deaktivierten Kachel „Neues Element“ (`dashboard.html`, `.dashboard-pin-*` in `dashboard.css`). Sie wird im Dashboard-Lauf durch die echten Pins ersetzt.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Layout | Oben die Pin-Zeile, darunter zwei Spalten, links Tools, rechts Reports. Jede Spalte scrollt für sich, die Seite nicht. Technik wie `genesys_live.css`: `body:has(...)` auf `100dvh`, `overflow: hidden`, Footer aus. |
| Kartenraster | Vier Karten pro Zeile über die ganze Seite: Pin-Zeile vier nebeneinander, Tools- und Reports-Spalte je zwei Kartenspalten. Gemeinsames 4-Spalten-Raster, damit alle Karten gleich breit sind. |
| Schmal (bis 800 px) | Spalten untereinander, normaler Seitenscroll. |
| Leere Spalte | Hat der Nutzer keine Tools oder keine Reports, entfällt die Spalte; die andere nutzt die Breite (mit Maximalbreite). |
| Tabs | Entfallen samt `show_tools` und Tab-Code in `tools.js`. |
| Pins | Höchstens 4 insgesamt über Tools und Reports. Gespeichert wird eine geordnete Liste von Katalog-IDs (älteste zuerst) im `localStorage`, kein Backend. |
| Pin-Schlüssel | `sofa.workspace.pins.v1.<user_id>`. Pro Nutzer, weil mehrere Personen denselben Browser nutzen können. |
| Sortierung | Die Tools- und Reports-Spalten behalten ihre feste Katalogreihenfolge, es gibt keine Umsortierung. Angeheftete Karten stehen dort weiter, mit gefülltem Pin, und erscheinen zusätzlich in der Pin-Zeile (Reihenfolge = Anheftreihenfolge). |
| Pin-Zeile | Immer sichtbar, aber dezent. Vier Plätze: belegte zeigen die kompakte Karte (Icon, Kicker, Titel, Pin, Pop-out; ohne Chips und Beschreibung), freie sind graue Platzhalter. Daneben ein Info-Icon: angeheftete Tools und Reports erscheinen im Dashboard, es sind 4 möglich. Ohne Pins bleibt nur ein schmaler Streifen mit vier freien Plätzen; so ist die Funktion auffindbar. |
| Limit erreicht | Pin-Buttons bleiben immer klickbar. Bei vier belegten Plätzen wird der älteste Pin ersetzt. Erneuter Klick auf einen angehefteten Eintrag löst den Pin. |
| Verwaiste Pins | IDs, die der Nutzer nicht mehr sieht (Recht entzogen), werden beim Laden verworfen und zählen nicht. |
| Vorbereitung fürs Dashboard | Die Pin-Zeile ist die Vorschau der späteren Pinnwand. Angeheftete Karten in den Spalten tragen ein gefülltes Pin-Symbol. Keine weiteren Erklärtexte neben dem Info-Icon. |
| Karten-Pflichtbestandteile | Alle Karten kommen aus einem Template: Icon, Chips, Kicker, Titel, Beschreibung, Fußzeile mit „öffnen“, Pin und Pop-out unten rechts. Die Beschreibung ist Pflicht (Genesys Cloud Live bekommt eine). |
| Pop-out | Bei allen Karten, auch bei Genesys Cloud Live und Meine Genesys-Zahlen. Muss in der Widget-Ansicht (`?view=widget`) geprüft werden. |

## Umsetzung

### W1 – Katalog und gemeinsames Kartentemplate

- `app/workspace_catalog.py`: Liste der Einträge mit `id`, `kind` (`tool`/`report`), `href`, `icon`, `chips`, `kicker`, `title`, `copy` und der Sichtbarkeitsbedingung (Recht, Admin, Genesys-Report konfiguriert). Eine Funktion liefert die für einen Nutzer sichtbaren Einträge je Art.
- Makro `workspace_card` (z. B. `app/templates/_macros/workspace.html`), von beiden Spalten genutzt. Die Karte ist ein `<article>` mit gestrecktem Hauptlink (`::after`), Pin- und Pop-out-Button sind Geschwister des Links, nicht darin.
- `tools.html` schrumpft auf zwei Schleifen. Die Route `/tools` gibt die Listen statt `show_tools` und `agent_stats_configured` weiter.
- Test: jede Karte hat Pin, Pop-out, Beschreibung und eine eindeutige ID; Sichtbarkeit je Rechtekombination (Tool-Nutzer, Report-Nutzer, Admin, ohne Genesys-Secret).

### W2 – Zweispaltiges Layout

- Neue CSS-Regeln in `tools_overview.css`; Tabs und `.overview-panel` entfallen.
- Gemeinsames Raster mit vier Spalten; Pin-Zeile über alle vier, Tools und Reports über je zwei. Unter 1100 px 2 Spalten pro Bereich, unter 800 px untereinander. Hat der Nutzer nur Tools oder nur Reports, nimmt der Bereich alle vier Spalten.
- `min-height: 18rem` fällt weg, damit die Spalten mehr Einträge zeigen. Beschreibung auf zwei Zeilen begrenzen.
- Der Hover-Hub (`translateY(-3px)`) wird in einem Scrollcontainer oben abgeschnitten; die Spalte bekommt dafür oben und seitlich Innenabstand.
- `scrollbar-gutter: stable` pro Spalte, damit nichts springt.
- Kein Seitenscroll prüfen: bei 1366×768, 1920×1080 und mit sehr vielen Einträgen als Admin.

### W3 – Pins

- Neues Modul `app/static/js/workspace_pins.js` ohne DOM-Zugriff in den Kernfunktionen: `load(userId, visibleIds)`, `toggle(list, id, max)` (löst oder setzt; bei vollem Limit fällt der älteste heraus), `save(userId, list)`. Alle `localStorage`-Zugriffe in try/catch (kann leer sein oder werfen); ohne Speicher funktioniert die Seite, nur ohne Merken.
- Das Modul wird später vom Dashboard wiederverwendet, daher kein Workspace-spezifischer Code darin.
- `storage`-Ereignis hält zwei offene Tabs synchron.
- `tools.js` füllt die Pin-Zeile (Karten aus `<template>`-Klonen der Katalogkarten in kompakter Form) und setzt `aria-pressed` an den Pin-Buttons. Die Spalten werden nicht umsortiert.
- Die Nutzer-ID kommt als `data-user-id` am Seitencontainer.
- Test: Node-Check wie `genesys_live_checks.js` (Ersetzen des ältesten Pins, Entfernen, verwaiste IDs, kaputtes JSON, blockierter Speicher), eingebunden über einen Python-Test.

### W4 – Abschluss

- Alle drei Themes (auch Servodata-Theme mit Hintergrundbild) und deckende Flächen prüfen.
- Widget-Ansicht jeder Karte prüfen, vor allem Genesys Cloud Live und Meine Genesys-Zahlen.
- Tastaturbedienung: Pin und Pop-out erreichbar, sichtbarer Fokus, `aria-label` mit Kartentitel.
- Playwright-Sichtprüfung mit den Dev-Daten, `docs/` kurz ergänzen.

## Katalog-Daten fürs Dashboard

Pins liegen im Browser, der Katalog auf dem Server. Damit das Dashboard die angehefteten Einträge anzeigen kann, braucht es den Katalog im Browser: entweder als `<script type="application/json">` im Dashboard-Template oder über eine kleine Route. Das wird im Dashboard-Lauf entschieden; der Katalog in W1 wird nur so geschnitten, dass er serialisierbar ist (keine Funktionen in den Einträgen, Sichtbarkeit wird vorher aufgelöst).

## Nicht Teil dieses Laufs

- Dashboard-Pinnwand (Dashboard-Lauf).
- Drag-and-drop-Reihenfolge der Pins.
- Pins in der Datenbank oder geräteübergreifend.
- Suche oder Filter in der Workspace-Liste; bei der aktuellen Anzahl nicht nötig.
