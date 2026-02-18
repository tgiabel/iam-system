async function loadRoles() {
    const tableBody = document.querySelector("#rbac-table tbody");
    tableBody.innerHTML = ""; // clear

    try {
        const resp = await fetch("/api/roles");
        const roles = await resp.json();
        console.info(roles);
        roles.forEach(role => {
            const tr = document.createElement("tr");
            tr.dataset.roleId = role.role_id; // versteckte ID

            if (role.role_status == "INACTIVE") tr.classList.add("inactive-row");

            tr.innerHTML = `
                <td>${role.name}</td>
                <td>${typeMap(role.role_type)}</td>
                <td>${role.parent_role_name ? role.parent_role_name : "-"}</td>
                <td><span title="${role.resources.join("\n")}" style="cursor:help;"><strong>${role.resources.length}</strong></span></td>
                <td><span title="${role.assigned_to.join("\n")}" style="cursor:help;"><strong>${role.assigned_to.length}</strong></span></td>
                <td>
                    <button class="btn btn-secondary" onclick="gotoRole(${role.role_id})">
                        Details
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (e) {
        showFlash("Fehler beim Laden der Rollen", "failure")
        console.error("Fehler beim Laden der Rollen", e);
    }
}

function gotoRole(roleId) {
    window.location.href = `/roles/${roleId}`;
}

function typeMap(role_type) {
    switch(role_type) {
        case "PRIMARY": 
            return "Hauptrolle";
        case "SECONDARY":
            return "Nebenrolle";
        case "TEMPLATE":
            return "Template";
        default:
            return role_type;
    }
}


// Page load
document.addEventListener("DOMContentLoaded", loadRoles);
