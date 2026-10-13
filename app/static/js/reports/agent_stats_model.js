(function (root, factory) {
    const model = factory();
    if (typeof module === "object" && module.exports) module.exports = model;
    if (root) root.AgentStatsModel = model;
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => (
            {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
    }

    function shiftMonth(anchor, amount) {
        const [year, month] = anchor.slice(0, 7).split("-").map(Number);
        return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 10);
    }

    function formatDuration(seconds, precise = false) {
        if (seconds == null || !Number.isFinite(Number(seconds))) return "–";
        const value = Math.max(0, Math.round(Number(seconds)));
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor(value % 3600 / 60);
        const rest = value % 60;
        if (!precise) return `${hours}:${String(minutes).padStart(2, "0")}`;
        return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
            : `${minutes}:${String(rest).padStart(2, "0")}`;
    }

    function parseSelection(search) {
        const params = new URLSearchParams(search);
        const period = params.get("period") === "month" ? "month" : "day";
        const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get("anchor") || "") ? params.get("anchor") : null;
        return {period, anchor, queue: params.get("queue") || null};
    }

    // All statuses, offline/absence last. `count` comes from the API; in day view adjacent
    // timeline sections with the same label count as one choice.
    function presenceStatuses(statuses, timeline) {
        const chosen = {};
        let previous = null;
        (timeline || []).forEach(segment => {
            if (segment.label !== previous) chosen[segment.label] = (chosen[segment.label] || 0) + 1;
            previous = segment.label;
        });
        const hasTimeline = (timeline || []).length > 0;
        return (statuses || []).map(item => ({...item,
            count: Number.isFinite(item.count) ? item.count : hasTimeline ? chosen[item.label] || 0 : null}))
            .sort((left, right) => (left.group === "HOME") - (right.group === "HOME"));
    }

    // Logged-in time: every status except offline/absence.
    function loggedSeconds(statuses) {
        return (statuses || []).filter(item => item.group !== "HOME")
            .reduce((sum, item) => sum + (Number(item.seconds) || 0), 0);
    }

    // Visible window of the day timeline: active (non-offline) time ± padding, on full hours, inside the day.
    function focusRange(timeline, dayStart, dayEnd, padHours = 2) {
        const HOUR = 3600000;
        const day = {start: Date.parse(dayStart), end: Date.parse(dayEnd)};
        const active = (timeline || []).filter(segment => segment.status !== "HOME");
        if (!active.length) return day;
        const first = Math.min(...active.map(segment => Date.parse(segment.start)));
        const last = Math.max(...active.map(segment => Date.parse(segment.end)));
        return {start: Math.max(day.start, Math.floor((first - padHours * HOUR) / HOUR) * HOUR),
            end: Math.min(day.end, Math.ceil((last + padHours * HOUR) / HOUR) * HOUR)};
    }

    const COUNT_KEYS = ["answered", "not_answered", "transferred"];
    const TIME_KEYS = ["talk", "hold", "acw"];

    function formatPercent(ratio) {
        return ratio == null || !Number.isFinite(ratio) ? "–" : `${Math.round(ratio * 100)}\u00a0%`;
    }

    // Sums for the whole report or one queue. Queue times exist only when the API sends *_seconds sums.
    function scopeTotals(phone, queueId) {
        if (!phone || !phone.available || !phone.summary) return null;
        const source = queueId ? (phone.queues || []).find(queue => queue.queue_id === queueId) : phone.summary;
        const totals = Object.fromEntries(COUNT_KEYS.map(key => [key, Number(source?.[key]) || 0]));
        TIME_KEYS.forEach(key => {
            const sum = source?.[`${key}_seconds`];
            const avg = source?.[`avg_${key}_seconds`];
            totals[key] = Number.isFinite(sum) ? sum
                : !queueId && avg != null ? avg * totals.answered
                    : source && !totals.answered ? 0 : null;
        });
        totals.handle = !queueId && source.avg_handle_seconds != null
            ? source.avg_handle_seconds * totals.answered
            : TIME_KEYS.every(key => totals[key] != null) ? totals.talk + totals.hold + totals.acw : null;
        totals.hasTimes = totals.talk != null;
        return totals;
    }

    function callMetrics(totals) {
        if (!totals) return [];
        const count = value => value.toLocaleString("de-DE");
        const avg = sum => sum == null || !totals.answered ? null : sum / totals.answered;
        const offered = totals.answered + totals.not_answered;
        const contacts = `${count(totals.answered)} angenommene Kontakte`;
        return [
            {key: "avg_talk", label: "Ø Gespräch", kind: "duration", value: avg(totals.talk), primary: true},
            {key: "avg_handle", label: "Ø Bearbeitung", kind: "duration", value: avg(totals.handle), primary: true,
                detail: "Gespräch + Halten + Nachbearbeitung"},
            {key: "avg_hold", label: "Ø Halten", kind: "duration", value: avg(totals.hold)},
            {key: "avg_acw", label: "Ø Nachbearbeitung", kind: "duration", value: avg(totals.acw)},
            {key: "sum_talk", label: "Gesprächszeit gesamt", kind: "duration", extra: true, value: totals.talk, detail: contacts},
            {key: "sum_handle", label: "Bearbeitungszeit gesamt", kind: "duration", extra: true, value: totals.handle, detail: contacts},
            {key: "answer_rate", label: "Annahmequote", kind: "percent", extra: true,
                value: offered ? totals.answered / offered : null,
                detail: `${count(totals.answered)} von ${count(offered)} signalisierten Kontakten`},
            {key: "transfer_rate", label: "Weiterleitungsquote", kind: "percent", extra: true,
                value: totals.answered ? totals.transferred / totals.answered : null,
                detail: `${count(totals.transferred)} von ${count(totals.answered)} angenommenen Kontakten`},
        ];
    }

    function formatMetric(metric) {
        return metric.kind === "percent" ? formatPercent(metric.value) : formatDuration(metric.value, true);
    }

    // Neutral delta against the comparison period: no good/bad judgement, shorter is not always better.
    function trend(metric, previous) {
        if (!previous || metric.value == null || previous.value == null) return null;
        const delta = metric.value - previous.value;
        const percent = metric.kind === "percent";
        const step = percent ? Math.round(delta * 100) : Math.round(delta);
        const direction = step > 0 ? "up" : step < 0 ? "down" : "same";
        const sign = step > 0 ? "+" : step < 0 ? "−" : "±";
        const amount = percent ? `${Math.abs(step)}\u00a0Pp.` : formatDuration(Math.abs(step), true);
        return {direction, text: `${sign}${amount}`, previous: formatMetric(previous)};
    }

    function queueRows(phone) {
        if (!phone || !phone.available) return [];
        return (phone.queues || []).map(queue => ({id: queue.queue_id, name: queue.name,
            ...Object.fromEntries(COUNT_KEYS.map(key => [key, Number(queue[key]) || 0]))}))
            .sort((left, right) => right.answered - left.answered || left.name.localeCompare(right.name, "de"));
    }

    return {escapeHtml, shiftMonth, formatDuration, formatPercent, parseSelection, presenceStatuses,
        loggedSeconds, focusRange, scopeTotals, callMetrics, formatMetric, trend, queueRows};
}));
