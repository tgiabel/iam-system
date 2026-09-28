document.addEventListener("DOMContentLoaded", function () {
    "use strict";

    const Model = window.TokenDeletionsReportModel;
    const API = "/api/reporting/token-deletions/overview";
    const initial = Model.readUrl(window.location.search);
    const state = {
        year: initial.year,
        weekStart: initial.weekStart,
        report: null,
        loading: false,
        error: null,
        requestId: 0,
    };

    const $ = (id) => document.getElementById(id);
    const dom = {
        reload: $("tdrReload"), loadedAt: $("tdrLoadedAt"), status: $("tdrStatus"),
        todayValue: $("tdrTodayValue"), todayDate: $("tdrTodayDate"),
        yesterdayValue: $("tdrYesterdayValue"), yesterdayDate: $("tdrYesterdayDate"),
        yearPrev: $("tdrYearPrev"), yearNext: $("tdrYearNext"), yearLabel: $("tdrYearLabel"),
        monthsHead: $("tdrMonthsHead"), monthsBody: $("tdrMonthsBody"), yearEmpty: $("tdrYearEmpty"),
        weekPrev: $("tdrWeekPrev"), weekNext: $("tdrWeekNext"), weekLabel: $("tdrWeekLabel"),
        daysHead: $("tdrDaysHead"), daysBody: $("tdrDaysBody"), weekEmpty: $("tdrWeekEmpty"),
    };

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => (
            {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[char]));
    }

    async function api(params) {
        const response = await fetch(`${API}?${params}`, {
            headers: {Accept: "application/json"}, credentials: "same-origin",
        });
        let body = null;
        try {
            body = await response.json();
        } catch (_) { /* response without JSON */ }
        if (!response.ok) {
            const detail = body && body.detail;
            const error = new Error((detail && detail.message) || (typeof detail === "string" && detail)
                || `Laden fehlgeschlagen (HTTP ${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    async function load(allowFallback = true) {
        const requestId = ++state.requestId;
        state.loading = true;
        state.error = null;
        render();
        const params = new URLSearchParams();
        if (state.year) params.set("year", state.year);
        if (state.weekStart) params.set("week_start", state.weekStart);
        try {
            const report = await api(params);
            if (requestId !== state.requestId) return;
            state.report = report;
            state.year = report.year.value;
            state.weekStart = report.week.start;
            window.history.replaceState(null, "", window.location.pathname
                + Model.writeUrl(state.year, state.weekStart, report.today));
        } catch (error) {
            if (requestId !== state.requestId) return;
            if (allowFallback && error.status === 422 && (state.year || state.weekStart)) {
                state.year = null;
                state.weekStart = null;
                load(false);
                return;
            }
            state.report = null;
            state.error = error.message;
        }
        state.loading = false;
        render();
    }

    function render() {
        const report = state.report;
        dom.reload.disabled = state.loading;
        dom.status.className = "tdr-status" + (state.error ? " is-error" : "");
        dom.status.innerHTML = state.loading
            ? "Wird geladen…"
            : state.error
                ? `${escapeHtml(state.error)} <button type="button" data-retry>Erneut laden</button>`
                : "";
        dom.loadedAt.textContent = report ? Model.formatAsOf(report.data_as_of) : "";

        dom.todayValue.textContent = report ? Model.formatCount(report.totals.today) : "–";
        dom.yesterdayValue.textContent = report ? Model.formatCount(report.totals.yesterday) : "–";
        dom.todayDate.textContent = report ? Model.formatDay(report.today).date : "";
        dom.yesterdayDate.textContent = report ? Model.formatDay(report.yesterday).date : "";

        renderYear(report);
        renderWeek(report);
    }

    function renderYear(report) {
        if (!report) {
            dom.yearLabel.textContent = "–";
            dom.monthsHead.innerHTML = "";
            dom.monthsBody.innerHTML = "";
            dom.yearPrev.disabled = true;
            dom.yearNext.disabled = true;
            dom.yearEmpty.hidden = true;
            return;
        }
        const year = report.year.value;
        dom.yearLabel.textContent = year;
        dom.yearPrev.disabled = state.loading
            || Model.shiftYear(year, -1, report.first_day, report.today) === null;
        dom.yearNext.disabled = state.loading
            || Model.shiftYear(year, 1, report.first_day, report.today) === null;
        dom.monthsHead.innerHTML = "<tr><th>Monat</th>" + Model.MONTHS.map((month) =>
            `<th>${month}</th>`).join("") + "</tr>";
        dom.monthsBody.innerHTML = "<tr><th>Tokenlöschungen</th>" + report.year.months.map((month) => {
            const current = year === Number(report.today.slice(0, 4))
                && month.month === Number(report.today.slice(5, 7));
            const outside = Model.isOutsideMonth(year, month.month, report.first_day, report.today);
            return `<td class="${current ? "is-current " : ""}${outside ? "is-outside" : ""}">`
                + `<strong>${Model.formatCount(month.count)}</strong></td>`;
        }).join("") + "</tr>";
        dom.yearEmpty.hidden = report.year.months.some((month) => month.count);
    }

    function renderWeek(report) {
        if (!report) {
            dom.weekLabel.textContent = "–";
            dom.daysHead.innerHTML = "";
            dom.daysBody.innerHTML = "";
            dom.weekPrev.disabled = true;
            dom.weekNext.disabled = true;
            dom.weekEmpty.hidden = true;
            return;
        }
        const week = report.week;
        dom.weekLabel.textContent = Model.formatWeek(week.start, week.end, week.iso_week);
        dom.weekPrev.disabled = state.loading
            || Model.shiftWeek(week.start, -1, report.first_day, report.today) === null;
        dom.weekNext.disabled = state.loading
            || Model.shiftWeek(week.start, 1, report.first_day, report.today) === null;
        dom.daysHead.innerHTML = "<tr><th>Tag</th>" + week.days.map((day) => {
            const label = Model.formatDay(day.date);
            return `<th class="${day.date === report.today ? "is-current" : ""}">`
                + `${escapeHtml(label.weekday)}<span>${label.date}</span></th>`;
        }).join("") + "</tr>";
        dom.daysBody.innerHTML = "<tr><th>Tokenlöschungen</th>" + week.days.map((day) => {
            const classes = [
                day.date === report.today ? "is-current" : "",
                day.date > report.today || (report.first_day && day.date < report.first_day) ? "is-outside" : "",
            ].filter(Boolean).join(" ");
            return `<td class="${classes}"><strong>${Model.formatCount(day.count)}</strong></td>`;
        }).join("") + "</tr>";
        dom.weekEmpty.hidden = week.days.some((day) => day.count);
    }

    function navigateYear(amount) {
        if (!state.report) return;
        const target = Model.shiftYear(state.report.year.value, amount,
            state.report.first_day, state.report.today);
        if (target === null) return;
        state.year = target;
        load();
    }

    function navigateWeek(amount) {
        if (!state.report) return;
        const target = Model.shiftWeek(state.report.week.start, amount,
            state.report.first_day, state.report.today);
        if (target === null) return;
        state.weekStart = target;
        load();
    }

    dom.reload.addEventListener("click", () => load());
    dom.yearPrev.addEventListener("click", () => navigateYear(-1));
    dom.yearNext.addEventListener("click", () => navigateYear(1));
    dom.weekPrev.addEventListener("click", () => navigateWeek(-1));
    dom.weekNext.addEventListener("click", () => navigateWeek(1));
    dom.status.addEventListener("click", (event) => {
        if (event.target.closest("[data-retry]")) load();
    });
    window.addEventListener("popstate", () => {
        const url = Model.readUrl(window.location.search);
        state.year = url.year;
        state.weekStart = url.weekStart;
        load();
    });

    load();
});
