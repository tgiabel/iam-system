// Systemdetails: Ressourcen als Baum nach Voraussetzung, Ressource im Seitenpanel, Kopfdaten und Typen im Dialog.
(function () {
    "use strict";

    const D = window.DetailShared;
    const esc = D.esc;
    const $ = id => document.getElementById(id);

    const ACCOUNT_TYPE_ID = 1; // Konto
    const EXTERNAL_PROVIDER_ROLE_ID = 9;
    const SUBGROUP_MIN = 5;   // ab so vielen Kindern gleichen Typs eine eigene, zuklappbare Zeile
    const COLLAPSE_MIN = 10;  // ab so vielen startet die Gruppe zugeklappt

    const state = {
        systemId: null,
        system: null,
        types: [],
        backlogs: {},
        users: [],
        allResources: [],
        parentCandidates: [],
        filterType: "",
        query: "",
        collapsed: null,
        guideCatalog: [],
        panel: null
    };

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        bindEvents();
        state.systemId = $("system-page").dataset.systemId;
        try {
            const [backlogs, users, guideCatalog] = await Promise.all([
                D.getJson("/api/backlogs").catch(() => []),
                D.getJson("/api/users").catch(() => []),
                D.getJson("/api/resources/guide-placeholders").catch(() => [])
            ]);
            state.guideCatalog = Array.isArray(guideCatalog) ? guideCatalog : [];
            (Array.isArray(backlogs) ? backlogs : []).forEach(b => { state.backlogs[b.technical_identifier] = b.name; });
            state.users = Array.isArray(users) ? users : [];
            await reload();
            // Einstiege aus der Systemverwaltung: ?edit=1 (Stammdaten), ?resource=new (neue Ressource), ?res=<id>.
            const query = new URLSearchParams(location.search);
            const openId = query.get("res");
            if (query.get("edit") === "1") openSystemEdit();
            else if (query.get("resource") === "new") openPanel("new");
            else if (openId) openPanel("view", findResource(openId));
        } catch (error) {
            showFlash(error.message, "failure");
        }
    }

    // System, Typen und Kandidaten für „Übergeordnet“ ändern sich beim Speichern; der Rest bleibt.
    async function reload() {
        const [system, types, all] = await Promise.all([
            D.getJson(`/api/systems/${state.systemId}`),
            D.getJson(`/api/systems/${state.systemId}/resource-types`).catch(() => []),
            D.getJson("/api/resources").catch(() => [])
        ]);
        state.system = system;
        state.types = Array.isArray(types) ? types : [];
        // Alle Ressourcen: Konten als Kandidaten für „Übergeordnet“, der Rest für fremde Voraussetzungen und Abhängige.
        state.allResources = (Array.isArray(all) ? all : []).map(r => ({
            ...r,
            parent_resource_id: Array.isArray(r.parent_resource_ids) ? (r.parent_resource_ids[0] ?? null) : r.parent_resource_id
        }));
        state.parentCandidates = state.allResources.filter(r => Number(r.type_id) === ACCOUNT_TYPE_ID);
        if (!state.collapsed) initCollapsed();
        render();
    }

    // ---------- Daten ----------

    function resources() {
        return Array.isArray(state.system?.resources) ? state.system.resources : [];
    }

    function findResource(id) {
        return resources().find(r => String(r.resource_id) === String(id)) || null;
    }

    // Voraussetzung außerhalb des Systems aus der Gesamtliste, sonst ein Platzhalter.
    function foreignParent(r) {
        if (r.parent_resource_id == null || findResource(r.parent_resource_id)) return null;
        return state.allResources.find(c => String(c.resource_id) === String(r.parent_resource_id))
            || { resource_id: r.parent_resource_id, display_name: `#${r.parent_resource_id}` };
    }

    function lookupResource(id) {
        const own = findResource(id);
        return own ? { ...own, system_id: state.system.system_id } : foreignParent({ parent_resource_id: id });
    }

    function systemHandling() {
        return state.system.default_handling_type || "INTERNAL";
    }

    function backlogName(identifier) {
        return state.backlogs[identifier] || identifier;
    }

    function userLabel(id) {
        const user = state.users.find(u => String(u.user_id) === String(id));
        return user ? `${user.first_name || ""} ${user.last_name || ""}`.trim() : (id ?? "-");
    }

    function recipients() {
        return state.users.filter(u => Number(u.primary_role?.role_id) === EXTERNAL_PROVIDER_ROLE_ID);
    }

    function initCollapsed() {
        state.collapsed = new Set();
        const tree = D.resourceTree(resources());
        resources().forEach(r => {
            D.groupByType(tree.childrenOf(r.resource_id)).forEach(group => {
                if (group.rows.length >= COLLAPSE_MIN) state.collapsed.add(`g:${r.resource_id}:${group.typeId}`);
            });
        });
    }

    // ---------- Render ----------

    function render() {
        renderHead();
        renderFilter();
        renderTable();
    }

    function renderHead() {
        const s = state.system;
        document.title = `${s.name} | SOFA`;
        $("sys-title").textContent = s.name;
        $("sys-chips").innerHTML = D.chip(s.short_name || "-", "ui-chip-primary")
            + D.statusChip(s.status)
            + D.protectionChip(s.protection_need?.overall);
        const backlog = s.default_backlog_identifier ? esc(backlogName(s.default_backlog_identifier)) : `<span class="dp-muted">keins</span>`;
        $("sys-meta").innerHTML = [
            ["Standard-Backlog", backlog],
            ["Standard-Bearbeitung", esc(D.HANDLING[systemHandling()] || systemHandling())],
            ["ID", esc(s.system_id)]
        ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    }

    function renderFilter() {
        const list = resources();
        $("res-count").textContent = list.length;
        const groups = D.groupByType(list);
        if (state.filterType && !groups.some(g => g.typeId === state.filterType)) state.filterType = "";
        const options = [{ typeId: "", name: "Alle", count: list.length }, ...groups.map(g => ({ ...g, count: g.rows.length }))];
        $("type-chips").innerHTML = options.map(o => {
            const active = o.typeId === state.filterType;
            return `<button type="button" class="ui-chip ui-chip-sm ${active ? "ui-chip-primary" : "ui-chip-neutral"}" data-type="${esc(o.typeId)}" aria-pressed="${active}">${esc(o.name)} <span class="dp-type-count">${o.count}</span></button>`;
        }).join("");
        $("type-filter").innerHTML = options.map(o =>
            `<option value="${esc(o.typeId)}" ${o.typeId === state.filterType ? "selected" : ""}>${esc(o.typeId ? o.name : "Alle Typen")} (${o.count})</option>`).join("");
        fitTypeFilter();
    }

    // Typfilter als Badges; passen sie nicht in die Kopfzeile, übernimmt das Dropdown.
    function fitTypeFilter() {
        const chips = $("type-chips");
        const select = $("type-filter");
        const show = D.groupByType(resources()).length > 1;
        chips.hidden = !show;
        select.hidden = true;
        if (show && chips.scrollWidth > chips.clientWidth) {
            chips.hidden = true;
            select.hidden = false;
        }
    }

    function setFilterType(typeId) {
        state.filterType = typeId;
        renderFilter();
        renderTable();
    }

    function renderTable() {
        const list = resources();
        if (!list.length) {
            $("res-body").innerHTML = `<tr><td colspan="4" class="dp-empty">Noch keine Ressourcen</td></tr>`;
            return;
        }
        if (state.filterType || state.query) {
            const hits = list
                .filter(r => !state.filterType || String(r.type_id) === state.filterType)
                .filter(r => D.matches(r, state.query))
                .sort(D.byIdentifier);
            $("res-body").innerHTML = hits.length
                ? hits.map(r => renderRow(r, 0, { showParent: true })).join("")
                : `<tr><td colspan="4" class="dp-empty">Keine Treffer</td></tr>`;
            return;
        }
        const tree = D.resourceTree(list);
        $("res-body").innerHTML = tree.roots.map(r => renderNode(tree, r, 0)).join("");
    }

    function renderNode(tree, r, depth) {
        const kids = tree.childrenOf(r.resource_id);
        const nodeKey = `n:${r.resource_id}`;
        const open = !state.collapsed.has(nodeKey);
        let html = renderRow(r, depth, { toggle: kids.length ? { key: nodeKey, open } : null });
        if (!kids.length || !open) return html;

        D.groupByType(kids).forEach(group => {
            if (group.rows.length < SUBGROUP_MIN) {
                group.rows.forEach(child => { html += renderNode(tree, child, depth + 1); });
                return;
            }
            const key = `g:${r.resource_id}:${group.typeId}`;
            const groupOpen = !state.collapsed.has(key);
            html += `
                <tr class="dp-tree-sub ${groupOpen ? "" : "is-collapsed"}" data-toggle="${esc(key)}">
                    <td class="dp-tree-cell" style="--depth:${depth + 1}" colspan="4">
                        <span class="dp-tree-inner">
                            <span class="dp-tree-toggle" aria-hidden="true"><span class="dp-caret">▾</span></span>
                            ${esc(group.name)} <span class="dp-count">${group.rows.length}</span>
                        </span>
                    </td>
                </tr>`;
            if (groupOpen) group.rows.forEach(child => { html += renderNode(tree, child, depth + 2); });
        });
        return html;
    }

    function renderRow(r, depth, { toggle = null, showParent = false } = {}) {
        const foreign = foreignParent(r);
        const parent = showParent ? findResource(r.parent_resource_id) || foreign : foreign;
        const sub = parent ? ` · unter ${esc(parent.display_name)}` : "";
        const handling = D.handlingChip(r.override_handling_type || systemHandling(), r.override_handling_type ? "" : "Systemstandard");
        const backlog = r.backlog_identifier
            ? esc(backlogName(r.backlog_identifier))
            : `<span class="dp-muted">${state.system.default_backlog_identifier ? esc(backlogName(state.system.default_backlog_identifier)) : "–"}</span>`;
        return `
            <tr class="dp-row ${toggle && !toggle.open ? "is-collapsed" : ""}" data-res="${esc(r.resource_id)}">
                <td class="dp-tree-cell" style="--depth:${depth}">
                    <span class="dp-tree-inner">
                        ${toggle ? `<button type="button" class="dp-tree-toggle" data-toggle="${esc(toggle.key)}" aria-expanded="${toggle.open}" aria-label="${toggle.open ? "Zuklappen" : "Aufklappen"}"><span class="dp-caret">▾</span></button>` : ""}
                        <span class="dp-name"><strong>${esc(r.display_name || "-")}</strong><span class="dp-ident">${esc(r.technical_identifier || "")}${sub}</span></span>
                    </span>
                </td>
                <td>${esc(r.type_name || "-")}</td>
                <td>${handling}</td>
                <td>${backlog}</td>
            </tr>`;
    }

    // ---------- Panel ----------

    function openPanel(mode, resource = null) {
        if (mode !== "new" && !resource) return;
        state.panel = { mode, resource, activeTask: "ASSIGNMENT", snapshot: null, roles: null, guidePreview: false };
        renderPanel();
        $("res-panel-overlay").classList.add("active");
        if (resource) loadRoles(state.panel);
    }

    // Rollen der Ressource kommen nach; gezeigt nur, solange dasselbe Panel in der Ansicht offen ist.
    async function loadRoles(panel) {
        try {
            panel.roles = await D.getJson(`/api/resources/${panel.resource.resource_id}/roles`);
        } catch (error) {
            panel.roles = [];
            showFlash(error.message, "failure");
        }
        if (state.panel === panel && panel.mode === "view") renderPanel();
    }

    function closePanel() {
        $("res-panel-overlay").classList.remove("active");
        state.panel = null;
    }

    // Klick daneben, Escape und X: ungespeicherte Eingaben nicht stillschweigend verwerfen.
    function requestClosePanel() {
        if (!state.panel) return;
        if (isDirty() && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
        closePanel();
    }

    function formState() {
        return JSON.stringify([...$("res-panel-body").querySelectorAll("input, select, textarea")]
            .filter(el => el.id !== "f-parent-search")
            .map(el => (el.type === "radio" ? el.checked : el.value)));
    }

    function isDirty() {
        return state.panel?.snapshot != null && formState() !== state.panel.snapshot;
    }

    function renderPanel() {
        const { mode, resource: r } = state.panel;
        const isNew = mode === "new";
        $("res-panel-kicker").textContent = isNew ? state.system.name : (r.type_name || "Ressource");
        $("res-panel-title").textContent = isNew ? "Neue Ressource" : (r.display_name || "-");
        $("res-panel-ident").textContent = isNew ? "" : (r.technical_identifier || "");
        $("res-panel-chips").innerHTML = "";
        $("res-panel-body").classList.toggle("is-view", mode === "view");

        if (mode === "view") {
            state.panel.snapshot = null;
            const backlog = r.backlog_identifier || state.system.default_backlog_identifier;
            $("res-panel-body").innerHTML = D.renderResourceView(r, {
                handling: r.override_handling_type || systemHandling(),
                handlingIsDefault: !r.override_handling_type,
                backlogLabel: backlog ? esc(backlogName(backlog)) : `<span class="dp-muted">keins</span>`,
                backlogIsDefault: Boolean(backlog) && !r.backlog_identifier,
                classification: {
                    systemId: state.system.system_id,
                    ancestors: D.ancestorChain(r, lookupResource),
                    // Systemübergreifend, sobald /api/resources parent_resource_ids liefert; sonst nur das eigene System.
                    dependents: D.crossDependents(r.resource_id, state.allResources)
                        ?? D.resourceTree(resources()).childrenOf(r.resource_id)
                            .map(c => ({ ...c, system_id: state.system.system_id, system_name: state.system.name }))
                },
                roles: state.panel.roles || undefined,
                recipientLabel: userLabel,
                guideCatalog: state.guideCatalog,
                activeTask: state.panel.activeTask
            });
            $("res-panel-actions").innerHTML = `<button type="button" class="btn btn-primary" data-panel-edit>Bearbeiten</button>`;
            return;
        }

        $("res-panel-body").innerHTML = renderForm(isNew ? null : r);
        $("res-panel-actions").innerHTML = `
            <button type="button" class="btn btn-secondary" data-panel-cancel>Abbrechen</button>
            <button type="button" class="btn btn-primary" data-panel-save>${isNew ? "Anlegen" : "Speichern"}</button>`;
        syncForm();
        state.panel.snapshot = formState();
    }

    function identifierPrefix(typeId) {
        const type = state.types.find(t => String(t.type_id) === String(typeId));
        return type?.slug ? window.ResourceIdentifier.prefix(state.system.short_name, type.slug) : "";
    }

    // Konto ist eine Sonderressource: höchstens eins je System, Identifier fest <Kürzel>-<Slug>,
    // und es ist die Standard-Voraussetzung der übrigen Ressourcen des Systems.
    function isAccountType(typeId) {
        return String(typeId) === String(ACCOUNT_TYPE_ID);
    }

    function ownAccountId() {
        const account = resources().find(r => isAccountType(r.type_id));
        return account ? String(account.resource_id) : "";
    }

    function accountIdentifier(typeId) {
        return identifierPrefix(typeId).replace(/-$/, "");
    }

    // Typ und Identifier stehen nach dem Anlegen fest: Integrationen und Backlogs verweisen auf den Identifier.
    function renderForm(r) {
        const accountTaken = Boolean(ownAccountId());
        const typeId = r?.type_id
            ?? state.types.find(t => !(isAccountType(t.type_id) && accountTaken))?.type_id
            ?? state.types[0]?.type_id;
        const prefix = identifierPrefix(typeId);
        const handlingOptions = [
            ["", `Systemstandard (${D.HANDLING[systemHandling()] || systemHandling()})`],
            ...D.handlingChoices(r?.override_handling_type).map(v => [v, D.HANDLING[v] || v])
        ];
        const sysBacklog = state.system.default_backlog_identifier;
        const backlogOptions = [["", sysBacklog ? `Systemstandard (${backlogName(sysBacklog)})` : "Systemstandard"],
            ...D.backlogOptions(state.backlogs, r?.backlog_identifier)];
        const currentParent = r?.parent_resource_id != null ? lookupResource(r.parent_resource_id) : null;
        const candidates = D.parentOptions(state.parentCandidates, r, currentParent, state.system.system_id);
        const parentId = String(r ? (r.parent_resource_id ?? "") : (isAccountType(typeId) ? "" : ownAccountId()));

        return `
            <section class="dp-section dp-form" data-form>
                <div class="dp-form-grid">
                    <div class="dp-field dp-span-2">
                        <label for="f-name">Name</label>
                        <input class="ui-input" id="f-name" value="${esc(r?.display_name || "")}">
                    </div>
                    <div class="dp-field">
                        <label for="f-type">Typ</label>
                        ${r
                            ? `<span class="dp-ident-fixed" id="f-type">${esc(r.type_name || "-")}</span>`
                            : `<select class="ui-input" id="f-type">${state.types.map(t => {
                                const blocked = isAccountType(t.type_id) && accountTaken;
                                return `<option value="${esc(t.type_id)}" ${String(t.type_id) === String(typeId) ? "selected" : ""} ${blocked ? "disabled" : ""}>${esc(t.name)}${blocked ? " (vorhanden)" : ""}</option>`;
                            }).join("")}</select>`}
                    </div>
                    <div class="dp-field">
                        <label for="f-ident">Identifier</label>
                        ${r
                            ? `<span class="dp-ident-fixed" id="f-ident">${esc(r.technical_identifier || "-")}</span>`
                            : `<span class="dp-ident-fixed" id="f-ident-account" ${isAccountType(typeId) ? "" : "hidden"}>${esc(accountIdentifier(typeId))}</span>
                            <div class="dp-prefixed" id="f-ident-wrap" ${isAccountType(typeId) ? "hidden" : ""}>
                                <span id="f-prefix" ${prefix ? "" : "hidden"}>${esc(prefix)}</span>
                                <input class="ui-input" id="f-ident" autocomplete="off">
                            </div>`}
                    </div>
                    <div class="dp-field">
                        <label for="f-handling">Bearbeitung</label>
                        <select class="ui-input" id="f-handling">${handlingOptions.map(([v, l]) =>
                            `<option value="${v}" ${v === (r?.override_handling_type || "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
                    </div>
                    <div class="dp-field">
                        <label for="f-backlog">Backlog</label>
                        <select class="ui-input" id="f-backlog">${backlogOptions.map(([v, l]) =>
                            `<option value="${esc(v)}" ${v === (r?.backlog_identifier || "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
                    </div>
                    <div class="dp-field dp-span-2 dp-pick">
                        <label for="f-parent-search">Übergeordnet</label>
                        <input type="search" class="ui-input" id="f-parent-search" placeholder="Konto suchen" autocomplete="off">
                        <div class="dp-pick-list" id="f-parent-list">
                            <label><input type="radio" name="f-parent" value="" ${parentId === "" ? "checked" : ""}> Keine</label>
                            ${candidates.map(c => `
                                <label data-search="${esc(`${c.display_name} ${c.technical_identifier || ""} ${c.system_name || ""}`.toLowerCase())}">
                                    <input type="radio" name="f-parent" value="${esc(c.resource_id)}" ${String(c.resource_id) === parentId ? "checked" : ""}>
                                    ${esc(c.display_name)} <span class="dp-ident">${esc(c.technical_identifier || "")}${String(c.system_id) === String(state.system.system_id) ? "" : ` · ${esc(c.system_name || "")}`}</span>
                                </label>`).join("")}
                        </div>
                    </div>
                </div>
            </section>
            <section class="dp-section" data-automation>
                <div class="dp-section-head">
                    <h3>Automatisierung</h3>
                    <div class="ui-segmented" role="group" aria-label="Vorgang">
                        ${D.TASK_TYPES.map(t => `<button type="button" data-form-task="${t.value}" aria-pressed="${t.value === state.panel.activeTask}">${t.label}</button>`).join("")}
                    </div>
                </div>
                ${D.TASK_TYPES.map(t => renderAutomationFields(r, t.value)).join("")}
            </section>
            ${renderGuideFields(r)}`;
    }

    // Anleitung je Vorgang, unabhängig von der Bearbeitung; der Vorgang-Umschalter ist mit der Automatisierung gekoppelt.
    function renderGuideFields(r) {
        const groups = window.ResourceGuide.groupCatalog(state.guideCatalog);
        return `
            <section class="dp-section" data-guide>
                <div class="dp-section-head">
                    <h3>Anleitung</h3>
                    <div class="dp-guide-tools">
                        ${groups.length ? `<select class="ui-input dp-guide-insert" data-guide-insert aria-label="Platzhalter einfügen">
                            <option value="">Platzhalter</option>
                            ${groups.map(group => `<optgroup label="${esc(group.name)}">${group.entries.map(entry =>
                                `<option value="${esc(entry.key)}">${esc(entry.label || entry.key)}</option>`).join("")}</optgroup>`).join("")}
                        </select>` : ""}
                        <button type="button" class="ui-flat-button ui-flat-button--sm" data-guide-preview aria-pressed="${state.panel.guidePreview}">Vorschau</button>
                        <div class="ui-segmented" role="group" aria-label="Vorgang">
                            ${D.TASK_TYPES.map(t => `<button type="button" data-form-task="${t.value}" aria-pressed="${t.value === state.panel.activeTask}">${t.label}</button>`).join("")}
                        </div>
                    </div>
                </div>
                ${D.TASK_TYPES.map(t => `
                <div class="dp-field" data-guide-fields="${t.value}">
                    <textarea class="ui-textarea" data-guide="${t.value}" rows="7" maxlength="${window.ResourceGuide.MAX_LENGTH}" aria-label="Anleitung ${esc(t.label)}">${esc(r?.guides?.[t.value] || "")}</textarea>
                    <div class="rg-guide dp-guide-preview" data-guide-preview-for="${t.value}" hidden></div>
                    <p class="dp-guide-unknown" data-guide-unknown="${t.value}" hidden></p>
                </div>`).join("")}
            </section>`;
    }

    // Unbekannte Platzhalter gleich am Feld; die API lehnt sie beim Speichern ohnehin ab (422).
    function syncGuide() {
        const body = $("res-panel-body");
        const preview = state.panel.guidePreview;
        body.querySelector("[data-guide-preview]")?.setAttribute("aria-pressed", String(preview));
        const insert = body.querySelector("[data-guide-insert]");
        if (insert) insert.disabled = preview;
        for (const { value: taskType } of D.TASK_TYPES) {
            const field = body.querySelector(`[data-guide="${taskType}"]`);
            if (!field) continue;
            const view = body.querySelector(`[data-guide-preview-for="${taskType}"]`);
            field.hidden = preview;
            view.hidden = !preview;
            if (preview) view.innerHTML = window.ResourceGuide.preview(field.value, state.guideCatalog) || `<p class="dp-note">Leer</p>`;
            const unknown = state.guideCatalog.length ? window.ResourceGuide.unknownKeys(field.value, state.guideCatalog) : [];
            const hint = body.querySelector(`[data-guide-unknown="${taskType}"]`);
            hint.hidden = !unknown.length;
            hint.textContent = unknown.length ? `Unbekannt: ${unknown.join(", ")}` : "";
        }
    }

    function insertPlaceholder(select) {
        const key = select.value;
        select.value = "";
        const field = $("res-panel-body").querySelector(`[data-guide="${state.panel.activeTask}"]`);
        if (!key || !field) return;
        field.focus();
        field.setRangeText(`{{${key}}}`, field.selectionStart, field.selectionEnd, "end");
        syncGuide();
    }

    // Nur geänderte Anleitungen; ein fehlender Schlüssel lässt die gespeicherte unverändert, null löscht sie.
    function buildGuides(r) {
        const guides = {};
        for (const { value: taskType } of D.TASK_TYPES) {
            const field = $("res-panel-body").querySelector(`[data-guide="${taskType}"]`);
            if (!field) continue;
            const value = field.value.trim();
            if (value !== String(r?.guides?.[taskType] || "").trim()) guides[taskType] = value || null;
        }
        return guides;
    }

    function renderAutomationFields(r, taskType) {
        const ext = r ? D.metaEntry(r, "EXTERNAL", taskType)?.meta || {} : {};
        const bot = r ? D.metaEntry(r, "BOT", taskType)?.meta : null;
        const contact = String(ext.external_contact ?? ext.recipient ?? "");
        const options = recipients().map(u => [String(u.user_id), `${u.first_name || ""} ${u.last_name || ""}`.trim()]);
        if (contact && !options.some(([v]) => v === contact)) options.push([contact, userLabel(contact)]);
        return `
            <div data-task-fields="${taskType}">
                <div class="dp-form" data-handling-fields="EXTERNAL">
                    <div class="dp-form-grid">
                        <div class="dp-field">
                            <label>Empfänger</label>
                            <select class="ui-input" data-meta="recipient"><option value="">Bitte wählen</option>${options.map(([v, l]) =>
                                `<option value="${esc(v)}" ${v === contact ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
                        </div>
                        <div class="dp-field">
                            <label>Betreff</label>
                            <input class="ui-input" data-meta="subject" value="${esc(ext.subject || "")}">
                        </div>
                        <div class="dp-field dp-span-2">
                            <label>Mailvorlage</label>
                            <textarea class="ui-textarea" data-meta="body" rows="6">${esc(ext.body || ext.mail_template || "")}</textarea>
                        </div>
                    </div>
                </div>
                <div class="dp-field" data-handling-fields="BOT">
                    <label>Parameter (JSON)</label>
                    <textarea class="ui-textarea dp-code" data-meta="bot" rows="5" placeholder='{"queue_id": "…"}'>${esc(D.botEditorValue(bot))}</textarea>
                </div>
                <p class="dp-note" data-handling-fields="INTERNAL">Manuell über das Backlog.</p>
            </div>`;
    }

    function selectedHandling() {
        return $("res-panel-body").querySelector("#f-handling")?.value || systemHandling();
    }

    // Sichtbarkeit der Formularteile nach Bearbeitung und Vorgang.
    function syncForm() {
        const body = $("res-panel-body");
        const handling = selectedHandling();
        body.querySelectorAll("[data-task-fields]").forEach(el => { el.hidden = el.dataset.taskFields !== state.panel.activeTask; });
        body.querySelectorAll("[data-guide-fields]").forEach(el => { el.hidden = el.dataset.guideFields !== state.panel.activeTask; });
        body.querySelectorAll("[data-handling-fields]").forEach(el => { el.hidden = el.dataset.handlingFields !== handling; });
        const segmented = body.querySelector("[data-automation] .ui-segmented");
        if (segmented) segmented.hidden = !D.AUTOMATED.includes(handling);
        syncGuide();
    }

    function showFormTask(taskType) {
        state.panel.activeTask = taskType;
        $("res-panel-body").querySelectorAll("[data-form-task]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.formTask === taskType)));
        syncForm();
    }

    // Nur beim Anlegen: Präfix und Voraussetzung folgen dem Typ, ein eingegebenes Kürzel bleibt.
    function onTypeChange() {
        const body = $("res-panel-body");
        const typeId = body.querySelector("#f-type").value;
        const prefix = identifierPrefix(typeId);
        const account = isAccountType(typeId);
        body.querySelector("#f-ident-wrap").hidden = account;
        body.querySelector("#f-ident-account").hidden = !account;
        body.querySelector("#f-ident-account").textContent = accountIdentifier(typeId);
        const prefixEl = body.querySelector("#f-prefix");
        prefixEl.hidden = !prefix;
        prefixEl.textContent = prefix;
        // Konto hängt an nichts; alles andere bekommt das Konto des Systems als Voraussetzung.
        const parentRadio = body.querySelector(`input[name="f-parent"][value="${account ? "" : ownAccountId()}"]`);
        if (parentRadio) parentRadio.checked = true;
    }

    // ---------- Speichern ----------

    // Liefert den Identifier einer neuen Ressource oder null mit Hinweis.
    function newIdentifier(typeId) {
        if (isAccountType(typeId)) return accountIdentifier(typeId);
        const input = $("res-panel-body").querySelector("#f-ident");
        const prefix = identifierPrefix(typeId);
        const code = input.value.trim().toUpperCase();
        if (!prefix) {
            if (input.value.trim()) return input.value.trim();
            showFlash("Bitte einen Identifier angeben", "failure");
            return null;
        }
        if (!window.ResourceIdentifier.isValidCode(code)) {
            showFlash("Kürzel: nur A–Z, 0–9 und einzelne Unterstriche", "failure");
            return null;
        }
        return prefix + code;
    }

    // Einträge der gewählten Bearbeitung je Vorgang; die API ersetzt nur diese, andere bleiben erhalten.
    function buildMeta(handling) {
        if (!D.AUTOMATED.includes(handling)) return [];
        const meta = [];
        for (const { value: taskType, label } of D.TASK_TYPES) {
            const fields = $("res-panel-body").querySelector(`[data-task-fields="${taskType}"] [data-handling-fields="${handling}"]`);
            const field = name => fields.querySelector(`[data-meta="${name}"]`).value.trim();
            let entry;
            if (handling === "EXTERNAL") {
                const recipient = field("recipient");
                entry = { external_contact: /^\d+$/.test(recipient) ? Number(recipient) : recipient, subject: field("subject"), body: field("body") };
            } else {
                entry = D.parseBotParams(field("bot"));
                if (!entry) {
                    showFormTask(taskType);
                    showFlash(`Parameter für ${label} sind kein gültiges JSON-Objekt`, "failure");
                    return null;
                }
            }
            meta.push({ handling_type: handling, task_type: taskType, meta: entry });
        }
        return meta;
    }

    async function saveResource(button) {
        const body = $("res-panel-body");
        const r = state.panel.resource;
        const name = body.querySelector("#f-name").value.trim();
        if (!name) {
            showFlash("Bitte einen Namen angeben", "failure");
            return;
        }
        const typeId = r ? r.type_id : Number(body.querySelector("#f-type").value);
        const technicalIdentifier = r ? r.technical_identifier : newIdentifier(typeId);
        if (technicalIdentifier === null) return;
        const meta = buildMeta(selectedHandling());
        if (meta === null) return;
        const parent = body.querySelector('input[name="f-parent"]:checked')?.value || "";

        const payload = {
            system_id: state.system.system_id,
            type_id: typeId,
            display_name: name,
            technical_identifier: technicalIdentifier,
            override_handling_type: body.querySelector("#f-handling").value || null,
            parent_resource_id: parent ? Number(parent) : null,
            backlog_identifier: body.querySelector("#f-backlog").value || null
        };
        if (meta.length) payload.meta = meta;
        const guides = buildGuides(r);
        if (Object.keys(guides).length) payload.guides = guides;
        if (r) payload.resource_id = r.resource_id;

        button.disabled = true;
        try {
            const saved = await D.send(r ? `/api/resources/${r.resource_id}` : "/api/resources", "POST", payload);
            showFlash(r ? "Ressource gespeichert" : "Ressource angelegt", "success");
            closePanel();
            await reload();
            const fresh = findResource(r ? r.resource_id : saved?.resource_id);
            if (fresh) openPanel("view", fresh);
        } catch (error) {
            // „Unbekannte Platzhalter in Anleitung ASSIGNMENT: …“ – zum betroffenen Vorgang wechseln, Label statt Kürzel.
            const failed = error.status === 422 ? D.TASK_TYPES.find(t => error.message.includes(`Anleitung ${t.value}`)) : null;
            if (failed) {
                state.panel.guidePreview = false;
                showFormTask(failed.value);
                $("res-panel-body").querySelector(`[data-guide="${failed.value}"]`)?.focus();
            }
            showFlash(failed ? error.message.replace(`Anleitung ${failed.value}`, `Anleitung (${failed.label})`) : error.message, "failure");
            button.disabled = false;
        }
    }

    // ---------- Typen ----------

    function openTypes() {
        renderTypes();
        $("types-form").reset();
        $("types-dialog").showModal();
    }

    // Nur systemeigene Typen sind löschbar, und nur unbenutzte.
    function renderTypes() {
        $("types-body").innerHTML = state.types.map(t => {
            const own = t.system_id != null;
            return `
                <tr>
                    <td>${esc(t.name)}</td>
                    <td class="dp-ident">${esc(t.slug)}</td>
                    <td>${esc(t.resource_count ?? 0)}</td>
                    <td>${own
                        ? `<button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm" data-type-delete="${esc(t.type_id)}" ${t.resource_count ? "disabled title=\"Wird noch verwendet\"" : ""} aria-label="${esc(t.name)} löschen">✕</button>`
                        : `<span class="dp-muted">global</span>`}</td>
                </tr>`;
        }).join("");
    }

    async function createType(event) {
        event.preventDefault();
        const payload = { name: $("type-name").value.trim(), slug: $("type-slug").value.trim().toUpperCase() };
        $("type-create-btn").disabled = true;
        try {
            const created = await D.send(`/api/systems/${state.systemId}/resource-types`, "POST", payload);
            showFlash(`Typ ${created?.name || payload.name} angelegt`, "success");
            $("types-form").reset();
        } catch (error) {
            showFlash(error.message, "failure");
        } finally {
            $("type-create-btn").disabled = false;
        }
        await reloadTypes();
    }

    async function deleteType(button) {
        const type = state.types.find(t => String(t.type_id) === button.dataset.typeDelete);
        button.disabled = true;
        try {
            await D.send(`/api/systems/${state.systemId}/resource-types/${button.dataset.typeDelete}`, "DELETE");
            showFlash(`Typ ${type?.name || ""} gelöscht`, "success");
        } catch (error) {
            showFlash(error.message, "failure");
        }
        await reloadTypes();
    }

    async function reloadTypes() {
        try {
            await reload();
        } catch (error) {
            showFlash(error.message, "failure");
        }
        renderTypes();
    }

    // ---------- System bearbeiten ----------

    function openSystemEdit() {
        const s = state.system;
        $("sys-name").value = s.name || "";
        $("sys-short").value = s.short_name || "";
        // Das Kürzel steckt in den Identifiern; änderbar nur, solange es keine Ressourcen gibt.
        $("sys-short").disabled = resources().length > 0;
        $("sys-backlog").innerHTML = `<option value="">keins</option>` + D.backlogOptions(state.backlogs, s.default_backlog_identifier)
            .map(([v, l]) => `<option value="${esc(v)}" ${v === s.default_backlog_identifier ? "selected" : ""}>${esc(l)}</option>`).join("");
        $("sys-handling").innerHTML = D.handlingChoices(systemHandling())
            .map(v => `<option value="${v}" ${v === systemHandling() ? "selected" : ""}>${esc(D.HANDLING[v] || v)}</option>`).join("");
        document.querySelectorAll("[data-pn]").forEach(select => {
            const current = s.protection_need?.[select.dataset.pn] || "";
            select.innerHTML = `<option value="">nicht gepflegt</option>` + Object.entries(D.PROTECTION)
                .map(([v, p]) => `<option value="${v}" ${v === current ? "selected" : ""}>${p.label}</option>`).join("");
        });
        syncOverall();
        $("sys-edit-dialog").showModal();
    }

    // Gesamt = höchste Einzelstufe (Maximumprinzip).
    function syncOverall() {
        const order = Object.keys(D.PROTECTION);
        const values = [...document.querySelectorAll("[data-pn]")].map(s => s.value).filter(Boolean);
        const overall = values.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0];
        $("sys-protection-overall").innerHTML = D.protectionChip(overall);
    }

    // Standard-Bearbeitung und Schutzziele nur, wenn geändert; overall leitet das API selbst ab.
    async function saveSystem(event) {
        event.preventDefault();
        const s = state.system;
        const payload = {
            name: $("sys-name").value.trim(),
            short_name: $("sys-short").disabled ? s.short_name : $("sys-short").value.trim(),
            default_backlog_identifier: $("sys-backlog").value || null
        };
        if ($("sys-handling").value !== systemHandling()) payload.default_handling_type = $("sys-handling").value;
        const protection = {};
        document.querySelectorAll("[data-pn]").forEach(select => {
            const value = select.value || null;
            if (value !== (s.protection_need?.[select.dataset.pn] || null)) protection[select.dataset.pn] = value;
        });
        if (Object.keys(protection).length) payload.protection_need = protection;
        $("sys-save-btn").disabled = true;
        try {
            await D.send(`/api/systems/${state.systemId}`, "POST", payload);
            showFlash("System gespeichert", "success");
            $("sys-edit-dialog").close();
            await reload();
        } catch (error) {
            showFlash(error.message, "failure");
        } finally {
            $("sys-save-btn").disabled = false;
        }
    }

    // ---------- Events ----------

    function bindEvents() {
        $("res-search").addEventListener("input", event => { state.query = event.target.value.trim(); renderTable(); });
        $("type-filter").addEventListener("change", event => setFilterType(event.target.value));
        $("type-chips").addEventListener("click", event => {
            const chip = event.target.closest("[data-type]");
            if (chip) setFilterType(chip.dataset.type);
        });
        new ResizeObserver(fitTypeFilter).observe($("type-chips").parentElement);
        $("res-body").addEventListener("click", event => {
            const toggle = event.target.closest("[data-toggle]");
            if (toggle) {
                const key = toggle.dataset.toggle;
                state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key);
                renderTable();
                return;
            }
            const row = event.target.closest("[data-res]");
            if (row) openPanel("view", findResource(row.dataset.res));
        });
        $("res-add-btn").addEventListener("click", () => openPanel("new"));
        $("types-btn").addEventListener("click", openTypes);
        $("sys-edit-btn").addEventListener("click", openSystemEdit);

        D.bindPanel($("res-panel-overlay"), requestClosePanel);
        ["sys-edit-dialog", "types-dialog"].forEach(id => D.bindDialog($(id)));

        $("res-panel-overlay").addEventListener("click", event => {
            if (!state.panel) return;
            const open = event.target.closest("[data-open-resource]");
            if (open && !open.disabled) {
                const target = findResource(open.dataset.openResource);
                if (target) openPanel("view", target);
                else if (open.dataset.system) location.href = `/systems/${open.dataset.system}?res=${open.dataset.openResource}`;
                return;
            }
            const viewTask = event.target.closest("[data-view-task]");
            if (viewTask) { state.panel.activeTask = viewTask.dataset.viewTask; renderPanel(); return; }
            if (event.target.closest("[data-guide-preview]")) { state.panel.guidePreview = !state.panel.guidePreview; syncGuide(); return; }
            const formTask = event.target.closest("[data-form-task]");
            if (formTask) { showFormTask(formTask.dataset.formTask); return; }
            if (event.target.closest("[data-panel-edit]")) { state.panel.mode = "edit"; renderPanel(); return; }
            if (event.target.closest("[data-panel-cancel]")) {
                state.panel.mode === "new" ? closePanel() : (state.panel.mode = "view", renderPanel());
                return;
            }
            const save = event.target.closest("[data-panel-save]");
            if (save) saveResource(save);
        });
        $("res-panel-body").addEventListener("change", event => {
            if (event.target.matches("[data-guide-insert]")) insertPlaceholder(event.target);
            if (event.target.id === "f-handling") syncForm();
            if (event.target.id === "f-type") onTypeChange();
        });
        $("res-panel-body").addEventListener("input", event => {
            if (event.target.matches("[data-guide]")) { syncGuide(); return; }
            if (event.target.id !== "f-parent-search") return;
            const q = event.target.value.trim().toLowerCase();
            $("f-parent-list").querySelectorAll("label[data-search]").forEach(label => {
                label.hidden = Boolean(q) && !label.dataset.search.includes(q) && !label.querySelector("input").checked;
            });
        });

        document.querySelectorAll("[data-pn]").forEach(select => select.addEventListener("change", syncOverall));
        $("sys-edit-form").addEventListener("submit", saveSystem);
        $("types-form").addEventListener("submit", createType);
        $("types-body").addEventListener("click", event => {
            const button = event.target.closest("[data-type-delete]");
            if (button && !button.disabled) deleteType(button);
        });
    }
}());
