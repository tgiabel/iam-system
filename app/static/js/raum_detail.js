document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("sidebar-overlay");
    const sidebarHeader = document.getElementById("sidebar-header");
    const sidebarContent = document.getElementById("sidebar-content");
    const tableHead = document.getElementById("table-head");
    const tableBody = document.querySelector("#raum-table tbody");
    const actionBtn = document.getElementById("action-btn");

    // Beispielhafte Datensätze
    const btList = [
        { id: "506/BT01", raum: "506", nr: "01", panel: "5-2", start: 17, ende: 20, patches: 4, belegt: 1 },
        { id: "506/BT02", raum: "506", nr: "02", panel: "5-2", start: 21, ende: 24, patches: 4, belegt: 1 },
        { id: "506/BT03", raum: "506", nr: "03", panel: "5-3", start: 1, ende: 4, patches: 4, belegt: 1 },
        { id: "506/BT04", raum: "506", nr: "04", panel: "5-2", start: 5, ende: 8, patches: 4, belegt: 1 }
    ];

    const apList = [
        { id: "506/AP01", raum: "506", bt: "506/BT01", apPatch: 19, nfPatch: "", apNr: "01", rechner: "FW0BIBYM" },
        { id: "506/AP02", raum: "506", bt: "506/BT02", apPatch: 21, nfPatch: "", apNr: "02", rechner: "FW0CPM6S" },
        { id: "506/AP03", raum: "506", bt: "506/BT03", apPatch: 3, nfPatch: "", apNr: "03", rechner: "FW0CPM5R" },
        { id: "506/AP04", raum: "506", bt: "", apPatch: "", nfPatch: "", apNr: "04", rechner: "FW0ECWMI" },
        { id: "506/AP05", raum: "506", bt: "", apPatch: "", nfPatch: "", apNr: "05", rechner: "FWOB2FV7" }
    ];

    let mode = "BT"; // oder "AP"

    function renderTable() {
        if (mode === "BT") {
            tableHead.innerHTML = `
                <tr>
                    <th>BT-ID</th><th>Raum-ID</th><th>BT-Nr</th><th>Panel-Kennung</th>
                    <th>Patch-Range-Start</th><th>Patch-Range-Ende</th><th>Anzahl Patches</th><th>Belegte Patches</th>
                </tr>`;
            tableBody.innerHTML = btList.map(b => `
                <tr data-id="${b.id}">
                    <td>${b.id}</td><td>${b.raum}</td><td>${b.nr}</td><td>${b.panel}</td>
                    <td>${b.start}</td><td>${b.ende}</td><td>${b.patches}</td><td>${b.belegt}</td>
                </tr>
            `).join("");
        } else {
            tableHead.innerHTML = `
                <tr>
                    <th>AP-ID</th><th>Raum-ID</th><th>BT-ID</th><th>AP-Patch</th>
                    <th>NF-Patch</th><th>AP-Nr</th><th>Rechner-ID</th>
                </tr>`;
            tableBody.innerHTML = apList.map(a => `
                <tr data-id="${a.id}">
                    <td>${a.id}</td><td>${a.raum}</td><td>${a.bt || "-"}</td>
                    <td>${a.apPatch || "-"}</td><td>${a.nfPatch || "-"}</td>
                    <td>${a.apNr}</td><td>${a.rechner}</td>
                </tr>
            `).join("");
        }

        document.querySelectorAll("#raum-table tbody tr").forEach(tr => {
            tr.addEventListener("click", () => {
                const id = tr.dataset.id;
                openOverlay(id);
            });
        });
    }

    function openOverlay(id) {
        overlay.classList.add("active");
        sidebarHeader.textContent = `Details zu ${id}`;
        sidebarContent.innerHTML = `<p><strong>ID:</strong> ${id}</p><p>Weitere Daten folgen hier...</p>`;
    }

    overlay.addEventListener("click", e => {
        if (e.target === overlay) overlay.classList.remove("active");
    });

    actionBtn.addEventListener("click", () => {
        mode = mode === "BT" ? "AP" : "BT";
        renderTable();
    });

    renderTable();
});
