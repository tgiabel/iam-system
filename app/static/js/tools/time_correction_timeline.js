(function (root, factory) {
    const isCommonJs = typeof module === "object" && module.exports;
    const model = isCommonJs ? require("./time_correction_model.js") : (root && root.TimeCorrectionModel);
    const timeline = factory(model);
    if (isCommonJs) {
        module.exports = timeline;
    }
    if (root) {
        root.TimeCorrectionTimeline = timeline;
    }
}(typeof window !== "undefined" ? window : globalThis, function (Model) {
    "use strict";

    // Zeilen als HTML-Text, ohne ids und ohne Zustand: Dieselbe Zeile lässt sich später
    // N-mal in einer Lese-Übersicht rendern.

    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => (
        {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]
    ));
    const pct = value => value.toFixed(4) + "%";
    const box = placed => `left:${pct(placed.left)};width:${pct(placed.width)}`;

    function row(label, trackClass, content) {
        return `<div class="tc-row"><div class="tc-row-label">${escapeHtml(label)}</div>`
            + `<div class="tc-track ${trackClass}">${content}</div></div>`;
    }

    function axisHtml(range) {
        const ticks = Model.axisTicks(range).map(tick => (
            `<span class="tc-tick" style="left:${pct(tick.percent)}">${tick.label}</span>`
        )).join("");
        return row("", "tc-axis", ticks);
    }

    function nowHtml(view, range, nowMs) {
        const percent = nowMs == null ? null : Model.nowPercent(nowMs, view, range);
        if (percent == null) return "";
        return `<div class="tc-future" style="left:${pct(percent)}" aria-hidden="true"></div>`
            + `<div class="tc-now" style="left:${pct(percent)}" title="Jetzt ${Model.berlinTime(nowMs)}"></div>`;
    }

    // Kanonische Zeile: genau die Wechsel, die Opcyc bekäme (merged), dazu ein Streifen über
    // den korrigierten Teilstücken (pieces) und eine Marke je Wechsel.
    function resultRowHtml(view, range, options = {}) {
        const segments = (view.merged || []).map(segment => {
            const startMs = Model.toMs(segment.start);
            const placed = Model.place(startMs, Model.toMs(segment.end), range);
            if (!placed) return "";
            const title = Model.describeChange(view, segment);
            const marker = startMs >= range.start
                ? `<span class="tc-marker tc-marker-${segment.source === "correction" ? "correction" : "genesys"}"`
                    + ` style="left:${pct(placed.left)}" aria-hidden="true"></span>`
                : "";
            return `<div class="tc-seg tc-status-${escapeHtml(segment.status)}" style="${box(placed)}" title="${escapeHtml(title)}">`
                + `<span class="tc-seg-label">${escapeHtml(segment.status)}</span></div>${marker}`;
        }).join("");
        const stripes = (view.pieces || []).filter(piece => piece.source === "correction").map(piece => {
            const placed = Model.place(Model.toMs(piece.start), Model.toMs(piece.end), range);
            return placed ? `<div class="tc-stripe" style="${box(placed)}" aria-hidden="true"></div>` : "";
        }).join("");
        return row(options.label ?? "Ergebnis", "tc-track-result", segments + stripes + nowHtml(view, range, options.nowMs));
    }

    function changeListHtml(view) {
        const rows = Model.changeRows(view);
        if (!rows.length) return '<p class="tc-empty">Keine Opcyc-Datensätze entstanden.</p>';
        return '<table class="tc-table"><thead><tr><th scope="col">Uhrzeit</th><th scope="col">Status</th>'
            + '<th scope="col">Herkunft</th></tr></thead><tbody>'
            + rows.map(item => (
                `<tr><td class="tc-num">${item.time}</td><td>${escapeHtml(item.status)}</td>`
                + `<td${item.source === "correction" ? ' class="tc-origin-correction"' : ""}>${escapeHtml(item.origin)}</td></tr>`
            )).join("")
            + "</tbody></table>";
    }

    function revokedListHtml(view) {
        const rows = Model.revokedRows(view);
        if (!rows.length) return "";
        return '<table class="tc-table"><thead><tr><th scope="col">Nr.</th><th scope="col">Zeitraum</th>'
            + '<th scope="col">Status</th><th scope="col">Grund</th><th scope="col">Angelegt</th>'
            + '<th scope="col">Zurückgenommen</th></tr></thead><tbody>'
            + rows.map(item => (
                `<tr><td class="tc-num">#${escapeHtml(item.id)}</td><td class="tc-num">${escapeHtml(item.period)}</td>`
                + `<td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.reason)}</td>`
                + `<td>${escapeHtml(item.created)}</td><td>${escapeHtml(item.revoked)}</td></tr>`
            )).join("")
            + "</tbody></table>";
    }

    return {
        axisHtml,
        changeListHtml,
        revokedListHtml,
        resultRowHtml,
    };
}));
