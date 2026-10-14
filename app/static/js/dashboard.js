"use strict";

// Startseite: Termine-Seitenleiste (Tag und Woche), angeheftete Einträge und Genesys-Live-Panel.
// Die Zusammenfassung der Events steckt in calendar_summary.js, das Panel in genesys_live_panel.js.
(function () {
    const REFRESH_LIVE_MS = 15000;
    const REFRESH_DATA_MS = 120000;
    const TIME_ZONE = "Europe/Berlin";
    const STATUS_LABELS = { PLANNED: "geplant", EXECUTED: "erledigt", FAILED: "Fehler", SKIPPED: "übersprungen", CANCELED: "abgebrochen" };

    const calendar = window.CalendarSummary;
    const panel = window.GenesysLivePanel;
    const $ = id => document.getElementById(id);

    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

    function setText(id, value) {
        const element = $(id);
        if (element) element.textContent = value;
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

    const formatWeekday = date => new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(date).replace(".", "");
    const formatDayMonth = date => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(date);
    const formatLongDay = date => `${new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(date)}, ${formatDayMonth(date)}`;

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
        const grid = $("dash-pins-grid");
        const source = $("dash-pin-source");
        if (!grid || !source) return;
        const cards = new Map(Array.from(source.content.querySelectorAll(".ws-item")).map(card => [card.dataset.workspaceId, card]));
        const userId = page.dataset.userId;
        const read = () => (userId ? window.WorkspacePins.load(readStorage(), userId, Array.from(cards.keys())) : []);

        function render() {
            const pinned = read();
            if (!pinned.length) {
                grid.innerHTML = '<a class="dash-pin-empty" href="/workspace">Workspace</a>';
                return;
            }
            grid.replaceChildren(...pinned.map(id => {
                const slot = document.createElement("div");
                slot.className = "workspace-pin-slot";
                slot.append(cards.get(id).cloneNode(true));
                return slot;
            }));
        }

        window.addEventListener("storage", event => {
            if (userId && event.key === window.WorkspacePins.storageKey(userId)) render();
        });
        render();
    }

    // ---------- Termine: Seitenleiste mit Tag und Woche ----------

    function initSide(url) {
        const side = $("dash-side");
        if (!side || !url) return { refresh: async () => {} };

        const today = () => dayKeyOf(new Date());
        const state = { weekOffset: 0, selectedDay: today(), weeks: new Map(), failed: false, lines: new Map() };
        const pending = new Map();

        const weekStart = offset => addDays(weekStartOf(new Date()), offset * 7);
        const weekKey = offset => dayKeyOf(weekStart(offset));
        const weekDays = () => Array.from({ length: 7 }, (_, index) => addDays(weekStart(state.weekOffset), index));

        // Laufende Abrufe teilen sich ein Promise, damit dieselbe Woche nicht mehrfach geladen wird.
        function ensureWeek(offset) {
            const key = weekKey(offset);
            if (state.weeks.has(key)) return Promise.resolve(state.weeks.get(key));
            if (!pending.has(key)) pending.set(key, fetchWeek(offset, key).finally(() => pending.delete(key)));
            return pending.get(key);
        }

        async function fetchWeek(offset, key) {
            const start = weekStart(offset);
            const params = new URLSearchParams({
                from_date: `${dayKeyOf(start)}T00:00:00`,
                to_date: `${dayKeyOf(addDays(start, 6))}T23:59:59`
            });
            const { ok, status, data } = await fetchJson(`${url}${url.includes("?") ? "&" : "?"}${params}`);
            if (status === 401 || status === 403) throw Object.assign(new Error("forbidden"), { forbidden: true });
            if (!ok || !Array.isArray(data)) throw new Error("events");
            state.weeks.set(key, data);
            return data;
        }

        const weekEvents = () => state.weeks.get(weekKey(state.weekOffset));

        // Wochenzeilen nennen den Stand im Text ("… geplant/erledigt"), Tageszeilen als Chip.
        function lineMarkup(line, meta, dayMode) {
            const chips = [
                line.done ? `<span class="dash-chip">${line.done} erledigt</span>` : "",
                dayMode && line.state === "done" ? '<span class="dash-chip">erledigt</span>' : "",
                line.failedExtra ? `<span class="dash-chip dash-chip--overdue">${line.failedExtra} Fehler</span>` : ""
            ].join("");
            return `<button type="button" class="dash-line" data-kind="${line.kind}" data-state="${line.state}" data-line="${escapeHtml(line.id)}">
                <span class="dash-line-text">${escapeHtml(line.text)}</span>
                <span class="dash-line-meta">${escapeHtml(meta)}${chips}</span>
            </button>`;
        }

        function setLines(box, lines, emptyText, meta, dayMode) {
            if (state.failed) {
                box.innerHTML = '<p class="dash-empty">Termine nicht verfügbar</p>';
                return;
            }
            if (!lines) {
                box.innerHTML = '<p class="dash-empty">Lädt …</p>';
                return;
            }
            lines.forEach(line => state.lines.set(line.id, line));
            box.innerHTML = lines.length ? lines.map(line => lineMarkup(line, meta(line), dayMode)).join("") : `<p class="dash-empty">${emptyText}</p>`;
        }

        function renderDay() {
            const date = dateFromKey(state.selectedDay);
            const isToday = state.selectedDay === today();
            setText("dash-day-title", isToday ? `Heute · ${formatWeekday(date)}, ${formatDayMonth(date)}` : formatLongDay(date));
            $("dash-day-today").hidden = isToday;
            const events = weekEvents();
            setLines($("dash-day-lines"), events && calendar.summarizeDay(calendar.eventsOnDay(events, state.selectedDay)),
                "Keine Termine", line => line.time, true);
        }

        function renderWeek() {
            const days = weekDays();
            const events = weekEvents();
            setText("dash-week-label", `KW ${String(isoWeek(days[0])).padStart(2, "0")} · ${formatDayMonth(days[0])}–${formatDayMonth(days[6])}`);
            $("dash-weekdays").innerHTML = days.map(day => {
                const key = dayKeyOf(day);
                const has = events && calendar.eventsOnDay(events, key).length > 0;
                const classes = ["dash-wd", key === today() ? "is-today" : "", key === state.selectedDay ? "is-selected" : "", has ? "has-events" : "", [0, 6].includes(day.getDay()) ? "is-weekend" : ""].filter(Boolean).join(" ");
                return `<button type="button" class="${classes}" data-day="${key}" aria-pressed="${key === state.selectedDay}" aria-label="${escapeHtml(formatLongDay(day))}">${escapeHtml(formatWeekday(day))}</button>`;
            }).join("");
            setLines($("dash-week-lines"), events && calendar.summarize(events), "Keine Termine", line => {
                const names = line.dayKeys.map(key => formatWeekday(dateFromKey(key)));
                const time = line.kind === "training" ? calendar.timeOf(line.events[0]) : "";
                return [names.join(", "), time].filter(Boolean).join(" · ");
            }, false);
        }

        function render() {
            state.lines.clear();
            renderDay();
            renderWeek();
        }

        function hide() {
            side.hidden = true;
        }

        async function show(offset, day) {
            state.weekOffset = offset;
            state.selectedDay = day;
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

        function openLine(id) {
            const line = state.lines.get(id);
            if (!line) return;
            setText("console-calendar-day-modal-title", line.text);
            const body = $("console-calendar-day-modal-body");
            if (body) {
                body.innerHTML = line.events.map(event => {
                    const date = dateFromKey(calendar.dayKeyOf(event));
                    const time = calendar.timeOf(event);
                    const status = String(event.event_status || "").toUpperCase();
                    return `<div class="dash-event" data-state="${escapeHtml(status.toLowerCase())}">
                        <span class="dash-event-when">${escapeHtml(`${formatWeekday(date)} ${formatDayMonth(date)}${time ? ` · ${time}` : ""}`)}</span>
                        <span class="dash-event-text">${escapeHtml(event.description || event.title || "")}</span>
                        <span class="dash-chip${status === "FAILED" ? " dash-chip--overdue" : ""}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
                    </div>`;
                }).join("");
            }
            window.openSofaModal?.("console-calendar-day-modal");
        }

        const firstDay = offset => (offset === 0 ? today() : dayKeyOf(weekStart(offset)));
        $("dash-week-prev").addEventListener("click", () => show(state.weekOffset - 1, firstDay(state.weekOffset - 1)));
        $("dash-week-next").addEventListener("click", () => show(state.weekOffset + 1, firstDay(state.weekOffset + 1)));
        $("dash-day-today").addEventListener("click", () => show(0, today()));
        $("dash-weekdays").addEventListener("click", event => {
            const button = event.target.closest("[data-day]");
            if (!button) return;
            state.selectedDay = button.dataset.day;
            render();
        });
        side.addEventListener("click", event => {
            const line = event.target.closest("[data-line]");
            if (line) openLine(line.dataset.line);
        });

        async function refresh() {
            state.weeks.clear();
            try {
                await ensureWeek(state.weekOffset);
                state.failed = false;
            } catch (error) {
                if (error.forbidden) return hide();
                state.failed = true;
            }
            side.hidden = false;
            render();
        }

        side.hidden = false;
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

        loadIncidents();
        initPins(page);
        const live = initLive(page.dataset.srcLive);
        const side = initSide(page.dataset.srcEvents);

        side.refresh();
        live.refresh();

        setInterval(() => { if (!document.hidden) side.refresh(); }, REFRESH_DATA_MS);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) { side.refresh(); live.refresh(); }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
}());
