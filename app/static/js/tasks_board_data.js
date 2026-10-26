// Datenzugang des Boards über die SOFA-API. Der Mock (tasks_board_mock.js) bietet dieselben Funktionen.
// Jede Funktion liefert {ok, data} oder {ok: false, status, message}; Sammelaktionen {done, failed}.
(function () {
    "use strict";

    const { fetchJson, withParams } = window.SofaUtils;
    const contract = window.SofaContract;

    const post = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    async function call(url, options, fallback, messageOf = (status, data) => contract.extractDetailMessage(data?.detail ?? data)) {
        try {
            const { ok, status, data } = await fetchJson(url, options);
            return ok ? { ok, data } : { ok, status, data, message: messageOf(status, data) || fallback };
        } catch (_) {
            return { ok: false, status: 0, message: "Server nicht erreichbar." };
        }
    }

    // Sammelaktionen antworten je Task mit success und message.
    function bulkOutcome(result, ids) {
        if (!result.ok) return { done: [], failed: ids.map(id => ({ task_id: id, message: result.message })) };
        const rows = Array.isArray(result.data?.results) ? result.data.results : [];
        return {
            done: rows.filter(row => row.success).map(row => row.task_id),
            failed: rows.filter(row => !row.success).map(row => ({ task_id: row.task_id, message: row.message || "Nicht möglich." }))
        };
    }

    function live() {
        return {
            async load(completedSince) {
                const result = await call(withParams("/api/tasks/overview", { completed_since: completedSince }), {}, "Aufgaben konnten nicht geladen werden.");
                if (!result.ok) return result;
                return { ok: true, data: { tasks: window.TasksBoardModel.tasksFromOverview(result.data), truncated: Boolean(result.data?.completed_truncated) } };
            },
            async backlogs() {
                const result = await call("/api/backlogs", {}, "");
                return result.ok && Array.isArray(result.data) ? result.data : [];
            },
            history: taskId => call(`/api/tasks/${encodeURIComponent(taskId)}/history`, {}, "Verlauf konnte nicht geladen werden."),
            async assign(ids) {
                return bulkOutcome(await call("/api/tasks/bulk-assign", post({ task_ids: ids }), "Übernehmen nicht möglich."), ids);
            },
            // Ein Kommentar geht nur beim einzelnen Freigeben mit (landet im RELEASED-Eintrag).
            async release(ids, comment = "") {
                if (ids.length === 1 && comment.trim()) {
                    const result = await call(withParams(`/api/tasks/${encodeURIComponent(ids[0])}/assign`, { comment: comment.trim() }), { method: "DELETE" }, "Freigeben nicht möglich.");
                    return result.ok ? { done: ids, failed: [] } : { done: [], failed: [{ task_id: ids[0], message: result.message }] };
                }
                return bulkOutcome(await call("/api/tasks/bulk-release", post({ task_ids: ids }), "Freigeben nicht möglich."), ids);
            },
            complete: (taskId, payload) => call(`/api/tasks/${encodeURIComponent(taskId)}/complete`, post(payload), "Abschließen nicht möglich."),
            comment: (taskId, comment) => call(`/api/tasks/${encodeURIComponent(taskId)}/comments`, post({ comment }), "Notiz konnte nicht gespeichert werden."),
            mailTemplate: task => call("/api/resources/mail_template", post({ resource_id: task.resource_id, user_id: task.target_user_id, task_type: task.task_type }), "Mailvorlage konnte nicht geladen werden."),
            sendMail: (taskId, mail) => call(`/api/tasks/${encodeURIComponent(taskId)}/send_mail`, post({ recipient: mail.recipient, cc: "", bcc: "", subject: mail.subject, body: mail.body }), "", (status, data) => contract.mailErrorMessage(status, data?.detail ?? data?.error)),
            runIntegration: taskId => call("/api/tasks/dispatch_bot", post({ task_id: taskId }), "Automatisierung konnte nicht gestartet werden.")
        };
    }

    window.TasksBoardData = { live };
}());
