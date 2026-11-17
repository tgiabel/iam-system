// Systemverwaltung: Systeme als Tabelle, gruppiert nach Standard-Backlog. Daten aus /api/views/systems.
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const L = window.SofaList;
    const D = window.DetailShared;
    const { escapeHtml, fetchJson, apiErrorMessage, withParams } = window.SofaUtils;
    const page = document.getElementById("systems-page");
    const mock = page.dataset.mock || "";
    let data = { systems: [], backlogs: [] };
    let loadState = "loading";
    let loadError = "";

    const LEVELS = [
        { id: "CRITICAL", className: "ui-status-error" },
        { id: "ELEVATED", className: "ui-status-warning" },
        { id: "LOW", className: "ui-status-success" }
    ].map(level => ({ ...level, label: D.PROTECTION[level.id].label }));
    const NO_LEVEL = { id: "NONE", label: "ohne Schutzbedarf" };
    const GOALS = [["confidentiality", "Vertraulichkeit"], ["integrity", "Integrität"], ["availability", "Verfügbarkeit"]];

    let backlogName = new Map();
    const view = { search: "", quick: null };

    const resources = system => system.resources || [];
    const protectionOf = system => LEVELS.find(level => level.id === system.protection_need?.overall) || NO_LEVEL;

    function countBy(items, keyFn) {
        const counts = new Map();
        items.forEach(item => counts.set(keyFn(item), (counts.get(keyFn(item)) || 0) + 1));
        return counts;
    }

    const QUICK = [
        ...LEVELS.map(level => ({ ...level, className: `al-quick-${level.id.toLowerCase()}`, test: system => protectionOf(system) === level })),
        { ...NO_LEVEL, className: "al-quick-none", test: system => protectionOf(system) === NO_LEVEL },
        { id: "overdue", label: "mit überfälligen Aufgaben", className: "is-warning", sep: true, test: system => system.overdue_tasks > 0 },
        { id: "empty", label: "ohne Ressourcen", test: system => !resources(system).length }
    ];

    function renderQuick() {
        let sepDone = false;
        document.getElementById("systems-quick").innerHTML = QUICK.map(quick => {
            const count = data.systems.filter(quick.test).length;
            if (!count) {
                return "";
            }
            const sep = quick.sep && !sepDone ? '<span class="ui-quick-sep" aria-hidden="true"></span>' : "";
            sepDone = sepDone || Boolean(sep);
            return `${sep}<button type="button" class="ui-quick-filter ${quick.className || ""}" data-quick="${quick.id}" aria-pressed="${view.quick === quick.id}"><strong>${count}</strong> ${escapeHtml(quick.label)}</button>`;
        }).join("");
    }

    // ---------- Zellen ----------

    // Zusammensetzung „Konto · Queue 24 · Gruppe 3“, Konto vorn, dann die größten Typen.
    function compositionText(system) {
        const counts = [...countBy(resources(system), item => item.type_name)]
            .sort((left, right) => (right[0] === "Konto") - (left[0] === "Konto") || right[1] - left[1] || left[0].localeCompare(right[0], "de"));
        return counts.map(([type, count]) => count > 1 ? `${type} ${count}` : type).join(" · ");
    }

    // Intern ist der Normalfall und bleibt gedämpft; Bot/Extern als Marke, „Extern 3“, wenn nur ein Teil.
    function handlingCell(system) {
        const list = resources(system);
        const other = [...countBy(list, item => item.handling)].filter(([handling]) => handling !== "INTERNAL");
        if (!list.length) {
            return '<span class="ui-table-muted">–</span>';
        }
        if (!other.length) {
            return `<span class="ui-table-muted">${escapeHtml(D.HANDLING.INTERNAL)}</span>`;
        }
        return `<span class="al-tags" data-tip="handling" tabindex="0">${other.map(([handling, count]) =>
            `<span class="al-tag al-tag--handling">${escapeHtml(D.HANDLING[handling] || handling)}${count < list.length ? ` ${count}` : ""}</span>`).join("")}</span>`;
    }

    function protectionCell(system) {
        const level = protectionOf(system);
        return level === NO_LEVEL
            ? '<span class="al-tag al-tag--todo">fehlt</span>'
            : `<span class="ui-status-badge ui-status-badge-sm ${level.className}" data-tip="protection" tabindex="0">${escapeHtml(level.label)}</span>`;
    }

    function hitTag(system) {
        const term = view.search.trim();
        if (!term || L.matchesSearch(term, [system.name, system.short_name, system.system_id])) {
            return "";
        }
        const hits = resources(system).map(item => item.display_name).filter(name => L.matchesSearch(term, [name]));
        return hits.length ? `<span class="al-hit">${escapeHtml(hits[0])}${hits.length > 1 ? ` +${hits.length - 1}` : ""}</span>` : "";
    }

    const num = (value, tip = "", className = "") => value
        ? `<span class="${tip ? "ui-hint" : ""}${className ? ` ${className}` : ""}"${tip ? ` data-tip="${tip}" tabindex="0"` : ""}>${value}</span>`
        : '<span class="ui-table-muted">–</span>';

    function row(system) {
        const composition = compositionText(system);
        const sameName = L.normalize(system.short_name) === L.normalize(system.name);
        return `
            <tr data-open="${escapeHtml(system.system_id)}" tabindex="0">
                <td class="al-sysname-cell">
                    <span class="al-sysname">
                        <strong>${escapeHtml(system.name)}</strong>
                        ${sameName ? "" : `<span class="al-sys">${escapeHtml(system.short_name)}</span>`}
                        ${hitTag(system)}
                    </span>
                </td>
                <td class="al-col-content ui-table-muted"><span class="al-composition" title="${escapeHtml(composition)}">${escapeHtml(composition || "–")}</span></td>
                <td>${protectionCell(system)}</td>
                <td class="al-col-handling">${handlingCell(system)}</td>
                <td class="ui-table-num al-col-res">${num(resources(system).length, "resources")}</td>
                <td class="ui-table-num al-col-users">${num(system.user_count || 0)}</td>
                <td class="ui-table-num al-col-tasks">${num(system.open_tasks || 0, "tasks")}</td>
                <td class="ui-table-num">${num(system.overdue_tasks || 0, "", "al-overdue")}</td>
                <td class="ui-table-action">${L.menuButton(system.system_id, system.name)}</td>
            </tr>`;
    }

    // ---------- Tabelle, gruppiert nach Standard-Backlog ----------

    const RANK = { CRITICAL: 3, ELEVATED: 2, LOW: 1 };
    const SORT_KEYS = {
        name: system => system.name,
        short: system => system.short_name,
        protection: system => RANK[system.protection_need?.overall] || 0,
        resources: system => resources(system).length,
        users: system => system.user_count || 0,
        tasks: system => system.open_tasks || 0,
        overdue: system => system.overdue_tasks || 0,
        _tie: system => system.name
    };
    const SORT_COLUMNS = {
        name: [{ key: "name", dir: "asc", label: "Name A–Z" }, { key: "name", dir: "desc", label: "Name Z–A" },
               { key: "short", dir: "asc", label: "Kürzel A–Z", group: "short" }],
        protection: [{ key: "protection", dir: "desc", label: "Kritisch zuerst" }, { key: "protection", dir: "asc", label: "Gering zuerst" }],
        resources: [{ key: "resources", dir: "desc", label: "Meiste Ressourcen zuerst" }, { key: "resources", dir: "asc", label: "Wenigste Ressourcen zuerst" }],
        users: [{ key: "users", dir: "desc", label: "Meiste User zuerst" }, { key: "users", dir: "asc", label: "Wenigste User zuerst" }],
        tasks: [{ key: "tasks", dir: "desc", label: "Meiste Aufgaben zuerst" }, { key: "tasks", dir: "asc", label: "Wenigste Aufgaben zuerst" }],
        overdue: [{ key: "overdue", dir: "desc", label: "Meiste überfällige zuerst" }, { key: "overdue", dir: "asc", label: "Wenigste überfällige zuerst" }]
    };
    view.sort = { key: "name", dir: "asc" };
    const COLSPAN = 9;

    function visibleSystems() {
        const quick = QUICK.find(item => item.id === view.quick);
        return data.systems.filter(system => (!quick || quick.test(system)) && L.matchesSearch(view.search, [
            system.name, system.short_name, system.system_id, backlogName.get(system.default_backlog_identifier),
            ...resources(system).map(item => item.display_name)
        ]));
    }

    function renderTable() {
        const systems = visibleSystems();
        const total = data.systems.length;
        document.getElementById("systems-count").textContent = systems.length === total ? `${total} Systeme` : `${systems.length} von ${total}`;

        const groups = new Map();
        L.sortBy(systems, SORT_KEYS, view.sort).forEach(system => {
            const key = system.default_backlog_identifier || "";
            groups.set(key, [...(groups.get(key) || []), system]);
        });
        // Backlogs alphabetisch, ohne Standard-Backlog am Ende.
        const label = key => key ? backlogName.get(key) || key : "Ohne Standard-Backlog";
        const ordered = [...groups].sort((left, right) => (left[0] === "") - (right[0] === "") || L.compareValues(label(left[0]), label(right[0])));

        document.getElementById("systems-body").innerHTML = ordered.length ? ordered.map(([key, list]) => `
            <tr class="al-group-row"><th colspan="${COLSPAN}" scope="rowgroup">${escapeHtml(label(key))} <span>${list.length}</span></th></tr>
            ${list.map(row).join("")}`).join("")
            : `<tr><td colspan="${COLSPAN}" class="ui-list-empty">Keine Systeme gefunden</td></tr>`;
    }

    function renderState() {
        const message = loadState === "loading"
            ? '<span class="ui-list-loading">Lädt …</span>'
            : `<span class="ui-list-error">${escapeHtml(loadError)}</span> <button type="button" class="ui-flat-button ui-flat-button--sm" data-reload>Erneut laden</button>`;
        document.getElementById("systems-body").innerHTML = `<tr><td colspan="${COLSPAN}" class="ui-list-empty">${message}</td></tr>`;
        document.getElementById("systems-count").textContent = "";
        document.getElementById("systems-quick").innerHTML = "";
    }

    function render() {
        if (loadState !== "ready") {
            renderState();
            return;
        }
        renderQuick();
        renderTable();
    }

    const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;

    function setData(next) {
        data = { systems: next.systems || [], backlogs: next.backlogs || [] };
        backlogName = new Map(data.backlogs.map(item => [item.technical_identifier, item.display_name]));
        document.getElementById("systems-create-backlog").innerHTML = option("", "Bitte wählen")
            + data.backlogs.map(item => option(item.technical_identifier, item.display_name)).join("");
    }

    async function load() {
        // Beim ersten Laden zeigt die Seite „Lädt …“; ein späterer Fehler lässt den letzten Stand stehen.
        const { ok, data: payload } = await fetchJson(withParams("/api/views/systems", mock ? { mock } : {}))
            .catch(() => ({ ok: false, data: null }));
        if (ok && payload) {
            setData(payload);
            loadState = "ready";
        } else if (loadState === "ready") {
            showFlash(apiErrorMessage(payload, "Systeme konnten nicht geladen werden"), "failure");
        } else {
            loadState = "error";
            loadError = apiErrorMessage(payload, "Systeme konnten nicht geladen werden");
        }
        render();
    }

    // ---------- Tooltips ----------

    const systemById = id => data.systems.find(system => String(system.system_id) === String(id));
    const TIP_LIMIT = 8;

    const TIPS = {
        protection: system => L.tipGroup("Schutzbedarf", GOALS.map(([key, label]) =>
            `<li>${escapeHtml(label)} <strong>${escapeHtml(D.PROTECTION[system.protection_need?.[key]]?.label || "–")}</strong></li>`)),
        resources: system => [...countBy(resources(system), item => item.type_name)].sort((left, right) => right[1] - left[1])
            .map(([type]) => {
                const names = resources(system).filter(item => item.type_name === type).map(item => item.display_name).sort();
                const shown = names.slice(0, TIP_LIMIT).map(name => `<li>${escapeHtml(name)}</li>`);
                return L.tipGroup(`${type} · ${names.length}`, names.length > TIP_LIMIT
                    ? [...shown, `<li class="ui-table-muted">+${names.length - TIP_LIMIT} weitere</li>`] : shown);
            }).join(""),
        handling: system => L.tipGroup("Bearbeitung", L.tipCounts(new Map([...countBy(resources(system), item => item.handling)]
            .map(([handling, count]) => [D.HANDLING[handling] || handling, count])))),
        tasks: system => L.tipGroup(`Offene Aufgaben · ${system.open_tasks}`, [
            `<li><span class="ui-tip-num">${system.blocked_tasks || 0}</span>blockiert</li>`,
            `<li><span class="ui-tip-num">${system.overdue_tasks || 0}</span>überfällig</li>`
        ])
    };

    L.bindTips(document.getElementById("systems-body"), target => {
        const system = systemById(target.closest("[data-open]")?.dataset.open);
        return system ? TIPS[target.dataset.tip]?.(system) : "";
    });

    // ---------- Aktionen ----------

    const mockFlash = text => showFlash(`${text} (Mock)`, "success");

    // Ziele der Einträge. Im Mock zeigen Detailseite und Aufgaben nur eine Meldung (die IDs gibt es dort nicht);
    // das Rollenmanagement hat dieselben Mock-Daten und nimmt den Vorfilter mit.
    const detailUrl = (system, query = "") => `/systems/${encodeURIComponent(system.system_id)}${query}`;
    const go = (url, mockText) => mock && mockText ? mockFlash(mockText) : window.location.assign(url);
    const openSystem = system => go(detailUrl(system), `Detailseite ${system.name}`);

    function menuItems(system) {
        // „User anzeigen“ fehlt, bis die SD-API die User je System liefert.
        return [
            { id: "open", label: "Details öffnen" },
            { id: "edit", label: "Stammdaten bearbeiten" },
            { id: "resource", label: "Ressource anlegen" },
            { separator: true },
            system.open_tasks ? { id: "tasks", label: "Offene Aufgaben" } : null,
            resources(system).length ? { id: "roles", label: "Rollen anzeigen" } : null
        ].filter(Boolean).filter((item, index, list) => !item.separator || index < list.length - 1);
    }

    const ACTIONS = {
        open: openSystem,
        edit: system => go(detailUrl(system, "?edit=1"), `Stammdaten ${system.name}`),
        resource: system => go(detailUrl(system, "?resource=new"), `Neue Ressource in ${system.name}`),
        tasks: system => go(`/tasks?${new URLSearchParams({ system: system.system_id })}`, `Aufgaben gefiltert auf ${system.short_name}`),
        roles: system => go(`/roles?${new URLSearchParams(mock ? { system: system.system_id, mock } : { system: system.system_id })}`)
    };

    L.bindSortMenu(document.getElementById("systems-table"), view.sort, SORT_COLUMNS, renderTable);

    const body = document.getElementById("systems-body");
    body.addEventListener("keydown", event => {
        const system = event.key === "Enter" && event.target.matches("tr[data-open]") && systemById(event.target.dataset.open);
        if (system) {
            openSystem(system);
        }
    });
    body.addEventListener("click", event => {
        if (event.target.closest("[data-reload]")) {
            load();
            return;
        }
        const menu = event.target.closest("[data-menu]");
        const system = systemById(event.target.closest("[data-open]")?.dataset.open);
        if (!system) {
            return;
        }
        event.preventDefault();
        if (menu) {
            event.stopPropagation();
            L.openMenu(menu, menuItems(system), id => ACTIONS[id](system));
            return;
        }
        openSystem(system);
    });

    let searchTimer = null;
    document.getElementById("systems-search").addEventListener("input", event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            view.search = event.target.value;
            renderTable();
        }, 120);
    });

    document.getElementById("systems-quick").addEventListener("click", event => {
        const quick = event.target.closest("[data-quick]");
        if (quick) {
            view.quick = view.quick === quick.dataset.quick ? null : quick.dataset.quick;
            render();
        }
    });

    document.querySelectorAll("#systems-create-form [data-protection]").forEach(select => {
        select.innerHTML = option("", "–") + [...LEVELS].reverse().map(level => option(level.id, level.label)).join("");
    });

    const dialog = document.getElementById("systems-create-dialog");
    const form = document.getElementById("systems-create-form");
    document.getElementById("systems-create").addEventListener("click", () => {
        form.reset();
        dialog.showModal();
    });
    dialog.querySelectorAll("[data-dialog-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
    window.SofaDialog.closeOnBackdrop(dialog);

    async function post(url, payload) {
        const { ok, status, data: body } = await fetchJson(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }).catch(() => ({ ok: false, status: 0, data: { error: "Netzwerkfehler oder Server nicht erreichbar" } }));
        if (!ok) {
            throw new Error(apiErrorMessage(body, `Speichern fehlgeschlagen (${status})`));
        }
        return body;
    }

    // Anlegen nimmt nur Name, Kürzel und Backlog an; den Schutzbedarf schreibt danach die Aktualisierung.
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (mock) {
            dialog.close();
            mockFlash("System angelegt");
            return;
        }
        const fields = new FormData(form);
        const base = {
            name: String(fields.get("name") || "").trim(),
            short_name: String(fields.get("short_name") || "").trim(),
            default_backlog_identifier: fields.get("default_backlog_identifier") || null
        };
        const protection = Object.fromEntries(GOALS.map(([key]) => [key, fields.get(key) || null]).filter(([, value]) => value));
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        let created = null;
        try {
            created = await post("/api/systems", base);
            if (Object.keys(protection).length) {
                await post(`/api/systems/${encodeURIComponent(created.system_id)}`, { name: base.name, short_name: base.short_name, protection_need: protection });
            }
            window.location.assign(detailUrl(created));
        } catch (error) {
            // Das System steht schon, nur der Schutzbedarf fehlt: dann trotzdem zur Detailseite.
            if (created?.system_id) {
                showFlash(`System angelegt, Schutzbedarf nicht gespeichert: ${error.message}`, "failure");
                setTimeout(() => window.location.assign(detailUrl(created)), 2500);
            } else {
                showFlash(error.message, "failure");
                submit.disabled = false;
            }
        }
    });

    render();
    load();
});
