'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {makeEvent, KINDS, isKind} = require('../src/sources/event.cjs');

const base = {source:'cal-1', kind:'calendar.upcoming', subject:'uid-1', title:'Stand-up', at:1000, key:'k1'};

test('the same real-world item always gets the same id and the envelope is frozen', () => {
  const a = makeEvent(base), b = makeEvent({...base, title:'Renamed', at:2000, detail:'x'});
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, makeEvent({...base, key:'k2'}).id);
  assert.notEqual(a.id, makeEvent({...base, source:'cal-2'}).id);
  assert.deepEqual(Object.keys(a), ['id', 'at', 'source', 'kind', 'subject', 'title', 'detail', 'importance', 'data']);
  assert.equal(a.importance, 'normal');
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.data));
  assert.ok(Object.isFrozen(KINDS) && isKind('feed.item') && !isKind('feed.other') && !isKind(1));
});

test('text is stripped of control characters and truncated without throwing', () => {
  const event = makeEvent({...base, title:`a\u0000b\u001b[31m\u202e${'x'.repeat(5000)}`, detail:'line1\r\nline2', subject:'s'.repeat(900)});
  assert.equal(event.title.length, 200);
  assert.ok(!/[\u0000-\u001f\u202e]/.test(event.title));
  assert.ok(event.title.startsWith('a b [31m'));
  assert.equal(event.detail, 'line1 line2');
  assert.equal(event.subject.length, 200);
});

test('oversized or unserializable data is dropped to an empty object', () => {
  assert.deepEqual(makeEvent({...base, data:{a:'y'.repeat(3000)}}).data, {});
  const cyclic = {}; cyclic.self = cyclic;
  assert.deepEqual(makeEvent({...base, data:cyclic}).data, {});
  const kept = makeEvent({...base, data:{n:1, nested:{ok:true}}});
  assert.deepEqual(kept.data, {n:1, nested:{ok:true}});
  assert.ok(Object.isFrozen(kept.data.nested));
});

test('wrong types are rejected', () => {
  for (const patch of [{source:'bad id'}, {source:'x'.repeat(65)}, {kind:'nope'}, {title:5}, {subject:null}, {detail:{}}, {at:1.5}, {at:'1'},
    {importance:'urgent'}, {data:[]}, {data:'x'}, {key:{}}]) {
    assert.throws(() => makeEvent({...base, ...patch}), TypeError, JSON.stringify(patch));
  }
  assert.throws(() => makeEvent(null), TypeError);
});
