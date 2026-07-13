const PAGE_SIZE = 100;
const MAX_CACHED_DAYS = 7;

const ivrReportState = {
    day: null,
    loading: false,
    allRows: [],
    searchTerm: "",
    sortDirection: "asc",
    page: 1,
};

const ivrReportDom = {};
const ivrReportDayCache = new Map();

const PERSISTED_KEY = "sofaIvrReportFilters";

let ivrSearchDebounceTimer = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatPlainValue(value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }
    return String(value);
}

function normalizeValue(value) {
    return String(value ?? "").trim().toLowerCase();
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function isValidDayKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildDayKey(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dayKeyAddDays(dayKey, delta) {
    const [year, month, day] = dayKey.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day) + delta * 86400000);
    return buildDayKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function getYesterdayDayKey() {
    const now = new Date();
    const todayKey = buildDayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return dayKeyAddDays(todayKey, -1);
}

function formatDayLabel(dayKey) {
    if (!isValidDayKey(dayKey)) {
        return formatPlainValue(dayKey);
    }
    const [year, month, day] = dayKey.split("-");
    return `${day}.${month}.${year}`;
}

function formatNaiveDateTime(value) {
    if (!value) {
        return "-";
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(value));
    if (!match) {
        return String(value);
    }
    const [, year, month, day, hour, minute, second] = match;
    return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
}

function loadPersistedFilters() {
    try {
        const raw = localStorage.getItem(PERSISTED_KEY);
        if (!raw) {
            return;
        }
        const saved = JSON.parse(raw);
        if (isValidDayKey(saved.day)) {
            ivrReportState.day = saved.day;
        }
    } catch (err) {
        console.error("Gespeicherter Tag konnte nicht geladen werden", err);
    }
}

function savePersistedFilters() {
    try {
        localStorage.setItem(PERSISTED_KEY, JSON.stringify({ day: ivrReportState.day }));
    } catch (err) {
        console.error("Tag konnte nicht gespeichert werden", err);
    }
}

const ivrReportApi = {
    async getReport(day) {
        const res = await fetch(`/api/reporting/ivr/report?day=${encodeURIComponent(day)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || `IVR Report konnte nicht geladen werden (${res.status})`);
        }
        return data;
    },
};

function cacheDom() {
    ivrReportDom.prevDayBtn = document.getElementById("ivrPrevDay");
    ivrReportDom.nextDayBtn = document.getElementById("ivrNextDay");
    ivrReportDom.dayLabel = document.getElementById("ivrDayLabel");
    ivrReportDom.dayPicker = document.getElementById("ivrDayPicker");
    ivrReportDom.retryBtn = document.getElementById("ivrRetryBtn");
    ivrReportDom.countChip = document.getElementById("ivrReportCount");
    ivrReportDom.tableBody = document.getElementById("ivrReportTableBody");
    ivrReportDom.searchInput = document.getElementById("ivrSearchInput");
    ivrReportDom.sortHeader = document.getElementById("ivrSortTimestamp");
    ivrReportDom.sortIndicator = document.getElementById("ivrSortIndicator");
    ivrReportDom.prevPageBtn = document.getElementById("ivrPrevPage");
    ivrReportDom.nextPageBtn = document.getElementById("ivrNextPage");
    ivrReportDom.pageLabel = document.getElementById("ivrPageLabel");
}

function updateDayToolbar() {
    const yesterday = getYesterdayDayKey();

    if (ivrReportDom.dayLabel) {
        ivrReportDom.dayLabel.textContent = formatDayLabel(ivrReportState.day);
    }
    if (ivrReportDom.dayPicker) {
        ivrReportDom.dayPicker.max = yesterday;
        ivrReportDom.dayPicker.value = ivrReportState.day || "";
    }
    if (ivrReportDom.nextDayBtn) {
        ivrReportDom.nextDayBtn.disabled = !ivrReportState.day || ivrReportState.day >= yesterday;
    }
    const disableNav = ivrReportState.loading;
    if (ivrReportDom.prevDayBtn) {
        ivrReportDom.prevDayBtn.disabled = disableNav;
    }
    if (ivrReportDom.retryBtn) {
        ivrReportDom.retryBtn.disabled = disableNav;
    }
}

function updateSortIndicator() {
    if (ivrReportDom.sortIndicator) {
        ivrReportDom.sortIndicator.textContent = ivrReportState.sortDirection === "asc" ? "▲" : "▼";
    }
}

function renderLoadingRow() {
    if (!ivrReportDom.tableBody) {
        return;
    }
    ivrReportDom.tableBody.innerHTML = `
        <tr class="ivr-report-empty-row">
            <td colspan="12">Lädt…</td>
        </tr>
    `;
}

function renderTable(rows) {
    if (!ivrReportDom.tableBody) {
        return;
    }

    if (!rows.length) {
        ivrReportDom.tableBody.innerHTML = `
            <tr class="ivr-report-empty-row">
                <td colspan="12">
                    <div class="ui-empty-state ui-empty-inline">Keine Anrufe für diesen Tag.</div>
                </td>
            </tr>
        `;
        return;
    }

    ivrReportDom.tableBody.innerHTML = rows.map(row => `
        <tr>
            <td>${escapeHtml(formatNaiveDateTime(row.TimeStamp))}</td>
            <td>${escapeHtml(formatPlainValue(row.Servicenummer))}</td>
            <td>${escapeHtml(formatPlainValue(row.RemoteNumber))}</td>
            <td>${escapeHtml(formatPlainValue(row.Herkunft))}</td>
            <td>${escapeHtml(formatPlainValue(row.Ziel))}</td>
            <td>${escapeHtml(formatPlainValue(row.ZielBezeichnung))}</td>
            <td>${escapeHtml(formatPlainValue(row.Ergebnis))}</td>
            <td>${escapeHtml(formatPlainValue(row.Rufdauer))}</td>
            <td>${escapeHtml(formatPlainValue(row.Faxweiche))}</td>
            <td>${escapeHtml(formatPlainValue(row.Sprachdialog))}</td>
            <td>${escapeHtml(formatPlainValue(row.Verbindung))}</td>
            <td>${escapeHtml(formatPlainValue(row.Leitungszeit))}</td>
        </tr>
    `).join("");
}

function matchesSearch(row) {
    const term = normalizeValue(ivrReportState.searchTerm);
    if (!term) {
        return true;
    }
    return [row.Ziel, row.ZielBezeichnung, row.RemoteNumber, row.CallId]
        .some(value => normalizeValue(value).includes(term));
}

function getFilteredSortedRows() {
    const filtered = ivrReportState.allRows.filter(matchesSearch);
    const direction = ivrReportState.sortDirection === "desc" ? -1 : 1;

    return filtered.sort((left, right) => {
        const leftValue = String(left.TimeStamp ?? "");
        const rightValue = String(right.TimeStamp ?? "");
        if (leftValue === rightValue) {
            return 0;
        }
        return (leftValue < rightValue ? -1 : 1) * direction;
    });
}

function renderCount(filteredCount) {
    if (!ivrReportDom.countChip) {
        return;
    }
    const total = ivrReportState.allRows.length;
    ivrReportDom.countChip.textContent = ivrReportState.searchTerm
        ? `${filteredCount} / ${total} Anrufe`
        : `${total} Anrufe`;
}

function renderPage() {
    const filtered = getFilteredSortedRows();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

    if (ivrReportState.page > totalPages) {
        ivrReportState.page = totalPages;
    }
    if (ivrReportState.page < 1) {
        ivrReportState.page = 1;
    }

    const startIndex = (ivrReportState.page - 1) * PAGE_SIZE;
    renderTable(filtered.slice(startIndex, startIndex + PAGE_SIZE));
    renderCount(filtered.length);

    if (ivrReportDom.pageLabel) {
        ivrReportDom.pageLabel.textContent = `Seite ${ivrReportState.page} / ${totalPages}`;
    }
    if (ivrReportDom.prevPageBtn) {
        ivrReportDom.prevPageBtn.disabled = ivrReportState.page <= 1;
    }
    if (ivrReportDom.nextPageBtn) {
        ivrReportDom.nextPageBtn.disabled = ivrReportState.page >= totalPages;
    }
}

function storeDayInCache(day, entry) {
    if (ivrReportDayCache.has(day)) {
        ivrReportDayCache.delete(day);
    }
    ivrReportDayCache.set(day, entry);
    while (ivrReportDayCache.size > MAX_CACHED_DAYS) {
        ivrReportDayCache.delete(ivrReportDayCache.keys().next().value);
    }
}

function getDayFromCache(day) {
    const entry = ivrReportDayCache.get(day);
    if (!entry) {
        return null;
    }
    ivrReportDayCache.delete(day);
    ivrReportDayCache.set(day, entry);
    return entry;
}

async function loadReport(day, { forceRefresh = false } = {}) {
    if (forceRefresh) {
        ivrReportDayCache.delete(day);
    }

    const cached = getDayFromCache(day);
    if (cached) {
        ivrReportState.day = day;
        ivrReportState.allRows = cached.rows;
        ivrReportState.page = 1;
        savePersistedFilters();
        updateDayToolbar();
        renderPage();
        return;
    }

    ivrReportState.loading = true;
    updateDayToolbar();
    renderLoadingRow();

    try {
        const data = await ivrReportApi.getReport(day);
        const resolvedDay = isValidDayKey(data.day) ? data.day : day;
        const rows = Array.isArray(data.data) ? data.data : [];

        storeDayInCache(resolvedDay, { rows, count: typeof data.count === "number" ? data.count : rows.length });

        ivrReportState.day = resolvedDay;
        ivrReportState.allRows = rows;
        ivrReportState.page = 1;
        savePersistedFilters();
        renderPage();
    } catch (err) {
        console.error("IVR Report Fehler", err);
        showFlash(err.message || "IVR Report konnte nicht geladen werden", "failure");
        ivrReportState.allRows = [];
        renderPage();
    } finally {
        ivrReportState.loading = false;
        updateDayToolbar();
    }
}

function scheduleSearch(value) {
    ivrReportState.searchTerm = value;
    ivrReportState.page = 1;
    clearTimeout(ivrSearchDebounceTimer);
    ivrSearchDebounceTimer = setTimeout(() => {
        renderPage();
    }, 200);
}

function bindEvents() {
    ivrReportDom.prevDayBtn?.addEventListener("click", () => {
        loadReport(dayKeyAddDays(ivrReportState.day, -1));
    });

    ivrReportDom.nextDayBtn?.addEventListener("click", () => {
        const yesterday = getYesterdayDayKey();
        const nextDay = dayKeyAddDays(ivrReportState.day, 1);
        if (nextDay > yesterday) {
            return;
        }
        loadReport(nextDay);
    });

    ivrReportDom.dayLabel?.addEventListener("click", () => {
        if (!ivrReportDom.dayPicker) {
            return;
        }
        if (typeof ivrReportDom.dayPicker.showPicker === "function") {
            ivrReportDom.dayPicker.showPicker();
        } else {
            ivrReportDom.dayPicker.focus();
            ivrReportDom.dayPicker.click();
        }
    });

    ivrReportDom.dayPicker?.addEventListener("change", event => {
        const value = event.target.value;
        if (isValidDayKey(value)) {
            loadReport(value);
        }
    });

    ivrReportDom.retryBtn?.addEventListener("click", () => {
        loadReport(ivrReportState.day, { forceRefresh: true });
    });

    ivrReportDom.searchInput?.addEventListener("input", event => {
        scheduleSearch(event.target.value || "");
    });

    function toggleSort() {
        ivrReportState.sortDirection = ivrReportState.sortDirection === "asc" ? "desc" : "asc";
        ivrReportState.page = 1;
        updateSortIndicator();
        renderPage();
    }

    ivrReportDom.sortHeader?.addEventListener("click", toggleSort);
    ivrReportDom.sortHeader?.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleSort();
        }
    });

    ivrReportDom.prevPageBtn?.addEventListener("click", () => {
        ivrReportState.page -= 1;
        renderPage();
    });

    ivrReportDom.nextPageBtn?.addEventListener("click", () => {
        ivrReportState.page += 1;
        renderPage();
    });
}

function initializeIvrReport() {
    cacheDom();
    loadPersistedFilters();

    const yesterday = getYesterdayDayKey();
    if (!isValidDayKey(ivrReportState.day) || ivrReportState.day > yesterday) {
        ivrReportState.day = yesterday;
    }

    updateSortIndicator();
    bindEvents();
    loadReport(ivrReportState.day);
}

document.addEventListener("DOMContentLoaded", initializeIvrReport);
