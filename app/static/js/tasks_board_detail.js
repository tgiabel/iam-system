// Interaktiver Modal-Entwurf: ausschliesslich lokale Mock-Daten, keine API-Aufrufe.
(function () {
    "use strict";

    window.TasksBoardDetail = { create };

    function create({ Model, me, todayKey, details, getTasks, setTasks, assign, release, onChange, now, formatDateTime, processLabel, backlogLookup, labels }) {
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
        const infoOf = task => details[task.task_id] ||= { history: [] };
        const archivedOf = task => contract.getArchivedAccounts(task);
        const button = (text, action, primary = false, extra = "") => `<button type="button" class="btn ${primary ? "btn-primary" : "btn-secondary"}" data-detail-action="${action}"${extra}>${esc(text)}</button>`;
        const editable = task => task.status === "IN_PROGRESS" && Model.isMine(task, me.user_id);
        const isAccount = task => contract.isAccountAssignmentTask(task);
        const planOf = task => Model.completionPlan(task, {
            tasks: getTasks(), meId: me.user_id, todayKey, manual: state.manual, accountChoice: state.accountChoice,
            restored: state.restored, identifier: state.identifier, relatedIds: state.related, earlyIds: state.early
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
        const commentField = () => textField("Kommentar", "tb-detail-comment", state.comment, {textarea: true, placeholder: "Hinweis für Verlauf oder Übergabe", maxLength: Model.COMMENT_MAX_LENGTH});

        function record(taskId, action, comment = null, extra = {}) {
            const task = getTasks().find(task => String(task.task_id) === String(taskId));
            if (!task) return;
            const history = infoOf(task).history;
            history.push({ action, timestamp: now(), user_id: me.user_id, user_name: me.name, comment: comment || null, ...extra });
            if (state && String(state.taskId) === String(taskId)) {
                state.newEntries.add(history.length - 1);
                state.followHistory = true;
            }
        }

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
            if (state) capture();
            if (!dialog.open) opener = document.activeElement;
            state = { taskId, step: "detail", historyLimit: HISTORY_PAGE_SIZE, historyCount: null, newEntries: new Set(), followHistory: true, historyReady: false, historyLoading: false, unread: 0, mailExpanded: new Set(), comment: drafts.get(String(taskId)) || "", identifier: "", accountChoice: "", restored: false, early: new Set(), related: new Set(), manual: false, busy: false, message: "", mail: {} };
            el("tb-detail-announcement").textContent = "";
            render();
            if (!dialog.open) dialog.showModal();
            el("tb-detail-close").focus({ preventScroll: true });
            requestAnimationFrame(() => {
                if (!state || String(state.taskId) !== String(taskId)) return;
                scrollToLatest();
                state.historyReady = true;
            });
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

        function contextHtml(task) {
            const due = Model.dueInfo(task, todayKey);
            const primary = [];
            if (task.target_date) primary.push(["Stichtag", `<span class="tb-detail-due ${task.status !== "COMPLETED" && due ? `is-${due.tone}` : ""}">${esc(window.SofaContract.formatDateKey(String(task.target_date).slice(0, 10)))}</span>`]);
            if (task.assigned_to_user_id != null) primary.push([task.status === "COMPLETED" ? "Erledigt von" : "Bearbeiter", esc(Model.isMine(task, me.user_id) ? task.status === "COMPLETED" ? "mir" : "Ich" : Model.displayName(task.assigned_to_user_name))]);
            if (task.status === "IN_PROGRESS" && task.assigned_at) primary.push(["Übernommen", `<span title="${esc(formatDateTime(task.assigned_at))}">vor ${esc(Model.ageLabel(task.assigned_at, now()))}</span>`]);
            if (task.status === "COMPLETED") primary.push(["Abschluss", esc(formatDateTime(task.completed_at))]);
            primary.push(["Bearbeitung", esc(labels.handling[task.handling_type] || task.handling_type)]);
            return primary.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("") + `
                <div class="tb-detail-reference"><dt>Kontext</dt><dd>${esc(processLabel(task))}<span aria-hidden="true"> · </span>${esc(backlogLookup[task.backlog_identifier]?.name || task.backlog_identifier || "Kein Backlog")}<span aria-hidden="true"> · </span>Task #${esc(task.task_id)}</dd></div>`;
        }

        function workHtml(task) {
            const info = infoOf(task);
            if (state.step === "complete") return completionHtml(task);
            if (state.step === "mail") return mailHtml(task);
            if (task.status === "COMPLETED") {
                const last = [...info.history].reverse().find(entry => entry.action === "COMPLETED");
                return `<section class="tb-detail-result">${workHeading("Erledigt", "complete")}
                    ${info.account_identifier ? identifierHtml(info.account_identifier) : ""}
                    ${last?.comment ? `<p class="tb-detail-result-comment">${esc(last.comment)}</p>` : ""}
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
                ${task.handling_type === "BOT" && info.automation_failed ? `<div class="tb-detail-notice is-error"><strong>Automatisierung fehlgeschlagen</strong><p>Zielsystem nicht erreichbar</p><button type="button" class="tb-link-btn" data-detail-action="manual">Manuell erfassen →</button></div>` : ""}
                ${task.handling_type === "EXTERNAL" ? `<div class="tb-detail-inline">${info.mail_sent ? `<strong>Per Mail beauftragt</strong>` : ""}${button(info.mail_sent ? "Weitere Mail …" : "Mail vorbereiten …", "mail")}</div>` : ""}
                ${archivedOf(task).length ? `<p class="tb-detail-inline-hint">Archiviertes Konto vorhanden</p>` : ""}
                ${commentField()}<div class="tb-detail-note-actions"><button type="button" class="tb-link-btn" data-detail-action="note"${state.comment.trim() ? "" : " disabled"}>Notiz speichern</button></div>
            </section>`;
        }

        function identifierHtml(identifier) {
            return `<div class="tb-detail-identifier"><span><span class="tb-detail-hint">Account-Kennung</span><strong>${esc(identifier)}</strong></span><button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm" data-copy-identifier="${esc(identifier)}" aria-label="Kennung kopieren" title="Kennung kopieren"><svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button></div>`;
        }

        function completionHtml(task) {
            const { archived, archive, automatic, related, early, needsIdentifier } = planOf(task);
            return `<section class="tb-detail-work-section">${workHeading(automatic ? "Automatisierung" : "Abschluss", "complete")}
                ${archived.length ? `<fieldset class="tb-detail-choices"><legend>Archiviertes Konto vorhanden</legend>${archived.map(account => `<label><input type="radio" name="tb-account-choice" value="${esc(account.userAccountHistoryId)}"${state.accountChoice === String(account.userAccountHistoryId) ? " checked" : ""}${account.restorable ? "" : " disabled"}><span><strong>${esc(account.accountIdentifier)}</strong><small>${account.restorable ? `Wiederherstellung bestätigen · archiviert ${esc(formatDateTime(account.archivedAt))}` : "Kennung inzwischen anderweitig vergeben"}</small></span></label>`).join("")}<label><input type="radio" name="tb-account-choice" value="new"${state.accountChoice === "new" ? " checked" : ""}><span>Neues Konto ${automatic ? "anlegen" : "erfassen"}</span></label></fieldset>` : ""}
                ${archive ? `<label class="tb-detail-confirm"><input type="checkbox" id="tb-account-restored"${state.restored ? " checked" : ""}><span>Das Konto ${esc(archive.accountIdentifier)} wurde im Zielsystem wiederhergestellt.</span></label>` : needsIdentifier ? textField("Account-Kennung", "tb-complete-identifier", state.identifier, {required: true, placeholder: "Benutzername oder Account-Kennung"}) : ""}
                ${related.length ? `<fieldset class="tb-detail-related"><legend>Umgesetzte Entzüge mit abschließen</legend>${related.map(other => `<label><input type="checkbox" data-related="${esc(other.task_id)}"${state.related.has(other.task_id) ? " checked" : ""}><span><strong>${esc(other.resource_name)}</strong><small>${esc(statusLabel(other))}${other.target_date ? ` · Stichtag ${esc(window.SofaContract.formatDateKey(String(other.target_date).slice(0, 10)))}` : ""}</small></span></label>`).join("")}</fieldset>` : ""}
                ${early.map(other => `<label class="tb-detail-confirm is-warning"><input type="checkbox" data-early="${esc(other.task_id)}"${state.early.has(other.task_id) ? " checked" : ""}><span><strong>Entzug vor Stichtag</strong>${esc(other.resource_name)} ist erst für den ${esc(window.SofaContract.formatDateKey(String(other.target_date).slice(0, 10)))} vorgesehen. Trotzdem jetzt abschließen.</span></label>`).join("")}
                ${commentField()}
                <p class="tb-detail-error" id="tb-complete-error" role="alert" hidden></p>
            </section>`;
        }

        function mailHtml(task) {
            return `<section class="tb-detail-work-section">${workHeading("Mail vorbereiten", "mail")}
                ${textField("Empfänger", "tb-mail-recipient", state.mail.recipient || "", {required: true})}
                ${textField("Betreff", "tb-mail-subject", state.mail.subject || "", {required: true})}
                ${textField("Nachricht", "tb-mail-body", state.mail.body || "", {textarea: true})}
                <p class="tb-detail-error" id="tb-complete-error" role="alert" hidden></p></section>`;
        }

        function historyEntries(task) {
            return infoOf(task).history.map((entry, index) => ({...entry, index}))
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.index - b.index);
        }

        function mailSnapshot(entry) {
            if (entry.action !== "MAIL_SENT") return null;
            let mail = entry.mail || entry.details;
            if (typeof mail === "string") {
                try { mail = JSON.parse(mail); } catch (_) { return null; }
            }
            if (!mail || typeof mail !== "object" || !["recipient", "subject", "body"].every(key => typeof mail[key] === "string")) return null;
            return mail;
        }

        function mailReadHtml(mail, index) {
            const fields = [["An", mail.recipient], ["CC", mail.cc], ["BCC", mail.bcc], ["Betreff", mail.subject]];
            return `<div class="tb-history-mail" id="tb-history-mail-${index}" role="region" aria-label="Mailinhalt">
                <dl>${fields.filter(([, value]) => typeof value === "string" && value).map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
                <p class="tb-history-mail-body">${esc(mail.body)}</p></div>`;
        }

        function historyHtml(history) {
            const actions = {CREATED: "Erstellt", ASSIGNED: "Übernommen", RELEASED: "Freigegeben", COMPLETED: "Erledigt", COMMENTED: "Notiz", MAIL_SENT: "Per Mail beauftragt", BOT_RESPONSE: "Automatisierung", UNBLOCKED: "Voraussetzung erfüllt"};
            const visible = history.slice(-state.historyLimit);
            let day = "";
            return visible.map(entry => {
                const entryDay = entry.timestamp.slice(0, 10);
                const separator = entryDay !== day ? `<li class="tb-timeline-day">${esc(Model.formatDayLabel(entryDay, todayKey))}</li>` : "";
                day = entryDay;
                const human = Boolean(entry.user_id);
                const mail = mailSnapshot(entry);
                const actionLabel = actions[entry.action] || "Aktualisierung";
                const expanded = state.mailExpanded.has(entry.index);
                const comment = entry.action === "MAIL_SENT" && entry.comment === "Mailbeauftragung versendet" ? null : entry.comment;
                return `${separator}<li class="tb-timeline-entry${comment && human ? " has-comment" : ""}${entry.error ? " is-error" : ""}${state.newEntries.has(entry.index) ? " is-new" : ""}" data-history-index="${entry.index}" data-history-action="${esc(entry.action)}">
                    <div class="tb-timeline-heading"><span>${human ? `<strong>${esc(actor(entry))}</strong><span class="tb-timeline-action">${esc(actionLabel)}</span>` : esc(actionLabel)}</span><span class="tb-timeline-tools"><time datetime="${esc(entry.timestamp)}" title="${esc(formatDateTime(entry.timestamp))}">${esc(Model.timeOf(entry.timestamp))}</time>${mail ? `<button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm tb-history-mail-toggle" data-history-mail="${entry.index}" aria-label="${expanded ? "Mailinhalt ausblenden" : "Mailinhalt ansehen"}" title="${expanded ? "Mailinhalt ausblenden" : "Mailinhalt ansehen"}" aria-expanded="${expanded}" aria-controls="tb-history-mail-${entry.index}"><svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg></button>` : ""}</span></div>
                    ${comment ? `<p>${esc(comment)}</p>` : ""}${entry.result ? `<p class="tb-timeline-result">${esc(entry.result)}</p>` : ""}${entry.identifier ? identifierHtml(entry.identifier) : ""}${mail && expanded ? mailReadHtml(mail, entry.index) : ""}</li>`;
            }).join("") || `<li class="tb-detail-copy">Noch keine Einträge.</li>`;
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

        function renderHistory(task) {
            const scroller = el("tb-history-scroll");
            const oldTop = scroller.scrollTop;
            const atBottom = scroller.scrollHeight - scroller.clientHeight - oldTop < 70;
            const history = historyEntries(task);
            const added = state.historyCount === null ? 0 : Math.max(0, history.length - state.historyCount);
            if (added) state.historyLimit += added;
            const follow = state.followHistory || (added > 0 && atBottom);
            state.historyCount = history.length;
            el("tb-history-count").textContent = history.length;
            el("tb-history-list").innerHTML = historyHtml(history);
            el("tb-history-older").hidden = history.length <= state.historyLimit;
            if (follow) scrollToLatest();
            else {
                scroller.scrollTop = oldTop;
                state.unread += added;
                updateLatestButton();
            }
            state.followHistory = false;
            if (added) {
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
            if (!state || state.historyLoading) return;
            const task = taskOf();
            if (!task) return;
            const history = historyEntries(task);
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
            if (state.busy) return `<span class="tb-detail-running" role="status">Automatisierung wird ausgeführt …</span><button type="button" class="btn btn-primary" disabled>Wird ausgeführt …</button>`;
            if (state.step === "complete") {
                const { automatic } = planOf(task);
                const confirm = task.status === "OPEN" ? automatic ? "Übernehmen & ausführen" : "Übernehmen & abschließen" : automatic ? "Automatisiert ausführen" : "Abschluss bestätigen";
                return `${button(confirm, "confirm-complete", true)}${button("Zurück", "back")}`;
            }
            if (state.step === "mail") return `${button("Mail senden", "send-mail", true)}${button("Zurück", "back")}`;
            if (task.status === "OPEN") return `${button("Übernehmen", "assign", true)}${button("Direkt erledigen …", "complete")}`;
            if (editable(task)) return `${button(task.handling_type === "BOT" ? infoOf(task).automation_failed ? "Erneut ausführen …" : "Automatisiert ausführen …" : "Erledigen …", "complete", true)}${button("Freigeben", "release", false, ' title="Zurück zu den offenen Aufgaben"')}`;
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
            el("tb-detail-title").textContent = task.resource_name || "Ressource";
            el("tb-detail-operation").textContent = operation;
            el("tb-detail-operation").className = `tb-detail-operation ${task.task_type === "REVOCATION" ? "is-revoke" : "is-assign"}`;
            el("tb-detail-person").textContent = `für ${Model.displayName(task.target_user_name) || "–"}`;
            el("tb-detail-status").textContent = statusLabel(task);
            el("tb-detail-status").className = `tb-detail-status ui-status-badge ui-status-badge-sm ui-status-${statusTone(task)}`;
            el("tb-detail-context").innerHTML = contextHtml(task);
            el("tb-detail-work").innerHTML = workHtml(task);
            renderHistory(task);
            el("tb-detail-actions").innerHTML = actionsHtml(task);
            el("tb-detail-actions").hidden = !el("tb-detail-actions").childElementCount;
            el("tb-detail-close").disabled = state.busy;
            el("tb-detail-work").toggleAttribute("inert", state.busy);
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
            const error = el("tb-complete-error");
            if (error) { error.hidden = false; error.textContent = message; }
            const field = fieldId ? el(fieldId) : null;
            if (field) { field.setAttribute("aria-invalid", "true"); field.setAttribute("aria-describedby", "tb-complete-error"); field.focus(); }
        }

        async function finish(task) {
            if (!Model.canSelect(task, me.user_id)) return;
            const info = infoOf(task);
            const { archive, automatic, included, issue } = planOf(task);
            if (issue) return validationError(issue.message, { restored: "tb-account-restored", identifier: "tb-complete-identifier" }[issue.field]);
            const related = included.slice(1);

            if (automatic) {
                // Das Uebernehmen bleibt auch bei einem fehlgeschlagenen Versuch bestehen.
                if (task.status === "OPEN") assign([task.task_id]);
                state.busy = true;
                render();
                onChange();
                await new Promise(resolve => setTimeout(resolve, 650));
                state.busy = false;
                if (info.automation_fails_once && !info.automation_attempted) {
                    info.automation_attempted = true;
                    info.automation_failed = true;
                    record(task.task_id, "BOT_RESPONSE", null, {user_id: null, user_name: "Automatisierung", result: "Zielsystem nicht erreichbar. Die Aufgabe bleibt in Bearbeitung.", error: true});
                    state.step = "detail";
                    render({focus: true});
                    announce("Automatisierung fehlgeschlagen. Erneuter Versuch oder manuelle Erfassung möglich.");
                    onChange();
                    return;
                }
                info.automation_failed = false;
                record(task.task_id, "BOT_RESPONSE", null, {user_id: null, user_name: "Automatisierung", result: "Erfolgreich ausgeführt", identifier: isAccount(task) ? `user${task.target_user_id}` : null});
            }

            const stamp = now();
            for (const item of included) {
                const current = getTasks().find(other => other.task_id === item.task_id);
                if (!Model.canSelect(current, me.user_id)) continue;
                if (current.status === "OPEN") assign([current.task_id]);
                const isRelated = current.task_id !== task.task_id;
                record(current.task_id, "COMPLETED", isRelated ? Model.relatedCompletionComment(state.comment) : state.comment.trim(), {
                    result: archive && !isRelated ? "Wiederherstellung im Zielsystem bestätigt" : null
                });
            }
            info.account_identifier = isAccount(task) ? archive?.accountIdentifier || (automatic ? `user${task.target_user_id}` : state.identifier.trim()) : null;
            const ids = new Set(included.map(item => item.task_id));
            const updated = getTasks().map(item => ids.has(item.task_id) ? Model.completeTask(item, me, stamp) : item);
            setTasks(updated.map(item => {
                if (item.status !== "BLOCKED" || !ids.has(item.blocked_by?.task_id)) return item;
                record(item.task_id, "UNBLOCKED", null, {user_id: null, user_name: "System"});
                return {...item, status: "OPEN", blocked_by: null};
            }));
            state.comment = "";
            drafts.delete(String(task.task_id));
            state.step = "detail";
            state.message = related.length ? `${included.length} Aufgaben gemeinsam abgeschlossen.` : "";
            onChange();
            render({focus: true});
            announce(state.message || "Aufgabe erfolgreich abgeschlossen.");
        }

        dialog.addEventListener("input", event => {
            capture();
            if (event.target.id === "tb-detail-comment") {
                const noteButton = dialog.querySelector('[data-detail-action="note"]');
                if (noteButton) noteButton.disabled = !state.comment.trim();
            }
            event.target.removeAttribute("aria-invalid");
            event.target.removeAttribute("aria-describedby");
            if (el("tb-complete-error")) el("tb-complete-error").hidden = true;
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
            if (!state || state.busy) return;
            capture();
            const task = taskOf();
            if (!task) return;
            const mailToggle = event.target.closest("[data-history-mail]");
            if (mailToggle) {
                const index = Number(mailToggle.dataset.historyMail);
                if (state.mailExpanded.has(index)) state.mailExpanded.delete(index); else state.mailExpanded.add(index);
                renderHistory(task);
                dialog.querySelector(`[data-history-mail="${index}"]`)?.focus({preventScroll: true});
                if (state.mailExpanded.has(index)) el(`tb-history-mail-${index}`)?.scrollIntoView({block: "nearest"});
                return;
            }
            const dependency = event.target.closest("[data-detail-dependency]");
            if (dependency) { drafts.set(String(task.task_id), state.comment); open(Number(dependency.dataset.detailDependency)); return; }
            const copy = event.target.closest("[data-copy-identifier]");
            if (copy) {
                try { await navigator.clipboard.writeText(copy.dataset.copyIdentifier); announce("Kennung kopiert."); }
                catch (_) { announce("Kopieren nicht möglich. Die Kennung kann markiert und kopiert werden."); }
                return;
            }
            const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
            if (!action) return;
            if (action === "close") { close(); return; }
            if (action === "latest") { scrollToLatest(); el("tb-history-scroll").focus({preventScroll: true}); return; }
            if (action === "back") { state.step = "detail"; state.manual = false; announce(""); render({focus: true}); return; }
            if (action === "assign" && task.status === "OPEN") { assign([task.task_id]); onChange(); render({focus: true}); announce("Aufgabe übernommen."); return; }
            if (action === "release" && editable(task)) { const hasComment = Boolean(state.comment.trim()); release([task.task_id], state.comment.trim()); state.comment = ""; drafts.delete(String(task.task_id)); onChange(); render({focus: true}); announce(hasComment ? "Aufgabe freigegeben. Kommentar gespeichert." : "Aufgabe freigegeben."); return; }
            if (action === "note" && editable(task) && state.comment.trim()) { record(task.task_id, "COMMENTED", state.comment.trim()); state.comment = ""; drafts.delete(String(task.task_id)); render(); el("tb-detail-comment").focus(); announce("Notiz gespeichert."); return; }
            if ((action === "complete" || action === "manual") && Model.canSelect(task, me.user_id)) {
                state.manual = action === "manual" && Boolean(infoOf(task).automation_failed);
                state.step = "complete";
                announce("");
                render({focus: true});
                return;
            }
            if (action === "confirm-complete") { await finish(task); return; }
            if (action === "mail" && editable(task) && task.handling_type === "EXTERNAL") {
                state.mail = {recipient: "service@example.test", subject: `${Model.actionLabel(task)} · ${Model.displayName(task.target_user_name)}`, body: `Bitte ${Model.actionLabel(task)} für ${Model.displayName(task.target_user_name)}.`, ...state.mail};
                state.step = "mail";
                announce("");
                render({focus: true});
                return;
            }
            if (action === "send-mail" && editable(task) && task.handling_type === "EXTERNAL") {
                if (!["recipient", "subject", "body"].every(key => state.mail[key]?.trim())) return validationError("Bitte Empfänger, Betreff und Nachricht ausfüllen.");
                record(task.task_id, "MAIL_SENT", null, {result: `An ${state.mail.recipient}`, mail: {...state.mail}});
                infoOf(task).mail_sent = true;
                state.step = "detail";
                render({focus: true});
                announce("Mail im Entwurf beauftragt. Es wurde keine E-Mail versendet.");
            }
        });
        el("tb-detail-close").addEventListener("click", close);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.addEventListener("close", () => {
            clearTimeout(highlightTimer);
            const taskId = state?.taskId;
            if (state) drafts.set(String(state.taskId), state.comment);
            state = null;
            const card = document.querySelector(`[data-task-id="${taskId}"] .tb-card-main`);
            const target = opener?.isConnected ? opener : card?.getClientRects().length ? card : el("tb-search");
            target?.focus({preventScroll: true});
        });

        return { open, close, record };
    }
}());
