const SEGMENT_COUNT = 50;

const queueManagerState = {
    queues: [],
    sortBy: "name",
    hiddenQueueIds: new Set(),
    modal: {
        open: false,
        queueId: "",
        queueName: "",
        members: [],
        joinedStaged: [],
        unjoinedStaged: [],
        originalJoinedIds: new Set(),
        joinedFilter: "",
        unjoinedFilter: "",
        saving: false,
        pinnedTier: null,
    },
    loadingFlags: {
        queues: false,
        members: false,
    },
};

const queueManagerDom = {};
const queueManagerColumns = new Map();

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeText(value) {
    return String(value ?? "").trim();
}

function normalizeLower(value) {
    return normalizeText(value).toLowerCase();
}

function buildUserDisplayName(user) {
    return normalizeText(user?.name) || normalizeText(user?.user_id) || "Unbekannt";
}

function getMemberApiId(member) {
    return normalizeText(member?.user_id || member?.id);
}

function getQueueId(queue) {
    return normalizeText(queue?.queue_id || queue?.id);
}

function stripQueueNamePrefix(name) {
    return normalizeText(name).replace(/^\[(?:PROD|INT)\]_/i, "");
}

function normalizeQueueListResponse(payload) {
    const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.queues) ? payload.queues : []);
    return list.map(queue => ({
        ...queue,
        queue_name: stripQueueNamePrefix(queue.name),
        member_count:         Number(queue.member_count)         || 0,
        joined_member_count:  Number(queue.joined_member_count)  || 0,
        active_users:         Number(queue.active_users)         || 0,
        presence_available:   Number(queue.presence_available)   || 0,
        on_queue_idle:        Number(queue.on_queue_idle)        || 0,
        on_queue_interacting: Number(queue.on_queue_interacting) || 0,
        presence_offline:     Number(queue.presence_offline)     || 0,
    }));
}

function normalizeMembersResponse(payload) {
    return Array.isArray(payload) ? payload : (Array.isArray(payload?.members) ? payload.members : []);
}

// ── Presence helpers ──────────────────────────────────────────────────────────

function presenceTier(member) {
    const sp = normalizeLower(member?.presence?.system_presence);
    const rs = normalizeText(member?.routing_status).toUpperCase();
    if (!member?.presence || sp === "" || sp === "offline") return 4;
    if (sp === "on queue") {
        if (rs === "INTERACTING" || rs === "COMMUNICATING") return 2;
        return 1;
    }
    if (sp === "available") return 0;
    return 3;
}

function presenceTierClass(tier) {
    return (
        ["qm-presence-active", "qm-presence-idle", "qm-presence-interacting", "qm-presence-busy", "qm-presence-inactive"][tier]
        ?? "qm-presence-busy"
    );
}

function presenceLabel(member) {
    const sp = normalizeLower(member?.presence?.system_presence);
    const rs = normalizeText(member?.routing_status).toUpperCase();
    if (!member?.presence || sp === "" || sp === "offline") return "Offline";
    if (sp === "on queue") {
        if (rs === "INTERACTING" || rs === "COMMUNICATING") return "Im Call";
        return "In Warteschleife";
    }
    const spLabels = {
        available: "Online",
        break:     "In Pause",
        meal:      "In Kurzpause",
        training:  "In Schulung",
        busy:      "Beschäftigt",
    };
    return spLabels[sp] || sp || "Offline";
}

function sortByPresenceThenName(members) {
    const pinned = queueManagerState.modal.pinnedTier;
    return [...members].sort((a, b) => {
        const ta = presenceTier(a), tb = presenceTier(b);
        if (pinned !== null) {
            const pa = ta === pinned ? 0 : 1;
            const pb = tb === pinned ? 0 : 1;
            if (pa !== pb) return pa - pb;
        }
        return ta !== tb ? ta - tb : buildUserDisplayName(a).localeCompare(buildUserDisplayName(b), "de");
    });
}

function buildPresenceSummaryHtml(members) {
    const counts = [0, 0, 0, 0, 0];
    for (const m of members) {
        counts[presenceTier(m)]++;
    }
    const labels = ["Online", "In Warteschleife", "Im Call", "Beschäftigt / Pause", "Offline"];
    const pinnedTier = queueManagerState.modal.pinnedTier;
    const chips = counts
        .map((count, tier) => count > 0
            ? `<button type="button" class="qm-presence-chip ${presenceTierClass(tier)}${pinnedTier === tier ? " is-active" : ""}" data-tier="${tier}">${count} ${labels[tier]}</button>`
            : "")
        .join("");
    return chips ? `<div class="qm-presence-summary">${chips}</div>` : "";
}

// ── API ───────────────────────────────────────────────────────────────────────

const queueManagerApi = {
    async requestJson(url, options = {}) {
        const response = await fetch(url, options);
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const message = typeof payload === "string"
                ? payload
                : payload?.detail || payload?.error || payload?.message || "Die Anfrage konnte nicht verarbeitet werden.";
            throw new Error(typeof message === "string" ? message : JSON.stringify(message));
        }

        return payload;
    },

    listQueues() {
        return this.requestJson("/api/q-manager/queues/all");
    },

    listQueuesOverview() {
        return this.requestJson("/api/q-manager/queues/overview");
    },

    listQueueMembers(queueId) {
        return this.requestJson(`/api/q-manager/queues/${encodeURIComponent(queueId)}/members`);
    },

    patchQueueMembers(queueId, payload) {
        return this.requestJson(`/api/q-manager/queues/${encodeURIComponent(queueId)}/members`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
};

// ── DOM cache ─────────────────────────────────────────────────────────────────

function cacheDom() {
    queueManagerDom.globalStatus = document.getElementById("globalStatus");

    queueManagerDom.kpiQueueCount = document.getElementById("qmKpiQueueCount");
    queueManagerDom.kpiTotalMembers = document.getElementById("qmKpiTotalMembers");
    queueManagerDom.kpiActiveMembers = document.getElementById("qmKpiActiveMembers");
    queueManagerDom.kpiMaxQueue = document.getElementById("qmKpiMaxQueue");

    queueManagerDom.queueFilter = document.getElementById("qmQueueFilter");
    queueManagerDom.sortSelect    = document.getElementById("qmSortSelect");
    queueManagerDom.refreshButton = document.getElementById("qmRefreshButton");
    queueManagerDom.lastUpdated   = document.getElementById("qmLastUpdated");

    queueManagerDom.equalizer = document.getElementById("qmEqualizer");

    queueManagerDom.modal = document.getElementById("qmQueueModal");
    queueManagerDom.modalTitle = document.getElementById("qmModalTitle");
    queueManagerDom.modalQueueId = document.getElementById("qmModalQueueId");
    queueManagerDom.modalCloseBtn = document.getElementById("qmModalCloseBtn");

    queueManagerDom.presenceSummary = document.getElementById("qmPresenceSummary");

    queueManagerDom.joinedCount = document.getElementById("qmJoinedCount");
    queueManagerDom.unjoinedCount = document.getElementById("qmUnjoinedCount");
    queueManagerDom.joinedFilter = document.getElementById("qmJoinedFilter");
    queueManagerDom.unjoinedFilter = document.getElementById("qmUnjoinedFilter");
    queueManagerDom.joinedList = document.getElementById("qmJoinedList");
    queueManagerDom.unjoinedList = document.getElementById("qmUnjoinedList");

    queueManagerDom.pendingChanges = document.getElementById("qmPendingChanges");
    queueManagerDom.modalFooterStatus = document.getElementById("qmModalFooterStatus");
    queueManagerDom.discardButton = document.getElementById("qmDiscardButton");
    queueManagerDom.saveButton = document.getElementById("qmSaveButton");
}

// ── Status helper ─────────────────────────────────────────────────────────────

function setStatus(element, kind, message) {
    if (!element) return;
    element.textContent = message;
    element.classList.remove("queue-manager-status-info", "queue-manager-status-success", "queue-manager-status-error");
    element.classList.add(`queue-manager-status-${kind}`);
}

// ── Equalizer ─────────────────────────────────────────────────────────────────

function sortQueues(queues) {
    const sortBy = queueManagerState.sortBy;
    return [...queues].sort((a, b) => {
        if (sortBy === "member_count")
            return (b.member_count || 0) - (a.member_count || 0);
        if (sortBy === "joined")
            return (b.joined_member_count || 0) - (a.joined_member_count || 0);
        if (sortBy === "present") {
            const ap = Math.max(0, (a.joined_member_count || 0) - (a.presence_offline || 0));
            const bp = Math.max(0, (b.joined_member_count || 0) - (b.presence_offline || 0));
            return bp - ap;
        }
        return (a.queue_name || "").localeCompare(b.queue_name || "", "de");
    });
}

function buildSegments(presAvail, onIdle, onInter, otherRed, segmentCount) {
    const fills = [
        { count: presAvail, cls: "is-filled-green"  },
        { count: onIdle,    cls: "is-filled-blue"   },
        { count: onInter,   cls: "is-filled-orange" },
        { count: otherRed,  cls: "is-filled-red"    },
    ];
    const slots = [];
    for (const { count, cls } of fills) {
        const n = Math.min(count, segmentCount - slots.length);
        for (let i = 0; i < n; i++) slots.push(cls);
        if (slots.length >= segmentCount) break;
    }
    while (slots.length < segmentCount) slots.push("");
    return slots.map(cls => `<span class="qm-segment${cls ? ` ${cls}` : ""}"></span>`).join("");
}

function buildColumnHtml(queue, segmentCount) {
    const queueId = getQueueId(queue);
    const queueName = normalizeText(queue?.queue_name) || queueId;
    const memberCount   = queue.member_count         || 0;
    const joinedCount   = queue.joined_member_count  || 0;
    const presAvail     = queue.presence_available   || 0;
    const onIdle        = queue.on_queue_idle        || 0;
    const onInter       = queue.on_queue_interacting || 0;
    const presOffline   = queue.presence_offline     || 0;
    const presentCount  = Math.max(0, joinedCount - presOffline);
    const otherRed      = Math.max(0, joinedCount - presAvail - onIdle - onInter - presOffline);

    const segments = buildSegments(presAvail, onIdle, onInter, otherRed, segmentCount);

    const tooltipParts = [];
    if (presAvail > 0)   tooltipParts.push(`${presAvail} Online`);
    if (onIdle > 0)      tooltipParts.push(`${onIdle} In Warteschleife`);
    if (onInter > 0)     tooltipParts.push(`${onInter} Im Call`);
    if (otherRed > 0)    tooltipParts.push(`${otherRed} Beschäftigt/Pause`);
    if (presOffline > 0) tooltipParts.push(`${presOffline} Offline`);
    const tooltip = `${queueName} — ${tooltipParts.join(", ") || "Keine Daten"}`;

    const isHidden = queueManagerState.hiddenQueueIds.has(queueId);

    return `
        <div class="qm-column-wrap${isHidden ? " is-dimmed" : ""}" role="listitem"
             data-queue-id="${escapeHtml(queueId)}"
             data-queue-name="${escapeHtml(normalizeLower(queueName))}">
            <button type="button" class="qm-visibility-btn${isHidden ? " is-hidden" : ""}"
                    data-toggle-queue-id="${escapeHtml(queueId)}"
                    title="${isHidden ? "Queue einblenden" : "Queue ausblenden"}">
                ${isHidden ? "●" : "○"}
            </button>
            <button type="button" class="qm-column"
                data-queue-id="${escapeHtml(queueId)}"
                title="${escapeHtml(tooltip)}">
                <div class="qm-column-assignment">${memberCount} Mitglieder</div>
                <div class="qm-column-counter">
                    <span class="qm-column-counter-x">${presentCount}</span><span class="qm-column-counter-y">/${joinedCount}</span>
                </div>
                <div class="qm-column-track">${segments}</div>
                <span class="qm-column-label">${escapeHtml(queueName)}</span>
            </button>
        </div>
    `;
}

function renderEqualizer() {
    const queues = queueManagerState.queues;
    queueManagerColumns.clear();

    if (queues.length === 0) {
        queueManagerDom.equalizer.innerHTML = `
            <div class="qm-equalizer-empty queue-manager-empty-card">
                <strong>Keine Queues gefunden</strong>
                <p>Es konnten keine Queues geladen werden.</p>
            </div>
        `;
        return;
    }

    const maxPresent = Math.max(...queues.map(q => Math.max(0, (q.joined_member_count || 0) - (q.presence_offline || 0))));
    const segmentCount = Math.min(50, Math.max(10, maxPresent + 5));

    const sorted = sortQueues(queues);
    const hidden = queueManagerState.hiddenQueueIds;
    const visible = sorted.filter(q => !hidden.has(getQueueId(q)));
    const dimmed  = sorted.filter(q =>  hidden.has(getQueueId(q)));
    const ordered = [...visible, ...dimmed];

    queueManagerDom.equalizer.innerHTML = ordered.map(queue => buildColumnHtml(queue, segmentCount)).join("");

    queueManagerDom.equalizer.querySelectorAll(".qm-column-wrap[data-queue-id]").forEach(wrapEl => {
        queueManagerColumns.set(wrapEl.dataset.queueId, wrapEl);
    });

    filterEqualizer(queueManagerDom.queueFilter?.value || "");
}

function filterEqualizer(query) {
    const q = normalizeLower(query);
    queueManagerColumns.forEach((wrapEl, id) => {
        const isHidden = queueManagerState.hiddenQueueIds.has(id);
        if (isHidden) {
            wrapEl.classList.add("is-dimmed");
            wrapEl.classList.remove("is-match");
            return;
        }
        if (!q) {
            wrapEl.classList.remove("is-dimmed", "is-match");
            return;
        }
        const match = (wrapEl.dataset.queueName || "").includes(q);
        wrapEl.classList.toggle("is-match", match);
        wrapEl.classList.toggle("is-dimmed", !match);
    });
}

function renderKpis() {
    const queues = queueManagerState.queues;
    const queueCount = queues.length;

    let maxQueue = null;
    for (const queue of queues) {
        if (!maxQueue || (queue.joined_member_count || 0) > (maxQueue.joined_member_count || 0)) {
            maxQueue = queue;
        }
    }
    const maxPresent = maxQueue
        ? Math.max(0, (maxQueue.joined_member_count || 0) - (maxQueue.presence_offline || 0))
        : 0;

    queueManagerDom.kpiQueueCount.textContent   = String(queueCount);
    queueManagerDom.kpiTotalMembers.textContent  = "–";
    queueManagerDom.kpiActiveMembers.textContent = "–";
    queueManagerDom.kpiMaxQueue.textContent      = maxQueue && (maxQueue.joined_member_count || 0) > 0
        ? `${maxQueue.queue_name || getQueueId(maxQueue)} (${maxQueue.joined_member_count}/${maxPresent})`
        : "–";
}

// ── Queues loading ────────────────────────────────────────────────────────────

async function loadQueues() {
    queueManagerState.loadingFlags.queues = true;
    queueManagerDom.globalStatus.hidden = true;

    try {
        const payload = await queueManagerApi.listQueuesOverview();
        queueManagerState.queues = normalizeQueueListResponse(payload);

        renderEqualizer();
        renderKpis();
        if (queueManagerDom.lastUpdated) {
            const now = new Date();
            queueManagerDom.lastUpdated.textContent = `zuletzt aktualisiert um ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
        }
    } catch (error) {
        setStatus(queueManagerDom.globalStatus, "error", error.message || "Queues konnten nicht geladen werden.");
        queueManagerDom.globalStatus.hidden = false;
    } finally {
        queueManagerState.loadingFlags.queues = false;
    }
}

function findQueueById(queueId) {
    return queueManagerState.queues.find(q => getQueueId(q) === queueId) || null;
}

// ── Modal: user rows ──────────────────────────────────────────────────────────

function filterUsers(users, filterText) {
    const q = normalizeLower(filterText);
    if (!q) return users;
    return users.filter(user => normalizeLower(buildUserDisplayName(user)).includes(q));
}

function isUserPendingChange(member) {
    const id = getMemberApiId(member);
    const wasJoined = queueManagerState.modal.originalJoinedIds.has(id);
    const isJoinedNow = queueManagerState.modal.joinedStaged.some(m => getMemberApiId(m) === id);
    return wasJoined !== isJoinedNow;
}

function buildUserRowHtml(member, targetAction) {
    const id = getMemberApiId(member);
    const tier = presenceTier(member);
    const tierClass = presenceTierClass(tier);
    const label = presenceLabel(member);
    const pending = isUserPendingChange(member);
    const pendingClass = pending ? (targetAction === "move-to-unjoined" ? " is-pending-unjoin" : " is-pending-join") : "";
    const arrow = targetAction === "move-to-unjoined" ? "→" : "←";
    const ariaLabel = targetAction === "move-to-unjoined" ? "Deaktivieren" : "Aktivieren";

    return `
        <div class="qm-user-row${pendingClass}" data-member-api-id="${escapeHtml(id)}">
            <span class="qm-presence-dot ${tierClass}" title="${escapeHtml(label)}"></span>
            <div class="qm-user-row-info">
                <strong class="qm-user-row-name">${escapeHtml(buildUserDisplayName(member))}</strong>
                ${label ? `<span class="qm-user-row-meta">${escapeHtml(label)}</span>` : ""}
            </div>
            <div class="qm-user-row-actions">
                <button type="button" class="qm-move-btn" data-action="${targetAction}" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(ariaLabel)}">${arrow}</button>
            </div>
        </div>
    `;
}

function renderPane(side) {
    const isJoined = side === "joined";
    const staged = isJoined ? queueManagerState.modal.joinedStaged : queueManagerState.modal.unjoinedStaged;
    const filterText = isJoined ? queueManagerState.modal.joinedFilter : queueManagerState.modal.unjoinedFilter;
    const listEl = isJoined ? queueManagerDom.joinedList : queueManagerDom.unjoinedList;
    const countEl = isJoined ? queueManagerDom.joinedCount : queueManagerDom.unjoinedCount;
    const targetAction = isJoined ? "move-to-unjoined" : "move-to-joined";
    const emptyText = isJoined ? "Keine zugeordneten Mitglieder." : "Keine nicht zugeordneten Mitglieder.";

    countEl.textContent = String(staged.length);

    const sorted = sortByPresenceThenName(staged);
    const filtered = filterUsers(sorted, filterText);

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="qm-pane-empty queue-manager-empty-card">
                <p>${staged.length === 0 ? emptyText : "Kein Treffer für den Filter."}</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = filtered.map(member => buildUserRowHtml(member, targetAction)).join("");
}

function renderPresenceSummary() {
    if (!queueManagerDom.presenceSummary) return;
    queueManagerDom.presenceSummary.innerHTML = buildPresenceSummaryHtml(queueManagerState.modal.members);
}

function renderPendingChanges() {
    if (!queueManagerDom.pendingChanges) return;

    const { joinedStaged, unjoinedStaged, originalJoinedIds } = queueManagerState.modal;
    const toJoin = joinedStaged.filter(m => !originalJoinedIds.has(getMemberApiId(m)));
    const toUnjoin = unjoinedStaged.filter(m => originalJoinedIds.has(getMemberApiId(m)));

    if (toJoin.length === 0 && toUnjoin.length === 0) {
        queueManagerDom.pendingChanges.innerHTML = "";
        return;
    }

    function buildChip(members, action, cssClass) {
        if (members.length === 0) return "";
        const MAX = 3;
        const names = members.slice(0, MAX).map(m => buildUserDisplayName(m)).join(", ");
        const extra = members.length > MAX ? ` + ${members.length - MAX} weitere` : "";
        return `<span class="qm-pending-chip ${cssClass}">${escapeHtml(action)}: ${escapeHtml(names + extra)}</span>`;
    }

    queueManagerDom.pendingChanges.innerHTML =
        buildChip(toJoin, "→ Zugeordnet", "qm-pending-join") +
        buildChip(toUnjoin, "→ Nicht zugeordnet", "qm-pending-unjoin");
}

function renderModal() {
    renderPane("joined");
    renderPane("unjoined");
    renderPresenceSummary();
    renderPendingChanges();
}

// ── Modal: open / close / load ────────────────────────────────────────────────

async function loadMembers(queueId) {
    queueManagerDom.joinedList.innerHTML = "";
    queueManagerDom.unjoinedList.innerHTML = "";
    queueManagerDom.joinedCount.textContent = "…";
    queueManagerDom.unjoinedCount.textContent = "…";
    queueManagerDom.modalFooterStatus.textContent = "Mitglieder werden geladen…";

    try {
        const payload = await queueManagerApi.listQueueMembers(queueId);
        const members = normalizeMembersResponse(payload);

        queueManagerState.modal.members = members;
        queueManagerState.modal.joinedStaged = members.filter(m => m.joined);
        queueManagerState.modal.unjoinedStaged = members.filter(m => !m.joined);
        queueManagerState.modal.originalJoinedIds = new Set(
            queueManagerState.modal.joinedStaged.map(getMemberApiId).filter(Boolean)
        );

        renderModal();
        queueManagerDom.modalFooterStatus.textContent = "";
    } catch (error) {
        queueManagerState.modal.members = [];
        queueManagerState.modal.joinedStaged = [];
        queueManagerState.modal.unjoinedStaged = [];
        queueManagerState.modal.originalJoinedIds = new Set();
        renderModal();
        queueManagerDom.modalFooterStatus.textContent = error.message || "Mitglieder konnten nicht geladen werden.";
    }
}

function openQueueModal(queueId, queueName) {
    queueManagerState.modal.open = true;
    queueManagerState.modal.queueId = queueId;
    queueManagerState.modal.queueName = queueName;
    queueManagerState.modal.joinedFilter = "";
    queueManagerState.modal.unjoinedFilter = "";
    queueManagerState.modal.pinnedTier = null;

    queueManagerDom.modalTitle.textContent = queueName || queueId;
    queueManagerDom.modalQueueId.textContent = `Queue ID ${queueId}`;
    queueManagerDom.joinedFilter.value = "";
    queueManagerDom.unjoinedFilter.value = "";
    queueManagerDom.joinedList.innerHTML = "";
    queueManagerDom.unjoinedList.innerHTML = "";
    queueManagerDom.modalFooterStatus.textContent = "";
    if (queueManagerDom.presenceSummary) queueManagerDom.presenceSummary.innerHTML = "";
    if (queueManagerDom.pendingChanges) queueManagerDom.pendingChanges.innerHTML = "";

    queueManagerDom.modal.classList.add("active");
    queueManagerDom.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    loadMembers(queueId);
}

function closeQueueModal() {
    queueManagerDom.modal.classList.remove("active");
    queueManagerDom.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");

    queueManagerState.modal.open = false;
    queueManagerState.modal.queueId = "";
    queueManagerState.modal.queueName = "";
    queueManagerState.modal.members = [];
    queueManagerState.modal.joinedStaged = [];
    queueManagerState.modal.unjoinedStaged = [];
    queueManagerState.modal.originalJoinedIds = new Set();
    queueManagerState.modal.pinnedTier = null;
}

// ── Modal: move / discard / save ──────────────────────────────────────────────

function moveUser(memberApiId, fromSide) {
    const source = fromSide === "joined" ? queueManagerState.modal.joinedStaged : queueManagerState.modal.unjoinedStaged;
    const target = fromSide === "joined" ? queueManagerState.modal.unjoinedStaged : queueManagerState.modal.joinedStaged;

    const index = source.findIndex(m => getMemberApiId(m) === memberApiId);
    if (index === -1) return;

    const [member] = source.splice(index, 1);
    target.push(member);

    renderModal();
}

function discardModalChanges() {
    const { members, originalJoinedIds } = queueManagerState.modal;
    queueManagerState.modal.joinedStaged = members.filter(m => originalJoinedIds.has(getMemberApiId(m)));
    queueManagerState.modal.unjoinedStaged = members.filter(m => !originalJoinedIds.has(getMemberApiId(m)));
    queueManagerState.modal.joinedFilter = "";
    queueManagerState.modal.unjoinedFilter = "";
    queueManagerDom.joinedFilter.value = "";
    queueManagerDom.unjoinedFilter.value = "";
    queueManagerDom.modalFooterStatus.textContent = "Änderungen verworfen.";
    renderModal();
}

function computeJoinDiff() {
    const { joinedStaged, unjoinedStaged, originalJoinedIds } = queueManagerState.modal;
    const toJoin = joinedStaged.filter(m => !originalJoinedIds.has(getMemberApiId(m))).map(getMemberApiId);
    const toUnjoin = unjoinedStaged.filter(m => originalJoinedIds.has(getMemberApiId(m))).map(getMemberApiId);
    return { toJoin, toUnjoin };
}

async function saveModalChanges() {
    const { queueId } = queueManagerState.modal;
    const { toJoin, toUnjoin } = computeJoinDiff();

    if (toJoin.length === 0 && toUnjoin.length === 0) {
        queueManagerDom.modalFooterStatus.textContent = "Keine Änderungen zum Speichern.";
        return;
    }

    queueManagerState.modal.saving = true;
    queueManagerDom.saveButton.disabled = true;
    queueManagerDom.discardButton.disabled = true;
    queueManagerDom.modalFooterStatus.textContent = "Speichere…";

    const tasks = [];
    if (toJoin.length > 0) tasks.push(queueManagerApi.patchQueueMembers(queueId, { user_ids: toJoin, joined: true }));
    if (toUnjoin.length > 0) tasks.push(queueManagerApi.patchQueueMembers(queueId, { user_ids: toUnjoin, joined: false }));

    const results = await Promise.allSettled(tasks);
    const errors = results.filter(r => r.status === "rejected").map(r => r.reason?.message || "Unbekannter Fehler");

    if (errors.length === results.length) {
        queueManagerDom.modalFooterStatus.textContent = `Speichern fehlgeschlagen: ${errors.join(" / ")}`;
    } else {
        const summaryParts = [];
        if (toJoin.length > 0) summaryParts.push(`${toJoin.length} aktiviert`);
        if (toUnjoin.length > 0) summaryParts.push(`${toUnjoin.length} deaktiviert`);

        queueManagerDom.modalFooterStatus.textContent = errors.length > 0
            ? `Teilweise gespeichert (${summaryParts.join(", ")}), Fehler: ${errors.join(" / ")}`
            : `Gespeichert: ${summaryParts.join(", ")}.`;

        await loadMembers(queueId);
        loadQueues();
    }

    queueManagerState.modal.saving = false;
    queueManagerDom.saveButton.disabled = false;
    queueManagerDom.discardButton.disabled = false;
}

// ── Events ────────────────────────────────────────────────────────────────────

function handleClick(event) {
    const visBtn = event.target.closest(".qm-visibility-btn[data-toggle-queue-id]");
    if (visBtn) {
        const id = visBtn.dataset.toggleQueueId;
        if (queueManagerState.hiddenQueueIds.has(id))
            queueManagerState.hiddenQueueIds.delete(id);
        else
            queueManagerState.hiddenQueueIds.add(id);
        renderEqualizer();
        return;
    }

    const presenceChip = event.target.closest(".qm-presence-chip[data-tier]");
    if (presenceChip) {
        const tier = Number(presenceChip.dataset.tier);
        const modal = queueManagerState.modal;
        modal.pinnedTier = modal.pinnedTier === tier ? null : tier;
        renderModal();
        return;
    }

    const column = event.target.closest(".qm-column[data-queue-id]");
    if (column) {
        const queueId = column.dataset.queueId;
        const queue = findQueueById(queueId);
        openQueueModal(queueId, queue?.queue_name || queueId);
        return;
    }

    if (event.target.closest("#qmModalCloseBtn")) {
        closeQueueModal();
        return;
    }

    if (event.target === queueManagerDom.modal) {
        closeQueueModal();
        return;
    }

    const moveBtn = event.target.closest(".qm-move-btn[data-action]");
    if (moveBtn) {
        const row = moveBtn.closest(".qm-user-row");
        const memberApiId = row?.dataset.memberApiId || "";
        const fromSide = moveBtn.dataset.action === "move-to-unjoined" ? "joined" : "unjoined";
        moveUser(memberApiId, fromSide);
        return;
    }

    if (event.target.closest("#qmDiscardButton")) {
        discardModalChanges();
        return;
    }

    if (event.target.closest("#qmSaveButton")) {
        saveModalChanges();
        return;
    }

    if (event.target.closest("#qmRefreshButton")) {
        loadQueues();
    }
}

function handleKeydown(event) {
    if (event.key === "Escape" && queueManagerState.modal.open) {
        closeQueueModal();
    }
}

function bindEvents() {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);

    queueManagerDom.sortSelect?.addEventListener("change", event => {
        queueManagerState.sortBy = event.target.value;
        renderEqualizer();
    });

    queueManagerDom.queueFilter?.addEventListener("input", event => {
        filterEqualizer(event.target.value);
    });

    queueManagerDom.joinedFilter?.addEventListener("input", event => {
        queueManagerState.modal.joinedFilter = event.target.value;
        renderPane("joined");
    });

    queueManagerDom.unjoinedFilter?.addEventListener("input", event => {
        queueManagerState.modal.unjoinedFilter = event.target.value;
        renderPane("unjoined");
    });
}

async function initializeQueueManager() {
    cacheDom();
    bindEvents();
    await loadQueues();
}

document.addEventListener("DOMContentLoaded", initializeQueueManager);
