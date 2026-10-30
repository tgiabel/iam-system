// Rollendetails: Paket nach System gruppiert, Ressource im Seitenpanel, Bearbeiten in Dialogen.
(function () {
    "use strict";

    const D = window.DetailShared;
    const esc = D.esc;
    const $ = id => document.getElementById(id);

    const ROLE_TYPES = { PRIMARY: "Hauptrolle", SECONDARY: "Nebenrolle", SKILL: "Skill", TEMPLATE: "Template" };

    const state = {
        roleId: null,
        role: null,
        roles: [],
        // Alle Ressourcen aus /api/resources/map: Namen für Voraussetzungen und Auswahl beim Hinzufügen
        resources: [],
        backlogs: {},
        origin: "all",
        query: "",
        collapsed: new Set(),
        collapseReady: false,
        selected: new Set(),
        // system_id → SystemContext, erst beim Öffnen einer Ressource geladen
        systemCtx: {},
        // user_id → Person aus der Reevaluierung (Dry Run): weicht vom Rollenpaket ab
        drift: new Map(),
        // resource_id → Bereitstellung je Zeile (Standard Erforderlich)
        addSelected: new Map(),
        reqTarget: "",
        panel: null,
        canOpenSystems: false,
        canOpenUsers: false
    };

    document.addEventListener("DOMContentLoaded", init);

    async function init() {
        state.roleId = $("role-page").dataset.roleId;
        state.canOpenSystems = hasPerm("SOFA-PAGE-SYS");
        state.canOpenUsers = hasPerm("SOFA-PAGE-USER");
        bindEvents();
        try {
            const [backlogs, resourceMap] = await Promise.all([
                D.getJson("/api/backlogs").catch(() => []),
                D.getJson("/api/resources/map").catch(() => ({}))
            ]);
            (Array.isArray(backlogs) ? backlogs : []).forEach(b => { state.backlogs[b.technical_identifier] = b.name; });
            state.resources = Object.entries(resourceMap || {}).map(([id, r]) => ({ ...r, resource_id: Number(id) }));
            await reload();
        } catch (error) {
            showFlash(error.message, "failure");
        }
    }

    async function reload() {
        const [role, roles] = await Promise.all([
            D.getJson(`/api/roles/${state.roleId}`),
            D.getJson("/api/roles").catch(() => [])
        ]);
        state.role = role;
        state.roles = Array.isArray(roles) ? roles : [];
        render();
        loadDrift();
    }

    // Dry Run der Reevaluierung (liest nur): Wer weicht heute vom Paket ab?
    async function loadDrift() {
        try {
            const data = await D.send(`/api/roles/${state.role.role_id}/resources/reevaluate`, "POST", { dry_run: true });
            state.drift = new Map((data?.users || []).map(u => [String(u.user_id), u]));
        } catch (error) {
            state.drift = new Map();
            showFlash(error.message, "failure");
        }
        renderPeople();
    }

    // ---------- Daten ----------

    function packageRows() {
        const own = (state.role.resources || []).map(r => ({ ...r, inherited: false }));
        const inherited = (state.role.inherited_resources || []).map(r => ({ ...r, inherited: true }));
        return [...own, ...inherited];
    }

    function rowKey(r) {
        return `${r.inherited ? "i" : "o"}:${r.resource_id}`;
    }

    function listedResource(id) {
        return state.resources.find(x => String(x.resource_id) === String(id)) || null;
    }

    function assignedPeople() {
        return [...(state.role.assigned_to || [])]
            .sort((a, b) => D.compareText(`${a.last_name} ${a.first_name}`, `${b.last_name} ${b.first_name}`));
    }

    function childRoles() {
        return state.roles
            .filter(r => r.parent_role_name && r.parent_role_name === state.role.name)
            .sort((a, b) => D.compareText(a.name, b.name));
    }

    function initials(first, last) {
        return `${String(first || "").charAt(0)}${String(last || "").charAt(0)}`.toUpperCase() || "?";
    }

    function formatDate(value) {
        if (!value) return "-";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("de-DE");
    }

    // ---------- Render ----------

    function render() {
        renderHead();
        renderPackage();
        renderPeople();
    }

    function renderHead() {
        const role = state.role;
        document.title = `${role.name} | SOFA`;
        $("role-title").textContent = role.name;
        $("role-chips").innerHTML = D.chip(ROLE_TYPES[role.role_type] || role.role_type, "ui-chip-primary")
            + D.statusChip(role.status);
        $("role-desc").textContent = role.description || "";
        $("role-desc").hidden = !role.description;

        const meta = [];
        if (role.parent_role_id) {
            meta.push(["Erbt von", `<a href="/roles/${esc(role.parent_role_id)}">${esc(role.parent_role_name || role.parent_role_id)}</a>`]);
        }
        meta.push(["Angelegt", esc(formatDate(role.created_at))]);
        meta.push(["ID", esc(role.role_id)]);
        $("role-meta").innerHTML = meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    }

    function renderPackage() {
        const rows = packageRows();
        const hasInherited = rows.some(r => r.inherited);
        $("pkg-count").textContent = rows.length;
        $("pkg-origin").hidden = !hasInherited;
        document.querySelector('[data-col="origin"]').hidden = !hasInherited;
        if (!hasInherited) state.origin = "all";
        document.querySelectorAll("#pkg-origin button").forEach(btn => {
            btn.setAttribute("aria-pressed", String(btn.dataset.origin === state.origin));
        });

        const visible = rows
            .filter(r => state.origin === "all" || (state.origin === "inherited") === r.inherited)
            .filter(r => D.matches(r, state.query));

        const colspan = hasInherited ? 5 : 4;
        if (!visible.length) {
            $("pkg-body").innerHTML = `<tr><td colspan="${colspan}" class="dp-empty">${rows.length ? "Keine Treffer" : "Noch keine Ressourcen"}</td></tr>`;
            updateBulk();
            return;
        }

        const groups = packageGroups(visible);
        // Beim Öffnen ist nur der oberste Block aufgeklappt.
        if (!state.collapseReady) {
            groups.slice(1).forEach(g => state.collapsed.add(String(g.id)));
            state.collapseReady = true;
        }
        const allOpen = groups.every(g => !state.collapsed.has(String(g.id)));
        $("pkg-toggle-all").hidden = groups.length < 2 || Boolean(state.query);
        const toggle = $("pkg-toggle-all");
        toggle.innerHTML = allOpen ? ICON_COLLAPSE : ICON_EXPAND;
        toggle.title = allOpen ? "Alle zuklappen" : "Alle aufklappen";
        toggle.setAttribute("aria-label", toggle.title);

        $("pkg-body").innerHTML = groups.map(group => {
            const collapsed = state.collapsed.has(String(group.id)) && !state.query;
            const head = `
                <tr class="dp-group-row dp-block-head ${collapsed ? "is-collapsed" : ""}" data-group="${esc(group.id)}" aria-expanded="${!collapsed}">
                    <td colspan="${colspan}">
                        <span class="dp-block-head-inner">
                            <span class="dp-caret" aria-hidden="true">▾</span>
                            <span>${esc(group.name)}</span>
                            <span class="dp-count">${group.rows.length}</span>
                            <span class="dp-block-types">${esc(D.typeSummary(group.rows))}</span>
                            <span class="dp-block-summary">${requirementSummary(group.rows)}</span>
                            ${state.canOpenSystems ? `<a class="dp-row-icon" href="/systems/${esc(group.id)}" title="System öffnen" aria-label="${esc(group.name)} öffnen">${ICON_OPEN}</a>` : ""}
                        </span>
                    </td>
                </tr>`;
            if (collapsed) return head;
            return head + group.rows.sort(D.byIdentifier).map(r => renderRow(r, hasInherited)).join("");
        }).join("");
        updateBulk();
    }

    const ICON_EXPAND = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></svg>`;
    const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20l5-5 5 5"/><path d="M7 4l5 5 5-5"/></svg>`;

    const ICON_OPEN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`;

    function packageGroups(rows) {
        const groups = new Map();
        rows.forEach(r => {
            const key = String(r.system_id ?? "");
            if (!groups.has(key)) groups.set(key, { id: r.system_id, name: r.system_name || "Ohne System", rows: [] });
            groups.get(key).rows.push(r);
        });
        return [...groups.values()].sort((a, b) => D.compareText(a.name, b.name));
    }

    function requirementSummary(rows) {
        const deferred = rows.filter(r => String(r.provisioning_requirement).toUpperCase() === "DEFERRED").length;
        const inherited = rows.filter(r => r.inherited).length;
        return (deferred ? D.chip(`${deferred} Nachlieferung`, "ui-chip-purple") : "")
            + (inherited ? D.chip(`${inherited} geerbt`, "ui-chip-neutral") : "");
    }

    // Übergeordnete Ressource = Voraussetzung: Die Aufgabe bleibt blockiert, bis die Person sie aktiv hat.
    function missingPrerequisite(r) {
        if (r.parent_resource_id == null) return null;
        const ids = new Set(packageRows().map(x => String(x.resource_id)));
        if (ids.has(String(r.parent_resource_id))) return null;
        return listedResource(r.parent_resource_id) || { resource_id: r.parent_resource_id, display_name: `#${r.parent_resource_id}` };
    }

    function renderRow(r, hasInherited) {
        const key = rowKey(r);
        const missing = missingPrerequisite(r);
        const checked = state.selected.has(key);
        const origin = r.inherited
            ? `<a class="dp-link" href="/roles/${esc(r.source_role_id || "")}" title="Änderbar an dieser Rolle">${esc(r.source_role_name || "geerbt")}</a>`
            : `<span class="dp-muted">eigene</span>`;
        return `
            <tr class="dp-row dp-in-block ${checked ? "is-selected" : ""}" data-key="${esc(key)}">
                <td class="dp-col-check">
                    ${r.inherited
                        ? ""
                        : `<input type="checkbox" data-check="${esc(key)}" ${checked ? "checked" : ""} aria-label="${esc(r.display_name)} auswählen">`}
                </td>
                <td><div class="dp-name"><strong>${esc(r.display_name || "-")}</strong><span class="dp-ident">${esc(r.technical_identifier || "")}</span>
                    ${missing ? D.chip("Voraussetzung nicht im Paket", "ui-chip-warning", `Setzt ${missing.display_name} voraus`) : ""}</div></td>
                <td>${esc(r.type_name || "-")}</td>
                <td>${D.requirementChip(r.provisioning_requirement)}</td>
                ${hasInherited ? `<td>${origin}</td>` : ""}
            </tr>`;
    }

    function renderPeople() {
        const people = assignedPeople();
        $("assigned-count").textContent = people.length;
        const driftCount = state.drift.size;
        $("sync-note").hidden = driftCount === 0;
        $("sync-note-text").textContent = `${driftCount} nicht aktuell`;
        $("assigned-list").innerHTML = people.length
            ? people.map(p => {
                const name = `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.pnr;
                const drift = state.drift.has(String(p.user_id));
                const inner = `
                    <span class="dp-avatar" aria-hidden="true">${esc(initials(p.first_name, p.last_name))}</span>
                    <span class="dp-people-name">${esc(name)}<small>${esc(p.pnr || "")}</small></span>
                    ${drift ? `<span class="dp-dot" title="Rollenpaket nicht aktuell"></span>` : ""}`;
                // Deep-Link in die Userverwaltung gibt es noch nicht (vorgemerkt).
                return `<li>${state.canOpenUsers ? `<a href="/users?user_id=${esc(p.user_id)}">${inner}</a>` : `<span>${inner}</span>`}</li>`;
            }).join("")
            : `<li class="dp-empty">Niemand</li>`;

        const children = childRoles();
        $("children-card").hidden = !children.length;
        $("children-count").textContent = children.length;
        $("children-list").innerHTML = children.map(r => `
            <li><a href="/roles/${esc(r.role_id)}">
                <span class="dp-people-name">${esc(r.name)}<small>${esc(ROLE_TYPES[r.role_type] || r.role_type)}</small></span>
            </a></li>`).join("");
    }

    // ---------- Auswahl / Bulk-Leiste ----------

    function selectedRows() {
        return packageRows().filter(r => state.selected.has(rowKey(r)));
    }

    function updateBulk() {
        const count = state.selected.size;
        $("pkg-bulk").hidden = count === 0;
        $("pkg-bulk-count").textContent = `${count} ausgewählt`;
        const ownVisible = [...document.querySelectorAll("#pkg-body [data-check]")];
        const all = $("pkg-check-all");
        all.checked = ownVisible.length > 0 && ownVisible.every(cb => cb.checked);
        all.indeterminate = !all.checked && ownVisible.some(cb => cb.checked);
        all.disabled = ownVisible.length === 0;
    }

    // ---------- Ressource ansehen ----------

    // Einmal je System, erst beim Öffnen einer Ressource.
    function systemContext(systemId) {
        if (!(systemId in state.systemCtx)) {
            state.systemCtx[systemId] = D.getJson(`/api/systems/${systemId}`).catch(error => {
                showFlash(error.message, "failure");
                return null;
            });
        }
        return state.systemCtx[systemId];
    }

    // Paketzeilen kennen ihre Voraussetzung; sonst liefert sie das System der Ressource.
    async function resourceWithParent(id) {
        const row = packageRows().find(x => String(x.resource_id) === String(id));
        if (row) return row;
        const listed = listedResource(id);
        if (!listed) return null;
        const sys = await systemContext(listed.system_id);
        const full = (sys?.resources || []).find(x => String(x.resource_id) === String(id));
        return { ...listed, parent_resource_id: full?.parent_resource_id ?? null };
    }

    // Voraussetzungskette, auch systemübergreifend, nächste zuerst; endet bei Zyklen.
    async function ancestorsOf(r) {
        const chain = [];
        const seen = new Set([String(r.resource_id)]);
        let parentId = r.parent_resource_id;
        while (parentId != null && !seen.has(String(parentId))) {
            seen.add(String(parentId));
            const parent = await resourceWithParent(parentId);
            if (!parent) break;
            chain.push(parent);
            parentId = parent.parent_resource_id;
        }
        return chain;
    }

    async function openResource(key) {
        const r = packageRows().find(row => rowKey(row) === key);
        if (!r) return;
        const panel = { key, resource: r, sys: null, ancestors: [], roles: undefined, activeTask: "ASSIGNMENT" };
        state.panel = panel;
        const [sys, ancestors] = await Promise.all([systemContext(r.system_id), ancestorsOf(r)]);
        if (state.panel !== panel) return;
        panel.sys = sys;
        const inPackage = new Set(packageRows().map(x => String(x.resource_id)));
        panel.ancestors = ancestors.map(a => ({ ...a, inPackage: inPackage.has(String(a.resource_id)) }));

        $("res-panel-kicker").textContent = r.type_name || "Ressource";
        $("res-panel-title").textContent = r.display_name || "-";
        $("res-panel-ident").textContent = r.technical_identifier || "";
        $("res-panel-chips").innerHTML = D.requirementChip(r.provisioning_requirement)
            + (r.inherited ? D.chip(`geerbt von ${r.source_role_name || "?"}`, "ui-chip-neutral") : "");
        // Geerbte Ressourcen ändert man an der Rolle, von der sie kommen.
        $("res-panel-own-actions").hidden = r.inherited;
        $("res-panel-source-link").hidden = !r.inherited;
        $("res-panel-source-link").href = `/roles/${r.source_role_id || ""}`;
        $("res-panel-source-link").textContent = `An ${r.source_role_name || "Ursprungsrolle"} ändern`;
        $("res-panel-system-link").hidden = !state.canOpenSystems;
        $("res-panel-system-link").href = `/systems/${r.system_id}?res=${r.resource_id}`;
        renderPanel();
        $("res-panel-overlay").classList.add("active");
        loadRoles(panel);
    }

    async function loadRoles(panel) {
        try {
            panel.roles = await D.getJson(`/api/resources/${panel.resource.resource_id}/roles`);
        } catch (error) {
            panel.roles = [];
            showFlash(error.message, "failure");
        }
        if (state.panel === panel) renderPanel();
    }

    function renderPanel() {
        const { resource: r, sys } = state.panel;
        // RoleContext liefert keine Automatisierung (meta); sie steht an der Ressource im System.
        const full = (sys?.resources || []).find(x => String(x.resource_id) === String(r.resource_id));
        const backlogId = r.backlog_identifier || sys?.default_backlog_identifier;
        const body = $("res-panel-body");
        body.classList.add("is-view");
        body.innerHTML = D.renderResourceView({ ...r, meta: full?.meta ?? r.meta }, {
            handling: r.override_handling_type || sys?.default_handling_type || "INTERNAL",
            handlingIsDefault: !r.override_handling_type,
            backlogLabel: backlogId ? esc(state.backlogs[backlogId] || backlogId) : `<span class="dp-muted">keins</span>`,
            backlogIsDefault: Boolean(backlogId) && !r.backlog_identifier,
            classification: {
                ancestors: state.panel.ancestors,
                dependents: packageRows().filter(x => String(x.parent_resource_id ?? "") === String(r.resource_id)),
                systemId: r.system_id,
                scope: "im Paket"
            },
            roles: state.panel.roles,
            system: { system_id: r.system_id, name: r.system_name || "-", linked: state.canOpenSystems },
            activeTask: state.panel.activeTask
        });
    }

    function closeResource() {
        $("res-panel-overlay").classList.remove("active");
        state.panel = null;
    }

    // ---------- Rolle bearbeiten ----------

    function openEdit() {
        const role = state.role;
        $("edit-name").value = role.name || "";
        $("edit-desc").value = role.description || "";
        $("edit-type").innerHTML = Object.entries(ROLE_TYPES)
            .map(([v, l]) => `<option value="${v}" ${v === role.role_type ? "selected" : ""}>${l}</option>`).join("");
        setEditStatus(role.status || "ACTIVE");
        $("edit-parent").innerHTML = `<option value="">Keine</option>` + state.roles
            .filter(r => r.role_id !== role.role_id)
            .sort((a, b) => D.compareText(a.name, b.name))
            .map(r => `<option value="${esc(r.role_id)}" ${String(r.role_id) === String(role.parent_role_id ?? "") ? "selected" : ""}>${esc(r.name)} · ${esc(ROLE_TYPES[r.role_type] || r.role_type)}</option>`)
            .join("");
        $("role-edit-dialog").showModal();
    }

    function setEditStatus(value) {
        $("edit-status").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === value)));
    }

    async function saveRole(event) {
        event.preventDefault();
        const parent = $("edit-parent").value;
        const payload = {
            name: $("edit-name").value.trim(),
            description: $("edit-desc").value.trim() || null,
            role_type: $("edit-type").value,
            status: $("edit-status").querySelector('[aria-pressed="true"]')?.dataset.value || "ACTIVE",
            parent_role_id: parent ? Number(parent) : null
        };
        if (!payload.name) {
            showFlash("Bitte einen Namen angeben", "failure");
            return;
        }
        $("edit-save-btn").disabled = true;
        try {
            await D.send(`/api/roles/${state.role.role_id}`, "POST", payload);
            showFlash("Rolle gespeichert", "success");
            $("role-edit-dialog").close();
            await reload();
        } catch (error) {
            showFlash(error.message, "failure");
        } finally {
            $("edit-save-btn").disabled = false;
        }
    }

    // ---------- Paket ändern ----------

    // Ergebnis als Flash, danach in jedem Fall neu laden (auch nach Teilerfolg).
    async function changePackage(action, success) {
        try {
            await action();
            showFlash(success, "success");
        } catch (error) {
            showFlash(error.message, "failure");
        }
        state.selected.clear();
        try {
            await reload();
        } catch (error) {
            showFlash(error.message, "failure");
        }
    }

    function openAdd() {
        state.addSelected.clear();
        $("add-search").value = "";
        const systems = new Map(state.resources.map(r => [String(r.system_id), r.system_name || String(r.system_id)]));
        $("add-system").innerHTML = `<option value="">Alle Systeme</option>` + [...systems]
            .sort((a, b) => D.compareText(a[1], b[1]))
            .map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
        renderAdd();
        $("add-dialog").showModal();
        $("add-search").focus();
    }

    function renderAdd() {
        const query = $("add-search").value.trim();
        const system = $("add-system").value;
        const inPackage = new Set(packageRows().map(r => String(r.resource_id)));
        const list = state.resources
            .filter(r => !system || String(r.system_id) === system)
            .filter(r => D.matches(r, query));

        const groups = new Map();
        list.forEach(r => {
            const key = String(r.system_id);
            if (!groups.has(key)) groups.set(key, { name: r.system_name || key, rows: [] });
            groups.get(key).rows.push(r);
        });

        $("add-body").innerHTML = list.length
            ? [...groups.values()].sort((a, b) => D.compareText(a.name, b.name)).map(group => `
                <tr class="dp-group-row"><td colspan="4">${esc(group.name)} <span class="dp-count">${group.rows.length}</span></td></tr>
                ${group.rows.sort(D.byIdentifier).map(r => {
                    const id = String(r.resource_id);
                    const has = inPackage.has(id);
                    const req = state.addSelected.get(id);
                    return `
                        <tr class="${has ? "is-disabled" : "dp-row"} ${req ? "is-selected" : ""}" data-add="${esc(id)}">
                            <td class="dp-col-check"><input type="checkbox" ${has || req ? "checked" : ""} ${has ? "disabled" : ""} aria-label="${esc(r.display_name)}"></td>
                            <td><div class="dp-name"><strong>${esc(r.display_name)}</strong><span class="dp-ident">${esc(r.technical_identifier || "")}</span></div></td>
                            <td>${esc(r.type_name || "")}</td>
                            <td class="dp-row-req">${has
                                ? `<span class="dp-muted">im Paket</span>`
                                : req ? `
                                    <div class="ui-segmented" role="group" aria-label="Bereitstellung">
                                        ${Object.entries(D.REQUIREMENTS).map(([value, def]) =>
                                            `<button type="button" data-req="${value}" aria-pressed="${value === req}" title="${esc(def.hint)}">${def.label}</button>`).join("")}
                                    </div>` : ""}</td>
                        </tr>`;
                }).join("")}`).join("")
            : `<tr><td colspan="4" class="dp-empty">Keine Treffer</td></tr>`;

        const count = state.addSelected.size;
        const deferred = [...state.addSelected.values()].filter(v => v === "DEFERRED").length;
        $("add-summary").innerHTML = count
            ? `${count} ausgewählt${deferred ? ` ${D.chip(`${deferred} Nachlieferung`, "ui-chip-purple")}` : ""}`
            : "";
        $("add-submit").disabled = count === 0;
        $("add-submit").textContent = count ? `${count} hinzufügen` : "Hinzufügen";
    }

    // Die API nimmt je Aufruf eine Bereitstellung: ein Aufruf je gewähltem Wert.
    function addResources() {
        const byRequirement = new Map();
        state.addSelected.forEach((requirement, id) => {
            if (!byRequirement.has(requirement)) byRequirement.set(requirement, []);
            byRequirement.get(requirement).push(Number(id));
        });
        const count = state.addSelected.size;
        $("add-dialog").close();
        return changePackage(async () => {
            for (const [requirement, ids] of byRequirement) {
                await D.send(`/api/roles/${state.role.role_id}/resources`, "POST", {
                    resource_ids: ids,
                    provisioning_requirement: requirement
                });
            }
        }, `${count} ${count === 1 ? "Ressource" : "Ressourcen"} hinzugefügt`);
    }

    function openRequirement() {
        const rows = selectedRows();
        $("req-list").innerHTML = rows.map(r => `<li>${esc(r.display_name)} ${D.requirementChip(r.provisioning_requirement)}</li>`).join("");
        $("req-reason").value = "";
        setReqTarget("");
        $("req-dialog").showModal();
    }

    // Ressourcen, die schon den Zielwert haben, werden übersprungen.
    function requirementChanges() {
        return selectedRows().filter(r => String(r.provisioning_requirement || "").toUpperCase() !== state.reqTarget);
    }

    function setReqTarget(value) {
        state.reqTarget = value;
        $("req-target").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.value === value)));
        $("req-hint").textContent = D.REQUIREMENTS[value]?.hint || "";
        $("req-submit").disabled = !value || requirementChanges().length === 0;
    }

    function saveRequirement(event) {
        event.preventDefault();
        const rows = requirementChanges();
        if (!state.reqTarget || !rows.length) return;
        const reason = $("req-reason").value.trim();
        const label = D.REQUIREMENTS[state.reqTarget].label;
        $("req-dialog").close();
        return changePackage(() => D.send(`/api/roles/${state.role.role_id}/resources/requirement`, "POST", {
            resource_ids: rows.map(r => r.resource_id),
            requirement: state.reqTarget,
            reason
        }), `${rows.length} auf ${label} geändert`);
    }

    function openRemove() {
        const rows = selectedRows();
        const removing = new Set(rows.map(r => String(r.resource_id)));
        $("rm-list").innerHTML = rows.map(r => `<li>${esc(r.display_name)} <span class="dp-ident">${esc(r.technical_identifier || "")}</span></li>`).join("");
        // Bleibende Ressourcen, die eine der entfernten voraussetzen, wären danach dauerhaft blockiert.
        const orphans = packageRows().filter(r => !removing.has(String(r.resource_id))
            && removing.has(String(r.parent_resource_id ?? "")));
        $("rm-warning").hidden = !orphans.length;
        $("rm-warning").innerHTML = orphans.length
            ? `${D.chip("Voraussetzung", "ui-chip-warning")} <span>für ${orphans.map(o => `<strong>${esc(o.display_name)}</strong>`).join(", ")}, die im Paket bleiben</span>`
            : "";
        $("rm-dialog").showModal();
    }

    function removeResources(event) {
        event.preventDefault();
        const ids = selectedRows().map(r => r.resource_id);
        $("rm-dialog").close();
        return changePackage(() => D.send(`/api/roles/${state.role.role_id}/resources`, "DELETE", { resource_ids: ids }),
            `${ids.length} ${ids.length === 1 ? "Ressource" : "Ressourcen"} entfernt`);
    }

    // ---------- Events ----------

    function bindEvents() {
        $("pkg-search").addEventListener("input", event => { state.query = event.target.value.trim(); renderPackage(); });
        $("pkg-origin").addEventListener("click", event => {
            const btn = event.target.closest("[data-origin]");
            if (!btn) return;
            state.origin = btn.dataset.origin;
            renderPackage();
        });

        $("pkg-body").addEventListener("click", event => {
            const group = event.target.closest("[data-group]");
            if (group && !event.target.closest("a")) {
                const id = group.dataset.group;
                state.collapsed.has(id) ? state.collapsed.delete(id) : state.collapsed.add(id);
                renderPackage();
                return;
            }
            const check = event.target.closest("[data-check]");
            if (check) {
                check.checked ? state.selected.add(check.dataset.check) : state.selected.delete(check.dataset.check);
                check.closest("tr").classList.toggle("is-selected", check.checked);
                updateBulk();
                return;
            }
            const row = event.target.closest(".dp-row");
            if (row && !event.target.closest("a, .dp-col-check")) openResource(row.dataset.key);
        });

        $("pkg-check-all").addEventListener("change", event => {
            document.querySelectorAll("#pkg-body [data-check]").forEach(cb => {
                event.target.checked ? state.selected.add(cb.dataset.check) : state.selected.delete(cb.dataset.check);
            });
            renderPackage();
        });

        $("pkg-toggle-all").addEventListener("click", () => {
            const ids = packageGroups(packageRows()).map(g => String(g.id));
            const allOpen = ids.every(id => !state.collapsed.has(id));
            ids.forEach(id => allOpen ? state.collapsed.add(id) : state.collapsed.delete(id));
            renderPackage();
        });

        $("bulk-clear-btn").addEventListener("click", () => { state.selected.clear(); renderPackage(); });
        $("bulk-req-btn").addEventListener("click", openRequirement);
        $("bulk-rm-btn").addEventListener("click", openRemove);
        // Einzelaktionen aus dem Panel laufen über dieselben Dialoge wie die Auswahl.
        const fromPanel = open => () => {
            state.selected = new Set([state.panel.key]);
            closeResource();
            renderPackage();
            open();
        };
        $("res-panel-remove").addEventListener("click", fromPanel(openRemove));
        $("res-panel-req").addEventListener("click", fromPanel(openRequirement));
        $("pkg-add-btn").addEventListener("click", openAdd);
        $("role-edit-btn").addEventListener("click", openEdit);

        D.bindPanel($("res-panel-overlay"), closeResource);
        $("res-panel-body").addEventListener("click", event => {
            if (!state.panel) return;
            const open = event.target.closest("[data-open-resource]");
            if (open) {
                // Ohne Systemseite bleibt man im Panel, sofern die Voraussetzung im Paket liegt.
                const target = packageRows().find(x => String(x.resource_id) === open.dataset.openResource);
                if (state.canOpenSystems) {
                    location.href = `/systems/${open.dataset.system || state.panel.resource.system_id}?res=${open.dataset.openResource}`;
                } else if (target) {
                    openResource(rowKey(target));
                }
                return;
            }
            const tab = event.target.closest("[data-view-task]");
            if (!tab) return;
            state.panel.activeTask = tab.dataset.viewTask;
            renderPanel();
        });

        ["role-edit-dialog", "add-dialog", "req-dialog", "rm-dialog"].forEach(id => D.bindDialog($(id)));

        $("edit-status").addEventListener("click", event => {
            const btn = event.target.closest("[data-value]");
            if (btn) setEditStatus(btn.dataset.value);
        });
        $("role-edit-form").addEventListener("submit", saveRole);

        $("add-search").addEventListener("input", renderAdd);
        $("add-system").addEventListener("change", renderAdd);
        $("add-body").addEventListener("click", event => {
            const row = event.target.closest(".dp-row[data-add]");
            if (!row) return;
            const id = row.dataset.add;
            const req = event.target.closest("[data-req]");
            if (req) {
                state.addSelected.set(id, req.dataset.req);
            } else if (!event.target.closest(".dp-row-req")) {
                state.addSelected.has(id) ? state.addSelected.delete(id) : state.addSelected.set(id, "REQUIRED");
            }
            renderAdd();
        });
        $("add-submit").addEventListener("click", addResources);

        $("req-target").addEventListener("click", event => {
            const btn = event.target.closest("[data-value]");
            if (btn) setReqTarget(btn.dataset.value);
        });
        $("req-form").addEventListener("submit", saveRequirement);
        $("rm-form").addEventListener("submit", removeResources);
    }
}());
