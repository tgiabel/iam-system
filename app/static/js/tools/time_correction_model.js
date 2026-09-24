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

    // --- Bearbeitungsblöcke ---------------------------------------------------------
    // Ein Block je aktiver Korrektur. Zeiten in ms; to=null ist ein Wechsel ab Zeitpunkt.
    // appliedTo ist das wirksame Ende aus der API (applied_to), nie selbst berechnet.

    function activeBlocks(view) {
        return (view.corrections || [])
            .filter(correction => correction.id != null && !correction.revoked_at)
            .sort((a, b) => a.id - b.id)
            .map(correction => ({
                key: "c" + correction.id,
                id: correction.id,
                status: correction.status_group,
                from: toMs(correction.effective_from),
                to: correction.effective_to ? toMs(correction.effective_to) : null,
                appliedTo: correction.applied_to ? toMs(correction.applied_to) : null,
                reason: correction.reason || "",
                createdBy: correction.created_by ? correction.created_by.name : "",
                createdAt: correction.created_at ? toMs(correction.created_at) : null,
            }));
    }

    // Angezeigtes Ende: festes Ende, sonst das wirksame; ohne beides nur der Beginn.
    function blockEnd(block) {
        return block.to != null ? block.to : (block.appliedTo != null ? block.appliedTo : block.from);
    }

    // Unterzeilen: Blöcke in Rangfolge (später = gewinnt). Überlappen sich zwei, liegt der
    // spätere weiter oben (kleinere Zeile). Ergebnis: Zeile je key und Anzahl der Zeilen.
    function layoutLanes(blocks) {
        const lanes = {};
        const placed = [];
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index];
            const start = block.from;
            const end = Math.max(blockEnd(block), start);
            let lane = 0;
            placed.forEach(other => {
                const overlaps = start < other.end && other.start < end
                    || start === other.start;
                if (overlaps) lane = Math.max(lane, other.lane + 1);
            });
            lanes[block.key] = lane;
            placed.push({start, end, lane});
        }
        const count = placed.reduce((max, item) => Math.max(max, item.lane + 1), 0);
        return {lanes, count};
    }

    // --- Formularzeiten ----------------------------------------------------------------
    // „HH:MM“ Berliner Zeit am Tag der Ansicht → ms. An der doppelten Stunde (25-Stunden-Tag)
    // gilt das erste Vorkommen; eine Uhrzeit, die es nicht gibt (Sprung auf Sommerzeit), ist null.
    // Als Ende steht „00:00“ für das Tagesende.

    const MINUTE_MS = 60 * 1000;
    const clockMinutes = clock => {
        const match = /^(\d{2}):(\d{2})$/.exec(clock || "");
        return match && +match[1] < 24 && +match[2] < 60 ? +match[1] * 60 + +match[2] : null;
    };

    function clockToMs(view, clock, isEnd = false) {
        const minutes = clockMinutes(clock);
        if (minutes == null) return null;
        const day = dayRange(view);
        if (isEnd && minutes === 0) return day.end;
        let candidate = day.start + minutes * MINUTE_MS;
        const shown = clockMinutes(berlinTime(candidate));
        if (shown !== minutes) {
            let diff = minutes - shown;
            if (diff > 12 * 60) diff -= 24 * 60;
            if (diff < -12 * 60) diff += 24 * 60;
            candidate += diff * MINUTE_MS;
            if (clockMinutes(berlinTime(candidate)) !== minutes) return null;
        }
        return candidate >= day.start && candidate < day.end ? candidate : null;
    }

    function msToClock(ms) {
        return berlinTime(ms);
    }

    // Späteste zulässige Zeit: „jetzt“ (auf die Minute abgerundet) oder das Tagesende.
    function latestMs(view, nowMs) {
        return Math.min(dayRange(view).end, Math.floor(nowMs / MINUTE_MS) * MINUTE_MS);
    }

    // --- Änderungen an den Blöcken ------------------------------------------------------
    // Gespeicherte Blöcke werden nie geändert: Ändern heißt zurücknehmen und neu anlegen,
    // Entfernen heißt zurücknehmen. Neue und geänderte Blöcke liegen oben (touched = Reihenfolge).

    const STATUSES = ["ONLINE", "BIPAU", "PAUSE", "HOME"];
    const REASON_MAX = 255;
    const EDITABLE = ["status", "from", "to", "reason"];

    function nextTouch(blocks) {
        return blocks.reduce((max, block) => Math.max(max, block.touched || 0), 0) + 1;
    }

    function differsFromOriginal(block) {
        return EDITABLE.some(field => block[field] !== block.original[field]);
    }

    function createBlock(blocks, values, key) {
        return [...blocks, {
            key, id: null, status: values.status, from: values.from, to: values.to ?? null,
            appliedTo: null, reason: values.reason || "", createdBy: "", createdAt: null,
            changed: false, removed: false, touched: nextTouch(blocks),
        }];
    }

    function updateBlock(blocks, key, patch) {
        return blocks.map(block => {
            if (block.key !== key) return block;
            const next = {...block, ...patch};
            if (block.id == null) return next;
            const original = block.original || block;
            const changed = differsFromOriginal({...next, original});
            return {...next, original, changed, appliedTo: changed ? null : original.appliedTo,
                    touched: changed ? (block.touched || nextTouch(blocks)) : 0};
        });
    }

    // Neue Blöcke verschwinden; gespeicherte bleiben bis zum Speichern als entfernt stehen.
    function removeBlock(blocks, key) {
        return blocks.flatMap(block => {
            if (block.key !== key) return [block];
            if (block.id == null) return [];
            return [{...(block.original || block), original: block.original || block, removed: true, changed: false, touched: 0}];
        });
    }

    function restoreBlock(blocks, key) {
        return blocks.map(block => (block.key === key ? {...block, removed: false} : block));
    }

    function blockState(block) {
        if (block.removed) return "removed";
        if (block.id == null) return "new";
        return block.changed ? "changed" : "unchanged";
    }

    // Anzeige- und Rangfolge: unveränderte gespeicherte nach id, darüber neue und geänderte.
    function orderedBlocks(blocks) {
        const saved = blocks.filter(block => !block.touched).sort((a, b) => a.id - b.id);
        const touched = blocks.filter(block => block.touched).sort((a, b) => a.touched - b.touched);
        return [...saved, ...touched];
    }

    function changeSummary(blocks) {
        const summary = {created: 0, changed: 0, removed: 0};
        blocks.forEach(block => {
            const state = blockState(block);
            if (state === "new") summary.created++;
            if (state === "changed") summary.changed++;
            if (state === "removed") summary.removed++;
        });
        return summary;
    }

    function needsReason(block) {
        const state = blockState(block);
        return (state === "new" || state === "changed") && !String(block.reason || "").trim();
    }

    // Prüfung vor dem Senden; die SD-API prüft dasselbe noch einmal (422 mit loc).
    function blockError(block, view, nowMs) {
        if (block.removed) return "";
        const day = dayRange(view);
        if (block.from == null || !(block.from >= day.start && block.from < day.end)) return "Beginn fehlt oder liegt nicht am Tag.";
        if (block.to != null && block.to <= block.from) return "Ende muss nach dem Beginn liegen.";
        if (block.to != null && block.to > day.end) return "Ende liegt nach Mitternacht.";
        const state = blockState(block);
        if (state === "new" || state === "changed") {
            const latest = latestMs(view, nowMs);
            if (block.from > latest || (block.to != null && block.to > latest)) return "Liegt in der Zukunft.";
            if (String(block.reason || "").length > REASON_MAX) return `Grund höchstens ${REASON_MAX} Zeichen.`;
        }
        return "";
    }

    const iso = ms => new Date(ms).toISOString();

    // Bedienung → Request. revoke: geänderte und entfernte gespeicherte Blöcke.
    // create: neue und geänderte, von unten nach oben (der obere gewinnt). createKeys[i]
    // ist der Block zu create[i] und ordnet Vorschau und 422-loc wieder zu.
    function buildChangeRequest(blocks) {
        const revoke = blocks
            .filter(block => block.id != null && (block.changed || block.removed))
            .map(block => block.id)
            .sort((a, b) => a - b);
        const created = orderedBlocks(blocks).filter(block => ["new", "changed"].includes(blockState(block)));
        const create = created.map(block => {
            const item = {effective_from: iso(block.from), status_group: block.status, reason: block.reason.trim()};
            if (block.to != null) item.effective_to = iso(block.to);
            return item;
        });
        return {revoke, create, createKeys: created.map(block => block.key)};
    }

    // Vorschau: wie Speichern, aber ohne revision; ein leerer Grund darf fehlen.
    function previewBody(request) {
        return {
            revoke: request.revoke,
            create: request.create.map(item => {
                const copy = {...item};
                if (!copy.reason) delete copy.reason;
                return copy;
            }),
        };
    }

    // Was die Zusammenführung beeinflusst; der Grund gehört nicht dazu.
    function previewKey(request) {
        return JSON.stringify([request.revoke, request.create.map(({reason, ...item}) => item)]);
    }

    function saveBody(request, revision) {
        return {revision, revoke: request.revoke, create: request.create};
    }

    function hasChanges(request) {
        return request.revoke.length + request.create.length > 0;
    }

    function canSave(blocks, view, nowMs) {
        return hasChanges(buildChangeRequest(blocks))
            && !blocks.some(block => needsReason(block) || blockError(block, view, nowMs));
    }

    function saveMessage(request) {
        return [
            request.create.length && `${request.create.length} angelegt`,
            request.revoke.length && `${request.revoke.length} zurückgenommen`,
        ].filter(Boolean).join(" · ");
    }

    // Wirksames Ende je Block aus der Vorschau: neue und geänderte über create_index
    // (Position in create = createKeys), die übrigen über ihre id. Nie selbst berechnet.
    function withPreview(blocks, preview) {
        if (!preview) return blocks;
        const byId = {};
        const byIndex = {};
        (preview.view.corrections || []).forEach(correction => {
            if (correction.id != null) byId[correction.id] = correction;
            else byIndex[correction.create_index] = correction;
        });
        return blocks.map(block => {
            if (block.removed) return block;
            const index = preview.createKeys.indexOf(block.key);
            const source = index >= 0 ? byIndex[index] : byId[block.id];
            if (!source) return block;
            return {...block, appliedTo: source.applied_to ? toMs(source.applied_to) : null, previewed: true};
        });
    }

    // --- Direkte Bedienung ------------------------------------------------------------
    // snap: {stepMs, anchors, magnetMs, min, max}. Eine Magnet-Kante im Umkreis hat Vorrang vor
    // dem Raster; das Ergebnis liegt immer in [min, max] (max ist am laufenden Tag „jetzt“).

    const MIN_LENGTH_MS = MINUTE_MS;

    function magnetFor(ms, snap) {
        let best = null;
        (snap.anchors || []).forEach(anchor => {
            const distance = Math.abs(anchor - ms);
            if (distance <= (snap.magnetMs || 0) && (best == null || distance < Math.abs(best - ms))) best = anchor;
        });
        return best;
    }

    function clamp(ms, snap) {
        if (snap.max != null && ms > snap.max) ms = snap.max;
        if (snap.min != null && ms < snap.min) ms = snap.min;
        return ms;
    }

    function snapTime(ms, snap = {}) {
        const magnet = magnetFor(ms, snap);
        const step = snap.stepMs || MINUTE_MS;
        return clamp(magnet != null ? magnet : Math.round(ms / step) * step, snap);
    }

    // Neuer Beginn und neues Ende eines Blocks beim Ziehen.
    // mode: "move" (ganzer Block), "start"/"end" (Kante), "draw" (neuer Bereich ab origin.from).
    // origin: Block zu Beginn des Ziehens; deltaMs: Weg des Zeigers; pointerMs: Zeit unter dem Zeiger.
    function dragBlock(origin, mode, deltaMs, pointerMs, snap = {}) {
        if (mode === "start") {
            const upper = origin.to != null ? origin.to - MIN_LENGTH_MS : Infinity;
            return {from: Math.min(snapTime(pointerMs, snap), upper), to: origin.to};
        }
        if (mode === "end") {
            // Ein offener Wechsel bekommt so ein festes Ende und wird zum Bereich.
            return {from: origin.from, to: Math.max(snapTime(pointerMs, snap), origin.from + MIN_LENGTH_MS)};
        }
        if (mode === "draw") {
            const at = snapTime(pointerMs, snap);
            const from = Math.min(origin.from, at);
            return {from, to: Math.max(origin.from, at, from + MIN_LENGTH_MS)};
        }
        // Verschieben: die Kante, die einer Magnet-Kante am nächsten ist, rastet dort ein;
        // sonst rastet der Beginn im Raster. Die Länge bleibt, der Block bleibt in [min, max].
        const length = origin.to != null ? origin.to - origin.from : 0;
        const from = origin.from + deltaMs;
        const edges = origin.to != null ? [from, from + length] : [from];
        let shift = null;
        edges.forEach(edge => {
            const magnet = magnetFor(edge, snap);
            if (magnet != null && (shift == null || Math.abs(magnet - edge) < Math.abs(shift))) shift = magnet - edge;
        });
        if (shift == null) shift = snapTime(from, {stepMs: snap.stepMs}) - from;
        let start = from + shift;
        if (snap.max != null && start + length > snap.max) start = snap.max - length;
        if (snap.min != null && start < snap.min) start = snap.min;
        return {from: start, to: origin.to != null ? start + length : null};
    }

    // --- Fehler der SD-API ------------------------------------------------------------

    function errorMessage(payload) {
        const detail = payload && payload.detail;
        if (typeof detail === "string") return detail;
        if (detail && typeof detail.message === "string") return detail.message;
        if (Array.isArray(detail) && detail.length) return detail.map(item => item.msg).filter(Boolean).join(" · ");
        return "Die Anfrage konnte nicht verarbeitet werden.";
    }

    function errorCode(payload) {
        const detail = payload && payload.detail;
        return detail && !Array.isArray(detail) && typeof detail === "object" ? detail.code || "" : "";
    }

    // loc ["body","create",i,…] bzw. ["body","revoke",i,…] → Block. Fachliche Fehler kommen als
    // {code, message, loc}, Schemafehler im FastAPI-Format als Liste mit loc und msg.
    function errorTargets(payload, request, blocks) {
        const detail = payload && payload.detail;
        const items = Array.isArray(detail) ? detail.map(item => ({loc: item.loc, message: item.msg}))
            : detail && typeof detail === "object" ? [{loc: detail.loc, message: detail.message}] : [];
        const byBlock = {};
        items.forEach(item => {
            const loc = item.loc || [];
            let key = null;
            if (loc[0] === "body" && loc[1] === "create") key = request.createKeys[loc[2]] || null;
            if (loc[0] === "body" && loc[1] === "revoke") {
                const block = blocks.find(candidate => candidate.id === request.revoke[loc[2]]);
                key = block ? block.key : null;
            }
            if (key && !byBlock[key]) byBlock[key] = item.message || errorMessage(payload);
        });
        return {code: errorCode(payload), message: errorMessage(payload), byBlock};
    }

    // Eigene Änderungen als Text, zum Abschreiben nach einem Konflikt.
    function changeLines(blocks) {
        const period = block => block.to != null
            ? `${msToClock(block.from)}–${msToClock(block.to)}` : `ab ${msToClock(block.from)}`;
        return orderedBlocks(blocks).flatMap(block => {
            const state = blockState(block);
            const text = [`${block.status} ${period(block)}`, String(block.reason || "").trim()].filter(Boolean).join(" · ");
            if (state === "new") return [`neu: ${text}`];
            if (state === "changed") return [`#${block.id} geändert: ${text}`];
            if (state === "removed") return [`#${block.id} zurücknehmen: ${block.status} ${period(block)}`];
            return [];
        });
    }

    return {
        REASON_MAX,
        STATUSES,
        activeBlocks,
        blockError,
        blockState,
        buildChangeRequest,
        canSave,
        changeSummary,
        clockToMs,
        createBlock,
        hasChanges,
        latestMs,
        msToClock,
        needsReason,
        orderedBlocks,
        previewBody,
        previewKey,
        removeBlock,
        restoreBlock,
        saveBody,
        saveMessage,
        updateBlock,
        withPreview,
        axisTicks,
        blockEnd,
        berlinDateTime,
        berlinTime,
        changeLines,
        changeRows,
        dayHours,
        dayLabel,
        dragBlock,
        dayRange,
        describeChange,
        errorCode,
        errorMessage,
        errorTargets,
        findCorrection,
        isSearchable,
        layoutLanes,
        nowPercent,
        orderDays,
        percentAt,
        place,
        readSelection,
        revokedRows,
        selectionQuery,
        snapTime,
        timeAtPercent,
        toMs,
        viewRange,
        workRange,
    };
}));
