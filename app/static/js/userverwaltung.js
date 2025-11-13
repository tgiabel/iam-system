document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("sidebar-overlay");
    const actionBtn = document.getElementById("action-btn");
    const filterBtn = document.getElementById("filter-btn");
    const filterDropdown = document.getElementById("filter-dropdown");
    const subfilterDropdown = document.getElementById("subfilter-dropdown");
    const activeFilters = document.getElementById("active-filters");
    const tableBody = document.querySelector("#user-table tbody");
    const searchInput = document.getElementById("search-input");

    const options = {
        hauptrolle: ["Extern", "Agent", "Teamleiter", "Steuerung", "Controlling", "Personalmangager", "Produktmanager", "IT", "Leitung Produktion", "Leitung V&V", "Leitung Akademie"],
        nebenrolle: ["TMA", "ISB", "DSB", "KIH", "SD-Sperre"],
        status: ["Aktiv", "In Bearbeitung", "Überberechtigt", "Inaktiv", "Error"]
    };

    let activeFilterValues = {};

    // --------------------------
    // Tabelle rendern
    // --------------------------
    function renderTable() {
        tableBody.innerHTML = users.map(u => {
            const nebenrollenCount = u.nebenrollen.length;
            return `
            <tr data-id="${u.id}">
                <td>${u.racf}</td>
                <td>${u.vorname}</td>
                <td>${u.nachname}</td>
                <td><a href="mailto:${u.email}">${u.email}</a></td>
                <td>${renderHauptrolle(u.hauptrolle)}</td>
                ${renderNebenRollenCount(u.nebenrollen)}
                <td>${renderStatusBadge(u.status)}</td>
            </tr>`;
        }).join("");

        document.querySelectorAll("#user-table tbody tr").forEach(tr => {
            tr.addEventListener("click", async () => {
                const userId = tr.dataset.id;
                const resp = await fetch(`/api/users/${userId}/details`);
                const user = await resp.json();
                
                // Overlay befüllen
                document.getElementById("sidebar-username").textContent = `${user.first_name} ${user.last_name}`;
                document.getElementById("user-anrede").textContent = user.anrede || "-";
                document.getElementById("user-vorname").textContent = user.first_name;
                document.getElementById("user-nachname").textContent = user.last_name;
                document.getElementById("user-geburtstag").textContent = user.geburtsdatum || "-";
                document.getElementById("user-adresse").textContent = user.address || "-";
                document.getElementById("user-telefon").textContent = user.telephone || "-";

                const accountList = document.querySelector(".account-list");
                accountList.innerHTML = user.accounts.map(acc => `
                    <li title="${acc.system}"><span class="account-name">${acc.name}</span> <button class="account-cta">🔁</button></li>
                `).join("");

                overlay.classList.add("active");
            });
        });

        // --------------------------
        // Sidebar Tabs Logik
        // --------------------------
        document.querySelectorAll(".sidebar-tabs .tab").forEach(tabBtn => {
            tabBtn.addEventListener("click", () => {
                // Tabs aktivieren
                document.querySelectorAll(".sidebar-tabs .tab").forEach(b => b.classList.remove("active"));
                tabBtn.classList.add("active");

                // Inhalte umschalten
                const tab = tabBtn.dataset.tab;
                document.querySelectorAll(".tab-content").forEach(tc => tc.classList.add("hidden"));
                document.getElementById("tab-" + tab).classList.remove("hidden");
            });
        });
    }

    function renderStatusBadge(status) {
        const map = {
            "Aktiv": "status-green",
            "In Bearbeitung": "status-orange",
            "Überberechtigt": "status-blue",
            "Inaktiv": "status-grey",
            "Error": "status-red"
        };
        return `<span class="badge ${map[status] || "status-grey"}">${status}</span>`;
    }

    function renderHauptrolle(mr) {
        const map = mr == 'Extern' ? "red" : "blue";
        return `<span class="badge status-${map}">${mr}</span>`;
    }

    function renderNebenRollenCount(nr) {
        return `<td title="${nr}" class="label-ttip">${nr.length}</td>`;
    }

    // --------------------------
    // Filter Dropdowns
    // --------------------------
    filterBtn.addEventListener("click", () => {
        filterDropdown.classList.toggle("active");
        subfilterDropdown.classList.remove("active");
    });

    filterDropdown.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
            showSubfilter(e.target.dataset.filter);
        }
    });

    function showSubfilter(type) {
        subfilterDropdown.innerHTML = options[type].map(opt => `
            <label>
                <input type="checkbox" value="${opt}" data-type="${type}" ${activeFilterValues[type]?.includes(opt) ? "checked" : ""}>
                ${opt}
            </label>
        `).join("");
        subfilterDropdown.style.top = "0";
        subfilterDropdown.classList.add("active");
    }

    subfilterDropdown.addEventListener("change", (e) => {
        const type = e.target.dataset.type;
        if (!activeFilterValues[type]) activeFilterValues[type] = [];

        if (e.target.checked) {
            activeFilterValues[type].push(e.target.value);
        } else {
            activeFilterValues[type] = activeFilterValues[type].filter(v => v !== e.target.value);
        }
        renderActiveTags();
        renderTable();
    });

    function renderActiveTags() {
        activeFilters.innerHTML = "";
        Object.entries(activeFilterValues).forEach(([key, values]) => {
            values.forEach(v => {
                const tag = document.createElement("div");
                tag.classList.add("filter-tag");
                tag.innerHTML = `${key}: ${v} <span data-type="${key}" data-value="${v}">✕</span>`;
                activeFilters.appendChild(tag);
            });
        });
    }

    activeFilters.addEventListener("click", (e) => {
        if (e.target.tagName === "SPAN") {
            const type = e.target.dataset.type;
            const val = e.target.dataset.value;
            activeFilterValues[type] = activeFilterValues[type].filter(v => v !== val);
            renderActiveTags();
            renderTable();
        }
    });

    searchInput.addEventListener("input", renderTable);

    // Aktion-Button macht aktuell nichts
    actionBtn.addEventListener("click", () => {});

    // Overlay schließen
    overlay.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.remove("active");
    });

    // Init
    renderTable();
});
