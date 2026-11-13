'use strict';
// Runs the unit tests: node scripts/test.cjs [node --test options] [test files]
// With no file named, every test/*.test.cjs runs.
//
// The one thing this adds to a plain `node --test` is a temporary directory
// whose path contains no symbolic link. The fixtures create their folders under
// os.tmpdir() and compare those paths with resolved ones, and several modules
// refuse a data folder that sits behind a link. The default macOS temporary
// directory is /var/folders/..., and /var is a link to /private/var, so a plain
// `node --test test/*.test.cjs` fails there by the hundreds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
// Windows keeps its own TEMP untouched: resolving it there can turn a short
// (8.3) path into a long one, which is a different change with its own risks.
function linkFreeTemp({platform = process.platform, tmpdir = os.tmpdir(), realpath = fs.realpathSync} = {}) {
  if (platform === 'win32') return null;
  const resolved = realpath(tmpdir);
  return resolved === tmpdir ? null : resolved;
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
  const {options, files} = split(process.argv.slice(2)), env = {...process.env}, temp = linkFreeTemp();
  if (temp) { env.TMPDIR = temp; console.error(`Temporary directory for this run: ${temp}`); }
  const result = spawnSync(process.execPath, ['--test', ...options, ...(files.length ? files : allTests())], {cwd: root, env, stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exit(result.status === null ? 1 : result.status);
}
module.exports = {linkFreeTemp, split, allTests};
