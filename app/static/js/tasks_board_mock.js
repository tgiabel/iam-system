// Mock-Datenzugang für /tasks?mock= (nur Entwicklungsinstanz): dieselben Funktionen wie TasksBoardData.live,
// aber alles lokal. Verlaufseinträge haben die Form von GET /sofa/tasks/{id}/logs.
(function () {
    "use strict";

    const Model = window.TasksBoardModel;
    const contract = window.SofaContract;

    function create(data, me, now) {
        let tasks = (data.tasks || []).slice();
        const details = data.task_details || {};
        const historyOf = taskId => (details[taskId] ||= { history: [] }).history;
        const find = taskId => tasks.find(task => String(task.task_id) === String(taskId));
        const update = (taskId, change) => {
            tasks = tasks.map(task => (String(task.task_id) === String(taskId) ? change(task) : task));
        };
        const ok = value => ({ ok: true, data: value });
        const fail = (status, message) => ({ ok: false, status, message });
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

        function log(taskId, action, comment = null, { user = me, details: extra = null } = {}) {
            historyOf(taskId).push({
                action, timestamp: now(), user_id: user?.user_id ?? null, user_name: user?.name ?? null,
                comment: comment || null, details: extra ? JSON.stringify(extra) : null
            });
        }

        function assignOne(taskId) {
            if (find(taskId)?.status !== "OPEN") return false;
            update(taskId, task => Model.assignTo(task, me, now()));
            log(taskId, "ASSIGNED");
            return true;
        }

        function releaseOne(taskId, comment) {
            const task = find(taskId);
            if (task?.status !== "IN_PROGRESS" || !Model.isMine(task, me.user_id)) return false;
            update(taskId, Model.release);
            log(taskId, "RELEASED", comment);
            return true;
        }

        // Wie die SD-API: nur eigene Tasks in Bearbeitung; abhängige Tasks werden frei.
        function completeOne(taskId, payload) {
            const task = find(taskId);
            if (task?.status !== "IN_PROGRESS" || !Model.isMine(task, me.user_id)) return fail(409, "Die Aufgabe ist nicht mehr in Bearbeitung.");
            const restored = contract.getArchivedAccounts(task)
                .find(account => String(account.userAccountHistoryId) === String(payload.reactivate_user_account_history_id));
            const identifier = restored?.accountIdentifier || payload.account_identifier || null;
            log(taskId, "COMPLETED", payload.comment, {
                details: Number(task.resource_type_id) === 1 ? { resource: task.resource_name, account_identifier: identifier } : null
            });
            update(taskId, current => Model.completeTask(current, me, now()));
            tasks.filter(other => other.status === "BLOCKED" && String(other.blocked_by?.task_id) === String(taskId)).forEach(other => {
                update(other.task_id, current => ({ ...current, status: "OPEN", blocked_by: null }));
                log(other.task_id, "UNBLOCKED", "Task zur Bearbeitung freigegeben. Ressourcenabhängigkeit erfüllt.", { user: null });
            });
            return ok(find(taskId));
        }

        function outcome(ids, done, message) {
            return { done, failed: ids.filter(id => !done.includes(id)).map(id => ({ task_id: id, message })) };
        }

        return {
            load: async () => ok({ tasks: tasks.slice(), truncated: false }),
            backlogs: async () => data.backlogs || [],
            history: async taskId => ok(historyOf(taskId).slice()),
            assign: async ids => outcome(ids, ids.filter(assignOne), "Nicht mehr offen."),
            release: async (ids, comment = "") => outcome(ids, ids.filter(id => releaseOne(id, comment.trim())), "Nicht mehr in Bearbeitung."),
            complete: async (taskId, payload) => completeOne(taskId, payload),
            async comment(taskId, comment) {
                log(taskId, "COMMENTED", comment);
                return ok({ status: "commented", task_id: taskId });
            },
            mailTemplate: async task => ok({
                recipient: "service@example.test",
                subject: `${Model.actionLabel(task)} · ${Model.displayName(task.target_user_name)}`,
                body: `Bitte ${Model.actionLabel(task)} für ${Model.displayName(task.target_user_name)}.`
            }),
            async sendMail(taskId, mail) {
                log(taskId, "MAIL_SENT", "Mailbeauftragung versendet", {
                    details: { ...mail, cc: "team@example.test", bcc: "", initiator_user_id: me.user_id }
                });
                return ok({ status: "queued" });
            },
            // Jede dritte Aufgabe scheitert beim ersten Versuch, wie ein nicht erreichbares Zielsystem.
            async runIntegration(taskId) {
                await wait(650);
                const task = find(taskId);
                const info = details[taskId] ||= { history: [] };
                log(taskId, "BOT_DISPATCHED", "Integration gestartet");
                if (info.automation_fails_once && !info.automation_attempted) {
                    info.automation_attempted = true;
                    log(taskId, "BOT_RESPONSE", "Fehlgeschlagen - Zielsystem nicht erreichbar", { details: { status: "error", message: "Zielsystem nicht erreichbar" } });
                    return fail(500, "Zielsystem nicht erreichbar");
                }
                const identifier = contract.isAccountAssignmentTask(task) ? `user${task.target_user_id}` : null;
                log(taskId, "BOT_RESPONSE", "Erfolgreich ausgeführt", { details: { status: "success", summary: "Erfolgreich ausgeführt", user_id: identifier } });
                const completed = completeOne(taskId, { comment: "Erfolgreich ausgeführt", account_identifier: identifier });
                return ok({ status: "success", task_completed: completed.ok, completion_error: completed.ok ? null : completed.message });
            }
        };
    }

    window.TasksBoardMock = { create };
}());
