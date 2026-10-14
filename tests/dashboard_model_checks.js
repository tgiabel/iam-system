"use strict";
const assert = require("node:assert/strict");
const model = require("../app/static/js/dashboard_model.js");
const calendar = require("../app/static/js/calendar_summary.js");

// ---------- Tasks ----------
const TODAY = "2026-10-14";
const task = (target, extra = {}) => ({ target_date: target, provisioning_requirement: "REQUIRED", ...extra });

assert.equal(model.nextDateKey("2026-10-31"), "2026-11-01");
assert.equal(model.nextDateKey("2026-12-31"), "2027-01-01");

const stats = model.taskStats({
    open_tasks: [task("2026-10-14"), task("2026-10-14"), task("2026-10-15"), task("2026-10-10"), task(null), task("2026-10-14", { provisioning_requirement: "DEFERRED" })],
    blocked_tasks: [task("2026-10-14"), task("2026-11-01", { provisioning_requirement: "deferred" })],
    user_tasks: [task("2026-10-15"), task(null)]
}, TODAY);
assert.deepEqual(stats, {
    open: 5, blocked: 1, inProgress: 2, active: 8, mine: 2,
    overdue: 1, dueToday: 3, dueTomorrow: 2, deferred: 2, deferredHigh: false
}, "nachgelagerte zaehlen nicht als aktiv oder faellig");

assert.equal(model.taskStats({ open_tasks: [], blocked_tasks: [], user_tasks: [task(null)], in_progress_total: 11 }, TODAY).active, 11,
    "Gesamtzahl in Bearbeitung ersetzt die eigenen");
assert.equal(model.taskStats({ open_tasks: Array.from({ length: 25 }, () => task(null, { provisioning_requirement: "DEFERRED" })) }, TODAY).deferredHigh, true);
assert.equal(model.taskStats(null, TODAY).active, 0, "fehlende Antwort ergibt Nullen");

// ---------- Servicelevel ----------
const sl = model.serviceLevel({ target_percent: 80, threshold_seconds: 20, today: { percent: 82.44, offered: 10, abandoned: 1 }, yesterday: { percent: 79.1 } });
assert.equal(sl.text, "82,4 %");
assert.equal(sl.tone, "ok");
assert.equal(sl.delta, 3.3);
assert.equal(model.serviceLevel({ target_percent: 80, today: { percent: 72 } }).tone, "warn");
assert.equal(model.serviceLevel({ target_percent: 80, today: { percent: 61 } }).tone, "bad");
assert.equal(model.serviceLevel({ target_percent: 80, today: { percent: 61 } }).delta, null);
assert.equal(model.serviceLevel({}), null);

// ---------- Kalender ----------
const ev = (type, day, extra = {}) => ({
    title: "", description: "", event_type: type, event_status: "PLANNED",
    display_at: `${day}T00:00:00`, user_id: null, process_id: null, role_id: null, ...extra
});

assert.equal(calendar.kindOf(ev("ROLE_ASSIGNMENT", "2026-10-14", { process_type: "CHANGE" })), "change");
assert.equal(calendar.kindOf(ev("ROLE_REMOVAL", "2026-10-14", { title: "Abteilungswechsel: Altrolle entziehen" })), "change", "Fallback ueber den Titel");
assert.equal(calendar.kindOf(ev("GIBTS_NICHT", "2026-10-14")), "other");
assert.equal(calendar.skillOf(ev("TRAINING_SCHEDULE", "2026-10-14", { description: "Retouren Schulung für Mia Hoffmann." })), "Retouren", "Skill aus dem Text");
assert.equal(calendar.skillOf(ev("TRAINING_SCHEDULE", "2026-10-14", { role_name: "Kündigung", description: "x" })), "Kündigung");
assert.equal(calendar.timeOf(ev("ONBOARDING", "2026-10-14")), "");
assert.equal(calendar.timeOf({ display_at: "2026-10-14T08:30:00" }), "08:30");

const week = [
    ev("ONBOARDING", "2026-10-12", { user_id: 1 }), ev("ONBOARDING", "2026-10-12", { user_id: 2 }), ev("ONBOARDING", "2026-10-14", { user_id: 2 }),
    ev("TRAINING_SCHEDULE", "2026-10-13", { user_id: 1, role_id: 11, role_name: "Retouren" }),
    ev("TRAINING_SCHEDULE", "2026-10-13", { user_id: 2, role_id: 11, role_name: "Retouren" }),
    ev("TRAINING_SCHEDULE", "2026-10-15", { user_id: 3, role_id: 12, role_name: "Technik 2nd Level" }),
    ev("ROLE_ASSIGNMENT", "2026-10-15", { user_id: 4, process_id: 9, process_type: "CHANGE" }),
    ev("ROLE_REMOVAL", "2026-10-15", { user_id: 4, process_id: 9, process_type: "CHANGE" }),
    ev("ROLE_REMOVAL", "2026-10-16", { user_id: 5, process_id: 10, event_status: "FAILED" }),
    ev("OFFBOARDING", "2026-10-16", { user_id: 6, event_status: "EXECUTED" }),
    ev("RETRAIN", "2026-10-16", { user_id: 7, event_status: "CANCELED" }),
    ev("ONBOARDING", "2026-10-12", { user_id: 8, event_status: "EXECUTED" }),
    { event_type: "ONBOARDING", event_status: "PLANNED", display_at: null }
];
const lines = calendar.summarize(week);
const texts = lines.map(line => line.text);
assert.deepEqual(texts, [
    "2 Onboardings geplant",
    "1 Offboarding erledigt",
    "Retouren-Schulung für 2 Mitarbeiter geplant",
    "Schulung „Technik 2nd Level“ für 1 Mitarbeiter geplant",
    "1 Abteilungswechsel geplant",
    "1 Rollenentzug fehlgeschlagen"
], "Reihenfolge nach Art; abgebrochene und undatierte Events fehlen");
const onboarding = lines[0];
assert.equal(onboarding.done, 1, "erledigte Onboardings als Zusatz");
assert.equal(onboarding.state, "planned");
assert.equal(lines.at(-1).state, "failed");
assert.equal(lines.at(-1).failedExtra, 0, "reiner Fehler steht schon im Haupttext");
assert.equal(lines[4].total, 1, "zwei Events eines Abteilungswechsels zaehlen als ein Vorgang");

assert.equal(calendar.dayTotal(week, "2026-10-12"), 3);
assert.equal(calendar.dayTotal(week, "2026-10-17"), 0);
assert.equal(calendar.eventsOnDay(week, "2026-10-13").length, 2);
assert.deepEqual(calendar.summarize(null), []);

const noUser = calendar.summarize([ev("ONBOARDING", "2026-10-12"), ev("ONBOARDING", "2026-10-12")]);
assert.equal(noUser[0].text, "2 Onboardings geplant", "ohne user_id zaehlen Events");

assert.equal(calendar.lineText("training", "", 1, "geplant"), "Schulung für 1 Mitarbeiter geplant");

console.log("Dashboard model OK");
