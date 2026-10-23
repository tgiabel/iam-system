"use strict";
const assert = require("node:assert/strict");
const utils = require("../app/static/js/sofa_utils.js");

assert.equal(utils.escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
assert.equal(utils.escapeHtml(null), "");
assert.equal(utils.escapeHtml(0), "0");
assert.equal(utils.withParams("/api/events", { from_date: "2026-10-19" }), "/api/events?from_date=2026-10-19");
assert.equal(utils.withParams("/api/mock?scenario=busy", { date: "2026-10-19" }), "/api/mock?scenario=busy&date=2026-10-19");
assert.equal(utils.withParams("/api/x", {}), "/api/x");

console.log("sofa_utils_checks: ok");
