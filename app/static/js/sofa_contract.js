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

    function berlinDateKey(value = new Date()) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
        }).formatToParts(value);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
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

    function buildCancelPayload(reason, acknowledgedTaskIds) {
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
        const payload = { reason: normalized };
        if (Array.isArray(acknowledgedTaskIds)) {
            payload.acknowledged_task_ids = acknowledgedTaskIds;
        }
        return { ok: true, payload };
    }

    const CONFIRMATION_CODES = new Set(["cancellation_requires_confirmation", "offboarding_cancels_started_work"]);

    // Ein 409, der keine Ablehnung ist, sondern nach Bestaetigung fragt.
    function parseConfirmationRequest(detail) {
        if (!detail || typeof detail !== "object" || !CONFIRMATION_CODES.has(detail.code)) {
            return null;
        }
        const context = detail.context && typeof detail.context === "object" ? detail.context : {};
        const warnings = (Array.isArray(context.warnings) ? context.warnings : [])
            .filter(warning => warning && Number.isInteger(warning.task_id))
            .map(warning => ({
                taskId: warning.task_id,
                kind: typeof warning.kind === "string" ? warning.kind : "",
                message: typeof warning.message === "string" ? warning.message : ""
            }));
        return {
            code: detail.code,
            message: extractDetailMessage(detail),
            warnings,
            taskIds: warnings.map(warning => warning.taskId),
            unlockAt: typeof context.unlock_at === "string" ? context.unlock_at : null,
            unlocksImmediately: context.unlocks_immediately === true
        };
    }

    // Eine Ruecknahme lehnt die API beim manuellen Abbruch ab; der Button waere nur ein Fehlerweg.
    function isProcessCancellable(processType) {
        return String(processType || "").trim().toUpperCase() !== "ROLLBACK";
    }

    function cancellationSuccessMessage(result) {
        return result && Number.isInteger(result.rollback_process_id)
            ? "Prozess abgebrochen, Rücknahme eingeleitet"
            : "Prozess abgebrochen";
    }

    function canPreviewReschedule(effectiveDate, expectedEffectiveDate, todayKey = berlinDateKey()) {
        const dateResult = validateEffectiveDate(effectiveDate, todayKey);
        return dateResult.ok && dateResult.value !== parseDateKey(expectedEffectiveDate);
    }

    function buildReschedulePayload(effectiveDate, expectedEffectiveDate, reason, todayKey = berlinDateKey()) {
        const dateResult = validateEffectiveDate(effectiveDate, todayKey);
        if (!dateResult.ok) return dateResult;
        const expected = parseDateKey(expectedEffectiveDate);
        if (!expected) {
            return { ok: false, message: "Der erwartete bisherige Stichtag fehlt." };
        }
        if (dateResult.value === expected) {
            return { ok: false, message: "Bitte einen anderen Stichtag auswählen." };
        }
        if (reason === undefined) {
            return { ok: true, payload: { effective_date: dateResult.value } };
        }
        if (typeof reason !== "string" || !reason.trim()) {
            return { ok: false, message: "Bitte einen Grund für die Terminänderung angeben." };
        }
        const normalizedReason = reason.trim();
        if (normalizedReason.length > 500) {
            return { ok: false, message: "Der Änderungsgrund darf höchstens 500 Zeichen lang sein." };
        }
        return {
            ok: true,
            payload: {
                effective_date: dateResult.value,
                expected_effective_date: expected,
                reason: normalizedReason
            }
        };
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

    // Account-Kennungen im Sidepanel. Quelle sind resources[] (Zuweisungen mit Status) und
    // accounts[] der Detailantwort; entzogene Zuweisungen gehoeren nicht ins Panel.
    const ACCOUNT_RESOURCE_TYPE_ID = 1;
    const ACCOUNT_STATUS_PRIORITY = { active: 3, revocation_requested: 2, requested: 1 };
    const ACCOUNT_CORRECTABLE_STATUSES = ["active", "revocation_requested"];

    function normalizeAssignmentStatus(value) {
        return String(value || "active").trim().toLowerCase().replace(/\s+/g, "_");
    }

    function buildAccountRows(detail) {
        const resources = Array.isArray(detail?.resources) ? detail.resources : [];
        const accounts = Array.isArray(detail?.accounts) ? detail.accounts : [];

        const assignmentByResourceId = new Map();
        resources
            .filter(resource => Number(resource?.type_id) === ACCOUNT_RESOURCE_TYPE_ID)
            .forEach(resource => {
                const status = normalizeAssignmentStatus(resource.assignment_status);
                if (!(status in ACCOUNT_STATUS_PRIORITY)) {
                    return;
                }
                const existing = assignmentByResourceId.get(resource.resource_id);
                if (!existing || ACCOUNT_STATUS_PRIORITY[status] > ACCOUNT_STATUS_PRIORITY[existing.status]) {
                    assignmentByResourceId.set(resource.resource_id, { resource, status });
                }
            });

        const describe = resource => ({
            resourceName: String(resource?.display_name || resource?.technical_identifier || ""),
            systemName: String(resource?.system_name || "")
        });

        const linkedResourceIds = new Set();
        const accountRows = [];
        const legacyRows = [];
        accounts.forEach(account => {
            if (account?.resource_id === null || account?.resource_id === undefined) {
                legacyRows.push({
                    kind: "legacy",
                    accountIdentifier: String(account?.account_identifier || ""),
                    resourceId: null,
                    systemId: account?.system_id ?? null,
                    resourceName: "",
                    systemName: String(account?.system_name || ""),
                    status: null,
                    canEdit: false
                });
                return;
            }
            linkedResourceIds.add(account.resource_id);
            const assignment = assignmentByResourceId.get(account.resource_id);
            accountRows.push({
                kind: "account",
                accountIdentifier: String(account.account_identifier || ""),
                resourceId: account.resource_id,
                systemId: account.system_id ?? assignment?.resource?.system_id ?? null,
                ...describe(assignment?.resource),
                status: assignment ? assignment.status : null,
                canEdit: Boolean(assignment && ACCOUNT_CORRECTABLE_STATUSES.includes(assignment.status))
            });
        });

        const missingRows = [];
        assignmentByResourceId.forEach(({ resource, status }, resourceId) => {
            if (linkedResourceIds.has(resourceId)) {
                return;
            }
            missingRows.push({
                kind: "missing",
                accountIdentifier: "",
                resourceId,
                systemId: resource.system_id ?? null,
                ...describe(resource),
                status,
                canEdit: status === "active",
                // Der Service verknuepft ueber das System: gleiche Kennung = LINKED.
                legacyAccountIdentifiers: legacyRows
                    .filter(row => row.systemId !== null && String(row.systemId) === String(resource.system_id))
                    .map(row => row.accountIdentifier)
            });
        });

        return [...accountRows, ...missingRows, ...legacyRows];
    }

    const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

    function buildAccountIdentifierPayload({ accountIdentifier, comment, expectedAccountIdentifier, adoptUnlinkedAccount }) {
        const identifier = typeof accountIdentifier === "string" ? accountIdentifier.trim() : "";
        const normalizedComment = typeof comment === "string" ? comment.trim() : "";

        if (!identifier) {
            return { ok: false, message: "Bitte eine Kennung eintragen." };
        }
        if (identifier.length > 255 || CONTROL_CHARACTERS.test(identifier)) {
            return { ok: false, message: "Die Kennung darf höchstens 255 Zeichen lang sein und keine Steuerzeichen enthalten." };
        }
        if (normalizedComment.length < 3 || normalizedComment.length > 500) {
            return { ok: false, message: "Bitte einen Kommentar mit 3 bis 500 Zeichen angeben." };
        }

        const payload = {
            account_identifier: identifier,
            comment: normalizedComment,
            // Immer mitsenden: null heisst "kein Konto erwartet", damit SD-API parallele Aenderungen erkennt.
            expected_account_identifier: expectedAccountIdentifier ? String(expectedAccountIdentifier) : null
        };
        if (adoptUnlinkedAccount === true) {
            payload.adopt_unlinked_account = true;
        }
        return { ok: true, payload };
    }

    const ACCOUNT_IDENTIFIER_OUTCOMES = {
        CORRECTED: "Kennung korrigiert",
        CREATED: "Kennung nachgetragen",
        LINKED: "Bestandskonto verknüpft",
        UNCHANGED: "Kennung war bereits gesetzt, keine Änderung"
    };

    function accountIdentifierOutcomeMessage(outcome) {
        const action = String(outcome?.action || "").toUpperCase();
        const label = ACCOUNT_IDENTIFIER_OUTCOMES[action] || "Kennung gespeichert";
        return outcome?.account_identifier && action !== "UNCHANGED"
            ? `${label}: ${outcome.account_identifier}`
            : label;
    }

    // Welche Aktionen im User-Sidepanel fachlich passen. Ausgetretene Personen bekommen nur den
    // Wiedereintritt und das Entziehen eines verbliebenen SOFA-Zugangs; alles, was eine laufende
    // Beschaeftigung voraussetzt, gilt nur fuer aktive Personen. Rechte prueft der Aufrufer.
    function isInactiveUser(user) {
        return user?.is_active === false || user?.is_active === 0;
    }

    function getUserPanelActions(user) {
        const active = !isInactiveUser(user);
        const hasSofaAccess = Boolean(user?.has_sofa_access);
        return {
            rehire: !active,
            offboarding: active,
            roleActions: active,
            sofaSetup: active && !hasSofaAccess,
            sofaReset: active && hasSofaAccess,
            sofaRevoke: hasSofaAccess
        };
    }

    return {
        berlinDateKey,
        canPreviewReschedule,
        accountIdentifierOutcomeMessage,
        buildAccountIdentifierPayload,
        buildAccountRows,
        buildCancelPayload,
        cancellationSuccessMessage,
        isProcessCancellable,
        parseConfirmationRequest,
        buildReschedulePayload,
        buildRehireForm,
        buildRehireStartPayload,
        classifyRehireError,
        getArchivedAccounts,
        getUserPanelActions,
        isInactiveUser,
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
