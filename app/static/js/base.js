document.addEventListener("DOMContentLoaded", () => {
    const adminBtn = document.getElementById("admin-button");
    const navAdmin = document.getElementById("nav-admin");
    const adminMenu = document.getElementById("admin-subnav");

    const profileBtn = document.getElementById("profile-button");
    const navProfile = document.getElementById("nav-profile");
    const profileMenu = document.getElementById("profile-subnav");
    const profileModalTriggers = document.querySelectorAll("[data-profile-modal-trigger]");
    const modalCloseButtons = document.querySelectorAll("[data-modal-close]");
    const modalOverlays = document.querySelectorAll(".ui-modal-overlay[data-base-modal]");
    const passwordChangeModal = document.getElementById("password-change-modal");
    const passwordChangeForm = document.getElementById("password-change-form");
    const passwordChangeSubmit = document.getElementById("password-change-submit");
    const reportProblemModal = document.getElementById("report-problem-modal");
    const reportProblemForm = document.getElementById("report-problem-form");
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

    function updateBodyScrollLock() {
        const hasOpenModal = document.querySelector(".ui-modal-overlay.active");
        document.body.classList.toggle("modal-open", Boolean(hasOpenModal));
    }

    function openModal(overlay) {
        if (!overlay) return;
        closeAll();
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
        updateBodyScrollLock();
    }

    function closeModal(overlay) {
        if (!overlay) return;
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
        if (overlay.id === "password-change-modal") {
            passwordChangeForm?.reset();
        }
        if (overlay.id === "report-problem-modal") {
            reportProblemForm?.reset();
        }
        updateBodyScrollLock();
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
            { selector: '[data-nav-target="console"]', path: "/console" },
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

    profileModalTriggers.forEach(trigger => {
        trigger.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const targetId = trigger.getAttribute("data-profile-modal-trigger");
            if (!targetId) return;
            openModal(document.getElementById(targetId));
        });
    });

    modalCloseButtons.forEach(button => {
        button.addEventListener("click", () => {
            const targetId = button.getAttribute("data-modal-close");
            if (!targetId) return;
            closeModal(document.getElementById(targetId));
        });
    });

    modalOverlays.forEach(overlay => {
        overlay.addEventListener("click", event => {
            if (event.target === overlay) {
                closeModal(overlay);
            }
        });
    });

    passwordChangeForm?.addEventListener("submit", async event => {
        event.preventDefault();

        const currentPassword = document.getElementById("current-password-input")?.value?.trim() || "";
        const newPassword = document.getElementById("new-password-input")?.value?.trim() || "";
        const confirmPassword = document.getElementById("confirm-password-input")?.value?.trim() || "";

        if (!currentPassword || !newPassword || !confirmPassword) {
            showFlash("Bitte alle Passwortfelder ausfüllen.", "failure");
            return;
        }

        if (newPassword !== confirmPassword) {
            showFlash("Die neuen Passwörter stimmen nicht überein.", "failure");
            return;
        }

        if (currentPassword === newPassword) {
            showFlash("Das neue Passwort muss sich vom aktuellen unterscheiden.", "failure");
            return;
        }

        if (passwordChangeSubmit) {
            passwordChangeSubmit.disabled = true;
            passwordChangeSubmit.textContent = "Speichert...";
        }

        try {
            const response = await fetch("/api/account/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                showFlash(data.detail || data.error || "Passwort konnte nicht geändert werden.", "failure");
                return;
            }
            closeModal(passwordChangeModal);
            showFlash("Passwort erfolgreich geändert.", "success");
        } catch (error) {
            console.error(error);
            showFlash("Netzwerkfehler beim Ändern des Passworts.", "failure");
        } finally {
            if (passwordChangeSubmit) {
                passwordChangeSubmit.disabled = false;
                passwordChangeSubmit.textContent = "Passwort speichern";
            }
        }
    });

    reportProblemForm?.addEventListener("submit", event => {
        event.preventDefault();

        const subject = document.getElementById("problem-subject-input")?.value?.trim() || "";
        const description = document.getElementById("problem-description-input")?.value?.trim() || "";

        if (!subject || !description) {
            showFlash("Bitte Betreff und Beschreibung ausfüllen.", "failure");
            return;
        }
        closeModal(reportProblemModal);
        showFlash("Problemhinweis vorgemerkt. Versand folgt in einem späteren Schritt.", "success");
    });

    markActiveNavigation();

    // click outside closes menus
    window.addEventListener("click", () => {
        closeAll();
    });

    // Escape closes menus
    window.addEventListener("keydown", (ev) => {
        if (ev.key !== "Escape") return;

        const openModalOverlay = document.querySelector(".ui-modal-overlay.active");
        if (openModalOverlay) {
            closeModal(openModalOverlay);
            return;
        }

        closeAll();
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
