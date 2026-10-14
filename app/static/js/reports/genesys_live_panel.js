(function (root, factory) {
    const panel = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = panel;
    }
    if (root) {
        root.GenesysLivePanel = panel;
    }
}(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    // Gemeinsamer Panel-Inhalt der Report-Seite und des Dashboards: reine Funktionen ohne DOM-Zugriff.
    const PANEL_KEY = "genesysLive.panelGroups";
    const DEFAULT_OPEN = { queue: true, pause: false, busy: false };

    const safe = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
    const AGENT_ICON = '<svg class="queue-mini-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 19c.3-3.5 2.6-5.4 6.5-5.4s6.2 1.9 6.5 5.4"/></svg>';
    const PHONE_ICON = '<svg class="queue-mini-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h4l2 5-2.4 2.4a17 17 0 0 0 6 6L16 14l5 2v4a2 2 0 0 1-2.2 2A19 19 0 0 1 2 5.2 2 2 0 0 1 4 3Z"/></svg>';
    const CHEVRON = '<svg class="kpi-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
    const INFO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.1"/></svg>';

    // Der Speicher kann fehlen oder werfen: dann gelten die Standardwerte.
    function loadOpen(storage) {
        try {
            return { ...DEFAULT_OPEN, ...JSON.parse(storage.getItem(PANEL_KEY) || "{}") };
        } catch (_) {
            return { ...DEFAULT_OPEN };
        }
    }

    function saveOpen(storage, open) {
        try {
            storage.setItem(PANEL_KEY, JSON.stringify(open));
        } catch (_) { /* nur Komfort */ }
    }

    function kpiRow(label, value, denominator, color, { emphasis = false, waiting = false, tone = "", hint = "", child = false, solo = false } = {}) {
        const percent = Math.max(0, Math.min(100, Math.round(value / Math.max(1, denominator) * 100)));
        return `<div class="kpi-row${emphasis ? " is-emphasis" : ""}${waiting ? " is-waiting" : ""}${child ? " is-child" : ""}${solo ? " is-solo" : ""}${tone ? ` is-${tone}` : ""}${value === 0 ? " is-zero" : ""}" style="--bar:${color}"><span class="kpi-row-label"${hint ? ` title="${safe(hint)}"` : ""}>${label}</span><strong class="kpi-row-value">${value}</strong><span class="kpi-track" aria-hidden="true"><span class="kpi-fill" style="width:${percent}%"></span></span></div>`;
    }

    function infoTip(id, label, body) {
        return `<span class="info-tip" tabindex="0" role="button" aria-label="${safe(label)}" aria-describedby="${id}">${INFO_ICON}</span><span class="info-tip-text" id="${id}" role="tooltip">${body}</span>`;
    }

    // A status block: the parent row toggles its breakdown; collapsed, it may show a different headline row.
    function kpiGroup(key, parent, children, open) {
        const isOpen = Boolean(open[key]);
        const head = isOpen || !parent.collapsed ? parent : { ...parent, ...parent.collapsed };
        const percent = Math.max(0, Math.min(100, Math.round(head.value / Math.max(1, head.denominator) * 100)));
        return `<div class="kpi-group${isOpen ? " is-open" : ""}">
    <button type="button" class="kpi-row kpi-parent${head.emphasis ? " is-emphasis" : ""}${head.tone ? ` is-${head.tone}` : ""}${head.value === 0 ? " is-zero" : ""}" style="--bar:${head.color}" data-kpi-group="${key}" aria-expanded="${isOpen}" aria-controls="kpi-${key}"><span class="kpi-row-label">${CHEVRON}${head.label}</span><strong class="kpi-row-value">${head.value}</strong><span class="kpi-track" aria-hidden="true"><span class="kpi-fill" style="width:${percent}%"></span></span></button>
    <div class="kpi-children" id="kpi-${key}"${isOpen ? "" : " hidden"}>${children.join("")}</div>
  </div>`;
    }

    // data: Summen (live.total) oder eine Queue; queue nur bei Filter (Fuss mit Aktivierungsquote).
    function panelBody(live, data, queue, open) {
        const voice = data.voice, people = data.people, onQueue = people.on_queue;
        const voiceTotal = Math.max(1, voice.interacting + voice.waiting);
        const otherOnQueue = onQueue.communicating + onQueue.not_responding;
        const otherTip = infoTip("otherTip", "Was zählt zu Sonstige?", `<span>In Warteschleife, aber gerade nicht für Queue-Anrufe bereit:</span><span class="info-tip-line"><span>Anruf außerhalb einer Queue</span><strong>${onQueue.communicating}</strong></span><span class="info-tip-line"><span>Nicht antwortend</span><strong>${onQueue.not_responding}</strong></span>`);
        // Rows come from the response, so a new Genesys status shows up without a frontend change.
        const statusRows = (group, color) => live.statuses[group].map(row => kpiRow(
            row.unspecified ? `${safe(row.label)}${infoTip(`${group}OtherTip`, "Was zählt zu Sonstige?", "<span>Beschäftigt ohne nähere Angabe gewählt.</span>")}` : safe(row.label),
            people[group].by_status[row.key] || 0, people[group].total, color, { child: true }));
        const attendance = [
            kpiGroup("queue", {
                label: "In Warteschleife", value: onQueue.total, denominator: people.present, color: "var(--gl-blue-fill)",
                collapsed: { label: "Frei in Warteschleife", value: onQueue.idle, denominator: onQueue.total, color: "var(--gl-green-fill)", emphasis: true, tone: "green" }
            }, [
                kpiRow("Davon frei", onQueue.idle, onQueue.total, "var(--gl-green-fill)", { child: true, emphasis: true, tone: "green" }),
                kpiRow("Im Gespräch", onQueue.interacting, onQueue.total, "var(--gl-orange-fill)", { child: true, hint: "Genesys Interacting; umfasst auch andere Kanäle und Nachbearbeitung." }),
                kpiRow(`Sonstige${otherTip}`, otherOnQueue, onQueue.total, "var(--gl-purple-fill)", { child: true }),
            ], open),
            kpiGroup("pause", { label: "Pause", value: people.pause.total, denominator: people.present, color: "var(--gl-orange-fill)" }, statusRows("pause", "var(--gl-orange-fill)"), open),
            kpiGroup("busy", { label: "Beschäftigt", value: people.busy.total, denominator: people.present, color: "var(--gl-red-fill)" }, statusRows("busy", "var(--gl-red-fill)"), open),
            // Away is not used actively; the row only appears when someone is in it.
            ...(people.away ? [kpiRow("Außer Haus", people.away, people.present, "var(--gl-grey-fill)", { solo: true })] : []),
        ].join("");

        return `
    <div class="panel-group"><div class="group-heading"><h3 class="group-label">${PHONE_ICON}Interaktionen · Voice</h3><span class="group-total" title="Laufende und wartende Voice-Interaktionen">${voice.interacting + voice.waiting} gesamt</span></div>
      ${kpiRow("Laufend", voice.interacting, voiceTotal, "var(--gl-blue-fill)", { emphasis: true })}
      ${kpiRow("Wartend", voice.waiting, voiceTotal, "var(--gl-orange-fill)", { emphasis: true, waiting: true })}
    </div>
    <div class="panel-group attendance"><div class="group-heading"><h3 class="group-label">${AGENT_ICON}Anwesenheit</h3><span class="group-total" title="Eindeutige Personen, die nicht offline sind">${people.present} Anwesende</span></div>${attendance}</div>
    ${queue ? `<div class="panel-foot"><strong>${queue.joined_count}</strong> von ${queue.member_count} Mitgliedern aktiviert</div>` : ""}`;
    }

    return { PANEL_KEY, DEFAULT_OPEN, safe, AGENT_ICON, PHONE_ICON, loadOpen, saveOpen, kpiRow, infoTip, kpiGroup, panelBody };
}));
