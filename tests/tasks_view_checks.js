const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Minimales DOM: nur so viel, wie das Rendering und das Gruppen-Modal anfassen.
class Element {
    constructor(id = '') {
        this.id = id;
        this.dataset = {};
        this.attributes = {};
        this.className = '';
        this.innerHTML = '';
        this.textContent = '';
        this.value = '';
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.classes = new Set();
        this.classList = {
            add: name => this.classes.add(name),
            remove: name => this.classes.delete(name),
            contains: name => this.classes.has(name),
            toggle: (name, force) => {
                const shouldAdd = force === undefined ? !this.classes.has(name) : force;
                if (shouldAdd) this.classes.add(name); else this.classes.delete(name);
                return shouldAdd;
            },
        };
    }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener() {}
    contains() { return false; }
    querySelectorAll() { return []; }
}

const elements = new Map();
const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
};

const tabs = ['open', 'mine'].map(name => {
    const tab = new Element(`task-group-tab-${name}`);
    tab.dataset.groupTab = name;
    return tab;
});

const store = new Map();
const loggedErrors = [];
const context = vm.createContext({
    console: Object.assign(Object.create(console), {error: (...args) => loggedErrors.push(args)}),
    Intl,
    Date,
    JSON,
    Set,
    Map,
    Number,
    String,
    Object,
    Array,
    Boolean,
    HTMLInputElement: class {},
    showFlash() {},
    localStorage: {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
    },
    document: {
        addEventListener() {},
        getElementById: id => element(id),
        querySelector: () => null,
        querySelectorAll: selector => (selector.includes('data-group-tab') ? tabs : []),
        body: new Element('body'),
    },
});
context.window = context;
context.globalThis = context;

const load = file => vm.runInContext(fs.readFileSync(file, 'utf8'), context);
load('app/static/js/sofa_contract.js');
load('app/static/js/task_view_model.js');
vm.runInContext(fs.readFileSync('app/static/js/tasks.js', 'utf8') + `
    globalThis.tasksPage = {
        state: taskViewState, filterBar: taskFilterBar, groupModal: taskGroupModal,
        renderStrip: renderTaskStripContent, filterBuckets: filterTaskBuckets,
        buildOptions: buildTaskFilterOptions, loadView: loadPersistedTaskView,
        saveView: savePersistedTaskView, vm: taskVM,
    };
`, context);

const page = context.tasksPage;

function task(overrides) {
    return Object.assign({
        task_id: 1, uiListState: 'open', status: 'OPEN', task_type: 'ASSIGNMENT',
        handling_type: 'INTERNAL', target_user_id: 10, target_user_name: 'Musterfrau, Maria',
        system_id: 5, system_name: 'Microsoft', process_id: 700, process_name: 'Onboarding Maria',
        resource_name: 'Postfach', backlog_identifier: 'IT', target_date: null,
    }, overrides);
}

function setBuckets(buckets) {
    page.state.buckets = Object.assign({open: [], blocked: [], mine: []}, buckets);
    context.window.taskIndex = {};
    [...page.state.buckets.open, ...page.state.buckets.blocked, ...page.state.buckets.mine]
        .forEach(entry => { context.window.taskIndex[String(entry.task_id)] = entry; });
}

function occurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}

// --- Streifen ohne Gruppierung ---------------------------------------------

page.state.grouping.dimension = 'none';
const flat = page.renderStrip(
    [task({task_id: 2, target_date: '2026-12-01'}), task({task_id: 3, target_date: '2026-01-01'})],
    'open',
    'leer'
);
assert.strictEqual(occurrences(flat, 'class="task-tile task-card'), 2);
assert(flat.indexOf('data-task-id="3"') < flat.indexOf('data-task-id="2"'),
    'Ohne Gruppierung gilt die Stichtagssortierung');
assert.strictEqual(page.renderStrip([], 'open', 'Keine offenen Aufgaben').includes('Keine offenen Aufgaben'), true);

// --- Stapel ----------------------------------------------------------------

page.state.grouping.dimension = 'person';
const grouped = page.renderStrip([
    task({task_id: 11, target_user_id: 10, target_date: '2026-12-01'}),
    task({task_id: 12, target_user_id: 10, target_date: '2026-01-01', uiListState: 'blocked'}),
    task({task_id: 13, target_user_id: 10, target_date: '2026-12-02'}),
    task({task_id: 14, target_user_id: 99, target_user_name: 'Beispiel, Bernd'}),
], 'open', 'leer');

assert.strictEqual(occurrences(grouped, 'class="task-stack"'), 1, 'Nur die Dreiergruppe wird gestapelt');
assert.strictEqual(occurrences(grouped, 'class="task-stack-sheet'), 2, 'Hoechstens zwei Blaetter hinter der Karte');
assert(grouped.includes('data-group-key="id:10"'));
assert(grouped.includes('data-group-bucket="open"'));
assert(grouped.includes('>3</span>'), 'Das Label zeigt die Gruppengroesse');
assert(grouped.includes('1 blockiert'), 'Blockierte Aufgaben werden am Stapel ausgewiesen');
assert(grouped.includes('data-task-id="14"'), 'Einzelne Aufgaben bleiben eine normale Karte');
assert.strictEqual(
    occurrences(grouped, 'data-task-id="12"'), 0,
    'Die blockierte Aufgabe ist nicht die Schauseite des Stapels'
);

const withoutPerson = page.renderStrip([
    task({task_id: 20, target_user_id: null, target_user_name: null}),
    task({task_id: 21, target_user_id: null, target_user_name: null}),
], 'open', 'leer');
assert(withoutPerson.includes('Ohne Person'), 'Nicht gruppierbare Aufgaben bekommen einen eigenen Block');

// --- Filter ----------------------------------------------------------------

setBuckets({
    open: [task({task_id: 31, handling_type: 'INTERNAL'}), task({task_id: 32, handling_type: 'BOT'})],
    blocked: [task({task_id: 33, uiListState: 'blocked'})],
    mine: [task({task_id: 34, uiListState: 'mine', status: 'IN_PROGRESS'})],
});
page.buildOptions();

page.state.filters.handling = page.vm.toggleFacetValue(page.state.filters.handling, 'BOT', 'exclude', true);
let filtered = page.filterBuckets();
assert.deepStrictEqual(filtered.open.map(entry => entry.task_id), [31], 'Exclude blendet die Bot-Aufgabe aus');
assert.deepStrictEqual(filtered.blocked, [], 'Blockierte bleiben ohne Sichtbarkeits-Haken aus');

page.state.visibility.showBlocked = true;
filtered = page.filterBuckets();
assert.deepStrictEqual(filtered.blocked.map(entry => entry.task_id), [33]);

// collectTags() baut sein Array im vm-Realm - fuer deepStrictEqual hier neu einsammeln.
const tags = Array.from(page.filterBar.collectTags());
assert.deepStrictEqual(
    tags.map(tag => tag.label),
    ['Kein Automatisiert', 'Blockierte sichtbar'],
    'Exclude- und Sichtbarkeits-Badges tragen sprechende Labels'
);

// --- Persistenz ------------------------------------------------------------

page.state.search = 'maria';
page.saveView();
page.state.search = '';
page.state.filters.handling = page.vm.createFacet();
page.state.visibility.showBlocked = false;
page.state.grouping.dimension = 'none';
page.loadView();
assert.strictEqual(page.state.search, 'maria');
assert.deepStrictEqual(Array.from(page.state.filters.handling.exclude), ['BOT']);
assert.strictEqual(page.state.visibility.showBlocked, true);
assert.strictEqual(page.state.grouping.dimension, 'person');

store.set('sofaTasksView', '{kein json');
page.loadView();
assert.strictEqual(page.state.search, 'maria', 'Ein kaputter Eintrag laesst den Zustand unveraendert');
assert.strictEqual(loggedErrors.length, 1, 'Der kaputte Eintrag wird genau einmal gemeldet');

// --- Gruppen-Modal ---------------------------------------------------------

page.state.grouping.dimension = 'person';
setBuckets({
    open: [task({task_id: 41, target_user_id: 10, task_type: 'REVOCATION'}),
           task({task_id: 42, target_user_id: 10})],
    blocked: [task({task_id: 43, target_user_id: 10, uiListState: 'blocked'})],
    mine: [task({task_id: 44, target_user_id: 10, uiListState: 'mine', status: 'IN_PROGRESS'}),
           task({task_id: 45, target_user_id: 99, uiListState: 'mine', status: 'IN_PROGRESS'})],
});

const modal = page.groupModal;
modal.open('id:10', 'open');
assert.strictEqual(element('task-group-overlay').classList.contains('active'), true);
assert.strictEqual(element('task-group-title').textContent, 'Musterfrau, Maria');
assert.strictEqual(element('task-group-count-open').textContent, '3', 'Blockierte zaehlen im Offen-Tab mit');
assert.strictEqual(element('task-group-count-mine').textContent, '1', 'Fremde Aufgaben bleiben draussen');
assert.strictEqual(occurrences(element('task-group-list').innerHTML, 'class="task-group-row '), 3);

const rowMarkup = element('task-group-list').innerHTML;
assert(rowMarkup.includes('task-group-row is-tone-primary'), 'Zuweisungen sind blau');
assert(rowMarkup.includes('task-group-row is-tone-error'), 'Entzuege sind rot');
assert(rowMarkup.includes('task-group-row is-tone-neutral'), 'Blockierte sind neutral');
assert.strictEqual(occurrences(rowMarkup, 'task-group-row::before'), 0);
assert(
    rowMarkup.indexOf('data-task-id="43"') > rowMarkup.indexOf('data-task-id="42"'),
    'Blockierte Aufgaben stehen in der Modal-Liste unten'
);

modal.state.search = 'nichts das passt';
modal.render();
assert(element('task-group-list').innerHTML.includes('Keine Aufgaben für diese Suche'));
modal.state.search = '';

modal.toggleSelection(41, true);
modal.toggleSelection(42, true);
assert.strictEqual(element('task-group-bulk-bar').hidden, false);
assert.strictEqual(element('task-group-selection-count').textContent, '2 ausgewählt');
assert.strictEqual(element('task-group-bulk-action').textContent, 'Übernehmen');

modal.toggleSelectAll(true);
assert.strictEqual(element('task-group-selection-count').textContent, '3 ausgewählt');

// Nach dem Uebernehmen sind die offenen Aufgaben weg - das Modal springt auf den
// gefuellten Tab und vergisst die Auswahl.
setBuckets({
    open: [],
    blocked: [],
    mine: [task({task_id: 41, target_user_id: 10, uiListState: 'mine', status: 'IN_PROGRESS'}),
           task({task_id: 44, target_user_id: 10, uiListState: 'mine', status: 'IN_PROGRESS'})],
});
modal.render();
assert.strictEqual(modal.state.tab, 'mine', 'Leerer Tab wechselt automatisch');
assert.strictEqual(modal.state.selection.size, 0, 'Verschwundene Aufgaben bleiben nicht ausgewaehlt');
assert.strictEqual(element('task-group-bulk-action').textContent, 'Freigeben');
assert.strictEqual(tabs[0].disabled, true, 'Der leere Tab ist nicht waehlbar');
assert.strictEqual(tabs[1].attributes['aria-selected'], 'true');

// Ist die Gruppe komplett leer, schliesst das Modal.
setBuckets({open: [], blocked: [], mine: []});
modal.render();
assert.strictEqual(element('task-group-overlay').classList.contains('active'), false);

// Wer die Gruppierung umstellt, meint nicht mehr diese Gruppe.
setBuckets({open: [task({task_id: 51, target_user_id: 10})], blocked: [], mine: []});
modal.open('id:10', 'open');
assert.strictEqual(element('task-group-overlay').classList.contains('active'), true);
page.state.grouping.dimension = 'system';
modal.render();
assert.strictEqual(element('task-group-overlay').classList.contains('active'), false);

console.log('tasks_view checks passed');
