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

    const LANE_PX = 36;

    // Eine Zeile über die volle Breite. title steht über der Zeile, note klein in ihr.
    function row(trackClass, content, options = {}) {
        const title = options.title ? `<div class="tc-row-title">${escapeHtml(options.title)}</div>` : "";
        const note = options.note ? `<span class="tc-track-note">${escapeHtml(options.note)}</span>` : "";
        return `<div class="tc-row">${title}<div class="tc-track ${trackClass}"`
            + `${options.style ? ` style="${options.style}"` : ""}>${content}${note}</div></div>`;
    }

    function axisHtml(range) {
        const ticks = Model.axisTicks(range).map(tick => (
            `<span class="tc-tick" style="left:${pct(tick.percent)}">${tick.label}</span>`
        )).join("");
        return row("tc-axis", ticks);
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
        return row("tc-track-result", segments + stripes + nowHtml(view, range, options.nowMs) + pending,
            {note: options.note});
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
        return row("tc-track-genesys", entries + extra);
    }

    function blockTitle(block) {
        const head = block.id != null ? "#" + block.id : "neu";
        const period = `${Model.berlinTime(block.from)}${block.to != null ? "–" + Model.berlinTime(block.to) : " (offen)"}`;
        const created = block.createdAt != null ? Model.berlinDateTime(block.createdAt) : "";
        return [`${head} · ${block.status} ${period}`, block.reason, block.createdBy, created].filter(Boolean).join(" · ");
    }

    const STATE_LABELS = {new: "neu", changed: "geändert", removed: "entfernt", unchanged: ""};
    // Griffe an den Kanten: Ziehen ändert Beginn bzw. Ende, am Körper verschiebt es den Block.
    // Tastatur am Block (time_correction.js): verschieben, Ende ändern, entfernen.
    const BLOCK_KEYS = "ArrowLeft ArrowRight ArrowUp ArrowDown Delete";
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
            if (options.readOnly) classes.push("tc-block-readonly");
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
                + (options.readOnly ? "" : ` role="button" tabindex="0" aria-pressed="${block.key === options.selectedKey}"`)
                + (options.readOnly || state === "removed" ? "" : ` aria-keyshortcuts="${BLOCK_KEYS}"`)
                + ` style="${box(placed)};top:${lanes[block.key] * LANE_PX + 4}px" title="${escapeHtml(title)}">`
                + `<span class="tc-seg-label">${escapeHtml(label)}</span>`
                + (state === "removed" || options.readOnly ? "" : HANDLES) + "</div>";
        }).join("");
        return row(`tc-track-corrections${options.readOnly ? " tc-track-readonly" : ""}`, items + (options.extra || ""),
            {title: "Korrekturen", style: `height:${Math.max(1, count) * LANE_PX + 8}px`});
    }

    const RESULT_NOTES = {preview: "Vorschau", pending: "Vorschau …", stale: "nicht aktuell", error: "Fehler"};

    // Bearbeitungsmodus: oben die Genesys-Ebene, unten die Korrektur-Ebene, dazwischen die
    // Zeitbuchung, in die beide zusammengeführt werden.
    // options.preview: Tagesansicht der SD-API-Vorschau; options.previewState: "", preview,
    // pending, stale, error. Die Zeitbuchung zeigt nie einen Stand, den die SD-API nicht berechnet
    // hat: Solange die Vorschau fehlt oder veraltet ist, bleibt sie überdeckt.
    function editorHtml(view, blocks, range, options = {}) {
        const shown = options.preview || view;
        const state = options.previewState || "";
        const now = nowHtml(view, range, options.nowMs);
        return '<div class="tc-layers" role="group" aria-label="Genesys und Korrekturen, zusammengeführt zur Zeitbuchung">'
            + genesysRowHtml(shown, range, now)
            + resultRowHtml(shown, range, {nowMs: options.nowMs, note: RESULT_NOTES[state],
                pending: state === "pending" || state === "stale" || state === "error"})
            + correctionRowHtml(blocks, range, {...options, extra: now})
            + "</div>";
    }

    // items: [{name, view}] der angezeigten Mitarbeiter; eine Liste für alle.
    function changeListHtml(items) {
        const rows = Model.combinedChangeRows(items);
        if (!rows.length) return '<p class="tc-empty">Keine Opcyc-Datensätze entstanden.</p>';
        return '<table class="tc-table"><thead><tr><th scope="col">Uhrzeit</th><th scope="col">Mitarbeiter</th>'
            + '<th scope="col">Status</th><th scope="col">Herkunft</th></tr></thead><tbody>'
            + rows.map(item => (
                `<tr><td class="tc-num">${item.time}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.status)}</td>`
                + `<td${item.source === "correction" ? ' class="tc-origin-correction"' : ""}>${escapeHtml(item.origin)}</td></tr>`
            )).join("")
            + "</tbody></table>";
    }

    // --- Kacheln im Bearbeitungsmodus -----------------------------------------------
    // Vorn „Neue Korrektur“, dann die Korrekturen nach Beginn, abgetrennt die zurückgenommenen.
    // Eingeklappt: Status, Zeitraum, Zeitpunkt und Bearbeiter. Ausgeklappt (nur in der Breite):
    // dazu der Grund und die Knöpfe Bearbeiten und Entfernen. Im Bearbeiten sind die Felder änderbar.

    const ICONS = {
        edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
        remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3"/></svg>',
        restore: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7"/><path d="M4 4v4.7h4.7"/></svg>',
    };

    function tileClass(block, options = {}) {
        const classes = ["tc-tile", `tc-status-${block.status}`];
        if (block.revoked) classes.push("tc-tile-revoked");
        else {
            const state = Model.blockState(block);
            if (state !== "unchanged") classes.push(`tc-tile-${state}`);
            if (Model.blockMessage(block, options.view, options.nowMs, (options.errors || {})[block.key])) classes.push("has-error");
        }
        if (block.key === options.selectedKey) classes.push("is-expanded");
        if (block.key === options.editKey && !block.revoked && !block.removed && !options.readOnly) classes.push("is-editing");
        return classes.join(" ");
    }

    function statusSelect(block) {
        return `<select class="tc-tile-select" data-field="status" aria-label="Status">`
            + Model.STATUSES.map(status => `<option${status === block.status ? " selected" : ""}>${status}</option>`).join("")
            + "</select>";
    }

    function timeInput(field, ms, label, maxClock) {
        return `<input type="time" class="tc-tile-clock" data-field="${field}" step="60" aria-label="${label}"`
            + ` value="${ms != null ? Model.msToClock(ms) : ""}"${maxClock ? ` max="${maxClock}"` : ""}>`;
    }

    function periodHtml(block) {
        const word = text => `<span class="tc-tile-word">${text}</span>`;
        const clock = ms => `<strong>${Model.msToClock(ms)}</strong>`;
        return block.to != null ? `${clock(block.from)} ${word("bis")} ${clock(block.to)}` : `${word("ab")} ${clock(block.from)}`;
    }

    function tileActions(block, options, editing) {
        if (block.revoked || options.readOnly) return "";
        const buttons = block.removed
            ? `<button type="button" class="tc-tile-btn" data-action="restore" aria-label="Wiederherstellen" title="Wiederherstellen">${ICONS.restore}</button>`
            : `<button type="button" class="tc-tile-btn" data-action="edit" aria-pressed="${editing}" aria-label="Bearbeiten" title="Bearbeiten">${ICONS.edit}</button>`
                + `<button type="button" class="tc-tile-btn" data-action="remove" aria-label="Entfernen" title="Entfernen">${ICONS.remove}</button>`;
        return `<div class="tc-tile-actions">${buttons}</div>`;
    }

    function reasonInput(block, editing) {
        return `<input type="text" class="ui-input tc-tile-reason" data-field="reason" maxlength="${Model.REASON_MAX}"`
            + ` value="${escapeHtml(block.reason)}" placeholder="Grund" aria-label="Grund"${editing ? "" : " readonly"}>`;
    }

    function tileHtml(block, options) {
        const expanded = block.key === options.selectedKey;
        const editing = expanded && block.key === options.editKey && !block.revoked && !block.removed && !options.readOnly;
        const open = `<div class="${tileClass(block, options)}" data-tile="${escapeHtml(block.key)}">`;
        const meta = `<span class="tc-tile-meta">${escapeHtml(Model.blockMeta(block))}</span>`;
        const message = Model.blockMessage(block, options.view, options.nowMs, (options.errors || {})[block.key]);
        const error = `<span class="tc-tile-error" role="alert">${escapeHtml(message)}</span>`;
        if (editing) {
            // Im Bearbeiten ein kompakter Block: Status über die volle Breite, Zeitspanne, Grund.
            return open + '<div class="tc-tile-form">' + statusSelect(block)
                + `<span class="tc-tile-time">${timeInput("from", block.from, "Beginn", options.maxClock)}`
                + ` <span class="tc-tile-word">bis</span> ${timeInput("to", block.to, "Ende (leer: offen)", options.maxClock)}</span>`
                + reasonInput(block, true) + error + "</div>"
                + tileActions(block, options, true) + "</div>";
        }
        const main = `<div class="tc-tile-main" data-action="toggle" role="button" tabindex="0" aria-expanded="${expanded}">`
            + `<span class="tc-tile-status">${escapeHtml(block.status)}</span>`
            + `<span class="tc-tile-time">${periodHtml(block)}</span>`
            + (expanded ? "" : meta) + "</div>";
        if (!expanded) return open + main + "</div>";
        // Ausgeklappt (lesend): rechts der Grund, darunter links Zeitpunkt und Bearbeiter.
        return open + main + `<div class="tc-tile-detail">${reasonInput(block, false)}${error}${meta}</div>`
            + tileActions(block, options, false) + "</div>";
    }

    // options: {view, nowMs, selectedKey, editKey, errors, maxClock, readOnly}
    // readOnly: aufgeklappte Ansicht außerhalb des Bearbeitens, ohne „+“ und ohne Knöpfe.
    function tilesHtml(blocks, revoked, options = {}) {
        // Zurückgenommene stehen hinter der Trennlinie unter „Archiviert“: gelöscht wird nie etwas.
        const archive = revoked.length
            ? '<div class="tc-tiles-sep" aria-hidden="true"></div><div class="tc-tiles-archive">'
                + '<span class="tc-tiles-label">Archiviert</span><div class="tc-tiles-row">'
                + revoked.map(block => tileHtml(block, options)).join("") + "</div></div>"
            : "";
        return (options.readOnly ? ""
            : '<button type="button" class="tc-tile tc-tile-add" data-action="add">'
                + '<span class="tc-tile-add-icon" aria-hidden="true">+</span><span>Neue Zeitkorrektur</span></button>')
            + Model.tileBlocks(blocks).map(block => tileHtml(block, options)).join("")
            + archive;
    }

    // --- Kennzahlen des aktiven Mitarbeiters ---------------------------------------
    // Dauer je Status, links aus Genesys (je Bezeichnung), rechts für Opcyc (je Status).

    function kpiGroup(title, items) {
        const cards = items.length
            ? items.map(item => (
                `<div class="tc-kpi tc-status-${escapeHtml(item.status)}">`
                + `<span class="tc-kpi-label">${escapeHtml(item.label)}</span>`
                + `<span class="tc-kpi-value">${Model.formatDuration(item.seconds)}</span></div>`
            )).join("")
            : '<span class="tc-kpi-empty">–</span>';
        return `<div class="tc-kpi-group"><span class="tc-kpi-title">${title}</span><div class="tc-kpi-cards">${cards}</div></div>`;
    }

    function kpisHtml(view, nowMs) {
        return kpiGroup("Genesys", Model.genesysDurations(view, nowMs))
            + kpiGroup("Opcyc", Model.opcycDurations(view, nowMs));
    }

    // --- Mitarbeiter-Kacheln ------------------------------------------------------
    // Eine Kachel je Mitarbeiter mit Buchung am Tag, über die Suche geholte vorn.
    // chips: [{user_id, name, logged, pause, corrections, manual}] (Sekunden bzw. Anzahl oder null);
    // visible: user_ids.

    const CHIP_ICONS = {
        clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
        meal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M16 21V3c-2 1.5-3 4-3 7v3h3"/></svg>',
    };

    function chipsHtml(chips, visible) {
        const shown = new Set(visible || []);
        return chips.map(chip => {
            const on = shown.has(chip.user_id);
            return `<button type="button" class="tc-chip${on ? " is-on" : ""}${chip.manual ? " tc-chip-manual" : ""}"`
                + ` data-chip="${escapeHtml(chip.user_id)}" aria-pressed="${on}">`
                + `<span class="tc-chip-name" title="${escapeHtml(chip.name || "")}">${escapeHtml(chip.name || "…")}</span>`
                + '<span class="tc-chip-times">'
                + `<span class="tc-chip-log" title="Logzeit">${CHIP_ICONS.clock}${Model.formatDuration(chip.logged)}</span>`
                + `<span class="tc-chip-pause" title="Pause (BIPAU und PAUSE)">${CHIP_ICONS.meal}${Model.formatDuration(chip.pause)}</span>`
                // Die Zeile bleibt auch leer stehen, damit die Zeiten in allen Kacheln gleich sitzen.
                + `</span><span class="tc-chip-note">${escapeHtml(Model.correctionLabel(chip.corrections))}</span></button>`;
        }).join("");
    }

    return {
        axisHtml,
        chipsHtml,
        kpisHtml,
        changeListHtml,
        correctionRowHtml,
        editorHtml,
        genesysRowHtml,
        tileClass,
        tilesHtml,
        resultRowHtml,
    };
}));
