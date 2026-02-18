document.addEventListener("DOMContentLoaded", () => {
    const adminBtn = document.getElementById("admin-button");
    const navAdmin = document.getElementById("nav-admin");
    const adminMenu = document.getElementById("admin-subnav");

    const profileBtn = document.getElementById("profile-button");
    const navProfile = document.getElementById("nav-profile");
    const profileMenu = document.getElementById("profile-subnav");


    function closeAll() {
        [navAdmin, navProfile].forEach(parent => {
            if (!parent) return;
            parent.classList.remove("open");
            const btn = parent.querySelector("button[aria-expanded]");
            if (btn) btn.setAttribute("aria-expanded", "false");
            const menu = parent.querySelector(".subnav");
            if (menu) menu.setAttribute("aria-hidden", "true");
        });
    }

    // toggle helper
    function toggleDropdown(parent, button, menu) {
        if (!parent || !button || !menu) return;
        const opening = !parent.classList.contains("open");
        closeAll();
        if (opening) {
            parent.classList.add("open");
            button.setAttribute("aria-expanded", "true");
            menu.setAttribute("aria-hidden", "false");
        } else {
            parent.classList.remove("open");
            button.setAttribute("aria-expanded", "false");
            menu.setAttribute("aria-hidden", "true");
        }
    }

    // admin click
    if (adminBtn && navAdmin && adminMenu) {
        adminBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleDropdown(navAdmin, adminBtn, adminMenu);
        });

        // keyboard (Enter / Space)
        adminBtn.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                toggleDropdown(navAdmin, adminBtn, adminMenu);
            }
        });
    }

    // profile click
    if (profileBtn && navProfile && profileMenu) {
        profileBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleDropdown(navProfile, profileBtn, profileMenu);
        });

        profileBtn.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                toggleDropdown(navProfile, profileBtn, profileMenu);
            }
        });
    }

    // click outside closes menus
    window.addEventListener("click", () => {
        closeAll();
    });

    // Escape closes menus
    window.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") closeAll();
    });

    // existing alerts logic
    const alerts = document.querySelectorAll(".flash-messages .alert");
    if (alerts.length) {
      setTimeout(() => {
        alerts.forEach(alert => {
          alert.classList.add("hide");
        });
      }, 2000);
    }
});

function showFlash(message, category="success") {

    let main = document.querySelector("main");

    let container = document.createElement("div");
    container.className = "flash-messages";

    let alert = document.createElement("div");
    alert.className = `alert alert-${category}`;
    alert.textContent = message;
    alert.onclick = () => {
        alert.remove();
    };

    container.appendChild(alert);

    // GANZ OBEN einfügen
    main.prepend(container);

    // Auto remove
    setTimeout(() => {
        container.remove();
    }, 4000);
}