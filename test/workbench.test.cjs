'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {Workbench} = require('../src/workbench.cjs');
const {APP_SCRIPT_HASH, MAX_BYTES} = require('../src/mcp/extensions.cjs');

async function isolated(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcade-workbench-'));
  const workbench = new Workbench({root, discover: async () => {throw Error('File inspection must not discover or run Claude.');}});
  try {await run(workbench, root);} finally {await workbench.close(); await fs.rm(root, {recursive: true, force: true});}
}
async function complete(workbench, task) {
  // The public UI permits retrieval only once its polled state is complete.
  await (await workbench.localExtensions()).result(task.taskId);
  await workbench.updateInspections();
  return workbench.result(task.taskId);
}

test('Workbench inspects only explicitly selected text; hash matches original UTF-8 bytes including BOM', async () => {
  await isolated(async (workbench, root) => {
    for (const [name, bytes] of [
      ['unicode.txt', Buffer.from('小芽\r\nARCADE\n')],
      ['bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('BOM')])],
      ['empty.txt', Buffer.alloc(0)],
    ]) {
      const file = path.join(root, name); await fs.writeFile(file, bytes);
      const task = await workbench.inspectFile(file), result = (await complete(workbench, task)).structuredContent;
      assert.equal(result.label, name); assert.equal(result.bytes, bytes.length);
      assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.deepEqual(Buffer.from(result.preview, 'utf8'), bytes);
      assert.equal(workbench.snapshot().sessions, null);
      await assert.rejects(workbench.cancel(task.taskId), /terminal/);
    }
  });
});

test('Workbench rejects malformed UTF-8, excessive input and unavailable files without creating tasks', async () => {
  await isolated(async (workbench, root) => {
    const malformed = path.join(root, 'malformed.txt'); await fs.writeFile(malformed, Buffer.from([0xc3, 0x28]));
    await assert.rejects(workbench.inspectFile(malformed), /valid UTF-8/);
    const oversized = path.join(root, 'oversized.txt'); await fs.writeFile(oversized, Buffer.alloc(MAX_BYTES + 1, 97));
    await assert.rejects(workbench.inspectFile(oversized), /256 KiB/);
    const tooManyCharacters = path.join(root, 'too-many.txt'); await fs.writeFile(tooManyCharacters, 'x'.repeat(65537));
    await assert.rejects(workbench.inspectFile(tooManyCharacters), /65,536/);
    await assert.rejects(workbench.inspectFile(path.join(root, 'missing.txt')));
    await assert.rejects(workbench.inspectFile(root));
    assert.deepEqual(workbench.snapshot().inspections, []);
  });
});

test('Workbench result, cancellation and fixed viewer resource stay inside the inspection service', async () => {
  await isolated(async workbench => {
    await assert.rejects(workbench.cancel('not-a-task'), /Unknown inspection/);
    await assert.rejects(workbench.result('not-a-task'), /not complete or has expired/);
    const task = await workbench.sample(), result = await complete(workbench, task);
    assert.equal(result.structuredContent.jsonValid, true);
    assert.match(result.structuredContent.preview, /no model task/);
    const resource = await workbench.resource();
    const script = resource.text.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.equal(`sha256-${createHash('sha256').update(script).digest('base64')}`, APP_SCRIPT_HASH);
    assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
    assert.match(resource.text, /connect-src 'none'/);
    await workbench.close();
    await assert.rejects(workbench.sample(), /closed/);
  });
});

test('Workbench cannot switch project or start a competing action while CLI discovery is pending', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcade-workbench-race-'));
  const second = path.join(root, 'second'); await fs.mkdir(second);
  let failDiscovery;
  const gate = new Promise((_resolve, reject) => {failDiscovery = reject;});
  const workbench = new Workbench({root, discover: () => gate});
  try {
    workbench.choose(root);
    const operation = workbench.create('Keep this task in the original project');
    assert.throws(() => workbench.choose(second), /current session operation/);
    await assert.rejects(workbench.change('12345678', 'stop'), /current session operation/);
    assert.equal(workbench.snapshot().workspace, await fs.realpath(root));
    failDiscovery(Error('Discovery fixture stopped before running any CLI.'));
    await assert.rejects(operation, /fixture stopped/);
    workbench.choose(second);
    assert.equal(workbench.snapshot().workspace, await fs.realpath(second));
    await assert.rejects(workbench.change('12345678', 'constructor'), /Unknown session operation/);
  } finally {failDiscovery(Error('Finished')); await workbench.close(); await fs.rm(root, {recursive: true, force: true});}
});

test('Workbench ignores an older inspection list arriving after a newer completed state', async () => {
  await isolated(async workbench => {
    const resolvers = [];
    workbench.extensions = Promise.resolve({list: () => new Promise(resolve => resolvers.push(resolve)), close: async () => {}});
    workbench.labels.set('same-task', 'Latest file.txt');
    const older = workbench.updateInspections(), newer = workbench.updateInspections();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolvers.length, 2);
    resolvers[1]([{taskId: 'same-task', status: 'completed'}]); await newer;
    resolvers[0]([{taskId: 'same-task', status: 'working'}]); await older;
    assert.equal(workbench.snapshot().inspections[0].status, 'completed');
    assert.equal(workbench.snapshot().inspections[0].label, 'Latest file.txt');
  });
});

test('Workbench does not publish an in-flight inspection response after closing', async () => {
  await isolated(async workbench => {
    let resolveList, publications = 0;
    workbench.onChange = () => {publications++;};
    workbench.extensions = Promise.resolve({list: () => new Promise(resolve => {resolveList = resolve;}), close: async () => {}});
    const pending = workbench.updateInspections();
    await new Promise(resolve => setImmediate(resolve));
    await workbench.close(); resolveList([{taskId: 'old-task', status: 'completed'}]); await pending;
    assert.equal(publications, 0); assert.deepEqual(workbench.snapshot().inspections, []);
  });
});

test('closing Workbench while discovering Claude cannot launch a background session afterward', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arcade-workbench-close-'));
  let finishDiscovery;
  const gate = new Promise(resolve => {finishDiscovery = resolve;});
  const workbench = new Workbench({root, discover: () => gate});
  try {
    workbench.choose(root);
    const pending = workbench.create('This launch must be cancelled before starting.');
    await workbench.close(); finishDiscovery({cli: process.execPath});
    await assert.rejects(pending, /closed/);
    assert.equal(workbench.background, null);
    await assert.rejects(fs.access(path.join(root, 'background-sessions.json')));
  } finally {finishDiscovery({cli: process.execPath}); await workbench.close(); await fs.rm(root, {recursive: true, force: true});}
});
