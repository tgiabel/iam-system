//------------------------------------------------
// STATE
//------------------------------------------------

let system = null;

const DOM = {};
const STATE = {
    overlayMode: "view",
    currentResource: null
};

//------------------------------------------------
// INIT
//------------------------------------------------

document.addEventListener("DOMContentLoaded", init);

async function init(){
    cacheDOM();
    bindBaseEvents();
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
    DOM.editActions = document.querySelector("#edit-actions");

    // form fields
    DOM.displayName = document.getElementById("res-display-name");
    DOM.techId = document.getElementById("res-technical-id");
    DOM.type = document.getElementById("res-type");
    DOM.handling = document.getElementById("res-handling");
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

    DOM.addResBtn.addEventListener("click", ()=> openOverlay("add"));
    DOM.editResBtn.addEventListener("click", ()=> openOverlay("edit"));
    DOM.selectRes.addEventListener("change", onSelectResource);

    [DOM.closeBtn, DOM.cancelBtn].forEach(btn=>{
        btn.addEventListener("click", closeOverlay);
    });

    DOM.saveResBtn.addEventListener("click", saveResource);
}

function editSystem(){

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

    fillSelect("system-type", ["Applikation","Service","Tool"]);
    fillSelect("system-status", ["Aktiv","Inaktiv"]);
    fillSelect("system-owner", ["IT HR","IT Core","Security"]);
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

function openOverlay(mode, resource=null){

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

        DOM.title.textContent = "Ressource Details";

        DOM.form.querySelectorAll("input,select")
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
            override_handling_type:"INTERNAL"
        });

        STATE.currentResource = null;
    }
}

function closeOverlay(){
    DOM.overlay.classList.remove("active");
    DOM.selectRes.value = "";
    DOM.form.style.display = "none";
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

    const res = system.resources.find(
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

async function saveResource(){

    const payload = {
        display_name: DOM.displayName.value,
        technical_identifier: DOM.techId.value,
        type_id: parseInt(DOM.type.value),
        override_handling_type: DOM.handling.value
    };

    if(STATE.currentResource){

        payload.resource_id =
            STATE.currentResource.resource_id;

        console.log("UPDATE", payload);

        // await api.update()

    }else{

        payload.system_id = system.system_id;

        console.log("CREATE", payload);

        // await api.create()
    }

    closeOverlay();
}
