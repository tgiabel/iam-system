const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Minimal DOM for the real form renderer and its delegated input handler.
class Element {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.className = '';
        this.hidden = false;
        this.value = '';
        this.classList = {add: name => { this.className += ` ${name}`; }};
    }
    set innerHTML(html) {
        this.children = [];
        if (html.includes('<label')) this.children.push(new Element('label'));
    }
    appendChild(child) { this.children.push(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(selector) {
        const attribute = selector.match(/^\[data-(account-hint|modal-field)-index="(\d+)"\]$/);
        const key = attribute?.[1] === 'account-hint' ? 'accountHintIndex' : 'modalFieldIndex';
        for (const child of this.children) {
            if ((selector === 'label' && child.tagName === 'label')
                || (attribute && child.dataset[key] === attribute[2])) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
}

const context = vm.createContext({
    document: {createElement: tag => new Element(tag), addEventListener() {}},
    showFlash() {}, console, Intl, Date,
});
vm.runInContext(fs.readFileSync('app/static/js/tools/request_templates.js', 'utf8') + `
    globalThis.form = {state: requestTemplateState, dom: requestTemplateDom,
        schema: requestTemplateSchemaUtils, formatters: requestTemplateFormatters,
        ui: requestTemplateUi, handlers: requestTemplateHandlers, api: requestTemplateApi};
`, context);
const {state, dom, schema, formatters, ui, handlers, api} = context.form;
const plain = value => JSON.parse(JSON.stringify(value));
const archivedField = (key, value, timestamp = '2026-09-16T17:38:07+02:00') => ({
    key, label: key, type: 'text', required: true, value,
    account_archived: true, account_archived_at: timestamp,
});
const container = new Element('div');
dom.renderModalFields = container;

// Compatibility, Berlin calendar date, and invalid/missing date handling.
const oldField = schema.toModalField({key: 'email', type: 'text', value: 'old@example.test'});
assert.strictEqual(oldField.accountArchived, false);
assert.strictEqual(oldField.accountArchivedAt, null);
assert.strictEqual(formatters.archivedAccountHint('2026-09-16T23:30:00Z'),
    'Das Konto wurde am 17.09.2026 deaktiviert.');
assert.strictEqual(formatters.archivedAccountHint('2026-09-16T00:30:00'),
    'Das Konto wurde am 16.09.2026 deaktiviert.');
for (const date of [null, '', 'garbage', '2026-02-30T12:00:00Z', '2026-09-16T99:00:00']) {
    assert.strictEqual(formatters.archivedAccountHint(date), 'Das Konto wurde deaktiviert.');
}

// Multiple fields, focusable/accessible tooltip, edit/restore, and render payload.
state.modalFields = schema.buildModalFieldsFromPrefill({fields: [
    archivedField('email', 'former@example.test'), archivedField('racf', 'former-racf'),
    {key: 'first_name', type: 'text', value: 'Ina'},
]});
ui.renderModalFields();
const emailHint = container.querySelector('[data-account-hint-index="0"]');
const racfHint = container.querySelector('[data-account-hint-index="1"]');
assert(emailHint && racfHint);
assert.strictEqual(container.querySelector('[data-account-hint-index="2"]'), null);
assert.strictEqual(emailHint.tabIndex, 0);
assert.strictEqual(emailHint.attributes['aria-label'], 'Das Konto wurde am 16.09.2026 deaktiviert.');
assert.strictEqual(emailHint.children[1].textContent, emailHint.attributes['aria-label']);
const input = container.querySelector('[data-modal-field-index="0"]');
input.value = 'changed@example.test';
handlers.handleFieldInput({target: input});
assert.strictEqual(emailHint.hidden, true);
assert.strictEqual(racfHint.hidden, false);
input.value = 'former@example.test ';
handlers.handleFieldInput({target: input});
assert.strictEqual(emailHint.hidden, true); // exact match, no trimming
input.value = 'former@example.test';
handlers.handleFieldInput({target: input});
assert.strictEqual(emailHint.hidden, false);
assert.deepStrictEqual(plain(handlers.collectModalValues()), {values: {
    email: 'former@example.test', racf: 'former-racf', first_name: 'Ina',
}, error: null});

const renderExistingDocumentCard = ui.renderExistingDocumentCard;
const setLoading = ui.setRenderActionLoading;
ui.renderExistingDocumentCard = () => {};
ui.setRenderActionLoading = () => {};
state.selectedSchema = {fields: [{key: 'email', type: 'text', required: true}]};
state.selectedTemplateId = '7';
state.selectedTemplateDocType = 'word';
state.selectedUserId = '1234';
state.existingDocument = {documentId: 'old-document'};
handlers.handleUserSelectionChange({target: {value: '5678'}});
assert.strictEqual(state.existingDocument, null);
assert.strictEqual(state.modalFields[0].accountArchived, false);
assert.strictEqual(state.modalFields[0].value, '');
assert.strictEqual(container.querySelector('[data-account-hint-index="0"]'), null);

async function verifyAsyncWorkflow() {
    // Ignore a prefill answer for the previous user, including A -> B -> A.
    state.selectedUserId = '1234';
    let resolve;
    api.prefillTemplate = () => new Promise(done => { resolve = done; });
    const pending = handlers.handlePrefillClick();
    handlers.handleUserSelectionChange({target: {value: '5678'}});
    handlers.handleUserSelectionChange({target: {value: '1234'}});
    resolve({fields: [archivedField('email', 'wrong-user@example.test')]});
    await pending;
    assert.strictEqual(state.modalFields[0].value, '');
    assert.strictEqual(state.modalFields[0].accountArchived, false);

    // Current response populates independent per-field warnings.
    api.prefillTemplate = async () => ({fields: [
        archivedField('email', 'former@example.test'), archivedField('racf', 'former-racf'),
    ]});
    await handlers.handlePrefillClick();
    assert.strictEqual(state.modalFields[0].accountArchived, true);
    assert(container.querySelector('[data-account-hint-index="0"]'));
    assert(container.querySelector('[data-account-hint-index="1"]'));

    // A template change resets values and the previous document reference.
    ui.renderTemplateCardRow = () => {};
    ui.setMainPaneState = () => {};
    ui.setStatus = () => {};
    dom.mainPaneStatus = new Element('div');
    api.getTemplate = async () => { throw new Error('fixture: stop after reset'); };
    await handlers.selectTemplate('8', 'pdf');
    assert.strictEqual(state.existingDocument, null);
    assert.strictEqual(state.modalFields.length, 0);
    assert.strictEqual(container.querySelector('[data-account-hint-index="0"]'), null);

    // Stale errors cannot overwrite status for a newer selection either.
    state.selectedTemplateId = '7';
    state.selectedUserId = '1234';
    let reject;
    api.prefillTemplate = () => new Promise((done, fail) => { reject = fail; });
    let statusCalls = 0;
    ui.setStatus = () => { statusCalls += 1; };
    const failing = handlers.handlePrefillClick();
    handlers.handleUserSelectionChange({target: {value: '5678'}});
    reject(new Error('late error'));
    await failing;
    assert.strictEqual(statusCalls, 0);
}
verifyAsyncWorkflow().then(() => console.log('Archive hint workflow passed')).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
