'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const { install,uninstall,installed } = require('../src/core/integration.cjs');
const { readJSON,atomicJSON,drainInbox } = require('../src/core/files.cjs');
const { Store } = require('../src/core/store.cjs');
const { normalize } = require('../src/core/events.cjs');
const sourceDir=path.resolve(__dirname,'../src');
function fixture(t){const parent=process.env.ARCADE_TEST_TMP || os.tmpdir();fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'arcade-test-'));t.after(()=>{if(!path.resolve(root).startsWith(path.resolve(parent)+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true});});return root;}
test('installer preserves unrelated settings/hooks; repeat install and uninstall are safe',t=>{
 const root=fixture(t),settingsFile=path.join(root,'claude','settings.json');const original={permissions:{allow:['Read']},hooks:{Stop:[{matcher:'',hooks:[{type:'command',command:'echo original'}]}]}};
 atomicJSON(settingsFile,original);const result=install({root,settingsFile,sourceDir,nodePath:process.execPath});assert(result.backup);assert.equal(installed(settingsFile),true);
 const command=readJSON(settingsFile).hooks.Stop.at(-1).hooks[0];assert.equal(command.command,process.execPath);assert.deepEqual(command.args,[path.join(root,'bin','hook.cjs')]);
 install({root,settingsFile,sourceDir,nodePath:process.execPath});assert.equal(readJSON(settingsFile).hooks.Stop.length,2);assert.deepEqual(readJSON(settingsFile).permissions,original.permissions);
 uninstall(settingsFile);assert.deepEqual(readJSON(settingsFile),original);assert.equal(installed(settingsFile),false);
});
test('malformed settings are never overwritten',t=>{const root=fixture(t),settingsFile=path.join(root,'settings.json');fs.writeFileSync(settingsFile,'{oops');assert.throws(()=>install({root,settingsFile,sourceDir}));assert.equal(fs.readFileSync(settingsFile,'utf8'),'{oops');});
test('real hook subprocess → atomic inbox → reducer → persistent snapshot, without exposing input',t=>{
 const root=fixture(t);const hook=spawnSync(process.execPath,[path.join(sourceDir,'hook.cjs')],{input:JSON.stringify({session_id:'real',hook_event_name:'Stop',cwd:'/private/my-app',last_assistant_message:'SECRET',prompt:'SECRET'}),env:{...process.env,AGENT_ARCADE_HOME:root},encoding:'utf8'});
 assert.equal(hook.status,0);assert.equal(hook.stdout,'');assert.equal(hook.stderr,'');const s=new Store();const changes=drainInbox(root,s);assert.equal(changes.length,1);assert.equal(s.snapshot()[0].state,'done');assert(!JSON.stringify(s.export()).includes('SECRET'));assert.equal(fs.readdirSync(path.join(root,'inbox')).length,0);assert.equal(readJSON(path.join(root,'state.json')).tasks.length,1);
});
test('installed hook survives app source path changes and result capture can be revoked',t=>{
 const root=fixture(t);install({root,settingsFile:path.join(root,'settings.json'),sourceDir,nodePath:process.execPath});atomicJSON(path.join(root,'config.json'),{captureResults:true});
 const r=spawnSync(process.execPath,[path.join(root,'bin','hook.cjs')],{input:JSON.stringify({session_id:'r',hook_event_name:'Stop',last_assistant_message:'local result'}),env:{...process.env,AGENT_ARCADE_HOME:root}});assert.equal(r.status,0);const s=new Store();drainInbox(root,s,{captureResults:false});assert.equal(s.snapshot()[0].result,'');
});
test('malformed input exits quietly with success',t=>{const root=fixture(t);for(const input of ['invalid','{}','x'.repeat(2100000)]){const r=spawnSync(process.execPath,[path.join(sourceDir,'hook.cjs')],{input,env:{...process.env,AGENT_ARCADE_HOME:root}});assert.equal(r.status,0);assert.equal(r.stdout.toString(),'');}});
test('concurrent hook processes do not lose events or race to inconsistent observer keys',async t=>{
 const root=fixture(t);await Promise.all(Array.from({length:12},(_,i)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[path.join(sourceDir,'hook.cjs')],{env:{...process.env,AGENT_ARCADE_HOME:root},stdio:['pipe','pipe','pipe']});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(String(code))));p.stdin.end(JSON.stringify({session_id:`s-${i}`,hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:`t-${i}`,tool_input:{command:'fixture'}}));})));
 const observerKey=fs.readFileSync(path.join(root,'observer-key'));assert.equal(observerKey.length,32);
 for(const file of fs.readdirSync(path.join(root,'inbox'))){const e=readJSON(path.join(root,'inbox',file));assert.equal(e.toolKey,normalize({session_id:e.session,hook_event_name:'PreToolUse',tool_name:'Bash',tool_input:{command:'fixture'}},{observerKey}).toolKey);}
 const s=new Store();assert.equal(drainInbox(root,s).length,12);assert.equal(s.tasks.size,12);
});

test('UTF-8 reply capture survives stdin splitting inside a Chinese character',async t=>{
 const root=fixture(t);atomicJSON(path.join(root,'config.json'),{captureResults:true});
 const input=Buffer.from(JSON.stringify({session_id:'unicode',hook_event_name:'Stop',last_assistant_message:'回复结束🌱'}));
 const split=input.indexOf(Buffer.from('回'))+1;
 const p=spawn(process.execPath,[path.join(sourceDir,'hook.cjs')],{env:{...process.env,AGENT_ARCADE_HOME:root},stdio:['pipe','pipe','pipe']});
 const exited=new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',resolve);});
 p.stdin.write(input.subarray(0,split));await new Promise(resolve=>setTimeout(resolve,80));p.stdin.end(input.subarray(split));
 assert.equal(await exited,0);const s=new Store();drainInbox(root,s,{captureResults:true});assert.equal(s.snapshot()[0].result,'回复结束🌱');
});

test('independent real observer processes correlate official ID-less permissions without storing arguments',t=>{
 const root=fixture(t),s=new Store();
 const send=(name,extra)=>{
  const r=spawnSync(process.execPath,[path.join(sourceDir,'hook.cjs')],{input:JSON.stringify({session_id:'official-shape',hook_event_name:name,tool_name:'Bash',...extra}),env:{...process.env,AGENT_ARCADE_HOME:root},encoding:'utf8'});
  assert.equal(r.status,0);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
  const files=fs.readdirSync(path.join(root,'inbox'));const payload=readJSON(path.join(root,'inbox',files[0]));assert.match(payload.toolKey,/^[a-f0-9]{64}$/);assert(!JSON.stringify(payload).includes('PRIVATE_COMMAND'));
  drainInbox(root,s);return payload.toolKey;
 };
 const key=send('PreToolUse',{tool_use_id:'a',tool_input:{command:'PRIVATE_COMMAND',description:'first'}});
 send('PreToolUse',{tool_use_id:'b',tool_input:{command:'other'}});
 assert.equal(send('PermissionRequest',{tool_input:{description:'first',command:'PRIVATE_COMMAND'}}),key);assert.deepEqual(s.snapshot()[0].waitFor,['a']);
 send('PostToolUse',{tool_use_id:'b',tool_input:{command:'other'}});assert.equal(s.snapshot()[0].state,'waiting');
 send('PostToolUse',{tool_use_id:'a',tool_input:{command:'PRIVATE_COMMAND',description:'first'}});assert.equal(s.snapshot()[0].state,'running');
 assert.equal(fs.readFileSync(path.join(root,'observer-key')).length,32);
});
