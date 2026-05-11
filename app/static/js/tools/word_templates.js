const wordTemplateState = {
    templates: [],
    selectedTemplateId: null,
    selectedTemplate: null,
    selectedSchema: null,
    latestDocumentId: null,
    latestOutputFilename: null,
};

const wordTemplateDom = {};

const wordTemplateApi = {
    async request(url, options = {}) {
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

    listTemplates() {
        return this.request("/api/dataprocessing/word-templates");
    },

    getTemplate(templateId) {
        return this.request(`/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}`);
    },

    createTemplate(formData) {
        return this.request("/api/dataprocessing/word-templates", {
            method: "POST",
            body: formData,
        });
    },

    updateTemplate(templateId, payload) {
        return this.request(`/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    renderTemplate(templateId, payload) {
        return this.request(`/api/dataprocessing/word-templates/${encodeURIComponent(templateId)}/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
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

            if (type === "text" && field.default !== undefined && typeof field.default !== "string") {
                return `Das Feld "${key}" erwartet für default einen String.`;
            }

            if (type === "checkbox" && field.default !== undefined && typeof field.default !== "boolean") {
                return `Das Feld "${key}" erwartet für default einen Boolean.`;
            }

            if (type !== "text" && field.max_length !== undefined) {
                return `max_length ist nur für text-Felder erlaubt (${key}).`;
            }

            if (type === "text" && field.max_length !== undefined) {
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
};

const wordTemplateUi = {
    cacheDom() {
        wordTemplateDom.templateList = document.getElementById("templateList");
        wordTemplateDom.templateListStatus = document.getElementById("templateListStatus");
        wordTemplateDom.templateListMeta = document.getElementById("templateListMeta");
        wordTemplateDom.templateEditStatus = document.getElementById("templateEditStatus");
        wordTemplateDom.templateEditMeta = document.getElementById("templateEditMeta");
        wordTemplateDom.templateUploadForm = document.getElementById("templateUploadForm");
        wordTemplateDom.templateNameInput = document.getElementById("templateNameInput");
        wordTemplateDom.templateDescriptionInput = document.getElementById("templateDescriptionInput");
        wordTemplateDom.templateSchemaInput = document.getElementById("templateSchemaInput");
        wordTemplateDom.templateFileInput = document.getElementById("templateFileInput");
        wordTemplateDom.templateFileHelp = document.getElementById("templateFileHelp");
        wordTemplateDom.templateSubmitButton = document.getElementById("templateSubmitButton");
        wordTemplateDom.templateResetButton = document.getElementById("templateResetButton");
        wordTemplateDom.renderStatus = document.getElementById("renderStatus");
        wordTemplateDom.renderMeta = document.getElementById("renderMeta");
        wordTemplateDom.renderEmptyState = document.getElementById("renderEmptyState");
        wordTemplateDom.renderForm = document.getElementById("renderForm");
        wordTemplateDom.renderFields = document.getElementById("renderFields");
        wordTemplateDom.renderResult = document.getElementById("renderResult");
        wordTemplateDom.renderSubmitButton = document.getElementById("renderSubmitButton");
        wordTemplateDom.downloadDocumentButton = document.getElementById("downloadDocumentButton");
    },

    setStatus(element, tone, message) {
        if (!element) {
            return;
        }

        element.className = `word-template-status word-template-status-${tone}`;
        element.innerHTML = message;
    },

    setSubmitLoading(isLoading) {
        if (!wordTemplateDom.templateSubmitButton) {
            return;
        }

        wordTemplateDom.templateSubmitButton.disabled = isLoading;
        if (wordTemplateState.selectedTemplateId) {
            wordTemplateDom.templateSubmitButton.textContent = isLoading ? "Vorlage wird aktualisiert..." : "Vorlage aktualisieren";
            return;
        }

        wordTemplateDom.templateSubmitButton.textContent = isLoading ? "Vorlage wird gespeichert..." : "Vorlage speichern";
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
                <span class="word-template-list-title">${wordTemplateFormatters.value(template.name)}</span>
                <span class="word-template-list-copy">${wordTemplateFormatters.value(template.description)}</span>
                <span class="word-template-list-meta">${wordTemplateFormatters.value(template.original_filename)} · aktualisiert ${wordTemplateFormatters.dateTime(template.updated_at)}</span>
            `;

            button.addEventListener("click", () => wordTemplateHandlers.selectTemplate(template.template_id));
            list.appendChild(button);
        });
    },

    populateForm(template, schema) {
        wordTemplateDom.templateNameInput.value = template.name || "";
        wordTemplateDom.templateDescriptionInput.value = template.description || "";
        wordTemplateDom.templateSchemaInput.value = JSON.stringify(schema, null, 2);
        wordTemplateDom.templateFileInput.value = "";
        wordTemplateDom.templateFileInput.required = false;
        wordTemplateDom.templateFileInput.disabled = true;
        wordTemplateDom.templateSubmitButton.textContent = "Vorlage aktualisieren";
        wordTemplateDom.templateResetButton.textContent = "Neue Vorlage vorbereiten";
        wordTemplateDom.templateFileHelp.innerHTML = `Aktive Datei: <code>${wordTemplateFormatters.value(template.original_filename)}</code>. Der Austausch der <code>.dotx</code>-Datei ist in V1 nicht vorgesehen.`;
        wordTemplateDom.templateEditMeta.textContent = `Bearbeite ID ${template.template_id}`;
    },

    resetForm() {
        wordTemplateState.selectedTemplateId = null;
        wordTemplateState.selectedTemplate = null;
        wordTemplateState.selectedSchema = null;
        wordTemplateState.latestDocumentId = null;
        wordTemplateState.latestOutputFilename = null;

        wordTemplateDom.templateUploadForm.reset();
        wordTemplateDom.templateSchemaInput.value = wordTemplateSchemaUtils.example();
        wordTemplateDom.templateFileInput.required = true;
        wordTemplateDom.templateFileInput.disabled = false;
        wordTemplateDom.templateSubmitButton.disabled = false;
        wordTemplateDom.templateSubmitButton.textContent = "Vorlage speichern";
        wordTemplateDom.templateResetButton.textContent = "Formular zurücksetzen";
        wordTemplateDom.templateFileHelp.innerHTML = `Erlaubt ist ausschließlich eine <code>.dotx</code>-Datei.`;
        wordTemplateDom.templateEditMeta.textContent = "Upload & Schema";
        this.setStatus(
            wordTemplateDom.templateEditStatus,
            "info",
            'Name, Beschreibung, Schema und <code>.dotx</code>-Datei werden hier gepflegt.'
        );
        this.updateRenderPlaceholder();
        this.renderTemplateList();
    },

    updateRenderPlaceholder() {
        if (!wordTemplateState.selectedTemplate) {
            wordTemplateDom.renderMeta.textContent = "Dynamisches Formular";
            this.setStatus(
                wordTemplateDom.renderStatus,
                "info",
                "Nach Auswahl einer Vorlage wird aus dem gespeicherten Schema automatisch ein Formular erzeugt."
            );
            wordTemplateDom.renderForm.hidden = true;
            wordTemplateDom.renderEmptyState.hidden = false;
            wordTemplateDom.renderResult.hidden = true;
            wordTemplateDom.renderResult.innerHTML = "";
            wordTemplateDom.downloadDocumentButton.disabled = true;
            wordTemplateDom.renderEmptyState.innerHTML = `
                <strong>Render-Formular folgt</strong>
                <p>Wähle oder erstelle zuerst eine Vorlage, damit die Felder aus <code>schema_json.fields</code> aufgebaut werden können.</p>
            `;
            return;
        }

        wordTemplateDom.renderMeta.textContent = wordTemplateFormatters.value(wordTemplateState.selectedTemplate.name);
        this.setStatus(
            wordTemplateDom.renderStatus,
            "info",
            "Die Vorlage ist geladen. Das Render-Formular wurde aus dem gespeicherten Schema erzeugt."
        );
        this.buildRenderForm();
    },

    buildRenderForm() {
        const schema = wordTemplateState.selectedSchema;
        const renderFields = wordTemplateDom.renderFields;

        wordTemplateState.latestDocumentId = null;
        wordTemplateState.latestOutputFilename = null;
        wordTemplateDom.downloadDocumentButton.disabled = true;
        wordTemplateDom.renderResult.hidden = true;
        wordTemplateDom.renderResult.innerHTML = "";
        wordTemplateDom.renderFields.innerHTML = "";
        wordTemplateDom.renderEmptyState.hidden = true;
        wordTemplateDom.renderForm.hidden = false;

        if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) {
            renderFields.innerHTML = `
                <div class="word-template-empty-state">
                    <strong>Keine Felder definiert</strong>
                    <p>Die Vorlage enthält aktuell keine ausfüllbaren Schema-Felder. Das Dokument kann trotzdem direkt gerendert werden.</p>
                </div>
            `;
            return;
        }

        schema.fields.forEach((field, index) => {
            const wrapper = document.createElement("div");
            wrapper.className = "word-template-render-field";

            const fieldKey = String(field.key || "");
            const fieldLabel = String(field.label || field.key || "Feld");
            const placeholder = String(field.placeholder || "");
            const requiredLabel = field.required ? "Pflichtfeld" : "Optional";
            const description = `${placeholder || "Kein Platzhalter"} · ${requiredLabel}`;

            if (field.type === "checkbox") {
                const checkboxId = `render-field-${fieldKey}`;
                const defaultValue = typeof field.default === "boolean" ? field.default : false;
                wrapper.innerHTML = `
                    <label for="${checkboxId}">${fieldLabel}</label>
                    <p class="word-template-render-field-copy">${description}</p>
                    <label class="word-template-checkbox-row" for="${checkboxId}">
                        <input
                            id="${checkboxId}"
                            type="checkbox"
                            data-render-field-index="${index}"
                            data-render-field-type="checkbox"
                            ${defaultValue ? "checked" : ""}>
                        <span>${field.true_value || "Aktiv"}</span>
                    </label>
                `;
                renderFields.appendChild(wrapper);
                return;
            }

            const input = document.createElement("input");
            input.type = "text";
            input.className = "word-template-input";
            input.id = `render-field-${fieldKey}`;
            input.name = fieldKey;
            input.placeholder = placeholder;
            input.value = typeof field.default === "string" ? field.default : "";
            input.dataset.renderFieldIndex = String(index);
            input.dataset.renderFieldType = "text";

            if (Number.isInteger(field.max_length)) {
                input.maxLength = field.max_length;
            }

            wrapper.innerHTML = `
                <label for="${input.id}">${fieldLabel}</label>
                <p class="word-template-render-field-copy">${description}</p>
            `;
            wrapper.appendChild(input);
            renderFields.appendChild(wrapper);
        });
    },

    setRenderLoading(isLoading) {
        if (!wordTemplateDom.renderSubmitButton) {
            return;
        }

        wordTemplateDom.renderSubmitButton.disabled = isLoading;
        wordTemplateDom.renderSubmitButton.textContent = isLoading ? "Dokument wird erzeugt..." : "Dokument rendern";
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

            if (successMessage) {
                wordTemplateUi.setStatus(wordTemplateDom.templateListStatus, "success", successMessage);
            } else {
                wordTemplateUi.setStatus(
                    wordTemplateDom.templateListStatus,
                    "info",
                    `${wordTemplateState.templates.length} Vorlage(n) erfolgreich geladen.`
                );
            }

            if (selectTemplateId) {
                await this.selectTemplate(selectTemplateId);
            }
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.templateListStatus,
                "error",
                error.message || "Vorlagen konnten nicht geladen werden."
            );
        }
    },

    async selectTemplate(templateId) {
        wordTemplateState.selectedTemplateId = String(templateId);
        wordTemplateUi.renderTemplateList();
        wordTemplateUi.setStatus(wordTemplateDom.templateEditStatus, "info", "Vorlagendetails werden geladen...");

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
            wordTemplateUi.populateForm(template, schema);
            wordTemplateUi.setStatus(
                wordTemplateDom.templateEditStatus,
                "success",
                `Vorlage <strong>${wordTemplateFormatters.value(template.name)}</strong> wurde geladen und kann jetzt bearbeitet werden.`
            );
            wordTemplateUi.updateRenderPlaceholder();
            wordTemplateUi.renderTemplateList();
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.templateEditStatus,
                "error",
                error.message || "Die Vorlage konnte nicht geladen werden."
            );
        }
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

    collectRenderValues() {
        const schema = wordTemplateState.selectedSchema;
        const values = {};

        if (!schema || !Array.isArray(schema.fields)) {
            return { values, error: null };
        }

        for (const [index, field] of schema.fields.entries()) {
            const key = String(field.key || "");
            if (!key) {
                continue;
            }

            const input = wordTemplateDom.renderFields.querySelector(`[data-render-field-index="${index}"]`);
            if (!input) {
                return { values: null, error: `Das Eingabefeld für "${key}" konnte nicht gefunden werden.` };
            }

            if (field.type === "checkbox") {
                values[key] = Boolean(input.checked);
                continue;
            }

            const rawValue = String(input.value || "");
            if (!rawValue && typeof field.default === "string") {
                values[key] = field.default;
            } else {
                values[key] = rawValue;
            }

            if (!values[key] && field.required && field.default === undefined) {
                return { values: null, error: `Das Pflichtfeld "${field.label || key}" muss ausgefüllt werden.` };
            }

            if (field.max_length && values[key].length > field.max_length) {
                return { values: null, error: `Das Feld "${field.label || key}" überschreitet die maximale Länge von ${field.max_length}.` };
            }
        }

        return { values, error: null };
    },

    async handleSubmit(event) {
        event.preventDefault();

        const name = wordTemplateDom.templateNameInput.value.trim();
        const description = wordTemplateDom.templateDescriptionInput.value.trim();
        const rawSchema = wordTemplateDom.templateSchemaInput.value.trim();
        const { schema, error: parseError } = wordTemplateSchemaUtils.parse(rawSchema);

        if (parseError) {
            wordTemplateUi.setStatus(wordTemplateDom.templateEditStatus, "error", parseError);
            return;
        }

        const validationError = wordTemplateSchemaUtils.validate(schema);
        if (validationError) {
            wordTemplateUi.setStatus(wordTemplateDom.templateEditStatus, "error", validationError);
            return;
        }

        if (!name) {
            wordTemplateUi.setStatus(wordTemplateDom.templateEditStatus, "error", "Der Vorlagenname ist erforderlich.");
            return;
        }

        wordTemplateUi.setSubmitLoading(true);

        try {
            if (wordTemplateState.selectedTemplateId) {
                const updated = await wordTemplateApi.updateTemplate(wordTemplateState.selectedTemplateId, {
                    name,
                    description,
                    schema,
                });

                wordTemplateUi.setStatus(
                    wordTemplateDom.templateEditStatus,
                    "success",
                    `Vorlage <strong>${wordTemplateFormatters.value(updated.name || name)}</strong> wurde aktualisiert.`
                );
                await this.loadTemplates({
                    selectTemplateId: updated.template_id || wordTemplateState.selectedTemplateId,
                    successMessage: "Vorlagenliste wurde nach dem Update aktualisiert.",
                });
                return;
            }

            const file = wordTemplateDom.templateFileInput.files?.[0];
            const fileError = this.validateCreateFile(file);
            if (fileError) {
                wordTemplateUi.setStatus(wordTemplateDom.templateEditStatus, "error", fileError);
                return;
            }

            const formData = new FormData();
            formData.append("name", name);
            formData.append("description", description);
            formData.append("schema_json", JSON.stringify(schema));
            formData.append("template_file", file);

            const created = await wordTemplateApi.createTemplate(formData);
            wordTemplateUi.setStatus(
                wordTemplateDom.templateEditStatus,
                "success",
                `Vorlage <strong>${wordTemplateFormatters.value(created.name || name)}</strong> wurde angelegt.`
            );
            await this.loadTemplates({
                selectTemplateId: created.template_id,
                successMessage: "Vorlagenliste wurde nach dem Upload aktualisiert.",
            });
        } catch (error) {
            wordTemplateUi.setStatus(
                wordTemplateDom.templateEditStatus,
                "error",
                error.message || "Die Vorlage konnte nicht gespeichert werden."
            );
        } finally {
            wordTemplateUi.setSubmitLoading(false);
        }
    },

    async handleRenderSubmit(event) {
        event.preventDefault();

        if (!wordTemplateState.selectedTemplateId) {
            wordTemplateUi.setStatus(wordTemplateDom.renderStatus, "error", "Bitte wählen Sie zuerst eine gespeicherte Vorlage aus.");
            return;
        }

        const { values, error } = this.collectRenderValues();
        if (error) {
            wordTemplateUi.setStatus(wordTemplateDom.renderStatus, "error", error);
            return;
        }

        wordTemplateUi.setRenderLoading(true);

        try {
            const result = await wordTemplateApi.renderTemplate(wordTemplateState.selectedTemplateId, { values });
            wordTemplateState.latestDocumentId = result.document_id;
            wordTemplateState.latestOutputFilename = result.output_filename;
            wordTemplateDom.downloadDocumentButton.disabled = !result.document_id;
            wordTemplateDom.renderResult.hidden = false;
            wordTemplateDom.renderResult.innerHTML = `
                <strong>Dokument erfolgreich erzeugt</strong>
                <div>Dateiname: <code>${wordTemplateFormatters.value(result.output_filename)}</code></div>
                <div>Dokument-ID: <code>${wordTemplateFormatters.value(result.document_id)}</code></div>
            `;
            wordTemplateUi.setStatus(
                wordTemplateDom.renderStatus,
                "success",
                `Die Vorlage wurde erfolgreich gerendert. Das Ergebnis kann jetzt als <code>.docx</code> heruntergeladen werden.`
            );
        } catch (renderError) {
            wordTemplateDom.downloadDocumentButton.disabled = true;
            wordTemplateDom.renderResult.hidden = true;
            wordTemplateUi.setStatus(
                wordTemplateDom.renderStatus,
                "error",
                renderError.message || "Das Dokument konnte nicht erzeugt werden."
            );
        } finally {
            wordTemplateUi.setRenderLoading(false);
        }
    },

    handleDownloadClick() {
        if (!wordTemplateState.latestDocumentId) {
            wordTemplateUi.setStatus(wordTemplateDom.renderStatus, "error", "Es steht noch kein generiertes Dokument zum Download bereit.");
            return;
        }

        window.location.href = `/api/dataprocessing/word-documents/${encodeURIComponent(wordTemplateState.latestDocumentId)}/download`;
    },
};

document.addEventListener("DOMContentLoaded", () => {
    wordTemplateUi.cacheDom();

    if (!wordTemplateDom.templateUploadForm) {
        return;
    }

    wordTemplateUi.resetForm();
    wordTemplateDom.templateUploadForm.addEventListener("submit", (event) => wordTemplateHandlers.handleSubmit(event));
    wordTemplateDom.templateResetButton.addEventListener("click", () => wordTemplateUi.resetForm());
    wordTemplateDom.renderForm.addEventListener("submit", (event) => wordTemplateHandlers.handleRenderSubmit(event));
    wordTemplateDom.downloadDocumentButton.addEventListener("click", () => wordTemplateHandlers.handleDownloadClick());
    wordTemplateHandlers.loadTemplates();
});
