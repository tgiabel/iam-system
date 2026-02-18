async function loadSystems() {
    const tableBody = document.querySelector("#system-table tbody");
    tableBody.innerHTML = ""; // clear

    try {
        const resp = await fetch("/api/systems");
        const systems = await resp.json();

        systems.forEach(system => {
            const tr = document.createElement("tr");
            tr.dataset.systemId = system.system_id; // versteckte ID

            tr.innerHTML = `
                <td>${system.short_name}</td>
                <td>${system.name}</td>
                <td>bald typ..</td>
                <td><span title="${system.resource_names.join("\n")}" style="cursor:help;"><strong>${system.resource_names.length}</strong></span></td>
                <td>
                    <button class="btn btn-secondary" onclick="gotoSystem(${system.system_id})">
                        Details
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) {
        showFlash("Fehler beim Laden der Systeme", "failure")
        console.error("Fehler beim Laden der Systeme", e);
    }
}

function gotoSystem(systemId) {
    window.location.href = `/systems/${systemId}`;
}


// Page load
document.addEventListener("DOMContentLoaded", loadSystems);
