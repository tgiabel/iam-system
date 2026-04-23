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
}

function setDashboardText(id, value) {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }
    element.textContent = value;
}

function formatDashboardDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getLatestCompletedTask(tasks) {
    return [...tasks].sort((left, right) => {
        const leftTime = new Date(left?.completed_at || left?.updated_at || left?.created_at || 0).getTime();
        const rightTime = new Date(right?.completed_at || right?.updated_at || right?.created_at || 0).getTime();
        return rightTime - leftTime;
    })[0];
}

function getCurrentMonthCompletedTasks(tasks) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return tasks.filter(task => {
        const value = task?.completed_at || task?.updated_at || task?.created_at;
        const date = new Date(value || 0);
        if (Number.isNaN(date.getTime())) {
            return false;
        }
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    });
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
        const completedTasks = Array.isArray(data.completed_tasks) ? data.completed_tasks : [];
        const monthlyCompletedTasks = getCurrentMonthCompletedTasks(completedTasks);
        const latestCompleted = getLatestCompletedTask(completedTasks);

        setDashboardText("dashboard-open-count", String(openTasks.length + blockedTasks.length));
        setDashboardText("dashboard-my-count", String(myTasks.length));
        setDashboardText("dashboard-completed-count", String(monthlyCompletedTasks.length));

        setDashboardText(
            "dashboard-last-completed",
            latestCompleted
                ? `Letzte Erledigung: ${latestCompleted.resource_name || latestCompleted.task_type || "Task"} am ${formatDashboardDate(latestCompleted.completed_at || latestCompleted.updated_at || latestCompleted.created_at)}`
                : "Noch keine erledigten Aufgaben vorhanden."
        );

        const notificationOpen = document.getElementById("dashboard-notification-open");
        if (notificationOpen) {
            notificationOpen.innerHTML = `
                <strong>Aktuelles</strong>
                <span>;USTER</span>
            `;
        }
    } catch (error) {
        console.error(error);
        setDashboardText("dashboard-open-count", "0");
        setDashboardText("dashboard-my-count", "0");
        setDashboardText("dashboard-completed-count", "0");
        setDashboardText("dashboard-last-completed", "Kennzahlen konnten gerade nicht geladen werden.");
        showFlash("Dashboard-Kennzahlen konnten nicht geladen werden.", "failure");
    }
}
