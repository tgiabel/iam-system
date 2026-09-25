// Datumswahl wie in der Zeitkorrektur: ‹ [Datum wählen] [Gestern] [Heute] ›.
// Die Pfeile springen einen Tag und erscheinen nur, wenn es in die Richtung weitergeht.
// Tage sind Kalendertage „JJJJ-MM-TT“; heute, gestern und der früheste Tag kommen vom Server.
// Die Zeitkorrektur hat noch ihre eigene Fassung (time_correction_model.js).
(function (root, factory) {
    const picker = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = picker;
    }
    if (root) {
        root.DayPicker = picker;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const DAY_NAMES = ["Heute", "Gestern"];

    // `index` 0 = heute, 1 = gestern, sonst ohne Namen.
    function dayLabel(isoDate, index) {
        const [year, month, day] = isoDate.split("-");
        const weekday = WEEKDAYS[new Date(Date.UTC(+year, +month - 1, +day)).getUTCDay()];
        const name = DAY_NAMES[index];
        return `${name ? name + " · " : ""}${weekday} ${day}.${month}.`;
    }

    // Ein Kalendertag, den es gibt, der nicht nach heute und nicht vor dem frühesten Tag liegt.
    function isPickableDay(date, today, firstDay) {
        if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
        const [year, month, day] = date.split("-").map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
            && date <= today && (!firstDay || date >= firstDay);
    }

    // Kalendertag daneben; null, wenn er außerhalb liegt.
    function shiftDay(date, amount, today, firstDay) {
        const [year, month, day] = date.split("-").map(Number);
        const shifted = new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
        return isPickableDay(shifted, today, firstDay) ? shifted : null;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => (
            {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[char]));
    }

    // Verbindet das Markup unter `root` (data-day-*) mit `onSelect(tag)`. `render` zeichnet den Stand.
    function mount(root, onSelect) {
        const dom = {
            prev: root.querySelector("[data-day-prev]"),
            next: root.querySelector("[data-day-next]"),
            pick: root.querySelector("[data-day-pick]"),
            input: root.querySelector("[data-day-input]"),
            days: root.querySelector("[data-day-list]"),
        };
        let state = {day: null, today: null, yesterday: null, firstDay: null};

        function select(date) {
            if (isPickableDay(date, state.today, state.firstDay) && date !== state.day) onSelect(date);
            else render(state);
        }

        function render(next) {
            state = {...state, ...next};
            const quick = [state.yesterday, state.today].filter((day) => isPickableDay(day, state.today, state.firstDay));
            dom.days.innerHTML = quick.map((day) => (
                `<button type="button" class="ui-flat-button day-picker-day" data-date="${day}" aria-pressed="${day === state.day}">`
                + `${escapeHtml(dayLabel(day, day === state.today ? 0 : 1))}</button>`
            )).join("");
            const picked = Boolean(state.day) && !quick.includes(state.day);
            dom.pick.textContent = picked ? dayLabel(state.day, -1) : "Datum wählen";
            dom.pick.setAttribute("aria-pressed", String(picked));
            dom.input.max = state.today || "";
            dom.input.min = state.firstDay || "";
            dom.input.value = state.day || "";
            // Ohne Ziel nur unsichtbar, damit die Tage nicht verrutschen.
            [[dom.prev, -1], [dom.next, 1]].forEach(([button, amount]) => {
                const off = !state.day || !shiftDay(state.day, amount, state.today, state.firstDay);
                button.classList.toggle("is-off", off);
                button.disabled = off;
                button.setAttribute("aria-hidden", String(off));
            });
        }

        function openCalendar() {
            if (typeof dom.input.showPicker === "function") {
                try {
                    dom.input.showPicker();
                    return;
                } catch (_) { /* ohne Nutzergeste oder nicht unterstützt: Feld fokussieren */ }
            }
            dom.input.focus();
            dom.input.click();
        }

        dom.prev.addEventListener("click", () => select(shiftDay(state.day, -1, state.today, state.firstDay)));
        dom.next.addEventListener("click", () => select(shiftDay(state.day, 1, state.today, state.firstDay)));
        dom.pick.addEventListener("click", openCalendar);
        dom.input.addEventListener("change", () => select(dom.input.value));
        dom.days.addEventListener("click", (event) => {
            const button = event.target.closest("[data-date]");
            if (button) select(button.dataset.date);
        });
        return {render};
    }

    return {dayLabel, isPickableDay, shiftDay, mount};
}));
