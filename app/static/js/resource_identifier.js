// Technischer Identifier einer Ressource: <Systemkuerzel>-<Typ-Slug>-<Kuerzel>.
// Altbestand ausserhalb des Musters bleibt gueltig und wird als freier Text gefuehrt.
(function (root, factory) {
    const identifier = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = identifier;
    }
    if (root) {
        root.ResourceIdentifier = identifier;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const CODE_PATTERN = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

    function prefix(systemShortName, typeSlug) {
        return `${systemShortName}-${typeSlug}-`;
    }

    function isValidCode(code) {
        return CODE_PATTERN.test(String(code ?? ""));
    }

    // { mode: "code", code } wenn der Identifier zum Praefix passt, sonst { mode: "free", value }.
    function split(technicalIdentifier, identifierPrefix) {
        const value = String(technicalIdentifier ?? "");
        if (value.startsWith(identifierPrefix) && isValidCode(value.slice(identifierPrefix.length))) {
            return { mode: "code", code: value.slice(identifierPrefix.length) };
        }
        return { mode: "free", value };
    }

    return { isValidCode, prefix, split };
}));
