const assert = require('assert');
const path = require('path');

const viewModel = require(path.join(__dirname, '..', 'app', 'static', 'js', 'task_view_model.js'));

const TODAY = '2026-09-18';

function task(overrides) {
    return Object.assign({
        task_id: 1,
        uiListState: 'open',
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

assert.strictEqual(viewModel.isGroupingActive('none'), false);
assert.strictEqual(viewModel.isGroupingActive('person'), true);
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
    task({task_id: 12, target_user_id: 10, target_date: '2026-08-01', uiListState: 'blocked'}),
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
assert.strictEqual(personGroups[0].blockedCount, 1, 'Blockierte Tasks werden pro Gruppe gezaehlt');
assert.strictEqual(
    personGroups[0].face.task_id,
    11,
    'Die Schauseite ueberspringt blockierte Aufgaben'
);
assert.strictEqual(
    viewModel.pickGroupFace([task({task_id: 30, uiListState: 'blocked'})]).task_id,
    30,
    'Besteht die Gruppe nur aus blockierten Aufgaben, zeigt der Stapel eben diese'
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
    'Onboarding · Musterfrau, Maria'
);
assert.strictEqual(
    viewModel.buildGroups(
        [task({task_id: 23, process_name: null, process_type: 'ONBOARDING', process_id: 700})],
        'process',
        {todayKey: TODAY, processLabels: {ONBOARDING: 'Onboarding'}}
    )[0].label,
    'Onboarding · #700 · Musterfrau, Maria',
    'Ohne Prozessnamen bleibt Typ + ID als Kennzeichnung stehen'
);
assert.strictEqual(
    viewModel.buildGroups(
        [task({task_id: 24, process_name: 'Offboarding', target_user_name: null})],
        'process',
        {todayKey: TODAY}
    )[0].label,
    'Offboarding',
    'Ohne Personennamen bleibt es beim reinen Prozesslabel'
);

// --- Listenreihenfolge -----------------------------------------------------

// In Listen stehen blockierte und nachgelagerte Aufgaben unten, sonst gilt die
// normale Sortierung.
const listTasks = [
    task({task_id: 61, uiListState: 'blocked', target_date: '2026-01-01'}),
    task({task_id: 62, provisioning_requirement: 'DEFERRED', target_date: '2026-01-02'}),
    task({task_id: 63, target_date: '2026-12-01'}),
    task({task_id: 64, target_date: '2026-08-01'}),
];
assert.deepStrictEqual(
    viewModel.sortTasksForList(listTasks, TODAY).map(entry => entry.task_id),
    [64, 63, 62, 61]
);
assert.deepStrictEqual(
    viewModel.sortTasks(listTasks, TODAY).map(entry => entry.task_id),
    [61, 62, 64, 63],
    'Die Streifensortierung bleibt rein am Stichtag'
);

// --- Facetten (Include/Exclude) --------------------------------------------

let facet = viewModel.createFacet();
facet = viewModel.toggleFacetValue(facet, 'INTERNAL', 'include', true);
facet = viewModel.toggleFacetValue(facet, 'BOT', 'include', true);
assert.deepStrictEqual(facet, {include: ['INTERNAL', 'BOT'], exclude: []}, 'Mehrere Werte parallel einschliessbar');

facet = viewModel.toggleFacetValue(facet, 'INTERNAL', 'exclude', true);
assert.deepStrictEqual(
    facet,
    {include: ['BOT'], exclude: ['INTERNAL']},
    'Ausschliessen entfernt denselben Wert aus dem Einschluss'
);

assert.strictEqual(viewModel.matchesFacet('INTERNAL', facet), false, 'Exclude schlaegt Include');
assert.strictEqual(viewModel.matchesFacet('BOT', facet), true);
assert.strictEqual(viewModel.matchesFacet('EXTERNAL', facet), false, 'Bei aktivem Include faellt der Rest raus');

const excludeOnly = viewModel.toggleFacetValue(viewModel.createFacet(), 'EVENT', 'exclude', true);
assert.strictEqual(viewModel.matchesFacet('EXTERNAL', excludeOnly), true, 'Reines Exclude laesst alles andere durch');
assert.strictEqual(viewModel.isFacetActive(viewModel.createFacet()), false);
assert.strictEqual(viewModel.isFacetActive(excludeOnly), true);

facet = viewModel.toggleFacetValue(facet, 'INTERNAL', 'exclude', false);
assert.deepStrictEqual(facet, {include: ['BOT'], exclude: []}, 'Abwaehlen entfernt nur den eigenen Modus');

assert.strictEqual(
    viewModel.matchesFacets(
        task({handling_type: 'BOT', task_type: 'REVOCATION'}),
        {handling: {include: ['BOT'], exclude: []}, taskType: {include: [], exclude: ['REVOCATION']}},
        {handling: entry => entry.handling_type, taskType: entry => entry.task_type}
    ),
    false,
    'Facetten werden UND-verknuepft'
);

// --- Persistierter Zustand -------------------------------------------------

const restored = viewModel.normalizeViewState({
    search: 'maria',
    filters: {status: {include: ['OPEN'], exclude: 'kaputt'}, unbekannt: {include: ['x']}},
    visibility: {showBlocked: true, showDeferred: 'ja'},
    grouping: {dimension: 'person'},
});
assert.strictEqual(restored.search, 'maria');
assert.deepStrictEqual(restored.filters.status, {include: ['OPEN'], exclude: []}, 'Kaputte Facettenteile fallen weg');
assert.deepStrictEqual(restored.filters.backlog, {include: [], exclude: []});
assert.strictEqual(restored.filters.unbekannt, undefined, 'Unbekannte Facetten werden verworfen');
assert.strictEqual(restored.visibility.showBlocked, true);
assert.strictEqual(restored.visibility.showDeferred, false, 'Nicht-Boolean bleibt beim Default');
assert.strictEqual(restored.grouping.dimension, 'person');

assert.deepStrictEqual(
    viewModel.normalizeViewState(null),
    viewModel.createDefaultViewState(),
    'Fehlender Zustand ergibt den Default'
);
assert.strictEqual(
    viewModel.normalizeViewState({grouping: {dimension: 'sternzeichen'}}).grouping.dimension,
    'none',
    'Unbekannte Dimension faellt auf none zurueck'
);

assert.strictEqual(viewModel.hasActiveFilters(viewModel.createDefaultViewState()), false);
assert.strictEqual(viewModel.hasNonDefaultView(viewModel.createDefaultViewState()), false);
assert.strictEqual(
    viewModel.hasActiveFilters(viewModel.normalizeViewState({grouping: {dimension: 'person'}})),
    false,
    'Gruppierung ist kein Filter'
);
assert.strictEqual(
    viewModel.hasNonDefaultView(viewModel.normalizeViewState({grouping: {dimension: 'person'}})),
    true,
    'Gruppierung macht die Ansicht aber zuruecksetzbar'
);
assert.strictEqual(
    viewModel.hasNonDefaultView(viewModel.normalizeViewState({visibility: {showDeferred: true}})),
    true
);

// --- Tabs im Gruppen-Modal -------------------------------------------------

assert.deepStrictEqual(
    viewModel.resolveGroupModalTab({open: 3, mine: 2}, 'open'),
    {tab: 'open', close: false}
);
assert.deepStrictEqual(
    viewModel.resolveGroupModalTab({open: 0, mine: 4}, 'open'),
    {tab: 'mine', close: false},
    'Leerer Tab wechselt auf den gefuellten'
);
assert.deepStrictEqual(
    viewModel.resolveGroupModalTab({open: 5, mine: 0}, 'mine'),
    {tab: 'open', close: false}
);
assert.deepStrictEqual(
    viewModel.resolveGroupModalTab({open: 0, mine: 0}, 'mine'),
    {tab: 'mine', close: true},
    'Sind beide Tabs leer, schliesst das Modal'
);

// --- Task-Praedikate -------------------------------------------------------

assert.strictEqual(viewModel.isBlockedTask(task({uiListState: 'blocked'})), true);
assert.strictEqual(viewModel.isBlockedTask(task({})), false);
assert.strictEqual(viewModel.isDeferredTask(task({provisioning_requirement: 'deferred'})), true);
assert.strictEqual(viewModel.isDeferredTask(task({})), false, 'Fehlendes Feld gilt als REQUIRED');

console.log('task_view_model checks passed');
