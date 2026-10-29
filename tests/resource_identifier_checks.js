"use strict";
const assert = require("node:assert/strict");
const identifier = require("../app/static/js/resource_identifier.js");

assert.equal(identifier.prefix("GC", "QUEUE"), "GC-QUEUE-");

assert.ok(identifier.isValidCode("DZ_SPERRE"));
assert.ok(identifier.isValidCode("A1"));
assert.ok(!identifier.isValidCode(""));
assert.ok(!identifier.isValidCode("dz_sperre"));
assert.ok(!identifier.isValidCode("DZ__SPERRE"));
assert.ok(!identifier.isValidCode("_DZ"));
assert.ok(!identifier.isValidCode("DZ-SPERRE"));

assert.deepEqual(identifier.split("GC-QUEUE-DZ_SPERRE", "GC-QUEUE-"), { mode: "code", code: "DZ_SPERRE" });
// Altbestand: kein Kuerzel hinter dem Praefix oder anderer Typ im Identifier
assert.deepEqual(identifier.split("GC-ACC", "GC-ACC-"), { mode: "free", value: "GC-ACC" });
assert.deepEqual(identifier.split("GC-MISC-WRTC", "GC-PHONE-"), { mode: "free", value: "GC-MISC-WRTC" });
assert.deepEqual(identifier.split("VRP-SYS-a", "VRP-SYS-"), { mode: "free", value: "VRP-SYS-a" });
assert.deepEqual(identifier.split(null, "GC-ACC-"), { mode: "free", value: "" });

console.log("resource_identifier_checks: ok");
