document.addEventListener("DOMContentLoaded", () => {
    const tableBody = document.querySelector("#standort-table tbody");
    const searchInput = document.getElementById("search-input");
    const filterBtn = document.getElementById("filter-btn");
    const filterDropdown = document.getElementById("filter-dropdown");
    const subfilterDropdown = document.getElementById("subfilter-dropdown");
    const activeFilters = document.getElementById("active-filters");

    const rooms = [
        { id: "501", etage: "5", raum: "01", bez: "Besprechungsraum", ap: 1, bt: 0, schluessel: 0 },
        { id: "502", etage: "5", raum: "02", bez: "Verwaltung/ Personal", ap: 2, bt: 2, schluessel: 2 },
        { id: "503", etage: "5", raum: "03", bez: "Steuerung/ Controlling", ap: 3, bt: 3, schluessel: 4 },
        { id: "504", etage: "5", raum: "04", bez: "Projektraum", ap: 7, bt: 0, schluessel: 0 },
        { id: "505", etage: "5", raum: "05", bez: "Schulungsraum", ap: 1, bt: 0, schluessel: 0 },
        { id: "506", etage: "5", raum: "06", bez: "Großraumbüro", ap: 40, bt: 0, schluessel: 0 },
        { id: "507", etage: "5", raum: "07", bez: "Akademie", ap: 3, bt: 5, schluessel: 5 },
        { id: "508", etage: "5", raum: "08", bez: "Produktmanagement/ IT", ap: 2, bt: 4, schluessel: 4 },
        { id: "509", etage: "5", raum: "09", bez: "Produktionsleitung", ap: 1, bt: 4, schluessel: 4 },
        { id: "510", etage: "5", raum: "10", bez: "Lounge", ap: 0, bt: 0, schluessel: 0 },
        { id: "511", etage: "5", raum: "11", bez: "Druckerraum", ap: 1, bt: 0, schluessel: 0 },
        { id: "512", etage: "5", raum: "12", bez: "Schließfächer", ap: 0, bt: 0, schluessel: 0 },
        { id: "513", etage: "5", raum: "13", bez: "Raucherraum", ap: 0, bt: 0, schluessel: 0 },
        { id: "518", etage: "5", raum: "18", bez: "Serverraum", ap: 0, bt: 2, schluessel: 2 },
        { id: "", etage: "5", raum: "", bez: "Technikraum", ap: 0, bt: 0, schluessel: 1 }
    ];

    const etagen = [...new Set(rooms.map(r => r.etage))];
    let activeFilterValues = {};

    function renderTable() {
        const search = searchInput.value.toLowerCase();
        const filtered = rooms.filter(r => {
            const matchesSearch = r.raum.toLowerCase().includes(search) || r.bez.toLowerCase().includes(search);
            const matchesEtage =
                !activeFilterValues.etage?.length || activeFilterValues.etage.includes(r.etage);
            return matchesSearch && matchesEtage;
        });

        tableBody.innerHTML = filtered.map(r => `
            <tr data-id="${r.id}">
                <td>${r.id || "-"}</td>
                <td>${r.etage}</td>
                <td>${r.raum || "-"}</td>
                <td>${r.bez}</td>
                <td>${r.ap}</td>
                <td>${r.bt}</td>
                <td>${r.schluessel}</td>
            </tr>
        `).join("");

        document.querySelectorAll("#standort-table tbody tr").forEach(tr => {
            tr.addEventListener("click", () => {
                const roomId = tr.dataset.id;
                if (!roomId) return;
                window.location.href = `/location/${roomId}`;
            });
        });
    }

    filterBtn.addEventListener("click", () => {
        filterDropdown.classList.toggle("active");
        subfilterDropdown.classList.remove("active");
    });

    filterDropdown.addEventListener("click", e => {
        if (e.target.dataset.filter === "etage") {
            subfilterDropdown.innerHTML = etagen.map(e => `
                <label>
                    <input type="checkbox" value="${e}" data-type="etage" ${activeFilterValues.etage?.includes(e) ? "checked" : ""}> Etage ${e}
                </label>
            `).join("");
            subfilterDropdown.classList.add("active");
        }
    });

    subfilterDropdown.addEventListener("change", e => {
        const type = e.target.dataset.type;
        if (!activeFilterValues[type]) activeFilterValues[type] = [];
        if (e.target.checked)
            activeFilterValues[type].push(e.target.value);
        else
            activeFilterValues[type] = activeFilterValues[type].filter(v => v !== e.target.value);
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

    activeFilters.addEventListener("click", e => {
        if (e.target.tagName === "SPAN") {
            const type = e.target.dataset.type;
            const val = e.target.dataset.value;
            activeFilterValues[type] = activeFilterValues[type].filter(v => v !== val);
            renderActiveTags();
            renderTable();
        }
    });

    searchInput.addEventListener("input", renderTable);

    renderTable();
});
