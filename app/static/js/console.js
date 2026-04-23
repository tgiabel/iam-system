const consoleState = {
    events: [],
    weekOffset: 0,
    loading: false,
    error: null
};

const consoleDOM = {};

const LABELS = {
    event_status: {
        PLANNED: "Geplant",
        EXECUTED: "Erledigt",
        SKIPPED: "Übersprungen",
        FAILED: "Fehler",
        CANCELED: "Abgebrochen"
    },
};

function formatFromMap(map, value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }
    return map[value] || humanizeToken(value);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeToken(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function humanizeToken(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return "-";
    }

    return normalized
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function parseDateLike(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getTime());
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return null;
    }

    const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        return new Date(Number(year), Number(month) - 1, Number(day));
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfISOWeek(date) {
    const baseDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const weekday = baseDate.getDay() || 7;
    baseDate.setDate(baseDate.getDate() - weekday + 1);
    baseDate.setHours(0, 0, 0, 0);
    return baseDate;
}

function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
}

function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function toDayKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function getISOWeekInfo(date) {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + 4 - (target.getDay() || 7));
    const yearStart = new Date(target.getFullYear(), 0, 1);
    const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
    return {
        year: target.getFullYear(),
        week
    };
}

function formatDayHeading(date) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(date);
}

function formatDayDate(date) {
    return new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit"
    }).format(date);
}

function formatWeekRange(startDate) {
    const endDate = addDays(startDate, 6);
    return `${new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit"
    }).format(startDate)} - ${new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(endDate)}`;
}

function formatTime(value) {
    const parsed = parseDateLike(value);
    if (!parsed) {
        return "";
    }

    if (!/[tT ]\d{1,2}:\d{2}/.test(String(value))) {
        return "";
    }

    return new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
    }).format(parsed);
}

function getWeekStart() {
    const baseWeek = startOfISOWeek(new Date());
    return addDays(baseWeek, consoleState.weekOffset * 7);
}

function getWeekDays() {
    const weekStart = getWeekStart();
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function getRenderableEvents() {
    return (Array.isArray(consoleState.events) ? consoleState.events : [])
        .map(event => {
            const eventDate = parseDateLike(event.display_at);
            if (!eventDate) {
                return null;
            }

            return {
                ...event,
                _date: eventDate
            };
        })
        .filter(Boolean);
}

function getEventsByDay() {
    const weekDays = getWeekDays();
    const buckets = new Map(weekDays.map(day => [toDayKey(day), []]));

    getRenderableEvents().forEach(event => {
        const key = toDayKey(event._date);
        if (!buckets.has(key)) {
            return;
        }
        buckets.get(key).push(event);
    });

    buckets.forEach(items => {
        items.sort((left, right) => {
            const timestampDiff = left._date.getTime() - right._date.getTime();
            if (timestampDiff !== 0) {
                return timestampDiff;
            }
            return String(left.title || "").localeCompare(String(right.title || ""), "de");
        });
    });

    return buckets;
}

function setFeedback(message, stateClass = "") {
    if (!consoleDOM.feedback) {
        return;
    }

    consoleDOM.feedback.textContent = message;
    consoleDOM.feedback.className = "console-calendar-feedback";
    if (stateClass) {
        consoleDOM.feedback.classList.add(stateClass);
    }
}

function getEventTypeClass(eventType) {
    const normalized = normalizeToken(eventType);
    return {
        onboarding: "console-event-type-onboarding",
        offboarding: "console-event-type-offboarding",
        role_assignment: "console-event-type-role_assignment",
        role_removal: "console-event-type-role_removal"
    }[normalized] || "console-event-type-default";
}

function getEventStatusClass(eventStatus) {
    const normalized = normalizeToken(eventStatus);
    return {
        planned: "console-event-status-planned",
        executed: "console-event-status-executed",
        failed: "console-event-status-failed",
        skipped: "console-event-status-skipped",
        canceled: "console-event-status-canceled"
    }[normalized] || "console-event-status-skipped";
}

function renderEventCard(event) {
    const title = event.title || humanizeToken(event.event_type || "event");
    const description = String(event.description || "").trim();
    const time = formatTime(event.display_at);
    const typeLabel = humanizeToken(event.event_type || "event");
    const statusLabel = formatFromMap(LABELS.event_status, event.event_status) || humanizeToken(event.event_status || "unknown");

    return `
        <article class="console-event-card ${event.blocks_process_completion ? "is-blocking" : ""}">
            <strong class="console-event-title">${escapeHtml(title)}</strong>
            <div class="console-event-meta">
                <span class="console-event-badge ${escapeHtml(getEventStatusClass(event.event_status))} hidden">${escapeHtml(statusLabel)}</span>
            </div>
            ${description ? `<span class="console-event-description">${escapeHtml(description)}</span>` : ""}
        </article>
    `;
}

function renderCalendar() {
    if (!consoleDOM.grid) {
        return;
    }

    const weekDays = getWeekDays();
    const eventsByDay = getEventsByDay();
    const today = new Date();
    const hasWeekEvents = Array.from(eventsByDay.values()).some(items => items.length > 0);

    const { week, year } = getISOWeekInfo(weekDays[0]);
    consoleDOM.weekLabel.textContent = `KW ${String(week).padStart(2, "0")} / ${year}`;
    consoleDOM.weekRange.textContent = formatWeekRange(weekDays[0]);

    const dayMarkup = weekDays.map(day => {
        const dayKey = toDayKey(day);
        const events = eventsByDay.get(dayKey) || [];

        return `
            <section class="console-calendar-day ${isSameDay(day, today) ? "is-today" : ""} ${events.length ? "" : "is-empty"}">
                <div class="console-day-head">
                    <strong class="console-day-title">${escapeHtml(humanizeToken(formatDayHeading(day)))}</strong>
                    <span class="console-day-date">${escapeHtml(formatDayDate(day))}</span>
                </div>
                <div class="console-day-events">
                    ${events.length
                        ? events.map(renderEventCard).join("")
                        : `<div class="console-empty-day">Keine Events in diesem Tag.</div>`}
                </div>
            </section>
        `;
    }).join("");

    consoleDOM.grid.innerHTML = hasWeekEvents
        ? dayMarkup
        : `${dayMarkup}<div class="console-empty-week">In dieser Kalenderwoche sind keine Events vorhanden.</div>`;

    if (consoleState.error) {
        setFeedback(consoleState.error, "is-error");
        return;
    }

    setFeedback(
        hasWeekEvents
            ? "Die sichtbare Kalenderwoche wurde aus den geladenen Prozess-Events aufgebaut."
            : "Für die sichtbare Kalenderwoche wurden keine Events gefunden.",
        "is-success"
    );
}

async function loadEvents() {
    consoleState.loading = true;
    consoleState.error = null;
    setFeedback("Events werden geladen…");

    try {
        const response = await fetch("/api/events");
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || data.detail || `Events konnten nicht geladen werden (${response.status})`);
        }

        consoleState.events = Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Kalender-Events konnten nicht geladen werden", error);
        consoleState.events = [];
        consoleState.error = error instanceof Error
            ? error.message
            : "Events konnten nicht geladen werden.";
    } finally {
        consoleState.loading = false;
        renderCalendar();
    }
}

function bindControls() {
    consoleDOM.prevBtn?.addEventListener("click", () => {
        consoleState.weekOffset -= 1;
        renderCalendar();
    });

    consoleDOM.nextBtn?.addEventListener("click", () => {
        consoleState.weekOffset += 1;
        renderCalendar();
    });

    consoleDOM.currentBtn?.addEventListener("click", () => {
        consoleState.weekOffset = 0;
        renderCalendar();
    });
}

function cacheDom() {
    consoleDOM.grid = document.getElementById("console-calendar-grid");
    consoleDOM.feedback = document.getElementById("console-calendar-feedback");
    consoleDOM.weekLabel = document.getElementById("console-week-label");
    consoleDOM.weekRange = document.getElementById("console-week-range");
    consoleDOM.prevBtn = document.getElementById("console-week-prev");
    consoleDOM.nextBtn = document.getElementById("console-week-next");
    consoleDOM.currentBtn = document.getElementById("console-week-current");
}

function initConsoleCalendar() {
    cacheDom();
    if (!consoleDOM.grid) {
        return;
    }

    bindControls();
    renderCalendar();
    loadEvents();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConsoleCalendar);
} else {
    initConsoleCalendar();
}
