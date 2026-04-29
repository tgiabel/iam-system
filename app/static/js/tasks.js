if (!window.taskOverlayInitialized) {
    document.addEventListener("DOMContentLoaded", () => {
        initTabs();
        initTaskOverlay();
        initMailDialog();
        initTaskActionHandling();
        initTaskFilters();
        loadTasks();
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
        EXTERNAL: "Extern",
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
        BOT_RESPONSE: "Bot-Antwort",
        MAIL_SENT: "E-Mail versendet"
    },
    processes: {
        SKILL_ASSIGNMENT: "Rollenzuweisung",
        SKILL_REMOVAL: "Rollenentzug",
        TEMPORARY_ROLE: "Temporäre Rolle",
        ONBOARDING: "Onboarding",
        OFFBOARDING: "Offboarding",
        CHANGE: "Abteilungswechsel"
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
    taskType: ""
};

const taskViewState = {
    filters: { ...TASK_FILTER_DEFAULTS },
    filterOptions: {
        status: [],
        handling: [],
        taskType: []
    },
    buckets: {
        open: [],
        blocked: [],
        mine: [],
        completed: []
    }
};

const processViewState = {
    loaded: false,
    loading: false,
    error: null,
    data: {
        running_processes: [],
        completed_processes: []
    }
};

const api = {
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

    async sendMail(mailToSend) {
        try {
            const payload = {
                Absender: "test@servodata.de",
                EmpfängerTo: mailToSend.recipient,
                EmpfängerCC: mailToSend.cc || "",
                EmpfängerBCC: mailToSend.bcc || "",
                Betreff: mailToSend.subject,
                Mailtext: mailToSend.body,
                Html: 0
            };

            const res = await fetch("/api/mail/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
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

            showFlash("Bot erfolgreich dispatched", "success");
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
        "Alle Status",
        taskViewState.filters.status
    );
    populateFilterSelect(
        "tasks-handling-filter",
        taskViewState.filterOptions.handling,
        "Alle Handling-Typen",
        taskViewState.filters.handling
    );
    populateFilterSelect(
        "tasks-type-filter",
        taskViewState.filterOptions.taskType,
        "Alle Task-Typen",
        taskViewState.filters.taskType
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
    const assignedTo = task.assigned_to_user_name || task.assigned_to_name || "-";
    const kickerLabel = formatTaskModalSubtitle(task);

    return `
        <a href="#" class="task-tile task-card ${getTaskStateClass(task)}" data-task-id="${escapeHtml(task.task_id)}">
            <div class="task-card-top">
                <div class="task-card-heading">
                    <span class="task-card-kicker">${escapeHtml(kickerLabel)}</span>
                    <h3 class="task-card-title">${escapeHtml(formatTaskType(task.task_type))}</h3>
                </div>
                <div class="task-card-chips">
                    <span class="ui-chip ${getHandlingChipClass(task.handling_type)}">${escapeHtml(formatHandlingType(task.handling_type))}</span>
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
                        <span>Bearbeitet von</span>
                        <span>${escapeHtml(assignedTo)}</span>
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
                Diese Aufgabe wird aktuell bereits bearbeitet. Verlauf und Stammdaten bleiben weiterhin sichtbar.
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
        actionsEl.append(createActionButton("Extern beauftragen", "external", "secondary"));
    }

    if (task.handling_type === "BOT") {
        actionsEl.append(createActionButton("Bot beauftragen", "bot", "secondary"));
    }

    actionsEl.append(createActionButton("Erledigt", "complete", "primary", "task-complete-btn"));
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
                <td>${escapeHtml(entry.user_id || "-")}</td>
                <td>${escapeHtml(details)}</td>
            </tr>
        `;
    }).join("");
}

async function openTaskOverlay(task) {
    window.currentTask = task;
    populateTaskModal(task);
    renderTaskActions(task);
    setHistoryExpanded(false);

    const historyBody = document.getElementById("task-history-body");
    if (historyBody) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="4" class="history-empty-cell">Lade Verlauf...</td>
            </tr>
        `;
    }

    openOverlay("task-overlay");

    try {
        const res = await fetch(`/api/tasks/${task.task_id}/history`);
        if (!res.ok) {
            throw new Error("History failed");
        }

        const historyData = await res.json();
        renderHistoryEntries(historyData);
    } catch (err) {
        console.error("History Error:", err);
        if (historyBody) {
            historyBody.innerHTML = `
                <tr>
                    <td colspan="4" class="history-empty-cell history-error-cell">Fehler beim Laden des Verlaufs</td>
                </tr>
            `;
        }
    }
}

function initTabs() {
    const tabs = document.querySelectorAll(".tasks-tab");
    const tabPanels = document.querySelectorAll(".tasks-tab-panel");

    function activateTab(target) {
        tabs.forEach(item => {
            const isActive = item.dataset.tab === target;
            item.classList.toggle("active", isActive);
            item.setAttribute("aria-selected", String(isActive));
        });

        tabPanels.forEach(panel => {
            const isActive = panel.id === `tab-${target}`;
            panel.classList.toggle("active", isActive);
            panel.setAttribute("aria-hidden", String(!isActive));
        });

        if (target === "prozesse") {
            loadProcesses();
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            activateTab(tab.dataset.tab);
        });
    });

    const initiallyActive = document.querySelector(".tasks-tab.active")?.dataset.tab || "aufgaben";
    activateTab(initiallyActive);
}

function initTaskOverlay() {
    const historyToggle = document.getElementById("history-toggle");
    historyToggle?.addEventListener("click", () => {
        const container = document.getElementById("history-container");
        setHistoryExpanded(!container?.classList.contains("open"));
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
                const res = await fetch(`/api/tasks/${task.task_id}/assign?user_id=${window.currentUserId}`, {
                    method: "PATCH"
                });

                if (!res.ok) {
                    if (res.status === 409) {
                        showFlash("Task wurde bereits übernommen", "failure");
                        await loadTasks();
                        return;
                    }

                    throw new Error("Assign fehlgeschlagen");
                }

                showFlash("Task erfolgreich übernommen");
                await res.json();
                closeOverlay("task-overlay");
                await loadTasks();
            } catch (err) {
                console.error(err);
                alert("Fehler beim Übernehmen des Tasks.");
            }
        }

        if (action === "release") {
            try {
                const res = await fetch(`/api/tasks/${task.task_id}/assign`, {
                    method: "DELETE"
                });

                if (!res.ok) {
                    const err = await res.json();
                    showFlash(err.detail || "Fehler beim Freigeben", "failure");
                    throw new Error(err.detail || "API Error");
                }

                await res.json();
                showFlash("Task erfolgreich freigegeben");
                closeOverlay("task-overlay");
                await loadTasks();
            } catch (err) {
                console.error("Release Task Error:", err);
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
            subject: subjectInput.value.trim(),
            body: bodyInput.value.trim(),
            task_id: task.task_id
        };

        if (!mailToSend.recipient || !mailToSend.subject || !mailToSend.body) {
            showFlash("Bitte Empfänger, Betreff und Nachricht ausfüllen!", "failure");
            return;
        }

        try {
            const result = await api.sendMail(mailToSend);
            if (result) {
                closeOverlay("mail-dialog-overlay");
            }
        } catch (err) {
            console.error("Fehler beim Senden der Mail:", err);
            showFlash("Fehler beim Senden der E-Mail. Bitte erneut versuchen.", "failure");
        }
    };
}

async function dispatchBot(task) {
    try {
        const historyRes = await fetch(`/api/tasks/${task.task_id}/history`);
        if (!historyRes.ok) {
            showFlash("Fehler beim Laden der History", "failure");
            return;
        }

        const history = await historyRes.json();
        const hasSuccessfulBotResponse = history.some(entry => {
            if (entry.action !== "BOT_RESPONSE" || !entry.details) {
                return false;
            }

            try {
                return JSON.parse(entry.details).status === "success";
            } catch (err) {
                return false;
            }
        });

        if (hasSuccessfulBotResponse) {
            showFlash("Bot wurde bereits erfolgreich ausgeführt. Bitte prüfen Sie den Verlauf.", "info");
            return;
        }

        const result = await api.dispatchBot(task.task_id);
        if (!result) {
            return;
        }

        closeOverlay("task-overlay");
        await loadTasks();
    } catch (err) {
        console.error("Bot Dispatch Error:", err);
        showFlash("Fehler beim Dispatchen des Bots", "failure");
    }
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
    const name = firstDefinedValue(process, PROCESS_KEYS.name);
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

function renderProcessStateRow(bodyId, message, variant = "empty") {
    const body = document.getElementById(bodyId);
    if (!body) {
        return;
    }

    const stateClass = variant === "error"
        ? "process-state-row process-state-error"
        : "process-state-row";

    body.innerHTML = `
        <tr class="${stateClass}">
            <td colspan="6">
                <div class="ui-empty-state ui-empty-inline">${escapeHtml(message)}</div>
            </td>
        </tr>
    `;
}

function renderProcessTable(bodyId, processes, isCompleted) {
    const body = document.getElementById(bodyId);
    if (!body) {
        return;
    }

    if (!processes.length) {
        renderProcessStateRow(
            bodyId,
            isCompleted ? "Keine abgeschlossenen Prozesse vorhanden." : "Keine laufenden Prozesse vorhanden."
        );
        return;
    }

    body.innerHTML = processes.map(process => renderProcessRow(process, isCompleted)).join("");
}

function renderProcessTables(data) {
    const { running, completed } = extractProcessBuckets(data);
    renderProcessTable("running-processes-body", running, false);
    renderProcessTable("completed-processes-body", completed, true);
}

function renderProcessLoadingState() {
    renderProcessStateRow("running-processes-body", "Lade laufende Prozesse...", "loading");
    renderProcessStateRow("completed-processes-body", "Lade abgeschlossene Prozesse...", "loading");
}

function renderProcessErrorState(message) {
    renderProcessStateRow("running-processes-body", message, "error");
    renderProcessStateRow("completed-processes-body", message, "error");
}

async function loadProcesses(forceReload = false) {
    if (processViewState.loading) {
        return;
    }

    if (processViewState.loaded && !forceReload) {
        renderProcessTables(processViewState.data);
        return;
    }

    processViewState.loading = true;
    processViewState.error = null;
    renderProcessLoadingState();

    try {
        const res = await fetch("/api/processes/overview");
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || data.error || "Fehler beim Laden der Prozesse.");
        }

        processViewState.loaded = true;
        processViewState.data = data;
        renderProcessTables(processViewState.data);
    } catch (err) {
        processViewState.error = err;
        console.error("Prozess-Ladefehler:", err);
        renderProcessErrorState("Prozessübersicht konnte nicht geladen werden.");
    } finally {
        processViewState.loading = false;
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
    renderTaskBuckets(filteredBuckets);

    const visibleCount = Object.values(filteredBuckets).reduce((sum, tasks) => sum + tasks.length, 0);
    const totalCount = Object.values(taskViewState.buckets).reduce((sum, tasks) => sum + tasks.length, 0);
    updateTaskFilterSummary(visibleCount, totalCount);
}

function initTaskFilters() {
    const searchInput = document.getElementById("tasks-search-input");
    const statusFilter = document.getElementById("tasks-status-filter");
    const handlingFilter = document.getElementById("tasks-handling-filter");
    const typeFilter = document.getElementById("tasks-type-filter");
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
    } catch (err) {
        console.error("Task-Ladefehler:", err);
        showFlash("Fehler beim Laden der Aufgaben. Siehe Konsole.", "failure");
    }
}
