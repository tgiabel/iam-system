document.addEventListener("DOMContentLoaded", () => {
    const userTable = document.getElementById("user-table");
    const tableBody = document.querySelector("#user-table tbody");
    const searchInput = document.getElementById("search-input");
    const overlay = document.getElementById("sidebar-overlay");
    const tabs = document.querySelectorAll(".sidebar-tabs .tab");
    const tabContents = document.querySelectorAll(".tab-content");
    const onboardBtn = document.getElementById("onboard-action-btn");
    const onboardOverlay = document.getElementById("onboard-overlay");
    const onboardClose = document.getElementById("onboard-close-btn");
    const onboardModal = document.querySelector(".onboard-modal");
    const tmpRightsBtn = document.getElementById("tmp-rights-action-btn");
    const tmpRightsOverlay = document.getElementById("tmp-rights-overlay");
    const tmpRightsClose = document.getElementById("tmp-rights-close-btn");
    const tmpRightsModal = document.querySelector(".tmp-rights-modal");
    const originalOnboardModalHTML = onboardModal.innerHTML;
    const originalTmpRightsModalHTML = tmpRightsModal.innerHTML;
    
    let users = [];
    let systemMap = null;
    let roleMap = null;


    // Overlay schließen und Originalzustand wiederherstellen
    function closeOnboardOverlay() {
        onboardOverlay.classList.remove("active");
        onboardModal.innerHTML = originalOnboardModalHTML;
        bindOnboardButtons(); // Neu binden, da Buttons wieder neu erstellt
    }

    function closeTmpRightsOverlay() {
        tmpRightsOverlay.classList.remove("active");
        tmpRightsModal.innerHTML = originalTmpRightsModalHTML;
        bindTmpRightsButtons(); // Neu binden, da Buttons wieder neu erstellt
    }
    onboardBtn.addEventListener("click", () => {
        onboardOverlay.classList.add("active");
    });

    onboardClose.addEventListener("click", () => {
        onboardOverlay.classList.remove("active");
    });

    // Klick auf Hintergrund schließt Overlay
    onboardOverlay.addEventListener("click", e => {
        if (e.target === onboardOverlay) closeOnboardOverlay();
    });

    tmpRightsBtn.addEventListener("click", () => {
        tmpRightsOverlay.classList.add("active");
    });

    tmpRightsClose.addEventListener("click", () => {
        tmpRightsOverlay.classList.remove("active");
    });

    // Klick auf Hintergrund schließt Overlay
    tmpRightsOverlay.addEventListener("click", e => {
        if (e.target === tmpRightsOverlay) closeTmpRightsOverlay();
    });

    function bindOnboardButtons() {
        const closeBtn = document.getElementById("onboard-close-btn");
        if (closeBtn) closeBtn.addEventListener("click", closeOnboardOverlay);

        const employeeBtn = document.getElementById("onboard-employee-btn");
        if (employeeBtn) employeeBtn.addEventListener("click", () => {
            showEmployeeForm();
        });

        const externalBtn = document.getElementById("onboard-external-btn");
        if (externalBtn) externalBtn.addEventListener("click", () => {
            console.log("Extern gewählt");
            // später: externes Onboarding Step 1
        });
    }

    bindOnboardButtons(); // initial binden
    // --- Funktion für Mitarbeiterformular ---
    function showEmployeeForm() {
        onboardModal.innerHTML = "";

        const title = document.createElement("h3");
        title.textContent = "Onboarding Mitarbeiter";
        onboardModal.appendChild(title);

        const formDiv = document.createElement("div");
        formDiv.classList.add("onboard-form");

        const input = document.createElement("input");
        input.type = "text";
        input.id = "personalnummer-input";
        input.placeholder = "Personalnummer";
        input.title = "Bitte stelle sicher, dass der Mitarbeiter in Helix angelegt ist.";
        input.style.width = "100%";
        input.style.padding = "8px";
        input.style.margin = "12px 0";
        input.style.boxSizing = "border-box";
        formDiv.appendChild(input);

        const nextBtn = document.createElement("button");
        nextBtn.id = "personalnummer-next-btn";
        nextBtn.className = "btn btn-primary";
        nextBtn.textContent = "Weiter";
        nextBtn.style.marginRight = "8px";
        formDiv.appendChild(nextBtn);

        onboardModal.appendChild(formDiv);

        // Abbrechen Button wieder hinzufügen
        const cancelBtn = document.createElement("button");
        cancelBtn.id = "onboard-close-btn";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.textContent = "Abbrechen";
        cancelBtn.style.marginTop = "16px";
        onboardModal.appendChild(cancelBtn);

        cancelBtn.addEventListener("click", closeOnboardOverlay);

        nextBtn.addEventListener("click", async () => {
            const pn = input.value.trim();
            if (!pn) {
                alert("Bitte Personalnummer eingeben");
                return;
            }
            try {
                const response = await fetch("/api/processes/onboarding", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pnr: pn })
                });

                const data = await response.json();

                if (!response.ok) {
                    alert("Fehler: " + (data.error ?? JSON.stringify(data)));
                    return;
                }

                console.log("Onboarding Prozess gestartet:", data);
                alert("Prozess gestartet! ID: " + data.process_id);

                // Optional: Step 3 / weitere UI Aktionen
            } catch (err) {
                console.error(err);
                alert("Unerwarteter Fehler: " + err);
            }
        });
    }


    // --- SYSTEM MAP LADEN ---
    async function loadSystemMap() {
        if (systemMap) return systemMap;
        const res = await fetch("/static/json/system_map.json");
        if (!res.ok) throw new Error("System Map konnte nicht geladen werden");
        systemMap = await res.json();
        return systemMap;
    }

    // --- ROLE MAP LADEN ---
    async function loadRoleMap() {
        if (roleMap) return roleMap;
        const res = await fetch("/static/json/role_map.json");
        if (!res.ok) throw new Error("Role Map konnte nicht geladen werden");
        roleMap = await res.json(); // korrekt speichern
        return roleMap;
    }

    // --- TAB SWITCHING ---
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.toggle("active", t === tab));
            tabContents.forEach(tc => tc.classList.toggle("hidden", tc.id !== `tab-${target}`));
        });
    });

    // --- USER DETAILS SIDEBAR BEFÜLLEN ---
    async function showUserDetails(userId) {
        try {
            const res = await fetch(`/api/users/${userId}/details`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            console.info(data);

            const user = data.user;
            const accounts = data.accounts || [];
            const roles = data.roles || [];
            const assignments = data.resource_assignments || [];
            const roleResourcesMap = data.role_resources_map || {}; // role_id -> [resources + lifecycle_status]
            const userRolesMap = await loadRoleMap();
            // --- Persönliche Infos ---
            document.getElementById("sidebar-username").textContent =
                `${user.first_name} ${user.last_name}`;
            document.getElementById("user-pnr").textContent = user.pnr;
            document.getElementById("user-vorname").textContent = user.first_name;
            document.getElementById("user-nachname").textContent = user.last_name;
            document.getElementById("user-funktion").textContent = userRolesMap?.[user.assigned_role_id] || "-";
            document.getElementById("user-email").textContent = user.email || "-";
            document.getElementById("user-telefon").textContent = user.telephone || "-";
            document.getElementById("user-mobil").textContent = user.mobile || "-";
            document.getElementById("user-eintritt").textContent = user.eintritt || "-";
            document.getElementById("user-austritt").textContent = user.austritt || "-";

            // Helix-Link
            const helixLink = document.getElementById("user-helix-link");
            helixLink.href = `https://helix.servodata.de/user/${user.pnr}`;

            // --- Accounts ---
            const systems = await loadSystemMap();
            const accountList = document.querySelector(".account-list");
            accountList.innerHTML = accounts.map(acc => {
                const systemName = systems[acc.system_id] || `System #${acc.system_id}`;
                return `
                    <li title="${systemName}">
                        <span class="account-name">${acc.account_identifier}</span>
                        <span class="account-system">${systemName}</span>
                        <button title="In Zwischneablage kopieren" class="account-cta" onclick="copyToClipboard('${acc.account_identifier}')">&#128203</button>
                    </li>
                `;
            }).join("");

            // --- Rollen Tab (Accordion mit Role Map Namen + Ressourcen + Status) ---
            const rollenTab = document.getElementById("tab-rollen");
            rollenTab.innerHTML = "";

            if (!roles.length) {
                rollenTab.innerHTML = "<p>Keine Rollen zugewiesen</p>";
            } else {
                const rolesMap = await loadRoleMap(); // role_id -> role_name

                roles.forEach(role => {
                    const roleItem = document.createElement("div");
                    roleItem.classList.add("role-item");

                    const roleHeader = document.createElement("div");
                    roleHeader.classList.add("role-header");

                    // Rollenname aus roleMap, fallback auf role.name oder Role ID
                    const roleName = rolesMap?.[role.role_id] || role.name || `Role ${role.role_id}`;
                    roleHeader.textContent = roleName;

                    const roleResources = document.createElement("div");
                    roleResources.classList.add("role-resources", "hidden");

                    // Ressourcen aus roleResourcesMap
                    const resources = roleResourcesMap[role.role_id] || [];
                    roleResources.innerHTML = ""; // vorher leeren

                    if (!resources.length) {
                        roleResources.innerHTML = "<p>Rolle hat keine Ressourcen.</p>";
                    } else {
                        const ul = document.createElement("ul");
                        ul.classList.add("role-resource-list"); // Klasse für CSS

                        resources.forEach(res => {
                            const li = document.createElement("li");
                            li.textContent = `${res.resource_name} - ${res.lifecycle_status || "NICHT ZUGEWIESEN"}`;

                            // Rot, wenn nicht ACTIVE
                            if (res.lifecycle_status !== "ACTIVE") {
                                li.classList.add("inactive-resource");
                            }

                            ul.appendChild(li);
                        });

                        roleResources.appendChild(ul);
                    }


                    // Accordion Toggle
                    roleHeader.addEventListener("click", () => roleResources.classList.toggle("hidden"));

                    roleItem.appendChild(roleHeader);
                    roleItem.appendChild(roleResources);
                    rollenTab.appendChild(roleItem);
                });
            }

            // --- Berechtigungen Tab ---
            const berechtigungenTab = document.getElementById("tab-berechtigungen");
            berechtigungenTab.innerHTML = assignments.length
                ? `<ul>${assignments.map(a => `<li>Resource ${a.resource_id} - Status: ${a.lifecycle_status}</li>`).join("")}</ul>`
                : "<p>Keine Berechtigungen zugewiesen</p>";

            // --- Overlay öffnen ---
            overlay.classList.add("active");

        } catch (err) {
            console.error("Fehler beim Laden der User-Details:", err);
        }
    }

    // --- TABLE RENDER & ROW CLICK ---
    function renderTable() {
        const filterText = searchInput.value.toLowerCase();
        tableBody.innerHTML = users
            .filter(u =>
                u.first_name.toLowerCase().includes(filterText) ||
                u.last_name.toLowerCase().includes(filterText) ||
                u.pnr.toLowerCase().includes(filterText)
            )
            .map(u => `
                <tr data-id="${u.user_id}">
                    <td class="select-col">
                        <input type="checkbox" class="row-select">
                    </td>
                    <td>${u.pnr}</td>
                    <td>${u.first_name}</td>
                    <td>${u.last_name}</td>
                    <td>${u.email || ""}</td>
                    <td>${u.primary_role.name || ""}</td>
                    <td><span title="${u.secondary_roles.join("\n")}" style="cursor:help;"><strong>${u.secondary_roles.length}</strong></span></td>
                    <td>${u.is_active ? "Aktiv" : "Inaktiv"}</td>
                </tr>
            `).join("");

        tableBody.querySelectorAll("tr").forEach(tr => {
            tr.addEventListener("click", () => {
                showUserDetails(tr.dataset.id);
        });
        });
    }

    // --- FETCH USERS ---
    async function fetchUsers() {
        try {
            const res = await fetch("/api/users");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            users = await res.json();
            renderTable();
        } catch (err) {
            console.error("Fehler beim Laden der Users:", err);
            tableBody.innerHTML = `<tr><td colspan="7">Fehler beim Laden der User</td></tr>`;
        }
    }

    // --- SEARCH ---
    searchInput.addEventListener("input", renderTable);

    // --- OVERLAY CLOSE ---
    overlay.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.remove("active");
    });

    // --- INIT ---
    fetchUsers();
});

function copyToClipboard(text) {
    try {
        navigator.clipboard.writeText(text);
    } catch(err) {
        showFlash("Fehler beim Kopieren", "failure");
        console.error("Fehler beim Kopieren: ", err);
    }
}