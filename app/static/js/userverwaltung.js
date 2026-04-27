const state = {
    users: [],
    systemMap: null,
    roleMap: null,
    currentUserDetail: null,
    currentUserActivity: null,
    activeUserTab: "details",
    searchTerm: "",
    filters: {
        primaryRoleIds: [],
        secondaryRoleIds: [],
        includeInactive: false,
        openCategory: null
    }
};

const DOM = {};

function getAuthz() {
    return window.currentAuthz || { pages: [], capabilities: [], scopes: {} };
}

function hasCapability(capability) {
    const authz = getAuthz();
    return Array.isArray(authz.capabilities) && authz.capabilities.includes(capability);
}

const STATUS_LABELS = {
    active: "Aktiv",
    inactive: "Inaktiv",
    pending: "Offen",
    in_progress: "In Bearbeitung",
    requested: "Beantragt",
    revocation_requested: "Entzug angefragt",
    revoked: "Entzogen"
};

const ASSIGNMENT_LABELS = {
    requested: "Beantragt",
    active: "Aktiv",
    revocation_requested: "Entzug angefragt",
    revoked: "Entzogen"
};

const ACTIVE_ROLE_ASSIGNMENT_CODES = new Set(["active"]);
const REQUESTED_ROLE_ASSIGNMENT_CODES = new Set(["requested", "open", "pending", "in_progress"]);

const api = {
    async getUsers() {
        const isActive = String(!state.filters.includeInactive);
        const res = await fetch(`/api/users?is_active=${isActive}`);
        if (!res.ok) {
            throw new Error(`Users konnten nicht geladen werden (${res.status})`);
        }
        return res.json();
    },

    async getUserDetails(id) {
        const res = await fetch(`/api/users/${id}/details`);
        if (!res.ok) {
            throw new Error(`Userdetails konnten nicht geladen werden (${res.status})`);
        }
        return res.json();
    },

    async getUserActivity(id) {
        const res = await fetch(`/api/users/${id}/activity`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || `Aktivitäten konnten nicht geladen werden (${res.status})`);
        }
        return data;
    },

    async setupSofaAccess(userId, password) {
        const res = await fetch(`/api/users/${userId}/sofa-access/setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || "SOFA Zugriff konnte nicht eingerichtet werden");
        }
        return data;
    },

    async resetSofaPassword(userId, password) {
        const res = await fetch(`/api/users/${userId}/sofa-access/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || "SOFA Passwort konnte nicht zurückgesetzt werden");
        }
        return data;
    },

    async revokeSofaAccess(userId) {
        const res = await fetch(`/api/users/${userId}/sofa-access/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.detail || data.error || "SOFA Zugriff konnte nicht entzogen werden");
        }
        return data;
    },

    async getSystemMap() {
        if (state.systemMap) {
            return state.systemMap;
        }

        const res = await fetch("/api/systems/map");
        if (!res.ok) {
            throw new Error("System Map konnte nicht geladen werden");
        }

        state.systemMap = await res.json();
        return state.systemMap;
    },

    async getRoleMap() {
        if (state.roleMap) {
            return state.roleMap;
        }

        const res = await fetch("/api/roles/map");
        if (!res.ok) {
            throw new Error("Role Map konnte nicht geladen werden");
        }

        state.roleMap = await res.json();
        return state.roleMap;
    },

    async startOnboarding(payload) {
        try {
            const res = await fetch("/api/processes/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pnr: payload })
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }

            showFlash("Onboarding gestartet", "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startExternalOnboarding(payload) {
        try {
            const res = await fetch("/api/processes/onboarding-ext", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }

            showFlash("Externer User angelegt", "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startOffboarding(payload) {
        try {
            const res = await fetch("/api/processes/offboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }

            showFlash(`Austritt zum ${payload.exitdate} beantragt`, "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startTmpRoleAssignment(payload) {
        try {
            const res = await fetch("/api/processes/tmp_role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }

            const roleName = state.roleMap?.[payload.role_id]?.name || payload.role_id;
            showFlash(`Temporäre Rolle ${roleName} beantragt`, "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startNewSkillAssignment(payload) {
        try {
            const res = await fetch("/api/processes/skill_assignment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }

            const roleName = state.roleMap?.[payload.role_id]?.name || payload.role_id;
            showFlash(`Rolle ${roleName} beantragt`, "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startPrimaryRoleChange(payload) {
        try {
            const res = await fetch("/api/processes/change", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || data.error || "Unbekannter Fehler", "failure");
                return false;
            }

            const roleName = state.roleMap?.[payload.role_id]?.name || payload.role_id;
            showFlash(`Funktion erfolgreich auf ${roleName} gewechselt`, "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startSkillRevoke(payload) {
        try {
            const res = await fetch("/api/processes/skill_revocation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return false;
            }

            const roleName = state.roleMap?.[payload.role_id]?.name || payload.role_id;
            showFlash(`Rollen-Entzug für ${roleName} beantragt`, "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    },

    async startTrainingSchedule(payload) {
        try {
            const res = await fetch("/api/processes/training_schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));

            if (res.status === 501) {
                showFlash(data.detail || "Backend für Schulungsplanung ist noch nicht implementiert", "failure");
                return false;
            }

            if (!res.ok) {
                showFlash(data.detail || data.error || "Unbekannter Fehler", "failure");
                return false;
            }

            showFlash("Schulung erfolgreich geplant", "success");
            return true;
        } catch (err) {
            console.error(err);
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            return false;
        }
    }
};

function normalizeValue(value) {
    return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function humanizeToken(value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    return String(value)
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatDate(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getRoleOptionsByType(type) {
    return Object.entries(state.roleMap || {})
        .filter(([, role]) => role.type === type)
        .sort(([, left], [, right]) => left.name.localeCompare(right.name, "de"));
}

function updateBodyScrollLock() {
    const hasOpenModal = document.querySelector(".ui-modal-overlay.active");
    document.body.classList.toggle("modal-open", Boolean(hasOpenModal));
}

function openOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay) {
        return;
    }
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    updateBodyScrollLock();
}

function closeOverlay(id) {
    const overlay = document.getElementById(id);
    if (!overlay) {
        return;
    }
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    updateBodyScrollLock();
}

function getSummaryStatus(user) {
    const derivedStatuses = getNormalizedDerivedStatuses(user);
    if (derivedStatuses.length) {
        const primaryStatus = derivedStatuses[0];
        return {
            code: primaryStatus.code,
            label: primaryStatus.label,
            className: primaryStatus.className,
            count: derivedStatuses.length,
            extraCount: Math.max(derivedStatuses.length - 1, 0),
            tooltip: buildDerivedStatusesTooltip(derivedStatuses),
            source: "derived"
        };
    }

    const rawStatus =
        user?.summary_status_code ||
        user?.summary_status ||
        (user?.is_active === false ? "inactive" : "active");

    const normalized = normalizeValue(rawStatus).replace(/\s+/g, "_");
    const label = STATUS_LABELS[normalized] || humanizeToken(rawStatus);

    let className = "users-status-progress";
    if (normalized === "active") {
        className = "users-status-active";
    } else if (normalized === "inactive") {
        className = "users-status-inactive";
    } else if (normalized.includes("request") || normalized === "requested") {
        className = "users-status-pending";
    } else if (normalized.includes("warning") || normalized.includes("revocation")) {
        className = "users-status-warning";
    } else if (normalized.includes("progress") || normalized.includes("pending")) {
        className = "users-status-progress";
    }

    return { code: normalized, label, className, count: 1, extraCount: 0, tooltip: label, source: "fallback" };
}

function getSeverityBadgeClass(severity, isOverdue = false) {
    const normalized = normalizeValue(severity) || "info";
    if (isOverdue || normalized === "error") {
        return "users-status-error";
    }
    if (normalized === "warning") {
        return "users-status-warning";
    }
    return "users-status-progress";
}

function normalizeDerivedStatus(status) {
    if (!status || typeof status !== "object") {
        return null;
    }

    const code = String(status.code || "unknown").trim() || "unknown";
    const label = String(status.label || humanizeToken(code)).trim() || humanizeToken(code);
    const severity = normalizeValue(status.severity) || "info";
    const isOverdue = Boolean(status.is_overdue);
    const normalized = {
        code,
        label,
        processId: status.process_id ?? null,
        processType: status.process_type ?? null,
        severity,
        isOverdue,
        referenceDate: status.reference_date || null,
        startedAt: status.started_at || null,
        completedAt: status.completed_at || null,
        roleId: status.role_id ?? null,
        roleName: status.role_name || null,
        eventId: status.event_id ?? null,
        eventType: status.event_type || null,
        eventStatus: status.event_status || null,
        lastError: status.last_error || null
    };

    return {
        ...normalized,
        className: getSeverityBadgeClass(normalized.severity, normalized.isOverdue)
    };
}

function getNormalizedDerivedStatuses(user) {
    const statuses = Array.isArray(user?.derived_statuses) ? user.derived_statuses : [];
    return statuses
        .map(normalizeDerivedStatus)
        .filter(Boolean);
}

function formatDerivedStatusSummary(status) {
    const parts = [status.label];
    if (status.roleName) {
        parts.push(`Rolle: ${status.roleName}`);
    }
    if (status.referenceDate) {
        parts.push(`Bezug: ${formatDate(status.referenceDate)}`);
    }
    if (status.isOverdue) {
        parts.push("überfällig");
    }
    return parts.join(" · ");
}

function buildDerivedStatusesTooltip(statuses) {
    return statuses.map(formatDerivedStatusSummary).join("\n");
}

function renderDerivedStatusBadge(status, options = {}) {
    const extraCount = Number(options.extraCount || 0);
    const tooltip = options.tooltip || status.label;
    return `
        <span class="users-derived-status-main" title="${escapeHtml(tooltip)}">
            <span class="users-status-badge ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
            ${extraCount > 0 ? `<span class="users-derived-status-count" aria-label="${escapeHtml(`${extraCount} weitere Status`)}">+${escapeHtml(extraCount)}</span>` : ""}
        </span>
    `;
}

function getAssignmentStatus(resourceOrRole) {
    const rawStatus =
        resourceOrRole?.assignment_status ||
        resourceOrRole?.status ||
        resourceOrRole?.lifecycle_status ||
        "active";

    const normalized = normalizeValue(rawStatus).replace(/\s+/g, "_");
    return {
        code: normalized,
        label: ({
            ...ASSIGNMENT_LABELS,
            open: "Offen",
            in_progress: "In Bearbeitung",
            completed: "Erledigt",
            inactive: "Inaktiv"
        })[normalized] || humanizeToken(rawStatus),
        className: {
            requested: "user-assignment-requested",
            open: "user-assignment-requested",
            active: "user-assignment-active",
            completed: "user-assignment-active",
            in_progress: "users-status-progress",
            revocation_requested: "user-assignment-revocation-requested",
            revoked: "user-assignment-revoked",
            inactive: "user-assignment-revoked"
        }[normalized] || "users-status-progress"
    };
}

function getAssignmentStatusCode(resourceOrRole) {
    return getAssignmentStatus(resourceOrRole).code;
}

function isActiveRoleAssignment(role) {
    return ACTIVE_ROLE_ASSIGNMENT_CODES.has(getAssignmentStatusCode(role));
}

function isRequestedRoleAssignment(role) {
    return REQUESTED_ROLE_ASSIGNMENT_CODES.has(getAssignmentStatusCode(role));
}

function isSelectionBlockingRoleAssignment(role) {
    return isActiveRoleAssignment(role) || isRequestedRoleAssignment(role);
}

function getSecondaryRoles(user, options = {}) {
    const { activeOnly = true } = options;
    const secondaryRoles = Array.isArray(user?.secondary_roles) ? user.secondary_roles : [];

    return activeOnly
        ? secondaryRoles.filter(role => isActiveRoleAssignment(role))
        : secondaryRoles;
}

function getBlockedRoleIdsForSelection(user, roleType = null) {
    const sourceUser = state.currentUserDetail?.user_id === user?.user_id
        ? state.currentUserDetail
        : user;

    return new Set(
        getRoleAssignments(sourceUser)
            .filter(role => !roleType || normalizeValue(role.role_type) === normalizeValue(roleType))
            .filter(isSelectionBlockingRoleAssignment)
            .map(role => String(role?.role_id || "").trim())
            .filter(Boolean)
    );
}

function getRolePreview(roles) {
    const names = (roles || []).map(role => role?.name).filter(Boolean);
    if (!names.length) {
        return "Keine Nebenrollen";
    }
    if (names.length <= 2) {
        return names.join(", ");
    }
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function getResourceIdentifier(resource) {
    return resource?.technical_identifier ||
        resource?.resource_name ||
        resource?.account_identifier ||
        resource?.display_name ||
        "-";
}

function getResourceDisplayName(resource) {
    return resource?.display_name ||
        resource?.resource_name ||
        resource?.technical_identifier ||
        resource?.account_identifier ||
        "-";
}

function getSystemName(resource) {
    const systemId = resource?.system_id;
    if (systemId !== undefined && state.systemMap?.[systemId]?.name) {
        return state.systemMap[systemId].name;
    }
    return resource?.system_name || resource?.system || "Ohne System";
}

function dedupeBy(items, keyBuilder) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyBuilder(item);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function sortUsersByName(users) {
    return [...(Array.isArray(users) ? users : [])].sort((left, right) => {
        const leftKey = `${left?.last_name || ""} ${left?.first_name || ""}`.trim();
        const rightKey = `${right?.last_name || ""} ${right?.first_name || ""}`.trim();
        return leftKey.localeCompare(rightKey, "de");
    });
}

function buildUserLabel(user) {
    const name = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
    return name || user?.email || user?.racf || user?.pnr || `User #${user?.user_id}`;
}

function buildUserSelectionMeta(user) {
    return [user?.pnr && `PNR ${user.pnr}`, user?.racf && `RACF ${user.racf}`, user?.primary_role?.name]
        .filter(Boolean)
        .join(" · ");
}

function mergeUsersById(...groups) {
    return dedupeBy(groups.flat().filter(Boolean), user => String(user?.user_id || ""));
}

function getRoleAssignments(detail) {
    const directAssignments = Array.isArray(detail?.role_assignments) ? detail.role_assignments : [];

    if (directAssignments.length) {
        return directAssignments.map(role => ({
            role_id: role.role_id,
            name: role.role_name || role.name || state.roleMap?.[role.role_id]?.name || `Rolle #${role.role_id}`,
            role_type: role.role_type || role.type || state.roleMap?.[role.role_id]?.type || null,
            assignment_status: role.assignment_status || role.status || "active",
            process_id: role.process_id || null,
            is_primary: String(role.role_id) === String(detail?.primary_role?.role_id) || normalizeValue(role.role_type) === "primary",
            resources: Array.isArray(role.resources) ? role.resources : []
        }));
    }

    const combinedRoles = [
        ...(detail?.primary_role ? [detail.primary_role] : []),
        ...(Array.isArray(detail?.secondary_roles) ? detail.secondary_roles : []),
        ...(Array.isArray(detail?.roles) ? detail.roles : [])
    ].filter(Boolean);

    const uniqueRoles = dedupeBy(combinedRoles, role => String(role.role_id));

    return uniqueRoles.map(role => ({
        role_id: role.role_id,
        name: role.name || state.roleMap?.[role.role_id]?.name || `Rolle #${role.role_id}`,
        role_type: role.role_type || role.type || state.roleMap?.[role.role_id]?.type || null,
        assignment_status: role.assignment_status || role.status || "active",
        process_id: role.process_id || null,
        is_primary: String(role.role_id) === String(detail?.primary_role?.role_id) || normalizeValue(role.role_type || role.type) === "primary",
        resources: Array.isArray(detail?.role_resources_map?.[role.role_id]) ? detail.role_resources_map[role.role_id] : []
    }));
}

function getSortedRoleAssignments(detail) {
    return getRoleAssignments(detail).sort((left, right) => {
        if (left.is_primary && !right.is_primary) {
            return -1;
        }
        if (!left.is_primary && right.is_primary) {
            return 1;
        }
        return String(left.name || "").localeCompare(String(right.name || ""), "de");
    });
}

function getUserResources(detail) {
    const roleResources = getRoleAssignments(detail).flatMap(role =>
        (Array.isArray(role.resources) ? role.resources : []).map(resource => ({
            ...resource,
            source_role_name: role.name,
            assignment_status: resource.assignment_status || resource.status || resource.lifecycle_status || role.assignment_status || "active"
        }))
    );

    const accountResources = (Array.isArray(detail?.accounts) ? detail.accounts : []).map(account => ({
        system_id: account.system_id,
        system_name: getSystemName(account),
        technical_identifier: account.account_identifier,
        display_name: account.account_identifier,
        assignment_status: account.assignment_status || "active"
    }));

    return dedupeBy([...roleResources, ...accountResources], resource => [
        resource.system_id ?? resource.system_name ?? "system",
        getResourceIdentifier(resource),
        getResourceDisplayName(resource)
    ].join("|"));
}

function groupResourcesBySystem(resources) {
    const groups = new Map();

    resources.forEach(resource => {
        const systemName = getSystemName(resource);
        if (!groups.has(systemName)) {
            groups.set(systemName, []);
        }
        groups.get(systemName).push(resource);
    });

    return Array.from(groups.entries())
        .sort(([left], [right]) => left.localeCompare(right, "de"))
        .map(([systemName, items]) => ({
            systemName,
            items: items.sort((left, right) => getResourceIdentifier(left).localeCompare(getResourceIdentifier(right), "de"))
        }));
}

function renderEmptyState(message) {
    return `<div class="ui-empty-state ui-empty-inline">${escapeHtml(message)}</div>`;
}

const filterController = {
    async init() {
        this.bindEvents();
        try {
            await api.getRoleMap();
        } catch (err) {
            console.error("Role Map konnte nicht für Filter geladen werden", err);
        }
        this.renderActiveTags();
    },

    bindEvents() {
        DOM.filterBtn?.addEventListener("click", event => {
            event.stopPropagation();
            const shouldOpen = !DOM.filterDropdown.classList.contains("active");
            this.closeMenus();
            if (shouldOpen) {
                DOM.filterDropdown.classList.add("active");
            }
        });

        DOM.filterDropdown?.querySelectorAll("[data-filter]").forEach(button => {
            button.addEventListener("click", async event => {
                event.stopPropagation();
                await this.openSubfilter(button.dataset.filter);
            });
        });

        DOM.subfilterDropdown?.addEventListener("click", event => {
            event.stopPropagation();
        });

        DOM.subfilterDropdown?.addEventListener("change", async event => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            if (target.dataset.filterType === "status") {
                state.filters.includeInactive = target.checked;
                this.renderActiveTags();
                await tableController.loadUsers();
                await this.openSubfilter("status");
                return;
            }

            if (target.dataset.filterType === "primary") {
                this.toggleRoleFilter("primaryRoleIds", target.value, target.checked);
            }

            if (target.dataset.filterType === "secondary") {
                this.toggleRoleFilter("secondaryRoleIds", target.value, target.checked);
            }

            this.renderActiveTags();
            tableController.render();
        });

        DOM.activeFilters?.addEventListener("click", async event => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.matches("[data-filter-type]")) {
                return;
            }

            const filterType = target.dataset.filterType;
            const value = target.dataset.value;

            if (filterType === "status") {
                state.filters.includeInactive = false;
                this.renderActiveTags();
                this.rerenderOpenSubfilter();
                await tableController.loadUsers();
                return;
            }

            if (filterType === "primary") {
                this.toggleRoleFilter("primaryRoleIds", value, false);
            }

            if (filterType === "secondary") {
                this.toggleRoleFilter("secondaryRoleIds", value, false);
            }

            this.renderActiveTags();
            this.rerenderOpenSubfilter();
            tableController.render();
        });

        document.addEventListener("click", event => {
            if (!DOM.filterContainer?.contains(event.target)) {
                this.closeMenus();
            }
        });
    },

    async openSubfilter(category) {
        state.filters.openCategory = category;
        if (!state.roleMap && category !== "status") {
            await api.getRoleMap();
        }

        DOM.filterDropdown.classList.add("active");
        DOM.subfilterDropdown.classList.add("active");
        this.renderSubfilter(category);
    },

    closeMenus() {
        DOM.filterDropdown?.classList.remove("active");
        DOM.subfilterDropdown?.classList.remove("active");
        state.filters.openCategory = null;
    },

    rerenderOpenSubfilter() {
        if (!state.filters.openCategory || !DOM.subfilterDropdown?.classList.contains("active")) {
            return;
        }
        this.renderSubfilter(state.filters.openCategory);
    },

    renderSubfilter(category) {
        if (!DOM.subfilterDropdown) {
            return;
        }

        if (category === "status") {
            DOM.subfilterDropdown.innerHTML = `
                <label>
                    <input
                        type="checkbox"
                        data-filter-type="status"
                        ${state.filters.includeInactive ? "checked" : ""}
                    >
                    Inaktive User mitladen
                </label>
            `;
            return;
        }

        const roleType = category === "hauptrolle" ? "PRIMARY" : "SECONDARY";
        const selectedIds = category === "hauptrolle" ? state.filters.primaryRoleIds : state.filters.secondaryRoleIds;
        const filterType = category === "hauptrolle" ? "primary" : "secondary";
        const options = getRoleOptionsByType(roleType);

        DOM.subfilterDropdown.innerHTML = options.length
            ? options.map(([roleId, role]) => `
                <label>
                    <input
                        type="checkbox"
                        value="${escapeHtml(roleId)}"
                        data-filter-type="${filterType}"
                        ${selectedIds.includes(String(roleId)) ? "checked" : ""}
                    >
                    ${escapeHtml(role.name)}
                </label>
            `).join("")
            : "<span>Keine Rollen gefunden</span>";
    },

    toggleRoleFilter(key, roleId, checked) {
        const normalizedRoleId = String(roleId);
        const values = new Set(state.filters[key].map(String));
        if (checked) {
            values.add(normalizedRoleId);
        } else {
            values.delete(normalizedRoleId);
        }
        state.filters[key] = Array.from(values);
    },

    renderActiveTags() {
        if (!DOM.activeFilters) {
            return;
        }

        const tags = [
            ...state.filters.primaryRoleIds.map(roleId => ({
                filterType: "primary",
                value: roleId,
                label: `Funktion: ${state.roleMap?.[roleId]?.name || roleId}`
            })),
            ...state.filters.secondaryRoleIds.map(roleId => ({
                filterType: "secondary",
                value: roleId,
                label: `Nebenrolle: ${state.roleMap?.[roleId]?.name || roleId}`
            }))
        ];

        if (state.filters.includeInactive) {
            tags.push({
                filterType: "status",
                value: "inactive",
                label: "Inaktive inkl."
            });
        }

        DOM.activeFilters.innerHTML = tags.map(tag => `
            <div class="users-filter-tag">
                <span>${escapeHtml(tag.label)}</span>
                <button type="button" data-filter-type="${escapeHtml(tag.filterType)}" data-value="${escapeHtml(tag.value)}" aria-label="${escapeHtml(tag.label)} entfernen">&times;</button>
            </div>
        `).join("");
    }
};

const tableController = {
    async init() {
        this.bindSearch();
        await this.loadUsers();
    },

    async loadUsers() {
        try {
            state.users = await api.getUsers();
            this.render();
        } catch (err) {
            console.error(err);
        DOM.tableBody.innerHTML = `
                <tr class="users-empty-row">
                    <td colspan="6">${renderEmptyState("Fehler beim Laden der User.")}</td>
                </tr>
            `;
            showFlash("Fehler beim Laden der User", "failure");
        }
    },

    getFilteredUsers() {
        return sortUsersByName(
            state.users
            .filter(user => this.matchesSearch(user))
            .filter(user => this.matchesPrimaryRoles(user))
            .filter(user => this.matchesSecondaryRoles(user))
        );
    },

    matchesSearch(user) {
        const searchValue = normalizeValue(state.searchTerm);
        if (!searchValue) {
            return true;
        }

        const haystacks = [
            user.pnr,
            user.racf,
            user.last_name,
            user.first_name,
            user.email,
            user.primary_role?.name,
            ...getSecondaryRoles(user).map(role => role?.name)
        ];

        return haystacks.some(value => normalizeValue(value).includes(searchValue));
    },

    matchesPrimaryRoles(user) {
        if (!state.filters.primaryRoleIds.length) {
            return true;
        }
        return state.filters.primaryRoleIds.includes(String(user.primary_role?.role_id || ""));
    },

    matchesSecondaryRoles(user) {
        if (!state.filters.secondaryRoleIds.length) {
            return true;
        }

        const userRoleIds = getSecondaryRoles(user).map(role => String(role.role_id));
        return state.filters.secondaryRoleIds.some(roleId => userRoleIds.includes(String(roleId)));
    },

    render() {
        const users = this.getFilteredUsers();

        DOM.tableBody.innerHTML = users.length
            ? users.map(user => {
                const secondaryRoles = getSecondaryRoles(user);
                const status = getSummaryStatus(user);

                return `
                    <tr class="users-table-row ${user.is_active ? "" : "is-inactive"}" data-user-id="${escapeHtml(user.user_id)}">
                        <td class="users-identity-cell">
                            <div class="users-identity-block">
                                <span class="users-identity-main">${escapeHtml(user.racf || "-")}</span>
                                <span class="users-identity-meta">${escapeHtml(user.pnr || "-")}</span>
                            </div>
                        </td>
                        <td class="users-name-cell">
                            <div class="users-name-block">
                                <span class="users-name-main">${escapeHtml(user.last_name || "-")}</span>
                                <span class="users-name-meta">${escapeHtml(user.email || "")}</span>
                            </div>
                        </td>
                        <td>${escapeHtml(user.first_name || "-")}</td>
                        <td class="users-role-cell">${escapeHtml(user.primary_role?.name || "-")}</td>
                        <td class="users-secondary-cell">
                            <div class="users-secondary-block">
                                <span class="users-secondary-count" title="${escapeHtml(secondaryRoles.map(role => role.name).join("\n") || "Keine Nebenrollen")}">${secondaryRoles.length}</span>
                                <span class="users-secondary-preview ${secondaryRoles.length ? "" : "is-empty"}">${escapeHtml(getRolePreview(secondaryRoles))}</span>
                            </div>
                        </td>
                        <td>${renderDerivedStatusBadge(status, { extraCount: status.extraCount, tooltip: status.tooltip })}</td>
                    </tr>
                `;
            }).join("")
            : `
                <tr class="users-empty-row">
                    <td colspan="6">${renderEmptyState("Keine User gefunden.")}</td>
                </tr>
            `;

        this.bindRows();
    },

    bindRows() {
        DOM.tableBody.querySelectorAll("[data-user-id]").forEach(row => {
            row.addEventListener("click", () => {
                sidebarController.open(row.dataset.userId);
            });
        });
    },

    bindSearch() {
        DOM.searchInput?.addEventListener("input", event => {
            state.searchTerm = event.target.value || "";
            this.render();
        });
    }
};

const sidebarController = {
    init() {
        DOM.sidebarCloseBtn?.addEventListener("click", () => this.close());
        DOM.sidebarOverlay?.addEventListener("click", event => {
            if (event.target === DOM.sidebarOverlay) {
                this.close();
            }
        });
        DOM.userPanelTabs?.addEventListener("click", event => {
            const button = event.target.closest("[data-tab]");
            if (!button) {
                return;
            }
            this.setActiveTab(button.dataset.tab);
        });
    },

    async open(userId) {
        try {
            const [detail, activity] = await Promise.all([
                api.getUserDetails(userId),
                api.getUserActivity(userId).catch(error => {
                    console.error("User Activity Fehler", error);
                    return {
                        affected_processes: [],
                        initiated_processes: [],
                        recent_task_actions: []
                    };
                }),
                api.getSystemMap().catch(() => state.systemMap || {})
            ]);

            state.currentUserDetail = detail;
            state.currentUserActivity = activity;
            await this.render(detail, activity);
            this.setActiveTab(state.activeUserTab);
            openOverlay("sidebar-overlay");
        } catch (err) {
            console.error("UserDetails Fehler", err);
            showFlash("Userdetails konnten nicht geladen werden", "failure");
        }
    },

    close() {
        closeOverlay("sidebar-overlay");
        state.currentUserDetail = null;
        state.currentUserActivity = null;
        state.activeUserTab = "details";
    },

    async refreshCurrentUser() {
        if (!state.currentUserDetail?.user_id) {
            return;
        }
        await this.open(state.currentUserDetail.user_id);
    },

    setActiveTab(tabId) {
        state.activeUserTab = tabId;

        DOM.userPanelTabButtons.forEach(button => {
            button.classList.toggle("is-active", button.dataset.tab === tabId);
        });

        DOM.userPanelViews.forEach(view => {
            view.classList.toggle("active", view.id === `tab-${tabId}`);
        });
    },

    async render(user, activity) {
        const status = getSummaryStatus(user);
        DOM.sidebarUsername.textContent = `${user.first_name || "-"} ${user.last_name || "-"}`.trim();
        DOM.sidebarSubtitle.textContent = user.email || user.racf || "Userdetails";
        DOM.sidebarPnrChip.textContent = `PNR ${user.pnr || "-"}`;
        DOM.sidebarRacfChip.textContent = `RACF ${user.racf || "-"}`;
        DOM.sidebarStatusChip.className = `ui-status-badge ${status.className}`;
        DOM.sidebarStatusChip.textContent = status.label;
        DOM.sidebarStatusChip.title = status.tooltip || status.label;

        DOM.sidebarPNR.textContent = user.pnr || "-";
        DOM.sidebarRacf.textContent = user.racf || "-";
        DOM.sidebarLastName.textContent = user.last_name || "-";
        DOM.sidebarFirstName.textContent = user.first_name || "-";
        DOM.sidebarFunktion.textContent = user.primary_role?.name || "-";
        DOM.sidebarEmail.textContent = user.email || "-";
        DOM.sidebarTelefon.textContent = user.telefon || "-";
        DOM.sidebarMobil.textContent = user.mobile || "-";
        DOM.sidebarEintritt.textContent = formatDate(user.eintritt);
        DOM.sidebarAustritt.textContent = formatDate(user.austritt);

        if (DOM.userHelixLink) {
            DOM.userHelixLink.href = user.helix_url || "#";
            DOM.userHelixLink.toggleAttribute("aria-disabled", !user.helix_url);
        }

        this.renderDerivedStatuses(user);
        await this.renderAccounts(user.accounts || []);
        this.renderSofaAccessActions(user);
        this.renderRoles(user);
        this.renderResources(user);
        this.renderActivity(activity);
        this.bindActions(user);
    },

    renderSofaAccessActions(user) {
        const hasSofaAccess = Boolean(user.has_sofa_access);
        const canSetup = hasCapability("sofa_access.setup");
        const canReset = hasCapability("sofa_access.reset");
        const canRevoke = hasCapability("sofa_access.revoke");

        DOM.sofaAccessStatus.textContent = hasSofaAccess
            ? "SOFA Zugriff ist eingerichtet und kann hier direkt verwaltet werden."
            : "Für diesen User ist aktuell kein SOFA Zugriff eingerichtet.";

        if (!canSetup && !canReset && !canRevoke) {
            DOM.sofaAccessActions.innerHTML = `
                <div class="ui-empty-state ui-empty-inline">Keine administrativen SOFA-Aktionen verfuegbar.</div>
            `;
            return;
        }

        if (!hasSofaAccess) {
            DOM.sofaAccessActions.innerHTML = canSetup
                ? `
                    <button type="button" class="btn btn-primary" id="sofa-access-setup-btn">SOFA Zugriff einrichten</button>
                `
                : `
                    <div class="ui-empty-state ui-empty-inline">Kein Recht zum Einrichten von SOFA-Zugaengen.</div>
                `;
            return;
        }

        const buttons = [];
        if (canReset) {
            buttons.push('<button type="button" class="btn btn-secondary" id="sofa-password-reset-btn">SOFA Passwort zurücksetzen</button>');
        }
        if (canRevoke) {
            buttons.push('<button type="button" class="btn btn-red" id="sofa-access-revoke-btn">SOFA Zugriff entziehen</button>');
        }

        DOM.sofaAccessActions.innerHTML = buttons.join("") || `
            <div class="ui-empty-state ui-empty-inline">Keine administrativen SOFA-Aktionen verfuegbar.</div>
        `;
    },

    renderDerivedStatuses(user) {
        const statuses = getNormalizedDerivedStatuses(user);
        if (DOM.userDerivedStatusCount) {
            DOM.userDerivedStatusCount.textContent = String(statuses.length);
        }

        if (!DOM.userDerivedStatusList) {
            return;
        }

        if (!statuses.length) {
            DOM.userDerivedStatusList.innerHTML = renderEmptyState("Keine abgeleiteten Status vorhanden.");
            return;
        }

        DOM.userDerivedStatusList.innerHTML = statuses.map(status => `
            <article class="user-derived-status-card">
                <div class="user-derived-status-top">
                    <div class="user-derived-status-head">
                        <span class="users-status-badge ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
                        ${status.roleName ? `<span class="ui-chip ui-chip-neutral">${escapeHtml(status.roleName)}</span>` : ""}
                        ${status.isOverdue ? '<span class="ui-chip ui-chip-warning">Überfällig</span>' : ""}
                    </div>
                </div>
                <div class="user-derived-status-meta">
                    ${status.referenceDate ? `<span><strong>Bezug:</strong> ${escapeHtml(formatDateTime(status.referenceDate))}</span>` : ""}
                    ${status.startedAt ? `<span><strong>Gestartet:</strong> ${escapeHtml(formatDateTime(status.startedAt))}</span>` : ""}
                    ${status.completedAt ? `<span><strong>Abgeschlossen:</strong> ${escapeHtml(formatDateTime(status.completedAt))}</span>` : ""}
                    ${status.processType ? `<span><strong>Prozess:</strong> ${escapeHtml(humanizeToken(status.processType))}${status.processId ? ` · #${escapeHtml(status.processId)}` : ""}</span>` : status.processId ? `<span><strong>Prozess:</strong> #${escapeHtml(status.processId)}</span>` : ""}
                    ${status.eventType ? `<span><strong>Event:</strong> ${escapeHtml(humanizeToken(status.eventType))}${status.eventStatus ? ` · ${escapeHtml(humanizeToken(status.eventStatus))}` : ""}</span>` : status.eventStatus ? `<span><strong>Event-Status:</strong> ${escapeHtml(humanizeToken(status.eventStatus))}</span>` : ""}
                </div>
                ${status.lastError ? `<p class="user-derived-status-error"><strong>Letzter Fehler:</strong> ${escapeHtml(status.lastError)}</p>` : ""}
            </article>
        `).join("");
    },

    async renderAccounts(accounts = []) {
        const items = Array.isArray(accounts) ? accounts : [];
        DOM.userAccountsCount.textContent = String(items.length);

        if (!items.length) {
            DOM.sidebarAccounts.innerHTML = renderEmptyState("Keine Accounts vorhanden.");
            return;
        }

        DOM.sidebarAccounts.innerHTML = items.map(account => {
            const system = state.systemMap?.[account.system_id]?.name || account.system_name || `System #${account.system_id}`;
            return `
                <div class="user-account-item">
                    <div class="user-account-main">
                        <span class="user-account-id">${escapeHtml(account.account_identifier || "-")}</span>
                        <span class="user-account-system">${escapeHtml(system)}</span>
                    </div>
                    <span class="users-status-badge users-status-active">${escapeHtml(humanizeToken(account.assignment_status || "active"))}</span>
                </div>
            `;
        }).join("");
    },

    renderRoles(detail) {
        const roles = getSortedRoleAssignments(detail);

        if (!roles.length) {
            DOM.sidebarRoles.innerHTML = renderEmptyState("Keine Rollen vorhanden.");
            return;
        }

        DOM.sidebarRoles.innerHTML = roles.map((role, index) => {
            const assignmentStatus = getAssignmentStatus(role);
            const roleTypeLabel = role.is_primary ? "Hauptrolle / Funktion" : (normalizeValue(role.role_type) === "secondary" ? "Nebenrolle" : humanizeToken(role.role_type || "Rolle"));
            const resources = Array.isArray(role.resources) ? role.resources : [];
            const bodyId = `role-body-${role.role_id}-${index}`;

            return `
                <article class="user-role-card">
                    <button type="button" class="user-role-toggle" data-role-toggle="${escapeHtml(bodyId)}" aria-expanded="${role.is_primary ? "true" : "false"}">
                        <div class="user-role-main">
                            <span class="user-role-title">${escapeHtml(role.name || `Rolle #${role.role_id}`)}</span>
                            <div class="user-role-subline">
                                <span class="ui-chip ${role.is_primary ? "ui-chip-primary" : "ui-chip-neutral"}">${escapeHtml(roleTypeLabel)}</span>
                                <span class="users-status-badge ${escapeHtml(assignmentStatus.className)}">${escapeHtml(assignmentStatus.label)}</span>
                                <span class="ui-chip ui-chip-neutral">${resources.length} Ressourcen</span>
                            </div>
                        </div>
                        <span class="user-role-chevron">›</span>
                    </button>
                    <div class="user-role-body" id="${escapeHtml(bodyId)}" ${role.is_primary ? "" : "hidden"}>
                        ${resources.length ? `
                            <div class="user-resource-list">
                                ${resources.map(resource => {
                                    const resourceStatus = getAssignmentStatus(resource);
                                    return `
                                        <div class="user-resource-row">
                                            <div class="user-resource-main">
                                                <span class="user-resource-identifier" title="${escapeHtml(getResourceDisplayName(resource))}">${escapeHtml(getResourceIdentifier(resource))}</span>
                                                <span class="user-resource-system">${escapeHtml(getSystemName(resource))}</span>
                                            </div>
                                            <span class="users-status-badge ${escapeHtml(resourceStatus.className)}">${escapeHtml(resourceStatus.label)}</span>
                                        </div>
                                    `;
                                }).join("")}
                            </div>
                        ` : renderEmptyState("Für diese Rolle sind keine Ressourcen vorhanden.")}
                    </div>
                </article>
            `;
        }).join("");

        DOM.sidebarRoles.querySelectorAll("[data-role-toggle]").forEach(button => {
            button.addEventListener("click", () => {
                const targetId = button.dataset.roleToggle;
                const body = document.getElementById(targetId);
                if (!body) {
                    return;
                }
                const isOpen = !body.hidden;
                body.hidden = isOpen;
                button.setAttribute("aria-expanded", String(!isOpen));
            });
        });
    },

    renderResources(detail) {
        const groups = groupResourcesBySystem(getUserResources(detail));

        if (!groups.length) {
            DOM.sidebarResources.innerHTML = renderEmptyState("Keine Ressourcen vorhanden.");
            return;
        }

        DOM.sidebarResources.innerHTML = groups.map(group => `
            <article class="ui-card user-resource-group">
                <div class="user-resource-group-header">
                    <h3>${escapeHtml(group.systemName)}</h3>
                    <span class="ui-chip ui-chip-neutral">${group.items.length}</span>
                </div>
                <div class="user-resource-list">
                    ${group.items.map(resource => {
                        const resourceStatus = getAssignmentStatus(resource);
                        return `
                            <div class="user-resource-row">
                                <div class="user-resource-main">
                                    <span class="user-resource-identifier" title="${escapeHtml(getResourceDisplayName(resource))}">${escapeHtml(getResourceIdentifier(resource))}</span>
                                    <span class="user-resource-system">${escapeHtml(getResourceDisplayName(resource))}</span>
                                </div>
                                <span class="users-status-badge ${escapeHtml(resourceStatus.className)}">${escapeHtml(resourceStatus.label)}</span>
                            </div>
                        `;
                    }).join("")}
                </div>
            </article>
        `).join("");
    },

    renderActivity(activity) {
        const affected = Array.isArray(activity?.affected_processes) ? activity.affected_processes : [];
        const initiated = Array.isArray(activity?.initiated_processes) ? activity.initiated_processes : [];
        const recent = Array.isArray(activity?.recent_task_actions) ? activity.recent_task_actions : [];

        DOM.affectedProcesses.innerHTML = this.renderProcessEntries(affected, "Keine Prozesse gefunden, die diesen User betreffen.");
        DOM.initiatedProcesses.innerHTML = this.renderProcessEntries(initiated, "Keine vom User ausgelösten Prozesse gefunden.");
        DOM.recentActions.innerHTML = this.renderTaskActions(recent, "Keine erledigten Task-Aktionen gefunden.");
    },

    renderProcessEntries(items, emptyMessage) {
        if (!items.length) {
            return renderEmptyState(emptyMessage);
        }

        return items.map(item => {
            const status = getAssignmentStatus({ assignment_status: item.status || item.process_status || "active" });
            const title = item.process_name || humanizeToken(item.process_type || "prozess");
            return `
                <div class="user-activity-entry">
                    <div class="user-activity-top">
                        <span class="user-activity-title">${escapeHtml(title)}${item.process_id ? ` · #${escapeHtml(item.process_id)}` : ""}</span>
                        <span class="users-status-badge ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
                    </div>
                    <div class="user-activity-meta">
                        <span><strong>Ziel:</strong> ${escapeHtml(item.target_name || item.target_user_name || "-")}</span>
                        <span><strong>Initiator:</strong> ${escapeHtml(item.initiator_name || item.triggered_by_name || "-")}</span>
                        <span><strong>Gestartet:</strong> ${escapeHtml(formatDateTime(item.started_at || item.created_at))}</span>
                        <span><strong>Abgeschlossen:</strong> ${escapeHtml(formatDateTime(item.completed_at || item.finished_at))}</span>
                    </div>
                </div>
            `;
        }).join("");
    },

    renderTaskActions(items, emptyMessage) {
        if (!items.length) {
            return renderEmptyState(emptyMessage);
        }

        return items.map(item => {
            const status = getAssignmentStatus({ assignment_status: item.status || item.action || "active" });
            const title = item.action_label || humanizeToken(item.action || "completed");
            return `
                <div class="user-activity-entry">
                    <div class="user-activity-top">
                        <span class="user-activity-title">${escapeHtml(title)}${item.task_id ? ` · Task #${escapeHtml(item.task_id)}` : ""}</span>
                        <span class="users-status-badge ${escapeHtml(status.className)}">${escapeHtml(status.label)}</span>
                    </div>
                    <div class="user-activity-meta">
                        <span><strong>Typ:</strong> ${escapeHtml(humanizeToken(item.task_type || "-"))}</span>
                        <span><strong>Ressource:</strong> ${escapeHtml(item.resource_name || "-")}</span>
                        <span><strong>Zeit:</strong> ${escapeHtml(formatDateTime(item.completed_at || item.created_at || item.occurred_at))}</span>
                    </div>
                </div>
            `;
        }).join("");
    },

    bindActions(user) {
        document.getElementById("sofa-access-setup-btn")?.addEventListener("click", () => {
            sofaAccessModalController.open(user, "setup");
        });
        document.getElementById("sofa-password-reset-btn")?.addEventListener("click", () => {
            sofaAccessModalController.open(user, "reset");
        });
        document.getElementById("sofa-access-revoke-btn")?.addEventListener("click", () => {
            sofaAccessModalController.open(user, "revoke");
        });
        if (DOM.primaryRoleChangeActionBtn) {
            DOM.primaryRoleChangeActionBtn.onclick = () => primaryRoleChangeModalController.open(user);
        }
        if (DOM.detailTrainingActionBtn) {
            DOM.detailTrainingActionBtn.onclick = () => trainingModalController.open({ presetUsers: [user], source: "detail" });
        }
        if (DOM.tmpRightsActionBtn) {
            DOM.tmpRightsActionBtn.onclick = () => tmpRightsModalController.open(user);
        }
        if (DOM.newSkillActionBtn) {
            DOM.newSkillActionBtn.onclick = () => newSkillModalController.open(user);
        }
        if (DOM.skillRevokeActionBtn) {
            DOM.skillRevokeActionBtn.onclick = () => skillRevokeModalController.open(user);
        }
        if (DOM.offboardActionBtn) {
            DOM.offboardActionBtn.onclick = () => offboardModalController.open(user);
        }
    }
};

function bindModalOverlayDismiss(overlayEl, closeFn) {
    overlayEl?.addEventListener("click", event => {
        if (event.target === overlayEl) {
            closeFn();
        }
    });
}

function buildButtonRow(primaryLabel, primaryClass = "btn-primary") {
    return `
        <div class="btn-row">
            <button type="button" class="btn ${primaryClass}" id="modal-submit-btn">${primaryLabel}</button>
            <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Abbrechen</button>
        </div>
    `;
}

const sofaAccessModalController = {
    init() {
        bindModalOverlayDismiss(DOM.sofaAccessOverlay, () => this.close());
        DOM.sofaAccessCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user, mode) {
        this.render(user, mode);
        openOverlay("sofa-access-overlay");
    },

    close() {
        closeOverlay("sofa-access-overlay");
        DOM.sofaAccessModalBody.innerHTML = "";
    },

    render(user, mode) {
        const titleMap = {
            setup: `SOFA Zugriff für ${user.first_name} ${user.last_name} einrichten`,
            reset: `SOFA Passwort für ${user.first_name} ${user.last_name} zurücksetzen`,
            revoke: `SOFA Zugriff für ${user.first_name} ${user.last_name} entziehen`
        };

        DOM.sofaAccessModalTitle.textContent = titleMap[mode];

        if (mode === "revoke") {
            DOM.sofaAccessModalBody.innerHTML = `
                <p class="user-action-note">Der Zugriff auf die SOFA Anwendung wird für diesen User entzogen.</p>
                ${buildButtonRow("Bestätigen", "btn-red")}
            `;
        } else {
            DOM.sofaAccessModalBody.innerHTML = `
                <div class="user-action-form">
                    <div class="ui-field-group">
                        <label class="ui-field-label" for="sofa-access-password-input">Passwort</label>
                        <input id="sofa-access-password-input" class="ui-input" type="password" placeholder="Passwort">
                    </div>
                    <div class="ui-field-group">
                        <label class="ui-field-label" for="sofa-access-password-confirm-input">Passwort bestätigen</label>
                        <input id="sofa-access-password-confirm-input" class="ui-input" type="password" placeholder="Passwort bestätigen">
                    </div>
                    ${buildButtonRow("Speichern")}
                </div>
            `;
        }

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            try {
                if (mode === "setup" || mode === "reset") {
                    const password = document.getElementById("sofa-access-password-input")?.value.trim() || "";
                    const passwordConfirm = document.getElementById("sofa-access-password-confirm-input")?.value.trim() || "";

                    if (!password || !passwordConfirm) {
                        showFlash("Bitte Passwort und Bestätigung ausfüllen", "failure");
                        return;
                    }

                    if (password !== passwordConfirm) {
                        showFlash("Die Passwörter stimmen nicht überein", "failure");
                        return;
                    }

                    if (mode === "setup") {
                        await api.setupSofaAccess(user.user_id, password);
                        showFlash("SOFA Zugriff eingerichtet", "success");
                    } else {
                        await api.resetSofaPassword(user.user_id, password);
                        showFlash("SOFA Passwort zurückgesetzt", "success");
                    }
                } else {
                    await api.revokeSofaAccess(user.user_id);
                    showFlash("SOFA Zugriff entzogen", "success");
                }

                await tableController.loadUsers();
                await sidebarController.refreshCurrentUser();
                this.close();
            } catch (err) {
                console.error(err);
                showFlash(err.message || "SOFA Aktion fehlgeschlagen", "failure");
            }
        });
    }
};

const onboardModalController = {
    init() {
        DOM.onboardActionBtn?.addEventListener("click", () => this.open());
        bindModalOverlayDismiss(DOM.onboardOverlay, () => this.close());
        DOM.onboardCloseBtn?.addEventListener("click", () => this.close());
        DOM.onboardInternBtn?.addEventListener("click", () => this.renderInternalForm());
        DOM.onboardExternalBtn?.addEventListener("click", () => this.renderExternalForm());
    },

    open() {
        this.renderStart();
        openOverlay("onboard-overlay");
    },

    close() {
        closeOverlay("onboard-overlay");
        this.renderStart();
    },

    renderStart() {
        DOM.onboardModalTitle.textContent = "Onboarding";
        DOM.onboardModalBody.innerHTML = `
            <div class="user-action-choice-grid">
                <button id="onboard-external-btn" class="btn btn-secondary">Extern</button>
                <button id="onboard-employee-btn" class="btn btn-primary">Mitarbeiter</button>
            </div>
        `;
        cacheDOM();
        DOM.onboardCloseBtn?.addEventListener("click", () => this.close());
        DOM.onboardInternBtn?.addEventListener("click", () => this.renderInternalForm());
        DOM.onboardExternalBtn?.addEventListener("click", () => this.renderExternalForm());
    },

    renderInternalForm() {
        DOM.onboardModalTitle.textContent = "Onboarding Mitarbeiter";
        DOM.onboardModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="personalnummer-input">Personalnummer</label>
                    <input id="personalnummer-input" class="ui-input" placeholder="Personalnummer">
                </div>
                <p class="user-action-note">Bitte sicherstellen, dass der Mitarbeiter bereits in Helix angelegt ist.</p>
                ${buildButtonRow("Weiter")}
            </div>
        `;

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const pnr = document.getElementById("personalnummer-input")?.value.trim();
            if (!pnr) {
                showFlash("Bitte Personalnummer eingeben", "failure");
                return;
            }

            const success = await api.startOnboarding(pnr);
            if (!success) {
                return;
            }
            await tableController.loadUsers();
            this.close();
        });
    },

    renderExternalForm() {
        DOM.onboardModalTitle.textContent = "Externes Onboarding";
        DOM.onboardModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="extern-vorname-input">Vorname</label>
                    <input id="extern-vorname-input" class="ui-input" placeholder="Vorname">
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="extern-nachname-input">Nachname</label>
                    <input id="extern-nachname-input" class="ui-input" placeholder="Nachname">
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="extern-email-input">E-Mail</label>
                    <input id="extern-email-input" class="ui-input" type="email" placeholder="E-Mail">
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="extern-telefon-input">Telefon</label>
                    <input id="extern-telefon-input" class="ui-input" type="tel" placeholder="Telefon">
                </div>
                ${buildButtonRow("Weiter")}
            </div>
        `;

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const payload = {
                vorname: document.getElementById("extern-vorname-input")?.value.trim(),
                nachname: document.getElementById("extern-nachname-input")?.value.trim(),
                email: document.getElementById("extern-email-input")?.value.trim(),
                telefon: document.getElementById("extern-telefon-input")?.value.trim()
            };

            if (!payload.vorname || !payload.nachname || !payload.email || !payload.telefon) {
                showFlash("Bitte alle Felder ausfüllen", "failure");
                return;
            }

            const success = await api.startExternalOnboarding(payload);
            if (!success) {
                return;
            }

            await tableController.loadUsers();
            this.close();
        });
    }
};

const trainingModalController = {
    state: {
        availableUsers: [],
        roleOptions: [],
        selectedUserIds: new Set(),
        selectedRoleIds: new Set(),
        scheduledFor: "",
        userSearchTerm: "",
        roleSearchTerm: "",
        source: "global"
    },

    init() {
        DOM.trainingActionBtn?.addEventListener("click", () => this.open({ source: "global" }));
        bindModalOverlayDismiss(DOM.trainingOverlay, () => this.close());
        DOM.trainingCloseBtn?.addEventListener("click", () => this.close());
    },

    async open(options = {}) {
        await api.getRoleMap();
        const availableUsers = this.resolveAvailableUsers(options);
        const presetUsers = Array.isArray(options.presetUsers) ? options.presetUsers : [];

        this.state = {
            availableUsers,
            roleOptions: this.getRoleOptions(),
            selectedUserIds: new Set(presetUsers.map(user => String(user?.user_id || "")).filter(Boolean)),
            selectedRoleIds: new Set(),
            scheduledFor: "",
            userSearchTerm: "",
            roleSearchTerm: "",
            source: options.source === "detail" ? "detail" : "global"
        };

        this.render();
        openOverlay("training-overlay");
    },

    close() {
        closeOverlay("training-overlay");
        DOM.trainingModalBody.innerHTML = "";
    },

    resolveAvailableUsers(options = {}) {
        const hasUserFilters = Boolean(
            normalizeValue(state.searchTerm) ||
            state.filters.primaryRoleIds.length ||
            state.filters.secondaryRoleIds.length ||
            state.filters.includeInactive
        );
        const baseUsers = hasUserFilters ? tableController.getFilteredUsers() : state.users;
        const presetUsers = Array.isArray(options.presetUsers) ? options.presetUsers : [];
        return sortUsersByName(mergeUsersById(baseUsers, presetUsers));
    },

    getRoleOptions() {
        return Object.entries(state.roleMap || {})
            .filter(([, role]) => role.type === "SECONDARY")
            .sort(([, left], [, right]) => String(left.name || "").localeCompare(String(right.name || ""), "de"))
            .map(([id, role]) => ({
                role_id: String(id),
                name: role.name || `Rolle #${id}`
            }));
    },

    getVisibleUsers() {
        const search = normalizeValue(this.state.userSearchTerm);
        if (!search) {
            return this.state.availableUsers;
        }

        return this.state.availableUsers.filter(user => {
            const haystacks = [
                user?.pnr,
                user?.racf,
                user?.email,
                user?.first_name,
                user?.last_name,
                user?.primary_role?.name
            ];
            return haystacks.some(value => normalizeValue(value).includes(search));
        });
    },

    getVisibleRoleOptions() {
        const search = normalizeValue(this.state.roleSearchTerm);
        if (!search) {
            return this.state.roleOptions;
        }
        return this.state.roleOptions.filter(role => normalizeValue(role.name).includes(search));
    },

    hasValidSelection() {
        return Boolean(
            this.state.selectedUserIds.size &&
            this.state.selectedRoleIds.size &&
            this.state.scheduledFor
        );
    },

    renderSummaryChips(items, emptyLabel) {
        if (!items.length) {
            return `<span class="ui-chip ui-chip-neutral">${escapeHtml(emptyLabel)}</span>`;
        }

        return items.map(item => `
            <span class="ui-chip ui-chip-neutral">${escapeHtml(item)}</span>
        `).join("");
    },

    render() {
        const visibleUsers = this.getVisibleUsers();
        const visibleRoles = this.getVisibleRoleOptions();
        const selectedUsers = this.state.availableUsers.filter(user => this.state.selectedUserIds.has(String(user.user_id)));
        const selectedRoles = this.state.roleOptions.filter(role => this.state.selectedRoleIds.has(String(role.role_id)));
        const isDetailContext = this.state.source === "detail";

        DOM.trainingModalTitle.textContent = isDetailContext ? "Schulung planen für User" : "Schulung planen";
        DOM.trainingModalBody.innerHTML = `
            <div class="training-modal-grid">
                <section class="training-panel">
                    <div class="training-panel-header">
                        <h4 class="training-panel-title">User auswählen</h4>
                        <span class="training-selection-count">${escapeHtml(this.state.selectedUserIds.size)}</span>
                    </div>
                    <input
                        type="search"
                        id="training-user-search"
                        class="ui-input training-selection-search"
                        placeholder="Suche nach PNR, RACF, Name oder Funktion"
                        value="${escapeHtml(this.state.userSearchTerm)}"
                    >
                    <div class="training-selection-list">
                        ${visibleUsers.length ? visibleUsers.map(user => `
                            <label class="training-selection-item">
                                <input
                                    type="checkbox"
                                    data-training-user-id="${escapeHtml(user.user_id)}"
                                    ${this.state.selectedUserIds.has(String(user.user_id)) ? "checked" : ""}
                                >
                                <span class="training-selection-main">
                                    <span class="training-selection-title">${escapeHtml(buildUserLabel(user))}</span>
                                    <span class="training-selection-meta">${escapeHtml(buildUserSelectionMeta(user) || "Keine Zusatzinformationen")}</span>
                                </span>
                            </label>
                        `).join("") : renderEmptyState("Keine User für die aktuelle Auswahl gefunden.")}
                    </div>
                </section>

                <section class="training-panel">
                    <div class="training-panel-header">
                        <h4 class="training-panel-title">Nebenrollen auswählen</h4>
                        <span class="training-selection-count">${escapeHtml(this.state.selectedRoleIds.size)}</span>
                    </div>
                    <input
                        type="search"
                        id="training-role-search"
                        class="ui-input training-selection-search"
                        placeholder="Suche nach Nebenrolle"
                        value="${escapeHtml(this.state.roleSearchTerm)}"
                    >
                    <div class="training-selection-list">
                        ${visibleRoles.length ? visibleRoles.map(role => `
                            <label class="training-selection-item">
                                <input
                                    type="checkbox"
                                    data-training-role-id="${escapeHtml(role.role_id)}"
                                    ${this.state.selectedRoleIds.has(String(role.role_id)) ? "checked" : ""}
                                >
                                <span class="training-selection-main">
                                    <span class="training-selection-title">${escapeHtml(role.name)}</span>
                                    <span class="training-selection-meta">Nebenrolle aus der zentralen Rollenliste</span>
                                </span>
                            </label>
                        `).join("") : renderEmptyState("Keine Nebenrollen für die Suche gefunden.")}
                    </div>
                </section>
            </div>

            <div class="training-modal-footer">
                <div class="training-panel">
                    <div class="ui-field-group">
                        <label class="ui-field-label" for="training-date-input">Schulungsdatum</label>
                        <input
                            type="date"
                            id="training-date-input"
                            class="ui-input"
                            min="${new Date().toISOString().split("T")[0]}"
                            value="${escapeHtml(this.state.scheduledFor)}"
                        >
                    </div>
                    <div class="training-selection-summary">
                        ${this.renderSummaryChips(selectedUsers.map(buildUserLabel), "Keine User ausgewählt")}
                        ${this.renderSummaryChips(selectedRoles.map(role => role.name), "Keine Nebenrollen ausgewählt")}
                    </div>
                </div>
                <p class="training-submit-note">Der Prozess wird bereits über den finalen BFF-Endpunkt ausgelöst. Solange das Backend noch fehlt, bleibt der Dialog nach dem 501-Hinweis geöffnet.</p>
                <div class="btn-row">
                    <button type="button" class="btn btn-primary" id="training-submit-btn" ${this.hasValidSelection() ? "" : "disabled"}>Schulung planen</button>
                    <button type="button" class="btn btn-secondary" id="training-cancel-btn">Abbrechen</button>
                </div>
            </div>
        `;

        this.bindEvents();
    },

    bindEvents() {
        document.getElementById("training-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("training-user-search")?.addEventListener("input", event => {
            this.state.userSearchTerm = event.target.value || "";
            this.render();
        });
        document.getElementById("training-role-search")?.addEventListener("input", event => {
            this.state.roleSearchTerm = event.target.value || "";
            this.render();
        });
        document.getElementById("training-date-input")?.addEventListener("change", event => {
            this.state.scheduledFor = event.target.value || "";
            this.render();
        });

        DOM.trainingModalBody.querySelectorAll("[data-training-user-id]").forEach(input => {
            input.addEventListener("change", event => {
                const userId = String(event.target.dataset.trainingUserId || "");
                if (!userId) {
                    return;
                }
                if (event.target.checked) {
                    this.state.selectedUserIds.add(userId);
                } else {
                    this.state.selectedUserIds.delete(userId);
                }
                this.render();
            });
        });

        DOM.trainingModalBody.querySelectorAll("[data-training-role-id]").forEach(input => {
            input.addEventListener("change", event => {
                const roleId = String(event.target.dataset.trainingRoleId || "");
                if (!roleId) {
                    return;
                }
                if (event.target.checked) {
                    this.state.selectedRoleIds.add(roleId);
                } else {
                    this.state.selectedRoleIds.delete(roleId);
                }
                this.render();
            });
        });

        document.getElementById("training-submit-btn")?.addEventListener("click", async () => {
            if (!this.state.selectedUserIds.size || !this.state.selectedRoleIds.size || !this.state.scheduledFor) {
                showFlash("Bitte mindestens einen User, eine Nebenrolle und ein Schulungsdatum auswählen", "failure");
                return;
            }

            const payload = {
                user_ids: Array.from(this.state.selectedUserIds, value => Number(value)).filter(Number.isFinite),
                role_ids: Array.from(this.state.selectedRoleIds, value => Number(value)).filter(Number.isFinite),
                scheduled_for: this.state.scheduledFor
            };

            const success = await api.startTrainingSchedule(payload);
            if (!success) {
                return;
            }

            this.close();
        });
    }
};

const tmpRightsModalController = {
    init() {
        bindModalOverlayDismiss(DOM.tmpRightsOverlay, () => this.close());
        DOM.tmpRightsCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user) {
        this.render(user);
        openOverlay("tmp-rights-overlay");
    },

    close() {
        closeOverlay("tmp-rights-overlay");
        DOM.tmpRightsModalBody.innerHTML = "";
    },

    async render(user) {
        DOM.tmpRightsModalTitle.textContent = `Temporäre Rolle für ${user.first_name} ${user.last_name}`;
        DOM.tmpRightsModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="tmp-role-select">Rolle</label>
                    <select id="tmp-role-select" class="ui-input">
                        <option value="" disabled selected>Rolle auswählen…</option>
                    </select>
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="tmp-startdate">Ab wann (optional)</label>
                    <input type="date" id="tmp-startdate" class="ui-input">
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="tmp-enddate">Enddatum</label>
                    <input type="date" id="tmp-enddate" class="ui-input" min="${new Date().toISOString().split("T")[0]}">
                </div>
                ${buildButtonRow("Beantragen")}
            </div>
        `;

        const select = document.getElementById("tmp-role-select");
        const blockedRoleIds = getBlockedRoleIdsForSelection(user, "secondary");
        Object.entries(await api.getRoleMap())
            .filter(([, role]) => role.type === "SECONDARY")
            .filter(([roleId]) => !blockedRoleIds.has(String(roleId)))
            .sort(([, left], [, right]) => String(left.name || "").localeCompare(String(right.name || ""), "de"))
            .forEach(([id, role]) => {
                const option = document.createElement("option");
                option.value = id;
                option.textContent = role.name;
                select.appendChild(option);
            });

        if (select.options.length <= 1) {
            DOM.tmpRightsModalBody.innerHTML = `
                <div class="user-action-form">
                    <p class="user-action-note">Es sind keine beantragbaren Nebenrollen verfügbar.</p>
                    <div class="btn-row">
                        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Schließen</button>
                    </div>
                </div>
            `;
            document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
            return;
        }

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const roleId = document.getElementById("tmp-role-select")?.value;
            const startdate = document.getElementById("tmp-startdate")?.value || null;
            const enddate = document.getElementById("tmp-enddate")?.value;

            if (!roleId || !enddate) {
                showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
                return;
            }

            const payload = {
                user_id: user.user_id,
                role_id: roleId,
                enddate
            };

            if (startdate) {
                payload.startdate = startdate;
            }

            const success = await api.startTmpRoleAssignment(payload);

            if (!success) {
                return;
            }

            await sidebarController.refreshCurrentUser();
            this.close();
        });
    }
};

const newSkillModalController = {
    init() {
        bindModalOverlayDismiss(DOM.newSkillOverlay, () => this.close());
        DOM.newSkillCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user) {
        this.render(user);
        openOverlay("new-skill-overlay");
    },

    close() {
        closeOverlay("new-skill-overlay");
        DOM.newSkillModalBody.innerHTML = "";
    },

    async render(user) {
        DOM.newSkillModalTitle.textContent = `Neue Rolle für ${user.first_name} ${user.last_name}`;
        DOM.newSkillModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="new-skill-select">Rolle</label>
                    <select id="new-skill-select" class="ui-input">
                        <option value="" disabled selected>Rolle auswählen…</option>
                    </select>
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="new-skill-startdate">Ab wann (optional)</label>
                    <input type="date" id="new-skill-startdate" class="ui-input">
                </div>
                ${buildButtonRow("Beantragen")}
            </div>
        `;

        const select = document.getElementById("new-skill-select");
        const blockedRoleIds = getBlockedRoleIdsForSelection(user, "secondary");
        Object.entries(await api.getRoleMap())
            .filter(([, role]) => role.type === "SECONDARY")
            .filter(([roleId]) => !blockedRoleIds.has(String(roleId)))
            .sort(([, left], [, right]) => String(left.name || "").localeCompare(String(right.name || ""), "de"))
            .forEach(([id, role]) => {
                const option = document.createElement("option");
                option.value = id;
                option.textContent = role.name;
                select.appendChild(option);
            });

        if (select.options.length <= 1) {
            DOM.newSkillModalBody.innerHTML = `
                <div class="user-action-form">
                    <p class="user-action-note">Es sind keine beantragbaren Nebenrollen verfügbar.</p>
                    <div class="btn-row">
                        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Schließen</button>
                    </div>
                </div>
            `;
            document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
            return;
        }

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const roleId = document.getElementById("new-skill-select")?.value;
            const startDate = document.getElementById("new-skill-startdate")?.value || null;

            if (!roleId) {
                showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
                return;
            }

            const payload = {
                user_id: user.user_id,
                role_id: roleId
            };

            if (startDate) {
                payload.start_date = startDate;
            }

            const success = await api.startNewSkillAssignment(payload);

            if (!success) {
                return;
            }

            await sidebarController.refreshCurrentUser();
            this.close();
        });
    }
};

const primaryRoleChangeModalController = {
    init() {
        bindModalOverlayDismiss(DOM.primaryRoleChangeOverlay, () => this.close());
        DOM.primaryRoleChangeCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user) {
        this.renderSelection(user);
        openOverlay("primary-role-change-overlay");
    },

    close() {
        closeOverlay("primary-role-change-overlay");
        DOM.primaryRoleChangeModalBody.innerHTML = "";
    },

    async renderSelection(user) {
        DOM.primaryRoleChangeModalTitle.textContent = `Wechsel der Hauptrolle für ${user.first_name} ${user.last_name}`;
        DOM.primaryRoleChangeModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="primary-role-change-select">Neue Hauptrolle</label>
                    <select id="primary-role-change-select" class="ui-input">
                        <option value="" disabled selected>Hauptrolle auswählen…</option>
                    </select>
                </div>
                ${buildButtonRow("Weiter")}
            </div>
        `;

        const select = document.getElementById("primary-role-change-select");
        const blockedRoleIds = getBlockedRoleIdsForSelection(user, "primary");

        Object.entries(await api.getRoleMap())
            .filter(([, role]) => role.type === "PRIMARY")
            .filter(([roleId]) => !blockedRoleIds.has(String(roleId)))
            .sort(([, left], [, right]) => String(left.name || "").localeCompare(String(right.name || ""), "de"))
            .forEach(([id, role]) => {
                const option = document.createElement("option");
                option.value = id;
                option.textContent = role.name;
                select.appendChild(option);
            });

        if (select.options.length <= 1) {
            DOM.primaryRoleChangeModalBody.innerHTML = `
                <div class="user-action-form">
                    <p class="user-action-note">Es sind keine nicht zugewiesenen Hauptrollen verfügbar.</p>
                    <div class="btn-row">
                        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Schließen</button>
                    </div>
                </div>
            `;
            document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
            return;
        }

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", () => {
            const roleId = document.getElementById("primary-role-change-select")?.value;

            if (!roleId) {
                showFlash("Bitte eine Hauptrolle auswählen", "failure");
                return;
            }

            const roleName = state.roleMap?.[roleId]?.name || `Rolle #${roleId}`;
            this.renderConfirmation(user, roleId, roleName);
        });
    },

    renderConfirmation(user, roleId, roleName) {
        const currentRoleName = user.primary_role?.name || "die aktuelle Funktion";
        DOM.primaryRoleChangeModalTitle.textContent = `Wechsel der Hauptrolle für ${user.first_name} ${user.last_name}`;
        DOM.primaryRoleChangeModalBody.innerHTML = `
            <div class="user-action-form">
                <p class="user-action-note">
                    Die bestehende Funktion <strong>${escapeHtml(currentRoleName)}</strong> wird entzogen und durch
                    <strong>${escapeHtml(roleName)}</strong> ersetzt.
                </p>
                <p class="user-action-note">Bitte den Wechsel der Hauptrolle noch einmal ausdrücklich bestätigen.</p>
                ${buildButtonRow("Bestätigen", "btn-red")}
            </div>
        `;

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.renderSelection(user));
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const success = await api.startPrimaryRoleChange({
                user_id: user.user_id,
                role_id: roleId
            });

            if (!success) {
                return;
            }

            await sidebarController.refreshCurrentUser();
            this.close();
        });
    }
};

const skillRevokeModalController = {
    init() {
        bindModalOverlayDismiss(DOM.skillRevokeOverlay, () => this.close());
        DOM.skillRevokeCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user) {
        this.render(user);
        openOverlay("skill-revoke-overlay");
    },

    close() {
        closeOverlay("skill-revoke-overlay");
        DOM.skillRevokeModalBody.innerHTML = "";
    },

    render(user) {
        DOM.skillRevokeModalTitle.textContent = `Rolle entziehen für ${user.first_name} ${user.last_name}`;
        DOM.skillRevokeModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="skill-revoke-select">Rolle</label>
                    <select id="skill-revoke-select" class="ui-input">
                        <option value="" disabled selected>Rolle auswählen…</option>
                    </select>
                </div>
                <div class="ui-field-group">
                    <label class="ui-field-label" for="skill-revoke-startdate">Ab wann (optional)</label>
                    <input type="date" id="skill-revoke-startdate" class="ui-input">
                </div>
                ${buildButtonRow("Beantragen")}
            </div>
        `;

        const select = document.getElementById("skill-revoke-select");
        getSecondaryRoles(user)
            .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "de"))
            .forEach(role => {
                const option = document.createElement("option");
                option.value = role.role_id;
                option.textContent = role.name;
                select.appendChild(option);
            });

        if (select.options.length <= 1) {
            DOM.skillRevokeModalBody.innerHTML = `
                <div class="user-action-form">
                    <p class="user-action-note">Es sind keine aktiv zugewiesenen Nebenrollen verfügbar.</p>
                    <div class="btn-row">
                        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Schließen</button>
                    </div>
                </div>
            `;
            document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
            return;
        }

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const roleId = document.getElementById("skill-revoke-select")?.value;
            const startDate = document.getElementById("skill-revoke-startdate")?.value || null;

            if (!roleId) {
                showFlash("Bitte alle Pflichtfelder ausfüllen", "failure");
                return;
            }

            const payload = {
                user_id: user.user_id,
                role_id: roleId
            };

            if (startDate) {
                payload.start_date = startDate;
            }

            const success = await api.startSkillRevoke(payload);

            if (!success) {
                return;
            }

            await sidebarController.refreshCurrentUser();
            this.close();
        });
    }
};

const offboardModalController = {
    init() {
        bindModalOverlayDismiss(DOM.offboardOverlay, () => this.close());
        DOM.offboardCloseBtn?.addEventListener("click", () => this.close());
    },

    open(user) {
        this.render(user);
        openOverlay("offboard-overlay");
    },

    close() {
        closeOverlay("offboard-overlay");
        DOM.offboardModalBody.innerHTML = "";
    },

    render(user) {
        DOM.offboardModalTitle.textContent = `Offboarding von ${user.first_name} ${user.last_name}`;
        DOM.offboardModalBody.innerHTML = `
            <div class="user-action-form">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="offboard-exitdate">Austritt am</label>
                    <input type="date" id="offboard-exitdate" class="ui-input" min="${new Date().toISOString().split("T")[0]}">
                </div>
                ${buildButtonRow("Bestätigen")}
            </div>
        `;

        document.getElementById("modal-cancel-btn")?.addEventListener("click", () => this.close());
        document.getElementById("modal-submit-btn")?.addEventListener("click", async () => {
            const exitdate = document.getElementById("offboard-exitdate")?.value;

            if (!exitdate) {
                showFlash("Bitte das Austrittsdatum angeben", "failure");
                return;
            }

            const success = await api.startOffboarding({
                user_id: user.user_id,
                exitdate
            });

            if (!success) {
                return;
            }

            await sidebarController.refreshCurrentUser();
            this.close();
        });
    }
};

function cacheDOM() {
    DOM.filterContainer = document.getElementById("users-filter-container");
    DOM.filterBtn = document.getElementById("filter-btn");
    DOM.filterDropdown = document.getElementById("filter-dropdown");
    DOM.subfilterDropdown = document.getElementById("subfilter-dropdown");
    DOM.activeFilters = document.getElementById("active-filters");
    DOM.searchInput = document.getElementById("search-input");
    DOM.userTable = document.getElementById("user-table");
    DOM.tableBody = document.getElementById("user-table-body");

    DOM.sidebarOverlay = document.getElementById("sidebar-overlay");
    DOM.sidebarCloseBtn = document.getElementById("sidebar-close-btn");
    DOM.userPanelTabs = document.getElementById("user-panel-tabs");
    DOM.userPanelTabButtons = document.querySelectorAll(".user-panel-tab");
    DOM.userPanelViews = document.querySelectorAll(".user-panel-view");
    DOM.sidebarUsername = document.getElementById("sidebar-username");
    DOM.sidebarSubtitle = document.getElementById("sidebar-subtitle");
    DOM.sidebarPnrChip = document.getElementById("sidebar-pnr-chip");
    DOM.sidebarRacfChip = document.getElementById("sidebar-racf-chip");
    DOM.sidebarStatusChip = document.getElementById("sidebar-status-chip");

    DOM.sidebarPNR = document.getElementById("user-pnr");
    DOM.sidebarRacf = document.getElementById("user-racf");
    DOM.sidebarLastName = document.getElementById("user-nachname");
    DOM.sidebarFirstName = document.getElementById("user-vorname");
    DOM.sidebarFunktion = document.getElementById("user-funktion");
    DOM.sidebarEmail = document.getElementById("user-email");
    DOM.sidebarTelefon = document.getElementById("user-telefon");
    DOM.sidebarMobil = document.getElementById("user-mobil");
    DOM.sidebarEintritt = document.getElementById("user-eintritt");
    DOM.sidebarAustritt = document.getElementById("user-austritt");
    DOM.userHelixLink = document.getElementById("user-helix-link");
    DOM.sidebarAccounts = document.getElementById("user-accounts-list");
    DOM.userAccountsCount = document.getElementById("user-accounts-count");
    DOM.userDerivedStatusList = document.getElementById("user-derived-status-list");
    DOM.userDerivedStatusCount = document.getElementById("user-derived-status-count");
    DOM.sofaAccessStatus = document.getElementById("sofa-access-status");
    DOM.sofaAccessActions = document.getElementById("sofa-access-actions");
    DOM.offboardActionBtn = document.getElementById("offboard-action-btn");
    DOM.primaryRoleChangeActionBtn = document.getElementById("primary-role-change-action-btn");
    DOM.detailTrainingActionBtn = document.getElementById("detail-training-action-btn");
    DOM.newSkillActionBtn = document.getElementById("new-skill-action-btn");
    DOM.tmpRightsActionBtn = document.getElementById("tmp-rights-action-btn");
    DOM.skillRevokeActionBtn = document.getElementById("skill-revoke-action-btn");
    DOM.sidebarRoles = document.getElementById("user-roles-list");
    DOM.sidebarResources = document.getElementById("user-resources-list");
    DOM.affectedProcesses = document.getElementById("user-affected-processes");
    DOM.initiatedProcesses = document.getElementById("user-initiated-processes");
    DOM.recentActions = document.getElementById("user-recent-actions");

    DOM.onboardActionBtn = document.getElementById("onboard-action-btn");
    DOM.onboardOverlay = document.getElementById("onboard-overlay");
    DOM.onboardModal = document.getElementById("onboard-modal");
    DOM.onboardModalTitle = DOM.onboardModal?.querySelector(".ui-section-title");
    DOM.onboardModalBody = DOM.onboardModal?.querySelector(".ui-modal-body");
    DOM.onboardCloseBtn = document.getElementById("onboard-close-btn");
    DOM.onboardInternBtn = document.getElementById("onboard-employee-btn");
    DOM.onboardExternalBtn = document.getElementById("onboard-external-btn");

    DOM.trainingActionBtn = document.getElementById("training-action-btn");
    DOM.trainingOverlay = document.getElementById("training-overlay");
    DOM.trainingModal = document.getElementById("training-modal");
    DOM.trainingModalTitle = DOM.trainingModal?.querySelector(".ui-section-title");
    DOM.trainingModalBody = DOM.trainingModal?.querySelector(".ui-modal-body");
    DOM.trainingCloseBtn = document.getElementById("training-close-btn");

    DOM.tmpRightsOverlay = document.getElementById("tmp-rights-overlay");
    DOM.tmpRightsModal = document.getElementById("tmp-rights-modal");
    DOM.tmpRightsModalTitle = DOM.tmpRightsModal?.querySelector(".ui-section-title");
    DOM.tmpRightsModalBody = DOM.tmpRightsModal?.querySelector(".ui-modal-body");
    DOM.tmpRightsCloseBtn = document.getElementById("tmp-rights-close-btn");

    DOM.newSkillOverlay = document.getElementById("new-skill-overlay");
    DOM.newSkillModal = document.getElementById("new-skill-modal");
    DOM.newSkillModalTitle = DOM.newSkillModal?.querySelector(".ui-section-title");
    DOM.newSkillModalBody = DOM.newSkillModal?.querySelector(".ui-modal-body");
    DOM.newSkillCloseBtn = document.getElementById("new-skill-close-btn");

    DOM.primaryRoleChangeOverlay = document.getElementById("primary-role-change-overlay");
    DOM.primaryRoleChangeModal = document.getElementById("primary-role-change-modal");
    DOM.primaryRoleChangeModalTitle = DOM.primaryRoleChangeModal?.querySelector(".ui-section-title");
    DOM.primaryRoleChangeModalBody = DOM.primaryRoleChangeModal?.querySelector(".ui-modal-body");
    DOM.primaryRoleChangeCloseBtn = document.getElementById("primary-role-change-close-btn");

    DOM.skillRevokeOverlay = document.getElementById("skill-revoke-overlay");
    DOM.skillRevokeModal = document.getElementById("skill-revoke-modal");
    DOM.skillRevokeModalTitle = DOM.skillRevokeModal?.querySelector(".ui-section-title");
    DOM.skillRevokeModalBody = DOM.skillRevokeModal?.querySelector(".ui-modal-body");
    DOM.skillRevokeCloseBtn = document.getElementById("skill-revoke-close-btn");

    DOM.offboardOverlay = document.getElementById("offboard-overlay");
    DOM.offboardModal = document.getElementById("offboard-modal");
    DOM.offboardModalTitle = DOM.offboardModal?.querySelector(".ui-section-title");
    DOM.offboardModalBody = DOM.offboardModal?.querySelector(".ui-modal-body");
    DOM.offboardCloseBtn = document.getElementById("offboard-close-btn");

    DOM.sofaAccessOverlay = document.getElementById("sofa-access-overlay");
    DOM.sofaAccessModal = document.getElementById("sofa-access-modal");
    DOM.sofaAccessModalTitle = DOM.sofaAccessModal?.querySelector(".ui-section-title");
    DOM.sofaAccessModalBody = DOM.sofaAccessModal?.querySelector(".ui-modal-body");
    DOM.sofaAccessCloseBtn = document.getElementById("sofa-access-close-btn");
}

document.addEventListener("DOMContentLoaded", async () => {
    cacheDOM();
    sidebarController.init();
    await filterController.init();
    await tableController.init();
    onboardModalController.init();
    trainingModalController.init();
    sofaAccessModalController.init();
    tmpRightsModalController.init();
    newSkillModalController.init();
    primaryRoleChangeModalController.init();
    skillRevokeModalController.init();
    offboardModalController.init();
});
