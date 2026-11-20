'use strict';
// Explicit local inspection/configuration only; never launches a QQ bridge.
const {inspectMacQQBridge, prepareMacQQBridge} = require('../src/bot/mac-qq-bridge.cjs');
function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--runtime', '--node', '--prepare-new', '--account', '--port'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--') || options[name] !== undefined) {
      throw Error('Usage: node scripts/inspect-mac-qq-bridge.cjs --runtime ABSOLUTE_DIR [--node OFFICIAL_NODE_24_PLUS] [--prepare-new NEW_ABSOLUTE_DIR --account DEDICATED_AI_QQ --port 3001]');
    }
    options[name] = args[++i];
  }
  if (!options['--runtime'] || (!options['--prepare-new'] && (options['--account'] || options['--port']))) throw Error('A runtime is required; account/port are only used with --prepare-new.');
  const result = options['--prepare-new'] ? prepareMacQQBridge({runtimeRoot: options['--runtime'], nodeExecutable: options['--node'],
    targetDirectory: options['--prepare-new'], accountId: options['--account'], port: options['--port'] === undefined ? 3001 : Number(options['--port'])}) :
    inspectMacQQBridge(options['--runtime'], {nodeExecutable: options['--node']});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(JSON.stringify({ok: false, code: error.code || 'invalid_arguments', message: error.message}) + '\n'); process.exitCode = 1; }
}
module.exports = {main};
