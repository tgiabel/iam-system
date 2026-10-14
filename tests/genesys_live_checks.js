"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const sample = JSON.parse(fs.readFileSync("tests/fixtures/genesys_live.sample.json", "utf8"));
const source = fs.readFileSync("app/static/js/reports/genesys_live.js", "utf8");
const logic = source.slice(0, source.indexOf('for(const scroller of document.querySelectorAll'));
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    innerHTML: "", textContent: "", hidden: false, title: "",
    classList: {toggle() {}}, parentElement: null
  });
  return elements.get(id);
}
element("updatedAt").parentElement = element("asof");
const context = vm.createContext({
  document: {getElementById: element},
  window: {matchMedia: () => ({matches: false})},
  localStorage: {getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }},
  Intl, Date, Math, JSON, String, Number
});
vm.runInContext(logic, context);
context.sample = sample;
vm.runInContext("live = sample; renderPanel(); renderTime()", context);
assert.match(element("panelContent").innerHTML, /56 Anwesende/);
assert.match(element("panelContent").innerHTML, /Davon frei/);
assert.match(element("panelContent").innerHTML, /Anruf außerhalb einer Queue/);
assert.match(element("panelContent").innerHTML, /Beschäftigt ohne nähere Angabe gewählt/);
assert.match(element("panelContent").innerHTML, /Besprechung/);
assert.match(element("panelContent").innerHTML, /is-zero/);
assert.equal(element("updatedAt").textContent, "13:08:12");
assert.equal(element("staleNotice").hidden, true);
vm.runInContext("live.stale=true; renderTime()", context);
assert.equal(element("staleNotice").hidden, false);
assert.equal(element("asof").title, "Daten veraltet");
vm.runInContext('selectedId = sample.queues.find(q => q.mine.member).queue_id; renderPanel()', context);
assert.equal(element("panelMark").textContent, "Queue");
assert.match(element("selectionBar").innerHTML, /Filter/);
assert.match(vm.runInContext('queueCard({...sample.queues[0],label:"<Queue>"})', context), /&lt;Queue&gt;/);
console.log("Genesys Live browser logic OK");
