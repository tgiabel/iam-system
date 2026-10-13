const assert = require('assert');
const Model = require('../app/static/js/reports/agent_stats_model.js');

function element(id) {
    return {id, hidden: false, innerHTML: '', textContent: '', value: '', dataset: {}, disabled: false,
        listeners: {}, attributes: {}, classes: new Set(),
        get classList() {
            const classes = this.classes;
            return {add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
                toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
                contains(name) { return classes.has(name); }};
        },
        querySelectorAll() { return []; },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        setAttribute(name, value) { this.attributes[name] = value; }};
}

const ids = [
    'asReload', 'asAsOf', 'asStatus', 'asEmpty', 'asContent', 'asDayPicker',
    'asMonthPicker', 'asMonthPrev', 'asMonthNext', 'asMonthCurrent', 'asMonthInput',
    'asPresenceRange', 'asLogTotal', 'asStatusToggle', 'asStatuses', 'asTimelineWrap', 'asTimeline',
    'asPhoneScope', 'asQueueReset', 'asPhoneRange', 'asCallTotal', 'asCallBox', 'asPhoneSummary',
    'asQueueList', 'asOther', 'asMetricsCard', 'asMetricsHeading', 'asCompareLabel', 'asTimes',
    'asMoreToggle', 'asMoreMetrics',
];
const dom = Object.fromEntries(ids.map(id => [id, element(id)]));
const buttons = ['day', 'month'].map(period => Object.assign(element(period), {dataset: {period}}));
const root = {querySelectorAll() { return buttons; }};
global.document = {getElementById(id) { return id === 'agentStats' ? root : dom[id]; }};
const reports = {
    day: {period: 'day', anchor: '2026-10-12', today: '2026-10-12', first_day: '2025-10-13',
        from: '2026-10-11T22:00:00.000Z', to: '2026-10-12T22:00:00.000Z',
        data_as_of: {presence: '2026-10-12T08:00:00.000Z', conversations: null},
        account_linked: true,
        phone: {available: false, from: null, through: null, summary: null, queues: [], other: null},
        presence: {available: true, from: '2026-10-12', through: '2026-10-12',
            statuses: [{key: 'p', label: 'Online', group: 'ONLINE', seconds: 3600},
                {key: 'o', label: 'Offline', group: 'HOME', seconds: 1800}],
            timeline: [{start: '2026-10-12T07:00:00.000Z', end: '2026-10-12T08:00:00.000Z',
                label: 'Online', status: 'ONLINE'}]}},
    month: {period: 'month', anchor: '2026-10-01', today: '2026-10-12', first_day: '2025-10-13',
        from: '2026-09-30T22:00:00.000Z', to: '2026-10-31T23:00:00.000Z',
        data_as_of: {}, account_linked: true,
        phone: {available: true, from: '2026-10-01', through: '2026-10-12',
            summary: {answered: 4, not_answered: 1, transferred: 0,
                avg_talk_seconds: 81, avg_handle_seconds: 100, avg_hold_seconds: 12, avg_acw_seconds: 7},
            queues: [{queue_id: 'q', name: 'Hotline', answered: 4, not_answered: 1, transferred: 0}],
            other: {outbound: 0, direct: 0, unclassified: 0}},
        presence: {available: true, from: '2026-10-01', through: '2026-10-12',
            statuses: [{key: 'p', label: 'Online', group: 'ONLINE', seconds: 3600}], timeline: []}},
};
const queues = [
    {queue_id: 'a', name: 'Alpha', answered: 3, not_answered: 1, transferred: 0,
        talk_seconds: 300, hold_seconds: 30, acw_seconds: 60},
    {queue_id: 'b', name: 'Beta', answered: 1, not_answered: 0, transferred: 1,
        talk_seconds: 120, hold_seconds: 0, acw_seconds: 30},
];
reports.multi = {...reports.month, phone: {...reports.month.phone,
    summary: {answered: 4, not_answered: 1, transferred: 1, avg_talk_seconds: 105,
        avg_handle_seconds: 135, avg_hold_seconds: 8, avg_acw_seconds: 23},
    queues, comparison: {label: 'Vormonat',
        summary: {answered: 2, not_answered: 0, transferred: 0, avg_talk_seconds: 90,
            avg_handle_seconds: 100, avg_hold_seconds: 5, avg_acw_seconds: 5},
        queues: [{...queues[0], answered: 2, not_answered: 0, talk_seconds: 180}]}}};
let requests = 0;
let lastUrl = '';
let current = reports.day;
let timelineRange = null;
global.window = {AgentStatsModel: Model,
    TimeCorrectionModel: {dayRange() { return {start: 0, end: 1}; }, nowPercent() { return null; }},
    TimeCorrectionTimeline: {axisHtml(range) { timelineRange = range; return 'axis'; }, genesysRowHtml() { return 'timeline'; }},
    DayPicker: {mount() { return {render() {}}; }, shiftDay() { return '2026-10-11'; }},
    location: {search: '', pathname: '/tools/agent-stats'},
    history: {replaceState(_state, _title, url) { lastUrl = url; }}, addEventListener() {}};
global.fetch = async () => { requests += 1; return {ok: true, json: async () => current}; };
require('../app/static/js/reports/agent_stats_report.js');

function click(selector, attribute, value) {
    return {target: {closest(query) { return query === selector ? {dataset: {[attribute]: value}} : null; }}};
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }
const toggleQueues = () => dom.asPhoneSummary.listeners.click(click('[data-toggle-queues]', 'x', ''));

(async () => {
    await flush();
    assert.strictEqual(dom.asContent.hidden, false);
    assert.strictEqual(dom.asTimelineWrap.hidden, false);
    assert.deepStrictEqual(timelineRange, {start: Date.parse('2026-10-12T05:00:00.000Z'),
        end: Date.parse('2026-10-12T10:00:00.000Z')}, 'timeline focuses active time ± 2h');
    assert.match(dom.asPhoneSummary.innerHTML, /nicht verfügbar/);
    assert.strictEqual(dom.asCallTotal.hidden, true);
    assert.strictEqual(dom.asLogTotal.textContent, 'Eingeloggt 1:00', 'offline is not logged time');
    assert.strictEqual(dom.asStatusToggle.hidden, false);
    assert.strictEqual(dom.asStatuses.hidden, true, 'day view shows only the timeline at first');
    assert.match(dom.asStatuses.innerHTML, /Online[\s\S]*1×[\s\S]*Offline/, 'all statuses with count');
    dom.asStatusToggle.listeners.click();
    assert.strictEqual(dom.asStatuses.hidden, false);
    assert.strictEqual(dom.asStatusToggle.attributes['aria-expanded'], 'true');
    assert.match(dom.asAsOf.innerHTML, /^<span>Anwesenheit [^<]+<\/span>$/, 'one line per data source');
    assert.match(dom.asStatuses.innerHTML, /<button [^>]*data-status="Online" aria-pressed="false"/);
    dom.asStatuses.listeners.click(click('[data-status]', 'status', 'Online'));
    assert.ok(dom.asTimelineWrap.classList.contains('has-focus'), 'status click highlights timeline');
    dom.asStatuses.listeners.click(click('[data-status]', 'status', 'Online'));
    assert.ok(!dom.asTimelineWrap.classList.contains('has-focus'), 'second click clears highlight');
    dom.asStatuses.listeners.click(click('[data-status]', 'status', 'Online'));
    dom.asStatusToggle.listeners.click();
    assert.strictEqual(dom.asStatuses.hidden, true);
    assert.ok(!dom.asTimelineWrap.classList.contains('has-focus'), 'collapsing clears highlight');
    dom.asStatusToggle.listeners.click();
    assert.match(dom.asStatuses.innerHTML, /data-status="Online" aria-pressed="false"/);
    dom.asStatuses.listeners.click(click('[data-status]', 'status', 'Online'));

    current = reports.month;
    buttons[1].listeners.click();
    await flush();
    assert.strictEqual(dom.asDayPicker.hidden, true);
    assert.strictEqual(dom.asTimelineWrap.hidden, true);
    assert.strictEqual(dom.asStatusToggle.hidden, true, 'month view has no timeline to collapse to');
    assert.strictEqual(dom.asStatuses.hidden, false);
    assert.doesNotMatch(dom.asStatuses.innerHTML, /×/, 'no count without API field in month view');
    assert.doesNotMatch(dom.asStatuses.innerHTML, /data-status/, 'no highlight without timeline');
    assert.ok(!dom.asTimelineWrap.classList.contains('has-focus'));
    assert.match(dom.asPhoneRange.textContent, /01\.10\.2026 – 12\.10\.2026/);
    assert.match(dom.asPhoneSummary.innerHTML, /Angenommen[\s\S]*Verpasst[\s\S]*Weitergeleitet/);
    assert.match(dom.asPhoneSummary.innerHTML, /data-toggle-queues aria-expanded="false"/,
        'single queue can be expanded');
    toggleQueues();
    assert.strictEqual(dom.asQueueList.hidden, false);
    assert.match(dom.asQueueList.innerHTML, /data-queue="q"[\s\S]*Hotline/);
    dom.asQueueList.listeners.click(click('[data-queue]', 'queue', 'q'));
    assert.match(lastUrl, /queue=q/);
    assert.strictEqual(dom.asPhoneScope.textContent, 'Hotline');
    assert.strictEqual(dom.asQueueReset.hidden, false);
    dom.asQueueReset.listeners.click();
    assert.strictEqual(dom.asPhoneScope.hidden, true);
    assert.doesNotMatch(lastUrl, /queue=/);
    toggleQueues();
    assert.strictEqual(dom.asQueueList.hidden, true);
    assert.strictEqual(dom.asCallTotal.textContent, '5 Anrufe');
    assert.doesNotMatch(dom.asTimes.innerHTML, /Annahmequote/);
    dom.asMoreToggle.listeners.click();
    assert.strictEqual(dom.asMoreMetrics.hidden, false);
    assert.match(dom.asMoreMetrics.innerHTML, /Annahmequote[\s\S]*80\u00a0%/);
    dom.asMoreToggle.listeners.click();
    assert.strictEqual(dom.asMoreMetrics.hidden, true);

    current = reports.multi;
    dom.asReload.listeners.click();
    await flush();
    assert.match(dom.asPhoneSummary.innerHTML, /data-toggle-queues aria-expanded="false"/);
    assert.strictEqual(dom.asQueueList.hidden, true);
    assert.match(dom.asTimes.innerHTML, /\+0:15/, 'talk trend against comparison');
    assert.strictEqual(dom.asCompareLabel.textContent, 'ggü. Vormonat');
    const loaded = requests;
    toggleQueues();
    assert.strictEqual(dom.asQueueList.hidden, false);
    assert.match(dom.asPhoneSummary.innerHTML, /aria-expanded="true"/);
    assert.match(dom.asQueueList.innerHTML, /Alpha[\s\S]*Beta/, 'sorted by answered');
    dom.asQueueList.listeners.click(click('[data-queue]', 'queue', 'b'));
    assert.strictEqual(requests, loaded, 'queue filter works without refetch');
    assert.match(lastUrl, /queue=b/);
    assert.strictEqual(dom.asPhoneScope.hidden, false);
    assert.strictEqual(dom.asPhoneScope.textContent, 'Beta');
    assert.strictEqual(dom.asQueueReset.hidden, false);
    assert.strictEqual(dom.asMetricsHeading.textContent, 'Gesprächswerte – Beta');
    assert.strictEqual(dom.asCallTotal.textContent, '1 Anruf');
    assert.match(dom.asPhoneSummary.innerHTML, /<strong class="as-callkpi-value">1<\/strong>/);
    dom.asMoreToggle.listeners.click();
    assert.match(dom.asMoreMetrics.innerHTML, /Weiterleitungsquote[\s\S]*100\u00a0%/);
    dom.asMoreToggle.listeners.click();
    assert.strictEqual(dom.asOther.innerHTML, '');
    assert.match(dom.asQueueList.innerHTML, /data-queue="b" aria-pressed="true"/);
    dom.asQueueReset.listeners.click();
    assert.strictEqual(dom.asPhoneScope.hidden, true);
    assert.strictEqual(dom.asQueueReset.hidden, true);
    assert.strictEqual(dom.asMetricsHeading.textContent, 'Gesprächswerte');
    assert.doesNotMatch(lastUrl, /queue=/);

    const realQueues = {...reports.multi.phone, comparison: undefined,
        queues: queues.map(({talk_seconds, hold_seconds, acw_seconds, ...queue}) => queue)};
    current = {...reports.multi, phone: realQueues};
    dom.asReload.listeners.click();
    await flush();
    dom.asQueueList.listeners.click(click('[data-queue]', 'queue', 'a'));
    assert.match(dom.asTimes.innerHTML, /Zeiten je Hotline sind noch nicht verfügbar/);
    dom.asMoreToggle.listeners.click();
    assert.match(dom.asMoreMetrics.innerHTML, /Annahmequote[\s\S]*75\u00a0%/);
    dom.asMoreToggle.listeners.click();
    dom.asQueueReset.listeners.click();
    toggleQueues();
    assert.strictEqual(dom.asQueueList.hidden, true);

    toggleQueues();
    dom.asQueueList.listeners.click(click('[data-queue]', 'queue', 'a'));
    current = {...reports.multi, phone: {...reports.multi.phone, queues: [queues[1]]}};
    dom.asReload.listeners.click();
    await flush();
    assert.strictEqual(dom.asPhoneScope.hidden, true, 'a queue absent from the new period is cleared');
    assert.doesNotMatch(lastUrl, /queue=/);

    current = {...reports.day, account_linked: false};
    buttons[0].listeners.click();
    await flush();
    assert.strictEqual(dom.asContent.hidden, true);
    assert.match(dom.asEmpty.textContent, /kein gültiges Genesys-Konto/);
})().catch(error => { console.error(error); process.exitCode = 1; });
