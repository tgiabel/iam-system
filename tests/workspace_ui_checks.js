const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const documentListeners = {};
const pageListeners = {};
const windowListeners = {};
let openedWindows = 0;

const page = {
    dataset: { userId: "" },
    addEventListener(name, callback) {
        (pageListeners[name] ||= []).push(callback);
    },
    querySelectorAll() { return []; },
};
const windowMock = {
    location: { origin: "https://sofa.example" },
    WorkspacePins: {},
    open() { openedWindows += 1; },
    addEventListener(name, callback) {
        (windowListeners[name] ||= []).push(callback);
    },
};
const documentMock = {
    readyState: "loading",
    addEventListener(name, callback) {
        (documentListeners[name] ||= []).push(callback);
    },
    getElementById(id) { return id === "toolsOverview" ? page : null; },
};
const context = vm.createContext({
    window: windowMock,
    document: documentMock,
    URL,
    Map,
    Array,
    String,
});
const source = fs.readFileSync(path.join(__dirname, "..", "app", "static", "js", "tools.js"), "utf8");

// Simuliert eine doppelte Einbindung nach einer UI-Neuinitialisierung.
vm.runInContext(source, context);
vm.runInContext(source, context);

assert.strictEqual(documentListeners.DOMContentLoaded.length, 1);
documentListeners.DOMContentLoaded[0]();
assert.strictEqual(pageListeners.click.length, 1);
assert.strictEqual(windowListeners.storage.length, 1);

const card = {
    querySelector(selector) {
        if (selector === ".ws-item-link") {
            return { getAttribute: () => "/reports/presence-report" };
        }
        return null;
    },
};
const popout = { closest: selector => selector === ".ws-item" ? card : null };
pageListeners.click[0]({
    target: { closest: selector => selector === ".ws-item-popout" ? popout : null },
    preventDefault() {},
});
assert.strictEqual(openedWindows, 1);

console.log("workspace ui listeners ok");
