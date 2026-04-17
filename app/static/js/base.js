document.addEventListener("DOMContentLoaded", () => {
    const adminBtn = document.getElementById("admin-button");
    const navAdmin = document.getElementById("nav-admin");
    const adminMenu = document.getElementById("admin-subnav");

    const profileBtn = document.getElementById("profile-button");
    const navProfile = document.getElementById("nav-profile");
    const profileMenu = document.getElementById("profile-subnav");
    const themeToggleButton = document.getElementById("theme-toggle-button");
    const themeToggleIcon = document.getElementById("theme-toggle-icon");
    const themeIcons = [
        { key: "sun", src: "/static/img/sun-icon-white.png", label: "Sonnenmodus-Symbol" },
        { key: "moon", src: "/static/img/moon-icon-white.png", label: "Mondmodus-Symbol" },
        { key: "duck", src: "/static/img/duck-icon-white.png", label: "Entenmodus-Symbol" }
    ];


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

    function normalizePath(path) {
        if (!path || path === "/") return "/";
        return path.endsWith("/") ? path.slice(0, -1) : path;
    }

    function pathMatches(path, basePath) {
        const normalizedPath = normalizePath(path);
        const normalizedBasePath = normalizePath(basePath);

        if (normalizedBasePath === "/") return normalizedPath === "/";
        return normalizedPath === normalizedBasePath || normalizedPath.startsWith(`${normalizedBasePath}/`);
    }

    function clearActiveNavigation() {
        document
            .querySelectorAll(".nav-link.is-active, .subnav-item.is-active, .nav-item.is-active, .profile-dropdown.is-active")
            .forEach(element => element.classList.remove("is-active"));
    }

    function markActiveNavigation() {
        const currentPath = normalizePath(window.location.pathname);
        clearActiveNavigation();

        const directTargets = [
            { selector: '[data-nav-target="dashboard"]', match: pathMatches(currentPath, "/") },
            { selector: '[data-nav-target="tasks"]', match: pathMatches(currentPath, "/tasks") },
            { selector: '[data-nav-target="tools"]', match: pathMatches(currentPath, "/tools") },
            { selector: '[data-nav-target="login"]', match: pathMatches(currentPath, "/login") }
        ];

        directTargets.forEach(({ selector, match }) => {
            if (!match) return;
            const element = document.querySelector(selector);
            if (element) element.classList.add("is-active");
        });

        const adminTargets = [
            { selector: '[data-nav-target="users"]', path: "/users" },
            { selector: '[data-nav-target="systems"]', path: "/systems" },
            { selector: '[data-nav-target="roles"]', path: "/roles" },
            { selector: '[data-nav-target="iks"]', path: "/iks" }
        ];

        const activeAdminItem = adminTargets.find(({ path }) => pathMatches(currentPath, path));
        if (activeAdminItem) {
            const adminItem = document.querySelector(activeAdminItem.selector);
            if (adminItem) adminItem.classList.add("is-active");
            if (navAdmin) navAdmin.classList.add("is-active");
        }

        if (pathMatches(currentPath, "/account")) {
            const accountItem = document.querySelector('[data-nav-target="account"]');
            if (accountItem) accountItem.classList.add("is-active");
            if (navProfile) navProfile.classList.add("is-active");
        }
    }

    function updateThemeIcon(nextIconKey) {
        if (!themeToggleIcon) return;

        const nextIcon = themeIcons.find(icon => icon.key === nextIconKey) || themeIcons[0];
        themeToggleIcon.src = nextIcon.src;
        if (themeToggleButton) {
            themeToggleButton.setAttribute("data-theme-icon", nextIcon.key);
            themeToggleButton.setAttribute("aria-label", `${nextIcon.label} aktivieren`);
            themeToggleButton.setAttribute("title", `${nextIcon.label} aktivieren`);
        }

        try {
            window.localStorage.setItem("sofaThemeToggleIcon", nextIcon.key);
        } catch (error) {
            console.debug("Theme icon state could not be persisted.", error);
        }
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

    if (themeToggleButton && themeToggleIcon) {
        let initialThemeIcon = themeIcons[0].key;

        try {
            initialThemeIcon = window.localStorage.getItem("sofaThemeToggleIcon") || initialThemeIcon;
        } catch (error) {
            console.debug("Theme icon state could not be restored.", error);
        }

        updateThemeIcon(initialThemeIcon);

        themeToggleButton.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const currentIcon = themeToggleButton.getAttribute("data-theme-icon") || themeIcons[0].key;
            const currentIndex = themeIcons.findIndex(icon => icon.key === currentIcon);
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % themeIcons.length : 0;
            updateThemeIcon(themeIcons[nextIndex].key);
        });
    }

    markActiveNavigation();

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
