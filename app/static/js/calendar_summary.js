(function (root, factory) {
    const summary = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = summary;
    }
    if (root) {
        root.CalendarSummary = summary;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    // Fasst Prozess-Events einer Woche je Ereignisart zusammen. Reine Funktionen ohne DOM.
    const COUNTED_STATUS = new Set(["PLANNED", "EXECUTED", "FAILED"]);
    const KIND_ORDER = ["onboarding", "offboarding", "training", "change", "assignment", "removal", "retrain", "other"];
    const NOUNS = {
        onboarding: ["Onboarding", "Onboardings"],
        offboarding: ["Offboarding", "Offboardings"],
        change: ["Abteilungswechsel", "Abteilungswechsel"],
        assignment: ["Rollenzuweisung", "Rollenzuweisungen"],
        removal: ["Rollenentzug", "Rollenentzüge"],
        retrain: ["Nachschulung", "Nachschulungen"],
        other: ["Termin", "Termine"]
    };
    const SKILL_FROM_TEXT = /^(.+?) Schulung für /;

    function kindOf(event) {
        if (String(event.process_type || "").toUpperCase() === "CHANGE" || /^Abteilungswechsel/.test(event.title || "")) {
            return "change";
        }
        switch (String(event.event_type || "").toUpperCase()) {
            case "ONBOARDING": return "onboarding";
            case "OFFBOARDING": return "offboarding";
            case "TRAINING_SCHEDULE": return "training";
            case "ROLE_ASSIGNMENT": return "assignment";
            case "ROLE_REMOVAL": return "removal";
            case "RETRAIN": return "retrain";
            default: return "other";
        }
    }

    function dayKeyOf(event) {
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(event.display_at || ""));
        return match ? match[1] : null;
    }

    // Uhrzeit nur, wenn der Zeitstempel eine echte enthaelt (00:00 steht fuer "ohne Uhrzeit").
    function timeOf(event) {
        const match = /[T ](\d{2}:\d{2})/.exec(String(event.display_at || ""));
        return match && match[1] !== "00:00" ? match[1] : "";
    }

    // Der Skill ist die Rolle der Schulung; aeltere Antworten tragen ihn nur im Text.
    function skillOf(event) {
        const name = String(event.role_name || "").trim();
        if (name) return name;
        const match = SKILL_FROM_TEXT.exec(String(event.description || ""));
        return match ? match[1].trim() : "";
    }

    function normalizeStatus(event) {
        return String(event.event_status || "").toUpperCase();
    }

    // Was als eine Einheit zaehlt: Personen, bei Abteilungswechsel der Vorgang, sonst jedes Event.
    function unitKey(kind, event, index) {
        if (kind === "change") return event.process_id != null ? `p${event.process_id}` : `e${index}`;
        if (["onboarding", "offboarding", "training", "retrain"].includes(kind)) {
            return event.user_id != null ? `u${event.user_id}` : `e${index}`;
        }
        return `e${index}`;
    }

    function countUnits(items) {
        return new Set(items.map(item => item.unit)).size;
    }

    function pluralNoun(kind, count) {
        return NOUNS[kind][count === 1 ? 0 : 1];
    }

    function trainingName(skill) {
        if (!skill) return "Schulung";
        return /\s/.test(skill) ? `Schulung „${skill}“` : `${skill}-Schulung`;
    }

    function lineText(kind, skill, count, state) {
        if (kind === "training") return `${trainingName(skill)} für ${count} Mitarbeiter ${state}`;
        return `${count} ${pluralNoun(kind, count)} ${state}`;
    }

    function byMoment(left, right) {
        return String(left.display_at).localeCompare(String(right.display_at)) || String(left.description).localeCompare(String(right.description), "de");
    }

    function summarize(events) {
        const groups = new Map();
        (Array.isArray(events) ? events : []).forEach((event, index) => {
            const status = normalizeStatus(event);
            const dayKey = dayKeyOf(event);
            if (!COUNTED_STATUS.has(status) || !dayKey) return;
            const kind = kindOf(event);
            const skill = kind === "training" ? skillOf(event) : "";
            const groupKey = kind === "training" ? `training|${event.role_id ?? skill}|${dayKey}` : kind;
            if (!groups.has(groupKey)) groups.set(groupKey, { kind, skill, items: [] });
            groups.get(groupKey).items.push({ event, status, dayKey, unit: unitKey(kind, event, index) });
        });

        const lines = Array.from(groups.entries()).map(([id, group]) => {
            const planned = countUnits(group.items.filter(item => item.status === "PLANNED"));
            const executed = countUnits(group.items.filter(item => item.status === "EXECUTED"));
            const failed = countUnits(group.items.filter(item => item.status === "FAILED"));
            let count = planned;
            let state = "geplant";
            if (!planned && executed) {
                count = executed;
                state = "erledigt";
            } else if (!planned) {
                count = failed;
                state = "fehlgeschlagen";
            }
            const mainIsFailed = !planned && !executed;
            return {
                id,
                kind: group.kind,
                skill: group.skill,
                text: lineText(group.kind, group.skill, count, state),
                planned,
                executed,
                failed,
                total: planned + executed + failed,
                done: planned && executed ? executed : 0,
                failedExtra: mainIsFailed ? 0 : failed,
                state: failed ? "failed" : planned ? "planned" : "done",
                dayKeys: Array.from(new Set(group.items.map(item => item.dayKey))).sort(),
                events: group.items.map(item => item.event).sort(byMoment)
            };
        });

        return lines.sort((left, right) => {
            const kindDiff = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
            return kindDiff || left.text.localeCompare(right.text, "de") || left.dayKeys[0].localeCompare(right.dayKeys[0]);
        });
    }

    function eventsOnDay(events, dayKey) {
        return (Array.isArray(events) ? events : []).filter(event => dayKeyOf(event) === dayKey);
    }

    // Zahl je Tag fuers Wochenband: Summe der Einheiten aller Zusammenfassungen dieses Tages.
    function dayTotal(events, dayKey) {
        return summarize(eventsOnDay(events, dayKey)).reduce((sum, line) => sum + line.total, 0);
    }

    return { kindOf, skillOf, dayKeyOf, timeOf, summarize, eventsOnDay, dayTotal, lineText, KIND_ORDER };
}));
