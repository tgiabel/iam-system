"use strict";

(function () {
    const Model = window.TimeCorrectionModel;
    const Timeline = window.TimeCorrectionTimeline;
    const BASE = "/api/time-corrections";
    const SEARCH_DELAY_MS = 250;
    const NOW_REFRESH_MS = 60 * 1000;
    const DEFAULT_RANGE_MS = 15 * 60 * 1000;
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const PREVIEW_DELAY_MS = 300;

    const state = {
        days: [],
        date: null,
        user: null,
        view: null,
        loadedAt: null,
        rangeMode: "work",
        editing: false,
        blocks: [],
        selectedKey: null,
        lastStatus: "ONLINE",
        newCount: 0,
        preview: null,
        previewState: "",
        previewToken: 0,
        saving: false,
        blockErrors: {},
        blocked: "",
        results: [],
        activeResult: -1,
        searchToken: 0,
        dayToken: 0,
    };
    const dom = {};

    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => (
        {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]
    ));

    async function api(path, options = {}) {
        const response = await fetch(BASE + path, {
            cache: "no-store",
            ...options,
            headers: {"Content-Type": "application/json", ...options.headers},
        });
        let payload = null;
        try { payload = await response.json(); } catch (_) { /* leerer oder kein JSON-Body */ }
        if (!response.ok) {
            const error = new Error(Model.errorMessage(payload));
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    function setStatus(message) {
        dom.status.textContent = message || "";
    }

    function updateUrl() {
        const query = Model.selectionQuery(state.user && state.user.user_id, state.date);
        history.replaceState(null, "", window.location.pathname + query);
    }

    // --- Mitarbeitersuche -------------------------------------------------------

    function closeResults() {
        state.results = [];
        state.activeResult = -1;
        dom.userList.hidden = true;
        dom.userList.innerHTML = "";
        dom.userQuery.setAttribute("aria-expanded", "false");
        dom.userQuery.removeAttribute("aria-activedescendant");
    }

    function renderResults() {
        if (!state.results.length) {
            dom.userList.innerHTML = '<li class="tc-user-empty" role="presentation">Keine Treffer</li>';
        } else {
            dom.userList.innerHTML = state.results.map((user, index) => (
                `<li id="tcUserOption${index}" role="option" class="tc-user-option${index === state.activeResult ? " is-active" : ""}"`
                + ` aria-selected="${index === state.activeResult}" data-index="${index}">${escapeHtml(user.name)}</li>`
            )).join("");
        }
        dom.userList.hidden = false;
        dom.userQuery.setAttribute("aria-expanded", "true");
        if (state.activeResult >= 0) {
            dom.userQuery.setAttribute("aria-activedescendant", `tcUserOption${state.activeResult}`);
        } else {
            dom.userQuery.removeAttribute("aria-activedescendant");
        }
    }

    async function searchUsers() {
        const query = dom.userQuery.value.trim();
        const token = ++state.searchToken;
        if (!Model.isSearchable(query)) {
            closeResults();
            return;
        }
        try {
            const users = await api("/users?q=" + encodeURIComponent(query));
            if (token !== state.searchToken) return;
            state.results = Array.isArray(users) ? users : [];
            state.activeResult = state.results.length ? 0 : -1;
            renderResults();
        } catch (error) {
            if (token !== state.searchToken) return;
            closeResults();
            setStatus(error.message);
        }
    }

    function selectUser(user) {
        if (!confirmDiscard()) return;
        state.searchToken++;
        closeResults();
        state.user = {user_id: user.user_id, name: user.name};
        dom.userQuery.value = user.name;
        updateUrl();
        loadDay();
    }

    function onQueryKeydown(event) {
        if (dom.userList.hidden || !state.results.length) {
            if (event.key === "Escape") closeResults();
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            state.activeResult = (state.activeResult + step + state.results.length) % state.results.length;
            renderResults();
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (state.activeResult >= 0) selectUser(state.results[state.activeResult]);
        } else if (event.key === "Escape") {
            closeResults();
        }
    }

    // --- Tage -------------------------------------------------------------------

    function renderDays() {
        dom.days.innerHTML = state.days.map((day, index) => (
            `<button type="button" class="ui-flat-button tc-day" data-date="${day}" aria-pressed="${day === state.date}">`
            + `${escapeHtml(Model.dayLabel(day, index))}</button>`
        )).join("");
    }

    function selectDay(date) {
        if (date === state.date || !confirmDiscard()) return;
        state.date = date;
        renderDays();
        updateUrl();
        loadDay();
    }

    // --- Tagesansicht -----------------------------------------------------------

    function formatClock(date) {
        return new Intl.DateTimeFormat("de-DE", {timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit"}).format(date);
    }

    function renderTimeline() {
        const view = state.view;
        dom.timelinePanel.hidden = !view;
        if (!view) {
            dom.timeline.innerHTML = "";
            return;
        }
        const range = Model.viewRange(view, state.rangeMode);
        const nowMs = Date.now();
        const focusedKey = document.activeElement && document.activeElement.dataset
            ? document.activeElement.dataset.key : null;
        dom.timeline.innerHTML = Timeline.axisHtml(range) + (state.editing
            ? Timeline.editorHtml(view, Model.withPreview(state.blocks, state.preview), range, {
                nowMs, selectedKey: state.selectedKey, errors: state.blockErrors,
                preview: state.preview && state.preview.view, previewState: state.previewState,
            })
            : Timeline.resultRowHtml(view, range, {nowMs}));
        if (focusedKey) {
            const block = dom.timeline.querySelector(`[data-key="${focusedKey}"]`);
            if (block) block.focus();
        }
        dom.rangeButtons.forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.range === state.rangeMode));
        });
        dom.edit.hidden = state.editing || Boolean(state.blocked);
        dom.editClose.hidden = !state.editing;
    }

    // --- Bearbeitungsmodus ------------------------------------------------------

    function isDirty() {
        const summary = Model.changeSummary(state.blocks);
        return state.editing && summary.created + summary.changed + summary.removed > 0;
    }

    function confirmDiscard() {
        return !isDirty() || window.confirm("Ungespeicherte Änderungen verwerfen?");
    }

    function renderEditor() {
        dom.editor.hidden = !state.editing;
        if (!state.editing) return;
        dom.save.disabled = state.saving || !Model.canSave(state.blocks, state.view, Date.now());
        const summary = Model.changeSummary(state.blocks);
        dom.summary.textContent = [
            summary.created && `${summary.created} neu`,
            summary.changed && `${summary.changed} geändert`,
            summary.removed && `${summary.removed} entfernt`,
        ].filter(Boolean).join(" · ");

        const block = state.blocks.find(item => item.key === state.selectedKey);
        dom.form.hidden = !block;
        if (!block) return;
        const removed = block.removed;
        dom.formTitle.textContent = block.id != null ? "#" + block.id : "neu";
        dom.formStatus.value = block.status;
        dom.formFrom.value = Model.msToClock(block.from);
        dom.formTo.value = block.to != null ? Model.msToClock(block.to) : "";
        dom.formOpen.checked = block.to == null;
        dom.formTo.disabled = removed || block.to == null;
        if (document.activeElement !== dom.formReason) dom.formReason.value = block.reason;
        [dom.formStatus, dom.formFrom, dom.formOpen, dom.formReason].forEach(input => { input.disabled = removed; });
        dom.formReason.setAttribute("aria-invalid", String(Model.needsReason(block)));
        dom.formRemove.textContent = removed ? "Wiederherstellen" : "Entfernen";
        // Nichts in der Zukunft: Die Zeitfelder enden am heutigen Tag bei „jetzt“.
        const latest = Model.latestMs(state.view, Date.now());
        const limit = latest < Model.dayRange(state.view).end ? Model.msToClock(latest) : "";
        [dom.formFrom, dom.formTo].forEach(input => {
            if (limit) input.max = limit; else input.removeAttribute("max");
        });
        dom.formError.textContent = state.blockErrors[block.key]
            || Model.blockError(block, state.view, Date.now())
            || (Model.needsReason(block) ? "Grund fehlt." : "");
    }

    function renderEditing() {
        renderTimeline();
        renderEditor();
    }

    function dayPath() {
        return `/days/${state.date}/users/${encodeURIComponent(state.user.user_id)}`;
    }

    // --- Vorschau und Speichern ---------------------------------------------------
    // Die Zusammenführung rechnet ausschließlich die SD-API. Nach jeder Änderung wird die
    // Vorschau neu angefordert; bis sie da ist, gilt das angezeigte Ergebnis als veraltet.

    let previewTimer = null;

    // Verwirft die Vorschau und die Fehler, die sich auf sie oder einen Speicherversuch beziehen.
    function resetPreview() {
        clearTimeout(previewTimer);
        state.previewToken++;
        state.preview = null;
        state.previewState = "";
        state.blockErrors = {};
    }

    function schedulePreview() {
        clearTimeout(previewTimer);
        state.previewToken++;
        const request = Model.buildChangeRequest(state.blocks);
        if (!Model.hasChanges(request)) {
            state.preview = null;
            state.previewState = "";
            return;
        }
        if (state.preview && state.preview.key === Model.previewKey(request)) {
            state.previewState = "preview";
            return;
        }
        if (state.blocks.some(block => Model.blockError(block, state.view, Date.now()))) {
            state.previewState = "stale";
            return;
        }
        state.previewState = "pending";
        previewTimer = setTimeout(runPreview, PREVIEW_DELAY_MS);
    }

    async function runPreview() {
        const request = Model.buildChangeRequest(state.blocks);
        const token = ++state.previewToken;
        try {
            const view = await api(dayPath() + "/preview", {method: "POST", body: JSON.stringify(Model.previewBody(request))});
            if (token !== state.previewToken || !state.editing) return;
            state.preview = {view, createKeys: request.createKeys, key: Model.previewKey(request)};
            state.previewState = "preview";
        } catch (error) {
            if (token !== state.previewToken || !state.editing) return;
            state.previewState = "error";
            if (!handleApiError(error, request)) setStatus(error.message);
        }
        renderEditing();
    }

    function changed() {
        state.blockErrors = {};
        schedulePreview();
        renderEditing();
    }

    // --- Direkte Bedienung --------------------------------------------------------
    // Ziehen am Körper verschiebt, an den Griffen ändert es Beginn oder Ende, auf der leeren
    // Zeile zeichnet es einen Bereich; ein Klick dort legt einen Wechsel ab Zeitpunkt an.
    // Die Zeiger-Erfassung hängt an #tcTimeline, weil die Zeile beim Ziehen neu gezeichnet wird.
    // Die Vorschau wird erst nach dem Loslassen angefordert.

    const DRAG_THRESHOLD_PX = 3;
    let drag = null;
    let frame = 0;

    function snapOptions() {
        const day = Model.dayRange(state.view);
        return {stepMs: 60 * 1000, anchors: [], magnetMs: 0, min: day.start, max: day.end};
    }

    function pointerMs(clientX) {
        const ratio = Math.min(1, Math.max(0, (clientX - drag.rect.left) / drag.rect.width));
        return Model.timeAtPercent(ratio * 100, drag.range);
    }

    function scheduleRender() {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
            frame = 0;
            renderEditing();
        });
    }

    function onPointerDown(event) {
        if (!state.editing || state.blocked || event.button !== 0) return;
        const track = event.target.closest(".tc-track-corrections");
        if (!track) return;
        const element = event.target.closest("[data-key]");
        const block = element ? state.blocks.find(item => item.key === element.dataset.key) : null;
        const handle = event.target.closest("[data-handle]");
        drag = {
            key: block ? block.key : null,
            mode: block ? (handle ? handle.dataset.handle : "move") : "draw",
            fixed: Boolean(block && block.removed),
            before: state.blocks,
            origin: block ? {from: block.from, to: block.to} : null,
            startX: event.clientX,
            rect: track.getBoundingClientRect(),
            range: Model.viewRange(state.view, state.rangeMode),
            moved: false,
        };
        drag.originMs = pointerMs(event.clientX);
        if (!block) drag.origin = {from: Model.snapTime(drag.originMs, snapOptions()), to: null};
        dom.timeline.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!drag || drag.fixed) return;
        if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
        if (!drag.moved) {
            drag.moved = true;
            dom.timeline.classList.add("tc-dragging");
            if (!drag.key) {
                drag.key = "n" + (++state.newCount);
                state.blocks = Model.createBlock(state.blocks,
                    {status: state.lastStatus, from: drag.origin.from, to: drag.origin.from + 60 * 1000}, drag.key);
            }
            state.selectedKey = drag.key;
            clearTimeout(previewTimer);
            state.previewToken++;
            state.previewState = "pending";
        }
        const at = pointerMs(event.clientX);
        state.blocks = Model.updateBlock(state.blocks, drag.key,
            Model.dragBlock(drag.origin, drag.mode, at - drag.originMs, at, snapOptions()));
        scheduleRender();
    }

    function finishDrag(cancel) {
        const current = drag;
        drag = null;
        dom.timeline.classList.remove("tc-dragging");
        if (cancel) {
            state.blocks = current.before;
            if (!state.blocks.some(block => block.key === state.selectedKey)) state.selectedKey = null;
            changed();
        } else if (current.moved) {
            changed();
        } else if (current.key) {
            selectBlock(current.key);
        } else {
            const key = "n" + (++state.newCount);
            state.blocks = Model.createBlock(state.blocks, {status: state.lastStatus, from: current.origin.from, to: null}, key);
            state.selectedKey = key;
            changed();
        }
    }

    function onPointerUp(event) {
        if (drag) finishDrag(event.type === "pointercancel");
    }

    // --- Fehler der SD-API --------------------------------------------------------
    // 409: jemand hat inzwischen gespeichert. day_not_allowed: der Tag ist nicht mehr heute oder
    // gestern. In beiden Fällen wird die Seite schreibgeschützt; das Modal zeigt die eigenen
    // Änderungen zum Abschreiben und bietet nur „Neu laden“ an. Übrige 422 stehen am Block.

    const MODAL_TITLES = {
        conflict: "Die Zeitleiste wurde inzwischen geändert.",
        day: "Tag nicht mehr korrigierbar.",
    };

    function openBlockedModal(kind) {
        state.blocked = kind;
        const lines = state.editing ? Model.changeLines(state.blocks) : [];
        dom.modalTitle.textContent = MODAL_TITLES[kind];
        dom.modalBody.hidden = !lines.length;
        dom.modalChanges.innerHTML = lines.map(line => `<li>${escapeHtml(line)}</li>`).join("");
        dom.modal.classList.add("active");
        dom.modal.setAttribute("aria-hidden", "false");
        clearTimeout(previewTimer);
        renderTimeline();
        dom.modalReload.focus();
    }

    function reloadAfterBlock() {
        const kind = state.blocked;
        dom.modal.classList.remove("active");
        dom.modal.setAttribute("aria-hidden", "true");
        state.blocked = "";
        if (kind === "day") {
            // Die Tage ändern sich um Mitternacht; die Seite lädt sie neu und fällt auf heute zurück.
            state.editing = false;
            window.location.reload();
            return;
        }
        loadDay();
    }

    // Liefert true, wenn der Fehler behandelt ist (Modal oder Block).
    function handleApiError(error, request) {
        const code = Model.errorCode(error.payload);
        if (error.status === 409 || code === "day_not_allowed") {
            openBlockedModal(error.status === 409 ? "conflict" : "day");
            return true;
        }
        if (error.status !== 422 || !request) return false;
        const targets = Model.errorTargets(error.payload, request, state.blocks);
        const keys = Object.keys(targets.byBlock);
        if (!keys.length) return false;
        state.blockErrors = targets.byBlock;
        state.selectedKey = keys[0];
        return true;
    }

    async function save() {
        const request = Model.buildChangeRequest(state.blocks);
        if (!Model.canSave(state.blocks, state.view, Date.now()) || state.saving) return;
        state.saving = true;
        renderEditor();
        try {
            const view = await api(dayPath(), {method: "POST", body: JSON.stringify(Model.saveBody(request, state.view.revision))});
            resetPreview();
            state.view = view;
            state.loadedAt = new Date();
            state.editing = false;
            state.blocks = [];
            state.selectedKey = null;
            setStatus(Model.saveMessage(request));
        } catch (error) {
            if (!handleApiError(error, request)) setStatus(error.message);
        } finally {
            state.saving = false;
        }
        render();
    }

    function startEditing() {
        if (!state.view) return;
        state.editing = true;
        state.blocks = Model.activeBlocks(state.view);
        state.selectedKey = null;
        resetPreview();
        setStatus("");
        renderEditing();
    }

    function stopEditing() {
        if (!confirmDiscard()) return;
        state.editing = false;
        state.blocks = [];
        state.selectedKey = null;
        resetPreview();
        renderEditing();
    }

    function selectBlock(key) {
        state.selectedKey = state.selectedKey === key ? null : key;
        renderEditing();
    }

    function selectedBlock() {
        return state.blocks.find(block => block.key === state.selectedKey) || null;
    }

    function patchSelected(patch) {
        state.blocks = Model.updateBlock(state.blocks, state.selectedKey, patch);
        changed();
    }

    function addBlock() {
        const view = state.view;
        const latest = Model.latestMs(view, Date.now());
        const eight = Model.clockToMs(view, "08:00");
        // Vorbelegung: 08:00, am laufenden Tag höchstens „jetzt“ (auf 5 Minuten abgerundet).
        const from = Math.max(Model.dayRange(view).start,
            Math.min(eight ?? latest, Math.floor(latest / FIVE_MINUTES_MS) * FIVE_MINUTES_MS));
        const key = "n" + (++state.newCount);
        state.blocks = Model.createBlock(state.blocks, {status: state.lastStatus, from, to: null}, key);
        state.selectedKey = key;
        changed();
        dom.formFrom.focus();
    }

    // Eingegebene Zeit: als Ende steht 00:00 für Mitternacht; am laufenden Tag höchstens „jetzt“.
    function readClock(input, isEnd) {
        const ms = Model.clockToMs(state.view, input.value, isEnd);
        if (ms == null) return null;
        return Math.min(ms, Model.latestMs(state.view, Date.now()));
    }

    function onFormChange(event) {
        const block = selectedBlock();
        if (!block) return;
        const target = event.target;
        if (target === dom.formStatus) {
            state.lastStatus = target.value;
            patchSelected({status: target.value});
        } else if (target === dom.formFrom) {
            const from = readClock(target, false);
            if (from == null) { renderEditor(); return; }
            patchSelected({from});
        } else if (target === dom.formTo) {
            const to = readClock(target, true);
            if (to == null) { renderEditor(); return; }
            patchSelected({to});
        } else if (target === dom.formOpen) {
            const latest = Model.latestMs(state.view, Date.now());
            const end = Math.min(Model.blockEnd(block) > block.from ? Model.blockEnd(block) : block.from + DEFAULT_RANGE_MS,
                latest, Model.dayRange(state.view).end);
            patchSelected({to: target.checked ? null : end});
        }
    }

    function onReasonInput() {
        if (!selectedBlock()) return;
        patchSelected({reason: dom.formReason.value});
    }

    function onRemoveClick() {
        const block = selectedBlock();
        if (!block) return;
        if (block.removed) {
            state.blocks = Model.restoreBlock(state.blocks, block.key);
        } else {
            state.blocks = Model.removeBlock(state.blocks, block.key);
            if (block.id == null) state.selectedKey = null;
        }
        changed();
    }

    function onTimelineActivate(event) {
        if (!state.editing || (event.key !== "Enter" && event.key !== " ")) return;
        const target = event.target.closest("[data-key]");
        if (!target) return;
        event.preventDefault();
        selectBlock(target.dataset.key);
    }

    function renderChanges() {
        dom.changesBox.hidden = !state.view;
        dom.changes.innerHTML = state.view ? Timeline.changeListHtml(state.view) : "";
        dom.changeCount.textContent = state.view ? `(${Model.changeRows(state.view).length})` : "";
        const revoked = state.view ? Model.revokedRows(state.view).length : 0;
        dom.revokedBox.hidden = !revoked;
        dom.revoked.innerHTML = revoked ? Timeline.revokedListHtml(state.view) : "";
        dom.revokedCount.textContent = revoked ? `(${revoked})` : "";
    }

    function render() {
        const hasUser = Boolean(state.user);
        dom.empty.hidden = hasUser;
        dom.reload.hidden = !hasUser;
        dom.loadedAt.textContent = state.loadedAt ? "Stand " + formatClock(state.loadedAt) : "";
        renderTimeline();
        renderEditor();
        renderChanges();
    }

    async function loadDay() {
        if (!state.user || !state.date) {
            render();
            return;
        }
        const token = ++state.dayToken;
        resetPreview();
        state.editing = false;
        state.blocks = [];
        state.selectedKey = null;
        state.view = null;
        state.loadedAt = null;
        setStatus("Lädt …");
        render();
        try {
            const view = await api(`/days/${state.date}/users/${encodeURIComponent(state.user.user_id)}`);
            if (token !== state.dayToken) return;
            state.view = view;
            state.user = view.user;
            state.loadedAt = new Date();
            dom.userQuery.value = view.user.name;
            setStatus("");
        } catch (error) {
            if (token !== state.dayToken) return;
            if (!handleApiError(error, null)) setStatus(error.message);
        }
        render();
    }

    // --- Start ------------------------------------------------------------------

    async function init() {
        dom.root = document.getElementById("tcTool");
        if (!dom.root) return;
        ["userQuery", "userList", "days", "loadedAt", "reload", "status", "empty", "timelinePanel", "timeline", "changesBox", "changes", "changeCount", "revokedBox", "revoked", "revokedCount", "edit", "editClose",
            "editor", "add", "summary", "form", "formTitle", "formStatus", "formFrom", "formTo", "formOpen", "formReason",
            "formRemove", "formError", "save",
            "modal", "modalTitle", "modalBody", "modalChanges", "modalReload"].forEach(key => {
            dom[key] = document.getElementById("tc" + key[0].toUpperCase() + key.slice(1));
        });

        let timer;
        dom.userQuery.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(searchUsers, SEARCH_DELAY_MS);
        });
        dom.userQuery.addEventListener("keydown", onQueryKeydown);
        dom.userQuery.addEventListener("blur", () => setTimeout(closeResults, 150));
        // mousedown statt click, damit die Auswahl vor dem blur des Eingabefelds greift.
        dom.userList.addEventListener("mousedown", event => {
            const option = event.target.closest("[data-index]");
            if (!option) return;
            event.preventDefault();
            selectUser(state.results[Number(option.dataset.index)]);
        });
        dom.days.addEventListener("click", event => {
            const button = event.target.closest("[data-date]");
            if (button) selectDay(button.dataset.date);
        });
        dom.reload.addEventListener("click", () => { if (confirmDiscard()) loadDay(); });
        dom.edit.addEventListener("click", startEditing);
        dom.editClose.addEventListener("click", stopEditing);
        dom.add.addEventListener("click", addBlock);
        dom.save.addEventListener("click", save);
        dom.modalReload.addEventListener("click", reloadAfterBlock);
        dom.form.addEventListener("change", onFormChange);
        dom.form.addEventListener("submit", event => event.preventDefault());
        dom.formReason.addEventListener("input", onReasonInput);
        dom.formRemove.addEventListener("click", onRemoveClick);
        dom.timeline.addEventListener("pointerdown", onPointerDown);
        dom.timeline.addEventListener("pointermove", onPointerMove);
        dom.timeline.addEventListener("pointerup", onPointerUp);
        dom.timeline.addEventListener("pointercancel", onPointerUp);
        document.addEventListener("keydown", event => {
            if (drag && event.key === "Escape") finishDrag(true);
        });
        dom.timeline.addEventListener("keydown", onTimelineActivate);
        window.addEventListener("beforeunload", event => {
            if (!isDirty() || state.blocked) return;
            event.preventDefault();
            event.returnValue = "";
        });
        dom.rangeButtons = [...dom.root.querySelectorAll("[data-range]")];
        dom.rangeButtons.forEach(button => button.addEventListener("click", () => {
            state.rangeMode = button.dataset.range;
            renderTimeline();
        }));
        // Die Linie „jetzt“ wandert mit; neu geladen wird dabei nichts.
        setInterval(renderTimeline, NOW_REFRESH_MS);

        try {
            const payload = await api("/days");
            state.days = Model.orderDays(payload.days);
        } catch (error) {
            setStatus(error.message);
            return;
        }
        const selection = Model.readSelection(window.location.search, state.days);
        state.date = selection.date;
        state.user = selection.userId ? {user_id: selection.userId, name: ""} : null;
        renderDays();
        updateUrl();
        loadDay();
    }

    document.addEventListener("DOMContentLoaded", init);
}());
