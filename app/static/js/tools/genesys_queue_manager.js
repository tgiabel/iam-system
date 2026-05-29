const queueManagerState = {
    queues: [],
    selectedQueueId: "",
    selectedQueue: null,
    queueMembers: [],
    queueMemberSelection: new Set(),
    queueAddSelection: new Map(),
    queueUserSearchResults: [],
    userSearchResults: [],
    selectedUser: null,
    userQueues: [],
    pendingUserQueueIds: new Set(),
    originalUserQueueIds: new Set(),
    loadingFlags: {
        queues: false,
        queueMembers: false,
        queueSearch: false,
        queueAdd: false,
        queueRemove: false,
        userSearch: false,
        userQueues: false,
        userSave: false,
    },
};

const queueManagerDom = {};

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
    const firstName = normalizeText(user?.first_name);
    const lastName = normalizeText(user?.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    return fullName || normalizeText(user?.name) || normalizeText(user?.email) || normalizeText(user?.genesys_user_id) || normalizeText(user?.user_id) || "Unbekannter User";
}

function buildUserSecondaryText(user) {
    return [
        user?.email,
        user?.pnr ? `PNR ${user.pnr}` : "",
        user?.racf ? `RACF ${user.racf}` : "",
        user?.genesys_user_id ? `Genesys ${user.genesys_user_id}` : "",
    ].filter(Boolean).join(" • ");
}

function getUserApiId(user) {
    return normalizeText(user?.genesys_user_id || user?.user_id || user?.id);
}

function getQueueId(queue) {
    return normalizeText(queue?.queue_id || queue?.id);
}

function getMemberApiId(member) {
    return normalizeText(
        member?.genesys_user_id
        || member?.user_id
        || member?.member_id
        || member?.id
    );
}

function getMembershipId(member) {
    return normalizeText(member?.id || member?.member_id || member?.assignment_id || getMemberApiId(member));
}

function normalizeQueueListResponse(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.queues)) {
        return payload.queues;
    }
    return [];
}

function normalizeMembersResponse(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.members)) {
        return payload.members;
    }
    return [];
}

function normalizeUserSearchResponse(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.users)) {
        return payload.users;
    }
    if (Array.isArray(payload?.results)) {
        return payload.results;
    }
    return [];
}

function normalizeUserQueuesResponse(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.queues)) {
        return payload.queues;
    }
    return [];
}

function findQueueById(queueId) {
    return queueManagerState.queues.find(queue => getQueueId(queue) === queueId) || null;
}

function filterQueueStrip(query) {
    const q = normalizeLower(query);
    queueManagerDom.queueStrip?.querySelectorAll("[data-queue-id]").forEach(btn => {
        btn.hidden = q ? !normalizeLower(btn.title).includes(q) : false;
    });
}

function filterUserQueueList(query) {
    const q = normalizeLower(query);
    queueManagerDom.userQueuesList?.querySelectorAll(".queue-manager-user-queue-item").forEach(item => {
        const name = normalizeLower(item.querySelector("strong")?.textContent || "");
        item.hidden = q ? !name.includes(q) : false;
    });
}

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

    listQueueMembers(queueId) {
        return this.requestJson(`/api/q-manager/queues/${encodeURIComponent(queueId)}/members`);
    },

    addQueueMembers(queueId, payload) {
        return this.requestJson(`/api/q-manager/queues/${encodeURIComponent(queueId)}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    removeQueueMembers(queueId, payload) {
        return this.requestJson(`/api/q-manager/queues/${encodeURIComponent(queueId)}/members/remove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },

    deleteQueueMember(queueId, memberId) {
        return this.requestJson(`/api/q-manager/queues/${encodeURIComponent(queueId)}/members/${encodeURIComponent(memberId)}`, {
            method: "DELETE",
        });
    },

    searchUsers(query) {
        const searchParams = new URLSearchParams({ q: query });
        return this.requestJson(`/api/q-manager/users/search?${searchParams.toString()}`);
    },

    getUser(userId) {
        return this.requestJson(`/api/q-manager/users/${encodeURIComponent(userId)}`);
    },

    listUserQueues(userId) {
        return this.requestJson(`/api/q-manager/users/${encodeURIComponent(userId)}/queues`);
    },

    updateUserQueues(userId, payload) {
        return this.requestJson(`/api/q-manager/users/${encodeURIComponent(userId)}/queues`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    },
};

const queueManagerUi = {
    cacheDom() {
        queueManagerDom.globalStatus = document.getElementById("globalStatus");
        queueManagerDom.queueStatus = document.getElementById("queueStatus");
        queueManagerDom.userStatus = document.getElementById("userStatus");
        queueManagerDom.queueMeta = document.getElementById("queueMeta");
        queueManagerDom.userMeta = document.getElementById("userMeta");
        queueManagerDom.queueStrip = document.getElementById("queueStrip");
        queueManagerDom.queueStripFilter = document.getElementById("queueStripFilter");
        queueManagerDom.userQueueFilter = document.getElementById("userQueueFilter");
        queueManagerDom.selectedQueueCard = document.getElementById("selectedQueueCard");
        queueManagerDom.selectedQueueTitle = document.getElementById("selectedQueueTitle");
        queueManagerDom.selectedQueueSubtitle = document.getElementById("selectedQueueSubtitle");
        queueManagerDom.refreshQueueMembersButton = document.getElementById("refreshQueueMembersButton");
        queueManagerDom.queueUserSearchInput = document.getElementById("queueUserSearchInput");
        queueManagerDom.queueUserSearchButton = document.getElementById("queueUserSearchButton");
        queueManagerDom.queueUserSearchResults = document.getElementById("queueUserSearchResults");
        queueManagerDom.queueAddSelectionSummary = document.getElementById("queueAddSelectionSummary");
        queueManagerDom.clearQueueAddSelectionButton = document.getElementById("clearQueueAddSelectionButton");
        queueManagerDom.addQueueMembersButton = document.getElementById("addQueueMembersButton");
        queueManagerDom.memberListMeta = document.getElementById("memberListMeta");
        queueManagerDom.memberTableBody = document.getElementById("memberTableBody");
        queueManagerDom.removeSelectedMembersButton = document.getElementById("removeSelectedMembersButton");
        queueManagerDom.clearMemberSelectionButton = document.getElementById("clearMemberSelectionButton");
        queueManagerDom.userSearchInput = document.getElementById("userSearchInput");
        queueManagerDom.userSearchButton = document.getElementById("userSearchButton");
        queueManagerDom.userSearchResults = document.getElementById("userSearchResults");
        queueManagerDom.selectedUserCard = document.getElementById("selectedUserCard");
        queueManagerDom.selectedUserTitle = document.getElementById("selectedUserTitle");
        queueManagerDom.selectedUserDetails = document.getElementById("selectedUserDetails");
        queueManagerDom.refreshUserQueuesButton = document.getElementById("refreshUserQueuesButton");
        queueManagerDom.userQueueMeta = document.getElementById("userQueueMeta");
        queueManagerDom.userQueuesList = document.getElementById("userQueuesList");
        queueManagerDom.resetUserQueueSelectionButton = document.getElementById("resetUserQueueSelectionButton");
        queueManagerDom.saveUserQueuesButton = document.getElementById("saveUserQueuesButton");
    },

    setStatus(element, kind, message) {
        if (!element) {
            return;
        }
        element.textContent = message;
        element.classList.remove("queue-manager-status-info", "queue-manager-status-success", "queue-manager-status-error");
        element.classList.add(`queue-manager-status-${kind}`);
    },

    renderQueueStrip() {
        const queues = queueManagerState.queues;
        const dom = queueManagerDom.queueStrip;
        if (!dom) {
            return;
        }

        if (!queues.length) {
            dom.innerHTML = `<span class="queue-manager-panel-meta">Keine Queues verfügbar.</span>`;
            return;
        }

        dom.innerHTML = queues.map(queue => {
            const queueId = getQueueId(queue);
            const activeClass = queueId === queueManagerState.selectedQueueId ? "is-active" : "";
            const label = escapeHtml(queue?.queue_name || queueId);
            return `<button type="button" role="listitem"
                class="queue-manager-strip-item ${activeClass}"
                data-queue-id="${escapeHtml(queueId)}"
                title="${label}">${label}</button>`;
        }).join("");

        if (queueManagerDom.queueStripFilter?.value) {
            filterQueueStrip(queueManagerDom.queueStripFilter.value);
        }
    },

    renderSelectedQueue() {
        const queue = queueManagerState.selectedQueue;
        if (!queue || !queueManagerDom.selectedQueueCard) {
            if (queueManagerDom.selectedQueueCard) {
                queueManagerDom.selectedQueueCard.hidden = true;
            }
            queueManagerDom.queueMeta.textContent = "Keine Queue ausgewählt";
            return;
        }

        queueManagerDom.selectedQueueCard.hidden = false;
        queueManagerDom.selectedQueueTitle.textContent = queue.queue_name || getQueueId(queue);
        queueManagerDom.selectedQueueSubtitle.textContent = `Queue ID ${getQueueId(queue)}`;
        queueManagerDom.queueMeta.textContent = queue.queue_name || getQueueId(queue);
        queueManagerDom.refreshQueueMembersButton.disabled = queueManagerState.loadingFlags.queueMembers;
    },

    renderQueueSearchResults() {
        const results = queueManagerState.queueUserSearchResults;
        if (!results.length) {
            queueManagerDom.queueUserSearchResults.innerHTML = `
                <div class="queue-manager-empty-card">
                    <strong>Keine Treffer</strong>
                    <p>Die Suche hat keine passenden User geliefert.</p>
                </div>
            `;
            return;
        }

        queueManagerDom.queueUserSearchResults.innerHTML = results.map(user => {
            const userApiId = getUserApiId(user);
            const checked = queueManagerState.queueAddSelection.has(userApiId);
            return `
                <div class="queue-manager-search-result">
                    <div class="queue-manager-search-result-top">
                        <div>
                            <p class="queue-manager-search-result-title">${escapeHtml(buildUserDisplayName(user))}</p>
                            <p class="queue-manager-search-result-meta">${escapeHtml(buildUserSecondaryText(user) || "Keine Zusatzdaten verfügbar")}</p>
                        </div>
                    </div>
                    <div class="queue-manager-search-result-actions">
                        <label class="queue-manager-checkbox-row">
                            <input type="checkbox" data-queue-add-id="${escapeHtml(userApiId)}" ${checked ? "checked" : ""}>
                            <span>Für Bulk Add vormerken</span>
                        </label>
                    </div>
                </div>
            `;
        }).join("");
    },

    renderQueueAddSelectionSummary() {
        const count = queueManagerState.queueAddSelection.size;
        queueManagerDom.queueAddSelectionSummary.textContent = count
            ? `${count} User für Bulk Add ausgewählt.`
            : "Keine User für Bulk Add ausgewählt.";
        queueManagerDom.clearQueueAddSelectionButton.disabled = count === 0 || queueManagerState.loadingFlags.queueAdd;
        queueManagerDom.addQueueMembersButton.disabled = count === 0 || !queueManagerState.selectedQueueId || queueManagerState.loadingFlags.queueAdd;
    },

    renderMembers() {
        const members = queueManagerState.queueMembers;
        if (!members.length) {
            queueManagerDom.memberTableBody.innerHTML = `
                <tr>
                    <td colspan="4">
                        <div class="queue-manager-empty-table">Für diese Queue sind aktuell keine Mitglieder vorhanden.</div>
                    </td>
                </tr>
            `;
            queueManagerDom.memberListMeta.textContent = "0 Mitglieder";
            this.renderMemberSelectionActions();
            return;
        }

        queueManagerDom.memberTableBody.innerHTML = members.map(member => {
            const membershipId = getMembershipId(member);
            const memberApiId = getMemberApiId(member);
            const checked = queueManagerState.queueMemberSelection.has(memberApiId);
            return `
                <tr>
                    <td>
                        <input type="checkbox" data-member-select-id="${escapeHtml(memberApiId)}" ${checked ? "checked" : ""}>
                    </td>
                    <td>
                        <strong>${escapeHtml(buildUserDisplayName(member))}</strong>
                        <div class="queue-manager-search-result-meta">${escapeHtml(buildUserSecondaryText(member) || "-")}</div>
                    </td>
                    <td>${escapeHtml(membershipId || memberApiId || "-")}</td>
                    <td>
                        <button type="button" class="btn btn-secondary" data-delete-member-id="${escapeHtml(membershipId)}">Entfernen</button>
                    </td>
                </tr>
            `;
        }).join("");

        queueManagerDom.memberListMeta.textContent = `${members.length} Mitglieder`;
        this.renderMemberSelectionActions();
    },

    renderMemberSelectionActions() {
        const selectionCount = queueManagerState.queueMemberSelection.size;
        queueManagerDom.removeSelectedMembersButton.disabled = selectionCount === 0 || !queueManagerState.selectedQueueId || queueManagerState.loadingFlags.queueRemove;
        queueManagerDom.clearMemberSelectionButton.disabled = selectionCount === 0;
    },

    renderUserSearchResults() {
        const results = queueManagerState.userSearchResults;
        if (!results.length) {
            queueManagerDom.userSearchResults.innerHTML = `
                <div class="queue-manager-empty-card">
                    <strong>Keine Treffer</strong>
                    <p>Es wurden keine passenden User für die Suchanfrage gefunden.</p>
                </div>
            `;
            return;
        }

        queueManagerDom.userSearchResults.innerHTML = results.map(user => {
            const userApiId = getUserApiId(user);
            return `
                <div class="queue-manager-search-result">
                    <div class="queue-manager-search-result-top">
                        <div>
                            <p class="queue-manager-search-result-title">${escapeHtml(buildUserDisplayName(user))}</p>
                            <p class="queue-manager-search-result-meta">${escapeHtml(buildUserSecondaryText(user) || "Keine Zusatzdaten verfügbar")}</p>
                        </div>
                    </div>
                    <div class="queue-manager-search-result-actions">
                        <button type="button" class="btn btn-secondary" data-select-user-id="${escapeHtml(userApiId)}">User auswählen</button>
                    </div>
                </div>
            `;
        }).join("");
    },

    renderSelectedUser() {
        const user = queueManagerState.selectedUser;
        if (!queueManagerDom.selectedUserCard) {
            return;
        }

        if (!user) {
            queueManagerDom.selectedUserCard.hidden = true;
            queueManagerDom.userMeta.textContent = "Kein User ausgewählt";
            return;
        }

        queueManagerDom.selectedUserCard.hidden = false;
        queueManagerDom.selectedUserTitle.textContent = buildUserDisplayName(user);
        queueManagerDom.userMeta.textContent = buildUserDisplayName(user);
        queueManagerDom.refreshUserQueuesButton.disabled = queueManagerState.loadingFlags.userQueues;

        const hasGenesysId = Boolean(user.genesys_user_id);
        queueManagerDom.selectedUserDetails.innerHTML = hasGenesysId ? "" : `
            <div class="queue-manager-status queue-manager-status-error" style="margin-top: 8px;">
                Dieser User hat keinen Genesys-Account. Queue-Operationen sind nicht verfügbar.
            </div>
        `;
    },

    renderUserQueues() {
        const selectedUser = queueManagerState.selectedUser;
        const queues = queueManagerState.queues;
        if (!selectedUser) {
            queueManagerDom.userQueuesList.innerHTML = `
                <div class="queue-manager-empty-card">
                    <strong>Kein User aktiv</strong>
                    <p>Wähle zuerst einen User aus der Suche aus.</p>
                </div>
            `;
            queueManagerDom.userQueueMeta.textContent = "Kein User ausgewählt";
            this.renderUserQueueActions();
            return;
        }

        if (!queues.length) {
            queueManagerDom.userQueuesList.innerHTML = `
                <div class="queue-manager-empty-card">
                    <strong>Keine Queues vorhanden</strong>
                    <p>Ohne Queue-Liste kann keine Mitgliedschaft gepflegt werden.</p>
                </div>
            `;
            queueManagerDom.userQueueMeta.textContent = "0 Queues";
            this.renderUserQueueActions();
            return;
        }

        queueManagerDom.userQueuesList.innerHTML = queues.map(queue => {
            const queueId = getQueueId(queue);
            const checked = queueManagerState.pendingUserQueueIds.has(queueId);
            return `
                <div class="queue-manager-user-queue-item">
                    <div class="queue-manager-user-queue-row">
                        <div>
                            <strong>${escapeHtml(queue.queue_name || queueId)}</strong>
                            <p class="queue-manager-user-queue-meta">Queue ID ${escapeHtml(queueId)}</p>
                        </div>
                        <label class="queue-manager-toggle-row">
                            <input type="checkbox" data-user-queue-id="${escapeHtml(queueId)}" ${checked ? "checked" : ""}>
                            <span class="queue-manager-pill ${checked ? "queue-manager-pill-joined" : "queue-manager-pill-not-joined"}">${checked ? "Joined" : "Nicht joined"}</span>
                        </label>
                    </div>
                </div>
            `;
        }).join("");

        queueManagerDom.userQueueMeta.textContent = `${queueManagerState.pendingUserQueueIds.size} von ${queues.length} Queues ausgewählt`;
        this.renderUserQueueActions();
    },

    renderUserQueueActions() {
        const hasUser = Boolean(queueManagerState.selectedUser);
        const isBusy = queueManagerState.loadingFlags.userSave || queueManagerState.loadingFlags.userQueues;
        const hasPendingChanges = hasUser && (
            queueManagerState.pendingUserQueueIds.size !== queueManagerState.originalUserQueueIds.size
            || [...queueManagerState.pendingUserQueueIds].some(id => !queueManagerState.originalUserQueueIds.has(id))
        );
        const hasGenesysId = Boolean(getUserApiId(queueManagerState.selectedUser));
        queueManagerDom.resetUserQueueSelectionButton.disabled = !hasUser || isBusy || !hasPendingChanges;
        queueManagerDom.saveUserQueuesButton.disabled = !hasUser || isBusy || !hasPendingChanges || !hasGenesysId;
    },

    syncAll() {
        this.renderQueueStrip();
        this.renderSelectedQueue();
        this.renderQueueSearchResults();
        this.renderQueueAddSelectionSummary();
        this.renderMembers();
        this.renderUserSearchResults();
        this.renderSelectedUser();
        this.renderUserQueues();
    },
};

async function loadQueues({ preserveSelection = true } = {}) {
    queueManagerState.loadingFlags.queues = true;
    queueManagerUi.setStatus(queueManagerDom.globalStatus, "info", "Queues werden geladen...");

    try {
        const payload = await queueManagerApi.listQueues();
        queueManagerState.queues = normalizeQueueListResponse(payload);
        const stillExists = preserveSelection && queueManagerState.selectedQueueId
            ? findQueueById(queueManagerState.selectedQueueId)
            : null;

        if (stillExists) {
            queueManagerState.selectedQueue = stillExists;
        } else if (!queueManagerState.selectedQueueId && queueManagerState.queues.length) {
            queueManagerState.selectedQueueId = getQueueId(queueManagerState.queues[0]);
            queueManagerState.selectedQueue = queueManagerState.queues[0];
        } else {
            queueManagerState.selectedQueue = findQueueById(queueManagerState.selectedQueueId);
        }

        queueManagerUi.setStatus(queueManagerDom.globalStatus, "success", `${queueManagerState.queues.length} Queues geladen.`);
        if (queueManagerDom.queueStripFilter) queueManagerDom.queueStripFilter.value = "";
        queueManagerUi.renderQueueStrip();
        queueManagerUi.renderSelectedQueue();

        if (queueManagerState.selectedQueueId) {
            await loadQueueMembers(queueManagerState.selectedQueueId);
        } else {
            queueManagerState.queueMembers = [];
            queueManagerUi.renderMembers();
        }

        if (queueManagerState.selectedUser) {
            await loadUserQueues(queueManagerState.selectedUser, { silentStatus: true });
        } else {
            queueManagerUi.renderUserQueues();
        }
    } catch (error) {
        queueManagerUi.setStatus(queueManagerDom.globalStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.queues = false;
    }
}

async function loadQueueMembers(queueId, { statusMessage } = {}) {
    if (!queueId) {
        return;
    }

    queueManagerState.loadingFlags.queueMembers = true;
    queueManagerState.queueMemberSelection.clear();
    queueManagerUi.renderMemberSelectionActions();
    queueManagerUi.setStatus(
        queueManagerDom.queueStatus,
        "info",
        statusMessage || "Mitglieder der ausgewählten Queue werden geladen..."
    );

    try {
        const payload = await queueManagerApi.listQueueMembers(queueId);
        queueManagerState.queueMembers = normalizeMembersResponse(payload);
        queueManagerUi.setStatus(
            queueManagerDom.queueStatus,
            "success",
            `${queueManagerState.queueMembers.length} Mitglieder für die Queue geladen.`
        );
        queueManagerUi.renderMembers();
        queueManagerUi.renderSelectedQueue();
    } catch (error) {
        queueManagerState.queueMembers = [];
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "error", error.message);
        queueManagerUi.renderMembers();
    } finally {
        queueManagerState.loadingFlags.queueMembers = false;
        queueManagerUi.renderSelectedQueue();
    }
}

async function searchUsersForQueue() {
    const query = normalizeText(queueManagerDom.queueUserSearchInput?.value);
    if (!query) {
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "error", "Bitte gib einen Suchbegriff für die Usersuche ein.");
        return;
    }

    queueManagerState.loadingFlags.queueSearch = true;
    queueManagerUi.setStatus(queueManagerDom.queueStatus, "info", `Suche User für Bulk Add mit "${query}"...`);

    try {
        const payload = await queueManagerApi.searchUsers(query);
        queueManagerState.queueUserSearchResults = normalizeUserSearchResponse(payload);
        queueManagerUi.renderQueueSearchResults();
        queueManagerUi.setStatus(
            queueManagerDom.queueStatus,
            "success",
            `${queueManagerState.queueUserSearchResults.length} Suchtreffer für Bulk Add geladen.`
        );
    } catch (error) {
        queueManagerState.queueUserSearchResults = [];
        queueManagerUi.renderQueueSearchResults();
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.queueSearch = false;
    }
}

async function addSelectedUsersToQueue() {
    const queueId = queueManagerState.selectedQueueId;
    const selectedIds = Array.from(queueManagerState.queueAddSelection.keys()).filter(Boolean);
    if (!queueId || !selectedIds.length) {
        return;
    }

    queueManagerState.loadingFlags.queueAdd = true;
    queueManagerUi.renderQueueAddSelectionSummary();
    queueManagerUi.setStatus(queueManagerDom.queueStatus, "info", "Füge ausgewählte User zur Queue hinzu...");

    try {
        const result = await queueManagerApi.addQueueMembers(queueId, { member_ids: selectedIds });
        queueManagerState.queueAddSelection.clear();
        queueManagerUi.renderQueueAddSelectionSummary();
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "success", result?.message || "User wurden zur Queue hinzugefügt.");
        await loadQueueMembers(queueId, { statusMessage: "Mitgliederliste nach Bulk Add wird aktualisiert..." });
        if (queueManagerState.selectedUser) {
            await loadUserQueues(queueManagerState.selectedUser, { silentStatus: true });
        }
    } catch (error) {
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.queueAdd = false;
        queueManagerUi.renderQueueAddSelectionSummary();
    }
}

async function removeSelectedMembersFromQueue() {
    const queueId = queueManagerState.selectedQueueId;
    const selectedIds = Array.from(queueManagerState.queueMemberSelection.values()).filter(Boolean);
    if (!queueId || !selectedIds.length) {
        return;
    }

    if (!window.confirm(`${selectedIds.length} markierte Mitglieder wirklich aus der Queue entfernen?`)) {
        return;
    }

    queueManagerState.loadingFlags.queueRemove = true;
    queueManagerUi.renderMemberSelectionActions();
    queueManagerUi.setStatus(queueManagerDom.queueStatus, "info", "Entferne markierte Mitglieder aus der Queue...");

    try {
        const result = await queueManagerApi.removeQueueMembers(queueId, { member_ids: selectedIds });
        queueManagerState.queueMemberSelection.clear();
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "success", result?.message || "Mitglieder wurden entfernt.");
        await loadQueueMembers(queueId, { statusMessage: "Mitgliederliste nach Bulk Remove wird aktualisiert..." });
        if (queueManagerState.selectedUser) {
            await loadUserQueues(queueManagerState.selectedUser, { silentStatus: true });
        }
    } catch (error) {
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.queueRemove = false;
        queueManagerUi.renderMemberSelectionActions();
    }
}

async function deleteSingleMember(membershipId) {
    const queueId = queueManagerState.selectedQueueId;
    if (!queueId || !membershipId) {
        return;
    }

    if (!window.confirm("Dieses Mitglied wirklich aus der Queue entfernen?")) {
        return;
    }

    queueManagerUi.setStatus(queueManagerDom.queueStatus, "info", "Entferne Mitglied aus der Queue...");

    try {
        const result = await queueManagerApi.deleteQueueMember(queueId, membershipId);
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "success", result?.message || "Mitglied wurde entfernt.");
        await loadQueueMembers(queueId, { statusMessage: "Mitgliederliste wird aktualisiert..." });
        if (queueManagerState.selectedUser) {
            await loadUserQueues(queueManagerState.selectedUser, { silentStatus: true });
        }
    } catch (error) {
        queueManagerUi.setStatus(queueManagerDom.queueStatus, "error", error.message);
    }
}

async function searchUsersForUserWorkspace() {
    const query = normalizeText(queueManagerDom.userSearchInput?.value);
    if (!query) {
        queueManagerUi.setStatus(queueManagerDom.userStatus, "error", "Bitte gib einen Suchbegriff für die User-Suche ein.");
        return;
    }

    queueManagerState.loadingFlags.userSearch = true;
    queueManagerUi.setStatus(queueManagerDom.userStatus, "info", `Suche User mit "${query}"...`);

    try {
        const payload = await queueManagerApi.searchUsers(query);
        queueManagerState.userSearchResults = normalizeUserSearchResponse(payload);
        queueManagerUi.renderUserSearchResults();
        queueManagerUi.setStatus(
            queueManagerDom.userStatus,
            "success",
            `${queueManagerState.userSearchResults.length} User-Treffer geladen.`
        );
    } catch (error) {
        queueManagerState.userSearchResults = [];
        queueManagerUi.renderUserSearchResults();
        queueManagerUi.setStatus(queueManagerDom.userStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.userSearch = false;
    }
}

async function selectUserForWorkspace(userApiId) {
    const fromSearch = queueManagerState.userSearchResults.find(user => getUserApiId(user) === userApiId)
        || queueManagerState.queueUserSearchResults.find(user => getUserApiId(user) === userApiId);

    queueManagerUi.setStatus(queueManagerDom.userStatus, "info", "Lade User-Details und Queue-Zuordnungen...");

    try {
        const user = fromSearch || await queueManagerApi.getUser(userApiId);
        queueManagerState.selectedUser = user;
        queueManagerUi.renderSelectedUser();
        await loadUserQueues(user);
    } catch (error) {
        queueManagerState.selectedUser = null;
        queueManagerUi.renderSelectedUser();
        queueManagerUi.setStatus(queueManagerDom.userStatus, "error", error.message);
    }
}

async function loadUserQueues(user, { silentStatus = false } = {}) {
    const userApiId = getUserApiId(user);
    if (!userApiId) {
        return;
    }

    queueManagerState.loadingFlags.userQueues = true;
    if (!silentStatus) {
        queueManagerUi.setStatus(queueManagerDom.userStatus, "info", "Queue-Zuordnungen des Users werden geladen...");
    }

    try {
        const payload = await queueManagerApi.listUserQueues(userApiId);
        queueManagerState.userQueues = normalizeUserQueuesResponse(payload);
        const loadedIds = new Set(
            queueManagerState.userQueues.map(queue => normalizeText(queue?.queue_id || queue?.id)).filter(Boolean)
        );
        queueManagerState.originalUserQueueIds = new Set(loadedIds);
        queueManagerState.pendingUserQueueIds = new Set(loadedIds);
        if (queueManagerDom.userQueueFilter) queueManagerDom.userQueueFilter.value = "";
        queueManagerUi.renderSelectedUser();
        queueManagerUi.renderUserQueues();
        if (!silentStatus) {
            queueManagerUi.setStatus(
                queueManagerDom.userStatus,
                "success",
                `${queueManagerState.pendingUserQueueIds.size} Queue-Zuordnungen für ${buildUserDisplayName(user)} geladen.`
            );
        }
    } catch (error) {
        queueManagerState.userQueues = [];
        queueManagerState.pendingUserQueueIds = new Set();
        queueManagerUi.renderUserQueues();
        queueManagerUi.setStatus(queueManagerDom.userStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.userQueues = false;
        queueManagerUi.renderSelectedUser();
        queueManagerUi.renderUserQueueActions();
    }
}

function togglePendingQueue(queueId, joined) {
    if (joined) {
        queueManagerState.pendingUserQueueIds.add(queueId);
    } else {
        queueManagerState.pendingUserQueueIds.delete(queueId);
    }
    queueManagerUi.renderUserQueues();
}

async function saveAllUserQueues() {
    const user = queueManagerState.selectedUser;
    const userApiId = getUserApiId(user);
    if (!userApiId) {
        return;
    }

    const toAdd = [...queueManagerState.pendingUserQueueIds].filter(id => !queueManagerState.originalUserQueueIds.has(id));
    const toRemove = [...queueManagerState.originalUserQueueIds].filter(id => !queueManagerState.pendingUserQueueIds.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
        queueManagerUi.setStatus(queueManagerDom.userStatus, "info", "Keine Änderungen zum Speichern.");
        return;
    }

    queueManagerState.loadingFlags.userSave = true;
    queueManagerUi.renderUserQueueActions();
    queueManagerUi.setStatus(queueManagerDom.userStatus, "info", "Speichere Queue-Zuordnungen...");

    try {
        const calls = [];
        if (toAdd.length) {
            calls.push(queueManagerApi.updateUserQueues(userApiId, { queue_ids: toAdd, joined: true }));
        }
        if (toRemove.length) {
            calls.push(queueManagerApi.updateUserQueues(userApiId, { queue_ids: toRemove, joined: false }));
        }

        const results = await Promise.allSettled(calls);
        const errors = results.filter(r => r.status === "rejected").map(r => r.reason?.message);

        if (errors.length === results.length) {
            throw new Error(errors.join(" / "));
        }

        const parts = [];
        if (toAdd.length) parts.push(`${toAdd.length} hinzugefügt`);
        if (toRemove.length) parts.push(`${toRemove.length} entfernt`);
        const summary = parts.join(", ");

        if (errors.length) {
            queueManagerUi.setStatus(queueManagerDom.userStatus, "info", `Teilweise gespeichert (${summary}). Fehler: ${errors.join(", ")}`);
        } else {
            queueManagerUi.setStatus(queueManagerDom.userStatus, "success", `Queue-Zuordnungen gespeichert: ${summary}.`);
        }

        await loadQueues();
        await loadUserQueues(user, { silentStatus: true });
    } catch (error) {
        queueManagerUi.setStatus(queueManagerDom.userStatus, "error", error.message);
    } finally {
        queueManagerState.loadingFlags.userSave = false;
        queueManagerUi.renderUserQueueActions();
    }
}

function handleClick(event) {
    const queueButton = event.target.closest("[data-queue-id]");
    if (queueButton) {
        const queueId = queueButton.getAttribute("data-queue-id") || "";
        queueManagerState.selectedQueueId = queueId;
        queueManagerState.selectedQueue = findQueueById(queueId);
        queueManagerUi.renderQueueStrip();
        queueManagerUi.renderSelectedQueue();
        loadQueueMembers(queueId);
        return;
    }

    const userButton = event.target.closest("[data-select-user-id]");
    if (userButton) {
        selectUserForWorkspace(userButton.getAttribute("data-select-user-id") || "");
        return;
    }

    const deleteMemberButton = event.target.closest("[data-delete-member-id]");
    if (deleteMemberButton) {
        deleteSingleMember(deleteMemberButton.getAttribute("data-delete-member-id") || "");
        return;
    }

}

function handleChange(event) {
    const queueAddCheckbox = event.target.closest("[data-queue-add-id]");
    if (queueAddCheckbox) {
        const userApiId = queueAddCheckbox.getAttribute("data-queue-add-id") || "";
        const user = queueManagerState.queueUserSearchResults.find(item => getUserApiId(item) === userApiId);
        if (queueAddCheckbox.checked && user) {
            queueManagerState.queueAddSelection.set(userApiId, user);
        } else {
            queueManagerState.queueAddSelection.delete(userApiId);
        }
        queueManagerUi.renderQueueAddSelectionSummary();
        return;
    }

    const memberCheckbox = event.target.closest("[data-member-select-id]");
    if (memberCheckbox) {
        const memberApiId = memberCheckbox.getAttribute("data-member-select-id") || "";
        if (memberCheckbox.checked) {
            queueManagerState.queueMemberSelection.add(memberApiId);
        } else {
            queueManagerState.queueMemberSelection.delete(memberApiId);
        }
        queueManagerUi.renderMemberSelectionActions();
        return;
    }

    const userQueueCheckbox = event.target.closest("[data-user-queue-id]");
    if (userQueueCheckbox) {
        const queueId = userQueueCheckbox.getAttribute("data-user-queue-id") || "";
        togglePendingQueue(queueId, userQueueCheckbox.checked);
    }
}

function bindEvents() {
    document.addEventListener("click", handleClick);
    document.addEventListener("change", handleChange);

    queueManagerDom.refreshQueueMembersButton?.addEventListener("click", () => {
        if (queueManagerState.selectedQueueId) {
            loadQueueMembers(queueManagerState.selectedQueueId);
        }
    });

    queueManagerDom.queueUserSearchButton?.addEventListener("click", searchUsersForQueue);
    queueManagerDom.queueUserSearchInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchUsersForQueue();
        }
    });

    queueManagerDom.clearQueueAddSelectionButton?.addEventListener("click", () => {
        queueManagerState.queueAddSelection.clear();
        queueManagerUi.renderQueueSearchResults();
        queueManagerUi.renderQueueAddSelectionSummary();
    });

    queueManagerDom.addQueueMembersButton?.addEventListener("click", addSelectedUsersToQueue);
    queueManagerDom.removeSelectedMembersButton?.addEventListener("click", removeSelectedMembersFromQueue);
    queueManagerDom.clearMemberSelectionButton?.addEventListener("click", () => {
        queueManagerState.queueMemberSelection.clear();
        queueManagerUi.renderMembers();
    });

    queueManagerDom.userSearchButton?.addEventListener("click", searchUsersForUserWorkspace);
    queueManagerDom.userSearchInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchUsersForUserWorkspace();
        }
    });

    queueManagerDom.refreshUserQueuesButton?.addEventListener("click", () => {
        if (queueManagerState.selectedUser) {
            loadUserQueues(queueManagerState.selectedUser);
        }
    });

    queueManagerDom.resetUserQueueSelectionButton?.addEventListener("click", () => {
        if (queueManagerState.selectedUser) {
            loadUserQueues(queueManagerState.selectedUser, { silentStatus: true });
        }
    });

    queueManagerDom.saveUserQueuesButton?.addEventListener("click", saveAllUserQueues);

    queueManagerDom.queueStripFilter?.addEventListener("input", event => {
        filterQueueStrip(event.target.value);
    });

    queueManagerDom.userQueueFilter?.addEventListener("input", event => {
        filterUserQueueList(event.target.value);
    });
}

async function initializeQueueManager() {
    queueManagerUi.cacheDom();
    queueManagerUi.syncAll();
    bindEvents();

    try {
        await loadQueues({ preserveSelection: false });
    } catch (_error) {
        // Fehlerstatus wird bereits in loadQueues gesetzt.
    }
}

document.addEventListener("DOMContentLoaded", initializeQueueManager);
