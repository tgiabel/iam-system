// Rollenmanagement: links der Vererbungsbaum der Funktionen (Templates + Hauptrollen), rechts die
// Neben- und Skillrollen. Vererbung gibt es nur zwischen Funktionen. Daten aus /api/views/roles.
document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    const L = window.SofaList;
    const { escapeHtml, fetchJson, apiErrorMessage } = window.SofaUtils;
    const root = document.getElementById("roles-page");
    const mock = root.dataset.mock || "";
    const params = new URLSearchParams(window.location.search);

    const TREE_TYPES = new Set(["PRIMARY", "TEMPLATE"]);
    const TYPE_LABELS = { PRIMARY: "Hauptrolle", TEMPLATE: "Template", SECONDARY: "Nebenrolle", SKILL: "Skill" };
    const QUICK = {
        noUsers: { label: "ohne User", test: role => role.role_type !== "TEMPLATE" && !users(role).length },
        noResources: { label: "ohne Ressourcen", test: role => !resources(role).length }
    };

    const view = {
        search: "",
        showInactive: false,
        quick: null,
        // Vorfilter /roles?system=<id>: Rollen mit eigener Zuordnung einer Ressource des Systems.
        system: params.get("system") || null,
        flatType: "ALL",
        collapsed: new Set(),
        sort: { key: "name", dir: "asc" }
    };

    // resource_items: die wirksamen Ressourcen (geerbte eingerechnet), je mit resource_id und system_id.
    const resources = role => Array.isArray(role.resource_items) ? role.resource_items : [];
    const users = role => Array.isArray(role.assigned_to) ? role.assigned_to : [];
    const isInactive = role => String(role.role_status || "").toUpperCase() === "INACTIVE";
    const byName = (left, right) => left.name.localeCompare(right.name, "de");

    // ---------- Beziehungen (immer über alle Rollen, unabhängig von Filtern) ----------

    let data = { roles: [], systems: [], users: [] };
    let loadState = "loading";
    let loadError = "";
    let roleById = new Map();
    let childrenOf = new Map();
    let systemById = new Map();
    let functionOf = new Map();

    function setData(next) {
        data = { roles: next.roles || [], systems: next.systems || [], users: next.users || [] };
        roleById = new Map(data.roles.map(role => [String(role.role_id), role]));
        childrenOf = new Map();
        data.roles.forEach(role => {
            const parent = parentOf(role);
            if (parent) {
                childrenOf.set(parent, [...(childrenOf.get(parent) || []), role]);
            }
        });
        systemById = new Map(data.systems.map(system => [String(system.system_id), system]));
        functionOf = new Map(data.users.map(user => [`${user.first_name} ${user.last_name}`, user.primary_role?.name]));
    }

    function parentOf(role) {
        const parent = TREE_TYPES.has(role.role_type) ? roleById.get(String(role.parent_role_id ?? "")) : null;
        return parent && parent !== role ? parent : null;
    }

    const descendants = role => (childrenOf.get(role) || []).flatMap(child => [child, ...descendants(child)]);

    // Templates haben keine eigenen User; gezeigt werden die User aller Funktionen darunter.
    const usersOf = role => role.role_type === "TEMPLATE"
        ? [...new Set(descendants(role).flatMap(users))]
        : users(role);

    // Geerbt ist, was die Elternrolle wirksam hat; zugeordnet über die ID, denn Namen sind nicht eindeutig.
    const inheritedOf = role => new Set(parentOf(role) ? resources(parentOf(role)).map(item => item.resource_id) : []);
    const ownResources = role => {
        const inherited = inheritedOf(role);
        return resources(role).filter(item => !inherited.has(item.resource_id));
    };

    const shortOf = item => systemById.get(String(item.system_id))?.short_name || "–";
    const resourceLabel = item => {
        const system = shortOf(item);
        return item.display_name.startsWith(`${system} `) ? item.display_name : `${system} ${item.display_name}`;
    };

    function systemsOf(role) {
        const counts = new Map();
        resources(role).forEach(item => counts.set(shortOf(item), (counts.get(shortOf(item)) || 0) + 1));
        return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "de"));
    }

    // ---------- Filtern ----------

    function baseRoles() {
        return data.roles.filter(role => view.showInactive || !isInactive(role));
    }

    // Im Baum zählen nur die eigenen Ressourcen: Was ein Template vergibt, steht am Template, nicht an jeder Erbin.
    const searchValues = role => [role.name, role.role_id, ...ownResources(role).map(resourceLabel), ...users(role)];

    const matchesSystem = role => !view.system || ownResources(role).some(item => String(item.system_id) === view.system);

    function matches(role) {
        return (!view.quick || QUICK[view.quick].test(role)) && matchesSystem(role)
            && L.matchesSearch(view.search, searchValues(role));
    }

    const isFiltering = () => Boolean(view.search.trim() || view.quick || view.system);

    // Bei einer Suche: warum die Rolle trifft, wenn nicht über den Namen.
    function hitHint(role) {
        const term = view.search.trim();
        if (!term || L.matchesSearch(term, [role.name, role.role_id])) {
            return "";
        }
        const hits = [...ownResources(role).map(resourceLabel), ...users(role)].filter(value => L.matchesSearch(term, [value]));
        return hits.length
            ? `<span class="al-hit">${escapeHtml(hits[0])}${hits.length > 1 ? ` +${hits.length - 1}` : ""}</span>`
            : "";
    }

    // ---------- Zellen und Tooltips (gemeinsam für Baum und Tabelle) ----------

    const num = (value, tip, extraClass = "") => value
        ? `<span class="ui-hint${extraClass}" data-tip="${tip}" tabindex="0">${value}</span>`
        : '<span class="ui-table-muted">–</span>';

    function systemsCell(role) {
        const systems = systemsOf(role);
        if (!systems.length) {
            return "";
        }
        const more = systems.length > 3 ? `<span class="al-more">+${systems.length - 3}</span>` : "";
        return `<span class="al-systems" data-tip="resources" tabindex="0">${systems.slice(0, 3).map(([system]) => `<span class="al-sys">${escapeHtml(system)}</span>`).join("")}${more}</span>`;
    }

    const tipGroup = L.tipGroup;

    function resourceItems(items) {
        const bySystem = new Map();
        items.forEach(item => {
            const system = shortOf(item);
            const label = item.display_name.startsWith(`${system} `) ? item.display_name.slice(system.length + 1) : item.display_name;
            bySystem.set(system, [...(bySystem.get(system) || []), label]);
        });
        return [...bySystem].sort((left, right) => left[0].localeCompare(right[0], "de"))
            .map(([system, list]) => `<li><strong>${escapeHtml(system)}</strong> ${escapeHtml(list.sort().join(" · "))}</li>`);
    }

    function resourcesTip(role) {
        const inherited = inheritedOf(role);
        const own = resources(role).filter(item => !inherited.has(item.resource_id));
        const fromParent = resources(role).filter(item => inherited.has(item.resource_id));
        if (!fromParent.length) {
            return tipGroup(`Ressourcen · ${own.length}`, resourceItems(own));
        }
        return (own.length ? tipGroup(`Eigene · ${own.length}`, resourceItems(own)) : "")
            + tipGroup(`Geerbt von ${parentOf(role).name} · ${fromParent.length}`, resourceItems(fromParent));
    }

    // Hauptrollen: Namen. Templates, Neben- und Skillrollen: Verteilung nach Funktion.
    function usersTip(role) {
        const list = usersOf(role);
        if (role.role_type === "PRIMARY") {
            const names = [...list].sort((left, right) => left.localeCompare(right, "de"));
            const shown = names.slice(0, 12).map(name => `<li>${escapeHtml(name)}</li>`);
            return tipGroup(`User · ${names.length}`, names.length > 12 ? [...shown, `<li class="ui-table-muted">+${names.length - 12} weitere</li>`] : shown);
        }
        const counts = new Map();
        list.forEach(name => {
            const label = functionOf.get(name) || "Unbekannt";
            counts.set(label, (counts.get(label) || 0) + 1);
        });
        return tipGroup(`Nach Funktion · ${list.length}`, L.tipCounts(counts));
    }

    const menuButton = role => L.menuButton(role.role_id, role.name);

    const inactiveTag = role => isInactive(role) ? '<span class="al-tag">Inaktiv</span>' : "";

    // ---------- Baum ----------

    function buildTree(roles) {
        const set = new Set(roles);
        const children = new Map();
        const roots = [];
        roles.forEach(role => {
            const parent = parentOf(role);
            if (parent && set.has(parent)) {
                children.set(parent, [...(children.get(parent) || []), role]);
            } else {
                roots.push(role);
            }
        });
        // Unter einem Template erst die Hauptrollen, dann die weiteren Templates; ganz oben Templates zuerst.
        const order = templatesFirst => (left, right) => {
            const rank = role => (role.role_type === "TEMPLATE") === templatesFirst ? 0 : 1;
            return rank(left) - rank(right) || byName(left, right);
        };
        children.forEach(list => list.sort(order(false)));
        roots.sort(order(true));
        return { roots, children };
    }

    function treeRow(role, depth, childCount, collapsed, state) {
        const id = escapeHtml(role.role_id);
        const isTemplate = role.role_type === "TEMPLATE";
        const twisty = childCount
            ? `<button type="button" class="al-twisty" data-toggle="${id}" aria-label="${collapsed ? "Ausklappen" : "Einklappen"}" aria-expanded="${!collapsed}">
                   <svg class="ui-icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
               </button>`
            : '<span class="al-twisty" aria-hidden="true"></span>';
        const classes = ["al-tree-row", isTemplate ? "is-template" : "is-primary", childCount ? "" : "is-leaf",
            state === "context" ? "is-context" : "",
            isInactive(role) ? "is-inactive" : ""].filter(Boolean).join(" ");
        return `
            <li role="treeitem" aria-level="${depth + 1}"${childCount ? ` aria-expanded="${!collapsed}"` : ""} class="${classes}" style="--depth:${depth}" data-open="${id}" tabindex="0">
                <span class="al-tree-name">
                    ${twisty}
                    <span class="al-role-name">${escapeHtml(role.name)}</span>
                    ${isTemplate ? '<span class="al-tag al-tag--template">Template</span>' : ""}
                    ${inactiveTag(role)}
                    ${collapsed ? `<span class="al-more">+${descendants(role).length}</span>` : ""}
                    ${hitHint(role)}
                </span>
                <span class="al-col-sys">${systemsCell(role)}</span>
                <span class="al-num">${num(resources(role).length, "resources")}</span>
                <span class="al-num">${num(usersOf(role).length, "users", isTemplate ? " al-num-sum" : "")}</span>
                <span class="al-act">${menuButton(role)}</span>
            </li>`;
    }

    function renderTree() {
        const roles = baseRoles().filter(role => TREE_TYPES.has(role.role_type));
        const { roots, children } = buildTree(roles);
        const filtering = isFiltering();

        // Sichtbar: Treffer und ihre Vorfahren (als Kontext abgeschwächt).
        const visible = new Map();
        const walk = role => {
            const childHit = (children.get(role) || []).map(walk).some(Boolean);
            const hit = !filtering || matches(role);
            if (hit || childHit) {
                visible.set(role, hit ? "hit" : "context");
            }
            return hit || childHit;
        };
        roots.forEach(walk);

        const rows = [];
        const emit = (role, depth) => {
            if (!visible.has(role)) {
                return;
            }
            const kids = (children.get(role) || []).filter(child => visible.has(child));
            const collapsed = !filtering && kids.length > 0 && view.collapsed.has(String(role.role_id));
            rows.push(treeRow(role, depth, kids.length, collapsed, visible.get(role)));
            if (!collapsed) {
                kids.forEach(child => emit(child, depth + 1));
            }
        };
        // Hauptrollen ohne Vererbung stehen abgesetzt unter dem Baum.
        const standalone = roots.filter(role => role.role_type !== "TEMPLATE" && !children.has(role));
        roots.filter(role => !standalone.includes(role)).forEach(role => emit(role, 0));
        if (standalone.some(role => visible.has(role))) {
            rows.push('<li class="al-tree-section" role="presentation">Ohne Vererbung</li>');
            standalone.forEach(role => emit(role, 0));
        }

        const hits = [...visible.values()].filter(state => state === "hit").length;
        document.getElementById("roles-tree-count").textContent = filtering ? `${hits} von ${roles.length}` : roles.length;
        document.getElementById("roles-tree").innerHTML = rows.join("") || '<li class="ui-list-empty">Keine Treffer</li>';
        return hits;
    }

    // ---------- Neben- und Skillrollen ----------

    const SORT_KEYS = {
        name: role => role.name,
        type: role => TYPE_LABELS[role.role_type],
        resources: role => resources(role).length,
        users: role => users(role).length,
        _tie: role => role.name
    };

    const SORT_COLUMNS = {
        name: [{ key: "name", dir: "asc", label: "Name A–Z" }, { key: "name", dir: "desc", label: "Name Z–A" }],
        type: [{ key: "type", dir: "asc", label: "Nebenrollen zuerst" }, { key: "type", dir: "desc", label: "Skills zuerst" }],
        resources: [{ key: "resources", dir: "desc", label: "Meiste Ressourcen zuerst" }, { key: "resources", dir: "asc", label: "Wenigste Ressourcen zuerst" }],
        users: [{ key: "users", dir: "desc", label: "Meiste User zuerst" }, { key: "users", dir: "asc", label: "Wenigste User zuerst" }]
    };

    // Ausgeblendete Spalten (Container-Query) zählen im festen Tabellenlayout mit; Zeilen über die ganze Breite
    // spannen deshalb nur die sichtbaren Spalten.
    function flatSpan() {
        const table = document.getElementById("roles-table");
        table.classList.toggle("is-all", view.flatType === "ALL");
        return [...table.tHead.rows[0].cells].filter(cell => getComputedStyle(cell).display !== "none").length;
    }

    function renderFlat() {
        const shown = baseRoles().filter(role => !TREE_TYPES.has(role.role_type) && matches(role));
        const counts = { ALL: shown.length };
        ["SECONDARY", "SKILL"].forEach(type => {
            counts[type] = shown.filter(role => role.role_type === type).length;
        });
        Object.entries(counts).forEach(([type, count]) => {
            root.querySelector(`[data-type-count="${type}"]`).textContent = count;
        });
        root.querySelectorAll("#roles-flat-type [data-type]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.type === view.flatType));
        });
        const table = document.getElementById("roles-table");
        table.classList.toggle("is-all", view.flatType === "ALL");

        const rows = L.sortBy(shown.filter(role => view.flatType === "ALL" || role.role_type === view.flatType), SORT_KEYS, view.sort);
        document.getElementById("roles-body").innerHTML = rows.length ? rows.map(role => `
            <tr class="ui-table-row${isInactive(role) ? " is-inactive" : ""}" data-open="${escapeHtml(role.role_id)}" tabindex="0">
                <td class="al-name-cell"><span class="al-role-name">${escapeHtml(role.name)}</span>${inactiveTag(role)}${hitHint(role)}</td>
                <td class="al-col-type ui-table-muted">${escapeHtml(TYPE_LABELS[role.role_type])}</td>
                <td class="al-col-sys">${systemsCell(role)}</td>
                <td class="ui-table-num">${num(resources(role).length, "resources")}</td>
                <td class="ui-table-num">${num(users(role).length, "users")}</td>
                <td class="ui-table-action">${menuButton(role)}</td>
            </tr>`).join("")
            : `<tr><td colspan="${flatSpan()}" class="ui-list-empty">Keine Treffer</td></tr>`;
        return shown.length;
    }

    // ---------- Kopfbereich ----------

    function renderQuick() {
        const roles = baseRoles();
        const quick = Object.entries(QUICK).map(([id, item]) => {
            const count = roles.filter(item.test).length;
            if (!count && view.quick !== id) {
                return "";
            }
            return `<button type="button" class="ui-quick-filter" data-quick="${id}" aria-pressed="${view.quick === id}"><strong>${count}</strong> ${escapeHtml(item.label)}</button>`;
        }).filter(Boolean);
        const system = view.system ? systemById.get(view.system) : null;
        const token = view.system ? `
            <span class="ui-filter-token">
                ${escapeHtml(system?.name || `System ${view.system}`)}
                <button type="button" data-token-system aria-label="Filter entfernen">&times;</button>
            </span>` : "";
        document.getElementById("roles-quick").innerHTML = [
            ...quick,
            token && quick.length ? '<span class="ui-quick-sep" aria-hidden="true"></span>' : "",
            token
        ].join("");
    }

    function renderState() {
        const message = loadState === "loading"
            ? '<span class="ui-list-loading">Lädt …</span>'
            : `<span class="ui-list-error">${escapeHtml(loadError)}</span> <button type="button" class="ui-flat-button ui-flat-button--sm" data-reload>Erneut laden</button>`;
        document.getElementById("roles-tree").innerHTML = `<li class="ui-list-empty">${message}</li>`;
        // Die Meldung steht einmal, im Baum; die Tabelle bleibt leer.
        document.getElementById("roles-body").innerHTML = "";
        flatSpan();
        document.getElementById("roles-count").textContent = "";
        document.getElementById("roles-tree-count").textContent = "";
    }

    function render() {
        document.getElementById("roles-inactive").setAttribute("aria-pressed", String(view.showInactive));
        if (loadState !== "ready") {
            renderState();
            return;
        }
        renderQuick();
        const hits = renderTree() + renderFlat();
        const total = baseRoles().length;
        document.getElementById("roles-count").textContent = isFiltering() ? `${hits} von ${total}` : `${total} Rollen`;
    }

    async function load() {
        // Beim ersten Laden zeigt die Seite „Lädt …“; ein späterer Fehler lässt den letzten Stand stehen.
        if (loadState !== "ready") {
            loadState = "loading";
            render();
        }
        const { ok, data: payload } = await fetchJson(window.SofaUtils.withParams("/api/views/roles", mock ? { mock } : {}))
            .catch(() => ({ ok: false, data: null }));
        if (ok && payload) {
            setData(payload);
            loadState = "ready";
        } else if (loadState === "ready") {
            showFlash(apiErrorMessage(payload, "Rollen konnten nicht geladen werden"), "failure");
        } else {
            loadState = "error";
            loadError = apiErrorMessage(payload, "Rollen konnten nicht geladen werden");
        }
        render();
    }

    // ---------- Schreiben ----------

    async function send(url, payload) {
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

    // ---------- Anlegen ----------

    const dialog = document.getElementById("roles-create-dialog");
    const form = document.getElementById("roles-create-form");
    const typeSelect = document.getElementById("roles-create-type");
    const parentField = document.getElementById("roles-create-parent-field");

    function syncCreateFields() {
        // Vererbung nur für Funktionen: Elternrollen sind die Templates.
        parentField.hidden = !TREE_TYPES.has(typeSelect.value);
    }

    const options = (roles, placeholder) => (placeholder ? `<option value="">${placeholder}</option>` : "") + roles
        .filter(role => !isInactive(role)).sort(byName)
        .map(role => `<option value="${escapeHtml(role.role_id)}">${escapeHtml(role.name)}</option>`).join("");

    function openCreate({ type = "PRIMARY", parent = "" } = {}) {
        form.reset();
        typeSelect.value = type;
        document.getElementById("roles-create-parent").innerHTML = options(data.roles.filter(role => role.role_type === "TEMPLATE"), "Keine");
        document.getElementById("roles-create-parent").value = parent;
        syncCreateFields();
        dialog.showModal();
    }

    document.getElementById("roles-create").addEventListener("click", () => openCreate());
    typeSelect.addEventListener("change", syncCreateFields);
    dialog.querySelectorAll("[data-dialog-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
    window.SofaDialog.closeOnBackdrop(dialog);
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (mock) {
            dialog.close();
            showFlash("Rolle angelegt (Mock)", "success");
            return;
        }
        const fields = new FormData(form);
        const parent = TREE_TYPES.has(typeSelect.value) ? fields.get("parent_role_id") : "";
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            await send("/api/roles", {
                name: String(fields.get("name") || "").trim(),
                role_type: typeSelect.value,
                description: String(fields.get("description") || "").trim(),
                parent_role_id: parent ? Number(parent) : null
            });
            dialog.close();
            showFlash("Rolle angelegt", "success");
            await load();
        } catch (error) {
            showFlash(error.message, "failure");
        } finally {
            submit.disabled = false;
        }
    });

    // ---------- Deaktivieren und Aktivieren ----------

    // Nur ohne User und ohne aktive Kindrollen. Die SD-API sperrt zusätzlich bei laufenden Zuweisungen (409).
    const canToggle = role => !users(role).length && !(childrenOf.get(role) || []).some(child => !isInactive(child));

    async function setStatus(role, status) {
        if (mock) {
            showFlash(`${status === "ACTIVE" ? "Aktiviert" : "Deaktiviert"}: ${role.name} (Mock)`, "success");
            return;
        }
        try {
            // POST /roles/{id} ersetzt die ganze Rolle; ohne parent_role_id fiele die Elternrolle weg.
            const { ok, data: current } = await fetchJson(`/api/roles/${encodeURIComponent(role.role_id)}`);
            if (!ok || !current) {
                throw new Error(apiErrorMessage(current, "Rolle konnte nicht geladen werden"));
            }
            await send(`/api/roles/${encodeURIComponent(role.role_id)}`, {
                name: current.name,
                description: current.description ?? "",
                role_type: current.role_type,
                parent_role_id: current.parent_role_id ?? null,
                status
            });
            showFlash(`${status === "ACTIVE" ? "Aktiviert" : "Deaktiviert"}: ${role.name}`, "success");
            await load();
        } catch (error) {
            showFlash(error.message, "failure");
        }
    }

    const confirmDialog = document.getElementById("roles-confirm-dialog");
    let confirmRole = null;
    function confirmDeactivate(role) {
        confirmRole = role;
        document.getElementById("roles-confirm-name").textContent = role.name;
        confirmDialog.showModal();
    }
    confirmDialog.querySelectorAll("[data-dialog-close]").forEach(button => button.addEventListener("click", () => confirmDialog.close()));
    window.SofaDialog.closeOnBackdrop(confirmDialog);
    document.getElementById("roles-confirm-form").addEventListener("submit", event => {
        event.preventDefault();
        confirmDialog.close();
        if (confirmRole) {
            setStatus(confirmRole, "INACTIVE");
        }
    });

    // ---------- Zeilenmenü ----------

    function menuItems(role) {
        const items = [{ id: "details", label: "Details öffnen" }];
        if (role.role_type !== "TEMPLATE") {
            items.push({ id: "users", label: "User anzeigen" });
        }
        if (role.role_type === "TEMPLATE") {
            items.push({ separator: true }, { id: "new-primary", label: "Hauptrolle darunter anlegen" }, { id: "new-template", label: "Template darunter anlegen" });
        }
        if (canToggle(role)) {
            items.push({ separator: true }, isInactive(role)
                ? { id: "activate", label: "Aktivieren" }
                : { id: "deactivate", label: "Deaktivieren", danger: true });
        }
        return items;
    }

    const withMock = values => new URLSearchParams(mock ? { ...values, mock } : values);

    function runAction(id, role) {
        const roleId = String(role.role_id);
        if (id === "new-primary" || id === "new-template") {
            openCreate({ type: id === "new-primary" ? "PRIMARY" : "TEMPLATE", parent: roleId });
        } else if (id === "users") {
            // Userverwaltung mit dieser Rolle als Filter.
            window.location.href = `/users?${withMock({ role: roleId })}`;
        } else if (id === "deactivate") {
            confirmDeactivate(role);
        } else if (id === "activate") {
            setStatus(role, "ACTIVE");
        } else if (mock) {
            showFlash(`Detailseite ${role.name} (Mock)`, "success");
        } else {
            window.location.href = `/roles/${encodeURIComponent(roleId)}`;
        }
    }

    // ---------- Ereignisse ----------

    L.bindSortMenu(document.getElementById("roles-table"), view.sort, SORT_COLUMNS, renderFlat);

    let searchTimer = null;
    document.getElementById("roles-search").addEventListener("input", event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            view.search = event.target.value;
            render();
        }, 120);
    });

    document.getElementById("roles-inactive").addEventListener("click", () => {
        view.showInactive = !view.showInactive;
        render();
    });

    document.getElementById("roles-quick").addEventListener("click", event => {
        const quick = event.target.closest("[data-quick]");
        if (quick) {
            view.quick = view.quick === quick.dataset.quick ? null : quick.dataset.quick;
            render();
        } else if (event.target.closest("[data-token-system]")) {
            view.system = null;
            params.delete("system");
            const query = params.toString();
            window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
            render();
        }
    });

    document.getElementById("roles-flat-type").addEventListener("click", event => {
        const button = event.target.closest("[data-type]");
        if (button) {
            view.flatType = button.dataset.type;
            renderFlat();
        }
    });

    const split = root.querySelector(".al-split");
    L.bindTips(split, target => {
        const role = roleById.get(target.closest("[data-open]")?.dataset.open);
        if (!role) {
            return "";
        }
        return target.dataset.tip === "users" ? usersTip(role) : resourcesTip(role);
    });

    split.addEventListener("click", event => {
        if (event.target.closest("[data-reload]")) {
            load();
            return;
        }
        const toggle = event.target.closest("[data-toggle]");
        const menu = event.target.closest("[data-menu]");
        const row = event.target.closest("[data-open]");
        if (toggle) {
            event.stopPropagation();
            const id = toggle.dataset.toggle;
            view.collapsed.has(id) ? view.collapsed.delete(id) : view.collapsed.add(id);
            renderTree();
        } else if (menu) {
            event.stopPropagation();
            const role = roleById.get(menu.dataset.menu);
            L.openMenu(menu, menuItems(role), id => runAction(id, role));
        } else if (row && !window.getSelection()?.toString()) {
            runAction("details", roleById.get(row.dataset.open));
        }
    });

    split.addEventListener("keydown", event => {
        const row = event.target.closest("[data-open]");
        if (row && event.target === row && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            runAction("details", roleById.get(row.dataset.open));
        }
    });

    load();
});
