"use strict";

const INCIDENT_ID = window.STOERUNG_INCIDENT_ID || "";
const POLL_INTERVAL_MS = 30_000;

const detailApi = {
    async requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const ct = response.headers.get("content-type") || "";
        const payload = ct.includes("application/json")
            ? await response.json()
            : await response.text();
        if (!response.ok) {
            throw new Error(payload?.detail || payload?.error || payload || "Fehler");
        }
        return payload;
    },

    getIncident() {
        return this.requestJson(`/api/stoerung/incidents/${INCIDENT_ID}`);
    },

    appendEntry(content) {
        return this.requestJson(`/api/stoerung/incidents/${INCIDENT_ID}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        });
    },

    updateStatus(status) {
        return this.requestJson(`/api/stoerung/incidents/${INCIDENT_ID}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
        });
    },

    closeIncident(body) {
        return this.requestJson(`/api/stoerung/incidents/${INCIDENT_ID}/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    },

    updateContributors(contributorRoles, contributorUserIds) {
        return this.requestJson(`/api/stoerung/incidents/${INCIDENT_ID}/contributors`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contributor_roles: contributorRoles,
                contributor_user_ids: contributorUserIds,
            }),
        });
    },

    getRoles() {
        return this.requestJson("/api/stoerung/roles");
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

function formatTimestamp(iso) {
    if (!iso) return "–";
    return iso.slice(0, 16).replace("T", " ");
}

// ── Modal helpers ─────────────────────────────────────

function openModal(overlay) {
    if (!overlay) return;
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function closeModal(overlay) {
    if (!overlay) return;
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

// ── DOM cache ─────────────────────────────────────────

const dom = {};

function cacheDom() {
    dom.logStream = document.getElementById("logStream");
    dom.entryCountChip = document.getElementById("entryCountChip");
    dom.refreshLogBtn = document.getElementById("refreshLogBtn");
    dom.appendForm = document.getElementById("appendForm");
    dom.appendContent = document.getElementById("appendContent");
    dom.appendFeedback = document.getElementById("appendFeedback");
    dom.appendSubmitBtn = document.getElementById("appendSubmitBtn");
    dom.statusSelect = document.getElementById("statusSelect");
    dom.updateStatusBtn = document.getElementById("updateStatusBtn");
    dom.statusFeedback = document.getElementById("statusFeedback");
    dom.statusChip = document.getElementById("stoerung-status-chip");

    // Close modal
    dom.openCloseModalBtn = document.getElementById("openCloseModalBtn");
    dom.closeModal = document.getElementById("stoerung-close-modal");
    dom.closeModalCloseBtn = document.getElementById("closeModalCloseBtn");
    dom.cancelCloseBtn = document.getElementById("cancelCloseBtn");
    dom.closeIncidentForm = document.getElementById("closeIncidentForm");
    dom.closeNoteInput = document.getElementById("closeNoteInput");
    dom.closeRootCauseInput = document.getElementById("closeRootCauseInput");
    dom.closeResolutionInput = document.getElementById("closeResolutionInput");
    dom.closeError = document.getElementById("close-error");
    dom.closeSubmitBtn = document.getElementById("closeSubmitBtn");

    // Contributors modal
    dom.openContributorsBtn = document.getElementById("openContributorsBtn");
    dom.contributorsModal = document.getElementById("stoerung-contributors-modal");
    dom.contributorsModalCloseBtn = document.getElementById("contributorsModalCloseBtn");
    dom.contributorRoleSelect = document.getElementById("contributorRoleSelect");
    dom.addContributorBtn = document.getElementById("addContributorBtn");
    dom.contributorsChipList = document.getElementById("contributorsChipList");
    dom.contributorsFeedback = document.getElementById("contributorsFeedback");
}

// ── Log rendering ─────────────────────────────────────

function renderEntry(entry) {
    const div = document.createElement("div");
    div.className = "stoerung-log-entry";
    div.dataset.entryId = entry.id;
    div.innerHTML = `
        <div class="stoerung-log-entry-header">
            <span class="stoerung-log-entry-author">${escapeHtml(entry.author_name)}</span>
            <span class="stoerung-log-entry-role">${escapeHtml(entry.author_role_name)}</span>
            <span class="stoerung-log-entry-time">${escapeHtml(formatTimestamp(entry.created_at))}</span>
        </div>
        <div class="stoerung-log-entry-content">${escapeHtml(entry.content)}</div>
    `;
    return div;
}

function refreshLog(entries) {
    if (!dom.logStream) return;
    const existingIds = new Set(
        [...dom.logStream.querySelectorAll("[data-entry-id]")].map(el => el.dataset.entryId)
    );

    if (entries.length === 0 && existingIds.size === 0) return;

    if (entries.length === 0) {
        dom.logStream.innerHTML = `<div class="stoerung-log-empty">Noch keine Protokolleinträge.</div>`;
        return;
    }

    const emptyMsg = dom.logStream.querySelector(".stoerung-log-empty");
    if (emptyMsg) emptyMsg.remove();

    let appended = false;
    entries.forEach((entry) => {
        if (!existingIds.has(String(entry.id))) {
            dom.logStream.appendChild(renderEntry(entry));
            appended = true;
        }
    });

    if (dom.entryCountChip) {
        dom.entryCountChip.textContent = `${entries.length} Einträge`;
    }

    if (appended) {
        dom.logStream.scrollTop = dom.logStream.scrollHeight;
    }
}

// ── Polling ───────────────────────────────────────────

let pollTimer = null;
let isActive = true;

async function pollEntries() {
    if (!INCIDENT_ID || !isActive) return;
    try {
        const incident = await detailApi.getIncident();
        refreshLog(incident.entries || []);
        if (dom.statusChip && incident.status) {
            updateStatusChipDom(incident.status);
        }
    } catch (_) {
        // silent poll failure
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollEntries, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Status chip ───────────────────────────────────────

const STATUS_LABELS = {
    aktiv: "Aktiv",
    in_bearbeitung: "In Bearbeitung",
    behoben: "Behoben",
    geschlossen: "Geschlossen",
};

function updateStatusChipDom(status) {
    if (!dom.statusChip) return;
    dom.statusChip.textContent = STATUS_LABELS[status] || status;
    dom.statusChip.className = `ui-chip stoerung-chip-${status}`;
}

// ── Status update ─────────────────────────────────────

async function handleStatusUpdate() {
    const status = dom.statusSelect?.value;
    if (!status || !dom.updateStatusBtn) return;

    dom.updateStatusBtn.disabled = true;
    if (dom.statusFeedback) dom.statusFeedback.textContent = "Wird gespeichert…";

    try {
        const result = await detailApi.updateStatus(status);
        updateStatusChipDom(result.status || status);
        if (dom.statusFeedback) dom.statusFeedback.textContent = "Status gespeichert.";
        setTimeout(() => { if (dom.statusFeedback) dom.statusFeedback.textContent = ""; }, 3000);
        // Refresh log to pick up auto-created status-change entry from backend
        await pollEntries();
    } catch (err) {
        if (dom.statusFeedback) dom.statusFeedback.textContent = err.message || "Fehler beim Speichern.";
    } finally {
        dom.updateStatusBtn.disabled = false;
    }
}

// ── Append entry ──────────────────────────────────────

async function handleAppendSubmit(event) {
    event.preventDefault();
    const content = dom.appendContent?.value?.trim() || "";
    if (!content) return;

    dom.appendSubmitBtn.disabled = true;
    dom.appendSubmitBtn.textContent = "Wird gesendet…";
    if (dom.appendFeedback) dom.appendFeedback.textContent = "";

    try {
        const entry = await detailApi.appendEntry(content);
        dom.appendContent.value = "";

        const emptyMsg = dom.logStream?.querySelector(".stoerung-log-empty");
        if (emptyMsg) emptyMsg.remove();

        if (dom.logStream) {
            dom.logStream.appendChild(renderEntry(entry));
            dom.logStream.scrollTop = dom.logStream.scrollHeight;
        }

        const currentCount = dom.logStream
            ? dom.logStream.querySelectorAll("[data-entry-id]").length
            : 0;
        if (dom.entryCountChip) dom.entryCountChip.textContent = `${currentCount} Einträge`;

        if (dom.appendFeedback) dom.appendFeedback.textContent = "Eintrag gespeichert.";
        setTimeout(() => { if (dom.appendFeedback) dom.appendFeedback.textContent = ""; }, 3000);
    } catch (err) {
        if (dom.appendFeedback) dom.appendFeedback.textContent = err.message || "Fehler beim Senden.";
    } finally {
        dom.appendSubmitBtn.disabled = false;
        dom.appendSubmitBtn.textContent = "Eintrag senden";
    }
}

// ── Close incident ────────────────────────────────────

async function handleCloseSubmit(event) {
    event.preventDefault();
    const closingNote = dom.closeNoteInput?.value?.trim() || "";
    if (!closingNote) return;

    if (dom.closeError) dom.closeError.style.display = "none";
    dom.closeSubmitBtn.disabled = true;
    dom.closeSubmitBtn.textContent = "Wird geschlossen…";

    try {
        const payload = {
            closing_note: closingNote,
            root_cause: dom.closeRootCauseInput?.value?.trim() || null,
            resolution_summary: dom.closeResolutionInput?.value?.trim() || null,
        };
        await detailApi.closeIncident(payload);
        stopPolling();
        window.location.reload();
    } catch (err) {
        if (dom.closeError) {
            dom.closeError.textContent = err.message || "Fehler beim Schließen.";
            dom.closeError.style.display = "";
        }
        dom.closeSubmitBtn.disabled = false;
        dom.closeSubmitBtn.textContent = "Störung schließen";
    }
}

// ── Contributors modal ────────────────────────────────

let currentContributorRoles = [];

function initContributorRoles() {
    if (!dom.contributorsChipList) return;
    currentContributorRoles = [...dom.contributorsChipList.querySelectorAll("[data-role]")]
        .map(el => el.dataset.role);
}

async function loadRolesIntoSelect() {
    if (!dom.contributorRoleSelect) return;
    try {
        const roleMap = await detailApi.getRoles();
        const roles = Object.values(roleMap);
        dom.contributorRoleSelect.innerHTML =
            `<option value="">Rolle wählen…</option>` +
            roles
                .filter(r => !currentContributorRoles.includes(r.name))
                .map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`)
                .join("");
    } catch (_) {
        dom.contributorRoleSelect.innerHTML = `<option value="">Laden fehlgeschlagen</option>`;
    }
}

async function handleAddContributor() {
    const role = dom.contributorRoleSelect?.value?.trim() || "";
    if (!role || !dom.addContributorBtn) return;
    if (currentContributorRoles.includes(role)) {
        if (dom.contributorsFeedback) dom.contributorsFeedback.textContent = "Rolle bereits vorhanden.";
        return;
    }

    dom.addContributorBtn.disabled = true;
    if (dom.contributorsFeedback) dom.contributorsFeedback.textContent = "Wird gespeichert…";

    try {
        const newRoles = [...currentContributorRoles, role];
        await detailApi.updateContributors(newRoles, []);
        currentContributorRoles = newRoles;

        // Add chip to list
        const chip = document.createElement("span");
        chip.className = "ui-chip ui-chip-primary stoerung-contributor-chip";
        chip.dataset.role = role;
        chip.textContent = role;
        dom.contributorsChipList?.appendChild(chip);

        // Remove from select options
        const opt = dom.contributorRoleSelect?.querySelector(`option[value="${CSS.escape(role)}"]`);
        if (opt) opt.remove();
        if (dom.contributorRoleSelect) dom.contributorRoleSelect.value = "";

        if (dom.contributorsFeedback) dom.contributorsFeedback.textContent = "Rolle hinzugefügt.";
        setTimeout(() => { if (dom.contributorsFeedback) dom.contributorsFeedback.textContent = ""; }, 3000);
    } catch (err) {
        if (dom.contributorsFeedback) dom.contributorsFeedback.textContent = err.message || "Fehler.";
    } finally {
        dom.addContributorBtn.disabled = false;
    }
}

// ── Event binding ─────────────────────────────────────

function bindEvents() {
    dom.refreshLogBtn?.addEventListener("click", pollEntries);
    dom.appendForm?.addEventListener("submit", handleAppendSubmit);
    dom.updateStatusBtn?.addEventListener("click", handleStatusUpdate);

    // Close modal
    dom.openCloseModalBtn?.addEventListener("click", () => openModal(dom.closeModal));
    dom.closeModalCloseBtn?.addEventListener("click", () => closeModal(dom.closeModal));
    dom.cancelCloseBtn?.addEventListener("click", () => closeModal(dom.closeModal));
    dom.closeModal?.addEventListener("click", (e) => {
        if (e.target === dom.closeModal) closeModal(dom.closeModal);
    });
    dom.closeIncidentForm?.addEventListener("submit", handleCloseSubmit);

    // Contributors modal
    dom.openContributorsBtn?.addEventListener("click", () => {
        openModal(dom.contributorsModal);
        loadRolesIntoSelect();
    });
    dom.contributorsModalCloseBtn?.addEventListener("click", () => closeModal(dom.contributorsModal));
    dom.contributorsModal?.addEventListener("click", (e) => {
        if (e.target === dom.contributorsModal) closeModal(dom.contributorsModal);
    });
    dom.addContributorBtn?.addEventListener("click", handleAddContributor);

    // Escape closes any open modal
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (dom.closeModal?.classList.contains("active")) { closeModal(dom.closeModal); return; }
        if (dom.contributorsModal?.classList.contains("active")) { closeModal(dom.contributorsModal); return; }
    });
}

// ── Init ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    if (!INCIDENT_ID) return;
    cacheDom();
    bindEvents();
    initContributorRoles();

    // Scroll log to bottom on load
    if (dom.logStream) dom.logStream.scrollTop = dom.logStream.scrollHeight;

    const initial = window.STOERUNG_INITIAL;
    if (initial && initial.status && initial.status !== "geschlossen") {
        isActive = true;
        startPolling();
    } else {
        isActive = false;
    }
});
