document.addEventListener("DOMContentLoaded", () => {

    document.querySelectorAll(".resource-item").forEach(item => {

        const tooltip = document.createElement("div");
        tooltip.classList.add("tooltip-box");

        const roles = item.dataset.roles ? item.dataset.roles.split(",") : [];
        const users = item.dataset.users ? item.dataset.users.split(",") : [];

        tooltip.innerHTML = `
            <h4>Rollen (${roles.length})</h4>
            <ul>${roles.map(r => `<li>${r}</li>`).join("")}</ul>
            <h4>Benutzer (${users.length})</h4>
            <ul>${users.map(u => `<li>${u}</li>`).join("")}</ul>
        `;

        item.appendChild(tooltip);

        item.addEventListener("mouseenter", () => {
            tooltip.style.display = "block";
        });

        item.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
        });
    });

        document.querySelectorAll(".resource-item").forEach(item => {

        const tooltip = document.createElement("div");
        tooltip.classList.add("tooltip-box");

        const roles = item.dataset.roles ? item.dataset.roles.split(",") : [];
        const users = item.dataset.users ? item.dataset.users.split(",") : [];

        tooltip.innerHTML = `
            <h4>Rollen (${roles.length})</h4>
            <ul>${roles.map(r => `<li>${r}</li>`).join("")}</ul>
            <h4>Benutzer (${users.length})</h4>
            <ul>${users.map(u => `<li>${u}</li>`).join("")}</ul>
        `;

        item.appendChild(tooltip);

        item.addEventListener("mouseenter", () => {
            tooltip.style.display = "block";
        });

        item.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
        });
    });



    // ==========================================================
    //  SIDEBAR OVERLAY LOGIK
    // ==========================================================

    const sidebar = document.getElementById("resource-sidebar");
    const overlay = document.getElementById("resource-sidebar-overlay");
    const sidebarTitle = document.getElementById("sidebar-title");
    const sidebarRoles = document.getElementById("sidebar-roles");
    const sidebarUsers = document.getElementById("sidebar-users");
    const closeBtn = document.getElementById("sidebar-close");

    function openSidebar(name, roles, users) {
        sidebarTitle.textContent = name;

        sidebarRoles.innerHTML = roles.map(r => `<li>${r}</li>`).join("");
        sidebarUsers.innerHTML = users.map(u => `<li>${u}</li>`).join("");

        overlay.classList.add("visible");
        sidebar.classList.add("open");
    }

    function closeSidebar() {
        overlay.classList.remove("visible");
        sidebar.classList.remove("open");
    }

    closeBtn.addEventListener("click", closeSidebar);
    overlay.addEventListener("click", closeSidebar);

    // Klick auf Resource-Item öffnet Sidebar
    document.querySelectorAll(".resource-item").forEach(item => {

        item.addEventListener("click", () => {
            const name = item.querySelector(".resource-name").textContent;
            const roles = item.dataset.roles ? item.dataset.roles.split(",") : [];
            const users = item.dataset.users ? item.dataset.users.split(",") : [];

            openSidebar(name, roles, users);
        });

    });


});
