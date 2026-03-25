//------------------------------------------------
// STATE
//------------------------------------------------

let role = null;

const DOM = {};
const STATE = {
    overlayMode: "view",
    currentResource: null,
    systemMap: null
};

const api = {

    async getSystemMap(){
        if (STATE.systemMap) return STATE.systemMap;
        const res = await fetch("/api/systems/map");
        if (!res.ok) throw new Error("System Map konnte nicht geladen werden");

        STATE.systemMap = await res.json();
        return STATE.systemMap;
    },

    async getSystemResources(sysId) {
        const res = await fetch(`/api/systems/${sysId}/resources`);
        if(!res.ok) throw new Error(res.status);
        return res.json();
    },

    async addResourcesToRole(roleId, resourceIds) {
        const res = await fetch(`/api/roles/${roleId}/resources`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resource_ids: resourceIds })
        });
        if (!res.ok) throw new Error("Fehler beim Hinzufügen der Ressourcen");
        return await res.json();
    },

    async removeResourcesFromRole(roleId, resourceIds) {
        const res = await fetch(`/api/roles/${roleId}/resources`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resource_ids: resourceIds })
        });
        if (!res.ok) throw new Error("Fehler beim Entfernen der Ressourcen");
        return await res.json();
    }
}
//------------------------------------------------
// INIT
//------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init(){
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('msg') === 'pkg-chg-suc') {
        showFlash("Änderungen erfolgreich gespeichert!", "success"); 
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    cacheDOM();
    bindBaseEvents();
    await loadRoleDetail();
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
    DOM.selectSys = document.getElementById("sys-select");
    DOM.tableContainer = document.getElementById("resource-table-container");

    DOM.title = document.getElementById("resource-modal-title");
    DOM.saveResBtn = document.getElementById("resource-save-btn");

    DOM.tableBody = document.querySelector("#resources-table tbody");

    DOM.addResBtn = document.getElementById("add-resource-btn");
    DOM.rmResBtn = document.getElementById("rm-resources-btn");

    DOM.editBtn = document.querySelector("#edit-role-btn");
    DOM.cancelEdit = document.querySelector("#cancel-edit-btn");
    DOM.editActions = document.querySelector("#edit-actions");

    // form fields
    DOM.displayName = document.getElementById("res-display-name");
    DOM.techId = document.getElementById("res-technical-id");
    DOM.type = document.getElementById("res-type");
    DOM.handling = document.getElementById("res-handling");
}

//------------------------------------------------
// LOAD role
//------------------------------------------------

async function loadRoleDetail(){

    const roleId = window.location.pathname.split("/").pop();

    try{

        const resp = await fetch(`/api/roles/${roleId}`);
        role = await resp.json();
        console.info(role);
        fillroleInfo();
        renderResourceTable();
        setupCards();

    }catch(e){
        console.error("Fehler beim Laden:", e);
    }
}

//------------------------------------------------
// role INFO
//------------------------------------------------

function fillroleInfo(){

    document.querySelector("#role-id-text").textContent = role.role_id;
    document.querySelector("#role-name-text").textContent = role.name;
    document.querySelector("#role-type-text").textContent = role.role_type || "-";
    document.querySelector("#role-status-text").textContent = role.status || "-";
    document.querySelector("#role-parent-text").textContent = role.parent_role_name || "-";
    document.querySelector("#role-owner-text").textContent = role.owner || "-";
}

//------------------------------------------------
// RESOURCE TABLE
//------------------------------------------------

function renderResourceTable(){

    const resourceTypes = {1:"konto",2:"gruppe",3:"lizenz",4:"sonstige"};

    DOM.tableBody.innerHTML = "";

    role.resources.forEach(res=>{

        const tr = document.createElement("tr");

        tr.dataset.type = "own";
        tr.dataset.res_id = res.resource_id;

        tr.innerHTML = `
            <td>${res.technical_identifier || ""}</td>
            <td>${res.display_name}</td>
            <td>${res.type_name}</td>
            <td>${res.override_handling_type || ""}</td>
            <td>Nein</td>
        `;

        DOM.tableBody.appendChild(tr);
    });
    role.inherited_resources.forEach(res=>{

        const tr = document.createElement("tr");

        tr.dataset.type = "inherited";
        tr.dataset.res_id = res.resource_id;

        tr.innerHTML = `
            <td>${res.technical_identifier || ""}</td>
            <td>${res.display_name}</td>
            <td>${res.type_name}</td>
            <td>${res.override_handling_type || ""}</td>
            <td>Ja</td>
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
        own: document.querySelector("#count-own"),
        inherited: document.querySelector("#count-inherited")
    };

    const resourceTypes = {1:"own",2:"inherited"};

    const counts = {
        all: role.resources.length,
        own:role.resources.length, inherited:role.inherited_resources.length
    };

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

        const res = role.resources.find(
            r=>r.resource_id == tr.dataset.res_id
        );

        openOverlay("view", res);
    });

    DOM.editBtn.addEventListener("click", editrole);
    DOM.cancelEdit.addEventListener("click", cancelEdit);

    DOM.addResBtn.addEventListener("click", ()=> openOverlay("add"));
    DOM.rmResBtn.addEventListener("click", ()=> openOverlay("rm"));

    [DOM.closeBtn, DOM.cancelBtn].forEach(btn=>{
        btn.addEventListener("click", closeOverlay);
    });

    DOM.saveResBtn.addEventListener("click", saveResourceOverlay);
}

function editrole(){

    DOM.infoFields.forEach(field=>{

        const text = field.querySelector(".field-text");
        const input = field.querySelector(".field-input");

        if(!input) return;

        input.value = text.textContent;

        text.style.display = "none";
        input.style.display = "block";
    });

    DOM.sectionButtons.forEach(btn=> btn.disabled = true);

    DOM.editActions.style.display = "flex";

    fillSelect("role-type", ["Applikation","Service","Tool"]);
    fillSelect("role-status", ["Aktiv","Inaktiv"]);
    fillSelect("role-owner", ["IT HR","IT Core","Security"]);
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

    DOM.editActions.style.display = "none";
}


function fillSelect(id, values){
    const select = document.querySelector(`#${id}-input`);

    select.innerHTML = "";

    values.forEach(v=>{
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
}

//------------------------------------------------
// OVERLAY
//------------------------------------------------

async function openOverlay(mode, resource=null){

    STATE.overlayMode = mode;
    STATE.currentResource = resource;

    DOM.overlay.classList.add("active");

    DOM.selectContainer.style.display = "none";
    DOM.form.style.display = "block";

    DOM.form.querySelectorAll("input,select")
        .forEach(el=> el.disabled=false);

    DOM.saveResBtn.style.display = "inline-block";

    //--------------------------------
    // VIEW
    //--------------------------------

    if(mode==="view"){

        DOM.title.textContent = "Ressourcen Details";
        DOM.form.style.display = "block";
        DOM.selectContainer.style.display = "none";
        DOM.tableContainer.style.display = "none";

        DOM.form.querySelectorAll("input,select")
            .forEach(el=> el.disabled=true);

        DOM.saveResBtn.style.display = "none";

        fillResourceForm(resource);
    }

    //--------------------------------
    // REMOVE
    //--------------------------------

    if(mode==="rm"){

        DOM.title.textContent = "Ressourcen entfernen";
        DOM.form.style.display = "none";
        DOM.selectContainer.style.display = "none";
        DOM.tableContainer.style.display = "block";

        const currentList = document.getElementById("res-list-current");
        const removeList = document.getElementById("res-list-to-remove");

        // Leeren
        currentList.innerHTML = "";
        removeList.innerHTML = "";

        // Funktion zum Erstellen einer Zeile
        const createRow = (res, isRemoving) => {
            const tr = document.createElement("tr");
            tr.dataset.id = res.resource_id;
            tr.innerHTML = `
                <td>${res.display_name}</td>
                <td>
                    <button type="button" class="action-btn ${isRemoving ? "btn-transparent" : "btn-red btn-transparent"}">
                        ${isRemoving ? "↑" : "✖"}
                    </button>
                </td>
            `;

            // Event-Listener für den Button
            tr.querySelector(".action-btn").onclick = () => {
                if (!isRemoving) {
                    // Von "Aktuell" nach "Entfernen"
                    removeList.appendChild(createRow(res, true));
                } else {
                    // Zurück nach "Aktuell"
                    currentList.appendChild(createRow(res, false));
                }
                tr.remove(); // Die alte Zeile löschen
            };

            return tr;
        };

        // Initial befüllen
        role.resources.forEach(r => {
            currentList.appendChild(createRow(r, false));
        });
    }

    //--------------------------------
    // ADD
    //--------------------------------

    if (mode === "add") {
        DOM.title.textContent = "Ressourcen hinzufügen";
        const systems = await api.getSystemMap();

        DOM.form.style.display = "none";
        DOM.tableContainer.style.display = "none";
        DOM.selectContainer.style.display = "block";

        const availContainer = document.getElementById("available-res-container");
        const availList = document.getElementById("res-list-available");
        const addList = document.getElementById("res-list-to-add");

        // Select befüllen
        DOM.selectSys.innerHTML = "<option value=''>-- Bitte wählen --</option>";
        Object.entries(systems).forEach(([id, name]) => {
            DOM.selectSys.innerHTML += `<option value="${id}">${name}</option>`;
        });

        // Hilfsfunktion für Zeilen (ähnlich wie bei rm)
        const createAddRow = (res, isStaged) => {
            const tr = document.createElement("tr");
            tr.dataset.id = res.resource_id;
            tr.innerHTML = `
                <td>${res.display_name}</td>
                <td>
                    <button type="button" class="action-btn ${isStaged ? "btn-red btn-transparent" : "btn-green btn-transparent"}">
                        ${isStaged ? "✖" : "✚"}
                    </button>
                </td>
            `;

            tr.querySelector(".action-btn").onclick = () => {
                if (!isStaged) {
                    // Nach unten schieben (Markiert zum Hinzufügen)
                    addList.appendChild(createAddRow(res, true));
                } else {
                    // Zurück nach oben schieben (Wieder verfügbar machen)
                    availList.appendChild(createAddRow(res, false));
                }
                tr.remove();
            };
            return tr;
        };

        // Event: System ausgewählt
        DOM.selectSys.onchange = async (e) => {
            const sysId = e.target.value;
            if (!sysId) {
                availContainer.style.display = "none";
                return;
            }

            // 1. Daten laden (ist direkt das Array)
            const resources = await api.getSystemResources(sysId);
            availList.innerHTML = "";
            availContainer.style.display = "block";

            // 2. Da 'resources' direkt das Array ist, prüfen wir .length direkt darauf
            if (Array.isArray(resources) && resources.length > 0) {
                resources.forEach(r => {
                    // Prüfen, ob die Ressource bereits in der Rolle vorhanden ist
                    const alreadyHas = role.resources.some(existing => 
                        existing.resource_id === r.resource_id
                    );
                    
                    if (!alreadyHas) {
                        availList.appendChild(createAddRow(r, false));
                    }
                });

                // Kleiner Bonus: Falls alle Ressourcen des Systems bereits in der Rolle sind
                if (availList.innerHTML === "") {
                    availList.innerHTML = "<tr><td colspan='2' style='font-style: italic; color: gray;'>Alle Ressourcen dieses Systems sind bereits zugewiesen.</td></tr>";
                }
            } else {
                availList.innerHTML = "<tr><td colspan='2'>Keine Ressourcen für dieses System gefunden</td></tr>";
            }
        };
    }
}

function closeOverlay(){
    DOM.overlay.classList.remove("active");
    DOM.form.style.display = "none";
    STATE.overlayMode = "";
}

//------------------------------------------------
// FORM
//------------------------------------------------

function fillResourceForm(res){

    DOM.displayName.value = res.display_name || "";
    DOM.techId.value = res.technical_identifier || "";
    DOM.type.value = res.type_id || 1;
    DOM.handling.value = res.override_handling_type || "INTERNAL";
}

function onSelectResource(){

    const res = role.resources.find(
        r=> r.resource_id == DOM.selectRes.value
    );

    if(!res) return;

    DOM.selectContainer.style.display = "none";
    DOM.form.style.display = "block";

    fillResourceForm(res);

    STATE.currentResource = res;
}

//------------------------------------------------
// SAVE
//------------------------------------------------

async function saveResourceOverlay(){

    const mode = STATE.overlayMode;
    const roleIdToUpdate = role.role_id;
    let resoureceIds = [];
    try{
        if (mode === "add") {
            const rows = document.querySelectorAll("#res-list-to-add tr");
            resoureceIds = Array.from(rows).map(tr => tr.dataset.id);
            if (resoureceIds.length > 0) {
                await api.addResourcesToRole(roleIdToUpdate, resoureceIds);
            } else {
                showFlash("Keine Ressourcen zum Hinzufügen ausgewählt", "failure");
                return;
            }
        }
        else if (mode === "rm") {
            const rows = document.querySelectorAll("#res-list-to-remove tr");
            resoureceIds = Array.from(rows).map(tr => tr.dataset.id);
            if (resoureceIds.length > 0) {
                await api.removeResourcesFromRole(roleIdToUpdate, resoureceIds);
            } else {
                showFlash("Keine Ressourcen zum Entfernen ausgewählt", "failure");
                return;
            }            
        }
        else {
            showFlash("Fehler beim Speichern. [ovMode nicht gesetzt oder unbekannt]", "failure");
            return;
        }
        window.location.href = window.location.pathname + "?msg=pkg-chg-suc";
        showFlash("Erfolgreich gespeichert.", "success");
    } catch (err) {
        console.error("Speichern fehlgeschlagen:", err);
        showFlash(err.message, "failure");
    }
}
