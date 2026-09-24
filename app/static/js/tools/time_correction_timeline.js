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

    const LANE_PX = 30;

    function row(label, trackClass, content, style = "", note = "") {
        const noteHtml = note ? `<span class="tc-row-note">${escapeHtml(note)}</span>` : "";
        return `<div class="tc-row"><div class="tc-row-label">${escapeHtml(label)}${noteHtml}</div>`
            + `<div class="tc-track ${trackClass}"${style ? ` style="${style}"` : ""}>${content}</div></div>`;
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
        const pending = options.pending ? '<div class="tc-pending" aria-hidden="true"></div>' : "";
        return row(options.label ?? "Ergebnis", "tc-track-result",
            segments + stripes + nowHtml(view, range, options.nowMs) + pending, "", options.note);
    }

    // Genesys-Ebene: jeder Eintrag einzeln, auch bei gleichem Status. An diesen Kanten
    // endet ein offener Wechsel.
    function genesysRowHtml(view, range, extra = "") {
        const entries = (view.genesys || []).map(entry => {
            const startMs = Model.toMs(entry.start);
            const endMs = Model.toMs(entry.end);
            const placed = Model.place(startMs, endMs, range);
            if (!placed) return "";
            const title = `${entry.label} → ${entry.status} · ${Model.berlinTime(startMs)}–${Model.berlinTime(endMs)}`;
            return `<div class="tc-seg tc-seg-genesys tc-status-${escapeHtml(entry.status)}" style="${box(placed)}" title="${escapeHtml(title)}">`
                + `<span class="tc-seg-label">${escapeHtml(entry.label)}</span></div>`;
        }).join("");
        return row("Genesys", "tc-track-genesys", entries + extra);
    }

    function blockTitle(block) {
        const head = block.id != null ? "#" + block.id : "neu";
        const period = `${Model.berlinTime(block.from)}${block.to != null ? "–" + Model.berlinTime(block.to) : " (offen)"}`;
        const created = block.createdAt != null ? Model.berlinDateTime(block.createdAt) : "";
        return [`${head} · ${block.status} ${period}`, block.reason, block.createdBy, created].filter(Boolean).join(" · ");
    }

    const STATE_LABELS = {new: "neu", changed: "geändert", removed: "entfernt", unchanged: ""};
    // Griffe an den Kanten: Ziehen ändert Beginn bzw. Ende, am Körper verschiebt es den Block.
    const HANDLES = '<span class="tc-handle tc-handle-start" data-handle="start" aria-hidden="true"></span>'
        + '<span class="tc-handle tc-handle-end" data-handle="end" aria-hidden="true"></span>';

    // Korrektur-Ebene: ein Block je Korrektur, Überlappungen in Unterzeilen, der spätere oben.
    // Die Blöcke sind fokussierbar; Enter oder Klick wählt einen Block zum Bearbeiten.
    function correctionRowHtml(blocks, range, options = {}) {
        const ordered = Model.orderedBlocks(blocks);
        const {lanes, count} = Model.layoutLanes(ordered);
        const items = ordered.map(block => {
            const placed = Model.place(block.from, Model.blockEnd(block), range)
                || (block.from >= range.start && block.from <= range.end
                    ? {left: Model.percentAt(block.from, range), width: 0} : null);
            if (!placed) return "";
            const state = Model.blockState(block);
            const classes = ["tc-block", `tc-status-${block.status}`];
            if (state !== "unchanged") classes.push(`tc-block-${state}`);
            if (Model.needsReason(block) || (options.errors && options.errors[block.key])) classes.push("tc-block-missing");
            if (block.to == null) classes.push("tc-block-open");
            // Ohne Wirkung laut API; neue Blöcke kennen ihr wirksames Ende erst aus der Vorschau.
            if ((state === "unchanged" || block.previewed) && state !== "removed" && block.appliedTo == null) {
                classes.push("tc-block-idle");
            }
            if (block.key === options.selectedKey) classes.push("is-selected");
            const label = `${block.status} ${block.id != null ? "#" + block.id : "neu"}`;
            const title = [blockTitle(block), STATE_LABELS[state], options.errors && options.errors[block.key]]
                .filter(Boolean).join(" · ");
            return `<div class="${classes.map(escapeHtml).join(" ")}" data-key="${escapeHtml(block.key)}"`
                + ` role="button" tabindex="0" aria-pressed="${block.key === options.selectedKey}"`
                + ` style="${box(placed)};top:${lanes[block.key] * LANE_PX + 4}px" title="${escapeHtml(title)}">`
                + `<span class="tc-seg-label">${escapeHtml(label)}</span>`
                + (state === "removed" ? "" : HANDLES) + "</div>";
        }).join("");
        return row("Korrekturen", "tc-track-corrections", items + (options.extra || ""),
            `height:${Math.max(1, count) * LANE_PX + 8}px`);
    }

    const RESULT_NOTES = {preview: "Vorschau", pending: "Vorschau …", stale: "nicht aktuell", error: "Fehler"};

    // Bearbeitungsmodus: Genesys und Korrekturen als zwei Ebenen, darunter das Ergebnis.
    // options.preview: Tagesansicht der SD-API-Vorschau; options.previewState: "", preview,
    // pending, stale, error. Das Ergebnis zeigt nie einen Stand, den die SD-API nicht berechnet hat:
    // Solange die Vorschau fehlt oder veraltet ist, bleibt es überdeckt.
    function editorHtml(view, blocks, range, options = {}) {
        const shown = options.preview || view;
        const state = options.previewState || "";
        const now = nowHtml(view, range, options.nowMs);
        return '<div class="tc-layers" role="group" aria-label="Ebenen, zusammengeführt zum Ergebnis">'
            + genesysRowHtml(shown, range, now) + correctionRowHtml(blocks, range, {...options, extra: now}) + "</div>"
            + '<div class="tc-merge" aria-hidden="true"><span>⊕</span></div>'
            + resultRowHtml(shown, range, {nowMs: options.nowMs, label: "Ergebnis", note: RESULT_NOTES[state],
                pending: state === "pending" || state === "stale" || state === "error"});
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
        correctionRowHtml,
        editorHtml,
        genesysRowHtml,
        revokedListHtml,
        resultRowHtml,
    };
}));
