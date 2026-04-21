//------------------------------------------------
// STATE
//------------------------------------------------

let system = null;

const DOM = {};
const STATE = {
    overlayMode: "view",
    currentResource: null,
    parentResourceCandidates: [],
    parentResourceQuery: "",
    selectedParentResourceId: null,
    users: [],
    isEditing: false
};

const TASK_TYPES = ["ASSIGNMENT", "REVOCATION"];
const PARENT_RESOURCE_TYPE_ID = 1;

const api = {
    async createResource(sysId, typeId, displayName, technicalIdentifier, handlingType, parentResourceId = null, meta = null) {
        try {    
            const body = { 
                system_id: sysId,
                type_id: typeId,
                display_name: displayName,
                technical_identifier: technicalIdentifier,
                override_handling_type: handlingType,
                parent_resource_id: parentResourceId
            };
            if (Array.isArray(meta) && meta.length > 0) {
                body.meta = meta;
            }
            const res = await fetch(`/api/resources`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }
            showFlash(`Resource hinzugefügt.`, "success");
            return true;
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return false;
        }
    },
    async updateResource(resId, sysId, typeId, displayName, technicalIdentifier, handlingType, parentResourceId = null, meta = null) {
        try{
            const body = {
                resource_id: resId,
                system_id: sysId,
                type_id: typeId,
                display_name: displayName,
                technical_identifier: technicalIdentifier,
                override_handling_type: handlingType,
                parent_resource_id: parentResourceId
            };
            if (Array.isArray(meta) && meta.length > 0) {
                body.meta = meta;
            }
            const res = await fetch(`/api/resources/${resId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }
            showFlash(`Resource aktualisiert.`, "success");
            return true;
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return false;
        }
    },
    async updateSystem(systemId, payload) {
        try {
            const res = await fetch(`/api/systems/${systemId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || data.error || "System konnte nicht gespeichert werden", "failure");
                return false;
            }

            return data;
        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
            return false;
        }
    }
}

//------------------------------------------------
// INIT
//------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init(){
    const msg = sessionStorage.getItem("flash_msg");
    const type = sessionStorage.getItem("flash_type");

    if (msg) {
        showFlash(msg, type);
        sessionStorage.removeItem("flash_msg");
        sessionStorage.removeItem("flash_type");
    }
    cacheDOM();
    bindBaseEvents();
    await loadUsers();
    await loadParentResourceCandidates();
    await loadSystemDetail();
}

//------------------------------------------------
// DOM CACHE
//------------------------------------------------

function cacheDOM(){
    
    DOM.infoFields = document.querySelectorAll(".info-field");
    DOM.sectionButtons = document.querySelectorAll(".section-actions button");
    
    DOM.overlay = document.getElementById("resource-overlay");
    DOM.closeBtn = document.getElementById("resource-close-btn");
    DOM.cancelBtn = document.getElementById("resource-cancel-btn");

    DOM.form = document.getElementById("resource-form-container");
    DOM.selectContainer = document.getElementById("resource-select-container");
    DOM.selectRes = document.getElementById("resource-select");

    DOM.title = document.getElementById("resource-modal-title");
    DOM.saveResBtn = document.getElementById("resource-save-btn");

    DOM.tableBody = document.querySelector("#resources-table tbody");

    DOM.addResBtn = document.getElementById("add-resource-btn");
    DOM.editResBtn = document.getElementById("edit-resources-btn");

    DOM.editBtn = document.querySelector("#edit-system-btn");
    DOM.cancelEdit = document.querySelector("#cancel-edit-btn");
    DOM.saveEdit = document.querySelector("#save-edit-btn");
    DOM.editActions = document.querySelector("#edit-actions");

    // form fields
    DOM.displayName = document.getElementById("res-display-name");
    DOM.techId = document.getElementById("res-technical-id");
    DOM.type = document.getElementById("res-type");
    DOM.handling = document.getElementById("res-handling");
    DOM.parentSearch = document.getElementById("res-parent-search");
    DOM.parentSelect = document.getElementById("res-parent-id");
    DOM.parentSelectionLabel = document.getElementById("res-parent-selection-label");
    DOM.handlingMetaContainer = document.getElementById("resource-meta-container");
    DOM.metaFields = {
        EXTERNAL: {
            ASSIGNMENT: {
                recipient: document.getElementById("res-external-recipient-assignment"),
                subject: document.getElementById("res-external-subject-assignment"),
                body: document.getElementById("res-external-body-assignment")
            },
            REVOCATION: {
                recipient: document.getElementById("res-external-recipient-revocation"),
                subject: document.getElementById("res-external-subject-revocation"),
                body: document.getElementById("res-external-body-revocation")
            }
        },
        BOT: {
            ASSIGNMENT: {
                bot: document.getElementById("res-bot-name-assignment"),
                action: document.getElementById("res-bot-action-assignment"),
                data: document.getElementById("res-bot-data-assignment")
            },
            REVOCATION: {
                bot: document.getElementById("res-bot-name-revocation"),
                action: document.getElementById("res-bot-action-revocation"),
                data: document.getElementById("res-bot-data-revocation")
            }
        }
    };
    DOM.metaSections = DOM.handlingMetaContainer.querySelectorAll(".resource-meta-fields");

    DOM.systemNameInput = document.getElementById("system-name-input");
    DOM.systemShortInput = document.getElementById("system-short-input");
}

//------------------------------------------------
// LOAD SYSTEM
//------------------------------------------------

async function loadSystemDetail(){

    const systemId = window.location.pathname.split("/").pop();

    try{

        const resp = await fetch(`/api/systems/${systemId}`);
        system = await resp.json();

        fillSystemInfo();
        renderResourceTable();
        setupCards();

    }catch(e){
        console.error("Fehler beim Laden:", e);
    }
}

async function loadUsers() {
    try {
        const res = await fetch("/api/users");
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || data.error || "Benutzer konnten nicht geladen werden");
        }
        STATE.users = Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Fehler beim Laden der Benutzer:", e);
        STATE.users = [];
    }
    fillRecipientOptions();
}

async function loadParentResourceCandidates() {
    try {
        const res = await fetch(`/api/resources?type_id=${PARENT_RESOURCE_TYPE_ID}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.detail || data.error || "Parent-Ressourcen konnten nicht geladen werden");
        }

        STATE.parentResourceCandidates = Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Fehler beim Laden der Parent-Ressourcen:", e);
        STATE.parentResourceCandidates = [];
        showFlash("Parent-Ressourcen konnten nicht geladen werden", "failure");
    }
}

//------------------------------------------------
// SYSTEM INFO
//------------------------------------------------

function fillSystemInfo(){

    document.querySelector("#system-id-text").textContent = system.system_id;
    document.querySelector("#system-name-text").textContent = system.name;
    document.querySelector("#system-short-text").textContent = system.short_name;
    document.querySelector("#system-type-text").textContent = system.type || "-";
    document.querySelector("#system-status-text").textContent = system.status || "-";
    document.querySelector("#system-owner-text").textContent = system.owner || "-";
}

//------------------------------------------------
// RESOURCE TABLE
//------------------------------------------------

function renderResourceTable(){

    const resourceTypes = {1:"konto",2:"gruppe",3:"lizenz",4:"sonstige"};

    DOM.tableBody.innerHTML = "";

    system.resources.forEach(res=>{

        const tr = document.createElement("tr");

        tr.dataset.type = resourceTypes[res.type_id] || "other";
        tr.dataset.res_id = res.resource_id;

        tr.innerHTML = `
            <td>${res.technical_identifier || ""}</td>
            <td>${res.display_name}</td>
            <td>${res.type_name}</td>
            <td>${res.override_handling_type || ""}</td>
        `;

        DOM.tableBody.appendChild(tr);
    });
}

//------------------------------------------------
// RESOURCE CARDS
//------------------------------------------------

function setupCards(){

    const cards = {
        all: document.querySelector("#count-all"),
        konto: document.querySelector("#count-konto"),
        gruppe: document.querySelector("#count-gruppe"),
        lizenz: document.querySelector("#count-lizenz"),
        sonstige: document.querySelector("#count-sonstige")
    };

    const resourceTypes = {1:"konto",2:"gruppe",3:"lizenz",4:"sonstige"};

    const counts = {
        all: system.resources.length,
        konto:0, gruppe:0, lizenz:0, sonstige:0
    };

    system.resources.forEach(r=>{
        const key = resourceTypes[r.type_id];
        if(key) counts[key]++;
    });

    Object.entries(counts).forEach(([key,val])=>{

        const el = cards[key];
        if(!el) return;

        el.textContent = val;

        const card = el.closest(".resource-card");

        card.classList.toggle("disabled", val === 0);

        card.onclick = ()=>{
            if(val === 0) return;

            document.querySelectorAll("#resources-table tbody tr")
                .forEach(tr=>{
                    tr.style.display =
                        key==="all" || tr.dataset.type===key
                        ? ""
                        : "none";
                });
        };
    });
}

//------------------------------------------------
// EVENTS
//------------------------------------------------

function bindBaseEvents(){

    // Table click (event delegation)
    DOM.tableBody.addEventListener("click", e=>{

        const tr = e.target.closest("tr");
        if(!tr) return;

        const res = system.resources.find(
            r=>r.resource_id == tr.dataset.res_id
        );

        openOverlay("view", res);
    });

    DOM.editBtn.addEventListener("click", editSystem);
    DOM.cancelEdit.addEventListener("click", cancelEdit);
    DOM.saveEdit.addEventListener("click", saveSystemEdit);

    DOM.addResBtn.addEventListener("click", ()=> openOverlay("add"));
    DOM.editResBtn.addEventListener("click", ()=> openOverlay("edit"));
    DOM.selectRes.addEventListener("change", onSelectResource);
    DOM.handling.addEventListener("change", toggleHandlingMetaField);
    DOM.parentSearch.addEventListener("input", onParentSearchInput);
    DOM.parentSelect.addEventListener("change", onParentSelectionChange);

    [DOM.closeBtn, DOM.cancelBtn].forEach(btn=>{
        btn.addEventListener("click", closeOverlay);
    });

    DOM.saveResBtn.addEventListener("click", saveResource);
}

function toggleHandlingMetaField(){
    const selectedHandlingType = DOM.handling.value;
    const showMeta = ["EXTERNAL","BOT"].includes(selectedHandlingType);
    DOM.handlingMetaContainer.style.display = showMeta ? "block" : "none";
    const readOnly = !showMeta || STATE.overlayMode === "view";

    DOM.metaSections.forEach(section => {
        const isActive = showMeta && section.dataset.handlingType === selectedHandlingType;
        section.style.display = isActive ? "block" : "none";

        section.querySelectorAll("input, select, textarea").forEach(field => {
            field.disabled = !isActive || readOnly;
        });
    });

    if (showMeta) {
        fillMetaFieldsForHandling(selectedHandlingType, STATE.currentResource);
    }
}


function editSystem(){
    DOM.infoFields.forEach(field=>{
        const text = field.querySelector(".field-text");
        const input = field.querySelector(".field-input");

        if(!input) return;

        text.style.display = "none";
        input.style.display = "block";
    });

    DOM.systemNameInput.value = system.name || "";
    DOM.systemShortInput.value = system.short_name || "";

    DOM.sectionButtons.forEach(btn=> btn.disabled = true);
    DOM.editBtn.disabled = true;

    DOM.editActions.style.display = "flex";
    STATE.isEditing = true;
}


function cancelEdit(){

    DOM.infoFields.forEach(field=>{

        const text = field.querySelector(".field-text");
        const input = field.querySelector(".field-input");

        if(!input) return;

        input.style.display = "none";
        text.style.display = "block";
    });

    DOM.sectionButtons.forEach(btn=> btn.disabled = false);
    DOM.editBtn.disabled = false;

    DOM.editActions.style.display = "none";
    STATE.isEditing = false;
}

async function saveSystemEdit() {
    const payload = {
        name: String(DOM.systemNameInput.value || "").trim(),
        short_name: String(DOM.systemShortInput.value || "").trim()
    };

    if (!payload.name || !payload.short_name) {
        showFlash("Bitte Name und Kürzel ausfüllen", "failure");
        return;
    }

    DOM.saveEdit.disabled = true;

    try {
        const updatedSystem = await api.updateSystem(system.system_id, payload);
        if (!updatedSystem) {
            return;
        }

        system = { ...system, ...updatedSystem, ...payload };
        fillSystemInfo();
        cancelEdit();
        showFlash("Systemdetails gespeichert", "success");
    } finally {
        DOM.saveEdit.disabled = false;
    }
}

//------------------------------------------------
// OVERLAY
//------------------------------------------------

function openOverlay(mode, resource=null){

    STATE.overlayMode = mode;
    STATE.currentResource = resource;

    DOM.overlay.classList.add("active");

    DOM.selectContainer.style.display = "none";
    DOM.form.style.display = "block";

    DOM.form.querySelectorAll("input,select,textarea")
        .forEach(el=> el.disabled=false);

    DOM.saveResBtn.style.display = "inline-block";

    //--------------------------------
    // VIEW
    //--------------------------------

    if(mode==="view"){

        DOM.title.textContent = "Ressource Details";

        DOM.form.querySelectorAll("input,select,textarea")
            .forEach(el=> el.disabled=true);

        DOM.saveResBtn.style.display = "none";

        fillResourceForm(resource);
    }

    //--------------------------------
    // EDIT
    //--------------------------------

    if(mode==="edit"){

        DOM.title.textContent = "Ressource bearbeiten";

        DOM.form.style.display = "none";
        DOM.selectContainer.style.display = "block";

        DOM.selectRes.innerHTML =
            "<option value=''>-- Bitte wählen --</option>";

        system.resources.forEach(r=>{
            DOM.selectRes.innerHTML +=
                `<option value="${r.resource_id}">
                    ${r.display_name}
                 </option>`;
        });
    }

    //--------------------------------
    // ADD
    //--------------------------------

    if(mode==="add"){

        DOM.title.textContent = "Neue Ressource";

        fillResourceForm({
            display_name:"",
            technical_identifier:"",
            type_id:1,
            parent_resource_id:null,
            override_handling_type:"INTERNAL"
        });

        STATE.currentResource = null;
    }
}

function closeOverlay(){
    DOM.overlay.classList.remove("active");
    DOM.selectRes.value = "";
    DOM.form.style.display = "none";
    DOM.parentSearch.value = "";
    STATE.parentResourceQuery = "";
    STATE.selectedParentResourceId = null;
}

//------------------------------------------------
// FORM
//------------------------------------------------

function fillResourceForm(res){

    DOM.displayName.value = res.display_name || "";
    DOM.techId.value = res.technical_identifier || "";
    DOM.type.value = res.type_id || 1;
    DOM.handling.value = res.override_handling_type || "INTERNAL";
    STATE.selectedParentResourceId = normalizeParentResourceId(res.parent_resource_id);
    DOM.parentSearch.value = "";
    STATE.parentResourceQuery = "";
    renderParentResourceOptions();
    updateParentSelectionLabel();

    resetMetaFields();
    toggleHandlingMetaField();
}

function onSelectResource(){

    const res = system.resources.find(
        r=> r.resource_id == DOM.selectRes.value
    );

    if(!res) return;

    STATE.currentResource = res;

    DOM.selectContainer.style.display = "none";
    DOM.form.style.display = "block";

    fillResourceForm(res);
}

//------------------------------------------------
// SAVE
//------------------------------------------------

async function saveResource(){
    const handlingType = DOM.handling.value;
    const typeId = parseInt(DOM.type.value, 10);
    const parentResourceId = getSelectedParentResourceId();
    const meta = buildMetaPayload(handlingType);
    let success = false;

    if(STATE.currentResource){
        success = await api.updateResource(
            STATE.currentResource.resource_id,
            system.system_id,
            typeId,
            DOM.displayName.value,
            DOM.techId.value,
            handlingType,
            parentResourceId,
            meta
        );
    }else{
        success = await api.createResource(
            system.system_id,
            typeId,
            DOM.displayName.value,
            DOM.techId.value,
            handlingType,
            parentResourceId,
            meta
        );
    }

    if (!success) {
        return;
    }

    await loadSystemDetail();
    closeOverlay();

}

function fillRecipientOptions() {
    const recipients = getRecipientOptions();
    const recipientSelects = [
        DOM.metaFields.EXTERNAL.ASSIGNMENT.recipient,
        DOM.metaFields.EXTERNAL.REVOCATION.recipient
    ];

    recipientSelects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = "<option value=''>-- Bitte wählen --</option>";

        recipients.forEach(recipient => {
            const option = document.createElement("option");
            option.value = recipient.value;
            option.textContent = recipient.label;
            select.appendChild(option);
        });

        if (recipients.some(recipient => recipient.value === currentValue)) {
            select.value = currentValue;
        }
    });
}

function getRecipientOptions() {
    const options = [];
    const seen = new Set();

    STATE.users.forEach(user => {
        if (!user.user_id) {
            return;
        }

        const label = `${user.first_name || ""} ${user.last_name || ""}`.trim();
        const optionValue = String(user.user_id);
        const optionLabel = label
            ? `${label}${user.email ? ` (${user.email})` : ""}`
            : (user.email || optionValue);

        if (!seen.has(optionValue)) {
            seen.add(optionValue);
            options.push({ value: optionValue, label: optionLabel });
        }
    });

    const currentMeta = Array.isArray(STATE.currentResource?.meta) ? STATE.currentResource.meta : [];
    currentMeta.forEach(entry => {
        const value = getExternalRecipientValue(entry?.meta);
        if (value && !seen.has(value)) {
            seen.add(value);
            options.push({ value, label: value });
        }
    });

    return options;
}

function resetMetaFields() {
    Object.values(DOM.metaFields.EXTERNAL).forEach(fields => {
        fields.recipient.value = "";
        fields.subject.value = "";
        fields.body.value = "";
    });

    Object.values(DOM.metaFields.BOT).forEach(fields => {
        fields.bot.value = "";
        fields.action.value = "";
        fields.data.value = "";
    });

    fillRecipientOptions();
}

function fillMetaFieldsForHandling(handlingType, resource) {
    resetFieldsForHandling(handlingType);

    if (!resource || !Array.isArray(resource.meta)) {
        return;
    }

    TASK_TYPES.forEach(taskType => {
        const metaEntry = findMetaEntry(resource.meta, handlingType, taskType);

        if (!metaEntry || !metaEntry.meta) {
            return;
        }

        const formFields = DOM.metaFields[handlingType]?.[taskType];
        if (!formFields) {
            return;
        }

        if (handlingType === "EXTERNAL") {
            formFields.recipient.value = getExternalRecipientValue(metaEntry.meta);
            formFields.subject.value = metaEntry.meta.subject || "";
            formFields.body.value = metaEntry.meta.body || metaEntry.meta.mail_template || "";
        }

        if (handlingType === "BOT") {
            formFields.bot.value = metaEntry.meta.bot || "";
            formFields.action.value = metaEntry.meta.action || "";
            formFields.data.value = metaEntry.meta.data || "";
        }
    });
}

function findMetaEntry(metaEntries, handlingType, taskType) {
    return metaEntries.find(entry =>
        entry.handling_type === handlingType && entry.task_type === taskType
    ) || metaEntries.find(entry =>
        entry.handling_type === handlingType && !entry.task_type
    );
}

function resetFieldsForHandling(handlingType) {
    const fieldsByTaskType = DOM.metaFields[handlingType];
    if (!fieldsByTaskType) {
        return;
    }

    Object.values(fieldsByTaskType).forEach(fields => {
        Object.values(fields).forEach(field => {
            field.value = "";
        });
    });
}

function buildMetaPayload(handlingType) {
    const existingMeta = Array.isArray(STATE.currentResource?.meta)
        ? STATE.currentResource.meta.filter(entry => entry.handling_type !== handlingType)
        : [];

    if (!["EXTERNAL", "BOT"].includes(handlingType)) {
        return existingMeta;
    }

    const newMeta = TASK_TYPES.map(taskType => {
        const meta = buildMetaForTaskType(handlingType, taskType);
        return {
            handling_type: handlingType,
            task_type: taskType,
            meta
        };
    });

    return [...existingMeta, ...newMeta];
}

function buildMetaForTaskType(handlingType, taskType) {
    const fields = DOM.metaFields[handlingType]?.[taskType];
    if (!fields) {
        return {};
    }

    if (handlingType === "EXTERNAL") {
        return {
            external_contact: normalizeRecipientValue(fields.recipient.value),
            subject: fields.subject.value.trim(),
            body: fields.body.value.trim()
        };
    }

    if (handlingType === "BOT") {
        return {
            bot: fields.bot.value.trim(),
            action: fields.action.value.trim(),
            data: fields.data.value.trim()
        };
    }

    return {};
}

function getExternalRecipientValue(meta) {
    if (!meta) {
        return "";
    }

    return String(meta.external_contact || meta.recipient || "");
}

function normalizeRecipientValue(value) {
    if (!value) {
        return "";
    }

    const normalized = value.trim();
    return /^\d+$/.test(normalized) ? parseInt(normalized, 10) : normalized;
}

function onParentSearchInput() {
    STATE.parentResourceQuery = DOM.parentSearch.value.trim();
    renderParentResourceOptions();
}

function onParentSelectionChange() {
    STATE.selectedParentResourceId = normalizeParentResourceId(DOM.parentSelect.value);
    updateParentSelectionLabel();
}

function renderParentResourceOptions() {
    const currentResourceId = normalizeParentResourceId(STATE.currentResource?.resource_id);
    const query = STATE.parentResourceQuery.toLowerCase();
    const candidates = STATE.parentResourceCandidates.filter(candidate => {
        const candidateId = normalizeParentResourceId(candidate.resource_id);

        if (currentResourceId != null && candidateId === currentResourceId) {
            return false;
        }

        if (STATE.selectedParentResourceId != null && candidateId === STATE.selectedParentResourceId) {
            return true;
        }

        if (!query) {
            return true;
        }

        const haystack = [
            candidate.display_name,
            candidate.technical_identifier,
            candidate.system_name
        ]
            .map(value => String(value || "").toLowerCase())
            .join(" ");

        return haystack.includes(query);
    });

    DOM.parentSelect.innerHTML = "";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Keine uebergeordnete Ressource";
    DOM.parentSelect.appendChild(emptyOption);

    candidates.forEach(candidate => {
        const option = document.createElement("option");
        option.value = String(candidate.resource_id);
        option.textContent = formatParentCandidateLabel(candidate);
        DOM.parentSelect.appendChild(option);
    });

    DOM.parentSelect.value = STATE.selectedParentResourceId == null
        ? ""
        : String(STATE.selectedParentResourceId);

    if (DOM.parentSelect.value !== "" && DOM.parentSelect.value !== String(STATE.selectedParentResourceId)) {
        DOM.parentSelect.value = "";
    }
}

function formatParentCandidateLabel(candidate) {
    const parts = [candidate.display_name || `Ressource ${candidate.resource_id}`];

    if (candidate.technical_identifier) {
        parts.push(candidate.technical_identifier);
    }

    if (candidate.system_name) {
        parts.push(candidate.system_name);
    }

    return parts.join(" | ");
}

function normalizeParentResourceId(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function getSelectedParentResourceId() {
    return normalizeParentResourceId(DOM.parentSelect.value);
}

function updateParentSelectionLabel() {
    const selectedResource = STATE.parentResourceCandidates.find(candidate =>
        normalizeParentResourceId(candidate.resource_id) === STATE.selectedParentResourceId
    );

    if (!selectedResource) {
        DOM.parentSelectionLabel.textContent = "Keine uebergeordnete Ressource ausgewaehlt.";
        return;
    }

    DOM.parentSelectionLabel.textContent = `Ausgewaehlt: ${formatParentCandidateLabel(selectedResource)}`;
}
