const requestTemplateState = {
    templates: [],
    allDocuments: [],
    templateDocuments: [],
    selectedTemplateId: null,
    selectedTemplateDocType: null,
    selectedTemplate: null,
    selectedSchema: null,
    selectionMode: "all",
    documentSearchTerm: "",
    selectedDocumentId: null,
    selectedDocumentDocType: null,
    selectedDocument: null,
    users: [],
    userSearchTerm: "",
    selectedUserId: "",
    modalFields: [],
    existingDocument: null,
    pendingDeleteDocument: null,
    templateModalMode: "create",
    isTemplateModalOpen: false,
    isDeleteModalOpen: false,
};

const requestTemplateDom = {};

const DOC_TYPE_LABELS = { word: "Word", pdf: "PDF" };

function normalizeValue(value) {
    return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseFilenameFromDisposition(dispositionHeader, fallbackName) {
    const header = String(dispositionHeader || "");
    const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch?.[1]) {
        return decodeURIComponent(utfMatch[1]);
    }

    const plainMatch = header.match(/filename="?([^";]+)"?/i);
    if (plainMatch?.[1]) {
        return plainMatch[1];
    }

    return fallbackName;
}

function buildQueryString(params = {}) {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
            return;
        }
        searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    return query ? `?${query}` : "";
}

function detectDocTypeFromFilename(filename) {
    const lowered = String(filename || "").trim().toLowerCase();
    if (lowered.endsWith(".dotx")) {
        return "word";
    }
    if (lowered.endsWith(".pdf")) {
        return "pdf";
    }
    return null;
}

function docTypeBadgeHtml(docType) {
    const label = DOC_TYPE_LABELS[docType];
    if (!label) {
        return "";
    }
    return `<span class="request-template-type-badge request-template-type-badge-${docType}">${label}</span>`;
}

const requestTemplateApi = {
    async requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json")
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const message = typeof data === "string"
                ? data
                : data?.error || data?.detail || "Die Anfrage konnte nicht verarbeitet werden.";
            throw new Error(message);
        }

        return data;
    },

    async requestBlob(url, options = {}, fallbackFilename = "document") {
        const response = await fetch(url, options);

        if (!response.ok) {
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const payload = await response.json();
                throw new Error(payload?.error || payload?.detail || "Die Datei konnte nicht geladen werden.");
            }

            throw new Error(await response.text() || "Die Datei konnte nicht geladen werden.");
        }

        const blob = await response.blob();
        const filename = parseFilenameFromDisposition(
            response.headers.get("content-disposition"),
            fallbackFilename
        );

        return { blob, filename };
    },

    listTemplates() {
        return this.requestJson("/api/dataprocessing/doc-templates");
    },

    getTemplate(templateId, docType) {
        return this.requestJson(`/api/dataprocessing/doc-templates/${encodeURIComponent(templateId)}${buildQueryString({ doc_type: docType })}`);
    },

    listDocuments(params = {}) {
        return this.requestJson(`/api/dataprocessing/doc-documents${buildQueryString(params)}`);
    },

    listTemplateUsers() {
        return this.requestJson("/api/dataprocessing/word-template-users");
    },

    createTemplate(formData) {
        return this.requestJson("/api/dataprocessing/doc-templates", {
            method: "POST",
            body: formData,
        });
    },

    updateTemplate(templateId, docType, payload) {
        return this.requestJson(`/api/dataprocessing/doc-templates/${encodeURIComponent(templateId)}${buildQueryString({ doc_type: docType })}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    prefillTemplate(templateId, docType, payload) {
        return this.requestJson(`/api/dataprocessing/doc-templates/${encodeURIComponent(templateId)}/prefill${buildQueryString({ doc_type: docType })}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    renderDownload(templateId, docType, payload, fallbackFilename) {
        return this.requestBlob(
            `/api/dataprocessing/doc-templates/${encodeURIComponent(templateId)}/render-download${buildQueryString({ doc_type: docType })}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
            fallbackFilename
        );
    },

    downloadDocument(documentId, docType, fallbackFilename = "document") {
        return this.requestBlob(
            `/api/dataprocessing/doc-documents/${encodeURIComponent(documentId)}/download${buildQueryString({ doc_type: docType })}`,
            {},
            fallbackFilename
        );
    },

    deleteDocument(documentId, docType) {
        return this.requestJson(`/api/dataprocessing/doc-documents/${encodeURIComponent(documentId)}${buildQueryString({ doc_type: docType })}`, {
            method: "DELETE",
        });
    },
};

const requestTemplateSchemaUtils = {
    example() {
        return JSON.stringify(
            {
                version: 1,
                fields: [
                    {
                        key: "kunde_name",
                        label: "Kundenname",
                        placeholder: "{{kunde_name}}",
                        type: "text",
                        required: true,
                        default: "",
                        max_length: 100,
                    },
                    {
                        key: "agb_ok",
                        label: "AGB akzeptiert",
                        placeholder: "{{agb_ok}}",
                        type: "checkbox",
                        required: true,
                        default: false,
                        true_value: "JA",
                        false_value: "NEIN",
                    },
                ],
            },
            null,
            2
        );
    },

    parse(rawValue) {
        if (rawValue && typeof rawValue === "object") {
            return { schema: rawValue, error: null };
        }

        try {
            return { schema: JSON.parse(rawValue), error: null };
        } catch (_error) {
            return { schema: null, error: "Das Schema ist kein gültiges JSON." };
        }
    },

    validate(schema) {
        if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
            return "Das Schema muss ein JSON-Objekt sein.";
        }

        if (schema.version !== 1) {
            return "schema.version muss genau 1 sein.";
        }

        if (!Array.isArray(schema.fields)) {
            return "schema.fields muss ein Array sein.";
        }

        const fieldKeys = new Set();
        const placeholders = new Set();

        for (const field of schema.fields) {
            if (!field || typeof field !== "object" || Array.isArray(field)) {
                return "Jedes Feld in schema.fields muss ein Objekt sein.";
            }

            const key = String(field.key || "").trim();
            const placeholder = String(field.placeholder || "").trim();
            const type = String(field.type || "").trim();
            const hasTypedDefault = field.default !== undefined && field.default !== null;

            if (!key) {
                return "Jedes Feld benötigt einen nicht-leeren key.";
            }

            if (!placeholder) {
                return `Das Feld "${key}" benötigt einen placeholder.`;
            }

            if (fieldKeys.has(key)) {
                return `Der key "${key}" ist mehrfach vorhanden.`;
            }

            if (placeholders.has(placeholder)) {
                return `Der placeholder "${placeholder}" ist mehrfach vorhanden.`;
            }

            if (!["text", "checkbox"].includes(type)) {
                return `Der Feldtyp "${type}" wird nicht unterstützt.`;
            }

            if (type === "text" && hasTypedDefault && typeof field.default !== "string") {
                return `Das Feld "${key}" erwartet für default einen String.`;
            }

            if (type === "checkbox" && hasTypedDefault && typeof field.default !== "boolean") {
                return `Das Feld "${key}" erwartet für default einen Boolean.`;
            }

            if (type !== "text" && field.max_length !== undefined && field.max_length !== null) {
                return `max_length ist nur für text-Felder erlaubt (${key}).`;
            }

            if (type === "text" && field.max_length !== undefined && field.max_length !== null) {
                const lengthValue = Number(field.max_length);
                if (!Number.isInteger(lengthValue) || lengthValue < 1) {
                    return `max_length muss für "${key}" eine positive Ganzzahl sein.`;
                }
            }

            fieldKeys.add(key);
            placeholders.add(placeholder);
        }

        return null;
    },

    toModalField(field) {
        if (!field || typeof field !== "object") {
            return null;
        }

        const key = String(field.key || "").trim();
        if (!key || key === "editor_name") {
            return null;
        }

        const type = String(field.type || "text").trim();
        if (!["text", "checkbox"].includes(type)) {
            return null;
        }

        const value = field.value !== undefined ? field.value : field.default;

        return {
            key,
            label: String(field.label || key).trim(),
            type,
            required: Boolean(field.required),
            placeholder: String(field.placeholder || "").trim(),
            max_length: Number.isInteger(field.max_length) ? field.max_length : null,
            value: type === "checkbox"
                ? Boolean(value)
                : value === null || value === undefined
                    ? ""
                    : String(value),
        };
    },

    buildModalFieldsFromSchema(schema) {
        const fields = Array.isArray(schema?.fields) ? schema.fields : [];
        return fields.map((field) => this.toModalField(field)).filter(Boolean);
    },

    buildModalFieldsFromPrefill(payload) {
        const fields = Array.isArray(payload?.fields) ? payload.fields : [];
        return fields.map((field) => this.toModalField(field)).filter(Boolean);
    },

    buildExistingDocument(payload, docType) {
        if (!payload?.existing_document_available || !payload?.existing_document_id) {
            return null;
        }

        return {
            documentId: String(payload.existing_document_id),
            docType: payload.doc_type || docType || null,
            filename: payload.existing_document_filename || "",
            createdAt: payload.existing_document_created_at || "",
        };
    },
};

const requestTemplateFormatters = {
    value(value) {
        if (value === null || value === undefined || value === "") {
            return "-";
        }
        return String(value);
    },

    dateTime(value) {
        if (!value) {
            return "-";
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("de-DE", {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(parsed);
    },

    userLabel(user) {
        if (!user) {
            return "Unbekannter User";
        }

        const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
        const secondary = user.email || user.pnr || user.racf || "";
        return secondary ? `${fullName || "User"} (${secondary})` : (fullName || `User #${user.user_id}`);
    },
};

const requestTemplateUi = {
    cacheDom() {
        requestTemplateDom.templateCardRow = document.getElementById("templateCardRow");

        requestTemplateDom.documentSearchInput = document.getElementById("documentSearchInput");
        requestTemplateDom.documentList = document.getElementById("documentList");
        requestTemplateDom.documentListStatus = document.getElementById("documentListStatus");
        requestTemplateDom.documentListMeta = document.getElementById("documentListMeta");

        requestTemplateDom.mainPaneKicker = document.getElementById("mainPaneKicker");
        requestTemplateDom.mainPaneTitle = document.getElementById("mainPaneTitle");
        requestTemplateDom.mainPaneMeta = document.getElementById("mainPaneMeta");
        requestTemplateDom.mainPaneStatus = document.getElementById("mainPaneStatus");
        requestTemplateDom.mainPaneEmptyState = document.getElementById("mainPaneEmptyState");
        requestTemplateDom.mainPaneGenerate = document.getElementById("mainPaneGenerate");
        requestTemplateDom.mainPaneDocumentActions = document.getElementById("mainPaneDocumentActions");
        requestTemplateDom.mainPaneDescriptionCard = document.getElementById("mainPaneDescriptionCard");
        requestTemplateDom.mainPaneDescriptionCopy = document.getElementById("mainPaneDescriptionCopy");
        requestTemplateDom.mainPaneRenderForm = document.getElementById("mainPaneRenderForm");
        requestTemplateDom.docActionSignButton = document.getElementById("docActionSignButton");
        requestTemplateDom.docActionDownloadButton = document.getElementById("docActionDownloadButton");
        requestTemplateDom.docActionSendButton = document.getElementById("docActionSendButton");
        requestTemplateDom.docActionDeleteButton = document.getElementById("docActionDeleteButton");

        requestTemplateDom.templateModalOverlay = document.getElementById("request-template-manage-modal");
        requestTemplateDom.templateModalTitle = document.getElementById("request-template-manage-modal-title");
        requestTemplateDom.templateModalSubtitle = document.getElementById("templateModalSubtitle");
        requestTemplateDom.templateModalStatus = document.getElementById("templateModalStatus");
        requestTemplateDom.templateModalForm = document.getElementById("templateModalForm");
        requestTemplateDom.templateNameInput = document.getElementById("templateNameInput");
        requestTemplateDom.templateDescriptionInput = document.getElementById("templateDescriptionInput");
        requestTemplateDom.templateSchemaInput = document.getElementById("templateSchemaInput");
        requestTemplateDom.templateFileInput = document.getElementById("templateFileInput");
        requestTemplateDom.templateFileHelp = document.getElementById("templateFileHelp");
        requestTemplateDom.templateSubmitButton = document.getElementById("templateSubmitButton");
        requestTemplateDom.templateResetButton = document.getElementById("templateResetButton");
        requestTemplateDom.closeTemplateModalButton = document.getElementById("closeTemplateModalButton");
        requestTemplateDom.cancelTemplateModalButton = document.getElementById("cancelTemplateModalButton");

        requestTemplateDom.existingDocumentCard = document.getElementById("existingDocumentCard");
        requestTemplateDom.existingDocumentCopy = document.getElementById("existingDocumentCopy");
        requestTemplateDom.openExistingDocumentButton = document.getElementById("openExistingDocumentButton");
        requestTemplateDom.renderUserSearchInput = document.getElementById("renderUserSearchInput");
        requestTemplateDom.renderUserSelect = document.getElementById("renderUserSelect");
        requestTemplateDom.prefillTemplateButton = document.getElementById("prefillTemplateButton");
        requestTemplateDom.renderModalForm = document.getElementById("renderModalForm");
        requestTemplateDom.renderModalFields = document.getElementById("renderModalFields");
        requestTemplateDom.renderModalSubmitButton = document.getElementById("renderModalSubmitButton");

        requestTemplateDom.deleteModalOverlay = document.getElementById("request-document-delete-modal");
        requestTemplateDom.documentDeleteStatus = document.getElementById("documentDeleteStatus");
        requestTemplateDom.documentDeleteName = document.getElementById("documentDeleteName");
        requestTemplateDom.documentDeleteMeta = document.getElementById("documentDeleteMeta");
        requestTemplateDom.closeDocumentDeleteModalButton = document.getElementById("closeDocumentDeleteModalButton");
        requestTemplateDom.cancelDocumentDeleteModalButton = document.getElementById("cancelDocumentDeleteModalButton");
        requestTemplateDom.confirmDocumentDeleteButton = document.getElementById("confirmDocumentDeleteButton");
    },

    setStatus(element, tone, message) {
        if (!element) {
            return;
        }

        element.className = `request-template-status request-template-status-${tone}`;
        element.innerHTML = message;
    },

    setTemplateModalSubmitLoading(isLoading) {
        requestTemplateDom.templateSubmitButton.disabled = isLoading;
        requestTemplateDom.templateResetButton.disabled = isLoading;

        if (requestTemplateState.templateModalMode === "edit") {
            requestTemplateDom.templateSubmitButton.textContent = isLoading ? "Vorlage wird aktualisiert..." : "Vorlage aktualisieren";
            return;
        }

        requestTemplateDom.templateSubmitButton.textContent = isLoading ? "Vorlage wird gespeichert..." : "Vorlage speichern";
    },

    setRenderActionLoading(isLoading, mode = "prefill") {
        requestTemplateDom.prefillTemplateButton.disabled = isLoading;
        requestTemplateDom.renderModalSubmitButton.disabled = isLoading;
        if (requestTemplateDom.openExistingDocumentButton) {
            requestTemplateDom.openExistingDocumentButton.disabled = isLoading;
        }

        if (mode === "prefill") {
            requestTemplateDom.prefillTemplateButton.textContent = isLoading ? "Vorlage wird gefüllt..." : "Vorlage automatisch ausfüllen";
            return;
        }

        requestTemplateDom.renderModalSubmitButton.textContent = isLoading ? "Dokument wird erzeugt..." : "Dokument erzeugen";
    },

    setDeleteActionLoading(isLoading) {
        requestTemplateDom.confirmDocumentDeleteButton.disabled = isLoading;
        requestTemplateDom.cancelDocumentDeleteModalButton.disabled = isLoading;
        requestTemplateDom.closeDocumentDeleteModalButton.disabled = isLoading;
        requestTemplateDom.confirmDocumentDeleteButton.textContent = isLoading ? "Dokument wird gelöscht..." : "Dokument löschen";
    },

    downloadBlob(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = blobUrl;
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(blobUrl);
    },

    renderTemplateCardRow() {
        const row = requestTemplateDom.templateCardRow;
        if (!row) {
            return;
        }

        row.innerHTML = "";

        const allCard = document.createElement("button");
        allCard.type = "button";
        allCard.className = "request-template-card request-template-card-all";
        if (requestTemplateState.selectionMode === "all") {
            allCard.classList.add("is-active");
        }
        allCard.innerHTML = `
            <span class="request-template-card-title">Alle Dokumente</span>
            <span class="request-template-card-meta">${requestTemplateState.allDocuments.length} Dokument(e)</span>
        `;
        allCard.addEventListener("click", () => requestTemplateHandlers.selectAllDocumentsMode());
        row.appendChild(allCard);

        const divider = document.createElement("div");
        divider.className = "request-template-card-divider";
        row.appendChild(divider);

        requestTemplateState.templates.forEach((template) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "request-template-card";

            const isActive = requestTemplateState.selectionMode === "template"
                && String(template.template_id) === String(requestTemplateState.selectedTemplateId)
                && String(template.doc_type || "") === String(requestTemplateState.selectedTemplateDocType || "");
            if (isActive) {
                card.classList.add("is-active");
            }

            card.innerHTML = `
                <span class="request-template-card-title">${docTypeBadgeHtml(template.doc_type)}${escapeHtml(requestTemplateFormatters.value(template.name))}</span>
                <span class="request-template-card-meta">${escapeHtml(requestTemplateFormatters.value(template.original_filename))}</span>
            `;

            if (isActive) {
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.className = "request-template-card-edit";
                editButton.setAttribute("aria-label", "Vorlage bearbeiten");
                editButton.innerHTML = "&#9998;";
                editButton.addEventListener("click", (event) => {
                    event.stopPropagation();
                    requestTemplateHandlers.openEditTemplateModal();
                });
                card.appendChild(editButton);
            }

            card.addEventListener("click", () => requestTemplateHandlers.selectTemplate(template.template_id, template.doc_type));
            row.appendChild(card);
        });

        const addCard = document.createElement("button");
        addCard.type = "button";
        addCard.className = "request-template-card request-template-card-add";
        addCard.textContent = "+ Neue Vorlage";
        addCard.addEventListener("click", () => requestTemplateHandlers.openCreateTemplateModal());
        row.appendChild(addCard);
    },

    renderDocumentList() {
        const list = requestTemplateDom.documentList;
        if (!list) {
            return;
        }

        list.innerHTML = "";

        const isTemplateMode = requestTemplateState.selectionMode === "template";
        const selectedTemplateId = String(requestTemplateState.selectedTemplateId || "");
        const selectedTemplateDocType = String(requestTemplateState.selectedTemplateDocType || "");
        const rawDocuments = isTemplateMode ? requestTemplateState.templateDocuments : requestTemplateState.allDocuments;
        const documents = isTemplateMode && selectedTemplateId
            ? rawDocuments.filter((documentItem) => String(documentItem.template_id || "") === selectedTemplateId
                && String(documentItem.doc_type || "") === selectedTemplateDocType)
            : rawDocuments;

        const searchTerm = normalizeValue(requestTemplateState.documentSearchTerm);
        const visibleDocuments = searchTerm
            ? documents.filter((documentItem) => normalizeValue(documentItem.output_filename).includes(searchTerm))
            : documents;

        requestTemplateDom.documentListMeta.textContent = `${visibleDocuments.length} Dokument(e)`;

        if (isTemplateMode) {
            const newItem = document.createElement("button");
            newItem.type = "button";
            newItem.className = "request-template-explorer-item request-template-explorer-item-new";
            if (requestTemplateState.selectedDocumentId === "new") {
                newItem.classList.add("is-active");
            }
            newItem.textContent = "+ Neues Dokument";
            newItem.addEventListener("click", () => requestTemplateHandlers.selectNewDocument());
            list.appendChild(newItem);
        }

        if (!visibleDocuments.length) {
            const placeholder = document.createElement("div");
            placeholder.className = "is-placeholder";
            const noDocumentsAtAll = !documents.length;
            const heading = noDocumentsAtAll ? "Keine Dokumente gefunden" : "Keine Treffer für die Suche";
            const copy = noDocumentsAtAll
                ? (isTemplateMode ? "Für diese Vorlage wurden noch keine Dokumente erzeugt." : "Es wurden noch keine Dokumente erzeugt.")
                : "Für die aktuelle Suche wurden keine passenden Dokumente gefunden.";
            placeholder.innerHTML = `
                <strong>${heading}</strong>
                <p>${copy}</p>
            `;
            list.appendChild(placeholder);
            return;
        }

        visibleDocuments.forEach((documentItem) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "request-template-explorer-item";
            item.title = requestTemplateFormatters.value(documentItem.output_filename);
            if (
                String(documentItem.document_id) === String(requestTemplateState.selectedDocumentId)
                && String(documentItem.doc_type || "") === String(requestTemplateState.selectedDocumentDocType || "")
            ) {
                item.classList.add("is-active");
            }

            item.innerHTML = `
                <span class="request-template-explorer-item-title">${docTypeBadgeHtml(documentItem.doc_type)}${escapeHtml(requestTemplateFormatters.value(documentItem.output_filename))}</span>
                <p class="request-template-explorer-item-meta">${escapeHtml(requestTemplateFormatters.value(documentItem.template_name || documentItem.template_id))} · ${escapeHtml(requestTemplateFormatters.dateTime(documentItem.created_at))}</p>
            `;

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "request-template-explorer-item-delete";
            deleteButton.setAttribute("aria-label", "Dokument löschen");
            deleteButton.innerHTML = "&times;";
            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                requestTemplateHandlers.openDeleteDocumentModal(documentItem);
            });
            item.appendChild(deleteButton);

            item.addEventListener("click", () => requestTemplateHandlers.selectDocument(documentItem));
            list.appendChild(item);
        });
    },

    setMainPaneState(state) {
        const isForm = state === "form";
        requestTemplateDom.mainPaneEmptyState.hidden = isForm;
        requestTemplateDom.mainPaneGenerate.hidden = !isForm;
    },

    renderDescriptionCard() {
        const template = requestTemplateState.selectedTemplate;
        if (!template) {
            requestTemplateDom.mainPaneDescriptionCard.hidden = true;
            return;
        }

        const description = String(template.description || "").trim();
        requestTemplateDom.mainPaneDescriptionCopy.textContent = description || "Für diese Vorlage wurde noch keine Beschreibung hinterlegt.";
        requestTemplateDom.mainPaneDescriptionCard.hidden = false;
    },

    syncMainPaneSections() {
        const documentItem = requestTemplateState.selectedDocument;
        requestTemplateDom.mainPaneDocumentActions.hidden = !documentItem;

        if (documentItem) {
            requestTemplateDom.docActionDownloadButton.onclick = () => requestTemplateHandlers.downloadDocument(documentItem.document_id, documentItem.doc_type, documentItem.output_filename);
            requestTemplateDom.docActionDeleteButton.onclick = () => requestTemplateHandlers.openDeleteDocumentModal(documentItem);
        } else {
            requestTemplateDom.docActionDownloadButton.onclick = null;
            requestTemplateDom.docActionDeleteButton.onclick = null;
        }

        requestTemplateDom.mainPaneRenderForm.hidden = requestTemplateState.selectedDocumentId !== "new";
        requestTemplateUi.renderDescriptionCard();
    },

    prepareTemplateModalCreate() {
        requestTemplateState.templateModalMode = "create";
        requestTemplateDom.templateModalForm.reset();
        requestTemplateDom.templateModalTitle.textContent = "Neue Vorlage anlegen";
        requestTemplateDom.templateModalSubtitle.innerHTML = 'Name, Beschreibung, Schema und Vorlagendatei werden hier gepflegt.';
        requestTemplateDom.templateSchemaInput.value = requestTemplateSchemaUtils.example();
        requestTemplateDom.templateFileInput.value = "";
        requestTemplateDom.templateFileInput.disabled = false;
        requestTemplateDom.templateFileInput.required = true;
        requestTemplateDom.templateSubmitButton.textContent = "Vorlage speichern";
        requestTemplateDom.templateResetButton.textContent = "Formular zurücksetzen";
        requestTemplateDom.templateFileHelp.innerHTML = 'Erlaubt sind ausschließlich <code>.dotx</code>- oder <code>.pdf</code>-Dateien.';
        this.setStatus(
            requestTemplateDom.templateModalStatus,
            "info",
            'Lege hier eine neue Vorlage mit <code>.dotx</code>- oder <code>.pdf</code>-Datei und JSON-Schema an.'
        );
    },

    updateCreateFileHint(file) {
        if (requestTemplateState.templateModalMode !== "create") {
            return;
        }

        const docType = file ? detectDocTypeFromFilename(file.name) : null;

        if (docType === "word") {
            requestTemplateDom.templateFileHelp.innerHTML = 'Erkannt: <strong>Word-Vorlage</strong> (<code>.dotx</code>).';
            return;
        }

        if (docType === "pdf") {
            requestTemplateDom.templateFileHelp.innerHTML = 'Erkannt: <strong>PDF-Vorlage</strong> (AcroForm). Checkbox-Felder verwenden standardmäßig <code>"Yes"/"Off"</code>, abweichende Werte können je Feld über <code>true_value</code>/<code>false_value</code> gesetzt werden.';
            return;
        }

        if (file) {
            requestTemplateDom.templateFileHelp.innerHTML = 'Unbekanntes Dateiformat. Erlaubt sind ausschließlich <code>.dotx</code>- oder <code>.pdf</code>-Dateien.';
            return;
        }

        requestTemplateDom.templateFileHelp.innerHTML = 'Erlaubt sind ausschließlich <code>.dotx</code>- oder <code>.pdf</code>-Dateien.';
    },

    populateTemplateModalForEdit(template, schema) {
        requestTemplateState.templateModalMode = "edit";
        requestTemplateDom.templateNameInput.value = template.name || "";
        requestTemplateDom.templateDescriptionInput.value = template.description || "";
        requestTemplateDom.templateSchemaInput.value = JSON.stringify(schema, null, 2);
        requestTemplateDom.templateFileInput.value = "";
        requestTemplateDom.templateFileInput.disabled = true;
        requestTemplateDom.templateFileInput.required = false;
        requestTemplateDom.templateModalTitle.textContent = "Vorlage bearbeiten";
        requestTemplateDom.templateModalSubtitle.innerHTML = `Bearbeite Metadaten und Schema der Vorlage <code>${escapeHtml(requestTemplateFormatters.value(template.template_id))}</code>.`;
        requestTemplateDom.templateSubmitButton.textContent = "Vorlage aktualisieren";
        requestTemplateDom.templateResetButton.textContent = "Änderungen verwerfen";
        const extensionLabel = template.doc_type === "pdf" ? ".pdf" : ".dotx";
        requestTemplateDom.templateFileHelp.innerHTML = `Aktive Datei: <code>${escapeHtml(requestTemplateFormatters.value(template.original_filename))}</code>. Der Austausch der <code>${extensionLabel}</code>-Datei ist in V1 nicht vorgesehen.`;
        this.setStatus(
            requestTemplateDom.templateModalStatus,
            "info",
            `Die Vorlage <strong>${escapeHtml(requestTemplateFormatters.value(template.name))}</strong> kann jetzt angepasst werden.`
        );
    },

    openTemplateModal() {
        requestTemplateDom.templateModalOverlay.classList.add("active");
        requestTemplateDom.templateModalOverlay.setAttribute("aria-hidden", "false");
        requestTemplateState.isTemplateModalOpen = true;
        document.body.style.overflow = "hidden";
    },

    closeTemplateModal() {
        requestTemplateDom.templateModalOverlay.classList.remove("active");
        requestTemplateDom.templateModalOverlay.setAttribute("aria-hidden", "true");
        requestTemplateState.isTemplateModalOpen = false;
        if (!requestTemplateState.isDeleteModalOpen) {
            document.body.style.overflow = "";
        }
    },

    renderDeleteDocumentModal() {
        const documentItem = requestTemplateState.pendingDeleteDocument;
        if (!documentItem) {
            requestTemplateDom.documentDeleteName.textContent = "Kein Dokument ausgewählt";
            requestTemplateDom.documentDeleteMeta.textContent = "Nach Auswahl eines Dokuments werden Dateiname, Vorlage und Erstellzeitpunkt hier angezeigt.";
            return;
        }

        requestTemplateDom.documentDeleteName.textContent = requestTemplateFormatters.value(documentItem.output_filename);
        requestTemplateDom.documentDeleteMeta.textContent = `${requestTemplateFormatters.value(documentItem.template_name || documentItem.template_id)} · erstellt ${requestTemplateFormatters.dateTime(documentItem.created_at)}`;
    },

    openDeleteModal() {
        requestTemplateDom.deleteModalOverlay.classList.add("active");
        requestTemplateDom.deleteModalOverlay.setAttribute("aria-hidden", "false");
        requestTemplateState.isDeleteModalOpen = true;
        document.body.style.overflow = "hidden";
    },

    closeDeleteModal() {
        requestTemplateDom.deleteModalOverlay.classList.remove("active");
        requestTemplateDom.deleteModalOverlay.setAttribute("aria-hidden", "true");
        requestTemplateState.isDeleteModalOpen = false;
        if (!requestTemplateState.isTemplateModalOpen) {
            document.body.style.overflow = "";
        }
    },

    renderExistingDocumentCard() {
        const existingDocument = requestTemplateState.existingDocument;
        if (!existingDocument) {
            requestTemplateDom.existingDocumentCard.hidden = true;
            requestTemplateDom.existingDocumentCopy.textContent = "Für diesen Kontext existiert bereits eine letzte generierte Version.";
            return;
        }

        const filename = requestTemplateFormatters.value(existingDocument.filename);
        const createdAt = requestTemplateFormatters.dateTime(existingDocument.createdAt);
        requestTemplateDom.existingDocumentCopy.textContent = `Es existiert bereits ${filename}. Erstellt am ${createdAt}.`;
        requestTemplateDom.existingDocumentCard.hidden = false;
    },

    renderUserOptions() {
        const select = requestTemplateDom.renderUserSelect;
        const visibleUsers = requestTemplateHandlers.getVisibleUsers();

        select.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = visibleUsers.length ? "User auswählen" : "Keine passenden User gefunden";
        select.appendChild(placeholder);

        visibleUsers.forEach((user) => {
            const option = document.createElement("option");
            option.value = String(user.user_id);
            option.textContent = requestTemplateFormatters.userLabel(user);
            if (String(user.user_id) === String(requestTemplateState.selectedUserId)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (
            requestTemplateState.selectedUserId
            && !visibleUsers.some((user) => String(user.user_id) === String(requestTemplateState.selectedUserId))
        ) {
            select.value = "";
        }
    },

    renderModalFields() {
        const container = requestTemplateDom.renderModalFields;
        container.innerHTML = "";

        if (!requestTemplateState.modalFields.length) {
            container.innerHTML = `
                <div class="request-template-empty-state">
                    <strong>Keine editierbaren Felder</strong>
                    <p>Diese Vorlage enthält aktuell keine sichtbaren Formularfelder. Das Dokument kann trotzdem direkt erzeugt werden.</p>
                </div>
            `;
            return;
        }

        requestTemplateState.modalFields.forEach((field, index) => {
            const wrapper = document.createElement("div");
            wrapper.className = "request-template-render-field";

            const requiredLabel = field.required ? "Pflichtfeld" : "Optional";
            const metaParts = [];
            if (field.placeholder) {
                metaParts.push(field.placeholder);
            }
            metaParts.push(requiredLabel);
            if (Number.isInteger(field.max_length)) {
                metaParts.push(`max. ${field.max_length} Zeichen`);
            }

            if (field.type === "checkbox") {
                const inputId = `render-modal-field-${index}`;
                wrapper.innerHTML = `
                    <label for="${inputId}">${escapeHtml(field.label)}</label>
                    <p class="request-template-render-field-copy">${escapeHtml(metaParts.join(" · "))}</p>
                    <label class="request-template-checkbox-row" for="${inputId}">
                        <input id="${inputId}" type="checkbox" data-modal-field-index="${index}" ${field.value ? "checked" : ""}>
                        <span>Wert setzen</span>
                    </label>
                `;
                container.appendChild(wrapper);
                return;
            }

            const input = document.createElement("input");
            input.type = "text";
            input.className = "request-template-input";
            input.id = `render-modal-field-${index}`;
            input.value = field.value || "";
            input.placeholder = field.placeholder || "";
            input.dataset.modalFieldIndex = String(index);
            if (Number.isInteger(field.max_length)) {
                input.maxLength = field.max_length;
            }

            wrapper.innerHTML = `
                <label for="${input.id}">${escapeHtml(field.label)}</label>
                <p class="request-template-render-field-copy">${escapeHtml(metaParts.join(" · "))}</p>
            `;
            wrapper.appendChild(input);
            container.appendChild(wrapper);
        });
    },
};

const requestTemplateHandlers = {
    async loadTemplates(options = {}) {
        const { selectTemplateId = null, selectTemplateDocType = null } = options;

        try {
            const templates = await requestTemplateApi.listTemplates();
            requestTemplateState.templates = Array.isArray(templates) ? templates : [];
            requestTemplateUi.renderTemplateCardRow();

            if (selectTemplateId) {
                await this.selectTemplate(selectTemplateId, selectTemplateDocType);
                return;
            }

            if (
                requestTemplateState.selectedTemplateId
                && !requestTemplateState.templates.some((template) => String(template.template_id) === String(requestTemplateState.selectedTemplateId)
                    && String(template.doc_type || "") === String(requestTemplateState.selectedTemplateDocType || ""))
            ) {
                await this.selectAllDocumentsMode();
            }
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.documentListStatus,
                "error",
                error.message || "Vorlagen konnten nicht geladen werden."
            );
        }
    },

    async loadDocuments(options = {}) {
        const { mode = requestTemplateState.selectionMode } = options;

        if (mode === "template" && !requestTemplateState.selectedTemplateId) {
            requestTemplateUi.setStatus(
                requestTemplateDom.documentListStatus,
                "info",
                "Wähle zuerst eine Vorlage aus, um deren Dokumente anzuzeigen."
            );
            requestTemplateDom.documentListStatus.hidden = false;
            requestTemplateUi.renderDocumentList();
            return;
        }

        requestTemplateDom.documentListStatus.hidden = true;

        try {
            const documents = await requestTemplateApi.listDocuments(
                mode === "template"
                    ? { template_id: requestTemplateState.selectedTemplateId, doc_type: requestTemplateState.selectedTemplateDocType }
                    : {}
            );
            const normalizedDocuments = Array.isArray(documents) ? documents : [];

            if (mode === "template") {
                requestTemplateState.templateDocuments = normalizedDocuments;
            } else {
                requestTemplateState.allDocuments = normalizedDocuments;
                requestTemplateUi.renderTemplateCardRow();
            }

            requestTemplateUi.renderDocumentList();
            requestTemplateDom.documentListStatus.hidden = true;
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.documentListStatus,
                "error",
                error.message || "Die Dokumentenliste konnte nicht geladen werden."
            );
            requestTemplateDom.documentListStatus.hidden = false;
            requestTemplateUi.renderDocumentList();
        }
    },

    async selectAllDocumentsMode() {
        requestTemplateState.selectionMode = "all";
        requestTemplateState.selectedTemplateId = null;
        requestTemplateState.selectedTemplateDocType = null;
        requestTemplateState.selectedTemplate = null;
        requestTemplateState.selectedSchema = null;
        requestTemplateState.selectedDocumentId = null;
        requestTemplateState.selectedDocumentDocType = null;
        requestTemplateState.selectedDocument = null;
        requestTemplateState.modalFields = [];

        requestTemplateDom.mainPaneKicker.textContent = "Übersicht";
        requestTemplateDom.mainPaneTitle.textContent = "Alle Dokumente";
        requestTemplateDom.mainPaneMeta.textContent = "";
        requestTemplateDom.mainPaneStatus.hidden = true;
        requestTemplateDom.mainPaneEmptyState.querySelector("strong").textContent = "Kein Dokument ausgewählt";
        requestTemplateDom.mainPaneEmptyState.querySelector("p").textContent = "Wähle links ein Dokument aus der Liste oder wähle oben eine Vorlage aus, um ein neues Dokument zu erstellen.";
        requestTemplateUi.setMainPaneState("empty");
        requestTemplateUi.syncMainPaneSections();

        requestTemplateUi.renderTemplateCardRow();
        await this.loadDocuments({ mode: "all" });
    },

    async selectTemplate(templateId, docType) {
        requestTemplateState.selectionMode = "template";
        requestTemplateState.selectedTemplateId = String(templateId);
        requestTemplateState.selectedTemplateDocType = docType || null;
        requestTemplateState.selectedDocumentId = null;
        requestTemplateState.selectedDocumentDocType = null;
        requestTemplateState.selectedDocument = null;
        requestTemplateUi.renderTemplateCardRow();
        requestTemplateUi.setMainPaneState("empty");
        requestTemplateDom.mainPaneStatus.hidden = false;
        requestTemplateUi.setStatus(requestTemplateDom.mainPaneStatus, "info", "Vorlagendetails werden geladen...");

        try {
            const template = await requestTemplateApi.getTemplate(templateId, requestTemplateState.selectedTemplateDocType);
            requestTemplateState.selectedTemplateDocType = template.doc_type || requestTemplateState.selectedTemplateDocType;
            const { schema, error: parseError } = requestTemplateSchemaUtils.parse(template.schema_json || "{}");
            if (parseError) {
                throw new Error(parseError);
            }

            const validationError = requestTemplateSchemaUtils.validate(schema);
            if (validationError) {
                throw new Error(validationError);
            }

            requestTemplateState.selectedTemplate = template;
            requestTemplateState.selectedSchema = schema;
            requestTemplateState.modalFields = requestTemplateSchemaUtils.buildModalFieldsFromSchema(schema);

            requestTemplateDom.mainPaneKicker.textContent = "Übersicht";
            requestTemplateDom.mainPaneTitle.textContent = requestTemplateFormatters.value(template.name);
            requestTemplateDom.mainPaneMeta.textContent = "";
            requestTemplateDom.mainPaneEmptyState.querySelector("strong").textContent = "Kein Dokument ausgewählt";
            requestTemplateDom.mainPaneEmptyState.querySelector("p").textContent = `Wähle links ein Dokument aus der Liste oder erstelle über "+ Neues Dokument" ein neues Dokument für "${requestTemplateFormatters.value(template.name)}".`;
            requestTemplateDom.mainPaneStatus.hidden = true;
            requestTemplateUi.renderDescriptionCard();

            requestTemplateUi.renderTemplateCardRow();
            await this.loadDocuments({ mode: "template" });
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.mainPaneStatus,
                "error",
                error.message || "Die Vorlage konnte nicht geladen werden."
            );
        }
    },

    selectNewDocument() {
        if (!requestTemplateState.selectedTemplate || !requestTemplateState.selectedSchema) {
            return;
        }

        requestTemplateState.selectedDocumentId = "new";
        requestTemplateState.selectedDocumentDocType = requestTemplateState.selectedTemplateDocType;
        requestTemplateState.selectedDocument = null;
        requestTemplateState.modalFields = requestTemplateSchemaUtils.buildModalFieldsFromSchema(requestTemplateState.selectedSchema);
        requestTemplateState.selectedUserId = "";
        requestTemplateState.userSearchTerm = "";
        requestTemplateState.existingDocument = null;

        requestTemplateDom.mainPaneKicker.textContent = "Neues Dokument";
        requestTemplateDom.mainPaneTitle.textContent = requestTemplateState.selectedTemplate.name || "Dokument erstellen";
        requestTemplateDom.mainPaneMeta.textContent = "";
        requestTemplateDom.renderUserSearchInput.value = "";

        requestTemplateUi.renderExistingDocumentCard();
        requestTemplateUi.renderUserOptions();
        requestTemplateUi.renderModalFields();
        requestTemplateUi.syncMainPaneSections();
        requestTemplateDom.mainPaneStatus.hidden = true;
        requestTemplateUi.setMainPaneState("form");
        requestTemplateUi.renderDocumentList();
        this.ensureUsersLoaded();
    },

    async selectDocument(documentItem) {
        if (requestTemplateState.selectionMode === "all") {
            await this.selectTemplate(documentItem.template_id, documentItem.doc_type);
        }

        requestTemplateState.selectedDocumentId = documentItem.document_id;
        requestTemplateState.selectedDocumentDocType = documentItem.doc_type;
        requestTemplateState.selectedDocument = documentItem;
        requestTemplateState.existingDocument = null;

        requestTemplateDom.mainPaneKicker.textContent = "Dokument";
        requestTemplateDom.mainPaneTitle.textContent = requestTemplateFormatters.value(documentItem.output_filename);
        requestTemplateDom.mainPaneMeta.textContent = `Erstellt ${requestTemplateFormatters.dateTime(documentItem.created_at)}`;
        requestTemplateDom.mainPaneStatus.hidden = true;

        requestTemplateUi.syncMainPaneSections();
        requestTemplateUi.setMainPaneState("form");
        requestTemplateUi.renderDocumentList();
    },

    openCreateTemplateModal() {
        requestTemplateUi.prepareTemplateModalCreate();
        requestTemplateUi.openTemplateModal();
        requestTemplateDom.templateNameInput.focus();
    },

    openEditTemplateModal() {
        if (!requestTemplateState.selectedTemplate || !requestTemplateState.selectedSchema) {
            requestTemplateUi.setStatus(
                requestTemplateDom.documentListStatus,
                "error",
                "Bitte wählen Sie zuerst eine Vorlage aus, bevor Sie sie bearbeiten."
            );
            return;
        }

        requestTemplateUi.populateTemplateModalForEdit(requestTemplateState.selectedTemplate, requestTemplateState.selectedSchema);
        requestTemplateUi.openTemplateModal();
        requestTemplateDom.templateNameInput.focus();
    },

    closeTemplateModal() {
        requestTemplateUi.closeTemplateModal();
    },

    openDeleteDocumentModal(documentItem) {
        requestTemplateState.pendingDeleteDocument = documentItem || null;
        requestTemplateUi.renderDeleteDocumentModal();
        requestTemplateUi.setStatus(
            requestTemplateDom.documentDeleteStatus,
            "info",
            "Prüfe die Dokumentdaten und bestätige das Löschen nur, wenn die Datei nicht mehr benötigt wird."
        );
        requestTemplateUi.openDeleteModal();
    },

    closeDeleteDocumentModal() {
        requestTemplateState.pendingDeleteDocument = null;
        requestTemplateUi.closeDeleteModal();
        requestTemplateUi.renderDeleteDocumentModal();
    },

    resetTemplateModal() {
        if (requestTemplateState.templateModalMode === "edit" && requestTemplateState.selectedTemplate && requestTemplateState.selectedSchema) {
            requestTemplateUi.populateTemplateModalForEdit(requestTemplateState.selectedTemplate, requestTemplateState.selectedSchema);
            return;
        }

        requestTemplateUi.prepareTemplateModalCreate();
    },

    validateCreateFile(file) {
        if (!file) {
            return "Bitte wählen Sie eine .dotx- oder .pdf-Datei aus.";
        }

        if (!detectDocTypeFromFilename(file.name)) {
            return "Die Vorlagendatei muss die Endung .dotx oder .pdf haben.";
        }

        return null;
    },

    handleTemplateFileChange(event) {
        requestTemplateUi.updateCreateFileHint(event.target.files?.[0] || null);
    },

    async handleTemplateModalSubmit(event) {
        event.preventDefault();

        const name = requestTemplateDom.templateNameInput.value.trim();
        const description = requestTemplateDom.templateDescriptionInput.value.trim();
        const rawSchema = requestTemplateDom.templateSchemaInput.value.trim();
        const { schema, error: parseError } = requestTemplateSchemaUtils.parse(rawSchema);

        if (parseError) {
            requestTemplateUi.setStatus(requestTemplateDom.templateModalStatus, "error", parseError);
            return;
        }

        const validationError = requestTemplateSchemaUtils.validate(schema);
        if (validationError) {
            requestTemplateUi.setStatus(requestTemplateDom.templateModalStatus, "error", validationError);
            return;
        }

        if (!name) {
            requestTemplateUi.setStatus(requestTemplateDom.templateModalStatus, "error", "Der Vorlagenname ist erforderlich.");
            return;
        }

        requestTemplateUi.setTemplateModalSubmitLoading(true);

        try {
            if (requestTemplateState.templateModalMode === "edit" && requestTemplateState.selectedTemplateId) {
                const updated = await requestTemplateApi.updateTemplate(requestTemplateState.selectedTemplateId, requestTemplateState.selectedTemplateDocType, {
                    name,
                    description,
                    schema,
                });

                requestTemplateUi.closeTemplateModal();
                await this.loadTemplates({
                    selectTemplateId: updated.template_id || requestTemplateState.selectedTemplateId,
                    selectTemplateDocType: updated.doc_type || requestTemplateState.selectedTemplateDocType,
                });
                return;
            }

            const file = requestTemplateDom.templateFileInput.files?.[0];
            const fileError = this.validateCreateFile(file);
            if (fileError) {
                requestTemplateUi.setStatus(requestTemplateDom.templateModalStatus, "error", fileError);
                return;
            }

            const formData = new FormData();
            formData.append("name", name);
            formData.append("description", description);
            formData.append("schema_json", JSON.stringify(schema));
            formData.append("template_file", file);

            const created = await requestTemplateApi.createTemplate(formData);
            requestTemplateUi.closeTemplateModal();
            await this.loadTemplates({
                selectTemplateId: created.template_id,
                selectTemplateDocType: created.doc_type,
            });
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.templateModalStatus,
                "error",
                error.message || "Die Vorlage konnte nicht gespeichert werden."
            );
        } finally {
            requestTemplateUi.setTemplateModalSubmitLoading(false);
        }
    },

    getVisibleUsers() {
        const search = normalizeValue(requestTemplateState.userSearchTerm);
        const allUsers = Array.isArray(requestTemplateState.users) ? requestTemplateState.users : [];
        const filteredUsers = search
            ? allUsers.filter((user) => {
                const haystack = [
                    user.first_name,
                    user.last_name,
                    user.email,
                    user.pnr,
                    user.racf,
                ]
                    .map(normalizeValue)
                    .join(" ");
                return haystack.includes(search);
            })
            : allUsers.slice();

        if (!requestTemplateState.selectedUserId) {
            return filteredUsers;
        }

        const selected = allUsers.find((user) => String(user.user_id) === String(requestTemplateState.selectedUserId));
        if (!selected || filteredUsers.some((user) => String(user.user_id) === String(selected.user_id))) {
            return filteredUsers;
        }

        return [selected, ...filteredUsers];
    },

    async ensureUsersLoaded() {
        if (requestTemplateState.users.length) {
            requestTemplateUi.renderUserOptions();
            return;
        }

        try {
            const users = await requestTemplateApi.listTemplateUsers();
            requestTemplateState.users = Array.isArray(users) ? users : [];
            requestTemplateUi.renderUserOptions();
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.mainPaneStatus,
                "error",
                error.message || "Die User-Liste konnte nicht geladen werden."
            );
            requestTemplateDom.mainPaneStatus.hidden = false;
        }
    },

    async handlePrefillClick() {
        if (!requestTemplateState.selectedTemplateId) {
            requestTemplateUi.setStatus(requestTemplateDom.mainPaneStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            requestTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        if (!requestTemplateState.selectedUserId) {
            requestTemplateUi.setStatus(requestTemplateDom.mainPaneStatus, "error", "Bitte wählen Sie einen User zum Vorbefüllen aus.");
            requestTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        requestTemplateUi.setRenderActionLoading(true, "prefill");

        try {
            const payload = await requestTemplateApi.prefillTemplate(requestTemplateState.selectedTemplateId, requestTemplateState.selectedTemplateDocType, {
                user_id: requestTemplateState.selectedUserId,
            });
            requestTemplateState.modalFields = requestTemplateSchemaUtils.buildModalFieldsFromPrefill(payload);
            requestTemplateState.existingDocument = requestTemplateSchemaUtils.buildExistingDocument(payload, requestTemplateState.selectedTemplateDocType);
            requestTemplateUi.renderExistingDocumentCard();
            requestTemplateUi.renderModalFields();
            showFlash(
                requestTemplateState.existingDocument
                    ? "Die Vorlage wurde vorbefüllt. Zusätzlich steht die letzte bereits generierte Version direkt zum Öffnen bereit."
                    : "Die Vorlage wurde mit den verfügbaren Userdaten vorbefüllt. Alle sichtbaren Felder können vor dem Download noch angepasst werden.",
                "success"
            );
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.mainPaneStatus,
                "error",
                error.message || "Die Vorlage konnte nicht automatisch ausgefüllt werden."
            );
            requestTemplateDom.mainPaneStatus.hidden = false;
        } finally {
            requestTemplateUi.setRenderActionLoading(false, "prefill");
        }
    },

    collectModalValues() {
        const values = {};

        for (const [index, field] of requestTemplateState.modalFields.entries()) {
            const input = requestTemplateDom.renderModalFields.querySelector(`[data-modal-field-index="${index}"]`);
            if (!input) {
                return { values: null, error: `Das Eingabefeld für "${field.label}" konnte nicht gefunden werden.` };
            }

            if (field.type === "checkbox") {
                values[field.key] = Boolean(input.checked);
                continue;
            }

            const rawValue = String(input.value || "");
            if (field.required && !rawValue.trim()) {
                return { values: null, error: `Das Pflichtfeld "${field.label}" muss ausgefüllt werden.` };
            }

            if (Number.isInteger(field.max_length) && rawValue.length > field.max_length) {
                return { values: null, error: `Das Feld "${field.label}" überschreitet die maximale Länge von ${field.max_length}.` };
            }

            values[field.key] = rawValue;
        }

        return { values, error: null };
    },

    async handleRenderModalSubmit(event) {
        event.preventDefault();

        if (!requestTemplateState.selectedTemplateId) {
            requestTemplateUi.setStatus(requestTemplateDom.mainPaneStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            requestTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        const { values, error } = this.collectModalValues();
        if (error) {
            requestTemplateUi.setStatus(requestTemplateDom.mainPaneStatus, "error", error);
            requestTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        requestTemplateUi.setRenderActionLoading(true, "render");

        try {
            const fallbackExtension = requestTemplateState.selectedTemplateDocType === "pdf" ? "pdf" : "docx";
            const fallbackFilename = `${(requestTemplateState.selectedTemplate?.name || "dokument").replace(/\s+/g, "-").toLowerCase()}.${fallbackExtension}`;
            const { blob, filename } = await requestTemplateApi.renderDownload(requestTemplateState.selectedTemplateId, requestTemplateState.selectedTemplateDocType, {
                user_id: requestTemplateState.selectedUserId || null,
                values,
            }, fallbackFilename);

            requestTemplateUi.downloadBlob(blob, filename);
            showFlash(`Das Dokument wurde erfolgreich erzeugt. Der Download für "${filename}" wurde gestartet.`, "success");
            await this.loadDocuments({ mode: "template" });
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.mainPaneStatus,
                "error",
                error.message || "Das Dokument konnte nicht erzeugt werden."
            );
            requestTemplateDom.mainPaneStatus.hidden = false;
        } finally {
            requestTemplateUi.setRenderActionLoading(false, "render");
        }
    },

    removeDocumentFromState(documentId, docType) {
        const normalizedDocumentId = String(documentId);
        const normalizedDocType = String(docType || "");
        const matches = (documentItem) => String(documentItem.document_id) === normalizedDocumentId
            && String(documentItem.doc_type || "") === normalizedDocType;

        requestTemplateState.allDocuments = requestTemplateState.allDocuments.filter((documentItem) => !matches(documentItem));
        requestTemplateState.templateDocuments = requestTemplateState.templateDocuments.filter((documentItem) => !matches(documentItem));

        if (
            String(requestTemplateState.existingDocument?.documentId || "") === normalizedDocumentId
            && String(requestTemplateState.existingDocument?.docType || "") === normalizedDocType
        ) {
            requestTemplateState.existingDocument = null;
            requestTemplateUi.renderExistingDocumentCard();
        }
    },

    async downloadDocument(documentId, docType, fallbackFilename = "document") {
        try {
            const { blob, filename } = await requestTemplateApi.downloadDocument(documentId, docType, fallbackFilename);
            requestTemplateUi.downloadBlob(blob, filename);
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.mainPaneStatus,
                "error",
                error.message || "Das Dokument konnte nicht heruntergeladen werden."
            );
            requestTemplateDom.mainPaneStatus.hidden = false;
        }
    },

    async handleDeleteDocumentConfirm() {
        const documentItem = requestTemplateState.pendingDeleteDocument;
        if (!documentItem?.document_id) {
            requestTemplateUi.setStatus(
                requestTemplateDom.documentDeleteStatus,
                "error",
                "Es wurde kein Dokument zum Löschen ausgewählt."
            );
            return;
        }

        requestTemplateUi.setDeleteActionLoading(true);

        try {
            const payload = await requestTemplateApi.deleteDocument(documentItem.document_id, documentItem.doc_type);
            const wasSelected = String(requestTemplateState.selectedDocumentId || "") === String(documentItem.document_id)
                && String(requestTemplateState.selectedDocumentDocType || "") === String(documentItem.doc_type || "");
            this.removeDocumentFromState(documentItem.document_id, documentItem.doc_type);
            requestTemplateUi.renderDocumentList();
            requestTemplateUi.renderTemplateCardRow();
            showFlash(`Dokument "${requestTemplateFormatters.value(payload.output_filename || documentItem.output_filename)}" wurde gelöscht.`, "success");
            this.closeDeleteDocumentModal();

            if (wasSelected) {
                if (requestTemplateState.selectionMode === "template" && requestTemplateState.selectedTemplate) {
                    this.selectNewDocument();
                } else {
                    await this.selectAllDocumentsMode();
                }
            }
        } catch (error) {
            requestTemplateUi.setStatus(
                requestTemplateDom.documentDeleteStatus,
                "error",
                error.message || "Das Dokument konnte nicht gelöscht werden."
            );
        } finally {
            requestTemplateUi.setDeleteActionLoading(false);
        }
    },

    handleDocumentSearchInput(event) {
        requestTemplateState.documentSearchTerm = event.target.value || "";
        requestTemplateUi.renderDocumentList();
    },

    handleUserSearchInput(event) {
        requestTemplateState.userSearchTerm = event.target.value || "";
        requestTemplateUi.renderUserOptions();
    },

    handleUserSelectionChange(event) {
        requestTemplateState.selectedUserId = String(event.target.value || "");
    },

    handleOverlayClick(event) {
        if (event.target === requestTemplateDom.templateModalOverlay) {
            this.closeTemplateModal();
            return;
        }

        if (event.target === requestTemplateDom.deleteModalOverlay) {
            this.closeDeleteDocumentModal();
        }
    },

    handleKeydown(event) {
        if (event.key !== "Escape") {
            return;
        }

        if (requestTemplateState.isDeleteModalOpen) {
            this.closeDeleteDocumentModal();
            return;
        }

        if (requestTemplateState.isTemplateModalOpen) {
            this.closeTemplateModal();
        }
    },
};

document.addEventListener("DOMContentLoaded", () => {
    requestTemplateUi.cacheDom();

    if (!requestTemplateDom.templateModalForm) {
        return;
    }

    requestTemplateUi.prepareTemplateModalCreate();

    requestTemplateDom.templateModalForm.addEventListener("submit", (event) => requestTemplateHandlers.handleTemplateModalSubmit(event));
    requestTemplateDom.templateResetButton.addEventListener("click", () => requestTemplateHandlers.resetTemplateModal());
    requestTemplateDom.closeTemplateModalButton.addEventListener("click", () => requestTemplateHandlers.closeTemplateModal());
    requestTemplateDom.cancelTemplateModalButton.addEventListener("click", () => requestTemplateHandlers.closeTemplateModal());
    requestTemplateDom.templateFileInput.addEventListener("change", (event) => requestTemplateHandlers.handleTemplateFileChange(event));
    requestTemplateDom.documentSearchInput.addEventListener("input", (event) => requestTemplateHandlers.handleDocumentSearchInput(event));

    requestTemplateDom.openExistingDocumentButton.addEventListener("click", () => {
        if (requestTemplateState.existingDocument?.documentId) {
            requestTemplateHandlers.downloadDocument(
                requestTemplateState.existingDocument.documentId,
                requestTemplateState.existingDocument.docType,
                requestTemplateState.existingDocument.filename || "bestehende-version"
            );
        }
    });
    requestTemplateDom.prefillTemplateButton.addEventListener("click", () => requestTemplateHandlers.handlePrefillClick());
    requestTemplateDom.renderModalForm.addEventListener("submit", (event) => requestTemplateHandlers.handleRenderModalSubmit(event));
    requestTemplateDom.renderUserSearchInput.addEventListener("input", (event) => requestTemplateHandlers.handleUserSearchInput(event));
    requestTemplateDom.renderUserSelect.addEventListener("change", (event) => requestTemplateHandlers.handleUserSelectionChange(event));

    requestTemplateDom.closeDocumentDeleteModalButton.addEventListener("click", () => requestTemplateHandlers.closeDeleteDocumentModal());
    requestTemplateDom.cancelDocumentDeleteModalButton.addEventListener("click", () => requestTemplateHandlers.closeDeleteDocumentModal());
    requestTemplateDom.confirmDocumentDeleteButton.addEventListener("click", () => requestTemplateHandlers.handleDeleteDocumentConfirm());

    requestTemplateDom.templateModalOverlay.addEventListener("click", (event) => requestTemplateHandlers.handleOverlayClick(event));
    requestTemplateDom.deleteModalOverlay.addEventListener("click", (event) => requestTemplateHandlers.handleOverlayClick(event));
    document.addEventListener("keydown", (event) => requestTemplateHandlers.handleKeydown(event));

    requestTemplateUi.renderTemplateCardRow();
    requestTemplateUi.renderDocumentList();

    requestTemplateHandlers.loadTemplates();
    requestTemplateHandlers.selectAllDocumentsMode();
});
