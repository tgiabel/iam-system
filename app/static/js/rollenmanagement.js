const roleState = {
    roleMap: null,
    ui: {}
};

async function loadRoles() {
    const tableBody = document.querySelector("#rbac-table tbody");
    tableBody.innerHTML = "";

    try {
        const resp = await fetch("/api/roles");
        const roles = await resp.json();
        console.info(roles);

        roles.forEach(role => {
            const tr = document.createElement("tr");
            tr.dataset.roleId = role.role_id;

            if (role.role_status == "INACTIVE") tr.classList.add("inactive-row");

            tr.innerHTML = `
                <td>${role.name}</td>
                <td>${typeMap(role.role_type)}</td>
                <td>${role.parent_role_name ? role.parent_role_name : "-"}</td>
                <td><span title="${role.resources.join("\n")}" style="cursor:help;"><strong>${role.resources.length}</strong></span></td>
                <td><span title="${role.assigned_to.join("\n")}" style="cursor:help;"><strong>${role.assigned_to.length}</strong></span></td>
                <td>
                    <button class="btn btn-secondary" onclick="gotoRole(${role.role_id})">
                        Details
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) {
        showFlash("Fehler beim Laden der Rollen", "failure");
        console.error("Fehler beim Laden der Rollen", e);
    }
}

function gotoRole(roleId) {
    window.location.href = `/roles/${roleId}`;
}

function typeMap(role_type) {
    switch (role_type) {
        case "PRIMARY":
            return "Hauptrolle";
        case "SECONDARY":
            return "Nebenrolle";
        case "TEMPLATE":
            return "Template";
        default:
            return role_type;
    }
}

function injectRoleManagementUI() {
    if (document.getElementById("role-create-fab")) return;

    const style = document.createElement("style");
    style.textContent = `
        .floating-create-btn {
            position: fixed;
            right: 32px;
            bottom: 96px;
            width: 64px;
            height: 64px;
            border: none;
            border-radius: 50%;
            background: var(--color-primary);
            color: #fff;
            font-size: 2.2rem;
            line-height: 1;
            box-shadow: 0 14px 32px rgba(0, 0, 0, 0.22);
            cursor: pointer;
            z-index: 2200;
        }

        .floating-create-btn:hover {
            background: var(--color-primary-hover);
        }

        .create-modal {
            position: fixed;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(15, 23, 42, 0.45);
            z-index: 2300;
            padding: 20px;
        }

        .create-modal.active {
            display: flex;
        }

        .create-modal-card {
            width: min(100%, 560px);
            background: #fff;
            border-radius: 18px;
            box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
            overflow: hidden;
        }

        .create-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 22px 24px 10px;
        }

        .create-modal-header h3 {
            margin: 0;
        }

        .create-modal-close {
            border: none;
            background: transparent;
            font-size: 1.8rem;
            line-height: 1;
            cursor: pointer;
            color: #475569;
        }

        .create-modal-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 0 24px 24px;
        }

        .create-modal-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .create-modal-field label {
            font-weight: 600;
            color: #334155;
        }

        .create-modal-field input,
        .create-modal-field textarea,
        .create-modal-field select {
            width: 100%;
            padding: 12px 14px;
            border: 1px solid #cbd5e1;
            border-radius: 10px;
            font: inherit;
        }

        .create-modal-field textarea {
            min-height: 110px;
            resize: vertical;
        }

        .create-modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 8px;
        }

        @media (max-width: 640px) {
            .floating-create-btn {
                right: 20px;
                bottom: 20px;
                width: 58px;
                height: 58px;
            }

            .create-modal {
                padding: 12px;
            }
        }
    `;
    document.head.appendChild(style);

    const button = document.createElement("button");
    button.id = "role-create-fab";
    button.className = "floating-create-btn";
    button.type = "button";
    button.setAttribute("aria-label", "Neue Rolle anlegen");
    button.textContent = "+";

    const modal = document.createElement("div");
    modal.id = "role-create-modal";
    modal.className = "create-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
        <div class="create-modal-card" role="dialog" aria-modal="true" aria-labelledby="role-create-title">
            <div class="create-modal-header">
                <h3 id="role-create-title">Neue Rolle anlegen</h3>
                <button id="role-create-close" class="create-modal-close" type="button" aria-label="Schließen">&times;</button>
            </div>
            <form id="role-create-form" class="create-modal-form">
                <div class="create-modal-field">
                    <label for="role-create-name">Name</label>
                    <input id="role-create-name" name="name" type="text" required>
                </div>
                <div class="create-modal-field">
                    <label for="role-create-description">Beschreibung</label>
                    <textarea id="role-create-description" name="description" required></textarea>
                </div>
                <div class="create-modal-field">
                    <label for="role-create-type">Rollen-Typ</label>
                    <select id="role-create-type" name="role_type" required>
                        <option value="PRIMARY">Hauptrolle</option>
                        <option value="SECONDARY">Nebenrolle</option>
                        <option value="TEMPLATE">Template</option>
                    </select>
                </div>
                <div class="create-modal-field">
                    <label for="role-create-parent">Geerbte Rolle</label>
                    <select id="role-create-parent" name="parent_role_id">
                        <option value="">Keine</option>
                    </select>
                </div>
                <div class="create-modal-actions">
                    <button id="role-create-cancel" class="btn btn-secondary" type="button">Abbrechen</button>
                    <button class="btn btn-primary" type="submit">Rolle anlegen</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(modal);
}

async function fetchRoleMap() {
    if (roleState.roleMap) return roleState.roleMap;

    const resp = await fetch("/api/roles/map");
    if (!resp.ok) {
        throw new Error("Role Map konnte nicht geladen werden");
    }

    roleState.roleMap = await resp.json();
    return roleState.roleMap;
}

async function populateParentRoleOptions() {
    const parentSelect = roleState.ui.parentSelect;
    if (!parentSelect) return;

    parentSelect.innerHTML = '<option value="">Keine</option>';

    try {
        const roleMap = await fetchRoleMap();
        Object.entries(roleMap)
            .sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"))
            .forEach(([roleId, roleData]) => {
                const option = document.createElement("option");
                option.value = roleId;
                option.textContent = `${roleData.name} (${typeMap(roleData.type)})`;
                parentSelect.appendChild(option);
            });
    } catch (err) {
        showFlash("Geerbte Rollen konnten nicht geladen werden", "failure");
        console.error(err);
    }
}

function openRoleCreateModal() {
    roleState.ui.modal.classList.add("active");
    roleState.ui.modal.setAttribute("aria-hidden", "false");
    roleState.ui.form.reset();
    populateParentRoleOptions();
    document.getElementById("role-create-name")?.focus();
}

function closeRoleCreateModal() {
    roleState.ui.modal.classList.remove("active");
    roleState.ui.modal.setAttribute("aria-hidden", "true");
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

    const submitButton = roleState.ui.form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

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
    } catch (err) {
        showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
        console.error("Fehler beim Anlegen der Rolle", err);
    } finally {
        submitButton.disabled = false;
    }
}

function initRoleManagementUI() {
    injectRoleManagementUI();

    roleState.ui = {
        fab: document.getElementById("role-create-fab"),
        modal: document.getElementById("role-create-modal"),
        form: document.getElementById("role-create-form"),
        parentSelect: document.getElementById("role-create-parent"),
        closeButtons: [
            document.getElementById("role-create-close"),
            document.getElementById("role-create-cancel")
        ].filter(Boolean)
    };

    roleState.ui.fab.addEventListener("click", openRoleCreateModal);
    roleState.ui.closeButtons.forEach(button => button.addEventListener("click", closeRoleCreateModal));
    roleState.ui.form.addEventListener("submit", createRole);

    roleState.ui.modal.addEventListener("click", (event) => {
        if (event.target === roleState.ui.modal) {
            closeRoleCreateModal();
        }
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && roleState.ui.modal.classList.contains("active")) {
            closeRoleCreateModal();
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initRoleManagementUI();
    loadRoles();
});
