'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {GroupPublicContext, MAX_AGE} = require('../src/bot/group-public-context.cjs');

const now = 1800000000000;
const speaker = 'a'.repeat(16);
const otherSpeaker = 'b'.repeat(16);
const digest = value => createHash('sha256').update(value).digest('hex');
const member = (number, fields = {}) => ({
  id: digest('member message ' + number),
  kind: 'member',
  speaker,
  replyTo: null,
  text: 'Synthetic public row ' + number,
  at: now,
  ...fields,
});
const character = {
  id: digest('confirmed character reply'), kind: 'character', speaker: 'claude-ju',
  replyTo: speaker, text: 'Synthetic character reply', at: now,
};

function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-public-recall-'));
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  return function fileFor(label) {
    const file = path.join(folder, label + '.json');
    const scope = digest(label);
    const open = (expectedScope = scope) => new GroupPublicContext({file, scope: expectedScope, now: () => now});
    return {file, scope, open};
  };
}

test('recall removes only the matching member row from a schema 1 file and survives cold reopen', t => {
  const fileFor = setup(t), target = fileFor('group 500001'), unrelated = fileFor('group 500002');
  const recalled = member(1), sameMember = member(2), elsewhere = member(3, {speaker: otherSpeaker});
  const expired = member(4, {at: now - MAX_AGE - 1});
  const rows = [recalled, sameMember, character, elsewhere, expired];
  fs.writeFileSync(target.file, JSON.stringify({schema: 1, scope: target.scope, rows}));
  const second = unrelated.open();
  second.append(recalled);
  const savedElsewhere = fs.readFileSync(unrelated.file);

  const store = target.open();
  assert.equal(store.hasMemberRow(recalled.id, otherSpeaker), false);
  assert.equal(store.recallMember(recalled.id, otherSpeaker), false);
  assert.equal(store.recallMember(character.id, speaker), false);
  assert.equal(store.recallMember(character.id, character.speaker), false);
  assert.equal(store.recallMember(digest('unobserved'), speaker), false);
  assert.equal(store.hasMemberRow(recalled.id, speaker), true);
  assert.equal(store.recallMember(recalled.id, speaker), true);
  assert.equal(store.hasMemberRow(recalled.id, speaker), false);
  assert.equal(store.recallMember(recalled.id, speaker), false);
  assert.deepEqual(store.view(), [sameMember, character, elsewhere]);
  assert.deepEqual(target.open().view(), store.view());
  assert.deepEqual(JSON.parse(fs.readFileSync(target.file, 'utf8')), {schema: 1, scope: target.scope, rows: rows.slice(1)});
  assert.deepEqual(fs.readFileSync(unrelated.file), savedElsewhere);
  assert.deepEqual(unrelated.open().view(), [recalled]);
  assert.throws(() => target.open(unrelated.scope), {code: 'group_storage_unavailable'});
});

test('atomic replace failure hides only the recalled row and a duplicate valid notice can retry', t => {
  const target = setup(t)('group 500001'), store = target.open();
  const recalled = member(1), unaffected = member(2);
  for (const row of [recalled, unaffected, character]) store.append(row);
  const saved = fs.readFileSync(target.file);
  const rename = fs.renameSync;
  const block = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === target.file) throw Error('simulated replacement failure');
    return rename(from, to);
  });

  assert.throws(() => store.recallMember(recalled.id, speaker), {code: 'group_storage_unavailable'});
  assert.deepEqual(fs.readFileSync(target.file), saved);
  assert.deepEqual(fs.readdirSync(path.dirname(target.file)), [path.basename(target.file)]);
  assert.deepEqual(store.view(), [unaffected, character]);
  assert.equal(store.hasMemberRow(recalled.id, speaker), true);
  assert.equal(store.recallMember(recalled.id, otherSpeaker), false);
  store.append(recalled);
  assert.deepEqual(store.view(), [unaffected, character]);

  block.mock.restore();
  assert.equal(store.recallMember(recalled.id, speaker), true);
  assert.equal(store.recallMember(recalled.id, speaker), false);
  assert.deepEqual(target.open().view(), [unaffected, character]);
});

test('the next successful append persists an already admitted recall without reviving that row', t => {
  const target = setup(t)('group 500001'), store = target.open();
  const recalled = member(1), unaffected = member(2);
  for (const row of [recalled, unaffected, character]) store.append(row);
  const rename = fs.renameSync;
  const block = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === target.file) throw Error('simulated replacement failure');
    return rename(from, to);
  });
  assert.throws(() => store.recallMember(recalled.id, speaker), {code: 'group_storage_unavailable'});
  block.mock.restore();

  const next = member(3, {speaker: otherSpeaker});
  store.append(next);
  assert.deepEqual(store.view(), [unaffected, character, next]);
  assert.deepEqual(target.open().view(), store.view());
  assert.equal(store.hasMemberRow(recalled.id, speaker), false);
});
