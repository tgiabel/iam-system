"use strict";

const stoerungApi = {
    async requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const ct = response.headers.get("content-type") || "";
        const payload = ct.includes("application/json")
            ? await response.json()
            : await response.text();
        if (!response.ok) {
            throw new Error(payload?.detail || payload?.error || payload || "Fehler beim Request");
        }
        return payload;
    },

    createIncident(body) {
        return this.requestJson("/api/stoerung/incidents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const dom = {};

function cacheDom() {
    dom.openCreateBtn = document.getElementById("openCreateBtn");
    dom.closeCreateModal = document.getElementById("closeCreateModal");
    dom.cancelCreateBtn = document.getElementById("cancelCreateBtn");
    dom.createModal = document.getElementById("stoerung-create-modal");
    dom.createForm = document.getElementById("stoerung-create-form");
    dom.createError = document.getElementById("create-error");
    dom.createSubmitBtn = document.getElementById("createSubmitBtn");
    dom.titleInput = document.getElementById("create-title-input");
    dom.severityInput = document.getElementById("create-severity-input");
    dom.descriptionInput = document.getElementById("create-description-input");
    dom.systemInput = document.getElementById("create-system-input");
}

function openModal() {
    if (!dom.createModal) return;
    dom.createModal.classList.add("active");
    dom.createModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    dom.titleInput?.focus();
}

function closeModal() {
    if (!dom.createModal) return;
    dom.createModal.classList.remove("active");
    dom.createModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    dom.createForm?.reset();
    if (dom.createError) dom.createError.style.display = "none";
}

function showCreateError(msg) {
    if (!dom.createError) return;
    dom.createError.textContent = msg;
    dom.createError.style.display = "";
}

async function handleCreateSubmit(event) {
    event.preventDefault();
    if (!dom.createError) return;
    dom.createError.style.display = "none";

    const title = dom.titleInput?.value?.trim() || "";
    const severity = dom.severityInput?.value || "mittel";
    const description = dom.descriptionInput?.value?.trim() || null;
    const systemName = dom.systemInput?.value?.trim() || null;

    if (!title) {
        showCreateError("Bitte einen Titel angeben.");
        return;
    }

    dom.createSubmitBtn.disabled = true;
    dom.createSubmitBtn.textContent = "Wird erstellt…";

    try {
        const payload = { title, severity };
        if (description) payload.description = description;
        if (systemName) payload.system_name = systemName;

        const incident = await stoerungApi.createIncident(payload);
        window.location.href = `/tools/stoerungsprotokoll/${incident.id}`;
    } catch (err) {
        showCreateError(err.message || "Unbekannter Fehler beim Erstellen.");
        dom.createSubmitBtn.disabled = false;
        dom.createSubmitBtn.textContent = "Störung erfassen";
    }
}

function bindEvents() {
    dom.openCreateBtn?.addEventListener("click", openModal);
    dom.closeCreateModal?.addEventListener("click", closeModal);
    dom.cancelCreateBtn?.addEventListener("click", closeModal);
    dom.createModal?.addEventListener("click", (e) => {
        if (e.target === dom.createModal) closeModal();
    });
    dom.createForm?.addEventListener("submit", handleCreateSubmit);

    document.querySelectorAll(".stoerung-table-row").forEach((row) => {
        const href = row.dataset.href;
        if (!href) return;
        row.addEventListener("click", () => { window.location.href = href; });
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                window.location.href = href;
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    bindEvents();

    if (window.location.hash === "#create") {
        openModal();
    }
});
