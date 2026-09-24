const assert = require('assert');
const path = require('path');

const model = require(path.join(__dirname, '..', 'app', 'static', 'js', 'tools', 'time_correction_model.js'));
const timeline = require(path.join(__dirname, '..', 'app', 'static', 'js', 'tools', 'time_correction_timeline.js'));

const DAYS = ['2026-09-23', '2026-09-24'];

// --- Tage ---------------------------------------------------------------------

assert.deepStrictEqual(model.orderDays(DAYS), ['2026-09-24', '2026-09-23']);
assert.deepStrictEqual(model.orderDays(null), []);
assert.strictEqual(model.dayLabel('2026-09-24', 0), 'Heute · Do 24.09.');
assert.strictEqual(model.dayLabel('2026-09-23', 1), 'Gestern · Mi 23.09.');
// Umstellungstag: Wochentag hängt nicht an der Zeitzone des Rechners.
assert.strictEqual(model.dayLabel('2026-10-25', 0), 'Heute · So 25.10.');
assert.strictEqual(model.dayLabel('2026-03-29', 5), 'So 29.03.');

// --- Auswahl in der URL -------------------------------------------------------

const USER = '00000000-0000-0000-0000-000000000001';
assert.deepStrictEqual(model.readSelection(`?user=${USER}&date=2026-09-23`, DAYS), {userId: USER, date: '2026-09-23'});
assert.deepStrictEqual(model.readSelection('?date=2026-09-01', DAYS), {userId: null, date: '2026-09-24'});
assert.deepStrictEqual(model.readSelection('', DAYS), {userId: null, date: '2026-09-24'});
assert.deepStrictEqual(model.readSelection('', []), {userId: null, date: null});
assert.strictEqual(model.selectionQuery(USER, '2026-09-24'), `?user=${USER}&date=2026-09-24`);
assert.strictEqual(model.selectionQuery(null, '2026-09-24'), '?date=2026-09-24');
assert.strictEqual(model.selectionQuery(null, null), '');

// --- Suche und Fehler ---------------------------------------------------------

assert.strictEqual(model.isSearchable(' a '), false);
assert.strictEqual(model.isSearchable('Te'), true);
assert.strictEqual(model.errorMessage({detail: {code: 'user_unknown', message: 'Unbekannt'}}), 'Unbekannt');
assert.strictEqual(model.errorMessage({detail: 'Keine aktive Identität.'}), 'Keine aktive Identität.');
assert.strictEqual(model.errorMessage(null), 'Die Anfrage konnte nicht verarbeitet werden.');

// --- Zeit <-> Position --------------------------------------------------------

const H = 3600 * 1000;
const normalDay = {day_start: '2026-09-23T22:00:00.000Z', day_end: '2026-09-24T22:00:00.000Z'};
const dayRange = model.dayRange(normalDay);
assert.strictEqual(model.dayHours(normalDay), 24);
assert.strictEqual(model.percentAt(dayRange.start, dayRange), 0);
assert.strictEqual(model.percentAt(dayRange.start + 6 * H, dayRange), 25);
assert.strictEqual(model.percentAt(dayRange.end, dayRange), 100);
assert.strictEqual(model.timeAtPercent(50, dayRange), dayRange.start + 12 * H);
for (const percent of [0, 12.5, 33.3, 99.9]) {
    assert.ok(Math.abs(model.percentAt(model.timeAtPercent(percent, dayRange), dayRange) - percent) < 1e-9);
}
assert.strictEqual(model.berlinTime(model.toMs('2026-09-24T06:07:08.000Z')), '08:07');
assert.strictEqual(model.berlinTime(model.toMs('2026-09-24T06:07:08.000Z'), true), '08:07:08');

// --- Achse an den Umstellungstagen ------------------------------------------------

const labels = view => model.axisTicks(model.dayRange(view)).map(tick => tick.label);
const hours = n => Array.from({length: n}, (_, i) => String(i).padStart(2, '0'));
assert.deepStrictEqual(labels(normalDay), hours(24));
const springDay = {day_start: '2026-03-28T23:00:00.000Z', day_end: '2026-03-29T22:00:00.000Z'};
assert.strictEqual(model.dayHours(springDay), 23);
assert.deepStrictEqual(labels(springDay), hours(24).filter(h => h !== '02'));
const autumnDay = {day_start: '2026-10-24T22:00:00.000Z', day_end: '2026-10-25T23:00:00.000Z'};
assert.strictEqual(model.dayHours(autumnDay), 25);
assert.deepStrictEqual(labels(autumnDay), ['00', '01', '02', '02', ...hours(24).slice(3)]);
// Die zweite 02 liegt eine Stunde nach der ersten, beide auf der linearen Achse.
const autumnTicks = model.axisTicks(model.dayRange(autumnDay));
assert.strictEqual(autumnTicks[3].ms - autumnTicks[2].ms, H);
assert.strictEqual(autumnTicks[3].percent, 3 / 25 * 100);

// --- Ausschnitt „Arbeitszeit“ -------------------------------------------------

const seg = (start, end, status) => ({start, end, status, source: 'genesys', correction_id: null, create_index: null});
const work = model.workRange(normalDay, [
    seg('2026-09-23T22:00:00.000Z', '2026-09-24T06:10:00.000Z', 'HOME'),
    seg('2026-09-24T06:10:00.000Z', '2026-09-24T14:40:00.000Z', 'ONLINE'),
    seg('2026-09-24T14:40:00.000Z', '2026-09-24T22:00:00.000Z', 'HOME'),
]);
// 08:10–16:40 Berlin → 07:00–18:00 (1 h Rand, volle Stunden).
assert.deepStrictEqual([model.berlinTime(work.start), model.berlinTime(work.end)], ['07:00', '18:00']);
const shortWork = model.workRange(normalDay, [seg('2026-09-24T08:00:00.000Z', '2026-09-24T09:00:00.000Z', 'PAUSE')]);
assert.strictEqual(shortWork.end - shortWork.start, 8 * H);
assert.ok(shortWork.start <= model.toMs('2026-09-24T07:00:00.000Z') && shortWork.end >= model.toMs('2026-09-24T10:00:00.000Z'));
const earlyWork = model.workRange(normalDay, [seg('2026-09-23T22:30:00.000Z', '2026-09-23T23:00:00.000Z', 'ONLINE')]);
assert.deepStrictEqual(earlyWork, {start: dayRange.start, end: dayRange.start + 8 * H});
const lateWork = model.workRange(normalDay, [seg('2026-09-24T21:00:00.000Z', '2026-09-24T21:30:00.000Z', 'ONLINE')]);
assert.deepStrictEqual(lateWork, {start: dayRange.end - 8 * H, end: dayRange.end});
assert.deepStrictEqual(model.workRange(normalDay, [seg('2026-09-23T22:00:00.000Z', '2026-09-24T22:00:00.000Z', 'HOME')]), dayRange);
assert.deepStrictEqual(model.viewRange({...normalDay, merged: []}, 'day'), dayRange);

// --- Lage im Ausschnitt und „jetzt“ ---------------------------------------------

const window8 = {start: dayRange.start + 8 * H, end: dayRange.start + 16 * H};
assert.deepStrictEqual(model.place(dayRange.start, dayRange.start + 10 * H, window8), {left: 0, width: 25});
assert.strictEqual(model.place(dayRange.start, dayRange.start + 8 * H, window8), null);
assert.strictEqual(model.nowPercent(dayRange.start + 12 * H, normalDay, window8), 50);
assert.strictEqual(model.nowPercent(dayRange.start + 20 * H, normalDay, window8), null);
assert.strictEqual(model.nowPercent(dayRange.end + H, normalDay, dayRange), null);

// --- Herkunft und Ergebniszeile ------------------------------------------------

const view = {
    ...normalDay,
    genesys: [
        {start: '2026-09-24T06:10:00.000Z', end: '2026-09-24T10:03:00.000Z', status: 'ONLINE', label: 'Verfügbar'},
        {start: '2026-09-24T10:03:00.000Z', end: '2026-09-24T10:40:00.000Z', status: 'PAUSE', label: 'Mittagspause'},
    ],
    corrections: [{id: 12, create_index: null, status_group: 'ONLINE', reason: 'Dienstbeginn <laut TL>',
                   created_by: {user_id: 7, name: 'Tina Test'}, revoked_at: null}],
    pieces: [
        {start: '2026-09-24T06:00:00.000Z', end: '2026-09-24T06:10:00.000Z', status: 'ONLINE', source: 'correction', correction_id: 12, create_index: null},
        {start: '2026-09-24T06:10:00.000Z', end: '2026-09-24T10:03:00.000Z', status: 'ONLINE', source: 'genesys', correction_id: null, create_index: null},
        {start: '2026-09-24T10:03:00.000Z', end: '2026-09-24T10:40:00.000Z', status: 'PAUSE', source: 'genesys', correction_id: null, create_index: null},
    ],
    merged: [
        {start: '2026-09-24T06:00:00.000Z', end: '2026-09-24T10:03:00.000Z', status: 'ONLINE', source: 'correction', correction_id: 12, create_index: null},
        {start: '2026-09-24T10:03:00.000Z', end: '2026-09-24T10:40:00.000Z', status: 'PAUSE', source: 'genesys', correction_id: null, create_index: null},
    ],
};
assert.strictEqual(model.describeChange(view, view.merged[0]), 'Wechsel 08:00 → ONLINE · Korrektur #12 · Dienstbeginn <laut TL> · Tina Test');
assert.strictEqual(model.describeChange(view, view.merged[1]), 'Wechsel 12:03 → PAUSE · Genesys (Mittagspause)');
const previewView = {...view, corrections: [{id: null, create_index: 0, status_group: 'PAUSE', reason: '', created_by: null}]};
assert.strictEqual(model.describeChange(previewView, {start: '2026-09-24T10:03:00.000Z', status: 'PAUSE', source: 'correction', correction_id: null, create_index: 0}),
    'Wechsel 12:03 → PAUSE · Korrektur neu');

const html = timeline.resultRowHtml(view, dayRange, {nowMs: dayRange.start + 12 * H});
assert.strictEqual((html.match(/class="tc-seg /g) || []).length, 2);
assert.strictEqual((html.match(/class="tc-stripe"/g) || []).length, 1);
assert.strictEqual((html.match(/tc-marker-correction/g) || []).length, 1);
assert.strictEqual((html.match(/tc-marker-genesys/g) || []).length, 1);
assert.ok(html.includes('class="tc-now" style="left:50.0000%"'));
assert.ok(html.includes('Dienstbeginn &lt;laut TL&gt;'), 'Grund wird maskiert');
assert.ok(!/ id=/.test(html), 'Zeile ohne ids, damit sie mehrfach gerendert werden kann');
assert.ok(!timeline.resultRowHtml(view, dayRange, {nowMs: dayRange.end + H}).includes('tc-now'));
assert.ok(timeline.resultRowHtml(view, dayRange, {label: 'Tina Test'}).includes('>Tina Test</div>'));
assert.strictEqual((timeline.axisHtml(model.dayRange(autumnDay)).match(/class="tc-tick"/g) || []).length, 25);

// --- Opcyc-Datensätze ----------------------------------------------------------------

assert.deepStrictEqual(model.changeRows(view), [
    {time: '08:00:00', status: 'ONLINE', origin: 'Korrektur #12', source: 'correction'},
    {time: '12:03:00', status: 'PAUSE', origin: 'Genesys (Mittagspause)', source: 'genesys'},
]);
// Sekunden wie in der snapshot-CSV (strftime): abgeschnitten, nicht gerundet.
const secondsView = {...view, genesys: [], merged: [
    {start: '2026-09-24T10:03:17.999Z', end: '2026-09-24T10:40:00.000Z', status: 'PAUSE', source: 'genesys', correction_id: null, create_index: null},
]};
assert.deepStrictEqual(model.changeRows(secondsView).map(item => [item.time, item.origin]), [['12:03:17', 'Genesys']]);
// 25-Stunden-Tag: beide 02:30 erscheinen, in zeitlicher Reihenfolge.
const autumnView = {...autumnDay, genesys: [], corrections: [], merged: [
    {start: '2026-10-25T00:30:00.000Z', end: '2026-10-25T01:30:00.000Z', status: 'ONLINE', source: 'genesys'},
    {start: '2026-10-25T01:30:00.000Z', end: '2026-10-25T02:00:00.000Z', status: 'PAUSE', source: 'genesys'},
]};
assert.deepStrictEqual(model.changeRows(autumnView).map(item => item.time), ['02:30:00', '02:30:00']);

const listHtml = timeline.changeListHtml(view);
assert.strictEqual((listHtml.match(/<tr>/g) || []).length, 3);
assert.ok(listHtml.includes('<td class="tc-origin-correction">Korrektur #12</td>'));
assert.ok(timeline.changeListHtml({...view, merged: []}).includes('Keine Opcyc-Datensätze entstanden.'));
// Nicht in der Lieferung: Opcyc bekommt nichts, auch wenn merged ein Segment enthält.
assert.deepStrictEqual(model.changeRows({...view, delivered: false}), []);
assert.strictEqual(model.changeRows({...view, delivered: true}).length, 2);
assert.ok(!/ id=/.test(listHtml));

// --- Verlauf der zurückgenommenen Korrekturen -------------------------------------

const historyView = {...view, corrections: [
    {id: 3, create_index: null, effective_from: '2026-09-24T07:30:00.000Z', effective_to: '2026-09-24T07:45:00.000Z',
     applied_to: null, status_group: 'PAUSE', reason: 'Pause <nachgetragen>', created_at: '2026-09-24T08:15:00.000Z',
     created_by: {user_id: 7, name: 'Tina Test'}, revoked_at: '2026-09-24T09:02:00.000Z', revoked_by: {user_id: 8, name: 'Olaf Probe'}},
    {id: 5, create_index: null, effective_from: '2026-09-24T06:00:00.000Z', effective_to: null,
     applied_to: null, status_group: 'ONLINE', reason: 'Dienstbeginn', created_at: '2026-09-24T08:20:00.000Z',
     created_by: {user_id: 7, name: 'Tina Test'}, revoked_at: '2026-09-24T09:02:00.000Z', revoked_by: {user_id: 8, name: 'Olaf Probe'}},
    {...view.corrections[0], effective_from: '2026-09-24T06:00:00.000Z', effective_to: null, created_at: '2026-09-24T09:02:00.000Z'},
]};
assert.deepStrictEqual(model.revokedRows(historyView), [
    {id: 3, period: '09:30–09:45', status: 'PAUSE', reason: 'Pause <nachgetragen>',
     created: 'Tina Test · 24.09. 10:15', revoked: 'Olaf Probe · 24.09. 11:02'},
    {id: 5, period: 'ab 08:00', status: 'ONLINE', reason: 'Dienstbeginn',
     created: 'Tina Test · 24.09. 10:20', revoked: 'Olaf Probe · 24.09. 11:02'},
]);
assert.deepStrictEqual(model.revokedRows(view), []);
const revokedHtml = timeline.revokedListHtml(historyView);
assert.strictEqual((revokedHtml.match(/<tr>/g) || []).length, 3);
assert.ok(revokedHtml.includes('Pause &lt;nachgetragen&gt;'));
assert.strictEqual(timeline.revokedListHtml(view), '');

console.log('time_correction_model_checks: ok');
