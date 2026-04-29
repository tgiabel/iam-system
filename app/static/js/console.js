const consoleState = {
    events: [],
    weekOffset: 0,
    loading: false,
    error: null,
    reevaluate: {
        roles: [],
        selectedRoleId: "",
        previewResult: null,
        executionResult: null,
        loadingRoles: false,
        previewLoading: false,
        executeLoading: false,
        error: null
    }
};

const consoleDOM = {};

const LABELS = {
    event_status: {
        PLANNED: "Geplant",
        EXECUTED: "Erledigt",
        SKIPPED: "Uebersprungen",
        FAILED: "Fehler",
        CANCELED: "Abgebrochen"
    }
};

const ROLE_REEVALUATION_ACTION_LABELS = {
    assign: "Zuweisen",
    reassign: "Neu zuweisen",
    reactivate: "Reaktivieren",
    revoke: "Entziehen",
    abort: "Abbrechen"
};

const ROLE_REEVALUATION_COUNT_FIELDS = [
    { key: "scanned_user_count", label: "Gepruefte User" },
    { key: "affected_user_count", label: "Betroffene User" },
    { key: "assign_count", label: "Zuweisungen" },
    { key: "reassign_count", label: "Neuzuordnungen" },
    { key: "reactivate_count", label: "Reaktivierungen" },
    { key: "revoke_count", label: "Entzuege" },
    { key: "abort_count", label: "Abbrueche" }
];

function formatFromMap(map, value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }
    return map[value] || humanizeToken(value);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeToken(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function humanizeToken(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return "-";
    }

    return normalized
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function parseDateLike(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getTime());
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }

    const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfISOWeek(date) {
    const baseDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const weekday = baseDate.getDay() || 7;
    baseDate.setDate(baseDate.getDate() - weekday + 1);
    baseDate.setHours(0, 0, 0, 0);
    return baseDate;
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
}

function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function toDayKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function getISOWeekInfo(date) {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + 4 - (target.getDay() || 7));
    const yearStart = new Date(target.getFullYear(), 0, 1);
    const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    return {
        year: target.getFullYear(),
        week
    };
}

function formatDayHeading(date) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(date);
}

function formatDayDate(date) {
    return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit"
    }).format(date);
}

function formatWeekRange(startDate) {
    const endDate = addDays(startDate, 6);
    return `${new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit"
    }).format(startDate)} - ${new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(endDate)}`;
}

function formatTime(value) {
    const parsed = parseDateLike(value);
    if (!parsed) {
        return "";
    }

    if (!/[tT ]\d{1,2}:\d{2}/.test(String(value))) {
        return "";
    }

    return new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
    }).format(parsed);
}

function getWeekStart() {
    const baseWeek = startOfISOWeek(new Date());
    return addDays(baseWeek, consoleState.weekOffset * 7);
}

function getWeekDays() {
    const weekStart = getWeekStart();
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function getRenderableEvents() {
    return (Array.isArray(consoleState.events) ? consoleState.events : [])
        .map(event => {
            const eventDate = parseDateLike(event.display_at);
            if (!eventDate) {
                return null;
            }

            return {
                ...event,
                _date: eventDate
            };
        })
        .filter(Boolean);
}

function getEventsByDay() {
    const weekDays = getWeekDays();
    const buckets = new Map(weekDays.map(day => [toDayKey(day), []]));

    getRenderableEvents().forEach(event => {
        const key = toDayKey(event._date);
        if (!buckets.has(key)) {
            return;
        }
        buckets.get(key).push(event);
    });

    buckets.forEach(items => {
        items.sort((left, right) => {
            const timestampDiff = left._date.getTime() - right._date.getTime();
            if (timestampDiff !== 0) {
                return timestampDiff;
            }
            return String(left.title || "").localeCompare(String(right.title || ""), "de");
        });
    });

    return buckets;
}

function setCalendarFeedback(message, stateClass = "") {
    if (!consoleDOM.feedback) {
        return;
    }

    consoleDOM.feedback.textContent = message;
    consoleDOM.feedback.className = "console-calendar-feedback";
    if (stateClass) {
        consoleDOM.feedback.classList.add(stateClass);
    }
}

function getEventStatusClass(eventStatus) {
    const normalized = normalizeToken(eventStatus);
    return {
        planned: "console-event-status-planned",
        executed: "console-event-status-executed",
        failed: "console-event-status-failed",
        skipped: "console-event-status-skipped",
        canceled: "console-event-status-canceled"
    }[normalized] || "console-event-status-skipped";
}

function renderEventCard(event) {
    const title = event.title || humanizeToken(event.event_type || "event");
    const description = String(event.description || "").trim();
    const statusLabel = formatFromMap(LABELS.event_status, event.event_status) || humanizeToken(event.event_status || "unknown");

    return `
        <article class="console-event-card ${event.blocks_process_completion ? "is-blocking" : ""}">
            <strong class="console-event-title">${escapeHtml(title)}</strong>
            <div class="console-event-meta">
                <span class="console-event-badge ${escapeHtml(getEventStatusClass(event.event_status))} hidden">${escapeHtml(statusLabel)}</span>
            </div>
            ${description ? `<span class="console-event-description">${escapeHtml(description)}</span>` : ""}
        </article>
    `;
}

function renderCalendar() {
    if (!consoleDOM.grid) {
        return;
    }

    const weekDays = getWeekDays();
    const eventsByDay = getEventsByDay();
    const today = new Date();
    const hasWeekEvents = Array.from(eventsByDay.values()).some(items => items.length > 0);

    const { week, year } = getISOWeekInfo(weekDays[0]);
    consoleDOM.weekLabel.textContent = `KW ${String(week).padStart(2, "0")} / ${year}`;
    consoleDOM.weekRange.textContent = formatWeekRange(weekDays[0]);

    const dayMarkup = weekDays.map(day => {
        const dayKey = toDayKey(day);
        const events = eventsByDay.get(dayKey) || [];

        return `
            <section class="console-calendar-day ${isSameDay(day, today) ? "is-today" : ""} ${events.length ? "" : "is-empty"}">
                <div class="console-day-head">
                    <strong class="console-day-title">${escapeHtml(humanizeToken(formatDayHeading(day)))}</strong>
                    <span class="console-day-date">${escapeHtml(formatDayDate(day))}</span>
                </div>
                <div class="console-day-events">
                    ${events.length
                        ? events.map(renderEventCard).join("")
                        : `<div class="console-empty-day">Keine Events in diesem Tag.</div>`}
                </div>
            </section>
        `;
    }).join("");

    consoleDOM.grid.innerHTML = hasWeekEvents
        ? dayMarkup
        : `${dayMarkup}<div class="console-empty-week">In dieser Kalenderwoche sind keine Events vorhanden.</div>`;

    if (consoleState.error) {
        setCalendarFeedback(consoleState.error, "is-error");
        return;
    }

    setCalendarFeedback(
        hasWeekEvents
            ? "Die sichtbare Kalenderwoche wurde aus den geladenen Prozess-Events aufgebaut."
            : "Fuer die sichtbare Kalenderwoche wurden keine Events gefunden.",
        "is-success"
    );
}

async function loadEvents() {
    consoleState.loading = true;
    consoleState.error = null;
    setCalendarFeedback("Events werden geladen...");

    try {
        const response = await fetch("/api/events");
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || data.detail || `Events konnten nicht geladen werden (${response.status})`);
        }

        consoleState.events = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Kalender-Events konnten nicht geladen werden", error);
        consoleState.events = [];
        consoleState.error = error instanceof Error
            ? error.message
            : "Events konnten nicht geladen werden.";
    } finally {
        consoleState.loading = false;
        renderCalendar();
    }
}

function bindCalendarControls() {
    consoleDOM.prevBtn?.addEventListener("click", () => {
        consoleState.weekOffset -= 1;
        renderCalendar();
    });

    consoleDOM.nextBtn?.addEventListener("click", () => {
        consoleState.weekOffset += 1;
        renderCalendar();
    });

    consoleDOM.currentBtn?.addEventListener("click", () => {
        consoleState.weekOffset = 0;
        renderCalendar();
    });
}

function hasRoleReevaluationAccess() {
    const pages = window.currentAuthz?.pages;
    return Array.isArray(pages) && pages.includes("roles");
}

function setRoleReevaluationFeedback(message = "", stateClass = "") {
    if (!consoleDOM.reevaluateFeedback) {
        return;
    }

    consoleDOM.reevaluateFeedback.textContent = message;
    consoleDOM.reevaluateFeedback.className = "console-reevaluate-feedback";
    if (stateClass) {
        consoleDOM.reevaluateFeedback.classList.add(stateClass);
    }
}

function formatRoleOptionLabel(role) {
    const roleName = String(role?.name || `Rolle #${role?.role_id ?? "-"}`).trim();
    return `${roleName} (ID ${role?.role_id ?? "-"})`;
}

function sortRoles(roles) {
    return [...roles].sort((left, right) => {
        const leftName = String(left?.name || "").trim();
        const rightName = String(right?.name || "").trim();
        const nameDiff = leftName.localeCompare(rightName, "de", { sensitivity: "base" });
        if (nameDiff !== 0) {
            return nameDiff;
        }
        return Number(left?.role_id || 0) - Number(right?.role_id || 0);
    });
}

function renderRoleOptions() {
    if (!consoleDOM.reevaluateRoleSelect) {
        return;
    }

    const options = ['<option value="">Rolle auswaehlen...</option>'];

    sortRoles(consoleState.reevaluate.roles).forEach(role => {
        const roleId = String(role?.role_id ?? "");
        const isSelected = roleId === String(consoleState.reevaluate.selectedRoleId);
        options.push(
            `<option value="${escapeHtml(roleId)}" ${isSelected ? "selected" : ""}>${escapeHtml(formatRoleOptionLabel(role))}</option>`
        );
    });

    consoleDOM.reevaluateRoleSelect.innerHTML = options.join("");
}

function getCurrentReevaluationResult() {
    return consoleState.reevaluate.executionResult || consoleState.reevaluate.previewResult;
}

function formatAssignmentStatus(value) {
    if (!value) {
        return "";
    }
    return humanizeToken(String(value).toUpperCase());
}

function formatReevaluationAction(value) {
    const normalized = normalizeToken(value);
    return ROLE_REEVALUATION_ACTION_LABELS[normalized] || humanizeToken(value);
}

function renderCounts(result) {
    return ROLE_REEVALUATION_COUNT_FIELDS.map(({ key, label }) => `
        <div class="console-reevaluate-count-card">
            <span class="console-reevaluate-count-label">${escapeHtml(label)}</span>
            <strong class="console-reevaluate-count-value">${escapeHtml(result?.[key] ?? 0)}</strong>
        </div>
    `).join("");
}

function renderUsers(result) {
    const users = Array.isArray(result?.users) ? result.users : [];
    if (!users.length) {
        return `
            <div class="console-reevaluate-empty">
                Keine betroffenen User oder Ressourcen in der Rueckgabe vorhanden.
            </div>
        `;
    }

    return users.map(user => {
        const changes = Array.isArray(user?.changes) ? user.changes : [];
        const changesMarkup = changes.length
            ? changes.map(change => {
                const assignmentStatus = formatAssignmentStatus(change?.current_assignment_status);
                return `
                    <div class="console-reevaluate-change-item">
                        <div class="console-reevaluate-change-main">
                            <strong>${escapeHtml(change?.resource_name || `Ressource #${change?.resource_id ?? "-"}`)}</strong>
                            <span>Ressource ${escapeHtml(change?.resource_id ?? "-")}</span>
                        </div>
                        <div class="console-reevaluate-change-meta">
                            <span class="console-reevaluate-action-badge">${escapeHtml(formatReevaluationAction(change?.action))}</span>
                            ${assignmentStatus ? `<span class="console-reevaluate-status">Status: ${escapeHtml(assignmentStatus)}</span>` : ""}
                        </div>
                    </div>
                `;
            }).join("")
            : `<div class="console-reevaluate-empty">Keine Aenderungen fuer diesen User gemeldet.</div>`;

        return `
            <article class="console-reevaluate-user-card">
                <div class="console-reevaluate-user-head">
                    <strong>User ${escapeHtml(user?.user_id ?? "-")}</strong>
                    <span>${escapeHtml(changes.length)} Aenderung${changes.length === 1 ? "" : "en"}</span>
                </div>
                <div class="console-reevaluate-change-list">
                    ${changesMarkup}
                </div>
            </article>
        `;
    }).join("");
}

function updateRoleReevaluationButtons() {
    if (consoleDOM.reevaluatePreviewBtn) {
        const isBusy = consoleState.reevaluate.previewLoading || consoleState.reevaluate.executeLoading;
        consoleDOM.reevaluatePreviewBtn.disabled = isBusy;
        consoleDOM.reevaluatePreviewBtn.textContent = consoleState.reevaluate.previewLoading
            ? "Vorschau laedt..."
            : "Vorschau laden";
    }

    const executeBtn = document.getElementById("reevaluate-execute-btn");
    if (executeBtn) {
        executeBtn.disabled = consoleState.reevaluate.previewLoading || consoleState.reevaluate.executeLoading;
        executeBtn.textContent = consoleState.reevaluate.executeLoading
            ? "Re-Evaluierung laeuft..."
            : "Re-Evaluierung ausfuehren";
    }

    if (consoleDOM.reevaluateRoleSelect) {
        consoleDOM.reevaluateRoleSelect.disabled = consoleState.reevaluate.loadingRoles
            || consoleState.reevaluate.previewLoading
            || consoleState.reevaluate.executeLoading;
    }
}

function renderRoleReevaluationResult() {
    if (!consoleDOM.reevaluateResults) {
        return;
    }

    const result = getCurrentReevaluationResult();
    if (!result) {
        consoleDOM.reevaluateResults.innerHTML = `
            <div class="console-reevaluate-empty">
                Waehle eine Rolle aus und lade zuerst die Vorschau.
            </div>
        `;
        updateRoleReevaluationButtons();
        return;
    }

    const isPreview = Boolean(result.dry_run);
    const hasAffectedUsers = Number(result.affected_user_count || 0) > 0;
    const canExecute = isPreview
        && hasAffectedUsers
        && String(result.role_id) === String(consoleState.reevaluate.selectedRoleId);

    consoleDOM.reevaluateResults.innerHTML = `
        <section class="console-reevaluate-result-card">
            <div class="console-reevaluate-result-head">
                <div>
                    <p class="console-reevaluate-result-kicker">${isPreview ? "Vorschau" : "Ergebnis"}</p>
                    <h3 class="ui-section-title">Rollenpaket ${escapeHtml(result.role_id ?? "-")}</h3>
                </div>
                <span class="ui-chip ${isPreview ? "ui-chip-neutral" : "ui-chip-primary"}">${isPreview ? "Dry Run" : "Ausgefuehrt"}</span>
            </div>

            <div class="console-reevaluate-count-grid">
                ${renderCounts(result)}
            </div>

            ${Number(result.affected_user_count || 0) === 0
                ? `<div class="console-reevaluate-success">Keine nachtraeglichen Aenderungen noetig.</div>`
                : `
                    <div class="console-reevaluate-user-list">
                        ${renderUsers(result)}
                    </div>
                `}

            ${canExecute
                ? `
                    <div class="console-reevaluate-result-actions">
                        <button type="button" class="btn btn-primary" id="reevaluate-execute-btn">
                            Re-Evaluierung ausfuehren
                        </button>
                    </div>
                `
                : ""}
        </section>
    `;

    document.getElementById("reevaluate-execute-btn")?.addEventListener("click", () => {
        runRoleReevaluation(false);
    });

    updateRoleReevaluationButtons();
}

function resetRoleReevaluationResults() {
    consoleState.reevaluate.previewResult = null;
    consoleState.reevaluate.executionResult = null;
    consoleState.reevaluate.error = null;
    renderRoleReevaluationResult();
}

async function loadRolesForReevaluation() {
    if (!consoleDOM.reevaluateRoleSelect || !hasRoleReevaluationAccess()) {
        return;
    }

    consoleState.reevaluate.loadingRoles = true;
    updateRoleReevaluationButtons();
    setRoleReevaluationFeedback("Rollen werden geladen...");

    try {
        const response = await fetch("/api/roles");
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || data.error || "Rollen konnten nicht geladen werden.");
        }

        consoleState.reevaluate.roles = Array.isArray(data) ? data : [];
        renderRoleOptions();
        renderRoleReevaluationResult();
        setRoleReevaluationFeedback(
            consoleState.reevaluate.roles.length
                ? "Waehle eine Rolle fuer die Vorschau aus."
                : "Es sind keine Rollen fuer die Re-Evaluierung verfuegbar.",
            consoleState.reevaluate.roles.length ? "is-success" : ""
        );
    } catch (error) {
        console.error("Rollen fuer die Re-Evaluierung konnten nicht geladen werden", error);
        consoleState.reevaluate.roles = [];
        renderRoleOptions();
        renderRoleReevaluationResult();
        setRoleReevaluationFeedback(
            error instanceof Error ? error.message : "Rollen konnten nicht geladen werden.",
            "is-error"
        );
    } finally {
        consoleState.reevaluate.loadingRoles = false;
        updateRoleReevaluationButtons();
    }
}

async function runRoleReevaluation(dryRun) {
    const selectedRoleId = String(consoleState.reevaluate.selectedRoleId || "").trim();
    if (!selectedRoleId) {
        setRoleReevaluationFeedback("Bitte zuerst eine Rolle auswaehlen.", "is-error");
        showFlash("Bitte zuerst eine Rolle auswaehlen.", "failure");
        return;
    }

    if (!dryRun) {
        const previewResult = consoleState.reevaluate.previewResult;
        if (!previewResult || String(previewResult.role_id) !== selectedRoleId) {
            setRoleReevaluationFeedback("Bitte zuerst eine aktuelle Vorschau fuer diese Rolle laden.", "is-error");
            showFlash("Bitte zuerst eine aktuelle Vorschau fuer diese Rolle laden.", "failure");
            return;
        }
    }

    consoleState.reevaluate.error = null;
    if (dryRun) {
        consoleState.reevaluate.previewLoading = true;
        consoleState.reevaluate.executionResult = null;
        setRoleReevaluationFeedback("Vorschau wird geladen...");
    } else {
        consoleState.reevaluate.executeLoading = true;
        setRoleReevaluationFeedback("Re-Evaluierung wird ausgefuehrt...");
    }
    updateRoleReevaluationButtons();

    try {
        const response = await fetch(`/api/roles/${encodeURIComponent(selectedRoleId)}/resources/reevaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dry_run: dryRun })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || data.error || "Re-Evaluierung konnte nicht ausgefuehrt werden.");
        }

        if (dryRun) {
            consoleState.reevaluate.previewResult = data;
            consoleState.reevaluate.executionResult = null;
            setRoleReevaluationFeedback("Vorschau erfolgreich geladen.", "is-success");
        } else {
            consoleState.reevaluate.executionResult = data;
            setRoleReevaluationFeedback("Re-Evaluierung erfolgreich ausgefuehrt.", "is-success");
        }

        renderRoleReevaluationResult();
    } catch (error) {
        console.error("Re-Evaluierung fehlgeschlagen", error);
        const message = error instanceof Error
            ? error.message
            : "Re-Evaluierung konnte nicht ausgefuehrt werden.";
        consoleState.reevaluate.error = message;
        setRoleReevaluationFeedback(message, "is-error");
        showFlash(message, "failure");
    } finally {
        consoleState.reevaluate.previewLoading = false;
        consoleState.reevaluate.executeLoading = false;
        updateRoleReevaluationButtons();
    }
}

function bindRoleReevaluationControls() {
    if (!consoleDOM.reevaluateRoleSelect || !consoleDOM.reevaluatePreviewBtn) {
        return;
    }

    consoleDOM.reevaluateRoleSelect.addEventListener("change", event => {
        consoleState.reevaluate.selectedRoleId = String(event.target.value || "");
        resetRoleReevaluationResults();
        setRoleReevaluationFeedback(consoleState.reevaluate.selectedRoleId ? "" : "Bitte eine Rolle auswaehlen.");
    });

    consoleDOM.reevaluatePreviewBtn.addEventListener("click", () => {
        runRoleReevaluation(true);
    });
}

function cacheDom() {
    consoleDOM.grid = document.getElementById("console-calendar-grid");
    consoleDOM.feedback = document.getElementById("console-calendar-feedback");
    consoleDOM.weekLabel = document.getElementById("console-week-label");
    consoleDOM.weekRange = document.getElementById("console-week-range");
    consoleDOM.prevBtn = document.getElementById("console-week-prev");
    consoleDOM.nextBtn = document.getElementById("console-week-next");
    consoleDOM.currentBtn = document.getElementById("console-week-current");
    consoleDOM.reevaluateRoleSelect = document.getElementById("reevaluate-role-select");
    consoleDOM.reevaluatePreviewBtn = document.getElementById("reevaluate-preview-btn");
    consoleDOM.reevaluateFeedback = document.getElementById("reevaluate-feedback");
    consoleDOM.reevaluateResults = document.getElementById("reevaluate-results");
}

function initConsole() {
    cacheDom();

    if (consoleDOM.grid) {
        bindCalendarControls();
        renderCalendar();
        loadEvents();
    }

    if (consoleDOM.reevaluateRoleSelect && hasRoleReevaluationAccess()) {
        bindRoleReevaluationControls();
        renderRoleReevaluationResult();
        loadRolesForReevaluation();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConsole);
} else {
    initConsole();
}
