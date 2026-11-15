'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {SourceRegistry} = require('../src/sources/registry.cjs');
const {makeEvent} = require('../src/sources/event.cjs');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const feed = (id, extra = {}) => ({id, kind:'feed', name:`Feed ${id}`, enabled:true, notify:'both', url:`https://news.example/${id}.xml`, mode:'feed', ...extra});
const event = (source, key) => makeEvent({source, kind:'feed.item', subject:'s', title:`t${key}`, at:1, key:String(key)});

// A registry over a temp directory whose "feed" kind is a scripted fake source.
function setup(t, behavior, sources = [feed('a')]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-sources-registry-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const file = path.join(dir, 'sources.json'), clock = {now:1000000}, polls = [], published = [], closed = [];
  const factories = {feed: config => ({intervalMs:60000, close:() => closed.push(config.id),
    poll:(cursor, signal) => { polls.push({id:config.id, cursor, signal, at:clock.now}); return behavior(config, cursor, signal, polls.length); }})};
  const make = (publish = (e, config) => { published.push([e.title, config.id, config.notify]); }) => new SourceRegistry({file, publish, now:() => clock.now, factories});
  fs.writeFileSync(file, JSON.stringify({version:1, sources}));
  return {dir, file, clock, polls, published, closed, make};
}

test('tick polls a source when due, publishes its events and reschedules by interval', async t => {
  const ctx = setup(t, async (config, cursor) => ({cursor:{n:(cursor?.n || 0) + 1}, events:[event(config.id, cursor?.n || 0)]}));
  const registry = ctx.make();
  assert.deepEqual(registry.load(), {problem:null});
  assert.deepEqual(registry.snapshot(), [{id:'a', kind:'feed', name:'Feed a', enabled:true, notify:'both', lastCheckedAt:null, lastEventAt:null, lastError:null, target:'https://news.example/a.xml'}]);
  registry.tick(); registry.tick();
  assert.equal(ctx.polls.length, 1);
  await flush();
  assert.deepEqual(ctx.published, [['t0', 'a', 'both']]);
  assert.deepEqual([registry.snapshot()[0].lastCheckedAt, registry.snapshot()[0].lastEventAt], [1000000, 1000000]);
  ctx.clock.now += 59999; registry.tick();
  assert.equal(ctx.polls.length, 1);
  ctx.clock.now += 1; registry.tick(); await flush();
  assert.equal(ctx.polls.length, 2);
  assert.deepEqual(ctx.polls[1].cursor, {n:1});
  registry.close(); ctx.clock.now += 600000; registry.tick();
  assert.equal(ctx.polls.length, 2);
  assert.deepEqual(ctx.closed, ['a']);
});

test('failures back off exponentially up to 30 minutes and report a short, credential-free error', async t => {
  let failing = true;
  const ctx = setup(t, async () => {
    if (failing) throw Object.assign(new Error('GET https://user:hunter2@news.example/a.xml?token=abc123 failed\n    at stack'), {code:'http_error', stack:'secret stack'});
    return {cursor:null, events:[]};
  });
  const registry = ctx.make(); registry.load();
  const expectNextAfter = async delay => {
    ctx.clock.now += delay - 1; registry.tick(); const before = ctx.polls.length;
    ctx.clock.now += 1; registry.tick(); await flush();
    return [before, ctx.polls.length];
  };
  registry.tick(); await flush();
  const {lastError} = registry.snapshot()[0];
  assert.equal(lastError.code, 'http_error');
  assert.ok(!/hunter2|abc123|stack/.test(JSON.stringify(lastError)) && lastError.message.length <= 160);
  assert.deepEqual(await expectNextAfter(120000), [1, 2]);
  assert.deepEqual(await expectNextAfter(240000), [2, 3]);
  assert.deepEqual(await expectNextAfter(480000), [3, 4]);
  assert.deepEqual(await expectNextAfter(960000), [4, 5]);
  assert.deepEqual(await expectNextAfter(1800000), [5, 6]);
  failing = false;
  assert.deepEqual(await expectNextAfter(1800000), [6, 7]);
  assert.equal(registry.snapshot()[0].lastError, null);
  assert.deepEqual(await expectNextAfter(60000), [7, 8]);
  registry.close();
});

test('a throwing or rejecting publish and a throwing poll never break the loop', async t => {
  const ctx = setup(t, (config, cursor, signal, n) => {
    if (n === 2) throw new Error('synchronous failure');
    return {cursor:null, events:[event('a', 1), {bogus:true}, event('a', 2), event('a', 3)]};
  });
  const seen = [];
  const registry = ctx.make(e => { seen.push(e.title); if (e.title === 't1') throw new Error('publish failed'); if (e.title === 't2') return Promise.reject(new Error('async')); });
  registry.load();
  assert.doesNotThrow(() => registry.tick()); await flush();
  assert.deepEqual(seen, ['t1', 't2', 't3']);
  assert.equal(registry.snapshot()[0].lastError, null);
  ctx.clock.now += 60000;
  assert.doesNotThrow(() => registry.tick()); await flush();
  assert.equal(registry.snapshot()[0].lastError.code, 'error');
  ctx.clock.now += 120000; registry.tick(); await flush();
  assert.equal(seen.length, 6);
  registry.close();
});

test('at most two polls run at once; a stuck poll is aborted after two minutes', async t => {
  const release = [];
  const ctx = setup(t, () => new Promise(resolve => release.push(resolve)), [feed('a'), feed('b'), feed('c'), feed('d', {enabled:false})]);
  const registry = ctx.make(); registry.load();
  registry.tick(); registry.tick();
  assert.deepEqual(ctx.polls.map(p => p.id), ['a', 'b']);
  release[0]({cursor:null, events:[]}); await flush();
  registry.tick();
  assert.deepEqual(ctx.polls.map(p => p.id), ['a', 'b', 'c']);
  ctx.clock.now += 120000; registry.tick(); await flush();
  assert.ok(ctx.polls[1].signal.aborted && ctx.polls[2].signal.aborted);
  const byId = Object.fromEntries(registry.snapshot().map(s => [s.id, s]));
  assert.equal(byId.b.lastError.code, 'timeout');
  assert.equal(byId.d.lastCheckedAt, null);
  assert.deepEqual(ctx.polls.map(p => p.id), ['a', 'b', 'c', 'a']);
  registry.close();
});

test('configure validates, saves, keeps cursors of unchanged sources and aborts removed ones', async t => {
  let hang = false;
  const ctx = setup(t, (config, cursor) => (hang ? new Promise(() => {}) : Promise.resolve({cursor:{n:(cursor?.n || 0) + 1}, events:[]})), [feed('a'), feed('b')]);
  const registry = ctx.make(); registry.load();
  registry.tick(); await flush();
  assert.deepEqual(ctx.polls.map(p => p.cursor), [null, null]);
  assert.throws(() => registry.configure({version:1, sources:[feed('a', {url:'http://news.example/a.xml'})]}), {code:'sources_invalid'});
  assert.equal(registry.snapshot().length, 2);

  // Renaming keeps the cursor; pointing "b" elsewhere starts it from scratch.
  const snapshot = registry.configure({version:1, sources:[feed('a', {name:'Renamed', notify:'none'}), feed('b', {url:'https://other.example/b.xml'})]});
  assert.deepEqual(snapshot.map(s => [s.name, s.target]), [['Renamed', 'https://news.example/a.xml'], ['Feed b', 'https://other.example/b.xml']]);
  assert.equal(JSON.parse(fs.readFileSync(ctx.file, 'utf8')).sources[0].name, 'Renamed');
  assert.deepEqual(ctx.closed, ['b']);
  ctx.clock.now += 60000; registry.tick(); await flush();
  assert.deepEqual(ctx.polls.slice(2).map(p => [p.id, p.cursor]).sort(), [['a', {n:1}], ['b', null]]);

  // Disabling and re-enabling keeps the cursor too, and survives a restart.
  registry.configure([feed('a', {enabled:false}), feed('b', {url:'https://other.example/b.xml'})]);
  registry.configure([feed('a'), feed('b', {url:'https://other.example/b.xml'})]);
  ctx.clock.now += 60000; registry.tick(); await flush();
  assert.deepEqual(ctx.polls.slice(4).map(p => [p.id, p.cursor]).sort(), [['a', {n:2}], ['b', {n:1}]]);
  const state = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'sources-state.json'), 'utf8'));
  assert.deepEqual(Object.values(state.cursors).map(x => x.cursor), [{n:3}, {n:2}]);
  const restarted = ctx.make(); restarted.load(); restarted.tick(); await flush();
  assert.deepEqual(ctx.polls.slice(6).map(p => [p.id, p.cursor]).sort(), [['a', {n:3}], ['b', {n:2}]]);
  restarted.close();

  // Removing a source aborts its poll in flight; a late result is ignored.
  hang = true; ctx.clock.now += 60000; registry.tick();
  const inFlight = ctx.polls.slice(8);
  assert.equal(inFlight.length, 2);
  registry.configure([feed('a')]);
  assert.deepEqual(inFlight.map(p => [p.id, p.signal.aborted]), [['a', false], ['b', true]]);
  registry.close();
  assert.ok(inFlight[0].signal.aborted);
  assert.throws(() => registry.configure([]), /closed/);
});

test('a damaged source list loads as empty with a problem; tick stays quiet', t => {
  const ctx = setup(t, async () => ({cursor:null, events:[]}));
  fs.writeFileSync(ctx.file, '{"version":1,"sources":[{"id":"a"}]}');
  fs.writeFileSync(path.join(ctx.dir, 'sources-state.json'), 'garbage');
  const registry = ctx.make();
  assert.match(registry.load().problem, /ignored/);
  assert.equal(registry.problem, registry.load().problem);
  registry.tick();
  assert.deepEqual([registry.snapshot(), ctx.polls], [[], []]);
  registry.close();
});

test('failed cursor persistence withholds delivery, retries the old cursor and survives restart without replay', async t => {
  const ctx = setup(t, async (config, cursor) => cursor?.n === 1
    ? {cursor:{n:1}, events:[]}
    : {cursor:{n:1}, events:[event(config.id, 1)]});
  const state = path.join(ctx.dir, 'sources-state.json');
  fs.mkdirSync(state); // deterministic write failure, including when running as root
  const registry = ctx.make(); registry.load(); registry.tick(); await flush();
  assert.deepEqual(ctx.published, []);
  assert.equal(registry.snapshot()[0].lastError.code, 'state_unavailable');
  fs.rmdirSync(state);
  ctx.clock.now += 120000; registry.tick(); await flush();
  assert.equal(ctx.polls[1].cursor, null);
  assert.deepEqual(ctx.published, [['t1', 'a', 'both']]);
  assert.equal(registry.snapshot()[0].lastError, null);
  registry.close();
  const restarted = ctx.make(); restarted.load(); restarted.tick(); await flush();
  assert.deepEqual(ctx.polls[2].cursor, {n:1});
  assert.equal(ctx.published.length, 1);
  restarted.close();
});

test('an oversized cursor cannot publish events or erase the saved progress', async t => {
  let oversized = false;
  const ctx = setup(t, async () => ({cursor:oversized ? {text:'x'.repeat(1024*1024)} : {n:1}, events:oversized ? [event('a', 2)] : []}));
  const registry = ctx.make(); registry.load(); registry.tick(); await flush();
  const state = path.join(ctx.dir, 'sources-state.json'), saved = fs.readFileSync(state, 'utf8');
  oversized = true; ctx.clock.now += 60000; registry.tick(); await flush();
  assert.equal(registry.snapshot()[0].lastError.code, 'invalid_result');
  assert.deepEqual(ctx.published, []);
  assert.equal(fs.readFileSync(state, 'utf8'), saved);
  registry.close();
});
