// Tokenlöschungs-Report without DOM: URL state, UTC-safe calendar arithmetic and labels.
(function (root, factory) {
    const model = factory();
    if (typeof module === "object" && module.exports) module.exports = model;
    if (root) root.TokenDeletionsReportModel = model;
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    const COUNT = new Intl.NumberFormat("de-DE");
    const DAY = new Intl.DateTimeFormat("de-DE", {weekday: "long", timeZone: "UTC"});
    const SHORT_DATE = new Intl.DateTimeFormat("de-DE", {day: "2-digit", month: "2-digit", timeZone: "UTC"});
    const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"];

    function parts(value) {
        if (!DATE.test(value || "")) return null;
        const [year, month, day] = value.split("-").map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1
                || parsed.getUTCDate() !== day) return null;
        return {year, month, day, parsed};
    }

    function isoDate(value) {
        return value.toISOString().slice(0, 10);
    }

    function addDays(value, amount) {
        const parsed = parts(value);
        if (!parsed) return null;
        parsed.parsed.setUTCDate(parsed.parsed.getUTCDate() + amount);
        return isoDate(parsed.parsed);
    }

    function mondayFor(value) {
        const parsed = parts(value);
        if (!parsed) return null;
        const weekday = parsed.parsed.getUTCDay();
        return addDays(value, -(weekday === 0 ? 6 : weekday - 1));
    }

    function readUrl(search) {
        const params = new URLSearchParams(search || "");
        const rawYear = params.get("year");
        const year = /^\d{4}$/.test(rawYear || "") && Number(rawYear) >= 2000 ? Number(rawYear) : null;
        const rawWeek = params.get("week_start");
        const weekStart = parts(rawWeek) && mondayFor(rawWeek) === rawWeek ? rawWeek : null;
        return {year, weekStart};
    }

    function writeUrl(year, weekStart, today) {
        const params = new URLSearchParams();
        const currentYear = Number(today.slice(0, 4));
        const currentWeek = mondayFor(today);
        if (year !== currentYear) params.set("year", String(year));
        if (weekStart !== currentWeek) params.set("week_start", weekStart);
        const query = params.toString();
        return query ? `?${query}` : "";
    }

    function shiftYear(year, amount, firstDay, today) {
        if (!parts(today) || !firstDay) return null;
        const candidate = year + amount;
        const firstYear = Number(firstDay.slice(0, 4));
        const currentYear = Number(today.slice(0, 4));
        return candidate >= firstYear && candidate <= currentYear ? candidate : null;
    }

    function shiftWeek(weekStart, amount, firstDay, today) {
        if (!parts(weekStart) || !parts(firstDay) || !parts(today)) return null;
        const candidate = addDays(weekStart, amount * 7);
        const candidateEnd = addDays(candidate, 6);
        return candidate <= today && candidateEnd >= firstDay ? candidate : null;
    }

    function isoWeek(value) {
        const parsed = parts(value);
        if (!parsed) return null;
        const target = parsed.parsed;
        target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
        const first = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
        return {
            year: target.getUTCFullYear(),
            week: Math.ceil((((target - first) / 86400000) + 1) / 7),
        };
    }

    function formatCount(value) {
        return COUNT.format(Number(value) || 0);
    }

    function formatDay(value) {
        const parsed = parts(value);
        return parsed ? {
            weekday: DAY.format(parsed.parsed),
            date: SHORT_DATE.format(parsed.parsed),
        } : {weekday: "", date: ""};
    }

    function formatWeek(start, end, week) {
        const left = formatDay(start).date;
        const right = formatDay(end).date;
        return `KW ${week} · ${left}–${right}`;
    }

    function formatAsOf(value) {
        if (!value) return "";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "";
        return `Stand ${parsed.toLocaleTimeString("de-DE", {
            hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
        })}`;
    }

    function isOutsideMonth(year, month, firstDay, today) {
        const start = `${year}-${String(month).padStart(2, "0")}-01`;
        const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
        const end = addDays(next, -1);
        return !firstDay || end < firstDay || start > today;
    }

    return {
        MONTHS, addDays, mondayFor, readUrl, writeUrl, shiftYear, shiftWeek, isoWeek,
        formatCount, formatDay, formatWeek, formatAsOf, isOutsideMonth,
    };
}));
