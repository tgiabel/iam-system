const state = {
    users: [],
    systemMap: null,
    roleMap: null,
    currentUserDetail: null,
    filters: {
        primaryRoleIds: [],
        secondaryRoleIds: [],
        includeInactive: false,
        openCategory: null
    }
};

const DOM = {};

const api = {

    async getUsers(){
        const isActive = String(!state.filters.includeInactive);
        const res = await fetch(`/api/users?is_active=${isActive}`);
        if(!res.ok) throw new Error(res.status);
        return res.json();
    },

    async getUserDetails(id){
        const res = await fetch(`/api/users/${id}/details`);
        if(!res.ok) throw new Error(res.status);
        return res.json();
    },

    async setupSofaAccess(userId, password) {
        const res = await fetch(`/api/users/${userId}/sofa-access/setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.error || "SOFA Zugriff konnte nicht eingerichtet werden");
        return data;
    },

    async resetSofaPassword(userId, password) {
        const res = await fetch(`/api/users/${userId}/sofa-access/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.error || "SOFA Passwort konnte nicht zurückgesetzt werden");
        return data;
    },

    async revokeSofaAccess(userId) {
        const res = await fetch(`/api/users/${userId}/sofa-access/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.error || "SOFA Zugriff konnte nicht entzogen werden");
        return data;
    },

    async getSystemMap(){
        if (state.systemMap) return state.systemMap;
        const res = await fetch("/api/systems/map");
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

    async startExternalOnboarding(payload){
        try {
            const res = await fetch("/api/processes/onboarding-ext", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }

            showFlash(`Externen User angelegt`, "success");

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

    async startSkillRevoke(payload){
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

function normalizeValue(value) {
    return String(value || "").toLowerCase();
}

function getRoleOptionsByType(type) {
    return Object.entries(state.roleMap || {})
        .filter(([, role]) => role.type === type)
        .sort(([, a], [, b]) => a.name.localeCompare(b.name, "de"));
}

const filterController = {

    async init() {
        this.bindEvents();

        try {
            await api.getRoleMap();
        } catch (err) {
            console.error("Role Map konnte nicht für Filter geladen werden", err);
        }

        this.renderActiveTags();
    },

    bindEvents() {
        DOM.filterBtn?.addEventListener("click", (event) => {
            event.stopPropagation();

            const shouldOpen = !DOM.filterDropdown.classList.contains("active");
            this.closeMenus();

            if (shouldOpen) {
                DOM.filterDropdown.classList.add("active");
            }
        });

        DOM.filterDropdown?.querySelectorAll("[data-filter]").forEach(button => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                await this.openSubfilter(button.dataset.filter);
            });
        });

        DOM.subfilterDropdown?.addEventListener("click", (event) => {
            event.stopPropagation();
        });

        DOM.subfilterDropdown?.addEventListener("change", async (event) => {
            const target = event.target;

            if (!(target instanceof HTMLInputElement)) return;

            if (target.dataset.filterType === "status") {
                state.filters.includeInactive = target.checked;
                this.renderActiveTags();
                await tableController.loadUsers();
                await this.openSubfilter("status");
                return;
            }

            if (target.dataset.filterType === "primary") {
                this.toggleRoleFilter("primaryRoleIds", target.value, target.checked);
            }

            if (target.dataset.filterType === "secondary") {
                this.toggleRoleFilter("secondaryRoleIds", target.value, target.checked);
            }

            this.renderActiveTags();
            tableController.render();
        });

        DOM.activeFilters?.addEventListener("click", async (event) => {
            const target = event.target;

            if (!(target instanceof HTMLElement) || target.tagName !== "SPAN") return;

            const { filterType, value } = target.dataset;
            if (!filterType) return;

            if (filterType === "status") {
                state.filters.includeInactive = false;
                this.renderActiveTags();
                this.rerenderOpenSubfilter();
                await tableController.loadUsers();
                return;
            }

            if (filterType === "primary") {
                this.toggleRoleFilter("primaryRoleIds", value, false);
            }

            if (filterType === "secondary") {
                this.toggleRoleFilter("secondaryRoleIds", value, false);
            }

            this.renderActiveTags();
            this.rerenderOpenSubfilter();
            tableController.render();
        });

        document.addEventListener("click", (event) => {
            if (!DOM.filterContainer?.contains(event.target)) {
                this.closeMenus();
            }
        });
    },

    async openSubfilter(category) {
        state.filters.openCategory = category;

        if (!state.roleMap && category !== "status") {
            await api.getRoleMap();
        }

        DOM.filterDropdown.classList.add("active");
        DOM.subfilterDropdown.classList.add("active");
        this.renderSubfilter(category);
    },

    closeMenus() {
        DOM.filterDropdown?.classList.remove("active");
        DOM.subfilterDropdown?.classList.remove("active");
        state.filters.openCategory = null;
    },

    rerenderOpenSubfilter() {
        if (!state.filters.openCategory || !DOM.subfilterDropdown?.classList.contains("active")) return;
        this.renderSubfilter(state.filters.openCategory);
    },

    renderSubfilter(category) {
        if (!DOM.subfilterDropdown) return;

        if (category === "status") {
            DOM.subfilterDropdown.innerHTML = `
                <label>
                    <input
                        type="checkbox"
                        data-filter-type="status"
                        ${state.filters.includeInactive ? "checked" : ""}
                    >
                    Inaktive User mitladen
                </label>
            `;
            return;
        }

        const roleType = category === "hauptrolle" ? "PRIMARY" : "SECONDARY";
        const selectedIds = category === "hauptrolle"
            ? state.filters.primaryRoleIds
            : state.filters.secondaryRoleIds;
        const filterType = category === "hauptrolle" ? "primary" : "secondary";
        const options = getRoleOptionsByType(roleType);

        DOM.subfilterDropdown.innerHTML = options.length
            ? options.map(([roleId, role]) => `
                <label>
                    <input
                        type="checkbox"
                        value="${roleId}"
                        data-filter-type="${filterType}"
                        ${selectedIds.includes(String(roleId)) ? "checked" : ""}
                    >
                    ${role.name}
                </label>
            `).join("")
            : "<span>Keine Rollen gefunden</span>";
    },

    toggleRoleFilter(key, roleId, checked) {
        const normalizedRoleId = String(roleId);
        const values = new Set(state.filters[key].map(String));

        if (checked) {
            values.add(normalizedRoleId);
        } else {
            values.delete(normalizedRoleId);
        }

        state.filters[key] = Array.from(values);
    },

    renderActiveTags() {
        if (!DOM.activeFilters) return;

        const tags = [
            ...state.filters.primaryRoleIds.map(roleId => ({
                filterType: "primary",
                value: roleId,
                label: `Funktion: ${state.roleMap?.[roleId]?.name || roleId}`
            })),
            ...state.filters.secondaryRoleIds.map(roleId => ({
                filterType: "secondary",
                value: roleId,
                label: `Nebenrolle: ${state.roleMap?.[roleId]?.name || roleId}`
            }))
        ];

        if (state.filters.includeInactive) {
            tags.push({
                filterType: "status",
                value: "inactive",
                label: "Inaktive inkl."
            });
        }

        DOM.activeFilters.innerHTML = tags.map(tag => `
            <div class="filter-tag">
                ${tag.label}
                <span data-filter-type="${tag.filterType}" data-value="${tag.value}">&times;</span>
            </div>
        `).join("");
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
        const users = this.getFilteredUsers();

        DOM.tableBody.innerHTML = users.length
            ? users.map(u => `
                <tr data-id="${u.user_id}">
                    <td>${u.pnr || "-"}</td>
                    <td>${u.first_name}</td>
                    <td>${u.last_name}</td>
                    <td>${u.email || ""}</td>
                    <td>${u.primary_role?.name || ""}</td>
                    <td><span title="${(u.secondary_roles || []).map(role => role.name).join("\n")}" style="cursor:help;"><strong>${(u.secondary_roles || []).length}</strong></span></td>
                    <td>${u.is_active ? "Aktiv" : "Inaktiv"}</td>
                </tr>
            `).join("")
            : `<tr><td colspan="8">Keine User gefunden</td></tr>`;

        this.bindRows();
    },

    getFilteredUsers() {
        const searchValue = normalizeValue(DOM.searchInput?.value);

        return state.users
            .filter(user => this.matchesSearch(user, searchValue))
            .filter(user => this.matchesPrimaryRoles(user))
            .filter(user => this.matchesSecondaryRoles(user));
    },

    matchesSearch(user, searchValue) {
        if (!searchValue) return true;

        return normalizeValue(user.first_name).includes(searchValue) ||
            normalizeValue(user.last_name).includes(searchValue) ||
            normalizeValue(user.pnr).includes(searchValue) ||
            normalizeValue(user.racf).includes(searchValue);
    },

    matchesPrimaryRoles(user) {
        if (!state.filters.primaryRoleIds.length) return true;

        return state.filters.primaryRoleIds.includes(String(user.primary_role?.role_id || ""));
    },

    matchesSecondaryRoles(user) {
        if (!state.filters.secondaryRoleIds.length) return true;

        const secondaryRoleIds = (user.secondary_roles || []).map(role => String(role.role_id));
        return state.filters.secondaryRoleIds.some(roleId => secondaryRoleIds.includes(String(roleId)));
    },

    bindRows(){
        DOM.tableBody.querySelectorAll("tr").forEach(tr=>{
            if (!tr.dataset.id) return;
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
            state.currentUserDetail = data;
            await this.render(data);
            DOM.sidebarOverlay.classList.add("active");

        }catch(err){
            console.error("UserDetails Fehler", err);
        }
    },

    close(){
        DOM.sidebarOverlay.classList.remove("active");
        state.currentUserDetail = null;
        tableController.loadUsers();
    },

    async refreshCurrentUser() {
        if (!state.currentUserDetail?.user_id) return;

        const data = await api.getUserDetails(state.currentUserDetail.user_id);
        state.currentUserDetail = data;
        await this.render(data);
    },

    async render(data){

        const user = data;

        DOM.sidebarUsername.textContent = `${user.first_name} ${user.last_name}`;
        DOM.sidebarPNR.textContent = user.pnr || "-";
        DOM.sidebarLastName.textContent = user.last_name || "-";
        DOM.sidebarFirstName.textContent = user.first_name || "-";
        DOM.sidebarFunktion.textContent = user.primary_role?.name || "-";
        DOM.sidebarEmail.textContent = user.email || "-";
        DOM.sidebarTelefon.textContent = user.telefon || "-";
        DOM.sidebarMobil.textContent = user.mobile || "-";
        DOM.sidebarEintritt.textContent = user.eintritt || "-";
        DOM.sidebarAustritt.textContent = user.austritt || "-";

        await this.renderAccounts(data.accounts);
        await this.renderRoles(data);
        this.renderSofaAccessActions(user);
        this.bindActions(user);
    },

    renderSofaAccessActions(user) {
        const hasSofaAccess = Boolean(user.has_sofa_access);

        DOM.sofaAccessStatus.textContent = hasSofaAccess
            ? "SOFA Zugriff ist eingerichtet."
            : "Kein SOFA Zugriff eingerichtet.";
        DOM.sofaAccessStatus.style.color = hasSofaAccess ? "#166534" : "#991b1b";

        DOM.sofaAccessActions.innerHTML = hasSofaAccess
            ? `
                <button class="btn btn-secondary" id="sofa-password-reset-btn">SOFA Passwort zurücksetzen</button>
                <button class="btn btn-red" id="sofa-access-revoke-btn">SOFA Zugriff entziehen</button>
            `
            : `
                <button class="btn btn-primary" id="sofa-access-setup-btn">SOFA Zugriff einrichten</button>
            `;
    },

    async renderAccounts(accounts=[]){

        if(!state.systemMap)
            state.systemMap = await api.getSystemMap();

        DOM.sidebarAccounts.innerHTML = accounts.map(acc=>{

            const system =
                state.systemMap[acc.system_id]?.name ||
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
        const roles = [
            ...(data.primary_role ? [data.primary_role] : []),
            ...(data.secondary_roles || []),
            ...(data.roles || [])
        ].filter((role, index, arr) =>
            role?.role_id && arr.findIndex(entry => entry?.role_id === role.role_id) === index
        );
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
                map?.[role.role_id]?.name ||
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
        document.getElementById("sofa-access-setup-btn")?.addEventListener("click", () => {
            sofaAccessModalController.open(user, "setup");
        });

        document.getElementById("sofa-password-reset-btn")?.addEventListener("click", () => {
            sofaAccessModalController.open(user, "reset");
        });

        document.getElementById("sofa-access-revoke-btn")?.addEventListener("click", () => {
            sofaAccessModalController.open(user, "revoke");
        });

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

const sofaAccessModalController = {
    init() {
        this.originalHTML = DOM.sofaAccessModal.innerHTML;

        DOM.sofaAccessOverlay.addEventListener("click", (e) => {
            if (e.target === DOM.sofaAccessOverlay) {
                this.close();
            }
        });

        DOM.sofaAccessCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user, mode) {
        this.render(user, mode);
        DOM.sofaAccessOverlay.classList.add("active");
    },

    close() {
        DOM.sofaAccessOverlay.classList.remove("active");
        DOM.sofaAccessModal.innerHTML = this.originalHTML;
        cacheDOM();
        DOM.sofaAccessCloseBtn?.addEventListener("click", () => this.close());
    },

    render(user, mode) {
        const titleMap = {
            setup: `SOFA Zugriff für ${user.first_name} ${user.last_name} einrichten`,
            reset: `SOFA Passwort für ${user.first_name} ${user.last_name} zurücksetzen`,
            revoke: `SOFA Zugriff für ${user.first_name} ${user.last_name} entziehen`
        };

        if (mode === "revoke") {
            DOM.sofaAccessModal.innerHTML = `
                <h3>${titleMap[mode]}</h3>
                <p style="margin:12px 0 20px;">Der Zugriff auf die SOFA Anwendung wird entzogen.</p>
                <button id="sofa-access-submit-btn" class="btn btn-red" style="margin-right:16px;">Bestätigen</button>
                <button id="sofa-access-close-btn" class="btn btn-secondary">Abbrechen</button>
            `;
        } else {
            DOM.sofaAccessModal.innerHTML = `
                <h3>${titleMap[mode]}</h3>
                <div class="onboard-form">
                    <input
                        id="sofa-access-password-input"
                        type="password"
                        placeholder="Passwort"
                        style="width:100%;padding:8px;margin:12px 0;box-sizing:border-box;"
                    />
                    <input
                        id="sofa-access-password-confirm-input"
                        type="password"
                        placeholder="Passwort bestätigen"
                        style="width:100%;padding:8px;margin:12px 0;box-sizing:border-box;"
                    />
                    <button id="sofa-access-submit-btn" class="btn btn-primary" style="margin-right:16px;">
                        Speichern
                    </button>
                    <button id="sofa-access-close-btn" class="btn btn-secondary">Abbrechen</button>
                </div>
            `;
        }

        cacheDOM();

        DOM.sofaAccessCloseBtn?.addEventListener("click", () => this.close());
        DOM.sofaAccessSubmitBtn?.addEventListener("click", async () => {
            try {
                if (mode === "setup" || mode === "reset") {
                    const password = DOM.sofaAccessPasswordInput?.value.trim() || "";
                    const passwordConfirm = DOM.sofaAccessPasswordConfirmInput?.value.trim() || "";

                    if (!password || !passwordConfirm) {
                        showFlash("Bitte Passwort und Bestätigung ausfüllen", "failure");
                        return;
                    }

                    if (password !== passwordConfirm) {
                        showFlash("Die Passwörter stimmen nicht überein", "failure");
                        return;
                    }

                    if (mode === "setup") {
                        await api.setupSofaAccess(user.user_id, password);
                        showFlash("SOFA Zugriff eingerichtet", "success");
                    } else {
                        await api.resetSofaPassword(user.user_id, password);
                        showFlash("SOFA Passwort zurückgesetzt", "success");
                    }
                }

                if (mode === "revoke") {
                    await api.revokeSofaAccess(user.user_id);
                    showFlash("SOFA Zugriff entzogen", "success");
                }

                await sidebarController.refreshCurrentUser();
                await tableController.loadUsers();
                this.close();
            } catch (err) {
                console.error(err);
                showFlash(err.message || "SOFA Aktion fehlgeschlagen", "failure");
            }
        });
    }
};

const onboardModalController = {
    init() {
        this.originalHTML = DOM.onboardModal.innerHTML;

        DOM.onboardActionBtn.addEventListener("click", () => this.open());

        DOM.onboardOverlay.addEventListener("click", (e) => {
            if (e.target === DOM.onboardOverlay) {
                this.close();
            }
        });

        this.render();
    },

    open() {
        DOM.onboardOverlay.classList.add("active");
    },

    render() {
        DOM.onboardCloseBtn?.addEventListener("click", () => this.close());

        DOM.onboardInternBtn?.addEventListener("click", () => this.internForm());

        DOM.onboardExternalBtn?.addEventListener("click", () => this.externForm());
    },

    close() {
        DOM.onboardOverlay.classList.remove("active");
        DOM.onboardModal.innerHTML = this.originalHTML;
        cacheDOM();
        this.render();
    },

    internForm() {
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

        DOM.onboardCloseBtn?.addEventListener("click", () => this.close());

        DOM.onboardInternSubmitBtn?.addEventListener("click", async () => {
            const pn = DOM.onboardInternInput.value.trim();

            if (!pn) {
                showFlash("Bitte Personalnummer eingeben", "failure");
                return;
            }

            await api.startOnboarding(pn);
            await tableController.loadUsers();
            this.close();
        });
    },

    externForm() {
        DOM.onboardModal.innerHTML = `
            <h3>Externes Onboarding</h3>

            <div class="onboard-form">
                <input 
                    id="extern-vorname-input"
                    placeholder="Vorname"
                    style="width:100%;padding:8px;margin:12px 0;box-sizing: border-box;"
                />

                <input 
                    id="extern-nachname-input"
                    placeholder="Nachname"
                    style="width:100%;padding:8px;margin:12px 0;box-sizing: border-box;"
                />

                <input 
                    id="extern-email-input"
                    type="email"
                    placeholder="E-Mail"
                    style="width:100%;padding:8px;margin:12px 0;box-sizing: border-box;"
                />

                <input 
                    id="extern-telefon-input"
                    type="tel"
                    placeholder="Telefon"
                    style="width:100%;padding:8px;margin:12px 0;box-sizing: border-box;"
                />

                <button id="onboard-extern-submit-btn"
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

        DOM.onboardCloseBtn?.addEventListener("click", () => this.close());

        DOM.onboardExternSubmitBtn?.addEventListener("click", async () => {
            const vorname = document.getElementById("extern-vorname-input")?.value.trim();
            const nachname = document.getElementById("extern-nachname-input")?.value.trim();
            const email = document.getElementById("extern-email-input")?.value.trim();
            const telefon = document.getElementById("extern-telefon-input")?.value.trim();

            if (!vorname || !nachname || !email || !telefon) {
                showFlash("Bitte alle Felder ausfüllen", "failure");
                return;
            }

            console.log("Externes Onboarding:", {
                vorname,
                nachname,
                email,
                telefon
            });

            await api.startExternalOnboarding({ vorname, nachname, email, telefon });
            await tableController.loadUsers();

            this.close();
        });
    }
};

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

        const roleList = user.secondary_roles || [];

        roleList
            .filter(role => role.role_type === "SECONDARY")
            .forEach(role => {
                const opt = document.createElement("option");
                opt.value = role.role_id;
                opt.textContent = role.name;
                select.appendChild(opt);
            });
    },

    bindSubmit(user) {
        DOM.skillRevokeSubmit.onclick = async () => {
            const roleId = DOM.skillRevokeSelect.value;
            const startdate = DOM.skillRevokeStartDate.value || null;

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
    filterController.init();
    tableController.init();
    onboardModalController.init();
    sofaAccessModalController.init();

});

function cacheDOM() {
    DOM.userTable = document.getElementById("user-table");
    DOM.tableBody = DOM.userTable.querySelector("tbody");
    DOM.searchInput = document.getElementById("search-input");
    DOM.filterContainer = document.querySelector(".filter-container");
    DOM.filterBtn = document.getElementById("filter-btn");
    DOM.filterDropdown = document.getElementById("filter-dropdown");
    DOM.subfilterDropdown = document.getElementById("subfilter-dropdown");
    DOM.activeFilters = document.getElementById("active-filters");

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
    DOM.onboardExternSubmitBtn = document.getElementById("onboard-extern-submit-btn");
    DOM.onboardExternVornameInput = document.getElementById("extern-vorname-input");
    DOM.onboardExternNachnameInput = document.getElementById("extern-nachname-input");
    DOM.onboardExternEmailInput = document.getElementById("extern-email-input");
    DOM.onboardExternTelefonInput = document.getElementById("extern-telefon-input");

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

    DOM.sofaAccessStatus = document.getElementById("sofa-access-status");
    DOM.sofaAccessActions = document.getElementById("sofa-access-actions");
    DOM.sofaAccessOverlay = document.getElementById("sofa-access-overlay");
    DOM.sofaAccessModal = document.getElementById("sofa-access-modal");
    DOM.sofaAccessCloseBtn = document.getElementById("sofa-access-close-btn");
    DOM.sofaAccessSubmitBtn = document.getElementById("sofa-access-submit-btn");
    DOM.sofaAccessPasswordInput = document.getElementById("sofa-access-password-input");
    DOM.sofaAccessPasswordConfirmInput = document.getElementById("sofa-access-password-confirm-input");
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
