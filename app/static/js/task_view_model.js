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

    // Name des Prozesses: eigener Name, sonst der Anzeigename des Typs.
    function processName(task, lookups) {
        const name = firstNonEmpty(task, ["process_name"]);
        if (name !== null) {
            return String(name);
        }
        const processType = firstNonEmpty(task, ["process_type"]);
        return processType === null ? null : (lookups?.processLabels?.[processType] || String(processType));
    }

    // Prozess, optional Person, die ID immer am Ende: "Onboarding · Musterfrau, Maria · #700".
    function describeProcess(task, lookups, { withPerson = false } = {}) {
        const id = firstNonEmpty(task, ["process_id"]);
        const name = processName(task, lookups) || (id === null ? "Ohne Prozess" : "Prozess");
        const person = withPerson ? firstNonEmpty(task, ["target_user_name"]) : null;
        return [name, person, id === null ? null : `#${id}`].filter(part => part !== null).join(" · ");
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
            labelOf: (task, lookups) => describeProcess(task, lookups, { withPerson: true })
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

    function getGroupKey(task, dimensionId) {
        const key = getGroupDimension(dimensionId).keyOf(task || {});
        return { key, isUngrouped: key === UNGROUPED_KEY };
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

        const groups = Array.from(groupsByKey.values()).map(group => ({ ...group, tasks: sortTasks(group.tasks, todayKey) }));

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

    // Seit dem SD-API-Release mit task_completed schliesst eine erfolgreiche Integration den Task
    // selbst ab. Fehlt das Feld, laeuft noch die alte SD-API und das Ergebnis kommt spaeter.
    function botDispatchFeedback(result) {
        if (!result || !("task_completed" in result)) {
            return { category: "success", message: "Bot erfolgreich dispatcht. Das Ergebnis erscheint später im Verlauf. Bitte Historie prüfen oder aktualisieren." };
        }
        if (result.task_completed) {
            return { category: "success", message: "Integration erfolgreich, Aufgabe abgeschlossen." };
        }
        if (result.completion_error) {
            return { category: "failure", message: `${result.completion_error}. Bitte von Hand abschließen.` };
        }
        return { category: "failure", message: "Integration ohne Erfolg. Details im Verlauf." };
    }

    return {
        UNGROUPED_KEY,
        GROUP_DIMENSIONS,
        botDispatchFeedback,
        buildGroups,
        compareTasks,
        describeProcess,
        getGroupDimension,
        getGroupKey,
        sortTasks
    };
}));
