'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Bus, MAX_SEEN, MAX_RECENT} = require('../src/core/bus.cjs');

test('delivers by source and kind family, and unsubscribes', () => {
  const bus = new Bus(), got = [];
  const off = bus.subscribe({source:'cal', kind:'calendar.'}, event => got.push(event.kind));
  bus.subscribe(event => event.kind === 'x', event => got.push('fn:' + event.kind));
  bus.publish({source:'cal', kind:'calendar.due'});
  bus.publish({source:'cal', kind:'folder.added'});
  bus.publish({source:'other', kind:'calendar.due'});
  bus.publish({source:'other', kind:'x'});
  off();
  bus.publish({source:'cal', kind:'calendar.upcoming'});
  assert.deepEqual(got, ['calendar.due', 'fn:x']);
});

test('drops a repeated id and bounds the remembered ids', () => {
  const bus = new Bus(); let count = 0;
  bus.subscribe(null, () => count++);
  assert.equal(bus.publish({id:'a', source:'s', kind:'k'}), true);
  assert.equal(bus.publish({id:'a', source:'s', kind:'k'}), false);
  for (let i = 0; i < MAX_SEEN; i++) bus.publish({id:'n' + i, source:'s', kind:'k'});
  assert.equal(bus.seen.size, MAX_SEEN);
  assert.equal(bus.publish({id:'a', source:'s', kind:'k'}), true, 'oldest id was forgotten');
  assert.equal(count, MAX_SEEN + 2);
});

test('a failing subscriber does not stop the others and events are frozen', () => {
  const errors = [], bus = new Bus({onError:error => errors.push(error.message)}), got = [];
  bus.subscribe(null, () => { throw Error('boom'); });
  bus.subscribe(null, event => { got.push(Object.isFrozen(event)); });
  bus.publish({source:'s', kind:'k'});
  assert.deepEqual(got, [true]);
  assert.deepEqual(errors, ['boom']);
});

test('nested publishing is bounded and invalid events are rejected', () => {
  const bus = new Bus(); let depth = 0;
  bus.subscribe(null, () => { depth++; bus.publish({source:'s', kind:'k'}); });
  bus.publish({source:'s', kind:'k'});
  assert.equal(depth, 4);
  assert.throws(() => bus.publish({source:'bad source', kind:'k'}));
  assert.throws(() => bus.publish({source:'s', kind:'k', id:''}));
  assert.throws(() => bus.subscribe(null, 'x'));
});

test('keeps a bounded list of display-safe recent events only', () => {
  const bus = new Bus();
  bus.publish({source:'s', kind:'internal', payload:{secret:1}});
  for (let i = 0; i < MAX_RECENT + 5; i++) bus.publish({id:'e' + i, at:i, source:'feed', kind:'feed.item', subject:'s', title:'t' + i, detail:'d', data:{x:1}, importance:'normal'});
  const recent = bus.recent(200);
  assert.equal(recent.length, MAX_RECENT);
  assert.equal(recent[0].title, 't' + (MAX_RECENT + 4));
  assert.deepEqual(Object.keys(recent[0]).sort(), ['at', 'id', 'importance', 'kind', 'source', 'subject', 'title']);
});
