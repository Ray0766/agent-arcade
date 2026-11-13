'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createFolderSource} = require('../src/sources/folder.cjs');

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

test('symbolic links are skipped where the platform allows creating them', async t => {
  const dir = temp(t), outside = temp(t), src = createFolderSource({id:'inbox', dir});
  const baseline = await src.poll(null);
  fs.writeFileSync(path.join(outside, 'target.txt'), 't');
  try { fs.symlinkSync(path.join(outside, 'target.txt'), path.join(dir, 'link.txt'), 'file'); }
  catch (error) { t.skip(`symlink not permitted: ${error.code}`); return; }
  fs.writeFileSync(path.join(dir, 'real.txt'), 'r');
  assert.deepEqual(summary((await src.poll(baseline.cursor)).events), [['folder.added', 'real.txt']]);
});

test('at most 50 events per poll; the rest are reported by the next poll', async t => {
  const dir = temp(t), src = createFolderSource({id:'inbox', dir});
  let result = await src.poll(null);
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.txt`), 'x');
  result = await src.poll(result.cursor);
  assert.equal(result.events.length, 50);
  assert.equal(result.events[0].subject, 'f00.txt');
  result = await src.poll(result.cursor);
  assert.deepEqual(result.events.map(e => e.subject), Array.from({length:10}, (_, i) => `f${50 + i}.txt`));
  assert.deepEqual((await src.poll(result.cursor)).events, []);
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
