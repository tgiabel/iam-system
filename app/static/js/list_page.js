// Gemeinsame Bausteine der Listenseiten (Userverwaltung, Rollenmanagement, Systemverwaltung):
// Popover, Zeilenmenü, Sortierung über Spaltenköpfe, Filter mit drei Zuständen, Suche.
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.SofaList = api;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    // Suchbegriffe ohne Groß-/Kleinschreibung und ohne Akzente vergleichen.
    function normalize(value) {
        return String(value ?? "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .trim();
    }

    function matchesSearch(term, values) {
        const needle = normalize(term);
        return !needle || values.some(value => normalize(value).includes(needle));
    }

    // Leere Werte stehen immer am Ende, egal in welche Richtung sortiert wird.
    function compareValues(left, right, dir = "asc") {
        const emptyLeft = left === null || left === undefined || left === "";
        const emptyRight = right === null || right === undefined || right === "";
        if (emptyLeft || emptyRight) {
            return emptyLeft === emptyRight ? 0 : emptyLeft ? 1 : -1;
        }
        const result = typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right), "de", { numeric: true, sensitivity: "base" });
        return dir === "desc" ? -result : result;
    }

    function sortBy(items, keyFns, sort) {
        const keyFn = keyFns[sort.key];
        if (!keyFn) {
            return [...items];
        }
        return [...items].sort((left, right) => compareValues(keyFn(left), keyFn(right), sort.dir)
            || compareValues(keyFns._tie?.(left), keyFns._tie?.(right), "asc"));
    }

    // Sortierung über ein Menü am Spaltenkopf. columns: { spalte: [{ key, dir, label }] }, die Optionen sind
    // ausgeschrieben. <th data-sort-col="spalte"> mit <button class="ui-table-sort-button"> öffnet das Menü.
    function bindSortMenu(table, sort, columns, onChange) {
        const optionsOf = col => columns[col] || [];
        const current = () => Object.values(columns).flat().find(option => option.key === sort.key && option.dir === sort.dir);
        const sync = () => {
            table.querySelectorAll("th[data-sort-col]").forEach(th => {
                const active = optionsOf(th.dataset.sortCol).some(option => option.key === sort.key);
                th.setAttribute("aria-sort", active ? (sort.dir === "desc" ? "descending" : "ascending") : "none");
                th.querySelector(".ui-table-sort-button")?.setAttribute("aria-haspopup", "menu");
            });
        };
        table.querySelector("thead").addEventListener("click", event => {
            const th = event.target.closest("th[data-sort-col]");
            const button = th?.querySelector(".ui-table-sort-button");
            if (!button) {
                return;
            }
            event.stopPropagation();
            const options = optionsOf(th.dataset.sortCol);
            const items = options.flatMap((option, index) => [
                index && option.group !== options[index - 1].group ? { separator: true } : null,
                { id: String(index), label: option.label, checked: option === current() }
            ]).filter(Boolean);
            openMenu(button, items, id => {
                Object.assign(sort, { key: options[id].key, dir: options[id].dir });
                sync();
                onChange();
            }, { align: "start" });
        });
        sync();
        return { sync, label: () => current()?.label || "" };
    }

    // Ein offenes Popover zur Zeit; schließt bei Klick daneben und mit Escape.
    let openPop = null;

    function closePopover() {
        if (!openPop) {
            return;
        }
        openPop.pop.hidden = true;
        openPop.button.setAttribute("aria-expanded", "false");
        openPop = null;
    }

    // Ein Popover, das rechts aus dem Fenster ragen würde, rückt um den Überstand nach links (8 px Rand).
    function keepInViewport(pop) {
        pop.style.left = "";
        const overflow = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
        if (overflow > 0) {
            pop.style.left = `${-overflow}px`;
        }
    }

    function bindPopover(button, pop, onOpen = () => {}) {
        button.addEventListener("click", event => {
            event.stopPropagation();
            const wasOpen = openPop?.pop === pop;
            closePopover();
            closeMenu();
            if (!wasOpen) {
                onOpen();
                pop.hidden = false;
                keepInViewport(pop);
                button.setAttribute("aria-expanded", "true");
                openPop = { button, pop };
            }
        });
        pop.addEventListener("click", event => event.stopPropagation());
    }

    // Menü an einem Button: items [{ id, label, danger, checked }] oder { separator: true }.
    // Mit checked (true/false) wird es eine Auswahlliste mit Haken.
    let menuEl = null;
    let menuAnchor = null;
    let menuAnchorBox = null;

    function closeMenu() {
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
        }
        menuAnchor?.setAttribute("aria-expanded", "false");
        menuAnchor = null;
    }

    function openMenu(anchor, items, onSelect, { align = "end" } = {}) {
        const sameAnchor = menuAnchor === anchor;
        closeMenu();
        closePopover();
        if (sameAnchor) {
            return;
        }
        const escape = window.SofaUtils.escapeHtml;
        menuEl = document.createElement("div");
        menuEl.className = "ui-menu";
        menuEl.setAttribute("role", "menu");
        menuEl.innerHTML = items.map(item => item.separator
            ? '<div class="ui-menu-sep" role="separator"></div>'
            : `<button type="button" role="${item.checked === undefined ? "menuitem" : "menuitemradio"}" data-menu-id="${escape(item.id)}"${item.checked === undefined ? "" : ` aria-checked="${Boolean(item.checked)}"`}${item.danger ? ' class="is-danger"' : ""}>${escape(item.label)}</button>`
        ).join("");
        document.body.appendChild(menuEl);
        const box = anchor.getBoundingClientRect();
        const menuBox = menuEl.getBoundingClientRect();
        const below = box.bottom + 4 + menuBox.height <= window.innerHeight - 8;
        menuEl.style.top = `${below ? box.bottom + 4 : Math.max(8, box.top - 4 - menuBox.height)}px`;
        const left = align === "start" ? box.left : box.right - menuBox.width;
        menuEl.style.left = `${Math.max(8, Math.min(left, window.innerWidth - 8 - menuBox.width))}px`;
        anchor.setAttribute("aria-expanded", "true");
        menuAnchor = anchor;
        menuAnchorBox = box;
        menuEl.addEventListener("click", event => {
            event.stopPropagation();
            const button = event.target.closest("[data-menu-id]");
            if (button) {
                closeMenu();
                onSelect(button.dataset.menuId);
            }
        });
        // Pfeiltasten, Pos1/Ende wandern durch die Einträge; Tab schließt das Menü und geht zurück zum Auslöser.
        menuEl.addEventListener("keydown", event => {
            const buttons = [...menuEl.querySelectorAll("[data-menu-id]")];
            const next = menuStep(buttons.indexOf(document.activeElement), buttons.length, event.key);
            if (next !== null) {
                event.preventDefault();
                buttons[next]?.focus();
            } else if (event.key === "Tab") {
                event.preventDefault();
                const back = menuAnchor;
                closeMenu();
                back?.focus();
            }
        });
        (menuEl.querySelector('[aria-checked="true"]') || menuEl.querySelector("button"))?.focus();
    }

    // Nächster Eintrag im Menü für eine Taste, null für andere Tasten. Am Ende geht es vorn weiter.
    function menuStep(index, count, key) {
        if (!count) {
            return null;
        }
        if (key === "ArrowDown") {
            return index < 0 ? 0 : (index + 1) % count;
        }
        if (key === "ArrowUp") {
            return index < 0 ? count - 1 : (index - 1 + count) % count;
        }
        if (key === "Home") {
            return 0;
        }
        return key === "End" ? count - 1 : null;
    }

    // Tooltip für [data-tip] in container, bei Hover und bei Tastaturfokus (die Ziele tragen tabindex="0");
    // render(el) liefert HTML. Ein Tooltip zur Zeit, fest am Body.
    let tipEl = null;

    function hideTip() {
        tipEl?.remove();
        tipEl = null;
    }

    function bindTips(container, render) {
        let timer = null;
        const show = target => {
            hideTip();
            const html = render(target);
            if (!html) {
                return;
            }
            tipEl = document.createElement("div");
            tipEl.className = "ui-tip";
            tipEl.setAttribute("role", "tooltip");
            tipEl.innerHTML = html;
            document.body.appendChild(tipEl);
            const box = target.getBoundingClientRect();
            const tipBox = tipEl.getBoundingClientRect();
            const below = box.bottom + 6 + tipBox.height <= window.innerHeight - 8;
            tipEl.style.top = `${below ? box.bottom + 6 : Math.max(8, box.top - 6 - tipBox.height)}px`;
            tipEl.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 8 - tipBox.width))}px`;
        };
        container.addEventListener("mouseover", event => {
            const target = event.target.closest("[data-tip]");
            if (!target || target.contains(event.relatedTarget)) {
                return;
            }
            clearTimeout(timer);
            timer = setTimeout(() => show(target), 250);
        });
        container.addEventListener("mouseout", event => {
            const target = event.target.closest("[data-tip]");
            if (target && !target.contains(event.relatedTarget)) {
                clearTimeout(timer);
                hideTip();
            }
        });
        container.addEventListener("focusin", event => {
            const target = event.target.closest("[data-tip]");
            if (target && target === event.target) {
                // Verzögert: Der Fokus scrollt das Ziel evtl. ins Bild, und Scrollen schließt Tooltips.
                clearTimeout(timer);
                timer = setTimeout(() => show(target), 150);
            }
        });
        container.addEventListener("focusout", event => {
            if (event.target.closest("[data-tip]")) {
                clearTimeout(timer);
                hideTip();
            }
        });
    }

    // Im Browser; die Node-Checks laden nur die reinen Funktionen.
    if (typeof document !== "undefined") {
        document.addEventListener("click", () => {
            closePopover();
            closeMenu();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                const anchor = menuAnchor || openPop?.button;
                hideTip();
                closePopover();
                closeMenu();
                anchor?.focus();
            }
        });
        window.addEventListener("resize", closeMenu);
        // Nur schließen, wenn der Auslöser sich bewegt: Der Fokus auf dem ⋯-Button scrollt sonst seine Zelle
        // (overflow: hidden) um wenige Pixel, und das Menü ginge gleich nach dem Öffnen wieder zu.
        document.addEventListener("scroll", () => {
            const box = menuAnchor?.getBoundingClientRect();
            if (box && (Math.abs(box.top - menuAnchorBox.top) > 4 || Math.abs(box.left - menuAnchorBox.left) > 4)) {
                closeMenu();
            }
            hideTip();
        }, true);
    }

    // Filter mit drei Zuständen je Wert: Map value → "include" | "exclude".
    const NEXT_STATE = { undefined: "include", include: "exclude", exclude: undefined };

    function cycleFacet(facet, value) {
        const next = NEXT_STATE[facet.get(value)];
        if (next) {
            facet.set(value, next);
        } else {
            facet.delete(value);
        }
    }

    // values: alle Werte eines Eintrags für diese Facette (z. B. alle Rollen-IDs eines Users).
    function matchesFacet(facet, values) {
        if (!facet.size) {
            return true;
        }
        const own = new Set(values.map(String));
        let includes = 0;
        let hit = false;
        for (const [value, state] of facet) {
            if (state === "exclude" && own.has(value)) {
                return false;
            }
            if (state === "include") {
                includes += 1;
                hit = hit || own.has(value);
            }
        }
        return includes === 0 || hit;
    }

    // ⋯-Button für das Zeilen- bzw. Kartenmenü (openMenu), id landet in data-menu.
    function menuButton(id, label) {
        const escape = window.SofaUtils.escapeHtml;
        return `<button type="button" class="ui-flat-button ui-flat-button--icon ui-flat-button--sm al-row-menu" data-menu="${escape(id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Aktionen für ${escape(label)}">`
            + '<svg class="ui-icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg></button>';
    }

    // Tooltip-Inhalt: Gruppe mit Titel und Liste (items sind fertige <li>).
    function tipGroup(title, items) {
        return `<div class="ui-tip-group"><span class="ui-tip-title">${window.SofaUtils.escapeHtml(title)}</span><ul class="ui-tip-list">${items.join("")}</ul></div>`;
    }

    // Map label → Anzahl als Liste „12 Agent“, die größten zuerst.
    function tipCounts(counts) {
        const escape = window.SofaUtils.escapeHtml;
        return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "de"))
            .map(([label, count]) => `<li><span class="ui-tip-num">${count}</span>${escape(label)}</li>`);
    }

    function readData(id) {
        const node = document.getElementById(id);
        return node ? JSON.parse(node.textContent || "null") : null;
    }

    function formatDate(value) {
        if (!value) {
            return "";
        }
        const [year, month, day] = String(value).slice(0, 10).split("-");
        return day && month && year ? `${day}.${month}.${year}` : String(value);
    }

    return {
        bindPopover, bindSortMenu, bindTips, closeMenu, closePopover, compareValues, cycleFacet, formatDate,
        matchesFacet, matchesSearch, menuButton, menuStep, normalize, openMenu, readData, sortBy, tipCounts, tipGroup
    };
}));
