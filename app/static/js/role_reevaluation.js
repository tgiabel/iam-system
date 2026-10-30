// Reevaluierung eines Rollenpakets (SD-API B2): welcher Dry Run nach welcher Änderung, Zusammenfassung,
// Texte für skipped[] und notices[]. DOM-frei, geprüft in tests/role_reevaluation_checks.js.
(function (root, factory) {
    const model = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = model;
    }
    if (root) {
        root.RoleReevaluation = model;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const GRANT_ACTIONS = ["assign", "reassign", "reactivate"];
    // Neue Aufgaben entstehen nur hier; reactivate und abort brechen eine bestehende ab.
    const TASK_ACTIONS = ["assign", "reassign", "revoke"];

    const SKIP_REASONS = {
        offboarding_unlocked: "Offboarding läuft",
        role_requested: "Rolle noch beantragt",
        role_removal_planned: "Rollenentzug geplant",
        in_process: "In offenem Prozess"
    };
    const NOTICE_CODES = {
        requested_with_weaker_requirement: "Offene Aufgabe schwächer eingestuft",
        prerequisite_missing: "Voraussetzung fehlt"
    };

    // Rollenänderung: Nur ein Wechsel der Elternrolle ändert das wirksame Paket.
    function roleChange(before, payload) {
        return String(before?.parent_role_id ?? "") === String(payload?.parent_role_id ?? "") ? "master" : "parent";
    }

    // Dry Run nach einer Änderung, oder null (kein Abgleich). Hinzufügen und Entfernen prüfen nur die
    // tatsächlich gespeicherten Ressourcen; Elternrolle und „Abgleichen“ das ganze Paket.
    // Einstufung und Stammdaten erzeugen keinen Drift.
    function dryRunAfter(kind, resourceIds = []) {
        const ids = [...new Set(resourceIds.map(Number))];
        if (kind === "add" || kind === "remove") return ids.length ? { dry_run: true, resource_ids: ids } : null;
        if (kind === "parent" || kind === "drift") return { dry_run: true };
        return null;
    }

    // Anwenden mit demselben Filter wie die Vorschau und deren Token.
    function applyRequest(dryRun, preview) {
        const request = { dry_run: false, expected_preview_token: preview?.preview_token || null };
        if (dryRun?.resource_ids) request.resource_ids = dryRun.resource_ids;
        return request;
    }

    function needsDialog(result) {
        return Number(result?.affected_user_count) > 0;
    }

    function count(result, actions) {
        return actions.reduce((sum, action) => sum + (Number(result?.[`${action}_count`]) || 0), 0);
    }

    function summary(result) {
        return {
            people: Number(result?.affected_user_count) || 0,
            grants: count(result, GRANT_ACTIONS),
            revokes: count(result, ["revoke", "abort"]),
            tasks: count(result, TASK_ACTIONS)
        };
    }

    // Personen der Vorschau; via nennt erbende Rollen (nicht die Rolle selbst).
    function people(result, roleId) {
        return (result?.users || []).map(u => ({
            user_id: u.user_id,
            first_name: u.first_name || "",
            last_name: u.last_name || "",
            pnr: u.pnr || "",
            via: (u.via_roles || []).filter(v => String(v.role_id) !== String(roleId)).map(v => v.role_name || `#${v.role_id}`),
            changes: (u.changes || []).map(c => ({
                grant: GRANT_ACTIONS.includes(c.action),
                action: c.action,
                name: c.resource_name || `#${c.resource_id}`,
                blocked: (c.blocking_resource_ids || []).length > 0
            }))
        })).sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, "de"));
    }

    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    // Knappe Zeilen für skipped[] und notices[]: Personengründe zählen Personen, die übrigen Zuweisungen.
    // Hinweise sind kein Drift.
    function hintLines(result) {
        const groups = new Map();
        const add = (label, key, perPerson) => {
            if (!groups.has(label)) groups.set(label, { keys: new Set(), perPerson });
            groups.get(label).keys.add(key);
        };
        (result?.skipped || []).forEach(s => {
            const label = SKIP_REASONS[s.reason] || s.reason;
            const perPerson = s.resource_id == null;
            add(label, perPerson ? `${s.user_id}` : `${s.user_id}:${s.resource_id}`, perPerson);
        });
        (result?.notices || []).forEach(n => add(NOTICE_CODES[n.code] || n.code, `${n.user_id}:${n.resource_id}`, false));
        return [...groups].map(([label, g]) => `${label}: ${g.perPerson
            ? plural(g.keys.size, "Person", "Personen")
            : plural(g.keys.size, "Zuweisung", "Zuweisungen")}`);
    }

    // Ergebnis des Anwendens aus der Antwort, nicht aus der Vorschau.
    function appliedMessage(result) {
        const created = Number(result?.created_task_count) || 0;
        const blocked = Number(result?.blocked_task_count) || 0;
        const parts = [];
        if (created) parts.push(`${plural(created, "Aufgabe", "Aufgaben")} erstellt${blocked ? `, davon ${blocked} blockiert` : ""}`);
        if (Number(result?.reactivate_count)) parts.push(`${plural(Number(result.reactivate_count), "Entzug", "Entzüge")} zurückgenommen`);
        if (Number(result?.abort_count)) parts.push(`${plural(Number(result.abort_count), "Zuweisung", "Zuweisungen")} abgebrochen`);
        return parts.length ? parts.join(" · ") : "Nichts zu ändern";
    }

    // 409 beim Anwenden: outdated bringt die neue Vorschau mit, conflict heißt erneut ausführen.
    function applyFailure(error) {
        const detail = error?.status === 409 ? error.data?.detail : null;
        if (detail?.code === "reevaluation_preview_outdated" && detail.context?.preview) {
            return { kind: "outdated", preview: detail.context.preview };
        }
        if (detail?.code === "reevaluation_conflict") return { kind: "conflict" };
        return { kind: "error" };
    }

    return {
        SKIP_REASONS, NOTICE_CODES,
        roleChange, dryRunAfter, applyRequest, needsDialog, summary, people, hintLines, appliedMessage, applyFailure
    };
}));
