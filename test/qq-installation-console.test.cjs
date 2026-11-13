'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {QQConsole}=require('../src/bot/qq-console.cjs');
const {readInstallationSettings,writeInstallationSettings}=require('../src/bot/qq-installation-settings.cjs');
const ID='12345001';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-installation-selection-')),root=path.join(base,'app'),componentStoreRoot=path.join(base,'shared-components'),legacy=path.join(base,'existing-desktop'),setupId=randomUUID(),descriptorSha256='a'.repeat(64);for(const dir of [root,componentStoreRoot,legacy])fs.mkdirSync(dir);
  const state={digest:descriptorSha256,readCalls:[],factories:[],runtimes:[],starts:0,stops:0,discoverHook:null,listHook:null,oldRows:[],oldIssue:null,candidateConfigured:true};
  const options={root,componentStoreRoot,lockRoot:path.join(base,'locks'),managedSetupReader:value=>{state.readCalls.push(value);assert.equal(value.root,componentStoreRoot);assert.equal(value.setupId,setupId);return{setupId,descriptorSha256:state.digest};},runtimeFactory:opts=>{
    const kind=opts.managedInstallation?'managed-shell':'legacy';if(opts.managedInstallation)opts.managedInstallation();state.factories.push(kind);
    const runtime={kind,desktopDataRoot:opts.desktopDataRoot||legacy,componentStoreRoot:opts.componentStoreRoot,lockRoot:opts.lockRoot,runs:new Map(),pending:new Set(),discover:async()=>{await state.discoverHook?.(runtime);return{configured:kind==='managed-shell'?state.candidateConfigured:true,issue:kind==='legacy'?state.oldIssue:null,desktopRunning:false,instances:kind==='legacy'?structuredClone(state.oldRows):[]};},instance:()=>({}),getConnections:async()=>new Map(),close:async()=>({closed:true,failures:[]}),start:async()=>{state.starts++;},stop:async()=>{state.stops++;},withConfigurationLock:async()=>assert.fail('No configuration writes in installation selection')};state.runtimes.push(runtime);return runtime;
  },profileFactory:()=>({list:async()=>{await state.listHook?.();return[];}})};
  const manager=new QQConsole(options);t.after(async()=>{await manager.close();const resolved=fs.realpathSync(base),temp=fs.realpathSync(os.tmpdir());assert(resolved.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(base,{recursive:true,force:true});});
  return{base,root,componentStoreRoot,legacy,setupId,descriptorSha256,request:{setupId,descriptorSha256},state,options,manager};
}
test('selection persists exact managed identity and the explicit previous legacy location without starting',async t=>{
  const f=fixture(t),result=await f.manager.setManagedSetup(f.request);assert(result.committed);assert.equal(result.automaticStart,false);assert.equal(result.installation.current.kind,'managed-shell');assert.equal(result.installation.previous.kind,'legacy');assert(result.installation.canReturn);assert.doesNotMatch(JSON.stringify(result.installation),/existing-desktop|shared-components|descriptorSha256/);
  const saved=JSON.parse(fs.readFileSync(f.manager.file,'utf8'));assert.deepEqual(saved,{version:2,current:{kind:'managed-shell',...f.request},previous:{kind:'legacy',desktopDataRoot:f.legacy}});const reopened=new QQConsole(f.options);assert.equal(reopened.runtime.kind,'managed-shell');assert.equal(reopened.installationSelection().current.setupId,f.setupId);assert.equal(f.state.starts,0);assert.equal(f.state.stops,0);await reopened.close();
  const back=await f.manager.setPreviousInstallation();assert(back.committed);assert.equal(back.installation.current.kind,'legacy');assert.equal(f.manager.runtime.desktopDataRoot,f.legacy);assert.equal(back.installation.previous.setupId,f.setupId);await assert.rejects(f.manager.setDirectory(f.legacy),{code:'already_selected'});
});
test('legacy v1 is read without rewriting and retained when selecting a new managed setup',async t=>{
  const f=fixture(t),old=Buffer.from(JSON.stringify({version:1,desktopDataRoot:f.legacy}));fs.writeFileSync(f.manager.file,old);const reopened=new QQConsole(f.options);assert(fs.readFileSync(f.manager.file).equals(old));await reopened.setManagedSetup(f.request);assert.equal(JSON.parse(fs.readFileSync(f.manager.file)).previous.desktopDataRoot,f.legacy);await reopened.close();
});
test('owned, unknown, external and residual old accounts prevent replacing their manager',async t=>{
  for(const row of [{management:'owned'},{management:'unknown'},{management:'external',processRunning:true},{management:'recoverable',recoveryRequired:true}]){const f=fixture(t);f.state.oldRows=[{accountId:ID,...row}];await assert.rejects(f.manager.setManagedSetup(f.request),{code:'operation_in_progress'});assert(!fs.existsSync(f.manager.file));assert.equal(f.state.factories.length,1);assert.equal(f.state.stops,0);}
  const f=fixture(t);f.manager.runtime.runs.set(ID,{});await assert.rejects(f.manager.setManagedSetup(f.request),{code:'operation_in_progress'});
});
test('only the coordinator own reservation is admitted and it blocks lifecycle operations',async t=>{
  const f=fixture(t);f.manager.busy.add('qq-setup');await assert.rejects(f.manager.setManagedSetup(f.request),{code:'operation_in_progress'});await assert.rejects(f.manager.perform('start',{accountId:ID}),{code:'operation_in_progress'});await assert.rejects(f.manager.setManagedSetup(f.request,{operationMarker:'qq-setup'}),{code:'installation_selection_invalid'});let checks=0;
  f.manager.busy.add('another');await assert.rejects(f.manager.setManagedSetup(f.request,{operationMarker:'qq-setup',assertCurrent:()=>{checks++;}}),{code:'operation_in_progress'});f.manager.busy.delete('another');const result=await f.manager.setManagedSetup(f.request,{operationMarker:'qq-setup',assertCurrent:()=>{checks++;}});assert(result.committed);assert(checks>=4);assert.deepEqual([...f.manager.busy],['qq-setup']);f.manager.busy.clear();assert.equal(f.state.starts,0);
});
test('a descriptor that changes while discovering the candidate cannot be selected',async t=>{
  const f=fixture(t);f.state.discoverHook=runtime=>{if(runtime.kind==='managed-shell')f.state.digest='b'.repeat(64);};await assert.rejects(f.manager.setManagedSetup(f.request),{code:'managed_installation_changed'});assert(!fs.existsSync(f.manager.file));assert.equal(f.manager.runtime.kind,'legacy');
});
test('candidate discovery failure and old runtime becoming active leave selection unchanged',async t=>{
  const f=fixture(t);f.state.candidateConfigured=false;await assert.rejects(f.manager.setManagedSetup(f.request),{code:'missing_components'});assert(!fs.existsSync(f.manager.file));
  f.state.candidateConfigured=true;f.state.discoverHook=runtime=>{if(runtime.kind==='managed-shell')f.state.oldRows=[{management:'owned'}];};await assert.rejects(f.manager.setManagedSetup(f.request),{code:'operation_in_progress'});assert(!fs.existsSync(f.manager.file));
});
test('unobservable original or candidate installation never masquerades as a safely empty environment',async t=>{
  for(const issue of ['managed_installation_changed','unsafe_path','selection_invalid']){const f=fixture(t);f.state.oldIssue=issue;await assert.rejects(f.manager.setManagedSetup(f.request),{code:'process_check_failed'});assert(!fs.existsSync(f.manager.file));assert.equal(f.state.factories.length,1);}
  const f=fixture(t),factory=f.manager.runtimeFactory;f.manager.runtimeFactory=options=>{const runtime=factory(options);runtime.discover=async()=>({configured:true,issue:'unsafe_path',instances:[]});return runtime;};await assert.rejects(f.manager.setManagedSetup(f.request),{code:'missing_components'});assert(!fs.existsSync(f.manager.file));assert.equal(f.state.starts,0);
});
test('abort and close during candidate discovery never commit or start a runtime',async t=>{
  for(const mode of ['abort','close']){const f=fixture(t),gate=deferred(),entered=deferred(),controller=new AbortController();f.state.discoverHook=async runtime=>{if(runtime.kind==='managed-shell'){entered.resolve();await gate.promise;}};const operation=f.manager.setManagedSetup(f.request,{signal:controller.signal});const rejected=assert.rejects(operation,{code:mode==='abort'?'cancelled':'changed'});await entered.promise;let closing;if(mode==='abort')controller.abort();else closing=f.manager.close();await tick();gate.resolve();await rejected;if(closing)await closing;assert(!fs.existsSync(f.manager.file));assert.equal(f.state.starts,0);assert.equal(f.state.stops,0);}
});
test('a committed selection is retained when refresh fails or a later observer cancels',async t=>{
  const f=fixture(t),controller=new AbortController();f.state.listHook=()=>{controller.abort();throw Object.assign(Error('PRIVATE_REFRESH_DETAILS'),{code:'connection_failed'});};const result=await f.manager.setManagedSetup(f.request,{signal:controller.signal});assert(result.committed);assert(result.refreshIssue);assert.equal(f.manager.runtime.kind,'managed-shell');assert.equal(JSON.parse(fs.readFileSync(f.manager.file)).current.setupId,f.setupId);assert(!JSON.stringify(result).includes('PRIVATE_REFRESH_DETAILS'));
});
test('malformed or linked selection records do not silently construct a legacy runtime',async t=>{
  for(const bytes of ['{','null',JSON.stringify({version:2,current:{kind:'managed-shell',setupId:'../outside',descriptorSha256:'a'.repeat(64)},previous:null}),'x'.repeat(9000)]){const f=fixture(t);fs.writeFileSync(f.manager.file,bytes);const count=f.state.factories.length,bad=new QQConsole(f.options);assert.equal(f.state.factories.length,count);assert.equal(bad.runtime,null);const view=await bad.refresh();assert.equal(view.configured,false);assert.equal(view.issue,'installation_selection_invalid');await assert.rejects(bad.perform('start',{accountId:ID}),{code:'installation_selection_invalid'});assert.equal(fs.readFileSync(f.manager.file,'utf8'),bytes);await bad.close();}
  const f=fixture(t),elsewhere=path.join(f.base,'foreign.json');fs.writeFileSync(elsewhere,'{}');fs.linkSync(elsewhere,f.manager.file);const bad=new QQConsole(f.options);assert.equal(bad.runtime,null);await bad.close();
});
test('managed request accepts only an opaque setup ID and the displayed descriptor digest',async t=>{
  const f=fixture(t);for(const value of [null,{...f.request,path:f.base},{...f.request,setupId:'../bad'},{...f.request,descriptorSha256:'bad'}])await assert.rejects(f.manager.setManagedSetup(value),{code:'installation_selection_invalid'});await assert.rejects(f.manager.setManagedSetup({...f.request,descriptorSha256:'b'.repeat(64)}),{code:'managed_installation_changed'});assert(!fs.existsSync(f.manager.file));
});
test('concurrent selection bytes are preserved instead of overwritten after candidate discovery',async t=>{
  const f=fixture(t),concurrent='UNKNOWN_EXTERNAL_SELECTION';f.state.discoverHook=runtime=>{if(runtime.kind==='managed-shell')fs.writeFileSync(f.manager.file,concurrent);};await assert.rejects(f.manager.setManagedSetup(f.request),{code:'installation_selection_changed'});assert.equal(fs.readFileSync(f.manager.file,'utf8'),concurrent);assert.equal(f.manager.runtime.kind,'legacy');
});
test('a rename that committed before reporting an error remains an explicit committed result',async t=>{
  const f=fixture(t),rename=fs.renameSync;fs.renameSync=(from,to)=>{const result=rename(from,to);if(to===f.manager.file)throw Object.assign(Error('PRIVATE_WRITE_DETAILS'),{code:'EIO'});return result;};try{const result=await f.manager.setManagedSetup(f.request);assert(result.committed);assert(result.refreshIssue);assert.equal(JSON.parse(fs.readFileSync(f.manager.file)).current.setupId,f.setupId);assert(!JSON.stringify(result).includes('PRIVATE_WRITE_DETAILS'));}finally{fs.renameSync=rename;}
});
test('settings writer rechecks the old record after temporary bytes are durable',t=>{
  const f=fixture(t),sync=fs.fsyncSync,foreign='CONCURRENT_AFTER_TEMP';let changed=false;fs.fsyncSync=fd=>{const result=sync(fd);if(!changed){changed=true;fs.writeFileSync(f.manager.file,foreign);}return result;};try{assert.throws(()=>writeInstallationSettings(f.manager.file,{current:{kind:'managed-shell',...f.request},previous:null},{expectedDigest:null}),{code:'installation_selection_changed'});assert.equal(fs.readFileSync(f.manager.file,'utf8'),foreign);}finally{fs.fsyncSync=sync;}
  assert.throws(()=>readInstallationSettings(f.manager.file),{code:'installation_selection_invalid'});
});

test('Node selection uses its own reader and runtime option and persists an exact return route',async t=>{
  const f=fixture(t),seen=[],originalFactory=f.manager.runtimeFactory;
  f.manager.managedNodeSetupReader=options=>{seen.push(options);return{engine:'managed-node',setupId:f.setupId,descriptorSha256:f.descriptorSha256};};
  f.manager.runtimeFactory=options=>{if(!options.managedNodeInstallation)return originalFactory(options);assert.equal(options.managedInstallation,undefined);assert.equal(options.desktopDataRoot,undefined);const read=options.managedNodeInstallation();assert.equal(read.engine,'managed-node');return{kind:'managed-node',runs:new Map(),pending:new Set(),discover:async()=>({configured:true,instances:[],desktopRunning:false}),getConnections:async()=>new Map(),instance:()=>({}),close:async()=>({closed:true,failures:[]})};};
  const result=await f.manager.setManagedSetup({engine:'managed-node',...f.request});assert(result.committed);assert.equal(result.installation.current.kind,'managed-node');assert.equal(result.installation.current.setupId,f.setupId);assert(seen.length>=3);assert.equal(f.state.readCalls.length,0);
  const saved=readInstallationSettings(f.manager.file).value;assert.deepEqual(saved.current,{kind:'managed-node',...f.request});assert.deepEqual(saved.previous,{kind:'legacy',desktopDataRoot:f.legacy});const back=await f.manager.setPreviousInstallation();assert.equal(back.installation.current.kind,'legacy');assert.equal(back.installation.previous.kind,'managed-node');assert.equal(f.state.starts,0);
});

test('a candidate with active or uncertain processes cannot become the selected runtime',async t=>{
  for(const row of [{management:'external'},{management:'recoverable',recoveryRequired:true},{management:'unknown'},{management:'owned',processRunning:true}]){
    const f=fixture(t),factory=f.manager.runtimeFactory;f.manager.runtimeFactory=options=>{const candidate=factory(options);candidate.discover=async()=>({configured:true,desktopRunning:false,instances:[{accountId:ID,...row}]});return candidate;};await assert.rejects(f.manager.setManagedSetup(f.request),{code:'operation_in_progress'});assert(!fs.existsSync(f.manager.file));assert.equal(f.manager.runtime.kind,'legacy');assert.equal(f.state.stops,0);
  }
});

test('a candidate that starts during the final old-installation observation cannot be selected',async t=>{
  const f=fixture(t),factory=f.manager.runtimeFactory;let oldObservations=0,candidateRunning=false,candidateObservations=0;
  f.state.discoverHook=runtime=>{if(runtime.kind==='legacy'&&++oldObservations===2)candidateRunning=true;};
  f.manager.runtimeFactory=options=>{const candidate=factory(options);candidate.discover=async()=>{candidateObservations++;return{configured:true,desktopRunning:false,instances:candidateRunning?[{accountId:ID,management:'external',processRunning:true}]:[]};};return candidate;};
  await assert.rejects(f.manager.setManagedSetup(f.request),{code:'operation_in_progress'});
  assert.equal(candidateObservations,2);assert(!fs.existsSync(f.manager.file));assert.equal(f.manager.runtime.kind,'legacy');assert.equal(f.state.starts,0);assert.equal(f.state.stops,0);
});

test('Node selection rejects a Shell reader result or changed descriptor without falling back',async t=>{
  const f=fixture(t);f.manager.managedNodeSetupReader=()=>({engine:'managed-shell',setupId:f.setupId,descriptorSha256:f.descriptorSha256});await assert.rejects(f.manager.setManagedSetup({engine:'managed-node',...f.request}),{code:'managed_installation_changed'});assert(!fs.existsSync(f.manager.file));assert.equal(f.state.factories.length,1);
  for(const engine of ['node','legacy','__proto__'])await assert.rejects(f.manager.setManagedSetup({engine,...f.request}),{code:'installation_selection_invalid'});
});
