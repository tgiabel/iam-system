const state = {
    roles: [],
    roleMap: new Map(),
    latestReport: null,
    latestPayload: null,
    processes: [
        { id: "OFFBOARDING", name: "Offboarding" },
        { id: "TEMPORARY_ROLE", name: "Temporäre Rolle" },
        { id: "SKILL_REMOVAL", name: "Rollenentzug" }
    ]
};

const DOM = {};

const api = {
    async getRoles() {
        if (state.roles.length > 0) {
            return state.roles;
        }

        const response = await fetch("/api/roles/map");
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Rollen konnten nicht geladen werden");
        }

        state.roles = Object.entries(data).map(([roleId, role]) => ({
            role_id: roleId,
            name: role.name,
            type: role.type
        }));
        state.roleMap = new Map(state.roles.map(role => [String(role.role_id), role]));
        return state.roles;
    },

    async startProcessReport(payload) {
        const response = await fetch("/api/processes/iks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || data.detail || "Prozessbericht konnte nicht geladen werden");
        }

        return data;
    },

    async startRoleReport(_payload) {
        throw new Error("Rollen-Bericht ist noch nicht verdrahtet.");
    }
};

const dateUtils = {
    toInputValue(date) {
        return date.toISOString().split("T")[0];
    },

    formatDateTime(value) {
        if (!value) {
            return "-";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat("de-DE", {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
    },

    getRangeForPreset(presetValue) {
        const today = new Date();

        switch (presetValue) {
            case "last_month":
                return this.getLastMonthRange(today);
            case "last_quarter":
                return this.getLastQuarterRange(today);
            case "this_year":
                return {
                    from: new Date(today.getFullYear(), 0, 1),
                    to: today
                };
            case "last_year":
                return {
                    from: new Date(today.getFullYear() - 1, 0, 1),
                    to: new Date(today.getFullYear() - 1, 11, 31)
                };
            default:
                return null;
        }
    },

    getLastMonthRange(referenceDate) {
        return {
            from: new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1),
            to: new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0)
        };
    },

    getLastQuarterRange(referenceDate) {
        const currentQuarter = Math.floor(referenceDate.getMonth() / 3);
        const targetQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
        const yearOffset = currentQuarter === 0 ? -1 : 0;
        const year = referenceDate.getFullYear() + yearOffset;
        const startMonth = targetQuarter * 3;

        return {
            from: new Date(year, startMonth, 1),
            to: new Date(year, startMonth + 3, 0)
        };
    }
};

const formatters = {
    humanizeKey(value) {
        return String(value || "")
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, character => character.toUpperCase());
    },

    humanizeProcessType(value) {
        const process = state.processes.find(item => item.id === value);
        return process?.name || this.humanizeKey(value);
    },

    statusClass(status) {
        const normalized = String(status || "").toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
        return normalized ? `status-${normalized}` : "";
    },

    statusLabel(status) {
        return this.humanizeKey(status || "-");
    },

    value(value) {
        if (value === null || value === undefined || value === "") {
            return "-";
        }

        if (typeof value === "string" && value.includes("T")) {
            return dateUtils.formatDateTime(value);
        }

        return String(value);
    },

    filenameBase() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        return `iks-report-${timestamp}`;
    }
};

const ui = {
    cacheDom() {
        DOM.form = document.getElementById("reportForm");
        DOM.selection = document.getElementById("selection");
        DOM.selectionLabel = document.getElementById("selectionLabel");
        DOM.selectedRoleId = document.getElementById("selectedRoleId");
        DOM.radios = document.querySelectorAll('input[name="type"]');
        DOM.preset = document.getElementById("preset");
        DOM.fromDate = document.getElementById("fromDate");
        DOM.toDate = document.getElementById("toDate");
        DOM.submitButton = DOM.form?.querySelector('button[type="submit"]');
        DOM.reportSection = document.getElementById("reportSection");
        DOM.reportTitle = document.getElementById("reportTitle");
        DOM.reportMeta = document.getElementById("reportMeta");
        DOM.reportContent = document.getElementById("reportContent");
        DOM.downloadHtmlButton = document.getElementById("downloadHtmlButton");
        DOM.downloadJsonButton = document.getElementById("downloadJsonButton");
    },

    setLoadingState(isLoading) {
        if (DOM.submitButton) {
            DOM.submitButton.disabled = isLoading;
            DOM.submitButton.textContent = isLoading ? "Bericht wird geladen..." : "Bericht generieren";
        }

        if (!DOM.selection) {
            return;
        }

        if (isLoading) {
            DOM.selection.disabled = true;
            return;
        }

        const selectedType = this.getSelectedType();
        const hasItems = selectedType === "role" ? state.roles.length > 0 : state.processes.length > 0;
        DOM.selection.disabled = !hasItems;
    },

    getSelectedType() {
        return document.querySelector('input[name="type"]:checked')?.value || "role";
    },

    populateSelection(type) {
        if (!DOM.selection) {
            return;
        }

        const items = type === "role" ? state.roles : state.processes;
        DOM.selection.innerHTML = "";

        if (!items.length) {
            DOM.selectionLabel.textContent = type === "role" ? "Rolle" : "Prozess";
            const option = document.createElement("option");
            option.value = "";
            option.textContent = type === "role" ? "Keine Rollen verfügbar" : "Keine Prozesse verfügbar";
            DOM.selection.appendChild(option);
            DOM.selection.disabled = true;
            this.syncHiddenFields(type);
            return;
        }

        DOM.selection.disabled = false;

        items.forEach(item => {
            const option = document.createElement("option");
            option.value = String(item.role_id ?? item.id);
            option.textContent = item.name;
            DOM.selection.appendChild(option);
        });

        DOM.selectionLabel.textContent = type === "role" ? "Rolle" : "Prozess";
        this.syncHiddenFields(type);
    },

    syncHiddenFields(type) {
        if (!DOM.selectedRoleId) {
            return;
        }

        DOM.selectedRoleId.value = type === "role" ? DOM.selection.value : "";
    },

    applyPreset() {
        const range = dateUtils.getRangeForPreset(DOM.preset.value);

        if (!range) {
            return;
        }

        DOM.fromDate.value = dateUtils.toInputValue(range.from);
        DOM.toDate.value = dateUtils.toInputValue(range.to);
    },

    getFormData() {
        const type = this.getSelectedType();
        const selectedId = DOM.selection.value;
        const role = state.roleMap.get(selectedId);
        const process = state.processes.find(item => String(item.id) === selectedId);

        return {
            type,
            selection_id: selectedId,
            selection_name: role?.name || process?.name || "",
            role_id: type === "role" ? selectedId : null,
            from: DOM.fromDate.value,
            to: DOM.toDate.value
        };
    },

    renderReport(report, requestPayload) {
        state.latestReport = report;
        state.latestPayload = requestPayload;

        DOM.reportSection.hidden = false;
        DOM.reportTitle.textContent = report.info || `IKS Bericht für ${requestPayload.selection_name}`;
        DOM.reportMeta.innerHTML = "";
        DOM.reportContent.innerHTML = "";

        const metaItems = [
            { label: "Info", value: report.info || "-" },
            { label: "Erstellt am", value: dateUtils.formatDateTime(report.generated_at) },
            { label: "Erstellt von", value: report.generated_by ?? "-" },
            { label: "Auswahl", value: requestPayload.selection_name || requestPayload.selection_id },
            { label: "Zeitraum", value: `${requestPayload.from} bis ${requestPayload.to}` },
            { label: "Anzahl Prozesse", value: Array.isArray(report.processes) ? report.processes.length : 0 }
        ];

        metaItems.forEach(item => {
            const card = document.createElement("div");
            card.className = "report-meta-item";
            card.innerHTML = `
                <span class="report-meta-label">${item.label}</span>
                <span class="report-meta-value">${item.value}</span>
            `;
            DOM.reportMeta.appendChild(card);
        });

        if (!Array.isArray(report.processes) || report.processes.length === 0) {
            DOM.reportContent.innerHTML = `<div class="empty-state">Für den gewählten Zeitraum wurden keine Prozesse gefunden.</div>`;
            return;
        }

        report.processes.forEach((process, index) => {
            const processCard = document.createElement("article");
            processCard.className = "process-card";

            const tasks = Array.isArray(process.tasks) ? process.tasks : [];
            const isOpen = index === 0;

            processCard.innerHTML = `
                <button type="button" class="process-toggle" aria-expanded="${isOpen}" data-process-toggle>
                    <div class="process-main">
                        <span class="process-title">${formatters.humanizeProcessType(process.process_type)} · #${process.process_id}</span>
                        <span class="process-subtitle">User ${formatters.value(process.user_id)} · gestartet ${formatters.value(process.started_at)}</span>
                    </div>
                    <div class="process-summary">
                        <span>${tasks.length} Tasks</span>
                        <span>${process.completed_at ? `abgeschlossen ${formatters.value(process.completed_at)}` : "noch offen"}</span>
                        <span class="process-chevron">▾</span>
                    </div>
                </button>
                <div class="process-body" ${isOpen ? "" : "hidden"}>
                    ${this.createTaskStrip(tasks)}
                </div>
            `;

            if (isOpen) {
                processCard.classList.add("open");
            }

            DOM.reportContent.appendChild(processCard);
        });
    },

    createTaskStrip(tasks) {
        if (!tasks.length) {
            return `<div class="empty-state">Zu diesem Prozess liegen keine Tasks vor.</div>`;
        }

        const taskCards = tasks.map(task => {
            const rows = Object.entries(task).map(([key, value]) => `
                <div class="task-row">
                    <span class="task-key">${formatters.humanizeKey(key)}</span>
                    <span class="task-value">${formatters.value(value)}</span>
                </div>
            `).join("");

            return `
                <article class="task-card ${formatters.statusClass(task.status)}">
                    <div class="task-title">Task #${formatters.value(task.task_id)} · ${formatters.statusLabel(task.status)}</div>
                    <div class="task-grid">${rows}</div>
                </article>
            `;
        }).join("");

        return `<div class="task-strip">${taskCards}</div>`;
    }
};

const exporter = {
    download(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    },

    downloadJson() {
        if (!state.latestReport) {
            return;
        }

        this.download(
            `${formatters.filenameBase()}.json`,
            JSON.stringify(state.latestReport, null, 2),
            "application/json"
        );
    },

    downloadHtml() {
        if (!state.latestReport) {
            return;
        }

        const title = DOM.reportTitle?.textContent || "IKS Bericht";
        const meta = DOM.reportMeta?.innerHTML || "";
        const content = this.buildExpandedHtmlContent();

        const documentHtml = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 32px; color: #1f2f40; background: #f7faff; }
        h1 { margin-bottom: 24px; }
        .report-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .report-meta-item, .process-card, .task-card { background: #fff; border: 1px solid #d7e4f2; border-radius: 12px; }
        .report-meta-item { padding: 14px; }
        .report-meta-label { display: block; font-size: 12px; text-transform: uppercase; color: #6c819b; margin-bottom: 6px; }
        .report-meta-value { font-weight: 600; }
        .process-card { padding: 18px; margin-bottom: 18px; }
        .process-title { font-size: 18px; font-weight: 700; }
        .process-subtitle, .process-summary { color: #5f7389; margin-top: 6px; }
        .task-strip { display: flex; gap: 12px; overflow-x: auto; padding-top: 16px; }
        .task-card { min-width: 260px; padding: 14px; border-width: 2px; }
        .status-open { border-color: #f0a93b; }
        .status-completed { border-color: #49a56b; }
        .status-failed, .status-cancelled { border-color: #d46868; }
        .status-in-progress { border-color: #4f8bd6; }
        .task-title { font-weight: 700; margin-bottom: 10px; }
        .task-row { margin-bottom: 8px; }
        .task-key { display: block; font-size: 12px; text-transform: uppercase; color: #698097; margin-bottom: 2px; }
        .empty-state { padding: 18px; background: #fff; border: 1px dashed #c7d7ea; border-radius: 12px; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <section class="report-meta">${meta}</section>
    <section>${content}</section>
</body>
</html>`;

        this.download(`${formatters.filenameBase()}.html`, documentHtml, "text/html");
    },

    buildExpandedHtmlContent() {
        if (!state.latestReport || !Array.isArray(state.latestReport.processes) || state.latestReport.processes.length === 0) {
            return `<div class="empty-state">Für den gewählten Zeitraum wurden keine Prozesse gefunden.</div>`;
        }

        return state.latestReport.processes.map(process => {
            const tasks = Array.isArray(process.tasks) ? process.tasks : [];

            return `
                <article class="process-card">
                    <div class="process-title">${formatters.humanizeProcessType(process.process_type)} · #${process.process_id}</div>
                    <div class="process-subtitle">User ${formatters.value(process.user_id)} · gestartet ${formatters.value(process.started_at)}</div>
                    <div class="process-summary">
                        ${tasks.length} Tasks · ${process.completed_at ? `abgeschlossen ${formatters.value(process.completed_at)}` : "noch offen"}
                    </div>
                    ${ui.createTaskStrip(tasks)}
                </article>
            `;
        }).join("");
    }
};

const controller = {
    async init() {
        ui.cacheDom();
        this.bindEvents();
        ui.setLoadingState(true);

        try {
            await api.getRoles();
        } catch (error) {
            console.error("Fehler beim Laden der Rollen", error);
            if (typeof showFlash === "function") {
                showFlash(error.message || "Fehler beim Laden der Rollen", "failure");
            }
        } finally {
            ui.populateSelection(ui.getSelectedType());
            ui.setLoadingState(false);
        }
    },

    bindEvents() {
        DOM.radios.forEach(radio => {
            radio.addEventListener("change", event => {
                ui.populateSelection(event.target.value);
            });
        });

        DOM.selection.addEventListener("change", () => {
            ui.syncHiddenFields(ui.getSelectedType());
        });

        DOM.preset.addEventListener("change", () => {
            ui.applyPreset();
        });

        DOM.form.addEventListener("submit", event => {
            event.preventDefault();
            this.handleSubmit();
        });

        DOM.reportContent.addEventListener("click", event => {
            const toggle = event.target.closest("[data-process-toggle]");
            if (!toggle) {
                return;
            }

            const card = toggle.closest(".process-card");
            const body = card?.querySelector(".process-body");
            const isOpen = toggle.getAttribute("aria-expanded") === "true";

            toggle.setAttribute("aria-expanded", String(!isOpen));
            card?.classList.toggle("open", !isOpen);
            if (body) {
                body.hidden = isOpen;
            }
        });

        DOM.downloadJsonButton.addEventListener("click", () => {
            exporter.downloadJson();
        });

        DOM.downloadHtmlButton.addEventListener("click", () => {
            exporter.downloadHtml();
        });
    },

    async handleSubmit() {
        const payload = ui.getFormData();

        if (!payload.selection_id) {
            if (typeof showFlash === "function") {
                showFlash("Bitte eine Auswahl treffen.", "failure");
            }
            return;
        }

        if (!payload.from || !payload.to) {
            if (typeof showFlash === "function") {
                showFlash("Bitte einen vollständigen Zeitraum wählen.", "failure");
            }
            return;
        }

        if (payload.from > payload.to) {
            if (typeof showFlash === "function") {
                showFlash("Das Startdatum darf nicht nach dem Enddatum liegen.", "failure");
            }
            return;
        }

        ui.setLoadingState(true);

        try {
            let report;

            if (payload.type === "process") {
                report = await api.startProcessReport({
                    process_type: payload.selection_id,
                    start_data: payload.from,
                    end_date: payload.to
                });
            } else {
                report = await api.startRoleReport(payload);
            }

            ui.renderReport(report, payload);
            DOM.reportSection.scrollIntoView({ behavior: "smooth", block: "start" });

            if (typeof showFlash === "function") {
                showFlash("Bericht erfolgreich geladen.", "success");
            }
        } catch (error) {
            console.error("Fehler beim Laden des IKS-Berichts", error);
            if (typeof showFlash === "function") {
                showFlash(error.message || "Bericht konnte nicht generiert werden.", "failure");
            }
        } finally {
            ui.setLoadingState(false);
        }
    }
};

document.addEventListener("DOMContentLoaded", () => {
    controller.init();
});
