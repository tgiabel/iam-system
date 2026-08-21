(function () {
    "use strict";

    const STORAGE_KEY = "sofaRechnerverwaltungState";
    const ACTIVE_JOB_STATUSES = new Set(["queued", "waiting_for_device", "running"]);
    const FILTER_DEFAULTS = Object.freeze({
        fsvVersion: "",
        efixVersion: "",
        deviceType: "",
        tranche: "",
        connectivity: "",
        vpn: "",
        locationKind: "",
        softwareId: "",
        softwareVersion: "",
        softwarePresence: "installed"
    });

    const state = {
        computers: [],
        softwareCatalog: [],
        meta: null,
        selectedIds: new Set(),
        visibleComputers: [],
        searchTerm: "",
        filters: { ...FILTER_DEFAULTS },
        quick: { session: false, jobs: false },
        sortField: "hostname",
        sortDirection: "asc",
        currentDetail: null,
        currentJobs: [],
        activeTab: "overview",
        softwareAction: null,
        powerAction: null,
        pollTimer: null,
        pollAttempts: 0
    };

    const DOM = {};

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function normalize(value) {
        return String(value ?? "").trim().toLocaleLowerCase("de");
    }

    function valueOrDash(value) {
        const text = String(value ?? "").trim();
        return text || "–";
    }

    function uniqueSorted(values) {
        return [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, "de", { numeric: true, sensitivity: "base" }));
    }

    function formatDate(value, withTime = false) {
        if (!value) return "–";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return valueOrDash(value);
        return new Intl.DateTimeFormat("de-DE", withTime
            ? { dateStyle: "medium", timeStyle: "short" }
            : { dateStyle: "medium" }
        ).format(parsed);
    }

    function formatRelative(value) {
        if (!value) return "Kein Kontakt erfasst";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return valueOrDash(value);
        const seconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
        if (seconds < 60) return "gerade eben";
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `vor ${minutes} Min.`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `vor ${hours} Std.`;
        const days = Math.round(hours / 24);
        if (days < 14) return `vor ${days} Tag${days === 1 ? "" : "en"}`;
        return formatDate(value);
    }

    function errorMessage(payload, fallback) {
        const detail = payload?.detail;
        if (typeof detail === "string") return detail;
        if (detail && typeof detail.message === "string") return detail.message;
        if (typeof payload?.error === "string") return payload.error;
        if (typeof payload?.message === "string") return payload.message;
        return fallback;
    }

    async function requestJson(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers
        });
        let payload = {};
        try {
            payload = await response.json();
        } catch (error) {
            payload = {};
        }
        if (!response.ok) {
            throw new Error(errorMessage(payload, `Anfrage fehlgeschlagen (${response.status})`));
        }
        return payload;
    }

    function getComputerId(computer) {
        return String(computer?.id ?? computer?.computer_id ?? "").trim();
    }

    function getHostname(computer) {
        return valueOrDash(computer?.hostname ?? computer?.computer_name ?? computer?.name);
    }

    function getUpdate(computer, key) {
        const nested = computer?.[key];
        if (nested && typeof nested === "object") {
            return {
                version: String(nested.version ?? "").trim(),
                installedAt: nested.installed_at ?? nested.installedAt ?? null
            };
        }
        return {
            version: String(computer?.[`${key}_version`] ?? nested ?? "").trim(),
            installedAt: computer?.[`${key}_installed_at`] ?? null
        };
    }

    function getConnectivity(computer) {
        const raw = typeof computer?.connectivity === "object"
            ? computer.connectivity.status
            : computer?.connectivity ?? computer?.connectivity_status ?? computer?.status;
        const normalized = normalize(raw);
        return ["online", "offline"].includes(normalized) ? normalized : "unknown";
    }

    function getLastSeen(computer) {
        return (typeof computer?.connectivity === "object" ? computer.connectivity.last_seen_at : null)
            ?? computer?.last_seen_at
            ?? computer?.last_contact_at
            ?? null;
    }

    function getSession(computer) {
        const session = computer?.session ?? computer?.current_session ?? computer?.current_user;
        if (!session || typeof session !== "object") return null;
        const displayName = String(
            session.display_name
            ?? session.name
            ?? [session.first_name, session.last_name].filter(Boolean).join(" ")
            ?? ""
        ).trim();
        if (!displayName && session.user_id == null && session.pnr == null) return null;
        return {
            ...session,
            display_name: displayName || String(session.pnr ?? session.user_id ?? "Unbekannter Nutzer"),
            logged_in_at: session.logged_in_at ?? session.login_at ?? session.since ?? null
        };
    }

    function normalizeLocationKind(value) {
        const kind = normalize(value).replaceAll("-", "_").replaceAll(" ", "_");
        if (["office", "buero", "büro"].includes(kind)) return "office";
        if (["warehouse", "lager"].includes(kind)) return "warehouse";
        if (["homeoffice", "home_office", "home"].includes(kind)) return "home_office";
        return "unknown";
    }

    function getLocation(computer) {
        const raw = computer?.location;
        if (!raw || typeof raw !== "object") {
            return { kind: "unknown", label: "Nicht zugeordnet", room: "", owner: null };
        }
        const owner = raw.owner && typeof raw.owner === "object" ? raw.owner : null;
        const ownerName = owner
            ? String(owner.display_name ?? owner.name ?? [owner.first_name, owner.last_name].filter(Boolean).join(" ") ?? "").trim()
            : String(raw.owner_name ?? "").trim();
        return {
            ...raw,
            kind: normalizeLocationKind(raw.kind ?? raw.type),
            label: String(raw.label ?? raw.name ?? "").trim(),
            room: String(raw.room ?? raw.area ?? raw.storage_area ?? "").trim(),
            owner: ownerName ? { ...(owner || {}), display_name: ownerName } : null
        };
    }

    function locationKindLabel(kind) {
        return { office: "Büro", warehouse: "Lager", home_office: "Homeoffice", unknown: "Nicht zugeordnet" }[kind] || "Nicht zugeordnet";
    }

    // Das Backend liefert den technischen Wert; uebersetzt wird ausschliesslich
    // hier in der Anzeige. Die Filterwerte bleiben technisch und damit stabil.
    const DEVICE_TYPE_LABELS = {
        desktop: "Desktop",
        laptop: "Notebook",
        virtual: "Virtuell",
        server: "Server",
        unknown: "Unbekannt"
    };

    function deviceTypeLabel(value) {
        const key = String(value ?? "").trim();
        if (!key) return "–";
        return DEVICE_TYPE_LABELS[key.toLowerCase()] || key;
    }

    const SOFTWARE_SOURCE_LABELS = {
        msi: "MSI-Paket",
        exe: "Setup",
        appx: "Store-Paket",
        fsv: "FSV",
        efix: "EFix",
        unknown: "Unbekannte Quelle"
    };

    function softwareSourceLabel(value) {
        const key = String(value ?? "").trim().toLowerCase();
        return SOFTWARE_SOURCE_LABELS[key] || "";
    }

    // `stale` und `error` sind Warnungen, `not_found` und `unknown` neutrale
    // Zustaende. Technische Fehlertexte liefert das Backend bewusst nicht.
    const DATA_STATUS_LABELS = {
        ok: { label: "Aktuell", className: "ui-status-success" },
        stale: { label: "Veraltet", className: "ui-status-warning" },
        error: { label: "Erhebung fehlgeschlagen", className: "ui-status-warning" },
        not_found: { label: "Nicht vorhanden", className: "ui-status-neutral" },
        unknown: { label: "Noch nicht gemeldet", className: "ui-status-neutral" }
    };

    const DATA_STATUS_SECTIONS = [
        ["hardware", "Hardware"],
        ["operating_system", "Betriebssystem"],
        ["network", "Netzwerk"],
        ["software", "Software"],
        ["session", "Sitzung"]
    ];

    function dataStatusPresentation(entry) {
        const raw = normalize(entry?.status) || "unknown";
        return DATA_STATUS_LABELS[raw] || DATA_STATUS_LABELS.unknown;
    }

    function getOperatingSystem(computer) {
        const value = computer?.operating_system;
        if (value && typeof value === "object") {
            // Ohne Dopplung: eine Version, die den Namen schon enthaelt, wird nicht
            // noch einmal angehaengt.
            const parts = [value.name, value.version, value.build ? `Build ${value.build}` : null]
                .map(part => String(part ?? "").trim())
                .filter(Boolean);
            return parts.filter((part, index) => !parts.slice(0, index).some(earlier => earlier.includes(part))).join(" · ");
        }
        return String(value ?? computer?.os?.name ?? computer?.os ?? "").trim();
    }

    function formatBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes <= 0) return "";
        const units = ["Byte", "KB", "MB", "GB", "TB"];
        let index = 0;
        let size = bytes;
        while (size >= 1024 && index < units.length - 1) {
            size /= 1024;
            index += 1;
        }
        const rounded = index >= 3 ? Math.round(size * 10) / 10 : Math.round(size);
        return `${rounded.toLocaleString("de-DE")} ${units[index]}`;
    }

    function getSoftwareFacts(computer) {
        // Das Detail liefert `installed_software`, die Uebersicht die kompakte
        // Liste unter `software`. Das Detail hat Vorrang, sobald es da ist.
        const items = computer?.installed_software ?? computer?.software ?? computer?.software_inventory ?? [];
        return Array.isArray(items) ? items.map(item => ({
            ...item,
            // Ohne Software-Onboarding gibt es keine stabile ID; gefuehrt wird
            // dann ueber den Namen.
            software_id: String(item?.software_id ?? item?.id ?? "").trim(),
            name: String(item?.name ?? item?.display_name ?? "").trim(),
            version: String(item?.version ?? "").trim(),
            // `installed_on` ist ein Datum ohne Uhrzeit. `installed_at` bleibt
            // leer, solange keine echte Zeitquelle existiert.
            installed_on: String(item?.installed_on ?? "").trim(),
            installed_at: item?.installed_at ?? item?.installation_date ?? null,
            source: String(item?.source ?? "").trim()
        })).filter(item => item.software_id || item.name) : [];
    }

    function catalogItemId(item) {
        return String(item?.software_id ?? item?.id ?? "").trim();
    }

    function catalogItemName(item) {
        return String(item?.name ?? item?.display_name ?? catalogItemId(item)).trim();
    }

    function catalogVersions(item) {
        const versions = item?.available_versions ?? item?.versions ?? [];
        return uniqueSorted((Array.isArray(versions) ? versions : []).map(version =>
            typeof version === "object" ? version.version ?? version.name : version
        ));
    }

    function getOpenJobCount(computer) {
        const explicit = Number(computer?.open_job_count ?? computer?.pending_job_count);
        if (Number.isFinite(explicit)) return Math.max(0, explicit);
        const jobs = Array.isArray(computer?.jobs) ? computer.jobs : [];
        return jobs.filter(job => ACTIVE_JOB_STATUSES.has(normalize(job?.status))).length;
    }

    function normalizeOverview(payload) {
        const computers = Array.isArray(payload) ? payload : payload?.computers;
        const catalog = Array.isArray(payload?.software_catalog) ? payload.software_catalog : [];
        // Abschneiden bleibt nicht still: das Backend sagt es, die Seite zeigt es.
        state.meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : null;
        state.computers = (Array.isArray(computers) ? computers : [])
            .filter(computer => getComputerId(computer));
        state.softwareCatalog = catalog
            .filter(item => catalogItemId(item))
            .sort((left, right) => catalogItemName(left).localeCompare(catalogItemName(right), "de"));
        renderTruncationNotice();
    }

    function renderTruncationNotice() {
        if (!DOM.truncationNotice) return;
        const truncated = Boolean(state.meta?.truncated);
        DOM.truncationNotice.hidden = !truncated;
        if (truncated && DOM.truncationLimit) {
            DOM.truncationLimit.textContent = String(state.meta?.limit ?? state.computers.length);
        }
    }

    function loadSavedState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (!saved || typeof saved !== "object") return;
            state.searchTerm = typeof saved.searchTerm === "string" ? saved.searchTerm : "";
            state.filters = { ...FILTER_DEFAULTS, ...(saved.filters || {}) };
            state.quick = { session: Boolean(saved.quick?.session), jobs: Boolean(saved.quick?.jobs) };
            state.sortField = typeof saved.sortField === "string" ? saved.sortField : "hostname";
            state.sortDirection = saved.sortDirection === "desc" ? "desc" : "asc";
        } catch (error) {
            console.debug("Gespeicherte Rechnerfilter konnten nicht gelesen werden.", error);
        }
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                searchTerm: state.searchTerm,
                filters: state.filters,
                quick: state.quick,
                sortField: state.sortField,
                sortDirection: state.sortDirection
            }));
        } catch (error) {
            console.debug("Rechnerfilter konnten nicht gespeichert werden.", error);
        }
    }

    function softwareCatalogMap() {
        return new Map(state.softwareCatalog.map(item => [catalogItemId(item), item]));
    }

    function softwareNameForFact(fact) {
        return fact.name || catalogItemName(softwareCatalogMap().get(fact.software_id)) || fact.software_id;
    }

    function matchesSearch(computer) {
        const term = normalize(state.searchTerm);
        if (!term) return true;
        const session = getSession(computer);
        const location = getLocation(computer);
        const values = [
            getHostname(computer),
            computer.asset_tag,
            computer.identifier,
            computer.device_type,
            computer.model,
            computer.comment,
            session?.display_name,
            session?.pnr,
            location.label,
            location.room,
            location.owner?.display_name
        ];
        return values.some(value => normalize(value).includes(term));
    }

    function matchesFilters(computer) {
        const fsv = getUpdate(computer, "fsv");
        const efix = getUpdate(computer, "efix");
        const location = getLocation(computer);
        const filters = state.filters;
        const missingMatch = (filter, value) => filter === "__missing__" ? !value : !filter || value === filter;

        if (!missingMatch(filters.fsvVersion, fsv.version)) return false;
        if (!missingMatch(filters.efixVersion, efix.version)) return false;
        if (filters.deviceType && String(computer.device_type ?? "") !== filters.deviceType) return false;
        if (!missingMatch(filters.tranche, String(computer.tranche ?? ""))) return false;
        if (filters.connectivity && getConnectivity(computer) !== filters.connectivity) return false;
        if (filters.vpn === "yes" && !computer.vpn_enabled) return false;
        if (filters.vpn === "no" && Boolean(computer.vpn_enabled)) return false;
        if (filters.locationKind && location.kind !== filters.locationKind) return false;
        if (state.quick.session && !getSession(computer)) return false;
        if (state.quick.jobs && getOpenJobCount(computer) < 1) return false;

        if (filters.softwareId) {
            const matching = getSoftwareFacts(computer).some(fact =>
                fact.software_id === filters.softwareId
                && (!filters.softwareVersion || fact.version === filters.softwareVersion)
            );
            if (filters.softwarePresence === "missing" ? matching : !matching) return false;
        }
        return true;
    }

    function sortValue(computer, field) {
        if (field === "hostname") return getHostname(computer);
        if (field === "device_type") return computer.device_type ?? "";
        if (field === "fsv") return getUpdate(computer, "fsv").version;
        if (field === "efix") return getUpdate(computer, "efix").version;
        if (field === "tranche") return computer.tranche ?? "";
        if (field === "connectivity") return { online: 1, offline: 2, unknown: 3 }[getConnectivity(computer)] ?? 3;
        if (field === "vpn") return computer.vpn_enabled ? 1 : 0;
        if (field === "location") {
            const location = getLocation(computer);
            return `${locationKindLabel(location.kind)} ${location.label} ${location.room} ${location.owner?.display_name || ""}`;
        }
        return "";
    }

    function filteredComputers() {
        const direction = state.sortDirection === "desc" ? -1 : 1;
        return state.computers
            .filter(matchesSearch)
            .filter(matchesFilters)
            .sort((left, right) => {
                const leftValue = sortValue(left, state.sortField);
                const rightValue = sortValue(right, state.sortField);
                if (typeof leftValue === "number" && typeof rightValue === "number") {
                    return (leftValue - rightValue) * direction;
                }
                return String(leftValue).localeCompare(String(rightValue), "de", { numeric: true, sensitivity: "base" }) * direction;
            });
    }

    function statusPresentation(status) {
        return {
            online: { label: "Online", className: "ui-status-success" },
            offline: { label: "Offline", className: "ui-status-error" },
            unknown: { label: "Unbekannt", className: "ui-status-neutral" }
        }[status] || { label: "Unbekannt", className: "ui-status-neutral" };
    }

    function jobPresentation(status) {
        return {
            queued: { label: "Eingeplant", className: "ui-status-info" },
            waiting_for_device: { label: "Wartet auf Verbindung", className: "ui-status-warning" },
            running: { label: "Wird ausgeführt", className: "ui-status-info" },
            succeeded: { label: "Erfolgreich", className: "ui-status-success" },
            failed: { label: "Fehlgeschlagen", className: "ui-status-error" },
            skipped: { label: "Übersprungen", className: "ui-status-neutral" }
        }[normalize(status)] || { label: valueOrDash(status), className: "ui-status-neutral" };
    }

    function actionLabel(action) {
        return {
            reboot: "Neustart",
            shutdown: "Herunterfahren",
            install: "Softwareinstallation",
            uninstall: "Softwaredeinstallation"
        }[normalize(action)] || valueOrDash(action);
    }

    function locationPresentation(computer) {
        const location = getLocation(computer);
        const main = locationKindLabel(location.kind);
        let detail = location.room || location.label;
        if (location.kind === "home_office") detail = location.owner?.display_name || location.label;
        if (location.label && location.room && location.label !== main) detail = `${location.label} · ${location.room}`;
        return { main, detail: detail || "–" };
    }

    function renderUpdateCell(update) {
        return `<div class="computer-cell-stack"><span class="computer-cell-main">${escapeHtml(update.version || "–")}</span><span class="computer-cell-meta">${escapeHtml(update.installedAt ? `Installiert ${formatDate(update.installedAt)}` : "Kein Datum")}</span></div>`;
    }

    function renderTable() {
        state.visibleComputers = filteredComputers();
        const visibleIds = new Set(state.visibleComputers.map(getComputerId));
        state.selectedIds = new Set([...state.selectedIds].filter(id => visibleIds.has(id)));

        DOM.visibleCount.textContent = `${state.visibleComputers.length} von ${state.computers.length} Rechnern`;
        const canSelect = hasPerm("SOFA-FN-COMPUTER-SOFTWARE");
        DOM.selectAll.disabled = !canSelect || !state.visibleComputers.length;

        if (!state.visibleComputers.length) {
            DOM.tableBody.innerHTML = `<tr class="computers-empty-row"><td colspan="10"><div class="ui-empty-state ui-empty-inline">${state.computers.length ? "Keine Rechner für diese Auswahl gefunden." : "Keine Rechner vorhanden."}</div></td></tr>`;
        } else {
            DOM.tableBody.innerHTML = state.visibleComputers.map(computer => {
                const id = getComputerId(computer);
                const fsv = getUpdate(computer, "fsv");
                const efix = getUpdate(computer, "efix");
                const status = statusPresentation(getConnectivity(computer));
                const session = getSession(computer);
                const location = locationPresentation(computer);
                const lastSeen = getLastSeen(computer);
                const selected = state.selectedIds.has(id);
                const comment = String(computer.comment ?? "").trim();
                return `
                    <tr class="ui-table-row computers-table-row${selected ? " is-selected" : ""}${computer.is_disabled ? " is-disabled" : ""}" data-computer-id="${escapeHtml(id)}" tabindex="0">
                        <td class="computers-select-column"><input type="checkbox" data-computer-select="${escapeHtml(id)}" aria-label="${escapeHtml(getHostname(computer))} auswählen" ${selected ? "checked" : ""} ${canSelect ? "" : "disabled"}></td>
                        <td class="computers-sticky-identity"><div class="computer-cell-stack"><span class="computer-cell-main">${escapeHtml(getHostname(computer))}${computer.is_disabled ? ` <span class="ui-status-badge ui-status-neutral computer-disabled-badge">Deaktiviert</span>` : ""}</span><span class="computer-cell-meta">${escapeHtml(computer.asset_tag || computer.identifier || "Keine zusätzliche Kennung")}</span></div></td>
                        <td><div class="computer-cell-stack"><span class="computer-cell-main">${escapeHtml(deviceTypeLabel(computer.device_type))}</span><span class="computer-cell-meta">${escapeHtml(computer.model || "Kein Modell")}</span></div></td>
                        <td>${renderUpdateCell(fsv)}</td>
                        <td>${renderUpdateCell(efix)}</td>
                        <td><span class="ui-chip ${computer.tranche ? "ui-chip-primary" : "ui-chip-neutral"}">${escapeHtml(computer.tranche || "–")}</span></td>
                        <td><div class="computer-status-stack"><span class="ui-status-badge ${status.className}">${status.label}</span><span class="computer-cell-meta">${escapeHtml(session ? session.display_name : "frei")}</span><span class="computer-cell-meta" title="${escapeHtml(formatDate(lastSeen, true))}">Kontakt ${escapeHtml(formatRelative(lastSeen))}</span></div></td>
                        <td><span class="ui-status-badge ${computer.vpn_enabled ? "ui-status-success" : "ui-status-neutral"}">${computer.vpn_enabled ? "Ja" : "Nein"}</span></td>
                        <td><div class="computer-cell-stack"><span class="computer-cell-main">${escapeHtml(location.main)}</span><span class="computer-cell-meta">${escapeHtml(location.detail)}</span></div></td>
                        <td><span class="computer-comment-preview" title="${escapeHtml(comment || "Kein Kommentar")}">${escapeHtml(comment || "–")}</span></td>
                    </tr>`;
            }).join("");
        }
        updateSelectionUi();
        updateSortHeaders();
    }

    function updateSelectionUi() {
        const count = state.selectedIds.size;
        DOM.bulkBar.hidden = count === 0;
        DOM.selectionCount.textContent = `${count} Rechner ausgewählt`;
        const allSelected = state.visibleComputers.length > 0 && state.visibleComputers.every(computer => state.selectedIds.has(getComputerId(computer)));
        DOM.selectAll.checked = allSelected;
        DOM.selectAll.indeterminate = count > 0 && !allSelected;
    }

    function updateSortHeaders() {
        DOM.sortButtons.forEach(button => {
            const active = button.dataset.sortField === state.sortField;
            button.classList.toggle("is-active", active);
            button.querySelector("[data-sort-indicator]").textContent = active ? (state.sortDirection === "asc" ? "↑" : "↓") : "";
            button.closest("th")?.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
        });
    }

    function renderStats() {
        const online = state.computers.filter(computer => getConnectivity(computer) === "online").length;
        const offline = state.computers.filter(computer => getConnectivity(computer) === "offline").length;
        const sessions = state.computers.filter(computer => Boolean(getSession(computer))).length;
        const jobs = state.computers.filter(computer => getOpenJobCount(computer) > 0).length;
        DOM.statOnline.textContent = online;
        DOM.statOffline.textContent = offline;
        DOM.statSession.textContent = sessions;
        DOM.statJobs.textContent = jobs;
        DOM.quickButtons.forEach(button => {
            const filter = button.dataset.quickFilter;
            const active = filter === "online" || filter === "offline"
                ? state.filters.connectivity === filter
                : Boolean(state.quick[filter]);
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function selectOptions(select, values, labelForValue = value => value) {
        const current = select.value;
        select.innerHTML = `<option value="">Alle</option><option value="__missing__">Nicht installiert</option>`
            + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(labelForValue(value))}</option>`).join("");
        select.value = [...select.options].some(option => option.value === current) ? current : "";
    }

    function renderFilterOptions() {
        selectOptions(DOM.filterFields.fsvVersion, uniqueSorted(state.computers.map(computer => getUpdate(computer, "fsv").version)));
        selectOptions(DOM.filterFields.efixVersion, uniqueSorted(state.computers.map(computer => getUpdate(computer, "efix").version)));

        const deviceSelect = DOM.filterFields.deviceType;
        const currentType = state.filters.deviceType;
        deviceSelect.innerHTML = `<option value="">Alle</option>` + uniqueSorted(state.computers.map(computer => computer.device_type))
            .map(type => `<option value="${escapeHtml(type)}">${escapeHtml(deviceTypeLabel(type))}</option>`).join("");
        deviceSelect.value = currentType;

        const softwareSelect = DOM.filterFields.softwareId;
        softwareSelect.innerHTML = `<option value="">Alle</option>` + state.softwareCatalog
            .map(item => `<option value="${escapeHtml(catalogItemId(item))}">${escapeHtml(catalogItemName(item))}</option>`).join("");
        softwareSelect.value = state.filters.softwareId;
        updateSoftwareFilterVersions();

        Object.entries(DOM.filterFields).forEach(([key, select]) => {
            if (key !== "softwareVersion" && key !== "softwarePresence") select.value = state.filters[key] ?? "";
        });
    }

    function updateSoftwareFilterVersions() {
        const softwareId = state.filters.softwareId;
        const versionSelect = DOM.filterFields.softwareVersion;
        const presenceSelect = DOM.filterFields.softwarePresence;
        versionSelect.disabled = !softwareId;
        presenceSelect.disabled = !softwareId;
        const versions = softwareId ? uniqueSorted([
            ...catalogVersions(state.softwareCatalog.find(item => catalogItemId(item) === softwareId)),
            ...state.computers.flatMap(getSoftwareFacts).filter(fact => fact.software_id === softwareId).map(fact => fact.version)
        ]) : [];
        versionSelect.innerHTML = `<option value="">Alle Versionen</option>` + versions
            .map(version => `<option value="${escapeHtml(version)}">${escapeHtml(version)}</option>`).join("");
        versionSelect.value = versions.includes(state.filters.softwareVersion) ? state.filters.softwareVersion : "";
        state.filters.softwareVersion = versionSelect.value;
        presenceSelect.value = state.filters.softwarePresence;
    }

    function activeFilterDefinitions() {
        const catalog = softwareCatalogMap();
        const labels = {
            fsvVersion: "FSV", efixVersion: "EFix", deviceType: "Typ", tranche: "Tranche",
            connectivity: "Zustand", vpn: "VPN", locationKind: "Standort",
            softwareId: "Software", softwareVersion: "Software-Version", softwarePresence: "Software"
        };
        const display = (key, value) => {
            if (value === "__missing__") return "Nicht installiert/zugeordnet";
            if (key === "connectivity") return statusPresentation(value).label;
            if (key === "vpn") return value === "yes" ? "Aktiviert" : "Nicht aktiviert";
            if (key === "locationKind") return locationKindLabel(value);
            if (key === "softwareId") return catalogItemName(catalog.get(value));
            if (key === "softwarePresence") return value === "missing" ? "Nicht installiert" : "Installiert";
            return value;
        };
        const definitions = Object.entries(state.filters)
            .filter(([key, value]) => value && !(key === "softwarePresence" && !state.filters.softwareId))
            .map(([key, value]) => ({ key, label: `${labels[key]}: ${display(key, value)}` }));
        if (state.quick.session) definitions.push({ key: "quick:session", label: "Aktive Sitzung" });
        if (state.quick.jobs) definitions.push({ key: "quick:jobs", label: "Offene Aufträge" });
        return definitions;
    }

    function renderFilterTags() {
        const definitions = activeFilterDefinitions();
        DOM.filterTags.innerHTML = definitions.map(item => `<span class="computers-filter-tag">${escapeHtml(item.label)}<button type="button" data-remove-filter="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)} entfernen">×</button></span>`).join("");
        DOM.filterCount.hidden = definitions.length === 0;
        DOM.filterCount.textContent = definitions.length;
    }

    function applyFilters({ persist = true } = {}) {
        if (persist) saveState();
        renderStats();
        renderFilterTags();
        renderTable();
    }

    async function loadOverview({ quiet = false } = {}) {
        if (!quiet) {
            DOM.tableBody.innerHTML = `<tr class="computers-empty-row"><td colspan="10"><div class="ui-empty-state ui-empty-inline">Rechner werden geladen…</div></td></tr>`;
        }
        try {
            normalizeOverview(await requestJson("/api/computers/overview"));
            renderFilterOptions();
            applyFilters({ persist: false });
        } catch (error) {
            console.error(error);
            if (!quiet) {
                DOM.tableBody.innerHTML = `<tr class="computers-empty-row"><td colspan="10"><div class="ui-empty-state ui-empty-inline">${escapeHtml(error.message || "Rechner konnten nicht geladen werden.")}</div></td></tr>`;
                showFlash(error.message || "Rechner konnten nicht geladen werden.", "failure");
            }
        }
    }

    function openOverlay(overlay) {
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
    }

    function closeOverlay(overlay) {
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
        if (overlay === DOM.softwareActionOverlay) stopBatchPolling();
        if (!document.querySelector(".ui-modal-overlay.active")) document.body.classList.remove("modal-open");
    }

    function setField(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = valueOrDash(value);
    }

    function detailSoftware(detail) {
        return getSoftwareFacts(detail).sort((left, right) => softwareNameForFact(left).localeCompare(softwareNameForFact(right), "de"));
    }

    function renderDetail() {
        const computer = state.currentDetail;
        if (!computer) return;
        const status = statusPresentation(getConnectivity(computer));
        const session = getSession(computer);
        const location = getLocation(computer);
        const fsv = getUpdate(computer, "fsv");
        const efix = getUpdate(computer, "efix");

        DOM.detailTitle.textContent = getHostname(computer);
        DOM.detailAsset.textContent = `Kennung ${valueOrDash(computer.asset_tag || computer.identifier)}`;
        DOM.detailStatus.className = `ui-status-badge ${status.className}`;
        DOM.detailStatus.textContent = status.label;
        DOM.detailTranche.textContent = `Tranche ${valueOrDash(computer.tranche)}`;

        setField("computer-field-type", deviceTypeLabel(computer.device_type));
        setField("computer-field-manufacturer", computer.manufacturer);
        setField("computer-field-model", computer.model);
        setField("computer-field-serial", computer.serial_number ?? computer.serial);
        setField("computer-field-cpu", computer.cpu_model);
        setField("computer-field-cpu-cores", computer.cpu_cores);
        setField("computer-field-memory", formatBytes(computer.memory_bytes));
        setField("computer-field-os", getOperatingSystem(computer));
        setField("computer-field-architecture", computer.architecture ?? computer.os?.architecture);
        setField("computer-field-vpn", computer.vpn_enabled ? "Aktiviert" : "Nicht aktiviert");
        setField("computer-field-connectivity", status.label);
        setField("computer-field-last-seen", getLastSeen(computer) ? `${formatRelative(getLastSeen(computer))} · ${formatDate(getLastSeen(computer), true)}` : null);
        setField("computer-field-session", session?.display_name ?? "Frei");
        setField("computer-field-session-since", session?.logged_in_at ? formatDate(session.logged_in_at, true) : null);
        setField("computer-field-ips", arrayDisplay(computer.ip_addresses ?? computer.network?.ip_addresses ?? computer.ip_address));
        setField("computer-field-macs", arrayDisplay(computer.mac_addresses ?? computer.network?.mac_addresses ?? computer.mac_address));
        setField("computer-field-fsv", fsv.version);
        setField("computer-field-fsv-date", fsv.installedAt ? formatDate(fsv.installedAt) : null);
        setField("computer-field-efix", efix.version);
        setField("computer-field-efix-date", efix.installedAt ? formatDate(efix.installedAt) : null);
        setField("computer-field-tranche", computer.tranche);
        setField("computer-field-location-kind", locationKindLabel(location.kind));
        setField("computer-field-location-label", location.label);
        setField("computer-field-location-room", location.room);
        setField("computer-field-owner", location.owner?.display_name);

        renderAdapters(computer);
        renderDataStatus(computer);

        if (DOM.detailDisabled) DOM.detailDisabled.hidden = !computer.is_disabled;

        DOM.commentText.textContent = valueOrDash(computer.comment);
        DOM.commentInput.value = String(computer.comment ?? "");
        cancelCommentEdit();

        const software = detailSoftware(computer);
        DOM.softwareCount.textContent = software.length;
        renderSoftwareList();
        renderJobs();

        // Bewusst kein Wiederaktivieren nach Erreichbarkeit: die Routen gibt es im
        // Backend noch nicht. Sobald sie existieren, kommt die Online-Pruefung
        // hierher zurueck.
        [DOM.rebootButton, DOM.shutdownButton, DOM.installButton, DOM.uninstallButton]
            .filter(Boolean)
            .forEach(button => { button.disabled = true; });
    }

    function renderAdapters(computer) {
        if (!DOM.adapterList) return;
        const adapters = Array.isArray(computer?.network_addresses) ? computer.network_addresses : [];
        if (!adapters.length) {
            DOM.adapterList.innerHTML = "";
            return;
        }
        const byInterface = new Map();
        adapters.forEach(entry => {
            const name = String(entry?.interface_name ?? "").trim() || "Unbenannte Schnittstelle";
            if (!byInterface.has(name)) byInterface.set(name, []);
            byInterface.get(name).push(entry);
        });
        DOM.adapterList.innerHTML = [...byInterface.entries()].map(([name, entries]) => {
            const mac = entries.map(entry => entry?.mac_address).find(Boolean);
            const vpn = entries.some(entry => entry?.is_vpn);
            const addresses = uniqueSorted(entries.map(entry => entry?.ip_address));
            return `<div class="computer-adapter">
                <div class="computer-adapter-head">
                    <span class="computer-adapter-name">${escapeHtml(name)}</span>
                    ${vpn ? `<span class="ui-status-badge ui-status-success">VPN</span>` : ""}
                </div>
                <div class="computer-adapter-meta">${escapeHtml(addresses.join(", ") || "Keine Adresse")}</div>
                <div class="computer-adapter-meta">${escapeHtml(mac || "Keine MAC-Adresse")}</div>
            </div>`;
        }).join("");
    }

    function renderDataStatus(computer) {
        if (!DOM.dataStatusList) return;
        const status = computer?.data_status && typeof computer.data_status === "object"
            ? computer.data_status
            : {};
        DOM.dataStatusList.innerHTML = DATA_STATUS_SECTIONS.map(([key, label]) => {
            const entry = status[key];
            const presentation = dataStatusPresentation(entry);
            // Bei `stale` und `error` zeigt `observed_at` das Alter der weiterhin
            // ausgelieferten Werte, `status_updated_at` den letzten Zustandswechsel.
            const observed = entry?.observed_at ? formatDate(entry.observed_at, true) : null;
            const changed = entry?.status_updated_at ? formatRelative(entry.status_updated_at) : null;
            const meta = observed ? `Stand ${observed}` : (changed ? `Gemeldet ${changed}` : "Keine Meldung");
            return `<li class="computer-datastatus-item">
                <span class="computer-datastatus-name">${escapeHtml(label)}</span>
                <span class="ui-status-badge ${presentation.className}">${escapeHtml(presentation.label)}</span>
                <span class="computer-datastatus-meta">${escapeHtml(meta)}</span>
            </li>`;
        }).join("");
    }

    function arrayDisplay(value) {
        if (Array.isArray(value)) {
            return value.map(item => typeof item === "object" ? item.address ?? item.value : item).filter(Boolean).join(", ") || "–";
        }
        return valueOrDash(value);
    }

    function normalizeJobs(payload) {
        if (Array.isArray(payload)) return payload;
        return Array.isArray(payload?.jobs) ? payload.jobs : Array.isArray(payload?.items) ? payload.items : [];
    }

    function renderSoftwareList() {
        if (!state.currentDetail) return;
        const term = normalize(DOM.softwareSearch.value);
        const software = detailSoftware(state.currentDetail).filter(item =>
            !term || [softwareNameForFact(item), item.version, item.publisher, item.manufacturer].some(value => normalize(value).includes(term))
        );
        DOM.softwareList.innerHTML = software.length ? software.map(item => `
            <article class="computer-list-item">
                <div class="computer-list-item-main">
                    <span class="computer-list-item-title">${escapeHtml(softwareNameForFact(item))}</span>
                    <span class="computer-list-item-meta">Version ${escapeHtml(item.version || "–")} · ${escapeHtml(item.publisher || item.manufacturer || "Hersteller unbekannt")}</span>
                    <span class="computer-list-item-meta">Installiert ${escapeHtml(item.installed_on || (item.installed_at ? formatDate(item.installed_at) : "–"))}${softwareSourceLabel(item.source) ? ` · ${escapeHtml(softwareSourceLabel(item.source))}` : ""}</span>
                </div>
                <span class="ui-chip ui-chip-success">Installiert</span>
            </article>`).join("") : `<div class="ui-empty-state ui-empty-inline">${term ? "Keine passende Software gefunden." : "Keine installierte Software gemeldet."}</div>`;
    }

    function renderJobs() {
        DOM.jobsCount.textContent = state.currentJobs.length;
        DOM.jobsList.innerHTML = state.currentJobs.length ? state.currentJobs.map(job => {
            const presentation = jobPresentation(job.status);
            const software = job.software_name ?? job.software?.name ?? job.software_id;
            const meta = [job.initiator_name ?? job.actor_name, job.created_at ? formatDate(job.created_at, true) : null, software].filter(Boolean).join(" · ");
            return `<article class="computer-list-item">
                <div class="computer-list-item-main">
                    <span class="computer-list-item-title">${escapeHtml(actionLabel(job.action ?? job.type))}</span>
                    <span class="computer-list-item-meta">${escapeHtml(meta || "Keine Zusatzinformationen")}</span>
                    ${job.message || job.error ? `<span class="computer-list-item-meta">${escapeHtml(job.message || job.error)}</span>` : ""}
                </div>
                <span class="ui-status-badge ${presentation.className} computer-job-status">${escapeHtml(presentation.label)}</span>
            </article>`;
        }).join("") : `<div class="ui-empty-state ui-empty-inline">Keine Aufträge vorhanden.</div>`;
    }

    async function openDetail(computerId) {
        const overview = state.computers.find(computer => getComputerId(computer) === String(computerId));
        if (!overview) return;
        state.currentDetail = { ...overview };
        state.currentJobs = [];
        state.activeTab = "overview";
        DOM.softwareSearch.value = "";
        switchTab("overview");
        renderDetail();
        DOM.softwareList.innerHTML = `<div class="ui-empty-state ui-empty-inline">Software wird geladen…</div>`;
        DOM.jobsList.innerHTML = `<div class="ui-empty-state ui-empty-inline">Aufträge werden geladen…</div>`;
        openOverlay(DOM.detailOverlay);

        const encodedId = encodeURIComponent(computerId);
        const [detailResult, jobsResult] = await Promise.allSettled([
            requestJson(`/api/computers/${encodedId}`),
            requestJson(`/api/computers/${encodedId}/jobs?limit=50`)
        ]);
        if (detailResult.status === "fulfilled") {
            const detail = detailResult.value?.computer ?? detailResult.value;
            state.currentDetail = { ...overview, ...(detail && typeof detail === "object" ? detail : {}) };
        } else {
            showFlash(detailResult.reason?.message || "Rechnerdetails konnten nicht vollständig geladen werden.", "failure");
        }
        state.currentJobs = jobsResult.status === "fulfilled" ? normalizeJobs(jobsResult.value) : [];
        renderDetail();
    }

    function switchTab(tab) {
        state.activeTab = tab;
        DOM.tabButtons.forEach(button => {
            const active = button.dataset.computerTab === tab;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
        });
        DOM.tabViews.forEach(view => view.classList.toggle("is-active", view.dataset.computerView === tab));
    }

    function startCommentEdit() {
        if (!state.currentDetail) return;
        DOM.commentText.hidden = true;
        DOM.commentEditor.hidden = false;
        DOM.commentEditButton.hidden = true;
        DOM.commentInput.focus();
    }

    function cancelCommentEdit() {
        if (!DOM.commentEditor) return;
        DOM.commentEditor.hidden = true;
        DOM.commentText.hidden = false;
        if (DOM.commentEditButton) DOM.commentEditButton.hidden = false;
        if (state.currentDetail) DOM.commentInput.value = String(state.currentDetail.comment ?? "");
    }

    async function saveComment() {
        if (!state.currentDetail) return;
        const id = getComputerId(state.currentDetail);
        const comment = DOM.commentInput.value.trim();
        DOM.commentSaveButton.disabled = true;
        try {
            const payload = await requestJson(`/api/computers/${encodeURIComponent(id)}/comment`, {
                method: "PATCH",
                body: JSON.stringify({ comment })
            });
            const updated = payload?.computer ?? payload;
            state.currentDetail.comment = typeof updated?.comment === "string" ? updated.comment : comment;
            const overview = state.computers.find(computer => getComputerId(computer) === id);
            if (overview) overview.comment = state.currentDetail.comment;
            DOM.commentText.textContent = valueOrDash(state.currentDetail.comment);
            cancelCommentEdit();
            applyFilters({ persist: false });
            showFlash("Kommentar gespeichert.", "success");
        } catch (error) {
            showFlash(error.message || "Kommentar konnte nicht gespeichert werden.", "failure");
        } finally {
            DOM.commentSaveButton.disabled = false;
        }
    }

    function selectedComputers() {
        return state.computers.filter(computer => state.selectedIds.has(getComputerId(computer)));
    }

    function openSoftwareAction(action, targetIds) {
        const targets = state.computers.filter(computer => targetIds.includes(getComputerId(computer)));
        if (!targets.length) return;
        state.softwareAction = { action, targetIds: targets.map(getComputerId), batchId: null };
        state.pollAttempts = 0;
        stopBatchPolling();
        DOM.softwareActionTitle.textContent = action === "install" ? "Software installieren" : "Software deinstallieren";
        DOM.softwareActionTargets.textContent = `${targets.length} Rechner ausgewählt`;
        DOM.softwareActionSubmit.textContent = action === "install" ? "Installation starten" : "Deinstallation starten";
        DOM.softwareActionSubmit.disabled = false;
        DOM.actionResults.hidden = true;
        DOM.actionResults.innerHTML = "";

        const available = action === "install"
            ? state.softwareCatalog
            : state.softwareCatalog.filter(item => targets.some(computer => getSoftwareFacts(computer).some(fact => fact.software_id === catalogItemId(item))));
        DOM.actionSoftware.innerHTML = `<option value="" disabled selected>Software auswählen…</option>` + available
            .map(item => `<option value="${escapeHtml(catalogItemId(item))}">${escapeHtml(catalogItemName(item))}</option>`).join("");
        DOM.actionSoftware.disabled = available.length === 0;
        DOM.actionVersion.innerHTML = `<option value="">${action === "install" ? "Standardversion" : "Alle installierten Versionen"}</option>`;
        DOM.actionVersion.disabled = true;
        DOM.actionSummary.textContent = available.length
            ? "Software auswählen, um die Zielauswahl zu prüfen."
            : "Auf den ausgewählten Rechnern wurde keine deinstallierbare Software gemeldet.";
        openOverlay(DOM.softwareActionOverlay);
    }

    function updateSoftwareActionOptions() {
        if (!state.softwareAction) return;
        const softwareId = DOM.actionSoftware.value;
        const targets = state.computers.filter(computer => state.softwareAction.targetIds.includes(getComputerId(computer)));
        const catalogItem = state.softwareCatalog.find(item => catalogItemId(item) === softwareId);
        let versions = state.softwareAction.action === "install"
            ? catalogVersions(catalogItem)
            : uniqueSorted(targets.flatMap(getSoftwareFacts).filter(fact => fact.software_id === softwareId).map(fact => fact.version));
        DOM.actionVersion.innerHTML = `<option value="">${state.softwareAction.action === "install" ? "Standardversion" : "Alle installierten Versionen"}</option>`
            + versions.map(version => `<option value="${escapeHtml(version)}">${escapeHtml(version)}</option>`).join("");
        DOM.actionVersion.disabled = versions.length === 0;
        updateSoftwareActionSummary();
    }

    function updateSoftwareActionSummary() {
        if (!state.softwareAction) return;
        const softwareId = DOM.actionSoftware.value;
        if (!softwareId) return;
        const version = DOM.actionVersion.value;
        const targets = state.computers.filter(computer => state.softwareAction.targetIds.includes(getComputerId(computer)));
        const installedCount = targets.filter(computer => getSoftwareFacts(computer).some(fact =>
            fact.software_id === softwareId && (!version || fact.version === version)
        )).length;
        const offlineCount = targets.filter(computer => getConnectivity(computer) !== "online").length;
        if (state.softwareAction.action === "install") {
            DOM.actionSummary.textContent = `${targets.length} Zielrechner · ${offlineCount} aktuell nicht erreichbar und werden vorgemerkt.`;
        } else {
            DOM.actionSummary.textContent = `Auf ${installedCount} von ${targets.length} Rechnern vorhanden · ${targets.length - installedCount} werden übersprungen.`;
        }
    }

    async function submitSoftwareAction(event) {
        event.preventDefault();
        if (!state.softwareAction || !DOM.actionSoftware.value) return;
        DOM.softwareActionSubmit.disabled = true;
        try {
            const payload = await requestJson("/api/computers/software-actions", {
                method: "POST",
                body: JSON.stringify({
                    computer_ids: state.softwareAction.targetIds,
                    action: state.softwareAction.action,
                    software_id: DOM.actionSoftware.value,
                    version: DOM.actionVersion.value || undefined
                })
            });
            state.softwareAction.batchId = payload.batch_id ?? payload.id ?? null;
            renderActionResults(payload);
            markTargetsWithOpenJob(state.softwareAction.targetIds);
            showFlash("Softwareauftrag wurde angelegt.", "success");
            if (state.softwareAction.batchId && hasActiveResults(payload)) startBatchPolling();
            else DOM.softwareActionSubmit.disabled = false;
            await refreshCurrentJobs();
        } catch (error) {
            showFlash(error.message || "Softwareauftrag konnte nicht angelegt werden.", "failure");
            DOM.softwareActionSubmit.disabled = false;
        }
    }

    function resultItems(payload) {
        if (Array.isArray(payload?.results)) return payload.results;
        if (Array.isArray(payload?.targets)) return payload.targets;
        return [];
    }

    function renderActionResults(payload) {
        const results = resultItems(payload);
        const counts = new Map();
        results.forEach(item => {
            const status = normalize(item.status || (item.success ? "succeeded" : "failed"));
            counts.set(status, (counts.get(status) || 0) + 1);
        });
        const summary = [...counts.entries()].map(([status, count]) => `${jobPresentation(status).label}: ${count}`).join(" · ");
        DOM.actionSummary.textContent = summary || payload.message || "Auftrag wurde angenommen.";
        DOM.actionResults.hidden = results.length === 0;
        DOM.actionResults.innerHTML = results.map(item => {
            const status = jobPresentation(item.status || (item.success ? "succeeded" : "failed"));
            const computer = state.computers.find(candidate => getComputerId(candidate) === String(item.computer_id ?? item.id));
            return `<div class="computer-action-result-row"><span>${escapeHtml(computer ? getHostname(computer) : item.computer_id ?? item.id ?? "Rechner")}</span><span class="ui-status-badge ${status.className}" title="${escapeHtml(item.message || item.error || "")}">${escapeHtml(status.label)}</span></div>`;
        }).join("");
    }

    function hasActiveResults(payload) {
        const results = resultItems(payload);
        if (!results.length) return normalize(payload?.status) === "running" || normalize(payload?.status) === "queued";
        return results.some(item => ACTIVE_JOB_STATUSES.has(normalize(item.status)));
    }

    function startBatchPolling() {
        stopBatchPolling();
        const poll = async () => {
            if (!state.softwareAction?.batchId || state.pollAttempts >= 60) {
                DOM.softwareActionSubmit.disabled = false;
                return;
            }
            state.pollAttempts += 1;
            try {
                const payload = await requestJson(`/api/computer-job-batches/${encodeURIComponent(state.softwareAction.batchId)}`);
                renderActionResults(payload);
                if (hasActiveResults(payload)) {
                    state.pollTimer = window.setTimeout(poll, 2500);
                } else {
                    DOM.softwareActionSubmit.disabled = false;
                    await loadOverview({ quiet: true });
                    await refreshCurrentJobs();
                }
            } catch (error) {
                console.error(error);
                state.pollTimer = window.setTimeout(poll, 5000);
            }
        };
        state.pollTimer = window.setTimeout(poll, 1800);
    }

    function stopBatchPolling() {
        if (state.pollTimer) window.clearTimeout(state.pollTimer);
        state.pollTimer = null;
    }

    function markTargetsWithOpenJob(targetIds) {
        targetIds.forEach(id => {
            const computer = state.computers.find(candidate => getComputerId(candidate) === id);
            if (computer) computer.open_job_count = getOpenJobCount(computer) + 1;
        });
        renderStats();
    }

    async function refreshCurrentJobs() {
        if (!state.currentDetail) return;
        try {
            state.currentJobs = normalizeJobs(await requestJson(`/api/computers/${encodeURIComponent(getComputerId(state.currentDetail))}/jobs?limit=50`));
            renderJobs();
        } catch (error) {
            console.debug("Auftragsverlauf konnte nicht aktualisiert werden.", error);
        }
    }

    function openPowerAction(action) {
        if (!state.currentDetail || getConnectivity(state.currentDetail) !== "online") return;
        state.powerAction = action;
        const session = getSession(state.currentDetail);
        const label = action === "reboot" ? "neu starten" : "herunterfahren";
        DOM.powerTitle.textContent = action === "reboot" ? "Rechner neu starten" : "Rechner herunterfahren";
        DOM.powerCopy.textContent = `${getHostname(state.currentDetail)} wirklich ${label}? Letzter Kontakt: ${formatRelative(getLastSeen(state.currentDetail))}.`;
        DOM.powerSessionConfirm.hidden = !session;
        DOM.powerSessionCheckbox.checked = false;
        DOM.powerSessionCopy.textContent = session
            ? `${session.display_name} ist aktuell angemeldet. Ich bestätige die mögliche Arbeitsunterbrechung.`
            : "";
        DOM.powerSubmit.textContent = action === "reboot" ? "Neu starten" : "Herunterfahren";
        DOM.powerSubmit.disabled = Boolean(session);
        openOverlay(DOM.powerOverlay);
    }

    async function submitPowerAction(event) {
        event.preventDefault();
        if (!state.currentDetail || !state.powerAction) return;
        const session = getSession(state.currentDetail);
        if (session && !DOM.powerSessionCheckbox.checked) return;
        DOM.powerSubmit.disabled = true;
        try {
            await requestJson(`/api/computers/${encodeURIComponent(getComputerId(state.currentDetail))}/power-actions`, {
                method: "POST",
                body: JSON.stringify({
                    action: state.powerAction,
                    confirm_active_session: Boolean(session && DOM.powerSessionCheckbox.checked)
                })
            });
            markTargetsWithOpenJob([getComputerId(state.currentDetail)]);
            closeOverlay(DOM.powerOverlay);
            showFlash(state.powerAction === "reboot" ? "Neustart wurde beauftragt." : "Herunterfahren wurde beauftragt.", "success");
            await refreshCurrentJobs();
        } catch (error) {
            showFlash(error.message || "Power-Aktion konnte nicht gestartet werden.", "failure");
        } finally {
            DOM.powerSubmit.disabled = false;
        }
    }

    function bindEvents() {
        DOM.search.addEventListener("input", event => {
            state.searchTerm = event.target.value;
            applyFilters();
        });

        DOM.filterToggle.addEventListener("click", event => {
            event.stopPropagation();
            const open = DOM.filterPanel.hidden;
            DOM.filterPanel.hidden = !open;
            DOM.filterToggle.setAttribute("aria-expanded", String(open));
        });
        DOM.filterPanel.addEventListener("click", event => event.stopPropagation());
        document.addEventListener("click", () => {
            DOM.filterPanel.hidden = true;
            DOM.filterToggle.setAttribute("aria-expanded", "false");
        });

        Object.entries(DOM.filterFields).forEach(([key, select]) => select.addEventListener("change", () => {
            state.filters[key] = select.value;
            if (key === "softwareId") {
                state.filters.softwareVersion = "";
                updateSoftwareFilterVersions();
            }
            applyFilters();
        }));

        DOM.filterReset.addEventListener("click", () => {
            state.filters = { ...FILTER_DEFAULTS };
            state.quick = { session: false, jobs: false };
            renderFilterOptions();
            applyFilters();
        });

        DOM.filterTags.addEventListener("click", event => {
            const button = event.target.closest("[data-remove-filter]");
            if (!button) return;
            const key = button.dataset.removeFilter;
            if (key.startsWith("quick:")) state.quick[key.split(":")[1]] = false;
            else {
                state.filters[key] = key === "softwarePresence" ? "installed" : "";
                if (key === "softwareId") state.filters.softwareVersion = "";
            }
            renderFilterOptions();
            applyFilters();
        });

        DOM.quickButtons.forEach(button => button.addEventListener("click", () => {
            const filter = button.dataset.quickFilter;
            if (filter === "online" || filter === "offline") {
                state.filters.connectivity = state.filters.connectivity === filter ? "" : filter;
                DOM.filterFields.connectivity.value = state.filters.connectivity;
            } else {
                state.quick[filter] = !state.quick[filter];
            }
            applyFilters();
        }));

        DOM.sortButtons.forEach(button => button.addEventListener("click", () => {
            if (state.sortField === button.dataset.sortField) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
            else {
                state.sortField = button.dataset.sortField;
                state.sortDirection = "asc";
            }
            applyFilters();
        }));

        DOM.tableBody.addEventListener("click", event => {
            const checkbox = event.target.closest("[data-computer-select]");
            if (checkbox) {
                event.stopPropagation();
                const id = checkbox.dataset.computerSelect;
                checkbox.checked ? state.selectedIds.add(id) : state.selectedIds.delete(id);
                renderTable();
                return;
            }
            const row = event.target.closest("[data-computer-id]");
            if (row && !event.target.closest("button, a, input, select, textarea")) openDetail(row.dataset.computerId);
        });
        DOM.tableBody.addEventListener("keydown", event => {
            if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-computer-id]")) {
                event.preventDefault();
                openDetail(event.target.dataset.computerId);
            }
        });

        DOM.selectAll.addEventListener("change", () => {
            if (DOM.selectAll.checked) state.visibleComputers.forEach(computer => state.selectedIds.add(getComputerId(computer)));
            else state.visibleComputers.forEach(computer => state.selectedIds.delete(getComputerId(computer)));
            renderTable();
        });
        DOM.selectionClear.addEventListener("click", () => {
            state.selectedIds.clear();
            renderTable();
        });
        DOM.bulkInstall.addEventListener("click", () => openSoftwareAction("install", selectedComputers().map(getComputerId)));
        DOM.bulkUninstall.addEventListener("click", () => openSoftwareAction("uninstall", selectedComputers().map(getComputerId)));

        DOM.detailClose.addEventListener("click", () => closeOverlay(DOM.detailOverlay));
        DOM.detailOverlay.addEventListener("click", event => { if (event.target === DOM.detailOverlay) closeOverlay(DOM.detailOverlay); });
        DOM.tabButtons.forEach(button => button.addEventListener("click", () => switchTab(button.dataset.computerTab)));
        DOM.softwareSearch.addEventListener("input", renderSoftwareList);
        DOM.commentEditButton?.addEventListener("click", startCommentEdit);
        DOM.commentCancelButton?.addEventListener("click", cancelCommentEdit);
        DOM.commentSaveButton?.addEventListener("click", saveComment);
        DOM.rebootButton?.addEventListener("click", () => openPowerAction("reboot"));
        DOM.shutdownButton?.addEventListener("click", () => openPowerAction("shutdown"));
        DOM.installButton?.addEventListener("click", () => openSoftwareAction("install", [getComputerId(state.currentDetail)]));
        DOM.uninstallButton?.addEventListener("click", () => openSoftwareAction("uninstall", [getComputerId(state.currentDetail)]));

        document.querySelectorAll("[data-close-overlay]").forEach(button => button.addEventListener("click", () => closeOverlay(document.getElementById(button.dataset.closeOverlay))));
        DOM.softwareActionOverlay.addEventListener("click", event => { if (event.target === DOM.softwareActionOverlay) closeOverlay(DOM.softwareActionOverlay); });
        DOM.powerOverlay.addEventListener("click", event => { if (event.target === DOM.powerOverlay) closeOverlay(DOM.powerOverlay); });
        DOM.actionSoftware.addEventListener("change", updateSoftwareActionOptions);
        DOM.actionVersion.addEventListener("change", updateSoftwareActionSummary);
        DOM.softwareActionForm.addEventListener("submit", submitSoftwareAction);
        DOM.powerForm.addEventListener("submit", submitPowerAction);
        DOM.powerSessionCheckbox.addEventListener("change", () => { DOM.powerSubmit.disabled = !DOM.powerSessionCheckbox.checked; });
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            const active = [...document.querySelectorAll(".ui-modal-overlay.active")].pop();
            if (active) closeOverlay(active);
        });
    }

    function cacheDom() {
        DOM.search = document.getElementById("computers-search");
        DOM.filterToggle = document.getElementById("computers-filter-toggle");
        DOM.filterPanel = document.getElementById("computers-filter-panel");
        DOM.filterReset = document.getElementById("computers-filter-reset");
        DOM.filterCount = document.getElementById("computers-filter-count");
        DOM.filterTags = document.getElementById("computers-filter-tags");
        DOM.filterFields = Object.fromEntries([...document.querySelectorAll("[data-filter-field]")].map(select => [select.dataset.filterField, select]));
        DOM.visibleCount = document.getElementById("computers-visible-count");
        DOM.statOnline = document.getElementById("computers-stat-online");
        DOM.statOffline = document.getElementById("computers-stat-offline");
        DOM.statSession = document.getElementById("computers-stat-session");
        DOM.statJobs = document.getElementById("computers-stat-jobs");
        DOM.quickButtons = [...document.querySelectorAll("[data-quick-filter]")];
        DOM.tableBody = document.getElementById("computers-table-body");
        DOM.sortButtons = [...document.querySelectorAll("[data-sort-field]")];
        DOM.selectAll = document.getElementById("computers-select-all");
        DOM.bulkBar = document.getElementById("computers-bulk-bar");
        DOM.selectionCount = document.getElementById("computers-selection-count");
        DOM.selectionClear = document.getElementById("computers-selection-clear");
        DOM.bulkInstall = document.getElementById("computers-bulk-install");
        DOM.bulkUninstall = document.getElementById("computers-bulk-uninstall");
        DOM.truncationNotice = document.getElementById("computers-truncation-notice");
        DOM.truncationLimit = document.getElementById("computers-truncation-limit");

        DOM.detailOverlay = document.getElementById("computer-detail-overlay");
        DOM.detailClose = document.getElementById("computer-detail-close");
        DOM.detailTitle = document.getElementById("computer-detail-title");
        DOM.detailAsset = document.getElementById("computer-detail-asset");
        DOM.detailStatus = document.getElementById("computer-detail-status");
        DOM.detailTranche = document.getElementById("computer-detail-tranche");
        DOM.detailDisabled = document.getElementById("computer-detail-disabled");
        DOM.adapterList = document.getElementById("computer-adapter-list");
        DOM.dataStatusList = document.getElementById("computer-datastatus-list");
        DOM.tabButtons = [...document.querySelectorAll("[data-computer-tab]")];
        DOM.tabViews = [...document.querySelectorAll("[data-computer-view]")];
        DOM.softwareCount = document.getElementById("computer-software-count");
        DOM.jobsCount = document.getElementById("computer-jobs-count");
        DOM.softwareSearch = document.getElementById("computer-software-search");
        DOM.softwareList = document.getElementById("computer-software-list");
        DOM.jobsList = document.getElementById("computer-jobs-list");
        DOM.commentText = document.getElementById("computer-comment-text");
        DOM.commentEditor = document.getElementById("computer-comment-editor");
        DOM.commentInput = document.getElementById("computer-comment-input");
        DOM.commentEditButton = document.getElementById("computer-comment-edit");
        DOM.commentCancelButton = document.getElementById("computer-comment-cancel");
        DOM.commentSaveButton = document.getElementById("computer-comment-save");
        DOM.rebootButton = document.getElementById("computer-reboot");
        DOM.shutdownButton = document.getElementById("computer-shutdown");
        DOM.installButton = document.getElementById("computer-install");
        DOM.uninstallButton = document.getElementById("computer-uninstall");

        DOM.softwareActionOverlay = document.getElementById("computer-software-action-overlay");
        DOM.softwareActionForm = document.getElementById("computer-software-action-form");
        DOM.softwareActionTitle = document.getElementById("computer-software-action-title");
        DOM.softwareActionTargets = document.getElementById("computer-software-action-targets");
        DOM.softwareActionSubmit = document.getElementById("computer-software-action-submit");
        DOM.actionSoftware = document.getElementById("computer-action-software");
        DOM.actionVersion = document.getElementById("computer-action-version");
        DOM.actionSummary = document.getElementById("computer-action-summary");
        DOM.actionResults = document.getElementById("computer-action-results");

        DOM.powerOverlay = document.getElementById("computer-power-overlay");
        DOM.powerForm = document.getElementById("computer-power-form");
        DOM.powerTitle = document.getElementById("computer-power-title");
        DOM.powerCopy = document.getElementById("computer-power-copy");
        DOM.powerSessionConfirm = document.getElementById("computer-power-session-confirm");
        DOM.powerSessionCheckbox = document.getElementById("computer-power-session-checkbox");
        DOM.powerSessionCopy = document.getElementById("computer-power-session-copy");
        DOM.powerSubmit = document.getElementById("computer-power-submit");
    }

    async function init() {
        cacheDom();
        loadSavedState();
        DOM.search.value = state.searchTerm;
        bindEvents();
        await loadOverview();
    }

    document.addEventListener("DOMContentLoaded", init);
}());
