// Detail-Modal einer Aufgabe. Daten und Aktionen kommen über backend (tasks_board_data.js oder der Mock);
// nach jeder Aktion werden Board und Verlauf neu geladen.
(function () {
    "use strict";

    window.TasksBoardDetail = { create };

    function create({ Model, me, today, backend, getTasks, refresh, now, formatDateTime, processLabel, backlogLookup, labels }) {
        const esc = window.SofaUtils.escapeHtml;
        const dialog = document.getElementById("tb-detail");
        const el = id => document.getElementById(id);
        let state = null;
        let opener = null;
        const drafts = new Map();
        const HISTORY_PAGE_SIZE = 20;
        let highlightTimer = null;
        const workIcons = {
            edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16z"/></svg>',
            complete: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></svg>',
            mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg>'
        };
        const workHeading = (title, icon) => `<h3 class="tb-work-heading"><span class="tb-work-icon">${workIcons[icon]}</span>${esc(title)}</h3>`;
        const taskOf = () => getTasks().find(task => String(task.task_id) === String(state?.taskId));
        const contract = window.SofaContract;
        const facts = () => Model.historyFacts(state.history || []);
        const archivedOf = task => contract.getArchivedAccounts(task);
        const button = (text, action, primary = false, extra = "") => `<button type="button" class="btn ${primary ? "btn-primary" : "btn-secondary"}" data-detail-action="${action}"${extra}>${esc(text)}</button>`;
        const editable = task => task.status === "IN_PROGRESS" && Model.isMine(task, me.user_id);
        const planOf = task => Model.completionPlan(task, {
            tasks: getTasks(), meId: me.user_id, todayKey: today(), manual: state.manual, automationFailed: Boolean(facts().automationError),
            accountChoice: state.accountChoice, restored: state.restored, identifier: state.identifier, comment: state.comment,
            relatedIds: state.related, earlyIds: state.early
        });
        const statusTone = task => task.status === "OPEN" && Model.isDeferred(task) ? "deferred"
            : { OPEN: "open", IN_PROGRESS: "progress", COMPLETED: "completed", BLOCKED: "blocked" }[task.status] || "neutral";
        const statusLabel = task => task.status === "OPEN" && Model.isDeferred(task) ? "Nachgelagert" : labels.status[task.status] || task.status;
        const actor = entry => Model.displayName(entry.user_name) || (entry.user_id ? `Bearbeiter #${entry.user_id}` : "System");
        const textField = (label, id, value, { textarea = false, required = false, placeholder = "", maxLength = null } = {}) => {
            const limit = maxLength ? ` maxlength="${maxLength}"` : "";
            return `
            <label class="tb-detail-field" for="${id}"><span>${esc(label)}${required ? " *" : ""}</span>
            ${textarea ? `<textarea id="${id}" rows="3" placeholder="${esc(placeholder)}"${limit}>${esc(value)}</textarea>` : `<input id="${id}" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"${required ? " required" : ""}${limit}>`}</label>`;
        };
        const commentField = ({ note = false } = {}) => note
            ? textField("Abschlussnotiz", "tb-detail-comment", state.comment, {textarea: true, required: true, placeholder: "Grund für den manuellen Abschluss", maxLength: Model.COMMENT_MAX_LENGTH})
            : textField("Kommentar", "tb-detail-comment", state.comment, {textarea: true, placeholder: "Hinweis für Verlauf oder Übergabe", maxLength: Model.COMMENT_MAX_LENGTH});
        const dateOf = stamp => contract.formatDateKey(String(stamp).slice(0, 10));
        const CHECK_ICON = '<svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
        // Kurz Haken statt Kopier-Icon; Chips schalten per Klasse, der Kennungs-Button tauscht sein Icon.
        function markCopied(button) {
            clearTimeout(button.copiedTimer);
            button.classList.add("is-copied");
            if (!button.classList.contains("rg-chip")) {
                button.dataset.icon ??= button.innerHTML;
                button.innerHTML = CHECK_ICON;
            }
            button.copiedTimer = setTimeout(() => {
                button.classList.remove("is-copied");
                if (button.dataset.icon !== undefined) { button.innerHTML = button.dataset.icon; delete button.dataset.icon; }
            }, 1600);
        }
        const guideButton = el("tb-guide-btn");
        const guidePop = el("tb-guide-pop");
        const moreButton = el("tb-more-btn");
        const moreMenu = el("tb-more-menu");
        const manualAllowed = task => editable(task) && task.handling_type === "BOT";

        function capture() {
            if (!state) return;
            const comment = el("tb-detail-comment");
            const identifier = el("tb-complete-identifier");
            if (comment) state.comment = comment.value;
            if (identifier) state.identifier = identifier.value;
            for (const key of ["recipient", "subject", "body"]) {
                const field = el(`tb-mail-${key}`);
                if (field) state.mail[key] = field.value;
            }
        }

        function open(taskId) {
            if (!getTasks().some(task => String(task.task_id) === String(taskId))) return;
            if (state?.busy) return;
            if (state) capture();
            if (!dialog.open) opener = document.activeElement;
            state = { taskId, step: "detail", history: null, historyFailed: false, historyLimit: HISTORY_PAGE_SIZE, historyCount: null, newEntries: new Set(), followHistory: true, historyReady: false, historyLoading: false, unread: 0, guide: null, guideState: "", mailExpanded: new Set(), comment: drafts.get(String(taskId)) || "", identifier: "", accountChoice: "", restored: false, early: new Set(), related: new Set(), manual: false, busy: "", error: "", message: "", mail: {} };
            el("tb-detail-announcement").textContent = "";
            render();
            if (!dialog.open) dialog.showModal();
            el("tb-detail-close").focus({ preventScroll: true });
            loadHistory();
        }

        function close() {
            if (state?.busy) return;
            capture();
            if (state) drafts.set(String(state.taskId), state.comment);
            dialog.close();
        }

        function announce(message) {
            el("tb-detail-announcement").textContent = message;
        }

        // Immer der ganze Verlauf; neu hinzugekommene Einträge werden kurz markiert.
        async function loadHistory({ draw = true } = {}) {
            const current = state;
            const result = await backend.history(current.taskId);
            if (state !== current) return;
            const previous = state.history;
            const entries = result.ok && Array.isArray(result.data)
                ? result.data.map((raw, index) => ({ ...Model.historyEntry(raw), index }))
                : previous || [];
            if (previous) {
                for (let index = previous.length; index < entries.length; index++) state.newEntries.add(index);
                if (entries.length > previous.length) state.followHistory = true;
            }
            state.history = entries;
            state.historyFailed = !result.ok;
            if (!draw) return;
            render();
            requestAnimationFrame(() => { if (state === current) state.historyReady = true; });
        }

        // ---------- Anleitung ----------
        // Nur für eigene Tasks in Bearbeitung und erst auf Klick; ohne Anleitung (auch 403/409) kein Button.

        function syncGuide(task) {
            if (!editable(task)) {
                state.guide = null;
                state.guideState = "";
            } else if (!state.guideState) {
                loadGuide();
            }
            guideButton.hidden = !(editable(task) && state.guide && state.step !== "mail");
            if (guideButton.hidden) closeGuide();
            else if (!guidePop.hidden) el("tb-guide-body").innerHTML = guideHtml();
        }

        async function loadGuide() {
            const current = state;
            current.guideState = "loading";
            const result = await backend.guide(current.taskId);
            if (state !== current || current.guideState !== "loading") return;
            const data = result.ok ? result.data : null;
            state.guide = typeof data?.guide === "string" && data.guide.trim() ? data : null;
            state.guideState = "done";
            const task = taskOf();
            if (task) syncGuide(task);
        }

        const guideHtml = () => window.ResourceGuide.render(state.guide.guide, state.guide);

        function openGuide() {
            closeMore();
            el("tb-guide-body").innerHTML = guideHtml();
            guidePop.hidden = false;
            guideButton.setAttribute("aria-expanded", "true");
            placeGuide();
            guidePop.focus({ preventScroll: true });
        }

        function closeGuide({ focus = false } = {}) {
            if (guidePop.hidden) return;
            guidePop.hidden = true;
            guideButton.setAttribute("aria-expanded", "false");
            if (focus) guideButton.focus({ preventScroll: true });
        }

        // Fest positioniert am Button, damit der Dialog (overflow: hidden) es nicht abschneidet.
        function placeGuide() {
            const box = guideButton.getBoundingClientRect();
            const top = box.bottom + 6;
            guidePop.style.top = `${top}px`;
            guidePop.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
            const width = guidePop.getBoundingClientRect().width;
            guidePop.style.left = `${Math.max(8, Math.min(box.right - width, window.innerWidth - 8 - width))}px`;
        }

        // ---------- Menü ⋯ ----------
        // Manueller Abschluss eines automatisierten Tasks, ohne dass die Automatisierung erst scheitern muss.

        function syncMore(task) {
            moreButton.hidden = !(manualAllowed(task) && state.step === "detail");
            moreButton.disabled = Boolean(state.busy);
            if (moreButton.hidden || state.busy) closeMore();
        }

        function openMore() {
            closeGuide();
            moreMenu.hidden = false;
            moreButton.setAttribute("aria-expanded", "true");
            const box = moreButton.getBoundingClientRect();
            const width = moreMenu.getBoundingClientRect().width;
            moreMenu.style.top = `${box.bottom + 4}px`;
            moreMenu.style.left = `${Math.max(8, Math.min(box.right - width, window.innerWidth - 8 - width))}px`;
            moreMenu.querySelector("[role=menuitem]")?.focus({ preventScroll: true });
        }

        function closeMore({ focus = false } = {}) {
            if (moreMenu.hidden) return;
            moreMenu.hidden = true;
            moreButton.setAttribute("aria-expanded", "false");
            if (focus) moreButton.focus({ preventScroll: true });
        }

        moreMenu.addEventListener("keydown", event => {
            const items = [...moreMenu.querySelectorAll("[role=menuitem]")];
            const index = items.indexOf(document.activeElement);
            const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
            if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
            else if (event.key === "Tab") { event.preventDefault(); closeMore({ focus: true }); }
        });

        window.addEventListener("resize", () => { if (!guidePop.hidden) placeGuide(); closeMore(); });

        function contextHtml(task) {
            const due = Model.dueInfo(task, today());
            const primary = [];
            if (task.target_date) primary.push(["Stichtag", `<span class="tb-detail-due ${task.status !== "COMPLETED" && due ? `is-${due.tone}` : ""}">${esc(dateOf(task.target_date))}</span>`]);
            if (task.assigned_to_user_id != null) primary.push([task.status === "COMPLETED" ? "Erledigt von" : "Bearbeiter", esc(Model.isMine(task, me.user_id) ? task.status === "COMPLETED" ? "mir" : "Ich" : Model.displayName(task.assigned_to_user_name))]);
            if (task.status === "IN_PROGRESS" && task.assigned_at) primary.push(["Übernommen", `<span title="${esc(formatDateTime(task.assigned_at))}">vor ${esc(Model.ageLabel(task.assigned_at, now()))}</span>`]);
            if (task.status === "COMPLETED") primary.push(["Abschluss", esc(formatDateTime(task.completed_at))]);
            primary.push(["Bearbeitung", esc(labels.handling[task.handling_type] || task.handling_type)]);
            return primary.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("") + `
                <div class="tb-detail-reference"><dt>Kontext</dt><dd>${esc(processLabel(task))}<span aria-hidden="true"> · </span>${esc(backlogLookup[task.backlog_identifier]?.name || task.backlog_identifier || "Kein Backlog")}<span aria-hidden="true"> · </span>Task #${esc(task.task_id)}</dd></div>`;
        }

        function workHtml(task) {
            const known = facts();
            if (state.step === "complete") return completionHtml(task);
            if (state.step === "mail") return mailHtml();
            if (task.status === "COMPLETED") {
                return `<section class="tb-detail-result">${workHeading("Erledigt", "complete")}
                    ${known.accountIdentifier ? identifierHtml(known.accountIdentifier) : ""}
                    ${known.completionComment ? `<p class="tb-detail-result-comment">${esc(known.completionComment)}</p>` : ""}
                    ${state.message ? `<p class="tb-detail-copy">${esc(state.message)}</p>` : ""}</section>`;
            }
            if (task.status === "BLOCKED") {
                const dependency = getTasks().find(other => String(other.task_id) === String(task.blocked_by?.task_id));
                return `<section class="tb-detail-notice"><h3>Voraussetzung</h3><p>${esc(task.blocked_by?.resource_name || "Ressource noch nicht bereit")}</p>
                    ${dependency ? `<div class="tb-detail-inline"><strong>${esc(statusLabel(dependency))}${dependency.assigned_to_user_name ? ` · ${esc(Model.displayName(dependency.assigned_to_user_name))}` : ""}</strong><button type="button" class="tb-link-btn" data-detail-dependency="${esc(dependency.task_id)}">Aufgabe ansehen →</button></div>` : ""}</section>`;
            }
            if (Model.isForeign(task, me.user_id)) return "";
            if (task.status === "OPEN") return archivedOf(task).length ? `<p class="tb-detail-inline-hint">Archiviertes Konto vorhanden</p>` : "";
            if (!editable(task)) return "";

            return `<section class="tb-detail-work-section">${workHeading("Bearbeitung", "edit")}
                ${task.handling_type === "BOT" && known.automationError ? `<div class="tb-detail-notice is-error"><strong>Automatisierung fehlgeschlagen</strong><p>${esc(known.automationError)}</p><button type="button" class="tb-link-btn" data-detail-action="manual">Manuell erfassen →</button></div>` : ""}
                ${task.handling_type === "EXTERNAL" ? `<div class="tb-detail-inline">${known.mailSent ? `<strong>Per Mail beauftragt</strong>` : ""}${button(known.mailSent ? "Weitere Mail …" : "Mail vorbereiten …", "mail")}</div>` : ""}
                ${archivedOf(task).length ? `<p class="tb-detail-inline-hint">Archiviertes Konto vorhanden</p>` : ""}
                ${commentField()}<div class="tb-detail-note-actions"><button type="button" class="tb-link-btn" data-detail-action="note"${state.comment.trim() ? "" : " disabled"}>Notiz speichern</button></div>
            </section>`;
        }

        function identifierHtml(identifier) {
            return `<div class="tb-detail-identifier"><span><span class="tb-detail-hint">Account-Kennung</span><strong>${esc(identifier)}</strong></span><button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm" data-copy-identifier="${esc(identifier)}" aria-label="Kennung kopieren" title="Kennung kopieren"><svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button></div>`;
        }

        function completionHtml(task) {
            const { archived, archive, automatic, related, early, needsIdentifier, needsNote } = planOf(task);
            const heading = automatic ? "Automatisierung" : state.manual ? "Manueller Abschluss" : "Abschluss";
            return `<section class="tb-detail-work-section">${workHeading(heading, "complete")}
                ${archived.length ? `<fieldset class="tb-detail-choices"><legend>Archiviertes Konto vorhanden</legend>${archived.map(account => `<label><input type="radio" name="tb-account-choice" value="${esc(account.userAccountHistoryId)}"${state.accountChoice === String(account.userAccountHistoryId) ? " checked" : ""}${account.restorable ? "" : " disabled"}><span><strong>${esc(account.accountIdentifier)}</strong><small>${account.restorable ? `Wiederherstellung bestätigen · archiviert ${esc(formatDateTime(account.archivedAt))}` : "Kennung inzwischen anderweitig vergeben"}</small></span></label>`).join("")}<label><input type="radio" name="tb-account-choice" value="new"${state.accountChoice === "new" ? " checked" : ""}><span>Neues Konto ${automatic ? "anlegen" : "erfassen"}</span></label></fieldset>` : ""}
                ${archive ? `<label class="tb-detail-confirm"><input type="checkbox" id="tb-account-restored"${state.restored ? " checked" : ""}><span>Das Konto ${esc(archive.accountIdentifier)} wurde im Zielsystem wiederhergestellt.</span></label>` : needsIdentifier ? textField("Account-Kennung", "tb-complete-identifier", state.identifier, {required: true, placeholder: "Benutzername oder Account-Kennung"}) : ""}
                ${related.length ? `<fieldset class="tb-detail-related"><legend>Umgesetzte Entzüge mit abschließen</legend>${related.map(other => `<label><input type="checkbox" data-related="${esc(other.task_id)}"${state.related.has(other.task_id) ? " checked" : ""}><span><strong>${esc(other.resource_name)}</strong><small>${esc(statusLabel(other))}${other.target_date ? ` · Stichtag ${esc(dateOf(other.target_date))}` : ""}</small></span></label>`).join("")}</fieldset>` : ""}
                ${early.map(other => `<label class="tb-detail-confirm is-warning"><input type="checkbox" data-early="${esc(other.task_id)}"${state.early.has(other.task_id) ? " checked" : ""}><span><strong>Entzug vor Stichtag</strong>${esc(other.resource_name)} ist erst für den ${esc(dateOf(other.target_date))} vorgesehen. Trotzdem jetzt abschließen.</span></label>`).join("")}
                ${commentField({ note: needsNote })}
            </section>`;
        }

        function mailHtml() {
            return `<section class="tb-detail-work-section">${workHeading("Mail vorbereiten", "mail")}
                ${textField("Empfänger", "tb-mail-recipient", state.mail.recipient || "", {required: true})}
                ${textField("Betreff", "tb-mail-subject", state.mail.subject || "", {required: true})}
                ${textField("Nachricht", "tb-mail-body", state.mail.body || "", {textarea: true, required: true})}</section>`;
        }

        const errorHtml = () => `<p class="tb-detail-error" id="tb-detail-error" role="alert"${state.error ? "" : " hidden"}>${esc(state.error)}</p>`;

        function mailSnapshot(entry) {
            const mail = entry.action === "MAIL_SENT" ? entry.details : null;
            return mail && ["recipient", "subject", "body"].every(key => typeof mail[key] === "string") ? mail : null;
        }

        function mailReadHtml(mail, index) {
            const fields = [["An", mail.recipient], ["CC", mail.cc], ["BCC", mail.bcc], ["Betreff", mail.subject]];
            return `<div class="tb-history-mail" id="tb-history-mail-${index}" role="region" aria-label="Mailinhalt">
                <dl>${fields.filter(([, value]) => typeof value === "string" && value).map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
                <p class="tb-history-mail-body">${esc(mail.body)}</p></div>`;
        }

        const HISTORY_ACTIONS = {CREATED: "Erstellt", ASSIGNED: "Übernommen", RELEASED: "Freigegeben", COMPLETED: "Erledigt", COMMENTED: "Notiz", MAIL_SENT: "Per Mail beauftragt", BOT_DISPATCHED: "Automatisierung gestartet", BOT_RESPONSE: "Automatisierung", UNBLOCKED: "Voraussetzung erfüllt", CANCELED: "Abgebrochen", RECLASSIFIED: "Umgestellt"};
        // Diese Kommentare wiederholen nur die Aktion.
        const SILENT_COMMENTS = {MAIL_SENT: "Mailbeauftragung versendet", BOT_DISPATCHED: "Integration gestartet", UNBLOCKED: "Task zur Bearbeitung freigegeben. Ressourcenabhängigkeit erfüllt."};

        function historyHtml(history) {
            if (!history) return `<li class="tb-detail-copy">Lädt …</li>`;
            const visible = history.slice(-state.historyLimit);
            let day = "";
            return visible.map(entry => {
                const entryDay = entry.timestamp.slice(0, 10);
                const separator = entryDay !== day ? `<li class="tb-timeline-day">${esc(Model.formatDayLabel(entryDay, today()))}</li>` : "";
                day = entryDay;
                const mail = mailSnapshot(entry);
                const actionLabel = HISTORY_ACTIONS[entry.action] || "Aktualisierung";
                const expanded = state.mailExpanded.has(entry.index);
                const comment = SILENT_COMMENTS[entry.action] === entry.comment ? null : entry.comment;
                const identifier = entry.action === "COMPLETED" ? entry.details?.account_identifier : null;
                return `${separator}<li class="tb-timeline-entry${comment && entry.human ? " has-comment" : ""}${entry.error ? " is-error" : ""}${state.newEntries.has(entry.index) ? " is-new" : ""}" data-history-index="${entry.index}" data-history-action="${esc(entry.action)}">
                    <div class="tb-timeline-heading"><span>${entry.human ? `<strong>${esc(actor(entry))}</strong><span class="tb-timeline-action">${esc(actionLabel)}</span>` : esc(actionLabel)}</span><span class="tb-timeline-tools"><time datetime="${esc(entry.timestamp)}" title="${esc(formatDateTime(entry.timestamp))}">${esc(Model.timeOf(entry.timestamp))}</time>${mail ? `<button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm tb-history-mail-toggle" data-history-mail="${entry.index}" aria-label="${expanded ? "Mailinhalt ausblenden" : "Mailinhalt ansehen"}" title="${expanded ? "Mailinhalt ausblenden" : "Mailinhalt ansehen"}" aria-expanded="${expanded}" aria-controls="tb-history-mail-${entry.index}"><svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg></button>` : ""}</span></div>
                    ${comment ? `<p>${esc(comment)}</p>` : ""}${identifier ? identifierHtml(identifier) : ""}${mail && expanded ? mailReadHtml(mail, entry.index) : ""}</li>`;
            }).join("") || `<li class="tb-detail-copy">${state.historyFailed ? "Verlauf konnte nicht geladen werden." : "Noch keine Einträge."}</li>`;
        }

        function updateLatestButton() {
            if (!state) return;
            const scroller = el("tb-history-scroll");
            const away = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 100;
            el("tb-history-latest").hidden = !away;
            const label = state.unread ? `${state.unread} neue Einträge – zum neuesten Eintrag` : "Zum neuesten Eintrag";
            el("tb-history-latest").setAttribute("aria-label", label);
            el("tb-history-latest").title = label;
            el("tb-history-unread").textContent = state.unread || "";
            el("tb-history-unread").hidden = !state.unread;
            if (!away) state.unread = 0;
        }

        function scrollToLatest() {
            if (!state) return;
            const scroller = el("tb-history-scroll");
            scroller.scrollTop = scroller.scrollHeight;
            state.unread = 0;
            updateLatestButton();
        }

        function renderHistory() {
            const scroller = el("tb-history-scroll");
            const oldTop = scroller.scrollTop;
            const atBottom = scroller.scrollHeight - scroller.clientHeight - oldTop < 70;
            const history = state.history;
            const count = history ? history.length : null;
            const added = state.historyCount === null || count === null ? 0 : Math.max(0, count - state.historyCount);
            if (added) state.historyLimit += added;
            const follow = state.followHistory || (added > 0 && atBottom);
            state.historyCount = count;
            el("tb-history-count").textContent = count ?? "";
            el("tb-history-list").innerHTML = historyHtml(history);
            el("tb-history-older").hidden = !history || history.length <= state.historyLimit;
            if (!history) return;
            if (follow) scrollToLatest();
            else {
                scroller.scrollTop = oldTop;
                state.unread += added;
                updateLatestButton();
            }
            state.followHistory = false;
            if (state.newEntries.size) {
                clearTimeout(highlightTimer);
                const current = state;
                highlightTimer = setTimeout(() => {
                    if (state !== current) return;
                    state.newEntries.clear();
                    el("tb-history-list").querySelectorAll(".is-new").forEach(entry => entry.classList.remove("is-new"));
                }, 3500);
            }
        }

        function loadOlderHistory() {
            if (!state?.history || state.historyLoading) return;
            const history = state.history;
            if (state.historyLimit >= history.length) return;
            const scroller = el("tb-history-scroll");
            const oldHeight = scroller.scrollHeight;
            const oldTop = scroller.scrollTop;
            state.historyLoading = true;
            state.historyLimit += HISTORY_PAGE_SIZE;
            el("tb-history-list").innerHTML = historyHtml(history);
            el("tb-history-older").hidden = history.length <= state.historyLimit;
            scroller.scrollTop = oldTop + scroller.scrollHeight - oldHeight;
            const current = state;
            requestAnimationFrame(() => { if (state === current) state.historyLoading = false; });
        }

        el("tb-history-scroll").addEventListener("scroll", () => {
            if (!state?.historyReady) return;
            updateLatestButton();
            if (el("tb-history-scroll").scrollTop < 48) loadOlderHistory();
        });

        function actionsHtml(task) {
            if (state.busy) return `<span class="tb-detail-running" role="status">${esc(state.busy)}</span>`;
            if (state.step === "complete") {
                const { automatic } = planOf(task);
                const confirm = task.status === "OPEN" ? automatic ? "Übernehmen & ausführen" : "Übernehmen & abschließen"
                    : automatic ? "Automatisiert ausführen" : state.manual ? "Manuell abschließen" : "Abschluss bestätigen";
                return `${button(confirm, "confirm-complete", true)}${button("Zurück", "back")}`;
            }
            if (state.step === "mail") return `${button("Mail senden", "send-mail", true)}${button("Zurück", "back")}`;
            if (task.status === "OPEN") return `${button("Übernehmen", "assign", true)}${button("Direkt erledigen …", "complete")}`;
            if (editable(task)) return `${button(task.handling_type === "BOT" ? facts().automationError ? "Erneut ausführen …" : "Automatisiert ausführen …" : "Erledigen …", "complete", true)}${button("Freigeben", "release", false, ' title="Zurück zu den offenen Aufgaben"')}`;
            return `${Model.isForeign(task, me.user_id) ? '<span class="tb-detail-hint">Nur lesend</span>' : ""}${button("Schließen", "close")}`;
        }

        function render({ focus = false } = {}) {
            const task = taskOf();
            if (!task) return;
            const operation = task.task_type === "REVOCATION" ? "entziehen" : "einrichten";
            dialog.dataset.status = task.status;
            const nextMode = state.step !== "detail" ? state.step : task.status === "COMPLETED" ? "done" : editable(task) ? "editing" : "idle";
            const modeChanged = dialog.dataset.mode !== nextMode;
            dialog.dataset.step = state.step;
            dialog.dataset.mode = nextMode;
            dialog.classList.toggle("is-foreign", Model.isForeign(task, me.user_id));
            el("tb-detail-kicker").textContent = task.system_name || "Aufgabe";
            el("tb-detail-title-text").textContent = task.resource_name || "Ressource";
            el("tb-detail-operation").textContent = operation;
            el("tb-detail-operation").className = `tb-detail-operation ${task.task_type === "REVOCATION" ? "is-revoke" : "is-assign"}`;
            el("tb-detail-person").textContent = `für ${Model.displayName(task.target_user_name) || "–"}`;
            el("tb-detail-status").textContent = statusLabel(task);
            el("tb-detail-status").className = `tb-detail-status ui-status-badge ui-status-badge-sm ui-status-${statusTone(task)}`;
            syncGuide(task);
            syncMore(task);
            el("tb-detail-context").innerHTML = contextHtml(task);
            el("tb-detail-work").innerHTML = workHtml(task) + errorHtml();
            renderHistory();
            el("tb-detail-actions").innerHTML = actionsHtml(task);
            el("tb-detail-actions").hidden = !el("tb-detail-actions").childElementCount;
            el("tb-detail-close").disabled = Boolean(state.busy);
            el("tb-detail-work").toggleAttribute("inert", Boolean(state.busy));
            if (modeChanged && focus) {
                el("tb-detail-work").classList.remove("is-entering");
                void el("tb-detail-work").offsetWidth;
                el("tb-detail-work").classList.add("is-entering");
            }
            if (focus) {
                el("tb-detail-body").scrollTop = 0;
                el("tb-detail-work").querySelector("h3")?.setAttribute("tabindex", "-1");
                el("tb-detail-work").querySelector("h3")?.focus({preventScroll: true});
            }
        }

        function validationError(message, fieldId) {
            state.error = message;
            const error = el("tb-detail-error");
            if (error) { error.hidden = false; error.textContent = message; }
            const field = fieldId ? el(fieldId) : null;
            if (field) { field.setAttribute("aria-invalid", "true"); field.setAttribute("aria-describedby", "tb-detail-error"); field.focus(); }
        }

        // Eine Aktion zur Zeit. work() gibt {message}, {error} oder {automation} zurück und darf state anpassen;
        // danach werden Board (ausser board: false) und Verlauf neu geladen. Eine gescheiterte Automatisierung
        // steht meist schon im Verlauf (Hinweis im Detail); nur sonst wird sie als Fehler gezeigt.
        async function run(label, work, { board = true, focusId = null } = {}) {
            if (!state || state.busy) return;
            const current = state;
            state.busy = label;
            state.error = "";
            announce("");
            render();
            let result;
            try {
                result = (await work()) || {};
            } catch (_) {
                result = { error: "Unerwarteter Fehler. Bitte die Ansicht aktualisieren." };
            }
            if (board) await refresh();
            if (state !== current) return;
            await loadHistory({ draw: false });
            if (state !== current) return;
            if (result.automation) result = facts().automationError ? { message: result.automation } : { error: result.automation };
            state.busy = "";
            state.error = result.error || "";
            if (!result.error && result.message) state.message = result.message;
            render({ focus: !focusId });
            if (focusId) el(focusId)?.focus();
            announce(result.error || result.message || "");
        }

        const firstFailure = outcome => outcome.failed[0]?.message || "";

        function finish(task) {
            if (!Model.canSelect(task, me.user_id)) return;
            const plan = planOf(task);
            if (plan.issue) return validationError(plan.issue.message, { restored: "tb-account-restored", identifier: "tb-complete-identifier", comment: "tb-detail-comment" }[plan.issue.field]);
            const comment = state.comment.trim();
            const payload = { comment: comment || null };
            if (plan.archive) payload.reactivate_user_account_history_id = plan.archive.userAccountHistoryId;
            else if (plan.needsIdentifier) payload.account_identifier = state.identifier.trim();
            const related = plan.included.slice(1);

            return run(plan.automatic ? "Automatisierung wird ausgeführt …" : "Wird abgeschlossen …", async () => {
                // Das Übernehmen bleibt bestehen, auch wenn der Abschluss danach scheitert.
                if (task.status === "OPEN") {
                    const error = firstFailure(await backend.assign([task.task_id]));
                    if (error) return { error };
                }
                if (plan.automatic) {
                    const result = await backend.runIntegration(task.task_id);
                    if (!result.ok || !result.data?.task_completed) {
                        state.step = "detail";
                        return { automation: result.ok ? window.TaskViewModel.botDispatchFeedback(result.data).message : `Automatisierung fehlgeschlagen: ${result.message}` };
                    }
                } else {
                    const result = await backend.complete(task.task_id, payload);
                    if (!result.ok) return { error: result.message };
                }
                state.comment = "";
                drafts.delete(String(task.task_id));
                state.step = "detail";
                state.manual = false;
                const failed = [];
                for (const other of related) {
                    const assignError = other.status === "OPEN" ? firstFailure(await backend.assign([other.task_id])) : "";
                    const result = assignError ? { ok: false, message: assignError }
                        : await backend.complete(other.task_id, { comment: Model.relatedCompletionComment(comment) });
                    if (!result.ok) failed.push(`${other.resource_name}: ${result.message}`);
                }
                if (failed.length) return { error: `Aufgabe abgeschlossen, nicht mit abgeschlossen: ${failed.join("; ")}` };
                return { message: related.length ? `${plan.included.length} Aufgaben gemeinsam abgeschlossen.` : "Aufgabe abgeschlossen." };
            });
        }

        dialog.addEventListener("input", event => {
            capture();
            if (event.target.id === "tb-detail-comment") {
                const noteButton = dialog.querySelector('[data-detail-action="note"]');
                if (noteButton) noteButton.disabled = !state.comment.trim();
            }
            event.target.removeAttribute("aria-invalid");
            event.target.removeAttribute("aria-describedby");
            if (state?.error) {
                state.error = "";
                el("tb-detail-error").hidden = true;
            }
        });
        dialog.addEventListener("change", event => {
            if (!state || state.busy) return;
            capture();
            const target = event.target;
            if (target.name === "tb-account-choice") {
                state.accountChoice = target.value;
                state.restored = false;
                render();
                dialog.querySelector('[name="tb-account-choice"]:checked')?.focus({preventScroll: true});
            }
            if (target.id === "tb-account-restored") state.restored = target.checked;
            if (target.matches("[data-related]")) {
                const id = Number(target.dataset.related);
                if (target.checked) state.related.add(id); else state.related.delete(id);
                render();
                dialog.querySelector(`[data-related="${id}"]`)?.focus({preventScroll: true});
            }
            if (target.matches("[data-early]")) {
                const id = Number(target.dataset.early);
                if (target.checked) state.early.add(id); else state.early.delete(id);
            }
        });
        window.SofaDialog.closeOnBackdrop(dialog, close);

        dialog.addEventListener("click", async event => {
            if (event.target === dialog) return;
            if (event.target.closest("#tb-guide-btn")) {
                if (guidePop.hidden && state?.guide) openGuide(); else closeGuide();
                return;
            }
            if (event.target.closest("#tb-more-btn")) {
                if (moreMenu.hidden && state && !state.busy) openMore(); else closeMore();
                return;
            }
            if (!guidePop.contains(event.target)) closeGuide();
            closeMore();
            if (!state || state.busy) return;
            capture();
            const task = taskOf();
            if (!task) return;
            const mailToggle = event.target.closest("[data-history-mail]");
            if (mailToggle) {
                const index = Number(mailToggle.dataset.historyMail);
                if (state.mailExpanded.has(index)) state.mailExpanded.delete(index); else state.mailExpanded.add(index);
                renderHistory();
                dialog.querySelector(`[data-history-mail="${index}"]`)?.focus({preventScroll: true});
                if (state.mailExpanded.has(index)) el(`tb-history-mail-${index}`)?.scrollIntoView({block: "nearest"});
                return;
            }
            const dependency = event.target.closest("[data-detail-dependency]");
            if (dependency) { drafts.set(String(task.task_id), state.comment); open(Number(dependency.dataset.detailDependency)); return; }
            const chip = event.target.closest("[data-copy]");
            if (chip) {
                try { await navigator.clipboard.writeText(chip.dataset.copy); markCopied(chip); announce("Kopiert."); }
                catch (_) { announce("Kopieren nicht möglich. Der Text kann markiert und kopiert werden."); }
                return;
            }
            const copy = event.target.closest("[data-copy-identifier]");
            if (copy) {
                try { await navigator.clipboard.writeText(copy.dataset.copyIdentifier); markCopied(copy); announce("Kennung kopiert."); }
                catch (_) { announce("Kopieren nicht möglich. Die Kennung kann markiert und kopiert werden."); }
                return;
            }
            const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
            if (!action) return;
            if (action === "close") { close(); return; }
            if (action === "latest") { scrollToLatest(); el("tb-history-scroll").focus({preventScroll: true}); return; }
            if (action === "back") { state.step = "detail"; state.manual = false; state.error = ""; announce(""); render({focus: true}); return; }
            if (action === "assign" && task.status === "OPEN") {
                run("Wird übernommen …", async () => {
                    const error = firstFailure(await backend.assign([task.task_id]));
                    return error ? { error } : { message: "Aufgabe übernommen." };
                });
                return;
            }
            if (action === "release" && editable(task)) {
                const comment = state.comment.trim();
                run("Wird freigegeben …", async () => {
                    const error = firstFailure(await backend.release([task.task_id], comment));
                    if (error) return { error };
                    state.comment = "";
                    drafts.delete(String(task.task_id));
                    return { message: comment ? "Aufgabe freigegeben. Kommentar gespeichert." : "Aufgabe freigegeben." };
                });
                return;
            }
            if (action === "note" && editable(task) && state.comment.trim()) {
                const comment = state.comment.trim();
                run("Notiz wird gespeichert …", async () => {
                    const result = await backend.comment(task.task_id, comment);
                    if (!result.ok) return { error: result.message };
                    state.comment = "";
                    drafts.delete(String(task.task_id));
                    return { message: "Notiz gespeichert." };
                }, { board: false, focusId: "tb-detail-comment" });
                return;
            }
            if (action === "manual" && !manualAllowed(task)) return;
            if ((action === "complete" || action === "manual") && Model.canSelect(task, me.user_id)) {
                state.manual = action === "manual";
                state.step = "complete";
                state.error = "";
                announce("");
                render({focus: true});
                return;
            }
            if (action === "confirm-complete") { await finish(task); return; }
            if (action === "mail" && editable(task) && task.handling_type === "EXTERNAL") {
                if (state.mail.recipient !== undefined) {
                    state.step = "mail";
                    render({focus: true});
                    return;
                }
                run("Mailvorlage wird geladen …", async () => {
                    const result = await backend.mailTemplate(task);
                    if (!result.ok) return { error: result.message };
                    state.mail = { recipient: result.data?.recipient || "", subject: result.data?.subject || "", body: result.data?.body || "" };
                    state.step = "mail";
                    return {};
                }, { board: false });
                return;
            }
            if (action === "send-mail" && editable(task) && task.handling_type === "EXTERNAL") {
                if (!["recipient", "subject", "body"].every(key => state.mail[key]?.trim())) return validationError("Bitte Empfänger, Betreff und Nachricht ausfüllen.");
                const mail = { recipient: state.mail.recipient.trim(), subject: state.mail.subject.trim(), body: state.mail.body.trim() };
                run("Mail wird eingestellt …", async () => {
                    const result = await backend.sendMail(task.task_id, mail);
                    if (!result.ok) return { error: result.message };
                    state.mail = {};
                    state.step = "detail";
                    return { message: "Mail zur Zustellung eingestellt." };
                }, { board: false });
            }
        });
        el("tb-detail-close").addEventListener("click", close);
        dialog.addEventListener("cancel", event => {
            event.preventDefault();
            if (!moreMenu.hidden) closeMore({ focus: true });
            else if (!guidePop.hidden) closeGuide({ focus: true }); else close();
        });
        dialog.addEventListener("close", () => {
            clearTimeout(highlightTimer);
            closeGuide();
            closeMore();
            const taskId = state?.taskId;
            if (state) drafts.set(String(state.taskId), state.comment);
            state = null;
            const card = document.querySelector(`[data-task-id="${taskId}"] .tb-card-main`);
            const target = opener?.isConnected ? opener : card?.getClientRects().length ? card : el("tb-search");
            target?.focus({preventScroll: true});
        });

        return { open, close, isBusy: () => Boolean(state?.busy) };
    }
}());
