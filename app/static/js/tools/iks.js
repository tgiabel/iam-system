(function () {
    "use strict";

    const REPORT_TYPES = Object.freeze(["process", "role", "system"]);
    const EXPORT_FORMATS = Object.freeze(["html", "csv", "json"]);
    const ALL_PROCESSES_VALUE = "__all_process_types__";
    const REPORT_TIMEZONE = "Europe/Berlin";

    const state = {
        catalog: { process_types: [], roles: [], systems: [] },
        report: null,
        loading: false
    };

    const DOM = {};

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function valueOrDash(value) {
        return value === null || value === undefined || value === "" ? "-" : String(value);
    }

    function labelOf(value, fallback = "-") {
        if (isObject(value)) {
            return value.name || value.label || value.display_name || fallback;
        }
        return value === null || value === undefined || value === "" ? fallback : String(value);
    }

    function statusCodeOf(value, fallback = "neutral") {
        const raw = isObject(value) ? (value.code || value.status || value.value) : value;
        return String(raw || fallback)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/_/g, "-")
            .replace(/^-+|-+$/g, "") || fallback;
    }

    function statusLabelOf(record, key = "status") {
        if (!record) return "-";
        const value = record[key];
        if (isObject(value)) return labelOf(value);
        return record[`${key}_label`] || valueOrDash(value);
    }

    function statusBadge(value, label) {
        return `<span class="iks-status-badge is-${escapeHtml(statusCodeOf(value))}">${escapeHtml(label || labelOf(value))}</span>`;
    }

    function formatDateTime(value) {
        if (!value) return "-";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("de-DE", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: REPORT_TIMEZONE
        }).format(date);
    }

    function formatDate(value) {
        if (!value) return "-";
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
            ? new Date(`${value}T12:00:00`)
            : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("de-DE", {
            dateStyle: "medium",
            timeZone: REPORT_TIMEZONE
        }).format(date);
    }

    function toDateInputValue(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getPresetRange(preset, reference = new Date()) {
        if (preset === "last_month") {
            return {
                from: new Date(reference.getFullYear(), reference.getMonth() - 1, 1),
                to: new Date(reference.getFullYear(), reference.getMonth(), 0)
            };
        }
        if (preset === "last_quarter") {
            const currentQuarterStart = Math.floor(reference.getMonth() / 3) * 3;
            return {
                from: new Date(reference.getFullYear(), currentQuarterStart - 3, 1),
                to: new Date(reference.getFullYear(), currentQuarterStart, 0)
            };
        }
        if (preset === "this_year") {
            return { from: new Date(reference.getFullYear(), 0, 1), to: reference };
        }
        if (preset === "last_year") {
            return {
                from: new Date(reference.getFullYear() - 1, 0, 1),
                to: new Date(reference.getFullYear() - 1, 11, 31)
            };
        }
        return null;
    }

    function showMessage(message, type = "failure") {
        if (typeof window.showFlash === "function") {
            window.showFlash(message, type);
        }
    }

    async function readJsonResponse(response) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = isObject(data.detail) ? data.detail.message : data.detail;
            throw new Error(detail || data.error || `Anfrage fehlgeschlagen (${response.status})`);
        }
        return data;
    }

    const api = {
        async getCatalog() {
            return readJsonResponse(await fetch("/api/iks/catalog", {
                headers: { "Accept": "application/json" }
            }));
        },

        async createReport(payload) {
            return readJsonResponse(await fetch("/api/iks/reports", {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }));
        }
    };

    function cacheDom() {
        DOM.form = document.getElementById("iks-report-form");
        DOM.typeInputs = document.querySelectorAll('input[name="report_type"]');
        DOM.targetSearch = document.getElementById("iks-target-search");
        DOM.targetSelect = document.getElementById("iks-target-select");
        DOM.targetLabel = document.getElementById("iks-target-label");
        DOM.targetHelp = document.getElementById("iks-target-help");
        DOM.catalogStatus = document.getElementById("iks-catalog-status");
        DOM.preset = document.getElementById("iks-period-preset");
        DOM.from = document.getElementById("iks-period-from");
        DOM.to = document.getElementById("iks-period-to");
        DOM.submit = document.getElementById("iks-submit");
        DOM.report = document.getElementById("iks-report");
        DOM.reportTitle = document.getElementById("iks-report-title");
        DOM.reportSubtitle = document.getElementById("iks-report-subtitle");
        DOM.meta = document.getElementById("iks-report-meta");
        DOM.assessment = document.getElementById("iks-assessment");
        DOM.kpis = document.getElementById("iks-kpis");
        DOM.dataQuality = document.getElementById("iks-data-quality");
        DOM.findings = document.getElementById("iks-findings");
        DOM.findingsCount = document.getElementById("iks-findings-count");
        DOM.details = document.getElementById("iks-report-details");
        DOM.technical = document.getElementById("iks-technical-content");
        DOM.exportButtons = document.querySelectorAll("[data-iks-export]");
        DOM.contractError = document.getElementById("iks-contract-error");
        DOM.contractErrorMessage = document.getElementById("iks-contract-error-message");
    }

    function getReportType() {
        return document.querySelector('input[name="report_type"]:checked')?.value || null;
    }

    function getCatalogItems(type) {
        if (type === "role") return state.catalog.roles;
        if (type === "system") return state.catalog.systems;
        return state.catalog.process_types;
    }

    function getTargetConfiguration(type) {
        if (type === "role") {
            return {
                label: "Rolle",
                help: "Eine Rolle für Zuweisungs- und Paketkontrolle auswählen.",
                placeholder: "Rolle suchen …"
            };
        }
        if (type === "system") {
            return {
                label: "System",
                help: "Ein System für den Soll-/Ist-Vergleich auswählen.",
                placeholder: "System suchen …"
            };
        }
        return {
            label: "Prozessart",
            help: "Eine Prozessart oder alle Prozessarten auswählen.",
            placeholder: "Prozessart suchen …"
        };
    }

    function catalogItemSecondary(item, type) {
        if (type === "role") {
            return item.type_label || labelOf(item.type, "") || item.status_label || "";
        }
        if (type === "system") {
            return item.short_name || item.status_label || "";
        }
        return item.description || "";
    }

    function renderTargetOptions({ reset = false } = {}) {
        const type = getReportType();
        if (!type) {
            DOM.targetLabel.textContent = "Kontrollobjekt";
            DOM.targetHelp.textContent = "Für keine Kontrollart liegt eine IKS-Berechtigung vor.";
            DOM.targetSearch.value = "";
            DOM.targetSearch.placeholder = "Keine Kontrollart verfügbar";
            DOM.targetSearch.disabled = true;
            DOM.targetSelect.innerHTML = '<option value="">Keine Kontrollart verfügbar</option>';
            DOM.targetSelect.disabled = true;
            DOM.catalogStatus.textContent = "Benötigt wird SOFA-IKS-PRCS, SOFA-IKS-ROLE, SOFA-IKS-SYS oder SOFA-IKS-ALL.";
            return;
        }
        const configuration = getTargetConfiguration(type);
        const previousValue = reset ? "" : DOM.targetSelect.value;
        const query = DOM.targetSearch.value.trim().toLocaleLowerCase("de");
        const items = getCatalogItems(type).filter(item => {
            const haystack = [item.name, catalogItemSecondary(item, type), item.id]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("de");
            return !query || haystack.includes(query);
        });

        DOM.targetLabel.textContent = configuration.label;
        DOM.targetHelp.textContent = configuration.help;
        DOM.targetSearch.placeholder = configuration.placeholder;
        DOM.targetSelect.innerHTML = "";

        if (type === "process") {
            const allOption = document.createElement("option");
            allOption.value = ALL_PROCESSES_VALUE;
            allOption.textContent = "Alle Prozessarten";
            DOM.targetSelect.appendChild(allOption);
        }

        items.forEach(item => {
            const secondary = catalogItemSecondary(item, type);
            const option = document.createElement("option");
            option.value = String(item.id);
            option.textContent = secondary ? `${item.name} · ${secondary}` : item.name;
            DOM.targetSelect.appendChild(option);
        });

        const hasOptions = DOM.targetSelect.options.length > 0;
        DOM.targetSelect.disabled = state.loading || !hasOptions;
        if (previousValue && [...DOM.targetSelect.options].some(option => option.value === previousValue)) {
            DOM.targetSelect.value = previousValue;
        }

        if (!hasOptions) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = query ? "Keine passenden Einträge" : "Keine Einträge verfügbar";
            DOM.targetSelect.appendChild(option);
            DOM.targetSelect.disabled = true;
        }

        const total = getCatalogItems(type).length;
        DOM.catalogStatus.textContent = total
            ? `${items.length} von ${total} Einträgen angezeigt.`
            : "Für diese Kontrollart sind keine Einträge im Katalog verfügbar.";
    }

    function normalizeCatalog(data) {
        if (!isObject(data)) throw new Error("Der IKS-Katalog ist ungültig.");
        const normalized = {};
        for (const key of ["process_types", "roles", "systems"]) {
            if (!Array.isArray(data[key])) {
                throw new Error(`Der IKS-Katalog enthält '${key}' nicht als Liste.`);
            }
            normalized[key] = data[key]
                .filter(item => isObject(item) && item.id !== undefined && item.id !== null && item.name)
                .map(item => ({ ...item, id: String(item.id), name: String(item.name) }));
        }
        return normalized;
    }

    function applyPreset() {
        const range = getPresetRange(DOM.preset.value);
        if (!range) return;
        DOM.from.value = toDateInputValue(range.from);
        DOM.to.value = toDateInputValue(range.to);
    }

    function setLoading(loading) {
        state.loading = loading;
        DOM.submit.disabled = loading || !getReportType();
        DOM.submit.textContent = loading ? "Bericht wird erstellt …" : "Bericht generieren";
        DOM.typeInputs.forEach(input => {
            input.disabled = loading || input.dataset.authorized !== "true";
        });
        DOM.targetSearch.disabled = loading || !getReportType();
        DOM.preset.disabled = loading;
        DOM.from.disabled = loading;
        DOM.to.disabled = loading;
        renderTargetOptions();
    }

    function buildRequestPayload() {
        const reportType = getReportType();
        const targetId = DOM.targetSelect.value;
        if (!REPORT_TYPES.includes(reportType)) {
            throw new Error("Bitte eine gültige Kontrollart wählen.");
        }
        if (reportType !== "process" && !targetId) {
            throw new Error(`Bitte ${reportType === "role" ? "eine Rolle" : "ein System"} wählen.`);
        }
        if (!DOM.from.value || !DOM.to.value) {
            throw new Error("Bitte einen vollständigen Kontrollzeitraum wählen.");
        }
        if (DOM.from.value > DOM.to.value) {
            throw new Error("Das Startdatum darf nicht nach dem Enddatum liegen.");
        }

        return {
            report_type: reportType,
            target: reportType === "process" && targetId === ALL_PROCESSES_VALUE
                ? null
                : { id: targetId },
            period: { from: DOM.from.value, to: DOM.to.value },
            timezone: REPORT_TIMEZONE
        };
    }

    function validateReport(report) {
        const errors = [];
        if (!isObject(report)) return ["Die Antwort ist kein Berichtsobjekt."];
        if (!report.schema_version) errors.push("schema_version fehlt");
        if (!report.ruleset_version) errors.push("ruleset_version fehlt");
        if (!report.report_id) errors.push("report_id fehlt");
        if (!REPORT_TYPES.includes(report.report_type)) errors.push("report_type ist ungültig");
        if (!report.title) errors.push("title fehlt");
        if (!report.generated_at) errors.push("generated_at fehlt");
        if (!isObject(report.generated_by) || !report.generated_by.name) errors.push("generated_by.name fehlt");
        if (!report.data_as_of) errors.push("data_as_of fehlt");
        if (!isObject(report.period) || !report.period.from || !report.period.to) errors.push("period ist unvollständig");
        if (report.report_type !== "process" && (!isObject(report.target) || !report.target.name)) errors.push("target.name fehlt");
        if (report.report_type === "process" && report.target !== null && (!isObject(report.target) || !report.target.name)) errors.push("target.name fehlt");
        if (!isObject(report.assessment) || !report.assessment.status || !report.assessment.label) errors.push("assessment ist unvollständig");
        if (!Array.isArray(report.kpis)) errors.push("kpis ist keine Liste");
        if (!Array.isArray(report.findings)) errors.push("findings ist keine Liste");
        if (!isObject(report.data_quality) || !report.data_quality.status || !Array.isArray(report.data_quality.sources)) errors.push("data_quality ist unvollständig");
        if (!isObject(report.details)) errors.push("details fehlt");
        if (!isObject(report.integrity) || !report.integrity.algorithm || !report.integrity.digest) errors.push("integrity ist unvollständig");
        if (!isObject(report.exports)) errors.push("exports fehlt");

        if (isObject(report.details)) {
            if (report.report_type === "process" && !Array.isArray(report.details.instances)) {
                errors.push("details.instances ist keine Liste");
            }
            if (report.report_type === "role") {
                if (!isObject(report.details.role)) errors.push("details.role fehlt");
                if (!Array.isArray(report.details.assignments)) errors.push("details.assignments ist keine Liste");
                if (!isObject(report.details.package) || !Array.isArray(report.details.package.resources)) errors.push("details.package.resources ist keine Liste");
                if (!Array.isArray(report.details.changes)) errors.push("details.changes ist keine Liste");
            }
            if (report.report_type === "system") {
                if (!isObject(report.details.system)) errors.push("details.system fehlt");
                if (!Array.isArray(report.details.access_rows)) errors.push("details.access_rows ist keine Liste");
                if (!Array.isArray(report.details.changes)) errors.push("details.changes ist keine Liste");
            }
        }
        return errors;
    }

    function metaCard(label, value) {
        return `<div class="iks-meta-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(valueOrDash(value))}</strong></div>`;
    }

    function renderMeta(report) {
        const target = report.target ? labelOf(report.target) : "Alle Prozessarten";
        DOM.meta.innerHTML = [
            metaCard("Berichts-ID", report.report_id),
            metaCard("Kontrollobjekt", target),
            metaCard("Zeitraum", `${formatDate(report.period.from)} – ${formatDate(report.period.to)}`),
            metaCard("Datenstand", formatDateTime(report.data_as_of)),
            metaCard("Erstellt von", report.generated_by.name),
            metaCard("Erstellt am", formatDateTime(report.generated_at)),
            metaCard("Schema", report.schema_version),
            metaCard("Regelwerk", report.ruleset_version)
        ].join("");
    }

    function renderAssessment(report) {
        const assessment = report.assessment;
        const status = statusCodeOf(assessment.status);
        DOM.assessment.innerHTML = `
            <div class="iks-assessment is-${escapeHtml(status)}">
                <span class="iks-assessment-badge">${escapeHtml(assessment.label)}</span>
                <div>
                    <strong>${escapeHtml(assessment.title || assessment.label)}</strong>
                    <p>${escapeHtml(assessment.summary || "Keine zusätzliche Zusammenfassung geliefert.")}</p>
                </div>
            </div>`;
    }

    function renderKpis(report) {
        DOM.kpis.innerHTML = report.kpis.slice(0, 4).map(kpi => {
            const tone = statusCodeOf(kpi.tone);
            const value = `${valueOrDash(kpi.value)}${kpi.unit ? ` ${kpi.unit}` : ""}`;
            return `<div class="iks-kpi is-${escapeHtml(tone)}"><span>${escapeHtml(kpi.label || kpi.key)}</span><strong>${escapeHtml(value)}</strong></div>`;
        }).join("");
        DOM.kpis.hidden = report.kpis.length === 0;
    }

    function renderDataQuality(report) {
        const quality = report.data_quality;
        const qualityStatus = statusCodeOf(quality.status);
        const sources = quality.sources.map(source => {
            const sourceLabel = source.label || source.status_label || labelOf(source.status);
            const asOf = source.as_of ? ` · ${formatDateTime(source.as_of)}` : "";
            return `<span class="iks-status-badge is-${escapeHtml(statusCodeOf(source.status))}">${escapeHtml(labelOf(source.name))}: ${escapeHtml(sourceLabel)}${escapeHtml(asOf)}</span>`;
        }).join("");
        DOM.dataQuality.innerHTML = `
            <div class="iks-data-quality is-${escapeHtml(qualityStatus)}">
                <div class="iks-data-quality-header">
                    <strong>Datenqualität</strong>
                    ${statusBadge(quality.status, quality.label || labelOf(quality.status))}
                </div>
                ${quality.summary ? `<p>${escapeHtml(quality.summary)}</p>` : ""}
                ${sources ? `<div class="iks-source-list">${sources}</div>` : ""}
            </div>`;
    }

    function renderFindings(report) {
        const findings = report.findings;
        DOM.findingsCount.textContent = String(findings.length);
        if (!findings.length) {
            DOM.findings.innerHTML = `<div class="iks-empty">Das Backend hat keine separaten Auffälligkeiten für diesen Bericht geliefert.</div>`;
            return;
        }

        DOM.findings.innerHTML = `<div class="iks-finding-list">${findings.map(finding => {
            const severity = statusCodeOf(finding.severity);
            const subject = finding.subject ? labelOf(finding.subject) : "";
            const references = asArray(finding.evidence_refs).join(", ");
            return `
                <article class="iks-finding is-${escapeHtml(severity)}">
                    <div class="iks-finding-header">
                        <h4>${escapeHtml(finding.title || finding.code || "Auffälligkeit")}</h4>
                        ${statusBadge(finding.severity, finding.severity_label || labelOf(finding.severity))}
                    </div>
                    ${finding.description ? `<p>${escapeHtml(finding.description)}</p>` : ""}
                    ${(subject || references) ? `<div class="iks-finding-meta">
                        ${subject ? `<span>Bezug: ${escapeHtml(subject)}</span>` : ""}
                        ${references ? `<span>Nachweis: ${escapeHtml(references)}</span>` : ""}
                    </div>` : ""}
                </article>`;
        }).join("")}</div>`;
    }

    function personCell(person) {
        const identifiers = [
            person?.pnr ? `PNR ${person.pnr}` : "",
            person?.racf ? `RACF ${person.racf}` : "",
            person?.employee_number ? `Personalnr. ${person.employee_number}` : ""
        ].filter(Boolean).join(" · ");
        return `<span class="iks-primary-text">${escapeHtml(labelOf(person))}</span>${identifiers ? `<span class="iks-secondary-text">${escapeHtml(identifiers)}</span>` : ""}`;
    }

    function renderEmpty(message) {
        return `<div class="iks-empty">${escapeHtml(message)}</div>`;
    }

    function renderSteps(steps) {
        if (!steps.length) return renderEmpty("Keine kontrollrelevanten Schritte geliefert.");
        return `<div class="iks-table-wrap"><table class="iks-table">
            <thead><tr><th>Schritt</th><th>Verantwortung</th><th>Fälligkeit</th><th>Abschluss</th><th>Status</th><th>Ergebnis</th></tr></thead>
            <tbody>${steps.map(step => `<tr>
                <td><span class="iks-primary-text">${escapeHtml(labelOf(step))}</span></td>
                <td>${escapeHtml(labelOf(step.owner || step.responsible))}</td>
                <td>${escapeHtml(formatDateTime(step.due_at))}</td>
                <td>${escapeHtml(formatDateTime(step.completed_at))}</td>
                <td>${statusBadge(step.status, statusLabelOf(step))}</td>
                <td>${escapeHtml(statusLabelOf(step, "result"))}</td>
            </tr>`).join("")}</tbody>
        </table></div>`;
    }

    function renderProcessDetails(details) {
        if (!details.instances.length) return renderEmpty("Für den gewählten Zeitraum wurden keine Prozessinstanzen geliefert.");
        return `<div class="iks-detail-section">
            <h4>Prozessinstanzen</h4>
            ${details.instances.map((instance, index) => `
                <details class="iks-process-instance" ${index === 0 ? "open" : ""}>
                    <summary>
                        <div>${personCell(instance.subject || instance.user)}<span class="iks-secondary-text">${escapeHtml(labelOf(instance.process_type || instance.process))}</span></div>
                        <div><span class="iks-secondary-text">Start</span><span class="iks-primary-text">${escapeHtml(formatDateTime(instance.started_at))}</span></div>
                        <div><span class="iks-secondary-text">Fälligkeit</span><span class="iks-primary-text">${escapeHtml(formatDateTime(instance.due_at))}</span></div>
                        <div><span class="iks-secondary-text">Abschluss</span><span class="iks-primary-text">${escapeHtml(formatDateTime(instance.completed_at))}</span></div>
                        ${statusBadge(instance.status, statusLabelOf(instance))}
                    </summary>
                    <div class="iks-process-steps">
                        ${instance.result ? `<p><strong>Ergebnis:</strong> ${escapeHtml(labelOf(instance.result))}</p>` : ""}
                        ${renderSteps(asArray(instance.steps))}
                    </div>
                </details>`).join("")}
        </div>`;
    }

    function roleOverviewItem(label, value) {
        return `<div class="iks-role-overview-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(valueOrDash(value))}</strong></div>`;
    }

    function renderAssignments(assignments) {
        if (!assignments.length) return renderEmpty("Keine aktuellen Rollenzuweisungen geliefert.");
        return `<div class="iks-table-wrap"><table class="iks-table">
            <thead><tr><th>Person</th><th>Zuweisungsart</th><th>Gültigkeit</th><th>Status</th><th>Bewertung</th><th>Begründung</th></tr></thead>
            <tbody>${assignments.map(assignment => {
                const assessment = assignment.assessment;
                const reason = isObject(assessment) ? (assessment.reason || assessment.summary) : assignment.reason;
                return `<tr>
                    <td>${personCell(assignment.person || assignment.user)}</td>
                    <td>${escapeHtml(labelOf(assignment.assignment_type || assignment.type))}</td>
                    <td>${escapeHtml(formatDate(assignment.valid_from))} – ${escapeHtml(formatDate(assignment.valid_to))}</td>
                    <td>${statusBadge(assignment.status, statusLabelOf(assignment))}</td>
                    <td>${statusBadge(assessment, labelOf(assessment, "Manuell zu prüfen"))}</td>
                    <td>${escapeHtml(reason || "-")}</td>
                </tr>`;
            }).join("")}</tbody>
        </table></div>`;
    }

    function renderRoleResources(resources) {
        if (!resources.length) return renderEmpty("Keine Ressourcen im aktuellen Rollenpaket geliefert.");
        return `<div class="iks-table-wrap"><table class="iks-table">
            <thead><tr><th>System</th><th>Ressource</th><th>Technische Kennung</th><th>Herkunft</th><th>Status</th></tr></thead>
            <tbody>${resources.map(resource => `<tr>
                <td>${escapeHtml(labelOf(resource.system))}</td>
                <td><span class="iks-primary-text">${escapeHtml(labelOf(resource))}</span></td>
                <td>${escapeHtml(valueOrDash(resource.technical_identifier))}</td>
                <td>${escapeHtml(labelOf(resource.source))}</td>
                <td>${statusBadge(resource.status, statusLabelOf(resource))}</td>
            </tr>`).join("")}</tbody>
        </table></div>`;
    }

    function renderChanges(changes, subjectLabel) {
        if (!changes.length) return renderEmpty("Keine Änderungen im gewählten Zeitraum geliefert.");
        return `<div class="iks-table-wrap"><table class="iks-table">
            <thead><tr><th>Änderung</th><th>${escapeHtml(subjectLabel)}</th><th>System</th><th>Zeitpunkt</th><th>Bearbeitet von</th><th>Audit-Kommentar</th></tr></thead>
            <tbody>${changes.map(change => `<tr>
                <td>${escapeHtml(labelOf(change.change_type || change.action))}</td>
                <td><span class="iks-primary-text">${escapeHtml(labelOf(change.subject || change.resource || change.assignment))}</span></td>
                <td>${escapeHtml(labelOf(change.system))}</td>
                <td>${escapeHtml(formatDateTime(change.occurred_at || change.changed_at))}</td>
                <td>${escapeHtml(labelOf(change.changed_by || change.actor))}</td>
                <td>${escapeHtml(change.audit_comment || "Keine Begründung dokumentiert")}</td>
            </tr>`).join("")}</tbody>
        </table></div>`;
    }

    function renderRoleDetails(details) {
        const role = details.role;
        return `
            <div class="iks-role-overview">
                ${roleOverviewItem("Rolle", labelOf(role))}
                ${roleOverviewItem("Rollentyp", labelOf(role.type))}
                ${roleOverviewItem("Status", statusLabelOf(role))}
                ${roleOverviewItem("Übergeordnete Rolle", labelOf(role.parent))}
            </div>
            <section class="iks-detail-section"><h4>Aktuelle Zuweisungen</h4>${renderAssignments(details.assignments)}</section>
            <section class="iks-detail-section"><h4>Aktuelles Rollenpaket</h4>${renderRoleResources(details.package.resources)}</section>
            <section class="iks-detail-section"><h4>Änderungen im Zeitraum</h4>${renderChanges(details.changes, "Zuweisung oder Ressource")}</section>`;
    }

    function renderSystemAccessRows(rows) {
        if (!rows.length) return renderEmpty("Keine Zugriffsdaten für dieses System geliefert.");
        return `<div class="iks-table-wrap"><table class="iks-table">
            <thead><tr><th>Person</th><th>Ressource</th><th>Soll-Zugriff</th><th>In SOFA dokumentierter Ist-Zugriff</th><th>Berechtigungsquelle</th><th>Bewertung</th></tr></thead>
            <tbody>${rows.map(row => {
                const sources = asArray(row.entitlement_sources).map(labelOf).join(", ");
                const assessment = row.assessment;
                return `<tr>
                    <td>${personCell(row.person || row.user)}</td>
                    <td><span class="iks-primary-text">${escapeHtml(labelOf(row.resource))}</span><span class="iks-secondary-text">${escapeHtml(valueOrDash(row.resource?.technical_identifier))}</span></td>
                    <td>${statusBadge(row.expected_access, labelOf(row.expected_access))}</td>
                    <td>${statusBadge(row.documented_access || row.actual_access, labelOf(row.documented_access || row.actual_access))}</td>
                    <td>${escapeHtml(sources || "-")}</td>
                    <td>${statusBadge(assessment, labelOf(assessment, "Nicht bewertbar"))}${isObject(assessment) && assessment.reason ? `<span class="iks-secondary-text">${escapeHtml(assessment.reason)}</span>` : ""}</td>
                </tr>`;
            }).join("")}</tbody>
        </table></div>`;
    }

    function renderSystemDetails(details) {
        const system = details.system;
        return `
            <div class="iks-role-overview">
                ${roleOverviewItem("System", labelOf(system))}
                ${roleOverviewItem("Kurzname", system.short_name)}
                ${roleOverviewItem("Status", statusLabelOf(system))}
                ${roleOverviewItem("Verantwortung", labelOf(system.owner))}
            </div>
            <div class="iks-system-note"><strong>Abgrenzung:</strong> Der Ist-Zugriff bildet den in SOFA dokumentierten Stand ab. Es findet kein Live-Abgleich mit AD, Genesys oder anderen Zielsystemen statt.</div>
            <section class="iks-detail-section"><h4>Soll-/Ist-Zugriffsmatrix</h4>${renderSystemAccessRows(details.access_rows)}</section>
            <section class="iks-detail-section"><h4>Änderungen im Zeitraum</h4>${renderChanges(details.changes, "Person oder Ressource")}</section>`;
    }

    function renderDetails(report) {
        if (report.report_type === "role") return renderRoleDetails(report.details);
        if (report.report_type === "system") return renderSystemDetails(report.details);
        return renderProcessDetails(report.details);
    }

    function renderTechnicalDetails(report) {
        DOM.technical.innerHTML = `<div class="iks-technical-grid">
            <div><span class="iks-secondary-text">Berichts-ID</span><code>${escapeHtml(report.report_id)}</code></div>
            <div><span class="iks-secondary-text">Regelwerk</span><code>${escapeHtml(report.ruleset_version)}</code></div>
            <div><span class="iks-secondary-text">Integritätsverfahren</span><code>${escapeHtml(report.integrity.algorithm)}</code></div>
            <div><span class="iks-secondary-text">Prüfsumme</span><code>${escapeHtml(report.integrity.digest)}</code></div>
        </div>`;
    }

    function getSafeExportUrl(rawUrl) {
        if (!rawUrl) return null;
        try {
            const url = new URL(rawUrl, window.location.origin);
            if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/iks/")) return null;
            return `${url.pathname}${url.search}`;
        } catch (_error) {
            return null;
        }
    }

    function configureExports(report) {
        DOM.exportButtons.forEach(button => {
            const format = button.dataset.iksExport;
            const url = getSafeExportUrl(report.exports?.[format]);
            button.dataset.exportUrl = url || "";
            button.disabled = !url;
            button.textContent = url ? format.toUpperCase() : `${format.toUpperCase()} nicht verfügbar`;
            button.title = url ? `${format.toUpperCase()}-Snapshot herunterladen` : "Export nicht verfügbar";
        });
    }

    function filenameFromDisposition(disposition, fallback) {
        if (!disposition) return fallback;
        const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (encoded) {
            try { return decodeURIComponent(encoded[1]); } catch (_error) { return encoded[1]; }
        }
        const simple = disposition.match(/filename="?([^";]+)"?/i);
        return simple?.[1] || fallback;
    }

    async function downloadExport(button) {
        const format = button.dataset.iksExport;
        const url = button.dataset.exportUrl;
        if (!EXPORT_FORMATS.includes(format) || !url || !state.report) return;

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Lädt …";
        try {
            const response = await fetch(url, { headers: { "Accept": "*/*" } });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const detail = isObject(data.detail) ? data.detail.message : data.detail;
                throw new Error(detail || data.error || `Export fehlgeschlagen (${response.status})`);
            }
            const blob = await response.blob();
            const fallback = `${state.report.report_id}.${format}`;
            const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), fallback);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            showMessage(error.message || "Export konnte nicht geladen werden.");
        } finally {
            button.textContent = originalText;
            button.disabled = !button.dataset.exportUrl;
        }
    }

    function renderReport(report) {
        const errors = validateReport(report);
        if (errors.length) {
            state.report = null;
            DOM.report.hidden = true;
            DOM.contractError.hidden = false;
            DOM.contractErrorMessage.textContent = `Der Backend-Vertrag ist unvollständig: ${errors.join(", ")}.`;
            DOM.exportButtons.forEach(button => { button.disabled = true; button.dataset.exportUrl = ""; });
            return false;
        }

        state.report = report;
        DOM.contractError.hidden = true;
        DOM.reportTitle.textContent = report.title;
        DOM.reportSubtitle.textContent = report.assessment.summary || "";
        renderMeta(report);
        renderAssessment(report);
        renderKpis(report);
        renderDataQuality(report);
        renderFindings(report);
        DOM.details.innerHTML = renderDetails(report);
        renderTechnicalDetails(report);
        configureExports(report);
        DOM.report.hidden = false;
        return true;
    }

    async function handleSubmit(event) {
        event.preventDefault();
        let payload;
        try {
            payload = buildRequestPayload();
        } catch (error) {
            showMessage(error.message);
            return;
        }

        setLoading(true);
        DOM.contractError.hidden = true;
        try {
            const report = await api.createReport(payload);
            if (renderReport(report)) {
                DOM.report.scrollIntoView({ behavior: "smooth", block: "start" });
                showMessage("Kontrollbericht erfolgreich erstellt.", "success");
            }
        } catch (error) {
            showMessage(error.message || "Kontrollbericht konnte nicht erstellt werden.");
        } finally {
            setLoading(false);
        }
    }

    function bindEvents() {
        DOM.typeInputs.forEach(input => input.addEventListener("change", () => {
            DOM.targetSearch.value = "";
            renderTargetOptions({ reset: true });
        }));
        DOM.targetSearch.addEventListener("input", () => renderTargetOptions());
        DOM.preset.addEventListener("change", applyPreset);
        DOM.from.addEventListener("change", () => { DOM.preset.value = "custom"; });
        DOM.to.addEventListener("change", () => { DOM.preset.value = "custom"; });
        DOM.form.addEventListener("submit", handleSubmit);
        DOM.exportButtons.forEach(button => button.addEventListener("click", () => downloadExport(button)));
    }

    async function init() {
        cacheDom();
        bindEvents();
        applyPreset();
        setLoading(true);
        DOM.catalogStatus.textContent = "IKS-Katalog wird geladen …";
        try {
            state.catalog = normalizeCatalog(await api.getCatalog());
            renderTargetOptions({ reset: true });
        } catch (error) {
            DOM.catalogStatus.textContent = error.message || "IKS-Katalog konnte nicht geladen werden.";
            showMessage(DOM.catalogStatus.textContent);
        } finally {
            setLoading(false);
        }
    }

    document.addEventListener("DOMContentLoaded", init);
}());
