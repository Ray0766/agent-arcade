'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Bus} = require('../src/core/bus.cjs');
const {makeEvent} = require('../src/sources/event.cjs');
const {createFolderSource} = require('../src/sources/folder.cjs');
const {groupFolderChange} = require('../src/sources/group-folder.cjs');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-folder-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return dir;
}
const summary = events => events.map(e => [e.kind, e.subject]);

test('baseline, then added, changed and removed files are reported by name only', async t => {
  const dir = temp(t), src = createFolderSource({id:'inbox', dir, now:() => 5000});
  fs.writeFileSync(path.join(dir, 'a.txt'), 'secret contents');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'nested.txt'), 'n');
  let result = await src.poll(null);
  assert.deepEqual(result.events, []);
  assert.deepEqual(Object.keys(result.cursor.files).sort(), ['a.txt', 'b.txt']);
  result = await src.poll(JSON.parse(JSON.stringify(result.cursor)));
  assert.deepEqual(result.events, []);

  fs.writeFileSync(path.join(dir, 'a.txt'), 'secret contents, now longer');
  fs.unlinkSync(path.join(dir, 'b.txt'));
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
  fs.writeFileSync(path.join(dir, 'sub', 'more.txt'), 'm');
  result = await src.poll(result.cursor);
  assert.deepEqual(summary(result.events), [['folder.changed', 'a.txt'], ['folder.removed', 'b.txt'], ['folder.added', 'c.txt']]);
  for (const event of result.events) {
    assert.equal(event.at, 5000);
    assert.ok(!JSON.stringify(event).includes('secret') && !JSON.stringify(event).includes(dir));
  }
  assert.deepEqual((await src.poll(result.cursor)).events, []);
});

test('group projection accepts the exact public basename and action while the watcher keeps its private notices', async t => {
  const dir = temp(t), operations = [];
  const src = createFolderSource({id:'inbox', dir, now:() => 5000, fsImpl:{
    readdir: (...args) => { operations.push('readdir'); return fs.promises.readdir(...args); },
    lstat: (...args) => { operations.push('lstat'); return fs.promises.lstat(...args); },
  }});
  const filename = '周末展览时间.txt';
  const selected = path.join(dir, filename), finder = path.join(dir, '.DS_Store');
  const contents = 'Synthetic private file contents';
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'preexisting.txt'), contents);
  const baseline = await src.poll(null);
  assert.deepEqual(baseline.events, []);
  fs.writeFileSync(selected, contents);
  fs.writeFileSync(finder, contents);
  fs.writeFileSync(path.join(dir, '._image.png'), contents);
  fs.writeFileSync(path.join(dir, 'sub', 'nested.txt'), contents);
  const added = await src.poll(baseline.cursor);
  fs.appendFileSync(selected, ' revised');
  fs.appendFileSync(finder, ' metadata');
  const changed = await src.poll(added.cursor);
  fs.unlinkSync(selected);
  const removed = await src.poll(changed.cursor);
  const events = [...added.events, ...changed.events, ...removed.events];
  assert.deepEqual(summary(events), [
    ['folder.added', '.DS_Store'], ['folder.added', '._image.png'], ['folder.added', filename],
    ['folder.changed', '.DS_Store'], ['folder.changed', filename], ['folder.removed', filename],
  ]);
  const group = events.map(groupFolderChange).filter(Boolean);
  assert.deepEqual(group, ['added', 'changed', 'removed'].map(change => ({name:filename, change})));
  assert.deepEqual([...new Set(operations)].sort(), ['lstat', 'readdir']);
  assert(!JSON.stringify(group).includes(contents) && !JSON.stringify(group).includes(dir));
  assert.deepEqual((await src.poll(removed.cursor)).events, []);
});

test('group projection rejects metadata aliases, loss of basename fidelity, and unsafe or malformed input', () => {
  const asChange = (name, extra) => ({kind:'folder.added', subject:name, data:{name}, ...extra});
  for (const name of ['.dS_sToRe', '._report.txt', '.AppleDouble', '.localized', 'Desktop.INI', 'Thumbs.DB', '.', '..',
    'sub/file.txt', 'sub\\file.txt', 'C:file.txt', 'fullwidth／file.txt', 'slash∕file.txt', 'report\nforged.txt',
    'report\0forged.txt', 'report\u202Etxt', 'report\uD800.txt', '[CQ:at,qq=all].txt', 'report`public.txt',
    '.leading space on name .', ' leading.txt', 'double  space.txt', 'a'.repeat(201), 'https://example.com/notice.txt', '']) {
    assert.equal(groupFolderChange(asChange(name)), null, JSON.stringify(name));
  }
  for (const invalid of [undefined, null, {}, asChange('public.txt', {kind:'feed.item'}),
    asChange('public.txt', {subject:'different.txt'}), asChange('public.txt', {data:{name:17}})]) {
    assert.equal(groupFolderChange(invalid), null);
  }
  for (const name of ['.gitignore', '活动安排 v2.txt', 'image@2x.png', 'café (final).png', 'a'.repeat(200)]) {
    assert.deepEqual(groupFolderChange(asChange(name)), {name, change:'added'});
  }
});

test('symbolic links are skipped where the platform allows creating them', async t => {
  const dir = temp(t), outside = temp(t), src = createFolderSource({id:'inbox', dir});
  const baseline = await src.poll(null);
  fs.writeFileSync(path.join(outside, 'target.txt'), 't');
  try { fs.symlinkSync(path.join(outside, 'target.txt'), path.join(dir, 'link.txt'), 'file'); }
  catch (error) { t.skip(`symlink not permitted: ${error.code}`); return; }
  fs.writeFileSync(path.join(dir, 'real.txt'), 'r');
  assert.deepEqual(summary((await src.poll(baseline.cursor)).events), [['folder.added', 'real.txt']]);
});

test('an opt-in root witness detects a same-path replacement while the owner cursor drains normally', async t => {
  const parent = temp(t), dir = path.join(parent, 'watched'), oldDir = path.join(parent, 'retired');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'original.txt'), 'old');
  const opts = {id:'inbox', dir, now:() => 5000};
  const plain = createFolderSource(opts), src = createFolderSource({...opts, captureGroupRoot:true});
  assert.equal(plain.groupRootStamp, undefined);
  assert.equal(src.groupRootStamp(), null);
  const before = await src.poll(null);
  const {groupFolder, ...privateBaseline} = before;
  assert.deepEqual(privateBaseline, await plain.poll(null));
  assert.match(groupFolder.rootStamp, /^[a-f0-9]{32}$/);
  assert.equal(groupFolder.baselineComplete, true);
  fs.writeFileSync(path.join(dir, 'new-inside-original.txt'), 'same root');
  assert.equal(src.groupRootStamp(), groupFolder.rootStamp);

  fs.renameSync(dir, oldDir);
  assert.equal(src.groupRootStamp(), null);
  fs.mkdirSync(dir);
  for (let i = 0; i < 51; i++) fs.writeFileSync(path.join(dir, `replacement-${i}.txt`), 'new');
  assert.equal(src.groupRootStamp(), null);
  const first = await src.poll(before.cursor);
  const {groupFolder:replacement, ...firstPrivate} = first;
  assert.deepEqual(firstPrivate, await plain.poll(before.cursor));
  assert.notEqual(replacement.rootStamp, groupFolder.rootStamp);
  assert.equal(replacement.rootStamp, src.groupRootStamp());
  assert.equal(replacement.baselineComplete, false);
  assert.equal(first.events.length, 50);

  const second = await src.poll(first.cursor);
  const {groupFolder:remaining, ...secondPrivate} = second;
  assert.deepEqual(secondPrivate, await plain.poll(first.cursor));
  assert.deepEqual(remaining, {rootStamp:replacement.rootStamp, baselineComplete:true});
  assert.equal(second.events.length, 2);
  const reopened = createFolderSource({...opts, captureGroupRoot:true});
  const final = await reopened.poll(JSON.parse(JSON.stringify(second.cursor)));
  assert.deepEqual(final.groupFolder, remaining);
  assert.deepEqual(final.events, []);
});

test('a root moved during the listing or a failed listing cannot prove group identity', async t => {
  const parent = temp(t), dir = path.join(parent, 'watched');
  fs.mkdirSync(dir);
  let replace = false, fail = false;
  const src = createFolderSource({id:'inbox', dir, captureGroupRoot:true, fsImpl:{
    readdir: async (...args) => {
      if (fail) throw Object.assign(new Error('Synthetic failed listing'), {code:'EACCES'});
      const entries = await fs.promises.readdir(...args);
      if (replace) {
        fs.renameSync(dir, path.join(parent, 'retired'));
        fs.mkdirSync(dir);
        replace = false;
      }
      return entries;
    },
    lstat: fs.promises.lstat,
  }});
  const baseline = await src.poll(null);
  const oldStamp = src.groupRootStamp();
  assert.match(oldStamp, /^[a-f0-9]{32}$/);
  replace = true;
  const raced = await src.poll(baseline.cursor);
  assert.deepEqual(raced.groupFolder, {rootStamp:null, baselineComplete:true});
  assert.equal(src.groupRootStamp(), null);
  const stable = await src.poll(raced.cursor);
  assert.match(stable.groupFolder.rootStamp, /^[a-f0-9]{32}$/);
  assert.notEqual(stable.groupFolder.rootStamp, oldStamp);
  fail = true;
  await assert.rejects(src.poll(stable.cursor), {code:'EACCES'});
  assert.equal(src.groupRootStamp(), null);
});

test('a selected symlink folder with a trailing separator keeps private listing without group proof', async t => {
  const parent = temp(t), dir = path.join(parent, 'real-folder'), link = path.join(parent, 'linked-folder');
  fs.mkdirSync(dir);
  try { fs.symlinkSync(dir, link, 'dir'); }
  catch (error) { t.skip(`symlink not permitted: ${error.code}`); return; }
  const src = createFolderSource({id:'inbox', dir:link + path.sep, captureGroupRoot:true});
  const baseline = await src.poll(null);
  fs.writeFileSync(path.join(dir, 'private.txt'), 'synthetic');
  const after = await src.poll(baseline.cursor);
  assert.deepEqual(summary(after.events), [['folder.added', 'private.txt']]);
  assert.deepEqual(after.groupFolder, {rootStamp:null, baselineComplete:true});
  assert.equal(src.groupRootStamp(), null);
});

test('moving the identical file back yields a new event across cold polls and saved-cursor retry stays stable', async t => {
  const parent = temp(t), dir = path.join(parent, 'watched'), name = '周日参观安排.txt';
  fs.mkdirSync(dir);
  const outside = path.join(parent, name), inside = path.join(dir, name);
  fs.writeFileSync(outside, 'synthetic');
  let now = 5000;
  const create = () => createFolderSource({id:'inbox', dir, now:() => now});
  const source = create(), baseline = await source.poll(null);
  const oldCursor = {files:baseline.cursor.files};
  assert.equal(baseline.cursor.eventSequence, '0');
  fs.renameSync(outside, inside);
  const first = await source.poll(oldCursor);
  assert.equal(first.cursor.eventSequence, '1');
  const signature = first.cursor.files[name];
  const [firstEvent] = first.events;
  const preUpgrade = makeEvent({source:'inbox', kind:'folder.added', subject:name, key:signature.join(':'), title:firstEvent.title, at:now});
  assert.notEqual(firstEvent.id, preUpgrade.id);
  now += 5000;
  const retry = await create().poll(JSON.parse(JSON.stringify({...oldCursor, eventSequence:'1\n'})));
  assert.equal(retry.events[0].id, firstEvent.id);
  assert.notEqual(retry.events[0].at, firstEvent.at);

  fs.renameSync(inside, outside);
  const removed = await create().poll(JSON.parse(JSON.stringify(first.cursor)));
  assert.equal(removed.cursor.eventSequence, '2');
  fs.renameSync(outside, inside);
  const returned = await create().poll(JSON.parse(JSON.stringify(removed.cursor)));
  assert.deepEqual(returned.cursor.files[name], signature);
  assert.equal(returned.cursor.eventSequence, '3');
  assert.equal((await create().poll(removed.cursor)).events[0].id, returned.events[0].id);
  assert.deepEqual(await create().poll(returned.cursor), {cursor:returned.cursor, events:[]});

  const timeline = [firstEvent, removed.events[0], returned.events[0]], bus = new Bus(), delivered = [];
  bus.subscribe({source:'inbox'}, event => delivered.push(event.kind));
  assert.equal(new Set(timeline.map(event => event.id)).size, 3);
  for (const event of timeline) assert(bus.publish(event));
  assert.equal(bus.publish(retry.events[0]), false);
  assert.deepEqual(delivered, ['folder.added', 'folder.removed', 'folder.added']);
});

test('at most 50 events per poll; the rest are reported by the next poll', async t => {
  const dir = temp(t), src = createFolderSource({id:'inbox', dir});
  let result = await src.poll(null);
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.txt`), 'x');
  result = await src.poll(result.cursor);
  assert.equal(result.events.length, 50);
  assert.equal(result.cursor.eventSequence, '50');
  assert.equal(result.events[0].subject, 'f00.txt');
  result = await src.poll(result.cursor);
  assert.deepEqual(result.events.map(e => e.subject), Array.from({length:10}, (_, i) => `f${50 + i}.txt`));
  assert.equal(result.cursor.eventSequence, '60');
  assert.deepEqual(await src.poll(result.cursor), {cursor:result.cursor, events:[]});
});

test('too many files, a missing folder, an aborted poll and invalid options fail clearly', async t => {
  const dir = temp(t);
  for (let i = 0; i < 4; i++) fs.writeFileSync(path.join(dir, `f${i}`), 'x');
  await assert.rejects(createFolderSource({id:'inbox', dir, maxEntries:3}).poll(null), {code:'too_many_entries'});
  await assert.rejects(createFolderSource({id:'inbox', dir:path.join(dir, 'missing')}).poll(null), {code:'ENOENT'});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createFolderSource({id:'inbox', dir}).poll(null, controller.signal), {code:'aborted'});
  for (const options of [{dir:'relative/path'}, {dir, intervalMs:4999}, {dir, maxEntries:0}, {dir:5}]) {
    assert.throws(() => createFolderSource({id:'inbox', ...options}), {code:'invalid_input'}, JSON.stringify(options));
  }
  assert.throws(() => createFolderSource({id:'bad id', dir}), {code:'invalid_input'});
});
