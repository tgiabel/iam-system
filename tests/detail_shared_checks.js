"use strict";
const assert = require("node:assert/strict");
const shared = require("../app/static/js/detail_shared.js");

const res = (id, parent, extra = {}) => ({ resource_id: id, parent_resource_id: parent, technical_identifier: `X-${id}`, ...extra });
const ids = list => list.map(r => r.resource_id);

// Baum: Wurzeln sind Ressourcen ohne Voraussetzung im System, Kinder sortiert nach Identifier
let tree = shared.resourceTree([res(3, 1), res(1, null), res(2, 1), res(4, 99)]);
assert.deepEqual(ids(tree.roots), [1, 4]);
assert.deepEqual(ids(tree.childrenOf(1)), [2, 3]);
assert.deepEqual(ids(tree.childrenOf("1")), [2, 3]);
assert.deepEqual(tree.childrenOf(4), []);

// Zyklen im Bestand: jede Ressource erscheint genau einmal, nichts verschwindet
tree = shared.resourceTree([res(1, null), res(5, 6), res(6, 5), res(7, 7)]);
assert.deepEqual(ids(tree.roots), [1, 5, 7]);
assert.deepEqual(ids(tree.childrenOf(5)), [6]);
assert.deepEqual(tree.childrenOf(6), []);
assert.deepEqual(tree.childrenOf(7), []);

// Gruppen nach Typ, sortiert nach Typname
const groups = shared.groupByType([res(1, null, { type_id: 6, type_name: "Queue" }), res(2, null, { type_id: 2, type_name: "Gruppe" }), res(3, null, { type_id: 6, type_name: "Queue" })]);
assert.deepEqual(groups.map(g => [g.name, g.rows.length]), [["Gruppe", 1], ["Queue", 2]]);

// Voraussetzungskette, nächste zuerst; endet bei unbekannter Voraussetzung und bei Zyklen
const byId = new Map([res(1, null), res(2, 1), res(3, 2), res(5, 6), res(6, 5)].map(r => [r.resource_id, r]));
const lookup = id => byId.get(Number(id)) || null;
assert.deepEqual(ids(shared.ancestorChain(res(4, 3), lookup)), [3, 2, 1]);
assert.deepEqual(ids(shared.ancestorChain(res(4, 99), lookup)), []);
assert.deepEqual(ids(shared.ancestorChain(byId.get(5), lookup)), [6]);
assert.deepEqual(ids(shared.ancestorChain(res(1, null), lookup)), []);

// Abhängige systemübergreifend über parent_resource_ids; ohne das Feld null (Fallback auf eigenes System)
assert.equal(shared.crossDependents(115, [res(115, null), res(425, null)]), null);
const all = [
    { resource_id: 115, technical_identifier: "VRP-ACC", parent_resource_ids: [31], system_id: 25 },
    { resource_id: 431, technical_identifier: "GANS-ACC", parent_resource_ids: [115], system_id: 62 },
    { resource_id: 425, technical_identifier: "NETC-ACC", parent_resource_ids: [115], system_id: 59 },
    { resource_id: 500, technical_identifier: "VRP-SYS-X", parent_resource_ids: [31, 115], system_id: 25 },
    { resource_id: 31, technical_identifier: "MS365-ACC", parent_resource_ids: [], system_id: 1 }
];
assert.deepEqual(ids(shared.crossDependents(115, all)), [431, 425, 500]);
assert.deepEqual(ids(shared.crossDependents("31", all)), [115, 500]);
assert.deepEqual(shared.crossDependents(425, all), []);

// Auswahl „Übergeordnet“: aktuelle Voraussetzung bleibt drin, auch wenn sie kein Konto ist
const accounts = [
    { resource_id: 10, display_name: "Opcyc Konto", system_id: 15 },
    { resource_id: 11, display_name: "Genesys Konto", system_id: 9 }
];
const group = { resource_id: 20, display_name: "Agentengruppe", system_id: 9 };
let options = shared.parentOptions(accounts, res(30, 20), group, 9);
assert.deepEqual(ids(options), [20, 11, 10]);
options = shared.parentOptions(accounts, res(30, 11), accounts[1], 9);
assert.deepEqual(ids(options), [11, 10]);
// die Ressource selbst nie
assert.deepEqual(ids(shared.parentOptions(accounts, accounts[1], null, 9)), [10]);
// neue Ressource
assert.deepEqual(ids(shared.parentOptions(accounts, null, null, 15)), [10, 11]);
assert.equal(accounts.length, 2);

// Backlog: aktueller Wert bleibt wählbar, auch wenn er nicht unter den zugänglichen ist
const backlogs = { "SOFA-BKLG-IT": "IT-Backlog" };
assert.deepEqual(shared.backlogOptions(backlogs, null), [["SOFA-BKLG-IT", "IT-Backlog"]]);
assert.deepEqual(shared.backlogOptions(backlogs, "SOFA-BKLG-IT"), [["SOFA-BKLG-IT", "IT-Backlog"]]);
assert.deepEqual(shared.backlogOptions(backlogs, "SOFA-BKLG-HR"), [["SOFA-BKLG-IT", "IT-Backlog"], ["SOFA-BKLG-HR", "SOFA-BKLG-HR"]]);
assert.deepEqual(shared.backlogOptions({}, "constructor"), [["constructor", "constructor"]]);
assert.deepEqual(Object.keys(backlogs), ["SOFA-BKLG-IT"]);

// Bearbeitung: EVENT wird nicht angeboten, bleibt aber wählbar, wo es gesetzt ist
assert.deepEqual(shared.handlingChoices(null), ["INTERNAL", "BOT", "EXTERNAL"]);
assert.deepEqual(shared.handlingChoices("BOT"), ["INTERNAL", "BOT", "EXTERNAL"]);
assert.deepEqual(shared.handlingChoices("EVENT"), ["INTERNAL", "BOT", "EXTERNAL", "EVENT"]);
assert.equal(shared.HANDLING.EVENT, "Ereignis");

// Bereitstellung: Nachlieferung lila, Schreibweise egal, unbekannte Werte neutral mit ihrem Wert
assert.ok(shared.requirementChip("DEFERRED").includes("ui-chip-purple"));
assert.ok(shared.requirementChip("required").includes("Erforderlich"));
assert.ok(shared.requirementChip("OPTIONAL").includes("ui-chip-neutral"));
assert.ok(shared.requirementChip("OPTIONAL").includes(">OPTIONAL<"));
assert.ok(shared.requirementChip("<x>").includes("&lt;x&gt;"));
assert.ok(shared.requirementChip(null).includes("dp-muted"));

// Bot-Parameter
assert.equal(shared.botEditorValue(null), "");
assert.equal(shared.botEditorValue({}), "");
assert.equal(shared.botEditorValue({ queue_id: "q1" }), '{\n  "queue_id": "q1"\n}');
assert.equal(shared.botEditorValue({ data: { queue_id: "q1" } }), '{\n  "queue_id": "q1"\n}');
assert.equal(shared.botEditorValue({ data: '{"queue_id":"q1"}' }), '{"queue_id":"q1"}');
assert.equal(shared.botEditorValue({ data: null }), "");
assert.deepEqual(shared.parseBotParams(""), {});
assert.deepEqual(shared.parseBotParams("  "), {});
assert.deepEqual(shared.parseBotParams('{"queue_id": "q1"}'), { queue_id: "q1" });
assert.equal(shared.parseBotParams("[1]"), null);
assert.equal(shared.parseBotParams("null"), null);
assert.equal(shared.parseBotParams('"text"'), null);
assert.equal(shared.parseBotParams("{queue_id: 1}"), null);

console.log("detail_shared_checks: ok");
