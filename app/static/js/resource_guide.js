// Ressourcen-Anleitungen (SD-API docs/resource-guides.md): kleine Markdown-Untermenge mit Platzhaltern.
// Erst wird der ganze Text escapt, dann **fett**, Listen (- / 1.), Links, Absätze und `Code` als
// Kopier-Chip umgesetzt. DOM-frei, geprüft in tests/resource_guide_checks.js.
(function (root, factory) {
    const guide = factory(root.SofaUtils || require("./sofa_utils.js"));
    if (typeof module === "object" && module.exports) {
        module.exports = guide;
    }
    if (root) {
        root.ResourceGuide = guide;
    }
}(typeof window !== "undefined" ? window : globalThis, function (utils) {
    "use strict";

    const esc = utils.escapeHtml;
    const MAX_LENGTH = 10000;
    const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
    // Nach dem Kopieren setzt die Seite kurz .is-copied: Haken statt Kopier-Icon.
    const COPY_ICON = '<svg class="rg-chip-icon rg-chip-copy" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>'
        + '<svg class="rg-chip-icon rg-chip-done" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    // Token im Zwischentext; kommt in escapetem Text nicht vor.
    const TOKEN = /\u0000(\d+)\u0000/g;

    function placeholderKeys(text) {
        return [...new Set([...String(text ?? "").matchAll(PLACEHOLDER)].map(match => match[1]))];
    }

    // Ein Platzhalter wird zu Warnung, Label oder bleibt Text (resolve liefert dann null).
    function placeholderHtml(info) {
        if (info.kind === "missing") return `<span class="rg-missing">${esc(info.label)} fehlt</span>`;
        if (info.kind === "unknown") return `<span class="rg-missing">${esc(info.label)} unbekannt</span>`;
        return `<span class="rg-placeholder">${esc(info.label)}</span>`;
    }

    function replacePlaceholders(escaped, resolve) {
        let marked = false;
        const html = escaped.replace(PLACEHOLDER, (whole, key) => {
            const info = resolve(key);
            if (!info) return whole;
            marked = true;
            return placeholderHtml(info);
        });
        return { html, marked };
    }

    // Trailing-Satzzeichen gehören nicht zum nackten Link.
    function splitUrl(url) {
        const match = url.match(/^(.*?)([.,;:!?)]*)$/);
        return [match[1], match[2]];
    }

    const linkHtml = (href, label) => `<a class="rg-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

    function inlineHtml(line, resolve) {
        const tokens = [];
        const keep = html => `\u0000${tokens.push(html) - 1}\u0000`;
        let text = line;
        // Code zuerst: darin wirkt kein Markdown, nur Platzhalter.
        text = text.replace(/`([^`]+)`/g, (whole, code) => {
            const { html, marked } = replacePlaceholders(code, resolve);
            return keep(marked
                ? `<span class="rg-chip is-static">${html}</span>`
                : `<button type="button" class="rg-chip" data-copy="${code}" title="Kopieren">${code}${COPY_ICON}</button>`);
        });
        // Ein Link mit offenem Platzhalter in der URL führt ins Leere: nur der Text und die Warnung.
        text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (whole, label, url) => {
            const inner = replacePlaceholders(label, resolve).html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
            const open = placeholderKeys(url).map(resolve).filter(Boolean);
            return keep(open.length ? `${inner} ${open.map(placeholderHtml).join(" ")}` : linkHtml(url, inner));
        });
        text = text.replace(/(^|[\s(])(https:\/\/[^\s<]+)/g, (whole, lead, raw) => {
            const [url, tail] = splitUrl(raw);
            if (placeholderKeys(url).length) return whole;
            return `${lead}${keep(linkHtml(url, url))}${tail}`;
        });
        text = replacePlaceholders(text, resolve).html;
        text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        return text.replace(TOKEN, (whole, index) => tokens[Number(index)]);
    }

    // Blöcke trennt eine Leerzeile; darin bilden Zeilen mit "- " bzw. "1. " Listen, der Rest Absätze.
    function toHtml(text, resolve) {
        const source = esc(String(text ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim());
        if (!source) return "";
        const out = [];
        for (const block of source.split(/\n[ \t]*\n+/)) {
            let paragraph = [];
            let list = null;
            const flushParagraph = () => {
                if (paragraph.length) out.push(`<p>${paragraph.map(line => inlineHtml(line, resolve)).join("<br>")}</p>`);
                paragraph = [];
            };
            const flushList = () => {
                if (!list) return;
                const start = list.tag === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
                out.push(`<${list.tag}${start}>${list.items.map(item => `<li>${inlineHtml(item, resolve)}</li>`).join("")}</${list.tag}>`);
                list = null;
            };
            for (const rawLine of block.split("\n")) {
                const line = rawLine.trim();
                if (!line) continue;
                const bullet = line.match(/^-\s+(.*)$/);
                const number = line.match(/^(\d+)\.\s+(.*)$/);
                const tag = bullet ? "ul" : number ? "ol" : null;
                if (!tag) {
                    flushList();
                    paragraph.push(line);
                    continue;
                }
                flushParagraph();
                if (list?.tag !== tag) {
                    flushList();
                    list = { tag, start: number ? Number(number[1]) : 1, items: [] };
                }
                list.items.push(bullet ? bullet[1] : number[2]);
            }
            flushParagraph();
            flushList();
        }
        return out.join("");
    }

    // Eine Zeile nur aus "---" beginnt eine neue Seite; Seiten werden getrimmt, leere fallen weg.
    function splitPages(text) {
        const pages = [[]];
        for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
            if (line.trim() === "---") pages.push([]);
            else pages[pages.length - 1].push(line);
        }
        return pages.map(lines => lines.join("\n").trim()).filter(Boolean);
    }

    // Anzeige in der Task-Card: übrig gebliebene Platzhalter aus missing/unknown werden zu Warnungen.
    function guideResolver({ missing = [], unknown = [] } = {}) {
        const missingLabels = new Map((missing || []).map(entry => [entry?.key ?? entry, entry?.label || entry?.key || entry]));
        const unknownKeys = new Set((unknown || []).map(entry => entry?.key ?? entry));
        return key => {
            if (missingLabels.has(key)) return { kind: "missing", label: missingLabels.get(key) };
            if (unknownKeys.has(key)) return { kind: "unknown", label: key };
            return null;
        };
    }

    // Vorschau und lesende Ansicht: Platzhalter erscheinen mit ihrem Label aus dem Katalog.
    function previewResolver(catalog = []) {
        const labels = new Map((catalog || []).map(entry => [entry.key, entry.label || entry.key]));
        // Ohne Katalog (nicht geladen) ist kein Platzhalter als unbekannt zu werten.
        return key => labels.has(key) || !labels.size
            ? { kind: "placeholder", label: labels.get(key) || key }
            : { kind: "unknown", label: key };
    }

    // Einseitig wie bisher; "---" bleibt hier ein Seitenwechsel ohne Ausgabe.
    const render = (text, data) => renderPages(text, data).join("");
    const preview = (text, catalog) => previewPages(text, catalog).join("");
    const renderPages = (text, data) => splitPages(text).map(page => toHtml(page, guideResolver(data)));
    const previewPages = (text, catalog) => splitPages(text).map(page => toHtml(page, previewResolver(catalog)));

    const CHEVRON = { prev: "m15 6-6 6 6 6", next: "m9 6 6 6-6 6" };
    const arrowHtml = (dir, disabled) => `<button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm rg-pager-arrow" data-guide-step="${dir === "prev" ? -1 : 1}" aria-label="${dir === "prev" ? "Vorherige Seite" : "Nächste Seite"}"${disabled ? " disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON[dir]}"/></svg></button>`;

    // Mehrere Seiten: Pfeile links/rechts, Punkte unten. Alle Seiten liegen übereinander, damit die Höhe
    // beim Blättern gleich bleibt (die längste zählt). Eine Seite: nur der Inhalt.
    function pagerHtml(pages, active = 0) {
        if (pages.length <= 1) return `<div class="rg-guide">${pages[0] || ""}</div>`;
        const index = Math.min(Math.max(0, active), pages.length - 1);
        return `<div class="rg-pager" data-guide-pager>
            ${arrowHtml("prev", index === 0)}
            <div class="rg-pages">${pages.map((html, page) => `<div class="rg-guide rg-page${page === index ? " is-active" : ""}" data-guide-page="${page}" role="group" aria-label="Seite ${page + 1} von ${pages.length}"${page === index ? "" : " aria-hidden=\"true\""}>${html}</div>`).join("")}</div>
            ${arrowHtml("next", index === pages.length - 1)}
            <div class="rg-dots">${pages.map((_, page) => `<button type="button" class="rg-dot" data-guide-dot="${page}" aria-label="Seite ${page + 1}"${page === index ? ' aria-current="true"' : ""}></button>`).join("")}</div>
        </div>`;
    }

    // Blättern im gerenderten Pager (Browser); liefert die neue Seite oder null ohne Pager.
    function showPage(root, index) {
        const pager = root?.querySelector("[data-guide-pager]");
        if (!pager) return null;
        const pages = [...pager.querySelectorAll("[data-guide-page]")];
        const current = Math.min(Math.max(0, index), pages.length - 1);
        pages.forEach((page, i) => {
            page.classList.toggle("is-active", i === current);
            page.toggleAttribute("aria-hidden", i !== current);
        });
        pager.querySelectorAll("[data-guide-dot]").forEach((dot, i) => {
            if (i === current) dot.setAttribute("aria-current", "true"); else dot.removeAttribute("aria-current");
        });
        pager.querySelector('[data-guide-step="-1"]').disabled = current === 0;
        pager.querySelector('[data-guide-step="1"]').disabled = current === pages.length - 1;
        return { index: current, count: pages.length };
    }

    // Klick auf Pfeil oder Punkt: Zielseite, sonst null.
    function pageTarget(target, current) {
        const step = target.closest("[data-guide-step]");
        if (step) return current + Number(step.dataset.guideStep);
        const dot = target.closest("[data-guide-dot]");
        return dot ? Number(dot.dataset.guideDot) : null;
    }

    function unknownKeys(text, catalog = []) {
        const known = new Set((catalog || []).map(entry => entry.key));
        return placeholderKeys(text).filter(key => !known.has(key));
    }

    // Katalog nach Gruppe in Reihenfolge des ersten Auftretens.
    function groupCatalog(catalog = []) {
        const groups = new Map();
        for (const entry of catalog || []) {
            const name = entry.group || "Weitere";
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(entry);
        }
        return [...groups].map(([name, entries]) => ({ name, entries }));
    }

    return { MAX_LENGTH, render, preview, splitPages, renderPages, previewPages, pagerHtml, showPage, pageTarget, placeholderKeys, unknownKeys, groupCatalog };
}));
