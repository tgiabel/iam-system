//------------------------------------------------
// STATE
//------------------------------------------------

let role = null;

const DOM = {};
const STATE = {
    overlayMode: "view",
    currentResource: null,
    systemMap: null,
    roleMap: null,
    sofaCatalog: null,
    sofaOptionCache: {},
    isEditing: false,
    isEditingSofa: false
};

const ROLE_TYPE_OPTIONS = [
    { value: "PRIMARY", label: "Hauptrolle" },
    { value: "SECONDARY", label: "Nebenrolle" },
    { value: "TEMPLATE", label: "Template" }
];

const ROLE_STATUS_OPTIONS = [
    { value: "ACTIVE", label: "Aktiv" },
    { value: "INACTIVE", label: "Inaktiv" }
];

const api = {
    async getSystemMap() {
        if (STATE.systemMap) return STATE.systemMap;
        const res = await fetch("/api/systems/map");
        if (!res.ok) throw new Error("System Map konnte nicht geladen werden");

        STATE.systemMap = await res.json();
        return STATE.systemMap;
    },

    async getRoleMap() {
        if (STATE.roleMap) return STATE.roleMap;
        const res = await fetch("/api/roles/map");
        if (!res.ok) throw new Error("Role Map konnte nicht geladen werden");

        STATE.roleMap = await res.json();
        return STATE.roleMap;
    },

    async getSystemResources(sysId) {
        const res = await fetch(`/api/systems/${sysId}/resources`);
        if (!res.ok) throw new Error(res.status);
        return res.json();
    },

    async updateRole(roleId, payload) {
        const res = await fetch(`/api/roles/${roleId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || "Rolle konnte nicht gespeichert werden");
        }
        return data;
    },

    async getSofaPermissionCatalog() {
        if (STATE.sofaCatalog) return STATE.sofaCatalog;

        const res = await fetch("/api/sofa/permissions");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || "SOFA-Permission-Katalog konnte nicht geladen werden");
        }

        STATE.sofaCatalog = data;
        return data;
    },

    async addResourcesToRole(roleId, resourceIds) {
        const res = await fetch(`/api/roles/${roleId}/resources`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resource_ids: resourceIds })
        });
        if (!res.ok) throw new Error("Fehler beim Hinzufügen der Ressourcen");
        return await res.json();
    },

    async removeResourcesFromRole(roleId, resourceIds) {
        const res = await fetch(`/api/roles/${roleId}/resources`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resource_ids: resourceIds })
        });
        if (!res.ok) throw new Error("Fehler beim Entfernen der Ressourcen");
        return await res.json();
    }
};

//------------------------------------------------
// INIT
//------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init() {
    const msg = sessionStorage.getItem("flash_msg");
    const type = sessionStorage.getItem("flash_type");

    if (msg) {
        showFlash(msg, type);
        sessionStorage.removeItem("flash_msg");
        sessionStorage.removeItem("flash_type");
    }
    cacheDOM();
    bindBaseEvents();
    await loadRoleDetail();
}

//------------------------------------------------
// DOM CACHE
//------------------------------------------------

function cacheDOM() {
    DOM.infoFields = document.querySelectorAll(".info-field");
    DOM.sectionButtons = document.querySelectorAll(".section-actions button");

    DOM.overlay = document.getElementById("resource-overlay");
    DOM.closeBtn = document.getElementById("resource-close-btn");
    DOM.cancelBtn = document.getElementById("resource-cancel-btn");

    DOM.form = document.getElementById("resource-form-container");
    DOM.selectContainer = document.getElementById("resource-select-container");
    DOM.selectSys = document.getElementById("sys-select");
    DOM.tableContainer = document.getElementById("resource-table-container");
    DOM.availableResContainer = document.getElementById("available-res-container");

    DOM.title = document.getElementById("resource-modal-title");
    DOM.subtitle = document.getElementById("resource-modal-subtitle");
    DOM.saveResBtn = document.getElementById("resource-save-btn");

    DOM.tableBody = document.querySelector("#resources-table tbody");

    DOM.addResBtn = document.getElementById("add-resource-btn");
    DOM.rmResBtn = document.getElementById("rm-resources-btn");

    DOM.editBtn = document.querySelector("#edit-role-btn");
    DOM.cancelEdit = document.querySelector("#cancel-edit-btn");
    DOM.saveEdit = document.querySelector("#save-edit-btn");
    DOM.editActions = document.querySelector("#edit-actions");
    DOM.sofaGrantBody = document.getElementById("sofa-grants-body");
    DOM.sofaGrantCount = document.getElementById("sofa-grant-count");
    DOM.sofaScopedCount = document.getElementById("sofa-scoped-count");
    DOM.sofaGlobalCount = document.getElementById("sofa-global-count");
    DOM.sofaProfileList = document.getElementById("sofa-profile-list");
    DOM.editSofaBtn = document.getElementById("edit-sofa-grants-btn");
    DOM.sofaGrantEditor = document.getElementById("sofa-grant-editor");
    DOM.sofaProfileOptions = document.getElementById("sofa-profile-options");
    DOM.sofaGrantList = document.getElementById("sofa-grant-list");
    DOM.addSofaGrantBtn = document.getElementById("add-sofa-grant-btn");
    DOM.cancelSofaGrantsBtn = document.getElementById("cancel-sofa-grants-btn");
    DOM.saveSofaGrantsBtn = document.getElementById("save-sofa-grants-btn");

    // form fields
    DOM.displayName = document.getElementById("res-display-name");
    DOM.techId = document.getElementById("res-technical-id");
    DOM.type = document.getElementById("res-type");
    DOM.handling = document.getElementById("res-handling");

    // info inputs
    DOM.roleNameInput = document.getElementById("role-name-input");
    DOM.roleTypeInput = document.getElementById("role-type-input");
    DOM.roleStatusInput = document.getElementById("role-status-input");
    DOM.roleParentInput = document.getElementById("role-parent-input");
    DOM.roleDescriptionInput = document.getElementById("role-description-input");
}

//------------------------------------------------
// LOAD ROLE
//------------------------------------------------

async function loadRoleDetail() {
    const roleId = window.location.pathname.split("/").pop();

    try {
        const [resp] = await Promise.all([
            fetch(`/api/roles/${roleId}`),
            api.getSofaPermissionCatalog()
        ]);
        if (!resp.ok) throw new Error("Rollendetails konnten nicht geladen werden");

        role = await resp.json();
        fillRoleInfo();
        renderSofaPermissions();
        renderResourceTable();
        setupCards();
    } catch (e) {
        console.error("Fehler beim Laden:", e);
        showFlash("Fehler beim Laden der Rollendetails", "failure");
    }
}

//------------------------------------------------
// ROLE INFO
//------------------------------------------------

function fillRoleInfo() {
    setText("role-id-text", role.role_id);
    setText("role-name-text", role.name);
    setText("role-type-text", formatRoleType(role.role_type));
    setText("role-status-text", formatRoleStatus(getRoleStatusValue()));
    setText("role-parent-text", role.parent_role_name || "-");
    setText("role-description-text", role.description || "-");
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || "-";
}

function getRoleStatusValue() {
    return role.status || role.role_status || "ACTIVE";
}

function formatRoleType(value) {
    return ROLE_TYPE_OPTIONS.find(option => option.value === value)?.label || value || "-";
}

function formatRoleStatus(value) {
    return ROLE_STATUS_OPTIONS.find(option => option.value === value)?.label || value || "-";
}

function getOwnResources() {
    return Array.isArray(role?.resources) ? role.resources : [];
}

function getInheritedResources() {
    return Array.isArray(role?.inherited_resources) ? role.inherited_resources : [];
}

function getAllRoleResources() {
    return [
        ...getOwnResources().map(resource => ({ ...resource, isInherited: false })),
        ...getInheritedResources().map(resource => ({ ...resource, isInherited: true }))
    ];
}

function getSofaPermissions() {
    return Array.isArray(STATE.sofaCatalog?.permissions) ? STATE.sofaCatalog.permissions : [];
}

function getSofaPermissionDefinition(permissionKey) {
    return getSofaPermissions().find(permission => permission.key === permissionKey) || null;
}

function getSofaResourceTypes() {
    return Array.isArray(STATE.sofaCatalog?.resource_types) ? STATE.sofaCatalog.resource_types : [];
}

function getSofaResourceTypeDefinition(resourceTypeKey) {
    return getSofaResourceTypes().find(resourceType => resourceType.key === resourceTypeKey) || null;
}

function getRoleSofaGrants() {
    return Array.isArray(role?.sofa_grants) ? role.sofa_grants : [];
}

function getAssignedSofaProfileKeys() {
    if (Array.isArray(role?.sofa_profile_keys)) {
        return role.sofa_profile_keys;
    }
    if (Array.isArray(role?.sofa_profiles)) {
        return role.sofa_profiles.map(profile => profile?.key).filter(Boolean);
    }
    return [];
}

function getAvailableSofaProfiles() {
    if (Array.isArray(role?.available_sofa_profiles) && role.available_sofa_profiles.length) {
        return role.available_sofa_profiles;
    }
    return Array.isArray(STATE.sofaCatalog?.profiles) ? STATE.sofaCatalog.profiles : [];
}

function getPermissionLabel(permissionKey) {
    return getSofaPermissionDefinition(permissionKey)?.label || permissionKey || "-";
}

function getPermissionCategory(permissionKey) {
    return getSofaPermissionDefinition(permissionKey)?.category || "-";
}

function summarizeGrantScope(grant) {
    const resources = grant?.resources;
    if (!resources || !Object.keys(resources).length) {
        return "Global";
    }

    const hasAnyIds = Object.values(resources).some(scope => Array.isArray(scope?.ids) && scope.ids.length > 0);
    const hasAnyAll = Object.values(resources).some(scope => Boolean(scope?.all));

    if (hasAnyAll && !hasAnyIds) {
        return "Global je Ressourcentyp";
    }

    if (hasAnyAll && hasAnyIds) {
        return "Gemischt";
    }

    return "Ressourcenbegrenzt";
}

function summarizeGrantResources(grant) {
    const resources = grant?.resources;
    if (!resources || !Object.keys(resources).length) {
        return "<span class=\"ui-chip ui-chip-neutral\">Keine Einschraenkung</span>";
    }

    const fragments = [];

    Object.entries(resources).forEach(([resourceKey, scope]) => {
        const resourceDefinition = getSofaResourceTypeDefinition(resourceKey);
        const resourceLabel = resourceDefinition?.label || resourceKey;

        if (scope?.all) {
            fragments.push(`<span class="ui-chip ui-chip-primary">${escapeHtml(resourceLabel)}: Alle</span>`);
            return;
        }

        const ids = Array.isArray(scope?.ids) ? scope.ids : [];
        if (!ids.length) {
            fragments.push(`<span class="ui-chip ui-chip-neutral">${escapeHtml(resourceLabel)}: Keine Auswahl</span>`);
            return;
        }

        const preview = ids.slice(0, 3).map(value => escapeHtml(value)).join(", ");
        const suffix = ids.length > 3 ? ` +${ids.length - 3}` : "";
        fragments.push(`<span class="ui-chip ui-chip-neutral">${escapeHtml(resourceLabel)}: ${preview}${suffix}</span>`);
    });

    return `<div class="sofa-resource-list">${fragments.join("")}</div>`;
}

function renderSofaPermissions() {
    if (!DOM.sofaGrantBody) return;

    const grants = getRoleSofaGrants();
    const globalGrants = grants.filter(grant => summarizeGrantScope(grant).toLowerCase().includes("global")).length;
    const scopedGrants = grants.length - globalGrants;

    DOM.sofaGrantCount.textContent = `${grants.length} Permissions`;
    DOM.sofaScopedCount.textContent = `${scopedGrants} Scoped`;
    DOM.sofaGlobalCount.textContent = `${globalGrants} Global`;

    renderSofaProfileSummary();

    if (!grants.length) {
        DOM.sofaGrantBody.innerHTML = `
            <tr>
                <td colspan="4" class="sofa-empty-state">Fuer diese Rolle sind noch keine SOFA-Berechtigungen hinterlegt.</td>
            </tr>
        `;
        return;
    }

    DOM.sofaGrantBody.innerHTML = grants.map(grant => `
        <tr>
            <td>${escapeHtml(getPermissionLabel(grant.permission))}</td>
            <td>${escapeHtml(getPermissionCategory(grant.permission))}</td>
            <td>${escapeHtml(summarizeGrantScope(grant))}</td>
            <td>${summarizeGrantResources(grant)}</td>
        </tr>
    `).join("");
}

function renderSofaProfileSummary() {
    const assignedKeys = new Set(getAssignedSofaProfileKeys());
    const assignedProfiles = getAvailableSofaProfiles().filter(profile => assignedKeys.has(profile.key));

    if (!assignedProfiles.length) {
        DOM.sofaProfileList.innerHTML = `<span class="ui-chip ui-chip-neutral">Keine Profile markiert</span>`;
        return;
    }

    DOM.sofaProfileList.innerHTML = assignedProfiles.map(profile => `
        <span class="ui-chip ui-chip-primary" title="${escapeHtml(profile.description || "")}">${escapeHtml(profile.name || profile.key)}</span>
    `).join("");
}

async function fetchSofaResourceOptions(resourceTypeKey) {
    if (STATE.sofaOptionCache[resourceTypeKey]) {
        return STATE.sofaOptionCache[resourceTypeKey];
    }

    const resourceType = getSofaResourceTypeDefinition(resourceTypeKey);
    const selectionSource = resourceType?.selection_source;
    let options = [];

    if (!selectionSource || typeof selectionSource !== "object") {
        STATE.sofaOptionCache[resourceTypeKey] = options;
        return options;
    }

    if (selectionSource.kind === "static") {
        options = Array.isArray(selectionSource.options) ? selectionSource.options.map(option => ({
            id: option.id,
            label: option.label || option.id
        })) : [];
    } else if (selectionSource.kind === "api" && selectionSource.path) {
        const res = await fetch(selectionSource.path);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || `Optionen fuer ${resourceType?.label || resourceTypeKey} konnten nicht geladen werden`);
        }

        if (Array.isArray(data)) {
            options = data.map(item => ({
                id: item.backlog_id ?? item.id ?? item.resource_id ?? item.role_id ?? item.system_id,
                label: item.name || item.display_name || item.slug || item.short_name || `Eintrag ${item.backlog_id ?? item.id ?? item.resource_id ?? item.role_id ?? item.system_id}`
            })).filter(option => option.id !== undefined && option.id !== null);
        } else if (data && typeof data === "object") {
            options = Object.entries(data).map(([id, item]) => {
                const label = item?.type
                    ? `${item.name || id} (${item.type})`
                    : item?.name || item?.label || id;
                return { id, label };
            });
        }
    }

    STATE.sofaOptionCache[resourceTypeKey] = options;
    return options;
}

function createGrantEditorRow(grant = null) {
    const row = document.createElement("div");
    row.className = "sofa-grant-editor-row";

    const permissionOptions = getSofaPermissions().map(permission => `
        <option value="${escapeHtml(permission.key)}">${escapeHtml(permission.label)}</option>
    `).join("");

    row.innerHTML = `
        <div class="sofa-grant-editor-head">
            <div class="form-field">
                <label>Permission</label>
                <select class="form-input sofa-permission-select">
                    <option value="">-- Bitte wählen --</option>
                    ${permissionOptions}
                </select>
            </div>
            <button type="button" class="btn btn-red sofa-remove-grant-btn">Entfernen</button>
        </div>
        <div class="sofa-grant-resource-grid"></div>
    `;

    row.querySelector(".sofa-remove-grant-btn").addEventListener("click", () => {
        row.remove();
        ensureGrantEditorNotEmpty();
    });

    const select = row.querySelector(".sofa-permission-select");
    select.value = grant?.permission || "";
    select.addEventListener("change", () => renderGrantResourceEditors(row, null));

    renderGrantResourceEditors(row, grant);
    return row;
}

function ensureGrantEditorNotEmpty() {
    if (DOM.sofaGrantList.children.length > 0) {
        return;
    }

    DOM.sofaGrantList.appendChild(createGrantEditorRow());
}

async function renderGrantResourceEditors(row, grant) {
    const permissionKey = row.querySelector(".sofa-permission-select")?.value;
    const permissionDefinition = getSofaPermissionDefinition(permissionKey);
    const container = row.querySelector(".sofa-grant-resource-grid");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const resourceTypes = Array.isArray(permissionDefinition?.resource_types) ? permissionDefinition.resource_types : [];
    if (!resourceTypes.length) {
        container.innerHTML = `<div class="sofa-resource-help">Diese Permission wird global vergeben und benoetigt keinen Ressourcenscope.</div>`;
        return;
    }

    for (const resourceTypeKey of resourceTypes) {
        const resourceType = getSofaResourceTypeDefinition(resourceTypeKey);
        const options = await fetchSofaResourceOptions(resourceTypeKey);
        const scope = grant?.resources?.[resourceTypeKey] || { all: false, ids: [] };

        const card = document.createElement("div");
        card.className = "sofa-grant-resource-card";
        card.dataset.resourceType = resourceTypeKey;

        const selectedIds = new Set((Array.isArray(scope.ids) ? scope.ids : []).map(value => String(value)));
        const optionMarkup = options.map(option => `
            <option value="${escapeHtml(option.id)}" ${selectedIds.has(String(option.id)) ? "selected" : ""}>${escapeHtml(option.label)}</option>
        `).join("");

        card.innerHTML = `
            <div>
                <strong>${escapeHtml(resourceType?.label || resourceTypeKey)}</strong>
                <div class="sofa-resource-help">${escapeHtml(resourceType?.description || "Scope fuer diese Permission")}</div>
            </div>
            <label class="sofa-inline-check">
                <input type="checkbox" class="sofa-scope-all-checkbox" ${scope.all ? "checked" : ""}>
                Alle ${escapeHtml(resourceType?.label || resourceTypeKey)}
            </label>
            <select class="form-input sofa-multi-select" multiple size="5" ${scope.all ? "disabled" : ""}>
                ${optionMarkup}
            </select>
        `;

        const checkbox = card.querySelector(".sofa-scope-all-checkbox");
        const multiSelect = card.querySelector(".sofa-multi-select");
        checkbox.addEventListener("change", () => {
            multiSelect.disabled = checkbox.checked;
        });

        container.appendChild(card);
    }
}

function renderSofaGrantEditor() {
    DOM.sofaProfileOptions.innerHTML = getAvailableSofaProfiles().map(profile => `
        <label class="sofa-profile-option">
            <input type="checkbox" value="${escapeHtml(profile.key)}" ${getAssignedSofaProfileKeys().includes(profile.key) ? "checked" : ""}>
            <span title="${escapeHtml(profile.description || "")}">${escapeHtml(profile.name || profile.key)}</span>
        </label>
    `).join("");

    DOM.sofaGrantList.innerHTML = "";
    const grants = getRoleSofaGrants();

    if (!grants.length) {
        DOM.sofaGrantList.appendChild(createGrantEditorRow());
        return;
    }

    grants.forEach(grant => {
        DOM.sofaGrantList.appendChild(createGrantEditorRow(grant));
    });
}

function openSofaGrantEditor() {
    STATE.isEditingSofa = true;
    DOM.sofaGrantEditor.style.display = "flex";
    renderSofaGrantEditor();
}

function closeSofaGrantEditor() {
    STATE.isEditingSofa = false;
    DOM.sofaGrantEditor.style.display = "none";
}

function collectSofaGrantPayload() {
    const grants = [];

    DOM.sofaGrantList.querySelectorAll(".sofa-grant-editor-row").forEach(row => {
        const permission = row.querySelector(".sofa-permission-select")?.value;
        if (!permission) {
            return;
        }

        const resources = {};
        row.querySelectorAll(".sofa-grant-resource-card").forEach(card => {
            const resourceTypeKey = card.dataset.resourceType;
            if (!resourceTypeKey) {
                return;
            }

            const all = Boolean(card.querySelector(".sofa-scope-all-checkbox")?.checked);
            const ids = Array.from(card.querySelector(".sofa-multi-select")?.selectedOptions || []).map(option => {
                const rawValue = option.value;
                const numericValue = Number(rawValue);
                return Number.isNaN(numericValue) || rawValue.trim() === "" ? rawValue : numericValue;
            });

            resources[resourceTypeKey] = { all, ids };
        });

        grants.push({ permission, resources });
    });

    return grants;
}

function sortResourcesByShortCode(resources) {
    return [...resources].sort((left, right) => {
        const leftKey = String(left.technical_identifier || "").trim();
        const rightKey = String(right.technical_identifier || "").trim();

        if (!leftKey && !rightKey) {
            return String(left.display_name || "").localeCompare(String(right.display_name || ""), "de", { sensitivity: "base" });
        }
        if (!leftKey) return 1;
        if (!rightKey) return -1;

        return leftKey.localeCompare(rightKey, "de", { sensitivity: "base", numeric: true });
    });
}

//------------------------------------------------
// RESOURCE TABLE
//------------------------------------------------

function renderResourceTable() {
    DOM.tableBody.innerHTML = "";

    sortResourcesByShortCode(getAllRoleResources()).forEach(res => {
        const tr = document.createElement("tr");

        tr.dataset.type = res.isInherited ? "inherited" : "own";
        tr.dataset.res_id = res.resource_id;
        tr.dataset.system_id = res.system_id || "";

        tr.innerHTML = `
            <td>${escapeHtml(res.technical_identifier || "")}</td>
            <td>${escapeHtml(res.display_name || "-")}</td>
            <td>${escapeHtml(res.type_name || "-")}</td>
            <td>${escapeHtml(res.override_handling_type || "")}</td>
            <td>${res.isInherited ? "Ja" : "Nein"}</td>
        `;

        DOM.tableBody.appendChild(tr);
    });
}

//------------------------------------------------
// RESOURCE CARDS
//------------------------------------------------

function setupCards() {
    const cards = {
        all: document.querySelector("#count-all"),
        own: document.querySelector("#count-own"),
        inherited: document.querySelector("#count-inherited")
    };

    const counts = {
        all: getAllRoleResources().length,
        own: getOwnResources().length,
        inherited: getInheritedResources().length
    };

    Object.entries(counts).forEach(([key, val]) => {
        const el = cards[key];
        if (!el) return;

        el.textContent = val;

        const card = el.closest(".resource-card");
        card.classList.toggle("disabled", val === 0);

        card.onclick = () => {
            if (val === 0) return;

            document.querySelectorAll("#resources-table tbody tr")
                .forEach(tr => {
                    tr.style.display = key === "all" || tr.dataset.type === key ? "" : "none";
                });
        };
    });
}

//------------------------------------------------
// EVENTS
//------------------------------------------------

function bindBaseEvents() {
    DOM.tableBody.addEventListener("click", e => {
        const tr = e.target.closest("tr");
        if (!tr) return;

        const res = getAllRoleResources().find(r =>
            String(r.resource_id) === String(tr.dataset.res_id) &&
            String(r.system_id || "") === String(tr.dataset.system_id || "")
        );
        if (!res) return;

        openOverlay("view", res);
    });

    DOM.editBtn.addEventListener("click", editRole);
    DOM.cancelEdit.addEventListener("click", cancelEdit);
    DOM.saveEdit.addEventListener("click", saveRoleEdit);
    DOM.editSofaBtn.addEventListener("click", openSofaGrantEditor);
    DOM.cancelSofaGrantsBtn.addEventListener("click", closeSofaGrantEditor);
    DOM.addSofaGrantBtn.addEventListener("click", () => {
        DOM.sofaGrantList.appendChild(createGrantEditorRow());
    });
    DOM.saveSofaGrantsBtn.addEventListener("click", saveSofaGrantEdit);

    DOM.addResBtn.addEventListener("click", () => openOverlay("add"));
    DOM.rmResBtn.addEventListener("click", () => openOverlay("rm"));

    [DOM.closeBtn, DOM.cancelBtn].forEach(btn => {
        btn.addEventListener("click", closeOverlay);
    });

    DOM.saveResBtn.addEventListener("click", saveResourceOverlay);
}

async function editRole() {
    try {
        await populateRoleEditFields();

        DOM.infoFields.forEach(field => {
            const text = field.querySelector(".field-text");
            const input = field.querySelector(".field-input");

            if (!input) return;

            text.style.display = "none";
            input.style.display = input.tagName === "TEXTAREA" ? "block" : "block";
        });

        DOM.sectionButtons.forEach(btn => btn.disabled = true);
        DOM.editBtn.disabled = true;
        DOM.editActions.style.display = "flex";
        STATE.isEditing = true;
    } catch (err) {
        console.error(err);
        showFlash("Bearbeitungsdaten konnten nicht geladen werden", "failure");
    }
}

function cancelEdit() {
    DOM.infoFields.forEach(field => {
        const text = field.querySelector(".field-text");
        const input = field.querySelector(".field-input");

        if (!input) return;

        input.style.display = "none";
        text.style.display = "block";
    });

    DOM.sectionButtons.forEach(btn => btn.disabled = false);
    DOM.editBtn.disabled = false;
    DOM.editActions.style.display = "none";
    STATE.isEditing = false;
}

async function populateRoleEditFields() {
    const roleMap = await api.getRoleMap();

    fillSelect(DOM.roleTypeInput, ROLE_TYPE_OPTIONS, role.role_type);
    fillSelect(DOM.roleStatusInput, ROLE_STATUS_OPTIONS, getRoleStatusValue());
    fillParentRoleSelect(roleMap, role.parent_role_id);

    DOM.roleNameInput.value = role.name || "";
    DOM.roleDescriptionInput.value = role.description || "";
}

function fillSelect(select, options, selectedValue = "") {
    if (!select) return;

    select.innerHTML = "";

    options.forEach(optionData => {
        const opt = document.createElement("option");
        opt.value = optionData.value;
        opt.textContent = optionData.label;
        opt.selected = String(optionData.value) === String(selectedValue);
        select.appendChild(opt);
    });
}

function fillParentRoleSelect(roleMap, selectedValue = null) {
    if (!DOM.roleParentInput) return;

    DOM.roleParentInput.innerHTML = '<option value="">Keine</option>';

    Object.entries(roleMap)
        .filter(([roleId]) => Number(roleId) !== Number(role.role_id))
        .sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"))
        .forEach(([roleId, roleData]) => {
            const opt = document.createElement("option");
            opt.value = roleId;
            opt.textContent = `${roleData.name} (${formatRoleType(roleData.type)})`;
            opt.selected = String(roleId) === String(selectedValue ?? "");
            DOM.roleParentInput.appendChild(opt);
        });
}

async function saveRoleEdit() {
    const payload = {
        name: String(DOM.roleNameInput.value || "").trim(),
        description: String(DOM.roleDescriptionInput.value || "").trim(),
        role_type: DOM.roleTypeInput.value,
        status: DOM.roleStatusInput.value,
        parent_role_id: DOM.roleParentInput.value ? Number(DOM.roleParentInput.value) : null
    };

    if (!payload.name || !payload.description || !payload.role_type) {
        showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
        return;
    }

    DOM.saveEdit.disabled = true;

    try {
        const updatedRole = await api.updateRole(role.role_id, payload);
        role = { ...role, ...updatedRole, ...payload };

        if (payload.parent_role_id === null) {
            role.parent_role_name = null;
        } else {
            const roleMap = await api.getRoleMap();
            role.parent_role_name = roleMap[payload.parent_role_id]?.name || role.parent_role_name;
        }

        STATE.roleMap = null;
        fillRoleInfo();
        cancelEdit();
        showFlash("Rollendetails gespeichert", "success");
    } catch (err) {
        console.error("Speichern fehlgeschlagen:", err);
        showFlash(err.message || "Rollendetails konnten nicht gespeichert werden", "failure");
    } finally {
        DOM.saveEdit.disabled = false;
    }
}

async function saveSofaGrantEdit() {
    const sofaGrants = collectSofaGrantPayload();
    const sofaProfileKeys = Array.from(DOM.sofaProfileOptions.querySelectorAll("input[type='checkbox']:checked"))
        .map(input => input.value)
        .filter(Boolean);

    DOM.saveSofaGrantsBtn.disabled = true;

    try {
        const updatedRole = await api.updateRole(role.role_id, {
            sofa_grants: sofaGrants,
            sofa_profile_keys: sofaProfileKeys
        });

        role = {
            ...role,
            ...updatedRole,
            sofa_grants: sofaGrants,
            sofa_profile_keys: sofaProfileKeys,
            sofa_profiles: getAvailableSofaProfiles().filter(profile => sofaProfileKeys.includes(profile.key))
        };

        renderSofaPermissions();
        closeSofaGrantEditor();
        showFlash("SOFA-Berechtigungen gespeichert", "success");
    } catch (err) {
        console.error("Speichern der SOFA-Berechtigungen fehlgeschlagen:", err);
        showFlash(err.message || "SOFA-Berechtigungen konnten nicht gespeichert werden", "failure");
    } finally {
        DOM.saveSofaGrantsBtn.disabled = false;
    }
}

//------------------------------------------------
// OVERLAY
//------------------------------------------------

async function openOverlay(mode, resource = null) {
    STATE.overlayMode = mode;
    STATE.currentResource = resource;

    DOM.overlay.classList.add("active");

    DOM.selectContainer.style.display = "none";
    DOM.tableContainer.style.display = "none";
    DOM.form.style.display = "block";

    DOM.form.querySelectorAll("input,select")
        .forEach(el => el.disabled = false);

    DOM.saveResBtn.style.display = "inline-block";

    if (mode === "view") {
        DOM.title.textContent = "Ressourcen Details";
        DOM.subtitle.textContent = "Ressourcen, die über diese Rolle verfügbar sind, im kompakten Read-only-Modus.";
        DOM.form.style.display = "block";
        DOM.selectContainer.style.display = "none";
        DOM.tableContainer.style.display = "none";

        DOM.form.querySelectorAll("input,select")
            .forEach(el => el.disabled = true);

        DOM.saveResBtn.style.display = "none";

        fillResourceForm(resource);
    }

    if (mode === "rm") {
        DOM.title.textContent = "Ressourcen entfernen";
        DOM.subtitle.textContent = "Eigene Ressourcen aus dem Rollenpaket entfernen und die Auswahl vor dem Speichern prüfen.";
        DOM.form.style.display = "none";
        DOM.selectContainer.style.display = "none";
        DOM.tableContainer.style.display = "block";

        const currentList = document.getElementById("res-list-current");
        const removeList = document.getElementById("res-list-to-remove");

        currentList.innerHTML = "";
        removeList.innerHTML = "";

        const createRow = (res, isRemoving) => {
            const tr = document.createElement("tr");
            tr.dataset.id = res.resource_id;
            tr.innerHTML = `
                <td>${escapeHtml(res.display_name || "-")}</td>
                <td>
                    <button type="button" class="action-btn ${isRemoving ? "btn-transparent" : "btn-red btn-transparent"}">
                        ${isRemoving ? "↑" : "✖"}
                    </button>
                </td>
            `;

            tr.querySelector(".action-btn").onclick = () => {
                if (!isRemoving) {
                    clearEmptyState(removeList);
                    removeList.appendChild(createRow(res, true));
                } else {
                    clearEmptyState(currentList);
                    currentList.appendChild(createRow(res, false));
                }
                tr.remove();
                ensureEmptyState(currentList, "Keine eigenen Ressourcen vorhanden.");
                ensureEmptyState(removeList, "Noch keine Ressourcen zum Entfernen markiert.");
            };

            return tr;
        };

        getOwnResources().forEach(r => {
            currentList.appendChild(createRow(r, false));
        });

        if (currentList.innerHTML === "") {
            currentList.innerHTML = "<tr class='empty-row'><td colspan='2'>Keine eigenen Ressourcen vorhanden.</td></tr>";
        }

        if (removeList.innerHTML === "") {
            removeList.innerHTML = "<tr class='empty-row'><td colspan='2'>Noch keine Ressourcen zum Entfernen markiert.</td></tr>";
        }
    }

    if (mode === "add") {
        DOM.title.textContent = "Ressourcen hinzufügen";
        DOM.subtitle.textContent = "System auswählen, passende Ressourcen markieren und gesammelt zur Rolle hinzufügen.";
        const systems = await api.getSystemMap();

        DOM.form.style.display = "none";
        DOM.tableContainer.style.display = "none";
        DOM.selectContainer.style.display = "block";

        const availContainer = DOM.availableResContainer;
        const availList = document.getElementById("res-list-available");
        const addList = document.getElementById("res-list-to-add");

        DOM.selectSys.innerHTML = "<option value=''>-- Bitte wählen --</option>";
        Object.entries(systems)
            .sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"))
            .forEach(([id, systemData]) => {
                const optionLabel = systemData.type
                    ? `${systemData.name} (${systemData.type})`
                    : systemData.name;
                DOM.selectSys.innerHTML += `<option value="${id}">${optionLabel}</option>`;
            });

        const createAddRow = (res, isStaged) => {
            const tr = document.createElement("tr");
            tr.dataset.id = res.resource_id;
            tr.innerHTML = `
                <td>${escapeHtml(res.display_name || "-")}</td>
                <td>
                    <button type="button" class="action-btn ${isStaged ? "btn-red btn-transparent" : "btn-green btn-transparent"}">
                        ${isStaged ? "✖" : "✚"}
                    </button>
                </td>
            `;

            tr.querySelector(".action-btn").onclick = () => {
                if (!isStaged) {
                    clearEmptyState(addList);
                    addList.appendChild(createAddRow(res, true));
                } else {
                    clearEmptyState(availList);
                    availList.appendChild(createAddRow(res, false));
                }
                tr.remove();
                ensureEmptyState(addList, "Noch keine Ressourcen zum Hinzufügen ausgewählt.");
            };
            return tr;
        };

        addList.innerHTML = "<tr class='empty-row'><td colspan='2'>Noch keine Ressourcen zum Hinzufügen ausgewählt.</td></tr>";

        DOM.selectSys.onchange = async e => {
            const sysId = e.target.value;
            if (!sysId) {
                availContainer.style.display = "none";
                return;
            }

            const resources = await api.getSystemResources(sysId);
            availList.innerHTML = "";
            availContainer.style.display = "block";

            if (Array.isArray(resources) && resources.length > 0) {
                resources.forEach(r => {
                    const alreadyHas = getAllRoleResources().some(existing =>
                        String(existing.resource_id) === String(r.resource_id) &&
                        String(existing.system_id || "") === String(r.system_id || "")
                    );

                    if (!alreadyHas) {
                        availList.appendChild(createAddRow(r, false));
                    }
                });

                if (availList.innerHTML === "") {
                    availList.innerHTML = "<tr class='empty-row'><td colspan='2'>Alle Ressourcen dieses Systems sind bereits zugewiesen.</td></tr>";
                }
            } else {
                availList.innerHTML = "<tr class='empty-row'><td colspan='2'>Keine Ressourcen für dieses System gefunden.</td></tr>";
            }
        };
    }
}

function closeOverlay() {
    DOM.overlay.classList.remove("active");
    DOM.form.style.display = "none";
    DOM.selectContainer.style.display = "none";
    DOM.tableContainer.style.display = "none";
    if (DOM.availableResContainer) {
        DOM.availableResContainer.style.display = "none";
    }
    STATE.overlayMode = "";
}

//------------------------------------------------
// FORM
//------------------------------------------------

function fillResourceForm(res) {
    DOM.displayName.value = res.display_name || "";
    DOM.techId.value = res.technical_identifier || "";
    DOM.type.value = res.type_id || 1;
    DOM.handling.value = res.override_handling_type || "INTERNAL";
}

function clearEmptyState(container) {
    container.querySelectorAll(".empty-row").forEach(row => row.remove());
}

function ensureEmptyState(container, message) {
    if (container.children.length > 0) {
        return;
    }

    container.innerHTML = `<tr class="empty-row"><td colspan="2">${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

//------------------------------------------------
// SAVE
//------------------------------------------------

async function saveResourceOverlay() {
    const mode = STATE.overlayMode;
    const roleIdToUpdate = role.role_id;
    let resourceIds = [];

    try {
        if (mode === "add") {
            const rows = document.querySelectorAll("#res-list-to-add tr");
            resourceIds = Array.from(rows).map(tr => tr.dataset.id);
            if (resourceIds.length > 0) {
                await api.addResourcesToRole(roleIdToUpdate, resourceIds);
            } else {
                showFlash("Keine Ressourcen zum Hinzufügen ausgewählt", "failure");
                return;
            }
        } else if (mode === "rm") {
            const rows = document.querySelectorAll("#res-list-to-remove tr");
            resourceIds = Array.from(rows).map(tr => tr.dataset.id);
            if (resourceIds.length > 0) {
                await api.removeResourcesFromRole(roleIdToUpdate, resourceIds);
            } else {
                showFlash("Keine Ressourcen zum Entfernen ausgewählt", "failure");
                return;
            }
        } else {
            showFlash("Fehler beim Speichern. [ovMode nicht gesetzt oder unbekannt]", "failure");
            return;
        }
        sessionStorage.setItem("flash_msg", "Änderungen gespeichert!");
        sessionStorage.setItem("flash_type", "success");
        location.reload();
    } catch (err) {
        console.error("Speichern fehlgeschlagen:", err);
        showFlash(err.message, "failure");
    }
}
