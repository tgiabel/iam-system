"use strict";
const assert = require("node:assert/strict");
const model = require("../app/static/js/role_reevaluation.js");

// Rollenänderung: nur die Elternrolle zählt, auch null gegen leer
assert.equal(model.roleChange({ parent_role_id: 12 }, { parent_role_id: 15 }), "parent");
assert.equal(model.roleChange({ parent_role_id: null }, { parent_role_id: 15 }), "parent");
assert.equal(model.roleChange({ parent_role_id: 12 }, { parent_role_id: null }), "parent");
assert.equal(model.roleChange({ parent_role_id: "12" }, { parent_role_id: 12 }), "master");
assert.equal(model.roleChange({}, { parent_role_id: null }), "master");

// Welcher Dry Run nach welcher Änderung
assert.deepEqual(model.dryRunAfter("add", [425, "427", 425]), { dry_run: true, resource_ids: [425, 427] });
assert.deepEqual(model.dryRunAfter("remove", [9001]), { dry_run: true, resource_ids: [9001] });
// Teilerfolg ohne gespeicherte IDs: kein Dry Run (leere Liste wäre 422 invalid_resource_filter)
assert.equal(model.dryRunAfter("add", []), null);
assert.deepEqual(model.dryRunAfter("parent"), { dry_run: true });
assert.deepEqual(model.dryRunAfter("drift"), { dry_run: true });
assert.equal(model.dryRunAfter("requirement", [1]), null);
assert.equal(model.dryRunAfter("master"), null);

// Anwenden: gleicher Filter, Token der Vorschau
assert.deepEqual(model.applyRequest({ dry_run: true, resource_ids: [5] }, { preview_token: "t1" }),
    { dry_run: false, expected_preview_token: "t1", resource_ids: [5] });
assert.deepEqual(model.applyRequest({ dry_run: true }, { preview_token: "t2" }), { dry_run: false, expected_preview_token: "t2" });

// Dialog nur bei betroffenen Personen; Hinweise allein sind kein Drift
assert.equal(model.needsDialog({ affected_user_count: 0, skipped: [{ user_id: 1, reason: "role_requested" }] }), false);
assert.equal(model.needsDialog({ affected_user_count: 2 }), true);
assert.equal(model.needsDialog(null), false);

// Zählung: Zuweisungen inkl. Reaktivierung, Entzüge inkl. Abbruch, Aufgaben nur assign/reassign/revoke
const preview = {
    role_id: 55, affected_user_count: 2, assign_count: 2, reassign_count: 1, reactivate_count: 1,
    revoke_count: 1, abort_count: 1, preview_token: "t1",
    users: [
        { user_id: 823, first_name: "Person", last_name: "B", pnr: "900002", via_roles: [{ role_id: 71, role_name: "Team 2" }],
          changes: [{ resource_id: 477, resource_name: "VRP Remedy", action: "revoke" }] },
        { user_id: 821, first_name: "Person", last_name: "A", pnr: "900001", via_roles: [{ role_id: 55, role_name: "Skill" }],
          changes: [{ resource_id: 431, resource_name: null, action: "assign", blocking_resource_ids: [115] }] }
    ]
};
assert.deepEqual(model.summary(preview), { people: 2, grants: 4, revokes: 2, tasks: 4 });
assert.deepEqual(model.summary({}), { people: 0, grants: 0, revokes: 0, tasks: 0 });

// Personen direkt aus users[], sortiert; via ohne die Rolle selbst
const people = model.people(preview, 55);
assert.deepEqual(people.map(p => p.pnr), ["900001", "900002"]);
assert.deepEqual(people[0].via, []);
assert.deepEqual(people[1].via, ["Team 2"]);
assert.deepEqual(people[0].changes, [{ grant: true, action: "assign", name: "#431", blocked: true }]);
assert.deepEqual(people[1].changes, [{ grant: false, action: "revoke", name: "VRP Remedy", blocked: false }]);

// skipped und notices: Personengründe zählen Personen, Ressourcengründe und Hinweise Zuweisungen
assert.deepEqual(model.hintLines({
    skipped: [
        { user_id: 1, resource_id: null, reason: "role_requested" },
        { user_id: 2, resource_id: null, reason: "role_requested" },
        { user_id: 3, resource_id: null, reason: "offboarding_unlocked" },
        { user_id: 4, resource_id: 10, reason: "in_process" },
        { user_id: 4, resource_id: 11, reason: "in_process" },
        { user_id: 5, resource_id: null, reason: "role_removal_planned" },
        { user_id: 6, resource_id: null, reason: "new_reason" }
    ],
    notices: [
        { user_id: 1, resource_id: 425, code: "requested_with_weaker_requirement" },
        { user_id: 2, resource_id: 425, code: "prerequisite_missing" },
        { user_id: 2, resource_id: 426, code: "prerequisite_missing" }
    ]
}), [
    "Rolle noch beantragt: 2 Personen",
    "Offboarding läuft: 1 Person",
    "In offenem Prozess: 2 Zuweisungen",
    "Rollenentzug geplant: 1 Person",
    "new_reason: 1 Person",
    "Offene Aufgabe schwächer eingestuft: 1 Zuweisung",
    "Voraussetzung fehlt: 2 Zuweisungen"
]);
assert.deepEqual(model.hintLines({}), []);

// Ergebnis aus der Antwort des Anwendens
assert.equal(model.appliedMessage({ created_task_count: 3, blocked_task_count: 1 }), "3 Aufgaben erstellt, davon 1 blockiert");
assert.equal(model.appliedMessage({ created_task_count: 1, reactivate_count: 1, abort_count: 2 }),
    "1 Aufgabe erstellt · 1 Entzug zurückgenommen · 2 Zuweisungen abgebrochen");
assert.equal(model.appliedMessage({ created_task_count: 0 }), "Nichts zu ändern");

// 409 beim Anwenden
const newPreview = { affected_user_count: 1, preview_token: "t2" };
assert.deepEqual(model.applyFailure({ status: 409, data: { detail: { code: "reevaluation_preview_outdated", context: { preview: newPreview } } } }),
    { kind: "outdated", preview: newPreview });
assert.deepEqual(model.applyFailure({ status: 409, data: { detail: { code: "reevaluation_conflict" } } }), { kind: "conflict" });
assert.deepEqual(model.applyFailure({ status: 409, data: { detail: "Konflikt" } }), { kind: "error" });
assert.deepEqual(model.applyFailure({ status: 403, data: { detail: { code: "page_access_denied" } } }), { kind: "error" });
assert.deepEqual(model.applyFailure(new Error("Netzwerk")), { kind: "error" });

console.log("role_reevaluation_checks: ok");
