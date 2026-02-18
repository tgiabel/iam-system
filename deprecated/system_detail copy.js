let system = null;
async function loadSystemDetail() {
    const systemId = window.location.pathname.split("/").pop();

    try {
        const resp = await fetch(`/api/systems/${systemId}`);
        system = await resp.json();

        // ----------------------------
        // Systeminfos füllen
        // ----------------------------
        document.querySelector("#system-id-text").textContent = system.system_id;
        document.querySelector("#system-name-text").textContent = system.name;
        document.querySelector("#system-short-text").textContent = system.short_name;
        document.querySelector("#system-type-text").textContent = system.type || "-";
        document.querySelector("#system-status-text").textContent = system.status || "-";
        document.querySelector("#system-owner-text").textContent = system.owner || "-";

        // ----------------------------
        // Ressourcen Cards & Counts
        // ----------------------------
        const cards = {
            all: document.querySelector("#count-all"),
            konto: document.querySelector("#count-konto"),
            gruppe: document.querySelector("#count-gruppe"),
            lizenz: document.querySelector("#count-lizenz"),
            sonstige: document.querySelector("#count-sonstige")
        };

        const resourceTypes = {1: "konto", 2: "gruppe", 3: "lizenz", 4: "sonstige"};
        const counts = {all: system.resources.length, konto:0, gruppe:0, lizenz:0, sonstige:0};

        system.resources.forEach(res => {
            const typeKey = resourceTypes[res.type_id];
            if (typeKey) counts[typeKey]++;
        });

        for (const [key, value] of Object.entries(counts)) {
            if (cards[key]) {
                cards[key].textContent = value;

                // Disabled, wenn Count = 0
                if (value === 0) {
                    cards[key].closest(".resource-card").classList.add("disabled");
                } else {
                    cards[key].closest(".resource-card").classList.remove("disabled");
                }

                // Tooltip mit Ressourcennamen
                const names = system.resources
                    .filter(r => key === "all" || resourceTypes[r.type_id] === key)
                    .map(r => r.display_name);
                cards[key].title = names.join("\n");
            }
        }

        // ----------------------------
        // Ressourcen Tabelle füllen
        // ----------------------------
        const tableBody = document.querySelector("#resources-table tbody");
        tableBody.innerHTML = "";

        system.resources.forEach(res => {
            const tr = document.createElement("tr");
            const typeKey = resourceTypes[res.type_id] || "other";
            tr.dataset.type = typeKey;
            tr.dataset.res_id = res.resource_id

            tr.innerHTML = `
                <td>${res.technical_identifier || ""}</td>
                <td>${res.display_name}</td>
                <td>${res.type_name}</td>
                <td>${res.override_handling_type || ""}</td>
            `;
            tableBody.appendChild(tr);
        });

        // ----------------------------
        // Filter Klick auf Cards
        // ----------------------------
        document.querySelectorAll(".resource-card").forEach(card => {
            card.addEventListener("click", () => {
                const type = card.dataset.type;

                // Ignoriere disabled cards
                if (card.classList.contains("disabled")) return;

                document.querySelectorAll("#resources-table tbody tr").forEach(tr => {
                    if (type === "all" || tr.dataset.type === type) {
                        tr.style.display = "";
                    } else {
                        tr.style.display = "none";
                    }
                });
            });
        });

    } catch (e) {
        console.error("Fehler beim Laden der Systemdetails", e);
    }
    const editBtn = document.querySelector("#edit-system-btn");
    const editActions = document.querySelector("#edit-actions");

    editBtn.addEventListener("click", () => {

        // Inputs anzeigen
        document.querySelectorAll(".info-field").forEach(field => {

            const text = field.querySelector(".field-text");
            const input = field.querySelector(".field-input");

            if(!input) return;

            input.value = text.textContent;

            text.style.display = "none";
            input.style.display = "block";
        });

        // Buttons oben deaktivieren
        document.querySelectorAll(".section-actions button")
            .forEach(btn => btn.disabled = true);

        editActions.style.display = "flex";

        // Beispiel
        fillSelect("system-type", ["Applikation","Service","Tool"]);
        fillSelect("system-status", ["Aktiv","Inaktiv"]);
        fillSelect("system-owner", ["IT HR","IT Core","Security"]);
    });
    document.querySelector("#cancel-edit-btn")
    .addEventListener("click", () => {

        document.querySelectorAll(".info-field").forEach(field => {

            const text = field.querySelector(".field-text");
            const input = field.querySelector(".field-input");

            if(!input) return;

            input.style.display = "none";
            text.style.display = "block";
        });

        document.querySelectorAll(".section-actions button")
            .forEach(btn => btn.disabled = false);

        editActions.style.display = "none";
    });

        // Beispiel
    fillSelect("system-type", ["Applikation","Service","Tool"]);
    fillSelect("system-status", ["Aktiv","Inaktiv"]);
    fillSelect("system-owner", ["IT HR","IT Core","Security"]);

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

function openResourceView(resId){
    const res = system.resources.find(r => r.resource_id == resId);
    if(!res) return;

    openOverlay("view", res);
}

function fillResourceForm(res){
    document.getElementById("res-display-name").value = res.display_name || "";
    document.getElementById("res-technical-id").value = res.technical_identifier || "";
    document.getElementById("res-type").value = res.type_id || 1;
    document.getElementById("res-handling").value = res.override_handling_type || "INTERNAL";
}

function resetOverlay(){
    resourceSelect.value = "";
    resourceFormContainer.style.display = "none";
}

function openOverlay(mode, resource = null) {

    resourceOverlay.classList.add("active");

    currentResource = resource;
    overlayMode = mode;

    // reset
    resourceSelectContainer.style.display = "none";
    resourceFormContainer.style.display = "block";

    resourceFormContainer.querySelectorAll("input, select")
        .forEach(el => el.disabled = false);

    resourceSaveBtn.style.display = "inline-block";

    //--------------------------------
    // VIEW MODE
    //--------------------------------
    if(mode === "view"){

        resourceModalTitle.textContent = "Ressource Details";

        resourceFormContainer.querySelectorAll("input, select")
            .forEach(el => el.disabled = true);

        resourceSaveBtn.style.display = "none";

        fillResourceForm(resource);
    }

    //--------------------------------
    // EDIT MODE
    //--------------------------------
    if(mode === "edit"){

        resourceModalTitle.textContent = "Ressource bearbeiten";

        resourceSelectContainer.style.display = "block";
        resourceFormContainer.style.display = "none";

        resourceSelect.innerHTML = "<option value=''>-- Bitte wählen --</option>";

        system.resources.forEach(r=>{
            const opt = document.createElement("option");
            opt.value = r.resource_id;
            opt.textContent = r.display_name;
            resourceSelect.appendChild(opt);
        });
    }

    //--------------------------------
    // ADD MODE
    //--------------------------------
    if(mode === "add"){

        resourceModalTitle.textContent = "Neue Ressource";

        fillResourceForm({
            display_name:"",
            technical_identifier:"",
            type_id:1,
            override_handling_type:"INTERNAL"
        });

        currentResource = null;
    }
}


// Page load
document.addEventListener("DOMContentLoaded", () => {
    // Lade System Details
    loadSystemDetail();
    
    const resourceOverlay = document.getElementById("resource-overlay");
    const resourceCloseBtn = document.getElementById("resource-close-btn");
    const resourceCancelBtn = document.getElementById("resource-cancel-btn");
    const resourceFormContainer = document.getElementById("resource-form-container");
    const resourceSelectContainer = document.getElementById("resource-select-container");
    const resourceSelect = document.getElementById("resource-select");
    const resourceModalTitle = document.getElementById("resource-modal-title");
    const resourceSaveBtn = document.getElementById("resource-save-btn");
    const tableBody = document.querySelector("#resources-table tbody");

    let overlayMode = "view"; // view / edit
    let currentResource = null;

    // --- Click auf Tabelle (READ ONLY) ---
    tableBody.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        if (!tr) return;

        openResourceView(tr.dataset.res_id);
    });

    // --- Edit Resources Button (Add MODE) ---
    document.getElementById("add-resource-btn").addEventListener("click", ()=> openOverlay("add"));

    // --- Edit Resources Button (EDIT MODE) ---
    document.getElementById("edit-resources-btn").addEventListener("click", () => openOverlay("edit"));

    // --- Auswahl Dropdown (EDIT MODE) ---
    resourceSelect.addEventListener("change", ()=>{

        const res = system.resources.find(
            r => r.resource_id == resourceSelect.value
        );

        if(!res) return;

        resourceSelectContainer.style.display = "none";
        resourceFormContainer.style.display = "block";

        fillResourceForm(res);
        currentResource = res;
    });

    resourceSaveBtn.addEventListener("click", async () => {

        const payload = {
            display_name: resDisplayName.value,
            technical_identifier: resTechnicalId.value,
            type_id: parseInt(resType.value),
            override_handling_type: resHandling.value
        };

        if(currentResource){

            // UPDATE
            payload.resource_id = currentResource.resource_id;

            console.log("UPDATE", payload);
            // await api.updateResource(payload)

        }else{

            // CREATE
            payload.system_id = system.system_id;

            console.log("CREATE", payload);
            // await api.createResource(payload)
        }

        resourceOverlay.classList.remove("active");
    });


    // --- Overlay schließen ---
    [resourceCloseBtn, resourceCancelBtn].forEach(btn => {
        btn.addEventListener("click", () => resetOverlay);
    });

    // --- Save Button ---
    resourceSaveBtn.addEventListener("click", async () => {
        if (!currentResource) return;

        // Hier später API Call einfügen
        const payload = {
            resource_id: currentResource.resource_id,
            display_name: document.getElementById("res-display-name").value,
            technical_identifier: document.getElementById("res-technical-id").value,
            type_id: parseInt(document.getElementById("res-type").value),
            override_handling_type: document.getElementById("res-handling").value
        };

        console.log("Save Resource Payload:", payload);
        // z.B. await apiClient.updateResource(payload);

        resourceOverlay.classList.remove("active");
        // Optional: Tabelle neu laden
    });


});


