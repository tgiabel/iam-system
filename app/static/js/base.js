document.addEventListener("DOMContentLoaded", () => {
    const AUTHZ_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const root = document.documentElement;
    const adminBtn = document.getElementById("admin-button");
    const navAdmin = document.getElementById("nav-admin");
    const adminMenu = document.getElementById("admin-subnav");

    const profileBtn = document.getElementById("profile-button");
    const navProfile = document.getElementById("nav-profile");
    const profileMenu = document.getElementById("profile-subnav");
    const mobileNavToggle = document.getElementById("mobile-nav-toggle");
    const mobileNavPanel = document.getElementById("mobile-nav-panel");
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
    const themes = [
        { key: "light", icon: "/static/img/sun-icon-white.png", label: "Light Theme" },
        { key: "dark", icon: "/static/img/moon-icon-white.png", label: "Dark Theme" },
        { key: "servodata", icon: "/static/img/duck-icon-white.png", label: "Servodata-Theme" }
    ];
    const validThemeKeys = themes.map(theme => theme.key);
    let authzRefreshTimer = null;
    let authzRefreshInFlight = false;

    try {
        const flashMessage = window.sessionStorage.getItem("flash_msg");
        const flashType = window.sessionStorage.getItem("flash_type");
        if (flashMessage) {
            showFlash(flashMessage, flashType || "success");
            window.sessionStorage.removeItem("flash_msg");
            window.sessionStorage.removeItem("flash_type");
        }
    } catch (error) {
        console.debug("Session flash state could not be restored.", error);
    }

    function closeDropdowns() {
        [navAdmin, navProfile].forEach(parent => {
            if (!parent) return;
            parent.classList.remove("open");
            const btn = parent.querySelector("button[aria-expanded]");
            if (btn) btn.setAttribute("aria-expanded", "false");
            const menu = parent.querySelector(".subnav");
            if (menu) menu.setAttribute("aria-hidden", "true");
        });
    }

    function closeAll() {
        closeDropdowns();
        closeMobileNav();
    }

    function openMobileNav() {
        if (!mobileNavToggle || !mobileNavPanel) return;
        document.body.classList.add("mobile-nav-open");
        mobileNavToggle.setAttribute("aria-expanded", "true");
        mobileNavPanel.setAttribute("aria-hidden", "false");
    }

    function closeMobileNav() {
        if (!mobileNavToggle || !mobileNavPanel) return;
        document.body.classList.remove("mobile-nav-open");
        mobileNavToggle.setAttribute("aria-expanded", "false");
        mobileNavPanel.setAttribute("aria-hidden", "true");
    }

    function toggleMobileNav() {
        if (!mobileNavToggle || !mobileNavPanel) return;
        if (document.body.classList.contains("mobile-nav-open")) {
            closeMobileNav();
            return;
        }

        [navAdmin, navProfile].forEach(parent => {
            if (!parent) return;
            parent.classList.remove("open");
            const btn = parent.querySelector("button[aria-expanded]");
            if (btn) btn.setAttribute("aria-expanded", "false");
            const menu = parent.querySelector(".subnav");
            if (menu) menu.setAttribute("aria-hidden", "true");
        });

        openMobileNav();
    }

    function updateBodyScrollLock() {
        const hasOpenModal = document.querySelector(".ui-modal-overlay.active");
        document.body.classList.toggle(
            "modal-open",
            Boolean(hasOpenModal) || document.body.classList.contains("mobile-nav-open")
        );
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
            .querySelectorAll(".nav-link.is-active, .subnav-item.is-active, .nav-item.is-active, .profile-dropdown.is-active, .mobile-nav-link.is-active")
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
            document.querySelectorAll(selector).forEach(element => element.classList.add("is-active"));
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
            document.querySelectorAll(activeAdminItem.selector).forEach(adminItem => adminItem.classList.add("is-active"));
            if (navAdmin) navAdmin.classList.add("is-active");
        }

        if (pathMatches(currentPath, "/account")) {
            const accountItem = document.querySelector('[data-nav-target="account"]');
            if (accountItem) accountItem.classList.add("is-active");
            if (navProfile) navProfile.classList.add("is-active");
        }
    }

    function getStoredTheme() {
        try {
            const storedTheme = window.localStorage.getItem("sofaTheme");
            return validThemeKeys.includes(storedTheme) ? storedTheme : "light";
        } catch (error) {
            console.debug("Theme state could not be restored.", error);
            return "light";
        }
    }

    function getThemeByKey(themeKey) {
        return themes.find(theme => theme.key === themeKey) || themes[0];
    }

    function updateThemeButton(themeKey) {
        if (!themeToggleButton || !themeToggleIcon) return;

        const activeTheme = getThemeByKey(themeKey);
        themeToggleIcon.src = activeTheme.icon;
        themeToggleButton.setAttribute("data-theme", activeTheme.key);
        themeToggleButton.setAttribute("aria-label", `Aktives Theme: ${activeTheme.label}`);
        themeToggleButton.setAttribute("title", `Aktives Theme: ${activeTheme.label}`);
    }

    function applyTheme(themeKey) {
        const activeTheme = getThemeByKey(themeKey);
        root.setAttribute("data-theme", activeTheme.key);
        updateThemeButton(activeTheme.key);

        try {
            window.localStorage.setItem("sofaTheme", activeTheme.key);
        } catch (error) {
            console.debug("Theme state could not be persisted.", error);
        }
    }

    function getCurrentAuthz() {
        return window.currentAuthz || { pages: [], has_admin_access: false };
    }

    function hasPageAccess(pageKey) {
        const pages = getCurrentAuthz().pages;
        return Array.isArray(pages) && pages.includes(pageKey);
    }

    function parseRequirementList(rawValue) {
        return String(rawValue || "")
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);
    }

    function setAuthzElementState(element, isAllowed) {
        const mode = element.dataset.authzMode || (
            element.matches("button, input, select, textarea, a") ? "disable" : "hide"
        );

        if (mode === "hide") {
            element.hidden = !isAllowed;
            return;
        }

        const shouldDisable = !isAllowed;
        if ("disabled" in element) {
            element.disabled = shouldDisable;
        }
        element.classList.toggle("is-disabled", shouldDisable);
        element.setAttribute("aria-disabled", shouldDisable ? "true" : "false");
    }

    function applyAuthzDomState() {
        document.querySelectorAll("[data-requires-page]").forEach(element => {
            const requiredPages = parseRequirementList(element.dataset.requiresPage);
            const pageAllowed = !requiredPages.length || requiredPages.some(hasPageAccess);
            setAuthzElementState(element, pageAllowed);
        });
    }

    function getRequiredPageForPath(pathname) {
        const currentPath = normalizePath(pathname);
        const pageTargets = [
            { page: "tasks", path: "/tasks" },
            { page: "tools", path: "/tools" },
            { page: "console", path: "/console" },
            { page: "users", path: "/users" },
            { page: "systems", path: "/systems" },
            { page: "roles", path: "/roles" },
            { page: "iks", path: "/iks" }
        ];
        return pageTargets.find(target => pathMatches(currentPath, target.path))?.page || null;
    }

    function queueRedirectFlash(message, category = "failure") {
        try {
            window.sessionStorage.setItem("flash_msg", message);
            window.sessionStorage.setItem("flash_type", category);
        } catch (error) {
            console.debug("Redirect flash state could not be persisted.", error);
        }
    }

    function handleAuthzLossAfterRefresh() {
        const requiredPage = getRequiredPageForPath(window.location.pathname);
        if (!requiredPage || hasPageAccess(requiredPage)) {
            return false;
        }

        queueRedirectFlash("Deine Berechtigungen wurden aktualisiert. Diese Seite ist nicht mehr verfuegbar.");
        window.location.href = "/";
        return true;
    }

    async function refreshSessionAuthz() {
        if (authzRefreshInFlight || !window.currentAuthz) {
            return;
        }

        authzRefreshInFlight = true;

        try {
            const response = await fetch("/api/session/authz", {
                headers: { Accept: "application/json" }
            });
            const data = await response.json().catch(() => ({}));

            if (response.status === 401) {
                queueRedirectFlash("Deine Session ist abgelaufen. Bitte melde dich erneut an.");
                window.location.href = "/login";
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || data.error || "Berechtigungen konnten nicht aktualisiert werden.");
            }

            if (data && typeof data === "object") {
                if (data.authz) {
                    window.currentAuthz = data.authz;
                }
                if (data.user) {
                    window.currentUser = data.user;
                }
            }

            applyAuthzDomState();
            window.dispatchEvent(new CustomEvent("sofa:authz-updated", { detail: data || {} }));
            handleAuthzLossAfterRefresh();
        } catch (error) {
            console.error("Berechtigungs-Refresh fehlgeschlagen", error);
        } finally {
            authzRefreshInFlight = false;
        }
    }

    function startAuthzRefresh() {
        if (!window.currentAuthz || authzRefreshTimer) {
            return;
        }

        authzRefreshTimer = window.setInterval(refreshSessionAuthz, AUTHZ_REFRESH_INTERVAL_MS);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                refreshSessionAuthz();
            }
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

    if (themeToggleButton && themeToggleIcon) {
        applyTheme(getStoredTheme());

        themeToggleButton.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const currentTheme = themeToggleButton.getAttribute("data-theme") || getStoredTheme();
            const currentIndex = themes.findIndex(theme => theme.key === currentTheme);
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % themes.length : 0;
            applyTheme(themes[nextIndex].key);
        });
    } else {
        applyTheme(getStoredTheme());
    }

    mobileNavToggle?.addEventListener("click", ev => {
        ev.stopPropagation();
        toggleMobileNav();
        updateBodyScrollLock();
    });

    mobileNavPanel?.addEventListener("click", event => {
        const link = event.target.closest("a");
        if (!link) return;
        closeMobileNav();
        updateBodyScrollLock();
    });

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
    applyAuthzDomState();
    startAuthzRefresh();

    // click outside closes menus
    window.addEventListener("click", event => {
        closeDropdowns();

        if (mobileNavPanel && mobileNavToggle) {
            const clickedInsideMobileNav = mobileNavPanel.contains(event.target) || mobileNavToggle.contains(event.target);
            if (!clickedInsideMobileNav) {
                closeMobileNav();
            }
        }
        updateBodyScrollLock();
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
        updateBodyScrollLock();
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 1080) {
            closeMobileNav();
            updateBodyScrollLock();
        }
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
