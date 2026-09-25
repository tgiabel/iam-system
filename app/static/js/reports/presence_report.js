// Presence-Report: Tagesansicht mit Pseudonymen. Klarname und Einzeldatensätze gibt es nur je Zeile
// über das Menü „⋯“, jeweils als eigener Abruf, den die SD-API protokolliert.
(function () {
    "use strict";

    const Model = window.PresenceReportModel;
    const API = "/api/reporting/presence";
    const HIDDEN_KEY = "presenceReport.hiddenStatuses.";
    const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';

    const url = Model.readUrl(window.location.search);
    const state = {
        day: url.day,
        source: url.source,
        calendar: {today: null, yesterday: null, firstDay: null},
        report: null,
        loading: false,
        error: null,
        query: "",
        sortKey: Model.LOGGED,
        sortDir: "desc",
        names: {},        // Pseudonym → Klarname, nur bis Neuladen oder Tageswechsel
        details: {},      // Pseudonym → {loading, records, error}
        expanded: new Set(),
        menuFor: null,
        requestId: 0,
        hidden: {},       // Quelle → ausgeblendete Status
    };

    const $ = (id) => document.getElementById(id);
    const dom = {
        reload: $("prReload"), loadedAt: $("prLoadedAt"), kpis: $("prKpis"), days: $("prDays"),
        source: $("prSource"), search: $("prSearch"), columnsBtn: $("prColumnsBtn"), columnsMenu: $("prColumnsMenu"),
        count: $("prCount"), exportLink: $("prExport"), head: $("prHead"), body: $("prBody"), rowMenu: $("prRowMenu"),
    };
    state.hidden = {genesys: storedHidden("genesys"), opcyc: storedHidden("opcyc")};
    const picker = window.DayPicker.mount(dom.days, (day) => {
        state.day = day;
        load({keepNames: false});
    });

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => (
            {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[char]));
    }

    function pluralize(count, singular, plural) {
        return `${count} ${count === 1 ? singular : plural}`;
    }

    // --- Laden -------------------------------------------------------------------------------

    async function api(path) {
        const response = await fetch(API + path, {headers: {Accept: "application/json"}, credentials: "same-origin"});
        let body = null;
        try {
            body = await response.json();
        } catch (_) { /* Fehlerantwort ohne JSON */ }
        if (!response.ok) {
            const detail = body && body.detail;
            const message = (detail && detail.message) || (typeof detail === "string" && detail)
                || (response.status === 403 ? "Keine Berechtigung." : `Laden fehlgeschlagen (HTTP ${response.status}).`);
            throw new Error(message);
        }
        return body;
    }

    // Namen gelten für die Pseudonyme eines Tages; beim Wechsel der Quelle bleiben sie stehen.
    async function load({keepNames}) {
        const requestId = ++state.requestId;
        state.loading = true;
        state.error = null;
        state.details = {};
        state.expanded = new Set();
        if (!keepNames) state.names = {};
        closeRowMenu();
        render();
        const params = new URLSearchParams({source: state.source});
        if (state.day) params.set("day", state.day);
        try {
            const report = await api(`/day?${params}`);
            if (requestId !== state.requestId) return;
            state.report = report;
            state.day = report.day;
            state.calendar = {today: report.today, yesterday: report.yesterday, firstDay: report.first_day};
        } catch (error) {
            if (requestId !== state.requestId) return;
            // Unbrauchbarer Tag aus der URL und noch kein Kalender: einmal mit heute versuchen.
            if (state.day && !state.calendar.today) {
                state.day = null;
                load({keepNames});
                return;
            }
            state.report = null;
            state.error = error.message;
        }
        state.loading = false;
        const query = Model.writeUrl(state.day, state.calendar.today, state.source);
        window.history.replaceState(null, "", window.location.pathname + query);
        render();
    }

    async function revealName(pseudonym) {
        const day = state.day;
        try {
            const body = await api(`/day/${day}/users/${encodeURIComponent(pseudonym)}/name`);
            if (day !== state.day) return;
            state.names[pseudonym] = body.name || "ohne Namen";
            renderTable();
        } catch (error) {
            showFlash(error.message, "failure");
        }
    }

    async function toggleDetails(pseudonym) {
        if (state.expanded.has(pseudonym)) {
            state.expanded.delete(pseudonym);
            renderTable();
            return;
        }
        state.expanded.add(pseudonym);
        if (!state.details[pseudonym] || state.details[pseudonym].error) {
            const {day, source} = state;
            state.details[pseudonym] = {loading: true};
            renderTable();
            try {
                const body = await api(`/day/${day}/users/${encodeURIComponent(pseudonym)}?source=${source}`);
                if (day !== state.day || source !== state.source) return;
                state.details[pseudonym] = {records: body.records};
            } catch (error) {
                if (day !== state.day || source !== state.source) return;
                state.details[pseudonym] = {error: error.message};
            }
        }
        renderTable();
    }

    // --- Spaltenwahl (im Browser gemerkt, je Quelle) -------------------------------------------

    function storedHidden(source) {
        try {
            const keys = JSON.parse(window.localStorage.getItem(HIDDEN_KEY + source) || "[]");
            return Array.isArray(keys) ? keys : [];
        } catch (_) {
            return [];
        }
    }

    function setHidden(keys) {
        state.hidden[state.source] = keys;
        try {
            window.localStorage.setItem(HIDDEN_KEY + state.source, JSON.stringify(keys));
        } catch (_) { /* ohne Speicher gilt die Wahl nur bis zum Neuladen der Seite */ }
    }

    function currentHidden() {
        return state.hidden[state.source];
    }

    // --- Zeichnen ----------------------------------------------------------------------------

    function render() {
        picker.render({day: state.day, ...state.calendar});
        dom.source.querySelectorAll("[data-source]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.source === state.source));
        });
        const asOf = state.report && state.report.data_as_of;
        dom.loadedAt.textContent = asOf
            ? `Stand ${new Date(asOf).toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin"})}`
            : "";
        dom.reload.disabled = state.loading;
        renderKpis();
        renderColumnsMenu();
        renderTable();
    }

    function statuses() {
        return state.report ? Model.visibleStatuses(state.report.statuses, currentHidden()) : [];
    }

    function renderKpis() {
        const report = state.report;
        if (!report || state.loading) {
            dom.kpis.innerHTML = "";
            dom.kpis.setAttribute("aria-busy", String(state.loading));
            return;
        }
        dom.kpis.setAttribute("aria-busy", "false");
        const cards = [`<div class="pr-kpi is-total"><span class="pr-kpi-value">${report.users.length}</span>`
            + `<span class="pr-kpi-label">Mitarbeiter</span></div>`];
        statuses().forEach((status) => {
            const total = report.totals[status.key];
            cards.push(`<div class="pr-kpi" title="${escapeHtml(status.label)}">`
                + `<span class="pr-kpi-value">${escapeHtml(Model.formatSpan(total.seconds))}</span>`
                + `<span class="pr-kpi-label">${escapeHtml(status.label)}</span>`
                + `<span class="pr-kpi-meta">${total.count}× · ${pluralize(total.users, "Mitarbeiter", "Mitarbeiter")}</span></div>`);
        });
        dom.kpis.innerHTML = cards.join("");
    }

    function renderColumnsMenu() {
        const all = state.report ? state.report.statuses : [];
        const hidden = currentHidden();
        dom.columnsBtn.disabled = !all.length;
        dom.columnsMenu.innerHTML = all.map((status) => (
            `<label class="pr-column-option"><input type="checkbox" data-status="${escapeHtml(status.key)}"`
            + `${hidden.includes(status.key) ? "" : " checked"}> <span>${escapeHtml(status.label)}</span></label>`
        )).join("");
    }

    function canAct(pseudonym) {
        const report = state.report;
        return report.can_view_details || (report.can_view_name && !state.names[pseudonym]);
    }

    function sortButton(key, label) {
        const active = state.sortKey === key;
        const indicator = active ? (state.sortDir === "asc" ? "↑" : "↓") : "";
        return `<button type="button" class="ui-table-sort-button${active ? " is-active" : ""}" data-sort="${escapeHtml(key)}"`
            + ` aria-sort="${active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none"}">`
            + `${escapeHtml(label)} <span data-sort-indicator>${indicator}</span></button>`;
    }

    function renderTable() {
        const report = state.report;
        const visible = statuses();
        const actions = Boolean(report && (report.can_view_name || report.can_view_details));
        dom.head.innerHTML = `<tr><th class="pr-col-name">${sortButton(Model.NAME, "Mitarbeiter")}</th>`
            + `<th>${sortButton(Model.LOGGED, "Logzeit")}</th>`
            + visible.map((status) => `<th>${sortButton(status.key, status.label)}</th>`).join("")
            + (actions ? '<th class="pr-col-actions"><span class="pr-sr-only">Aktionen</span></th>' : "")
            + "</tr>";
        const columns = 2 + visible.length + (actions ? 1 : 0);

        const rows = report ? Model.rows(report.users, state) : [];
        dom.count.textContent = pluralize(rows.length, "Mitarbeiter", "Mitarbeiter");
        const exportable = Boolean(report && report.users.length && !state.loading);
        dom.exportLink.href = exportable ? Model.exportUrl(state.day, state.source) : "#";
        dom.exportLink.setAttribute("aria-disabled", String(!exportable));
        dom.exportLink.tabIndex = exportable ? 0 : -1;

        let message = null;
        if (state.loading) message = "Wird geladen…";
        else if (state.error) message = state.error;
        else if (!report || !report.users.length) message = "Keine Daten";
        else if (!rows.length) message = "Keine Treffer";
        if (message) {
            dom.body.innerHTML = `<tr><td colspan="${columns}"><div class="ui-empty-state ui-empty-inline`
                + `${state.error ? " pr-error" : ""}">${escapeHtml(message)}</div></td></tr>`;
            return;
        }
        dom.body.innerHTML = rows.map((user) => rowHtml(user, visible, actions, columns)).join("");
    }

    function rowHtml(user, visible, actions, columns) {
        const name = state.names[user.pseudonym];
        const expanded = state.expanded.has(user.pseudonym);
        const identity = name
            ? `<span class="pr-name">${escapeHtml(name)}</span><span class="pr-pseudonym">${escapeHtml(user.pseudonym)}</span>`
            : `<span class="pr-name">${escapeHtml(user.pseudonym)}</span>`;
        const cells = visible.map((status) => {
            const cell = user.statuses[status.key];
            if (!cell) return '<td class="pr-cell is-empty">–</td>';
            const count = [`${cell.count}×`];
            if (cell.running) count.push(`+${cell.running} läuft`);
            return `<td class="pr-cell${cell.open ? " is-open" : ""}"${cell.open ? ' title="dauert an"' : ""}>`
                + `<span class="pr-duration">${Model.formatDuration(cell.seconds)}</span>`
                + `<span class="pr-count">${escapeHtml(count.join(" · "))}</span></td>`;
        }).join("");
        const menu = actions
            ? `<td class="pr-col-actions">${canAct(user.pseudonym)
                ? `<button type="button" class="pr-menu-btn" data-menu="${escapeHtml(user.pseudonym)}" aria-haspopup="menu"`
                  + ` aria-expanded="${state.menuFor === user.pseudonym}" aria-label="Aktionen für ${escapeHtml(user.pseudonym)}">${DOTS}</button>`
                : ""}</td>`
            : "";
        let html = `<tr class="pr-row${expanded ? " is-expanded" : ""}" data-pseudonym="${escapeHtml(user.pseudonym)}">`
            + `<td class="pr-col-name">${identity}</td>`
            + `<td class="pr-cell pr-logged"><span class="pr-duration">${Model.formatDuration(user.logged_seconds)}</span></td>`
            + cells + menu + "</tr>";
        if (expanded) {
            html += `<tr class="pr-detail-row"><td colspan="${columns}">${detailHtml(state.details[user.pseudonym])}</td></tr>`;
        }
        return html;
    }

    function detailHtml(detail) {
        if (!detail || detail.loading) return '<div class="pr-detail pr-detail-note">Wird geladen…</div>';
        if (detail.error) return `<div class="pr-detail pr-detail-note pr-error">${escapeHtml(detail.error)}</div>`;
        if (!detail.records.length) {
            return `<div class="pr-detail pr-detail-note">${state.source === "opcyc" ? "Keine Opcyc-Datensätze" : "Keine Einträge"}</div>`;
        }
        const opcyc = state.source === "opcyc";
        const labels = Object.fromEntries((state.report.statuses || []).map((status) => [status.key, status.label]));
        const rows = detail.records.map((record) => {
            const end = record.end ? Model.formatMoment(record.end, state.day) : "läuft";
            return `<tr${record.open ? ' class="is-open"' : ""}>`
                + `<td>${escapeHtml(Model.formatMoment(record.start, state.day))}</td>`
                + `<td>${escapeHtml(end)}</td>`
                + `<td>${Model.formatDuration(record.seconds)}</td>`
                + `<td>${escapeHtml(record.label || labels[record.status] || record.status)}</td>`
                + (opcyc ? `<td>${record.source === "correction" ? "Korrektur" : "Genesys"}</td>` : "")
                + "</tr>";
        }).join("");
        return `<div class="pr-detail"><table class="pr-detail-table"><thead><tr><th>Beginn</th><th>Ende</th>`
            + `<th>Dauer am Tag</th><th>Status</th>${opcyc ? "<th>Herkunft</th>" : ""}</tr></thead>`
            + `<tbody>${rows}</tbody></table></div>`;
    }

    // --- Zeilenmenü ----------------------------------------------------------------------------

    function openRowMenu(button) {
        const pseudonym = button.dataset.menu;
        if (state.menuFor === pseudonym) {
            closeRowMenu(true);
            return;
        }
        closeRowMenu();
        const report = state.report;
        const items = [];
        if (report.can_view_name && !state.names[pseudonym]) {
            items.push('<button type="button" role="menuitem" data-action="name">Klartext anzeigen</button>');
        }
        if (report.can_view_details) {
            items.push(`<button type="button" role="menuitem" data-action="details">${state.expanded.has(pseudonym)
                ? "Details ausblenden" : "Details anzeigen"}</button>`);
        }
        state.menuFor = pseudonym;
        dom.rowMenu.innerHTML = items.join("");
        const rect = button.getBoundingClientRect();
        dom.rowMenu.style.top = `${rect.bottom + 6}px`;
        dom.rowMenu.style.right = `${window.innerWidth - rect.right}px`;
        dom.rowMenu.classList.add("active");
        button.setAttribute("aria-expanded", "true");
        const first = dom.rowMenu.querySelector("button");
        if (first) first.focus({preventScroll: true});
    }

    function closeRowMenu(restoreFocus = false) {
        if (!state.menuFor) return;
        const button = dom.body.querySelector(`[data-menu="${CSS.escape(state.menuFor)}"]`);
        state.menuFor = null;
        dom.rowMenu.classList.remove("active");
        dom.rowMenu.innerHTML = "";
        if (button) {
            button.setAttribute("aria-expanded", "false");
            if (restoreFocus) button.focus();
        }
    }

    // --- Ereignisse --------------------------------------------------------------------------

    dom.reload.addEventListener("click", () => load({keepNames: false}));

    dom.source.addEventListener("click", (event) => {
        const button = event.target.closest("[data-source]");
        if (!button || button.dataset.source === state.source) return;
        state.source = button.dataset.source;
        if (state.sortKey !== Model.NAME) state.sortKey = Model.LOGGED;
        load({keepNames: true});
    });

    dom.search.addEventListener("input", () => {
        state.query = dom.search.value;
        closeRowMenu();
        renderTable();
    });

    dom.head.addEventListener("click", (event) => {
        const button = event.target.closest("[data-sort]");
        if (!button) return;
        Object.assign(state, Model.nextSort(state, button.dataset.sort));
        closeRowMenu();
        renderTable();
    });

    dom.body.addEventListener("click", (event) => {
        const button = event.target.closest("[data-menu]");
        if (button) openRowMenu(button);
    });

    dom.rowMenu.addEventListener("click", (event) => {
        const item = event.target.closest("[data-action]");
        if (!item) return;
        const pseudonym = state.menuFor;
        closeRowMenu(true);
        if (item.dataset.action === "name") revealName(pseudonym);
        else toggleDetails(pseudonym);
    });

    dom.columnsBtn.addEventListener("click", () => {
        const open = !dom.columnsMenu.classList.contains("active");
        dom.columnsMenu.classList.toggle("active", open);
        dom.columnsBtn.setAttribute("aria-expanded", String(open));
    });

    dom.columnsMenu.addEventListener("change", () => {
        const hidden = [...dom.columnsMenu.querySelectorAll("input[data-status]")]
            .filter((input) => !input.checked).map((input) => input.dataset.status);
        setHidden(hidden);
        if (hidden.includes(state.sortKey)) state.sortKey = Model.LOGGED;
        renderKpis();
        renderTable();
    });

    dom.exportLink.addEventListener("click", (event) => {
        if (dom.exportLink.getAttribute("aria-disabled") === "true") event.preventDefault();
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".ui-filter-container")) {
            dom.columnsMenu.classList.remove("active");
            dom.columnsBtn.setAttribute("aria-expanded", "false");
        }
        if (state.menuFor && !event.target.closest("#prRowMenu, [data-menu]")) closeRowMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (state.menuFor) closeRowMenu(true);
        if (dom.columnsMenu.classList.contains("active")) {
            dom.columnsMenu.classList.remove("active");
            dom.columnsBtn.setAttribute("aria-expanded", "false");
            dom.columnsBtn.focus();
        }
    });

    // Das Menü sitzt fest im Fenster; beim Scrollen gehörte es sonst zur falschen Zeile.
    window.addEventListener("scroll", () => closeRowMenu(), true);
    window.addEventListener("resize", () => closeRowMenu());

    load({keepNames: false});
}());
