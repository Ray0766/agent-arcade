'use strict';
// Runs the unit tests: node scripts/test.cjs [node --test options] [test files]
// With no file named, every test/*.test.cjs runs.
//
// The one thing this adds to a plain `node --test` is a temporary directory
// whose path is already in its resolved form. The fixtures create their folders
// under os.tmpdir() and compare those paths with resolved ones, and several
// modules refuse a data folder whose path differs from its resolved path.
// - macOS: the default is /var/folders/..., and /var is a link to /private/var.
//   A plain `node --test test/*.test.cjs` fails there by the hundreds.
// - Windows: a GitHub runner's TEMP is an 8.3 short name (C:\Users\RUNNER~1\...),
//   which src/qq-supervisor/ownership.cjs refuses; realpathSync.native expands it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
// The variables os.tmpdir() reads on each platform, set to the resolved
// directory; an empty object when the directory is already in that form.
function tempEnvironment({platform = process.platform, tmpdir = os.tmpdir(), realpath = platform === 'win32' ? fs.realpathSync.native : fs.realpathSync} = {}) {
  const resolved = realpath(tmpdir);
  if (typeof resolved !== 'string' || !resolved || resolved === tmpdir) return {};
  return platform === 'win32' ? {TEMP: resolved, TMP: resolved} : {TMPDIR: resolved};
}
function split(argv) {
  const options = [], files = [];
  for (const value of argv) (value.startsWith('-') ? options : files).push(value);
  return {options, files};
}
function allTests(directory = path.join(root, 'test')) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.test.cjs')).sort().map(name => path.join('test', name));
}

if (require.main === module) {
  const {options, files} = split(process.argv.slice(2)), temp = tempEnvironment(), env = {...process.env, ...temp};
  if (Object.keys(temp).length) console.error(`Temporary directory for this run: ${Object.values(temp)[0]}`);
  const result = spawnSync(process.execPath, ['--test', ...options, ...(files.length ? files : allTests())], {cwd: root, env, stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exit(result.status === null ? 1 : result.status);
}
module.exports = {tempEnvironment, split, allTests};
