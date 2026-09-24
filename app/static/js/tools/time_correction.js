"use strict";

(function () {
    const Model = window.TimeCorrectionModel;
    const Timeline = window.TimeCorrectionTimeline;
    const BASE = "/api/time-corrections";
    const SEARCH_DELAY_MS = 250;
    const NOW_REFRESH_MS = 60 * 1000;
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const PREVIEW_DELAY_MS = 300;

    // Die Kacheln zeigen alle Mitarbeiter des Tages, eine Zeitleiste aber immer nur für einen
    // (visible hat höchstens einen Eintrag). Bearbeiten liegt in editing, nicht im Eintrag.
    const state = {
        days: [],
        date: null,
        rangeMode: "work",
        chips: [],          // Tagesliste der SD-API: [{user_id, name, logged_seconds, pause_seconds}]
        picked: null,       // über die Suche gewählter Mitarbeiter {user_id, name}; bleibt nicht als Kachel
        chipSort: "name",
        visible: [],        // aktiver Mitarbeiter (höchstens einer)
        entries: {},        // user_id → {user, view, error, loading, token, expanded, selectedKey, editKey}
        editing: null,      // {userId, blocks, preview, previewState, previewToken, blockErrors, saving}
        lastStatus: "ONLINE",
        newCount: 0,
        loadedAt: null,
        blocked: "",
        results: [],
        activeResult: -1,
        searchToken: 0,
        summaryToken: 0,
    };
    const dom = {};
    const sections = {};
    const SORT_KEY = "sofa.timeCorrection.chipSort";

    // Sortierung der Kacheln je Browser merken; ohne Speicher (privates Fenster) gilt „Name“.
    function readChipSort() {
        try {
            const value = window.localStorage.getItem(SORT_KEY);
            return value && Object.prototype.hasOwnProperty.call(Model.CHIP_SORTS, value) ? value : "name";
        } catch (_) {
            return "name";
        }
    }

    function writeChipSort(value) {
        try { window.localStorage.setItem(SORT_KEY, value); } catch (_) { /* nur Komfort */ }
    }    // user_id → Teile des Panels (bleiben beim Neuzeichnen erhalten)

    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => (
        {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]
    ));

    const ICONS = {
        edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
        save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        cancel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    };

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
        history.replaceState(null, "", window.location.pathname + Model.selectionQuery(state.visible, state.date));
    }

    function dayPath(userId) {
        return `/days/${state.date}/users/${encodeURIComponent(userId)}`;
    }

    function isEditableDay() {
        return Model.isEditableDay(state.date, state.days);
    }

    // --- Mitarbeiter-Kacheln ----------------------------------------------------
    // Ganz links, abgetrennt, der aktive Mitarbeiter (aus der Suche oder aus der Tagesliste);
    // daneben die Tagesliste der SD-API. Ein Mitarbeiter aus der Tagesliste steht dann doppelt,
    // beide hervorgehoben. Log- und Pausenzeit aus der geladenen Tagesansicht, sonst aus der Liste.

    function nameOf(userId) {
        const entry = state.entries[userId];
        const chip = state.chips.find(item => item.user_id === userId);
        const picked = state.picked && state.picked.user_id === userId ? state.picked : null;
        return (entry && entry.user.name) || (chip && chip.name) || (picked && picked.name) || "";
    }

    // Werte aus der geladenen Tagesansicht, sonst aus der Tagesliste (corrections: Anforderung A3).
    function chipFor(userId) {
        const entry = state.entries[userId];
        const chip = state.chips.find(item => item.user_id === userId);
        const loaded = entry && entry.view;
        const sums = loaded ? Model.dayTotals(entry.view, Date.now())
            : chip ? {logged: chip.logged_seconds, pause: chip.pause_seconds} : {logged: null, pause: null};
        const corrections = loaded ? Model.correctionCount(entry.view) : (chip ? chip.corrections : null);
        return {user_id: userId, name: nameOf(userId), logged: sums.logged, pause: sums.pause, corrections, manual: !chip};
    }

    function chipList() {
        return Model.sortChips(state.chips.map(chip => chipFor(chip.user_id)), state.chipSort);
    }

    function orderedVisible() {
        return state.visible.slice();
    }

    function renderChips() {
        const active = state.visible[0];
        const slot = active
            ? `<div class="tc-chips-active">${Timeline.chipsHtml([chipFor(active)], state.visible)}</div>`
                + '<div class="tc-chips-sep" aria-hidden="true"></div>'
            : "";
        dom.chips.innerHTML = slot + Timeline.chipsHtml(chipList(), state.visible);
        dom.chipsWrap.hidden = !dom.chips.innerHTML;
        dom.sortMenu.querySelectorAll("[data-sort]").forEach(item => {
            item.setAttribute("aria-checked", String(item.dataset.sort === state.chipSort));
        });
    }

    // Sortier-Icon unten links an der Kachelleiste; die Wahl steht nur im Menü.
    function toggleSortMenu(open) {
        const show = open ?? dom.sortMenu.hidden;
        dom.sortMenu.hidden = !show;
        dom.sort.setAttribute("aria-expanded", String(show));
        if (show) {
            const current = dom.sortMenu.querySelector(`[data-sort="${state.chipSort}"]`);
            if (current) current.focus();
        }
    }

    function chooseSort(value) {
        state.chipSort = value;
        writeChipSort(value);
        toggleSortMenu(false);
        dom.sort.focus();
        renderChips();
    }

    // Nur einer ist aktiv: eine andere Kachel wechselt die Zeitleiste.
    function showUser(userId) {
        if (state.visible.includes(userId)) return;
        withDiscard(() => {
            state.editing = null;
            if (state.picked && state.picked.user_id !== userId) state.picked = null;
            state.visible = [userId];
            updateUrl();
            loadEntry(userId);
        });
    }

    function hideUser(userId) {
        withDiscard(() => {
            state.editing = null;
            state.visible = state.visible.filter(id => id !== userId);
            updateUrl();
            render();
        });
    }

    function toggleUser(userId) {
        if (state.visible.includes(userId)) hideUser(userId);
        else showUser(userId);
    }

    // --- Mitarbeitersuche -------------------------------------------------------
    // Ein Treffer wird aktiv; einer ohne Buchung bekommt dazu vorn eine Kachel.

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
            // Mit dem Tag findet die SD-API auch Mitarbeiter, die seitdem aus Genesys entfernt wurden.
            const users = await api(`/users?q=${encodeURIComponent(query)}&date=${state.date}`);
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
        state.searchToken++;
        closeResults();
        dom.userQuery.value = "";
        state.picked = {user_id: user.user_id, name: user.name};
        if (state.visible.includes(user.user_id)) render();
        else showUser(user.user_id);
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

    // Von links: „Datum wählen“ (bzw. der gewählte ältere Tag), gestern, heute.
    function renderDays() {
        dom.days.innerHTML = state.days.map((day, index) => (
            `<button type="button" class="ui-flat-button tc-day" data-date="${day}" aria-pressed="${day === state.date}">`
            + `${escapeHtml(Model.dayLabel(day, index))}</button>`
        )).reverse().join("");
        const picked = Boolean(state.date) && !state.days.includes(state.date);
        dom.pickDay.textContent = picked ? Model.dayLabel(state.date, -1) : "Datum wählen";
        dom.pickDay.setAttribute("aria-pressed", String(picked));
        dom.dayPicker.max = state.days[0] || "";
        dom.dayPicker.value = state.date || "";
        // Pfeile springen einen Tag zurück bzw. vor; nach heute gibt es nichts.
        // Ohne Ziel nur unsichtbar, damit die Tage nicht verrutschen.
        [[dom.dayPrev, -1], [dom.dayNext, 1]].forEach(([button, amount]) => {
            const off = !state.date || !Model.shiftDay(state.date, amount, state.days);
            button.classList.toggle("is-off", off);
            button.disabled = off;
            button.setAttribute("aria-hidden", String(off));
        });
    }

    function openDayPicker() {
        if (typeof dom.dayPicker.showPicker === "function") {
            try {
                dom.dayPicker.showPicker();
                return;
            } catch (_) { /* ohne Nutzergeste oder nicht unterstützt: Feld fokussieren */ }
        }
        dom.dayPicker.focus();
        dom.dayPicker.click();
    }

    function selectDay(date) {
        if (!Model.isPickableDay(date, state.days)) {
            renderDays();
            return;
        }
        if (date === state.date) return;
        withDiscard(() => {
            state.date = date;
            renderDays();
            updateUrl();
            loadDate();
        }, renderDays);
    }

    // --- Laden ------------------------------------------------------------------

    // Tagesliste und alle angezeigten Zeitleisten für den gewählten Tag.
    function loadDate() {
        state.editing = null;
        state.chips = [];
        state.entries = {};
        state.loadedAt = new Date();
        setStatus("");
        loadSummary();
        state.visible.forEach(loadEntry);
        render();
    }

    async function loadSummary() {
        const token = ++state.summaryToken;
        try {
            const data = await api(`/days/${state.date}/users`);
            if (token !== state.summaryToken) return;
            state.chips = data && Array.isArray(data.users) ? data.users : [];
        } catch (error) {
            if (token !== state.summaryToken) return;
            state.chips = [];
            // Solange die SD-API die Tagesliste nicht kennt (404), gibt es nur Kacheln aus der Suche.
            const oldDay = !isEditableDay() && Model.errorCode(error.payload) === "day_not_allowed";
            if (error.status !== 404 && !oldDay) setStatus(error.message);
        }
        render();
    }

    async function loadEntry(userId) {
        const entry = state.entries[userId]
            || (state.entries[userId] = {user: {user_id: userId, name: nameOf(userId)}, expanded: false, token: 0});
        const token = ++entry.token;
        entry.view = null;
        entry.error = "";
        entry.loading = true;
        entry.selectedKey = null;
        entry.editKey = null;
        render();
        try {
            const view = await api(dayPath(userId));
            if (token !== entry.token) return;
            entry.view = view;
            entry.user = view.user;
        } catch (error) {
            if (token !== entry.token) return;
            const code = Model.errorCode(error.payload);
            // Ältere Tage liefert die SD-API (noch) nicht aus; das ist kein Mitternachtswechsel.
            if (code === "day_not_allowed" && !isEditableDay()) entry.error = "Keine Daten für diesen Tag.";
            else if (code === "day_not_allowed") openBlockedModal("day");
            else entry.error = error.message;
        }
        entry.loading = false;
        render();
    }

    // --- Darstellung ------------------------------------------------------------

    function formatClock(date) {
        return new Intl.DateTimeFormat("de-DE", {timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit"}).format(date);
    }

    function editingFor(userId) {
        return state.editing && state.editing.userId === userId ? state.editing : null;
    }

    // Gemeinsame Skala aller angezeigten Zeitleisten. Beim Ziehen bleibt sie stehen,
    // sonst verschöbe sie sich unter dem Zeiger.
    function currentRange() {
        if (drag) return drag.range;
        return Model.unionRange(orderedVisible().map(userId => {
            const entry = state.entries[userId];
            if (!entry || !entry.view) return null;
            const editing = editingFor(userId);
            return Model.viewRange(entry.view, state.rangeMode, editing ? editing.blocks : undefined);
        }));
    }

    function element(tag, className, html = "") {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html) node.innerHTML = html;
        return node;
    }

    function iconButton(className, action, label, icon) {
        const button = element("button", className, icon);
        button.type = "button";
        button.dataset.panelAction = action;
        button.setAttribute("aria-label", label);
        button.title = label;
        return button;
    }

    // Panel eines Mitarbeiters: Name, Zeitleiste mit Aufklapp-Pfeil, rechts Bearbeiten bzw.
    // Speichern/Abbrechen, darunter die Kacheln.
    function createSection(userId) {
        const parts = {root: element("section", "tc-user")};
        parts.root.dataset.user = userId;
        parts.name = element("div", "tc-user-name");
        parts.kpis = element("div", "tc-kpis");
        const stage = element("div", "tc-stage");
        const panel = element("div", "tc-panel tc-timeline-panel");
        parts.expand = iconButton("tc-expand", "expand", "Details", ICONS.expand);
        parts.timeline = element("div", "tc-timeline");
        parts.timeline.dataset.timeline = userId;
        parts.status = element("p", "tc-panel-status");
        panel.append(parts.expand, parts.timeline, parts.status);
        const side = element("div", "tc-side");
        parts.edit = iconButton("tc-icon-btn", "edit", "Bearbeiten", ICONS.edit);
        parts.save = iconButton("tc-icon-btn tc-icon-primary", "save", "Speichern", ICONS.save);
        parts.saveCount = element("span", "tc-icon-badge");
        parts.save.append(parts.saveCount);
        parts.cancel = iconButton("tc-icon-btn", "cancel", "Abbrechen", ICONS.cancel);
        side.append(parts.edit, parts.save, parts.cancel);
        stage.append(panel, side);
        parts.tiles = element("div", "tc-tiles");
        parts.tiles.dataset.tiles = userId;
        parts.tiles.setAttribute("aria-label", "Korrekturen");
        parts.root.append(parts.name, parts.kpis, stage, parts.tiles);
        return parts;
    }

    function renderTimeline(userId) {
        const parts = sections[userId];
        const entry = state.entries[userId];
        if (!parts) return;
        const view = entry && entry.view;
        parts.status.textContent = entry ? (entry.error || (entry.loading ? "Lädt …" : "")) : "";
        parts.expand.hidden = !view || Boolean(editingFor(userId));
        if (!view) {
            parts.timeline.innerHTML = "";
            parts.kpis.innerHTML = "";
            return;
        }
        const range = currentRange() || Model.viewRange(view, state.rangeMode);
        const nowMs = Date.now();
        const editing = editingFor(userId);
        let rows;
        if (editing) {
            rows = Timeline.editorHtml(view, Model.withPreview(editing.blocks, editing.preview), range, {
                nowMs, selectedKey: entry.selectedKey, errors: editing.blockErrors,
                preview: editing.preview && editing.preview.view, previewState: editing.previewState,
            });
        } else if (entry.expanded) {
            rows = Timeline.editorHtml(view, Model.activeBlocks(view), range, {nowMs, selectedKey: entry.selectedKey, readOnly: true});
        } else {
            rows = Timeline.resultRowHtml(view, range, {nowMs});
        }
        const focusedKey = document.activeElement && document.activeElement.dataset
            && parts.timeline.contains && parts.timeline.contains(document.activeElement)
            ? document.activeElement.dataset.key : null;
        parts.timeline.innerHTML = Timeline.axisHtml(range) + rows;
        // Kennzahlen: im Bearbeiten aus der Vorschau, sobald sie da ist.
        const shown = editing && editing.previewState === "preview" && editing.preview ? editing.preview.view : view;
        parts.kpis.innerHTML = Timeline.kpisHtml(shown, nowMs);
        parts.expand.setAttribute("aria-expanded", String(Boolean(entry.expanded)));
        if (focusedKey) {
            const block = parts.timeline.querySelector(`[data-key="${focusedKey}"]`);
            if (block) block.focus();
        }
    }

    // Rechts neben dem Panel: Bearbeiten, im Bearbeitungsmodus Speichern und Abbrechen.
    function renderSide(userId) {
        const parts = sections[userId];
        const entry = state.entries[userId];
        if (!parts) return;
        const editing = editingFor(userId);
        parts.edit.hidden = Boolean(editing) || !entry || !entry.view || Boolean(state.blocked) || !isEditableDay();
        parts.save.hidden = !editing;
        parts.cancel.hidden = !editing;
        if (!editing) return;
        const summary = Model.changeSummary(editing.blocks);
        const count = summary.created + summary.changed + summary.removed;
        parts.save.disabled = editing.saving || !Model.canSave(editing.blocks, entry.view, Date.now());
        parts.saveCount.textContent = count ? String(count) : "";
        parts.save.title = ["Speichern",
            summary.created && `${summary.created} neu`,
            summary.changed && `${summary.changed} geändert`,
            summary.removed && `${summary.removed} entfernt`,
        ].filter(Boolean).join(" · ");
    }

    function tileOptions(userId) {
        const entry = state.entries[userId];
        const editing = editingFor(userId);
        const nowMs = Date.now();
        const latest = Model.latestMs(entry.view, nowMs);
        return {
            view: entry.view, nowMs, selectedKey: entry.selectedKey, editKey: entry.editKey,
            errors: editing ? editing.blockErrors : {}, readOnly: !editing,
            // Nichts in der Zukunft: Am laufenden Tag enden die Zeitfelder bei „jetzt“.
            maxClock: latest < Model.dayRange(entry.view).end ? Model.msToClock(latest) : "",
        };
    }

    // Kacheln im Bearbeitungsmodus und, nur lesend, in der aufgeklappten Ansicht.
    function renderTiles(userId) {
        const parts = sections[userId];
        const entry = state.entries[userId];
        if (!parts) return;
        const editing = editingFor(userId);
        const shown = Boolean(entry && entry.view) && (Boolean(editing) || entry.expanded);
        parts.tiles.hidden = !shown;
        if (!shown) {
            parts.tiles.innerHTML = "";
            return;
        }
        const scroll = parts.tiles.scrollLeft;
        const blocks = editing ? editing.blocks : Model.activeBlocks(entry.view);
        parts.tiles.innerHTML = Timeline.tilesHtml(blocks, Model.revokedBlocks(entry.view), tileOptions(userId));
        parts.tiles.scrollLeft = scroll;
        const selected = parts.tiles.querySelector && parts.tiles.querySelector(".is-expanded");
        if (selected && selected.scrollIntoView) selected.scrollIntoView({block: "nearest", inline: "nearest"});
    }

    // Beim Tippen nur Klassen und Meldung der einen Kachel nachziehen, damit der Fokus bleibt.
    function refreshTile(userId, key) {
        const parts = sections[userId];
        const editing = editingFor(userId);
        const tile = parts && parts.tiles.querySelector && parts.tiles.querySelector(`[data-tile="${key}"]`);
        const block = editing && editing.blocks.find(item => item.key === key);
        if (!tile || !block) return;
        const options = tileOptions(userId);
        tile.className = Timeline.tileClass(block, options);
        const error = tile.querySelector(".tc-tile-error");
        if (error) error.textContent = Model.blockMessage(block, options.view, options.nowMs, editing.blockErrors[key]);
    }

    function renderUser(userId) {
        const parts = sections[userId];
        if (!parts) return;
        parts.name.textContent = nameOf(userId) || "…";
        renderTimeline(userId);
        renderSide(userId);
        renderTiles(userId);
    }

    // Panels in der Reihenfolge der Kacheln; ausgeblendete werden entfernt.
    function renderUsers() {
        const order = orderedVisible();
        Object.keys(sections).forEach(userId => {
            if (order.includes(userId)) return;
            sections[userId].root.remove();
            delete sections[userId];
        });
        order.forEach((userId, index) => {
            if (!sections[userId]) sections[userId] = createSection(userId);
            const root = sections[userId].root;
            if (dom.users.children[index] !== root) dom.users.insertBefore(root, dom.users.children[index] || null);
            renderUser(userId);
        });
    }

    function renderTimelines() {
        orderedVisible().forEach(renderTimeline);
    }

    function renderChanges() {
        const items = orderedVisible().map(userId => state.entries[userId])
            .filter(entry => entry && entry.view).map(entry => ({name: entry.user.name, view: entry.view}));
        dom.changesBox.hidden = !items.length;
        dom.changes.innerHTML = items.length ? Timeline.changeListHtml(items) : "";
        dom.changeCount.textContent = items.length ? `(${Model.combinedChangeRows(items).length})` : "";
    }

    function render() {
        const anyView = state.visible.some(userId => state.entries[userId] && state.entries[userId].view);
        dom.empty.hidden = state.visible.length > 0;
        dom.range.hidden = !anyView;
        dom.reload.hidden = !state.date;
        dom.loadedAt.textContent = state.loadedAt ? "Stand " + formatClock(state.loadedAt) : "";
        dom.rangeButtons.forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.range === state.rangeMode));
        });
        renderChips();
        renderUsers();
        renderChanges();
    }

    // --- Bearbeitungsmodus ------------------------------------------------------

    function isDirty() {
        if (!state.editing) return false;
        const summary = Model.changeSummary(state.editing.blocks);
        return summary.created + summary.changed + summary.removed > 0;
    }

    // Nachfrage vor dem Verwerfen ungespeicherter Änderungen als eigenes Modal. action läuft
    // sofort, wenn nichts ungespeichert ist, sonst erst nach „Verwerfen“; onCancel nach
    // „Weiter bearbeiten“ (z. B. um die Datumswahl zurückzusetzen).
    let pendingDiscard = null;

    function withDiscard(action, onCancel = null) {
        if (!isDirty()) {
            action();
            return;
        }
        pendingDiscard = {action, onCancel};
        dom.confirmChanges.innerHTML = Model.changeLines(state.editing.blocks)
            .map(line => `<li>${escapeHtml(line)}</li>`).join("");
        dom.confirm.classList.add("active");
        dom.confirm.setAttribute("aria-hidden", "false");
        dom.confirmKeep.focus();
    }

    function closeConfirm(discard) {
        const pending = pendingDiscard;
        pendingDiscard = null;
        dom.confirm.classList.remove("active");
        dom.confirm.setAttribute("aria-hidden", "true");
        if (!pending) return;
        if (discard) {
            clearTimeout(previewTimer);
            const userId = state.editing && state.editing.userId;
            state.editing = null;
            if (userId && state.entries[userId]) {
                state.entries[userId].selectedKey = null;
                state.entries[userId].editKey = null;
            }
            pending.action();
            if (userId && sections[userId]) renderUser(userId);
        } else if (pending.onCancel) {
            pending.onCancel();
        }
    }

    function startEditing(userId) {
        const entry = state.entries[userId];
        if (!entry || !entry.view || !isEditableDay()) return;
        if (state.editing && state.editing.userId !== userId) {
            withDiscard(() => beginEditing(userId));
            return;
        }
        beginEditing(userId);
    }

    function beginEditing(userId) {
        const entry = state.entries[userId];
        const previous = state.editing && state.editing.userId;
        state.editing = {
            userId, blocks: Model.activeBlocks(entry.view), preview: null, previewState: "",
            previewToken: 0, blockErrors: {}, saving: false,
        };
        entry.selectedKey = null;
        entry.editKey = null;
        setStatus("");
        if (previous && state.entries[previous]) renderUser(previous);
        renderTimelines();
        renderUser(userId);
    }

    function stopEditing() {
        if (!state.editing) return;
        const userId = state.editing.userId;
        withDiscard(() => {
            clearTimeout(previewTimer);
            state.editing = null;
            const entry = state.entries[userId];
            if (entry) {
                entry.selectedKey = null;
                entry.editKey = null;
            }
            renderTimelines();
            renderUser(userId);
        });
    }

    // Auswahl: Block in der Zeile und ausgeklappte Kachel sind dasselbe.
    function selectBlock(userId, key) {
        const entry = state.entries[userId];
        entry.selectedKey = entry.selectedKey === key ? null : key;
        if (entry.editKey !== entry.selectedKey) entry.editKey = null;
        renderTimeline(userId);
        renderTiles(userId);
    }

    // --- Vorschau und Speichern ---------------------------------------------------
    // Die Zusammenführung rechnet ausschließlich die SD-API. Nach jeder Änderung wird die
    // Vorschau neu angefordert; bis sie da ist, gilt die angezeigte Zeitbuchung als veraltet.

    let previewTimer = null;

    function schedulePreview() {
        const editing = state.editing;
        clearTimeout(previewTimer);
        editing.previewToken++;
        const request = Model.buildChangeRequest(editing.blocks);
        const view = state.entries[editing.userId].view;
        if (!Model.hasChanges(request)) {
            editing.preview = null;
            editing.previewState = "";
            return;
        }
        if (editing.preview && editing.preview.key === Model.previewKey(request)) {
            editing.previewState = "preview";
            return;
        }
        if (editing.blocks.some(block => Model.blockError(block, view, Date.now()))) {
            editing.previewState = "stale";
            return;
        }
        editing.previewState = "pending";
        previewTimer = setTimeout(runPreview, PREVIEW_DELAY_MS);
    }

    async function runPreview() {
        const editing = state.editing;
        if (!editing) return;
        const request = Model.buildChangeRequest(editing.blocks);
        const token = ++editing.previewToken;
        try {
            const view = await api(dayPath(editing.userId) + "/preview",
                {method: "POST", body: JSON.stringify(Model.previewBody(request))});
            if (state.editing !== editing || token !== editing.previewToken) return;
            editing.preview = {view, createKeys: request.createKeys, key: Model.previewKey(request)};
            editing.previewState = "preview";
        } catch (error) {
            if (state.editing !== editing || token !== editing.previewToken) return;
            editing.previewState = "error";
            if (!handleApiError(error, request)) setStatus(error.message);
        }
        renderTimelines();
        renderSide(editing.userId);
        renderTiles(editing.userId);
    }

    // Nach jeder Änderung: Vorschau anfordern und neu zeichnen. inPlace: nur die Kachel
    // nachziehen (beim Tippen in einer Kachel), sonst alle Kacheln neu.
    function changed(inPlace = null) {
        const editing = state.editing;
        editing.blockErrors = {};
        schedulePreview();
        renderTimelines();
        renderSide(editing.userId);
        if (inPlace) refreshTile(editing.userId, inPlace);
        else renderTiles(editing.userId);
    }

    async function save() {
        const editing = state.editing;
        if (!editing || editing.saving) return;
        const entry = state.entries[editing.userId];
        const request = Model.buildChangeRequest(editing.blocks);
        if (!Model.canSave(editing.blocks, entry.view, Date.now())) return;
        editing.saving = true;
        renderSide(editing.userId);
        try {
            const view = await api(dayPath(editing.userId),
                {method: "POST", body: JSON.stringify(Model.saveBody(request, entry.view.revision))});
            clearTimeout(previewTimer);
            entry.view = view;
            entry.selectedKey = null;
            entry.editKey = null;
            state.editing = null;
            setStatus(`${entry.user.name}: ${Model.saveMessage(request)}`);
        } catch (error) {
            if (!handleApiError(error, request)) setStatus(error.message);
        } finally {
            editing.saving = false;
        }
        render();
    }

    // Neue Korrektur über die Kachel: offener Wechsel ab 08:00, am laufenden Tag höchstens
    // „jetzt“ (auf 5 Minuten abgerundet), gleich ausgeklappt und im Bearbeiten.
    function addBlock() {
        const editing = state.editing;
        const entry = state.entries[editing.userId];
        const view = entry.view;
        const latest = Model.latestMs(view, Date.now());
        const eight = Model.clockToMs(view, "08:00");
        const from = Math.max(Model.dayRange(view).start,
            Math.min(eight ?? latest, Math.floor(latest / FIVE_MINUTES_MS) * FIVE_MINUTES_MS));
        const key = "n" + (++state.newCount);
        editing.blocks = Model.createBlock(editing.blocks, {status: state.lastStatus, from, to: null}, key);
        entry.selectedKey = key;
        entry.editKey = key;
        changed();
        const tiles = sections[editing.userId].tiles;
        const status = tiles.querySelector && tiles.querySelector(`[data-tile="${key}"] [data-field="status"]`);
        if (status) status.focus();
    }

    // Eingegebene Zeit: am laufenden Tag höchstens „jetzt“; als Ende steht 00:00 für Mitternacht,
    // ein leeres Ende heißt „offen“ (Wechsel ab Zeitpunkt).
    function readClock(view, value, isEnd) {
        const ms = Model.clockToMs(view, value, isEnd);
        return ms == null ? null : Math.min(ms, Model.latestMs(view, Date.now()));
    }

    // --- Kacheln: Bedienung -------------------------------------------------------

    function onTileClick(event, userId) {
        const actionEl = event.target.closest("[data-action]");
        if (!actionEl || state.blocked) return;
        const action = actionEl.dataset.action;
        const editing = editingFor(userId);
        const entry = state.entries[userId];
        if (!editing && !(entry && entry.expanded && action === "toggle")) return;
        if (action === "add") {
            addBlock();
            return;
        }
        const tile = actionEl.closest("[data-tile]");
        const key = tile && tile.dataset.tile;
        if (!key) return;
        if (action === "toggle") {
            selectBlock(userId, key);
        } else if (action === "edit") {
            entry.editKey = entry.editKey === key ? null : key;
            renderTiles(userId);
            const tiles = sections[userId].tiles;
            const field = tiles.querySelector && tiles.querySelector(`[data-tile="${key}"] [data-field="status"]`);
            if (field) field.focus();
        } else if (action === "remove") {
            const block = editing.blocks.find(item => item.key === key);
            editing.blocks = Model.removeBlock(editing.blocks, key);
            if (block && block.id == null) entry.selectedKey = null;
            entry.editKey = null;
            changed();
        } else if (action === "restore") {
            editing.blocks = Model.restoreBlock(editing.blocks, key);
            changed();
        }
    }

    function onTileChange(event, userId) {
        const editing = editingFor(userId);
        const field = event.target.dataset.field;
        const tile = event.target.closest("[data-tile]");
        const key = tile && tile.dataset.tile;
        const block = editing && editing.blocks.find(item => item.key === key);
        if (!field || !block || field === "reason") return;
        const view = state.entries[userId].view;
        let patch = null;
        if (field === "status") {
            state.lastStatus = event.target.value;
            patch = {status: event.target.value};
        } else if (field === "from") {
            const from = readClock(view, event.target.value, false);
            if (from != null) patch = {from};
        } else if (field === "to") {
            const to = event.target.value ? readClock(view, event.target.value, true) : null;
            if (!event.target.value || to != null) patch = {to};
        }
        if (patch) editing.blocks = Model.updateBlock(editing.blocks, key, patch);
        // Gekürzte oder ungültige Eingaben zeigen den tatsächlichen Wert.
        const current = editing.blocks.find(item => item.key === key);
        if (field === "from") event.target.value = Model.msToClock(current.from);
        if (field === "to") event.target.value = current.to != null ? Model.msToClock(current.to) : "";
        changed(key);
    }

    function onTileInput(event, userId) {
        const editing = editingFor(userId);
        if (!editing || event.target.dataset.field !== "reason") return;
        const key = event.target.closest("[data-tile]").dataset.tile;
        if (!editing.blocks.some(item => item.key === key)) return;
        editing.blocks = Model.updateBlock(editing.blocks, key, {reason: event.target.value});
        changed(key);
    }

    // --- Direkte Bedienung --------------------------------------------------------
    // Ziehen am Körper verschiebt, an den Griffen ändert es Beginn oder Ende, auf der leeren
    // Zeile zeichnet es einen Bereich; ein Klick dort legt einen Wechsel ab Zeitpunkt an.
    // Die Zeiger-Erfassung hängt an der Zeitleiste des Panels, die beim Ziehen erhalten bleibt.
    // Die Vorschau wird erst nach dem Loslassen angefordert.

    const DRAG_THRESHOLD_PX = 3;
    let drag = null;
    let frame = 0;

    function snapOptions(view) {
        const day = Model.dayRange(view);
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
            if (!state.editing) return;
            renderTimelines();
            renderSide(state.editing.userId);
            renderTiles(state.editing.userId);
        });
    }

    function onPointerDown(event) {
        if (state.blocked || event.button !== 0) return;
        const timeline = event.target.closest("[data-timeline]");
        const track = event.target.closest(".tc-track-corrections");
        if (!timeline || !track) return;
        const userId = timeline.dataset.timeline;
        const entry = state.entries[userId];
        const editing = editingFor(userId);
        const element = event.target.closest("[data-key]");
        if (!editing) {
            // Aufgeklappte Ansicht: ein Klick auf einen Block klappt nur seine Kachel auf.
            if (entry && entry.expanded && element) selectBlock(userId, element.dataset.key);
            return;
        }
        const block = element ? editing.blocks.find(item => item.key === element.dataset.key) : null;
        const handle = event.target.closest("[data-handle]");
        drag = {
            userId, timeline,
            key: block ? block.key : null,
            mode: block ? (handle ? handle.dataset.handle : "move") : "draw",
            fixed: Boolean(block && block.removed),
            before: editing.blocks,
            origin: block ? {from: block.from, to: block.to} : null,
            startX: event.clientX,
            rect: track.getBoundingClientRect(),
            range: currentRange(),
            moved: false,
        };
        drag.originMs = pointerMs(event.clientX);
        if (!block) drag.origin = {from: Model.snapTime(drag.originMs, snapOptions(entry.view)), to: null};
        timeline.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!drag || drag.fixed || !state.editing) return;
        const editing = state.editing;
        const entry = state.entries[drag.userId];
        if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
        if (!drag.moved) {
            drag.moved = true;
            drag.timeline.classList.add("tc-dragging");
            if (!drag.key) {
                drag.key = "n" + (++state.newCount);
                editing.blocks = Model.createBlock(editing.blocks,
                    {status: state.lastStatus, from: drag.origin.from, to: drag.origin.from + 60 * 1000}, drag.key);
            }
            entry.selectedKey = drag.key;
            clearTimeout(previewTimer);
            editing.previewToken++;
            editing.previewState = "pending";
        }
        const at = pointerMs(event.clientX);
        editing.blocks = Model.updateBlock(editing.blocks, drag.key,
            Model.dragBlock(drag.origin, drag.mode, at - drag.originMs, at, snapOptions(entry.view)));
        scheduleRender();
    }

    function finishDrag(cancel) {
        const current = drag;
        drag = null;
        current.timeline.classList.remove("tc-dragging");
        const editing = state.editing;
        if (!editing) return;
        const entry = state.entries[current.userId];
        if (cancel) {
            editing.blocks = current.before;
            if (!editing.blocks.some(block => block.key === entry.selectedKey)) entry.selectedKey = null;
            changed();
        } else if (current.moved) {
            changed();
        } else if (current.key) {
            selectBlock(current.userId, current.key);
        } else {
            const key = "n" + (++state.newCount);
            editing.blocks = Model.createBlock(editing.blocks, {status: state.lastStatus, from: current.origin.from, to: null}, key);
            entry.selectedKey = key;
            changed();
        }
    }

    function onPointerUp(event) {
        if (drag) finishDrag(event.type === "pointercancel");
    }

    // --- Ereignisse in den Panels ----------------------------------------------------

    function onPanelAction(action, userId) {
        if (action === "expand") {
            const entry = state.entries[userId];
            entry.expanded = !entry.expanded;
            if (!entry.expanded) entry.selectedKey = null;
            renderUser(userId);
        } else if (action === "edit") {
            startEditing(userId);
        } else if (action === "save") {
            save();
        } else if (action === "cancel") {
            stopEditing();
        }
    }

    function onUsersClick(event) {
        const button = event.target.closest("[data-panel-action]");
        if (button) {
            onPanelAction(button.dataset.panelAction, button.closest("[data-user]").dataset.user);
            return;
        }
        const tiles = event.target.closest("[data-tiles]");
        if (tiles) onTileClick(event, tiles.dataset.tiles);
    }

    function onUsersKeydown(event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        const tiles = event.target.closest("[data-tiles]");
        if (tiles && event.target.dataset.action === "toggle") {
            event.preventDefault();
            onTileClick(event, tiles.dataset.tiles);
            return;
        }
        const timeline = event.target.closest("[data-timeline]");
        const block = event.target.closest("[data-key]");
        if (timeline && block && editingFor(timeline.dataset.timeline)) {
            event.preventDefault();
            selectBlock(timeline.dataset.timeline, block.dataset.key);
        }
    }

    function onUsersChange(event) {
        const tiles = event.target.closest("[data-tiles]");
        if (tiles) onTileChange(event, tiles.dataset.tiles);
    }

    function onUsersInput(event) {
        const tiles = event.target.closest("[data-tiles]");
        if (tiles) onTileInput(event, tiles.dataset.tiles);
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
        const lines = state.editing ? Model.changeLines(state.editing.blocks) : [];
        dom.modalTitle.textContent = MODAL_TITLES[kind];
        dom.modalBody.hidden = !lines.length;
        dom.modalChanges.innerHTML = lines.map(line => `<li>${escapeHtml(line)}</li>`).join("");
        dom.modal.classList.add("active");
        dom.modal.setAttribute("aria-hidden", "false");
        clearTimeout(previewTimer);
        orderedVisible().forEach(renderSide);
        dom.modalReload.focus();
    }

    function reloadAfterBlock() {
        const kind = state.blocked;
        dom.modal.classList.remove("active");
        dom.modal.setAttribute("aria-hidden", "true");
        state.blocked = "";
        const userId = state.editing && state.editing.userId;
        state.editing = null;
        if (kind === "day") {
            // Die Tage ändern sich um Mitternacht; die Seite lädt sie neu und fällt auf heute zurück.
            window.location.reload();
            return;
        }
        if (userId) loadEntry(userId);
        else render();
    }

    // Liefert true, wenn der Fehler behandelt ist (Modal oder Block).
    function handleApiError(error, request) {
        const code = Model.errorCode(error.payload);
        if (error.status === 409 || code === "day_not_allowed") {
            openBlockedModal(error.status === 409 ? "conflict" : "day");
            return true;
        }
        const editing = state.editing;
        if (error.status !== 422 || !request || !editing) return false;
        const targets = Model.errorTargets(error.payload, request, editing.blocks);
        const keys = Object.keys(targets.byBlock);
        if (!keys.length) return false;
        editing.blockErrors = targets.byBlock;
        state.entries[editing.userId].selectedKey = keys[0];
        return true;
    }

    // --- Start ------------------------------------------------------------------

    async function init() {
        dom.root = document.getElementById("tcTool");
        if (!dom.root) return;
        ["userQuery", "userList", "days", "pickDay", "dayPicker", "dayPrev", "dayNext", "range", "chips", "chipsWrap",
            "sort", "sortWrap", "sortMenu", "confirm", "confirmChanges", "confirmKeep", "confirmDiscard", "users", "loadedAt", "reload",
            "status", "empty", "changesBox", "changes", "changeCount",
            "modal", "modalTitle", "modalBody", "modalChanges", "modalReload"].forEach(key => {
            dom[key] = document.getElementById("tc" + key[0].toUpperCase() + key.slice(1));
        });
        dom.rangeButtons = [...dom.root.querySelectorAll("[data-range]")];
        state.chipSort = readChipSort();

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
        dom.pickDay.addEventListener("click", openDayPicker);
        dom.dayPicker.addEventListener("change", () => selectDay(dom.dayPicker.value));
        dom.reload.addEventListener("click", () => withDiscard(loadDate));
        dom.dayPrev.addEventListener("click", () => {
            const date = Model.shiftDay(state.date, -1, state.days);
            if (date) selectDay(date);
        });
        dom.dayNext.addEventListener("click", () => {
            const date = Model.shiftDay(state.date, 1, state.days);
            if (date) selectDay(date);
        });
        dom.sort.addEventListener("click", () => toggleSortMenu());
        dom.sortMenu.addEventListener("click", event => {
            const item = event.target.closest("[data-sort]");
            if (item) chooseSort(item.dataset.sort);
        });
        document.addEventListener("click", event => {
            if (!dom.sortMenu.hidden && !dom.sortWrap.contains(event.target)) toggleSortMenu(false);
        });
        dom.confirmKeep.addEventListener("click", () => closeConfirm(false));
        dom.confirmDiscard.addEventListener("click", () => closeConfirm(true));
        dom.chips.addEventListener("click", event => {
            const chip = event.target.closest("[data-chip]");
            if (chip) toggleUser(chip.dataset.chip);
        });
        dom.rangeButtons.forEach(button => button.addEventListener("click", () => {
            state.rangeMode = button.dataset.range;
            render();
        }));
        dom.users.addEventListener("click", onUsersClick);
        dom.users.addEventListener("keydown", onUsersKeydown);
        dom.users.addEventListener("change", onUsersChange);
        dom.users.addEventListener("input", onUsersInput);
        dom.users.addEventListener("pointerdown", onPointerDown);
        dom.users.addEventListener("pointermove", onPointerMove);
        dom.users.addEventListener("pointerup", onPointerUp);
        dom.users.addEventListener("pointercancel", onPointerUp);
        dom.modalReload.addEventListener("click", reloadAfterBlock);
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            if (drag) finishDrag(true);
            else if (pendingDiscard) closeConfirm(false);
            else if (!dom.sortMenu.hidden) {
                toggleSortMenu(false);
                dom.sort.focus();
            }
        });
        window.addEventListener("beforeunload", event => {
            if (!isDirty() || state.blocked) return;
            event.preventDefault();
            event.returnValue = "";
        });
        // Die Linie „jetzt“ wandert mit, Log- und Pausenzeiten laufen mit; neu geladen wird nichts.
        setInterval(() => {
            renderTimelines();
            renderChips();
        }, NOW_REFRESH_MS);

        try {
            const payload = await api("/days");
            state.days = Model.orderDays(payload.days);
        } catch (error) {
            setStatus(error.message);
            return;
        }
        const selection = Model.readSelection(window.location.search, state.days);
        state.date = selection.date;
        state.visible = selection.userIds.slice(0, 1);
        renderDays();
        updateUrl();
        loadDate();
    }

    document.addEventListener("DOMContentLoaded", init);
}());
