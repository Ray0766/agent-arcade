'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync, execFileSync} = require('node:child_process');
const source = path.resolve(__dirname, '..');

function run(program, args, options={}) {
  const result = spawnSync(program,args,{stdio:'inherit',...options});
  if (result.error || result.status !== 0) throw result.error || Error(program+' failed: '+result.status);
}

function main() {
  assert(process.platform === 'darwin' && process.arch === 'arm64', 'Apple Silicon build host required');
  assert(process.argv.length === 3, 'Pass the Electron 45.2.1 macOS arm64 dist directory');
  const electronDist = fs.realpathSync(process.argv[2]);
  const packageMetadata = require('../package.json');
  assert.match(packageMetadata.version,/^0\.4\.0-preview\.61\.qa\.[1-9]\d*$/);
  const version = fs.readFileSync(path.join(electronDist,'version'),'utf8').trim().replace(/^v/,'');
  assert.equal(version,packageMetadata.devDependencies.electron);
  const machine = execFileSync('/usr/bin/lipo',['-archs',path.join(electronDist,'Electron.app/Contents/MacOS/Electron')],{encoding:'utf8'}).trim();
  assert.equal(machine,'arm64');
  assert(fs.existsSync(path.join(source,'node_modules/electron-builder/cli.js')),'Run npm ci --ignore-scripts first');
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}),'','Commit the QA build inputs');
  const commit = execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
  const stage = fs.mkdtempSync('/private/tmp/arcade-qq-qa-build.');
  const archive = path.join(stage,'build-inputs.tar');
  const project = path.join(stage,'project');
  fs.mkdirSync(project);
  run('git',['archive','--format=tar','--output',archive,commit],{cwd:source});
  run('/usr/bin/tar',['-xf',archive,'-C',project]);
  run('/bin/cp',['-cR',path.join(source,'node_modules'),path.join(project,'node_modules')]);
  const env={...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'};
  for(const name of Object.keys(env)){
    if(/^(?:APPLE_|CSC_|WIN_CSC_)/.test(name)&&name!=='CSC_IDENTITY_AUTO_DISCOVERY')delete env[name];
  }
  const output = path.join(stage,'artifacts');
  console.log('QA_BUILD_DIRECTORY '+stage+'\nQA_BUILD_SOURCE '+commit);
  run(process.execPath,[path.join(project,'node_modules/electron-builder/cli.js'),'--mac','dmg:arm64','zip:arm64',
    '--publish','never','--config.electronDist='+electronDist,'--config.directories.output='+output,
    '--config.extraMetadata.buildSourceCommit='+commit],{cwd:project,env});
  console.log('QA_BUILD_OUTPUT '+output);
}

if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
