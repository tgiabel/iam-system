"use strict";
const assert = require("node:assert/strict");
const model = require("../app/static/js/tasks_board_model.js");

const ME = 42;
const TODAY = "2026-10-14"; // Mittwoch
const task = (id, extra = {}) => ({
    task_id: id,
    task_type: "ASSIGNMENT",
    status: "OPEN",
    handling_type: "INTERNAL",
    provisioning_requirement: "REQUIRED",
    target_user_id: 600,
    target_user_name: "Maria Musterfrau",
    resource_name: `Ressource ${id}`,
    system_name: "Genesys",
    backlog_identifier: "TEL",
    assigned_to_user_id: null,
    assigned_to_user_name: null,
    created_at: "2026-10-10T08:00:00",
    target_date: null,
    ...extra
});

// ---------- Spalten ----------
assert.equal(model.columnOf(task(1)), "open");
assert.equal(model.columnOf(task(2, { provisioning_requirement: "deferred" })), "parked", "nachgelagerte in die Leiste");
assert.equal(model.columnOf(task(3, { status: "BLOCKED" })), "parked");
assert.equal(model.columnOf(task(4, { status: "IN_PROGRESS" })), "progress");
assert.equal(model.columnOf(task(5, { status: "COMPLETED" })), "done");
assert.equal(model.columnOf(task(6, { status: "CANCELLED" })), null, "abgebrochene erscheinen nicht");

// ---------- Eigen / fremd / auswählbar ----------
const mine = task(10, { status: "IN_PROGRESS", assigned_to_user_id: ME, assigned_to_user_name: "Abel Tesfe", assigned_at: "2026-10-14T08:00:00" });
const foreign = task(11, { status: "IN_PROGRESS", assigned_to_user_id: 9101, assigned_to_user_name: "Jonas Becker", assigned_at: "2026-10-12T09:00:00" });
assert.equal(model.isMine(mine, ME), true);
assert.equal(model.isMine(task(12, { assigned_to_user_id: "42" }), ME), true, "IDs als String und Zahl");
assert.equal(model.isForeign(foreign, ME), true);
assert.equal(model.isForeign(mine, ME), false);
assert.equal(model.isForeign(task(13), ME), false, "offene gehören niemandem");
assert.equal(model.canSelect(task(14), ME), true);
assert.equal(model.canSelect(task(15, { provisioning_requirement: "DEFERRED" }), ME), true, "nachgelagerte bleiben übernehmbar");
assert.equal(model.canSelect(task(16, { status: "BLOCKED" }), ME), false);
assert.equal(model.canSelect(mine, ME), true);
assert.equal(model.canSelect(foreign, ME), false);
assert.equal(model.canSelect(task(17, { status: "COMPLETED", assigned_to_user_id: ME }), ME), false);

// ---------- Datum ----------
assert.equal(model.weekStart("2026-10-14"), "2026-10-12");
assert.equal(model.weekStart("2026-10-12"), "2026-10-12");
assert.equal(model.weekStart("2026-10-18"), "2026-10-12", "Sonntag gehört zur Woche ab Montag");
assert.equal(model.formatDayLabel("2026-10-14", TODAY), "Heute");
assert.equal(model.formatDayLabel("2026-10-13", TODAY), "Gestern");
assert.equal(model.formatDayLabel("2026-10-09", TODAY), "Fr 09.10.");
assert.deepEqual(model.dueInfo(task(20, { target_date: "2026-10-10" }), TODAY), { tone: "overdue", label: "4 T überfällig", dueKey: "2026-10-10" });
assert.equal(model.dueInfo(task(21, { target_date: "2026-10-14T00:00:00" }), TODAY).tone, "today");
assert.equal(model.dueInfo(task(22, { target_date: "2026-10-20" }), TODAY).label, "fällig 20.10.");
assert.equal(model.dueInfo(task(23), TODAY), null);
assert.equal(model.ageLabel("2026-10-14T08:00:00", "2026-10-14T08:20:00"), "20 Min");
assert.equal(model.ageLabel("2026-10-14T08:00:00", "2026-10-14T13:59:00"), "5 Std");
assert.equal(model.ageLabel("2026-10-11T08:00:00", "2026-10-14T09:00:00"), "3 T");
assert.equal(model.timeOf("2026-10-14T09:05:00"), "09:05");

const done = (id, completedAt, assignee = ME) => task(id, {
    status: "COMPLETED", completed_at: completedAt, assigned_to_user_id: assignee, assigned_to_user_name: "X"
});
assert.equal(model.isInDoneRange(done(30, "2026-10-14T07:00:00"), "today", TODAY), true);
assert.equal(model.isInDoneRange(done(31, "2026-10-13T17:00:00"), "today", TODAY), false);
assert.equal(model.isInDoneRange(done(32, "2026-10-12T07:00:00"), "week", TODAY), true);
assert.equal(model.isInDoneRange(done(33, "2026-10-11T07:00:00"), "week", TODAY), false);
assert.equal(model.isInDoneRange(done(34, "2026-10-01T07:00:00"), "month", TODAY), true);
assert.equal(model.isInDoneRange(done(35, "2026-09-30T23:00:00"), "month", TODAY), false);

// ---------- Namen ----------
assert.equal(model.displayName("Becker, Jonas"), "Jonas Becker");
assert.equal(model.displayName("Jonas Becker"), "Jonas Becker");
assert.equal(model.initials("Becker, Jonas"), "JB");
assert.equal(model.initials("Cher"), "C");
assert.equal(model.initials(""), "?");

// ---------- Beschriftung ----------
assert.equal(model.actionLabel(task(80, { resource_name: "Genesys-Benutzer" })), "Genesys-Benutzer einrichten");
assert.equal(model.actionLabel(task(81, { resource_name: "VPN-Token", task_type: "revocation" })), "VPN-Token entziehen");
assert.equal(model.actionLabel(task(82, { resource_name: " " })), "Ressource einrichten");

// ---------- Ansicht ----------
const defaults = model.createDefaultView();
assert.deepEqual(model.normalizeView(null), defaults);
assert.deepEqual(model.normalizeView({ openGrouping: "quatsch", doneRange: "year", railOpen: "ja" }), defaults, "Unbekanntes fällt auf Standard");
const restored = model.normalizeView({ openGrouping: "process", openSort: "age", doneRange: "week", onlyMine: true, railOpen: true, search: "x", facets: { backlog: ["TEL"] } });
assert.equal(restored.search, "", "Suche wird nicht wiederhergestellt");
assert.deepEqual(restored.facets, { backlog: ["TEL"], taskType: [], handling: [] });
assert.equal("search" in model.serializeView(restored), false);

// ---------- Board ----------
const tasks = [
    task(1, { target_date: "2026-10-20" }),
    task(2, { target_date: "2026-10-01", created_at: "2026-10-13T08:00:00" }),
    task(3, { created_at: "2026-10-01T08:00:00" }),
    task(4, { status: "BLOCKED", target_user_id: 601, target_user_name: "Ute Zander" }),
    task(5, { provisioning_requirement: "DEFERRED", target_user_id: 602, target_user_name: "Bea Adler" }),
    mine,
    foreign,
    task(18, { status: "IN_PROGRESS", assigned_to_user_id: 9101, assigned_to_user_name: "Jonas Becker", assigned_at: "2026-10-11T09:00:00" }),
    task(19, { status: "IN_PROGRESS", assigned_to_user_id: 9102, assigned_to_user_name: "Lea Anders", assigned_at: "2026-10-14T07:00:00" }),
    done(40, "2026-10-14T09:00:00"),
    done(41, "2026-10-14T11:00:00", 9101),
    done(42, "2026-10-13T11:00:00"),
    task(50, { status: "CANCELLED" })
];
const ctx = { meId: ME, todayKey: TODAY };
let board = model.buildBoard(tasks, defaults, ctx);

assert.deepEqual(model.columnTaskIds(board, "open"), [2, 1, 3], "überfällig, terminiert, ohne Stichtag");
assert.equal(board.parked.count, 2);
assert.deepEqual(board.parked.sections.map(section => [section.key, section.count]), [["blocked", 1], ["deferred", 1]]);
assert.deepEqual(board.progress.groups.map(group => [group.label, group.isMine]), [
    ["Abel Tesfe", true], ["Jonas Becker", false], ["Lea Anders", false]
], "eigene zuerst, dann Kollegen nach Name");
assert.deepEqual(board.progress.groups[1].tasks.map(t => t.task_id), [18, 11], "am längsten übernommene oben");
assert.equal(board.progress.groups[1].initials, "JB");
assert.deepEqual(model.columnTaskIds(board, "done"), [41, 40], "nur heute, neueste oben");

board = model.buildBoard(tasks, { ...defaults, openSort: "age" }, ctx);
assert.deepEqual(model.columnTaskIds(board, "open"), [3, 1, 2], "älteste zuerst");

board = model.buildBoard(tasks, { ...defaults, doneRange: "week" }, ctx);
assert.deepEqual(board.done.groups.map(group => [group.label, group.tasks.length]), [["Heute", 2], ["Gestern", 1]]);

board = model.buildBoard(tasks, { ...defaults, onlyMine: true }, ctx);
assert.equal(board.open.count, 3, "Nur meine lässt Offen unberührt");
assert.equal(board.parked.count, 2);
assert.deepEqual(board.progress.groups.map(group => group.label), ["Abel Tesfe"]);
assert.deepEqual(model.columnTaskIds(board, "done"), [40]);

board = model.buildBoard(tasks, { ...defaults, openGrouping: "person" }, ctx);
assert.equal(board.open.groups.length, 1);
assert.equal(board.open.groups[0].label, "Maria Musterfrau");

board = model.buildBoard(tasks, { ...defaults, search: "becker" }, ctx);
assert.deepEqual(model.columnTaskIds(board, "progress"), [18, 11], "Suche findet Bearbeiter");
board = model.buildBoard(tasks, { ...defaults, search: "ressource 1" }, ctx);
assert.deepEqual(model.columnTaskIds(board, "open"), [1], "alle Suchbegriffe müssen passen");

board = model.buildBoard([...tasks, task(60, { backlog_identifier: "IT" })], { ...defaults, facets: { backlog: ["IT"], taskType: [], handling: [] } }, ctx);
assert.deepEqual(model.columnTaskIds(board, "open"), [60]);
assert.equal(model.countActiveFacets({ facets: { backlog: ["IT"], taskType: ["REVOCATION"], handling: [] } }), 2);
assert.equal(model.facetValue(task(61, { backlog_identifier: "" }), "backlog"), "__NONE__");

// ---------- Leiste ----------
const parkedOf = (blocked, deferred) => ({ sections: [{ key: "blocked", count: blocked }, { key: "deferred", count: deferred }] });
assert.equal(model.activeParkedSection(parkedOf(2, 3), "deferred"), "deferred");
assert.equal(model.activeParkedSection(parkedOf(2, 3), "blocked"), "blocked");
assert.equal(model.activeParkedSection(parkedOf(0, 3), "blocked"), "deferred", "leerer Bereich entfällt, der andere ist offen");
assert.equal(model.activeParkedSection(parkedOf(2, 0), "deferred"), "blocked");
assert.equal(model.activeParkedSection(parkedOf(0, 0), "blocked"), null);
assert.equal(model.activeParkedSection(parkedOf(2, 3), null), "blocked", "alte leere Auswahl erhält einen vorhandenen Bereich");
assert.equal(model.activeParkedSection(parkedOf(0, 3), null), "deferred", "der einzige vorhandene Bereich wird aktiv");
assert.equal(model.activeParkedSection(parkedOf(0, 0), null), null, "ohne Aufgaben gibt es keinen aktiven Bereich");
assert.equal(model.normalizeView({ railTab: null }).railTab, "blocked", "alte leere Auswahl wird beim Laden ersetzt");
assert.equal(model.normalizeView(model.serializeView({ ...defaults, railTab: null })).railTab, "blocked");
assert.equal(model.normalizeView({ railTab: "deferred" }).railTab, "deferred");
assert.equal(model.normalizeView({ railTab: "quatsch" }).railTab, "blocked");

// ---------- Auswahl ----------
const summary = model.summarizeSelection(tasks, new Set([1, 5, 10, 11, 4]), ME);
assert.equal(summary.count, 5);
assert.deepEqual(summary.assignable.map(t => t.task_id), [1, 5]);
assert.deepEqual(summary.releasable.map(t => t.task_id), [10], "fremde und blockierte zählen nicht");

const selectable = id => id !== 3;
assert.deepEqual(model.rangeSelection([2, 1, 3, 7], 2, 7, selectable), [2, 1, 7]);
assert.deepEqual(model.rangeSelection([2, 1, 3, 7], 7, 1, selectable), [1, 7], "auch rückwärts");
assert.deepEqual(model.rangeSelection([2, 1], 99, 1, selectable), [1], "ohne Anker nur das Ziel");

// ---------- Simulierte Aktionen ----------
const assigned = model.assignTo(task(70), { user_id: ME, name: "Abel Tesfe" }, "2026-10-14T10:00:00");
assert.equal(model.columnOf(assigned), "progress");
assert.equal(model.isMine(assigned, ME), true);
const released = model.release(assigned);
assert.equal(model.columnOf(released), "open");
assert.equal(released.assigned_to_user_id, null);

// Abschluss übernimmt offene Tasks; fremde und blockierte Tasks bleiben unangetastet.
const stamp = "2026-10-14T12:00:00";
const completed = model.completeTask(task(90), {user_id: ME, name: "Abel Tesfe"}, stamp);
assert.equal(completed.status, "COMPLETED");
assert.equal(completed.assigned_to_user_id, ME);
assert.equal(completed.completed_at, stamp);
assert.equal(model.completeTask(mine, {user_id: ME}, stamp).assigned_at, mine.assigned_at);
assert.strictEqual(model.completeTask(foreign, {user_id: ME}, stamp), foreign);
const blocked = task(91, {status: "BLOCKED"});
assert.strictEqual(model.completeTask(blocked, {user_id: ME}, stamp), blocked);

const revoke = task(92, {task_type: "REVOCATION", resource_type_id: 1});
const related = id => task(id, {task_type: "REVOCATION"});
assert.deepEqual(model.relatedRevocations(revoke, [
    revoke, related(93), {...related(94), ...mine, task_id: 94, task_type: "REVOCATION"},
    {...related(95), ...foreign, task_id: 95, task_type: "REVOCATION"},
    related(96), {...related(97), status: "BLOCKED"}, {...related(98), target_user_id: 999},
    {...related(99), system_name: "Microsoft"}, {...related(100), status: "COMPLETED"}
], ME).map(t => t.task_id), [93, 94, 96], "Vorschläge nur offen/eigen, gleiche Person und gleiches System");
assert.deepEqual(model.relatedRevocations({...revoke, resource_type_id: 2}, [related(93)], ME), []);


// Mit abgeschlossene Entzüge: generischer Hinweis im Kommentar, eigener Kommentar bleibt erhalten.
assert.equal(model.relatedCompletionComment(""), "Mit dem Kontoentzug erledigt.");
assert.equal(model.relatedCompletionComment("  Geprüft. "), "Mit dem Kontoentzug erledigt. Geprüft.");
{
    const long = model.relatedCompletionComment("x".repeat(model.COMMENT_MAX_LENGTH));
    assert.equal(long.length, model.COMMENT_MAX_LENGTH, "Hinweis plus Kommentar bleibt bei 255 Zeichen");
    assert.ok(long.endsWith("…"));
}

// Prozess-Suche und Hinweis auf blockierte Tasks je Prozess.
{
    const base = model.createDefaultView();
    const tasks = [
        task(201, {process_id: 71}), task(202, {process_id: 712}),
        task(203, {process_id: 71, status: "BLOCKED"}), task(204, {process_id: 71, status: "BLOCKED", backlog_identifier: "IT"}),
        task(205, {process_id: 712, status: "BLOCKED"}), task(206, {status: "BLOCKED"})
    ];
    const ids = view => tasks.filter(t => model.matchesView(t, view, ME, {})).map(t => t.task_id);
    assert.equal(model.processQuery(71), "#71");
    assert.deepEqual(ids({...base, search: "#71"}), [201, 203, 204], "#71 trifft nicht #712");
    assert.deepEqual(model.blockedByProcess(tasks, {...base, search: "irgendwas"}, ME, {}), {71: 2, 712: 1},
        "Suche zählt nicht mit, Tasks ohne Prozess fehlen");
    assert.deepEqual(model.blockedByProcess(tasks, {...base, facets: {...base.facets, backlog: ["TEL"]}}, ME, {}), {71: 1, 712: 1},
        "Facetten gelten");
    const board = model.buildBoard(tasks, {...base, openGrouping: "process"}, {meId: ME, todayKey: TODAY});
    assert.deepEqual(board.open.blockedByProcess, {71: 2, 712: 1});
    assert.equal(model.buildBoard(tasks, base, {meId: ME, todayKey: TODAY}).open.blockedByProcess, undefined);
}

// Abschlussregeln: gelten für jeden Abschlussweg.
{
    const account = task(301, {resource_type_id: 1, task_type: "ASSIGNMENT", status: "IN_PROGRESS", assigned_to_user_id: ME,
        archived_accounts: [{user_account_history_id: 9, account_identifier: "alt1", archived_at: "2026-01-01T00:00:00"}]});
    const plan = (t, input = {}) => model.completionPlan(t, {tasks: [t], meId: ME, todayKey: TODAY, ...input});
    assert.equal(plan(account).issue.field, "accountChoice", "archiviertes Konto verlangt eine Entscheidung");
    assert.equal(plan(account, {accountChoice: "9"}).issue.field, "restored");
    assert.equal(plan(account, {accountChoice: "9", restored: true}).issue, null);
    assert.equal(plan(account, {accountChoice: "9", restored: true}).archive.accountIdentifier, "alt1");
    assert.equal(plan(account, {accountChoice: "new"}).issue.field, "identifier");
    assert.equal(plan(account, {accountChoice: "new", identifier: " neu "}).issue, null);

    const fresh = {...account, archived_accounts: []};
    assert.equal(plan(fresh).needsIdentifier, true);
    const bot = {...fresh, handling_type: "BOT"};
    assert.equal(plan(bot).automatic, true);
    assert.equal(plan(bot).issue, null, "Automatisierung braucht keine Kennung");
    assert.equal(plan(bot, {manual: true}).issue.field, "identifier", "nach Fehlschlag manuell erfassen");

    const revoke = task(310, {task_type: "REVOCATION", resource_type_id: 1, target_date: "2026-10-20", status: "IN_PROGRESS", assigned_to_user_id: ME});
    const group = task(311, {task_type: "REVOCATION", target_date: "2026-10-30"});
    const tasks = [revoke, group];
    const early = model.completionPlan(revoke, {tasks, meId: ME, todayKey: TODAY, relatedIds: [311]});
    assert.deepEqual(early.included.map(t => t.task_id), [310, 311]);
    assert.deepEqual(early.early.map(t => t.task_id), [310, 311], "beide Entzüge liegen vor dem Stichtag");
    assert.equal(early.issue.field, "early");
    assert.equal(model.completionPlan(revoke, {tasks, meId: ME, todayKey: TODAY, relatedIds: [311], earlyIds: [310, 311]}).issue, null);
    assert.equal(model.completionPlan(revoke, {tasks, meId: ME, todayKey: TODAY, earlyIds: [310]}).issue, null,
        "nicht gewählte verwandte Entzüge brauchen keine Bestätigung");
}

console.log("tasks_board_model_checks: ok");
