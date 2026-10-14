(function (root, factory) {
    const pins = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = pins;
    }
    if (root) {
        root.WorkspacePins = pins;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const MAX_PINS = 4;
    const KEY_PREFIX = "sofa.workspace.pins.v1.";

    function storageKey(userId) {
        return KEY_PREFIX + userId;
    }

    // Angeheftete Katalog-IDs, aelteste zuerst. Unbekannte, doppelte und
    // nicht mehr sichtbare IDs fallen heraus.
    function normalize(value, visibleIds) {
        if (!Array.isArray(value)) return [];
        const visible = new Set(visibleIds);
        const seen = new Set();
        const result = [];
        for (const id of value) {
            if (typeof id !== "string" || seen.has(id) || !visible.has(id)) continue;
            seen.add(id);
            result.push(id);
        }
        return result.slice(-MAX_PINS);
    }

    // Loest einen vorhandenen Pin oder setzt einen neuen; ist die Liste voll, faellt der aelteste heraus.
    function toggle(list, id, max = MAX_PINS) {
        if (list.includes(id)) return list.filter(item => item !== id);
        return list.concat(id).slice(-max);
    }

    // Der Speicher kann fehlen oder werfen (privates Fenster, gesperrte Daten): dann bleibt die Seite ohne Merken nutzbar.
    function load(storage, userId, visibleIds) {
        try {
            return normalize(JSON.parse(storage.getItem(storageKey(userId)) || "[]"), visibleIds);
        } catch (_) {
            return [];
        }
    }

    function save(storage, userId, list) {
        try {
            storage.setItem(storageKey(userId), JSON.stringify(list));
        } catch (_) { /* nur Komfort */ }
    }

    return { MAX_PINS, storageKey, normalize, toggle, load, save };
}));
