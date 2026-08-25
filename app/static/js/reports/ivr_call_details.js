const IVR_CALL_PAGE_SIZE = 100;
const IVR_CALL_MAX_CACHED_DAYS = 7;
const IVR_CALL_PERSISTED_KEY = "sofaIvrCallDetailsFilters";

const ivrCallState = {
    day: null,
    loading: false,
    error: null,
    allCalls: [],
    searchTerm: "",
    serviceNumber: "",
    issuesOnly: false,
    sortDirection: "asc",
    page: 1,
    expandedKeys: new Set(),
    metadata: {},
    requestToken: 0,
};

const ivrCallDom = {};
const ivrCallDayCache = new Map();
let ivrCallSearchTimer = null;

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
    return String(value ?? "").trim().toLocaleLowerCase("de");
}

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function isValidDayKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) {
        return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
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
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value));
    if (!match) {
        return String(value);
    }
    return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}:${match[6] || "00"}`;
}

function formatDuration(value) {
    const totalSeconds = Math.max(0, Math.round(toFiniteNumber(value, 0)));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) {
        return `${hours} Std. ${minutes} Min. ${seconds} Sek.`;
    }
    if (minutes) {
        return `${minutes} Min. ${seconds} Sek.`;
    }
    return `${seconds} Sek.`;
}

function isConnectedResult(value) {
    return normalizeValue(value) === "verbunden";
}

function normalizeSection(rawSection, index) {
    const raw = rawSection && typeof rawSection === "object" ? rawSection : {};
    return {
        sequence: toFiniteNumber(raw.sequence, index + 1),
        target: raw.target ?? null,
        targetLabel: raw.target_label ?? null,
        result: raw.result ?? null,
        durationSeconds: Math.max(0, toFiniteNumber(raw.duration_seconds, 0)),
    };
}

function normalizeCall(rawCall, index = 0) {
    const raw = rawCall && typeof rawCall === "object" ? rawCall : {};
    const sections = (Array.isArray(raw.sections) ? raw.sections : [])
        .map(normalizeSection)
        .sort((left, right) => left.sequence - right.sequence);
    const finalSection = sections.length ? sections[sections.length - 1] : null;
    const callId = raw.call_id ?? null;
    const sectionCount = sections.length || Math.max(0, toFiniteNumber(raw.section_count, 0));
    const totalDurationSeconds = sections.length
        ? sections.reduce((sum, section) => sum + section.durationSeconds, 0)
        : Math.max(0, toFiniteNumber(raw.total_duration_seconds, 0));
    const normalized = {
        key: callId === null || callId === undefined || callId === "" ? `missing-${index}` : String(callId),
        callId,
        startedAt: raw.started_at ?? null,
        serviceNumber: raw.service_number ?? null,
        callingPartyNumber: raw.calling_party_number ?? null,
        origin: raw.origin ?? null,
        finalTarget: finalSection ? finalSection.target : (raw.final_target ?? null),
        finalTargetLabel: finalSection ? finalSection.targetLabel : (raw.final_target_label ?? null),
        finalResult: finalSection ? finalSection.result : (raw.final_result ?? null),
        sectionCount,
        totalDurationSeconds,
        sections,
    };
    normalized.searchText = normalizeValue([
        normalized.callId,
        normalized.callingPartyNumber,
        normalized.origin,
        normalized.finalTarget,
        normalized.finalTargetLabel,
        normalized.finalResult,
        ...sections.flatMap(section => [section.target, section.targetLabel, section.result]),
    ].filter(value => value !== null && value !== undefined).join(" \u241f "));
    return normalized;
}

function normalizePayload(payload) {
    const rawCalls = payload && Array.isArray(payload.data) ? payload.data : [];
    return rawCalls.map(normalizeCall);
}

function callMatchesSearch(call, searchTerm) {
    const term = normalizeValue(searchTerm);
    return !term || call.searchText.includes(term);
}

function getFilteredSortedCalls() {
    const direction = ivrCallState.sortDirection === "desc" ? -1 : 1;
    return ivrCallState.allCalls
        .filter(call => callMatchesSearch(call, ivrCallState.searchTerm))
        .filter(call => !ivrCallState.serviceNumber || String(call.serviceNumber ?? "") === ivrCallState.serviceNumber)
        .filter(call => !ivrCallState.issuesOnly || !isConnectedResult(call.finalResult))
        .sort((left, right) => {
            const timeComparison = String(left.startedAt ?? "").localeCompare(String(right.startedAt ?? ""));
            if (timeComparison) {
                return timeComparison * direction;
            }
            return String(left.callId ?? "").localeCompare(String(right.callId ?? "")) * direction;
        });
}

function resultBadge(value) {
    const connected = isConnectedResult(value);
    const label = formatPlainValue(value);
    return `
        <span class="ivr-call-result ${connected ? "is-connected" : "is-issue"}">
            ${connected ? "" : '<span class="ivr-call-result-symbol" aria-hidden="true">!</span>'}
            <span>${escapeHtml(label)}</span>
        </span>`;
}

function targetContent(target, label) {
    return `
        <span class="ivr-call-primary">${escapeHtml(formatPlainValue(target))}</span>
        ${label ? `<span class="ivr-call-secondary" title="${escapeHtml(label)}">${escapeHtml(label)}</span>` : ""}`;
}

function renderSections(call) {
    if (!call.sections.length) {
        return `<div class="ui-empty-state ui-empty-inline">Für diesen Call wurden keine Routingabschnitte geliefert.</div>`;
    }
    return `
        <div class="ivr-call-sections">
            <h2 class="ivr-call-sections-title">Routingverlauf für Call ${escapeHtml(formatPlainValue(call.callId))}</h2>
            <ol class="ivr-call-section-list">
                ${call.sections.map(section => `
                    <li class="ivr-call-section">
                        <span class="ivr-call-section-number">Abschnitt ${escapeHtml(formatPlainValue(section.sequence))}</span>
                        <span>${targetContent(section.target, section.targetLabel)}</span>
                        <span>${resultBadge(section.result)}</span>
                        <span class="ivr-call-section-duration">Abschnittsdauer: <strong>${escapeHtml(formatDuration(section.durationSeconds))}</strong></span>
                    </li>
                `).join("")}
            </ol>
        </div>`;
}

function renderStateRow(message) {
    ivrCallDom.tableBody.innerHTML = `
        <tr class="ivr-call-details-state-row">
            <td colspan="9"><div class="ui-empty-state">${escapeHtml(message)}</div></td>
        </tr>`;
}

function renderTable(calls, startIndex) {
    if (!ivrCallDom.tableBody) {
        return;
    }
    if (ivrCallState.loading) {
        renderStateRow("IVR-Calls werden geladen …");
        return;
    }
    if (ivrCallState.error) {
        renderStateRow("Die Call-Daten konnten nicht geladen werden. Bitte erneut versuchen.");
        return;
    }
    if (!ivrCallState.allCalls.length) {
        renderStateRow(`Keine Anrufe für den ${formatDayLabel(ivrCallState.day)}. Das ist kein technischer Fehler.`);
        return;
    }
    if (!calls.length) {
        renderStateRow("Keine Calls entsprechen der aktuellen Suche und Filterung.");
        return;
    }

    ivrCallDom.tableBody.innerHTML = calls.map((call, index) => {
        const expanded = ivrCallState.expandedKeys.has(call.key);
        const panelId = `ivr-call-section-panel-${startIndex + index}`;
        const row = `
            <tr class="ivr-call-row${expanded ? " is-expanded" : ""}"
                data-call-key="${escapeHtml(call.key)}"
                tabindex="0"
                aria-expanded="${expanded}"
                aria-controls="${panelId}">
                <td>
                    <button type="button" class="ivr-call-toggle" aria-expanded="${expanded}" aria-controls="${panelId}" aria-label="Routingdetails für Call ${escapeHtml(formatPlainValue(call.callId))} ${expanded ? "schließen" : "öffnen"}">
                        <svg class="ivr-call-toggle-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
                            <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </td>
                <td>
                    <span class="ivr-call-primary">${escapeHtml(formatNaiveDateTime(call.startedAt))}</span>
                    <span class="ivr-call-secondary" title="${escapeHtml(formatPlainValue(call.callId))}">Call-ID: ${escapeHtml(formatPlainValue(call.callId))}</span>
                </td>
                <td>${escapeHtml(formatPlainValue(call.serviceNumber))}</td>
                <td>${escapeHtml(formatPlainValue(call.callingPartyNumber))}</td>
                <td>${escapeHtml(formatPlainValue(call.origin))}</td>
                <td>${targetContent(call.finalTarget, call.finalTargetLabel)}</td>
                <td>${resultBadge(call.finalResult)}</td>
                <td>${escapeHtml(formatPlainValue(call.sectionCount))}</td>
                <td>${escapeHtml(formatDuration(call.totalDurationSeconds))}</td>
            </tr>`;
        if (!expanded) {
            return row;
        }
        return `${row}
            <tr id="${panelId}" class="ivr-call-detail-row">
                <td colspan="9">${renderSections(call)}</td>
            </tr>`;
    }).join("");
}

function pluralize(count, singular, plural) {
    return `${count.toLocaleString("de-DE")} ${count === 1 ? singular : plural}`;
}

function updateStatus(filteredCalls) {
    if (!ivrCallDom.status) {
        return;
    }
    const sectionCount = filteredCalls.reduce((sum, call) => sum + call.sectionCount, 0);
    ivrCallDom.count.textContent = pluralize(filteredCalls.length, "Call", "Calls");
    ivrCallDom.sectionCount.textContent = pluralize(sectionCount, "Abschnitt", "Abschnitte");
    ivrCallDom.status.classList.toggle("is-error", Boolean(ivrCallState.error));
    if (ivrCallState.error) {
        ivrCallDom.status.textContent = ivrCallState.error;
        return;
    }
    const availableThrough = ivrCallState.metadata.dataAvailableThrough;
    ivrCallDom.status.textContent = availableThrough
        ? `Daten verfügbar bis ${formatDayLabel(availableThrough)}. Sortierung und Seitennavigation erfolgen auf Call-Ebene.`
        : "Sortierung und Seitennavigation erfolgen auf Call-Ebene.";
}

function updateControls(filteredCount, totalPages) {
    const yesterday = getYesterdayDayKey();
    ivrCallDom.dayLabel.textContent = formatDayLabel(ivrCallState.day);
    ivrCallDom.dayPicker.value = ivrCallState.day || "";
    ivrCallDom.dayPicker.max = yesterday;
    ivrCallDom.prevDay.disabled = ivrCallState.loading;
    ivrCallDom.nextDay.disabled = ivrCallState.loading || !ivrCallState.day || ivrCallState.day >= yesterday;
    ivrCallDom.retry.disabled = ivrCallState.loading;
    ivrCallDom.exportCsv.disabled = ivrCallState.loading || Boolean(ivrCallState.error) || filteredCount === 0;
    ivrCallDom.prevPage.disabled = ivrCallState.loading || ivrCallState.page <= 1;
    ivrCallDom.nextPage.disabled = ivrCallState.loading || ivrCallState.page >= totalPages;
    ivrCallDom.pageLabel.textContent = `Seite ${ivrCallState.page} / ${totalPages}`;
    ivrCallDom.sortIndicator.textContent = ivrCallState.sortDirection === "asc" ? "▲" : "▼";
}

function renderPage() {
    const filtered = getFilteredSortedCalls();
    const totalPages = Math.max(1, Math.ceil(filtered.length / IVR_CALL_PAGE_SIZE));
    ivrCallState.page = Math.min(Math.max(ivrCallState.page, 1), totalPages);
    const startIndex = (ivrCallState.page - 1) * IVR_CALL_PAGE_SIZE;
    renderTable(filtered.slice(startIndex, startIndex + IVR_CALL_PAGE_SIZE), startIndex);
    updateStatus(filtered);
    updateControls(filtered.length, totalPages);
}

function updateServiceFilterOptions() {
    const serviceNumbers = Array.from(new Set(
        ivrCallState.allCalls
            .map(call => call.serviceNumber)
            .filter(value => value !== null && value !== undefined && value !== "")
            .map(String),
    )).sort((left, right) => left.localeCompare(right, "de", { numeric: true }));

    if (ivrCallState.serviceNumber && !serviceNumbers.includes(ivrCallState.serviceNumber)) {
        ivrCallState.serviceNumber = "";
    }
    ivrCallDom.serviceFilter.innerHTML = [
        '<option value="">Alle Servicenummern</option>',
        ...serviceNumbers.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    ivrCallDom.serviceFilter.value = ivrCallState.serviceNumber;
}

function escapeCsvValue(value) {
    const text = String(value ?? "");
    const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
}

const IVR_CALL_CSV_COLUMNS = [
    ["Call-ID", (call) => call.callId],
    ["Callstart", (call) => call.startedAt],
    ["Servicerufnummer", (call) => call.serviceNumber],
    ["Anrufernummer", (call) => call.callingPartyNumber],
    ["Herkunft", (call) => call.origin],
    ["Finales Ziel", (call) => call.finalTarget],
    ["Finale Zielbezeichnung", (call) => call.finalTargetLabel],
    ["Finales Ergebnis", (call) => call.finalResult],
    ["Anzahl Routingabschnitte", (call) => call.sectionCount],
    ["Gesamtdauer Sekunden", (call) => call.totalDurationSeconds],
    ["Abschnittsnummer", (_call, section) => section?.sequence],
    ["Abschnittsziel", (_call, section) => section?.target],
    ["Abschnitt Zielbezeichnung", (_call, section) => section?.targetLabel],
    ["Abschnittsergebnis", (_call, section) => section?.result],
    ["Abschnittsdauer Sekunden", (_call, section) => section?.durationSeconds],
];

function buildCsv(calls) {
    const header = IVR_CALL_CSV_COLUMNS.map(([label]) => escapeCsvValue(label)).join(";");
    const rows = [];
    calls.forEach(call => {
        const sections = call.sections.length ? call.sections : [null];
        sections.forEach(section => {
            rows.push(IVR_CALL_CSV_COLUMNS
                .map(([, getter]) => escapeCsvValue(getter(call, section)))
                .join(";"));
        });
    });
    return `\ufeff${[header, ...rows].join("\r\n")}\r\n`;
}

function downloadCsv() {
    const calls = getFilteredSortedCalls();
    if (ivrCallState.loading || ivrCallState.error || !calls.length) {
        return;
    }
    const blob = new Blob([buildCsv(calls)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ivr-call-details-${ivrCallState.day || "export"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function storeDayInCache(day, entry) {
    if (ivrCallDayCache.has(day)) {
        ivrCallDayCache.delete(day);
    }
    ivrCallDayCache.set(day, entry);
    while (ivrCallDayCache.size > IVR_CALL_MAX_CACHED_DAYS) {
        ivrCallDayCache.delete(ivrCallDayCache.keys().next().value);
    }
}

function getDayFromCache(day) {
    const entry = ivrCallDayCache.get(day);
    if (!entry) {
        return null;
    }
    ivrCallDayCache.delete(day);
    ivrCallDayCache.set(day, entry);
    return entry;
}

const ivrCallApi = {
    async getCallDetails(day) {
        const response = await fetch(`/api/reporting/ivr/call-details?day=${encodeURIComponent(day)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = typeof data.detail === "string" ? data.detail : data.detail?.message;
            throw new Error(detail || data.error || `Call-Detailreport konnte nicht geladen werden (${response.status})`);
        }
        return data;
    },
};

async function loadReport(day, { forceRefresh = false } = {}) {
    const yesterday = getYesterdayDayKey();
    if (!isValidDayKey(day) || day > yesterday) {
        return;
    }
    const requestToken = ++ivrCallState.requestToken;
    if (forceRefresh) {
        ivrCallDayCache.delete(day);
    }
    const cached = getDayFromCache(day);
    if (cached) {
        ivrCallState.day = day;
        ivrCallState.loading = false;
        ivrCallState.allCalls = cached.calls;
        ivrCallState.metadata = cached.metadata;
        ivrCallState.error = null;
        ivrCallState.page = 1;
        ivrCallState.expandedKeys.clear();
        updateServiceFilterOptions();
        savePersistedDay();
        renderPage();
        return;
    }

    ivrCallState.loading = true;
    ivrCallState.error = null;
    ivrCallState.day = day;
    ivrCallState.allCalls = [];
    ivrCallState.metadata = {};
    ivrCallState.expandedKeys.clear();
    renderPage();
    try {
        const payload = await ivrCallApi.getCallDetails(day);
        if (requestToken !== ivrCallState.requestToken) {
            return;
        }
        const resolvedDay = isValidDayKey(payload.day) ? payload.day : day;
        const entry = {
            calls: normalizePayload(payload),
            metadata: {
                callCount: payload.call_count,
                sectionCount: payload.section_count,
                dataAvailableThrough: payload.data_available_through,
            },
        };
        storeDayInCache(resolvedDay, entry);
        ivrCallState.day = resolvedDay;
        ivrCallState.allCalls = entry.calls;
        ivrCallState.metadata = entry.metadata;
        ivrCallState.page = 1;
        updateServiceFilterOptions();
        savePersistedDay();
    } catch (error) {
        if (requestToken !== ivrCallState.requestToken) {
            return;
        }
        console.error("IVR Call-Detailreport Fehler", error);
        ivrCallState.allCalls = [];
        ivrCallState.metadata = {};
        updateServiceFilterOptions();
        ivrCallState.error = error.message || "Call-Detailreport konnte nicht geladen werden.";
    } finally {
        if (requestToken === ivrCallState.requestToken) {
            ivrCallState.loading = false;
            renderPage();
        }
    }
}

function savePersistedDay() {
    try {
        localStorage.setItem(IVR_CALL_PERSISTED_KEY, JSON.stringify({ day: ivrCallState.day }));
    } catch (error) {
        console.error("Reporttag konnte nicht gespeichert werden", error);
    }
}

function loadPersistedDay() {
    try {
        const saved = JSON.parse(localStorage.getItem(IVR_CALL_PERSISTED_KEY) || "{}");
        if (isValidDayKey(saved.day)) {
            ivrCallState.day = saved.day;
        }
    } catch (error) {
        console.error("Gespeicherter Reporttag konnte nicht geladen werden", error);
    }
}

function toggleCall(key) {
    if (ivrCallState.expandedKeys.has(key)) {
        ivrCallState.expandedKeys.delete(key);
    } else {
        ivrCallState.expandedKeys.add(key);
    }
    renderPage();
    const row = Array.from(ivrCallDom.tableBody.querySelectorAll(".ivr-call-row"))
        .find(candidate => candidate.dataset.callKey === key);
    row?.focus();
}

function cacheDom() {
    ivrCallDom.prevDay = document.getElementById("ivrCallPrevDay");
    ivrCallDom.nextDay = document.getElementById("ivrCallNextDay");
    ivrCallDom.dayLabel = document.getElementById("ivrCallDayLabel");
    ivrCallDom.dayPicker = document.getElementById("ivrCallDayPicker");
    ivrCallDom.retry = document.getElementById("ivrCallRetryBtn");
    ivrCallDom.search = document.getElementById("ivrCallSearchInput");
    ivrCallDom.serviceFilter = document.getElementById("ivrCallServiceFilter");
    ivrCallDom.issuesOnly = document.getElementById("ivrCallIssueOnly");
    ivrCallDom.count = document.getElementById("ivrCallCount");
    ivrCallDom.sectionCount = document.getElementById("ivrCallSectionCount");
    ivrCallDom.exportCsv = document.getElementById("ivrCallExportCsv");
    ivrCallDom.status = document.getElementById("ivrCallReportStatus");
    ivrCallDom.tableBody = document.getElementById("ivrCallTableBody");
    ivrCallDom.sortStart = document.getElementById("ivrCallSortStart");
    ivrCallDom.sortIndicator = document.getElementById("ivrCallSortIndicator");
    ivrCallDom.prevPage = document.getElementById("ivrCallPrevPage");
    ivrCallDom.nextPage = document.getElementById("ivrCallNextPage");
    ivrCallDom.pageLabel = document.getElementById("ivrCallPageLabel");
}

function bindEvents() {
    ivrCallDom.prevDay.addEventListener("click", () => loadReport(dayKeyAddDays(ivrCallState.day, -1)));
    ivrCallDom.nextDay.addEventListener("click", () => loadReport(dayKeyAddDays(ivrCallState.day, 1)));
    ivrCallDom.dayLabel.addEventListener("click", () => {
        if (typeof ivrCallDom.dayPicker.showPicker === "function") {
            ivrCallDom.dayPicker.showPicker();
        } else {
            ivrCallDom.dayPicker.focus();
            ivrCallDom.dayPicker.click();
        }
    });
    ivrCallDom.dayPicker.addEventListener("change", event => loadReport(event.target.value));
    ivrCallDom.retry.addEventListener("click", () => loadReport(ivrCallState.day, { forceRefresh: true }));
    ivrCallDom.search.addEventListener("input", event => {
        ivrCallState.searchTerm = event.target.value || "";
        ivrCallState.page = 1;
        clearTimeout(ivrCallSearchTimer);
        ivrCallSearchTimer = window.setTimeout(renderPage, 180);
    });
    ivrCallDom.serviceFilter.addEventListener("change", event => {
        ivrCallState.serviceNumber = event.target.value || "";
        ivrCallState.page = 1;
        renderPage();
    });
    ivrCallDom.issuesOnly.addEventListener("change", event => {
        ivrCallState.issuesOnly = event.target.checked;
        ivrCallState.page = 1;
        renderPage();
    });
    ivrCallDom.sortStart.addEventListener("click", () => {
        ivrCallState.sortDirection = ivrCallState.sortDirection === "asc" ? "desc" : "asc";
        ivrCallState.page = 1;
        renderPage();
    });
    ivrCallDom.prevPage.addEventListener("click", () => {
        ivrCallState.page -= 1;
        renderPage();
    });
    ivrCallDom.nextPage.addEventListener("click", () => {
        ivrCallState.page += 1;
        renderPage();
    });
    ivrCallDom.exportCsv.addEventListener("click", downloadCsv);
    ivrCallDom.tableBody.addEventListener("click", event => {
        const row = event.target.closest(".ivr-call-row");
        if (row) {
            toggleCall(row.dataset.callKey);
        }
    });
    ivrCallDom.tableBody.addEventListener("keydown", event => {
        if ((event.key === "Enter" || event.key === " ") && event.target.matches(".ivr-call-row")) {
            event.preventDefault();
            toggleCall(event.target.dataset.callKey);
        }
    });
}

function initializeIvrCallDetails() {
    cacheDom();
    loadPersistedDay();
    const yesterday = getYesterdayDayKey();
    if (!isValidDayKey(ivrCallState.day) || ivrCallState.day > yesterday) {
        ivrCallState.day = yesterday;
    }
    bindEvents();
    loadReport(ivrCallState.day);
}

if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", initializeIvrCallDetails);
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        buildCsv,
        callMatchesSearch,
        escapeCsvValue,
        formatDuration,
        isConnectedResult,
        isValidDayKey,
        normalizeCall,
        normalizePayload,
    };
}
