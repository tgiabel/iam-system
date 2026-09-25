const assert = require('assert');
const path = require('path');

const picker = require(path.join(__dirname, '..', 'app', 'static', 'js', 'day_picker.js'));
const model = require(path.join(__dirname, '..', 'app', 'static', 'js', 'reports', 'presence_report_model.js'));

// --- Datumswahl ---------------------------------------------------------------

assert.strictEqual(picker.dayLabel('2026-09-25', 0), 'Heute · Fr 25.09.');
assert.strictEqual(picker.dayLabel('2026-09-24', 1), 'Gestern · Do 24.09.');
assert.strictEqual(picker.dayLabel('2026-10-25', -1), 'So 25.10.');
assert.ok(picker.isPickableDay('2026-09-25', '2026-09-25', '2025-09-26'));
assert.ok(picker.isPickableDay('2025-09-26', '2026-09-25', '2025-09-26'), 'frühester Tag gehört dazu');
assert.ok(!picker.isPickableDay('2025-09-25', '2026-09-25', '2025-09-26'), 'nichts vor dem frühesten Tag');
assert.ok(!picker.isPickableDay('2026-09-26', '2026-09-25', null), 'nichts nach heute');
assert.ok(picker.isPickableDay('2020-01-01', '2026-09-25', null), 'ohne frühesten Tag keine Untergrenze');
assert.ok(!picker.isPickableDay('2026-02-30', '2026-09-25', null) && !picker.isPickableDay('gestern', '2026-09-25', null));
assert.ok(!picker.isPickableDay('2026-09-25', null, null), 'ohne heute nichts');
assert.strictEqual(picker.shiftDay('2026-09-24', 1, '2026-09-25', null), '2026-09-25');
assert.strictEqual(picker.shiftDay('2026-09-25', 1, '2026-09-25', null), null);
assert.strictEqual(picker.shiftDay('2025-09-26', -1, '2026-09-25', '2025-09-26'), null);
assert.strictEqual(picker.shiftDay('2026-03-01', -1, '2026-09-25', null), '2026-02-28');

// --- Formate ------------------------------------------------------------------

assert.strictEqual(model.formatDuration(0), '0:00:00');
assert.strictEqual(model.formatDuration(3909), '1:05:09');
assert.strictEqual(model.formatDuration(90000), '25:00:00', '25-Stunden-Tag');
assert.strictEqual(model.formatSpan(42), '42 s');
assert.strictEqual(model.formatSpan(18 * 60 + 5), '18 min');
assert.strictEqual(model.formatSpan(7 * 3600 + 31 * 60), '7 h 31 min');
assert.strictEqual(model.formatSpan(3600 + 5 * 60), '1 h 05 min');
// Berliner Zeit, Sommer- und Winterzeit; Datum nur außerhalb des Tages
assert.strictEqual(model.formatMoment('2026-09-21T06:07:08.000Z', '2026-09-21'), '08:07:08');
assert.strictEqual(model.formatMoment('2026-09-20T18:00:00.000Z', '2026-09-21'), '20.09. 20:00:00');
assert.strictEqual(model.formatMoment('2026-10-25T23:30:00.000Z', '2026-10-26'), '00:30:00');
assert.strictEqual(model.formatMoment(null, '2026-09-21'), null);

// --- URL ----------------------------------------------------------------------

assert.deepStrictEqual(model.readUrl('?day=2026-09-20&source=opcyc'), {day: '2026-09-20', source: 'opcyc'});
assert.deepStrictEqual(model.readUrl('?day=gestern&source=x'), {day: null, source: 'genesys'});
assert.deepStrictEqual(model.readUrl(''), {day: null, source: 'genesys'});
assert.strictEqual(model.writeUrl('2026-09-25', '2026-09-25', 'genesys'), '');
assert.strictEqual(model.writeUrl('2026-09-20', '2026-09-25', 'opcyc'), '?day=2026-09-20&source=opcyc');
assert.strictEqual(model.exportUrl('2026-09-20', 'opcyc'), '/api/reporting/presence/export?day=2026-09-20&source=opcyc');

// --- Zeilen -------------------------------------------------------------------

const users = [
    {pseudonym: 'MA-BBBBB', logged_seconds: 100, statuses: {q: {count: 3, seconds: 50}}},
    {pseudonym: 'MA-AAAAA', logged_seconds: 300, statuses: {q: {count: 1, seconds: 50}}},
    {pseudonym: 'MA-CCCCC', logged_seconds: 200, statuses: {}},
];
const order = (list) => list.map((user) => user.pseudonym);
assert.deepStrictEqual(order(model.rows(users)), ['MA-AAAAA', 'MA-CCCCC', 'MA-BBBBB'], 'Logzeit absteigend');
assert.deepStrictEqual(order(model.rows(users, {sortKey: 'q'})), ['MA-BBBBB', 'MA-AAAAA', 'MA-CCCCC'],
    'Dauer, dann Anzahl; fehlender Status zählt 0');
assert.deepStrictEqual(order(model.rows(users, {sortKey: 'name', sortDir: 'asc', names: {'MA-CCCCC': 'Anna'}})),
    ['MA-CCCCC', 'MA-AAAAA', 'MA-BBBBB'], 'aufgedeckte Namen sortieren mit');
assert.deepStrictEqual(order(model.rows(users, {query: 'bbb'})), ['MA-BBBBB']);
assert.deepStrictEqual(order(model.rows(users, {query: 'ann', names: {'MA-CCCCC': 'Anna'}})), ['MA-CCCCC']);
assert.deepStrictEqual(order(users), ['MA-BBBBB', 'MA-AAAAA', 'MA-CCCCC'], 'Eingabe bleibt unverändert');
assert.deepStrictEqual(model.nextSort({sortKey: 'logged', sortDir: 'desc'}, 'logged'), {sortKey: 'logged', sortDir: 'asc'});
assert.deepStrictEqual(model.nextSort({sortKey: 'logged', sortDir: 'desc'}, 'q'), {sortKey: 'q', sortDir: 'desc'});
assert.deepStrictEqual(model.nextSort({sortKey: 'q', sortDir: 'desc'}, 'name'), {sortKey: 'name', sortDir: 'asc'});
assert.deepStrictEqual(model.visibleStatuses([{key: 'a'}, {key: 'b'}], ['a']), [{key: 'b'}]);

console.log('presence report model checks ok');
