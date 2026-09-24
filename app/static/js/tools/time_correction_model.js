(function (root, factory) {
    const model = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = model;
    }
    if (root) {
        root.TimeCorrectionModel = model;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const DAY_NAMES = ["Heute", "Gestern"];
    const MIN_QUERY_LENGTH = 2;

    // Tage kommen aus GET /time-corrections/days; der jüngste ist „heute“.
    function orderDays(days) {
        return [...(days || [])].sort().reverse();
    }

    function dayLabel(isoDate, index) {
        const [year, month, day] = isoDate.split("-");
        const weekday = WEEKDAYS[new Date(Date.UTC(+year, +month - 1, +day)).getUTCDay()];
        const name = DAY_NAMES[index];
        return `${name ? name + " · " : ""}${weekday} ${day}.${month}.`;
    }

    // Auswahl aus der URL; ein Tag, den die API nicht anbietet, fällt auf heute zurück.
    function readSelection(search, days) {
        const params = new URLSearchParams(search);
        const ordered = orderDays(days);
        const date = params.get("date");
        return {
            userId: params.get("user") || null,
            date: ordered.includes(date) ? date : (ordered[0] || null),
        };
    }

    function selectionQuery(userId, date) {
        const params = new URLSearchParams();
        if (userId) params.set("user", userId);
        if (date) params.set("date", date);
        const query = params.toString();
        return query ? "?" + query : "";
    }

    function isSearchable(query) {
        return String(query || "").trim().length >= MIN_QUERY_LENGTH;
    }

    // --- Zeitachse ----------------------------------------------------------------
    // Die Achse ist linear in UTC von day_start bis day_end (aus der API). Berlin weicht
    // um volle Stunden von UTC ab, volle UTC-Stunden sind also volle Berliner Stunden.

    const HOUR_MS = 3600 * 1000;
    const WORK_MARGIN_MS = HOUR_MS;
    const WORK_MIN_MS = 8 * HOUR_MS;
    const formatters = {};

    function toMs(iso) {
        return Date.parse(iso);
    }

    function berlinFormatter(withSeconds) {
        const key = withSeconds ? "s" : "m";
        if (!formatters[key]) {
            formatters[key] = new Intl.DateTimeFormat("de-DE", {
                timeZone: "Europe/Berlin", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
                ...(withSeconds ? {second: "2-digit"} : {}),
            });
        }
        return formatters[key];
    }

    function berlinTime(ms, withSeconds = false) {
        return berlinFormatter(withSeconds).format(new Date(ms));
    }

    function berlinDateTime(ms) {
        if (!formatters.dt) {
            formatters.dt = new Intl.DateTimeFormat("de-DE", {
                timeZone: "Europe/Berlin", hourCycle: "h23", day: "2-digit", month: "2-digit",
                hour: "2-digit", minute: "2-digit",
            });
        }
        return formatters.dt.format(new Date(ms)).replace(",", "");
    }

    function dayRange(view) {
        return {start: toMs(view.day_start), end: toMs(view.day_end)};
    }

    function dayHours(view) {
        const range = dayRange(view);
        return (range.end - range.start) / HOUR_MS;
    }

    function percentAt(ms, range) {
        return (ms - range.start) / (range.end - range.start) * 100;
    }

    function timeAtPercent(percent, range) {
        return range.start + percent / 100 * (range.end - range.start);
    }

    // Eine Marke je voller Stunde; am 25-Stunden-Tag erscheint „02“ zweimal, am 23-Stunden-Tag fehlt sie.
    function axisTicks(range) {
        const ticks = [];
        for (let ms = Math.ceil(range.start / HOUR_MS) * HOUR_MS; ms < range.end; ms += HOUR_MS) {
            ticks.push({ms, percent: percentAt(ms, range), label: berlinTime(ms).slice(0, 2)});
        }
        return ticks;
    }

    // Ausschnitt „Arbeitszeit“: erster bis letzter Nicht-HOME-Abschnitt, je 1 h Rand,
    // auf volle Stunden, mindestens 8 h, nie über den Tag hinaus. Ohne Arbeitszeit: ganzer Tag.
    function workRange(view, segments) {
        const day = dayRange(view);
        const active = (segments || []).filter(segment => segment.status !== "HOME");
        if (!active.length) return day;
        let start = Math.min(...active.map(segment => toMs(segment.start))) - WORK_MARGIN_MS;
        let end = Math.max(...active.map(segment => toMs(segment.end))) + WORK_MARGIN_MS;
        start = Math.max(day.start, Math.floor(start / HOUR_MS) * HOUR_MS);
        end = Math.min(day.end, Math.ceil(end / HOUR_MS) * HOUR_MS);
        if (end - start < WORK_MIN_MS) {
            // Um die Mitte auf 8 h aufweiten; am Tagesrand zur anderen Seite hin.
            start = Math.floor(((start + end) / 2 - WORK_MIN_MS / 2) / HOUR_MS) * HOUR_MS;
            start = Math.max(day.start, Math.min(start, day.end - WORK_MIN_MS));
            end = Math.min(day.end, start + WORK_MIN_MS);
        }
        return {start, end};
    }

    function viewRange(view, mode) {
        return mode === "day" ? dayRange(view) : workRange(view, view.merged);
    }

    // Lage eines Abschnitts im Ausschnitt in Prozent; null, wenn er ganz außerhalb liegt.
    function place(startMs, endMs, range) {
        const from = Math.max(startMs, range.start);
        const to = Math.min(endMs, range.end);
        if (to <= from) return null;
        return {left: percentAt(from, range), width: percentAt(to, range) - percentAt(from, range)};
    }

    function nowPercent(nowMs, view, range) {
        const day = dayRange(view);
        if (nowMs < day.start || nowMs >= day.end || nowMs < range.start || nowMs > range.end) return null;
        return percentAt(nowMs, range);
    }

    // --- Herkunft eines Wechsels ------------------------------------------------------

    function findCorrection(view, item) {
        return (view.corrections || []).find(correction => (
            item.correction_id != null ? correction.id === item.correction_id
                : item.create_index != null && correction.id == null && correction.create_index === item.create_index
        )) || null;
    }

    function genesysLabel(view, startMs) {
        const entry = (view.genesys || []).find(item => toMs(item.start) === startMs);
        return entry ? entry.label : "";
    }

    function correctionName(correction) {
        return correction.id != null ? "#" + correction.id : "neu";
    }

    // Beschreibung des Wechsels am Beginn eines Ergebnis-Segments.
    function describeChange(view, segment) {
        const startMs = toMs(segment.start);
        const parts = [`Wechsel ${berlinTime(startMs)} → ${segment.status}`, changeOrigin(view, segment)];
        const correction = segment.source === "correction" ? findCorrection(view, segment) : null;
        if (correction) parts.push(correction.reason, correction.created_by && correction.created_by.name);
        return parts.filter(Boolean).join(" · ");
    }

    function changeOrigin(view, segment) {
        if (segment.source === "correction") {
            const correction = findCorrection(view, segment);
            return "Korrektur" + (correction ? " " + correctionName(correction) : "");
        }
        const label = genesysLabel(view, toMs(segment.start));
        return "Genesys" + (label ? ` (${label})` : "");
    }

    // Opcyc-Datensätze: je Ergebnis-Segment der Wechsel an seinem Beginn, wie in der
    // snapshot-CSV von genesys-sync (Berliner Uhrzeit hh:mm:ss, Status, Herkunft).
    // Steht der Mitarbeiter nicht in der Lieferung (delivered=false), entsteht kein Datensatz.
    function changeRows(view) {
        if (view.delivered === false) return [];
        return (view.merged || []).map(segment => ({
            time: berlinTime(toMs(segment.start), true),
            status: segment.status,
            origin: changeOrigin(view, segment),
            source: segment.source,
        }));
    }

    function correctionPeriod(correction) {
        const from = berlinTime(toMs(correction.effective_from));
        return correction.effective_to ? `${from}–${berlinTime(toMs(correction.effective_to))}` : `ab ${from}`;
    }

    function stamp(person, iso) {
        return [person && person.name, iso && berlinDateTime(toMs(iso))].filter(Boolean).join(" · ");
    }

    // Verlauf: zurückgenommene Korrekturen des Tages, nach id.
    function revokedRows(view) {
        return (view.corrections || []).filter(correction => correction.revoked_at).map(correction => ({
            id: correction.id,
            period: correctionPeriod(correction),
            status: correction.status_group,
            reason: correction.reason || "",
            created: stamp(correction.created_by, correction.created_at),
            revoked: stamp(correction.revoked_by, correction.revoked_at),
        }));
    }

    function errorMessage(payload) {
        const detail = payload && payload.detail;
        if (typeof detail === "string") return detail;
        if (detail && typeof detail.message === "string") return detail.message;
        return "Die Anfrage konnte nicht verarbeitet werden.";
    }

    return {
        axisTicks,
        berlinDateTime,
        berlinTime,
        changeRows,
        dayHours,
        dayLabel,
        dayRange,
        describeChange,
        errorMessage,
        findCorrection,
        isSearchable,
        nowPercent,
        orderDays,
        percentAt,
        place,
        readSelection,
        revokedRows,
        selectionQuery,
        timeAtPercent,
        toMs,
        viewRange,
        workRange,
    };
}));
