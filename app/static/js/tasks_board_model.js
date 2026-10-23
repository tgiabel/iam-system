(function (root, factory) {
    // Im Browser ueber window, im Node-Test ueber require(); wie task_view_model.js.
    const isCommonJs = typeof module === "object" && module.exports;
    const contract = isCommonJs ? require("./sofa_contract.js") : (root && root.SofaContract);
    const taskVM = isCommonJs ? require("./task_view_model.js") : (root && root.TaskViewModel);
    const model = factory(contract, taskVM);

    if (isCommonJs) {
        module.exports = model;
    }
    if (root) {
        root.TasksBoardModel = model;
    }
}(typeof window !== "undefined" ? window : globalThis, function (contract, taskVM) {
    "use strict";

    // Spalten des Boards. "parked" ist die Leiste "Zurückgestellt" (blockiert + nachgelagert).
    const COLUMNS = ["parked", "open", "progress", "done"];

    const OPEN_GROUPINGS = ["none", "process", "person", "system", "backlog"];
    const OPEN_SORTS = ["due", "age"];
    const DONE_RANGES = ["today", "week", "month"];
    const RAIL_TABS = ["blocked", "deferred"];
    const FACETS = ["backlog", "taskType", "handling"];

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

    function upper(value) {
        return String(value ?? "").trim().toUpperCase();
    }

    function sameUser(left, right) {
        return left !== null && left !== undefined && right !== null && right !== undefined &&
            String(left) === String(right);
    }

    function isDeferred(task) {
        return upper(task?.provisioning_requirement) === "DEFERRED";
    }

    function isMine(task, meId) {
        return sameUser(task?.assigned_to_user_id, meId);
    }

    // Fremd = jemand anderes hat den Task übernommen oder erledigt.
    function isForeign(task, meId) {
        const assignee = task?.assigned_to_user_id;
        return assignee !== null && assignee !== undefined && assignee !== "" && !sameUser(assignee, meId);
    }

    function columnOf(task) {
        switch (upper(task?.status)) {
            case "BLOCKED":
                return "parked";
            case "OPEN":
                return isDeferred(task) ? "parked" : "open";
            case "IN_PROGRESS":
                return "progress";
            case "COMPLETED":
                return "done";
            default:
                return null;
        }
    }

    // Auswählbar ist, was man selbst bewegen darf: offene (auch nachgelagerte) und eigene in Bearbeitung.
    function canSelect(task, meId) {
        const status = upper(task?.status);
        return status === "OPEN" || (status === "IN_PROGRESS" && isMine(task, meId));
    }

    // ---------- Datum ----------

    // SD-API-Zeitstempel sind naiv in Berliner Ortszeit: der Kalendertag steht vorne.
    function dayKeyOf(stamp) {
        return contract.parseDateKey(stamp);
    }

    function dayKeyToUtc(dayKey) {
        const [year, month, day] = dayKey.split("-").map(Number);
        return Date.UTC(year, month - 1, day);
    }

    function addDays(dayKey, days) {
        const value = new Date(dayKeyToUtc(dayKey) + days * DAY_MS);
        return value.toISOString().slice(0, 10);
    }

    function daysBetween(fromKey, toKey) {
        return Math.round((dayKeyToUtc(toKey) - dayKeyToUtc(fromKey)) / DAY_MS);
    }

    function weekStart(dayKey) {
        const weekday = new Date(dayKeyToUtc(dayKey)).getUTCDay();
        return addDays(dayKey, -((weekday + 6) % 7));
    }

    function rangeStart(range, todayKey) {
        if (range === "week") {
            return weekStart(todayKey);
        }
        if (range === "month") {
            return `${todayKey.slice(0, 8)}01`;
        }
        return todayKey;
    }

    function isInDoneRange(task, range, todayKey) {
        const doneKey = dayKeyOf(task?.completed_at);
        return Boolean(doneKey) && doneKey >= rangeStart(range, todayKey) && doneKey <= todayKey;
    }

    function formatDayLabel(dayKey, todayKey) {
        const delta = daysBetween(dayKey, todayKey);
        if (delta === 0) {
            return "Heute";
        }
        if (delta === 1) {
            return "Gestern";
        }
        const weekday = WEEKDAYS[new Date(dayKeyToUtc(dayKey)).getUTCDay()];
        return `${weekday} ${dayKey.slice(8, 10)}.${dayKey.slice(5, 7)}.`;
    }

    // Stichtag als kurzer Hinweis: überfällig / heute / Datum.
    function dueInfo(task, todayKey) {
        const dueKey = contract.parseDateKey(task?.target_date);
        if (!dueKey) {
            return null;
        }
        const delta = daysBetween(todayKey, dueKey);
        if (delta < 0) {
            return { tone: "overdue", label: `${-delta} T überfällig`, dueKey };
        }
        if (delta === 0) {
            return { tone: "today", label: "heute fällig", dueKey };
        }
        return { tone: "future", label: `fällig ${dueKey.slice(8, 10)}.${dueKey.slice(5, 7)}.`, dueKey };
    }

    function parseStamp(stamp) {
        const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(stamp || ""));
        if (!match) {
            return null;
        }
        const [, year, month, day, hour, minute] = match.map(Number);
        return Date.UTC(year, month - 1, day, hour, minute);
    }

    // Wie lange ein Task schon in Bearbeitung ist, grob: Min, Std, T.
    function ageLabel(since, now) {
        const start = parseStamp(since);
        const end = parseStamp(now);
        if (start === null || end === null) {
            return "";
        }
        const minutes = Math.max(0, Math.round((end - start) / 60000));
        if (minutes < 60) {
            return `${Math.max(1, minutes)} Min`;
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours} Std`;
        }
        return `${Math.floor(hours / 24)} T`;
    }

    function timeOf(stamp) {
        const match = /[T ](\d{2}):(\d{2})/.exec(String(stamp || ""));
        return match ? `${match[1]}:${match[2]}` : "";
    }

    // ---------- Namen ----------

    // SOFA-Namen kommen als "Nachname, Vorname".
    function displayName(name) {
        const raw = String(name || "").trim();
        if (!raw.includes(",")) {
            return raw;
        }
        const [last, first] = raw.split(",").map(part => part.trim());
        return first ? `${first} ${last}` : last;
    }

    function initials(name) {
        const parts = displayName(name).split(/\s+/).filter(Boolean);
        if (!parts.length) {
            return "?";
        }
        const first = parts[0][0];
        const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
        return `${first}${last}`.toUpperCase();
    }

    // Hauptbeschriftung der Karte: was mit der Ressource passiert.
    function actionLabel(task) {
        const resource = String(task?.resource_name || "").trim() || "Ressource";
        return upper(task?.task_type) === "REVOCATION" ? `${resource} entziehen` : `${resource} einrichten`;
    }

    // ---------- Ansicht ----------

    function createDefaultView() {
        return {
            railOpen: false,
            railTab: "blocked",
            openGrouping: "none",
            openSort: "due",
            doneRange: "today",
            onlyMine: false,
            search: "",
            facets: { backlog: [], taskType: [], handling: [] }
        };
    }

    function pick(value, allowed, fallback) {
        return allowed.includes(value) ? value : fallback;
    }

    // Gespeicherte Ansicht tolerant einlesen; Suche wird nicht gespeichert.
    function normalizeView(raw) {
        const defaults = createDefaultView();
        const source = raw && typeof raw === "object" ? raw : {};
        const facets = {};
        FACETS.forEach(key => {
            const values = source.facets?.[key];
            facets[key] = Array.isArray(values) ? values.map(String) : [];
        });
        return {
            railOpen: source.railOpen === true,
            railTab: pick(source.railTab, RAIL_TABS, defaults.railTab),
            openGrouping: pick(source.openGrouping, OPEN_GROUPINGS, defaults.openGrouping),
            openSort: pick(source.openSort, OPEN_SORTS, defaults.openSort),
            doneRange: pick(source.doneRange, DONE_RANGES, defaults.doneRange),
            onlyMine: source.onlyMine === true,
            search: "",
            facets
        };
    }

    function serializeView(view) {
        const { search, ...stored } = view;
        return stored;
    }

    // ---------- Filter ----------

    function facetValue(task, key) {
        if (key === "backlog") {
            return String(task?.backlog_identifier ?? "").trim() || "__NONE__";
        }
        if (key === "taskType") {
            return upper(task?.task_type);
        }
        return upper(task?.handling_type);
    }

    function normalizeText(value) {
        return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function searchIndex(task, lookups = {}) {
        return [
            task.task_id,
            task.resource_name,
            task.target_user_name,
            displayName(task.target_user_name),
            task.system_name,
            task.assigned_to_user_name,
            displayName(task.assigned_to_user_name),
            lookups.processLabels?.[task.process_type],
            task.process_id ? `#${task.process_id}` : ""
        ].map(normalizeText).filter(Boolean).join(" ");
    }

    function countActiveFacets(view) {
        return FACETS.reduce((sum, key) => sum + (view.facets[key]?.length || 0), 0);
    }

    // "Nur meine" wirkt nur dort, wo Tasks jemandem gehören (In Bearbeitung, Erledigt).
    function matchesView(task, view, meId, lookups) {
        for (const key of FACETS) {
            const selected = view.facets[key];
            if (selected?.length && !selected.includes(facetValue(task, key))) {
                return false;
            }
        }

        const column = columnOf(task);
        if (view.onlyMine && (column === "progress" || column === "done") && !isMine(task, meId)) {
            return false;
        }

        const query = normalizeText(view.search);
        if (query) {
            const index = searchIndex(task, lookups);
            // "#<Zahl>" trifft genau eine Prozess-ID, damit #71 nicht auch #712 findet.
            const hit = term => (/^#\d+$/.test(term)
                ? String(task.process_id ?? "") === term.slice(1)
                : index.includes(term));
            if (!query.split(" ").every(hit)) {
                return false;
            }
        }
        return true;
    }

    // Suchbegriff, der genau einen Prozess zeigt.
    function processQuery(processId) {
        return `#${processId}`;
    }

    // Blockierte Tasks je Prozess, für den Hinweis an der Prozessgruppe unter "Offen". Es zählen die Filter
    // ohne Suche, denn der Hinweis ersetzt die Suche durch die Prozess-ID.
    function blockedByProcess(tasks, view, meId, lookups) {
        const counts = {};
        const unsearched = { ...view, search: "" };
        (tasks || []).forEach(task => {
            if (upper(task.status) !== "BLOCKED" || task.process_id == null || !matchesView(task, unsearched, meId, lookups)) {
                return;
            }
            counts[task.process_id] = (counts[task.process_id] || 0) + 1;
        });
        return counts;
    }

    // ---------- Spalten aufbauen ----------

    function compareDue(left, right, todayKey) {
        return taskVM.compareTasks(left, right, todayKey);
    }

    function compareAge(left, right) {
        const byCreated = String(left.created_at || "").localeCompare(String(right.created_at || ""));
        return byCreated !== 0 ? byCreated : Number(left.task_id) - Number(right.task_id);
    }

    function groupBy(tasks, keyOf, labelOf) {
        const groups = new Map();
        tasks.forEach(task => {
            const key = keyOf(task);
            if (!groups.has(key)) {
                groups.set(key, { key, label: labelOf(task), tasks: [] });
            }
            groups.get(key).tasks.push(task);
        });
        return Array.from(groups.values());
    }

    function buildOpenColumn(tasks, view, lookups, todayKey) {
        const sorted = [...tasks].sort(view.openSort === "age"
            ? compareAge
            : (left, right) => compareDue(left, right, todayKey));

        if (view.openGrouping === "none") {
            return { count: sorted.length, groups: [{ key: "all", label: "", tasks: sorted }] };
        }

        const groups = taskVM.buildGroups(sorted, view.openGrouping, { ...lookups, todayKey });
        // buildGroups sortiert nach Stichtag; bei "Alter" gilt innerhalb der Gruppe das Alter.
        if (view.openSort === "age") {
            groups.forEach(group => group.tasks.sort(compareAge));
        }
        return {
            count: sorted.length,
            groups: groups.map(group => {
                let label = group.label;
                if (view.openGrouping === "process" && !group.isUngrouped) {
                    const task = group.tasks[0];
                    const name = String(task.process_name || "").trim()
                        || lookups.processLabels?.[task.process_type]
                        || String(task.process_type || "").trim()
                        || "Prozess";
                    const person = String(task.target_user_name || "").trim();
                    const id = String(task.process_id ?? "").trim();
                    label = [name, person, id ? `#${id}` : ""].filter(Boolean).join(" · ");
                }
                return { key: group.key, label, tasks: group.tasks };
            })
        };
    }

    function personGroups(tasks, todayKey) {
        return groupBy(
            [...tasks].sort((left, right) => compareDue(left, right, todayKey)),
            task => String(task.target_user_id ?? task.target_user_name ?? ""),
            task => displayName(task.target_user_name) || "Ohne Person"
        ).sort((left, right) => left.label.localeCompare(right.label, "de"));
    }

    function buildParkedColumn(tasks, todayKey) {
        const blocked = tasks.filter(task => upper(task.status) === "BLOCKED");
        const deferred = tasks.filter(task => upper(task.status) !== "BLOCKED");
        return {
            count: tasks.length,
            sections: [
                { key: "blocked", label: "Blockiert", count: blocked.length, groups: personGroups(blocked, todayKey) },
                { key: "deferred", label: "Nachgelagert", count: deferred.length, groups: personGroups(deferred, todayKey) }
            ]
        };
    }

    // Eigene Gruppe zuerst, Kollegen nach Name; innerhalb die am längsten übernommenen oben.
    function buildProgressColumn(tasks, meId) {
        const groups = groupBy(
            tasks,
            task => String(task.assigned_to_user_id ?? ""),
            task => displayName(task.assigned_to_user_name) || "Unbekannt"
        ).map(group => {
            const mine = isMine(group.tasks[0], meId);
            return {
                ...group,
                userId: group.tasks[0].assigned_to_user_id,
                isMine: mine,
                initials: initials(group.tasks[0].assigned_to_user_name),
                tasks: group.tasks.sort((left, right) =>
                    String(left.assigned_at || "").localeCompare(String(right.assigned_at || "")))
            };
        });

        groups.sort((left, right) => {
            if (left.isMine !== right.isMine) {
                return left.isMine ? -1 : 1;
            }
            return left.label.localeCompare(right.label, "de");
        });
        return { count: tasks.length, groups };
    }

    function buildDoneColumn(tasks, view, todayKey) {
        const inRange = tasks
            .filter(task => isInDoneRange(task, view.doneRange, todayKey))
            .sort((left, right) => String(right.completed_at || "").localeCompare(String(left.completed_at || "")));

        // Nur "Heute" kommt ohne Tagesköpfe aus.
        if (view.doneRange === "today") {
            return { count: inRange.length, groups: [{ key: "all", label: "", tasks: inRange }] };
        }
        return {
            count: inRange.length,
            groups: groupBy(inRange, task => dayKeyOf(task.completed_at), task => formatDayLabel(dayKeyOf(task.completed_at), todayKey))
        };
    }

    function buildBoard(tasks, view, { meId, todayKey, lookups = {} }) {
        const byColumn = { parked: [], open: [], progress: [], done: [] };
        (tasks || []).forEach(task => {
            const column = columnOf(task);
            if (column && matchesView(task, view, meId, lookups)) {
                byColumn[column].push(task);
            }
        });

        const open = buildOpenColumn(byColumn.open, view, lookups, todayKey);
        if (view.openGrouping === "process") {
            open.blockedByProcess = blockedByProcess(tasks, view, meId, lookups);
        }
        return {
            parked: buildParkedColumn(byColumn.parked, todayKey),
            open,
            progress: buildProgressColumn(byColumn.progress, meId),
            done: buildDoneColumn(byColumn.done, view, todayKey)
        };
    }

    // Ein geöffnetes Panel zeigt immer einen vorhandenen Bereich.
    function activeParkedSection(parked, railTab) {
        const present = (parked?.sections || []).filter(section => section.count > 0).map(section => section.key);
        if (!present.length) {
            return null;
        }
        return present.includes(railTab) ? railTab : present[0];
    }

    // Reihenfolge der Karten einer Spalte, wie sie angezeigt wird (für Shift-Klick-Bereiche).
    function columnTaskIds(board, column) {
        const data = board[column];
        if (!data) {
            return [];
        }
        const groups = data.sections ? data.sections.flatMap(section => section.groups) : data.groups;
        return groups.flatMap(group => group.tasks.map(task => task.task_id));
    }

    // ---------- Auswahl ----------

    function summarizeSelection(tasks, selectedIds, meId) {
        const selected = (tasks || []).filter(task => selectedIds.has(task.task_id));
        return {
            count: selected.length,
            assignable: selected.filter(task => upper(task.status) === "OPEN"),
            releasable: selected.filter(task => upper(task.status) === "IN_PROGRESS" && isMine(task, meId))
        };
    }

    // Bereich zwischen Anker und Ziel innerhalb einer Spalte; nur auswählbare Tasks.
    function rangeSelection(orderedIds, anchorId, targetId, isSelectable) {
        const from = orderedIds.indexOf(anchorId);
        const to = orderedIds.indexOf(targetId);
        if (from === -1 || to === -1) {
            return isSelectable(targetId) ? [targetId] : [];
        }
        const [start, end] = from < to ? [from, to] : [to, from];
        return orderedIds.slice(start, end + 1).filter(isSelectable);
    }

    // ---------- Simulierte Aktionen (Entwurf ohne Backend) ----------

    function assignTo(task, me, nowStamp) {
        return {
            ...task,
            status: "IN_PROGRESS",
            assigned_to_user_id: me.user_id,
            assigned_to_user_name: me.name,
            assigned_at: nowStamp
        };
    }

    function release(task) {
        return {
            ...task,
            status: "OPEN",
            assigned_to_user_id: null,
            assigned_to_user_name: null,
            assigned_at: null
        };
    }

    function completeTask(task, me, nowStamp) {
        if (!canSelect(task, me.user_id)) return task;
        const assigned = upper(task.status) === "OPEN" ? assignTo(task, me, nowStamp) : task;
        return { ...assigned, status: "COMPLETED", completed_at: nowStamp };
    }

    // Bis die SD-API einen strukturierten Abschlusskontext kennt, steht der Zusammenhang im Kommentar.
    const RELATED_REVOCATION_NOTE = "Mit dem Kontoentzug erledigt.";

    function relatedCompletionComment(comment) {
        const text = String(comment || "").trim();
        return text ? `${RELATED_REVOCATION_NOTE} ${text}` : RELATED_REVOCATION_NOTE;
    }

    function relatedRevocations(task, tasks, meId) {
        if (upper(task.task_type) !== "REVOCATION" || Number(task.resource_type_id) !== 1) return [];
        return tasks.filter(other => String(other.task_id) !== String(task.task_id) &&
            upper(other.task_type) === "REVOCATION" && sameUser(other.target_user_id, task.target_user_id) &&
            (task.system_id != null ? String(other.system_id) === String(task.system_id) : Boolean(task.system_name) && other.system_name === task.system_name) &&
            canSelect(other, meId));
    }

    return {
        COLUMNS,
        DONE_RANGES,
        RAIL_TABS,
        activeParkedSection,
        FACETS,
        OPEN_GROUPINGS,
        OPEN_SORTS,
        actionLabel,
        ageLabel,
        assignTo,
        blockedByProcess,
        buildBoard,
        canSelect,
        columnOf,
        columnTaskIds,
        completeTask,
        countActiveFacets,
        createDefaultView,
        displayName,
        dueInfo,
        facetValue,
        formatDayLabel,
        initials,
        isDeferred,
        isForeign,
        isInDoneRange,
        isMine,
        matchesView,
        normalizeView,
        processQuery,
        rangeSelection,
        RELATED_REVOCATION_NOTE,
        relatedCompletionComment,
        relatedRevocations,
        release,
        serializeView,
        summarizeSelection,
        timeOf,
        weekStart
    };
}));
