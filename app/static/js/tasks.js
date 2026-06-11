if (!window.taskOverlayInitialized) {
    document.addEventListener("DOMContentLoaded", () => {
        initTaskOverlay();
        initMailDialog();
        initTaskWarningDialog();
        initTaskActionHandling();
        initTaskFilters();
        initTaskBulkActions();
        loadInitialTaskData();
    });
    window.taskOverlayInitialized = true;
}

const LABELS = {
    status: {
        OPEN: "Offen",
        IN_PROGRESS: "In Bearbeitung",
        COMPLETED: "Erledigt",
        BLOCKED: "Blockiert"
    },
    handling: {
        INTERNAL: "Intern",
        EXTERNAL: "Mail",
        BOT: "Automatisiert"
    },
    taskType: {
        ASSIGNMENT: "Zuweisung",
        REVOCATION: "Entzug"
    },
    historyAction: {
        CREATED: "Erstellt",
        ASSIGNED: "Übernommen",
        RELEASED: "Freigegeben",
        COMPLETED: "Erledigt",
        BOT_DISPATCHED: "Bot dispatcht",
        BOT_RESPONSE: "Bot-Antwort",
        MAIL_SENT: "E-Mail versendet"
    },
    processes: {
        SKILL_ASSIGNMENT: "Rollenzuweisung",
        SKILL_REMOVAL: "Rollenentzug",
        TEMPORARY_ROLE: "Temporäre Rolle",
        ONBOARDING: "Onboarding",
        OFFBOARDING: "Offboarding",
        CHANGE: "Funktionswechsel"
    }
};

const PROCESS_KEYS = {
    id: ["process_id", "id"],
    name: ["process_name", "name", "process_type", "type"],
    target: ["target_name", "for_name", "resource_name", "user_name", "target_user_name"],
    triggeredBy: ["initiator_name", "triggered_by_name", "created_by_name", "initiator_user_name", "created_by"],
    startedAt: ["started_at", "created_at", "process_started_at"],
    completedAt: ["completed_at", "finished_at", "process_completed_at"],
    openTaskCount: ["open_task_count", "pending_task_count"]
};

const TASK_FILTER_DEFAULTS = {
    search: "",
    status: "",
    handling: "",
    taskType: "",
    backlog: ""
};

const NO_BACKLOG_FILTER_VALUE = "__NONE__";

const taskViewState = {
    filters: { ...TASK_FILTER_DEFAULTS },
    filterOptions: {
        status: [],
        handling: [],
        taskType: [],
        backlog: []
    },
    backlogLookup: {},
    filteredBuckets: {
        open: [],
        blocked: [],
        mine: [],
        completed: []
    },
    buckets: {
        open: [],
        blocked: [],
        mine: [],
        completed: []
    }
};

const WARNING_HISTORY_ACTIONS = new Set(["MAIL_SENT", "BOT_DISPATCHED", "BOT_RESPONSE"]);

const taskHistoryState = {
    taskId: null,
    entries: [],
    loading: false,
    requestId: 0
};

const taskWarningState = {
    resolver: null
};

const api = {
    async getTaskBacklogs() {
        try {
            const res = await fetch("/api/backlogs");
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.detail || data.error || "Backlogs konnten nicht geladen werden");
            }

            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error(err);
            return [];
        }
    },

    async getMailTemplate(resourceId, userId, taskType) {
        try {
            const res = await fetch("/api/resources/mail_template", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    resource_id: resourceId,
                    user_id: userId,
                    task_type: taskType
                })
            });
            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return null;
            }
            return data;
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return null;
        }
    },

    async sendMail(taskId, mailToSend) {
        try {
            const res = await fetch(`/api/tasks/${taskId}/send_mail`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipient: mailToSend.recipient,
                    cc: mailToSend.cc || "",
                    bcc: mailToSend.bcc || "",
                    subject: mailToSend.subject,
                    body: mailToSend.body
                })
            });

            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Fehler beim Senden der E-Mail", "failure");
                return null;
            }

            showFlash("E-Mail erfolgreich gesendet", "success");
            return data;
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return null;
        }
    },

    async bulkAssignTasks(taskIds) {
        try {
            const res = await fetch("/api/tasks/bulk-assign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ task_ids: taskIds })
            });
            const data = await res.json();

            if (!res.ok) {
                return {
                    ok: false,
                    message: extractErrorMessage(data.detail || data.error, "Fehler beim Übernehmen der Aufgaben")
                };
            }

            return { ok: true, results: Array.isArray(data.results) ? data.results : [] };
        } catch (err) {
            console.error("Bulk Assign Error:", err);
            return { ok: false, message: "Netzwerkfehler oder Server nicht erreichbar" };
        }
    },

    async bulkReleaseTasks(taskIds) {
        try {
            const res = await fetch("/api/tasks/bulk-release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ task_ids: taskIds })
            });
            const data = await res.json();

            if (!res.ok) {
                return {
                    ok: false,
                    message: extractErrorMessage(data.detail || data.error, "Fehler beim Freigeben der Aufgaben")
                };
            }

            return { ok: true, results: Array.isArray(data.results) ? data.results : [] };
        } catch (err) {
            console.error("Bulk Release Error:", err);
            return { ok: false, message: "Netzwerkfehler oder Server nicht erreichbar" };
        }
    },

    async dispatchBot(taskId) {
        try {
            const res = await fetch("/api/tasks/dispatch_bot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ task_id: taskId })
            });
            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Fehler beim Dispatchen des Bots", "failure");
                return null;
            }

            showFlash("Bot erfolgreich dispatcht. Das Ergebnis erscheint später im Verlauf. Bitte Historie prüfen oder aktualisieren.", "success");
            return data;
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return null;
        }
    }
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function humanizeToken(value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    return String(value)
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatFromMap(map, value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }
    return map[value] || humanizeToken(value);
}

function formatTaskType(taskType) {
    return formatFromMap(LABELS.taskType, taskType);
}

function formatHandlingType(handlingType) {
    return formatFromMap(LABELS.handling, handlingType);
}

function formatStatus(status, task) {
    if (task?.uiListState === "blocked") {
        return LABELS.status.BLOCKED;
    }
    return formatFromMap(LABELS.status, status);
}

function formatStatusFilterValue(status) {
    if (!status) {
        return "-";
    }
    if (status === "BLOCKED") {
        return LABELS.status.BLOCKED;
    }
    return formatFromMap(LABELS.status, status);
}

function formatHistoryAction(action) {
    return formatFromMap(LABELS.historyAction, action);
}

function formatHistoryUser(entry) {
    return entry.user_id || entry.user_name || entry.username || "-";
}

function extractErrorMessage(detail, fallback) {
    if (typeof detail === "string" && detail.trim()) {
        return detail;
    }

    if (detail && typeof detail === "object") {
        if (typeof detail.message === "string" && detail.message.trim()) {
            return detail.message;
        }
        if (typeof detail.error === "string" && detail.error.trim()) {
            return detail.error;
        }
    }

    return fallback;
}

function normalizeBacklogIdentifier(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const normalized = String(value).trim();
    return normalized || null;
}

function getTaskBacklogFilterKey(task) {
    const identifier = normalizeBacklogIdentifier(task?.backlog_identifier);
    return identifier === null ? NO_BACKLOG_FILTER_VALUE : identifier;
}

function formatBacklogFilterValue(backlogValue) {
    if (!backlogValue) {
        return "-";
    }

    if (backlogValue === NO_BACKLOG_FILTER_VALUE) {
        return "Kein Backlog";
    }

    return taskViewState.backlogLookup[backlogValue]?.name || `Backlog ${backlogValue}`;
}

function formatProcessLabel(task) {
    const explicitProcessName = firstDefinedValue(task, ["process_name", "name"], "");
    if (explicitProcessName && explicitProcessName !== "-") {
        return String(explicitProcessName);
    }

    const processType = firstDefinedValue(task, ["process_type", "type"], "");
    if (processType && processType !== "-") {
        return formatFromMap(LABELS.processes, processType);
    }

    return "Prozess";
}

function formatTaskModalSubtitle(task) {
    const processId = firstDefinedValue(task, PROCESS_KEYS.id, "");
    const processLabel = formatProcessLabel(task);

    if (processId && processId !== "-") {
        return `${processLabel} · #${processId}`;
    }

    return `Task #${task.task_id}`;
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

function getTaskStateClass(task) {
    if (task.uiListState === "completed") {
        return "is-completed";
    }
    if (task.uiListState === "blocked") {
        return "is-blocked";
    }
    if (task.uiListState === "mine") {
        return "is-mine";
    }
    if (task.task_type === "REVOCATION") {
        return "is-open is-revocation";
    }
    return "is-open";
}

function getHandlingChipClass(handlingType) {
    return {
        INTERNAL: "ui-chip-primary",
        EXTERNAL: "ui-chip-warning",
        BOT: "ui-chip-accent"
    }[handlingType] || "ui-chip-neutral";
}

function getStatusBadgeClass(status, task) {
    if (task?.uiListState === "blocked") {
        return "ui-status-blocked";
    }

    return {
        OPEN: "ui-status-open",
        IN_PROGRESS: "ui-status-progress",
        COMPLETED: "ui-status-completed"
    }[status] || "ui-status-neutral";
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

function decorateTasks(tasks, uiListState) {
    return tasks.map(task => ({ ...task, uiListState }));
}

function normalizeSearchValue(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getTaskStatusFilterKey(task) {
    if (task?.uiListState === "blocked") {
        return "BLOCKED";
    }

    const status = String(task?.status || "").trim().toUpperCase();
    if (status) {
        return status;
    }

    return isTaskCompleted(task) ? "COMPLETED" : "";
}

function getTaskHandlingFilterKey(task) {
    return String(task?.handling_type || "").trim().toUpperCase();
}

function getTaskTypeFilterKey(task) {
    return String(task?.task_type || "").trim().toUpperCase();
}

function getTaskSearchIndex(task) {
    return [
        task.task_id,
        task.target_user_name,
        task.resource_name,
        task.system_name,
        formatBacklogFilterValue(getTaskBacklogFilterKey(task)),
        formatProcessLabel(task),
        formatStatus(task.status, task),
        formatHandlingType(task.handling_type),
        formatTaskType(task.task_type)
    ]
        .map(normalizeSearchValue)
        .filter(Boolean)
        .join(" ");
}

function collectAllTasks() {
    return [
        ...taskViewState.buckets.open,
        ...taskViewState.buckets.blocked,
        ...taskViewState.buckets.mine,
        ...taskViewState.buckets.completed
    ];
}

function createSortedFilterOptions(values, formatter) {
    return Array.from(new Set(values.filter(Boolean)))
        .map(value => ({ value, label: formatter(value) }))
        .sort((left, right) => left.label.localeCompare(right.label, "de"));
}

function buildTaskFilterOptions() {
    const tasks = collectAllTasks();

    taskViewState.filterOptions.status = createSortedFilterOptions(
        tasks.map(getTaskStatusFilterKey),
        formatStatusFilterValue
    );
    taskViewState.filterOptions.handling = createSortedFilterOptions(
        tasks.map(getTaskHandlingFilterKey),
        formatHandlingType
    );
    taskViewState.filterOptions.taskType = createSortedFilterOptions(
        tasks.map(getTaskTypeFilterKey),
        formatTaskType
    );
    taskViewState.filterOptions.backlog = createSortedFilterOptions(
        tasks.map(getTaskBacklogFilterKey),
        formatBacklogFilterValue
    );
}

function populateFilterSelect(elementId, options, defaultLabel, selectedValue) {
    const select = document.getElementById(elementId);
    if (!select) {
        return;
    }

    const defaultOption = `<option value="">${escapeHtml(defaultLabel)}</option>`;
    const optionMarkup = options.map(option => `
        <option value="${escapeHtml(option.value)}"${option.value === selectedValue ? " selected" : ""}>
            ${escapeHtml(option.label)}
        </option>
    `).join("");

    select.innerHTML = defaultOption + optionMarkup;
    select.value = selectedValue || "";
}

function syncTaskFilterControls() {
    const searchInput = document.getElementById("tasks-search-input");
    if (searchInput) {
        searchInput.value = taskViewState.filters.search;
    }

    populateFilterSelect(
        "tasks-status-filter",
        taskViewState.filterOptions.status,
        "Alle",
        taskViewState.filters.status
    );
    populateFilterSelect(
        "tasks-handling-filter",
        taskViewState.filterOptions.handling,
        "Alle",
        taskViewState.filters.handling
    );
    populateFilterSelect(
        "tasks-type-filter",
        taskViewState.filterOptions.taskType,
        "Alle",
        taskViewState.filters.taskType
    );
    populateFilterSelect(
        "tasks-backlog-filter",
        taskViewState.filterOptions.backlog,
        "Alle",
        taskViewState.filters.backlog
    );
}

function hasActiveTaskFilters() {
    return Object.values(taskViewState.filters).some(value => String(value || "").trim() !== "");
}

function updateTaskFilterSummary(visibleCount, totalCount) {
    const summary = document.getElementById("tasks-filter-summary");
    if (summary) {
        summary.textContent = hasActiveTaskFilters()
            ? `${visibleCount} von ${totalCount} Aufgaben sichtbar`
            : `${totalCount} Aufgaben sichtbar`;
    }

    const resetButton = document.getElementById("tasks-filter-reset");
    if (resetButton) {
        resetButton.disabled = !hasActiveTaskFilters();
    }
}

function taskMatchesFilters(task) {
    const normalizedSearch = normalizeSearchValue(taskViewState.filters.search);
    if (normalizedSearch && !getTaskSearchIndex(task).includes(normalizedSearch)) {
        return false;
    }

    if (taskViewState.filters.status && getTaskStatusFilterKey(task) !== taskViewState.filters.status) {
        return false;
    }

    if (taskViewState.filters.handling && getTaskHandlingFilterKey(task) !== taskViewState.filters.handling) {
        return false;
    }

    if (taskViewState.filters.taskType && getTaskTypeFilterKey(task) !== taskViewState.filters.taskType) {
        return false;
    }

    if (taskViewState.filters.backlog && getTaskBacklogFilterKey(task) !== taskViewState.filters.backlog) {
        return false;
    }

    return true;
}

function filterTaskBuckets() {
    return {
        open: taskViewState.buckets.open.filter(taskMatchesFilters),
        blocked: taskViewState.buckets.blocked.filter(taskMatchesFilters),
        mine: taskViewState.buckets.mine.filter(taskMatchesFilters),
        completed: taskViewState.buckets.completed.filter(taskMatchesFilters)
    };
}

function isTaskCompleted(task) {
    return task.uiListState === "completed" || task.status === "COMPLETED" || Boolean(task.completed_at);
}

function renderEmptyState(message) {
    return `<div class="ui-empty-state"><span>${escapeHtml(message)}</span></div>`;
}

function setCount(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = String(value);
    }
}

function renderTaskTile(task) {
    const blockedLabel = task.uiListState === "blocked"
        ? `<span class="ui-chip ui-chip-neutral">Blockiert</span>`
        : "";

    const statusLabel = isTaskCompleted(task) ? "Zuletzt erledigt" : formatStatus(task.status, task);
    const kickerLabel = formatTaskModalSubtitle(task);
    const backlogLabel = formatBacklogFilterValue(getTaskBacklogFilterKey(task));
    const handlingChip = task.uiListState === "blocked"
        ? ""
        : `<span class="ui-chip ${getHandlingChipClass(task.handling_type)}">${escapeHtml(formatHandlingType(task.handling_type))}</span>`;

    return `
        <a href="#" class="task-tile task-card ${getTaskStateClass(task)}" data-task-id="${escapeHtml(task.task_id)}">
            <div class="task-card-top">
                <div class="task-card-heading">
                    <span class="task-card-kicker">${escapeHtml(kickerLabel)}</span>
                    <h3 class="task-card-title">${escapeHtml(formatTaskType(task.task_type))}</h3>
                </div>
                <div class="task-card-chips">
                    ${handlingChip}
                    ${blockedLabel}
                </div>
            </div>
            <div class="task-card-body">
                <div class="task-card-resource">${escapeHtml(task.resource_name || "-")}</div>
                <div class="task-card-meta">
                    <div class="task-card-row">
                        <span>Für</span>
                        <strong>${escapeHtml(task.target_user_name || "-")}</strong>
                    </div>
                    <div class="task-card-row">
                        <span>Status</span>
                        <span>${escapeHtml(statusLabel)}</span>
                    </div>
                    <div class="task-card-row">
                        <span>Backlog</span>
                        <span>${escapeHtml(backlogLabel)}</span>
                    </div>
                </div>
            </div>
        </a>
    `;
}

function getTaskContext(task) {
    const isMine =
        task.status === "IN_PROGRESS" &&
        task.assigned_to_user_id === window.currentUserId;

    const isOpen = task.status === "OPEN";

    return { isMine, isOpen };
}

function createActionButton(label, action, style = "secondary", id = null) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-${style}`;
    btn.textContent = label;
    btn.dataset.action = action;
    if (id !== null) {
        btn.id = id;
    }
    return btn;
}

function createFieldGroup({ label, id, placeholder, type = "text", required = false, helpText = "" }) {
    const wrapper = document.createElement("div");
    wrapper.className = "ui-field-group";

    const labelEl = document.createElement("label");
    labelEl.className = "ui-field-label";
    labelEl.setAttribute("for", id);
    labelEl.textContent = required ? `${label} *` : label;
    wrapper.appendChild(labelEl);

    const field = type === "textarea"
        ? document.createElement("textarea")
        : document.createElement("input");

    if (type !== "textarea") {
        field.type = type;
    }

    field.id = id;
    field.placeholder = placeholder;
    field.className = type === "textarea" ? "ui-textarea task-input" : "ui-input task-input";
    wrapper.appendChild(field);

    if (helpText) {
        const help = document.createElement("span");
        help.className = "ui-field-hint";
        help.textContent = helpText;
        wrapper.appendChild(help);
    }

    return { wrapper, field };
}

function renderTaskActions(task) {
    const { isMine, isOpen } = getTaskContext(task);
    const formEl = document.getElementById("task-form");
    const actionsEl = document.getElementById("task-actions");

    if (!formEl || !actionsEl) {
        return;
    }

    formEl.innerHTML = "";
    actionsEl.innerHTML = "";

    if (isTaskCompleted(task)) {
        formEl.innerHTML = `
            <div class="task-form-note">
                Diese Aufgabe ist bereits abgeschlossen. Du kannst hier noch Details und Verlauf einsehen.
            </div>
        `;
        return;
    }

    if (isOpen) {
        formEl.innerHTML = `
            <div class="task-form-note">
                Diese Aufgabe ist noch frei verfügbar und kann direkt von dir übernommen werden.
            </div>
        `;
        actionsEl.append(createActionButton("Übernehmen", "assign", "primary"));
        return;
    }

    if (!isMine) {
        formEl.innerHTML = `
            <div class="task-form-note">
                Bearbeitung aktuell nicht möglich – diese Aufgabe ist blockiert.
            </div>
        `;
        return;
    }

    const commentField = createFieldGroup({
        label: "Kommentar",
        id: "task-comment",
        placeholder: "Optionalen Kommentar für Verlauf oder Übergabe ergänzen",
        type: "textarea"
    });
    formEl.appendChild(commentField.wrapper);

    if (task.resource_type_id === 1 && task.task_type === "ASSIGNMENT") {
        const userIdField = createFieldGroup({
            label: "Account-Kennung",
            id: "task-account-identifier",
            placeholder: "Benutzername oder Account-Kennung eintragen",
            required: true,
            helpText: "Für Account-Ressourcen ist diese Angabe beim Abschluss verpflichtend."
        });
        formEl.appendChild(userIdField.wrapper);
    }

    actionsEl.append(createActionButton("Freigeben", "release", "red"));

    if (task.handling_type === "EXTERNAL") {
        actionsEl.append(createActionButton("Mail versenden", "external", "secondary"));
    }

    if (task.handling_type === "BOT") {
        actionsEl.append(createActionButton("Bot beauftragen", "bot", "secondary"));
    }

    actionsEl.append(createActionButton("Erledigt", "complete", "primary", "task-complete-btn"));
}

async function requestTaskAssign(taskId) {
    try {
        const res = await fetch(`/api/tasks/${taskId}/assign?user_id=${window.currentUserId}`, {
            method: "PATCH"
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                message: extractErrorMessage(
                    data.detail || data.error,
                    res.status === 409 ? "Task wurde bereits übernommen" : "Fehler beim Übernehmen des Tasks."
                )
            };
        }

        return { ok: true, data };
    } catch (err) {
        console.error("Assign Task Error:", err);
        return {
            ok: false,
            status: 0,
            message: "Fehler beim Übernehmen des Tasks."
        };
    }
}

async function requestTaskRelease(taskId) {
    try {
        const res = await fetch(`/api/tasks/${taskId}/assign`, {
            method: "DELETE"
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                message: extractErrorMessage(data.detail || data.error, "Fehler beim Freigeben")
            };
        }

        return { ok: true, data };
    } catch (err) {
        console.error("Release Task Error:", err);
        return {
            ok: false,
            status: 0,
            message: "Fehler beim Freigeben"
        };
    }
}

function setTaskBulkButtonState(button, isBusy, busyLabel) {
    if (!button) {
        return;
    }

    if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent;
    }

    button.dataset.busy = isBusy ? "true" : "false";
    button.disabled = isBusy;
    button.textContent = isBusy ? busyLabel : button.dataset.defaultLabel;
}

function updateTaskBulkActionState(filteredBuckets = taskViewState.filteredBuckets) {
    const openBulkButton = document.getElementById("open-tasks-bulk-assign");
    const myBulkButton = document.getElementById("my-tasks-bulk-release");
    const openBusy = openBulkButton?.dataset.busy === "true";
    const mineBusy = myBulkButton?.dataset.busy === "true";

    if (openBulkButton) {
        openBulkButton.disabled = openBusy || !filteredBuckets.open.length;
    }

    if (myBulkButton) {
        myBulkButton.disabled = mineBusy || !filteredBuckets.mine.length;
    }
}

function buildBulkActionSummary(successCount, failedTasks, successLabel) {
    if (!failedTasks.length) {
        return {
            type: "success",
            message: `${successCount} ${successLabel}.`
        };
    }

    const failureHint = failedTasks[0]?.message
        ? ` Erste Meldung: ${failedTasks[0].message}`
        : "";

    if (!successCount) {
        return {
            type: "failure",
            message: `Keine Aufgabe verarbeitet.${failureHint}`
        };
    }

    return {
        type: "failure",
        message: `${successCount} ${successLabel}, ${failedTasks.length} fehlgeschlagen.${failureHint}`
    };
}

async function handleBulkTaskAction({ buttonId, busyLabel, taskSelector, bulkRequestHandler, successLabel }) {
    const button = document.getElementById(buttonId);
    const tasks = taskSelector();

    if (!button || !tasks.length) {
        return;
    }

    setTaskBulkButtonState(button, true, busyLabel);

    try {
        const response = await bulkRequestHandler(tasks.map(task => task.task_id));

        if (!response.ok) {
            showFlash(response.message, "failure");
            return;
        }

        const failedTasks = response.results
            .filter(entry => !entry.success)
            .map(entry => ({ taskId: entry.task_id, message: entry.message }));
        const successCount = response.results.length - failedTasks.length;

        await loadTasks();

        const summary = buildBulkActionSummary(successCount, failedTasks, successLabel);
        showFlash(summary.message, summary.type);
    } finally {
        setTaskBulkButtonState(button, false, busyLabel);
        updateTaskBulkActionState(taskViewState.filteredBuckets);
    }
}

function initTaskBulkActions() {
    const openBulkButton = document.getElementById("open-tasks-bulk-assign");
    const myBulkButton = document.getElementById("my-tasks-bulk-release");

    if (openBulkButton && openBulkButton.dataset.bound !== "true") {
        openBulkButton.dataset.bound = "true";
        openBulkButton.addEventListener("click", async () => {
            await handleBulkTaskAction({
                buttonId: "open-tasks-bulk-assign",
                busyLabel: "Übernehme...",
                taskSelector: () => [...taskViewState.filteredBuckets.open],
                bulkRequestHandler: api.bulkAssignTasks,
                successLabel: "Aufgaben übernommen"
            });
        });
    }

    if (myBulkButton && myBulkButton.dataset.bound !== "true") {
        myBulkButton.dataset.bound = "true";
        myBulkButton.addEventListener("click", async () => {
            await handleBulkTaskAction({
                buttonId: "my-tasks-bulk-release",
                busyLabel: "Gebe frei...",
                taskSelector: () => [...taskViewState.filteredBuckets.mine],
                bulkRequestHandler: api.bulkReleaseTasks,
                successLabel: "Aufgaben freigegeben"
            });
        });
    }

    updateTaskBulkActionState();
}

async function refreshTaskModalFromOverview(taskId) {
    const didLoad = await loadTasks();
    if (!didLoad) {
        return null;
    }

    const refreshedTask = window.taskIndex?.[String(taskId)];
    if (!refreshedTask) {
        closeOverlay("task-overlay");
        showFlash("Task ist nicht mehr verfügbar.", "failure");
        return null;
    }

    window.currentTask = refreshedTask;
    populateTaskModal(refreshedTask);
    renderTaskActions(refreshedTask);
    await loadTaskHistory(taskId, { showLoading: false });
    return refreshedTask;
}

function openOverlay(elementId) {
    const overlay = document.getElementById(elementId);
    if (!overlay) {
        return;
    }

    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    updateBodyScrollLock();
}

function closeOverlay(elementId) {
    const overlay = document.getElementById(elementId);
    if (!overlay) {
        return;
    }

    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    updateBodyScrollLock();
}

function updateBodyScrollLock() {
    const hasOpenModal = document.querySelector(".ui-modal-overlay.active");
    document.body.classList.toggle("modal-open", Boolean(hasOpenModal));
}

function setHistoryExpanded(isOpen) {
    const container = document.getElementById("history-container");
    const toggle = document.getElementById("history-toggle");
    if (!container || !toggle) {
        return;
    }

    container.classList.toggle("open", isOpen);
    toggle.classList.toggle("open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    const label = toggle.querySelector("span");
    if (label) {
        label.textContent = isOpen ? "Verlauf ausblenden" : "Verlauf anzeigen";
    }
}

function setHistoryLoadingState(isLoading) {
    taskHistoryState.loading = isLoading;

    const refreshBtn = document.getElementById("history-refresh-btn");
    if (refreshBtn) {
        refreshBtn.disabled = isLoading;
        refreshBtn.textContent = isLoading ? "Aktualisiere..." : "Aktualisieren";
    }
}

function renderHistoryLoadingState(message = "Lade Verlauf...") {
    const historyBody = document.getElementById("task-history-body");
    if (!historyBody) {
        return;
    }

    historyBody.innerHTML = `
        <tr>
            <td colspan="4" class="history-empty-cell">${escapeHtml(message)}</td>
        </tr>
    `;
}

function renderHistoryErrorState(message = "Fehler beim Laden des Verlaufs") {
    const historyBody = document.getElementById("task-history-body");
    if (!historyBody) {
        return;
    }

    historyBody.innerHTML = `
        <tr>
            <td colspan="4" class="history-empty-cell history-error-cell">${escapeHtml(message)}</td>
        </tr>
    `;
}

function populateTaskModal(task) {
    const titleEl = document.getElementById("task-modal-title");
    const subtitleEl = document.getElementById("task-modal-subtitle");
    const systemEl = document.getElementById("task-modal-system");
    const userEl = document.getElementById("task-modal-user");
    const resourceEl = document.getElementById("task-modal-resource");
    const handlingEl = document.getElementById("task-modal-handling");
    const statusEl = document.getElementById("task-modal-status");

    if (titleEl) {
        titleEl.textContent = formatTaskType(task.task_type);
    }
    if (subtitleEl) {
        subtitleEl.textContent = formatTaskModalSubtitle(task);
    }
    if (systemEl) {
        systemEl.textContent = task.system_name || "-";
    }
    if (userEl) {
        userEl.textContent = task.target_user_name || "-";
    }
    if (resourceEl) {
        resourceEl.textContent = task.resource_name || "-";
    }
    if (handlingEl) {
        handlingEl.textContent = formatHandlingType(task.handling_type);
    }
    if (statusEl) {
        statusEl.className = `ui-status-badge ${getStatusBadgeClass(task.status, task)}`;
        statusEl.textContent = formatStatus(task.status, task);
    }
}

function renderHistoryEntries(entries) {
    const historyBody = document.getElementById("task-history-body");
    if (!historyBody) {
        return;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="4" class="history-empty-cell">Kein Verlauf verfügbar</td>
            </tr>
        `;
        return;
    }

    historyBody.innerHTML = entries.map(entry => {
        const details = entry.comment || entry.details || "-";
        return `
            <tr>
                <td>${escapeHtml(formatDateTime(entry.timestamp))}</td>
                <td>${escapeHtml(formatHistoryAction(entry.action))}</td>
                <td>${escapeHtml(formatHistoryUser(entry))}</td>
                <td>${escapeHtml(details)}</td>
            </tr>
        `;
    }).join("");
}

async function loadTaskHistory(taskId, { showLoading = true } = {}) {
    if (!taskId) {
        return null;
    }

    const requestId = ++taskHistoryState.requestId;
    taskHistoryState.taskId = taskId;

    if (showLoading) {
        renderHistoryLoadingState();
    }

    setHistoryLoadingState(true);

    try {
        const res = await fetch(`/api/tasks/${taskId}/history`);
        if (!res.ok) {
            throw new Error("History failed");
        }

        const historyData = await res.json();
        if (requestId !== taskHistoryState.requestId) {
            return historyData;
        }

        taskHistoryState.entries = Array.isArray(historyData) ? historyData : [];
        renderHistoryEntries(taskHistoryState.entries);
        return taskHistoryState.entries;
    } catch (err) {
        console.error("History Error:", err);
        if (requestId === taskHistoryState.requestId) {
            taskHistoryState.entries = [];
            renderHistoryErrorState();
        }
        return null;
    } finally {
        if (requestId === taskHistoryState.requestId) {
            setHistoryLoadingState(false);
        }
    }
}

function getRelevantWarningEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    return entries.filter(entry => WARNING_HISTORY_ACTIONS.has(String(entry.action || "").toUpperCase()));
}

function closeTaskWarningDialog(result) {
    closeOverlay("task-warning-overlay");

    if (typeof taskWarningState.resolver === "function") {
        const resolve = taskWarningState.resolver;
        taskWarningState.resolver = null;
        resolve(result);
    }
}

function showTaskWarningDialog(actionLabel, warningEntries) {
    const titleEl = document.getElementById("task-warning-title");
    const textEl = document.getElementById("task-warning-text");
    const listEl = document.getElementById("task-warning-list");
    const recentEntries = warningEntries.slice(-5).reverse();

    if (titleEl) {
        titleEl.textContent = `${actionLabel} erneut ausführen?`;
    }

    if (textEl) {
        textEl.textContent = "Im Verlauf gibt es bereits Einträge zu einer früheren Ausführung. Bitte prüfe am besten zuerst die Historie. Du kannst die Aktion trotzdem erneut ausführen.";
    }

    if (listEl) {
        listEl.innerHTML = recentEntries.map(entry => `
            <li>
                <strong>${escapeHtml(formatHistoryAction(entry.action))}</strong>
                <span>${escapeHtml(formatDateTime(entry.timestamp))}</span>
            </li>
        `).join("");
    }

    openOverlay("task-warning-overlay");

    return new Promise(resolve => {
        taskWarningState.resolver = resolve;
    });
}

async function confirmTaskActionIfNeeded(task, actionLabel) {
    const history = await loadTaskHistory(task.task_id, { showLoading: false });
    if (!history) {
        showFlash("Historie konnte nicht geladen werden. Aktion wurde vorsorglich nicht ausgeführt.", "failure");
        return false;
    }

    const warningEntries = getRelevantWarningEntries(history);
    if (!warningEntries.length) {
        return true;
    }

    return showTaskWarningDialog(actionLabel, warningEntries);
}

async function openTaskOverlay(task) {
    window.currentTask = task;
    taskHistoryState.taskId = task.task_id;
    taskHistoryState.entries = [];
    populateTaskModal(task);
    renderTaskActions(task);
    setHistoryExpanded(false);

    openOverlay("task-overlay");
    await loadTaskHistory(task.task_id);
}

function initTaskOverlay() {
    const historyToggle = document.getElementById("history-toggle");
    historyToggle?.addEventListener("click", () => {
        const container = document.getElementById("history-container");
        setHistoryExpanded(!container?.classList.contains("open"));
    });

    document.getElementById("history-refresh-btn")?.addEventListener("click", async () => {
        if (!window.currentTask || taskHistoryState.loading) {
            return;
        }

        await loadTaskHistory(window.currentTask.task_id, { showLoading: false });
    });

    document.addEventListener("click", async event => {
        const tile = event.target.closest(".task-tile");
        if (!tile) {
            return;
        }

        event.preventDefault();
        const taskId = tile.dataset.taskId;
        const task = window.taskIndex?.[taskId];
        if (!task) {
            return;
        }

        await openTaskOverlay(task);
    });

    document.getElementById("task-close-btn")?.addEventListener("click", () => {
        closeOverlay("task-overlay");
    });

    document.getElementById("task-overlay")?.addEventListener("click", event => {
        if (event.target.id === "task-overlay") {
            closeOverlay("task-overlay");
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") {
            return;
        }

        const warningOverlay = document.getElementById("task-warning-overlay");
        if (warningOverlay?.classList.contains("active")) {
            closeTaskWarningDialog(false);
            return;
        }

        const mailOverlay = document.getElementById("mail-dialog-overlay");
        if (mailOverlay?.classList.contains("active")) {
            closeOverlay("mail-dialog-overlay");
            return;
        }

        const taskOverlay = document.getElementById("task-overlay");
        if (taskOverlay?.classList.contains("active")) {
            closeOverlay("task-overlay");
        }
    });
}

function initMailDialog() {
    document.getElementById("mail-close-btn")?.addEventListener("click", () => {
        closeOverlay("mail-dialog-overlay");
    });

    document.getElementById("mail-cancel-btn")?.addEventListener("click", () => {
        closeOverlay("mail-dialog-overlay");
    });

    document.getElementById("mail-dialog-overlay")?.addEventListener("click", event => {
        if (event.target.id === "mail-dialog-overlay") {
            closeOverlay("mail-dialog-overlay");
        }
    });
}

function initTaskWarningDialog() {
    document.getElementById("task-warning-cancel-btn")?.addEventListener("click", () => {
        closeTaskWarningDialog(false);
    });

    document.getElementById("task-warning-confirm-btn")?.addEventListener("click", () => {
        closeTaskWarningDialog(true);
    });

    document.getElementById("task-warning-close-btn")?.addEventListener("click", () => {
        closeTaskWarningDialog(false);
    });

    document.getElementById("task-warning-overlay")?.addEventListener("click", event => {
        if (event.target.id === "task-warning-overlay") {
            closeTaskWarningDialog(false);
        }
    });
}

function initTaskActionHandling() {
    const actionsEl = document.getElementById("task-actions");
    if (!actionsEl || actionsEl.dataset.bound === "true") {
        return;
    }

    actionsEl.dataset.bound = "true";

    actionsEl.addEventListener("click", async event => {
        const btn = event.target.closest("button");
        if (!btn) {
            return;
        }

        const action = btn.dataset.action;
        const task = window.currentTask;
        if (!task) {
            return;
        }

        if (action === "assign") {
            try {
                btn.disabled = true;
                btn.textContent = "Übernehme...";

                const result = await requestTaskAssign(task.task_id);
                if (!result.ok) {
                    showFlash(result.message, "failure");

                    if ([404, 409].includes(result.status)) {
                        await refreshTaskModalFromOverview(task.task_id);
                    }
                    return;
                }

                showFlash("Task erfolgreich übernommen", "success");
                await refreshTaskModalFromOverview(task.task_id);
            } catch (err) {
                console.error(err);
                showFlash("Fehler beim Übernehmen des Tasks.", "failure");
            } finally {
                if (btn.isConnected) {
                    btn.disabled = false;
                    btn.textContent = "Übernehmen";
                }
            }
        }

        if (action === "release") {
            try {
                btn.disabled = true;
                btn.textContent = "Gebe frei...";

                const result = await requestTaskRelease(task.task_id);
                if (!result.ok) {
                    showFlash(result.message, "failure");

                    if ([404, 409].includes(result.status)) {
                        await refreshTaskModalFromOverview(task.task_id);
                    }
                    return;
                }

                showFlash("Task erfolgreich freigegeben", "success");
                await refreshTaskModalFromOverview(task.task_id);
            } catch (err) {
                console.error("Release Task Error:", err);
                showFlash("Fehler beim Freigeben", "failure");
            } finally {
                if (btn.isConnected) {
                    btn.disabled = false;
                    btn.textContent = "Freigeben";
                }
            }
        }

        if (action === "complete") {
            if (!validateTaskCompletion(task)) {
                return;
            }

            const completeBtn = document.getElementById("task-complete-btn");
            if (completeBtn) {
                completeBtn.disabled = true;
                completeBtn.textContent = "Wird gespeichert...";
            }

            try {
                const handler = window.completeHandlers[task.handling_type];
                if (handler) {
                    await handler(task);
                }
            } finally {
                if (completeBtn) {
                    completeBtn.disabled = false;
                    completeBtn.textContent = "Erledigt";
                }
            }
        }

        if (action === "external") {
            await openMailDialog(task);
        }

        if (action === "bot") {
            await dispatchBot(task);
        }
    });
}

function validateTaskCompletion(task) {
    const accountField = document.getElementById("task-account-identifier");
    accountField?.classList.remove("input-error");

    if (task.resource_type_id === 1 && task.task_type === "ASSIGNMENT") {
        const value = accountField?.value?.trim();
        if (!value) {
            showFlash("Bitte Benutzer-Kennung eintragen.", "failure");
            accountField?.classList.add("input-error");
            accountField?.focus();
            return false;
        }
    }

    return true;
}

async function completeInternal(task) {
    const payload = {};

    const comment = document.getElementById("task-comment")?.value?.trim();
    if (comment) {
        payload.comment = comment;
    }

    if (task.resource_type_id === 1 && task.task_type === "ASSIGNMENT") {
        payload.account_identifier = document.getElementById("task-account-identifier")?.value?.trim();
    }

    try {
        const res = await fetch(`/api/tasks/${task.task_id}/complete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(await res.text());
        }

        showFlash("Task erfolgreich erledigt.", "success");
        closeOverlay("task-overlay");
        await loadTasks();
    } catch (err) {
        console.error("Complete failed:", err);
        showFlash("Task konnte nicht erledigt werden.", "failure");
    }
}

window.completeHandlers ||= {
    INTERNAL: completeInternal,
    EXTERNAL: completeInternal,
    BOT: completeInternal
};

async function openMailDialog(task) {
    if (!task) {
        return;
    }

    let mailData;
    try {
        mailData = await api.getMailTemplate(task.resource_id, task.target_user_id, task.task_type);
    } catch (err) {
        console.error("Fehler beim Abrufen der Mailvorlage:", err);
        showFlash("Mailvorlage konnte nicht geladen werden!", "failure");
        return;
    }

    if (!mailData) {
        return;
    }

    const recipientInput = document.getElementById("mail-recipient");
    const subjectInput = document.getElementById("mail-subject");
    const bodyInput = document.getElementById("mail-body");
    const sendBtn = document.getElementById("send-mail-btn");

    if (!recipientInput || !subjectInput || !bodyInput || !sendBtn) {
        console.error("Mail-Dialog Elemente fehlen im DOM!");
        return;
    }

    recipientInput.value = mailData.recipient || "";
    subjectInput.value = mailData.subject || "";
    bodyInput.value = mailData.body || "";

    openOverlay("mail-dialog-overlay");

    sendBtn.onclick = async () => {
        const mailToSend = {
            recipient: recipientInput.value.trim(),
            cc: "",
            bcc: "",
            subject: subjectInput.value.trim(),
            body: bodyInput.value.trim(),
            task_id: task.task_id
        };

        if (!mailToSend.recipient || !mailToSend.subject || !mailToSend.body) {
            showFlash("Bitte Empfänger, Betreff und Nachricht ausfüllen!", "failure");
            return;
        }

        const shouldProceed = await confirmTaskActionIfNeeded(task, "E-Mail senden");
        if (!shouldProceed) {
            return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = "E-Mail wird gesendet...";

        try {
            const result = await api.sendMail(task.task_id, mailToSend);
            if (result) {
                closeOverlay("mail-dialog-overlay");
                await loadTaskHistory(task.task_id, { showLoading: false });
            }
        } catch (err) {
            console.error("Fehler beim Senden der Mail:", err);
            showFlash("Fehler beim Senden der E-Mail. Bitte erneut versuchen.", "failure");
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = "E-Mail jetzt senden";
        }
    };
}

async function dispatchBot(task) {
    const shouldProceed = await confirmTaskActionIfNeeded(task, "Bot dispatchen");
    if (!shouldProceed) {
        return;
    }

    try {
        const result = await api.dispatchBot(task.task_id);
        if (!result) {
            return;
        }

        await loadTaskHistory(task.task_id, { showLoading: false });
        await loadTasks();
    } catch (err) {
        console.error("Bot Dispatch Error:", err);
        showFlash("Fehler beim Dispatchen des Bots", "failure");
    }
}

function renderTaskBuckets(filteredBuckets) {
    const openContainer = document.getElementById("open-tasks-slider");
    const myContainer = document.getElementById("my-tasks-slider");
    const completedContainer = document.getElementById("completed-tasks-slider");

    const openAndBlocked = [...filteredBuckets.open, ...filteredBuckets.blocked];
    const isFiltered = hasActiveTaskFilters();

    if (openContainer) {
        openContainer.innerHTML = openAndBlocked.length
            ? openAndBlocked.map(renderTaskTile).join("")
            : renderEmptyState(isFiltered ? "Keine Aufgaben für die aktuelle Suche" : "Keine offenen Aufgaben");
    }

    if (myContainer) {
        myContainer.innerHTML = filteredBuckets.mine.length
            ? filteredBuckets.mine.map(renderTaskTile).join("")
            : renderEmptyState(isFiltered ? "Keine eigenen Aufgaben für die aktuelle Suche" : "Keine eigenen Aufgaben");
    }

    if (completedContainer) {
        completedContainer.innerHTML = filteredBuckets.completed.length
            ? filteredBuckets.completed.map(renderTaskTile).join("")
            : renderEmptyState(isFiltered ? "Keine erledigten Aufgaben für die aktuelle Suche" : "Keine abgeschlossenen Aufgaben");
    }

    setCount("open-tasks-count", openAndBlocked.length);
    setCount("my-tasks-count", filteredBuckets.mine.length);
}

function refreshTaskView() {
    const filteredBuckets = filterTaskBuckets();
    taskViewState.filteredBuckets = filteredBuckets;
    renderTaskBuckets(filteredBuckets);
    updateTaskBulkActionState(filteredBuckets);

    const visibleCount = Object.values(filteredBuckets).reduce((sum, tasks) => sum + tasks.length, 0);
    const totalCount = Object.values(taskViewState.buckets).reduce((sum, tasks) => sum + tasks.length, 0);
    updateTaskFilterSummary(visibleCount, totalCount);
}

function initTaskFilters() {
    const searchInput = document.getElementById("tasks-search-input");
    const statusFilter = document.getElementById("tasks-status-filter");
    const handlingFilter = document.getElementById("tasks-handling-filter");
    const typeFilter = document.getElementById("tasks-type-filter");
    const backlogFilter = document.getElementById("tasks-backlog-filter");
    const resetButton = document.getElementById("tasks-filter-reset");

    if (searchInput && searchInput.dataset.bound !== "true") {
        searchInput.dataset.bound = "true";
        searchInput.addEventListener("input", event => {
            taskViewState.filters.search = event.target.value || "";
            refreshTaskView();
        });
    }

    if (statusFilter && statusFilter.dataset.bound !== "true") {
        statusFilter.dataset.bound = "true";
        statusFilter.addEventListener("change", event => {
            taskViewState.filters.status = event.target.value || "";
            refreshTaskView();
        });
    }

    if (handlingFilter && handlingFilter.dataset.bound !== "true") {
        handlingFilter.dataset.bound = "true";
        handlingFilter.addEventListener("change", event => {
            taskViewState.filters.handling = event.target.value || "";
            refreshTaskView();
        });
    }

    if (typeFilter && typeFilter.dataset.bound !== "true") {
        typeFilter.dataset.bound = "true";
        typeFilter.addEventListener("change", event => {
            taskViewState.filters.taskType = event.target.value || "";
            refreshTaskView();
        });
    }

    if (backlogFilter && backlogFilter.dataset.bound !== "true") {
        backlogFilter.dataset.bound = "true";
        backlogFilter.addEventListener("change", event => {
            taskViewState.filters.backlog = event.target.value || "";
            refreshTaskView();
        });
    }

    if (resetButton && resetButton.dataset.bound !== "true") {
        resetButton.dataset.bound = "true";
        resetButton.addEventListener("click", () => {
            taskViewState.filters = { ...TASK_FILTER_DEFAULTS };
            syncTaskFilterControls();
            refreshTaskView();
        });
    }

    syncTaskFilterControls();
    updateTaskFilterSummary(0, 0);
}

async function loadTaskBacklogs() {
    const backlogs = await api.getTaskBacklogs();
    taskViewState.backlogLookup = {};

    backlogs.forEach(backlog => {
        const identifier = normalizeBacklogIdentifier(backlog?.technical_identifier);
        if (identifier === null) {
            return;
        }

        taskViewState.backlogLookup[identifier] = {
            backlog_identifier: identifier,
            name: String(backlog.display_name || identifier).trim()
        };
    });

    buildTaskFilterOptions();
    syncTaskFilterControls();
}

async function loadInitialTaskData() {
    await Promise.all([
        loadTaskBacklogs(),
        loadTasks()
    ]);
}

async function loadTasks() {
    try {
        const res = await fetch("/api/tasks/overview");
        const data = await res.json();

        const openTasks = decorateTasks(Array.isArray(data.open_tasks) ? data.open_tasks : [], "open");
        const blockedTasks = decorateTasks(Array.isArray(data.blocked_tasks) ? data.blocked_tasks : [], "blocked");
        const myTasks = decorateTasks(Array.isArray(data.user_tasks) ? data.user_tasks : [], "mine");
        const completedTasks = decorateTasks(Array.isArray(data.completed_tasks) ? data.completed_tasks : [], "completed");

        taskViewState.buckets = {
            open: openTasks,
            blocked: blockedTasks,
            mine: myTasks,
            completed: completedTasks
        };
        buildTaskFilterOptions();
        syncTaskFilterControls();

        window.taskIndex = {};
        [...openTasks, ...blockedTasks, ...myTasks, ...completedTasks].forEach(task => {
            window.taskIndex[String(task.task_id)] = task;
        });

        refreshTaskView();
        return true;
    } catch (err) {
        console.error("Task-Ladefehler:", err);
        showFlash("Fehler beim Laden der Aufgaben. Siehe Konsole.", "failure");
        return false;
    }
}
