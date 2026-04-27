const roleState = {
    roles: [],
    roleMap: null,
    searchTerm: "",
    typeFilter: "",
    ui: {}
};

function normalizeValue(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function typeMap(roleType) {
    switch (roleType) {
        case "PRIMARY":
            return "Hauptrolle";
        case "SECONDARY":
            return "Nebenrolle";
        case "TEMPLATE":
            return "Template";
        default:
            return roleType || "-";
    }
}

function getTypeClass(roleType) {
    switch (roleType) {
        case "PRIMARY":
            return "roles-type-primary";
        case "SECONDARY":
            return "roles-type-secondary";
        case "TEMPLATE":
            return "roles-type-template";
        default:
            return "roles-type-template";
    }
}

function getPreview(items, emptyLabel) {
    if (!items.length) {
        return {
            text: emptyLabel,
            title: emptyLabel,
            isEmpty: true
        };
    }

    if (items.length === 1) {
        return {
            text: items[0],
            title: items[0],
            isEmpty: false
        };
    }

    if (items.length === 2) {
        return {
            text: items.join(", "),
            title: items.join("\n"),
            isEmpty: false
        };
    }

    const preview = items.slice(0, 2).join(", ");
    return {
        text: `${preview} +${items.length - 2} weitere`,
        title: items.join("\n"),
        isEmpty: false
    };
}

function sortRoles(roles) {
    return [...roles].sort((left, right) => {
        const leftKey = normalizeValue(left.name || left.role_id);
        const rightKey = normalizeValue(right.name || right.role_id);
        return leftKey.localeCompare(rightKey, "de");
    });
}

function matchesSearch(role, searchTerm) {
    if (!searchTerm) {
        return true;
    }

    const haystack = [
        role.role_id,
        role.name,
        role.parent_role_name,
        ...(Array.isArray(role.resources) ? role.resources : []),
        ...(Array.isArray(role.assigned_to) ? role.assigned_to : [])
    ]
        .map(normalizeValue)
        .join(" ");

    return haystack.includes(searchTerm);
}

function isSkillRole(role) {
    return normalizeValue(role.name).startsWith("skill");
}

function matchesTypeFilter(role, typeFilter) {
    if (!typeFilter) {
        return true;
    }

    if (typeFilter === "SKILLS") {
        return isSkillRole(role);
    }

    return String(role.role_type || "").toUpperCase() === typeFilter;
}

function getFilteredRoles() {
    return sortRoles(roleState.roles).filter(role =>
        matchesSearch(role, roleState.searchTerm) && matchesTypeFilter(role, roleState.typeFilter)
    );
}

function renderEmptyState(message) {
    if (!roleState.ui.tableBody) {
        return;
    }

    roleState.ui.tableBody.innerHTML = `
        <tr class="roles-empty-row">
            <td colspan="6">
                <div class="ui-empty-state ui-empty-inline">${escapeHtml(message)}</div>
            </td>
        </tr>
    `;
}

function renderRoles() {
    if (!roleState.ui.tableBody) {
        return;
    }

    const roles = getFilteredRoles();
    if (!roles.length) {
        const hasActiveFilter = Boolean(roleState.searchTerm || roleState.typeFilter);
        renderEmptyState(hasActiveFilter ? "Keine Rollen für die gewählten Filter gefunden." : "Keine Rollen vorhanden.");
        return;
    }

    roleState.ui.tableBody.innerHTML = roles.map(role => {
        const resources = Array.isArray(role.resources) ? role.resources : [];
        const assignments = Array.isArray(role.assigned_to) ? role.assigned_to : [];
        const resourcePreview = getPreview(resources, "Keine Ressourcen verknüpft");
        const assignmentPreview = getPreview(assignments, "Keine User zugewiesen");
        const roleUrl = `/roles/${encodeURIComponent(role.role_id)}`;
        const isInactive = String(role.role_status || "").toUpperCase() === "INACTIVE";

        return `
            <tr class="roles-table-row ${isInactive ? "is-inactive" : ""}" data-role-id="${escapeHtml(role.role_id)}" data-role-url="${escapeHtml(roleUrl)}">
                <td class="roles-name-cell">
                    <div class="roles-name-block">
                        <span class="roles-name-main">${escapeHtml(role.name || "-")}</span>
                        <span class="roles-name-meta">ID ${escapeHtml(role.role_id)}${isInactive ? " · Inaktiv" : ""}</span>
                    </div>
                </td>
                <td>
                    <span class="roles-type-badge ${getTypeClass(role.role_type)}">${escapeHtml(typeMap(role.role_type))}</span>
                </td>
                <td class="roles-parent-cell">${escapeHtml(role.parent_role_name || "-")}</td>
                <td class="roles-resource-cell">
                    <div class="roles-resource-block">
                        <span class="roles-resource-count" title="${escapeHtml(resourcePreview.title)}">${resources.length}</span>
                        <span class="roles-resource-preview ${resourcePreview.isEmpty ? "is-empty" : ""}" title="${escapeHtml(resourcePreview.title)}">
                            ${escapeHtml(resourcePreview.text)}
                        </span>
                    </div>
                </td>
                <td class="roles-resource-cell">
                    <div class="roles-resource-block">
                        <span class="roles-resource-count" title="${escapeHtml(assignmentPreview.title)}">${assignments.length}</span>
                        <span class="roles-resource-preview ${assignmentPreview.isEmpty ? "is-empty" : ""}" title="${escapeHtml(assignmentPreview.title)}">
                            ${escapeHtml(assignmentPreview.text)}
                        </span>
                    </div>
                </td>
                <td class="roles-detail-cell">
                    <a class="roles-action-link" href="${escapeHtml(roleUrl)}" aria-label="Details zu ${escapeHtml(role.name || role.role_id)} öffnen" title="Details öffnen">
                        →
                    </a>
                </td>
            </tr>
        `;
    }).join("");

    bindRows();
}

function bindRows() {
    roleState.ui.tableBody?.querySelectorAll(".roles-table-row").forEach(row => {
        row.addEventListener("dblclick", event => {
            const interactiveTarget = event.target.closest("a, button, input");
            if (interactiveTarget) {
                return;
            }

            const targetUrl = row.dataset.roleUrl;
            if (targetUrl) {
                window.location.href = targetUrl;
            }
        });
    });
}

async function loadRoles() {
    try {
        const resp = await fetch("/api/roles");
        const roles = await resp.json();

        if (!resp.ok) {
            throw new Error(roles.detail || roles.error || "Rollen konnten nicht geladen werden");
        }

        roleState.roles = Array.isArray(roles) ? roles : [];
        renderRoles();
    } catch (error) {
        showFlash("Fehler beim Laden der Rollen", "failure");
        console.error("Fehler beim Laden der Rollen", error);
        renderEmptyState("Rollen konnten nicht geladen werden.");
    }
}

async function fetchRoleMap() {
    if (roleState.roleMap) {
        return roleState.roleMap;
    }

    const resp = await fetch("/api/roles/map");
    if (!resp.ok) {
        throw new Error("Role Map konnte nicht geladen werden");
    }

    roleState.roleMap = await resp.json();
    return roleState.roleMap;
}

async function populateParentRoleOptions() {
    const parentSelect = roleState.ui.parentSelect;
    if (!parentSelect) {
        return;
    }

    parentSelect.innerHTML = '<option value="">Keine</option>';

    try {
        const roleMap = await fetchRoleMap();
        Object.entries(roleMap)
            .sort(([, left], [, right]) => left.name.localeCompare(right.name, "de"))
            .forEach(([roleId, roleData]) => {
                const option = document.createElement("option");
                option.value = roleId;
                option.textContent = `${roleData.name} (${typeMap(roleData.type)})`;
                parentSelect.appendChild(option);
            });
    } catch (error) {
        showFlash("Geerbte Rollen konnten nicht geladen werden", "failure");
        console.error(error);
    }
}

function openRoleCreateModal() {
    roleState.ui.modal?.classList.add("active");
    roleState.ui.modal?.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    roleState.ui.form?.reset();
    populateParentRoleOptions();
    document.getElementById("role-create-name")?.focus();
}

function closeRoleCreateModal() {
    roleState.ui.modal?.classList.remove("active");
    roleState.ui.modal?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

async function createRole(event) {
    event.preventDefault();

    const formData = new FormData(roleState.ui.form);
    const parentRoleId = String(formData.get("parent_role_id") || "").trim();
    const payload = {
        name: String(formData.get("name") || "").trim(),
        description: String(formData.get("description") || "").trim(),
        role_type: String(formData.get("role_type") || "").trim(),
        parent_role_id: parentRoleId ? Number(parentRoleId) : null
    };

    if (!payload.name || !payload.description || !payload.role_type) {
        showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
        return;
    }

    const submitButton = roleState.ui.form?.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
    }

    try {
        const resp = await fetch("/api/roles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            showFlash(data.detail || data.error || "Rolle konnte nicht angelegt werden", "failure");
            return;
        }

        showFlash("Rolle erfolgreich angelegt", "success");
        closeRoleCreateModal();
        roleState.roleMap = null;
        await loadRoles();
    } catch (error) {
        showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
        console.error("Fehler beim Anlegen der Rolle", error);
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}

function bindSearch() {
    roleState.ui.searchInput?.addEventListener("input", event => {
        roleState.searchTerm = normalizeValue(event.target.value);
        renderRoles();
    });
}

function bindTypeFilter() {
    roleState.ui.typeFilter?.addEventListener("change", event => {
        roleState.typeFilter = String(event.target.value || "").toUpperCase();
        renderRoles();
    });
}

function initRoleManagementUI() {
    roleState.ui = {
        searchInput: document.getElementById("search-input"),
        typeFilter: document.getElementById("type-filter"),
        tableBody: document.getElementById("roles-table-body"),
        fab: document.getElementById("role-create-fab"),
        trigger: document.getElementById("role-create-trigger"),
        modal: document.getElementById("role-create-modal"),
        form: document.getElementById("role-create-form"),
        parentSelect: document.getElementById("role-create-parent"),
        closeButtons: [
            document.getElementById("role-create-close"),
            document.getElementById("role-create-cancel")
        ].filter(Boolean)
    };

    roleState.ui.fab?.addEventListener("click", openRoleCreateModal);
    roleState.ui.trigger?.addEventListener("click", openRoleCreateModal);
    roleState.ui.closeButtons.forEach(button => button.addEventListener("click", closeRoleCreateModal));
    roleState.ui.form?.addEventListener("submit", createRole);

    roleState.ui.modal?.addEventListener("click", event => {
        if (event.target === roleState.ui.modal) {
            closeRoleCreateModal();
        }
    });

    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && roleState.ui.modal?.classList.contains("active")) {
            closeRoleCreateModal();
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initRoleManagementUI();
    bindSearch();
    bindTypeFilter();
    loadRoles();
});
