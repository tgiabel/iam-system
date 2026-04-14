const systemUi = {
    modal: null,
    form: null,
    fab: null,
    closeButtons: []
};

async function loadSystems() {
    const tableBody = document.querySelector("#system-table tbody");
    tableBody.innerHTML = ""; // clear

    try {
        const resp = await fetch("/api/systems");
        const systems = await resp.json();

        systems.forEach(system => {
            const tr = document.createElement("tr");
            tr.dataset.systemId = system.system_id; // versteckte ID

            tr.innerHTML = `
                <td>${system.short_name}</td>
                <td>${system.name}</td>
                <td><span title="${system.resource_names.join("\n")}" style="cursor:help;"><strong>${system.resource_names.length}</strong></span></td>
                <td>
                    <button class="btn btn-secondary" onclick="gotoSystem(${system.system_id})">
                        Details
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) {
        showFlash("Fehler beim Laden der Systeme", "failure")
        console.error("Fehler beim Laden der Systeme", e);
    }
}

function gotoSystem(systemId) {
    window.location.href = `/systems/${systemId}`;
}

function openSystemCreateModal() {
    if (!systemUi.modal) return;
    systemUi.modal.classList.add("active");
    systemUi.modal.setAttribute("aria-hidden", "false");
    systemUi.form?.reset();
    document.getElementById("system-create-name")?.focus();
}

function closeSystemCreateModal() {
    if (!systemUi.modal) return;
    systemUi.modal.classList.remove("active");
    systemUi.modal.setAttribute("aria-hidden", "true");
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

    const submitButton = systemUi.form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

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
    } catch (err) {
        showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
        console.error("Fehler beim Anlegen des Systems", err);
    } finally {
        submitButton.disabled = false;
    }
}

function initSystemCreateModal() {
    systemUi.modal = document.getElementById("system-create-modal");
    systemUi.form = document.getElementById("system-create-form");
    systemUi.fab = document.getElementById("system-create-fab");
    systemUi.closeButtons = [
        document.getElementById("system-create-close"),
        document.getElementById("system-create-cancel")
    ].filter(Boolean);

    systemUi.fab?.addEventListener("click", openSystemCreateModal);
    systemUi.closeButtons.forEach(button => button.addEventListener("click", closeSystemCreateModal));
    systemUi.form?.addEventListener("submit", createSystem);

    systemUi.modal?.addEventListener("click", (event) => {
        if (event.target === systemUi.modal) {
            closeSystemCreateModal();
        }
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && systemUi.modal?.classList.contains("active")) {
            closeSystemCreateModal();
        }
    });
}

// Page load
document.addEventListener("DOMContentLoaded", () => {
    initSystemCreateModal();
    loadSystems();
});
