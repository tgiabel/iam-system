const sofaContract = window.SofaContract;

if (!window.taskOverlayInitialized) {
    document.addEventListener("DOMContentLoaded", () => {
        loadPersistedTaskView();
        initTaskOverlay();
        initMailDialog();
        initTaskWarningDialog();
        initRelatedRevocationsDialog();
        initTaskActionHandling();
        initTaskFilters();
        initTaskGroupModal();
        initTaskBulkActions();
        initTaskStripNavigation();
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
        BOT: "Automatisiert",
        EVENT: "Ereignis"
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
        CHANGE: "Funktionswechsel",
        ROLLBACK: "Rücknahme"
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

const taskVM = window.TaskViewModel;

const TASK_VIEW_STORAGE_KEY = "sofaTasksView";

// Die Sichtbarkeit ist bewusst keine Include/Exclude-Facette, sondern eine Einblendung.
const TASK_FILTER_CATEGORIES = [
    { id: "status", label: "Status" },
    { id: "handling", label: "Bearbeitungsart" },
    { id: "taskType", label: "Aufgabentyp" },
    { id: "backlog", label: "Backlog" },
    { id: "visibility", label: "Sichtbarkeit" }
];

const TASK_VISIBILITY_OPTIONS = [
    { key: "showBlocked", label: "Blockierte anzeigen", tagLabel: "Blockierte sichtbar" },
    { key: "showDeferred", label: "Nachgelagerte anzeigen", tagLabel: "Nachgelagerte sichtbar" }
];

const NO_BACKLOG_FILTER_VALUE = "__NONE__";

const taskViewState = {
    ...taskVM.createDefaultViewState(),
    filterOptions: {
        status: [],
        handling: [],
        taskType: [],
        backlog: []
    },
    backlogLookup: {},
    openFilterCategory: null,
    filteredBuckets: {
        open: [],
        blocked: [],
        mine: []
    },
    buckets: {
        open: [],
        blocked: [],
        mine: []
    }
};

const TASK_FACET_ACCESSORS = {
    status: task => getTaskStatusFilterKey(task),
    handling: task => getTaskHandlingFilterKey(task),
    taskType: task => getTaskTypeFilterKey(task),
    backlog: task => getTaskBacklogFilterKey(task)
};

function getTodayKey() {
    return sofaContract.berlinDateKey();
}

function getGroupLookups() {
    return {
        backlogLookup: taskViewState.backlogLookup,
        processLabels: LABELS.processes,
        todayKey: getTodayKey()
    };
}

function loadPersistedTaskView() {
    try {
        const raw = localStorage.getItem(TASK_VIEW_STORAGE_KEY);
        if (!raw) {
            return;
        }
        Object.assign(taskViewState, taskVM.normalizeViewState(JSON.parse(raw)));
    } catch (err) {
        console.error("Gespeicherte Aufgaben-Ansicht konnte nicht geladen werden", err);
    }
}

function savePersistedTaskView() {
    try {
        localStorage.setItem(TASK_VIEW_STORAGE_KEY, JSON.stringify({
            search: taskViewState.search,
            filters: taskViewState.filters,
            visibility: taskViewState.visibility,
            grouping: taskViewState.grouping
        }));
    } catch (err) {
        console.error("Aufgaben-Ansicht konnte nicht gespeichert werden", err);
    }
}

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

const relatedRevocationsState = {
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

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const message = sofaContract.mailErrorMessage(res.status, data.detail || data.error);
                showFlash(message, "failure");
                return { ok: false, status: res.status, message };
            }

            showFlash("E-Mail zur Zustellung eingestellt", "success");
            return { ok: true, data };
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return { ok: false, status: 0, message: "Netzwerkfehler oder Server nicht erreichbar" };
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

    async completeTask(taskId, payload) {
        try {
            const res = await fetch(`/api/tasks/${taskId}/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload || {})
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                return {
                    ok: false,
                    message: extractErrorMessage(data.detail || data.error, "Fehler beim Abschließen der Aufgabe")
                };
            }

            return { ok: true, data };
        } catch (err) {
            console.error("Complete Task Error:", err);
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

// Chip-Sprache: blau fuer Zuweisung, rot fuer Entzug, neutral fuer blockiert.
function getTaskRowToneClass(task) {
    if (isBlockedTask(task)) {
        return "is-tone-neutral";
    }
    return task.task_type === "REVOCATION" ? "is-tone-error" : "is-tone-primary";
}

function getTaskStateClass(task) {
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
        BOT: "ui-chip-purple"
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

function isBlockedTask(task) {
    return taskVM.isBlockedTask(task);
}

function isDeferredTask(task) {
    return taskVM.isDeferredTask(task);
}

function isEventHandlingTask(task) {
    return getTaskHandlingFilterKey(task) === "EVENT";
}

function taskPassesVisibilityToggles(task) {
    if (isBlockedTask(task) && !taskViewState.visibility.showBlocked) {
        return false;
    }

    if (isDeferredTask(task) && !taskViewState.visibility.showDeferred) {
        return false;
    }

    return true;
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
        ...taskViewState.buckets.mine
    ];
}

function createSortedFilterOptions(values, formatter) {
    return Array.from(new Set(values.filter(Boolean)))
        .map(value => ({ value, label: formatter(value) }))
        .sort((left, right) => left.label.localeCompare(right.label, "de"));
}

function buildTaskFilterOptions() {
    // Optionen nur aus dem, was aktuell ueberhaupt sichtbar sein darf - sonst liesse sich
    // z. B. "Blockiert" waehlen, obwohl der zugehoerige Haken aus ist.
    const tasks = collectAllTasks().filter(taskPassesVisibilityToggles);

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

    pruneStaleFilterSelections();
}

function pruneStaleFilterSelections() {
    // Werte, die es nicht mehr gibt, duerfen nicht als unsichtbarer Filter weiterwirken.
    Object.entries(taskViewState.filterOptions).forEach(([facetKey, options]) => {
        const allowed = new Set(options.map(option => option.value));
        const facet = taskViewState.filters[facetKey] || taskVM.createFacet();

        taskViewState.filters[facetKey] = {
            include: facet.include.filter(value => allowed.has(value)),
            exclude: facet.exclude.filter(value => allowed.has(value))
        };
    });
}

function syncTaskFilterControls() {
    taskFilterBar.syncControls();
}

function hasActiveTaskFilters() {
    return taskVM.hasActiveFilters(taskViewState);
}

function hasNonDefaultTaskView() {
    return taskVM.hasNonDefaultView(taskViewState);
}

function updateTaskFilterSummary(visibleCount, totalCount) {
    const summary = document.getElementById("tasks-filter-summary");
    if (summary) {
        summary.textContent = visibleCount !== totalCount
            ? `${visibleCount} von ${totalCount} Aufgaben sichtbar`
            : `${totalCount} Aufgaben sichtbar`;
    }

    const resetButton = document.getElementById("tasks-filter-reset");
    if (resetButton) {
        resetButton.disabled = !hasNonDefaultTaskView();
    }
}

function taskMatchesFilters(task) {
    return taskPassesVisibilityToggles(task) && taskMatchesSearchAndSelectFilters(task);
}

function taskMatchesSearchAndSelectFilters(task) {
    const normalizedSearch = normalizeSearchValue(taskViewState.search);
    if (normalizedSearch && !getTaskSearchIndex(task).includes(normalizedSearch)) {
        return false;
    }

    return taskVM.matchesFacets(task, taskViewState.filters, TASK_FACET_ACCESSORS);
}

function filterTaskBuckets() {
    return {
        open: taskViewState.buckets.open.filter(taskMatchesFilters),
        blocked: taskViewState.buckets.blocked.filter(taskMatchesFilters),
        mine: taskViewState.buckets.mine.filter(taskMatchesFilters)
    };
}
function isTaskCompleted(task) {
    return task.status === "COMPLETED" || Boolean(task.completed_at);
}

function findRelatedOpenRevocationTasks(task) {
    return [...taskViewState.buckets.open, ...taskViewState.buckets.mine].filter(other =>
        other.task_id !== task.task_id &&
        other.task_type === "REVOCATION" &&
        other.target_user_id === task.target_user_id &&
        other.system_name === task.system_name
    );
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

function renderTaskCardInner(task) {
    const blockedLabel = task.uiListState === "blocked"
        ? `<span class="ui-chip ui-chip-neutral">Blockiert</span>`
        : "";

    const statusLabel = isTaskCompleted(task) ? "Zuletzt erledigt" : formatStatus(task.status, task);
    const kickerLabel = formatTaskModalSubtitle(task);
    const backlogLabel = formatBacklogFilterValue(getTaskBacklogFilterKey(task));
    const handlingChip = task.uiListState === "blocked"
        ? ""
        : `<span class="ui-chip ${getHandlingChipClass(task.handling_type)}">${escapeHtml(formatHandlingType(task.handling_type))}</span>`;
    const targetDateRow = sofaContract.parseDateKey(task.target_date)
        ? `<div class="task-card-row"><span>Stichtag</span><strong>${escapeHtml(sofaContract.formatDateKey(task.target_date))}</strong></div>`
        : "";

    return `
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
                    ${targetDateRow}
                </div>
            </div>
    `;
}

function renderTaskTile(task) {
    return `
        <a href="#" class="task-tile task-card ${getTaskStateClass(task)}" data-task-id="${escapeHtml(task.task_id)}">
            ${renderTaskCardInner(task)}
        </a>
    `;
}

function renderGroupMarkers(group) {
    const markers = [];

    if (group.blockedCount) {
        markers.push(`<span class="ui-chip ui-chip-neutral">${group.blockedCount} blockiert</span>`);
    }
    if (group.deferredCount) {
        markers.push(`<span class="ui-chip ui-chip-neutral">${group.deferredCount} nachgelagert</span>`);
    }

    return markers.join("");
}

function renderGroupLabel(group) {
    return `
        <div class="task-group-label">
            <span class="task-group-label-title" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
            <span class="ui-count-pill ui-count-pill-info">${group.tasks.length}</span>
            ${renderGroupMarkers(group)}
        </div>
    `;
}

function renderTaskGroup(group, bucketKind) {
    if (group.tasks.length === 1) {
        return `
            <div class="task-group-item">
                ${renderGroupLabel(group)}
                ${renderTaskTile(group.tasks[0])}
            </div>
        `;
    }

    const sheetCount = Math.min(2, group.tasks.length - 1);
    const sheets = Array.from({ length: sheetCount }, (_, index) =>
        `<span class="task-stack-sheet task-stack-sheet-${sheetCount - index}" aria-hidden="true"></span>`
    ).join("");

    return `
        <div class="task-group-item">
            ${renderGroupLabel(group)}
            <a
                href="#"
                class="task-stack"
                data-group-key="${escapeHtml(group.key)}"
                data-group-bucket="${escapeHtml(bucketKind)}"
                aria-label="Gruppe ${escapeHtml(group.label)} mit ${group.tasks.length} Aufgaben öffnen"
            >
                ${sheets}
                <div class="task-card task-stack-face ${getTaskStateClass(group.face)}">
                    ${renderTaskCardInner(group.face)}
                </div>
            </a>
        </div>
    `;
}

function renderTaskStripContent(tasks, bucketKind, emptyMessage) {
    if (!tasks.length) {
        return renderEmptyState(emptyMessage);
    }

    if (!taskVM.isGroupingActive(taskViewState.grouping.dimension)) {
        return taskVM.sortTasks(tasks, getTodayKey()).map(renderTaskTile).join("");
    }

    return taskVM
        .buildGroups(tasks, taskViewState.grouping.dimension, getGroupLookups())
        .map(group => renderTaskGroup(group, bucketKind))
        .join("");
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

function createArchivedAccountNotice(task) {
    const accounts = sofaContract.getArchivedAccounts(task);
    if (!accounts.length) {
        return null;
    }

    const notice = document.createElement("section");
    notice.className = "task-archived-accounts";
    notice.setAttribute("aria-label", "Archivierte Konten");
    notice.innerHTML = `
        <strong class="task-archived-accounts-title">Archiviertes Konto vorhanden</strong>
        <p class="task-archived-accounts-text">
            Für ${escapeHtml(task.target_user_name || "diese Person")} gibt es in dieser Ressource ein archiviertes Konto.
            Bitte vor „Bot beauftragen“ oder dem Anlegen eines neuen Kontos prüfen, ob es wiederhergestellt werden kann.
        </p>
        <ul class="task-archived-accounts-list">
            ${accounts.map(account => `
                <li>
                    <span class="task-archived-account-main">
                        <strong>${escapeHtml(account.accountIdentifier || "-")}</strong>
                        <span>${account.archivedAt ? `archiviert am ${escapeHtml(formatDateTime(account.archivedAt))}` : "archiviert"}</span>
                    </span>
                    ${account.restorable
                        ? `<button type="button" class="btn btn-secondary task-archived-account-restore-btn" data-history-id="${escapeHtml(account.userAccountHistoryId)}">Archiviertes Konto wiederherstellen</button>`
                        : `<span class="task-archived-account-blocked">Kennung gehört inzwischen einer anderen Person</span>`}
                </li>
            `).join("")}
        </ul>
    `;

    notice.querySelectorAll(".task-archived-account-restore-btn").forEach(button => {
        const account = accounts.find(entry => String(entry.userAccountHistoryId) === button.dataset.historyId);
        button.addEventListener("click", () => restoreArchivedAccount(task, account, button));
    });

    return notice;
}

async function restoreArchivedAccount(task, account, button) {
    const confirmed = await showArchivedAccountRestoreWarning(task, account);
    if (!confirmed) {
        return;
    }

    const payload = { reactivate_user_account_history_id: account.userAccountHistoryId };
    const comment = document.getElementById("task-comment")?.value?.trim();
    if (comment) {
        payload.comment = comment;
    }

    button.disabled = true;
    try {
        const result = await api.completeTask(task.task_id, payload);
        if (!result.ok) {
            showFlash(result.message, "failure");
            return;
        }

        showFlash(`Konto ${account.accountIdentifier} wiederhergestellt, Task erledigt.`, "success");
        closeOverlay("task-overlay");
        await loadTasks();
    } finally {
        if (button.isConnected) {
            button.disabled = false;
        }
    }
}

function showArchivedAccountRestoreWarning(task, account) {
    const titleEl = document.getElementById("task-warning-title");
    const textEl = document.getElementById("task-warning-text");
    const listEl = document.getElementById("task-warning-list");
    const confirmEl = document.getElementById("task-warning-confirm-btn");
    const systemName = task.system_name || "dem Zielsystem";

    if (titleEl) {
        titleEl.textContent = "Archiviertes Konto wiederherstellen?";
    }
    if (textEl) {
        textEl.textContent = `Das Konto ${account.accountIdentifier} wird dieser Person wieder zugeordnet. Stelle das Konto zuerst in ${systemName} wieder her. Die Aufgabe wird danach abgeschlossen, ein neues Konto wird nicht angelegt.`;
    }
    if (listEl) {
        listEl.innerHTML = `
            <li>
                <strong>${escapeHtml(account.accountIdentifier || "-")}</strong>
                <span>${escapeHtml(task.resource_name || "-")} · ${escapeHtml(task.target_user_name || "-")}</span>
            </li>
        `;
    }
    if (confirmEl) {
        confirmEl.textContent = "Wiederhergestellt, Task abschließen";
    }

    openOverlay("task-warning-overlay");
    return new Promise(resolve => {
        taskWarningState.resolver = resolve;
    });
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

    // Der Hinweis steht vor Kommentar und Aktionen: Wer den Bot beauftragt oder eine neue
    // Kennung eintraegt, legt ein neues Konto an, obwohl ein archiviertes existiert.
    const archivedAccountNotice = createArchivedAccountNotice(task);
    if (archivedAccountNotice) {
        formEl.appendChild(archivedAccountNotice);
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

    if (sofaContract.canSendTaskMail(task, window.currentUserId)) {
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

// Arbeitet bewusst auf den rohen Buckets, nicht auf den gefilterten.
const taskGroupModal = {
    state: {
        dimension: "none",
        key: null,
        tab: "open",
        search: "",
        selection: new Set(),
        busy: false
    },

    isOpen() {
        return Boolean(document.getElementById("task-group-overlay")?.classList.contains("active"));
    },

    open(groupKey, bucketKind) {
        if (!groupKey || !taskVM.isGroupingActive(taskViewState.grouping.dimension)) {
            return;
        }

        this.state.dimension = taskViewState.grouping.dimension;
        this.state.key = groupKey;
        this.state.tab = bucketKind === "mine" ? "mine" : "open";
        this.state.search = "";
        this.state.selection = new Set();

        const searchInput = document.getElementById("task-group-search");
        if (searchInput) {
            searchInput.value = "";
        }

        openOverlay("task-group-overlay");
        this.render();
    },

    close() {
        this.state.key = null;
        this.state.selection = new Set();
        closeOverlay("task-group-overlay");
    },

    refresh() {
        if (this.isOpen()) {
            this.render();
        }
    },

    collectTasks() {
        const matchesGroup = task => taskVM.getGroupKey(task, this.state.dimension).key === this.state.key;

        return {
            open: [...taskViewState.buckets.open, ...taskViewState.buckets.blocked].filter(matchesGroup),
            mine: taskViewState.buckets.mine.filter(matchesGroup)
        };
    },

    resolveLabel(tasks) {
        const dimension = taskVM.getGroupDimension(this.state.dimension);
        if (this.state.key === taskVM.UNGROUPED_KEY) {
            return dimension.emptyLabel;
        }

        const sample = tasks.open[0] || tasks.mine[0];
        return sample ? dimension.labelOf(sample, getGroupLookups()) : dimension.label;
    },

    selectTab(tab) {
        if (this.state.tab === tab) {
            return;
        }

        this.state.tab = tab === "mine" ? "mine" : "open";
        this.state.selection = new Set();
        this.render();
    },

    toggleSelection(taskId, isSelected) {
        if (isSelected) {
            this.state.selection.add(String(taskId));
        } else {
            this.state.selection.delete(String(taskId));
        }
        this.render();
    },

    toggleSelectAll(isSelected) {
        const visible = this.getVisibleTasks();
        visible.forEach(task => {
            if (isSelected) {
                this.state.selection.add(String(task.task_id));
            } else {
                this.state.selection.delete(String(task.task_id));
            }
        });
        this.render();
    },

    clearSelection() {
        this.state.selection = new Set();
        this.render();
    },

    getVisibleTasks() {
        const tasks = this.collectTasks()[this.state.tab] || [];
        const search = normalizeSearchValue(this.state.search);

        return taskVM
            .sortTasksForList(tasks, getTodayKey())
            .filter(task => !search || getTaskSearchIndex(task).includes(search));
    },

    renderRow(task) {
        const chips = [
            task.uiListState === "blocked" ? `<span class="ui-chip ui-chip-neutral">Blockiert</span>` : "",
            isDeferredTask(task) ? `<span class="ui-chip ui-chip-neutral">Nachgelagert</span>` : "",
            `<span class="ui-chip ${getHandlingChipClass(task.handling_type)}">${escapeHtml(formatHandlingType(task.handling_type))}</span>`
        ].join("");

        const targetDate = sofaContract.parseDateKey(task.target_date)
            ? sofaContract.formatDateKey(task.target_date)
            : "ohne Stichtag";

        return `
            <div class="task-group-row ${getTaskRowToneClass(task)}">
                <label class="task-group-row-select">
                    <input
                        type="checkbox"
                        data-group-task-id="${escapeHtml(task.task_id)}"
                        ${this.state.selection.has(String(task.task_id)) ? "checked" : ""}
                        aria-label="Aufgabe ${escapeHtml(task.task_id)} auswählen"
                    >
                </label>
                <a href="#" class="task-tile task-group-row-main" data-task-id="${escapeHtml(task.task_id)}">
                    <span class="task-group-row-title">${escapeHtml(formatTaskType(task.task_type))} · ${escapeHtml(task.resource_name || "-")}</span>
                    <span class="task-group-row-meta">
                        <span>${escapeHtml(task.system_name || "-")}</span>
                        <span>${escapeHtml(task.target_user_name || "-")}</span>
                        <span>${escapeHtml(targetDate)}</span>
                    </span>
                </a>
                <div class="task-group-row-chips">${chips}</div>
            </div>
        `;
    },

    renderTabs(counts) {
        document.querySelectorAll("#task-group-overlay [data-group-tab]").forEach(tab => {
            const tabKey = tab.dataset.groupTab;
            const count = counts[tabKey] || 0;
            const isActive = tabKey === this.state.tab;

            tab.classList.toggle("is-active", isActive);
            tab.setAttribute("aria-selected", String(isActive));
            tab.disabled = count === 0;
            tab.setAttribute("aria-disabled", String(count === 0));
        });

        setCount("task-group-count-open", counts.open);
        setCount("task-group-count-mine", counts.mine);
    },

    renderBulkBar(visibleTasks) {
        const bar = document.getElementById("task-group-bulk-bar");
        const countLabel = document.getElementById("task-group-selection-count");
        const action = document.getElementById("task-group-bulk-action");
        const selectAll = document.getElementById("task-group-select-all");
        const selectedCount = this.state.selection.size;

        if (selectAll) {
            selectAll.disabled = !visibleTasks.length;
            selectAll.checked = Boolean(visibleTasks.length) &&
                visibleTasks.every(task => this.state.selection.has(String(task.task_id)));
        }

        if (bar) {
            bar.hidden = selectedCount === 0;
        }

        if (countLabel) {
            countLabel.textContent = `${selectedCount} ausgewählt`;
        }

        if (action && action.dataset.busy !== "true") {
            const isRelease = this.state.tab === "mine";
            action.textContent = isRelease ? "Freigeben" : "Übernehmen";
            // setTaskBulkButtonState cacht die Beschriftung, die haengt hier aber am Tab.
            action.dataset.defaultLabel = action.textContent;
            action.className = `btn btn-sm ${isRelease ? "btn-red" : "btn-primary"}`;
            action.disabled = selectedCount === 0;
        }
    },

    render() {
        if (!this.state.key) {
            return;
        }

        if (this.state.dimension !== taskViewState.grouping.dimension) {
            this.close();
            return;
        }

        const tasks = this.collectTasks();
        const counts = { open: tasks.open.length, mine: tasks.mine.length };
        const resolution = taskVM.resolveGroupModalTab(counts, this.state.tab);

        if (resolution.close) {
            this.close();
            return;
        }

        if (resolution.tab !== this.state.tab) {
            this.state.tab = resolution.tab;
            this.state.selection = new Set();
        }

        // Verschwundene Aufgaben duerfen nicht als unsichtbare Auswahl weiterleben.
        const tabTaskIds = new Set((tasks[this.state.tab] || []).map(task => String(task.task_id)));
        this.state.selection = new Set(
            Array.from(this.state.selection).filter(taskId => tabTaskIds.has(taskId))
        );

        const dimension = taskVM.getGroupDimension(this.state.dimension);
        const kicker = document.getElementById("task-group-kicker");
        const title = document.getElementById("task-group-title");
        if (kicker) {
            kicker.textContent = dimension.label;
        }
        if (title) {
            title.textContent = this.resolveLabel(tasks);
        }

        this.renderTabs(counts);

        const visibleTasks = this.getVisibleTasks();
        const list = document.getElementById("task-group-list");
        if (list) {
            list.innerHTML = visibleTasks.length
                ? visibleTasks.map(task => this.renderRow(task)).join("")
                : renderEmptyState(this.state.search ? "Keine Aufgaben für diese Suche" : "Keine Aufgaben");
        }

        this.renderBulkBar(visibleTasks);
    },

    async runBulkAction() {
        const selectedIds = Array.from(this.state.selection);
        if (!selectedIds.length || this.state.busy) {
            return;
        }

        const isRelease = this.state.tab === "mine";
        this.state.busy = true;

        try {
            await handleBulkTaskAction({
                buttonId: "task-group-bulk-action",
                busyLabel: isRelease ? "Gebe frei..." : "Übernehme...",
                taskSelector: () => selectedIds
                    .map(taskId => window.taskIndex?.[taskId])
                    .filter(Boolean),
                bulkRequestHandler: isRelease ? api.bulkReleaseTasks : api.bulkAssignTasks,
                successLabel: isRelease ? "Aufgaben freigegeben" : "Aufgaben übernommen"
            });
        } finally {
            this.state.busy = false;
            this.state.selection = new Set();
            this.render();
        }
    }
};

function initTaskGroupModal() {
    document.getElementById("task-group-close-btn")?.addEventListener("click", () => {
        taskGroupModal.close();
    });

    document.getElementById("task-group-overlay")?.addEventListener("click", event => {
        if (event.target.id === "task-group-overlay") {
            taskGroupModal.close();
        }
    });

    document.getElementById("task-group-search")?.addEventListener("input", event => {
        taskGroupModal.state.search = event.target.value || "";
        taskGroupModal.render();
    });

    document.querySelectorAll("#task-group-overlay [data-group-tab]").forEach(tab => {
        tab.addEventListener("click", () => taskGroupModal.selectTab(tab.dataset.groupTab));
    });

    document.getElementById("task-group-select-all")?.addEventListener("change", event => {
        taskGroupModal.toggleSelectAll(event.target.checked);
    });

    document.getElementById("task-group-selection-clear")?.addEventListener("click", () => {
        taskGroupModal.clearSelection();
    });

    document.getElementById("task-group-bulk-action")?.addEventListener("click", () => {
        taskGroupModal.runBulkAction();
    });

    document.getElementById("task-group-list")?.addEventListener("change", event => {
        const checkbox = event.target.closest("[data-group-task-id]");
        if (checkbox) {
            taskGroupModal.toggleSelection(checkbox.dataset.groupTaskId, checkbox.checked);
        }
    });

    document.addEventListener("click", event => {
        const stack = event.target.closest(".task-stack");
        if (!stack) {
            return;
        }

        event.preventDefault();
        taskGroupModal.open(stack.dataset.groupKey, stack.dataset.groupBucket);
    });
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
    const targetDateItemEl = document.getElementById("task-modal-target-date-item");
    const targetDateEl = document.getElementById("task-modal-target-date");

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
    const hasTargetDate = Boolean(sofaContract.parseDateKey(task.target_date));
    if (targetDateItemEl) {
        targetDateItemEl.hidden = !hasTargetDate;
    }
    if (targetDateEl) {
        targetDateEl.textContent = hasTargetDate ? sofaContract.formatDateKey(task.target_date) : "-";
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
    const confirmEl = document.getElementById("task-warning-confirm-btn");
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
    if (confirmEl) {
        confirmEl.textContent = "Trotzdem ausführen";
    }

    openOverlay("task-warning-overlay");

    return new Promise(resolve => {
        taskWarningState.resolver = resolve;
    });
}

function showFutureRevocationWarning(task) {
    const titleEl = document.getElementById("task-warning-title");
    const textEl = document.getElementById("task-warning-text");
    const listEl = document.getElementById("task-warning-list");
    const confirmEl = document.getElementById("task-warning-confirm-btn");

    if (titleEl) {
        titleEl.textContent = "Entzug vor Stichtag abschließen?";
    }
    if (textEl) {
        textEl.textContent = "Der Entzug ist erst für einen zukünftigen Stichtag vorgesehen. Mit dem Abschluss wird er trotzdem jetzt als erledigt behandelt. Bitte ausdrücklich bestätigen.";
    }
    if (listEl) {
        listEl.innerHTML = `
            <li>
                <strong>${escapeHtml(task.resource_name || formatTaskType(task.task_type))}</strong>
                <span>Stichtag: ${escapeHtml(sofaContract.formatDateKey(task.target_date))} · Zukünftig</span>
            </li>
        `;
    }
    if (confirmEl) {
        confirmEl.textContent = "Ja, vor Stichtag erledigen";
    }

    openOverlay("task-warning-overlay");
    return new Promise(resolve => {
        taskWarningState.resolver = resolve;
    });
}

function closeRelatedRevocationsDialog(result) {
    closeOverlay("related-revocations-overlay");

    if (typeof relatedRevocationsState.resolver === "function") {
        const resolve = relatedRevocationsState.resolver;
        relatedRevocationsState.resolver = null;
        resolve(result);
    }
}

function showRelatedRevocationsDialog(relatedTasks) {
    const textEl = document.getElementById("related-revocations-text");
    const listEl = document.getElementById("related-revocations-list");
    const [{ target_user_name: targetUserName, system_name: systemName }] = relatedTasks;

    const includesFutureTasks = relatedTasks.some(task => sofaContract.isFutureRevocationTask(task));

    if (textEl) {
        textEl.textContent = includesFutureTasks
            ? `Für ${targetUserName || "diesen Nutzer"} gibt es im System ${systemName || "-"} weitere offene Entzugs-Aufgaben. Die Auswahl enthält zukünftige Stichtage. Sollen ausdrücklich auch diese jetzt mit abgeschlossen werden?`
            : `Für ${targetUserName || "diesen Nutzer"} gibt es im System ${systemName || "-"} weitere offene Entzugs-Aufgaben. Sollen diese mit abgeschlossen werden?`;
    }

    if (listEl) {
        listEl.innerHTML = relatedTasks.map(task => {
            const targetDate = sofaContract.parseDateKey(task.target_date);
            const futureLabel = sofaContract.isFutureRevocationTask(task) ? " · Zukünftig" : "";
            return `
            <li>
                <strong>${escapeHtml(formatTaskType(task.task_type))}</strong>
                <span>${escapeHtml(task.resource_name || "-")}${targetDate ? ` · Stichtag: ${escapeHtml(sofaContract.formatDateKey(targetDate))}${futureLabel}` : ""}</span>
            </li>
        `;
        }).join("");
    }

    openOverlay("related-revocations-overlay");

    return new Promise(resolve => {
        relatedRevocationsState.resolver = resolve;
    });
}

async function handleRelatedRevocationTasks(relatedTasks) {
    if (!relatedTasks.length) {
        return;
    }

    const shouldComplete = await showRelatedRevocationsDialog(relatedTasks);
    if (!shouldComplete) {
        return;
    }

    const taskIds = relatedTasks.map(task => task.task_id);
    await api.bulkAssignTasks(taskIds);

    const results = await Promise.all(
        taskIds.map(taskId => api.completeTask(taskId, { comment: "Mit Benutzerkonto gelöscht" }))
    );

    const failedTasks = results
        .map((result, index) => ({ result, taskId: taskIds[index] }))
        .filter(({ result }) => !result.ok)
        .map(({ taskId, result }) => ({ taskId, message: result.message }));
    const successCount = results.length - failedTasks.length;

    const summary = buildBulkActionSummary(successCount, failedTasks, "weitere Aufgabe(n) abgeschlossen");
    showFlash(summary.message, summary.type);
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

        const relatedRevocationsOverlay = document.getElementById("related-revocations-overlay");
        if (relatedRevocationsOverlay?.classList.contains("active")) {
            closeRelatedRevocationsDialog(false);
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
            return;
        }

        if (taskGroupModal.isOpen()) {
            taskGroupModal.close();
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

function initRelatedRevocationsDialog() {
    document.getElementById("related-revocations-cancel-btn")?.addEventListener("click", () => {
        closeRelatedRevocationsDialog(false);
    });

    document.getElementById("related-revocations-confirm-btn")?.addEventListener("click", () => {
        closeRelatedRevocationsDialog(true);
    });

    document.getElementById("related-revocations-close-btn")?.addEventListener("click", () => {
        closeRelatedRevocationsDialog(false);
    });

    document.getElementById("related-revocations-overlay")?.addEventListener("click", event => {
        if (event.target.id === "related-revocations-overlay") {
            closeRelatedRevocationsDialog(false);
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

            if (sofaContract.isFutureRevocationTask(task)) {
                const confirmed = await showFutureRevocationWarning(task);
                if (!confirmed) {
                    return;
                }
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

    const relatedTasks = (task.task_type === "REVOCATION" && task.resource_type_id === 1)
        ? findRelatedOpenRevocationTasks(task)
        : [];

    try {
        const res = await fetch(`/api/tasks/${task.task_id}/complete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showFlash(extractErrorMessage(data.detail || data.error, "Task konnte nicht erledigt werden."), "failure");
            return;
        }

        showFlash("Task erfolgreich erledigt.", "success");
        closeOverlay("task-overlay");
        await handleRelatedRevocationTasks(relatedTasks);
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
        sendBtn.textContent = "Wird eingestellt...";

        try {
            const result = await api.sendMail(task.task_id, mailToSend);
            if (result.ok) {
                closeOverlay("mail-dialog-overlay");
                await loadTaskHistory(task.task_id, { showLoading: false });
            }
        } catch (err) {
            console.error("Fehler beim Senden der Mail:", err);
            showFlash("Fehler beim Senden der E-Mail. Bitte erneut versuchen.", "failure");
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = "E-Mail einstellen";
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

    const openAndBlocked = [...filteredBuckets.open, ...filteredBuckets.blocked];
    const isFiltered = hasActiveTaskFilters();
    const isGrouped = taskVM.isGroupingActive(taskViewState.grouping.dimension);

    if (openContainer) {
        openContainer.classList.toggle("is-grouped", isGrouped);
        openContainer.innerHTML = renderTaskStripContent(
            openAndBlocked,
            "open",
            isFiltered ? "Keine Aufgaben für die aktuelle Suche" : "Keine offenen Aufgaben"
        );
    }

    if (myContainer) {
        myContainer.classList.toggle("is-grouped", isGrouped);
        myContainer.innerHTML = renderTaskStripContent(
            filteredBuckets.mine,
            "mine",
            isFiltered ? "Keine eigenen Aufgaben für die aktuelle Suche" : "Keine eigenen Aufgaben"
        );
    }

    refreshTaskStripNavigation();

    setCount("open-tasks-count", filteredBuckets.open.length);
    setCount("my-tasks-count", filteredBuckets.mine.length);

    updateGroupCountPill(
        "blocked-tasks-count",
        countOpenTasksMatchingSelection(isBlockedTask),
        taskViewState.visibility.showBlocked,
        "blockierte Aufgaben"
    );
    updateGroupCountPill(
        "deferred-tasks-count",
        countOpenTasksMatchingSelection(isDeferredTask),
        taskViewState.visibility.showDeferred,
        "Nachlieferungen"
    );
}

// Blaetter-Buttons fuer die horizontalen Streifen: sichtbar nur, solange in
// die jeweilige Richtung noch gescrollt werden kann.
const TASK_STRIP_EDGE_TOLERANCE = 2;

function updateTaskStripNavigation(viewport) {
    const strip = viewport.querySelector(".task-strip");
    if (!strip) return;
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    const canPrev = strip.scrollLeft > TASK_STRIP_EDGE_TOLERANCE;
    const canNext = strip.scrollLeft < maxScroll - TASK_STRIP_EDGE_TOLERANCE;
    viewport.querySelectorAll("[data-strip-nav]").forEach(button => {
        const visible = button.dataset.stripNav === "prev" ? canPrev : canNext;
        button.classList.toggle("is-visible", visible);
        button.disabled = !visible;
    });
}

function refreshTaskStripNavigation() {
    document.querySelectorAll(".task-strip-viewport").forEach(updateTaskStripNavigation);
}

function initTaskStripNavigation() {
    const viewports = document.querySelectorAll(".task-strip-viewport");
    viewports.forEach(viewport => {
        const strip = viewport.querySelector(".task-strip");
        if (!strip) return;

        strip.addEventListener("scroll", () => updateTaskStripNavigation(viewport), {passive: true});
        viewport.querySelectorAll("[data-strip-nav]").forEach(button => {
            button.addEventListener("click", () => {
                const direction = button.dataset.stripNav === "prev" ? -1 : 1;
                const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                strip.scrollBy({
                    left: direction * strip.clientWidth * 0.85,
                    behavior: reduceMotion ? "auto" : "smooth",
                });
            });
        });
        updateTaskStripNavigation(viewport);
    });

    if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(entries => {
            entries.forEach(entry => updateTaskStripNavigation(entry.target));
        });
        viewports.forEach(viewport => observer.observe(viewport));
    }
}

// Zaehlt bewusst ohne die Sichtbarkeits-Haken, damit das Pill auch dann meldet,
// wie viele Aufgaben gerade ausgeblendet sind.
function countOpenTasksMatchingSelection(predicate) {
    return collectAllTasks().filter(task =>
        predicate(task) &&
        taskMatchesSearchAndSelectFilters(task)
    ).length;
}

function updateGroupCountPill(elementId, count, isVisible, groupLabel) {
    const pill = document.getElementById(elementId);
    if (!pill) {
        return;
    }

    pill.textContent = String(count);
    pill.hidden = count === 0;
    pill.classList.toggle("is-muted-group", !isVisible);
    pill.title = isVisible
        ? `${count} ${groupLabel}`
        : `${count} ${groupLabel} ausgeblendet`;
}

function refreshTaskView() {
    const filteredBuckets = filterTaskBuckets();
    taskViewState.filteredBuckets = filteredBuckets;
    renderTaskBuckets(filteredBuckets);
    updateTaskBulkActionState(filteredBuckets);
    taskGroupModal.refresh();

    const visibleCount = Object.values(filteredBuckets).reduce((sum, tasks) => sum + tasks.length, 0);
    const totalCount = Object.values(taskViewState.buckets).reduce((sum, tasks) => sum + tasks.length, 0);
    updateTaskFilterSummary(visibleCount, totalCount);
}

// Filterleiste im Stil der Userverwaltung.
const taskFilterBar = {
    init() {
        this.renderFilterDropdown();
        this.renderGroupDropdown();
        this.bindSearch();
        this.bindFilterMenu();
        this.bindGroupMenu();
        this.bindReset();
        this.bindGlobalClose();
        this.syncControls();
    },

    renderFilterDropdown() {
        const dropdown = document.getElementById("tasks-filter-dropdown");
        if (!dropdown) {
            return;
        }

        dropdown.innerHTML = TASK_FILTER_CATEGORIES.map(category => `
            <button type="button" data-filter-category="${escapeHtml(category.id)}">${escapeHtml(category.label)}</button>
        `).join("");
    },

    renderGroupDropdown() {
        const dropdown = document.getElementById("tasks-group-dropdown");
        if (!dropdown) {
            return;
        }

        dropdown.innerHTML = taskVM.GROUP_DIMENSIONS.map(dimension => `
            <button
                type="button"
                data-group-dimension="${escapeHtml(dimension.id)}"
                class="${dimension.id === taskViewState.grouping.dimension ? "is-active" : ""}"
            >${escapeHtml(dimension.label)}</button>
        `).join("");
    },

    bindSearch() {
        const searchInput = document.getElementById("tasks-search-input");
        if (!searchInput || searchInput.dataset.bound === "true") {
            return;
        }

        searchInput.dataset.bound = "true";
        searchInput.addEventListener("input", event => {
            taskViewState.search = event.target.value || "";
            savePersistedTaskView();
            refreshTaskView();
        });
    },

    bindFilterMenu() {
        const trigger = document.getElementById("tasks-filter-btn");
        const dropdown = document.getElementById("tasks-filter-dropdown");
        const subfilter = document.getElementById("tasks-subfilter-dropdown");
        const tags = document.getElementById("tasks-active-filters");

        if (trigger && trigger.dataset.bound !== "true") {
            trigger.dataset.bound = "true";
            trigger.addEventListener("click", event => {
                event.stopPropagation();
                const shouldOpen = !dropdown?.classList.contains("active");
                this.closeMenus();
                if (shouldOpen) {
                    dropdown?.classList.add("active");
                    trigger.setAttribute("aria-expanded", "true");
                }
            });
        }

        if (dropdown && dropdown.dataset.bound !== "true") {
            dropdown.dataset.bound = "true";
            dropdown.addEventListener("click", event => {
                event.stopPropagation();
                const button = event.target.closest("[data-filter-category]");
                if (button) {
                    this.openCategory(button.dataset.filterCategory);
                }
            });
        }

        if (subfilter && subfilter.dataset.bound !== "true") {
            subfilter.dataset.bound = "true";
            subfilter.addEventListener("click", event => event.stopPropagation());
            subfilter.addEventListener("change", event => this.handleSubfilterChange(event));
        }

        if (tags && tags.dataset.bound !== "true") {
            tags.dataset.bound = "true";
            tags.addEventListener("click", event => {
                const button = event.target.closest("[data-tag-kind]");
                if (button) {
                    this.removeTag(button.dataset);
                }
            });
        }
    },

    bindGroupMenu() {
        const trigger = document.getElementById("tasks-group-btn");
        const dropdown = document.getElementById("tasks-group-dropdown");

        if (trigger && trigger.dataset.bound !== "true") {
            trigger.dataset.bound = "true";
            trigger.addEventListener("click", event => {
                event.stopPropagation();
                const shouldOpen = !dropdown?.classList.contains("active");
                this.closeMenus();
                if (shouldOpen) {
                    dropdown?.classList.add("active");
                    trigger.setAttribute("aria-expanded", "true");
                }
            });
        }

        if (dropdown && dropdown.dataset.bound !== "true") {
            dropdown.dataset.bound = "true";
            dropdown.addEventListener("click", event => {
                event.stopPropagation();
                const button = event.target.closest("[data-group-dimension]");
                if (!button) {
                    return;
                }

                taskViewState.grouping.dimension = button.dataset.groupDimension;
                savePersistedTaskView();
                this.closeMenus();
                this.renderGroupDropdown();
                this.renderActiveTags();
                refreshTaskView();
            });
        }
    },

    bindReset() {
        const resetButton = document.getElementById("tasks-filter-reset");
        if (!resetButton || resetButton.dataset.bound === "true") {
            return;
        }

        resetButton.dataset.bound = "true";
        resetButton.addEventListener("click", () => {
            Object.assign(taskViewState, taskVM.createDefaultViewState());
            savePersistedTaskView();
            this.closeMenus();
            buildTaskFilterOptions();
            this.syncControls();
            refreshTaskView();
        });
    },

    bindGlobalClose() {
        if (document.body.dataset.tasksFilterBound === "true") {
            return;
        }

        document.body.dataset.tasksFilterBound = "true";
        document.addEventListener("click", event => {
            const insideFilter = document.getElementById("tasks-filter-container")?.contains(event.target);
            const insideGroup = document.getElementById("tasks-group-container")?.contains(event.target);
            if (!insideFilter && !insideGroup) {
                this.closeMenus();
            }
        });
    },

    handleSubfilterChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        if (target.dataset.visibilityKey) {
            taskViewState.visibility[target.dataset.visibilityKey] = target.checked;
            // Die Filteroptionen haengen an der Sichtbarkeit und muessen neu aufgebaut werden.
            buildTaskFilterOptions();
        } else if (target.dataset.facetKey) {
            const { facetKey, mode } = target.dataset;
            const values = target.dataset.selectAllValues
                ? JSON.parse(target.dataset.selectAllValues)
                : [target.value];

            values.forEach(value => {
                taskViewState.filters[facetKey] = taskVM.toggleFacetValue(
                    taskViewState.filters[facetKey],
                    value,
                    mode,
                    target.checked
                );
            });
        } else {
            return;
        }

        savePersistedTaskView();
        this.renderSubfilter(taskViewState.openFilterCategory);
        this.renderActiveTags();
        refreshTaskView();
    },

    removeTag({ tagKind, facetKey, mode, value, visibilityKey }) {
        if (tagKind === "facet") {
            taskViewState.filters[facetKey] = taskVM.toggleFacetValue(
                taskViewState.filters[facetKey],
                value,
                mode,
                false
            );
        } else if (tagKind === "visibility") {
            taskViewState.visibility[visibilityKey] = false;
            buildTaskFilterOptions();
        } else if (tagKind === "grouping") {
            taskViewState.grouping.dimension = "none";
            this.renderGroupDropdown();
        } else {
            return;
        }

        savePersistedTaskView();
        this.renderSubfilter(taskViewState.openFilterCategory);
        this.renderActiveTags();
        refreshTaskView();
    },

    openCategory(categoryId) {
        taskViewState.openFilterCategory = categoryId;
        document.getElementById("tasks-filter-dropdown")?.classList.add("active");
        document.getElementById("tasks-subfilter-dropdown")?.classList.add("active");
        this.highlightOpenCategory();
        this.renderSubfilter(categoryId);
    },

    highlightOpenCategory() {
        document.querySelectorAll("#tasks-filter-dropdown [data-filter-category]").forEach(button => {
            button.classList.toggle(
                "is-active",
                button.dataset.filterCategory === taskViewState.openFilterCategory
            );
        });
    },

    closeMenus() {
        ["tasks-filter-dropdown", "tasks-subfilter-dropdown", "tasks-group-dropdown"].forEach(elementId => {
            document.getElementById(elementId)?.classList.remove("active");
        });
        document.getElementById("tasks-filter-btn")?.setAttribute("aria-expanded", "false");
        document.getElementById("tasks-group-btn")?.setAttribute("aria-expanded", "false");
        taskViewState.openFilterCategory = null;
        this.highlightOpenCategory();
    },

    renderOptionRow(label, facetKey, value, includeSet, excludeSet) {
        return `
            <div class="ui-subfilter-option">
                <span class="ui-subfilter-option-label">${escapeHtml(label)}</span>
                <span class="ui-subfilter-toggle-group">
                    <label class="ui-subfilter-toggle ui-subfilter-toggle-include" title="Nur „${escapeHtml(label)}“ anzeigen">
                        <input type="checkbox" data-facet-key="${escapeHtml(facetKey)}" data-mode="include" value="${escapeHtml(value)}" ${includeSet.has(value) ? "checked" : ""}>
                        <span aria-hidden="true">✓</span>
                    </label>
                    <label class="ui-subfilter-toggle ui-subfilter-toggle-exclude" title="„${escapeHtml(label)}“ ausschließen">
                        <input type="checkbox" data-facet-key="${escapeHtml(facetKey)}" data-mode="exclude" value="${escapeHtml(value)}" ${excludeSet.has(value) ? "checked" : ""}>
                        <span aria-hidden="true">✕</span>
                    </label>
                </span>
            </div>
        `;
    },

    renderSelectAllRow(facetKey, values, includeSet, excludeSet) {
        const valuesAttr = escapeHtml(JSON.stringify(values));
        const allIncluded = values.every(value => includeSet.has(value));
        const allExcluded = values.every(value => excludeSet.has(value));

        return `
            <div class="ui-subfilter-option ui-subfilter-select-all">
                <span class="ui-subfilter-option-label">Alle</span>
                <span class="ui-subfilter-toggle-group">
                    <label class="ui-subfilter-toggle ui-subfilter-toggle-include" title="Alle anzeigen">
                        <input type="checkbox" data-facet-key="${escapeHtml(facetKey)}" data-mode="include" data-select-all-values='${valuesAttr}' ${allIncluded ? "checked" : ""}>
                        <span aria-hidden="true">✓</span>
                    </label>
                    <label class="ui-subfilter-toggle ui-subfilter-toggle-exclude" title="Alle ausschließen">
                        <input type="checkbox" data-facet-key="${escapeHtml(facetKey)}" data-mode="exclude" data-select-all-values='${valuesAttr}' ${allExcluded ? "checked" : ""}>
                        <span aria-hidden="true">✕</span>
                    </label>
                </span>
            </div>
        `;
    },

    renderSubfilter(categoryId) {
        const subfilter = document.getElementById("tasks-subfilter-dropdown");
        if (!subfilter || !categoryId || !subfilter.classList.contains("active")) {
            return;
        }

        if (categoryId === "visibility") {
            subfilter.innerHTML = TASK_VISIBILITY_OPTIONS.map(option => `
                <label class="ui-subfilter-switch">
                    <input type="checkbox" data-visibility-key="${escapeHtml(option.key)}" ${taskViewState.visibility[option.key] ? "checked" : ""}>
                    <span>${escapeHtml(option.label)}</span>
                </label>
            `).join("");
            return;
        }

        const options = taskViewState.filterOptions[categoryId] || [];
        if (!options.length) {
            subfilter.innerHTML = `<span class="ui-subfilter-empty">Keine Werte vorhanden</span>`;
            return;
        }

        const facet = taskViewState.filters[categoryId] || taskVM.createFacet();
        const includeSet = new Set(facet.include);
        const excludeSet = new Set(facet.exclude);

        subfilter.innerHTML =
            this.renderSelectAllRow(categoryId, options.map(option => option.value), includeSet, excludeSet) +
            options.map(option => this.renderOptionRow(
                option.label,
                categoryId,
                option.value,
                includeSet,
                excludeSet
            )).join("");
    },

    getFacetOptionLabel(facetKey, value) {
        return taskViewState.filterOptions[facetKey]?.find(option => option.value === value)?.label || value;
    },

    collectTags() {
        const tags = [];

        taskVM.TASK_FACET_KEYS.forEach(facetKey => {
            const facet = taskViewState.filters[facetKey] || taskVM.createFacet();

            facet.include.forEach(value => tags.push({
                tagKind: "facet",
                facetKey,
                mode: "include",
                value,
                label: this.getFacetOptionLabel(facetKey, value)
            }));
            facet.exclude.forEach(value => tags.push({
                tagKind: "facet",
                facetKey,
                mode: "exclude",
                value,
                excluded: true,
                label: `Kein ${this.getFacetOptionLabel(facetKey, value)}`
            }));
        });

        TASK_VISIBILITY_OPTIONS.forEach(option => {
            if (taskViewState.visibility[option.key]) {
                tags.push({ tagKind: "visibility", visibilityKey: option.key, label: option.tagLabel });
            }
        });

        return tags;
    },

    renderActiveTags() {
        const dimension = taskVM.getGroupDimension(taskViewState.grouping.dimension);
        const isGrouped = taskVM.isGroupingActive(dimension.id);
        const filterTags = this.collectTags();
        const tags = isGrouped
            ? [...filterTags, { tagKind: "grouping", grouping: true, label: `Gruppiert: ${dimension.label}` }]
            : filterTags;

        document.getElementById("tasks-filter-btn")?.classList.toggle("is-active", filterTags.length > 0);
        document.getElementById("tasks-group-btn")?.classList.toggle("is-active", isGrouped);

        const container = document.getElementById("tasks-active-filters");
        if (!container) {
            return;
        }

        container.innerHTML = tags.map(tag => `
            <div class="ui-filter-tag${tag.excluded ? " is-excluded" : ""}${tag.grouping ? " is-grouping" : ""}">
                <span>${escapeHtml(tag.label)}</span>
                <button
                    type="button"
                    data-tag-kind="${escapeHtml(tag.tagKind)}"
                    data-facet-key="${escapeHtml(tag.facetKey || "")}"
                    data-mode="${escapeHtml(tag.mode || "")}"
                    data-value="${escapeHtml(tag.value || "")}"
                    data-visibility-key="${escapeHtml(tag.visibilityKey || "")}"
                    aria-label="${escapeHtml(tag.label)} entfernen"
                >&times;</button>
            </div>
        `).join("");
    },

    syncControls() {
        const searchInput = document.getElementById("tasks-search-input");
        if (searchInput) {
            searchInput.value = taskViewState.search;
        }

        this.renderGroupDropdown();
        this.highlightOpenCategory();
        this.renderSubfilter(taskViewState.openFilterCategory);
        this.renderActiveTags();
    }
};

function initTaskFilters() {
    taskFilterBar.init();
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
    refreshTaskView();
}

async function loadInitialTaskData() {
    await Promise.all([
        loadTaskBacklogs(),
        loadTasks()
    ]);
}

function countBadgeRelevantTasks(tasks) {
    return tasks.filter(task => !isDeferredTask(task) && !isEventHandlingTask(task)).length;
}

async function loadTasks() {
    try {
        const res = await fetch("/api/tasks/overview");
        const data = await res.json();

        const openTasks = decorateTasks(Array.isArray(data.open_tasks) ? data.open_tasks : [], "open");
        const blockedTasks = decorateTasks(Array.isArray(data.blocked_tasks) ? data.blocked_tasks : [], "blocked");
        const myTasks = decorateTasks(Array.isArray(data.user_tasks) ? data.user_tasks : [], "mine");

        taskViewState.buckets = {
            open: openTasks,
            blocked: blockedTasks,
            mine: myTasks
        };

        // Gleiche Regel wie GET /sofa/me -> task_count: offene plus eigene Aufgaben,
        // ohne Nachlieferungen und ohne EVENT-Handling. Blockierte zaehlen ohnehin nicht mit.
        // Bewusst auf den rohen Buckets - Suche, Dropdowns und die Sichtbarkeits-Haken
        // duerfen die Badge nie veraendern.
        window.sofaSetTaskCountBadge?.(
            countBadgeRelevantTasks(openTasks) + countBadgeRelevantTasks(myTasks)
        );

        buildTaskFilterOptions();
        syncTaskFilterControls();

        window.taskIndex = {};
        [...openTasks, ...blockedTasks, ...myTasks].forEach(task => {
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
