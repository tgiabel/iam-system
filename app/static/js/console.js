const consoleState = {
    events: [],
    weekOffset: 0,
    loading: false,
    error: null,
    processes: {
        loaded: false,
        loading: false,
        error: null,
        data: {
            running_processes: [],
            completed_processes: []
        }
    },
    reevaluate: {
        roles: [],
        selectedRoleId: "",
        previewResult: null,
        executionResult: null,
        loadingRoles: false,
        previewLoading: false,
        executeLoading: false,
        error: null
    },
    sofa: {
        roles: [],
        selectedRoleId: "",
        roleDetail: null,
        catalog: null,
        loadingRoles: false,
        loadingDetail: false,
        saving: false,
        editing: false
    }
};

const consoleDOM = {};

const LABELS = {
    process: {
        SKILL_ASSIGNMENT: "Rollenzuweisung",
        SKILL_REMOVAL: "Rollenentzug",
        TEMPORARY_ROLE: "Temporäre Rolle",
        ONBOARDING: "Onboarding",
        OFFBOARDING: "Offboarding",
        CHANGE: "Funktionswechsel"
    },
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

const PROCESS_KEYS = {
    id: ["process_id", "id"],
    name: ["process_name", "name", "process_type", "type"],
    target: ["target_name", "for_name", "resource_name", "user_name", "target_user_name"],
    triggeredBy: ["initiator_name", "triggered_by_name", "created_by_name", "initiator_user_name", "created_by"],
    startedAt: ["started_at", "created_at", "process_started_at"],
    completedAt: ["completed_at", "finished_at", "process_completed_at"],
    openTaskCount: ["open_task_count", "pending_task_count"]
};

async function fetchJson(url, options = {}, fallback = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => fallback);

    if (!response.ok) {
        throw new Error(data.detail || data.error || `Request fehlgeschlagen (${response.status})`);
    }

    return data;
}

async function fetchRoleOverviewList() {
    const data = await fetchJson("/api/roles", {}, []);
    return Array.isArray(data) ? data : [];
}

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

function firstDefinedValue(record, keys, fallback = "-") {
    for (const key of keys) {
        const value = record?.[key];
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return fallback;
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

function formatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatProcessLabel(process) {
    const explicitProcessName = firstDefinedValue(process, ["process_name", "name"], "");
    if (explicitProcessName && explicitProcessName !== "-") {
        return String(explicitProcessName);
    }

    const processType = firstDefinedValue(process, ["process_type", "type"], "");
    if (processType && processType !== "-") {
        return formatFromMap(LABELS.process, processType);
    }

    return "Prozess";
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

function getFirstArrayByKeys(data, keys) {
    for (const key of keys) {
        if (Array.isArray(data?.[key])) {
            return data[key];
        }
    }
    return [];
}

function extractProcessBuckets(data) {
    const running = getFirstArrayByKeys(data, [
        "running_processes",
        "open_processes",
        "active_processes",
        "ongoing_processes"
    ]);

    const completed = getFirstArrayByKeys(data, [
        "completed_processes",
        "closed_processes",
        "finished_processes"
    ]);

    if (running.length || completed.length) {
        return { running, completed };
    }

    const allProcesses = getFirstArrayByKeys(data, ["processes"]);
    if (!allProcesses.length) {
        return { running: [], completed: [] };
    }

    return allProcesses.reduce((acc, process) => {
        const completedAt = firstDefinedValue(process, PROCESS_KEYS.completedAt, null);
        const status = String(process.status || "").toUpperCase();
        const isCompleted = Boolean(completedAt) || ["COMPLETED", "DONE", "FINISHED", "CANCELLED"].includes(status);

        if (isCompleted) {
            acc.completed.push(process);
        } else {
            acc.running.push(process);
        }
        return acc;
    }, { running: [], completed: [] });
}

function computeOpenTaskCount(process) {
    const explicitCount = firstDefinedValue(process, PROCESS_KEYS.openTaskCount, null);
    if (explicitCount !== null) {
        return explicitCount;
    }

    if (Array.isArray(process.open_tasks)) {
        return process.open_tasks.length;
    }

    if (Array.isArray(process.tasks)) {
        return process.tasks.filter(task => !task.completed_at && task.status !== "COMPLETED").length;
    }

    return "-";
}

function renderProcessRow(process, isCompleted) {
    const id = firstDefinedValue(process, PROCESS_KEYS.id);
    const name = formatProcessLabel(process);
    const target = firstDefinedValue(process, PROCESS_KEYS.target);
    const triggeredBy = firstDefinedValue(process, PROCESS_KEYS.triggeredBy);
    const startedAt = formatDateTime(firstDefinedValue(process, PROCESS_KEYS.startedAt, null));

    if (isCompleted) {
        const completedAt = formatDateTime(firstDefinedValue(process, PROCESS_KEYS.completedAt, null));
        return `
            <tr>
                <td>${escapeHtml(id)}</td>
                <td>${escapeHtml(name)}</td>
                <td>${escapeHtml(target)}</td>
                <td>${escapeHtml(triggeredBy)}</td>
                <td>${escapeHtml(startedAt)}</td>
                <td>${escapeHtml(completedAt)}</td>
            </tr>
        `;
    }

    const openTaskCount = computeOpenTaskCount(process);
    return `
        <tr>
            <td>${escapeHtml(id)}</td>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(target)}</td>
            <td>${escapeHtml(triggeredBy)}</td>
            <td>${escapeHtml(startedAt)}</td>
            <td>${escapeHtml(openTaskCount)}</td>
        </tr>
    `;
}

function renderProcessStateRow(body, message, variant = "empty") {
    if (!body) {
        return;
    }

    const stateClass = variant === "error"
        ? "console-process-state-row console-process-state-error"
        : "console-process-state-row";

    body.innerHTML = `
        <tr class="${stateClass}">
            <td colspan="6">
                <div class="ui-empty-state ui-empty-inline">${escapeHtml(message)}</div>
            </td>
        </tr>
    `;
}

function renderProcessTable(body, processes, isCompleted) {
    if (!body) {
        return;
    }

    if (!processes.length) {
        renderProcessStateRow(
            body,
            isCompleted ? "Keine abgeschlossenen Prozesse vorhanden." : "Keine laufenden Prozesse vorhanden."
        );
        return;
    }

    body.innerHTML = processes.map(process => renderProcessRow(process, isCompleted)).join("");
}

function renderProcessTables(data) {
    const { running, completed } = extractProcessBuckets(data);
    renderProcessTable(consoleDOM.runningProcessesBody, running, false);
    renderProcessTable(consoleDOM.completedProcessesBody, completed, true);
}

function renderProcessLoadingState() {
    renderProcessStateRow(consoleDOM.runningProcessesBody, "Lade laufende Prozesse...", "loading");
    renderProcessStateRow(consoleDOM.completedProcessesBody, "Lade abgeschlossene Prozesse...", "loading");
}

function renderProcessErrorState(message) {
    renderProcessStateRow(consoleDOM.runningProcessesBody, message, "error");
    renderProcessStateRow(consoleDOM.completedProcessesBody, message, "error");
}

async function loadProcesses(forceReload = false) {
    if (!consoleDOM.runningProcessesBody || !consoleDOM.completedProcessesBody || consoleState.processes.loading) {
        return;
    }

    if (consoleState.processes.loaded && !forceReload) {
        renderProcessTables(consoleState.processes.data);
        return;
    }

    consoleState.processes.loading = true;
    consoleState.processes.error = null;
    renderProcessLoadingState();

    try {
        const data = await fetchJson("/api/processes/overview", {}, {});
        consoleState.processes.loaded = true;
        consoleState.processes.data = data;
        renderProcessTables(consoleState.processes.data);
    } catch (error) {
        consoleState.processes.error = error;
        console.error("Prozess-Ladefehler:", error);
        renderProcessErrorState("Prozessübersicht konnte nicht geladen werden.");
    } finally {
        consoleState.processes.loading = false;
    }
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
        consoleState.reevaluate.roles = await fetchRoleOverviewList();
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

function hasSofaAuthorizationAccess() {
    const pages = window.currentAuthz?.pages;
    return Array.isArray(pages) && pages.includes("console") && pages.includes("roles");
}

function setSofaFeedback(message = "", stateClass = "") {
    if (!consoleDOM.sofaFeedback) {
        return;
    }

    consoleDOM.sofaFeedback.textContent = message;
    consoleDOM.sofaFeedback.className = "console-sofa-feedback";
    if (stateClass) {
        consoleDOM.sofaFeedback.classList.add(stateClass);
    }
}

function getSofaPermissions() {
    return [...(Array.isArray(consoleState.sofa.catalog?.permissions) ? consoleState.sofa.catalog.permissions : [])]
        .sort((left, right) => {
            const leftOrder = Number(left?.sort_order ?? 0);
            const rightOrder = Number(right?.sort_order ?? 0);
            if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
            }
            return String(left?.permission_key || "").localeCompare(String(right?.permission_key || ""), "de");
        });
}

function getSofaPermissionDefinition(permissionKey) {
    return getSofaPermissions().find(permission => permission.permission_key === permissionKey) || null;
}

function getSofaCatalogResources() {
    return Array.isArray(consoleState.sofa.catalog?.resources) ? consoleState.sofa.catalog.resources : [];
}

function getSofaResourcesByTypeSlug(typeSlug) {
    return getSofaCatalogResources().filter(resource => String(resource?.type_slug || "") === String(typeSlug || ""));
}

function getSofaResourceById(resourceId) {
    return getSofaCatalogResources().find(resource => Number(resource?.resource_id) === Number(resourceId)) || null;
}

function getDirectSofaGrants() {
    return Array.isArray(consoleState.sofa.roleDetail?.sofa_grants) ? consoleState.sofa.roleDetail.sofa_grants : [];
}

function getInheritedSofaGrants() {
    return Array.isArray(consoleState.sofa.roleDetail?.inherited_sofa_grants) ? consoleState.sofa.roleDetail.inherited_sofa_grants : [];
}

function formatPermissionArea(permissionKey) {
    const area = String(permissionKey || "").split(".")[0] || "";
    switch (area) {
        case "users":
            return "User";
        case "tasks":
            return "Tasks";
        case "tools":
            return "Tools";
        case "reports":
            return "Reports";
        case "roles":
            return "Rollen";
        case "systems":
            return "Systeme";
        case "sofa_access":
            return "SOFA-Zugang";
        default:
            return area || "-";
    }
}

function getPermissionLabel(permissionKey) {
    return getSofaPermissionDefinition(permissionKey)?.label || permissionKey || "-";
}

function summarizeGrantScope(grant) {
    const permissionDefinition = getSofaPermissionDefinition(grant?.permission);
    if (!permissionDefinition?.scope_resource_type_slug || permissionDefinition?.is_global_only) {
        return "Global";
    }

    if (grant?.all_scoped_resources) {
        return `Alle ${permissionDefinition.scope_resource_type_name || "Ressourcen"}`;
    }

    const resourceIds = Array.isArray(grant?.resource_ids) ? grant.resource_ids : [];
    return resourceIds.length ? "Ressourcenbegrenzt" : "Keine Auswahl";
}

function summarizeGrantResources(grant) {
    const permissionDefinition = getSofaPermissionDefinition(grant?.permission);
    if (!permissionDefinition?.scope_resource_type_slug || permissionDefinition?.is_global_only) {
        return "<span class=\"ui-chip ui-chip-neutral\">Keine Einschraenkung</span>";
    }

    if (grant?.all_scoped_resources) {
        return `<span class="ui-chip ui-chip-primary">Alle ${escapeHtml(permissionDefinition.scope_resource_type_name || "Ressourcen")}</span>`;
    }

    const resourceIds = Array.isArray(grant?.resource_ids) ? grant.resource_ids : [];
    if (!resourceIds.length) {
        return `<span class="ui-chip ui-chip-neutral">Keine Ressourcen gewaehlt</span>`;
    }

    return `
        <div class="console-sofa-resource-list">
            ${resourceIds.map(resourceId => {
                const resource = getSofaResourceById(resourceId);
                const label = resource?.display_name || resource?.technical_identifier || `Ressource ${resourceId}`;
                return `<span class="ui-chip ui-chip-neutral">${escapeHtml(label)}</span>`;
            }).join("")}
        </div>
    `;
}

function renderSofaGrantTable(tableBody, grants, emptyMessage) {
    if (!tableBody) {
        return;
    }

    if (!grants.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" class="console-sofa-empty">${escapeHtml(emptyMessage)}</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = grants.map(grant => `
        <tr>
            <td>${escapeHtml(getPermissionLabel(grant.permission))}</td>
            <td>${escapeHtml(formatPermissionArea(grant.permission))}</td>
            <td>${escapeHtml(summarizeGrantScope(grant))}</td>
            <td>${summarizeGrantResources(grant)}</td>
        </tr>
    `).join("");
}

function renderSofaSummary() {
    const roleDetail = consoleState.sofa.roleDetail;
    const directGrants = getDirectSofaGrants();
    const inheritedGrants = getInheritedSofaGrants();

    if (!roleDetail) {
        if (consoleDOM.sofaRoleName) {
            consoleDOM.sofaRoleName.textContent = "-";
        }
        if (consoleDOM.sofaRoleMeta) {
            consoleDOM.sofaRoleMeta.textContent = "Waehle eine Rolle fuer die Berechtigungsansicht.";
        }
        if (consoleDOM.sofaDirectCount) {
            consoleDOM.sofaDirectCount.textContent = "0";
        }
        if (consoleDOM.sofaInheritedCount) {
            consoleDOM.sofaInheritedCount.textContent = "0";
        }
        if (consoleDOM.sofaTotalCount) {
            consoleDOM.sofaTotalCount.textContent = "0";
        }
        return;
    }

    const roleType = humanizeToken(roleDetail.role_type || "rolle");
    const roleStatus = humanizeToken(roleDetail.role_status || roleDetail.status || "aktiv");
    const parentLabel = roleDetail.parent_role_name ? ` erbt von ${roleDetail.parent_role_name}` : "";

    consoleDOM.sofaRoleName.textContent = roleDetail.name || `Rolle ${roleDetail.role_id}`;
    consoleDOM.sofaRoleMeta.textContent = `ID ${roleDetail.role_id} · ${roleType} · ${roleStatus}${parentLabel}`;
    consoleDOM.sofaDirectCount.textContent = String(directGrants.length);
    consoleDOM.sofaInheritedCount.textContent = String(inheritedGrants.length);
    consoleDOM.sofaTotalCount.textContent = String(directGrants.length + inheritedGrants.length);
}

function renderSofaOverview() {
    renderSofaSummary();

    renderSofaGrantTable(
        consoleDOM.sofaDirectBody,
        getDirectSofaGrants(),
        "Fuer diese Rolle sind keine direkten SOFA-Grants hinterlegt."
    );
    renderSofaGrantTable(
        consoleDOM.sofaInheritedBody,
        getInheritedSofaGrants(),
        "Fuer diese Rolle sind keine geerbten SOFA-Grants vorhanden."
    );
}

function updateSofaButtons() {
    const isBusy = consoleState.sofa.loadingRoles || consoleState.sofa.loadingDetail || consoleState.sofa.saving;
    const hasSelection = Boolean(consoleState.sofa.selectedRoleId);
    const hasAccess = hasSofaAuthorizationAccess();

    if (consoleDOM.sofaRoleSelect) {
        consoleDOM.sofaRoleSelect.disabled = isBusy || !hasAccess;
    }
    if (consoleDOM.sofaReloadBtn) {
        consoleDOM.sofaReloadBtn.disabled = isBusy || !hasAccess;
        consoleDOM.sofaReloadBtn.textContent = consoleState.sofa.loadingDetail ? "Laedt..." : "Neu laden";
    }
    if (consoleDOM.sofaEditBtn) {
        consoleDOM.sofaEditBtn.disabled = isBusy || !hasAccess || !hasSelection;
    }
    if (consoleDOM.sofaAddGrantBtn) {
        consoleDOM.sofaAddGrantBtn.disabled = consoleState.sofa.saving || !hasAccess;
    }
    if (consoleDOM.sofaCancelBtn) {
        consoleDOM.sofaCancelBtn.disabled = consoleState.sofa.saving;
    }
    if (consoleDOM.sofaSaveBtn) {
        consoleDOM.sofaSaveBtn.disabled = consoleState.sofa.saving || !hasAccess;
        consoleDOM.sofaSaveBtn.textContent = consoleState.sofa.saving
            ? "Speichert..."
            : "SOFA-Berechtigungen speichern";
    }
}

function renderSofaRoleOptions() {
    if (!consoleDOM.sofaRoleSelect) {
        return;
    }

    const options = ['<option value="">Rolle auswaehlen...</option>'];
    sortRoles(consoleState.sofa.roles).forEach(role => {
        const roleId = String(role?.role_id ?? "");
        const isSelected = roleId === String(consoleState.sofa.selectedRoleId);
        options.push(
            `<option value="${escapeHtml(roleId)}" ${isSelected ? "selected" : ""}>${escapeHtml(formatRoleOptionLabel(role))}</option>`
        );
    });

    consoleDOM.sofaRoleSelect.innerHTML = options.join("");
}

async function ensureSofaCatalogLoaded() {
    if (consoleState.sofa.catalog) {
        return consoleState.sofa.catalog;
    }

    const data = await fetchJson("/api/sofa/permissions", {}, {});
    consoleState.sofa.catalog = data;
    return data;
}

async function loadRolesForSofa() {
    if (!consoleDOM.sofaRoleSelect || !hasSofaAuthorizationAccess()) {
        return;
    }

    consoleState.sofa.loadingRoles = true;
    updateSofaButtons();
    setSofaFeedback("Rollen werden geladen...");

    try {
        consoleState.sofa.roles = await fetchRoleOverviewList();
        renderSofaRoleOptions();
        setSofaFeedback(
            consoleState.sofa.roles.length
                ? "Waehle eine Rolle fuer die SOFA-Berechtigungsansicht."
                : "Es sind keine Rollen verfuegbar.",
            consoleState.sofa.roles.length ? "is-success" : ""
        );
    } catch (error) {
        console.error("SOFA-Rollen konnten nicht geladen werden", error);
        consoleState.sofa.roles = [];
        renderSofaRoleOptions();
        setSofaFeedback(error instanceof Error ? error.message : "Rollen konnten nicht geladen werden.", "is-error");
    } finally {
        consoleState.sofa.loadingRoles = false;
        updateSofaButtons();
    }
}

async function loadSofaRoleDetail(roleId) {
    if (!roleId || !hasSofaAuthorizationAccess()) {
        consoleState.sofa.roleDetail = null;
        renderSofaOverview();
        updateSofaButtons();
        return;
    }

    consoleState.sofa.loadingDetail = true;
    updateSofaButtons();
    setSofaFeedback("SOFA-Berechtigungen werden geladen...");

    try {
        await ensureSofaCatalogLoaded();
        const detail = await fetchJson(`/api/roles/${encodeURIComponent(roleId)}`, {}, {});
        consoleState.sofa.roleDetail = detail;
        renderSofaOverview();
        setSofaFeedback("SOFA-Berechtigungen geladen.", "is-success");

        if (consoleState.sofa.editing) {
            renderSofaGrantEditor(getDirectSofaGrants());
        }
    } catch (error) {
        console.error("SOFA-Detaildaten konnten nicht geladen werden", error);
        consoleState.sofa.roleDetail = null;
        renderSofaOverview();
        setSofaFeedback(error instanceof Error ? error.message : "SOFA-Berechtigungen konnten nicht geladen werden.", "is-error");
    } finally {
        consoleState.sofa.loadingDetail = false;
        updateSofaButtons();
    }
}

function createSofaGrantEditorRow(grant = null) {
    const row = document.createElement("div");
    row.className = "console-sofa-grant-row";

    const permissionOptions = getSofaPermissions().map(permission => `
        <option value="${escapeHtml(permission.permission_key)}">${escapeHtml(permission.label || permission.permission_key)}</option>
    `).join("");

    row.innerHTML = `
        <div class="console-sofa-grant-row-head">
            <div class="ui-field-group console-sofa-field">
                <label class="ui-field-label">Permission</label>
                <select class="ui-input console-sofa-permission-select">
                    <option value="">-- Bitte waehlen --</option>
                    ${permissionOptions}
                </select>
            </div>
            <button type="button" class="btn btn-red console-sofa-remove-grant-btn">Entfernen</button>
        </div>
        <div class="console-sofa-grant-grid"></div>
    `;

    row.querySelector(".console-sofa-remove-grant-btn").addEventListener("click", () => {
        row.remove();
        ensureSofaGrantEditorNotEmpty();
    });

    const select = row.querySelector(".console-sofa-permission-select");
    select.value = grant?.permission || "";
    select.addEventListener("change", () => renderSofaGrantResourceEditors(row, null));

    renderSofaGrantResourceEditors(row, grant);
    return row;
}

function ensureSofaGrantEditorNotEmpty() {
    if (!consoleDOM.sofaGrantList || consoleDOM.sofaGrantList.children.length > 0) {
        return;
    }
    consoleDOM.sofaGrantList.appendChild(createSofaGrantEditorRow());
}

async function renderSofaGrantResourceEditors(row, grant) {
    const permissionKey = row.querySelector(".console-sofa-permission-select")?.value;
    const permissionDefinition = getSofaPermissionDefinition(permissionKey);
    const container = row.querySelector(".console-sofa-grant-grid");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    const scopeTypeSlug = permissionDefinition?.scope_resource_type_slug;
    if (!scopeTypeSlug || permissionDefinition?.is_global_only) {
        container.innerHTML = `<div class="console-sofa-help">Diese Permission wird global vergeben und benoetigt keinen Ressourcenscope.</div>`;
        return;
    }

    const options = getSofaResourcesByTypeSlug(scopeTypeSlug).map(resource => ({
        id: resource.resource_id,
        label: resource.display_name || resource.technical_identifier || `Ressource ${resource.resource_id}`
    }));
    const allScopedResources = Boolean(grant?.all_scoped_resources);
    const resourceIds = Array.isArray(grant?.resource_ids) ? grant.resource_ids : [];
    const selectedIds = new Set(resourceIds.map(value => String(value)));

    const card = document.createElement("div");
    card.className = "console-sofa-scope-card";
    card.dataset.scopeTypeSlug = scopeTypeSlug;

    card.innerHTML = `
        <div>
            <strong>${escapeHtml(permissionDefinition.scope_resource_type_name || scopeTypeSlug)}</strong>
            <div class="console-sofa-help">Ressourcen dieses Typs fuer die aktuelle Permission.</div>
        </div>
        <label class="console-sofa-inline-check">
            <input type="checkbox" class="console-sofa-scope-all-checkbox" ${allScopedResources ? "checked" : ""}>
            Alle ${escapeHtml(permissionDefinition.scope_resource_type_name || "Ressourcen")}
        </label>
        <select class="ui-input console-sofa-multi-select" multiple size="6" ${allScopedResources ? "disabled" : ""}>
            ${options.map(option => `
                <option value="${escapeHtml(option.id)}" ${selectedIds.has(String(option.id)) ? "selected" : ""}>
                    ${escapeHtml(option.label)}
                </option>
            `).join("")}
        </select>
    `;

    const checkbox = card.querySelector(".console-sofa-scope-all-checkbox");
    const multiSelect = card.querySelector(".console-sofa-multi-select");
    checkbox.addEventListener("change", () => {
        multiSelect.disabled = checkbox.checked;
    });

    container.appendChild(card);
    if (!options.length) {
        const helper = document.createElement("div");
        helper.className = "console-sofa-help";
        helper.textContent = "Fuer diesen Ressourcentyp wurden im Backend-Catalog keine auswählbaren Ressourcen geliefert.";
        container.appendChild(helper);
    }
}

function renderSofaGrantEditor(grants) {
    if (!consoleDOM.sofaGrantList) {
        return;
    }

    consoleDOM.sofaGrantList.innerHTML = "";

    if (!grants.length) {
        consoleDOM.sofaGrantList.appendChild(createSofaGrantEditorRow());
        return;
    }

    grants.forEach(grant => {
        consoleDOM.sofaGrantList.appendChild(createSofaGrantEditorRow(grant));
    });
}

function openSofaGrantEditor() {
    if (!consoleState.sofa.roleDetail) {
        showFlash("Bitte zuerst eine Rolle auswaehlen.", "failure");
        return;
    }

    consoleState.sofa.editing = true;
    consoleDOM.sofaEditor.hidden = false;
    renderSofaGrantEditor(getDirectSofaGrants());
    updateSofaButtons();
}

function closeSofaGrantEditor() {
    consoleState.sofa.editing = false;
    if (consoleDOM.sofaEditor) {
        consoleDOM.sofaEditor.hidden = true;
    }
    updateSofaButtons();
}

function collectSofaGrantPayload() {
    const grants = [];

    consoleDOM.sofaGrantList?.querySelectorAll(".console-sofa-grant-row").forEach(row => {
        const permission = row.querySelector(".console-sofa-permission-select")?.value;
        if (!permission) {
            return;
        }

        const resourceCard = row.querySelector(".console-sofa-scope-card");
        const allScopedResources = Boolean(resourceCard?.querySelector(".console-sofa-scope-all-checkbox")?.checked);
        const resourceIds = Array.from(resourceCard?.querySelector(".console-sofa-multi-select")?.selectedOptions || [])
            .map(option => Number(option.value))
            .filter(value => !Number.isNaN(value));

        grants.push({
            permission,
            all_scoped_resources: allScopedResources,
            resource_ids: resourceIds
        });
    });

    return grants;
}

async function saveSofaGrantEditor() {
    if (!consoleState.sofa.selectedRoleId) {
        showFlash("Bitte zuerst eine Rolle auswaehlen.", "failure");
        return;
    }

    const payload = { grants: collectSofaGrantPayload() };
    consoleState.sofa.saving = true;
    updateSofaButtons();

    try {
        await fetchJson(`/api/roles/${encodeURIComponent(consoleState.sofa.selectedRoleId)}/sofa-grants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }, {});

        await loadSofaRoleDetail(consoleState.sofa.selectedRoleId);
        closeSofaGrantEditor();
        setSofaFeedback("SOFA-Berechtigungen gespeichert.", "is-success");
        showFlash("SOFA-Berechtigungen gespeichert", "success");
    } catch (error) {
        console.error("SOFA-Berechtigungen konnten nicht gespeichert werden", error);
        setSofaFeedback(error instanceof Error ? error.message : "SOFA-Berechtigungen konnten nicht gespeichert werden.", "is-error");
        showFlash(error instanceof Error ? error.message : "SOFA-Berechtigungen konnten nicht gespeichert werden.", "failure");
    } finally {
        consoleState.sofa.saving = false;
        updateSofaButtons();
    }
}

function bindSofaControls() {
    if (!consoleDOM.sofaRoleSelect) {
        return;
    }

    consoleDOM.sofaRoleSelect.addEventListener("change", event => {
        consoleState.sofa.selectedRoleId = String(event.target.value || "");
        closeSofaGrantEditor();
        loadSofaRoleDetail(consoleState.sofa.selectedRoleId);
    });

    consoleDOM.sofaReloadBtn?.addEventListener("click", async () => {
        await loadRolesForSofa();
        if (consoleState.sofa.selectedRoleId) {
            await loadSofaRoleDetail(consoleState.sofa.selectedRoleId);
        }
    });

    consoleDOM.sofaEditBtn?.addEventListener("click", () => {
        openSofaGrantEditor();
    });

    consoleDOM.sofaAddGrantBtn?.addEventListener("click", () => {
        consoleDOM.sofaGrantList?.appendChild(createSofaGrantEditorRow());
    });

    consoleDOM.sofaCancelBtn?.addEventListener("click", () => {
        closeSofaGrantEditor();
    });

    consoleDOM.sofaSaveBtn?.addEventListener("click", () => {
        saveSofaGrantEditor();
    });

    window.addEventListener("sofa:authz-updated", () => {
        if (!hasSofaAuthorizationAccess()) {
            closeSofaGrantEditor();
            setSofaFeedback("Der Zugriff auf Rollen-Berechtigungen wurde entzogen.", "is-error");
        }
        updateSofaButtons();
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
    consoleDOM.runningProcessesBody = document.getElementById("console-running-processes-body");
    consoleDOM.completedProcessesBody = document.getElementById("console-completed-processes-body");
    consoleDOM.reevaluateRoleSelect = document.getElementById("reevaluate-role-select");
    consoleDOM.reevaluatePreviewBtn = document.getElementById("reevaluate-preview-btn");
    consoleDOM.reevaluateFeedback = document.getElementById("reevaluate-feedback");
    consoleDOM.reevaluateResults = document.getElementById("reevaluate-results");
    consoleDOM.sofaRoleSelect = document.getElementById("console-sofa-role-select");
    consoleDOM.sofaReloadBtn = document.getElementById("console-sofa-reload-btn");
    consoleDOM.sofaEditBtn = document.getElementById("console-sofa-edit-btn");
    consoleDOM.sofaFeedback = document.getElementById("console-sofa-feedback");
    consoleDOM.sofaRoleName = document.getElementById("console-sofa-role-name");
    consoleDOM.sofaRoleMeta = document.getElementById("console-sofa-role-meta");
    consoleDOM.sofaDirectCount = document.getElementById("console-sofa-direct-count");
    consoleDOM.sofaInheritedCount = document.getElementById("console-sofa-inherited-count");
    consoleDOM.sofaTotalCount = document.getElementById("console-sofa-total-count");
    consoleDOM.sofaDirectBody = document.getElementById("console-sofa-direct-body");
    consoleDOM.sofaInheritedBody = document.getElementById("console-sofa-inherited-body");
    consoleDOM.sofaEditor = document.getElementById("console-sofa-editor");
    consoleDOM.sofaGrantList = document.getElementById("console-sofa-grant-list");
    consoleDOM.sofaAddGrantBtn = document.getElementById("console-sofa-add-grant-btn");
    consoleDOM.sofaCancelBtn = document.getElementById("console-sofa-cancel-btn");
    consoleDOM.sofaSaveBtn = document.getElementById("console-sofa-save-btn");
}

function initConsole() {
    cacheDom();

    if (consoleDOM.runningProcessesBody && consoleDOM.completedProcessesBody) {
        loadProcesses();
    }

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

    if (consoleDOM.sofaRoleSelect && hasSofaAuthorizationAccess()) {
        renderSofaOverview();
        bindSofaControls();
        loadRolesForSofa();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConsole);
} else {
    initConsole();
}
