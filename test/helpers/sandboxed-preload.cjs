'use strict';
// Runs src/preload.cjs the way Electron runs a sandboxed preload: as the body
// of a function that receives `require` and `process` as arguments. In that
// environment `process` is NOT a property of globalThis. A harness that passes
// it as a global of a fresh context accepts `globalThis.process`, which is
// undefined in the real window: every startup argument (appearance, platform)
// was silently ignored there while such tests stayed green.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preloadSource = () => fs.readFileSync(path.resolve(__dirname, '../../src/preload.cjs'), 'utf8');
function runSandboxedPreload({argv = [], electron, source = preloadSource()}) {
  const context = vm.createContext({});
  const wrapped = vm.runInContext(`(function (require, process, Buffer, global, setImmediate, clearImmediate, exports, module) {${source}\n})`, context, {filename: 'preload.cjs'});
  const exposed = {};
  const modules = electron || {contextBridge: {exposeInMainWorld: (name, value) => { exposed[name] = value; }}, ipcRenderer: {invoke: async () => null, send() {}, on() {}, removeListener() {}}};
  wrapped(name => { if (name !== 'electron') throw Error(`A sandboxed preload cannot require ${name}.`); return modules; }, {argv, platform: 'unknown'}, undefined, vm.runInContext('globalThis', context), () => {}, () => {}, {}, {exports: {}});
  return exposed;
}
module.exports = {runSandboxedPreload, preloadSource};
