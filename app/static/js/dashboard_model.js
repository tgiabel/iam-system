(function (root, factory) {
    const model = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = model;
    }
    if (root) {
        root.DashboardModel = model;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    // Kennzahlen der Startseite aus den Antworten von Tasks und Servicelevel. Reine Funktionen ohne DOM.
    // Ab dieser Zahl nachgelagerter Tasks wird die Kennzahl hervorgehoben.
    const DEFERRED_HIGH = 25;

    function dateKey(value) {
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ""));
        return match ? match[1] : null;
    }

    function nextDateKey(key) {
        const [year, month, day] = key.split("-").map(Number);
        return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    }

    const list = value => (Array.isArray(value) ? value : []);
    const isDeferred = task => String(task?.provisioning_requirement || "").trim().toUpperCase() === "DEFERRED";

    // Aktiv sind offene, blockierte und laufende Tasks ohne die nachgelagerten (wie die Aufgabenseite).
    // `in_progress_total` (alle laufenden) liefert die SD-API noch nicht; bis dahin zaehlen nur die eigenen.
    function taskStats(overview, todayKey) {
        const tomorrowKey = nextDateKey(todayKey);
        const open = list(overview?.open_tasks);
        const blocked = list(overview?.blocked_tasks);
        const mine = list(overview?.user_tasks);
        const everything = [...open, ...blocked, ...mine];
        const active = everything.filter(task => !isDeferred(task));
        const due = task => dateKey(task.target_date);
        const inProgress = Number.isFinite(overview?.in_progress_total)
            ? overview.in_progress_total
            : mine.filter(task => !isDeferred(task)).length;
        const deferred = everything.length - active.length;
        return {
            open: open.filter(task => !isDeferred(task)).length,
            blocked: blocked.filter(task => !isDeferred(task)).length,
            inProgress,
            active: open.filter(task => !isDeferred(task)).length + blocked.filter(task => !isDeferred(task)).length + inProgress,
            mine: mine.filter(task => !isDeferred(task)).length,
            overdue: active.filter(task => due(task) && due(task) < todayKey).length,
            dueToday: active.filter(task => due(task) === todayKey).length,
            dueTomorrow: active.filter(task => due(task) === tomorrowKey).length,
            deferred,
            deferredHigh: deferred >= DEFERRED_HIGH
        };
    }

    function formatPercent(value) {
        return `${(Math.round(value * 10) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
    }

    // Tendenz zum Vortag; "ok" ab Ziel, "warn" knapp darunter, "bad" ab 10 Punkten darunter.
    function serviceLevel(data) {
        const percent = Number(data?.today?.percent);
        if (!Number.isFinite(percent)) return null;
        const target = Number(data.target_percent) || 80;
        const yesterday = Number(data?.yesterday?.percent);
        const delta = Number.isFinite(yesterday) ? Math.round((percent - yesterday) * 10) / 10 : null;
        return {
            percent,
            text: formatPercent(percent),
            target,
            tone: percent >= target ? "ok" : percent >= target - 10 ? "warn" : "bad",
            delta,
            yesterdayText: Number.isFinite(yesterday) ? formatPercent(yesterday) : "",
            offered: Number(data?.today?.offered) || 0,
            abandoned: Number(data?.today?.abandoned) || 0,
            thresholdSeconds: Number(data.threshold_seconds) || 0
        };
    }

    return { DEFERRED_HIGH, dateKey, nextDateKey, taskStats, serviceLevel, formatPercent };
}));
