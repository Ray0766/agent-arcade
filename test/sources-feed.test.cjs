'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createFeedSource, parseFeed} = require('../src/sources/feed.cjs');

const URL_ = 'https://news.example/feed.xml?key=abc';
const rssItem = (n, extra = '') => `<item><title>Item ${n}</title><link>https://news.example/${n}</link><guid>g-${n}</guid>${extra}</item>`;
const rss = items => `<?xml version="1.0"?><rss version="2.0"><channel><title>Channel title</title>${items.join('')}</channel></rss>`;
function feed(body, options = {}) {
  const state = {body, calls:0, init:{headers:{'content-type':'application/rss+xml; charset=utf-8'}}};
  const fetchImpl = async (url, request) => {
    state.calls++; state.request = request; state.url = url;
    return new Response(typeof state.body === 'function' ? state.body() : state.body, state.init);
  };
  return {state, src:createFeedSource({id:'news', url:URL_, fetchImpl, now:() => 7000, ...options})};
}

test('RSS items: CDATA, entities, tag stripping, unsafe links and dates', () => {
  const items = parseFeed(rss([
    '<item><title><![CDATA[Tom & <b>Jerry</b>]]></title><link>https://news.example/a?x=1&amp;y=2</link><guid isPermaLink="false">id-1</guid><pubDate>Tue, 10 Mar 2026 10:00:00 GMT</pubDate></item>',
    '<item><title>Caf&#233; &amp; &lt;script&gt;alert(1)&lt;/script&gt; &#x4E2D;&#25991; &unknown; &amp;lt;</title><link>javascript:alert(1)</link></item>',
    '<item><title>\u0007Only title</title></item>', '<item><description>nothing usable</description></item>']));
  assert.equal(items.length, 3);
  assert.deepEqual({...items[0], id:null}, {id:null, title:'Tom & Jerry', link:'https://news.example/a?x=1&y=2', publishedAt:Date.UTC(2026, 2, 10, 10)});
  assert.equal(items[1].title, 'Caf\u00e9 & alert(1) \u4e2d\u6587 &unknown; &lt;');
  assert.equal(items[1].link, '');
  assert.equal(items[2].title, 'Only title');
  assert.equal(new Set(items.map(x => x.id)).size, 3);
  assert.throws(() => parseFeed('<html><body>Sign in</body></html>'), {code:'invalid_feed'});
});

test('Atom entries: id, alternate link and published date', () => {
  const items = parseFeed(`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>
    <entry><title type="html">Release &amp;amp; notes</title><link rel="self" href="https://news.example/self"/>
      <link rel="alternate" href="https://news.example/r1"/><id>urn:1</id><published>2026-03-10T10:00:00Z</published><updated>2026-03-11T10:00:00Z</updated></entry>
    <entry><title>Second</title><link href='http://news.example/r2'/><id>urn:2</id><updated>2026-03-11T10:00:00Z</updated></entry>
    <entry><title>Third</title><link href="ftp://news.example/r3"/><id>urn:3</id></entry></feed>`);
  assert.deepEqual(items.map(x => [x.title, x.link, x.publishedAt]), [
    ['Release &amp; notes', 'https://news.example/r1', Date.UTC(2026, 2, 10, 10)],
    ['Second', 'http://news.example/r2', Date.UTC(2026, 2, 11, 10)], ['Third', '', null]]);
});

test('the first poll is a baseline; later polls emit each unseen item once', async () => {
  const {state, src} = feed(rss([rssItem(2), rssItem(1)]));
  assert.equal(src.target, 'https://news.example/feed.xml');
  let result = await src.poll(null);
  assert.deepEqual(result.events, []);
  assert.equal(state.request.redirect, 'manual');
  assert.equal(state.url, URL_);
  state.body = rss([rssItem(3), rssItem(2), rssItem(1)]);
  result = await src.poll(JSON.parse(JSON.stringify(result.cursor)));
  assert.equal(result.events.length, 1);
  const [event] = result.events;
  assert.deepEqual([event.kind, event.title, event.detail, event.at, event.subject], ['feed.item', 'Item 3', 'https://news.example/3', 7000, 'https://news.example/feed.xml']);
  assert.deepEqual((await src.poll(result.cursor)).events, []);
});

test('at most 20 items per poll, oldest first, and the seen list stays bounded', async () => {
  const numbers = Array.from({length:30}, (_, i) => 30 - i);
  const {state, src} = feed(rss([]));
  let result = await src.poll(null);
  state.body = rss(numbers.map(n => rssItem(n)));
  result = await src.poll(result.cursor);
  assert.deepEqual(result.events.map(e => e.title), Array.from({length:20}, (_, i) => `Item ${i + 1}`));
  result = await src.poll(result.cursor);
  assert.deepEqual(result.events.map(e => e.title), Array.from({length:10}, (_, i) => `Item ${i + 21}`));
  result = await src.poll({seen:[...Array.from({length:600}, (_, i) => `gone${i}`), ...result.cursor.seen]});
  assert.deepEqual(result.events, []);
  assert.equal(result.cursor.seen.length, 500);
  assert.deepEqual((await src.poll(result.cursor)).events, []);
});

test('redirects, HTTP errors and oversized bodies are rejected', async () => {
  const {state, src} = feed(null);
  state.init = {status:302, headers:{location:'https://evil.example/'}};
  await assert.rejects(src.poll(null), {code:'redirected'});
  state.init = {status:500}; state.body = 'oops';
  await assert.rejects(src.poll(null), {code:'http_error'});
  state.init = {}; state.body = 'x'.repeat(2 * 1024 * 1024 + 1);
  await assert.rejects(src.poll(null), {code:'too_large'});
  // No content-length to pre-check: the streaming cap still applies.
  state.body = () => new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(512 * 1024)); }});
  await assert.rejects(src.poll(null), {code:'too_large'});
});

test('an abort signal or the timeout stops a hanging request', async () => {
  const hang = () => new Promise(() => {});
  const controller = new AbortController();
  const pending = createFeedSource({id:'news', url:URL_, fetchImpl:hang}).poll(null, controller.signal);
  controller.abort();
  await assert.rejects(pending, {code:'aborted'});
  await assert.rejects(createFeedSource({id:'news', url:URL_, fetchImpl:hang}).poll(null, controller.signal), {code:'aborted'});
  await assert.rejects(createFeedSource({id:'news', url:URL_, fetchImpl:hang, timeoutMs:1000}).poll(null), {code:'timeout'});
});

test('page mode: baseline, then one event when the body hash changes', async () => {
  const {state, src} = feed('<html>v1</html>', {mode:'page'});
  let result = await src.poll(null);
  assert.deepEqual(result.events, []);
  assert.deepEqual((await src.poll(result.cursor)).events, []);
  state.body = '<html>v2 <script>ignore()</script></html>';
  result = await src.poll(result.cursor);
  assert.deepEqual(result.events.map(e => [e.kind, e.subject, e.title]), [['page.changed', 'https://news.example/feed.xml', 'Page changed']]);
  assert.deepEqual((await src.poll(result.cursor)).events, []);
});

test('only credential-free https URLs and bounded options are accepted', () => {
  for (const options of [{url:'http://news.example/feed'}, {url:'https://user:pass@news.example/feed'}, {url:'file:///c:/x'}, {url:'not a url'},
    {url:URL_, mode:'html'}, {url:URL_, intervalMs:299999}, {url:URL_, timeoutMs:0}, {}]) {
    assert.throws(() => createFeedSource({id:'news', fetchImpl:async () => {}, ...options}), {code:'invalid_input'}, JSON.stringify(options));
  }
});
