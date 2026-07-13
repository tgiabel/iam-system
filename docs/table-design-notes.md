# Table design notes (working doc toward a centralized table component)

Snapshot from the IVR report build (2026-06). Two independent page-scoped table implementations now exist with near-identical visual intent but separately declared CSS. This is a reference for whoever centralizes table styling next — not a change in itself.

## Current state

### 1. Userverwaltung — `app/templates/userverwaltung.html` + `app/static/css/userverwaltung.css`
- Links only `ui.css` + `userverwaltung.css`. Its table look is fully self-contained in page-scoped rules — it does **not** use `app/static/css/page_w_table.css`.
- Structure: `<section class="ui-card users-table-card"><div class="table-wrapper"><table id="user-table">...`
- Key selectors: `.users-table-card .table-wrapper` (strips generic shadow/radius, sets `max-height: 65vh` + scroll), `#user-table` (width/min-width/border-collapse — note: **id selector**, not reusable), `.users-table-card thead th` (sticky, `var(--table-header-bg)` / `var(--text-inverse)`, uppercase, `1rem` padding, `0.06em` letter-spacing), `.users-table-card tbody td` (`1rem` padding, `color-mix(...)` border-bottom, `var(--ui-text)`), `.users-table-row:hover` (`rgba(var(--color-primary-rgb), 0.04)`), `.users-empty-row td { padding: 0 }` + inner `.ui-empty-state.ui-empty-inline`.

### 2. IVR Report — `app/templates/reports/ivr_report.html` + `app/static/css/ivr_report.css`
- Links only `ivr_report.css` (no `tools.css`, no `page_w_table.css`) — `ui.css`/`_.css` are already global via `base.html`.
- Structure: `<div class="ivr-report-table-card"><div class="table-wrapper"><table class="ivr-report-table">...` — deliberately **not** wrapped in `.ui-card` (this report's table sits directly on the page, no card chrome).
- Mirrors userverwaltung's values 1:1 where applicable: `.ivr-report-table-card .table-wrapper`, `.ivr-report-table thead th`, `.ivr-report-table tbody td`, `.ivr-report-table tbody tr:hover`, `.ivr-report-empty-row` + `.ui-empty-state.ui-empty-inline`.
- New, page-specific (no userverwaltung equivalent yet): `.ivr-report-sortable` / `.ivr-report-sort-indicator` (clickable/keyboard-accessible sort header) — candidate to promote into a shared component once a second table needs sorting.

## Duplication map (candidates for a shared component)

| Purpose | `userverwaltung.css` | `ivr_report.css` | Note |
|---|---|---|---|
| Card-scoped wrapper override | `.users-table-card .table-wrapper` | `.ivr-report-table-card .table-wrapper` | Same properties; one wraps a `.ui-card`, the other doesn't — the override itself is identical either way |
| Table sizing | `#user-table` | `.ivr-report-table` | userverwaltung uses an **id** selector here; should switch to a class to be reusable |
| Sticky header | `.users-table-card thead th` | `.ivr-report-table thead th` | Identical values (padding, sticky/z-index, color/bg, uppercase, letter-spacing) |
| Row hover | `.users-table-row:hover` | `.ivr-report-table tbody tr:hover` | Identical `rgba(var(--color-primary-rgb), 0.04)` |
| Empty/loading row | `.users-empty-row` | `.ivr-report-empty-row` | Same intended pattern: `<tr class="...-empty-row"><td colspan="N"><div class="ui-empty-state ui-empty-inline">...</div></td></tr>` |
| Sortable header | — | `.ivr-report-sortable` / `.ivr-report-sort-indicator` | IVR-only for now |

### Known pre-existing quirk (not fixed here, just noted)
In both files, the empty/loading row's `<td>` rule (`.users-empty-row td` / `.ivr-report-empty-row td`) has **lower CSS specificity** than the generic `<tbody td>` padding rule it's meant to override (`.users-table-card tbody td` / `.ivr-report-table tbody td`), since the generic rule has one more type selector in its specificity tuple. In practice this is harmless for `padding` because the inner `.ui-empty-state.ui-empty-inline` div supplies its own padding, so the outer `td`'s padding losing the override just adds a bit of extra whitespace, not a visible break. **Exception:** for the IVR report, the same specificity gap would have broken `white-space: normal` on the empty-state cell (the generic rule's `white-space: nowrap` would force the German empty-state sentence onto one line and overflow), so `ivr_report.css` raises that one rule's specificity explicitly: `.ivr-report-table tbody tr.ivr-report-empty-row td`. Whoever centralizes this should just give the empty-row override enough specificity from the start (e.g. qualify it with the table's own class, as done here) rather than relying on a bare two-class selector.

## `app/static/css/page_w_table.css` — not the real base, don't build on it
Despite its name and a `/* 3. TABLE DESIGN */` comment block with bare `table`/`thead`/`tbody tr`/`tbody td` selectors, this file is **not actually linked by `userverwaltung.html`** (confirmed) and isn't the source of either table's current look. It also has internal duplication/legacy cruft unrelated to tables — `.top-bar` and `.sidebar` are each declared twice in the same file with different, partially conflicting properties. Its bare unscoped element selectors (`table`, `thead`, `tbody tr`, `tbody td`, no class qualifier) would apply to *every* table on any page that imports it, which is risky to adopt as-is. Recommend retiring or rewriting this file rather than treating it as the shared base.

## Recommendation
Introduce one shared class pair (e.g. `.app-table-card` + `.app-table-card .table-wrapper`, plus `.app-table` for the `<table>` itself) in a small, dedicated, well-scoped file. Have both `userverwaltung.css` and `ivr_report.css` adopt it (replacing `.users-table-card`/`#user-table` and `.ivr-report-table-card`/`.ivr-report-table` respectively), and keep only genuinely page-specific extras — inactive-row tinting (`users`), sortable headers (`ivr_report`) — as additive page-scoped classes layered on top.
