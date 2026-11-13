"use strict";

// Startseite: Wochenkalender mit Tagesschublade, Genesys Live und Servicelevel rechts, Pin-Leiste unten.
// Die Zusammenfassung der Events steckt in calendar_summary.js, das Panel in genesys_live_panel.js.
(function () {
    const REFRESH_LIVE_MS = 15000;
    const COLD_RETRY_MS = 3000;
    const COLD_RETRIES_LIVE = 3;
    const REFRESH_DATA_MS = 120000;
    const REFRESH_SERVICE_LEVEL_MS = 60000;
    // Bis die SD-API ein Ziel liefert: 80 % und mehr gilt als erreicht.
    const DEFAULT_SL_TARGET = 0.8;
    const PIN_SLOTS = 4;
    const TIME_ZONE = "Europe/Berlin";
    const STATUS_LABELS = { PLANNED: "geplant", EXECUTED: "erledigt", FAILED: "Fehler", SKIPPED: "übersprungen", CANCELED: "abgebrochen" };

    const calendar = window.CalendarSummary;
    const panel = window.GenesysLivePanel;
    const $ = id => document.getElementById(id);

    const { escapeHtml, fetchJson, withParams } = window.SofaUtils;

    function setText(id, value) {
        const element = $(id);
        if (element) element.textContent = value;
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
            // Immer vier Plätze im 2×2-Raster; freie Plätze führen in den Workspace.
            const pinned = read();
            grid.replaceChildren(...Array.from({ length: PIN_SLOTS }, (_, index) => {
                const id = pinned[index];
                if (!id) {
                    const empty = document.createElement("a");
                    empty.className = "workspace-pin-slot is-empty";
                    empty.href = "/workspace";
                    empty.setAttribute("aria-label", "Im Workspace anheften");
                    return empty;
                }
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

    // ---------- Termine: Wochenkalender mit Tagesschublade ----------

    function initWeek(url, onDay = () => {}) {
        const week = $("dash-week");
        const clip = $("dash-day-clip");
        if (!week || !clip || !url) return { refresh: async () => {} };

        const today = () => dayKeyOf(new Date());
        const state = { today: today(), weekOffset: 0, selectedDay: today(), kind: null, weeks: new Map(), failed: false, lines: new Map() };
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
            const { ok, status, data } = await fetchJson(withParams(url, {
                from_date: `${dayKeyOf(start)}T00:00:00`,
                to_date: `${dayKeyOf(addDays(start, 6))}T23:59:59`
            }));
            if (status === 401 || status === 403) throw Object.assign(new Error("forbidden"), { forbidden: true });
            if (!ok || !Array.isArray(data)) throw new Error("events");
            state.weeks.set(key, data);
            return data;
        }

        const weekEvents = () => state.weeks.get(weekKey(state.weekOffset));

        function weekName(offset, start) {
            if (offset === 0) return "Diese Woche";
            if (offset === 1) return "Nächste Woche";
            if (offset === -1) return "Letzte Woche";
            return `KW ${String(isoWeek(start)).padStart(2, "0")}`;
        }

        function lineMarkup(line) {
            const chips = [
                line.state === "done" ? '<span class="ui-chip ui-chip-sm ui-chip-neutral">erledigt</span>' : "",
                line.failedExtra ? `<span class="ui-chip ui-chip-sm ui-chip-error">${line.failedExtra} Fehler</span>` : ""
            ].join("");
            return `<button type="button" class="dash-line" data-kind="${line.kind}" data-state="${line.state}" data-line="${escapeHtml(line.id)}">
                <span class="dash-line-text">${escapeHtml(line.text)}</span>
                <span class="dash-line-meta">${escapeHtml(line.time)}${chips}</span>
            </button>`;
        }

        function renderDays(events) {
            $("dash-days").innerHTML = weekDays().map(day => {
                const key = dayKeyOf(day);
                const counts = events ? calendar.kindCounts(calendar.eventsOnDay(events, key)) : [];
                const match = state.kind && counts.some(item => item.kind === state.kind);
                const classes = ["dash-dayt",
                    key === today() ? "is-today" : "",
                    key === state.selectedDay ? "is-selected" : "",
                    [0, 6].includes(day.getDay()) ? "is-weekend" : "",
                    state.kind ? (match ? "is-match" : "is-dim") : ""].filter(Boolean).join(" ");
                const label = [formatLongDay(day), ...counts.map(item => calendar.countText(item.kind, item.count))].join(", ");
                const dots = counts.map(item => `<span class="dash-dot${state.kind && item.kind !== state.kind ? " is-dim" : ""}" data-kind="${item.kind}">${item.count}</span>`).join("");
                return `<button type="button" class="${classes}" data-day="${key}" aria-pressed="${key === state.selectedDay}" aria-label="${escapeHtml(label)}">
                    <span class="dash-dayt-name">${escapeHtml(formatWeekday(day))}</span>
                    <span class="dash-dayt-date">${day.getDate()}</span>
                    <span class="dash-dots" aria-hidden="true">${dots}</span>
                </button>`;
            }).join("");
        }

        function renderBadges(events) {
            const days = weekDays();
            const label = $("dash-week-label");
            label.textContent = weekName(state.weekOffset, days[0]);
            label.title = `KW ${String(isoWeek(days[0])).padStart(2, "0")} · ${formatDayMonth(days[0])}–${formatDayMonth(days[6])}`;
            const box = $("dash-badges");
            if (state.failed) {
                box.innerHTML = '<span class="dash-empty">Termine nicht verfügbar</span>';
                return;
            }
            if (!events) {
                box.innerHTML = '<span class="dash-empty">Lädt …</span>';
                return;
            }
            const counts = calendar.kindCounts(events);
            if (state.kind && !counts.some(item => item.kind === state.kind)) state.kind = null;
            box.innerHTML = counts.length
                ? counts.map(item => `<button type="button" class="dash-badge" data-kind="${item.kind}" aria-pressed="${item.kind === state.kind}">${escapeHtml(calendar.countText(item.kind, item.count))}</button>`).join("")
                : '<span class="dash-empty">Keine Termine</span>';
        }

        function renderDay(events) {
            const date = dateFromKey(state.selectedDay);
            const isToday = state.selectedDay === today();
            setText("dash-day-title", isToday ? `Heute · ${formatWeekday(date)}, ${formatDayMonth(date)}` : formatLongDay(date));
            $("dash-day-today").hidden = isToday;
            const box = $("dash-day-lines");
            state.lines.clear();
            if (state.failed || !events) {
                clip.hidden = true;
                return;
            }
            const lines = calendar.summarizeDay(calendar.eventsOnDay(events, state.selectedDay));
            lines.forEach(line => state.lines.set(line.id, line));
            box.innerHTML = lines.length ? lines.map(lineMarkup).join("") : '<p class="dash-empty">Keine Termine</p>';
            clip.hidden = false;
        }

        function render() {
            // Erst nach geladenem Abruf: Badges können eine nicht mehr vorhandene Art abwählen.
            const events = state.failed ? null : weekEvents();
            renderBadges(events);
            renderDays(events);
            renderDay(events);
            onDay(state.selectedDay);
        }

        // Die Schublade gleitet bei jedem Tageswechsel neu unter dem Kalender hervor.
        function slideDay() {
            const day = $("dash-day");
            day.classList.remove("is-sliding");
            void day.offsetWidth;
            day.classList.add("is-sliding");
        }

        function hide() {
            week.hidden = true;
            clip.hidden = true;
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
            slideDay();
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
                        <span class="ui-chip ui-chip-sm ${status === "FAILED" ? "ui-chip-error" : "ui-chip-neutral"}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
                    </div>`;
                }).join("");
            }
            window.openSofaModal?.("console-calendar-day-modal");
        }

        const firstDay = offset => (offset === 0 ? today() : dayKeyOf(weekStart(offset)));
        $("dash-week-prev").addEventListener("click", () => show(state.weekOffset - 1, firstDay(state.weekOffset - 1)));
        $("dash-week-next").addEventListener("click", () => show(state.weekOffset + 1, firstDay(state.weekOffset + 1)));
        $("dash-day-today").addEventListener("click", () => show(0, today()));
        $("dash-days").addEventListener("click", event => {
            const button = event.target.closest("[data-day]");
            if (!button || button.dataset.day === state.selectedDay) return;
            state.selectedDay = button.dataset.day;
            render();
            slideDay();
            $("dash-days").querySelector(`[data-day="${state.selectedDay}"]`)?.focus();
        });
        $("dash-badges").addEventListener("click", event => {
            const badge = event.target.closest("[data-kind]");
            if (!badge) return;
            state.kind = state.kind === badge.dataset.kind ? null : badge.dataset.kind;
            render();
            $("dash-badges").querySelector(`[data-kind="${badge.dataset.kind}"]`)?.focus();
        });
        clip.addEventListener("click", event => {
            const line = event.target.closest("[data-line]");
            if (line) openLine(line.dataset.line);
        });

        async function refresh() {
            // Über Mitternacht offen: Wochenzählung und "Heute" beziehen sich auf den neuen Tag.
            if (state.today !== today()) {
                state.today = today();
                state.weekOffset = 0;
                state.selectedDay = state.today;
            }
            state.weeks.clear();
            try {
                await ensureWeek(state.weekOffset);
                state.failed = false;
            } catch (error) {
                if (error.forbidden) return hide();
                state.failed = true;
            }
            week.hidden = false;
            render();
        }

        week.hidden = false;
        render();
        return { refresh };
    }

    // ---------- Genesys Live ----------

    function initLive(url) {
        const aside = $("dash-live");
        if (!aside || !url) return { refresh: async () => {} };
        let live = null;
        let loading = false;
        let signedOut = false;
        let coldRetries = 0;
        const open = panel.loadOpen(readStorage());

        function render() {
            const content = $("panelContent");
            const info = live ? panel.freshness(live.as_of, live.stale) : { text: "–", tone: "", title: "" };
            const mark = aside.querySelector(".asof");
            mark.dataset.tone = info.tone;
            mark.title = info.title;
            $("updatedAt").textContent = info.text;
            if (signedOut) {
                content.innerHTML = '<p class="panel-empty">Für Genesys Live <a href="/login">neu anmelden</a></p>';
            } else if (!live) {
                content.innerHTML = '<p class="panel-empty">Live-Daten nicht verfügbar</p>';
            } else {
                content.innerHTML = panel.panelBody(live, live.total, null, open);
            }
        }

        // Ein 503 heißt nur, dass Genesys gerade nicht antwortet: der letzte Stand bleibt und altert sichtbar.
        // Ein ungültiger Report-Token (401) braucht eine neue Anmeldung; dann wird nicht mehr abgefragt.
        // Ohne jeden Stand (Kaltstart der SD-API) wird nach einem 5xx kurz nachgefasst statt bis zum nächsten Takt zu warten.
        async function load() {
            if (loading || signedOut) return;
            loading = true;
            let retry = false;
            try {
                const { ok, status, data } = await fetchJson(url);
                retry = status >= 500;
                if (status === 401) {
                    signedOut = true;
                } else if (ok && data?.total) {
                    live = data;
                } else if (live) {
                    live = { ...live, stale: true };
                }
            } catch (_) {
                if (live) live = { ...live, stale: true };
            } finally {
                loading = false;
            }
            render();
            if (retry && !live && coldRetries < COLD_RETRIES_LIVE) {
                coldRetries += 1;
                setTimeout(load, COLD_RETRY_MS);
            }
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

        setInterval(() => { if (!document.hidden) load(); }, REFRESH_LIVE_MS);
        return { refresh: load };
    }

    // ---------- Servicelevel: Tag, Monat und 7-Tage-Trend für alle Prod-Queues, eine Gruppe oder eine Queue ----------

    function initServiceLevel(url, userId) {
        const card = $("dash-sl");
        if (!card || !url) return { refresh: async () => {} };
        const trigger = $("dash-sl-trigger");
        const list = $("dash-sl-list");
        const storageKey = `sofa.dashboard.sl-scope.v2.${userId}`;
        const percentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
        // Auswahl: "" = alle Prod-Queues, "g:<id>" = Gruppe, "q:<id>" = einzelne Queue.
        let scope = "";
        let options = [{ value: "", label: "Gesamt-Servicelevel" }];
        let target = DEFAULT_SL_TARGET;
        try { scope = readStorage()?.getItem(storageKey) || ""; } catch (_) { /* ohne Speicher: Gesamt */ }

        const monthName = bucket => {
            const match = /^(\d{4})-(\d{2})$/.exec(String(bucket?.month || ""));
            return match ? new Intl.DateTimeFormat("de-DE", { month: "long" }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1)) : "";
        };
        const hasValue = bucket => Boolean(bucket && bucket.denominator > 0 && Number.isFinite(bucket.ratio));
        const percent = ratio => `${percentFormat.format(ratio * 100)} %`;
        const statusOf = ratio => (ratio >= target ? "good" : "bad");

        function setKpi(id, bucket) {
            const element = $(id);
            const ok = hasValue(bucket);
            element.textContent = ok ? percent(bucket.ratio) : "–";
            element.dataset.status = ok ? statusOf(bucket.ratio) : "";
            element.title = ok ? `${bucket.numerator} von ${bucket.denominator} rechtzeitig · Ziel ${percent(target)}` : "";
        }

        // ---- Auswahlliste: Gesamt, Gruppen, Trennlinie, einzelne Queues ----

        const optionId = index => `dash-sl-opt-${index}`;
        const labelOf = value => (options.find(option => option.value === value) || options[0]).label;

        function renderOptions(data) {
            const groups = (Array.isArray(data.groups) ? data.groups : []).map(group => ({ value: `g:${group.group_id}`, label: group.label }));
            const queues = (Array.isArray(data.queues) ? data.queues : []).map(queue => ({ value: `q:${queue.queue_id}`, label: queue.label }));
            options = [{ value: "", label: "Gesamt-Servicelevel" }, ...groups, ...queues.map(queue => ({ ...queue, single: true }))];
            if (!options.some(option => option.value === scope)) scope = "";
            let separated = false;
            list.innerHTML = options.map((option, index) => {
                const separator = option.single && !separated ? '<li class="dash-sl-sep" role="presentation"></li>' : "";
                if (option.single) separated = true;
                return `${separator}<li class="dash-sl-option" role="option" id="${optionId(index)}" data-value="${escapeHtml(option.value)}" aria-selected="${option.value === scope}">${escapeHtml(option.label)}</li>`;
            }).join("");
            trigger.textContent = labelOf(scope);
        }

        const optionElements = () => Array.from(list.querySelectorAll("[role=option]"));

        function setActive(element) {
            optionElements().forEach(option => option.classList.toggle("is-active", option === element));
            if (!element) return list.removeAttribute("aria-activedescendant");
            list.setAttribute("aria-activedescendant", element.id);
            element.scrollIntoView({ block: "nearest" });
        }

        // Öffnet nach unten oder, wenn unten zu wenig Platz ist, nach oben; die Höhe passt sich dem Platz an.
        function openList() {
            list.hidden = false;
            trigger.setAttribute("aria-expanded", "true");
            const rect = trigger.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom - 16;
            const above = rect.top - 16;
            const up = below < 240 && above > below;
            list.classList.toggle("is-up", up);
            list.style.maxHeight = `${Math.min(288, up ? above : below)}px`;
            list.focus();
            setActive(list.querySelector("[aria-selected=true]") || optionElements()[0]);
        }

        function closeList(focusTrigger) {
            if (list.hidden) return;
            list.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
            if (focusTrigger) trigger.focus();
        }

        function choose(element) {
            if (!element) return;
            scope = element.dataset.value;
            try { readStorage()?.setItem(storageKey, scope); } catch (_) { /* Auswahl gilt nur bis zum Neuladen */ }
            optionElements().forEach(option => option.setAttribute("aria-selected", String(option === element)));
            trigger.textContent = labelOf(scope);
            closeList(true);
            refresh();
        }

        trigger.addEventListener("click", () => (list.hidden ? openList() : closeList(false)));
        trigger.addEventListener("keydown", event => {
            if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                openList();
            }
        });
        list.addEventListener("click", event => choose(event.target.closest("[role=option]")));
        list.addEventListener("pointermove", event => {
            const option = event.target.closest("[role=option]");
            if (option && !option.classList.contains("is-active")) setActive(option);
        });
        list.addEventListener("keydown", event => {
            const all = optionElements();
            const current = all.indexOf(list.querySelector(".is-active"));
            const move = index => { event.preventDefault(); setActive(all[Math.max(0, Math.min(all.length - 1, index))]); };
            switch (event.key) {
                case "ArrowDown": return move(current + 1);
                case "ArrowUp": return move(current - 1);
                case "Home": return move(0);
                case "End": return move(all.length - 1);
                case "PageDown": return move(current + 8);
                case "PageUp": return move(current - 8);
                case "Enter":
                case " ":
                    event.preventDefault();
                    return choose(all[current]);
                case "Escape":
                    event.preventDefault();
                    return closeList(true);
                case "Tab":
                    return closeList(false);
                default:
                    // Tippen springt zum nächsten Eintrag mit diesem Anfangsbuchstaben.
                    if (event.key.length === 1 && /\S/.test(event.key)) {
                        const key = event.key.toLowerCase();
                        const order = all.slice(current + 1).concat(all.slice(0, current + 1));
                        const hit = order.find(option => option.textContent.trim().toLowerCase().startsWith(key));
                        if (hit) setActive(hit);
                    }
            }
        });
        document.addEventListener("pointerdown", event => {
            if (!list.hidden && !$("dash-sl-pick").contains(event.target)) closeList(false);
        });

        // ---- Trend: die sieben Tage vor heute, Punkte grün/rot am Ziel, Ziellinie gestrichelt ----

        function renderTrend(days) {
            const box = $("dash-sl-trend");
            const points = (Array.isArray(days) ? days : []).map(day => ({ date: day.date, ratio: hasValue(day) ? day.ratio : null }));
            const values = points.map(point => point.ratio).filter(value => value !== null);
            if (!values.length) {
                box.innerHTML = "";
                return;
            }
            const width = 160;
            const height = 44;
            const pad = 6;
            const low = Math.max(0, Math.min(target - 0.15, Math.floor((Math.min(...values) - 0.04) * 20) / 20));
            const high = 1;
            const x = index => pad + (index * (width - 2 * pad)) / Math.max(1, points.length - 1);
            const y = ratio => pad + ((high - ratio) * (height - 2 * pad)) / (high - low);
            // Tage ohne Anrufe unterbrechen die Linie.
            const segments = [];
            points.forEach((point, index) => {
                if (point.ratio === null) return segments.push([]);
                if (!segments.length) segments.push([]);
                segments[segments.length - 1].push(`${x(index).toFixed(1)},${y(point.ratio).toFixed(1)}`);
            });
            const dayLabel = point => `${formatWeekday(dateFromKey(point.date))} ${formatDayMonth(dateFromKey(point.date))}`;
            const summary = points.map(point => `${dayLabel(point)}: ${point.ratio === null ? "keine Anrufe" : percent(point.ratio)}`).join(", ");
            box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`Letzte 7 Tage, Ziel ${percent(target)}. ${summary}`)}">
                <line class="dash-sl-goal" x1="0" x2="${width}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"></line>
                ${segments.filter(segment => segment.length > 1).map(segment => `<polyline class="dash-sl-line" points="${segment.join(" ")}"></polyline>`).join("")}
                ${points.map((point, index) => (point.ratio === null ? "" : `<circle class="dash-sl-dot" data-status="${statusOf(point.ratio)}" cx="${x(index).toFixed(1)}" cy="${y(point.ratio).toFixed(1)}" r="3.5"></circle>`)).join("")}
                ${points.map((point, index) => `<rect class="dash-sl-hit" data-tip="${escapeHtml(`${dayLabel(point)} · ${point.ratio === null ? "keine Anrufe" : percent(point.ratio)}`)}" x="${(x(index) - (width - 2 * pad) / 12).toFixed(1)}" y="0" width="${((width - 2 * pad) / 6).toFixed(1)}" height="${height}"></rect>`).join("")}
            </svg><span class="dash-sl-tip" hidden></span>`;
        }

        $("dash-sl-trend").addEventListener("pointerover", event => {
            const hit = event.target.closest(".dash-sl-hit");
            const tip = $("dash-sl-trend").querySelector(".dash-sl-tip");
            if (!hit || !tip) return;
            const box = $("dash-sl-trend").getBoundingClientRect();
            const rect = hit.getBoundingClientRect();
            tip.textContent = hit.dataset.tip;
            tip.hidden = false;
            tip.style.left = `${rect.left + rect.width / 2 - box.left}px`;
        });
        $("dash-sl-trend").addEventListener("pointerleave", () => {
            const tip = $("dash-sl-trend").querySelector(".dash-sl-tip");
            if (tip) tip.hidden = true;
        });

        // ---- Daten ----

        function render(data) {
            if (Number.isFinite(data.target_ratio)) target = data.target_ratio;
            renderOptions(data);
            setKpi("dash-sl-day", data.day);
            // Der laufende Monat ist früh im Monat noch dünn; der ausgeschriebene Vormonat darunter gibt den ganzen Monat.
            setKpi("dash-sl-month", data.month);
            setText("dash-sl-month-label", monthName(data.month) || "Monat");
            setKpi("dash-sl-prev", data.previous_month);
            setText("dash-sl-prev-label", monthName(data.previous_month) || "Vormonat");
            renderTrend(data.days);
        }

        async function refresh() {
            const [kind, id] = scope ? [scope.slice(0, 1), scope.slice(2)] : [];
            const params = kind === "g" ? { group_id: id } : kind === "q" ? { queue_id: id } : null;
            const requestUrl = withParams(url, params || {});
            try {
                const { ok, status, data } = await fetchJson(requestUrl);
                if (status === 401 || status === 403) {
                    card.hidden = true;
                    return;
                }
                if (!ok || !data) throw new Error("service-level");
                render(data);
                card.hidden = false;
            } catch (_) {
                ["dash-sl-day", "dash-sl-month", "dash-sl-prev"].forEach(id => setKpi(id, null));
                renderTrend(null);
            }
        }

        return { refresh };
    }

    // ---------- Mein Tag: was die Person am gewählten Tag erledigt hat ----------

    const MY_DAY_STATS = [
        { key: "tasks_completed", one: "Aufgabe erledigt", many: "Aufgaben erledigt" },
        { key: "calls_answered", one: "Anruf in Genesys angenommen", many: "Anrufe in Genesys angenommen",
            href: day => `/reports/agent-stats?${new URLSearchParams({ period: "day", anchor: day })}` }
    ];

    function initMyDay(url) {
        const card = $("dash-me");
        if (!card || !url) return { show: () => {}, refresh: async () => {} };
        let day = null;
        let request = 0;

        function render(data) {
            const items = MY_DAY_STATS.map(stat => ({ stat, value: Number(data?.[stat.key]) || 0 })).filter(item => item.value > 0);
            // Ohne Erledigtes (Zukunft, Wochenende, früher Morgen) entfällt die Card.
            card.hidden = !items.length;
            $("dash-me-list").innerHTML = items.map(({ stat, value }) => {
                const inner = `<strong class="dash-me-value">${value}</strong><span class="dash-me-label">${escapeHtml(value === 1 ? stat.one : stat.many)}</span>`;
                return `<li>${stat.href ? `<a class="dash-me-stat" href="${escapeHtml(stat.href(day))}">${inner}</a>` : `<span class="dash-me-stat">${inner}</span>`}</li>`;
            }).join("");
        }

        async function refresh() {
            if (!day) return;
            if (day > dayKeyOf(new Date())) {
                card.hidden = true;
                $("dash-me-list").innerHTML = "";
                return;
            }
            const current = ++request;
            try {
                const { ok, status, data } = await fetchJson(withParams(url, { date: day }));
                if (current !== request) return;
                if (status === 401 || status === 403 || !ok) {
                    card.hidden = true;
                    return;
                }
                render(data);
            } catch (_) { /* letzter Stand bleibt stehen */ }
        }

        function show(dayKey) {
            if (dayKey === day) return;
            day = dayKey;
            refresh();
        }

        return { show, refresh };
    }

    // ---------- Start ----------

    function init() {
        const page = $("dashboard");
        if (!page) return;

        loadIncidents();
        initPins(page);
        const live = initLive(page.dataset.srcLive);
        const myDay = initMyDay(page.dataset.srcMyDay);
        const week = initWeek(page.dataset.srcEvents, day => myDay.show(day));
        const serviceLevel = initServiceLevel(page.dataset.srcServiceLevel, page.dataset.userId);

        week.refresh();
        live.refresh();
        serviceLevel.refresh();
        myDay.show(dayKeyOf(new Date()));

        setInterval(() => { if (!document.hidden) { week.refresh(); myDay.refresh(); } }, REFRESH_DATA_MS);
        setInterval(() => { if (!document.hidden) serviceLevel.refresh(); }, REFRESH_SERVICE_LEVEL_MS);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) { week.refresh(); live.refresh(); serviceLevel.refresh(); myDay.refresh(); }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
}());
