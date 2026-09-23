(function (root, factory) {
    // Datums-Helfer aus sofa_contract.js: im Browser ueber window, im Node-Test ueber require().
    const isCommonJs = typeof module === "object" && module.exports;
    const contract = isCommonJs ? require("./sofa_contract.js") : (root && root.SofaContract);
    const viewModel = factory(contract);

    if (isCommonJs) {
        module.exports = viewModel;
    }
    if (root) {
        root.TaskViewModel = viewModel;
    }
}(typeof window !== "undefined" ? window : globalThis, function (contract) {
    "use strict";

    const UNGROUPED_KEY = "__UNGROUPED__";

    // Reihenfolge-Raenge: ueberfaellig vor terminiert vor "kein Stichtag".
    const DUE_RANK_OVERDUE = 0;
    const DUE_RANK_SCHEDULED = 1;
    const DUE_RANK_UNDATED = 2;

    const TASK_FACET_KEYS = ["status", "handling", "taskType", "backlog"];

    const VISIBILITY_DEFAULTS = {
        showBlocked: false,
        showDeferred: false
    };

    function firstNonEmpty(record, keys) {
        for (const key of keys) {
            const value = record?.[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") {
                return value;
            }
        }
        return null;
    }

    function normalizeKeyPart(value) {
        return String(value).trim().toLowerCase().replace(/\s+/g, " ");
    }

    // ID vor normalisiertem Namen; fehlt beides, wird der Task nicht gruppiert.
    function buildKey(task, idKeys, nameKeys) {
        const id = firstNonEmpty(task, idKeys);
        if (id !== null) {
            return `id:${String(id).trim()}`;
        }

        const name = firstNonEmpty(task, nameKeys);
        if (name !== null) {
            return `name:${normalizeKeyPart(name)}`;
        }

        return UNGROUPED_KEY;
    }

    function describeProcess(task, lookups) {
        const name = firstNonEmpty(task, ["process_name"]);
        if (name !== null) {
            return String(name);
        }

        const processType = firstNonEmpty(task, ["process_type"]);
        const typeLabel = processType === null
            ? null
            : (lookups?.processLabels?.[processType] || String(processType));
        const id = firstNonEmpty(task, ["process_id"]);

        if (typeLabel && id !== null) {
            return `${typeLabel} · #${id}`;
        }
        if (typeLabel) {
            return typeLabel;
        }
        return id === null ? "Ohne Prozess" : `Prozess #${id}`;
    }

    const GROUP_DIMENSIONS = [
        {
            id: "none",
            label: "Keine Gruppierung",
            emptyLabel: "",
            keyOf: () => UNGROUPED_KEY,
            labelOf: () => ""
        },
        {
            id: "person",
            label: "Person",
            emptyLabel: "Ohne Person",
            keyOf: task => buildKey(task, ["target_user_id"], ["target_user_name"]),
            labelOf: task => {
                const name = firstNonEmpty(task, ["target_user_name"]);
                if (name !== null) {
                    return String(name);
                }
                const id = firstNonEmpty(task, ["target_user_id"]);
                return id === null ? "Ohne Person" : `Nutzer ${id}`;
            }
        },
        {
            id: "process",
            label: "Prozess",
            emptyLabel: "Ohne Prozess",
            keyOf: task => buildKey(task, ["process_id"], ["process_name"]),
            // Ein Prozess laeuft immer fuer genau eine Person, die gehoert ins Gruppenlabel.
            labelOf: (task, lookups) => {
                const processLabel = describeProcess(task, lookups);
                const person = firstNonEmpty(task, ["target_user_name"]);
                return person === null ? processLabel : `${processLabel} · ${person}`;
            }
        },
        {
            id: "system",
            label: "System",
            emptyLabel: "Ohne System",
            keyOf: task => buildKey(task, ["system_id"], ["system_name"]),
            labelOf: task => {
                const name = firstNonEmpty(task, ["system_name"]);
                if (name !== null) {
                    return String(name);
                }
                const id = firstNonEmpty(task, ["system_id"]);
                return id === null ? "Ohne System" : `System ${id}`;
            }
        },
        {
            id: "backlog",
            label: "Backlog",
            emptyLabel: "Kein Backlog",
            keyOf: task => buildKey(task, ["backlog_identifier"], []),
            labelOf: (task, lookups) => {
                const identifier = firstNonEmpty(task, ["backlog_identifier"]);
                if (identifier === null) {
                    return "Kein Backlog";
                }
                const normalized = String(identifier).trim();
                return lookups?.backlogLookup?.[normalized]?.name || `Backlog ${normalized}`;
            }
        }
    ];

    const GROUP_DIMENSION_BY_ID = Object.fromEntries(
        GROUP_DIMENSIONS.map(dimension => [dimension.id, dimension])
    );

    function getGroupDimension(dimensionId) {
        return GROUP_DIMENSION_BY_ID[dimensionId] || GROUP_DIMENSION_BY_ID.none;
    }

    function isGroupingActive(dimensionId) {
        return getGroupDimension(dimensionId).id !== "none";
    }

    function getGroupKey(task, dimensionId) {
        const key = getGroupDimension(dimensionId).keyOf(task || {});
        return { key, isUngrouped: key === UNGROUPED_KEY };
    }

    function isBlockedTask(task) {
        return task?.uiListState === "blocked";
    }

    function isDeferredTask(task) {
        // Fehlendes Feld gilt als REQUIRED, damit ohne Backend-Feld nichts verschwindet.
        return String(task?.provisioning_requirement || "").trim().toUpperCase() === "DEFERRED";
    }

    function getDueDateKey(task) {
        return contract.parseDateKey(task?.target_date);
    }

    function getDueRank(dueKey, todayKey) {
        if (!dueKey) {
            return DUE_RANK_UNDATED;
        }
        return dueKey < todayKey ? DUE_RANK_OVERDUE : DUE_RANK_SCHEDULED;
    }

    function compareTaskIds(left, right) {
        const leftNumber = Number(left?.task_id);
        const rightNumber = Number(right?.task_id);

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
        }

        return String(left?.task_id ?? "").localeCompare(String(right?.task_id ?? ""), "de");
    }

    // Ueberfaellig, dann terminiert, dann ohne Stichtag; Gleichstand entscheidet die Task-ID.
    function compareTasks(left, right, todayKey = contract.berlinDateKey()) {
        const leftDue = getDueDateKey(left);
        const rightDue = getDueDateKey(right);
        const leftRank = getDueRank(leftDue, todayKey);
        const rightRank = getDueRank(rightDue, todayKey);

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        if (leftDue && rightDue && leftDue !== rightDue) {
            return leftDue < rightDue ? -1 : 1;
        }

        return compareTaskIds(left, right);
    }

    function sortTasks(tasks, todayKey = contract.berlinDateKey()) {
        return [...(tasks || [])].sort((left, right) => compareTasks(left, right, todayKey));
    }

    function getListRank(task) {
        if (isBlockedTask(task)) {
            return 2;
        }
        return isDeferredTask(task) ? 1 : 0;
    }

    // Listenreihenfolge: was gerade nicht bearbeitbar ist, steht unten.
    function sortTasksForList(tasks, todayKey = contract.berlinDateKey()) {
        return [...(tasks || [])].sort((left, right) => {
            const rankDelta = getListRank(left) - getListRank(right);
            return rankDelta !== 0 ? rankDelta : compareTasks(left, right, todayKey);
        });
    }

    // Die Schauseite soll handlungsfaehig sein, also moeglichst nicht blockiert.
    function pickGroupFace(sortedTasks) {
        return sortedTasks.find(task => !isBlockedTask(task)) || sortedTasks[0] || null;
    }

    function buildGroups(tasks, dimensionId, lookups = {}) {
        const dimension = getGroupDimension(dimensionId);
        const todayKey = lookups.todayKey || contract.berlinDateKey();

        if (dimension.id === "none") {
            return [];
        }

        const groupsByKey = new Map();

        (tasks || []).forEach(task => {
            const key = dimension.keyOf(task);
            if (!groupsByKey.has(key)) {
                groupsByKey.set(key, {
                    key,
                    isUngrouped: key === UNGROUPED_KEY,
                    label: key === UNGROUPED_KEY ? dimension.emptyLabel : dimension.labelOf(task, lookups),
                    tasks: []
                });
            }
            groupsByKey.get(key).tasks.push(task);
        });

        const groups = Array.from(groupsByKey.values()).map(group => {
            const sorted = sortTasks(group.tasks, todayKey);
            return {
                ...group,
                tasks: sorted,
                face: pickGroupFace(sorted),
                blockedCount: sorted.filter(isBlockedTask).length,
                deferredCount: sorted.filter(isDeferredTask).length
            };
        });

        // Gruppen sortieren ueber ihre dringendste Aufgabe, der "Ohne ..."-Block bleibt hinten.
        groups.sort((left, right) => {
            if (left.isUngrouped !== right.isUngrouped) {
                return left.isUngrouped ? 1 : -1;
            }
            const byUrgency = compareTasks(left.tasks[0], right.tasks[0], todayKey);
            return byUrgency !== 0 ? byUrgency : left.label.localeCompare(right.label, "de");
        });

        return groups;
    }

    function createFacet() {
        return { include: [], exclude: [] };
    }

    function toFacet(raw) {
        return {
            include: Array.isArray(raw?.include) ? raw.include.map(String) : [],
            exclude: Array.isArray(raw?.exclude) ? raw.exclude.map(String) : []
        };
    }

    function isFacetActive(facet) {
        const normalized = toFacet(facet);
        return normalized.include.length > 0 || normalized.exclude.length > 0;
    }

    // Include und Exclude schliessen sich pro Wert aus.
    function toggleFacetValue(facet, value, mode, checked) {
        const normalized = toFacet(facet);
        const stringValue = String(value);
        const include = new Set(normalized.include);
        const exclude = new Set(normalized.exclude);
        const primary = mode === "exclude" ? exclude : include;
        const counterpart = mode === "exclude" ? include : exclude;

        if (checked) {
            primary.add(stringValue);
            counterpart.delete(stringValue);
        } else {
            primary.delete(stringValue);
        }

        return { include: Array.from(include), exclude: Array.from(exclude) };
    }

    function matchesFacet(value, facet) {
        const normalized = toFacet(facet);
        const stringValue = String(value ?? "");

        if (normalized.exclude.includes(stringValue)) {
            return false;
        }
        if (normalized.include.length && !normalized.include.includes(stringValue)) {
            return false;
        }
        return true;
    }

    function matchesFacets(task, filters, accessors) {
        return Object.entries(accessors || {}).every(([facetKey, accessor]) =>
            matchesFacet(accessor(task), filters?.[facetKey])
        );
    }

    function createDefaultViewState() {
        return {
            search: "",
            filters: Object.fromEntries(TASK_FACET_KEYS.map(key => [key, createFacet()])),
            visibility: { ...VISIBILITY_DEFAULTS },
            grouping: { dimension: "none" }
        };
    }

    // Alles Unbekannte aus einem persistierten Zustand faellt auf den Default zurueck.
    function normalizeViewState(raw) {
        const state = createDefaultViewState();

        if (typeof raw?.search === "string") {
            state.search = raw.search;
        }

        TASK_FACET_KEYS.forEach(facetKey => {
            state.filters[facetKey] = toFacet(raw?.filters?.[facetKey]);
        });

        Object.keys(VISIBILITY_DEFAULTS).forEach(visibilityKey => {
            if (typeof raw?.visibility?.[visibilityKey] === "boolean") {
                state.visibility[visibilityKey] = raw.visibility[visibilityKey];
            }
        });

        const dimensionId = raw?.grouping?.dimension;
        if (typeof dimensionId === "string" && GROUP_DIMENSION_BY_ID[dimensionId]) {
            state.grouping.dimension = dimensionId;
        }

        return state;
    }

    function hasActiveFilters(state) {
        const normalized = state || createDefaultViewState();
        return String(normalized.search || "").trim() !== "" ||
            TASK_FACET_KEYS.some(facetKey => isFacetActive(normalized.filters?.[facetKey]));
    }

    function hasNonDefaultView(state) {
        const normalized = state || createDefaultViewState();
        const visibilityChanged = Object.keys(VISIBILITY_DEFAULTS).some(
            key => Boolean(normalized.visibility?.[key]) !== VISIBILITY_DEFAULTS[key]
        );
        return hasActiveFilters(normalized) ||
            visibilityChanged ||
            isGroupingActive(normalized.grouping?.dimension);
    }

    // Ein leerer Tab ist nicht waehlbar; sind beide leer, schliesst das Modal.
    function resolveGroupModalTab(counts, activeTab) {
        const openCount = Number(counts?.open) || 0;
        const mineCount = Number(counts?.mine) || 0;
        const requestedTab = activeTab === "mine" ? "mine" : "open";

        if (!openCount && !mineCount) {
            return { tab: requestedTab, close: true };
        }

        const requestedCount = requestedTab === "mine" ? mineCount : openCount;
        if (requestedCount > 0) {
            return { tab: requestedTab, close: false };
        }

        return { tab: requestedTab === "mine" ? "open" : "mine", close: false };
    }

    return {
        UNGROUPED_KEY,
        TASK_FACET_KEYS,
        GROUP_DIMENSIONS,
        buildGroups,
        compareTasks,
        createDefaultViewState,
        createFacet,
        getGroupDimension,
        getGroupKey,
        hasActiveFilters,
        hasNonDefaultView,
        isBlockedTask,
        isDeferredTask,
        isFacetActive,
        isGroupingActive,
        matchesFacet,
        matchesFacets,
        normalizeViewState,
        pickGroupFace,
        resolveGroupModalTab,
        sortTasks,
        sortTasksForList,
        toggleFacetValue
    };
}));
