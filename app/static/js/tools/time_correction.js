"use strict";

(function () {
    const Model = window.TimeCorrectionModel;
    const Timeline = window.TimeCorrectionTimeline;
    const BASE = "/api/time-corrections";
    const SEARCH_DELAY_MS = 250;
    const NOW_REFRESH_MS = 60 * 1000;

    const state = {
        days: [],
        date: null,
        user: null,
        view: null,
        loadedAt: null,
        rangeMode: "work",
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
        if (date === state.date) return;
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
        dom.timeline.innerHTML = Timeline.axisHtml(range) + Timeline.resultRowHtml(view, range, {nowMs: Date.now()});
        dom.rangeButtons.forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.range === state.rangeMode));
        });
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
        renderChanges();
    }

    async function loadDay() {
        if (!state.user || !state.date) {
            render();
            return;
        }
        const token = ++state.dayToken;
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
            setStatus(error.message);
        }
        render();
    }

    // --- Start ------------------------------------------------------------------

    async function init() {
        dom.root = document.getElementById("tcTool");
        if (!dom.root) return;
        ["userQuery", "userList", "days", "loadedAt", "reload", "status", "empty", "timelinePanel", "timeline", "changesBox", "changes", "changeCount", "revokedBox", "revoked", "revokedCount"].forEach(key => {
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
        dom.reload.addEventListener("click", loadDay);
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
