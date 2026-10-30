"use strict";
const assert = require("node:assert/strict");
const utils = require("../app/static/js/sofa_utils.js");

assert.equal(utils.escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
assert.equal(utils.escapeHtml(null), "");
assert.equal(utils.escapeHtml(0), "0");
assert.equal(utils.withParams("/api/events", { from_date: "2026-10-19" }), "/api/events?from_date=2026-10-19");
assert.equal(utils.withParams("/api/mock?scenario=busy", { date: "2026-10-19" }), "/api/mock?scenario=busy&date=2026-10-19");
assert.equal(utils.withParams("/api/x", {}), "/api/x");
assert.equal(utils.apiErrorMessage({ detail: "Typ ist noch in Verwendung" }), "Typ ist noch in Verwendung");
assert.equal(utils.apiErrorMessage({ detail: [{ loc: ["body", "slug"], msg: "String should match pattern '^[A-Z0-9]{2,10}$'" }] }), "String should match pattern '^[A-Z0-9]{2,10}$'");
assert.equal(utils.apiErrorMessage({ error: "Request Error" }), "Request Error");
assert.equal(utils.apiErrorMessage({ detail: { code: "reevaluation_conflict", message: "Erneut ausführen", context: {} } }), "Erneut ausführen");
assert.equal(utils.apiErrorMessage({ detail: { code: "x" } }, "Fallback"), "Fallback");
assert.equal(utils.apiErrorMessage(null, "Fallback"), "Fallback");
assert.equal(utils.apiErrorMessage({ detail: [] }, "Fallback"), "Fallback");

console.log("sofa_utils_checks: ok");
