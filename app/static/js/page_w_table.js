document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("sidebar-overlay");
    const actionBtn = document.getElementById("action-btn");
    const filterBtn = document.getElementById("filter-btn");
    const filterDropdown = document.getElementById("filter-dropdown");
    const subfilterDropdown = document.getElementById("subfilter-dropdown");
    const activeFilters = document.getElementById("active-filters");
    const tableBody = document.querySelector("#user-table tbody");
    const searchInput = document.getElementById("search-input");

    // Dummy user data
    const users = [
        { 
            id: 1,
            racf: "Y123456", vorname: "Max", nachname: "Mustermann", email: "max.mustermann@servodata.de", 
            hauptrolle: "Agent", nebenrollen: ["TMA", "ISB"], status: "Aktiv",
            adresse: "Musterstraße 1, 12345 Musterstadt", telefon: "+49 123 456789", geburtstag: "1990-01-01"
        },
        { id: 2, racf: "Y2234567", vorname: "Martha", nachname: "Mustermann", email: "martha.mustermann@servodata.de", hauptrolle: "Agent", nebenrollen: ["DSB"], status: "In Bearbeitung" },
        { id: 3, racf: "Y3234567", vorname: "John", nachname: "Doe", email: "john.doe@servodata.de", hauptrolle: "Teamleiter", nebenrollen: ["KIH", "SD-Sperre"], status: "Überberechtigt" },
        { id: 4, racf: "Y4234567", vorname: "Lisa", nachname: "Meyer", email: "lisa.meyer@servodata.de", hauptrolle: "Agent", nebenrollen: [], status: "Inaktiv" },
        { id: 5, racf: "Y5234567", vorname: "Peter", nachname: "Schmidt", email: "peter.schmidt@servodata.de", hauptrolle: "Extern", nebenrollen: ["TMA"], status: "Error" }
    ];


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
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = users.filter(u => {
            const matchesSearch =
                u.racf.toLowerCase().includes(searchTerm) ||
                u.vorname.toLowerCase().includes(searchTerm) ||
                u.nachname.toLowerCase().includes(searchTerm) ||
                u.email.toLowerCase().includes(searchTerm);

            const matchesFilters = Object.entries(activeFilterValues).every(([key, values]) => {
                if (values.length === 0) return true;
                if (key === "nebenrolle") {
                    return u.nebenrollen.some(r => values.includes(r));
                }
                return values.includes(u[key]);
            });

            return matchesSearch && matchesFilters;
        });

        tableBody.innerHTML = filtered.map(u => {
            const nebenrollenCount = u.nebenrollen.length;
            const nebenrollenTooltip = nebenrollenCount > 0 ? u.nebenrollen.join(", ") : "";
            return `
            <tr data-racf="${u.racf}" data-id="${u.id}">
                <td>${u.racf}</td>
                <td>${u.vorname}</td>
                <td>${u.nachname}</td>
                <td><a href="mailto:${u.email}">${u.email}</a></td>
                <td><span class="badge status-blue">${u.hauptrolle}</span></td>
                <td title="${nebenrollenTooltip}" class="label-ttip">${nebenrollenCount}</td>
                <td>${renderStatusBadge(u.status)}</td>
            </tr>
            `;
        }).join("");

        // Klick auf Zeile → Overlay öffnen + Daten laden
        document.querySelectorAll("#user-table tbody tr").forEach(tr => {
            tr.addEventListener("click", () => {
                const userId = parseInt(tr.dataset.id); // ID aus data-Attribut
                const user = users.find(u => u.id === userId);
                if (!user) return;
                
                document.getElementById("sidebar-username").textContent = `${user.vorname} ${user.nachname}`;

                // Overlay öffnen
                overlay.classList.add("active");

                // Daten in Details Tab einfügen
                document.getElementById("user-racf").textContent = user.racf;
                document.getElementById("user-name").textContent = `${user.vorname} ${user.nachname}`;
                document.getElementById("user-email").textContent = user.email;
                document.getElementById("user-adresse").textContent = user.adresse || "-";
                document.getElementById("user-telefon").textContent = user.telefon || "-";
                document.getElementById("user-geburtstag").textContent = user.geburtstag || "-";
            });
        });

        // Tabs Logik
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
