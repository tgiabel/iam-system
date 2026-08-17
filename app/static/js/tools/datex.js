document.addEventListener("DOMContentLoaded", () => {
    const PAGE_SIZE = 100;
    const numberFormatter = new Intl.NumberFormat("de-DE");
    const state = {
        file: null,
        records: [],
        removed: new Set(),
        page: 1,
        query: "",
        sortKey: "file_row",
        sortDirection: "asc",
        mengeTotal: 0,
        invalidMengeIndices: new Set(),
    };

    const elements = {
        form: document.getElementById("datexForm"),
        dropArea: document.getElementById("dropArea"),
        fileInput: document.getElementById("fileInput"),
        fileName: document.getElementById("fileNameValue"),
        previewButton: document.getElementById("previewButton"),
        uploadPanel: document.getElementById("datexUploadPanel"),
        uploadExpanded: document.getElementById("datexUploadExpanded"),
        uploadCompact: document.getElementById("datexUploadCompact"),
        compactFileName: document.getElementById("compactFileName"),
        collapseUploadButton: document.getElementById("collapseUploadButton"),
        expandUploadButton: document.getElementById("expandUploadButton"),
        status: document.getElementById("datexStatus"),
        editor: document.getElementById("datexEditor"),
        validationBadge: document.getElementById("datexValidationBadge"),
        warnings: document.getElementById("datexWarnings"),
        originalRowCount: document.getElementById("originalRowCount"),
        removedRowCount: document.getElementById("removedRowCount"),
        remainingRowCount: document.getElementById("remainingRowCount"),
        originalMenge: document.getElementById("originalMenge"),
        removedMenge: document.getElementById("removedMenge"),
        remainingMenge: document.getElementById("remainingMenge"),
        blzFilter: document.getElementById("blzFilter"),
        clearFilterButton: document.getElementById("clearFilterButton"),
        removeFilteredButton: document.getElementById("removeFilteredButton"),
        activeResultSummary: document.getElementById("activeResultSummary"),
        activeRows: document.getElementById("activeRows"),
        activeEmpty: document.getElementById("activeEmpty"),
        previousPageButton: document.getElementById("previousPageButton"),
        nextPageButton: document.getElementById("nextPageButton"),
        pageSummary: document.getElementById("pageSummary"),
        removedRows: document.getElementById("removedRows"),
        removedEmpty: document.getElementById("removedEmpty"),
        removedTableWrap: document.getElementById("removedTableWrap"),
        restoreAllButton: document.getElementById("restoreAllButton"),
        exportButton: document.getElementById("exportButton"),
        overlayExportButton: document.getElementById("overlayExportButton"),
        openRemovalButton: document.getElementById("openRemovalButton"),
        closeRemovalButton: document.getElementById("closeRemovalButton"),
        removalOverlay: document.getElementById("datexRemovalOverlay"),
        dockRemovedCount: document.getElementById("dockRemovedCount"),
        dockRemainingCount: document.getElementById("dockRemainingCount"),
        dockRemainingMenge: document.getElementById("dockRemainingMenge"),
        sortButtons: Array.from(document.querySelectorAll(".datex-sort")),
        detailDialog: document.getElementById("datexDetailDialog"),
        detailTitle: document.getElementById("datex-detail-title"),
        detailContent: document.getElementById("datexDetailContent"),
        detailRaw: document.getElementById("datexDetailRaw"),
        detailClose: document.getElementById("datexDetailClose"),
    };

    if (!elements.form || !elements.fileInput || !elements.dropArea) {
        return;
    }

    const setStatus = (message = "", type = "info") => {
        elements.status.textContent = message;
        elements.status.className = `datex-status datex-status-${type}`;
        elements.status.hidden = !message;
    };

    const setBusy = (busy, button, busyLabel, defaultLabel) => {
        button.disabled = busy;
        button.textContent = busy ? busyLabel : defaultLabel;
    };

    const flash = (message, category = "success") => {
        if (typeof showFlash === "function") {
            showFlash(message, category);
            return;
        }
        setStatus(message, category === "failure" ? "error" : category);
    };

    const closeRemovalOverlay = () => {
        const wasOpen = elements.removalOverlay.classList.contains("active");
        elements.removalOverlay.classList.remove("active");
        elements.removalOverlay.setAttribute("aria-hidden", "true");
        if (!document.querySelector(".ui-modal-overlay.active")) {
            document.body.classList.remove("modal-open");
        }
        if (wasOpen && !elements.editor.hidden) {
            elements.openRemovalButton.focus();
        }
    };

    const openRemovalOverlay = () => {
        if (state.removed.size === 0) {
            return;
        }
        elements.removalOverlay.classList.add("active");
        elements.removalOverlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        elements.closeRemovalButton.focus();
    };

    const expandUploadPanel = () => {
        elements.uploadPanel.classList.remove("is-collapsed");
        elements.uploadExpanded.hidden = false;
        elements.uploadCompact.hidden = true;
        elements.collapseUploadButton.hidden = state.records.length === 0;
    };

    const collapseUploadPanel = () => {
        if (state.records.length === 0) {
            return;
        }
        elements.compactFileName.textContent = state.file?.name || "–";
        elements.uploadPanel.classList.add("is-collapsed");
        elements.uploadExpanded.hidden = true;
        elements.uploadCompact.hidden = false;
    };

    const resetEditor = () => {
        state.records = [];
        state.removed = new Set();
        state.page = 1;
        state.query = "";
        state.mengeTotal = 0;
        state.invalidMengeIndices = new Set();
        elements.blzFilter.value = "";
        elements.editor.hidden = true;
        closeRemovalOverlay();
        expandUploadPanel();
    };

    const selectFile = (file) => {
        state.file = file || null;
        elements.fileName.textContent = file ? file.name : "Keine Datei ausgewählt";
        elements.compactFileName.textContent = file ? file.name : "–";
        resetEditor();
        setStatus();
    };

    const findingMessage = (findings) => findings.map((finding) => finding.message).join(" ");

    const findingsFor = (record, ...fieldNames) => (
        (record.findings || []).filter((finding) => fieldNames.includes(finding.field))
    );

    const hasFindings = (record) => (record.findings || []).length > 0;

    const createCell = (value, className = "", findings = []) => {
        const cell = document.createElement("td");
        if (className) {
            cell.className = className;
        }
        if (findings.length) {
            const markedValue = document.createElement("span");
            markedValue.className = "datex-invalid-value";
            markedValue.textContent = value ?? "";
            markedValue.title = findingMessage(findings);
            cell.appendChild(markedValue);
        } else {
            cell.textContent = value ?? "";
        }
        return cell;
    };

    const buildFileRowCell = (record) => {
        const cell = createCell(record.file_row);
        if (!hasFindings(record)) {
            return cell;
        }
        const icon = document.createElement("span");
        icon.className = "datex-finding-icon";
        icon.textContent = "⚠";
        icon.setAttribute("role", "img");
        icon.setAttribute("aria-label", `${record.findings.length} Prüfhinweis${record.findings.length === 1 ? "" : "e"}: ${findingMessage(record.findings)}`);
        icon.title = findingMessage(record.findings);
        cell.prepend(icon);
        return cell;
    };

    const formatDate = (value) => {
        if (!/^\d{8}$/.test(value || "")) {
            return value || "";
        }
        return `${value.slice(6, 8)}.${value.slice(4, 6)}.${value.slice(0, 4)}`;
    };

    const formatTime = (value) => {
        if (!/^\d{6}$/.test(value || "")) {
            return value || "";
        }
        return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`;
    };

    const recordName = (record) => [record.fields.Nachname, record.fields.Vorname].filter(Boolean).join(", ");

    const displayMenge = (value) => value === null || value === undefined
        ? "nicht berechenbar"
        : numberFormatter.format(value);

    const sortValue = (record, key) => {
        if (key === "file_row") {
            return record.file_row;
        }
        if (key === "Menge") {
            return record.menge_value;
        }
        return record.fields[key] || "";
    };

    const activeFilteredRecords = () => {
        const filtered = state.records.filter((record) => {
            if (state.removed.has(record.index)) {
                return false;
            }
            return !state.query || record.fields.BLZ.includes(state.query);
        });

        return filtered.sort((left, right) => {
            const findingComparison = Number(hasFindings(right)) - Number(hasFindings(left));
            if (findingComparison) {
                return findingComparison;
            }
            const leftValue = sortValue(left, state.sortKey);
            const rightValue = sortValue(right, state.sortKey);
            let comparison;
            if (typeof leftValue === "number" && typeof rightValue === "number") {
                comparison = leftValue - rightValue;
            } else {
                comparison = String(leftValue).localeCompare(String(rightValue), "de", { numeric: true });
            }
            return state.sortDirection === "asc" ? comparison : -comparison;
        });
    };

    const buildDetails = (record) => {
        const cell = document.createElement("td");
        const button = actionButton("Anzeigen", "btn-secondary datex-btn-small", () => {
            elements.detailTitle.textContent = `Datensatz in Dateizeile ${record.file_row}`;
            elements.detailContent.replaceChildren();
            if (hasFindings(record)) {
                const findings = document.createElement("div");
                findings.className = "datex-detail-findings";
                const title = document.createElement("strong");
                title.textContent = "Prüfhinweise";
                const list = document.createElement("ul");
                record.findings.forEach((finding) => {
                    const item = document.createElement("li");
                    item.textContent = finding.message;
                    list.appendChild(item);
                });
                findings.append(title, list);
                elements.detailContent.appendChild(findings);
            }
            Object.entries(record.fields).forEach(([label, value]) => {
                const item = document.createElement("div");
                const key = document.createElement("span");
                const fieldValue = document.createElement("strong");
                key.textContent = label;
                fieldValue.textContent = value || "–";
                const fieldFindings = findingsFor(record, label);
                if (fieldFindings.length) {
                    fieldValue.classList.add("datex-invalid-value");
                    fieldValue.title = findingMessage(fieldFindings);
                }
                item.append(key, fieldValue);
                elements.detailContent.appendChild(item);
            });
            elements.detailRaw.textContent = record.raw;
            elements.detailDialog.showModal();
        });
        cell.appendChild(button);
        return cell;
    };

    const actionButton = (label, className, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn ${className}`;
        button.textContent = label;
        button.addEventListener("click", handler);
        return button;
    };

    const renderActiveRows = () => {
        const filtered = activeFilteredRecords();
        const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        state.page = Math.min(state.page, pageCount);
        const start = (state.page - 1) * PAGE_SIZE;
        const pageRecords = filtered.slice(start, start + PAGE_SIZE);
        elements.activeRows.replaceChildren();

        pageRecords.forEach((record) => {
            const row = document.createElement("tr");
            row.append(
                buildFileRowCell(record),
                createCell(record.fields.BLZ, "datex-monospace", findingsFor(record, "BLZ")),
                createCell(record.fields.Filiale),
                createCell(record.fields.KTONr, "datex-monospace", findingsFor(record, "KTONr")),
                createCell(record.fields.Leistungsnummer, "datex-monospace", findingsFor(record, "Leistungsnummer")),
                createCell(displayMenge(record.menge_value), "datex-number", findingsFor(record, "Menge")),
                createCell(record.fields.Betrag, "datex-number", findingsFor(record, "Betrag")),
                createCell(
                    `${formatDate(record.fields.Sperrdatum)} ${formatTime(record.fields.Uhrzeit)}`.trim(),
                    "",
                    findingsFor(record, "Sperrdatum", "Uhrzeit"),
                ),
                createCell(recordName(record), "", findingsFor(record, "Nachname", "Vorname")),
                buildDetails(record),
            );
            const actionCell = document.createElement("td");
            actionCell.appendChild(actionButton("Vormerken", "datex-btn-danger datex-btn-small", () => {
                state.removed.add(record.index);
                render();
            }));
            row.appendChild(actionCell);
            elements.activeRows.appendChild(row);
        });

        elements.activeEmpty.hidden = filtered.length !== 0;
        elements.activeResultSummary.textContent = state.query
            ? `${numberFormatter.format(filtered.length)} aktive Datensätze passen zum BLZ-Filter „${state.query}“.`
            : `${numberFormatter.format(filtered.length)} aktive Datensätze.`;
        elements.removeFilteredButton.disabled = !state.query || filtered.length === 0;
        elements.removeFilteredButton.textContent = state.query && filtered.length
            ? `${numberFormatter.format(filtered.length)} gefilterte Datensätze vormerken`
            : "BLZ-Filter für Sammelaktion eingeben";
        elements.pageSummary.textContent = `Seite ${state.page} von ${pageCount}`;
        elements.previousPageButton.disabled = state.page <= 1;
        elements.nextPageButton.disabled = state.page >= pageCount;
        elements.sortButtons.forEach((button) => {
            const active = button.dataset.sort === state.sortKey;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
        });
    };

    const renderRemovedRows = () => {
        const removedRecords = state.records
            .filter((record) => state.removed.has(record.index))
            .sort((left, right) => Number(hasFindings(right)) - Number(hasFindings(left)) || left.file_row - right.file_row);
        elements.removedRows.replaceChildren();
        removedRecords.forEach((record) => {
            const row = document.createElement("tr");
            row.append(
                buildFileRowCell(record),
                createCell(record.fields.BLZ, "datex-monospace", findingsFor(record, "BLZ")),
                createCell(record.fields.KTONr, "datex-monospace", findingsFor(record, "KTONr")),
                createCell(record.fields.Leistungsnummer, "datex-monospace", findingsFor(record, "Leistungsnummer")),
                createCell(displayMenge(record.menge_value), "datex-number", findingsFor(record, "Menge")),
                createCell(recordName(record), "", findingsFor(record, "Nachname", "Vorname")),
                buildDetails(record),
            );
            const actionCell = document.createElement("td");
            actionCell.appendChild(actionButton("Wiederherstellen", "btn-secondary datex-btn-small", () => {
                state.removed.delete(record.index);
                render();
            }));
            row.appendChild(actionCell);
            elements.removedRows.appendChild(row);
        });

        const hasRemoved = removedRecords.length > 0;
        elements.removedEmpty.hidden = hasRemoved;
        elements.removedTableWrap.hidden = !hasRemoved;
        elements.restoreAllButton.disabled = !hasRemoved;
        const hasOutstandingInvalidMenge = state.records.some(
            (record) => record.menge_value === null && !state.removed.has(record.index),
        );
        elements.exportButton.disabled = !hasRemoved || hasOutstandingInvalidMenge;
        elements.overlayExportButton.disabled = !hasRemoved || hasOutstandingInvalidMenge;
        elements.openRemovalButton.disabled = !hasRemoved;
        if (!hasRemoved) {
            closeRemovalOverlay();
        }
    };

    const renderSummary = () => {
        const removedRecords = state.records.filter((record) => state.removed.has(record.index));
        const sourceHasInvalidMenge = state.invalidMengeIndices.size > 0;
        const hasOutstandingInvalidMenge = state.records.some(
            (record) => record.menge_value === null && !state.removed.has(record.index),
        );
        const removedHasInvalidMenge = removedRecords.some((record) => record.menge_value === null);
        const removedMenge = removedHasInvalidMenge
            ? null
            : removedRecords.reduce((sum, record) => sum + record.menge_value, 0);
        const remainingMenge = hasOutstandingInvalidMenge
            ? null
            : state.records
                .filter((record) => !state.removed.has(record.index))
                .reduce((sum, record) => sum + record.menge_value, 0);
        elements.originalRowCount.textContent = numberFormatter.format(state.records.length);
        elements.removedRowCount.textContent = numberFormatter.format(removedRecords.length);
        elements.remainingRowCount.textContent = numberFormatter.format(state.records.length - removedRecords.length);
        elements.originalMenge.textContent = displayMenge(sourceHasInvalidMenge ? null : state.mengeTotal);
        elements.removedMenge.textContent = displayMenge(removedMenge);
        elements.remainingMenge.textContent = displayMenge(remainingMenge);
        elements.dockRemovedCount.textContent = numberFormatter.format(removedRecords.length);
        elements.dockRemainingCount.textContent = numberFormatter.format(state.records.length - removedRecords.length);
        elements.dockRemainingMenge.textContent = displayMenge(remainingMenge);
    };

    const render = () => {
        renderSummary();
        renderActiveRows();
        renderRemovedRows();
    };

    const showWarnings = (warnings, flaggedRowCount = 0, findingCount = 0) => {
        elements.warnings.replaceChildren();
        if (!warnings.length && !findingCount) {
            elements.warnings.hidden = true;
            elements.validationBadge.className = "datex-badge datex-badge-success";
            elements.validationBadge.textContent = "Datei ist strukturell gültig";
            return;
        }

        elements.validationBadge.className = "datex-badge datex-badge-warning";
        elements.validationBadge.textContent = findingCount
            ? `${numberFormatter.format(flaggedRowCount)} auffällige Datensätze · ${numberFormatter.format(findingCount)} Hinweise`
            : "Fußsummen weichen ab";
        if (!warnings.length) {
            elements.warnings.hidden = true;
            return;
        }
        const title = document.createElement("strong");
        title.textContent = "Hinweis: Beim Export werden die Fußsummen neu berechnet.";
        const list = document.createElement("ul");
        warnings.forEach((warning) => {
            const item = document.createElement("li");
            item.textContent = warning;
            list.appendChild(item);
        });
        elements.warnings.append(title, list);
        elements.warnings.hidden = false;
    };

    const responseError = async (response) => {
        try {
            const payload = await response.json();
            return payload.error || "Die Anfrage konnte nicht verarbeitet werden.";
        } catch (_error) {
            return "Die Anfrage konnte nicht verarbeitet werden.";
        }
    };

    elements.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = elements.fileInput.files?.[0];
        if (!file) {
            setStatus("Bitte zuerst eine DAT-Datei auswählen.", "error");
            return;
        }

        selectFile(file);
        setBusy(true, elements.previewButton, "Datei wird geprüft …", "Datei prüfen");
        setStatus("Die DAT-Datei wird eingelesen und geprüft …", "info");
        try {
            const formData = new FormData();
            formData.append("datfile", file);
            const response = await fetch("/api/tools/datex/preview", { method: "POST", body: formData });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const preview = await response.json();
            state.file = file;
            state.records = preview.records;
            state.removed = new Set();
            state.page = 1;
            state.query = "";
            state.sortKey = "file_row";
            state.sortDirection = "asc";
            state.mengeTotal = preview.menge_total;
            state.invalidMengeIndices = new Set(preview.invalid_menge_indices || []);
            showWarnings(preview.warnings || [], preview.flagged_row_count || 0, preview.finding_count || 0);
            elements.editor.hidden = false;
            setStatus();
            const findingSuffix = preview.finding_count
                ? ` ${numberFormatter.format(preview.flagged_row_count)} Datensätze haben Prüfhinweise.`
                : "";
            flash(`${numberFormatter.format(preview.row_count)} Datensätze wurden erfolgreich eingelesen.${findingSuffix}`, "success");
            render();
            collapseUploadPanel();
            elements.editor.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
            resetEditor();
            setStatus(error.message || "Die DAT-Datei konnte nicht gelesen werden.", "error");
        } finally {
            setBusy(false, elements.previewButton, "Datei wird geprüft …", "Datei prüfen");
        }
    });

    elements.dropArea.addEventListener("click", () => elements.fileInput.click());
    elements.dropArea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            elements.fileInput.click();
        }
    });
    elements.dropArea.addEventListener("dragover", (event) => {
        event.preventDefault();
        elements.dropArea.classList.add("open");
    });
    elements.dropArea.addEventListener("dragleave", () => elements.dropArea.classList.remove("open"));
    elements.dropArea.addEventListener("drop", (event) => {
        event.preventDefault();
        elements.dropArea.classList.remove("open");
        const file = event.dataTransfer?.files?.[0];
        if (!file) {
            return;
        }
        elements.fileInput.files = event.dataTransfer.files;
        selectFile(file);
    });
    elements.fileInput.addEventListener("change", () => selectFile(elements.fileInput.files?.[0]));
    elements.expandUploadButton.addEventListener("click", () => {
        expandUploadPanel();
        elements.dropArea.focus();
    });
    elements.collapseUploadButton.addEventListener("click", collapseUploadPanel);

    elements.blzFilter.addEventListener("input", () => {
        state.query = elements.blzFilter.value.trim();
        state.page = 1;
        renderActiveRows();
    });
    elements.clearFilterButton.addEventListener("click", () => {
        elements.blzFilter.value = "";
        state.query = "";
        state.page = 1;
        renderActiveRows();
        elements.blzFilter.focus();
    });
    elements.removeFilteredButton.addEventListener("click", () => {
        activeFilteredRecords().forEach((record) => state.removed.add(record.index));
        state.page = 1;
        render();
    });
    elements.restoreAllButton.addEventListener("click", () => {
        state.removed.clear();
        render();
    });
    elements.openRemovalButton.addEventListener("click", openRemovalOverlay);
    elements.closeRemovalButton.addEventListener("click", closeRemovalOverlay);
    elements.removalOverlay.addEventListener("click", (event) => {
        if (event.target === elements.removalOverlay) {
            closeRemovalOverlay();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }
        if (elements.detailDialog.open) {
            event.stopImmediatePropagation();
            return;
        }
        if (elements.removalOverlay.classList.contains("active")) {
            event.stopImmediatePropagation();
            closeRemovalOverlay();
        }
    }, true);
    elements.previousPageButton.addEventListener("click", () => {
        state.page -= 1;
        renderActiveRows();
    });
    elements.nextPageButton.addEventListener("click", () => {
        state.page += 1;
        renderActiveRows();
    });
    elements.sortButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const key = button.dataset.sort;
            if (state.sortKey === key) {
                state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
            } else {
                state.sortKey = key;
                state.sortDirection = "asc";
            }
            state.page = 1;
            renderActiveRows();
        });
    });
    elements.detailClose.addEventListener("click", () => elements.detailDialog.close());
    elements.detailDialog.addEventListener("click", (event) => {
        if (event.target === elements.detailDialog) {
            elements.detailDialog.close();
        }
    });

    const exportPackage = async () => {
        const hasOutstandingInvalidMenge = state.records.some(
            (record) => record.menge_value === null && !state.removed.has(record.index),
        );
        if (!state.file || state.removed.size === 0 || hasOutstandingInvalidMenge) {
            return;
        }
        [elements.exportButton, elements.overlayExportButton].forEach((button) => {
            setBusy(true, button, "Paket wird erstellt …", "DAT + Prüfbericht herunterladen");
        });
        setStatus();
        try {
            const formData = new FormData();
            formData.append("datfile", state.file);
            formData.append("removed_indices_json", JSON.stringify(Array.from(state.removed).sort((a, b) => a - b)));
            const response = await fetch("/api/tools/datex/download", { method: "POST", body: formData });
            if (!response.ok) {
                throw new Error(await responseError(response));
            }
            const blob = await response.blob();
            const disposition = response.headers.get("Content-Disposition") || "";
            const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
            const filename = filenameMatch?.[1] || "DATExport_korrigiert.zip";
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            setStatus();
            flash("Das Korrekturpaket wurde erstellt und heruntergeladen.", "success");
        } catch (error) {
            flash(error.message || "Das Korrekturpaket konnte nicht erstellt werden.", "failure");
        } finally {
            [elements.exportButton, elements.overlayExportButton].forEach((button) => {
                setBusy(false, button, "Paket wird erstellt …", "DAT + Prüfbericht herunterladen");
                button.disabled = state.removed.size === 0 || state.records.some(
                    (record) => record.menge_value === null && !state.removed.has(record.index),
                );
            });
        }
    };
    elements.exportButton.addEventListener("click", exportPackage);
    elements.overlayExportButton.addEventListener("click", exportPackage);
});
