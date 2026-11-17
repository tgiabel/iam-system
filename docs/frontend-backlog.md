# Frontend Backlog

Tracks UI/component follow-ups that were identified but deliberately deferred.

## User detail: derived status list could grow long

`renderDerivedStatuses()` in `app/static/js/user_actions.js` (~line 1229) renders
`#user-derived-status-list` (in `admin/user_actions.html`) with all of a user's derived
statuses. With many ongoing processes this list can get long. Preferred fix is a
simple scrollable container (`max-height` + `overflow-y: auto`), not the
expand/modal pattern used for the calendar.

## Console process tables could reuse the calendar's "+N weitere" → modal pattern

`renderProcessTable()` in `app/static/js/console.js` (running/completed processes on
the Konsole page) currently renders all rows unconditionally. If these lists grow
large, they could reuse the same "show first N, + N weitere opens a modal with the
rest" pattern introduced for the weekly calendar (`renderDayEvents()` +
`#console-calendar-day-modal`).

## Filterleiste existiert zweimal

Die Aufgabenseite nutzt jetzt die geteilte Komponente `.ui-filter-*` in
`app/static/css/ui.css` (Icon-Dropdown, Include/Exclude-Subfilter, wegklickbare
Badges). Die Verwaltungsseiten (Userverwaltung, Rollenmanagement, Systemverwaltung)
nutzen seit November 2026 die Listenbausteine aus `list_page.js` (`SofaList`: Filter
mit drei Zuständen im Popover, entfernbare Marken); die alte Kopie
`.users-filter-*` / `.users-subfilter-*` ist mit `userverwaltung.css` entfallen.
Daneben steht noch:

- `app/static/css/rechnerverwaltung.css` — `.computers-filter-tag`, eine
  einfachere Variante ohne Include/Exclude.

Die Include/Exclude-Logik liegt generisch und getestet in
`app/static/js/task_view_model.js` (`toggleFacetValue()`, `matchesFacet()`) und in
`app/static/js/list_page.js` (`cycleFacet()`, `matchesFacet()`).
