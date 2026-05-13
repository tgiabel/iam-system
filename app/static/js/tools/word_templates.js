const wordTemplateState = {
    templates: [],
    allDocuments: [],
    templateDocuments: [],
    selectedTemplateId: null,
    selectedTemplate: null,
    selectedSchema: null,
    documentListMode: "all",
    users: [],
    userSearchTerm: "",
    selectedUserId: "",
    modalFields: [],
    existingDocument: null,
    templateModalMode: "create",
    isRenderModalOpen: false,
    isTemplateModalOpen: false,
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
        wordTemplateDom.templateList = document.getElementById("templateList");
        wordTemplateDom.templateListStatus = document.getElementById("templateListStatus");
        wordTemplateDom.templateListMeta = document.getElementById("templateListMeta");
        wordTemplateDom.openTemplateCreateButton = document.getElementById("openTemplateCreateButton");

        wordTemplateDom.documentList = document.getElementById("documentList");
        wordTemplateDom.documentListStatus = document.getElementById("documentListStatus");
        wordTemplateDom.documentListMeta = document.getElementById("documentListMeta");
        wordTemplateDom.documentListContext = document.getElementById("documentListContext");
        wordTemplateDom.documentModeAllButton = document.getElementById("documentModeAllButton");
        wordTemplateDom.documentModeTemplateButton = document.getElementById("documentModeTemplateButton");
        wordTemplateDom.openTemplateEditButton = document.getElementById("openTemplateEditButton");

        wordTemplateDom.renderStatus = document.getElementById("renderStatus");
        wordTemplateDom.renderMeta = document.getElementById("renderMeta");
        wordTemplateDom.renderEmptyState = document.getElementById("renderEmptyState");
        wordTemplateDom.renderLauncher = document.getElementById("renderLauncher");
        wordTemplateDom.renderLauncherTitle = document.getElementById("renderLauncherTitle");
        wordTemplateDom.renderLauncherCopy = document.getElementById("renderLauncherCopy");
        wordTemplateDom.openRenderModalButton = document.getElementById("openRenderModalButton");

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

        wordTemplateDom.renderModalOverlay = document.getElementById("word-template-render-modal");
        wordTemplateDom.renderModalTitle = document.getElementById("word-template-render-modal-title");
        wordTemplateDom.renderModalSubtitle = document.getElementById("renderModalSubtitle");
        wordTemplateDom.renderModalStatus = document.getElementById("renderModalStatus");
        wordTemplateDom.existingDocumentCard = document.getElementById("existingDocumentCard");
        wordTemplateDom.existingDocumentCopy = document.getElementById("existingDocumentCopy");
        wordTemplateDom.openExistingDocumentButton = document.getElementById("openExistingDocumentButton");
        wordTemplateDom.renderUserSearchInput = document.getElementById("renderUserSearchInput");
        wordTemplateDom.renderUserSelect = document.getElementById("renderUserSelect");
        wordTemplateDom.prefillTemplateButton = document.getElementById("prefillTemplateButton");
        wordTemplateDom.renderModalForm = document.getElementById("renderModalForm");
        wordTemplateDom.renderModalFields = document.getElementById("renderModalFields");
        wordTemplateDom.renderModalSubmitButton = document.getElementById("renderModalSubmitButton");
        wordTemplateDom.closeRenderModalButton = document.getElementById("closeRenderModalButton");
        wordTemplateDom.cancelRenderModalButton = document.getElementById("cancelRenderModalButton");
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
        wordTemplateDom.openRenderModalButton.disabled = isLoading;
        if (wordTemplateDom.openExistingDocumentButton) {
            wordTemplateDom.openExistingDocumentButton.disabled = isLoading;
        }

        if (mode === "prefill") {
            wordTemplateDom.prefillTemplateButton.textContent = isLoading ? "Vorlage wird gefüllt..." : "Vorlage automatisch ausfüllen";
            return;
        }

        wordTemplateDom.renderModalSubmitButton.textContent = isLoading ? "DOCX wird erzeugt..." : "DOCX erzeugen";
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

    renderTemplateList() {
        const list = wordTemplateDom.templateList;
        if (!list) {
            return;
        }

        list.innerHTML = "";
        wordTemplateDom.templateListMeta.textContent = `${wordTemplateState.templates.length} Vorlage(n)`;

        if (!wordTemplateState.templates.length) {
            list.innerHTML = `
                <article class="word-template-list-item is-placeholder" aria-disabled="true">
                    <div>
                        <strong>Keine Vorlagen gefunden</strong>
                        <p>Lege die erste Word-Vorlage an, um den Workflow zu starten.</p>
                    </div>
                </article>
            `;
            return;
        }

        wordTemplateState.templates.forEach((template) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "word-template-list-item word-template-list-button";
            if (String(template.template_id) === String(wordTemplateState.selectedTemplateId)) {
                button.classList.add("is-active");
            }

            button.innerHTML = `
                <span class="word-template-list-title">${escapeHtml(wordTemplateFormatters.value(template.name))}</span>
                <span class="word-template-list-copy">${escapeHtml(wordTemplateFormatters.value(template.description))}</span>
                <span class="word-template-list-meta">${escapeHtml(wordTemplateFormatters.value(template.original_filename))} · aktualisiert ${escapeHtml(wordTemplateFormatters.dateTime(template.updated_at || template.created_at))}</span>
            `;
            button.addEventListener("click", () => wordTemplateHandlers.selectTemplate(template.template_id));
            list.appendChild(button);
        });
    },

    renderDocumentModeButtons() {
        const isTemplateMode = wordTemplateState.documentListMode === "template";
        const hasTemplate = Boolean(wordTemplateState.selectedTemplateId);

        wordTemplateDom.documentModeAllButton.classList.toggle("is-active", !isTemplateMode);
        wordTemplateDom.documentModeTemplateButton.classList.toggle("is-active", isTemplateMode);
        wordTemplateDom.documentModeTemplateButton.disabled = !hasTemplate;
        wordTemplateDom.openTemplateEditButton.disabled = !hasTemplate;

        if (!hasTemplate) {
            wordTemplateDom.documentListContext.textContent = "Aktuell werden alle erzeugten Dokumente angezeigt.";
            return;
        }

        const templateName = wordTemplateState.selectedTemplate?.name || `Vorlage ${wordTemplateState.selectedTemplateId}`;
        if (isTemplateMode) {
            wordTemplateDom.documentListContext.textContent = `Aktive Ansicht: Dokumente für "${templateName}".`;
            return;
        }

        wordTemplateDom.documentListContext.textContent = `Aktive Vorlage: "${templateName}". Über den Toggle kannst du zwischen allen Dokumenten und dieser Vorlage wechseln.`;
    },

    renderDocumentList() {
        const list = wordTemplateDom.documentList;
        if (!list) {
            return;
        }

        list.innerHTML = "";
        const isTemplateMode = wordTemplateState.documentListMode === "template";
        const selectedTemplateId = String(wordTemplateState.selectedTemplateId || "");
        const rawDocuments = isTemplateMode ? wordTemplateState.templateDocuments : wordTemplateState.allDocuments;
        const documents = isTemplateMode && selectedTemplateId
            ? rawDocuments.filter((documentItem) => String(documentItem.template_id || "") === selectedTemplateId)
            : rawDocuments;

        wordTemplateDom.documentListMeta.textContent = `${documents.length} Dokument(e)`;

        if (isTemplateMode && !selectedTemplateId) {
            list.innerHTML = `
                <article class="word-template-list-item is-placeholder" aria-disabled="true">
                    <div>
                        <strong>Keine Vorlage gewählt</strong>
                        <p>Wähle zuerst links eine Vorlage aus, um nur deren Dokumente anzuzeigen.</p>
                    </div>
                </article>
            `;
            return;
        }

        if (!documents.length) {
            list.innerHTML = `
                <article class="word-template-list-item is-placeholder" aria-disabled="true">
                    <div>
                        <strong>Keine Dokumente gefunden</strong>
                        <p>${isTemplateMode ? "Für die ausgewählte Vorlage wurden noch keine Dokumente erzeugt." : "Es wurden noch keine Dokumente erzeugt."}</p>
                    </div>
                </article>
            `;
            return;
        }

        documents.forEach((documentItem) => {
            const article = document.createElement("article");
            article.className = "word-template-list-item word-template-document-item";
            article.innerHTML = `
                <div class="word-template-document-header">
                    <div>
                        <strong>${escapeHtml(wordTemplateFormatters.value(documentItem.output_filename))}</strong>
                        <p class="word-template-document-copy">${escapeHtml(wordTemplateFormatters.value(documentItem.template_name || documentItem.template_id))}</p>
                    </div>
                </div>
                <div class="word-template-document-actions">
                    <button type="button" class="btn btn-secondary" data-document-action="download">Download</button>
                    <button type="button" class="btn btn-red" data-document-action="delete">Löschen</button>
                </div>
                <p class="word-template-list-meta">Erstellt ${escapeHtml(wordTemplateFormatters.dateTime(documentItem.created_at))}</p>
            `;

            const downloadButton = article.querySelector('[data-document-action="download"]');
            downloadButton.addEventListener("click", () => wordTemplateHandlers.downloadDocument(documentItem.document_id, documentItem.output_filename));
            list.appendChild(article);
        });
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
        if (!wordTemplateState.isRenderModalOpen) {
            document.body.style.overflow = "";
        }
    },

    syncRenderLauncher() {
        if (!wordTemplateState.selectedTemplate || !wordTemplateState.selectedSchema) {
            wordTemplateDom.renderMeta.textContent = "Dialog";
            this.setStatus(
                wordTemplateDom.renderStatus,
                "info",
                "Nach Auswahl einer Vorlage wird ein Dialog geöffnet, in dem das Formular automatisch oder manuell ausgefüllt werden kann."
            );
            wordTemplateDom.renderEmptyState.hidden = false;
            wordTemplateDom.renderLauncher.hidden = true;
            return;
        }

        wordTemplateDom.renderMeta.textContent = wordTemplateFormatters.value(wordTemplateState.selectedTemplate.name);
        this.setStatus(
            wordTemplateDom.renderStatus,
            "success",
            "Die Vorlage ist geladen. Der Dokument-Dialog kann jetzt geöffnet und bei Bedarf mit Userdaten vorbefüllt werden."
        );
        wordTemplateDom.renderEmptyState.hidden = true;
        wordTemplateDom.renderLauncher.hidden = false;
        wordTemplateDom.renderLauncherTitle.textContent = wordTemplateState.selectedTemplate.name || "Vorlage ausgewählt";
        wordTemplateDom.renderLauncherCopy.textContent = "Der Dialog erzeugt aus dem Schema ein HTML-Formular. Felder können automatisch vorbefüllt und vor dem Download noch angepasst werden.";
        wordTemplateDom.openRenderModalButton.disabled = false;
    },

    openRenderModal() {
        wordTemplateDom.renderModalOverlay.classList.add("active");
        wordTemplateDom.renderModalOverlay.setAttribute("aria-hidden", "false");
        wordTemplateState.isRenderModalOpen = true;
        document.body.style.overflow = "hidden";
    },

    closeRenderModal() {
        wordTemplateDom.renderModalOverlay.classList.remove("active");
        wordTemplateDom.renderModalOverlay.setAttribute("aria-hidden", "true");
        wordTemplateState.isRenderModalOpen = false;
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
        const { selectTemplateId = null, successMessage = "" } = options;
        wordTemplateUi.setStatus(wordTemplateDom.templateListStatus, "info", "Vorlagen werden geladen...");

        try {
            const templates = await wordTemplateApi.listTemplates();
            wordTemplateState.templates = Array.isArray(templates) ? templates : [];
            wordTemplateUi.renderTemplateList();
            wordTemplateUi.setStatus(
                wordTemplateDom.templateListStatus,
                successMessage ? "success" : "info",
                successMessage || `${wordTemplateState.templates.length} Vorlage(n) erfolgreich geladen.`
            );

            if (selectTemplateId) {
                await this.selectTemplate(selectTemplateId);
                return;
            }

            if (
                wordTemplateState.selectedTemplateId
                && !wordTemplateState.templates.some((template) => String(template.template_id) === String(wordTemplateState.selectedTemplateId))
            ) {
                wordTemplateState.selectedTemplateId = null;
                wordTemplateState.selectedTemplate = null;
                wordTemplateState.selectedSchema = null;
                wordTemplateState.documentListMode = "all";
                wordTemplateUi.renderTemplateList();
                wordTemplateUi.renderDocumentModeButtons();
                wordTemplateUi.syncRenderLauncher();
                await this.loadDocuments({ mode: "all" });
            }
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.templateListStatus,
                "error",
                error.message || "Vorlagen konnten nicht geladen werden."
            );
        }
    },

    async loadDocuments(options = {}) {
        const { mode = wordTemplateState.documentListMode, successMessage = "" } = options;
        wordTemplateState.documentListMode = mode;
        wordTemplateUi.renderDocumentModeButtons();

        if (mode === "template" && !wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "info",
                "Wähle zuerst eine Vorlage aus, um nur die Dokumente dieser Vorlage anzuzeigen."
            );
            wordTemplateUi.renderDocumentList();
            return;
        }

        wordTemplateUi.setStatus(wordTemplateDom.documentListStatus, "info", "Dokumente werden geladen...");

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
            }

            wordTemplateUi.renderDocumentList();
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                successMessage ? "success" : "info",
                successMessage || `${normalizedDocuments.length} Dokument(e) erfolgreich geladen.`
            );
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "error",
                error.message || "Die Dokumentenliste konnte nicht geladen werden."
            );
            wordTemplateUi.renderDocumentList();
        }
    },

    async selectTemplate(templateId) {
        wordTemplateState.selectedTemplateId = String(templateId);
        wordTemplateUi.renderTemplateList();
        wordTemplateUi.renderDocumentModeButtons();
        wordTemplateUi.setStatus(wordTemplateDom.renderStatus, "info", "Vorlagendetails werden geladen...");

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
            wordTemplateState.documentListMode = "template";

            wordTemplateUi.renderTemplateList();
            wordTemplateUi.renderDocumentModeButtons();
            wordTemplateUi.syncRenderLauncher();
            await this.loadDocuments({
                mode: "template",
                successMessage: `Dokumente für <strong>${escapeHtml(wordTemplateFormatters.value(template.name))}</strong> wurden geladen.`,
            });
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.renderStatus,
                "error",
                error.message || "Die Vorlage konnte nicht geladen werden."
            );
        }
    },

    setDocumentMode(mode) {
        if (mode === "template" && !wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(
                wordTemplateDom.documentListStatus,
                "error",
                "Bitte wählen Sie zuerst eine Vorlage aus."
            );
            return;
        }

        this.loadDocuments({ mode });
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
                    successMessage: `Vorlage <strong>${escapeHtml(wordTemplateFormatters.value(updated.name || name))}</strong> wurde aktualisiert.`,
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
                successMessage: `Vorlage <strong>${escapeHtml(wordTemplateFormatters.value(created.name || name))}</strong> wurde angelegt.`,
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

        wordTemplateUi.setStatus(wordTemplateDom.renderModalStatus, "info", "User-Liste wird geladen...");

        try {
            const users = await wordTemplateApi.listTemplateUsers();
            wordTemplateState.users = Array.isArray(users) ? users : [];
            wordTemplateUi.renderUserOptions();
            wordTemplateUi.setStatus(
                wordTemplateDom.renderModalStatus,
                "info",
                "Das Formular kann manuell ausgefüllt oder mit Userdaten vorbefüllt werden."
            );
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.renderModalStatus,
                "error",
                error.message || "Die User-Liste konnte nicht geladen werden."
            );
        }
    },

    openRenderModal() {
        if (!wordTemplateState.selectedTemplate || !wordTemplateState.selectedSchema) {
            wordTemplateUi.setStatus(wordTemplateDom.renderStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            return;
        }

        wordTemplateState.modalFields = wordTemplateSchemaUtils.buildModalFieldsFromSchema(wordTemplateState.selectedSchema);
        wordTemplateState.selectedUserId = "";
        wordTemplateState.userSearchTerm = "";
        wordTemplateState.existingDocument = null;

        wordTemplateDom.renderModalTitle.textContent = wordTemplateState.selectedTemplate.name || "Dokument erstellen";
        wordTemplateDom.renderModalSubtitle.textContent = "Wähle einen User zum Vorbefüllen oder trage die Werte direkt im Formular ein.";
        wordTemplateDom.renderUserSearchInput.value = "";
        wordTemplateUi.renderExistingDocumentCard();
        wordTemplateUi.renderUserOptions();
        wordTemplateUi.renderModalFields();
        wordTemplateUi.setStatus(
            wordTemplateDom.renderModalStatus,
            "info",
            "Das Formular wurde aus dem Schema aufgebaut. Felder können jetzt manuell gepflegt oder automatisch vorbefüllt werden."
        );
        wordTemplateUi.openRenderModal();
        this.ensureUsersLoaded();
        wordTemplateDom.renderUserSearchInput.focus();
    },

    closeRenderModal() {
        wordTemplateUi.closeRenderModal();
    },

    async handlePrefillClick() {
        if (!wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(wordTemplateDom.renderModalStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            return;
        }

        if (!wordTemplateState.selectedUserId) {
            wordTemplateUi.setStatus(wordTemplateDom.renderModalStatus, "error", "Bitte wählen Sie einen User zum Vorbefüllen aus.");
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
                wordTemplateDom.renderModalStatus,
                "success",
                wordTemplateState.existingDocument
                    ? "Die Vorlage wurde vorbefüllt. Zusätzlich steht die letzte bereits generierte Version direkt zum Öffnen bereit."
                    : "Die Vorlage wurde mit den verfügbaren Userdaten vorbefüllt. Alle sichtbaren Felder können vor dem Download noch angepasst werden."
            );
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.renderModalStatus,
                "error",
                error.message || "Die Vorlage konnte nicht automatisch ausgefüllt werden."
            );
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
            wordTemplateUi.setStatus(wordTemplateDom.renderModalStatus, "error", "Bitte wählen Sie zuerst eine Vorlage aus.");
            return;
        }

        const { values, error } = this.collectModalValues();
        if (error) {
            wordTemplateUi.setStatus(wordTemplateDom.renderModalStatus, "error", error);
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
                wordTemplateDom.renderModalStatus,
                "success",
                `Das Dokument wurde erfolgreich erzeugt. Der Download für <code>${escapeHtml(filename)}</code> wurde gestartet.`
            );
            await this.loadDocuments({
                mode: wordTemplateState.documentListMode,
                successMessage: "Die Dokumentenliste wurde nach dem Rendern aktualisiert.",
            });
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.renderModalStatus,
                "error",
                error.message || "Das Dokument konnte nicht erzeugt werden."
            );
        } finally {
            wordTemplateUi.setRenderActionLoading(false, "render");
        }
    },

    async downloadDocument(documentId, fallbackFilename = "document.docx") {
        try {
            const { blob, filename } = await wordTemplateApi.downloadDocument(documentId, fallbackFilename);
            wordTemplateUi.downloadBlob(blob, filename);
        } catch (error) {
            const targetStatus = wordTemplateState.isRenderModalOpen
                ? wordTemplateDom.renderModalStatus
                : wordTemplateDom.documentListStatus;
            wordTemplateUi.setStatus(
                targetStatus,
                "error",
                error.message || "Das Dokument konnte nicht heruntergeladen werden."
            );
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
        if (event.target === wordTemplateDom.renderModalOverlay) {
            this.closeRenderModal();
            return;
        }

        if (event.target === wordTemplateDom.templateModalOverlay) {
            this.closeTemplateModal();
        }
    },

    handleKeydown(event) {
        if (event.key !== "Escape") {
            return;
        }

        if (wordTemplateState.isRenderModalOpen) {
            this.closeRenderModal();
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
    wordTemplateUi.renderDocumentModeButtons();
    wordTemplateUi.syncRenderLauncher();

    wordTemplateDom.openTemplateCreateButton.addEventListener("click", () => wordTemplateHandlers.openCreateTemplateModal());
    wordTemplateDom.openTemplateEditButton.addEventListener("click", () => wordTemplateHandlers.openEditTemplateModal());
    wordTemplateDom.templateModalForm.addEventListener("submit", (event) => wordTemplateHandlers.handleTemplateModalSubmit(event));
    wordTemplateDom.templateResetButton.addEventListener("click", () => wordTemplateHandlers.resetTemplateModal());
    wordTemplateDom.closeTemplateModalButton.addEventListener("click", () => wordTemplateHandlers.closeTemplateModal());
    wordTemplateDom.cancelTemplateModalButton.addEventListener("click", () => wordTemplateHandlers.closeTemplateModal());

    wordTemplateDom.documentModeAllButton.addEventListener("click", () => wordTemplateHandlers.setDocumentMode("all"));
    wordTemplateDom.documentModeTemplateButton.addEventListener("click", () => wordTemplateHandlers.setDocumentMode("template"));

    wordTemplateDom.openRenderModalButton.addEventListener("click", () => wordTemplateHandlers.openRenderModal());
    wordTemplateDom.closeRenderModalButton.addEventListener("click", () => wordTemplateHandlers.closeRenderModal());
    wordTemplateDom.cancelRenderModalButton.addEventListener("click", () => wordTemplateHandlers.closeRenderModal());
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

    wordTemplateDom.renderModalOverlay.addEventListener("click", (event) => wordTemplateHandlers.handleOverlayClick(event));
    wordTemplateDom.templateModalOverlay.addEventListener("click", (event) => wordTemplateHandlers.handleOverlayClick(event));
    document.addEventListener("keydown", (event) => wordTemplateHandlers.handleKeydown(event));

    wordTemplateHandlers.loadTemplates();
    wordTemplateHandlers.loadDocuments({ mode: "all" });
});
