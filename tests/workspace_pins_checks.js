const assert = require('assert');
const path = require('path');

const pins = require(path.join(__dirname, '..', 'app', 'static', 'js', 'workspace_pins.js'));

const visible = ['a', 'b', 'c', 'd', 'e', 'f'];

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: key => (key in data ? data[key] : null),
        setItem: (key, value) => { data[key] = String(value); },
        data
    };
}

// toggle: setzen, loesen, aeltesten ersetzen
assert.deepStrictEqual(pins.toggle([], 'a'), ['a']);
assert.deepStrictEqual(pins.toggle(['a', 'b'], 'a'), ['b']);
assert.deepStrictEqual(pins.toggle(['a', 'b', 'c', 'd'], 'e'), ['b', 'c', 'd', 'e']);
assert.deepStrictEqual(pins.toggle(['a', 'b', 'c', 'd'], 'c'), ['a', 'b', 'd']);
assert.deepStrictEqual(pins.toggle(['a'], 'b', 1), ['b']);

// toggle veraendert die Eingabe nicht
const original = ['a', 'b'];
pins.toggle(original, 'c');
assert.deepStrictEqual(original, ['a', 'b']);

// normalize: unbekannte, doppelte, falsche Typen, Obergrenze
assert.deepStrictEqual(pins.normalize(['a', 'x', 'a', 7, null, 'b'], visible), ['a', 'b']);
assert.deepStrictEqual(pins.normalize(['a', 'b', 'c', 'd', 'e', 'f'], visible), ['c', 'd', 'e', 'f']);
assert.deepStrictEqual(pins.normalize({ a: 1 }, visible), []);
assert.deepStrictEqual(pins.normalize('a', visible), []);

// load/save pro Nutzer
const storage = memoryStorage();
pins.save(storage, 7, ['a', 'b']);
assert.deepStrictEqual(Object.keys(storage.data), ['sofa.workspace.pins.v1.7']);
assert.deepStrictEqual(pins.load(storage, 7, visible), ['a', 'b']);
assert.deepStrictEqual(pins.load(storage, 8, visible), []);
// verlorenes Recht: der Pin zaehlt nicht mehr
assert.deepStrictEqual(pins.load(storage, 7, ['b']), ['b']);

// kaputtes JSON
assert.deepStrictEqual(pins.load(memoryStorage({ 'sofa.workspace.pins.v1.7': '{kaputt' }), 7, visible), []);

// blockierter Speicher wirft nicht
const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
};
assert.deepStrictEqual(pins.load(blocked, 7, visible), []);
pins.save(blocked, 7, ['a']);
assert.deepStrictEqual(pins.load(undefined, 7, visible), []);

console.log('workspace pins ok');
