'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('fresh workbench import stays SDK-free; first inspection loads and reuses real MCP dependencies', {timeout: 15000}, () => {
  const script = String.raw`
    const assert = require('node:assert/strict');
    for (const name of ['node:http', 'node:https']) {
      const module = require(name);
      module.request = module.get = () => {throw Error('Network is forbidden in this test');};
    }
    require('node:net').Socket.prototype.connect = () => {throw Error('Sockets are forbidden in this test');};
    global.fetch = () => {throw Error('Fetch is forbidden in this test');};
    const childProcess = require('node:child_process');
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      childProcess[name] = () => {throw Error('Nested processes are forbidden in this test');};
    }
    const sdkEntries = () => Object.entries(require.cache).filter(([file]) =>
      /node_modules[\\/](?:@modelcontextprotocol[\\/]sdk|zod)[\\/]/.test(file));
    (async () => {
      require('./src/workbench.cjs');
      const extensions = require('./src/mcp/extensions.cjs');
      assert.equal(sdkEntries().length, 0);
      assert.deepEqual(Object.keys(extensions), ['createExtensionsServer', 'createLocalExtensions', 'inspectText', 'APP_URI', 'APP_SCRIPT_HASH', 'MAX_TEXT', 'MAX_BYTES']);
      const direct = await extensions.inspectText({text: 'direct', label: 'direct.txt'}, new AbortController().signal);
      assert.equal(direct.structuredContent.preview, 'direct');
      assert.equal(sdkEntries().length, 0);
      let first, second;
      try {
        first = await extensions.createLocalExtensions();
        const loaded = new Map(sdkEntries());
        assert.ok([...loaded.keys()].some(file => /@modelcontextprotocol/.test(file)));
        assert.ok([...loaded.keys()].some(file => /[\\/]zod[\\/]/.test(file)));
        const task = await first.inspect({text: '{"lazy":true}'});
        const result = await first.result(task.taskId);
        assert.equal(result.structuredContent.label, 'Text artifact');
        assert.equal(result.structuredContent.preview, '{"lazy":true}');
        assert.equal(result.structuredContent.verification, 'supplied-text-only');
        assert.equal((await first.get(task.taskId)).status, 'completed');
        assert.equal((await first.resource()).uri, extensions.APP_URI);
        second = await extensions.createLocalExtensions();
        const task2 = await second.inspect({text: 'second', label: 'second.txt'});
        assert.equal((await second.result(task2.taskId)).structuredContent.preview, 'second');
        await assert.rejects(second.get(task.taskId), /not found/);
        const reused = sdkEntries();
        assert.equal(reused.length, loaded.size);
        for (const [file, module] of reused) assert.equal(module, loaded.get(file));
        process.stdout.write(JSON.stringify({importSdkModules: 0, firstUseSdkModules: loaded.size, reused: true}));
      } finally {
        if (second) await second.close();
        if (first) await first.close();
      }
    })().catch(error => {console.error(error); process.exitCode = 1;});
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 12000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const observation = JSON.parse(result.stdout);
  assert.equal(observation.importSdkModules, 0);
  assert.ok(observation.firstUseSdkModules > 0);
  assert.equal(observation.reused, true);
});
