"use strict";

// Startseite: Heute-Kacheln, angeheftete Einträge, Kalender-Zusammenfassung und Genesys-Live-Panel.
// Rechenlogik steckt in dashboard_model.js und calendar_summary.js, das Panel in genesys_live_panel.js.
(function () {
    const REFRESH_LIVE_MS = 15000;
    const REFRESH_DATA_MS = 120000;
    const TIME_ZONE = "Europe/Berlin";
    const STATUS_LABELS = { PLANNED: "geplant", EXECUTED: "erledigt", FAILED: "Fehler", SKIPPED: "übersprungen", CANCELED: "abgebrochen" };

    const model = window.DashboardModel;
    const calendar = window.CalendarSummary;
    const panel = window.GenesysLivePanel;
    const $ = id => document.getElementById(id);

    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

    function setText(id, value) {
        const element = $(id);
        if (element) element.textContent = value;
    }

    function setHidden(id, hidden) {
        const element = $(id);
        if (element) element.hidden = hidden;
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, { cache: "no-store", ...options });
        const data = await response.json().catch(() => null);
        return { ok: response.ok, status: response.status, data };
    }

    function readStorage() {
        try { return window.localStorage; } catch (_) { return undefined; }
    }

    // ---------- Datum ----------

    function dayKeyOf(date) {
        const pad = value => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function dateFromKey(key) {
        const [year, month, day] = key.split("-").map(Number);
        return new Date(year, month - 1, day);
    }

    function addDays(date, days) {
        const next = new Date(date.getTime());
        next.setDate(next.getDate() + days);
        return next;
    }

    function weekStartOf(date) {
        const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        base.setDate(base.getDate() - ((base.getDay() || 7) - 1));
        return base;
    }

    function isoWeek(date) {
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        target.setDate(target.getDate() + 4 - (target.getDay() || 7));
        const yearStart = new Date(target.getFullYear(), 0, 1);
        return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    }

    const formatShortDay = date => new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(date).replace(".", "");
    const formatDayMonth = date => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(date);

    // ---------- Störung ----------

    async function loadIncidents() {
        const banner = $("dashboard-stoerung-banner");
        if (!banner) return;
        try {
            const { ok, data } = await fetchJson("/api/stoerung/incidents/active");
            const incidents = ok && Array.isArray(data) ? data : [];
            if (!incidents.length) return;
            setText("dashboard-stoerung-count", incidents.length === 1 ? "(1 aktive Störung)" : `(${incidents.length} aktive Störungen)`);
            banner.hidden = false;
        } catch (_) { /* Banner bleibt aus */ }
    }

    // ---------- Angeheftet ----------

    function initPins(page) {
        const nav = $("dash-pins");
        const source = $("dash-pin-source");
        if (!nav || !source) return;
        const cards = new Map(Array.from(source.content.querySelectorAll(".ws-item")).map(card => [card.dataset.workspaceId, card]));
        const userId = page.dataset.userId;
        const read = () => (userId ? window.WorkspacePins.load(readStorage(), userId, Array.from(cards.keys())) : []);

        function render() {
            const pinned = read();
            if (!pinned.length) {
                nav.innerHTML = '<a class="dash-pin-empty" href="/workspace">Workspace</a>';
                return;
            }
            nav.replaceChildren(...pinned.map(id => cards.get(id).cloneNode(true)));
        }

        window.addEventListener("storage", event => {
            if (userId && event.key === window.WorkspacePins.storageKey(userId)) render();
        });
        render();
    }

    // ---------- Heute-Kacheln ----------

    function renderToday() {
        const label = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TIME_ZONE }).format(new Date());
        setText("dash-today-date", `· ${label}`);
    }

    function renderTasks(overview) {
        const stats = model.taskStats(overview, window.SofaContract.berlinDateKey());
        setText("dash-tasks-active", String(stats.active));
        const chip = (id, count, text) => {
            setText(id, text);
            setHidden(id, !count);
        };
        chip("dash-tasks-mine", stats.mine, `${stats.mine} meine`);
        chip("dash-tasks-today", stats.dueToday, `${stats.dueToday} heute fällig`);
        chip("dash-tasks-tomorrow", stats.dueTomorrow, `${stats.dueTomorrow} morgen`);
        chip("dash-tasks-overdue", stats.overdue, `${stats.overdue} überfällig`);
        setText("dash-tasks-split", `${stats.open} offen · ${stats.inProgress} in Bearbeitung · ${stats.blocked} blockiert`);
        setText("dash-deferred-value", String(stats.deferred));
        $("dash-stat-deferred")?.classList.toggle("is-high", stats.deferredHigh);
    }

    async function loadTasks(url) {
        try {
            const { ok, data } = await fetchJson(url);
            if (!ok || !data) throw new Error(String(data?.detail || "Tasks"));
            renderTasks(data);
        } catch (_) {
            setText("dash-tasks-active", "–");
            setText("dash-deferred-value", "–");
        }
    }

    function renderServiceLevel(data) {
        const level = model.serviceLevel(data);
        const tile = $("dash-stat-sl");
        if (!level || !tile) return;
        tile.hidden = false;
        tile.dataset.tone = level.tone;
        setText("dash-sl-value", level.text);
        const trend = level.delta === null ? "" : ` · ${level.delta > 0 ? "▲" : level.delta < 0 ? "▼" : "="} ${Math.abs(level.delta).toLocaleString("de-DE")} ggü. gestern`;
        setText("dash-sl-sub", `Ziel ${level.target} %${trend}`);
        tile.title = `${level.offered} angeboten, ${level.abandoned} abgebrochen; Annahme in ${level.thresholdSeconds} s`;
    }

    async function loadServiceLevel(url) {
        if (!url) return;
        try {
            const { ok, data } = await fetchJson(url);
            if (ok && data) renderServiceLevel(data);
        } catch (_) { /* Kachel bleibt aus */ }
    }

    // ---------- Kalender ----------

    function initCalendar(url) {
        const card = $("dash-calendar");
        if (!card || !url) return { refresh: async () => {} };

        const state = { weekOffset: 0, selectedDay: null, weeks: new Map(), failed: false };

        const weekStart = offset => addDays(weekStartOf(new Date()), offset * 7);
        const weekKey = offset => dayKeyOf(weekStart(offset));

        // Laufende Abrufe teilen sich ein Promise, damit dieselbe Woche nicht mehrfach geladen wird.
        const pending = new Map();

        function ensureWeek(offset) {
            const key = weekKey(offset);
            if (state.weeks.has(key)) return Promise.resolve(state.weeks.get(key));
            if (!pending.has(key)) {
                pending.set(key, fetchWeek(offset, key).finally(() => pending.delete(key)));
            }
            return pending.get(key);
        }

        async function fetchWeek(offset, key) {
            const start = weekStart(offset);
            const params = new URLSearchParams({
                from_date: `${dayKeyOf(start)}T00:00:00`,
                to_date: `${dayKeyOf(addDays(start, 6))}T23:59:59`
            });
            const separator = url.includes("?") ? "&" : "?";
            const { ok, status, data } = await fetchJson(`${url}${separator}${params}`);
            if (status === 401 || status === 403) throw Object.assign(new Error("forbidden"), { forbidden: true });
            if (!ok || !Array.isArray(data)) throw new Error("events");
            state.weeks.set(key, data);
            return data;
        }

        function weekDays() {
            return Array.from({ length: 7 }, (_, index) => addDays(weekStart(state.weekOffset), index));
        }

        function renderTiles() {
            const today = new Date();
            const tomorrow = addDays(today, 1);
            const events = [...(state.weeks.get(weekKey(0)) || []), ...(state.weeks.get(weekKey(1)) || [])];
            const count = date => calendar.dayTotal(events, dayKeyOf(date));
            setText("dash-events-today", String(count(today)));
            setText("dash-events-tomorrow", `morgen ${count(tomorrow)}`);
            setHidden("dash-stat-events", false);
        }

        function renderWeek() {
            const days = weekDays();
            const events = state.weeks.get(weekKey(state.weekOffset)) || [];
            const todayKey = dayKeyOf(new Date());
            setText("dash-week-label", `KW ${String(isoWeek(days[0])).padStart(2, "0")} · ${formatDayMonth(days[0])}–${formatDayMonth(days[6])}`);
            $("dash-week").innerHTML = days.map(day => {
                const key = dayKeyOf(day);
                const total = calendar.dayTotal(events, key);
                const classes = ["dash-day", key === todayKey ? "is-today" : "", state.selectedDay === key ? "is-selected" : "", total ? "has-events" : "", [0, 6].includes(day.getDay()) ? "is-weekend" : ""].filter(Boolean).join(" ");
                return `<button type="button" class="${classes}" data-day="${key}" aria-pressed="${state.selectedDay === key}" aria-label="${escapeHtml(`${formatShortDay(day)} ${formatDayMonth(day)}, ${total} Termine`)}">
                    <span class="dash-day-name">${escapeHtml(formatShortDay(day))}</span>
                    <span class="dash-day-date">${escapeHtml(formatDayMonth(day))}</span>
                    <span class="dash-day-count">${total || ""}</span>
                </button>`;
            }).join("");
        }

        function lineMeta(line) {
            const first = line.events[0];
            const time = line.kind === "training" ? calendar.timeOf(first) : "";
            const names = line.dayKeys.map(key => formatShortDay(dateFromKey(key)));
            return [names.join(", "), time].filter(Boolean).join(" · ");
        }

        function renderLines() {
            const box = $("dash-cal-lines");
            if (state.failed) {
                box.innerHTML = '<p class="dash-empty">Termine nicht verfügbar</p>';
                return;
            }
            let events = state.weeks.get(weekKey(state.weekOffset));
            if (!events) {
                box.innerHTML = '<p class="dash-empty">Lädt …</p>';
                return;
            }
            if (state.selectedDay) events = calendar.eventsOnDay(events, state.selectedDay);
            const lines = calendar.summarize(events);
            state.lines = new Map(lines.map(line => [line.id, line]));
            if (!lines.length) {
                box.innerHTML = '<p class="dash-empty">Keine Termine</p>';
                return;
            }
            box.innerHTML = lines.map(line => {
                const chips = [
                    line.done ? `<span class="dash-chip">${line.done} erledigt</span>` : "",
                    line.failedExtra ? `<span class="dash-chip dash-chip--overdue">${line.failedExtra} Fehler</span>` : ""
                ].join("");
                return `<button type="button" class="dash-line" data-kind="${line.kind}" data-state="${line.state}" data-line="${escapeHtml(line.id)}">
                    <span class="dash-line-text">${escapeHtml(line.text)}</span>
                    <span class="dash-line-meta">${escapeHtml(state.selectedDay ? (calendar.timeOf(line.events[0]) || "") : lineMeta(line))}</span>
                    <span class="dash-line-chips">${chips}</span>
                </button>`;
            }).join("");
        }

        function render() {
            renderWeek();
            renderLines();
        }

        async function show(offset) {
            state.weekOffset = offset;
            state.failed = false;
            render();
            try {
                await ensureWeek(offset);
            } catch (error) {
                if (error.forbidden) return hide();
                state.failed = true;
            }
            render();
        }

        function hide() {
            card.hidden = true;
            setHidden("dash-stat-events", true);
        }

        function openLine(id) {
            const line = state.lines?.get(id);
            if (!line) return;
            setText("console-calendar-day-modal-title", line.text);
            const body = $("console-calendar-day-modal-body");
            if (body) {
                body.innerHTML = line.events.map(event => {
                    const date = dateFromKey(calendar.dayKeyOf(event));
                    const time = calendar.timeOf(event);
                    const status = String(event.event_status || "").toUpperCase();
                    return `<div class="dash-event" data-state="${escapeHtml(status.toLowerCase())}">
                        <span class="dash-event-when">${escapeHtml(`${formatShortDay(date)} ${formatDayMonth(date)}${time ? ` · ${time}` : ""}`)}</span>
                        <span class="dash-event-text">${escapeHtml(event.description || event.title || "")}</span>
                        <span class="dash-chip${status === "FAILED" ? " dash-chip--overdue" : ""}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
                    </div>`;
                }).join("");
            }
            window.openSofaModal?.("console-calendar-day-modal");
        }

        card.hidden = false;
        $("dash-week-prev").addEventListener("click", () => { state.selectedDay = null; show(state.weekOffset - 1); });
        $("dash-week-next").addEventListener("click", () => { state.selectedDay = null; show(state.weekOffset + 1); });
        $("dash-week-current").addEventListener("click", () => { state.selectedDay = null; show(0); });
        $("dash-week").addEventListener("click", event => {
            const button = event.target.closest("[data-day]");
            if (!button) return;
            state.selectedDay = state.selectedDay === button.dataset.day ? null : button.dataset.day;
            render();
        });
        $("dash-cal-lines").addEventListener("click", event => {
            const line = event.target.closest("[data-line]");
            if (line) openLine(line.dataset.line);
        });
        $("dash-stat-events")?.addEventListener("click", () => {
            state.selectedDay = dayKeyOf(new Date());
            show(0);
        });

        async function refresh() {
            state.weeks.clear();
            try {
                await Promise.all([ensureWeek(0), ensureWeek(1), ensureWeek(state.weekOffset)]);
                state.failed = false;
            } catch (error) {
                if (error.forbidden) return hide();
                state.failed = true;
            }
            renderTiles();
            render();
        }

        render();
        return { refresh };
    }

    // ---------- Genesys Live ----------

    function initLive(url) {
        const aside = $("dash-live");
        if (!aside || !url) return { refresh: async () => {} };
        let live = null;
        let loading = false;
        let timer = null;
        const open = panel.loadOpen(readStorage());

        function render() {
            const content = $("panelContent");
            if (!live) {
                content.innerHTML = '<p class="panel-empty">Live-Daten nicht verfügbar</p>';
                return;
            }
            content.innerHTML = panel.panelBody(live, live.total, null, open);
            $("staleNotice").hidden = !live.stale;
            aside.querySelector(".asof").classList.toggle("is-stale", Boolean(live.stale));
            $("updatedAt").textContent = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(live.as_of));
        }

        function remove() {
            clearInterval(timer);
            aside.remove();
            $("dash-layout").classList.remove("has-live");
        }

        async function load() {
            if (loading) return;
            loading = true;
            try {
                const { ok, status, data } = await fetchJson(url);
                // Nicht angemeldet oder nicht eingerichtet: der Bereich entfällt ohne Meldung.
                if (status === 401 || status === 503) return remove();
                if (!ok || !data?.total) throw new Error("live");
                live = data;
            } catch (_) {
                if (live) live = { ...live, stale: true };
            } finally {
                loading = false;
            }
            if (aside.isConnected) render();
        }

        aside.addEventListener("click", event => {
            const group = event.target.closest("[data-kpi-group]");
            if (!group || !live) return;
            const key = group.dataset.kpiGroup;
            open[key] = !open[key];
            panel.saveOpen(readStorage(), open);
            render();
            $(`kpi-${key}`).previousElementSibling.focus();
        });

        timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_LIVE_MS);
        return { refresh: load };
    }

    // ---------- Start ----------

    function init() {
        const page = $("dashboard");
        if (!page) return;
        const source = page.dataset;

        renderToday();
        loadIncidents();
        initPins(page);
        const live = initLive(source.srcLive);
        const calendarView = initCalendar(source.srcEvents);

        const refreshData = () => Promise.all([
            source.srcTasks ? loadTasks(source.srcTasks) : null,
            loadServiceLevel(source.srcServiceLevel),
            calendarView.refresh()
        ]);
        refreshData();
        live.refresh();

        setInterval(() => { if (!document.hidden) refreshData(); }, REFRESH_DATA_MS);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) { refreshData(); live.refresh(); }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
}());
