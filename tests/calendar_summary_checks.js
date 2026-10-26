"use strict";
const assert = require("node:assert/strict");
const calendar = require("../app/static/js/calendar_summary.js");

// ---------- Kalender ----------
const ev = (type, day, extra = {}) => ({
    title: "", description: "", event_type: type, event_status: "PLANNED",
    display_at: `${day}T00:00:00`, user_id: null, process_id: null, role_id: null, ...extra
});

assert.equal(calendar.kindOf(ev("ROLE_ASSIGNMENT", "2026-10-14", { process_type: "CHANGE" })), "change");
assert.equal(calendar.kindOf(ev("ROLE_REMOVAL", "2026-10-14", { title: "Abteilungswechsel: Altrolle entziehen" })), "removal", "nur process_type zaehlt, nicht der Titel");
assert.equal(calendar.kindOf(ev("GIBTS_NICHT", "2026-10-14")), "other");
assert.equal(calendar.roleOf(ev("TRAINING_SCHEDULE", "2026-10-14", { role_name: " Kündigung ", description: "Retouren Schulung für Mia Hoffmann." })), "Kündigung");
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

assert.deepEqual(calendar.kindCounts(week), [
    { kind: "onboarding", count: 3 },
    { kind: "offboarding", count: 1 },
    { kind: "training", count: 2 },
    { kind: "change", count: 1 },
    { kind: "removal", count: 1 }
], "Schulungen zaehlen je Skill und Tag, sonst Einheiten inkl. erledigter; abgebrochene fehlen");
assert.deepEqual(calendar.kindCounts(calendar.eventsOnDay(week, "2026-10-15")), [
    { kind: "training", count: 1 },
    { kind: "change", count: 1 }
]);
assert.deepEqual(calendar.kindCounts(null), []);
assert.equal(calendar.countText("onboarding", 3), "3 Onboardings");
assert.equal(calendar.countText("training", 1), "1 Schulung");
assert.equal(calendar.countText("change", 2), "2 Abteilungswechsel");

const noUser = calendar.summarize([ev("ONBOARDING", "2026-10-12"), ev("ONBOARDING", "2026-10-12")]);
assert.equal(noUser[0].text, "2 Onboardings geplant", "ohne user_id zaehlen Events");

assert.equal(calendar.lineText("training", "", 1, "geplant"), "Schulung für 1 Mitarbeiter geplant");

// ---------- Tagesansicht ----------
assert.equal(calendar.nameOf({ user_name: "Mia Hoffmann" }), "Mia Hoffmann");
assert.equal(calendar.nameOf({ description: "Onboarding-Termin für Jonas Brandt." }), "", "kein Name aus dem Text");
assert.equal(calendar.roleOf({}), "");
assert.equal(calendar.joinNames(["A", "B"]), "A, B");
assert.equal(calendar.joinNames(["A", "B", "C"]), "A, B + 1 weitere");
assert.equal(calendar.joinNames(["A", "B", "A", "C", "D", "E"]), "A, B + 3 weitere", "doppelte Namen zaehlen einmal");
assert.equal(calendar.joinNames([]), "");

const day = [
    ev("ONBOARDING", "2026-10-14", { user_name: "A" }), ev("ONBOARDING", "2026-10-14", { user_name: "B" }),
    ev("ONBOARDING", "2026-10-14", { user_name: "C" }), ev("ONBOARDING", "2026-10-14", { user_name: "D" }),
    ev("TRAINING_SCHEDULE", "2026-10-14", { user_name: "E", role_name: "Retouren", display_at: "2026-10-14T14:00:00" }),
    ev("TRAINING_SCHEDULE", "2026-10-14", { user_name: "F", role_name: "Retouren", display_at: "2026-10-14T13:30:00" }),
    ev("TRAINING_SCHEDULE", "2026-10-14", { user_name: "G", role_name: "Kündigung" }),
    ev("ROLE_ASSIGNMENT", "2026-10-14", { user_name: "H", role_name: "Technik", event_status: "FAILED" }),
    ev("OFFBOARDING", "2026-10-14", { user_name: "I", event_status: "EXECUTED" }),
    ev("RETRAIN", "2026-10-14", { event_status: "SKIPPED", user_name: "X" })
];
const dayLines = calendar.summarizeDay(day);
assert.deepEqual(dayLines.map(line => line.text), [
    "Onboarding für A, B + 2 weitere",
    "Offboarding für I",
    "Kündigung-Schulung für G",
    "Retouren-Schulung für E, F",
    "Rollenzuweisung Technik für H"
]);
assert.equal(dayLines[3].time, "13:30", "fruehste Uhrzeit der Gruppe");
assert.deepEqual(dayLines.map(line => line.state), ["planned", "done", "planned", "planned", "failed"]);
assert.equal(dayLines[4].failedExtra, 1);
assert.equal(calendar.summarizeDay(null).length, 0);
assert.equal(calendar.summarizeDay([ev("ONBOARDING", "2026-10-14"), ev("ONBOARDING", "2026-10-14")])[0].text, "2 Onboarding", "ohne Namen zaehlen Events");

console.log("Dashboard model OK");
