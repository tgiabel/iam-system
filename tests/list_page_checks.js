"use strict";
const assert = require("node:assert/strict");
const L = require("../app/static/js/list_page.js");

// compareValues: Zahlen numerisch, Texte deutsch und mit Ziffern, Leeres immer am Ende.
assert.ok(L.compareValues(2, 10) < 0);
assert.ok(L.compareValues(2, 10, "desc") > 0);
assert.ok(L.compareValues("Queue 2", "Queue 10") < 0, "Ziffern numerisch");
assert.ok(L.compareValues("Ärger", "Bär") < 0, "Umlaute wie Grundbuchstabe");
assert.equal(L.compareValues("agent", "Agent"), 0, "ohne Groß/klein");
for (const dir of ["asc", "desc"]) {
    assert.ok(L.compareValues(null, "A", dir) > 0, `null am Ende (${dir})`);
    assert.ok(L.compareValues("A", "", dir) < 0, `leer am Ende (${dir})`);
    assert.equal(L.compareValues(undefined, null, dir), 0);
}

// sortBy: Schlüssel je Spalte, Gleichstand über _tie, Eingabe bleibt unverändert.
const rows = [
    { name: "Chat", users: 3 }, { name: "Agent", users: 3 }, { name: "Bot", users: 9 }, { name: "Leer", users: null }
];
const keys = { name: row => row.name, users: row => row.users, _tie: row => row.name };
assert.deepEqual(L.sortBy(rows, keys, { key: "users", dir: "desc" }).map(row => row.name), ["Bot", "Agent", "Chat", "Leer"]);
assert.deepEqual(L.sortBy(rows, keys, { key: "users", dir: "asc" }).map(row => row.name), ["Agent", "Chat", "Bot", "Leer"]);
assert.deepEqual(L.sortBy(rows, keys, { key: "name", dir: "desc" }).map(row => row.name), ["Leer", "Chat", "Bot", "Agent"]);
assert.deepEqual(L.sortBy(rows, keys, { key: "unbekannt", dir: "asc" }), rows);
assert.equal(rows[0].name, "Chat", "Original nicht sortiert");

// cycleFacet: aus → nur diese → ohne diese → aus.
const facet = new Map();
L.cycleFacet(facet, "7");
assert.equal(facet.get("7"), "include");
L.cycleFacet(facet, "7");
assert.equal(facet.get("7"), "exclude");
L.cycleFacet(facet, "7");
assert.equal(facet.has("7"), false);

// matchesFacet: leer trifft alles; ein Ausschluss gewinnt; mehrere „nur diese“ sind ein Oder.
assert.equal(L.matchesFacet(new Map(), []), true);
const include = new Map([["1", "include"], ["2", "include"]]);
assert.equal(L.matchesFacet(include, [2, 5]), true, "Werte als Zahl");
assert.equal(L.matchesFacet(include, ["5"]), false);
const mixed = new Map([["1", "include"], ["3", "exclude"]]);
assert.equal(L.matchesFacet(mixed, ["1"]), true);
assert.equal(L.matchesFacet(mixed, ["1", "3"]), false);
const onlyExclude = new Map([["3", "exclude"]]);
assert.equal(L.matchesFacet(onlyExclude, []), true);
assert.equal(L.matchesFacet(onlyExclude, ["4"]), true);
assert.equal(L.matchesFacet(onlyExclude, ["3"]), false);

// Suche ohne Akzente und Groß/klein.
assert.equal(L.matchesSearch("muller", ["Müller"]), true);
assert.equal(L.matchesSearch("  ", ["x"]), true);
assert.equal(L.matchesSearch("xyz", ["Müller", null]), false);

// Pfeiltasten im Menü.
assert.equal(L.menuStep(-1, 3, "ArrowDown"), 0);
assert.equal(L.menuStep(2, 3, "ArrowDown"), 0, "am Ende vorn weiter");
assert.equal(L.menuStep(0, 3, "ArrowUp"), 2);
assert.equal(L.menuStep(1, 3, "Home"), 0);
assert.equal(L.menuStep(1, 3, "End"), 2);
assert.equal(L.menuStep(1, 3, "a"), null);
assert.equal(L.menuStep(0, 0, "ArrowDown"), null);

console.log("list_page_checks: ok");
