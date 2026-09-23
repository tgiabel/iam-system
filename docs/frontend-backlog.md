# Frontend Backlog

Tracks UI/component follow-ups that were identified but deliberately deferred.

## User detail: derived status list could grow long

`renderDerivedStatuses()` in `app/static/js/userverwaltung.js` (~line 1456) renders
`#user-derived-status-list` (in `userverwaltung.html`) with all of a user's derived
statuses. With many ongoing processes this list can get long. Preferred fix is a
simple scrollable container (`max-height` + `overflow-y: auto`), not the
expand/modal pattern used for the calendar.

## Duplicated "+x weitere" text-preview helper

Three near-identical helpers build a "name1, name2 +N weitere" preview string with a
tooltip listing all items:
- `app/static/js/systemverwaltung.js` — `getResourcePreview()` / `getRolePreview()`
- `app/static/js/rollenmanagement.js` — `getPreview()`
- `app/static/js/userverwaltung.js` — derived-status badge "+N weitere Status" count

Candidate for consolidation into a single shared utility (likely `base.js`). This is
a different (non-interactive, text + tooltip) pattern from the calendar's
"+ N weitere → modal" interaction — keep them separate, don't conflate.

## Console process tables could reuse the calendar's "+N weitere" → modal pattern

`renderProcessTable()` in `app/static/js/console.js` (running/completed processes on
the Konsole page) currently renders all rows unconditionally. If these lists grow
large, they could reuse the same "show first N, + N weitere opens a modal with the
rest" pattern introduced for the weekly calendar (`renderDayEvents()` +
`#console-calendar-day-modal`).

## Filterleiste existiert dreimal

Die Aufgabenseite nutzt jetzt die geteilte Komponente `.ui-filter-*` in
`app/static/css/ui.css` (Icon-Dropdown, Include/Exclude-Subfilter, wegklickbare
Badges). Zwei ältere Kopien desselben Musters stehen weiterhin daneben:

- `app/static/css/userverwaltung.css` — `.users-filter-*` / `.users-subfilter-*`,
  funktional identisch, inklusive Include/Exclude-Logik in
  `app/static/js/userverwaltung.js` (`toggleOptionFilter()`, `renderActiveTags()`).
- `app/static/css/rechnerverwaltung.css` — `.computers-filter-tag`, eine
  einfachere Variante ohne Include/Exclude.

Eine Migration der Userverwaltung auf `.ui-filter-*` wäre der nächste sinnvolle
Schritt, wurde hier aber bewusst nicht mitgemacht: die Datei ist groß, die
Änderung rein kosmetisch und ohne funktionalen Gewinn. Die Include/Exclude-Logik
selbst liegt inzwischen generisch und getestet in
`app/static/js/task_view_model.js` (`toggleFacetValue()`, `matchesFacet()`) und
kann bei einer Migration von dort bezogen werden.
