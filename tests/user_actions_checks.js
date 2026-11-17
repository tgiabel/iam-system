// Node-Checks für die Schnittstelle von user_actions.js, ohne DOM (Aufruf: node tests/user_actions_checks.js).
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
// Objekte aus dem VM-Kontext haben eigene Prototypen; verglichen wird der Inhalt.
const plain = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);
const source = fs.readFileSync(path.join(ROOT, "app/static/js/user_actions.js"), "utf8");

// Ein Kontext je Fall; die internen Controller holt ein angehängter Ausdruck heraus.
function load({ permissions = [], search = "" } = {}) {
    const calls = [];
    const flashes = [];
    const element = () => null;
    const context = {
        window: { SofaContract: require(path.join(ROOT, "app/static/js/sofa_contract.js")) },
        document: { getElementById: element, querySelectorAll: () => [], querySelector: element, addEventListener() {}, body: { classList: { toggle() {} } } },
        location: { search },
        URLSearchParams,
        console: { error() {}, warn() {}, log: console.log },
        hasPerm: id => permissions.includes(id),
        showFlash: (message, kind) => flashes.push([message, kind]),
        Promise
    };
    vm.createContext(context);
    vm.runInContext(`${source}
;globalThis.__t = { api, state, hooks, sidebarController, trainingModalController, primaryRoleChangeModalController,
    newSkillModalController, skillRevokeModalController, offboardModalController, rehireModalController,
    onboardModalController, afterChange };`, context);
    const t = context.__t;
    // Dialoge und Panel nur protokollieren.
    t.sidebarController.open = async id => calls.push(["panel", id]);
    t.primaryRoleChangeModalController.open = user => calls.push(["change", user]);
    t.newSkillModalController.open = user => calls.push(["skill", user]);
    t.skillRevokeModalController.open = user => calls.push(["revoke", user]);
    t.offboardModalController.open = user => calls.push(["offboarding", user]);
    t.rehireModalController.openForUser = user => calls.push(["rehire", user]);
    t.trainingModalController.open = options => calls.push(["training", options]);
    t.onboardModalController.open = () => calls.push(["onboarding"]);
    t.api.getRoleMap = async () => ({});
    return { A: context.window.SofaUserActions, t, calls, flashes };
}

const ALL = ["SOFA-FN-ROLE", "SOFA-FN-RL", "SOFA-FN-TRNG", "SOFA-FN-RMRL", "SOFA-FN-OFFB", "SOFA-FN-ONB"];
const active = { user_id: 7, is_active: true };
const inactive = { user_id: 8, is_active: false };

(async () => {
    // Schnittstelle
    {
        const { A } = load();
        eq(Object.keys(A).sort(), ["allowed", "init", "openUser", "run"]);
    }

    // allowed: Recht wie im Panel und dieselbe Regel aus sofaContract.getUserPanelActions.
    {
        const { A } = load({ permissions: ALL });
        for (const id of ["change", "skill", "training", "revoke", "offboarding"]) {
            assert.strictEqual(A.allowed(id, active), true, id);
            assert.strictEqual(A.allowed(id, inactive), false, id);
        }
        assert.strictEqual(A.allowed("rehire", inactive), true);
        assert.strictEqual(A.allowed("rehire", active), false);
        assert.strictEqual(A.allowed("details", inactive), true);
        // Temp. Rolle steht nur im Panel.
        assert.strictEqual(A.allowed("temporary", active), false);
        assert.strictEqual(A.allowed("unknown", active), false);
    }
    {
        const permissionOf = { change: "SOFA-FN-ROLE", skill: "SOFA-FN-RL", training: "SOFA-FN-TRNG",
            revoke: "SOFA-FN-RMRL", offboarding: "SOFA-FN-OFFB", rehire: "SOFA-FN-ONB" };
        for (const [id, permission] of Object.entries(permissionOf)) {
            const user = id === "rehire" ? inactive : active;
            assert.strictEqual(load({ permissions: [permission] }).A.allowed(id, user), true, id);
            assert.strictEqual(load({ permissions: ALL.filter(p => p !== permission) }).A.allowed(id, user), false, id);
        }
    }

    // run: erst die Details laden, dann den Dialog mit dem Detail-Objekt öffnen.
    {
        const { A, t, calls } = load({ permissions: ALL });
        const order = [];
        t.api.getUserDetails = async id => { order.push(`details ${id}`); return { user_id: id, is_active: true, birth_date: "1990-01-01" }; };
        await A.run("change", 7);
        eq(order, ["details 7"]);
        eq(calls, [["change", { user_id: 7, is_active: true, birth_date: "1990-01-01" }]]);
        calls.length = 0;
        await A.run("training", 7);
        assert.strictEqual(calls[0][0], "training");
        eq(calls[0][1].presetUsers.map(user => user.user_id), [7]);
        assert.strictEqual(calls[0][1].source, "detail");
        // Die Regel gilt für die geladenen Details: ein inzwischen inaktiver User bekommt kein Offboarding.
        calls.length = 0;
        t.api.getUserDetails = async id => ({ user_id: id, is_active: false });
        await A.run("offboarding", 7);
        await A.run("rehire", 7);
        eq(calls.map(call => call[0]), ["rehire"]);
        // Details öffnen geht über das Panel, das die Details selbst lädt.
        calls.length = 0;
        await A.run("details", 9);
        eq(calls, [["panel", 9]]);
        await A.openUser(10);
        eq(calls[1], ["panel", 10]);
    }
    {
        const { A, t, calls, flashes } = load({ permissions: ALL });
        t.api.getUserDetails = async () => { throw new Error("404"); };
        await A.run("skill", 7);
        eq(calls, []);
        eq(flashes, [["Userdetails konnten nicht geladen werden", "failure"]]);
    }
    {
        // Ohne Recht kein Dialog, auch nicht über run.
        const { A, t, calls } = load({ permissions: ["SOFA-FN-RL"] });
        t.api.getUserDetails = async id => ({ user_id: id, is_active: true });
        await A.run("offboarding", 7);
        await A.run("onboarding");
        await A.run("skill", 7);
        eq(calls.map(call => call[0]), ["skill"]);
    }
    {
        // Werkzeugleiste: ohne User.
        const { A, calls } = load({ permissions: ["SOFA-FN-ONB", "SOFA-FN-TRNG"] });
        await A.run("onboarding");
        await A.run("training");
        eq(calls, [["onboarding"], ["training", { source: "global" }]]);
    }

    // afterChange: Panel nur aktualisieren, wenn es (für diesen User) offen ist; danach immer die Liste neu laden.
    {
        const { A, t } = load();
        const log = [];
        A.init({ reload: async () => log.push("reload"), visibleUsers: () => [] });
        t.sidebarController.refreshCurrentUser = async () => log.push("panel");
        await t.afterChange(7);
        eq(log, ["reload"]);
        log.length = 0;
        t.state.currentUserDetail = { user_id: 7 };
        await t.afterChange(7);
        await t.afterChange();
        await t.afterChange(8);
        eq(log, ["panel", "reload", "panel", "reload", "reload"]);
    }

    // Schulung planen: die User, die die Liste zeigt, plus die vorgewählten.
    {
        const { A, t } = load();
        A.init({ visibleUsers: () => [
            { user_id: 2, last_name: "B", is_active: true },
            { user_id: 1, last_name: "A", is_active: true },
            // Mit „Inaktive“ zeigt die Liste auch Ausgetretene; zur Schulung stehen sie nicht zur Wahl.
            { user_id: 4, last_name: "D", is_active: false }
        ] });
        const users = t.trainingModalController.resolveAvailableUsers({ presetUsers: [{ user_id: 3, last_name: "C", is_active: true }, { user_id: 1, last_name: "A", is_active: true }] });
        eq(users.map(user => user.user_id), [1, 2, 3]);
    }

    // init: Hooks setzen, nur einmal binden, ?user_id= öffnet das Panel.
    {
        const { A, t, calls } = load({ search: "?user_id=821" });
        const reload = async () => {};
        A.init({ reload });
        assert.strictEqual(t.hooks.reload, reload);
        eq(calls, [["panel", 821]]);
        A.init({ reload });
        eq(calls, [["panel", 821]], "zweites init öffnet nicht noch einmal");
    }
    for (const search of ["", "?user_id=abc", "?role=5"]) {
        const { A, calls } = load({ search });
        A.init({});
        eq(calls, [], search);
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
