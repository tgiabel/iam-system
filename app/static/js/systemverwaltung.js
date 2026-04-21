const systemUi = {
    modal: null,
    form: null,
    fab: null,
    trigger: null,
    closeButtons: [],
    searchInput: null,
    tableBody: null
};

const systemState = {
    systems: [],
    roles: [],
    searchTerm: ""
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

function sortSystems(systems) {
    return [...systems].sort((left, right) => {
        const leftKey = normalizeValue(left.short_name || left.name || left.system_id);
        const rightKey = normalizeValue(right.short_name || right.name || right.system_id);
        return leftKey.localeCompare(rightKey, "de");
    });
}

function getResourceNames(system) {
    return Array.isArray(system.resource_names) ? system.resource_names : [];
}

function getResourcePreview(system) {
    const resourceNames = getResourceNames(system);
    if (!resourceNames.length) {
        return {
            text: "Keine Ressourcen hinterlegt",
            title: "Keine Ressourcen hinterlegt",
            isEmpty: true
        };
    }

    if (resourceNames.length === 1) {
        return {
            text: resourceNames[0],
            title: resourceNames[0],
            isEmpty: false
        };
    }

    if (resourceNames.length === 2) {
        return {
            text: resourceNames.join(", "),
            title: resourceNames.join("\n"),
            isEmpty: false
        };
    }

    const preview = resourceNames.slice(0, 2).join(", ");
    return {
        text: `${preview} +${resourceNames.length - 2} weitere`,
        title: resourceNames.join("\n"),
        isEmpty: false
    };
}

function matchesSearch(system, searchTerm) {
    if (!searchTerm) {
        return true;
    }

    const haystack = [
        system.system_id,
        system.short_name,
        system.name,
        ...getResourceNames(system)
    ]
        .map(normalizeValue)
        .join(" ");

    return haystack.includes(searchTerm);
}

function getFilteredSystems() {
    return sortSystems(systemState.systems).filter(system =>
        matchesSearch(system, systemState.searchTerm)
    );
}

function getProtectionClass(system) {
    const rawValue =
        system?.protection_need?.overall ||
        system?.schutzbedarfklasse ||
        system?.schutzbedarf ||
        system?.protection_class ||
        system?.criticality ||
        system?.classification ||
        "";

    const normalized = normalizeValue(rawValue);

    if (["gering", "low"].includes(normalized)) {
        return { label: "Gering", className: "systems-protection-low" };
    }

    if (["erhoeht", "erhöht", "mittel", "medium", "elevated"].includes(normalized)) {
        return { label: "Erhöht", className: "systems-protection-medium" };
    }

    if (["kritisch", "critical", "hoch", "high"].includes(normalized)) {
        return { label: "Kritisch", className: "systems-protection-high" };
    }

    return {
        label: rawValue ? String(rawValue) : "Nicht gepflegt",
        className: "systems-protection-unknown"
    };
}

function getRepresentedRoles(system) {
    const resourceNames = new Set(getResourceNames(system).map(normalizeValue).filter(Boolean));

    if (!resourceNames.size || !Array.isArray(systemState.roles)) {
        return [];
    }

    return systemState.roles.filter(role => {
        const roleResources = Array.isArray(role?.resources) ? role.resources : [];
        return roleResources.some(resourceName => resourceNames.has(normalizeValue(resourceName)));
    });
}

function getRolePreview(roleNames) {
    if (!roleNames.length) {
        return {
            text: "In keiner Rolle vertreten",
            title: "In keiner Rolle vertreten",
            isEmpty: true
        };
    }

    if (roleNames.length === 1) {
        return {
            text: roleNames[0],
            title: roleNames[0],
            isEmpty: false
        };
    }

    if (roleNames.length === 2) {
        return {
            text: roleNames.join(", "),
            title: roleNames.join("\n"),
            isEmpty: false
        };
    }

    const preview = roleNames.slice(0, 2).join(", ");
    return {
        text: `${preview} +${roleNames.length - 2} weitere`,
        title: roleNames.join("\n"),
        isEmpty: false
    };
}

function renderEmptyState(message) {
    if (!systemUi.tableBody) {
        return;
    }

    systemUi.tableBody.innerHTML = `
        <tr class="systems-empty-row">
            <td colspan="7">
                <div class="ui-empty-state ui-empty-inline">${escapeHtml(message)}</div>
            </td>
        </tr>
    `;
}

function renderSystems() {
    if (!systemUi.tableBody) {
        return;
    }

    const systems = getFilteredSystems();

    if (!systems.length) {
        renderEmptyState(systemState.searchTerm ? "Keine Systeme für diese Suche gefunden." : "Keine Systeme vorhanden.");
        return;
    }

    systemUi.tableBody.innerHTML = systems.map(system => {
        const resourceNames = getResourceNames(system);
        const preview = getResourcePreview(system);
        const protection = getProtectionClass(system);
        const representedRoles = getRepresentedRoles(system);
        const representedRoleNames = representedRoles.map(role => role.name).filter(Boolean);
        const rolePreview = getRolePreview(representedRoleNames);
        const systemUrl = `/systems/${encodeURIComponent(system.system_id)}`;

        return `
            <tr class="systems-table-row" data-system-id="${escapeHtml(system.system_id)}" data-system-url="${escapeHtml(systemUrl)}">
                <td class="systems-id-cell">${escapeHtml(system.system_id)}</td>
                <td class="systems-short-cell">${escapeHtml(system.short_name || "-")}</td>
                <td class="systems-name-cell">${escapeHtml(system.name || "-")}</td>
                <td class="systems-protection-cell">
                    <span class="systems-protection-badge ${protection.className}">
                        ${escapeHtml(protection.label)}
                    </span>
                </td>
                <td class="systems-resource-cell">
                    <div class="systems-resource-block">
                        <span class="systems-resource-count" title="${escapeHtml(preview.title)}">${resourceNames.length}</span>
                        <span class="systems-resource-preview ${preview.isEmpty ? "is-empty" : ""}" title="${escapeHtml(preview.title)}">
                            ${escapeHtml(preview.text)}
                        </span>
                    </div>
                </td>
                <td class="systems-resource-cell">
                    <div class="systems-resource-block">
                        <span class="systems-resource-count" title="${escapeHtml(rolePreview.title)}">${representedRoleNames.length}</span>
                        <span class="systems-resource-preview ${rolePreview.isEmpty ? "is-empty" : ""}" title="${escapeHtml(rolePreview.title)}">
                            ${escapeHtml(rolePreview.text)}
                        </span>
                    </div>
                </td>
                <td class="systems-detail-cell">
                    <a class="systems-action-link" href="${escapeHtml(systemUrl)}" aria-label="Details zu ${escapeHtml(system.name || system.short_name || system.system_id)} öffnen" title="Details öffnen">
                        →
                    </a>
                </td>
            </tr>
        `;
    }).join("");

    bindRows();
}

function bindRows() {
    systemUi.tableBody?.querySelectorAll(".systems-table-row").forEach(row => {
        row.addEventListener("dblclick", event => {
            const interactiveTarget = event.target.closest("a, button, input");
            if (interactiveTarget) {
                return;
            }

            const targetUrl = row.dataset.systemUrl;
            if (targetUrl) {
                window.location.href = targetUrl;
            }
        });
    });
}

async function loadSystems() {
    try {
        const [systemsResp, rolesResp] = await Promise.all([
            fetch("/api/systems"),
            fetch("/api/roles")
        ]);

        const systems = await systemsResp.json();
        const roles = await rolesResp.json().catch(() => []);

        if (!systemsResp.ok) {
            throw new Error(systems.detail || systems.error || "Systeme konnten nicht geladen werden");
        }

        systemState.systems = Array.isArray(systems) ? systems : [];
        systemState.roles = rolesResp.ok && Array.isArray(roles) ? roles : [];
        renderSystems();
    } catch (error) {
        showFlash("Fehler beim Laden der Systeme", "failure");
        console.error("Fehler beim Laden der Systeme", error);
        renderEmptyState("Systeme konnten nicht geladen werden.");
    }
}

function openSystemCreateModal() {
    if (!systemUi.modal) {
        return;
    }

    systemUi.modal.classList.add("active");
    systemUi.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    systemUi.form?.reset();
    document.getElementById("system-create-name")?.focus();
}

function closeSystemCreateModal() {
    if (!systemUi.modal) {
        return;
    }

    systemUi.modal.classList.remove("active");
    systemUi.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

async function createSystem(event) {
    event.preventDefault();

    const formData = new FormData(systemUi.form);
    const payload = {
        name: String(formData.get("name") || "").trim(),
        short_name: String(formData.get("short_name") || "").trim()
    };

    if (!payload.name || !payload.short_name) {
        showFlash("Bitte Name und Kürzel ausfüllen", "failure");
        return;
    }

    const submitButton = systemUi.form?.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
    }

    try {
        const resp = await fetch("/api/systems", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            showFlash(data.detail || data.error || "System konnte nicht angelegt werden", "failure");
            return;
        }

        showFlash("System erfolgreich angelegt", "success");
        closeSystemCreateModal();
        await loadSystems();
    } catch (error) {
        showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
        console.error("Fehler beim Anlegen des Systems", error);
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}

function bindSearch() {
    systemUi.searchInput?.addEventListener("input", event => {
        systemState.searchTerm = normalizeValue(event.target.value);
        renderSystems();
    });
}

function initSystemCreateModal() {
    systemUi.modal = document.getElementById("system-create-modal");
    systemUi.form = document.getElementById("system-create-form");
    systemUi.fab = document.getElementById("system-create-fab");
    systemUi.trigger = document.getElementById("system-create-trigger");
    systemUi.closeButtons = [
        document.getElementById("system-create-close"),
        document.getElementById("system-create-cancel")
    ].filter(Boolean);

    systemUi.fab?.addEventListener("click", openSystemCreateModal);
    systemUi.trigger?.addEventListener("click", openSystemCreateModal);
    systemUi.closeButtons.forEach(button => button.addEventListener("click", closeSystemCreateModal));
    systemUi.form?.addEventListener("submit", createSystem);

    systemUi.modal?.addEventListener("click", event => {
        if (event.target === systemUi.modal) {
            closeSystemCreateModal();
        }
    });

    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && systemUi.modal?.classList.contains("active")) {
            closeSystemCreateModal();
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    systemUi.searchInput = document.getElementById("search-input");
    systemUi.tableBody = document.getElementById("system-table-body");

    initSystemCreateModal();
    bindSearch();
    loadSystems();
});
