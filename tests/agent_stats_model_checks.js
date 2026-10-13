const m = require('../app/static/js/reports/agent_stats_model.js');
const assert = require('assert');
assert.strictEqual(m.shiftMonth('2026-01-01', -1), '2025-12-01');
assert.strictEqual(m.shiftMonth('2026-12-01', 1), '2027-01-01');
assert.strictEqual(m.formatDuration(100, true), '1:40');
assert.strictEqual(m.formatDuration(null, true), '–');
const statuses = m.presenceStatuses([{label: 'Off', group: 'HOME', seconds: 1}, {label: 'On', group: 'ONLINE', seconds: 2}],
    [{label: 'On'}, {label: 'On'}, {label: 'Off'}, {label: 'On'}]);
assert.deepStrictEqual(statuses.map(x => [x.label, x.count]), [['On', 2], ['Off', 1]]);
assert.strictEqual(m.presenceStatuses([{label: 'On', group: 'ONLINE', count: 7}], []).at(0).count, 7);
assert.strictEqual(m.presenceStatuses([{label: 'On', group: 'ONLINE'}], []).at(0).count, null);
const day = ['2026-10-11T22:00:00.000Z', '2026-10-12T22:00:00.000Z'];
assert.deepStrictEqual(m.focusRange([{start: '2026-10-11T22:00:00Z', end: '2026-10-12T06:15:00Z', status: 'HOME'},
    {start: '2026-10-12T06:15:00Z', end: '2026-10-12T14:15:00Z', status: 'ONLINE'}], ...day),
    {start: Date.parse('2026-10-12T04:00:00Z'), end: Date.parse('2026-10-12T17:00:00Z')});
assert.deepStrictEqual(m.focusRange([{start: '2026-10-11T23:00:00Z', end: '2026-10-12T21:30:00Z', status: 'ONLINE'}], ...day),
    {start: Date.parse(day[0]), end: Date.parse(day[1])});
assert.deepStrictEqual(m.focusRange([], ...day), {start: Date.parse(day[0]), end: Date.parse(day[1])});
assert.strictEqual(m.parseSelection('?period=month&anchor=2026-09-20').period, 'month');
assert.strictEqual(m.escapeHtml('<test>'), '&lt;test&gt;');
assert.strictEqual(m.parseSelection('?queue=q1').queue, 'q1');
assert.strictEqual(m.parseSelection('').queue, null);
const phone = {available: true,
    summary: {answered: 4, not_answered: 1, transferred: 1, avg_talk_seconds: 100,
        avg_handle_seconds: 150, avg_hold_seconds: 20, avg_acw_seconds: 30},
    queues: [{queue_id: 'a', name: 'A', answered: 3, not_answered: 1, transferred: 1,
        talk_seconds: 330, hold_seconds: 60, acw_seconds: 90},
    {queue_id: 'b', name: 'B', answered: 1, not_answered: 0, transferred: 0}]};
assert.strictEqual(m.scopeTotals(phone, null).handle, 600);
assert.strictEqual(m.scopeTotals(phone, 'a').handle, 480);
assert.strictEqual(m.scopeTotals(phone, 'b').hasTimes, false);
assert.strictEqual(m.scopeTotals({available: false}, null), null);
const metrics = m.callMetrics(m.scopeTotals(phone, 'a'));
assert.strictEqual(m.formatMetric(metrics.find(x => x.key === 'avg_handle')), '2:40');
assert.strictEqual(m.formatMetric(metrics.find(x => x.key === 'answer_rate')), '75\u00a0%');
assert.strictEqual(m.callMetrics(m.scopeTotals(phone, 'b'))[0].value, null);
assert.deepStrictEqual(m.trend({kind: 'duration', value: 90}, {kind: 'duration', value: 100}),
    {direction: 'down', text: '−0:10', previous: '1:40'});
assert.strictEqual(m.trend({kind: 'percent', value: .8}, {kind: 'percent', value: .75}).text, '+5\u00a0Pp.');
assert.strictEqual(m.trend({kind: 'duration', value: 90}, null), null);
assert.deepStrictEqual(m.queueRows({...phone, queues: [...phone.queues].reverse()}).map(q => q.id), ['a', 'b']);
assert.strictEqual(m.callMetrics(m.scopeTotals(phone, null)).filter(x => !x.extra).length, 4);
assert.strictEqual(m.loggedSeconds([{group: 'HOME', seconds: 50}, {group: 'ONLINE', seconds: 30}, {group: 'PAUSE', seconds: 5}]), 35);
