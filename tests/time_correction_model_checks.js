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

// --- Bearbeitungsblöcke ----------------------------------------------------------------

const correction = (id, from, to, appliedTo, extra = {}) => ({
    id, create_index: null, effective_from: from, effective_to: to, applied_to: appliedTo,
    status_group: 'ONLINE', reason: 'Grund ' + id, created_at: '2026-09-24T08:00:00.000Z',
    created_by: {user_id: 7, name: 'Tina Test'}, revoked_at: null, revoked_by: null, ...extra,
});
const blockView = {...normalDay, corrections: [
    correction(9, '2026-09-24T09:00:00.000Z', null, '2026-09-24T10:00:00.000Z'),
    correction(4, '2026-09-24T06:00:00.000Z', '2026-09-24T07:00:00.000Z', '2026-09-24T07:00:00.000Z'),
    correction(6, '2026-09-24T06:30:00.000Z', null, null, {revoked_at: '2026-09-24T08:30:00.000Z'}),
    {...correction(null, '2026-09-24T11:00:00.000Z', null, null), create_index: 0},
]};
const blocks = model.activeBlocks(blockView);
assert.deepStrictEqual(blocks.map(block => [block.key, block.id, block.to, block.appliedTo]), [
    ['c4', 4, model.toMs('2026-09-24T07:00:00.000Z'), model.toMs('2026-09-24T07:00:00.000Z')],
    ['c9', 9, null, model.toMs('2026-09-24T10:00:00.000Z')],
], 'nur aktive, gespeicherte Korrekturen, nach id');
assert.strictEqual(blocks[1].createdBy, 'Tina Test');
// Angezeigtes Ende: festes Ende, sonst applied_to aus der API, sonst nur der Beginn.
assert.strictEqual(model.blockEnd(blocks[1]), model.toMs('2026-09-24T10:00:00.000Z'));
assert.strictEqual(model.blockEnd({from: 5, to: null, appliedTo: null}), 5);

// --- Unterzeilen-Layout ----------------------------------------------------------------

const b = (key, from, to) => ({key, from: from * H, to: to == null ? null : to * H, appliedTo: null});
assert.deepStrictEqual(model.layoutLanes([]), {lanes: {}, count: 0});
assert.deepStrictEqual(model.layoutLanes([b('a', 8, 9), b('b', 9, 10), b('c', 11, 12)]),
    {lanes: {a: 0, b: 0, c: 0}, count: 1}, 'ohne Überlappung eine Zeile; Berühren ist keine Überlappung');
// Der spätere liegt oben: a < b < c; a überlappt nur b, liegt aber trotzdem unter b.
assert.deepStrictEqual(model.layoutLanes([b('a', 8, 10), b('b', 9, 11), b('c', 10.5, 12)]),
    {lanes: {c: 0, b: 1, a: 2}, count: 3});
assert.deepStrictEqual(model.layoutLanes([b('a', 8, 12), b('b', 9, 10), b('c', 10.5, 11)]),
    {lanes: {c: 0, b: 0, a: 1}, count: 2}, 'zwei spätere nebeneinander über einem früheren');
// Offene Wechsel ohne bekanntes Ende am selben Zeitpunkt weichen ebenfalls aus.
assert.deepStrictEqual(model.layoutLanes([b('a', 8, null), b('b', 8, null)]).lanes, {b: 0, a: 1});

// --- Zeilen im Bearbeitungsmodus -------------------------------------------------------

const genesysHtml = timeline.genesysRowHtml({...view, genesys: [
    {start: '2026-09-24T06:10:00.000Z', end: '2026-09-24T08:00:00.000Z', status: 'ONLINE', label: 'Verfügbar'},
    {start: '2026-09-24T08:00:00.000Z', end: '2026-09-24T09:00:00.000Z', status: 'ONLINE', label: 'Besprechung'},
]}, dayRange);
assert.strictEqual((genesysHtml.match(/tc-seg-genesys/g) || []).length, 2, 'gleicher Status bleibt getrennt');
assert.ok(genesysHtml.includes('title="Besprechung → ONLINE · 10:00–11:00"'));

const correctionHtml = timeline.correctionRowHtml([...blocks, {key: 'n1', from: dayRange.start + 12 * H, to: null, appliedTo: null, status: 'PAUSE', id: null}], dayRange,
    {selectedKey: 'c9'});
assert.strictEqual((correctionHtml.match(/class="tc-block /g) || []).length, 3);
assert.ok(/class="tc-block tc-status-ONLINE tc-block-open is-selected" data-key="c9"/.test(correctionHtml));
assert.ok(correctionHtml.includes('data-key="n1"') && correctionHtml.includes('PAUSE neu'));
assert.ok(!/tc-block-idle/.test(correctionHtml), 'neue Blöcke ohne Vorschau gelten nicht als wirkungslos');
assert.ok(timeline.correctionRowHtml([{...blocks[0], appliedTo: null}], dayRange).includes('tc-block-idle'));
assert.ok(correctionHtml.includes('title="#9 · ONLINE 11:00 (offen) · Grund 9 · Tina Test · 24.09. 10:00"'));
assert.ok(!/ id=/.test(correctionHtml));

const editor = timeline.editorHtml(view, blocks, dayRange, {nowMs: dayRange.start + 12 * H});
assert.deepStrictEqual((editor.match(/<div class="tc-row-label">([^<]*)</g) || []).map(m => m.split('>')[1].replace('<', '')),
    ['Genesys', 'Korrekturen', 'Ergebnis']);
assert.ok(editor.indexOf('tc-layers') < editor.indexOf('tc-merge'));

// --- Formularzeiten ----------------------------------------------------------------

assert.strictEqual(model.clockToMs(normalDay, '08:07'), model.toMs('2026-09-24T06:07:00.000Z'));
assert.strictEqual(model.clockToMs(normalDay, '00:00'), dayRange.start);
assert.strictEqual(model.clockToMs(normalDay, '00:00', true), dayRange.end, 'als Ende ist 00:00 Mitternacht');
assert.strictEqual(model.clockToMs(normalDay, '23:59', true), dayRange.end - 60 * 1000);
assert.strictEqual(model.clockToMs(normalDay, '8:00'), null);
assert.strictEqual(model.clockToMs(normalDay, '24:00'), null);
assert.strictEqual(model.clockToMs(normalDay, ''), null);
// Sommerzeit-Beginn: 02:xx gibt es nicht, 03:00 folgt direkt auf 01:59.
assert.strictEqual(model.clockToMs(springDay, '02:30'), null);
assert.strictEqual(model.clockToMs(springDay, '03:00'), model.toMs('2026-03-29T01:00:00.000Z'));
assert.strictEqual(model.clockToMs(springDay, '12:00'), model.toMs('2026-03-29T10:00:00.000Z'));
// Sommerzeit-Ende: eingetippte 02:30 ist die erste, danach gilt Winterzeit.
assert.strictEqual(model.clockToMs(autumnDay, '02:30'), model.toMs('2026-10-25T00:30:00.000Z'));
assert.strictEqual(model.clockToMs(autumnDay, '03:30'), model.toMs('2026-10-25T02:30:00.000Z'));
assert.strictEqual(model.clockToMs(autumnDay, '23:00'), model.toMs('2026-10-25T22:00:00.000Z'));
for (const clock of ['00:00', '06:15', '13:45', '23:59']) {
    assert.strictEqual(model.msToClock(model.clockToMs(normalDay, clock)), clock);
}
// „jetzt“ auf die Minute abgerundet; gestern ist es das Tagesende.
assert.strictEqual(model.latestMs(normalDay, dayRange.start + 10 * H + 59 * 1000), dayRange.start + 10 * H);
assert.strictEqual(model.latestMs(normalDay, dayRange.end + 5 * H), dayRange.end);

// --- Blöcke ändern -------------------------------------------------------------------

const saved = model.activeBlocks({...normalDay, corrections: [
    correction(4, '2026-09-24T06:00:00.000Z', '2026-09-24T07:00:00.000Z', '2026-09-24T07:00:00.000Z'),
    correction(9, '2026-09-24T09:00:00.000Z', null, '2026-09-24T10:00:00.000Z'),
]});
const at = clock => model.clockToMs(normalDay, clock);
let edited = model.createBlock(saved, {status: 'PAUSE', from: at('12:00'), to: at('12:30')}, 'n1');
assert.strictEqual(model.blockState(edited[2]), 'new');
assert.ok(model.needsReason(edited[2]));
edited = model.updateBlock(edited, 'n1', {reason: 'Pause nachgetragen'});
assert.ok(!model.needsReason(edited[2]));

// Gespeicherten Block ändern: geändert, wandert nach oben, wirksames Ende unbekannt bis zur Vorschau.
edited = model.updateBlock(edited, 'c4', {status: 'BIPAU'});
const c4 = edited.find(block => block.key === 'c4');
assert.strictEqual(model.blockState(c4), 'changed');
assert.strictEqual(c4.appliedTo, null);
assert.ok(!model.needsReason(c4), 'der alte Grund ist vorbelegt');
assert.deepStrictEqual(model.orderedBlocks(edited).map(block => block.key), ['c9', 'n1', 'c4']);
// Zurück auf den alten Stand: wieder unverändert, wieder an seinem Platz.
const reverted = model.updateBlock(edited, 'c4', {status: 'ONLINE'});
assert.strictEqual(model.blockState(reverted.find(block => block.key === 'c4')), 'unchanged');
assert.deepStrictEqual(model.orderedBlocks(reverted).map(block => block.key), ['c4', 'c9', 'n1']);
assert.strictEqual(reverted.find(block => block.key === 'c4').appliedTo, model.toMs('2026-09-24T07:00:00.000Z'));

// Entfernen: neue verschwinden, gespeicherte bleiben als entfernt (mit altem Stand) stehen.
edited = model.removeBlock(edited, 'c9');
assert.strictEqual(model.blockState(edited.find(block => block.key === 'c9')), 'removed');
assert.deepStrictEqual(model.changeSummary(edited), {created: 1, changed: 1, removed: 1});
const removedChanged = model.removeBlock(edited, 'c4').find(block => block.key === 'c4');
assert.strictEqual(model.blockState(removedChanged), 'removed');
assert.strictEqual(removedChanged.status, 'ONLINE', 'Entfernen verwirft die Änderung');
assert.strictEqual(model.removeBlock(edited, 'n1').length, 2);
assert.strictEqual(model.blockState(model.restoreBlock(edited, 'c9').find(block => block.key === 'c9')), 'unchanged');

// --- Prüfung vor dem Senden ------------------------------------------------------------

const now = dayRange.start + 10 * H;  // 10:00 Berlin
const newBlock = (values) => model.createBlock([], {status: 'ONLINE', reason: 'x', ...values}, 'n')[0];
assert.strictEqual(model.blockError(newBlock({from: at('08:00'), to: null}), normalDay, now), '');
assert.strictEqual(model.blockError(newBlock({from: at('08:00'), to: at('08:00')}), normalDay, now), 'Ende muss nach dem Beginn liegen.');
assert.strictEqual(model.blockError(newBlock({from: at('09:00'), to: at('10:01')}), normalDay, now), 'Liegt in der Zukunft.');
assert.strictEqual(model.blockError(newBlock({from: at('10:00'), to: null}), normalDay, now), '', 'genau „jetzt“ ist erlaubt');
assert.strictEqual(model.blockError(newBlock({from: at('10:01'), to: null}), normalDay, now), 'Liegt in der Zukunft.');
assert.strictEqual(model.blockError(newBlock({from: at('08:00'), to: dayRange.end + 60 * 1000}), normalDay, dayRange.end + H),
    'Ende liegt nach Mitternacht.');
assert.strictEqual(model.blockError(newBlock({from: dayRange.start - 60 * 1000, to: null}), normalDay, now),
    'Beginn fehlt oder liegt nicht am Tag.');
assert.strictEqual(model.blockError({...newBlock({from: at('08:00'), to: null}), reason: 'x'.repeat(256)}, normalDay, now),
    'Grund höchstens 255 Zeichen.');
// Gespeicherte, unveränderte Blöcke werden nicht erneut geprüft.
assert.strictEqual(model.blockError(saved[1], normalDay, dayRange.start), '');

// --- buildChangeRequest ----------------------------------------------------------------

assert.deepStrictEqual(model.buildChangeRequest(saved), {revoke: [], create: [], createKeys: []});
let request = model.buildChangeRequest(edited);
assert.deepStrictEqual(request, {
    revoke: [4, 9],
    create: [
        {effective_from: '2026-09-24T10:00:00.000Z', effective_to: '2026-09-24T10:30:00.000Z',
         status_group: 'PAUSE', reason: 'Pause nachgetragen'},
        {effective_from: '2026-09-24T06:00:00.000Z', effective_to: '2026-09-24T07:00:00.000Z',
         status_group: 'BIPAU', reason: 'Grund 4'},
    ],
    createKeys: ['n1', 'c4'],
});
// Wechsel ab Zeitpunkt: ohne effective_to; Grund wird getrimmt; kein created_by.
request = model.buildChangeRequest(model.createBlock([], {status: 'ONLINE', from: at('08:00'), to: null, reason: '  Dienstbeginn '}, 'n'));
assert.deepStrictEqual(request.create, [{effective_from: '2026-09-24T06:00:00.000Z', status_group: 'ONLINE', reason: 'Dienstbeginn'}]);
assert.ok(!('created_by' in request.create[0]));
// Nur entfernt: nur revoke.
assert.deepStrictEqual(model.buildChangeRequest(model.removeBlock(saved, 'c4')), {revoke: [4], create: [], createKeys: []});

// Korrekturzeile mit Zuständen.
const stateHtml = timeline.correctionRowHtml(edited, dayRange, {selectedKey: 'n1'});
assert.ok(/tc-block-changed/.test(stateHtml) && /tc-block-removed/.test(stateHtml) && /tc-block-new/.test(stateHtml));
assert.ok(/data-key="n1" role="button" tabindex="0" aria-pressed="true"/.test(stateHtml));
assert.ok(timeline.correctionRowHtml(model.createBlock([], {status: 'ONLINE', from: at('08:00'), to: null}, 'n'), dayRange)
    .includes('tc-block-missing'));

// --- Vorschau und Speichern --------------------------------------------------------

const changeRequest = model.buildChangeRequest(edited);
const withoutReason = model.buildChangeRequest(model.createBlock([], {status: 'ONLINE', from: at('08:00'), to: null}, 'n'));
assert.deepStrictEqual(model.previewBody(withoutReason), {revoke: [], create: [
    {effective_from: '2026-09-24T06:00:00.000Z', status_group: 'ONLINE'}]}, 'Vorschau ohne Grund und ohne revision');
assert.deepStrictEqual(model.saveBody(changeRequest, 'rev-1'),
    {revision: 'rev-1', revoke: changeRequest.revoke, create: changeRequest.create});
assert.ok(!('createKeys' in model.saveBody(changeRequest, 'rev-1')));
assert.strictEqual(model.previewKey(changeRequest),
    model.previewKey(model.buildChangeRequest(model.updateBlock(edited, 'n1', {reason: 'anders'}))), 'Grund ändert die Vorschau nicht');
assert.notStrictEqual(model.previewKey(changeRequest),
    model.previewKey(model.buildChangeRequest(model.updateBlock(edited, 'n1', {status: 'HOME'}))));
assert.strictEqual(model.saveMessage(changeRequest), '2 angelegt · 2 zurückgenommen');
assert.strictEqual(model.saveMessage({revoke: [4], create: []}), '1 zurückgenommen');

assert.ok(model.canSave(edited, normalDay, dayRange.end + H));
assert.ok(!model.canSave(saved, normalDay, dayRange.end + H), 'ohne Änderung nichts zu speichern');
assert.ok(!model.canSave(model.updateBlock(edited, 'n1', {reason: ' '}), normalDay, dayRange.end + H), 'Grund fehlt');
assert.ok(!model.canSave(edited, normalDay, dayRange.start + 11 * H), 'n1 (12:00) läge in der Zukunft');

// Wirksames Ende aus der Vorschau: neue und geänderte über create_index, übrige über id.
const previewDay = {...normalDay, corrections: [
    {...correction(4, '2026-09-24T06:00:00.000Z', '2026-09-24T07:00:00.000Z', null), revoked_at: '2026-09-24T09:00:00.000Z'},
    {...correction(9, '2026-09-24T09:00:00.000Z', null, null), revoked_at: '2026-09-24T09:00:00.000Z'},
    {...correction(null, '2026-09-24T10:00:00.000Z', '2026-09-24T10:30:00.000Z', '2026-09-24T10:30:00.000Z'), create_index: 0},
    {...correction(null, '2026-09-24T06:00:00.000Z', '2026-09-24T07:00:00.000Z', null), create_index: 1},
]};
const previewed = model.withPreview(edited, {view: previewDay, createKeys: changeRequest.createKeys});
const find = (list, key) => list.find(block => block.key === key);
assert.strictEqual(find(previewed, 'n1').appliedTo, model.toMs('2026-09-24T10:30:00.000Z'));
assert.strictEqual(find(previewed, 'c4').appliedTo, null);
assert.strictEqual(find(previewed, 'c4').previewed, true);
assert.strictEqual(find(previewed, 'c9'), find(edited, 'c9'), 'entfernte Blöcke bleiben unverändert');
assert.strictEqual(model.withPreview(edited, null), edited);
const previewRow = timeline.correctionRowHtml(previewed, dayRange);
assert.ok(/data-key="c4"/.test(previewRow) && /tc-block-changed[^"]*tc-block-idle/.test(previewRow), 'laut Vorschau ohne Wirkung');

const editorPreview = timeline.editorHtml(view, previewed, dayRange, {preview: {...view, merged: [
    {start: '2026-09-24T06:00:00.000Z', end: '2026-09-24T10:03:00.000Z', status: 'BIPAU', source: 'correction', correction_id: null, create_index: 1},
]}, previewState: 'preview'});
assert.ok(editorPreview.includes('<span class="tc-row-note">Vorschau</span>'));
assert.ok(editorPreview.includes('tc-seg tc-status-BIPAU'), 'Ergebnis aus der Vorschau');
assert.ok(!editorPreview.includes('tc-pending'));
const editorPending = timeline.editorHtml(view, edited, dayRange, {previewState: 'pending'});
assert.ok(editorPending.includes('tc-pending') && editorPending.includes('Vorschau …'));
assert.ok(timeline.editorHtml(view, edited, dayRange, {previewState: 'stale'}).includes('tc-pending'));
assert.ok(!timeline.editorHtml(view, saved, dayRange, {}).includes('tc-row-note'));

// --- 409 und 422 am Block --------------------------------------------------------

// changeRequest: revoke [4, 9], create [n1, c4].
const inFuture = {detail: {code: 'correction_in_future', message: 'Beginn oder Ende liegt nach jetzt.', loc: ['body', 'create', 1]}};
assert.deepStrictEqual(model.errorTargets(inFuture, changeRequest, edited),
    {code: 'correction_in_future', message: 'Beginn oder Ende liegt nach jetzt.', byBlock: {c4: 'Beginn oder Ende liegt nach jetzt.'}});
const unknownRevoke = {detail: {code: 'revoke_unknown', message: 'Korrektur ist nicht aktiv.', loc: ['body', 'revoke', 1]}};
assert.deepStrictEqual(model.errorTargets(unknownRevoke, changeRequest, edited).byBlock, {c9: 'Korrektur ist nicht aktiv.'});
const schemaError = {detail: [
    {loc: ['body', 'create', 0, 'effective_from'], msg: 'Input should have timezone info', type: 'timezone_aware'},
    {loc: ['body', 'create', 0, 'reason'], msg: 'String should have at most 255 characters', type: 'string_too_long'},
]};
assert.deepStrictEqual(model.errorTargets(schemaError, changeRequest, edited),
    {code: '', message: 'Input should have timezone info · String should have at most 255 characters',
     byBlock: {n1: 'Input should have timezone info'}});
const dayError = {detail: {code: 'day_not_allowed', message: 'Nur heute und gestern.'}};
assert.deepStrictEqual(model.errorTargets(dayError, changeRequest, edited),
    {code: 'day_not_allowed', message: 'Nur heute und gestern.', byBlock: {}});
assert.strictEqual(model.errorCode({detail: 'Not Found'}), '');
assert.strictEqual(model.errorCode(null), '');
assert.deepStrictEqual(model.errorTargets({detail: {code: 'x', message: 'y', loc: ['body', 'create', 7]}}, changeRequest, edited).byBlock, {});

const errorRow = timeline.correctionRowHtml(edited, dayRange, {errors: {c4: 'Beginn oder Ende liegt nach jetzt.'}});
assert.ok(/tc-block-missing[^"]*" data-key="c4"/.test(errorRow));
assert.ok(errorRow.includes('Beginn oder Ende liegt nach jetzt.'), 'Fehler im Tooltip');

// Eigene Änderungen als Text für das Konflikt-Modal, in der Reihenfolge der Korrekturzeile.
assert.deepStrictEqual(model.changeLines(edited), [
    '#9 zurücknehmen: ONLINE ab 11:00',
    'neu: PAUSE 12:00–12:30 · Pause nachgetragen',
    '#4 geändert: BIPAU 08:00–09:00 · Grund 4',
]);
assert.deepStrictEqual(model.changeLines(saved), []);

// --- Direkte Bedienung: Einrasten und Ziehen -----------------------------------------

const M = 60 * 1000;
const t = clock => model.clockToMs(normalDay, clock);
const minuteSnap = {stepMs: M, min: dayRange.start, max: dayRange.end};
assert.strictEqual(model.snapTime(t('08:07') + 29 * 1000, minuteSnap), t('08:07'));
assert.strictEqual(model.snapTime(t('08:07') + 31 * 1000, minuteSnap), t('08:08'));
assert.strictEqual(model.snapTime(dayRange.start - H, minuteSnap), dayRange.start);
assert.strictEqual(model.snapTime(dayRange.end + H, minuteSnap), dayRange.end);
// Magnet-Kante im Umkreis hat Vorrang, die nächste gewinnt.
const magnets = {...minuteSnap, anchors: [t('08:03'), t('08:10')], magnetMs: 4 * M};
assert.strictEqual(model.snapTime(t('08:06'), magnets), t('08:03'));
assert.strictEqual(model.snapTime(t('08:07'), magnets), t('08:10'));
assert.strictEqual(model.snapTime(t('08:20'), magnets), t('08:20'), 'außerhalb des Umkreises gilt das Raster');

const range = {from: t('09:00'), to: t('10:00')};
const open = {from: t('09:00'), to: null};
// Kanten.
assert.deepStrictEqual(model.dragBlock(range, 'start', 0, t('08:30'), minuteSnap), {from: t('08:30'), to: t('10:00')});
assert.deepStrictEqual(model.dragBlock(range, 'start', 0, t('10:30'), minuteSnap), {from: t('09:59'), to: t('10:00')},
    'Beginn bleibt mindestens eine Minute vor dem Ende');
assert.deepStrictEqual(model.dragBlock(range, 'end', 0, t('11:15'), minuteSnap), {from: t('09:00'), to: t('11:15')});
assert.deepStrictEqual(model.dragBlock(range, 'end', 0, t('08:00'), minuteSnap), {from: t('09:00'), to: t('09:01')});
assert.deepStrictEqual(model.dragBlock(open, 'start', 0, t('08:45'), minuteSnap), {from: t('08:45'), to: null});
assert.deepStrictEqual(model.dragBlock(open, 'end', 0, t('09:30'), minuteSnap), {from: t('09:00'), to: t('09:30')},
    'Ziehen an der rechten Kante macht aus dem Wechsel einen Bereich');
// Verschieben: Länge bleibt, im Tag geklammert.
assert.deepStrictEqual(model.dragBlock(range, 'move', 95 * M + 10 * 1000, 0, minuteSnap), {from: t('10:35'), to: t('11:35')});
assert.deepStrictEqual(model.dragBlock(range, 'move', 20 * H, 0, minuteSnap), {from: dayRange.end - H, to: dayRange.end});
assert.deepStrictEqual(model.dragBlock(range, 'move', -20 * H, 0, minuteSnap), {from: dayRange.start, to: dayRange.start + H});
assert.deepStrictEqual(model.dragBlock(open, 'move', -30 * M, 0, minuteSnap), {from: t('08:30'), to: null});
// Verschieben mit Magnet: die Kante, die näher an einer Magnet-Kante liegt, rastet ein.
const moveMagnets = {...minuteSnap, anchors: [t('10:07')], magnetMs: 4 * M};
assert.deepStrictEqual(model.dragBlock(range, 'move', 5 * M, 0, moveMagnets), {from: t('09:07'), to: t('10:07')}, 'Ende rastet ein');
assert.deepStrictEqual(model.dragBlock(range, 'move', 65 * M, 0, moveMagnets), {from: t('10:07'), to: t('11:07')}, 'Beginn rastet ein');
// Zeichnen: in beide Richtungen, mindestens eine Minute.
const drawOrigin = {from: t('12:00'), to: null};
assert.deepStrictEqual(model.dragBlock(drawOrigin, 'draw', 0, t('12:40'), minuteSnap), {from: t('12:00'), to: t('12:40')});
assert.deepStrictEqual(model.dragBlock(drawOrigin, 'draw', 0, t('11:20'), minuteSnap), {from: t('11:20'), to: t('12:00')});
assert.deepStrictEqual(model.dragBlock(drawOrigin, 'draw', 0, t('12:00'), minuteSnap), {from: t('12:00'), to: t('12:01')});

// Griffe an den Blöcken, nicht an entfernten.
const handleRow = timeline.correctionRowHtml(edited, dayRange);
assert.strictEqual((handleRow.match(/data-handle="start"/g) || []).length, 2);
assert.strictEqual((handleRow.match(/data-handle="end"/g) || []).length, 2);

console.log('time_correction_model_checks: ok');
