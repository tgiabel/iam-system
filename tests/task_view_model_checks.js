const assert = require('assert');
const path = require('path');

const viewModel = require(path.join(__dirname, '..', 'app', 'static', 'js', 'task_view_model.js'));

const TODAY = '2026-09-18';

function task(overrides) {
    return Object.assign({
        task_id: 1,
        status: 'OPEN',
        task_type: 'ASSIGNMENT',
        handling_type: 'INTERNAL',
        target_user_id: 10,
        target_user_name: 'Musterfrau, Maria',
        system_id: 5,
        system_name: 'Microsoft',
        process_id: 700,
        process_name: 'Onboarding Maria',
        backlog_identifier: 'IT',
        target_date: null,
    }, overrides);
}

// --- Gruppenschluessel ------------------------------------------------------

assert.deepStrictEqual(
    viewModel.getGroupKey(task({}), 'person'),
    {key: 'id:10', isUngrouped: false},
    'Person gruppiert ueber target_user_id'
);

assert.deepStrictEqual(
    viewModel.getGroupKey(task({system_id: null, system_name: '  Microsoft  '}), 'system'),
    {key: 'name:microsoft', isUngrouped: false},
    'Fehlende system_id faellt auf den normalisierten Namen zurueck'
);

assert.deepStrictEqual(
    viewModel.getGroupKey(task({process_id: null, process_name: null}), 'process'),
    {key: viewModel.UNGROUPED_KEY, isUngrouped: true},
    'Ohne process_id und ohne Namen ist der Task nicht gruppierbar'
);

assert.deepStrictEqual(
    viewModel.getGroupKey(task({backlog_identifier: ''}), 'backlog'),
    {key: viewModel.UNGROUPED_KEY, isUngrouped: true},
    'Leerer Backlog-Identifier zaehlt als nicht gesetzt'
);

assert.strictEqual(viewModel.getGroupDimension('gibtsnicht').id, 'none', 'Unbekannte Dimension faellt auf none');

// --- Sortierung ------------------------------------------------------------

const overdueOld = task({task_id: 1, target_date: '2026-08-01'});
const overdueRecent = task({task_id: 2, target_date: '2026-09-17'});
const dueToday = task({task_id: 3, target_date: '2026-09-18'});
const scheduled = task({task_id: 4, target_date: '2026-12-24'});
const undatedLow = task({task_id: 5, target_date: null});
const undatedHigh = task({task_id: 6, target_date: ''});

const sorted = viewModel.sortTasks(
    [undatedHigh, scheduled, dueToday, undatedLow, overdueRecent, overdueOld],
    TODAY
);
assert.deepStrictEqual(
    sorted.map(entry => entry.task_id),
    [1, 2, 3, 4, 5, 6],
    'Ueberfaellig (aeltester zuerst) vor terminiert vor ohne Stichtag, Tiebreak Task-ID'
);

assert.strictEqual(
    viewModel.compareTasks(task({task_id: 20, target_date: '2026-09-18T14:00:00+02:00'}), dueToday, TODAY) > 0,
    true,
    'Gleicher Stichtag: kleinere Task-ID zuerst, ISO-Zeitstempel werden auf den Tag reduziert'
);

// --- Gruppen bauen ---------------------------------------------------------

const groupTasks = [
    task({task_id: 11, target_user_id: 10, target_date: '2026-12-01'}),
    task({task_id: 12, target_user_id: 10, target_date: '2026-08-01'}),
    task({task_id: 13, target_user_id: 99, target_user_name: 'Beispiel, Bernd', target_date: '2026-09-30'}),
    task({task_id: 14, target_user_id: null, target_user_name: null, target_date: '2026-07-01'}),
];

const personGroups = viewModel.buildGroups(groupTasks, 'person', {todayKey: TODAY});
assert.deepStrictEqual(
    personGroups.map(group => group.key),
    ['id:10', 'id:99', viewModel.UNGROUPED_KEY],
    'Gruppen nach Dringlichkeit, der Ohne-Block immer zuletzt'
);
assert.strictEqual(personGroups[0].label, 'Musterfrau, Maria');
assert.strictEqual(personGroups[2].label, 'Ohne Person');
assert.deepStrictEqual(
    personGroups[0].tasks.map(entry => entry.task_id),
    [12, 11],
    'Innerhalb der Gruppe gilt dieselbe Sortierung'
);

assert.deepStrictEqual(viewModel.buildGroups(groupTasks, 'none', {todayKey: TODAY}), []);

const backlogGroups = viewModel.buildGroups(
    [task({task_id: 21, backlog_identifier: 'IT'})],
    'backlog',
    {todayKey: TODAY, backlogLookup: {IT: {name: 'IT-Betrieb'}}}
);
assert.strictEqual(backlogGroups[0].label, 'IT-Betrieb', 'Backlog-Label kommt aus dem Lookup');

// Ein Prozess laeuft fuer genau eine Person, die gehoert ins Gruppenlabel.
assert.strictEqual(
    viewModel.buildGroups([task({task_id: 22, process_name: 'Onboarding'})], 'process', {todayKey: TODAY})[0].label,
    'Onboarding · Musterfrau, Maria · #700',
    'Prozess und Person zuerst, die ID am Ende'
);
assert.strictEqual(
    viewModel.buildGroups(
        [task({task_id: 23, process_name: null, process_type: 'ONBOARDING', process_id: 700})],
        'process',
        {todayKey: TODAY, processLabels: {ONBOARDING: 'Onboarding'}}
    )[0].label,
    'Onboarding · Musterfrau, Maria · #700',
    'Ohne Prozessnamen stehen Typ, Person und zuletzt die ID'
);
assert.strictEqual(
    viewModel.buildGroups(
        [task({task_id: 24, process_name: 'Offboarding', target_user_name: null})],
        'process',
        {todayKey: TODAY}
    )[0].label,
    'Offboarding · #700',
    'Ohne Personennamen bleiben Prozess und ID'
);

// --- Rueckmeldung nach dem Bot-Aufruf --------------------------------------

assert.match(viewModel.botDispatchFeedback({status: 'success'}).message, /später im Verlauf/, 'Alte SD-API ohne task_completed');
assert.deepStrictEqual(
    viewModel.botDispatchFeedback({status: 'success', task_completed: true, completion_error: null}),
    {category: 'success', message: 'Integration erfolgreich, Aufgabe abgeschlossen.'},
);
assert.deepStrictEqual(
    viewModel.botDispatchFeedback({status: 'success', task_completed: false, completion_error: 'Integration erfolgreich, Task nicht abgeschlossen: Kennung vergeben'}),
    {category: 'failure', message: 'Integration erfolgreich, Task nicht abgeschlossen: Kennung vergeben. Bitte von Hand abschließen.'},
);
assert.strictEqual(viewModel.botDispatchFeedback({status: 'error', task_completed: false, completion_error: null}).category, 'failure');

console.log('task_view_model checks passed');
