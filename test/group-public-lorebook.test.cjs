'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {LorebookLibrary, importWorldInfoFile} = require('../src/bot/st/lorebooks.cjs');
const {
  projectGroupLorebook, groupLorebookBindings, scanGroupLorebooks, MAX_GROUP_LOREBOOKS, MAX_GROUP_LOREBOOK_BINDINGS,
} = require('../src/bot/group-public-lorebook.cjs');

const ACCOUNT = '87654321', OTHER_ACCOUNT = '87654322';
const GROUP = '55556666', OTHER_GROUP = '55556667', ROLE = 'claude-ju', OTHER_ROLE = 'deepseek-whale';
const scope = {accountId: ACCOUNT, groupId: GROUP, roleId: ROLE};
const raw = (id, keys, content, extra) => ({id, keys, content, enabled: true, ...extra});
const book = (name, entries, fields = {}) => importWorldInfoFile({name, entries, ...fields}).book;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-group-world-book-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const library = new LorebookLibrary({root});
  return {
    library,
    add: (name, entries, fields) => library.add({book: book(name, entries, fields)}),
    project: (bookId, overrides) => projectGroupLorebook(library, {...scope, bookId, ...overrides}),
  };
}

test('owner review includes exact enabled content and activation rules, with no private fields or overrides', t => {
  const f = fixture(t);
  const form = active => [
    raw(1, ['harbour'], 'Exact {{user}} context\n第二行', {
      secondary_keys: ['night'], selective: true, comment: 'private comment', insertion_order: 88,
      extensions: {probability: 70, useProbability: true, sticky: 4, cooldown: 2, delay_until_recursion: 1,
        match_whole_words: true, ignore_budget: true, ...active},
    }),
    raw(2, ['harbour'], 'private disabled marker', {enabled: false}),
  ];
  const saved = f.add('Reviewed book', form(), {scan_depth: 3});
  const original = f.project(saved.id);
  assert.equal(original.name, 'Reviewed book');
  assert.equal(original.review.length, 1);
  assert.equal(original.review[0].content, 'Exact {{user}} context\n第二行');
  assert.deepEqual(original.review[0].keys, ['harbour']);
  assert.deepEqual(original.review[0].secondaryKeys, ['night']);
  assert.deepEqual(
    ['selective', 'insertionOrder', 'probability', 'sticky', 'cooldown', 'delayUntilRecursion', 'matchWholeWords', 'ignoreBudget', 'scanDepth']
      .map(key => original.review[0][key]),
    [true, 88, 70, 4, 2, 1, true, false, 3],
  );
  assert.doesNotMatch(JSON.stringify(original), /private comment|private disabled marker/);
  assert(Object.isFrozen(original.review[0].keys));
  assert.equal(original.approval, f.project(saved.id).approval);
  for (const changed of [{accountId: OTHER_ACCOUNT}, {groupId: OTHER_GROUP}, {roleId: OTHER_ROLE}]) {
    assert.notEqual(original.approval, f.project(saved.id, changed).approval);
  }
  const sameContents = f.add('Reviewed book', form(), {scan_depth: 3});
  assert.notEqual(original.approval, f.project(sameContents.id).approval);
  f.library.update(saved.id, {book: book('Reviewed book', form({probability: 71}), {scan_depth: 3})});
  const changedRule = f.project(saved.id);
  assert.notEqual(original.approval, changedRule.approval);
  const changedText = form({probability: 71});
  changedText[0].content += '\n已更正';
  f.library.update(saved.id, {book: book('Reviewed book', changedText, {scan_depth: 3})});
  assert.notEqual(changedRule.approval, f.project(saved.id).approval);
  f.library.remove(saved.id);
  assert.throws(() => f.project(saved.id), {code: 'group_lorebook_missing'});
  assert.throws(() => f.project('../notes'), {code: 'group_lorebook_invalid'});
});

test('all 65 and 500 normalized entries are available for review, including sparse matches after 15k characters', t => {
  const f = fixture(t);
  for (const length of [65, 500]) {
    const entries = Array.from({length: length - 1}, (_, index) => raw(index + 1, [`cold-${index}`], '无关条目。'.repeat(50)));
    entries.push(raw(length, ['target marker'], 'Activated entry from the end of review.'));
    const saved = f.add(`Complete book ${length}`, entries);
    const projection = f.project(saved.id);
    assert.equal(projection.review.length, length);
    assert(projection.review.reduce((sum, item) => sum + item.content.length, 0) > 15000);
    assert.equal(projection.review.at(-1).id, length);
    assert.deepEqual(scanGroupLorebooks([projection], ['target marker']).texts, ['Activated entry from the end of review.']);
  }
});

test('runtime uses the checked standalone record and never falls back after a missing checked read', t => {
  const f = fixture(t);
  const saved = f.add('Checked read', [raw(1, ['public-token'], 'reviewed text')]);
  const reads = [];
  const source = {
    reviewRecord(id) { reads.push(id); return reads.length === 1 ? f.library.get(id) : null; },
    get() { assert.fail('unchecked library lookup'); },
  };
  assert.equal(projectGroupLorebook(source, {...scope, bookId: saved.id}).review[0].content, 'reviewed text');
  assert.throws(() => projectGroupLorebook(source, {...scope, bookId: saved.id}), {code: 'group_lorebook_missing'});
  assert.deepEqual(reads, [saved.id, saved.id]);
});

test('standalone books share bounded recursion across equal entry ids without reaching unselected or foreign books', t => {
  const f = fixture(t);
  const a = f.add('Selected A', [raw(1, ['harbour'], 'bridge-token')]);
  const b = f.add('Selected B', [raw(1, ['bridge-token'], 'hidden-cross-book-gem')]);
  f.add('Unselected book', [raw(1, ['hidden-cross-book-gem'], 'private standalone marker')]);
  const pa = f.project(a.id), pb = f.project(b.id);
  assert.deepEqual(scanGroupLorebooks([pa, pb], ['nothing']).texts, []);
  assert.deepEqual(scanGroupLorebooks([pa, pb], [{text: 'nothing', name: 'harbour', privateText: 'harbour'}]).texts, []);
  assert.deepEqual(scanGroupLorebooks([pa], ['harbour']).texts, ['bridge-token']);
  assert.deepEqual(new Set(scanGroupLorebooks([pa, pb], [{text: 'harbour'}]).texts), new Set(['bridge-token', 'hidden-cross-book-gem']));
  for (const other of [{groupId: OTHER_GROUP}, {roleId: OTHER_ROLE}, {accountId: OTHER_ACCOUNT}]) {
    assert.deepEqual(scanGroupLorebooks([pa, f.project(b.id, other)], ['harbour']), {texts: [], state: null});
  }
  for (const selection of [[pa, pa], [pa, structuredClone(pb)], [pa, , pb]]) {
    assert.deepEqual(scanGroupLorebooks(selection, ['harbour']), {texts: [], state: null});
  }
});

test('group lore uses the single shared 900-character budget and leaves macros and desktop placement inert', t => {
  const f = fixture(t);
  const first = 'A'.repeat(497) + ' {{user}}';
  const second = 'B'.repeat(500);
  const a = f.add('A', [raw(0, ['weather'], first, {insertion_order: 110, extensions: {position: 4, role: 1}})]);
  const b = f.add('B', [raw(0, ['weather'], second, {extensions: {ignore_budget: true}})], {token_budget: 1000000});
  const result = scanGroupLorebooks([f.project(a.id), f.project(b.id)], [{text: 'weather'}]);
  assert.deepEqual(result.texts, [first]);
  assert.equal(typeof result.texts[0], 'string');
  assert.match(result.texts[0], /\{\{user\}\}/);
});

test('probability, delay, sticky and cooldown advance only in the exact approved ordered selection', t => {
  t.mock.method(Math, 'random', () => .5);
  const f = fixture(t);
  const a = f.add('Timed', [
    raw(1, ['spark'], 'sticky spark', {extensions: {sticky: 4, cooldown: 4}}),
    raw(2, ['delayed'], 'delayed lore', {extensions: {delay: 4, probability: 60}}),
    raw(3, ['delayed'], 'failed probability', {extensions: {probability: 40}}),
  ]);
  const b = f.add('Second', [raw(1, ['b-key'], 'other lore')]);
  const pa = f.project(a.id), pb = f.project(b.id);
  const first = scanGroupLorebooks([pa, pb], ['spark delayed']);
  assert.deepEqual(first.texts, ['sticky spark']);
  const serialState = JSON.parse(JSON.stringify(first.state));
  const same = scanGroupLorebooks([pa, pb], ['nothing'], serialState);
  assert.deepEqual(same.texts, ['sticky spark']);
  assert.equal(same.state.approval, first.state.approval);
  const cooled = scanGroupLorebooks([pa, pb], ['spark delayed'], same.state);
  assert.deepEqual(cooled.texts, ['delayed lore']);
  const stillCooled = scanGroupLorebooks([pa, pb], ['spark'], cooled.state);
  assert.deepEqual(stillCooled.texts, []);
  assert.deepEqual(scanGroupLorebooks([pa, pb], ['spark'], stillCooled.state).texts, ['sticky spark']);
  const other = f.project(a.id, {groupId: OTHER_GROUP});
  for (const changed of [[pa], [pb, pa], [other]]) {
    const result = scanGroupLorebooks(changed, ['nothing'], serialState);
    assert.deepEqual(result.texts, []);
    assert.notEqual(result.state.approval, serialState.approval);
    assert.equal(result.state.effects.turn, 1);
  }
  const corrupted = structuredClone(serialState);
  const [stickyKey] = Object.keys(corrupted.effects.sticky);
  assert.match(stickyKey, /^\.[0-9a-f]{64}$/);
  corrupted.effects.sticky[stickyKey].end += 1;
  assert.deepEqual(scanGroupLorebooks([pa, pb], ['nothing'], corrupted).texts, []);
});

test('saved group lore metadata has independent book tuples, caps and fail-closed duplicates', () => {
  const row = (id, extra) => ({...scope, bookId: id.toString(16).padStart(16, '0'), name: `Fixture ${id}`, approval: 'a'.repeat(64), ...extra});
  const first = row(1), second = row(2), otherRole = row(1, {roleId: OTHER_ROLE});
  const otherGroup = row(1, {groupId: OTHER_GROUP});
  assert.deepEqual(groupLorebookBindings([first, second, otherRole, otherGroup], ACCOUNT, [GROUP]), [first, second, otherRole]);
  const invalidDuplicate = {...first, approval: 'invalid'};
  assert.deepEqual(groupLorebookBindings([first, invalidDuplicate, second, row(3, {content: 'no persisted content'})], ACCOUNT, [GROUP]), [second]);
  assert.deepEqual(groupLorebookBindings([first], OTHER_ACCOUNT, [GROUP]), []);
  const tooMany = Array.from({length: MAX_GROUP_LOREBOOKS + 1}, (_, index) => row(index));
  assert.deepEqual(groupLorebookBindings([...tooMany, otherRole], ACCOUNT, [GROUP]), [otherRole]);
  const allRows = Array.from({length: MAX_GROUP_LOREBOOK_BINDINGS + 1}, (_, index) => row(index, {roleId: `role-${index}`}));
  assert.deepEqual(groupLorebookBindings(allRows, ACCOUNT, [GROUP]), []);
});
