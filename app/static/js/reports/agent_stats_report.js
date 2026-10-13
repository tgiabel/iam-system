(function () {
    "use strict";
    const root = document.getElementById("agentStats");
    if (!root) return;
    const Model = window.AgentStatsModel;
    const Time = window.TimeCorrectionModel;
    const Timeline = window.TimeCorrectionTimeline;
    const dom = Object.fromEntries([
        "asReload", "asAsOf", "asStatus", "asEmpty", "asContent", "asDayPicker",
        "asMonthPicker", "asMonthPrev", "asMonthNext", "asMonthCurrent", "asMonthInput",
        "asPresenceRange", "asLogTotal", "asStatusToggle", "asStatuses", "asTimelineWrap", "asTimeline",
        "asPhoneScope", "asQueueReset", "asPhoneRange", "asCallTotal", "asCallBox", "asPhoneSummary",
        "asQueueList", "asOther", "asMetricsCard", "asMetricsHeading", "asCompareLabel", "asTimes",
        "asMoreToggle", "asMoreMetrics",
    ].map(id => [id, document.getElementById(id)]));
    const selected = Model.parseSelection(window.location.search);
    const state = {period: selected.period, anchor: selected.anchor, dayAnchor: selected.anchor,
        monthAnchor: selected.anchor ? selected.anchor.slice(0, 7) + "-01" : null,
        today: null, firstDay: null, requestNumber: 0, report: null,
        queue: selected.queue, queueName: null, statusesOpen: false, queuesOpen: false, moreOpen: false,
        focusStatus: null};
    const PHONE = "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z";
    const METRICS = [
        {key: "answered", label: "Angenommen", tone: "answered", mark: "M16 2v6h6M22 2l-6 6"},
        {key: "not_answered", label: "Verpasst", tone: "missed", mark: "M23 1l-6 6M17 1l6 6"},
        {key: "transferred", label: "Weitergeleitet", tone: "transferred", mark: "M19 1l4 4-4 4M15 5h8"},
    ];
    const icon = metric => `<svg class="as-call-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${PHONE}"/><path d="${metric.mark}"/></svg>`;
    const picker = window.DayPicker.mount(dom.asDayPicker, day => {
        state.dayAnchor = day;
        state.anchor = day;
        load();
    });
    const count = number => new Intl.NumberFormat("de-DE").format(number || 0);
    const dateLabel = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
    const rangeLabel = value => value && value.available
        ? `${dateLabel(value.from)} – ${dateLabel(value.through)}` : "";

    function syncUrl() {
        const params = new URLSearchParams({period: state.period});
        if (state.anchor) params.set("anchor", state.anchor);
        if (state.queue) params.set("queue", state.queue);
        window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    }

    function setQueue(queueId) {
        state.queue = queueId || null;
        if (!state.queue) state.queueName = null;
        syncUrl();
        if (state.report && state.report.account_linked) renderPhone(state.report.phone);
    }

    function setPeriod(period) {
        state.period = period;
        if (period === "month") {
            state.monthAnchor = state.monthAnchor || (state.anchor || state.today).slice(0, 7) + "-01";
            state.anchor = state.monthAnchor;
        } else {
            state.dayAnchor = state.dayAnchor || state.today;
            state.anchor = state.dayAnchor;
        }
        load();
    }

    function renderControls(report) {
        state.today = report.today;
        state.firstDay = report.first_day;
        if (!state.anchor) state.anchor = report.anchor;
        if (!state.dayAnchor) state.dayAnchor = report.today;
        if (!state.monthAnchor) state.monthAnchor = report.today.slice(0, 7) + "-01";
        root.querySelectorAll("[data-period]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.period === state.period));
        });
        dom.asDayPicker.hidden = state.period !== "day";
        dom.asMonthPicker.hidden = state.period !== "month";
        picker.render({day: state.dayAnchor, today: report.today,
            yesterday: window.DayPicker.shiftDay(report.today, -1, report.today, report.first_day),
            firstDay: report.first_day});
        dom.asMonthInput.min = report.first_day.slice(0, 7);
        dom.asMonthInput.max = report.today.slice(0, 7);
        dom.asMonthInput.value = state.monthAnchor.slice(0, 7);
        dom.asMonthPrev.disabled = Model.shiftMonth(state.monthAnchor, -1).slice(0, 7) < dom.asMonthInput.min;
        dom.asMonthNext.disabled = Model.shiftMonth(state.monthAnchor, 1).slice(0, 7) > dom.asMonthInput.max;
        dom.asMonthCurrent.disabled = state.monthAnchor.slice(0, 7) === dom.asMonthInput.max;
        const marks = report.data_as_of || {};
        const asTime = value => new Intl.DateTimeFormat("de-DE", {timeZone: "Europe/Berlin",
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).format(new Date(value));
        const lines = [marks.presence && `Anwesenheit ${asTime(marks.presence)}`,
            marks.conversations && `Telefonie ${asTime(marks.conversations)}`].filter(Boolean);
        if (!lines.length && report.period === "day" && report.anchor === report.today) lines.push("Stand nicht verfügbar");
        dom.asAsOf.innerHTML = lines.map(line => `<span>${Model.escapeHtml(line)}</span>`).join("");
    }

    function callKpis(values, interactive) {
        const items = METRICS.map(metric => (
            `<span class="as-callkpi is-${metric.tone}"><span class="as-callkpi-icon">${icon(metric)}</span>`
            + `<span class="as-callkpi-text"><strong class="as-callkpi-value">${count(values[metric.key])}</strong>`
            + `<span class="as-callkpi-label">${Model.escapeHtml(metric.label)}</span></span></span>`
        )).join("");
        return interactive
            ? `<button type="button" class="as-callkpis" data-toggle-queues aria-expanded="${state.queuesOpen}"`
                + ` aria-controls="asQueueList" aria-label="Nach Hotline aufschlüsseln">${items}</button>`
            : `<div class="as-callkpis">${items}</div>`;
    }

    function renderScope(phone) {
        const queue = state.queue && (phone.queues || []).find(item => item.queue_id === state.queue);
        if (state.queue && !queue) {
            state.queue = null;
            state.queueName = null;
            syncUrl();
        }
        if (queue) state.queueName = queue.name;
        const name = state.queue ? state.queueName || state.queue : "";
        dom.asPhoneScope.hidden = !state.queue;
        dom.asPhoneScope.textContent = name;
        dom.asQueueReset.hidden = !state.queue;
        dom.asMetricsHeading.textContent = state.queue ? `Gesprächswerte – ${name}` : "Gesprächswerte";
    }

    function renderQueues(rows) {
        dom.asQueueList.hidden = !state.queuesOpen;
        dom.asQueueList.innerHTML = !state.queuesOpen ? "" : rows.map(queue => {
            const active = queue.id === state.queue;
            return `<button type="button" class="as-queue-row" data-queue="${Model.escapeHtml(queue.id)}" aria-pressed="${active}">`
                + `<span class="as-queue-row-name">${Model.escapeHtml(queue.name)}</span>`
                + METRICS.map(metric => (
                    `<span class="as-queue-row-value is-${metric.tone}" title="${Model.escapeHtml(metric.label)}">`
                    + `${icon(metric)}<strong>${count(queue[metric.key])}</strong></span>`
                )).join("") + `</button>`;
        }).join("");
    }

    function metricRow(metric, previous, comparison) {
        const delta = Model.trend(metric, previous);
        return `<span class="as-metric${metric.primary ? " is-primary" : ""}">`
            + `<span class="as-metric-label">${Model.escapeHtml(metric.label)}</span>`
            + `<strong class="as-metric-value">${Model.escapeHtml(Model.formatMetric(metric))}</strong>`
            + `<span class="as-metric-detail">${Model.escapeHtml(metric.detail || "")}</span>`
            + (delta ? `<span class="as-metric-trend is-${delta.direction}" title="${Model.escapeHtml(comparison.label)}: ${Model.escapeHtml(delta.previous)}">`
                + `${Model.escapeHtml(delta.text)}</span>` : "<span></span>")
            + `</span>`;
    }

    function renderMetrics(phone, totals) {
        const comparison = phone.comparison && phone.comparison.summary ? phone.comparison : null;
        const previous = comparison
            ? Model.callMetrics(Model.scopeTotals({...comparison, available: true}, state.queue)) : [];
        dom.asCompareLabel.textContent = comparison ? `ggü. ${comparison.label}` : "";
        const rows = Model.callMetrics(totals).map((metric, index) => ({metric, html: metricRow(metric, previous[index], comparison)}));
        const note = totals.hasTimes ? ""
            : '<span class="as-muted as-metrics-note">Zeiten je Hotline sind noch nicht verfügbar.</span>';
        dom.asTimes.innerHTML = rows.filter(row => !row.metric.extra).map(row => row.html).join("") + note;
        dom.asMoreToggle.disabled = false;
        dom.asMoreToggle.setAttribute("aria-expanded", String(state.moreOpen));
        dom.asMetricsCard.classList.toggle("is-open", state.moreOpen);
        dom.asMoreMetrics.hidden = !state.moreOpen;
        dom.asMoreMetrics.innerHTML = rows.filter(row => row.metric.extra).map(row => row.html).join("");
    }

    function renderPhone(phone) {
        renderScope(phone);
        dom.asPhoneRange.textContent = phone.available && state.period === "month" ? rangeLabel(phone) : "";
        if (!phone.available) {
            const message = '<p class="as-muted">Telefonie für diesen Zeitraum nicht verfügbar.</p>';
            dom.asPhoneSummary.innerHTML = message;
            dom.asTimes.innerHTML = '<span class="as-muted">Telefonie für diesen Zeitraum nicht verfügbar.</span>';
            dom.asCallTotal.hidden = true;
            dom.asQueueList.hidden = true;
            dom.asQueueList.innerHTML = "";
            dom.asMoreToggle.disabled = true;
            dom.asMoreToggle.setAttribute("aria-expanded", "false");
            dom.asMetricsCard.classList.remove("is-open");
            dom.asMoreMetrics.hidden = true;
            dom.asMoreMetrics.innerHTML = "";
            dom.asCallBox.classList.remove("is-interactive", "is-open");
            dom.asOther.innerHTML = "";
            dom.asCompareLabel.textContent = "";
            return;
        }
        const totals = Model.scopeTotals(phone, state.queue);
        const rows = Model.queueRows(phone);
        const interactive = rows.length > 1;
        if (!interactive) state.queuesOpen = false;
        const calls = totals.answered + totals.not_answered;
        dom.asCallTotal.hidden = false;
        dom.asCallTotal.textContent = `${count(calls)} ${calls === 1 ? "Anruf" : "Anrufe"}`;
        dom.asCallTotal.title = "Angenommen + verpasst";
        dom.asCallBox.classList.toggle("is-interactive", interactive);
        dom.asCallBox.classList.toggle("is-open", state.queuesOpen);
        dom.asPhoneSummary.innerHTML = callKpis(totals, interactive);
        renderQueues(rows);
        renderMetrics(phone, totals);
        const other = !state.queue && phone.other || {};
        dom.asOther.innerHTML = [
            other.outbound && `${count(other.outbound)} ausgehend`,
            other.direct && `${count(other.direct)} direkt`,
            other.unclassified && `${count(other.unclassified)} ohne geklärte Queue-Zuordnung`,
        ].filter(Boolean).map(label => `<span>${Model.escapeHtml(label)}</span>`).join("");
    }

    function renderPresence(report) {
        const presence = report.presence;
        dom.asPresenceRange.textContent = presence.available && state.period === "month" ? rangeLabel(presence) : "";
        if (!presence.available) {
            dom.asStatuses.hidden = false;
            dom.asStatuses.innerHTML = '<p class="as-muted">Anwesenheit für diesen Zeitraum nicht verfügbar.</p>';
            dom.asLogTotal.hidden = true;
            dom.asStatusToggle.hidden = true;
            dom.asTimelineWrap.hidden = true;
            return;
        }
        const statuses = Model.presenceStatuses(presence.statuses, presence.timeline);
        const logged = Model.loggedSeconds(statuses);
        dom.asLogTotal.hidden = false;
        dom.asLogTotal.textContent = `Eingeloggt ${Model.formatDuration(logged)}`;
        dom.asTimelineWrap.hidden = state.period !== "day" || !presence.timeline.length;
        // Without a timeline the status cards are the only content, so they are always shown.
        const collapsible = !dom.asTimelineWrap.hidden && statuses.length > 0;
        dom.asStatusToggle.hidden = !collapsible;
        dom.asStatusToggle.setAttribute("aria-expanded", String(state.statusesOpen));
        dom.asStatuses.hidden = collapsible && !state.statusesOpen;
        // With a timeline, a status card highlights its sections there; clicking it again clears that.
        const pickable = !dom.asTimelineWrap.hidden;
        if (!pickable || !statuses.some(item => item.label === state.focusStatus)) state.focusStatus = null;
        dom.asStatuses.innerHTML = statuses.length ? statuses.map(item => {
            const tag = pickable ? "button" : "div";
            const attributes = pickable ? ` type="button" data-status="${Model.escapeHtml(item.label)}" aria-pressed="${item.label === state.focusStatus}"` : "";
            return `<${tag} class="as-status-kpi tc-status-${Model.escapeHtml(item.group)}"${attributes}>`
                + `<span class="as-status-kpi-label">${Model.escapeHtml(item.label)}</span>`
                + `<span class="as-status-kpi-values"><strong class="as-status-kpi-value">${Model.formatDuration(item.seconds)}</strong>`
                + (item.count != null ? `<span class="as-status-kpi-count" title="${count(item.count)} erfasste Statusabschnitte">${count(item.count)}×</span>` : "")
                + `</span></${tag}>`;
        }).join("") : '<p class="as-muted">Keine Statuszeiten in diesem Zeitraum.</p>';
        if (!dom.asTimelineWrap.hidden) {
            const view = {day_start: report.from, day_end: report.to, genesys: presence.timeline};
            const range = Model.focusRange(presence.timeline, report.from, report.to);
            const pct = Time.nowPercent(Date.now(), view, range);
            const marker = pct == null ? "" : `<span class="tc-now" style="left:${pct.toFixed(4)}%" title="Jetzt"></span>`;
            dom.asTimeline.innerHTML = Timeline.axisHtml(range) + Timeline.genesysRowHtml(view, range, marker);
        }
        highlightStatus();
    }

    function highlightStatus() {
        const focus = state.focusStatus;
        dom.asStatuses.classList.toggle("has-focus", focus != null);
        dom.asTimelineWrap.classList.toggle("has-focus", focus != null);
        if (!dom.asTimeline.querySelectorAll) return;
        dom.asTimeline.querySelectorAll(".tc-seg-genesys").forEach(segment => {
            const label = segment.querySelector(".tc-seg-label");
            segment.classList.toggle("is-focus", focus != null && label != null && label.textContent === focus);
        });
    }

    function render(report) {
        state.report = report;
        renderControls(report);
        dom.asStatus.classList.remove("is-error");
        dom.asStatus.textContent = "";
        if (!report.account_linked) {
            dom.asContent.hidden = true;
            dom.asEmpty.hidden = false;
            dom.asEmpty.textContent = "Für dein SOFA-Konto ist kein gültiges Genesys-Konto verknüpft.";
            return;
        }
        dom.asEmpty.hidden = true;
        dom.asContent.hidden = false;
        renderPresence(report);
        renderPhone(report.phone);
    }

    async function load() {
        const number = ++state.requestNumber;
        dom.asReload.disabled = true;
        dom.asStatus.classList.remove("is-error");
        dom.asStatus.textContent = "Lade persönliche Genesys-Zahlen …";
        const params = new URLSearchParams({period: state.period});
        if (state.anchor) params.set("anchor", state.anchor);
        const query = params.toString();
        syncUrl();
        try {
            const response = await fetch(`/api/reporting/agent-stats?${query}`, {cache: "no-store"});
            if (number !== state.requestNumber) return;
            if (!response.ok) {
                if (response.status === 401) throw new Error("Bitte neu anmelden, um den persönlichen Report zu öffnen.");
                if (response.status === 503) throw new Error("Der persönliche Report ist derzeit nicht verfügbar.");
                if (response.status === 422) throw new Error("Dieser Zeitraum ist nicht verfügbar.");
                throw new Error("Genesys-Zahlen konnten nicht geladen werden.");
            }
            const data = await response.json();
            if (number !== state.requestNumber) return;
            render(data);
        } catch (error) {
            if (number !== state.requestNumber) return;
            dom.asContent.hidden = true;
            dom.asEmpty.hidden = false;
            dom.asEmpty.textContent = error.message;
            dom.asStatus.classList.add("is-error");
            dom.asStatus.textContent = error.message;
        } finally {
            if (number === state.requestNumber) dom.asReload.disabled = false;
        }
    }

    dom.asReload.addEventListener("click", load);
    root.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
        if (button.dataset.period !== state.period) setPeriod(button.dataset.period);
    }));
    dom.asMonthPrev.addEventListener("click", () => {
        state.monthAnchor = Model.shiftMonth(state.monthAnchor, -1); state.anchor = state.monthAnchor; load();
    });
    dom.asMonthNext.addEventListener("click", () => {
        state.monthAnchor = Model.shiftMonth(state.monthAnchor, 1); state.anchor = state.monthAnchor; load();
    });
    dom.asMonthCurrent.addEventListener("click", () => {
        state.monthAnchor = state.today.slice(0, 7) + "-01"; state.anchor = state.monthAnchor; load();
    });
    dom.asMonthInput.addEventListener("change", () => {
        const value = dom.asMonthInput.value;
        if (value >= dom.asMonthInput.min && value <= dom.asMonthInput.max) {
            state.monthAnchor = value + "-01"; state.anchor = state.monthAnchor; load();
        }
    });
    function rerender(key) {
        state[key] = !state[key];
        if (key === "statusesOpen" && !state.statusesOpen) state.focusStatus = null;
        if (!state.report || !state.report.account_linked) return;
        if (key === "statusesOpen") renderPresence(state.report);
        else renderPhone(state.report.phone);
    }
    dom.asStatusToggle.addEventListener("click", () => rerender("statusesOpen"));
    dom.asStatuses.addEventListener("click", event => {
        const button = event.target.closest("[data-status]");
        if (!button) return;
        state.focusStatus = state.focusStatus === button.dataset.status ? null : button.dataset.status;
        dom.asStatuses.querySelectorAll("[data-status]").forEach(item => {
            item.setAttribute("aria-pressed", String(item.dataset.status === state.focusStatus));
        });
        highlightStatus();
    });
    dom.asMoreToggle.addEventListener("click", () => rerender("moreOpen"));
    dom.asPhoneSummary.addEventListener("click", event => {
        if (event.target.closest("[data-toggle-queues]")) rerender("queuesOpen");
    });
    dom.asQueueList.addEventListener("click", event => {
        const button = event.target.closest("[data-queue]");
        if (button) setQueue(button.dataset.queue === state.queue ? null : button.dataset.queue);
    });
    dom.asQueueReset.addEventListener("click", () => setQueue(null));
    window.addEventListener("popstate", () => {
        const parsed = Model.parseSelection(window.location.search);
        state.period = parsed.period; state.anchor = parsed.anchor; state.queue = parsed.queue;
        if (parsed.anchor) {
            if (parsed.period === "day") state.dayAnchor = parsed.anchor;
            else state.monthAnchor = parsed.anchor.slice(0, 7) + "-01";
        }
        load();
    });
    load();
}());
