'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {LorebookLibrary, importWorldInfoFile} = require('../src/bot/st/lorebooks.cjs');
const {projectGroupLorebook, scanGroupLorebooks} = require('../src/bot/group-public-lorebook.cjs');
const {
  readGroupLorebookState, writeGroupLorebookState, clearGroupLorebookState, validGroupLorebookState,
} = require('../src/bot/group-lorebook-state.cjs');
const {LIMITS} = require('../src/vendor/sillytavern/world-info.cjs');

const SCOPE = '1'.repeat(64), OTHER_SCOPE = '2'.repeat(64);
const REVISION = 'a'.repeat(64), NEW_REVISION = 'b'.repeat(64), APPROVAL = '3'.repeat(64);
const effectKey = n => `.${n.toString(16).padStart(64, '0')}`;
const sample = () => ({
  approval: APPROVAL,
  effects: {turn: 1, sticky: {[effectKey(1)]: {start: 1, end: 5, protected: false}}, cooldown: {}},
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-group-lorebook-state-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, file: path.join(root, 'effects.json')};
}

test('only the exact group and authorization revision can restore numeric scanner state', t => {
  const {root, file} = fixture(t);
  const other = path.join(root, 'unrelated.json');
  fs.writeFileSync(other, 'outside the state file');
  assert.equal(readGroupLorebookState(file, SCOPE, REVISION), undefined);
  assert.equal(clearGroupLorebookState(file, SCOPE), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(writeGroupLorebookState(file, SCOPE, REVISION, sample()), true);
  assert.deepEqual(readGroupLorebookState(file, SCOPE, REVISION), sample());
  assert.equal(readGroupLorebookState(file, OTHER_SCOPE, REVISION), undefined);
  assert.equal(readGroupLorebookState(file, SCOPE, NEW_REVISION), undefined);
  const before = fs.readFileSync(file);
  assert.throws(() => writeGroupLorebookState(file, OTHER_SCOPE, NEW_REVISION, sample()), {code: 'group_storage_unavailable'});
  assert.equal(clearGroupLorebookState(file, OTHER_SCOPE), false);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(writeGroupLorebookState(file, SCOPE, NEW_REVISION, sample()), true);
  assert.equal(readGroupLorebookState(file, SCOPE, REVISION), undefined);
  assert.deepEqual(readGroupLorebookState(file, SCOPE, NEW_REVISION), sample());
  assert.equal(clearGroupLorebookState(file, SCOPE), true);
  assert.equal(clearGroupLorebookState(file, SCOPE), true);
  assert.equal(readGroupLorebookState(file, SCOPE, NEW_REVISION), undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {schema: 1, scope: SCOPE, revision: NEW_REVISION, state: null});
  assert.deepEqual(fs.readdirSync(root).sort(), ['effects.json', 'unrelated.json']);
  assert.equal(fs.readFileSync(other, 'utf8'), 'outside the state file');
});

test('shared context reset does not resurrect real sticky activation if the same selection is reopened', t => {
  const {root, file} = fixture(t);
  const library = new LorebookLibrary({root: path.join(root, 'world-books')});
  const {book} = importWorldInfoFile({
    name: 'synthetic world', entries: [{id: 5, keys: ['magnet'], content: 'synthetic lore text', enabled: true, extensions: {sticky: 6}}],
  });
  const {id} = library.add({book});
  const projection = projectGroupLorebook(library, {accountId: '98765432', groupId: '55556666', roleId: 'fixture-role', bookId: id});
  const active = scanGroupLorebooks([projection], ['magnet']);
  assert.deepEqual(active.texts, ['synthetic lore text']);
  assert.equal(writeGroupLorebookState(file, SCOPE, REVISION, active.state), true);
  const saved = fs.readFileSync(file, 'utf8');
  assert(!saved.includes(id));
  assert.doesNotMatch(saved, /magnet|synthetic lore text|fixture-role/);
  assert.deepEqual(scanGroupLorebooks([projection], ['nothing'], readGroupLorebookState(file, SCOPE, REVISION)).texts, ['synthetic lore text']);
  assert.deepEqual(scanGroupLorebooks([projection], ['nothing'], readGroupLorebookState(file, SCOPE, NEW_REVISION)).texts, []);
  assert.equal(clearGroupLorebookState(file, SCOPE), true);
  assert.deepEqual(scanGroupLorebooks([projection], ['nothing'], readGroupLorebookState(file, SCOPE, REVISION)).texts, []);
});

test('malformed, oversized, unsafe and foreign file bytes remain untouched', t => {
  const {root, file} = fixture(t);
  const valid = {schema: 1, scope: SCOPE, revision: REVISION, state: sample()};
  for (const contents of [
    Buffer.from([0xff]), Buffer.alloc(128 * 1024 + 1, 32), '{malformed',
    JSON.stringify({...valid, schema: 2}), JSON.stringify({...valid, extra: 'text'}),
    JSON.stringify({...valid, state: {...sample(), entries: ['should not be read']}}),
  ]) {
    fs.writeFileSync(file, contents);
    const before = fs.readFileSync(file);
    assert.equal(readGroupLorebookState(file, SCOPE, REVISION), undefined);
    assert.equal(clearGroupLorebookState(file, SCOPE), false);
    assert.throws(() => writeGroupLorebookState(file, SCOPE, REVISION, sample()), {code: 'group_storage_unavailable'});
    assert.deepEqual(fs.readFileSync(file), before);
  }
  const held = path.join(root, 'held.json');
  fs.writeFileSync(held, JSON.stringify(valid));
  fs.unlinkSync(file);
  try { fs.symlinkSync(held, file, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('Windows symlink creation unavailable');
      return;
    }
    throw error;
  }
  assert.equal(readGroupLorebookState(file, SCOPE, REVISION), undefined);
  assert.equal(clearGroupLorebookState(file, SCOPE), false);
  assert.throws(() => writeGroupLorebookState(file, SCOPE, REVISION, sample()), {code: 'group_storage_unavailable'});
  assert.equal(fs.readlinkSync(file), held);
  assert.deepEqual(JSON.parse(fs.readFileSync(held, 'utf8')), valid);
});

test('timing is strictly validated and native scanner state-count bound is retained', t => {
  const {file} = fixture(t);
  const state = sample();
  state.effects.sticky = Object.fromEntries(Array.from({length: LIMITS.stateEntries}, (_, index) => [
    effectKey(index), {start: 1, end: 100001, protected: false},
  ]));
  assert.equal(writeGroupLorebookState(file, SCOPE, REVISION, state), true);
  assert.deepEqual(readGroupLorebookState(file, SCOPE, REVISION), state);
  const before = fs.readFileSync(file);
  const accessor = sample();
  Object.defineProperty(accessor.effects.sticky[effectKey(1)], 'end', {get() { return 5; }});
  const invalid = [
    accessor,
    {...state, entries: ['no text gets to disk']},
    {...sample(), approval: 'raw identifier'},
    {...sample(), effects: {...sample().effects, turn: Number.MAX_SAFE_INTEGER}},
    {...sample(), effects: {...sample().effects, sticky: {'raw-entry-id': {start: 1, end: 9, protected: false}}}},
    {...sample(), effects: {...sample().effects, sticky: {[effectKey(1)]: {start: 2, end: 10, protected: false}}}},
    {...state, effects: {...state.effects, cooldown: {[effectKey(1)]: {start: 1, end: 10, protected: true}}}},
  ];
  for (const value of invalid) {
    assert.equal(validGroupLorebookState(value), false);
    assert.throws(() => writeGroupLorebookState(file, SCOPE, REVISION, value), {code: 'group_storage_unavailable'});
  }
  assert.deepEqual(fs.readFileSync(file), before);
});
