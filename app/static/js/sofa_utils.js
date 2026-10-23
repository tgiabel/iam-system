// Kleine Helfer fuer alle Seiten (in base.html eingebunden). Neue Seiten nutzen diese statt eigener Kopien.
(function (root, factory) {
    const utils = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = utils;
    }
    if (root) {
        root.SofaUtils = utils;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
    }

    // Haengt Query-Parameter an, auch wenn die URL schon welche hat (z. B. ?scenario= im Mock).
    function withParams(url, params) {
        const query = new URLSearchParams(params).toString();
        return query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
    }

    // JSON abrufen ohne Ausnahme bei HTTP-Fehlern; data ist null, wenn die Antwort kein JSON ist.
    async function fetchJson(url, options = {}) {
        const response = await fetch(url, { cache: "no-store", ...options });
        const data = await response.json().catch(() => null);
        return { ok: response.ok, status: response.status, data };
    }

    return { escapeHtml, fetchJson, withParams };
}));
