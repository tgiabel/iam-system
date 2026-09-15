(function (root, factory) {
    const contract = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = contract;
    }
    if (root) {
        root.SofaContract = contract;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function pad2(value) {
        return String(value).padStart(2, "0");
    }

    function localDateKey(value = new Date()) {
        return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
    }

    function parseDateKey(value, { exact = false } = {}) {
        if (typeof value !== "string") {
            return null;
        }

        const raw = value.trim();
        const match = (exact ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})/).exec(raw);
        if (!match) {
            return null;
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const calendarDate = new Date(year, month - 1, day);
        if (
            calendarDate.getFullYear() !== year ||
            calendarDate.getMonth() !== month - 1 ||
            calendarDate.getDate() !== day
        ) {
            return null;
        }

        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    function validateEffectiveDate(value, todayKey = localDateKey()) {
        const dateKey = parseDateKey(value, { exact: true });
        if (!dateKey) {
            return { ok: false, message: "Bitte einen gültigen Stichtag im Format YYYY-MM-DD angeben." };
        }
        if (dateKey < todayKey) {
            return { ok: false, message: "Der Stichtag darf nicht in der Vergangenheit liegen." };
        }
        return { ok: true, value: dateKey };
    }

    function toPositiveInteger(value) {
        const normalized = Number(value);
        return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
    }

    function buildPlannedRolePayload(userId, roleId, effectiveDate, todayKey = localDateKey()) {
        const normalizedUserId = toPositiveInteger(userId);
        const normalizedRoleId = toPositiveInteger(roleId);
        const dateResult = validateEffectiveDate(effectiveDate, todayKey);

        if (!normalizedUserId || !normalizedRoleId) {
            return { ok: false, message: "Bitte eine gültige Rolle auswählen." };
        }
        if (!dateResult.ok) {
            return dateResult;
        }

        return {
            ok: true,
            payload: {
                user_id: normalizedUserId,
                role_id: normalizedRoleId,
                effective_date: dateResult.value
            }
        };
    }

    function buildCancelPayload(reason) {
        if (typeof reason !== "string") {
            return { ok: false, message: "Bitte einen Grund für den Abbruch angeben." };
        }
        const normalized = reason.trim();
        if (!normalized) {
            return { ok: false, message: "Bitte einen Grund für den Abbruch angeben." };
        }
        if (normalized.length > 500) {
            return { ok: false, message: "Der Abbruchgrund darf höchstens 500 Zeichen lang sein." };
        }
        return { ok: true, payload: { reason: normalized } };
    }

    function formatDateKey(value) {
        const dateKey = parseDateKey(value);
        if (!dateKey) {
            return "-";
        }
        const [year, month, day] = dateKey.split("-");
        return `${day}.${month}.${year}`;
    }

    function isFutureRevocationTask(task, todayKey = localDateKey()) {
        if (String(task?.task_type || "").toUpperCase() !== "REVOCATION") {
            return false;
        }
        const targetDateKey = parseDateKey(task?.target_date);
        return Boolean(targetDateKey && targetDateKey > todayKey);
    }

    function canSendTaskMail(task, currentUserId) {
        return (
            String(task?.status || "").toUpperCase() === "IN_PROGRESS" &&
            String(task?.handling_type || "").toUpperCase() === "EXTERNAL" &&
            Number(task?.assigned_to_user_id) === Number(currentUserId)
        );
    }

    function extractDetailMessage(detail) {
        if (typeof detail === "string" && detail.trim()) {
            return detail.trim();
        }
        if (detail && typeof detail === "object") {
            if (typeof detail.message === "string" && detail.message.trim()) {
                return detail.message.trim();
            }
            if (typeof detail.error === "string" && detail.error.trim()) {
                return detail.error.trim();
            }
        }
        return "";
    }

    function mailErrorMessage(status, detail) {
        if (Number(status) === 503) {
            return "Der Mailversand ist derzeit deaktiviert. Es wurde keine Mail beauftragt.";
        }

        const backendMessage = extractDetailMessage(detail);
        if (backendMessage) {
            return backendMessage;
        }

        return ({
            400: "Die Maildaten sind ungültig. Bitte prüfe deine Eingaben.",
            401: "Deine Sitzung konnte für den Mailversand nicht bestätigt werden. Bitte melde dich neu an.",
            403: "Die Aufgabe ist dir nicht mehr zugewiesen oder du darfst keine Mail beauftragen.",
            404: "Die Aufgabe oder der Benutzer ist nicht mehr verfügbar.",
            409: "Die Aufgabe ist nicht mehr in Bearbeitung. Bitte aktualisiere die Ansicht.",
            422: "Bitte fülle alle Mailfelder im erwarteten Format aus."
        })[Number(status)] || "Die E-Mail konnte nicht zur Zustellung eingestellt werden.";
    }

    // Wiedereintritt: Preview und Start bekommen dieselben Formulardaten.
    function buildRehireForm(draft) {
        const text = key => (typeof draft?.[key] === "string" ? draft[key].trim() : "");
        const form = {
            pnr: text("pnr"),
            first_name: text("first_name"),
            last_name: text("last_name"),
            primary_role_id: toPositiveInteger(draft?.primary_role_id),
            telephone: text("telephone"),
            entry_date: parseDateKey(text("entry_date"), { exact: true }),
            weekly_hours: toPositiveInteger(draft?.weekly_hours)
        };

        if (!form.pnr || !form.first_name || !form.last_name || !form.telephone) {
            return { ok: false, message: "Bitte alle Pflichtfelder ausfüllen." };
        }
        if (!form.primary_role_id) {
            return { ok: false, message: "Bitte eine Hauptrolle auswählen." };
        }
        if (!form.entry_date) {
            return { ok: false, message: "Bitte ein gültiges Eintrittsdatum angeben." };
        }
        if (!form.weekly_hours) {
            return { ok: false, message: "Bitte gültige Wochenstunden angeben." };
        }
        return { ok: true, payload: form };
    }

    const BUSINESS_REFERENCE_MAX_LENGTH = 100;

    function buildRehireStartPayload(form, stateFingerprint, businessReference, confirmed) {
        const reference = typeof businessReference === "string" ? businessReference.trim() : "";
        if (!reference) {
            return { ok: false, message: "Bitte eine Geschäftsreferenz angeben." };
        }
        if (reference.length > BUSINESS_REFERENCE_MAX_LENGTH) {
            return { ok: false, message: "Die Geschäftsreferenz darf höchstens 100 Zeichen lang sein." };
        }
        if (confirmed !== true) {
            return { ok: false, message: "Bitte die Prüfung der Daten bestätigen." };
        }
        if (typeof stateFingerprint !== "string" || !stateFingerprint) {
            return { ok: false, message: "Die Vorschau fehlt. Bitte die Vorschau neu laden." };
        }
        return {
            ok: true,
            payload: {
                ...form,
                state_fingerprint: stateFingerprint,
                confirmed: true,
                business_reference: reference
            }
        };
    }

    // Einordnung der SD-API-Codes fuer den Dialog:
    // form    = Formulardaten korrigieren, zurueck zum Formular
    // stale   = Bestand hat sich geaendert, Vorschau neu laden und erneut bestaetigen
    // blocked = fachlich kein Wiedereintritt moeglich, Dialog kann nur geschlossen werden
    // review  = auf der Pruefseite korrigierbar oder unbekannt, Meldung anzeigen
    const REHIRE_ERROR_KINDS = {
        invalid_request: "form",
        entry_before_exit: "form",
        primary_role_invalid: "form",
        empty_role_package: "form",
        preview_stale: "stale",
        state_fingerprint_missing: "stale",
        user_not_found: "blocked",
        user_active: "blocked",
        open_process: "blocked",
        no_completed_offboarding: "blocked",
        exit_date_missing: "blocked",
        remaining_role_assignments: "blocked",
        remaining_resource_assignments: "blocked",
        remaining_user_accounts: "blocked"
    };

    function classifyRehireError(detail, fallback) {
        const code = detail && typeof detail === "object" && typeof detail.code === "string" ? detail.code : "";
        return {
            code,
            kind: REHIRE_ERROR_KINDS[code] || "review",
            message: extractDetailMessage(detail) || fallback,
            context: detail && typeof detail === "object" && detail.context && typeof detail.context === "object"
                ? detail.context
                : {}
        };
    }

    function isAccountAssignmentTask(task) {
        return Number(task?.resource_type_id) === 1 && String(task?.task_type || "").toUpperCase() === "ASSIGNMENT";
    }

    // Archivierte Konten derselben Person und Ressource, die im Task wiederhergestellt werden koennen.
    function getArchivedAccounts(task) {
        if (!isAccountAssignmentTask(task) || !Array.isArray(task?.archived_accounts)) {
            return [];
        }
        return task.archived_accounts
            .filter(account => toPositiveInteger(account?.user_account_history_id))
            .map(account => ({
                userAccountHistoryId: toPositiveInteger(account.user_account_history_id),
                accountIdentifier: String(account.account_identifier || ""),
                archivedAt: account.archived_at || null,
                restorable: account.identifier_in_use_by_other !== true
            }));
    }

    return {
        buildCancelPayload,
        buildRehireForm,
        buildRehireStartPayload,
        classifyRehireError,
        getArchivedAccounts,
        isAccountAssignmentTask,
        buildPlannedRolePayload,
        canSendTaskMail,
        extractDetailMessage,
        formatDateKey,
        isFutureRevocationTask,
        localDateKey,
        mailErrorMessage,
        parseDateKey,
        validateEffectiveDate
    };
}));
