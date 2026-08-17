"use strict";

/* ── Mock reference data (demo only, no backend) ──────────────────── */

const MOCK_MEDIA_TYPES = [
    { id: "debitkarte", label: "Debitkarte" },
    { id: "kreditkarte", label: "Kreditkarte" },
    { id: "onlinebanking", label: "Onlinebanking" },
    { id: "bezahlkarte", label: "Bezahlkarte" },
    { id: "virtuelle_karte", label: "Virtuelle Karte" },
    { id: "telefonbanking", label: "Telefonbanking" },
];

const BLOCK_REASONS = [
    { value: "verloren", label: "Verloren" },
    { value: "gestohlen", label: "Gestohlen" },
    { value: "missbrauch", label: "Missbrauch/Kompromittiert" },
    { value: "sonstiges", label: "Sonstiges" },
];

const MOCK_ISSUERS = [
    {
        id: "issuer-1",
        name: "Sparkasse Musterstadt",
        hotlineNumber: "0800 123 456",
        mediaTypes: {
            debitkarte: { resolvedAction: "auto_block", mailNotifyIssuer: true, extraMeasures: [] },
            kreditkarte: {
                resolvedAction: "auto_block", mailNotifyIssuer: true, extraMeasures: [
                    { id: "ersatzkarte", label: "Ersatzkarte veranlasst" },
                    { id: "limit_null", label: "Limit auf 0 gesetzt" },
                ],
            },
            onlinebanking: { resolvedAction: "auto_block", mailNotifyIssuer: false, extraMeasures: [] },
        },
    },
    {
        id: "issuer-2",
        name: "Volksbank Beispielhausen",
        hotlineNumber: "0800 987 654",
        mediaTypes: {
            kreditkarte: {
                resolvedAction: "confirm_external_block", mailNotifyIssuer: true, extraMeasures: [
                    { id: "ersatzkarte", label: "Ersatzkarte veranlasst" },
                ],
            },
            bezahlkarte: { resolvedAction: "confirm_external_block", mailNotifyIssuer: false, extraMeasures: [] },
        },
    },
    {
        id: "issuer-3",
        name: "Deutsche Kreditbank Demo",
        hotlineNumber: "0800 555 111",
        mediaTypes: {
            virtuelle_karte: { resolvedAction: "mail_issuer_block_request", mailNotifyIssuer: false, extraMeasures: [] },
            onlinebanking: { resolvedAction: "mail_issuer_block_request", mailNotifyIssuer: false, extraMeasures: [] },
        },
    },
    {
        id: "issuer-4",
        name: "Regionalbank Nord eG",
        hotlineNumber: "0800 222 333",
        mediaTypes: {
            debitkarte: { resolvedAction: "call_forwarding", mailNotifyIssuer: false, extraMeasures: [] },
            kreditkarte: { resolvedAction: "call_forwarding", mailNotifyIssuer: false, extraMeasures: [] },
            telefonbanking: { resolvedAction: "call_forwarding", mailNotifyIssuer: false, extraMeasures: [] },
        },
    },
    {
        id: "issuer-5",
        name: "Fintech Digitalbank",
        hotlineNumber: "0800 444 777",
        mediaTypes: {
            bezahlkarte: { resolvedAction: "call_forwarding", mailNotifyIssuer: false, extraMeasures: [] },
            virtuelle_karte: {
                resolvedAction: "auto_block", mailNotifyIssuer: true, extraMeasures: [
                    { id: "limit_null", label: "Limit auf 0 gesetzt" },
                ],
            },
        },
    },
    {
        id: "issuer-6",
        name: "Landessparkasse Ost",
        hotlineNumber: "0800 666 888",
        mediaTypes: {
            debitkarte: { resolvedAction: "confirm_external_block", mailNotifyIssuer: true, extraMeasures: [] },
            onlinebanking: { resolvedAction: "auto_block", mailNotifyIssuer: false, extraMeasures: [] },
            telefonbanking: { resolvedAction: "mail_issuer_block_request", mailNotifyIssuer: false, extraMeasures: [] },
        },
    },
    {
        id: "issuer-7",
        name: "Privatbank Kontor",
        hotlineNumber: "0800 999 000",
        mediaTypes: {
            kreditkarte: {
                resolvedAction: "auto_block", mailNotifyIssuer: true, extraMeasures: [
                    { id: "ersatzkarte", label: "Ersatzkarte veranlasst" },
                    { id: "reise_info", label: "Reiseinformation hinterlegt" },
                ],
            },
        },
    },
];

const ACTION_META = {
    auto_block: { verb: "Sperren", confirmTitle: "Sperrung bestätigen", confirmCopy: "Das Medium wird sofort in unserem System gesperrt. Dieser Schritt ist nicht rückgängig zu machen.", needsModal: true, doneLabel: "Gesperrt" },
    confirm_external_block: { verb: "Sperrung bestätigen", confirmTitle: "Bestätigung", confirmCopy: "Die Sperrung erfolgt im System des Herausgebers. Mit der Bestätigung wird dieser Vorgang als erledigt dokumentiert.", needsModal: true, doneLabel: "Bestätigt" },
    mail_issuer_block_request: { verb: "Sperrauftrag senden", confirmTitle: "Sperrauftrag versenden", confirmCopy: "Der Herausgeber wird per E-Mail beauftragt, die Sperrung selbst durchzuführen. Wir sperren das Medium nicht selbst.", needsModal: true, doneLabel: "Sperrauftrag versendet" },
    call_forwarding: { verb: "Zur Weiterleitung vormerken", confirmTitle: "", confirmCopy: "", needsModal: false, doneLabel: "Weitergeleitet" },
};

const ACTION_DESCRIPTIONS = {
    auto_block: "Direkte Sperrung in unserem System",
    confirm_external_block: "Sperrung erfolgt im System des Herausgebers – wird hier bestätigt",
    mail_issuer_block_request: "Sperrauftrag wird per E-Mail an den Herausgeber gesendet",
    call_forwarding: "Anruf wird an die Hotline des Herausgebers weitergeleitet",
};

const ROLE_LABELS = {
    anrufer: { label: "Anrufer", chipClass: "ui-chip-primary" },
    karteninhaber: { label: "Karteninhaber", chipClass: "ui-chip-accent" },
    bankmitarbeiter_ia: { label: "Bankmitarbeiter i.A.", chipClass: "ui-chip-purple" },
};

/* ── Helpers ───────────────────────────────────────────────────────── */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatTimestamp(iso) {
    if (!iso) return "–";
    return new Date(iso).toLocaleString("de-DE");
}

function generateReferenceNumber() {
    const year = new Date().getFullYear();
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `SPR-${year}-${rand}`;
}

function blockReasonLabel(value) {
    const r = BLOCK_REASONS.find((b) => b.value === value);
    return r ? r.label : "–";
}

function eligibleIssuersForType(mediaTypeId) {
    return MOCK_ISSUERS.filter((iss) => iss.mediaTypes[mediaTypeId]);
}

function getStatusInfo(item) {
    switch (item.state) {
        case "open": return { cls: "ui-status-open", label: "Offen" };
        case "issuer_linked": return { cls: "ui-status-progress", label: "Karteninhaber offen" };
        case "holder_linked": return { cls: "ui-status-progress", label: "Details offen" };
        case "action_pending": return { cls: "ui-status-progress", label: "Bereit zur Ausführung" };
        case "staged": return { cls: "ui-status-blocked", label: "Vorgemerkt (Weiterleitung)" };
        case "completed": return { cls: "ui-status-completed", label: "Abgeschlossen" };
        default: return { cls: "ui-status-neutral", label: "" };
    }
}

/* ── State ─────────────────────────────────────────────────────────── */

const mediaBlockingState = {
    workItems: [],
    personBlocks: [],
    selectedItemId: null,
    callerIsHolder: true,
    sessionEnded: false,
    nextItemSeq: 1,
    nextPersonSeq: 1,
    searchQuery: "",
    pendingRemoval: null,
    pendingAction: null,
};

const dom = {};

function cacheDom() {
    dom.typeBar = document.getElementById("mb-media-type-bar");
    dom.workList = document.getElementById("mb-work-list");
    dom.workspace = document.getElementById("mb-workspace");
    dom.workspaceLayout = document.getElementById("mb-workspace-layout");
    dom.personRail = document.getElementById("mb-person-rail");
    dom.addPersonBtn = document.getElementById("mb-add-person-btn");
    dom.searchSection = document.getElementById("mb-search-section");
    dom.searchInput = document.getElementById("mb-issuer-search");
    dom.searchResults = document.getElementById("mb-issuer-search-results");
    dom.sessionPanel = document.getElementById("mb-session-panel");

    dom.removeModal = document.getElementById("mb-remove-confirm-modal");
    dom.removeBody = document.getElementById("mb-remove-confirm-body");
    dom.removeCancelBtn = document.getElementById("mb-remove-cancel-btn");
    dom.removeConfirmBtn = document.getElementById("mb-remove-confirm-btn");
    dom.removeCloseBtn = document.getElementById("mb-remove-close-btn");

    dom.actionModal = document.getElementById("mb-confirm-action-modal");
    dom.actionTitle = document.getElementById("mb-confirm-action-title");
    dom.actionBody = document.getElementById("mb-confirm-action-body");
    dom.actionCancelBtn = document.getElementById("mb-action-cancel-btn");
    dom.actionConfirmBtn = document.getElementById("mb-action-confirm-btn");
    dom.actionCloseBtn = document.getElementById("mb-action-close-btn");
}

function getSelectedItem() {
    return mediaBlockingState.workItems.find((i) => i.id === mediaBlockingState.selectedItemId) || null;
}

function getUnresolvedCount() {
    return mediaBlockingState.workItems.filter((i) => ["open", "issuer_linked", "holder_linked", "action_pending"].includes(i.state)).length;
}

function computeRoutingQueue() {
    const map = new Map();
    mediaBlockingState.workItems.filter((i) => i.state === "staged").forEach((item) => {
        const issuerId = item.issuer.id;
        if (!map.has(issuerId)) {
            const issuer = MOCK_ISSUERS.find((iss) => iss.id === issuerId);
            map.set(issuerId, { issuerId, issuerName: item.issuer.name, hotlineNumber: issuer ? issuer.hotlineNumber : "", workItemIds: [] });
        }
        map.get(issuerId).workItemIds.push(item.id);
    });
    return Array.from(map.values());
}

function holderLabel(item) {
    if (item.holderPersonId === "unbekannt") return "Unbekannt / nicht identifiziert";
    const p = mediaBlockingState.personBlocks.find((pb) => pb.id === item.holderPersonId);
    if (!p) return "–";
    return p.id === "anrufer" ? "Anrufer" : (p.name || "Neue Person");
}

/* ── Rendering ─────────────────────────────────────────────────────── */

function renderAll() {
    applySessionVisibility();
    renderTypeBar();
    renderWorkList();
    renderWorkspace();
    renderPersonRail();
    renderSessionPanel();
}

function applySessionVisibility() {
    const ended = mediaBlockingState.sessionEnded;
    dom.searchSection.hidden = ended;
    dom.typeBar.hidden = ended;
    dom.workspaceLayout.hidden = ended;
}

function renderTypeBar() {
    dom.typeBar.innerHTML = MOCK_MEDIA_TYPES.map((type) => {
        const count = mediaBlockingState.workItems.filter((i) => i.mediaTypeId === type.id).length;
        return `
            <div class="media-blocking-type-card">
                <span class="media-blocking-type-label">${escapeHtml(type.label)}</span>
                <span class="ui-count-pill ui-count-pill-info">${count}</span>
                <button type="button" class="media-blocking-type-add" data-add-type="${type.id}" aria-label="${escapeHtml(type.label)} hinzufügen">+</button>
            </div>
        `;
    }).join("");
}

function renderWorkList() {
    if (!mediaBlockingState.workItems.length) {
        dom.workList.innerHTML = `<div class="ui-empty-state ui-empty-inline">Noch keine Vorgänge — über die Medientypen oben starten.</div>`;
        return;
    }
    dom.workList.innerHTML = mediaBlockingState.workItems.map((item) => {
        const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
        const status = getStatusInfo(item);
        const sub = item.issuer ? item.issuer.name : "Herausgeber offen";
        const selected = item.id === mediaBlockingState.selectedItemId ? " is-selected" : "";
        const removable = item.state !== "completed";
        return `
            <div class="media-blocking-work-item${selected}" data-select-item="${item.id}">
                <div class="media-blocking-work-item-main">
                    <span class="media-blocking-work-item-title">${type ? escapeHtml(type.label) : ""}</span>
                    <span class="media-blocking-work-item-sub">${escapeHtml(sub)}</span>
                </div>
                <span class="ui-status-badge ${status.cls}">${status.label}</span>
                ${removable ? `<button type="button" class="media-blocking-row-remove" data-remove-item="${item.id}" aria-label="Vorgang entfernen">&times;</button>` : ""}
            </div>
        `;
    }).join("");
}

function renderRecap(item, fields) {
    const rows = [];
    if (fields.includes("issuer")) rows.push(`<div class="media-blocking-recap-row"><span>Herausgeber</span><strong>${item.issuer ? escapeHtml(item.issuer.name) : "–"}</strong></div>`);
    if (fields.includes("holder")) rows.push(`<div class="media-blocking-recap-row"><span>Karteninhaber</span><strong>${escapeHtml(holderLabel(item))}</strong></div>`);
    if (fields.includes("details")) {
        rows.push(`<div class="media-blocking-recap-row"><span>Letzte 4 Ziffern</span><strong>${escapeHtml(item.details.lastFourDigits || "–")}</strong></div>`);
        rows.push(`<div class="media-blocking-recap-row"><span>Grund</span><strong>${escapeHtml(blockReasonLabel(item.details.blockReason))}</strong></div>`);
    }
    return `<div class="media-blocking-recap">${rows.join("")}</div>`;
}

function renderIssuerOptions(item, query) {
    const options = eligibleIssuersForType(item.mediaTypeId)
        .filter((iss) => iss.name.toLowerCase().includes(query.toLowerCase()));
    if (!options.length) {
        return `<div class="media-blocking-search-empty">Keine Herausgeber gefunden.</div>`;
    }
    return options.map((iss) => `
        <button type="button" class="media-blocking-issuer-option" data-pick-issuer="${item.id}:${iss.id}">
            <span>${escapeHtml(iss.name)}</span>
            <span class="ui-chip ui-chip-neutral">wählen</span>
        </button>
    `).join("");
}

function renderStepIssuer(item) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    return `
        <div class="media-blocking-step" data-step="issuer" data-item-id="${item.id}">
            <span class="media-blocking-step-title">Herausgeber wählen — ${escapeHtml(type.label)}</span>
            <div class="ui-field-group">
                <label class="ui-field-label" for="mb-issuer-filter">Filtern</label>
                <input class="ui-input" id="mb-issuer-filter" type="search" placeholder="Herausgeber suchen…" autocomplete="off">
            </div>
            <div class="media-blocking-option-list" id="mb-issuer-option-list">
                ${renderIssuerOptions(item, "")}
            </div>
        </div>
    `;
}

function renderStepHolder(item) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    const recap = renderRecap(item, ["issuer"]);
    const options = mediaBlockingState.personBlocks.map((p) => `
        <button type="button" class="media-blocking-holder-option" data-pick-holder="${item.id}:${p.id}">
            <span>${p.id === "anrufer" ? "Anrufer" : escapeHtml(p.name || "Neue Person")}</span>
            <span class="ui-chip ui-chip-neutral">wählen</span>
        </button>
    `).join("");
    return `
        <div class="media-blocking-step" data-step="holder" data-item-id="${item.id}">
            <span class="media-blocking-step-title">Karteninhaber verknüpfen — ${escapeHtml(type.label)}</span>
            ${recap}
            <div class="media-blocking-option-list">
                ${options}
                <button type="button" class="media-blocking-holder-option" data-pick-holder="${item.id}:unbekannt">
                    <span>Unbekannt / nicht identifiziert</span>
                    <span class="ui-chip ui-chip-neutral">wählen</span>
                </button>
            </div>
        </div>
    `;
}

function renderStepDetails(item) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    const recap = renderRecap(item, ["issuer", "holder"]);
    const showExpiry = item.mediaTypeId !== "onlinebanking" && item.mediaTypeId !== "telefonbanking";
    const extras = item.availableExtraMeasures;
    const extrasHtml = extras.length
        ? extras.map((m) => `
            <label class="media-blocking-extra-measure">
                <input type="checkbox" data-toggle-extra="${item.id}:${m.id}" ${item.selectedExtraMeasures.includes(m.id) ? "checked" : ""}>
                ${escapeHtml(m.label)}
            </label>
        `).join("")
        : `<span class="media-blocking-search-empty">Keine zusätzlichen Maßnahmen für diesen Herausgeber verfügbar.</span>`;

    return `
        <div class="media-blocking-step" data-step="details" data-item-id="${item.id}">
            <span class="media-blocking-step-title">Details erfassen — ${escapeHtml(type.label)}</span>
            ${recap}
            <div class="media-blocking-form-row">
                <div class="ui-field-group">
                    <label class="ui-field-label" for="mb-detail-last4">Letzte 4 Ziffern</label>
                    <input class="ui-input" id="mb-detail-last4" type="text" maxlength="4" inputmode="numeric" value="${escapeHtml(item.details.lastFourDigits || "")}">
                </div>
                ${showExpiry ? `
                <div class="ui-field-group">
                    <label class="ui-field-label" for="mb-detail-expiry">Ablaufdatum</label>
                    <input class="ui-input" id="mb-detail-expiry" type="text" placeholder="MM/JJ" value="${escapeHtml(item.details.expiry || "")}">
                </div>` : ""}
            </div>
            <div class="ui-field-group">
                <label class="ui-field-label" for="mb-detail-reason">Grund</label>
                <select class="ui-input" id="mb-detail-reason">
                    <option value="">Bitte wählen…</option>
                    ${BLOCK_REASONS.map((r) => `<option value="${r.value}" ${item.details.blockReason === r.value ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("")}
                </select>
            </div>
            <div class="ui-field-group">
                <label class="ui-field-label" for="mb-detail-note">Notiz</label>
                <textarea class="ui-textarea" id="mb-detail-note" rows="3" placeholder="Optionale Notiz zu diesem Vorgang…">${escapeHtml(item.details.note || "")}</textarea>
            </div>
            <div class="media-blocking-extra-measures${extras.length ? "" : " is-disabled"}">
                <span class="media-blocking-resolved-action-label">Sonstige Maßnahmen</span>
                ${extrasHtml}
            </div>
            <div id="mb-detail-error" class="media-blocking-field-error" hidden></div>
            <div class="media-blocking-step-actions">
                <button type="button" class="btn btn-primary" data-save-details="${item.id}">Weiter</button>
            </div>
        </div>
    `;
}

function renderStepAction(item) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    const recap = renderRecap(item, ["issuer", "holder", "details"]);
    const meta = ACTION_META[item.resolvedAction];
    const extrasChosen = item.selectedExtraMeasures.map((id) => {
        const m = item.availableExtraMeasures.find((x) => x.id === id);
        return m ? m.label : id;
    });
    return `
        <div class="media-blocking-step" data-step="action" data-item-id="${item.id}">
            <span class="media-blocking-step-title">Prüfen &amp; ausführen — ${escapeHtml(type.label)}</span>
            ${recap}
            <div class="media-blocking-resolved-action">
                <span class="media-blocking-resolved-action-label">Aktion (automatisch ermittelt)</span>
                <strong>${escapeHtml(ACTION_DESCRIPTIONS[item.resolvedAction])}</strong>
                ${item.mailNotifyIssuer ? `<span class="ui-field-hint">Herausgeber wird automatisch per E-Mail benachrichtigt.</span>` : ""}
            </div>
            ${extrasChosen.length ? `
            <div class="media-blocking-recap">
                <div class="media-blocking-recap-row"><span>Sonstige Maßnahmen</span><strong>${extrasChosen.map((l) => escapeHtml(l)).join(", ")}</strong></div>
            </div>` : ""}
            <div class="media-blocking-step-actions">
                <button type="button" class="btn btn-red" data-run-action="${item.id}">${escapeHtml(meta.verb)}</button>
            </div>
        </div>
    `;
}

function renderStepSummaryReadonly(item) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    const recap = renderRecap(item, ["issuer", "holder", "details"]);
    const status = getStatusInfo(item);
    const resultHtml = item.result
        ? `<div class="media-blocking-recap">
            <div class="media-blocking-recap-row"><span>Referenz</span><strong>${escapeHtml(item.result.referenceNumber)}</strong></div>
            <div class="media-blocking-recap-row"><span>Zeitpunkt</span><strong>${formatTimestamp(item.result.completedAt)}</strong></div>
        </div>`
        : `<p class="ui-field-hint">Zur Weiterleitung vorgemerkt — wird beim Beenden des Gesprächs übermittelt. Solange das Gespräch läuft, kann dieser Vorgang noch entfernt werden.</p>`;
    return `
        <div class="media-blocking-step" data-step="readonly" data-item-id="${item.id}">
            <span class="media-blocking-step-title">${escapeHtml(type.label)} — <span class="ui-status-badge ${status.cls}">${status.label}</span></span>
            ${recap}
            <div class="media-blocking-resolved-action">
                <span class="media-blocking-resolved-action-label">Aktion</span>
                <strong>${escapeHtml(ACTION_DESCRIPTIONS[item.resolvedAction])}</strong>
            </div>
            ${resultHtml}
        </div>
    `;
}

function renderWorkspace() {
    const item = getSelectedItem();
    if (!item) {
        dom.workspace.innerHTML = `
            <div class="ui-empty-state">
                <div>
                    <p><strong>Kein Vorgang ausgewählt</strong></p>
                    <p>Über die Medientypen oben einen neuen Vorgang starten oder in der Bearbeitungsliste einen bestehenden auswählen.</p>
                </div>
            </div>
        `;
        return;
    }
    if (item.state === "open") dom.workspace.innerHTML = renderStepIssuer(item);
    else if (item.state === "issuer_linked") dom.workspace.innerHTML = renderStepHolder(item);
    else if (item.state === "holder_linked") dom.workspace.innerHTML = renderStepDetails(item);
    else if (item.state === "action_pending") dom.workspace.innerHTML = renderStepAction(item);
    else dom.workspace.innerHTML = renderStepSummaryReadonly(item);
}

function renderPersonBlock(person) {
    const isAnrufer = person.id === "anrufer";
    let chipsHtml;
    if (isAnrufer) {
        const chips = person.roles.map((r) => `<span class="ui-chip ${ROLE_LABELS[r].chipClass}">${ROLE_LABELS[r].label}</span>`).join("");
        chipsHtml = `<div class="media-blocking-person-chips">${chips}</div>`;
    } else {
        const toggleableRoles = ["karteninhaber", "bankmitarbeiter_ia"];
        const buttons = toggleableRoles.map((r) => {
            const info = ROLE_LABELS[r];
            const active = person.roles.includes(r);
            return `<button type="button" class="ui-chip ${active ? info.chipClass : "ui-chip-neutral"}" data-toggle-role="${person.id}:${r}">${info.label}</button>`;
        }).join("");
        chipsHtml = `<div class="media-blocking-person-chips">${buttons}</div>`;
    }

    return `
        <div class="media-blocking-person-block${isAnrufer ? " is-anrufer" : ""}">
            <div class="media-blocking-person-head">
                <span class="media-blocking-person-name">${isAnrufer ? "Anrufer" : escapeHtml(person.name || "Neue Person")}</span>
                ${!isAnrufer ? `<button type="button" class="media-blocking-row-remove" data-remove-person="${person.id}" aria-label="Person entfernen">&times;</button>` : ""}
            </div>
            ${chipsHtml}
            <div class="ui-field-group">
                <label class="ui-field-label" for="mb-person-name-${person.id}">Name</label>
                <input class="ui-input" id="mb-person-name-${person.id}" type="text" value="${escapeHtml(person.name)}" data-person-name="${person.id}" placeholder="Vor- und Nachname">
            </div>
            <div class="ui-field-group">
                <label class="ui-field-label" for="mb-person-phone-${person.id}">Rückrufnummer</label>
                <input class="ui-input" id="mb-person-phone-${person.id}" type="text" value="${escapeHtml(person.callbackNumber)}" data-person-phone="${person.id}" placeholder="+49…">
            </div>
            ${isAnrufer ? `
            <label class="media-blocking-caller-holder-toggle">
                <input type="checkbox" id="mb-caller-is-holder" ${mediaBlockingState.callerIsHolder ? "checked" : ""}>
                Anrufer ist Karteninhaber
            </label>` : ""}
        </div>
    `;
}

function renderPersonRail() {
    dom.personRail.innerHTML = mediaBlockingState.personBlocks.map((p) => renderPersonBlock(p)).join("");
    dom.addPersonBtn.hidden = mediaBlockingState.callerIsHolder;
}

function renderSearchResults() {
    const q = mediaBlockingState.searchQuery.trim().toLowerCase();
    if (!q) {
        dom.searchResults.hidden = true;
        dom.searchResults.innerHTML = "";
        return;
    }
    const matches = MOCK_ISSUERS.filter((iss) => iss.name.toLowerCase().includes(q));
    if (!matches.length) {
        dom.searchResults.innerHTML = `<div class="media-blocking-search-empty">Keine Treffer.</div>`;
        dom.searchResults.hidden = false;
        return;
    }
    dom.searchResults.innerHTML = matches.map((iss) => {
        const chips = Object.keys(iss.mediaTypes).map((mtId) => {
            const type = MOCK_MEDIA_TYPES.find((t) => t.id === mtId);
            return `<button type="button" class="ui-chip ui-chip-neutral" data-search-pick="${iss.id}:${mtId}">${escapeHtml(type ? type.label : mtId)}</button>`;
        }).join("");
        return `
            <div class="media-blocking-search-result-item">
                <span class="media-blocking-search-result-name">${escapeHtml(iss.name)}</span>
                <div class="media-blocking-search-result-types">${chips}</div>
            </div>
        `;
    }).join("");
    dom.searchResults.hidden = false;
}

function renderSessionPanel() {
    if (mediaBlockingState.sessionEnded) {
        const items = mediaBlockingState.workItems.map((item) => {
            const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
            const meta = ACTION_META[item.resolvedAction];
            const extrasChosen = item.selectedExtraMeasures.map((id) => {
                const m = item.availableExtraMeasures.find((x) => x.id === id);
                return m ? m.label : id;
            });
            return `
                <div class="media-blocking-summary-item">
                    <strong>${escapeHtml(type.label)} — ${escapeHtml(item.issuer ? item.issuer.name : "–")}</strong>
                    <span>${escapeHtml(ACTION_DESCRIPTIONS[item.resolvedAction])}${meta.doneLabel ? " · " + escapeHtml(meta.doneLabel) : ""}</span>
                    ${item.result ? `<span class="ui-field-hint">Referenz ${escapeHtml(item.result.referenceNumber)} · ${formatTimestamp(item.result.completedAt)}</span>` : ""}
                    ${extrasChosen.length ? `<span class="ui-field-hint">Sonstige Maßnahmen: ${extrasChosen.map((l) => escapeHtml(l)).join(", ")}</span>` : ""}
                </div>
            `;
        }).join("");

        dom.sessionPanel.innerHTML = `
            <div class="media-blocking-session-panel-bar">
                <span class="media-blocking-column-title">Sitzung abgeschlossen</span>
                <button type="button" class="btn btn-secondary" data-new-session>Neue Sitzung starten</button>
            </div>
            ${items || '<p class="ui-field-hint">Keine Vorgänge in dieser Sitzung.</p>'}
        `;
        return;
    }

    const unresolved = getUnresolvedCount();
    const routingQueue = computeRoutingQueue();
    let statusText;
    if (!mediaBlockingState.workItems.length) {
        statusText = "Noch keine Vorgänge in dieser Sitzung.";
    } else if (unresolved > 0) {
        statusText = `${unresolved} offene${unresolved === 1 ? "r" : ""} Vorgang${unresolved === 1 ? "" : "e"} — Gespräch kann noch nicht beendet werden.`;
    } else {
        const routingNote = routingQueue.length ? ` · ${routingQueue.length} Weiterleitung${routingQueue.length === 1 ? "" : "en"} vorgemerkt` : "";
        statusText = `Alle Vorgänge bearbeitet.${routingNote}`;
    }

    dom.sessionPanel.innerHTML = `
        <div class="media-blocking-session-panel-bar">
            <span class="media-blocking-session-status">${escapeHtml(statusText)}</span>
            <button type="button" class="btn btn-primary" data-end-session ${unresolved > 0 ? "disabled" : ""}>Gespräch beenden</button>
        </div>
    `;
}

/* ── Modal helpers ─────────────────────────────────────────────────── */

function openModal(modalEl) {
    modalEl.classList.add("active");
    modalEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function closeModal(modalEl) {
    modalEl.classList.remove("active");
    modalEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

function openRemoveModal(item) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    dom.removeBody.textContent = `Dieser Vorgang (${type.label}${item.issuer ? ", " + item.issuer.name : ""}) enthält bereits erfasste Angaben. Wirklich entfernen?`;
    openModal(dom.removeModal);
}

function closeRemoveModal() {
    closeModal(dom.removeModal);
    mediaBlockingState.pendingRemoval = null;
}

function confirmRemoval() {
    if (!mediaBlockingState.pendingRemoval) return;
    removeItem(mediaBlockingState.pendingRemoval.itemId);
    mediaBlockingState.pendingRemoval = null;
    closeModal(dom.removeModal);
}

function openActionModal(item, meta) {
    const type = MOCK_MEDIA_TYPES.find((t) => t.id === item.mediaTypeId);
    dom.actionTitle.textContent = meta.confirmTitle;
    dom.actionBody.innerHTML = `
        <p>${escapeHtml(meta.confirmCopy)}</p>
        <div class="media-blocking-recap">
            <div class="media-blocking-recap-row"><span>Medium</span><strong>${escapeHtml(type.label)}</strong></div>
            <div class="media-blocking-recap-row"><span>Herausgeber</span><strong>${escapeHtml(item.issuer.name)}</strong></div>
        </div>
    `;
    dom.actionConfirmBtn.textContent = meta.verb;
    openModal(dom.actionModal);
}

function closeActionModal() {
    closeModal(dom.actionModal);
    mediaBlockingState.pendingAction = null;
}

function confirmAction() {
    if (!mediaBlockingState.pendingAction) return;
    const item = mediaBlockingState.workItems.find((i) => i.id === mediaBlockingState.pendingAction.itemId);
    if (item) {
        item.result = { referenceNumber: generateReferenceNumber(), completedAt: new Date().toISOString() };
        item.state = "completed";
    }
    mediaBlockingState.pendingAction = null;
    closeModal(dom.actionModal);
    renderAll();
}

/* ── State-mutating handlers ──────────────────────────────────────── */

function handleAddItem(mediaTypeId) {
    if (mediaBlockingState.sessionEnded) return;
    const id = `item-${mediaBlockingState.nextItemSeq++}`;
    mediaBlockingState.workItems.push({
        id, mediaTypeId,
        state: "open",
        issuer: null,
        resolvedAction: null,
        mailNotifyIssuer: false,
        availableExtraMeasures: [],
        selectedExtraMeasures: [],
        holderPersonId: null,
        details: { lastFourDigits: "", expiry: "", blockReason: "", note: "" },
        result: null,
        createdAt: new Date().toISOString(),
    });
    mediaBlockingState.selectedItemId = id;
    renderAll();
}

function handleSelectItem(itemId) {
    mediaBlockingState.selectedItemId = itemId;
    renderWorkList();
    renderWorkspace();
}

function handleIssuerSelect(itemId, issuerId) {
    const item = mediaBlockingState.workItems.find((i) => i.id === itemId);
    const issuer = MOCK_ISSUERS.find((i) => i.id === issuerId);
    if (!item || !issuer) return;
    const config = issuer.mediaTypes[item.mediaTypeId];
    if (!config) return;
    item.issuer = { id: issuer.id, name: issuer.name };
    item.resolvedAction = config.resolvedAction;
    item.mailNotifyIssuer = !!config.mailNotifyIssuer;
    item.availableExtraMeasures = config.extraMeasures || [];
    item.selectedExtraMeasures = [];
    item.state = "issuer_linked";
    renderAll();
}

function handleHolderSelect(itemId, personId) {
    const item = mediaBlockingState.workItems.find((i) => i.id === itemId);
    if (!item) return;
    item.holderPersonId = personId;
    item.state = "holder_linked";
    renderAll();
}

function handleSaveDetails(itemId) {
    const item = mediaBlockingState.workItems.find((i) => i.id === itemId);
    if (!item) return;
    const last4 = document.getElementById("mb-detail-last4")?.value.trim() || "";
    const expiryInput = document.getElementById("mb-detail-expiry");
    const expiry = expiryInput ? expiryInput.value.trim() : "";
    const reason = document.getElementById("mb-detail-reason")?.value || "";
    const note = document.getElementById("mb-detail-note")?.value.trim() || "";
    const errorEl = document.getElementById("mb-detail-error");

    if (!/^\d{4}$/.test(last4)) {
        errorEl.textContent = "Bitte die letzten 4 Ziffern angeben (genau 4 Zahlen).";
        errorEl.hidden = false;
        return;
    }
    if (!reason) {
        errorEl.textContent = "Bitte einen Grund auswählen.";
        errorEl.hidden = false;
        return;
    }

    item.details = { lastFourDigits: last4, expiry, blockReason: reason, note };
    item.state = "action_pending";
    renderAll();
}

function handleToggleExtra(itemId, measureId, checked) {
    const item = mediaBlockingState.workItems.find((i) => i.id === itemId);
    if (!item) return;
    const set = new Set(item.selectedExtraMeasures);
    if (checked) set.add(measureId); else set.delete(measureId);
    item.selectedExtraMeasures = Array.from(set);
}

function handleRunAction(itemId) {
    const item = mediaBlockingState.workItems.find((i) => i.id === itemId);
    if (!item) return;
    const meta = ACTION_META[item.resolvedAction];
    if (!meta.needsModal) {
        item.state = "staged";
        renderAll();
        return;
    }
    mediaBlockingState.pendingAction = { itemId };
    openActionModal(item, meta);
}

function removeItem(itemId) {
    mediaBlockingState.workItems = mediaBlockingState.workItems.filter((i) => i.id !== itemId);
    if (mediaBlockingState.selectedItemId === itemId) {
        mediaBlockingState.selectedItemId = null;
    }
    renderAll();
}

function handleRemoveClick(itemId) {
    const item = mediaBlockingState.workItems.find((i) => i.id === itemId);
    if (!item) return;
    if (item.state === "open" || item.state === "staged") {
        removeItem(itemId);
        return;
    }
    mediaBlockingState.pendingRemoval = { itemId };
    openRemoveModal(item);
}

function handleSearchInput(e) {
    mediaBlockingState.searchQuery = e.target.value;
    renderSearchResults();
}

function handleSearchPick(issuerId, mediaTypeId) {
    const issuer = MOCK_ISSUERS.find((i) => i.id === issuerId);
    const config = issuer ? issuer.mediaTypes[mediaTypeId] : null;
    if (!issuer || !config) return;
    const id = `item-${mediaBlockingState.nextItemSeq++}`;
    mediaBlockingState.workItems.push({
        id, mediaTypeId,
        state: "issuer_linked",
        issuer: { id: issuer.id, name: issuer.name },
        resolvedAction: config.resolvedAction,
        mailNotifyIssuer: !!config.mailNotifyIssuer,
        availableExtraMeasures: config.extraMeasures || [],
        selectedExtraMeasures: [],
        holderPersonId: null,
        details: { lastFourDigits: "", expiry: "", blockReason: "", note: "" },
        result: null,
        createdAt: new Date().toISOString(),
    });
    mediaBlockingState.selectedItemId = id;
    mediaBlockingState.searchQuery = "";
    dom.searchInput.value = "";
    dom.searchResults.hidden = true;
    renderAll();
}

function handleCallerHolderToggle(checked) {
    mediaBlockingState.callerIsHolder = checked;
    const anrufer = mediaBlockingState.personBlocks.find((p) => p.id === "anrufer");
    if (anrufer) {
        const set = new Set(anrufer.roles);
        if (checked) set.add("karteninhaber"); else set.delete("karteninhaber");
        anrufer.roles = Array.from(set);
    }
    renderPersonRail();
}

function handleAddPerson() {
    const id = `person-${mediaBlockingState.nextPersonSeq++}`;
    mediaBlockingState.personBlocks.push({ id, name: "", callbackNumber: "", roles: [], removable: true });
    renderPersonRail();
}

function handleToggleRole(personId, role) {
    const person = mediaBlockingState.personBlocks.find((p) => p.id === personId);
    if (!person) return;
    const set = new Set(person.roles);
    if (set.has(role)) set.delete(role); else set.add(role);
    person.roles = Array.from(set);
    renderPersonRail();
}

function handleRemovePerson(personId) {
    mediaBlockingState.personBlocks = mediaBlockingState.personBlocks.filter((p) => p.id !== personId);
    mediaBlockingState.workItems.forEach((item) => {
        if (item.holderPersonId === personId && item.state !== "completed") {
            item.holderPersonId = null;
            item.state = "issuer_linked";
        }
    });
    renderAll();
}

function handleEndSession() {
    if (getUnresolvedCount() > 0 || mediaBlockingState.sessionEnded) return;
    const now = new Date().toISOString();
    mediaBlockingState.workItems.forEach((item) => {
        if (item.state === "staged") {
            item.result = { referenceNumber: generateReferenceNumber(), completedAt: now };
            item.state = "completed";
        }
    });
    mediaBlockingState.sessionEnded = true;
    mediaBlockingState.selectedItemId = null;
    renderAll();
}

function handleNewSession() {
    mediaBlockingState.workItems = [];
    mediaBlockingState.personBlocks = [{ id: "anrufer", name: "", callbackNumber: "", roles: ["anrufer", "karteninhaber"], removable: false }];
    mediaBlockingState.callerIsHolder = true;
    mediaBlockingState.selectedItemId = null;
    mediaBlockingState.sessionEnded = false;
    mediaBlockingState.pendingRemoval = null;
    mediaBlockingState.pendingAction = null;
    renderAll();
}

/* ── Event wiring ──────────────────────────────────────────────────── */

function handleDocumentClick(e) {
    if (!dom.searchResults.hidden && !dom.searchResults.contains(e.target) && e.target !== dom.searchInput) {
        dom.searchResults.hidden = true;
    }

    const addType = e.target.closest("[data-add-type]");
    if (addType) { handleAddItem(addType.dataset.addType); return; }

    const removeItemBtn = e.target.closest("[data-remove-item]");
    if (removeItemBtn) { handleRemoveClick(removeItemBtn.dataset.removeItem); return; }

    const selectItem = e.target.closest("[data-select-item]");
    if (selectItem) { handleSelectItem(selectItem.dataset.selectItem); return; }

    const pickIssuer = e.target.closest("[data-pick-issuer]");
    if (pickIssuer) {
        const [itemId, issuerId] = pickIssuer.dataset.pickIssuer.split(":");
        handleIssuerSelect(itemId, issuerId);
        return;
    }

    const pickHolder = e.target.closest("[data-pick-holder]");
    if (pickHolder) {
        const [itemId, personId] = pickHolder.dataset.pickHolder.split(":");
        handleHolderSelect(itemId, personId);
        return;
    }

    const saveDetails = e.target.closest("[data-save-details]");
    if (saveDetails) { handleSaveDetails(saveDetails.dataset.saveDetails); return; }

    const runAction = e.target.closest("[data-run-action]");
    if (runAction) { handleRunAction(runAction.dataset.runAction); return; }

    const toggleRole = e.target.closest("[data-toggle-role]");
    if (toggleRole) {
        const [personId, role] = toggleRole.dataset.toggleRole.split(":");
        handleToggleRole(personId, role);
        return;
    }

    const removePerson = e.target.closest("[data-remove-person]");
    if (removePerson) { handleRemovePerson(removePerson.dataset.removePerson); return; }

    const addPerson = e.target.closest("#mb-add-person-btn");
    if (addPerson) { handleAddPerson(); return; }

    const searchPick = e.target.closest("[data-search-pick]");
    if (searchPick) {
        const [issuerId, mediaTypeId] = searchPick.dataset.searchPick.split(":");
        handleSearchPick(issuerId, mediaTypeId);
        return;
    }

    const endSession = e.target.closest("[data-end-session]");
    if (endSession) { handleEndSession(); return; }

    const newSession = e.target.closest("[data-new-session]");
    if (newSession) { handleNewSession(); }
}

function handleDocumentChange(e) {
    if (e.target.id === "mb-caller-is-holder") {
        handleCallerHolderToggle(e.target.checked);
        return;
    }
    const extra = e.target.closest("[data-toggle-extra]");
    if (extra) {
        const [itemId, measureId] = extra.dataset.toggleExtra.split(":");
        handleToggleExtra(itemId, measureId, e.target.checked);
    }
}

function handleDocumentInput(e) {
    const nameInput = e.target.closest("[data-person-name]");
    if (nameInput) {
        const person = mediaBlockingState.personBlocks.find((p) => p.id === nameInput.dataset.personName);
        if (person) person.name = nameInput.value;
        return;
    }
    const phoneInput = e.target.closest("[data-person-phone]");
    if (phoneInput) {
        const person = mediaBlockingState.personBlocks.find((p) => p.id === phoneInput.dataset.personPhone);
        if (person) person.callbackNumber = phoneInput.value;
        return;
    }
    if (e.target.id === "mb-issuer-filter") {
        const stepEl = e.target.closest("[data-step='issuer']");
        if (!stepEl) return;
        const item = mediaBlockingState.workItems.find((i) => i.id === stepEl.dataset.itemId);
        const optionList = document.getElementById("mb-issuer-option-list");
        if (item && optionList) optionList.innerHTML = renderIssuerOptions(item, e.target.value);
    }
}

function bindEvents() {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("change", handleDocumentChange);
    document.addEventListener("input", handleDocumentInput);
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (dom.removeModal.classList.contains("active")) closeRemoveModal();
        if (dom.actionModal.classList.contains("active")) closeActionModal();
    });

    dom.searchInput.addEventListener("input", handleSearchInput);
    dom.searchInput.addEventListener("focus", () => { if (mediaBlockingState.searchQuery) renderSearchResults(); });

    dom.removeCancelBtn.addEventListener("click", closeRemoveModal);
    dom.removeCloseBtn.addEventListener("click", closeRemoveModal);
    dom.removeModal.addEventListener("click", (e) => { if (e.target === dom.removeModal) closeRemoveModal(); });
    dom.removeConfirmBtn.addEventListener("click", confirmRemoval);

    dom.actionCancelBtn.addEventListener("click", closeActionModal);
    dom.actionCloseBtn.addEventListener("click", closeActionModal);
    dom.actionModal.addEventListener("click", (e) => { if (e.target === dom.actionModal) closeActionModal(); });
    dom.actionConfirmBtn.addEventListener("click", confirmAction);
}

/* ── Bootstrap ─────────────────────────────────────────────────────── */

function init() {
    cacheDom();
    mediaBlockingState.personBlocks = [{ id: "anrufer", name: "", callbackNumber: "", roles: ["anrufer", "karteninhaber"], removable: false }];
    bindEvents();
    renderAll();
}

document.addEventListener("DOMContentLoaded", init);
