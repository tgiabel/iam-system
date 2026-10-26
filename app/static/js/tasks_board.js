// Aufgaben als Kanban. Logik ohne DOM in tasks_board_model.js, Daten über tasks_board_data.js
// (in der Entwicklungsinstanz mit /tasks?mock= über tasks_board_mock.js).
(function () {
    "use strict";

    const Model = window.TasksBoardModel;
    const root = document.getElementById("task-board");
    const dataEl = document.getElementById("task-board-data");
    if (!Model || !root || !dataEl) {
        return;
    }

    const data = JSON.parse(dataEl.textContent);
    const me = data.me || {};
    const meId = me.user_id;
    let todayKey = data.today;
    const REFRESH_MS = 60000;
    const backend = data.mock ? window.TasksBoardMock.create(data, me, berlinNowStamp) : window.TasksBoardData.live();
    const storageKey = `sofa.tasks.board.v1.${meId ?? "anon"}`;

    const LABELS = {
        taskType: { ASSIGNMENT: "Zuweisung", REVOCATION: "Entzug" },
        handling: { INTERNAL: "Intern", EXTERNAL: "Mail", BOT: "Automatisiert", EVENT: "Ereignis" },
        status: { OPEN: "Offen", IN_PROGRESS: "In Bearbeitung", COMPLETED: "Erledigt", BLOCKED: "Blockiert" },
        processes: window.SofaContract.PROCESS_TYPE_LABELS
    };

    const backlogLookup = {};
    function setBacklogs(backlogs) {
        backlogs.forEach(backlog => {
            backlogLookup[backlog.technical_identifier] = { name: backlog.display_name || backlog.technical_identifier };
        });
    }
    const lookups = { processLabels: LABELS.processes, backlogLookup };

    const ICONS = {
        lock: '<svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
        later: '<svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
        check: '<svg class="tb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        chevron: '<svg class="tb-icon tb-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
    };

    let tasks = [];
    // Bis zur ersten Antwort zeigen die Spalten "Lädt …"; ein späterer Fehler lässt den letzten Stand stehen.
    let loadState = "loading";
    let truncated = false;
    let loadRequest = 0;
    let bulkBusy = false;
    let view = loadView();
    let board = null;
    const selected = new Set();
    let anchor = null;
    // Gruppen unter Offen und Kollegen-Gruppen starten zugeklappt; für diese Sitzung gemerkt.
    const expandedGroups = new Set();

    // ---------- Speicher ----------

    function loadView() {
        try {
            return Model.normalizeView(JSON.parse(localStorage.getItem(storageKey) || "null"));
        } catch (error) {
            return Model.createDefaultView();
        }
    }

    function saveView() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(Model.serializeView(view)));
        } catch (error) {
            // Ohne Speicher gilt die Ansicht nur bis zum Neuladen.
        }
    }

    // ---------- Hilfen ----------

    const { escapeHtml } = window.SofaUtils;

    function berlinNowStamp() {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
        }).formatToParts(new Date());
        const v = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}`;
    }

    function findTask(taskId) {
        return tasks.find(task => String(task.task_id) === String(taskId)) || null;
    }

    function flash(message, type = "success") {
        if (typeof window.showFlash === "function") {
            window.showFlash(message, type);
        }
    }

    function formatDateTime(stamp) {
        const dayKey = window.SofaContract.parseDateKey(stamp);
        if (!dayKey) {
            return "–";
        }
        const time = Model.timeOf(stamp);
        return `${window.SofaContract.formatDateKey(dayKey)}${time ? `, ${time}` : ""}`;
    }

    function processLabel(task) {
        return window.TaskViewModel.describeProcess(task, lookups);
    }

    // ---------- Karten ----------

    // Rot für Entzug, Grün für Einrichtung.
    function typeClass(task) {
        return String(task.task_type || "").toUpperCase() === "REVOCATION" ? "is-revoke" : "is-assign";
    }

    function cardHtml(task) {
        const now = berlinNowStamp();
        const foreign = Model.isForeign(task, meId);
        const selectable = Model.canSelect(task, meId);
        const isSelected = selected.has(task.task_id);
        const status = String(task.status || "").toUpperCase();
        const classes = ["tb-card"];
        if (foreign) classes.push("is-foreign");
        if (status === "BLOCKED") classes.push("is-blocked");
        if (isSelected) classes.push("is-selected");
        if (selectable) classes.push("is-selectable");

        const meta = [];
        if (status === "BLOCKED" && task.blocked_by?.resource_name) {
            meta.push(`<span class="tb-card-context">${ICONS.lock}<span>Wartet auf ${escapeHtml(task.blocked_by.resource_name)}</span></span>`);
        }
        if (status === "OPEN" || status === "BLOCKED" || status === "IN_PROGRESS") {
            const due = Model.dueInfo(task, todayKey);
            if (due) {
                const chip = { overdue: " ui-chip ui-chip-sm ui-chip-error", today: " ui-chip ui-chip-sm ui-chip-warning" }[due.tone] || "";
                meta.push(`<span class="tb-card-due${chip}" title="${escapeHtml(`Stichtag: ${window.SofaContract.formatDateKey(due.dueKey)}`)}">${escapeHtml(due.label)}</span>`);
            }
        }
        const secondary = [];
        if (status !== "COMPLETED" && (task.handling_type === "EXTERNAL" || task.handling_type === "BOT")) {
            secondary.push(escapeHtml(LABELS.handling[task.handling_type]));
        }
        if (status === "IN_PROGRESS" && task.assigned_at) {
            secondary.push(`<span title="${escapeHtml(`Übernommen: ${formatDateTime(task.assigned_at)}`)}">seit ${escapeHtml(Model.ageLabel(task.assigned_at, now))} in Bearbeitung</span>`);
        }
        if (status === "COMPLETED" && task.completed_at) {
            meta.push(`<span class="tb-card-context" title="${escapeHtml(`Erledigt: ${formatDateTime(task.completed_at)}`)}">Erledigt ${escapeHtml(Model.timeOf(task.completed_at))}</span>`);
        }
        if (status === "COMPLETED" && task.assigned_to_user_id !== null && task.assigned_to_user_id !== undefined) {
            secondary.push(escapeHtml(Model.isMine(task, meId) ? "von mir" : `von ${Model.displayName(task.assigned_to_user_name) || "Unbekannt"}`));
        }
        if (secondary.length) {
            meta.push(`<span class="tb-card-context">${secondary.join('<span class="tb-card-separator" aria-hidden="true">·</span>')}</span>`);
        }

        const person = Model.displayName(task.target_user_name) || "–";
        const resource = String(task.resource_name || "").trim() || "Ressource";
        const action = typeClass(task) === "is-revoke" ? "entziehen" : "einrichten";
        const label = `${resource} ${action} für ${person}`;
        let corner = "";
        if (selectable) {
            corner = `<button type="button" class="tb-card-check" data-check="${escapeHtml(task.task_id)}" aria-pressed="${isSelected}" aria-label="${escapeHtml(`Auswählen: ${label}`)}">${ICONS.check}</button>`;
        }

        return `
            <article class="${classes.join(" ")}" data-task-id="${escapeHtml(task.task_id)}">
                <button type="button" class="tb-card-main" data-open="${escapeHtml(task.task_id)}">
                    <span class="tb-card-system">${escapeHtml(task.system_name || "–")}</span>
                    <span class="tb-card-heading">
                        <span class="tb-card-title">${escapeHtml(resource)}</span>
                        <span class="tb-card-action ${typeClass(task)}">${action}</span>
                    </span>
                    <span class="tb-card-person"><span class="tb-card-for">für</span> ${escapeHtml(person)}</span>
                    ${meta.length ? `<span class="tb-card-meta">${meta.join("")}</span>` : ""}
                </button>
                ${corner}
            </article>
        `;
    }

    function cardsHtml(list) {
        return `<div class="tb-cards">${list.map(task => cardHtml(task)).join("")}</div>`;
    }

    function groupLabelHtml(label, count) {
        return label
            ? `<h3 class="tb-group-label"><span>${escapeHtml(label)}</span><span class="tb-group-count">${count}</span></h3>`
            : "";
    }

    function emptyHtml(message) {
        return `<p class="tb-empty">${escapeHtml(message)}</p>`;
    }

    function filteredHint() {
        return view.search || Model.countActiveFacets(view) > 0 || view.onlyMine;
    }

    function columnEmptyHtml(message) {
        if (loadState !== "ready") {
            return emptyHtml(loadState === "failed" ? "Aufgaben konnten nicht geladen werden" : "Lädt …");
        }
        return emptyHtml(filteredHint() ? "Keine Treffer" : message);
    }

    // ---------- Spalten ----------

    function renderParked() {
        const el = document.getElementById("tb-col-parked");
        const column = board.parked;
        const [blocked, deferred] = column.sections;
        const open = view.railOpen;
        el.classList.toggle("is-open", open);

        // Alle Reiter behalten ihre Position und DOM-Knoten, auch beim Bereichswechsel.
        if (!el.querySelector(".tb-rail-tabs")) {
            el.innerHTML = `
                <div class="tb-rail-tabs">
                    <button type="button" class="tb-rail-tab is-main" data-rail-toggle aria-controls="tb-rail-body">
                        ${ICONS.chevron}
                        <span class="tb-rail-label">Zurückgestellt</span>
                    </button>
                    ${[blocked, deferred].map(section => `
                        <button type="button" class="tb-rail-tab is-${section.key}" data-rail-open="${section.key}" aria-controls="tb-park-body-${section.key}">
                            ${section.key === "blocked" ? ICONS.lock : ICONS.later}
                            <span class="tb-rail-section-label">${escapeHtml(section.label)}</span>
                            <span class="tb-rail-tab-count"></span>
                        </button>
                    `).join("")}
                </div>
                <div class="tb-rail-body" id="tb-rail-body"></div>
            `;
        }
        const toggle = el.querySelector("[data-rail-toggle]");
        toggle.disabled = column.count === 0;
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", `Zurückgestellt ${open ? "einklappen" : "aufklappen"}`);

        // Im Panel steht nur der aktive Bereich; seine Auswahl erfolgt über die Reiter links.
        const active = Model.activeParkedSection(column, view.railTab);
        const sections = column.sections.filter(section => section.count > 0).map(section => {
            const isActive = section.key === active;
            return `
                <section class="tb-park is-${section.key}${isActive ? " is-active" : ""}" data-park="${section.key}" aria-labelledby="tb-park-title-${section.key}"${isActive ? "" : " hidden"}>
                    <h2 class="tb-park-head" id="tb-park-title-${section.key}">
                        ${section.key === "blocked" ? ICONS.lock : ICONS.later}
                        <span class="tb-park-label">${escapeHtml(section.label)}</span>
                        <span class="tb-park-count">${section.count}</span>
                    </h2>
                    <div class="tb-park-body" id="tb-park-body-${section.key}"${isActive ? "" : " inert"}>
                        ${section.groups.map(group => `
                            <div class="tb-group">
                                ${groupLabelHtml(group.label, group.tasks.length)}
                                ${cardsHtml(group.tasks)}
                            </div>
                        `).join("")}
                    </div>
                </section>
            `;
        }).join("");

        const body = document.getElementById("tb-rail-body");
        body.innerHTML = sections || columnEmptyHtml("Nichts zurückgestellt");
        [blocked, deferred].forEach(section => {
            const button = el.querySelector(`[data-rail-open="${section.key}"]`);
            button.hidden = section.count === 0;
            button.querySelector(".tb-rail-tab-count").textContent = section.count;
            button.title = section.label;
        });
        syncRailAccessibility();
    }

    function syncRailAccessibility() {
        const el = document.getElementById("tb-col-parked");
        const mobile = window.matchMedia("(max-width: 900px)").matches;
        const visible = view.railOpen || mobile;
        const active = Model.activeParkedSection(board.parked, view.railTab);
        el.dataset.activeSection = active || "";
        el.querySelector(".tb-rail-body").inert = !visible;
        el.querySelectorAll("[data-rail-open]").forEach(button => {
            const expanded = visible && button.dataset.railOpen === active;
            const section = board.parked.sections.find(item => item.key === button.dataset.railOpen);
            button.classList.toggle("is-active", expanded);
            button.setAttribute("aria-expanded", String(expanded));
            button.setAttribute("aria-label", `${section.label}, ${section.count}, ${expanded ? "Sidepanel schließen" : "anzeigen"}`);
        });
    }

    function openGroupKey(group) {
        return `open:${view.openGrouping}:${group.key}`;
    }

    function renderOpen() {
        const column = board.open;
        document.getElementById("tb-count-open").textContent = column.count;
        const body = document.getElementById("tb-body-open");
        if (!column.count) {
            body.innerHTML = columnEmptyHtml("Keine offenen Aufgaben");
            return;
        }
        if (view.openGrouping === "none") {
            body.innerHTML = cardsHtml(column.groups[0].tasks);
            return;
        }
        body.innerHTML = column.groups.map((group, index) => {
            const key = openGroupKey(group);
            const isOpen = expandedGroups.has(key);
            const bodyId = `tb-open-group-${index}`;
            const processId = group.tasks[0].process_id;
            const blocked = view.openGrouping === "process" && processId != null ? column.blockedByProcess?.[processId] || 0 : 0;
            const blockedText = `${blocked} ${blocked === 1 ? "blockierte Aufgabe" : "blockierte Aufgaben"} in diesem Prozess`;
            return `
                <div class="tb-group tb-person${isOpen ? " is-open" : ""}">
                    <div class="tb-group-headrow">
                        <button type="button" class="tb-person-head" data-group-toggle="${escapeHtml(key)}" aria-expanded="${isOpen}" aria-controls="${bodyId}" title="${escapeHtml(group.label)}">
                            <span class="tb-person-name">${escapeHtml(group.label)}</span>
                            <span class="tb-group-count">${group.tasks.length}</span>
                            ${ICONS.chevron}
                        </button>
                        ${blocked ? `<button type="button" class="tb-group-blocked" data-show-blocked="${escapeHtml(processId)}" data-group-key="${escapeHtml(key)}" title="${escapeHtml(`${blockedText} anzeigen`)}" aria-label="${escapeHtml(`${blockedText} anzeigen`)}">${ICONS.lock}<span>${blocked}</span></button>` : ""}
                    </div>
                    <div id="${bodyId}"${isOpen ? "" : " hidden"}>${isOpen ? cardsHtml(group.tasks) : ""}</div>
                </div>
            `;
        }).join("");
    }

    function renderProgress() {
        const column = board.progress;
        document.getElementById("tb-count-progress").textContent = column.count;
        const body = document.getElementById("tb-body-progress");
        if (!column.count) {
            body.innerHTML = columnEmptyHtml("Nichts in Bearbeitung");
            return;
        }

        const mineGroup = column.groups.find(group => group.isMine);
        const others = column.groups.filter(group => !group.isMine);
        let html = "";

        html += `
            <div class="tb-group tb-person is-me">
                <h3 class="tb-person-head">
                    <span class="tb-avatar is-me">${escapeHtml(Model.initials(me.name))}</span>
                    <span class="tb-person-name">Ich</span>
                    <span class="tb-group-count">${mineGroup ? mineGroup.tasks.length : 0}</span>
                </h3>
                ${mineGroup ? cardsHtml(mineGroup.tasks) : emptyHtml("Nichts übernommen")}
            </div>
        `;

        html += others.map(group => {
            const isOpen = expandedGroups.has(group.key);
            const oldest = group.tasks[0];
            const age = oldest?.assigned_at ? Model.ageLabel(oldest.assigned_at, berlinNowStamp()) : "";
            return `
                <div class="tb-group tb-person${isOpen ? " is-open" : ""}">
                    <button type="button" class="tb-person-head" data-group-toggle="${escapeHtml(group.key)}" aria-expanded="${isOpen}">
                        <span class="tb-avatar">${escapeHtml(group.initials)}</span>
                        <span class="tb-person-name">${escapeHtml(group.label)}</span>
                        ${age && !isOpen ? `<span class="tb-person-age" title="Am längsten in Bearbeitung">seit ${escapeHtml(age)}</span>` : ""}
                        <span class="tb-group-count">${group.tasks.length}</span>
                        ${ICONS.chevron}
                    </button>
                    ${isOpen ? cardsHtml(group.tasks) : ""}
                </div>
            `;
        }).join("");

        body.innerHTML = html;
    }

    function renderDone() {
        const column = board.done;
        document.getElementById("tb-count-done").textContent = column.count;
        root.querySelectorAll("[data-done-range]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.doneRange === view.doneRange));
        });
        const body = document.getElementById("tb-body-done");
        if (!column.count) {
            const empty = { today: "Heute noch nichts erledigt", week: "Diese Woche nichts erledigt", month: "Diesen Monat nichts erledigt" };
            body.innerHTML = columnEmptyHtml(empty[view.doneRange]);
            return;
        }
        // Die SD-API liefert höchstens 1000 erledigte Aufgaben, die neuesten zuerst.
        body.innerHTML = (truncated ? emptyHtml("Nur die neuesten 1000") : "") + column.groups.map(group => `
            <div class="tb-group">
                ${groupLabelHtml(group.label, group.tasks.length)}
                ${cardsHtml(group.tasks)}
            </div>
        `).join("");
    }

    function renderTabs() {
        const counts = {
            parked: board.parked.count,
            open: board.open.count,
            progress: board.progress.count,
            done: board.done.count
        };
        const active = document.getElementById("tb-board").dataset.active;
        root.querySelectorAll("[data-tab]").forEach(button => {
            button.disabled = button.dataset.tab === "parked" && counts.parked === 0;
            button.setAttribute("aria-pressed", String(button.dataset.tab === active));
        });
        root.querySelectorAll("[data-tab-count]").forEach(el => {
            el.textContent = counts[el.dataset.tabCount];
        });
    }

    // ---------- Werkzeugleiste ----------

    function facetOptions() {
        const values = { backlog: new Set(), taskType: new Set(), handling: new Set() };
        tasks.forEach(task => Model.FACETS.forEach(key => values[key].add(Model.facetValue(task, key))));
        const label = {
            backlog: value => value === "__NONE__" ? "Kein Backlog" : (backlogLookup[value]?.name || value),
            taskType: value => LABELS.taskType[value] || value,
            handling: value => LABELS.handling[value] || value
        };
        return Model.FACETS.map(key => ({
            key,
            title: { backlog: "Backlog", taskType: "Aufgabentyp", handling: "Bearbeitungsart" }[key],
            options: Array.from(values[key]).filter(Boolean)
                .map(value => ({ value, label: label[key](value) }))
                .sort((left, right) => left.label.localeCompare(right.label, "de"))
        }));
    }

    function renderFilterPop() {
        const pop = document.getElementById("tb-filter-pop");
        pop.innerHTML = `
            ${facetOptions().map(facet => `
                <fieldset class="tb-pop-group">
                    <legend>${escapeHtml(facet.title)}</legend>
                    ${facet.options.map(option => `
                        <label><input type="checkbox" data-facet="${facet.key}" value="${escapeHtml(option.value)}"${view.facets[facet.key].includes(option.value) ? " checked" : ""}> ${escapeHtml(option.label)}</label>
                    `).join("")}
                </fieldset>
            `).join("")}
            <button type="button" class="tb-link-btn" data-filter-reset${Model.countActiveFacets(view) ? "" : " disabled"}>Zurücksetzen</button>
        `;
    }

    function renderToolbar() {
        const count = Model.countActiveFacets(view);
        const badge = document.getElementById("tb-filter-count");
        badge.hidden = count === 0;
        badge.textContent = count;
        document.getElementById("tb-filter-btn").classList.toggle("is-active", count > 0);
        document.getElementById("tb-only-mine").setAttribute("aria-pressed", String(view.onlyMine));
        root.querySelectorAll('input[name="tb-open-grouping"]').forEach(input => {
            input.checked = input.value === view.openGrouping;
        });
        root.querySelectorAll('input[name="tb-open-sort"]').forEach(input => {
            input.checked = input.value === view.openSort;
        });
        document.getElementById("tb-open-options-btn").classList.toggle(
            "is-active", view.openGrouping !== "none" || view.openSort !== "due"
        );
    }

    // ---------- Auswahl ----------

    function parkedIsVisible() {
        const mobileTab = window.matchMedia("(max-width: 900px)").matches;
        return view.railOpen || mobileTab;
    }

    function displayedColumnTaskIds(column) {
        if (column === "open" && view.openGrouping !== "none") {
            return board.open.groups
                .filter(group => expandedGroups.has(openGroupKey(group)))
                .flatMap(group => group.tasks.map(task => task.task_id));
        }
        return Model.columnTaskIds(board, column);
    }

    function visibleSelectableIds() {
        const ids = new Set();
        const activePark = parkedIsVisible() ? Model.activeParkedSection(board.parked, view.railTab) : null;
        board.parked.sections
            .filter(section => section.key === activePark)
            .forEach(section => section.groups.forEach(group => group.tasks.forEach(task => {
                if (Model.canSelect(task, meId)) {
                    ids.add(task.task_id);
                }
            })));
        Model.COLUMNS.filter(column => column !== "parked").forEach(column => {
            displayedColumnTaskIds(column).forEach(id => {
                const task = findTask(id);
                if (task && Model.canSelect(task, meId)) {
                    ids.add(task.task_id);
                }
            });
        });
        return ids;
    }

    // Was durch Filter verschwindet, fällt aus der Auswahl: nichts wird unsichtbar bewegt.
    function pruneSelection() {
        const visible = visibleSelectableIds();
        Array.from(selected).forEach(id => {
            if (!visible.has(id)) {
                selected.delete(id);
            }
        });
    }

    function renderSelbar() {
        const bar = document.getElementById("tb-selbar");
        const summary = Model.summarizeSelection(tasks, selected, meId);
        root.classList.toggle("has-selection", summary.count > 0);
        bar.hidden = summary.count === 0;
        if (!summary.count) {
            return;
        }
        document.getElementById("tb-sel-count").textContent = `${summary.count} ausgewählt`;
        const mixed = summary.assignable.length && summary.releasable.length;
        const assign = document.getElementById("tb-bulk-assign");
        const releaseBtn = document.getElementById("tb-bulk-release");
        assign.hidden = !summary.assignable.length;
        assign.disabled = bulkBusy;
        assign.textContent = mixed ? `${summary.assignable.length} übernehmen` : "Übernehmen";
        releaseBtn.hidden = !summary.releasable.length;
        releaseBtn.disabled = bulkBusy;
        releaseBtn.textContent = mixed ? `${summary.releasable.length} freigeben` : "Freigeben";
    }

    function columnOfTaskId(taskId) {
        const task = findTask(taskId);
        return task ? Model.columnOf(task) : null;
    }

    function toggleSelection(taskId, { range = false } = {}) {
        const task = findTask(taskId);
        if (!task || !Model.canSelect(task, meId)) {
            return;
        }
        const column = Model.columnOf(task);
        if (range && anchor !== null && columnOfTaskId(anchor) === column) {
            const ids = Model.rangeSelection(
                displayedColumnTaskIds(column), anchor, task.task_id,
                id => Model.canSelect(findTask(id), meId)
            );
            ids.forEach(id => selected.add(id));
        } else if (selected.has(task.task_id)) {
            selected.delete(task.task_id);
        } else {
            selected.add(task.task_id);
        }
        anchor = task.task_id;
        render();
    }

    // Nach dem Neuzeichnen denselben Knopf wieder fokussieren, sonst springt die Tastatur an den Seitenanfang.
    function refocus(attribute, value) {
        root.querySelector(`[${attribute}="${value}"]`)?.focus({ preventScroll: true });
    }

    function clearSelection() {
        selected.clear();
        anchor = null;
        render();
    }

    // ---------- Laden und Aktionen ----------

    // Erledigte ab Beginn des gewählten Zeitraums; die letzte Anfrage gewinnt.
    async function reload() {
        const request = ++loadRequest;
        if (!data.mock) todayKey = window.SofaContract.berlinDateKey();
        const result = await backend.load(Model.rangeStart(view.doneRange, todayKey));
        if (request !== loadRequest) return;
        if (result.ok) {
            tasks = result.data.tasks;
            truncated = result.data.truncated;
            loadState = "ready";
        } else if (loadState !== "ready") {
            loadState = "failed";
        }
        render();
    }

    async function runBulk(action) {
        const summary = Model.summarizeSelection(tasks, selected, meId);
        const list = action === "assign" ? summary.assignable : summary.releasable;
        if (!list.length || bulkBusy) return;
        bulkBusy = true;
        renderSelbar();
        const ids = list.map(task => task.task_id);
        const outcome = action === "assign" ? await backend.assign(ids) : await backend.release(ids);
        outcome.done.forEach(id => selected.delete(id));
        bulkBusy = false;
        await reload();
        const verb = action === "assign" ? "übernommen" : "freigegeben";
        if (outcome.failed.length) {
            flash(`${outcome.done.length} ${verb}, ${outcome.failed.length} nicht möglich: ${outcome.failed[0].message}`, "failure");
        } else {
            flash(`${outcome.done.length} ${verb}`);
        }
    }

    // ---------- Details ----------

    const detail = window.TasksBoardDetail.create({
        Model, me, today: () => todayKey, backend,
        getTasks: () => tasks,
        refresh: reload,
        now: berlinNowStamp, formatDateTime, processLabel, backlogLookup,
        labels: LABELS
    });

    function openDetail(taskId) {
        detail.open(taskId);
    }

    // ---------- Popover ----------

    function setPopover(buttonId, popId, open) {
        const button = document.getElementById(buttonId);
        const pop = document.getElementById(popId);
        if (!button || !pop) {
            return;
        }
        pop.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
    }

    function closePopovers() {
        setPopover("tb-filter-btn", "tb-filter-pop", false);
        setPopover("tb-open-options-btn", "tb-open-options", false);
    }

    // ---------- Gesamt ----------

    function render() {
        board = Model.buildBoard(tasks, view, { meId, todayKey, lookups });
        const active = Model.activeParkedSection(board.parked, view.railTab);
        const railTab = active || view.railTab;
        const railOpen = view.railOpen && active !== null;
        if (railTab !== view.railTab || railOpen !== view.railOpen) {
            view = { ...view, railTab, railOpen };
            saveView();
        }
        if (!active && document.getElementById("tb-board").dataset.active === "parked") {
            document.getElementById("tb-board").dataset.active = "open";
        }
        pruneSelection();
        renderParked();
        renderOpen();
        renderProgress();
        renderDone();
        renderTabs();
        renderToolbar();
        renderSelbar();
    }

    function updateView(patch) {
        view = { ...view, ...patch };
        saveView();
        render();
    }

    // ---------- Ereignisse ----------

    root.addEventListener("click", event => {
        const target = event.target;

        const check = target.closest("[data-check]");
        if (check) {
            toggleSelection(Number(check.dataset.check), { range: event.shiftKey });
            refocus("data-check", check.dataset.check);
            return;
        }

        const main = target.closest("[data-open]");
        if (main) {
            const taskId = Number(main.dataset.open);
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                event.preventDefault();
                toggleSelection(taskId, { range: event.shiftKey });
                refocus("data-open", main.dataset.open);
            } else {
                openDetail(taskId);
            }
            return;
        }

        // Blockierte Tasks eines Prozesses: Suche auf die Prozess-ID setzen und das Sidepanel auf "Blockiert" öffnen.
        const showBlocked = target.closest("[data-show-blocked]");
        if (showBlocked) {
            const search = Model.processQuery(showBlocked.dataset.showBlocked);
            document.getElementById("tb-search").value = search;
            expandedGroups.add(showBlocked.dataset.groupKey);
            if (window.matchMedia("(max-width: 900px)").matches) {
                document.getElementById("tb-board").dataset.active = "parked";
            }
            updateView({ search, railOpen: true, railTab: "blocked" });
            root.querySelector('[data-rail-open="blocked"]')?.focus({ preventScroll: true });
            return;
        }

        const groupToggle = target.closest("[data-group-toggle]");
        if (groupToggle) {
            const key = groupToggle.dataset.groupToggle;
            if (expandedGroups.has(key)) {
                expandedGroups.delete(key);
            } else {
                expandedGroups.add(key);
            }
            render();
            Array.from(root.querySelectorAll("[data-group-toggle]"))
                .find(button => button.dataset.groupToggle === key)?.focus({ preventScroll: true });
            return;
        }

        const railOpen = target.closest("[data-rail-open]");
        if (railOpen) {
            const key = railOpen.dataset.railOpen;
            const active = Model.activeParkedSection(board.parked, view.railTab);
            const closing = parkedIsVisible() && active === key;
            if (closing && window.matchMedia("(max-width: 900px)").matches) {
                document.getElementById("tb-board").dataset.active = "open";
            }
            updateView({ railOpen: !closing, railTab: key });
            return;
        }

        if (target.closest("[data-rail-toggle]")) {
            updateView({ railOpen: !view.railOpen });
            return;
        }

        const bulk = target.closest("[data-bulk]");
        if (bulk) {
            if (bulk.dataset.bulk === "clear") {
                clearSelection();
            } else {
                runBulk(bulk.dataset.bulk);
            }
            return;
        }

        const tab = target.closest("[data-tab]");
        if (tab) {
            document.getElementById("tb-board").dataset.active = tab.dataset.tab;
            renderTabs();
            return;
        }

        const range = target.closest("[data-done-range]");
        if (range) {
            updateView({ doneRange: range.dataset.doneRange });
            reload();
            return;
        }

        if (target.closest("[data-filter-reset]")) {
            updateView({ facets: Model.createDefaultView().facets });
            renderFilterPop();
            return;
        }

        if (target.closest("#tb-only-mine")) {
            updateView({ onlyMine: !view.onlyMine });
            return;
        }

        if (target.closest("#tb-filter-btn")) {
            const open = document.getElementById("tb-filter-pop").hidden;
            closePopovers();
            if (open) {
                renderFilterPop();
            }
            setPopover("tb-filter-btn", "tb-filter-pop", open);
            return;
        }

        if (target.closest("#tb-open-options-btn")) {
            const open = document.getElementById("tb-open-options").hidden;
            closePopovers();
            setPopover("tb-open-options-btn", "tb-open-options", open);
            return;
        }

        if (!target.closest(".tb-pop")) {
            closePopovers();
        }
    });

    root.addEventListener("change", event => {
        const target = event.target;
        if (target.matches("[data-facet]")) {
            const key = target.dataset.facet;
            const values = new Set(view.facets[key]);
            if (target.checked) {
                values.add(target.value);
            } else {
                values.delete(target.value);
            }
            updateView({ facets: { ...view.facets, [key]: Array.from(values) } });
            renderFilterPop();
            return;
        }
        if (target.name === "tb-open-grouping") {
            updateView({ openGrouping: target.value });
            return;
        }
        if (target.name === "tb-open-sort") {
            updateView({ openSort: target.value });
        }
    });

    document.getElementById("tb-search").addEventListener("input", event => {
        view = { ...view, search: event.target.value };
        render();
    });

    const dialog = document.getElementById("tb-detail");

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || dialog.open) {
            return;
        }
        const popOpen = !document.getElementById("tb-filter-pop").hidden || !document.getElementById("tb-open-options").hidden;
        if (popOpen) {
            closePopovers();
        } else if (selected.size) {
            clearSelection();
        }
    });

    window.matchMedia("(max-width: 900px)").addEventListener("change", syncRailAccessibility);
    render();
    backend.backlogs().then(backlogs => {
        setBacklogs(backlogs);
        render();
    });
    reload();
    setInterval(() => {
        if (!document.hidden && !detail.isBusy() && !bulkBusy) reload();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !detail.isBusy() && !bulkBusy) reload();
    });
}());
