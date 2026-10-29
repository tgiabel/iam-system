// Gemeinsame Bausteine für Rollen- und Systemdetails. Das Modell (Baum, Voraussetzungen, Bot-Parameter)
// ist DOM-frei und wird in tests/detail_shared_checks.js geprüft.
(function (root, factory) {
    const shared = factory(root.SofaUtils || require("./sofa_utils.js"));
    if (typeof module === "object" && module.exports) {
        module.exports = shared;
    }
    if (root) {
        root.DetailShared = shared;
    }
}(typeof window !== "undefined" ? window : globalThis, function (utils) {
    "use strict";

    const esc = utils.escapeHtml;

    const HANDLING = { INTERNAL: "Intern", BOT: "Bot", EXTERNAL: "Extern", EVENT: "Ereignis" };
    // Zur Auswahl; EVENT steuern Prozessereignisse, es bleibt nur stehen, wo es schon gesetzt ist.
    const HANDLING_CHOICES = ["INTERNAL", "BOT", "EXTERNAL"];
    const AUTOMATED = ["BOT", "EXTERNAL"];
    const STATUS = {
        ACTIVE: { label: "Aktiv", chip: "ui-chip-success" },
        INACTIVE: { label: "Inaktiv", chip: "ui-chip-neutral" }
    };
    // Lila = nachgelagert (zentrale Regel); Nachlieferung blockiert nur den Prozessabschluss.
    const REQUIREMENTS = {
        REQUIRED: { label: "Erforderlich", chip: "ui-chip-primary", hint: "Blockiert Rollenaktivierung und Prozessabschluss" },
        DEFERRED: { label: "Nachlieferung", chip: "ui-chip-purple", hint: "Blockiert nur den Prozessabschluss" }
    };
    const PROTECTION = {
        LOW: { label: "Gering", chip: "ui-chip-success" },
        ELEVATED: { label: "Erhöht", chip: "ui-chip-warning" },
        CRITICAL: { label: "Kritisch", chip: "ui-chip-error" }
    };
    const TASK_TYPES = [
        { value: "ASSIGNMENT", label: "Zuweisung" },
        { value: "REVOCATION", label: "Entzug" }
    ];

    async function getJson(url) {
        const { ok, data } = await utils.fetchJson(url);
        if (!ok) throw new Error(utils.apiErrorMessage(data, `Laden fehlgeschlagen: ${url}`));
        return data;
    }

    // Schreibt per POST/DELETE; Fehler der API kommen als Error mit deren Meldung zurück.
    async function send(url, method, payload) {
        const options = { method };
        if (payload !== undefined) {
            options.headers = { "Content-Type": "application/json" };
            options.body = JSON.stringify(payload);
        }
        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            throw new Error("Netzwerkfehler oder Server nicht erreichbar");
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(utils.apiErrorMessage(data, `Speichern fehlgeschlagen (${response.status})`));
        return data;
    }

    function chip(label, cls = "ui-chip-neutral", title = "") {
        return `<span class="ui-chip ui-chip-sm ${cls}"${title ? ` title="${esc(title)}"` : ""}>${esc(label)}</span>`;
    }

    function statusChip(value) {
        const status = STATUS[value] || { label: value || "-", chip: "ui-chip-neutral" };
        return chip(status.label, status.chip);
    }

    function requirementChip(value) {
        const req = REQUIREMENTS[String(value || "").toUpperCase()];
        return req ? chip(req.label, req.chip, req.hint) : `<span class="dp-muted">-</span>`;
    }

    // Auswahl der Bearbeitung; ein schon gesetzter Wert außerhalb der Auswahl bleibt wählbar.
    function handlingChoices(current) {
        return current && !HANDLING_CHOICES.includes(current) ? [...HANDLING_CHOICES, current] : HANDLING_CHOICES;
    }

    function protectionChip(level) {
        const p = PROTECTION[level];
        return p ? chip(`Schutzbedarf ${p.label}`, p.chip) : chip("Schutzbedarf nicht gepflegt", "ui-chip-neutral");
    }

    function compareText(a, b) {
        return String(a || "").localeCompare(String(b || ""), "de", { sensitivity: "base", numeric: true });
    }

    function byIdentifier(a, b) {
        return compareText(a.technical_identifier || a.display_name, b.technical_identifier || b.display_name);
    }

    function matches(resource, query) {
        if (!query) return true;
        const haystack = [resource.display_name, resource.technical_identifier, resource.type_name, resource.system_name]
            .join(" ").toLowerCase();
        return query.toLowerCase().split(/\s+/).every(part => haystack.includes(part));
    }

    // ---------- Modell ----------

    const idOf = r => String(r.resource_id);

    // Baum nach übergeordneter Ressource, jede Ressource genau einmal. Liegt die Voraussetzung nicht in der
    // Liste, ist die Ressource eine Wurzel; Zyklen im Bestand werden an der ersten Wiederkehr aufgetrennt.
    function resourceTree(list) {
        const ids = new Set(list.map(idOf));
        const byParent = new Map();
        list.forEach(r => {
            const parent = r.parent_resource_id == null ? "" : String(r.parent_resource_id);
            const key = ids.has(parent) ? parent : "";
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(r);
        });
        const children = new Map();
        const placed = new Set();
        const walk = r => {
            placed.add(idOf(r));
            const kids = (byParent.get(idOf(r)) || []).filter(k => !placed.has(idOf(k))).sort(byIdentifier);
            children.set(idOf(r), kids);
            kids.forEach(walk);
        };
        const roots = [...(byParent.get("") || [])].sort(byIdentifier);
        roots.forEach(walk);
        [...list].sort(byIdentifier).forEach(r => {
            if (!placed.has(idOf(r))) { roots.push(r); walk(r); }
        });
        return { roots, childrenOf: id => children.get(String(id)) || [] };
    }

    function groupByType(list) {
        const groups = new Map();
        list.forEach(r => {
            const key = String(r.type_id);
            if (!groups.has(key)) groups.set(key, { typeId: key, name: r.type_name || "-", rows: [] });
            groups.get(key).rows.push(r);
        });
        return [...groups.values()].sort((a, b) => compareText(a.name, b.name));
    }

    // Voraussetzungskette, nächste zuerst. lookup(id) liefert die Ressource oder null; endet bei Zyklen.
    function ancestorChain(resource, lookup) {
        const chain = [];
        const seen = new Set([idOf(resource)]);
        let id = resource.parent_resource_id;
        while (id != null && !seen.has(String(id))) {
            seen.add(String(id));
            const parent = lookup(id);
            if (!parent) break;
            chain.push(parent);
            id = parent.parent_resource_id;
        }
        return chain;
    }

    // Auswahl „Übergeordnet“: Kandidaten (Konten), eigenes System zuerst. Die aktuelle Voraussetzung steht
    // immer darin, auch wenn sie kein Konto ist; sonst ginge sie beim Speichern verloren.
    function parentOptions(candidates, resource, currentParent, systemId) {
        const own = c => String(c.system_id) === String(systemId);
        const options = candidates.filter(c => !resource || idOf(c) !== idOf(resource));
        if (currentParent && !options.some(c => idOf(c) === idOf(currentParent))) options.push(currentParent);
        return options.sort((a, b) => own(b) - own(a) || compareText(a.display_name, b.display_name));
    }

    // Backlog-Auswahl aus { identifier: name }. Der aktuelle Wert steht immer darin (ohne Namen als Identifier);
    // fehlt er, wäre „Systemstandard“ bzw. „keins“ vorgewählt und Speichern löschte ihn.
    function backlogOptions(backlogs, current) {
        const options = Object.entries(backlogs);
        if (current && !Object.prototype.hasOwnProperty.call(backlogs, current)) options.push([current, current]);
        return options;
    }

    // Bot-Parameter im Editor: Altbestand liegt unter data (Objekt oder JSON-Text).
    function botEditorValue(meta) {
        if (!meta || typeof meta !== "object") return "";
        if (Object.prototype.hasOwnProperty.call(meta, "data")) {
            if (typeof meta.data === "string") return meta.data;
            return meta.data && typeof meta.data === "object" ? JSON.stringify(meta.data, null, 2) : "";
        }
        return Object.keys(meta).length ? JSON.stringify(meta, null, 2) : "";
    }

    // Leer = {}; sonst muss es ein JSON-Objekt sein, andernfalls null.
    function parseBotParams(text) {
        const value = String(text || "").trim();
        if (!value) return {};
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    // ---------- Seitenpanel (ui-sidepanel) ----------

    function bindPanel(overlay, onClose) {
        overlay.addEventListener("click", event => {
            if (event.target === overlay || event.target.closest("[data-panel-close]")) onClose();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && overlay.classList.contains("active")) onClose();
        });
    }

    // ---------- Native Dialoge ----------

    function bindDialog(dialog) {
        window.SofaDialog.closeOnBackdrop(dialog);
        dialog.addEventListener("click", event => {
            if (event.target.closest("[data-dialog-close]")) dialog.close();
        });
    }

    // ---------- Ressourcen-Ansicht (lesend) ----------

    function metaEntry(resource, handling, taskType) {
        const entries = Array.isArray(resource.meta) ? resource.meta : [];
        return entries.find(e => e.handling_type === handling && e.task_type === taskType)
            || entries.find(e => e.handling_type === handling && !e.task_type)
            || null;
    }

    function handlingChip(handling, title = "") {
        return chip(HANDLING[handling] || handling || "-", handling === "BOT" ? "ui-chip-primary" : "ui-chip-neutral", title);
    }

    function renderAutomation(resource, handling, taskType, recipientLabel) {
        if (handling === "INTERNAL") {
            return `<p class="dp-note">Manuell über das Backlog.</p>`;
        }
        if (!AUTOMATED.includes(handling)) {
            return `<p class="dp-note">Über ein Prozessereignis.</p>`;
        }
        const entry = metaEntry(resource, handling, taskType);
        const meta = entry?.meta && typeof entry.meta === "object" ? entry.meta : null;
        if (!meta || !Object.keys(meta).length) {
            return `<p class="dp-note">Für ${taskType === "REVOCATION" ? "den Entzug" : "die Zuweisung"} nicht hinterlegt.</p>`;
        }
        if (handling === "EXTERNAL") {
            const contact = meta.external_contact ?? meta.recipient;
            return `
                <div class="dp-mailcard">
                    <div class="dp-mailcard-row"><span>An</span><strong>${esc(recipientLabel(contact))}</strong></div>
                    <div class="dp-mailcard-row"><span>Betreff</span><strong>${esc(meta.subject || "-")}</strong></div>
                    <pre class="dp-mail">${esc(meta.body || meta.mail_template || "")}</pre>
                </div>`;
        }
        const data = meta.data && typeof meta.data === "object" ? meta.data : meta;
        return `<table class="dp-params"><tbody>${Object.entries(data).map(([key, value]) => `
            <tr><td>${esc(key)}</td><td>${esc(typeof value === "object" ? JSON.stringify(value) : value)}</td></tr>`).join("")}
        </tbody></table>`;
    }

    function typeSummary(rows) {
        const counts = new Map();
        rows.forEach(r => counts.set(r.type_name || "-", (counts.get(r.type_name || "-") || 0) + 1));
        return [...counts].sort((x, y) => y[1] - x[1]).map(([name, n]) => `${n} ${name}`).join(" · ");
    }

    // Einordnung: Voraussetzungen (übergeordnete Ressourcen, nächste zuerst) explizit, abhängige Ressourcen
    // nach System gruppiert. Übergeordnet heißt technisch: Die Aufgabe bleibt blockiert, bis diese aktiv ist.
    // dep: { ancestors: [{ ...resource, inPackage? }], dependents: [resource], systemId (eigenes System,
    //       Systemname nur bei fremden), scope: "im Paket" | "" }
    function renderClassification(dep) {
        const ancestors = dep.ancestors || [];
        const parentsHtml = ancestors.length
            ? `<div class="dp-dep-list">${ancestors.map(a => `
                <div class="dp-dep-item">
                    <button type="button" class="dp-link" data-open-resource="${esc(a.resource_id)}" data-system="${esc(a.system_id ?? "")}">${esc(a.display_name)}</button>
                    <span class="dp-ident">${esc(a.technical_identifier || "")}${a.system_name && String(a.system_id) !== String(dep.systemId) ? ` · ${esc(a.system_name)}` : ""}</span>
                    ${a.inPackage === undefined ? "" : a.inPackage ? chip("im Paket", "ui-chip-success") : chip("nicht im Paket", "ui-chip-warning")}
                </div>`).join("")}</div>`
            : `<span class="dp-muted">keine</span>`;

        const groups = new Map();
        (dep.dependents || []).forEach(d => {
            const key = String(d.system_id ?? "");
            if (!groups.has(key)) groups.set(key, { name: d.system_name || "-", rows: [] });
            groups.get(key).rows.push(d);
        });
        const dependentsHtml = groups.size
            ? `<div class="dp-dep-list">${[...groups.values()].sort((x, y) => compareText(x.name, y.name)).map(g => `
                <div class="dp-dep-item">
                    <strong>${esc(g.name)}</strong><span class="dp-count">${g.rows.length}</span>
                    <span class="dp-muted">${esc(typeSummary(g.rows))}</span>
                </div>`).join("")}</div>`
            : `<span class="dp-muted">keine</span>`;

        return `
            <section class="dp-pblock">
                <div class="dp-pblock-head"><h3>Einordnung${dep.scope ? ` <span class="dp-muted">${esc(dep.scope)}</span>` : ""}</h3></div>
                <div class="dp-dep">
                    <div class="dp-dep-row"><span>Setzt voraus</span>${parentsHtml}</div>
                    <div class="dp-dep-row"><span>Voraussetzung für</span>${dependentsHtml}</div>
                </div>
            </section>`;
    }

    // ctx: handling, handlingIsDefault, backlogLabel, backlogIsDefault, classification (siehe oben), roles,
    //      system (Rollenseite: Systemlink), recipientLabel, activeTask
    function renderResourceView(resource, ctx) {
        const handling = ctx.handling;
        const activeTask = ctx.activeTask || "ASSIGNMENT";
        const roles = ctx.roles;

        const facts = [];
        if (ctx.system) {
            facts.push(["System", `<a class="dp-link" href="/systems/${esc(ctx.system.system_id)}">${esc(ctx.system.name)}</a>`]);
        }
        facts.push(["Bearbeitung", `${handlingChip(handling)}${ctx.handlingIsDefault ? " <small>Systemstandard</small>" : ""}`]);
        facts.push(["Backlog", `${ctx.backlogLabel}${ctx.backlogIsDefault ? " <small>Systemstandard</small>" : ""}`]);

        // Rollen aus GET /resources/{id}/roles: direkte zuerst, geerbte mit Quelle, inaktive gedämpft.
        const rolesBlock = Array.isArray(roles) ? `
            <section class="dp-pblock">
                <div class="dp-pblock-head"><h3>In Rollen <span class="dp-count">${roles.length}</span></h3></div>
                ${roles.length
                    ? `<div class="dp-dep-list">${roles.map(r => `
                        <div class="dp-dep-item ${r.role_status && r.role_status !== "ACTIVE" ? "is-inactive" : ""}">
                            <a class="dp-link" href="/roles/${esc(r.role_id)}">${esc(r.name)}</a>
                            ${r.provisioning_requirement ? requirementChip(r.provisioning_requirement) : ""}
                            ${r.inherited ? chip("geerbt", "ui-chip-neutral", r.source_role_name ? `von ${r.source_role_name}` : "") : ""}
                            ${r.role_status && r.role_status !== "ACTIVE" ? statusChip(r.role_status) : ""}
                        </div>`).join("")}</div>`
                    : `<p class="dp-note">In keiner Rolle.</p>`}
            </section>` : "";

        return `
            <div class="dp-facts">${facts.map(([k, v]) => `<div class="dp-fact"><span>${k}</span><strong>${v}</strong></div>`).join("")}</div>
            ${renderClassification(ctx.classification || {})}
            <section class="dp-pblock ${AUTOMATED.includes(handling) ? "is-accent" : ""}">
                <div class="dp-pblock-head">
                    <h3>Automatisierung</h3>
                    ${!AUTOMATED.includes(handling) ? "" : `
                    <div class="ui-segmented" role="group" aria-label="Vorgang">
                        ${TASK_TYPES.map(t => `<button type="button" data-view-task="${t.value}" aria-pressed="${t.value === activeTask}">${t.label}</button>`).join("")}
                    </div>`}
                </div>
                ${renderAutomation(resource, handling, activeTask, ctx.recipientLabel || (v => v ?? "-"))}
            </section>
            ${rolesBlock}`;
    }

    return {
        esc, HANDLING, AUTOMATED, STATUS, REQUIREMENTS, PROTECTION, TASK_TYPES,
        getJson, send, chip, statusChip, typeSummary, requirementChip, protectionChip, handlingChip, handlingChoices,
        compareText, byIdentifier, matches, bindPanel, bindDialog,
        resourceTree, groupByType, ancestorChain, parentOptions, backlogOptions, botEditorValue, parseBotParams,
        metaEntry, renderAutomation, renderResourceView
    };
}));
