// Presence-Report ohne DOM: Formate, URL, Suche, Sortierung, Spaltenwahl. In Node geprüft
// (tests/presence_report_model_checks.js).
(function (root, factory) {
    const model = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = model;
    }
    if (root) {
        root.PresenceReportModel = model;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const SOURCES = ["genesys", "opcyc"];
    const LOGGED = "logged";
    const NAME = "name";
    const BERLIN_TIME = new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    const BERLIN_DAY = new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Berlin"});

    // Tabelle: 1:05:09
    function formatDuration(seconds) {
        const total = Math.max(0, Math.round(seconds || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    }

    // Kennzahlen: „7 h 31 min“, „18 min“, „42 s“
    function formatSpan(seconds) {
        const total = Math.max(0, Math.round(seconds || 0));
        if (total < 60) return `${total} s`;
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
    }

    // Uhrzeit in Berlin; liegt der Zeitpunkt nicht am gewählten Tag, mit Datum davor.
    function formatMoment(iso, day) {
        if (!iso) return null;
        const moment = new Date(iso);
        const time = BERLIN_TIME.format(moment);
        const date = BERLIN_DAY.format(moment);
        if (date === day) return time;
        const [, month, dayOfMonth] = date.split("-");
        return `${dayOfMonth}.${month}. ${time}`;
    }

    function readUrl(search) {
        const params = new URLSearchParams(search || "");
        const day = params.get("day");
        const source = params.get("source");
        return {
            day: /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day : null,
            source: SOURCES.includes(source) ? source : "genesys",
        };
    }

    // Standardwerte (heute, genesys) bleiben aus der URL heraus.
    function writeUrl(day, today, source) {
        const params = new URLSearchParams();
        if (day && day !== today) params.set("day", day);
        if (source !== "genesys") params.set("source", source);
        const query = params.toString();
        return query ? `?${query}` : "";
    }

    function visibleStatuses(statuses, hidden) {
        return (statuses || []).filter((status) => !(hidden || []).includes(status.key));
    }

    function displayName(user, names) {
        return (names && names[user.pseudonym]) || user.pseudonym;
    }

    // Suche über Pseudonym und aufgedeckte Namen; Sortierung nach Spalte, bei Gleichstand stabil.
    function rows(users, {query = "", names = {}, sortKey = LOGGED, sortDir = "desc"} = {}) {
        const needle = query.trim().toLocaleLowerCase("de");
        const matches = (users || []).filter((user) => !needle
            || user.pseudonym.toLocaleLowerCase("de").includes(needle)
            || (names[user.pseudonym] || "").toLocaleLowerCase("de").includes(needle));
        const direction = sortDir === "asc" ? 1 : -1;
        return matches.sort((a, b) => {
            let order;
            if (sortKey === NAME) {
                order = displayName(a, names).localeCompare(displayName(b, names), "de", {sensitivity: "base"});
            } else if (sortKey === LOGGED) {
                order = a.logged_seconds - b.logged_seconds;
            } else {
                const left = a.statuses[sortKey] || {seconds: 0, count: 0};
                const right = b.statuses[sortKey] || {seconds: 0, count: 0};
                order = (left.seconds - right.seconds) || (left.count - right.count);
            }
            return order * direction || a.pseudonym.localeCompare(b.pseudonym);
        });
    }

    // Erster Klick auf eine Zahlenspalte sortiert absteigend, auf den Namen aufsteigend.
    function nextSort(current, key) {
        if (current.sortKey === key) {
            return {sortKey: key, sortDir: current.sortDir === "asc" ? "desc" : "asc"};
        }
        return {sortKey: key, sortDir: key === NAME ? "asc" : "desc"};
    }

    function exportUrl(day, source) {
        return `/api/reporting/presence/export?${new URLSearchParams({day, source})}`;
    }

    return {LOGGED, NAME, formatDuration, formatSpan, formatMoment, readUrl, writeUrl, visibleStatuses,
            displayName, rows, nextSort, exportUrl};
}));
