// Userverwaltung: Tabelle mit Suche, Filter, Schnellfiltern je laufendem Prozess und Zeilenmenü.
// Daten aus /api/views/users (alle User, aktive und inaktive; „Inaktive“ filtert nur hier).
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const L = window.SofaList;
    const A = window.SofaUserActions;
    const { escapeHtml, fetchJson, apiErrorMessage, withParams } = window.SofaUtils;
    const root = document.getElementById("users-page");
    const mock = root.dataset.mock || "";
    const params = new URLSearchParams(window.location.search);
    let data = { users: [], roles: [] };
    let loadState = "loading";
    let loadError = "";

    // Kurzbezeichnungen der Prozesse; Reihenfolge = Reihenfolge der Schnellfilter.
    const PROCESS_LABELS = {
        onboarding: "Onboarding",
        offboarding: "Offboarding",
        change: "Wechsel",
        skill_assignment: "Neue Rolle",
        skill_removal: "Rollenentzug",
        training_schedule: "Schulung",
        temporary_role: "Temp. Rolle",
        rollback: "Rücknahme"
    };

    let roleById = new Map();

    const view = {
        search: "",
        showInactive: false,
        quick: null,                 // Prozesstyp oder "overdue"
        facets: { primary: new Map(), secondary: new Map(), skill: new Map(), process: new Map() },
        sort: { key: "last_name", dir: "asc" }
    };

    // Aufruf mit ?role=<id> (z. B. aus dem Rollenmanagement): die Rolle je nach Typ als Filter setzen.
    // Das geht erst, wenn die Rollen geladen sind; danach gilt der Filter wie jeder andere.
    let presetRoleId = params.get("role");

    function applyPresetRole() {
        const role = presetRoleId ? roleById.get(presetRoleId) : null;
        const facet = { PRIMARY: "primary", SECONDARY: "secondary", SKILL: "skill" }[role?.role_type];
        if (facet) {
            view.facets[facet].set(String(role.role_id), "include");
        }
        presetRoleId = null;
    }

    function setData(payload) {
        data = { users: Array.isArray(payload.users) ? payload.users : [], roles: Array.isArray(payload.roles) ? payload.roles : [] };
        roleById = new Map(data.roles.map(role => [String(role.role_id), role]));
        applyPresetRole();
    }

    const FACETS = [
        { key: "primary", title: "Funktion", options: () => roleOptions("PRIMARY") },
        { key: "secondary", title: "Nebenrolle", options: () => roleOptions("SECONDARY") },
        { key: "skill", title: "Skill", options: () => roleOptions("SKILL") },
        {
            key: "process", title: "Prozess",
            options: () => Object.entries(PROCESS_LABELS).map(([value, label]) => ({ value, label }))
        }
    ];

    function roleOptions(type) {
        return data.roles
            .filter(role => role.role_type === type && role.role_status !== "INACTIVE")
            .map(role => ({ value: String(role.role_id), label: role.name }))
            .sort((left, right) => left.label.localeCompare(right.label, "de"));
    }

    function facetLabel(key, value) {
        if (key === "process") {
            return PROCESS_LABELS[value] || value;
        }
        return roleById.get(value)?.name || value;
    }

    // ---------- Ableitungen je User ----------

    const statusesOf = user => Array.isArray(user.derived_statuses) ? user.derived_statuses : [];
    const processesOf = user => [...new Set(statusesOf(user).map(status => String(status.process_type || "").toLowerCase()))];
    const isOverdue = user => statusesOf(user).some(status => status.is_overdue);
    // Die Datenquelle liefert nur aktive Rollen mit aktiver Zuweisung.
    const secondaryOf = user => Array.isArray(user.secondary_roles) ? user.secondary_roles : [];
    const fullName = user => [user.first_name, user.last_name].filter(Boolean).join(" ");

    function statusRank(user) {
        if (!user.is_active) {
            return -1;
        }
        if (isOverdue(user)) {
            return 3;
        }
        if (processesOf(user).includes("offboarding")) {
            return 2;
        }
        return statusesOf(user).length ? 1 : 0;
    }

    // Nächster Termin eines laufenden Prozesses (für „Nächster Termin zuerst“).
    function nextDate(user) {
        const dates = statusesOf(user).map(status => status.reference_date).filter(Boolean).sort();
        return dates[0] || "";
    }

    const SORT_KEYS = {
        pnr: user => user.pnr,
        racf: user => user.racf,
        xde: user => user.xde,
        last_name: user => `${user.last_name || ""}, ${user.first_name || ""}`,
        first_name: user => `${user.first_name || ""} ${user.last_name || ""}`,
        role: user => user.primary_role?.name,
        roles: user => secondaryOf(user).length,
        entry: user => user.entry_date,
        exit: user => user.exit_date,
        status: user => statusRank(user),
        next: user => nextDate(user),
        _tie: user => `${user.last_name || ""}, ${user.first_name || ""}`
    };

    // Ausgeschriebene Sortieroptionen je Spalte; group trennt im Menü.
    const SORT_COLUMNS = {
        ids: [
            { key: "pnr", dir: "asc", group: "pnr", label: "PNR aufsteigend" },
            { key: "pnr", dir: "desc", group: "pnr", label: "PNR absteigend" },
            { key: "racf", dir: "asc", group: "racf", label: "RACF A–Z" },
            { key: "racf", dir: "desc", group: "racf", label: "RACF Z–A" },
            { key: "xde", dir: "asc", group: "xde", label: "XDE aufsteigend" },
            { key: "xde", dir: "desc", group: "xde", label: "XDE absteigend" }
        ],
        name: [
            { key: "last_name", dir: "asc", group: "last", label: "Nachname A–Z" },
            { key: "last_name", dir: "desc", group: "last", label: "Nachname Z–A" },
            { key: "first_name", dir: "asc", group: "first", label: "Vorname A–Z" },
            { key: "first_name", dir: "desc", group: "first", label: "Vorname Z–A" }
        ],
        role: [
            { key: "role", dir: "asc", label: "Funktion A–Z" },
            { key: "role", dir: "desc", label: "Funktion Z–A" }
        ],
        roles: [
            { key: "roles", dir: "desc", label: "Meiste Rollen zuerst" },
            { key: "roles", dir: "asc", label: "Wenigste Rollen zuerst" }
        ],
        entry: [
            { key: "entry", dir: "desc", label: "Eintritt: neueste zuerst" },
            { key: "entry", dir: "asc", label: "Eintritt: älteste zuerst" }
        ],
        exit: [
            { key: "exit", dir: "asc", label: "Austritt: nächster zuerst" },
            { key: "exit", dir: "desc", label: "Austritt: spätester zuerst" }
        ],
        status: [
            { key: "status", dir: "desc", group: "rank", label: "Dringende zuerst" },
            { key: "next", dir: "asc", group: "next", label: "Nächster Termin zuerst" }
        ]
    };

    // ---------- Filtern ----------

    function baseUsers() {
        return data.users.filter(user => view.showInactive || user.is_active);
    }

    function matchesFacets(user) {
        const roleIds = secondaryOf(user).map(role => String(role.role_id));
        return L.matchesFacet(view.facets.primary, [String(user.primary_role?.role_id ?? "")])
            && L.matchesFacet(view.facets.secondary, roleIds)
            && L.matchesFacet(view.facets.skill, roleIds)
            && L.matchesFacet(view.facets.process, processesOf(user));
    }

    function matchesQuick(user) {
        if (!view.quick) {
            return true;
        }
        return view.quick === "overdue" ? isOverdue(user) : processesOf(user).includes(view.quick);
    }

    function visibleUsers() {
        const users = baseUsers().filter(user => matchesQuick(user) && matchesFacets(user) && L.matchesSearch(view.search, [
            user.pnr, user.racf, user.xde, user.first_name, user.last_name, fullName(user),
            user.primary_role?.name, ...secondaryOf(user).map(role => role.name)
        ]));
        return L.sortBy(users, SORT_KEYS, view.sort);
    }

    // ---------- Darstellung ----------

    function renderQuick() {
        if (loadState !== "ready") {
            document.getElementById("users-quick").innerHTML = "";
            return;
        }
        const users = baseUsers();
        const counts = Object.keys(PROCESS_LABELS).map(type => ({
            id: type, label: PROCESS_LABELS[type], count: users.filter(user => processesOf(user).includes(type)).length
        })).filter(item => item.count > 0);
        const overdue = users.filter(isOverdue).length;
        if (view.quick && view.quick !== "overdue" && !counts.some(item => item.id === view.quick)) {
            view.quick = null;
        }

        const chip = (id, label, count, extraClass = "") => `
            <button type="button" class="ui-quick-filter${extraClass}" data-quick="${escapeHtml(id)}" aria-pressed="${view.quick === id}">
                <strong>${count}</strong> ${escapeHtml(label)}
            </button>`;

        const tokens = FACETS.flatMap(facet => [...view.facets[facet.key]].map(([value, state]) => `
            <span class="ui-filter-token${state === "exclude" ? " is-excluded" : ""}">
                ${escapeHtml(state === "exclude" ? `ohne ${facetLabel(facet.key, value)}` : facetLabel(facet.key, value))}
                <button type="button" data-token-facet="${facet.key}" data-token-value="${escapeHtml(value)}" aria-label="Filter entfernen">&times;</button>
            </span>`));

        document.getElementById("users-quick").innerHTML = [
            ...counts.map(item => chip(item.id, item.label, item.count)),
            overdue ? chip("overdue", "Überfällig", overdue, " is-warning") : "",
            tokens.length && (counts.length || overdue) ? '<span class="ui-quick-sep" aria-hidden="true"></span>' : "",
            ...tokens
        ].join("");
    }

    function statusCell(user) {
        if (!user.is_active) {
            return '<span class="ui-status-badge ui-status-badge-sm ui-status-neutral">Inaktiv</span>';
        }
        const statuses = statusesOf(user);
        if (!statuses.length) {
            return "";
        }
        const sorted = [...statuses].sort((left, right) => Number(Boolean(right.is_overdue)) - Number(Boolean(left.is_overdue)));
        const first = sorted[0];
        const type = String(first.process_type || "").toLowerCase();
        const className = first.is_overdue ? "ui-status-error" : type === "offboarding" ? "ui-status-warning" : "ui-status-info";
        const date = first.reference_date ? ` · ${L.formatDate(first.reference_date).slice(0, 6)}` : "";
        const more = sorted.length > 1 ? `<span class="al-more ui-hint">+${sorted.length - 1}</span>` : "";
        return `<span class="al-status" data-tip="status"><span class="ui-status-badge ui-status-badge-sm ${className}">${escapeHtml(PROCESS_LABELS[type] || first.label)}${escapeHtml(date)}</span>${more}</span>`;
    }

    function statusTip(user) {
        const sorted = [...statusesOf(user)].sort((left, right) => Number(Boolean(right.is_overdue)) - Number(Boolean(left.is_overdue)));
        return `<ul class="ui-tip-list">${sorted.map(status => `
            <li>
                <strong>${escapeHtml(PROCESS_LABELS[String(status.process_type || "").toLowerCase()] || status.label)}</strong>
                ${escapeHtml([
                    status.role_name,
                    status.target_role_name && `${status.source_role_name || "–"} → ${status.target_role_name}`,
                    status.reference_date && L.formatDate(status.reference_date)
                ].filter(Boolean).join(" · "))}
                ${status.is_overdue ? '<span class="ui-tip-warn">überfällig</span>' : ""}
            </li>`).join("")}</ul>`;
    }

    // Nebenrollen vor Skills, je alphabetisch; die erste steht ausgeschrieben in der Zeile.
    const ROLE_GROUPS = [["SECONDARY", "Nebenrollen"], ["SKILL", "Skills"]];

    function sortedRoles(user) {
        const rank = role => ROLE_GROUPS.findIndex(([type]) => type === role.role_type);
        return [...secondaryOf(user)].sort((left, right) => (rank(left) - rank(right)) || left.name.localeCompare(right.name, "de"));
    }

    function rolesCell(user) {
        const roles = sortedRoles(user);
        if (!roles.length) {
            return "";
        }
        const more = roles.length > 1 ? `<span class="al-more ui-hint">+${roles.length - 1}</span>` : "";
        return `<span class="al-roles" data-tip="roles"><span class="al-roles-first">${escapeHtml(roles[0].name)}</span>${more}<span class="al-roles-count ui-hint">${roles.length}</span></span>`;
    }

    function rolesTip(user) {
        const roles = sortedRoles(user);
        return ROLE_GROUPS.map(([type, title]) => {
            const names = roles.filter(role => role.role_type === type).map(role => role.name);
            return names.length ? `<div class="ui-tip-group"><span class="ui-tip-title">${title} · ${names.length}</span>${names.map(name => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : "";
        }).join("");
    }

    // Kennungen übereinander; oben und fett steht die, nach der sortiert wird (sonst PNR). Fehlende entfallen.
    const ID_KEYS = ["pnr", "racf", "xde"];

    function idsCell(user) {
        const top = ID_KEYS.includes(view.sort.key) ? view.sort.key : "pnr";
        const rest = ID_KEYS.filter(key => key !== top && user[key]);
        return `<span class="al-ids"><strong>${escapeHtml(user[top] || "–")}</strong>${rest.map(key => `<span>${escapeHtml(user[key])}</span>`).join("")}</span>`;
    }

    function renderState() {
        const message = loadState === "loading"
            ? '<span class="ui-list-loading">Lädt …</span>'
            : `<span class="ui-list-error">${escapeHtml(loadError)}</span> <button type="button" class="ui-flat-button ui-flat-button--sm" data-reload>Erneut laden</button>`;
        document.getElementById("users-body").innerHTML = `<tr><td colspan="8" class="ui-list-empty">${message}</td></tr>`;
        document.getElementById("users-count").textContent = "";
    }

    function renderTable() {
        document.getElementById("users-sort-label").textContent = sortMenu.label();
        if (loadState !== "ready") {
            renderState();
            return;
        }
        const users = visibleUsers();
        const total = baseUsers().length;
        document.getElementById("users-count").textContent = users.length === total ? `${total} User` : `${users.length} von ${total}`;

        const body = document.getElementById("users-body");
        if (!users.length) {
            body.innerHTML = '<tr><td colspan="8" class="ui-list-empty">Keine User gefunden</td></tr>';
            return;
        }
        body.innerHTML = users.map(user => {
            return `
                <tr class="ui-table-row${user.is_active ? "" : " is-inactive"}" data-open="${escapeHtml(user.user_id)}">
                    <td>${idsCell(user)}</td>
                    <td class="al-name"><strong>${escapeHtml(user.last_name || "–")}</strong>, ${escapeHtml(user.first_name || "")}</td>
                    <td>${escapeHtml(user.primary_role?.name || "–")}</td>
                    <td>${rolesCell(user)}</td>
                    <td class="al-col-date ui-table-muted">${escapeHtml(L.formatDate(user.entry_date))}</td>
                    <td class="al-col-date ${user.is_active ? "al-exit" : "ui-table-muted"}">${escapeHtml(L.formatDate(user.exit_date))}</td>
                    <td>${statusCell(user)}</td>
                    <td class="ui-table-action">
                        ${L.menuButton(user.user_id, fullName(user))}
                    </td>
                </tr>`;
        }).join("");
    }

    function renderFilterPop() {
        document.getElementById("users-filter-pop").innerHTML = `
            <div class="ui-pop-columns">
                ${FACETS.map(facet => `
                    <div class="ui-pop-group" role="group" aria-label="${escapeHtml(facet.title)}">
                        <span class="ui-pop-group-title">${escapeHtml(facet.title)}</span>
                        ${facet.options().map(option => `
                            <button type="button" class="ui-pop-option" data-facet="${facet.key}" data-value="${escapeHtml(option.value)}"${view.facets[facet.key].has(option.value) ? ` data-state="${view.facets[facet.key].get(option.value)}"` : ""}>${escapeHtml(option.label)}</button>
                        `).join("")}
                    </div>
                `).join("")}
            </div>
            <div class="ui-pop-footer">
                <button type="button" class="ui-link-btn" data-filter-reset${activeFacetCount() ? "" : " disabled"}>Zurücksetzen</button>
            </div>`;
    }

    function activeFacetCount() {
        return Object.values(view.facets).reduce((sum, facet) => sum + facet.size, 0);
    }

    function renderToolbar() {
        const count = activeFacetCount();
        const badge = document.getElementById("users-filter-count");
        badge.hidden = count === 0;
        badge.textContent = count;
        document.getElementById("users-filter-btn").classList.toggle("is-active", count > 0);
        document.getElementById("users-inactive").setAttribute("aria-pressed", String(view.showInactive));
    }

    function render() {
        renderToolbar();
        renderQuick();
        renderTable();
    }

    async function load() {
        // Beim ersten Laden zeigt die Seite „Lädt …“; ein späterer Fehler lässt den letzten Stand stehen.
        if (loadState !== "ready") {
            loadState = "loading";
            render();
        }
        const { ok, data: payload } = await fetchJson(withParams("/api/views/users", mock ? { mock } : {}))
            .catch(() => ({ ok: false, data: null }));
        if (ok && payload) {
            setData(payload);
            loadState = "ready";
        } else if (loadState === "ready") {
            showFlash(apiErrorMessage(payload, "User konnten nicht geladen werden"), "failure");
        } else {
            loadState = "error";
            loadError = apiErrorMessage(payload, "User konnten nicht geladen werden");
        }
        render();
    }

    // ---------- Aktionen ----------

    function mockAction(label, user) {
        showFlash(user ? `${label}: ${fullName(user)} (Mock)` : `${label} (Mock)`, "success");
    }

    // Einträge nur mit dem Recht und nach derselben Regel wie im Panel (SofaUserActions.allowed).
    // Gruppen werden durch Trenner getrennt; leere Gruppen entfallen.
    const MENU_GROUPS = [
        [{ id: "details", label: "Details öffnen" }],
        [
            { id: "change", label: "Funktion wechseln" },
            { id: "skill", label: "Neue Rolle" },
            { id: "training", label: "Schulung planen" },
            { id: "revoke", label: "Rolle entziehen" }
        ],
        [{ id: "offboarding", label: "Offboarding", danger: true }],
        [{ id: "rehire", label: "Wiedereintritt" }]
    ];

    function menuItems(user) {
        return MENU_GROUPS
            .map(group => group.filter(item => A.allowed(item.id, user)))
            .filter(group => group.length)
            .flatMap((group, index) => index ? [{ separator: true }, ...group] : group);
    }

    const ACTION_LABELS = {
        details: "Details", rehire: "Wiedereintritt", change: "Funktion wechseln", skill: "Neue Rolle",
        training: "Schulung planen", revoke: "Rolle entziehen", offboarding: "Offboarding", onboarding: "Onboarding"
    };

    function runAction(id, user) {
        if (mock) {
            mockAction(ACTION_LABELS[id] || id, user);
            return;
        }
        A.run(id, user.user_id);
    }

    function userById(id) {
        return data.users.find(user => String(user.user_id) === String(id));
    }

    // ---------- Ereignisse ----------

    const sortMenu = L.bindSortMenu(document.getElementById("users-table"), view.sort, SORT_COLUMNS, renderTable);

    let searchTimer = null;
    document.getElementById("users-search").addEventListener("input", event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            view.search = event.target.value;
            renderTable();
        }, 120);
    });

    document.getElementById("users-inactive").addEventListener("click", () => {
        view.showInactive = !view.showInactive;
        render();
    });

    L.bindPopover(document.getElementById("users-filter-btn"), document.getElementById("users-filter-pop"), renderFilterPop);

    document.getElementById("users-filter-pop").addEventListener("click", event => {
        const option = event.target.closest("[data-facet]");
        if (option) {
            L.cycleFacet(view.facets[option.dataset.facet], option.dataset.value);
        } else if (event.target.closest("[data-filter-reset]")) {
            Object.values(view.facets).forEach(facet => facet.clear());
        } else {
            return;
        }
        renderFilterPop();
        render();
    });

    document.getElementById("users-quick").addEventListener("click", event => {
        const quick = event.target.closest("[data-quick]");
        const token = event.target.closest("[data-token-facet]");
        if (quick) {
            view.quick = view.quick === quick.dataset.quick ? null : quick.dataset.quick;
        } else if (token) {
            view.facets[token.dataset.tokenFacet].delete(token.dataset.tokenValue);
        } else {
            return;
        }
        render();
    });

    L.bindTips(document.getElementById("users-body"), target => {
        const user = userById(target.closest("tr[data-open]")?.dataset.open);
        if (!user) {
            return "";
        }
        return target.dataset.tip === "roles" ? rolesTip(user) : statusTip(user);
    });

    document.getElementById("users-body").addEventListener("click", event => {
        if (event.target.closest("[data-reload]")) {
            load();
            return;
        }
        const menuButton = event.target.closest("[data-menu]");
        if (menuButton) {
            event.stopPropagation();
            const user = userById(menuButton.dataset.menu);
            L.openMenu(menuButton, menuItems(user), id => runAction(id, user));
            return;
        }
        const row = event.target.closest("tr[data-open]");
        if (row && !window.getSelection()?.toString()) {
            runAction("details", userById(row.dataset.open));
        }
    });

    if (mock) {
        // Im Mock gibt es die User nicht in der SD-API: keine echten Dialoge, nur eine Meldung.
        root.querySelectorAll(".ui-toolbar-end [data-action]").forEach(button => {
            button.addEventListener("click", () => mockAction(ACTION_LABELS[button.dataset.action] || button.textContent.trim()));
        });
    } else {
        // Panel, Dialoge, Werkzeugleiste (#training-action-btn, #onboard-action-btn) und ?user_id= übernimmt user_actions.js.
        A.init({ reload: load, visibleUsers });
    }

    load();
});
