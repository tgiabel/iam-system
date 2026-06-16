const wordTemplateState = {
    templates: [],
    allDocuments: [],
    templateDocuments: [],
    selectedTemplateId: null,
    selectedTemplate: null,
    selectedSchema: null,
    selectionMode: "all",
    selectedDocumentId: null,
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

const wordTemplateDom = {};

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

const wordTemplateApi = {
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

    async requestBlob(url, options = {}, fallbackFilename = "document.docx") {
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
        return this.requestJson("/api/dataprocessing/word-templates");
    },

    getTemplate(templateId) {
        return this.requestJson(`/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}`);
    },

    listDocuments(params = {}) {
        return this.requestJson(`/api/dataprocessing/word-documents${buildQueryString(params)}`);
    },

    listTemplateUsers() {
        return this.requestJson("/api/dataprocessing/word-template-users");
    },

    createTemplate(formData) {
        return this.requestJson("/api/dataprocessing/word-templates", {
            method: "POST",
            body: formData,
        });
    },

    updateTemplate(templateId, payload) {
        return this.requestJson(`/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    prefillTemplate(templateId, payload) {
        return this.requestJson(`/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}/prefill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    renderDownload(templateId, payload, fallbackFilename) {
        return this.requestBlob(
            `/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}/render-download`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
            fallbackFilename
        );
    },

    downloadDocument(documentId, fallbackFilename = "document.docx") {
        return this.requestBlob(
            `/api/dataprocessing/word-documents/${encodeURIComponent(documentId)}/download`,
            {},
            fallbackFilename
        );
    },

    deleteDocument(documentId) {
        return this.requestJson(`/api/dataprocessing/word-documents/${encodeURIComponent(documentId)}`, {
            method: "DELETE",
        });
    },
};

const wordTemplateSchemaUtils = {
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

    buildExistingDocument(payload) {
        if (!payload?.existing_document_available || !payload?.existing_document_id) {
            return null;
        }

        return {
            documentId: String(payload.existing_document_id),
            filename: payload.existing_document_filename || "",
            createdAt: payload.existing_document_created_at || "",
        };
    },
};

const wordTemplateFormatters = {
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

const wordTemplateUi = {
    cacheDom() {
        wordTemplateDom.templateCardRow = document.getElementById("templateCardRow");

        wordTemplateDom.documentList = document.getElementById("documentList");
        wordTemplateDom.documentListStatus = document.getElementById("documentListStatus");
        wordTemplateDom.documentListMeta = document.getElementById("documentListMeta");

        wordTemplateDom.mainPaneKicker = document.getElementById("mainPaneKicker");
        wordTemplateDom.mainPaneTitle = document.getElementById("mainPaneTitle");
        wordTemplateDom.mainPaneMeta = document.getElementById("mainPaneMeta");
        wordTemplateDom.mainPaneStatus = document.getElementById("mainPaneStatus");
        wordTemplateDom.mainPaneEmptyState = document.getElementById("mainPaneEmptyState");
        wordTemplateDom.mainPaneGenerate = document.getElementById("mainPaneGenerate");
        wordTemplateDom.mainPaneDocumentActions = document.getElementById("mainPaneDocumentActions");
        wordTemplateDom.docActionSignButton = document.getElementById("docActionSignButton");
        wordTemplateDom.docActionDownloadButton = document.getElementById("docActionDownloadButton");
        wordTemplateDom.docActionSendButton = document.getElementById("docActionSendButton");
        wordTemplateDom.docActionDeleteButton = document.getElementById("docActionDeleteButton");

        wordTemplateDom.templateModalOverlay = document.getElementById("word-template-manage-modal");
        wordTemplateDom.templateModalTitle = document.getElementById("word-template-manage-modal-title");
        wordTemplateDom.templateModalSubtitle = document.getElementById("templateModalSubtitle");
        wordTemplateDom.templateModalStatus = document.getElementById("templateModalStatus");
        wordTemplateDom.templateModalForm = document.getElementById("templateModalForm");
        wordTemplateDom.templateNameInput = document.getElementById("templateNameInput");
        wordTemplateDom.templateDescriptionInput = document.getElementById("templateDescriptionInput");
        wordTemplateDom.templateSchemaInput = document.getElementById("templateSchemaInput");
        wordTemplateDom.templateFileInput = document.getElementById("templateFileInput");
        wordTemplateDom.templateFileHelp = document.getElementById("templateFileHelp");
        wordTemplateDom.templateSubmitButton = document.getElementById("templateSubmitButton");
        wordTemplateDom.templateResetButton = document.getElementById("templateResetButton");
        wordTemplateDom.closeTemplateModalButton = document.getElementById("closeTemplateModalButton");
        wordTemplateDom.cancelTemplateModalButton = document.getElementById("cancelTemplateModalButton");

        wordTemplateDom.existingDocumentCard = document.getElementById("existingDocumentCard");
        wordTemplateDom.existingDocumentCopy = document.getElementById("existingDocumentCopy");
        wordTemplateDom.openExistingDocumentButton = document.getElementById("openExistingDocumentButton");
        wordTemplateDom.renderUserSearchInput = document.getElementById("renderUserSearchInput");
        wordTemplateDom.renderUserSelect = document.getElementById("renderUserSelect");
        wordTemplateDom.prefillTemplateButton = document.getElementById("prefillTemplateButton");
        wordTemplateDom.renderModalForm = document.getElementById("renderModalForm");
        wordTemplateDom.renderModalFields = document.getElementById("renderModalFields");
        wordTemplateDom.renderModalSubmitButton = document.getElementById("renderModalSubmitButton");

        wordTemplateDom.deleteModalOverlay = document.getElementById("word-document-delete-modal");
        wordTemplateDom.documentDeleteStatus = document.getElementById("documentDeleteStatus");
        wordTemplateDom.documentDeleteName = document.getElementById("documentDeleteName");
        wordTemplateDom.documentDeleteMeta = document.getElementById("documentDeleteMeta");
        wordTemplateDom.closeDocumentDeleteModalButton = document.getElementById("closeDocumentDeleteModalButton");
        wordTemplateDom.cancelDocumentDeleteModalButton = document.getElementById("cancelDocumentDeleteModalButton");
        wordTemplateDom.confirmDocumentDeleteButton = document.getElementById("confirmDocumentDeleteButton");
    },

    setStatus(element, tone, message) {
        if (!element) {
            return;
        }

        element.className = `word-template-status word-template-status-${tone}`;
        element.innerHTML = message;
    },

    setTemplateModalSubmitLoading(isLoading) {
        wordTemplateDom.templateSubmitButton.disabled = isLoading;
        wordTemplateDom.templateResetButton.disabled = isLoading;

        if (wordTemplateState.templateModalMode === "edit") {
            wordTemplateDom.templateSubmitButton.textContent = isLoading ? "Vorlage wird aktualisiert..." : "Vorlage aktualisieren";
            return;
        }

        wordTemplateDom.templateSubmitButton.textContent = isLoading ? "Vorlage wird gespeichert..." : "Vorlage speichern";
    },

    setRenderActionLoading(isLoading, mode = "prefill") {
        wordTemplateDom.prefillTemplateButton.disabled = isLoading;
        wordTemplateDom.renderModalSubmitButton.disabled = isLoading;
        if (wordTemplateDom.openExistingDocumentButton) {
            wordTemplateDom.openExistingDocumentButton.disabled = isLoading;
        }

        if (mode === "prefill") {
            wordTemplateDom.prefillTemplateButton.textContent = isLoading ? "Vorlage wird gefüllt..." : "Vorlage automatisch ausfüllen";
            return;
        }

        wordTemplateDom.renderModalSubmitButton.textContent = isLoading ? "DOCX wird erzeugt..." : "DOCX erzeugen";
    },

    setDeleteActionLoading(isLoading) {
        wordTemplateDom.confirmDocumentDeleteButton.disabled = isLoading;
        wordTemplateDom.cancelDocumentDeleteModalButton.disabled = isLoading;
        wordTemplateDom.closeDocumentDeleteModalButton.disabled = isLoading;
        wordTemplateDom.confirmDocumentDeleteButton.textContent = isLoading ? "Dokument wird gelöscht..." : "Dokument löschen";
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
        const row = wordTemplateDom.templateCardRow;
        if (!row) {
            return;
        }

        row.innerHTML = "";

        const allCard = document.createElement("button");
        allCard.type = "button";
        allCard.className = "word-template-card word-template-card-all";
        if (wordTemplateState.selectionMode === "all") {
            allCard.classList.add("is-active");
        }
        allCard.innerHTML = `
            <span class="word-template-card-title">Alle Dokumente</span>
            <span class="word-template-card-meta">${wordTemplateState.allDocuments.length} Dokument(e)</span>
        `;
        allCard.addEventListener("click", () => wordTemplateHandlers.selectAllDocumentsMode());
        row.appendChild(allCard);

        const divider = document.createElement("div");
        divider.className = "word-template-card-divider";
        row.appendChild(divider);

        wordTemplateState.templates.forEach((template) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "word-template-card";

            const isActive = wordTemplateState.selectionMode === "template"
                && String(template.template_id) === String(wordTemplateState.selectedTemplateId);
            if (isActive) {
                card.classList.add("is-active");
            }

            card.innerHTML = `
                <span class="word-template-card-title">${escapeHtml(wordTemplateFormatters.value(template.name))}</span>
                <span class="word-template-card-meta">${escapeHtml(wordTemplateFormatters.value(template.original_filename))}</span>
            `;

            if (isActive) {
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.className = "word-template-card-edit";
                editButton.setAttribute("aria-label", "Vorlage bearbeiten");
                editButton.innerHTML = "&#9998;";
                editButton.addEventListener("click", (event) => {
                    event.stopPropagation();
                    wordTemplateHandlers.openEditTemplateModal();
                });
                card.appendChild(editButton);
            }

            card.addEventListener("click", () => wordTemplateHandlers.selectTemplate(template.template_id));
            row.appendChild(card);
        });

        const addCard = document.createElement("button");
        addCard.type = "button";
        addCard.className = "word-template-card word-template-card-add";
        addCard.textContent = "+ Neue Vorlage";
        addCard.addEventListener("click", () => wordTemplateHandlers.openCreateTemplateModal());
        row.appendChild(addCard);
    },

    renderDocumentList() {
        const list = wordTemplateDom.documentList;
        if (!list) {
            return;
        }

        list.innerHTML = "";

        const isTemplateMode = wordTemplateState.selectionMode === "template";
        const selectedTemplateId = String(wordTemplateState.selectedTemplateId || "");
        const rawDocuments = isTemplateMode ? wordTemplateState.templateDocuments : wordTemplateState.allDocuments;
        const documents = isTemplateMode && selectedTemplateId
            ? rawDocuments.filter((documentItem) => String(documentItem.template_id || "") === selectedTemplateId)
            : rawDocuments;

        wordTemplateDom.documentListMeta.textContent = `${documents.length} Dokument(e)`;

        if (isTemplateMode) {
            const newItem = document.createElement("button");
            newItem.type = "button";
            newItem.className = "word-template-explorer-item word-template-explorer-item-new";
            if (wordTemplateState.selectedDocumentId === "new") {
                newItem.classList.add("is-active");
            }
            newItem.textContent = "+ Neues Dokument";
            newItem.addEventListener("click", () => wordTemplateHandlers.selectNewDocument());
            list.appendChild(newItem);
        }

        if (!documents.length) {
            const placeholder = document.createElement("div");
            placeholder.className = "is-placeholder";
            placeholder.innerHTML = `
                <strong>Keine Dokumente gefunden</strong>
                <p>${isTemplateMode ? "Für diese Vorlage wurden noch keine Dokumente erzeugt." : "Es wurden noch keine Dokumente erzeugt."}</p>
            `;
            list.appendChild(placeholder);
            return;
        }

        documents.forEach((documentItem) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "word-template-explorer-item";
            if (String(documentItem.document_id) === String(wordTemplateState.selectedDocumentId)) {
                item.classList.add("is-active");
            }

            item.innerHTML = `
                <span class="word-template-explorer-item-title">${escapeHtml(wordTemplateFormatters.value(documentItem.output_filename))}</span>
                <p class="word-template-explorer-item-meta">${escapeHtml(wordTemplateFormatters.value(documentItem.template_name || documentItem.template_id))} · ${escapeHtml(wordTemplateFormatters.dateTime(documentItem.created_at))}</p>
            `;

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "word-template-explorer-item-delete";
            deleteButton.setAttribute("aria-label", "Dokument löschen");
            deleteButton.innerHTML = "&times;";
            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                wordTemplateHandlers.openDeleteDocumentModal(documentItem);
            });
            item.appendChild(deleteButton);

            item.addEventListener("click", () => wordTemplateHandlers.selectDocument(documentItem));
            list.appendChild(item);
        });
    },

    setMainPaneState(state) {
        const isForm = state === "form";
        wordTemplateDom.mainPaneEmptyState.hidden = isForm;
        wordTemplateDom.mainPaneGenerate.hidden = !isForm;
    },

    syncDocumentActionsRow() {
        const documentItem = wordTemplateState.selectedDocument;
        wordTemplateDom.mainPaneDocumentActions.hidden = !documentItem;

        if (!documentItem) {
            return;
        }

        wordTemplateDom.docActionDownloadButton.onclick = () => wordTemplateHandlers.downloadDocument(documentItem.document_id, documentItem.output_filename);
        wordTemplateDom.docActionDeleteButton.onclick = () => wordTemplateHandlers.openDeleteDocumentModal(documentItem);
    },

    prepareTemplateModalCreate() {
        wordTemplateState.templateModalMode = "create";
        wordTemplateDom.templateModalForm.reset();
        wordTemplateDom.templateModalTitle.textContent = "Neue Vorlage anlegen";
        wordTemplateDom.templateModalSubtitle.innerHTML = 'Name, Beschreibung, Schema und <code>.dotx</code>-Datei werden hier gepflegt.';
        wordTemplateDom.templateSchemaInput.value = wordTemplateSchemaUtils.example();
        wordTemplateDom.templateFileInput.value = "";
        wordTemplateDom.templateFileInput.disabled = false;
        wordTemplateDom.templateFileInput.required = true;
        wordTemplateDom.templateSubmitButton.textContent = "Vorlage speichern";
        wordTemplateDom.templateResetButton.textContent = "Formular zurücksetzen";
        wordTemplateDom.templateFileHelp.innerHTML = 'Erlaubt ist ausschließlich eine <code>.dotx</code>-Datei.';
        this.setStatus(
            wordTemplateDom.templateModalStatus,
            "info",
            'Lege hier eine neue Word-Vorlage mit <code>.dotx</code>-Datei und JSON-Schema an.'
        );
    },

    populateTemplateModalForEdit(template, schema) {
        wordTemplateState.templateModalMode = "edit";
        wordTemplateDom.templateNameInput.value = template.name || "";
        wordTemplateDom.templateDescriptionInput.value = template.description || "";
        wordTemplateDom.templateSchemaInput.value = JSON.stringify(schema, null, 2);
        wordTemplateDom.templateFileInput.value = "";
        wordTemplateDom.templateFileInput.disabled = true;
        wordTemplateDom.templateFileInput.required = false;
        wordTemplateDom.templateModalTitle.textContent = "Vorlage bearbeiten";
        wordTemplateDom.templateModalSubtitle.innerHTML = `Bearbeite Metadaten und Schema der Vorlage <code>${escapeHtml(wordTemplateFormatters.value(template.template_id))}</code>.`;
        wordTemplateDom.templateSubmitButton.textContent = "Vorlage aktualisieren";
        wordTemplateDom.templateResetButton.textContent = "Änderungen verwerfen";
        wordTemplateDom.templateFileHelp.innerHTML = `Aktive Datei: <code>${escapeHtml(wordTemplateFormatters.value(template.original_filename))}</code>. Der Austausch der <code>.dotx</code>-Datei ist in V1 nicht vorgesehen.`;
        this.setStatus(
            wordTemplateDom.templateModalStatus,
            "info",
            `Die Vorlage <strong>${escapeHtml(wordTemplateFormatters.value(template.name))}</strong> kann jetzt angepasst werden.`
        );
    },

    openTemplateModal() {
        wordTemplateDom.templateModalOverlay.classList.add("active");
        wordTemplateDom.templateModalOverlay.setAttribute("aria-hidden", "false");
        wordTemplateState.isTemplateModalOpen = true;
        document.body.style.overflow = "hidden";
    },

    closeTemplateModal() {
        wordTemplateDom.templateModalOverlay.classList.remove("active");
        wordTemplateDom.templateModalOverlay.setAttribute("aria-hidden", "true");
        wordTemplateState.isTemplateModalOpen = false;
        if (!wordTemplateState.isDeleteModalOpen) {
            document.body.style.overflow = "";
        }
    },

    renderDeleteDocumentModal() {
        const documentItem = wordTemplateState.pendingDeleteDocument;
        if (!documentItem) {
            wordTemplateDom.documentDeleteName.textContent = "Kein Dokument ausgewählt";
            wordTemplateDom.documentDeleteMeta.textContent = "Nach Auswahl eines Dokuments werden Dateiname, Vorlage und Erstellzeitpunkt hier angezeigt.";
            return;
        }

        wordTemplateDom.documentDeleteName.textContent = wordTemplateFormatters.value(documentItem.output_filename);
        wordTemplateDom.documentDeleteMeta.textContent = `${wordTemplateFormatters.value(documentItem.template_name || documentItem.template_id)} · erstellt ${wordTemplateFormatters.dateTime(documentItem.created_at)}`;
    },

    openDeleteModal() {
        wordTemplateDom.deleteModalOverlay.classList.add("active");
        wordTemplateDom.deleteModalOverlay.setAttribute("aria-hidden", "false");
        wordTemplateState.isDeleteModalOpen = true;
        document.body.style.overflow = "hidden";
    },

    closeDeleteModal() {
        wordTemplateDom.deleteModalOverlay.classList.remove("active");
        wordTemplateDom.deleteModalOverlay.setAttribute("aria-hidden", "true");
        wordTemplateState.isDeleteModalOpen = false;
        if (!wordTemplateState.isTemplateModalOpen) {
            document.body.style.overflow = "";
        }
    },

    renderExistingDocumentCard() {
        const existingDocument = wordTemplateState.existingDocument;
        if (!existingDocument) {
            wordTemplateDom.existingDocumentCard.hidden = true;
            wordTemplateDom.existingDocumentCopy.textContent = "Für diesen Kontext existiert bereits eine letzte generierte Version.";
            return;
        }

        const filename = wordTemplateFormatters.value(existingDocument.filename);
        const createdAt = wordTemplateFormatters.dateTime(existingDocument.createdAt);
        wordTemplateDom.existingDocumentCopy.textContent = `Es existiert bereits ${filename}. Erstellt am ${createdAt}.`;
        wordTemplateDom.existingDocumentCard.hidden = false;
    },

    renderUserOptions() {
        const select = wordTemplateDom.renderUserSelect;
        const visibleUsers = wordTemplateHandlers.getVisibleUsers();

        select.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = visibleUsers.length ? "User auswählen" : "Keine passenden User gefunden";
        select.appendChild(placeholder);

        visibleUsers.forEach((user) => {
            const option = document.createElement("option");
            option.value = String(user.user_id);
            option.textContent = wordTemplateFormatters.userLabel(user);
            if (String(user.user_id) === String(wordTemplateState.selectedUserId)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (
            wordTemplateState.selectedUserId
            && !visibleUsers.some((user) => String(user.user_id) === String(wordTemplateState.selectedUserId))
        ) {
            select.value = "";
        }
    },

    renderModalFields() {
        const container = wordTemplateDom.renderModalFields;
        container.innerHTML = "";

        if (!wordTemplateState.modalFields.length) {
            container.innerHTML = `
                <div class="word-template-empty-state">
                    <strong>Keine editierbaren Felder</strong>
                    <p>Diese Vorlage enthält aktuell keine sichtbaren Formularfelder. Das Dokument kann trotzdem direkt erzeugt werden.</p>
                </div>
            `;
            return;
        }

        wordTemplateState.modalFields.forEach((field, index) => {
            const wrapper = document.createElement("div");
            wrapper.className = "word-template-render-field";

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
                    <p class="word-template-render-field-copy">${escapeHtml(metaParts.join(" · "))}</p>
                    <label class="word-template-checkbox-row" for="${inputId}">
                        <input id="${inputId}" type="checkbox" data-modal-field-index="${index}" ${field.value ? "checked" : ""}>
                        <span>Wert setzen</span>
                    </label>
                `;
                container.appendChild(wrapper);
                return;
            }

            const input = document.createElement("input");
            input.type = "text";
            input.className = "word-template-input";
            input.id = `render-modal-field-${index}`;
            input.value = field.value || "";
            input.placeholder = field.placeholder || "";
            input.dataset.modalFieldIndex = String(index);
            if (Number.isInteger(field.max_length)) {
                input.maxLength = field.max_length;
            }

            wrapper.innerHTML = `
                <label for="${input.id}">${escapeHtml(field.label)}</label>
                <p class="word-template-render-field-copy">${escapeHtml(metaParts.join(" · "))}</p>
            `;
            wrapper.appendChild(input);
            container.appendChild(wrapper);
        });
    },
};

const wordTemplateHandlers = {
    async loadTemplates(options = {}) {
        const { selectTemplateId = null } = options;

        try {
            const templates = await wordTemplateApi.listTemplates();
            wordTemplateState.templates = Array.isArray(templates) ? templates : [];
            wordTemplateUi.renderTemplateCardRow();

            if (selectTemplateId) {
                await this.selectTemplate(selectTemplateId);
                return;
            }

            if (
                wordTemplateState.selectedTemplateId
                && !wordTemplateState.templates.some((template) => String(template.template_id) === String(wordTemplateState.selectedTemplateId))
            ) {
                await this.selectAllDocumentsMode();
            }
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "error",
                error.message || "Vorlagen konnten nicht geladen werden."
            );
        }
    },

    async loadDocuments(options = {}) {
        const { mode = wordTemplateState.selectionMode } = options;

        if (mode === "template" && !wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "info",
                "Wähle zuerst eine Vorlage aus, um deren Dokumente anzuzeigen."
            );
            wordTemplateDom.documentListStatus.hidden = false;
            wordTemplateUi.renderDocumentList();
            return;
        }

        wordTemplateDom.documentListStatus.hidden = true;

        try {
            const documents = await wordTemplateApi.listDocuments(
                mode === "template"
                    ? { template_id: wordTemplateState.selectedTemplateId }
                    : {}
            );
            const normalizedDocuments = Array.isArray(documents) ? documents : [];

            if (mode === "template") {
                wordTemplateState.templateDocuments = normalizedDocuments;
            } else {
                wordTemplateState.allDocuments = normalizedDocuments;
                wordTemplateUi.renderTemplateCardRow();
            }

            wordTemplateUi.renderDocumentList();
            wordTemplateDom.documentListStatus.hidden = true;
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "error",
                error.message || "Die Dokumentenliste konnte nicht geladen werden."
            );
            wordTemplateDom.documentListStatus.hidden = false;
            wordTemplateUi.renderDocumentList();
        }
    },

    async selectAllDocumentsMode() {
        wordTemplateState.selectionMode = "all";
        wordTemplateState.selectedTemplateId = null;
        wordTemplateState.selectedTemplate = null;
        wordTemplateState.selectedSchema = null;
        wordTemplateState.selectedDocumentId = null;
        wordTemplateState.selectedDocument = null;
        wordTemplateState.modalFields = [];

        wordTemplateDom.mainPaneKicker.textContent = "Übersicht";
        wordTemplateDom.mainPaneTitle.textContent = "Alle Dokumente";
        wordTemplateDom.mainPaneMeta.textContent = "";
        wordTemplateDom.mainPaneStatus.hidden = true;
        wordTemplateDom.mainPaneEmptyState.querySelector("strong").textContent = "Kein Dokument ausgewählt";
        wordTemplateDom.mainPaneEmptyState.querySelector("p").textContent = "Wähle links ein Dokument aus der Liste oder wähle oben eine Vorlage aus, um ein neues Dokument zu erstellen.";
        wordTemplateUi.setMainPaneState("empty");

        wordTemplateUi.renderTemplateCardRow();
        await this.loadDocuments({ mode: "all" });
    },

    async selectTemplate(templateId) {
        wordTemplateState.selectionMode = "template";
        wordTemplateState.selectedTemplateId = String(templateId);
        wordTemplateState.selectedDocumentId = null;
        wordTemplateState.selectedDocument = null;
        wordTemplateUi.renderTemplateCardRow();
        wordTemplateUi.setMainPaneState("empty");
        wordTemplateDom.mainPaneStatus.hidden = false;
        wordTemplateUi.setStatus(wordTemplateDom.mainPaneStatus, "info", "Vorlagendetails werden geladen...");

        try {
            const template = await wordTemplateApi.getTemplate(templateId);
            const { schema, error: parseError } = wordTemplateSchemaUtils.parse(template.schema_json || "{}");
            if (parseError) {
                throw new Error(parseError);
            }

            const validationError = wordTemplateSchemaUtils.validate(schema);
            if (validationError) {
                throw new Error(validationError);
            }

            wordTemplateState.selectedTemplate = template;
            wordTemplateState.selectedSchema = schema;
            wordTemplateState.modalFields = wordTemplateSchemaUtils.buildModalFieldsFromSchema(schema);

            wordTemplateDom.mainPaneKicker.textContent = "Übersicht";
            wordTemplateDom.mainPaneTitle.textContent = wordTemplateFormatters.value(template.name);
            wordTemplateDom.mainPaneMeta.textContent = "";
            wordTemplateDom.mainPaneEmptyState.querySelector("strong").textContent = "Kein Dokument ausgewählt";
            wordTemplateDom.mainPaneEmptyState.querySelector("p").textContent = `Wähle links ein Dokument aus der Liste oder erstelle über "+ Neues Dokument" ein neues Dokument für "${wordTemplateFormatters.value(template.name)}".`;
            wordTemplateDom.mainPaneStatus.hidden = true;

            wordTemplateUi.renderTemplateCardRow();
            await this.loadDocuments({ mode: "template" });
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "error",
                error.message || "Die Vorlage konnte nicht geladen werden."
            );
        }
    },

    selectNewDocument() {
        if (!wordTemplateState.selectedTemplate || !wordTemplateState.selectedSchema) {
            return;
        }

        wordTemplateState.selectedDocumentId = "new";
        wordTemplateState.selectedDocument = null;
        wordTemplateState.modalFields = wordTemplateSchemaUtils.buildModalFieldsFromSchema(wordTemplateState.selectedSchema);
        wordTemplateState.selectedUserId = "";
        wordTemplateState.userSearchTerm = "";
        wordTemplateState.existingDocument = null;

        wordTemplateDom.mainPaneKicker.textContent = "Neues Dokument";
        wordTemplateDom.mainPaneTitle.textContent = wordTemplateState.selectedTemplate.name || "Dokument erstellen";
        wordTemplateDom.mainPaneMeta.textContent = "";
        wordTemplateDom.renderUserSearchInput.value = "";

        wordTemplateUi.renderExistingDocumentCard();
        wordTemplateUi.renderUserOptions();
        wordTemplateUi.renderModalFields();
        wordTemplateUi.syncDocumentActionsRow();
        wordTemplateUi.setStatus(
            wordTemplateDom.mainPaneStatus,
            "info",
            "Das Formular wurde aus dem Schema aufgebaut. Felder können manuell gepflegt oder automatisch vorbefüllt werden."
        );
        wordTemplateDom.mainPaneStatus.hidden = false;
        wordTemplateUi.setMainPaneState("form");
        wordTemplateUi.renderDocumentList();
        this.ensureUsersLoaded();
    },

    async selectDocument(documentItem) {
        if (wordTemplateState.selectionMode === "all") {
            await this.selectTemplate(documentItem.template_id);
        }

        wordTemplateState.selectedDocumentId = documentItem.document_id;
        wordTemplateState.selectedDocument = documentItem;
        wordTemplateState.existingDocument = null;
        wordTemplateState.modalFields = wordTemplateSchemaUtils.buildModalFieldsFromSchema(wordTemplateState.selectedSchema);

        wordTemplateDom.mainPaneKicker.textContent = "Dokument";
        wordTemplateDom.mainPaneTitle.textContent = wordTemplateFormatters.value(documentItem.output_filename);
        wordTemplateDom.mainPaneMeta.textContent = `Erstellt ${wordTemplateFormatters.dateTime(documentItem.created_at)}`;
        wordTemplateDom.renderUserSearchInput.value = "";

        wordTemplateUi.renderExistingDocumentCard();
        wordTemplateUi.renderModalFields();
        wordTemplateUi.syncDocumentActionsRow();
        wordTemplateUi.setMainPaneState("form");
        wordTemplateUi.renderDocumentList();
        this.ensureUsersLoaded();

        if (documentItem.user_id) {
            wordTemplateState.selectedUserId = String(documentItem.user_id);
            wordTemplateUi.renderUserOptions();
            wordTemplateDom.mainPaneStatus.hidden = false;
            wordTemplateUi.setStatus(wordTemplateDom.mainPaneStatus, "info", "Aktuelle Userdaten werden geladen...");
            wordTemplateUi.setRenderActionLoading(true, "prefill");

            try {
                const payload = await wordTemplateApi.prefillTemplate(wordTemplateState.selectedTemplateId, {
                    user_id: documentItem.user_id,
                });
                wordTemplateState.modalFields = wordTemplateSchemaUtils.buildModalFieldsFromPrefill(payload);
                wordTemplateUi.renderModalFields();
                wordTemplateUi.setStatus(
                    wordTemplateDom.mainPaneStatus,
                    "success",
                    "Das Formular wurde mit den aktuellen Userdaten vorbefüllt. Beim Erzeugen entsteht ein neues Dokument."
                );
            } catch (error) {
                wordTemplateUi.setStatus(
                    wordTemplateDom.mainPaneStatus,
                    "error",
                    error.message || "Die aktuellen Userdaten konnten nicht geladen werden."
                );
            } finally {
                wordTemplateUi.setRenderActionLoading(false, "prefill");
            }
        } else {
            wordTemplateState.selectedUserId = "";
            wordTemplateUi.renderUserOptions();
            wordTemplateDom.mainPaneStatus.hidden = false;
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "info",
                "Für dieses Dokument liegt keine User-Zuordnung vor. Das Formular zeigt die Standardwerte der Vorlage."
            );
        }
    },

    openCreateTemplateModal() {
        wordTemplateUi.prepareTemplateModalCreate();
        wordTemplateUi.openTemplateModal();
        wordTemplateDom.templateNameInput.focus();
    },

    openEditTemplateModal() {
        if (!wordTemplateState.selectedTemplate || !wordTemplateState.selectedSchema) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "error",
                "Bitte wählen Sie zuerst eine Vorlage aus, bevor Sie sie bearbeiten."
            );
            return;
        }

        wordTemplateUi.populateTemplateModalForEdit(wordTemplateState.selectedTemplate, wordTemplateState.selectedSchema);
        wordTemplateUi.openTemplateModal();
        wordTemplateDom.templateNameInput.focus();
    },

    closeTemplateModal() {
        wordTemplateUi.closeTemplateModal();
    },

    openDeleteDocumentModal(documentItem) {
        wordTemplateState.pendingDeleteDocument = documentItem || null;
        wordTemplateUi.renderDeleteDocumentModal();
        wordTemplateUi.setStatus(
            wordTemplateDom.documentDeleteStatus,
            "info",
            "Prüfe die Dokumentdaten und bestätige das Löschen nur, wenn die Datei nicht mehr benötigt wird."
        );
        wordTemplateUi.openDeleteModal();
    },

    closeDeleteDocumentModal() {
        wordTemplateState.pendingDeleteDocument = null;
        wordTemplateUi.closeDeleteModal();
        wordTemplateUi.renderDeleteDocumentModal();
    },

    resetTemplateModal() {
        if (wordTemplateState.templateModalMode === "edit" && wordTemplateState.selectedTemplate && wordTemplateState.selectedSchema) {
            wordTemplateUi.populateTemplateModalForEdit(wordTemplateState.selectedTemplate, wordTemplateState.selectedSchema);
            return;
        }

        wordTemplateUi.prepareTemplateModalCreate();
    },

    validateCreateFile(file) {
        if (!file) {
            return "Bitte wählen Sie eine .dotx-Datei aus.";
        }

        if (!String(file.name || "").toLowerCase().endsWith(".dotx")) {
            return "Die Vorlagendatei muss die Endung .dotx haben.";
        }

        return null;
    },

    async handleTemplateModalSubmit(event) {
        event.preventDefault();

        const name = wordTemplateDom.templateNameInput.value.trim();
        const description = wordTemplateDom.templateDescriptionInput.value.trim();
        const rawSchema = wordTemplateDom.templateSchemaInput.value.trim();
        const { schema, error: parseError } = wordTemplateSchemaUtils.parse(rawSchema);

        if (parseError) {
            wordTemplateUi.setStatus(wordTemplateDom.templateModalStatus, "error", parseError);
            return;
        }

        const validationError = wordTemplateSchemaUtils.validate(schema);
        if (validationError) {
            wordTemplateUi.setStatus(wordTemplateDom.templateModalStatus, "error", validationError);
            return;
        }

        if (!name) {
            wordTemplateUi.setStatus(wordTemplateDom.templateModalStatus, "error", "Der Vorlagenname ist erforderlich.");
            return;
        }

        wordTemplateUi.setTemplateModalSubmitLoading(true);

        try {
            if (wordTemplateState.templateModalMode === "edit" && wordTemplateState.selectedTemplateId) {
                const updated = await wordTemplateApi.updateTemplate(wordTemplateState.selectedTemplateId, {
                    name,
                    description,
                    schema,
                });

                wordTemplateUi.closeTemplateModal();
                await this.loadTemplates({
                    selectTemplateId: updated.template_id || wordTemplateState.selectedTemplateId,
                });
                return;
            }

            const file = wordTemplateDom.templateFileInput.files?.[0];
            const fileError = this.validateCreateFile(file);
            if (fileError) {
                wordTemplateUi.setStatus(wordTemplateDom.templateModalStatus, "error", fileError);
                return;
            }

            const formData = new FormData();
            formData.append("name", name);
            formData.append("description", description);
            formData.append("schema_json", JSON.stringify(schema));
            formData.append("template_file", file);

            const created = await wordTemplateApi.createTemplate(formData);
            wordTemplateUi.closeTemplateModal();
            await this.loadTemplates({
                selectTemplateId: created.template_id,
            });
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.templateModalStatus,
                "error",
                error.message || "Die Vorlage konnte nicht gespeichert werden."
            );
        } finally {
            wordTemplateUi.setTemplateModalSubmitLoading(false);
        }
    },

    getVisibleUsers() {
        const search = normalizeValue(wordTemplateState.userSearchTerm);
        const allUsers = Array.isArray(wordTemplateState.users) ? wordTemplateState.users : [];
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

        if (!wordTemplateState.selectedUserId) {
            return filteredUsers;
        }

        const selected = allUsers.find((user) => String(user.user_id) === String(wordTemplateState.selectedUserId));
        if (!selected || filteredUsers.some((user) => String(user.user_id) === String(selected.user_id))) {
            return filteredUsers;
        }

        return [selected, ...filteredUsers];
    },

    async ensureUsersLoaded() {
        if (wordTemplateState.users.length) {
            wordTemplateUi.renderUserOptions();
            return;
        }

        try {
            const users = await wordTemplateApi.listTemplateUsers();
            wordTemplateState.users = Array.isArray(users) ? users : [];
            wordTemplateUi.renderUserOptions();
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "error",
                error.message || "Die User-Liste konnte nicht geladen werden."
            );
            wordTemplateDom.mainPaneStatus.hidden = false;
        }
    },

    async handlePrefillClick() {
        if (!wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(wordTemplateDom.mainPaneStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            wordTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        if (!wordTemplateState.selectedUserId) {
            wordTemplateUi.setStatus(wordTemplateDom.mainPaneStatus, "error", "Bitte wählen Sie einen User zum Vorbefüllen aus.");
            wordTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        wordTemplateUi.setRenderActionLoading(true, "prefill");

        try {
            const payload = await wordTemplateApi.prefillTemplate(wordTemplateState.selectedTemplateId, {
                user_id: wordTemplateState.selectedUserId,
            });
            wordTemplateState.modalFields = wordTemplateSchemaUtils.buildModalFieldsFromPrefill(payload);
            wordTemplateState.existingDocument = wordTemplateSchemaUtils.buildExistingDocument(payload);
            wordTemplateUi.renderExistingDocumentCard();
            wordTemplateUi.renderModalFields();
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "success",
                wordTemplateState.existingDocument
                    ? "Die Vorlage wurde vorbefüllt. Zusätzlich steht die letzte bereits generierte Version direkt zum Öffnen bereit."
                    : "Die Vorlage wurde mit den verfügbaren Userdaten vorbefüllt. Alle sichtbaren Felder können vor dem Download noch angepasst werden."
            );
            wordTemplateDom.mainPaneStatus.hidden = false;
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "error",
                error.message || "Die Vorlage konnte nicht automatisch ausgefüllt werden."
            );
            wordTemplateDom.mainPaneStatus.hidden = false;
        } finally {
            wordTemplateUi.setRenderActionLoading(false, "prefill");
        }
    },

    collectModalValues() {
        const values = {};

        for (const [index, field] of wordTemplateState.modalFields.entries()) {
            const input = wordTemplateDom.renderModalFields.querySelector(`[data-modal-field-index="${index}"]`);
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

        if (!wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(wordTemplateDom.mainPaneStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            wordTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        const { values, error } = this.collectModalValues();
        if (error) {
            wordTemplateUi.setStatus(wordTemplateDom.mainPaneStatus, "error", error);
            wordTemplateDom.mainPaneStatus.hidden = false;
            return;
        }

        wordTemplateUi.setRenderActionLoading(true, "render");

        try {
            const fallbackFilename = `${(wordTemplateState.selectedTemplate?.name || "dokument").replace(/\s+/g, "-").toLowerCase()}.docx`;
            const { blob, filename } = await wordTemplateApi.renderDownload(wordTemplateState.selectedTemplateId, {
                user_id: wordTemplateState.selectedUserId || null,
                values,
            }, fallbackFilename);

            wordTemplateUi.downloadBlob(blob, filename);
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "success",
                `Das Dokument wurde erfolgreich erzeugt. Der Download für <code>${escapeHtml(filename)}</code> wurde gestartet.`
            );
            wordTemplateDom.mainPaneStatus.hidden = false;
            await this.loadDocuments({ mode: "template" });
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "error",
                error.message || "Das Dokument konnte nicht erzeugt werden."
            );
            wordTemplateDom.mainPaneStatus.hidden = false;
        } finally {
            wordTemplateUi.setRenderActionLoading(false, "render");
        }
    },

    removeDocumentFromState(documentId) {
        const normalizedDocumentId = String(documentId);
        wordTemplateState.allDocuments = wordTemplateState.allDocuments.filter(
            (documentItem) => String(documentItem.document_id) !== normalizedDocumentId
        );
        wordTemplateState.templateDocuments = wordTemplateState.templateDocuments.filter(
            (documentItem) => String(documentItem.document_id) !== normalizedDocumentId
        );

        if (String(wordTemplateState.existingDocument?.documentId || "") === normalizedDocumentId) {
            wordTemplateState.existingDocument = null;
            wordTemplateUi.renderExistingDocumentCard();
        }
    },

    async downloadDocument(documentId, fallbackFilename = "document.docx") {
        try {
            const { blob, filename } = await wordTemplateApi.downloadDocument(documentId, fallbackFilename);
            wordTemplateUi.downloadBlob(blob, filename);
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.mainPaneStatus,
                "error",
                error.message || "Das Dokument konnte nicht heruntergeladen werden."
            );
            wordTemplateDom.mainPaneStatus.hidden = false;
        }
    },

    async handleDeleteDocumentConfirm() {
        const documentItem = wordTemplateState.pendingDeleteDocument;
        if (!documentItem?.document_id) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentDeleteStatus,
                "error",
                "Es wurde kein Dokument zum Löschen ausgewählt."
            );
            return;
        }

        wordTemplateUi.setDeleteActionLoading(true);

        try {
            const payload = await wordTemplateApi.deleteDocument(documentItem.document_id);
            const wasSelected = String(wordTemplateState.selectedDocumentId || "") === String(documentItem.document_id);
            this.removeDocumentFromState(documentItem.document_id);
            wordTemplateUi.renderDocumentList();
            wordTemplateUi.renderTemplateCardRow();
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "success",
                `Dokument <strong>${escapeHtml(wordTemplateFormatters.value(payload.output_filename || documentItem.output_filename))}</strong> wurde gelöscht.`
            );
            this.closeDeleteDocumentModal();

            if (wasSelected) {
                if (wordTemplateState.selectionMode === "template" && wordTemplateState.selectedTemplate) {
                    this.selectNewDocument();
                } else {
                    await this.selectAllDocumentsMode();
                }
            }
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentDeleteStatus,
                "error",
                error.message || "Das Dokument konnte nicht gelöscht werden."
            );
        } finally {
            wordTemplateUi.setDeleteActionLoading(false);
        }
    },

    handleUserSearchInput(event) {
        wordTemplateState.userSearchTerm = event.target.value || "";
        wordTemplateUi.renderUserOptions();
    },

    handleUserSelectionChange(event) {
        wordTemplateState.selectedUserId = String(event.target.value || "");
    },

    handleOverlayClick(event) {
        if (event.target === wordTemplateDom.templateModalOverlay) {
            this.closeTemplateModal();
            return;
        }

        if (event.target === wordTemplateDom.deleteModalOverlay) {
            this.closeDeleteDocumentModal();
        }
    },

    handleKeydown(event) {
        if (event.key !== "Escape") {
            return;
        }

        if (wordTemplateState.isDeleteModalOpen) {
            this.closeDeleteDocumentModal();
            return;
        }

        if (wordTemplateState.isTemplateModalOpen) {
            this.closeTemplateModal();
        }
    },
};

document.addEventListener("DOMContentLoaded", () => {
    wordTemplateUi.cacheDom();

    if (!wordTemplateDom.templateModalForm) {
        return;
    }

    wordTemplateUi.prepareTemplateModalCreate();

    wordTemplateDom.templateModalForm.addEventListener("submit", (event) => wordTemplateHandlers.handleTemplateModalSubmit(event));
    wordTemplateDom.templateResetButton.addEventListener("click", () => wordTemplateHandlers.resetTemplateModal());
    wordTemplateDom.closeTemplateModalButton.addEventListener("click", () => wordTemplateHandlers.closeTemplateModal());
    wordTemplateDom.cancelTemplateModalButton.addEventListener("click", () => wordTemplateHandlers.closeTemplateModal());

    wordTemplateDom.openExistingDocumentButton.addEventListener("click", () => {
        if (wordTemplateState.existingDocument?.documentId) {
            wordTemplateHandlers.downloadDocument(
                wordTemplateState.existingDocument.documentId,
                wordTemplateState.existingDocument.filename || "bestehende-version.docx"
            );
        }
    });
    wordTemplateDom.prefillTemplateButton.addEventListener("click", () => wordTemplateHandlers.handlePrefillClick());
    wordTemplateDom.renderModalForm.addEventListener("submit", (event) => wordTemplateHandlers.handleRenderModalSubmit(event));
    wordTemplateDom.renderUserSearchInput.addEventListener("input", (event) => wordTemplateHandlers.handleUserSearchInput(event));
    wordTemplateDom.renderUserSelect.addEventListener("change", (event) => wordTemplateHandlers.handleUserSelectionChange(event));

    wordTemplateDom.closeDocumentDeleteModalButton.addEventListener("click", () => wordTemplateHandlers.closeDeleteDocumentModal());
    wordTemplateDom.cancelDocumentDeleteModalButton.addEventListener("click", () => wordTemplateHandlers.closeDeleteDocumentModal());
    wordTemplateDom.confirmDocumentDeleteButton.addEventListener("click", () => wordTemplateHandlers.handleDeleteDocumentConfirm());

    wordTemplateDom.templateModalOverlay.addEventListener("click", (event) => wordTemplateHandlers.handleOverlayClick(event));
    wordTemplateDom.deleteModalOverlay.addEventListener("click", (event) => wordTemplateHandlers.handleOverlayClick(event));
    document.addEventListener("keydown", (event) => wordTemplateHandlers.handleKeydown(event));

    wordTemplateUi.renderTemplateCardRow();
    wordTemplateUi.renderDocumentList();

    wordTemplateHandlers.loadTemplates();
    wordTemplateHandlers.selectAllDocumentsMode();
});
