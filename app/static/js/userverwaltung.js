const state = {
    users: [],
    systemMap: null,
    roleMap: null
};

const DOM = {};

const api = {

    async getUsers(){
        const res = await fetch("/api/users");
        if(!res.ok) throw new Error(res.status);
        return res.json();
    },

    async getUserDetails(id){
        const res = await fetch(`/api/users/${id}/details`);
        if(!res.ok) throw new Error(res.status);
        return res.json();
    },

    async getSystemMap(){
        if (state.systemMap) return state.systemMap;
        const res = await fetch("/static/json/system_map.json");
        if (!res.ok) throw new Error("System Map konnte nicht geladen werden");

        state.systemMap = await res.json();
        return state.systemMap;
    },

    async getRoleMap(){
        if (state.roleMap) return state.roleMap;
        const res = await fetch("/api/roles/map");
        if (!res.ok) throw new Error("Role Map konnte nicht geladen werden");

        state.roleMap = await res.json();
        return state.roleMap;
    },

    async startOnboarding(payload){
        try {
            const res = await fetch("/api/processes/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pnr: payload })
            });
            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }

            showFlash(`Onboarding gestartet`, "success");

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    },

    async startOffboarding(payload) {
        try {
            const res = await fetch("/api/processes/offboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }

            showFlash(`Austritt zum ${payload.exitdate} beantragt`, "success");

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    },

    async startTmpRoleAssignment(payload) {
        try {
            const res = await fetch("/api/processes/tmp_role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }

            showFlash(`Temporäre Rolle ${state.roleMap?.[payload.role_id].name || roleId} beantragt`, "success");

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    },

    async startNewSkillAssignment(payload){
        try {
            const res = await fetch("/api/processes/skill_assignment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }

            showFlash(`Rolle ${state.roleMap?.[payload.role_id].name || roleId} beantragt`, "success");

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    },

    async startNewSkillRevoke(payload){
        try {
            const res = await fetch("/api/processes/skill_revocation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }

            showFlash(`Rollen-Entzug für ${state.roleMap?.[payload.role_id].name || roleId} beantragt`, "success");

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    }
};

const tableController = {

    async init(){
        await this.loadUsers();
        this.bindSearch();
    },

    async loadUsers(){
        try{
            state.users = await api.getUsers();
            this.render();
        }catch(err){
            console.error(err);
            DOM.tableBody.innerHTML = `<tr><td colspan="8">Fehler beim Laden</td></tr>`;
        }
    },

    render(){

        const filter = DOM.searchInput.value.toLowerCase();

        DOM.tableBody.innerHTML = state.users
            .filter(u =>
                u.first_name.toLowerCase().includes(filter) ||
                u.last_name.toLowerCase().includes(filter) ||
                u.pnr.toLowerCase().includes(filter)
            )
            .map(u => `
                <tr data-id="${u.user_id}">
                    <td>${u.pnr}</td>
                    <td>${u.first_name}</td>
                    <td>${u.last_name}</td>
                    <td>${u.email || ""}</td>
                    <td>${u.primary_role?.name || ""}</td>
                    <td><span title="${u.secondary_roles.map(role => role.name).join("\n")}" style="cursor:help;"><strong>${u.secondary_roles.length}</strong></span></td>
                    <td>${u.is_active ? "Aktiv" : "Inaktiv"}</td>
                </tr>
            `).join("");

        this.bindRows();
    },

    bindRows(){
        DOM.tableBody.querySelectorAll("tr").forEach(tr=>{
            tr.onclick = () =>
                sidebarController.open(tr.dataset.id);
        });
    },

    bindSearch(){
        DOM.searchInput.addEventListener("input", () => this.render());
    }
};

const sidebarController = {

    async open(userId){
        try{
            const data = await api.getUserDetails(userId);
            await this.render(data);
            DOM.sidebarOverlay.classList.add("active");

        }catch(err){
            console.error("UserDetails Fehler", err);
        }
    },

    close(){
        DOM.sidebarOverlay.classList.remove("active");
        tableController.loadUsers();
    },

    async render(data){

        const user = data;

        DOM.sidebarUsername.textContent = `${user.first_name} ${user.last_name}`;
        DOM.sidebarPNR.textContent = user.pnr || "-";
        DOM.sidebarLastName.textContent = user.last_name || "-";
        DOM.sidebarFirstName.textContent = user.first_name || "-";
        DOM.sidebarFunktion.textContent = user.primary_role.name || "-";
        DOM.sidebarEmail.textContent = user.email || "-";
        DOM.sidebarTelefon.textContent = user.telefon || "-";
        DOM.sidebarMobil.textContent = user.mobile || "-";
        DOM.sidebarEintritt.textContent = user.eintritt || "-";
        DOM.sidebarAustritt.textContent = user.austritt || "-";

        await this.renderAccounts(data.accounts);
        await this.renderRoles(data);
        this.bindActions(user);
    },

    async renderAccounts(accounts=[]){

        if(!state.systemMap)
            state.systemMap = await api.getSystemMap();

        DOM.sidebarAccounts.innerHTML = accounts.map(acc=>{

            const system =
                state.systemMap[acc.system_id] ||
                `System #${acc.system_id}`;

            return `
                <li>
                    <span>${acc.account_identifier}</span>
                    <span>${system}</span>
                </li>
            `;
        }).join("");
    },

    async renderRoles(data){

        const roles = data.roles || [];
        const map = await api.getRoleMap();

        DOM.sidebarRoles.innerHTML="";

        if(!roles.length){
            DOM.sidebarRoles.innerHTML="<p>Keine Rollen</p>";
            return;
        }

        roles.forEach(role=>{

            const wrapper = document.createElement("div");

            const header = document.createElement("div");
            header.classList.add("role-header");

            header.textContent =
                map?.[role.role_id] ||
                role.name;

            const body = document.createElement("div");
            body.classList.add("hidden");

            const resources =
                data.role_resources_map?.[role.role_id] || [];

            body.innerHTML = resources.length
                ? `<ul>
                    ${resources.map(r=>
                        `<li class="${r.lifecycle_status!=="ACTIVE"?"inactive-resource":""}">
                            ${r.resource_name} - ${r.lifecycle_status}
                        </li>`
                    ).join("")}
                </ul>`
                : "Keine Ressourcen";

            header.onclick = ()=>body.classList.toggle("hidden");

            wrapper.append(header,body);
            DOM.sidebarRoles.appendChild(wrapper);
        });
    },
    bindActions(user){

        document
            .getElementById("tmp-rights-action-btn")
            .onclick = () =>
                tmpRightsModalController.open(user);

        document
            .getElementById("new-skill-action-btn")
            .onclick = () =>
                newSkillModalController.open(user);

        document
            .getElementById("skill-revoke-action-btn")
            .onclick = () =>
                skillRevokeModalController.open(user);

        document
            .getElementById("offboard-action-btn")
            .onclick = () =>
                offboardModalController.open(user);

        DOM.sidebarOverlay.onclick = (e) => {
            if (e.target === DOM.sidebarOverlay) {
                this.close();
            }
        };
    }
}

const onboardModalController = {
    init(){
        
        this.originalHTML = DOM.onboardModal.innerHTML;
        DOM.onboardActionBtn.addEventListener("click", this.open);
        DOM.onboardOverlay.addEventListener("click", (e) => {
        if(e.target === DOM.onboardOverlay){
            this.close();
        }
    });
        this.render();
    },
    open(){
        DOM.onboardOverlay.classList.add("active");
    },
    render(){
        DOM.onboardCloseBtn.addEventListener("click", this.close);

        DOM.onboardInternBtn.addEventListener("click", this.internForm);

        DOM.onboardExternalBtn.addEventListener("click", () => {
            console.log("Extern gewählt");
            // später: externes Onboarding Step 1
        });
    },
    close(){
        DOM.onboardOverlay.classList.remove("active");
        DOM.onboardModal.innerHTML = this.originalHTML;
        cacheDOM();
        this.render();
    },
    internForm(){
        DOM.onboardModal.innerHTML = `
            <h3>Onboarding Mitarbeiter</h3>

            <div class="onboard-form">
                <input 
                    id="personalnummer-input"
                    placeholder="Personalnummer"
                    title="Bitte stelle sicher, dass der Mitarbeiter in Helix angelegt ist."
                    style="width:100%;padding:8px;margin:12px 0;box-sizing: border-box;"
                />

                <button id="onboard-intern-submit-btn"
                    class="btn btn-primary"
                    style="margin-right:16px;"    
                >
                    Weiter
                </button>

                <button id="onboard-close-btn"
                    class="btn btn-secondary">
                    Abbrechen
                </button>
            </div>
        `;

        cacheDOM();
        DOM.onboardCloseBtn.addEventListener("click", () => onboardModalController.close());
        DOM.onboardInternSubmitBtn.addEventListener("click", async () => {
            const pn = DOM.onboardInternInput.value.trim();
            if (!pn) {
                showFlash("Bitte Personalnummer eingeben", "failure");
                return;
            }

            await api.startOnboarding(pn);
            await tableController.loadUsers();
            onboardModalController.close();
                
        });
    }
}

const tmpRightsModalController = {

    open(user){
        this.render(user);
        DOM.tmpRightsOverlay.classList.add("active");
    },

    close(){
        DOM.tmpRightsOverlay.classList.remove("active");
    },

    render(user){
        DOM.tmpRightsModal.innerHTML = `
            <h3>Temporäre Rolle für ${user.first_name} ${user.last_name}</h3>

            <div class="form-group">
                <div class="tmp-rights-form-field">
                    <label>Rolle</label>
                    <select id="tmp-role-select" required>
                        <option value="" disabled selected>Rolle auswählen...</option>
                    </select>
                </div>    
            </div>

            <div class="form-group">
                <div class="tmp-rights-form-field">
                    <label>Ab wann (optional)</label>
                    <input 
                        type="date"
                        id="tmp-startdate"
                        min="${new Date().toISOString().split("T")[0]}"
                        disabled
                    >
                </div>
            </div>

            <div class="form-group">
                <div class="tmp-rights-form-field">
                    <label>Enddatum</label>
                    <input 
                        type="date"
                        id="tmp-enddate"
                        required
                        min="${new Date().toISOString().split("T")[0]}"
                    >
                </div>
            </div>

            <div style="margin-top:20px;">
                <button id="tmp-rights-submit" class="btn btn-primary">
                    Beantragen
                </button>

                <button id="tmp-rights-close-btn" class="btn btn-secondary">
                    Abbrechen
                </button>
            </div>
        `;

        cacheDOM(); // DOM.tmpRightsSelect etc. definieren
        DOM.tmpRightsCloseBtn.onclick = () => this.close();
        this.loadRoles();
        this.bindSubmit(user);
    },

    async loadRoles() {
        const select = DOM.tmpRightsSelect; // gecacht
        select.innerHTML = '<option value="" disabled selected>Rolle auswählen...</option>';
        roleList = await api.getRoleMap();
        Object.entries(roleList)
            .filter(([id, role]) => role.type === "SECONDARY")
            .forEach(([id, role]) => {
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = role.name;
                select.appendChild(opt);
            });
    },

    bindSubmit(user) {
        DOM.tmpRightsSubmit.onclick = async () => {
            const roleId = DOM.tmpRightsSelect.value;
            const startdate = DOM.tmpRightsStartdate.value || null;
            const enddate = DOM.tmpRightsEnddate.value;

            if (!roleId || !enddate) {
                showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
                return;
            }

            await api.startTmpRoleAssignment({ user_id: user.user_id, role_id: roleId, startdate, enddate });
            this.close();
        };
    }
};

const newSkillModalController = {

    open(user){
        this.render(user);
        DOM.newSkillOverlay.classList.add("active");
    },

    close(){
        DOM.newSkillOverlay.classList.remove("active");
    },

    render(user){
        DOM.newSkillModal.innerHTML = `
            <h3>Neuer Skill für ${user.first_name} ${user.last_name}</h3>

            <div class="form-group">
                <div class="new-skill-form-field">
                    <label>Rolle</label>
                    <select id="new-skill-select" required>
                        <option value="" disabled selected>Rolle auswählen...</option>
                    </select>
                </div>    
            </div>

            <div class="form-group">
                <div class="new-skill-form-field">
                    <label>Ab wann (optional)</label>
                    <input 
                        type="date"
                        id="new-skill-startdate"
                        min="${new Date().toISOString().split("T")[0]}"
                        disabled
                    >
                </div>
            </div>

            <div style="margin-top:20px;">
                <button id="new-skill-submit" class="btn btn-primary">
                    Beantragen
                </button>

                <button id="new-skill-close-btn" class="btn btn-secondary">
                    Abbrechen
                </button>
            </div>
        `;

        cacheDOM(); // DOM.tmpRightsSelect etc. definieren
        DOM.newSkillCloseBtn.onclick = () => this.close();
        this.loadRoles();
        this.bindSubmit(user);
    },

    async loadRoles() {
        const select = DOM.newSkillSelect; // gecacht
        select.innerHTML = '<option value="" disabled selected>Rolle auswählen...</option>';
        roleList = await api.getRoleMap();
        Object.entries(roleList)
            .filter(([id, role]) => role.type === "SECONDARY")
            .forEach(([id, role]) => {
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = role.name;
                select.appendChild(opt);
            });
    },

    bindSubmit(user) {
        DOM.newSkillSubmit.onclick = async () => {
            const roleId = DOM.newSkillSelect.value;
            const startdate = DOM.newSkillStartDate.value || null;

            if (!roleId) {
                showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
                return;
            }

            await api.startNewSkillAssignment({ user_id: user.user_id, role_id: roleId, start_date: startdate });
            this.close();
        };
    }
};

const skillRevokeModalController = {

    open(user){
        this.render(user);
        DOM.skillRevokeOverlay.classList.add("active");
    },

    close(){
        DOM.skillRevokeOverlay.classList.remove("active");
    },

    render(user){
        DOM.skillRevokeModal.innerHTML = `
            <h3>Skill entziehen für ${user.first_name} ${user.last_name}</h3>

            <div class="form-group">
                <div class="skill-revoke-form-field">
                    <label>Rolle</label>
                    <select id="skill-revoke-select" required>
                        <option value="" disabled selected>Rolle auswählen...</option>
                    </select>
                </div>    
            </div>

            <div class="form-group">
                <div class="skill-revoke-form-field">
                    <label>Ab wann (optional)</label>
                    <input 
                        type="date"
                        id="skill-revoke-startdate"
                        min="${new Date().toISOString().split("T")[0]}"
                        disabled
                    >
                </div>
            </div>

            <div style="margin-top:20px;">
                <button id="skill-revoke-submit" class="btn btn-primary">
                    Beantragen
                </button>

                <button id="skill-revoke-close-btn" class="btn btn-secondary">
                    Abbrechen
                </button>
            </div>
        `;

        cacheDOM(); // DOM.skillRevokeSelect etc. definieren
        DOM.skillRevokeCloseBtn.onclick = () => this.close();
        this.loadRoles(user);
        this.bindSubmit(user);
    },

    async loadRoles(user) {
        const select = DOM.skillRevokeSelect;
        select.innerHTML = '<option value="" disabled selected>Rolle auswählen...</option>';
        roleList = user.secondary_roles;
        Object.entries(roleList)
            .filter(([id, role]) => role.type === "SECONDARY")
            .forEach(([id, role]) => {
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = role.name;
                select.appendChild(opt);
            });
    },

    bindSubmit(user) {
        DOM.skillRevokeSubmit.onclick = async () => {
            const roleId = DOM.skillRevokeSelect.value;
            const startdate = DOM.skillRevokeStartdate.value || null;

            if (!roleId) {
                showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
                return;
            }

            await api.startSkillRevoke({
                user_id: user.user_id,
                role_id: roleId,
                start_date: startdate
            });

            this.close();
        };
    }
};

const offboardModalController = {

    open(user){
        this.render(user);
        DOM.offboardOverlay.classList.add("active");
    },

    close(){
        DOM.offboardOverlay.classList.remove("active");
    },

    render(user){
        DOM.offboardModal.innerHTML = `
            <h3>Offboarding von ${user.first_name} ${user.last_name}</h3>

            <div class="form-group">
                <div class="offboard-form-field">
                    <label>Austritt am</label>
                    <input 
                        type="date"
                        id="offboard-exitdate"
                        required
                        min="${new Date().toISOString().split("T")[0]}"
                    >
                </div>
            </div>

            <div style="margin-top:20px;">
                <button id="offboard-submit" class="btn btn-primary">
                    Bestätigen
                </button>

                <button id="offboard-close-btn" class="btn btn-secondary">
                    Abbrechen
                </button>
            </div>
        `;

        cacheDOM(); // DOM.offboardExitdate etc. definieren
        DOM.offboardCloseBtn.onclick = () => this.close();
        this.bindSubmit(user);
    },

    bindSubmit(user) {
        DOM.offboardSubmit.onclick = async () => {
            const exitdate = DOM.offboardExitdate.value;

            if (!exitdate) {
                showFlash("Bitte das Austrittsdatum angeben", "failure");
                return;
            }

            await api.startOffboarding({
                user_id: user.user_id,
                exitdate
            });
            this.close();
        };
    }
};

document.addEventListener("DOMContentLoaded", () => {
    
    cacheDOM();
    tableController.init();
    onboardModalController.init();

});

function cacheDOM() {
    DOM.userTable = document.getElementById("user-table");
    DOM.tableBody = DOM.userTable.querySelector("tbody");
    DOM.searchInput = document.getElementById("search-input");

    DOM.sidebarOverlay = document.getElementById("sidebar-overlay");
    DOM.tabs = document.querySelectorAll(".sidebar-tabs .tab");
    DOM.tabContents = document.querySelectorAll(".tab-content");

    DOM.onboardOverlay = document.getElementById("onboard-overlay");
    DOM.onboardModal = document.querySelector(".onboard-modal");
    DOM.onboardCloseBtn = document.getElementById("onboard-close-btn");
    DOM.onboardInternBtn = document.getElementById("onboard-employee-btn");
    DOM.onboardInternInput = document.getElementById("personalnummer-input");
    DOM.onboardInternSubmitBtn = document.getElementById("onboard-intern-submit-btn")
    DOM.onboardExternalBtn = document.getElementById("onboard-external-btn");
    DOM.onboardActionBtn = document.getElementById("onboard-action-btn");

    DOM.newSkillOverlay = document.getElementById("new-skill-overlay");
    DOM.newSkillModal = document.querySelector(".new-skill-modal");
    DOM.newSkillCloseBtn = document.getElementById("new-skill-close-btn");
    DOM.newSkillActionBtn = document.getElementById("new-skill-action-btn");
    DOM.newSkillSubmit = document.getElementById("new-skill-submit");
    DOM.newSkillSelect = document.getElementById("new-skill-select");
    DOM.newSkillStartDate = document.getElementById("new-skill-startdate");

    DOM.tmpRightsOverlay = document.getElementById("tmp-rights-overlay");
    DOM.tmpRightsModal = document.querySelector(".tmp-rights-modal");
    DOM.tmpRightsCloseBtn = document.getElementById("tmp-rights-close-btn");
    DOM.tmpRightsActionBtn = document.getElementById("tmp-rights-action-btn");
    DOM.tmpRightsSubmit = document.getElementById("tmp-rights-submit");
    DOM.tmpRightsSelect = document.getElementById("tmp-role-select");
    DOM.tmpRightsStartdate = document.getElementById("tmp-startdate");
    DOM.tmpRightsEnddate = document.getElementById("tmp-enddate");

    DOM.skillRevokeOverlay = document.getElementById("skill-revoke-overlay");
    DOM.skillRevokeModal = document.querySelector(".skill-revoke-modal");
    DOM.skillRevokeCloseBtn = document.getElementById("skill-revoke-close-btn");
    DOM.skillRevokeActionBtn = document.getElementById("skill-revoke-action-btn");
    DOM.skillRevokeSubmit = document.getElementById("skill-revoke-submit");
    DOM.skillRevokeSelect = document.getElementById("skill-revoke-select");
    DOM.skillRevokeStartDate = document.getElementById("skill-revoke-startdate");

    DOM.offboardOverlay = document.getElementById("offboard-overlay");
    DOM.offboardModal = document.querySelector(".offboard-modal");
    DOM.offboardExitdate = document.getElementById("offboard-exitdate");
    DOM.offboardSubmit = document.getElementById("offboard-submit");
    DOM.offboardCloseBtn = document.getElementById("offboard-close-btn");
    DOM.offboardActionBtn = document.getElementById("offboard-action-btn");
    // Sidebar fields
    DOM.sidebarUsername = document.getElementById("sidebar-username");
    DOM.sidebarPNR = document.getElementById("user-pnr");
    DOM.sidebarLastName = document.getElementById("user-nachname");
    DOM.sidebarFirstName = document.getElementById("user-vorname");
    DOM.sidebarFunktion = document.getElementById("user-funktion");
    DOM.sidebarEmail = document.getElementById("user-email");
    DOM.sidebarTelefon = document.getElementById("user-telefon");
    DOM.sidebarMobil = document.getElementById("user-mobil");
    DOM.sidebarEintritt = document.getElementById("user-eintritt");
    DOM.sidebarAustritt = document.getElementById("user-austritt");
    DOM.sidebarAccounts = document.querySelector(".account-list");
    DOM.sidebarRoles = document.getElementById("tab-rollen");
}