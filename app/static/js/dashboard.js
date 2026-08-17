if (!window.dashboardInitialized) {
    document.addEventListener("DOMContentLoaded", () => {
        initDashboard();
    });
    window.dashboardInitialized = true;
}

function initDashboard() {
    const privateSection = document.querySelector("[data-dashboard-private]");
    if (!privateSection) {
        return;
    }

    loadDashboardMetrics();
    loadActiveIncidentsBanner();
}

function setDashboardText(id, value) {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }
    element.textContent = value;
}

async function loadActiveIncidentsBanner() {
    const banner = document.getElementById("dashboard-stoerung-banner");
    const countEl = document.getElementById("dashboard-stoerung-count");
    if (!banner) return;

    try {
        const response = await fetch("/api/stoerung/incidents/active");
        if (!response.ok) return;
        const data = await response.json().catch(() => []);
        const incidents = Array.isArray(data) ? data : [];
        if (incidents.length === 0) return;

        if (countEl) {
            countEl.textContent = incidents.length === 1
                ? "(1 aktive Störung)"
                : `(${incidents.length} aktive Störungen)`;
        }
        banner.hidden = false;
        banner.style.display = "flex";
    } catch (_) {
        // silent – banner stays hidden
    }
}

async function loadDashboardMetrics() {
    try {
        const response = await fetch("/api/tasks/overview");
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || data.error || "Dashboard-Kennzahlen konnten nicht geladen werden.");
        }

        const openTasks = Array.isArray(data.open_tasks) ? data.open_tasks : [];
        const blockedTasks = Array.isArray(data.blocked_tasks) ? data.blocked_tasks : [];
        const myTasks = Array.isArray(data.user_tasks) ? data.user_tasks : [];

        setDashboardText("dashboard-open-count", String(openTasks.length + blockedTasks.length));
        setDashboardText("dashboard-my-count", String(myTasks.length));
    } catch (error) {
        console.error(error);
        setDashboardText("dashboard-open-count", "0");
        setDashboardText("dashboard-my-count", "0");
        showFlash("Dashboard-Kennzahlen konnten nicht geladen werden.", "failure");
    }
}
