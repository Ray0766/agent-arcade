'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {CreateTaskResultSchema, CallToolResultSchema} = require('@modelcontextprotocol/sdk/types.js');
const {createLocalExtensions, APP_URI, APP_SCRIPT_HASH, MAX_TEXT} = require('../src/mcp/extensions.cjs');
const {BoundedTaskStore} = require('../src/mcp/task-store.cjs');

test('MCP task inspects real input through negotiated protocol and resource metadata', async () => {
  const api = await createLocalExtensions();
  try {
    const text = '{"answer":"小芽","html":"<img onerror=bad()>"}\n';
    const task = await api.inspect({text, label: 'result.json'});
    assert.equal(task.status, 'working'); assert.equal(task.ttl, 60000);
    const result = await api.result(task.taskId);
    assert.equal(result.structuredContent.bytes, Buffer.byteLength(text));
    assert.equal(result.structuredContent.sha256, createHash('sha256').update(text).digest('hex'));
    assert.equal(result.structuredContent.preview, text);
    assert.equal(result.structuredContent.jsonValid, true);
    assert.equal(result.structuredContent.verification, 'supplied-text-only');
    assert.equal((await api.get(task.taskId)).status, 'completed');
    assert.equal((await api.list()).length, 1);
    await assert.rejects(api.cancel(task.taskId), /terminal/);
    const resource = await api.resource();
    assert.equal(resource.uri, APP_URI); assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
    assert.match(resource.text, /connect-src 'none'/);
    assert.ok(resource.text.includes(APP_SCRIPT_HASH));
    const script = resource.text.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.equal(`sha256-${createHash('sha256').update(script).digest('base64')}`, APP_SCRIPT_HASH);
    assert.doesNotMatch(resource.text, /innerHTML|fetch\(|XMLHttpRequest|src="https?:/);
    assert.match(resource.text, /event.source !== parent/);
  } finally {await api.close();}
});

test('MCP cancellation stops the inspection worker and cannot become completed later', async () => {
  let release, chunks = 0;
  const gate = new Promise(resolve => {release = resolve;});
  const api = await createLocalExtensions({yieldWork: async () => {chunks++; await gate;}});
  try {
    const task = await api.inspect({text: 'x'.repeat(65536), label: 'cancel.txt'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await api.cancel(task.taskId)).status, 'cancelled');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(chunks <= 1); assert.equal((await api.get(task.taskId)).status, 'cancelled');
    assert.equal((await api.result(task.taskId)).isError, true);
  } finally {release(); await api.close();}
});

test('bounded task store keeps original expiry, rejects cross-session access and enforces capacity', async () => {
  let at = 1000000;
  const store = new BoundedTaskStore({now: () => at, limit: 2});
  try {
    const a = await store.createTask({ttl: 1000}, 1, {}, 'a');
    const b = await store.createTask({ttl: null}, 2, {}, 'b');
    assert.equal(b.ttl, 60000);
    assert.equal(await store.getTask(a.taskId, 'b'), null);
    assert.equal(await store.getTask(a.taskId), null);
    assert.equal((await store.listTasks(undefined, 'a')).tasks.length, 1);
    await assert.rejects(store.storeTaskResult(a.taskId, 'completed', {}, 'b'));
    await assert.rejects(store.createTask({ttl: 1000}, 3, {}, 'a'), /capacity/);
    const signal = store.signal(a.taskId, 'a'); at += 900;
    await store.storeTaskResult(a.taskId, 'completed', {content: []}, 'a');
    at += 101;
    assert.equal(await store.getTask(a.taskId, 'a'), null);
    assert.equal(signal.aborted, true);
    const c = await store.createTask({ttl: 999999999}, 4, {}, 'a');
    assert.equal(c.ttl, 300000);
  } finally {store.close();}
});

test('inspection rejects oversized input and limits previews without changing full hash', async () => {
  const api = await createLocalExtensions();
  try {
    await assert.rejects(api.inspect({text: 'x'.repeat(MAX_TEXT + 1), label: 'large'}));
    const text = '中'.repeat(40000);
    const task = await api.inspect({text, label: 'bounded.txt'});
    const result = (await api.result(task.taskId)).structuredContent;
    assert.equal(result.bytes, 120000); assert.equal(result.preview.length, 32768);
    assert.equal(result.truncated, true);
    assert.equal(result.sha256, createHash('sha256').update(text).digest('hex'));
    const other = await createLocalExtensions();
    try {await assert.rejects(other.get(task.taskId), /not found/);} finally {await other.close();}
  } finally {await api.close();}
});

test('bundled MCP App enforces handshake/source, renders hostile text literally and tolerates malformed JSON', () => {
  const nodes = new Map(), sent = []; let receive;
  const parent = {postMessage: message => sent.push(message)};
  const document = {getElementById: id => {
    if (!nodes.has(id)) nodes.set(id, {textContent: '', addEventListener(_event, callback) {this.click = callback;}});
    return nodes.get(id);
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/mcp/result-app.js'), 'utf8'), {parent, document, addEventListener: (_type, callback) => {receive = callback;}});
  assert.equal(sent[0].method, 'ui/initialize');
  const result = {jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {structuredContent: {label: '<b>literal</b>', preview: '<img src=x onerror=bad()>', sha256: 'a'.repeat(64), bytes: 25, lines: 1, jsonValid: false, truncated: false}}};
  receive({source: parent, data: result}); assert.equal(nodes.get('artifact-body').textContent, '');
  receive({source: parent, data: {jsonrpc: '2.0', id: 'arcade-initialize', result: {protocolVersion: '2026-01-26'}}});
  assert.equal(sent.at(-1).method, 'ui/notifications/initialized');
  receive({source: {}, data: result}); assert.equal(nodes.get('artifact-body').textContent, '');
  receive({source: parent, data: result}); assert.equal(nodes.get('artifact-body').textContent, '<img src=x onerror=bad()>');
  assert.equal(nodes.get('artifact-title').textContent, '<b>literal</b>');
  result.params.structuredContent = {...result.params.structuredContent, preview: '{', jsonValid: true};
  receive({source: parent, data: result}); nodes.get('artifact-json').click(); assert.equal(nodes.get('artifact-body').textContent, '{');
  receive({source: parent, data: {jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown'}});
  assert.equal(nodes.get('artifact-body').textContent, ''); assert.equal(sent.at(-1).id, 7);
});

test('stdio MCP interoperability: discovery, required task call, get/list/result and cancellation', {timeout: 15000}, async () => {
  const transport = new StdioClientTransport({command: process.execPath, args: [path.resolve(__dirname, '../src/mcp/server.cjs')], stderr: 'pipe'});
  const client = new Client({name: 'arcade-test', version: '1.0.0'}, {capabilities: {tasks: {}}});
  try {
    await client.connect(transport);
    assert.deepEqual(client.getServerCapabilities().tasks.requests.tools.call, {});
    const tools = await client.listTools();
    assert.equal(tools.tools[0].execution.taskSupport, 'required');
    assert.equal(tools.tools[0]._meta.ui.resourceUri, APP_URI);
    const resource = await client.readResource({uri: APP_URI});
    assert.match(resource.contents[0].text, /ui\/notifications\/initialized/);
    await assert.rejects(client.callTool({name: 'inspect_text', arguments: {text: 'x'}}), /requires task-based execution/);
    const {task} = await client.request({method: 'tools/call', params: {name: 'inspect_text', arguments: {text: 'ARCADE_MCP_STDIO', label: 'stdio.txt'}, task: {ttl: 10000}}}, CreateTaskResultSchema);
    const result = await client.experimental.tasks.getTaskResult(task.taskId, CallToolResultSchema, {timeout: 5000});
    assert.equal(result.structuredContent.preview, 'ARCADE_MCP_STDIO');
    assert.equal((await client.experimental.tasks.getTask(task.taskId)).status, 'completed');
    assert.ok((await client.experimental.tasks.listTasks()).tasks.some(t => t.taskId === task.taskId));
    await assert.rejects(client.experimental.tasks.cancelTask('not-a-task'), /not found/);
  } finally {await client.close(); await transport.close();}
});
