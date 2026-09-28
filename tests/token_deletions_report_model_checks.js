const assert = require('assert');
const path = require('path');

const model = require(path.join(__dirname, '..', 'app', 'static', 'js', 'reports',
    'token_deletions_report_model.js'));

assert.deepStrictEqual(model.readUrl('?year=2025&week_start=2026-09-21'),
    {year: 2025, weekStart: '2026-09-21'});
assert.deepStrictEqual(model.readUrl('?year=x&week_start=2026-09-22'), {year: null, weekStart: null});
assert.strictEqual(model.writeUrl(2026, '2026-09-28', '2026-09-28'), '');
assert.strictEqual(model.writeUrl(2025, '2026-09-21', '2026-09-28'),
    '?year=2025&week_start=2026-09-21');

assert.strictEqual(model.addDays('2026-02-28', 1), '2026-03-01');
assert.strictEqual(model.addDays('2024-02-28', 1), '2024-02-29');
assert.strictEqual(model.mondayFor('2026-01-01'), '2025-12-29');
assert.deepStrictEqual(model.isoWeek('2025-12-29'), {year: 2026, week: 1});

assert.strictEqual(model.shiftYear(2026, -1, '2025-09-29', '2026-09-28'), 2025);
assert.strictEqual(model.shiftYear(2025, -1, '2025-09-29', '2026-09-28'), null);
assert.strictEqual(model.shiftYear(2026, 1, '2025-09-29', '2026-09-28'), null);
assert.strictEqual(model.shiftWeek('2026-09-28', -1, '2025-09-29', '2026-09-28'), '2026-09-21');
assert.strictEqual(model.shiftWeek('2026-09-28', 1, '2025-09-29', '2026-09-28'), null);
assert.strictEqual(model.shiftWeek('2025-09-29', -1, '2025-09-29', '2026-09-28'), null);

assert.strictEqual(model.formatCount(5124), '5.124');
assert.deepStrictEqual(model.formatDay('2026-09-28'), {weekday: 'Montag', date: '28.09.'});
assert.strictEqual(model.formatWeek('2026-09-28', '2026-10-04', 40), 'KW 40 · 28.09.–04.10.');
assert.strictEqual(model.isOutsideMonth(2025, 8, '2025-09-29', '2026-09-28'), true);
assert.strictEqual(model.isOutsideMonth(2025, 9, '2025-09-29', '2026-09-28'), false);
assert.strictEqual(model.isOutsideMonth(2026, 10, '2025-09-29', '2026-09-28'), true);

console.log('token deletions report model checks ok');
