'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQComponents}=require('../src/bot/qq-components.cjs');
const {QQConsole}=require('../src/bot/qq-console.cjs');
const VERSION='4.18.42',SHA='a'.repeat(64),DIGEST='b'.repeat(64),ID=`napcat-shell-${VERSION}-${SHA.slice(0,16)}`;
const next=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const error=(code,extra={})=>Object.assign(Error('SECRET upstream payload and private path'),{code,...extra});
const original=()=>({kind:'original',version:VERSION,verification:'not-checked',path:'SECRET original'});
const candidate=()=>({kind:'prepared',version:VERSION,versionId:ID,path:'SECRET prepared'});
const selection=(extra={})=>({current:original(),previous:null,digest:DIGEST,canRollback:false,scope:'napcat-only',automaticStart:false,...extra});
const prepared=()=>({version:VERSION,versionId:ID,source:{sha256:SHA,token:'SECRET'},fileCount:2,totalBytes:40,codeRoot:'SECRET code',files:[{path:'SECRET file',size:40}]});
function fixture(t,{realConsole=false,onChange}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-components-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[],packages={root,inspect:async()=>{calls.push('inspect');return {version:VERSION,tag:`v${VERSION}`,name:'NapCat.Shell.zip',size:40,sha256:SHA,assetId:1,publishedAt:'2026-10-30T07:05:50Z',url:'SECRET URL'};},stage:async()=>{calls.push('stage');return {version:VERSION,sha256:SHA,file:'SECRET ZIP'};}};
  const store={root,packages,prepare:async()=>{calls.push('prepare');return prepared();},resolvePrepared:async id=>{calls.push('resolve');assert.equal(id,ID);return prepared();},listPrepared:async()=>{calls.push('list');return {items:[prepared()],issues:[]};}};
  const selector={prepared:store,status:()=>{calls.push('status');return selection({digest:null});},preview:async options=>{calls.push('preview');return selection({candidate:candidate(),operation:options.operation});},activate:async options=>{calls.push('activate');options.assertCurrent();return selection({current:candidate(),previous:original(),canRollback:true,committed:true});},rollback:async options=>{calls.push('rollback');options.assertCurrent();return selection({previous:candidate(),canRollback:true,committed:true});}};
  const runtime={componentStoreRoot:root,componentSelection:()=>selector,instance:()=>({}),discover:async()=>({configured:true,instances:[]}),getConnections:async()=>new Map(),start:async()=>{calls.push('start');},close:async()=>({closed:true})};
  const console=realConsole?new QQConsole({root,runtimeFactory:()=>runtime,profileFactory:()=>({list:async()=>[]})}):{runtime,epoch:0,busy:new Set(),closed:false,refreshRevision:0,refreshing:null,check(value,epoch){if(this.closed||this.runtime!==value||this.epoch!==epoch)throw error('changed');},refresh:async()=>{calls.push('refresh');},abortDirectory:()=>calls.push('abort-directory')};
  const manager=new QQComponents({console,onChange,packagesFactory:()=>assert.fail('must use runtime shared package instance'),preparedFactory:()=>assert.fail('must use runtime shared prepared instance')});
  t.after(()=>manager.close());return {root,calls,packages,store,selector,runtime,console,manager};
}

test('Node component page uses the Node package namespace and rejects a Shell activation before the selector',async t=>{
  const f=fixture(t),nodeId=ID.replace('napcat-shell','napcat-node'),nodeValue=()=>({...prepared(),versionId:nodeId}),nodeSelection=()=>selection({scope:'qq-node-runtime',current:{...candidate(),versionId:nodeId}});
  f.store.component='napcat-node';f.packages.component='napcat-node';f.store.listPrepared=async()=>({items:[nodeValue()],issues:[]});f.store.prepare=async()=>nodeValue();f.selector.status=nodeSelection;
  f.packages.inspect=async()=>({version:VERSION,tag:`v${VERSION}`,name:'NapCat.Shell.Windows.Node.zip',size:124162399,sha256:SHA,assetId:1,publishedAt:'2026-10-30T07:05:50Z'});
  const status=await f.manager.execute({action:'status'});assert.equal(status.state.component,'napcat-node');assert.equal(status.state.current.versionId,nodeId);assert.equal(status.state.canRollback,false);assert.equal((await f.manager.execute({action:'inspect'})).release.name,'NapCat.Shell.Windows.Node.zip');assert.equal((await f.manager.execute({action:'prepare'})).prepared.versionId,nodeId);
  f.selector.preview=async()=>assert.fail('Wrong engine must not reach selection');await assert.rejects(f.manager.execute({action:'preview',versionId:ID}),{code:'invalid_version'});
  f.store.listPrepared=async()=>({items:[prepared()],issues:[]});await assert.rejects(f.manager.execute({action:'status'}),{code:'invalid_response'});
});

test('Node component selection never accepts a fabricated original QQ baseline',async t=>{
  const f=fixture(t);f.store.component='napcat-node';f.packages.component='napcat-node';f.selector.status=()=>selection({scope:'qq-node-runtime',current:original()});await assert.rejects(f.manager.execute({action:'status'}),{code:'invalid_response'});
});

test('strict action boundary rejects paths, URLs, hashes, unknown fields and unsupported versions before I/O',async t=>{
  const f=fixture(t),invalid=[null,[],{}, {action:'download'}, {action:'status',path:'C:\\private'}, {action:'inspect',url:'https://elsewhere'}, {action:'prepare',sha256:SHA}, {action:'prepare',version:'latest'}, {action:'preview'}, {action:'preview',versionId:'../bad'}, {action:'preview',operation:'rollback',versionId:ID}, {action:'preview',operation:'other'}, {action:'activate',versionId:ID,expectedDigest:'z'.repeat(64)}, {action:'activate',versionId:ID,expectedDigest:DIGEST,token:'SECRET'}, {action:'rollback',expectedDigest:DIGEST,versionId:ID}, {action:'cancel',extra:true},Object.assign(Object.create({}),{action:'status'})];
  for(const request of invalid)await assert.rejects(f.manager.execute(request),{code:'invalid_request'});assert.deepEqual(f.calls,[]);assert.equal(f.manager.snapshot().busy,false);
});

test('explicit status discovers only metadata and snapshot polling is pure, detached and silent',async t=>{
  let changes=0;const f=fixture(t,{onChange:()=>changes++});const result=await f.manager.execute({action:'status'});
  assert.deepEqual(f.calls,['status','list']);assert.equal(result.state.busy,false);assert.equal(result.state.phase,'idle');assert.equal(result.state.prepared[0].verified,false);assert.equal(result.state.current.verification,'not-checked');assert.doesNotMatch(JSON.stringify(result),/SECRET|codeRoot|files/);
  const count=changes;for(let i=0;i<50;i++){const copy=f.manager.snapshot();copy.prepared[0].fileCount=999;copy.current.kind='bad';}
  assert.deepEqual(f.calls,['status','list']);assert.equal(changes,count);assert.equal(f.manager.snapshot().prepared[0].fileCount,2);assert.equal(f.manager.snapshot().current.kind,'original');
});

test('lightweight metadata problems are fixed diagnostics and invalid lists fail closed',async t=>{
  const f=fixture(t);f.store.listPrepared=async()=>({items:[],issues:['prepared_invalid']});assert.equal((await f.manager.execute({action:'status'})).state.lastCode,'prepared_invalid');
  for(const listing of [{items:[prepared(),prepared()],issues:[]},{items:new Array(33).fill(prepared()),issues:[]},{items:[{...prepared(),fileCount:0}],issues:[]}]){f.store.listPrepared=async()=>listing;await assert.rejects(f.manager.execute({action:'status'}),{code:'invalid_response'});}
});

test('inspect returns only safe release scalars and preserves actionable fixed selection failures',async t=>{
  const f=fixture(t);const result=await f.manager.execute({action:'inspect'});assert.equal(result.release.sha256,SHA);assert.doesNotMatch(JSON.stringify(result),/SECRET|url/);
  for(const code of ['pending_upstream_update','manifest_invalid','selection_invalid']){f.selector.preview=async()=>{throw error(code);};await assert.rejects(f.manager.execute({action:'preview',versionId:ID}),e=>e.code===code&&!e.message.includes('SECRET'));}
  f.packages.inspect=async()=>{throw error('raw_private_value');};await assert.rejects(f.manager.execute({action:'inspect'}),e=>e.code==='components_failed'&&!e.message.includes('SECRET'));
});

test('prepare stages before extraction and returns bounded summaries, not paths or manifests',async t=>{
  const phases=[];let f;f=fixture(t,{onChange:()=>{if(f)phases.push(f.manager.snapshot().phase);}});const result=await f.manager.execute({action:'prepare'});
  assert.deepEqual(f.calls,['stage','prepare']);assert.deepEqual(result.prepared,{versionId:ID,version:VERSION,sha256:SHA,fileCount:2,totalBytes:40,verified:true});assert.deepEqual(phases,['downloading','preparing','idle']);assert.equal(f.manager.snapshot().prepared[0].verified,false);assert.doesNotMatch(JSON.stringify(result),/SECRET|codeRoot|files/);
});

test('first setup and existing preparation are mutually exclusive in both directions',async t=>{
  const f=fixture(t);f.console.busy.add('qq-setup');
  for(const request of [{action:'prepare'},{action:'inspect'},{action:'preview',versionId:ID}])await assert.rejects(f.manager.execute(request),{code:'operation_in_progress'});
  assert.deepEqual(f.calls,[]);assert.equal((await f.manager.execute({action:'status'})).state.busy,false);assert.deepEqual(await f.manager.execute({action:'cancel'}),{cancelRequested:false});
  f.console.busy.delete('qq-setup');const wait=deferred();f.packages.stage=async()=>wait.promise;const operation=f.manager.execute({action:'prepare'});await next();assert(f.console.busy.has('qq-components'));wait.resolve({version:VERSION,sha256:SHA});await operation;assert.equal(f.console.busy.size,0);
});

test('repeated prepare fully resolves the ID derived from the staged archive and rejects a different archive',async t=>{
  const f=fixture(t);f.store.prepare=async()=>{f.calls.push('prepare');throw error('version_exists');};const result=await f.manager.execute({action:'prepare'});assert.equal(result.prepared.verified,true);assert.deepEqual(f.calls,['stage','prepare','resolve']);
  f.store.resolvePrepared=async()=>{const value=prepared();value.source.sha256='c'.repeat(64);value.versionId=`napcat-shell-${VERSION}-${'c'.repeat(16)}`;return value;};await assert.rejects(f.manager.execute({action:'prepare'}),{code:'invalid_response'});
});

test('cancel aborts the owned request once, retains exclusivity until settled, and rejects a late success',async t=>{
  const f=fixture(t),gate=deferred();let signal;f.packages.stage=async options=>{signal=options.signal;return gate.promise;};const pending=f.manager.execute({action:'prepare'});const rejected=assert.rejects(pending,{code:'cancelled'});await next();
  assert.deepEqual(await f.manager.execute({action:'cancel'}),{cancelRequested:true});assert(signal.aborted);assert.deepEqual(await f.manager.execute({action:'cancel'}),{cancelRequested:false});assert.equal(f.manager.snapshot().phase,'cancelling');assert.equal((await f.manager.execute({action:'status'})).state.busy,true);
  await assert.rejects(f.manager.execute({action:'inspect'}),{code:'operation_in_progress'});gate.resolve({version:VERSION,sha256:SHA});await rejected;assert(!f.calls.includes('prepare'));assert.equal(f.manager.snapshot().busy,false);assert.equal(f.manager.snapshot().lastCode,'cancelled');
});

test('directory identity change aborts pending I/O and drops old cached selections without recursive publication',async t=>{
  let changes=0;const f=fixture(t,{onChange:()=>changes++});await f.manager.execute({action:'status'});const gate=deferred();let signal;f.packages.stage=options=>{signal=options.signal;return gate.promise;};const pending=f.manager.execute({action:'prepare'}),rejected=assert.rejects(pending,{code:'changed'});await next();f.console.epoch++;f.console.runtime={...f.runtime};const before=changes;
  const state=f.manager.snapshot();assert.equal(changes,before);assert.equal(state.current,null);assert.deepEqual(state.prepared,[]);assert(signal.aborted);gate.resolve({version:VERSION,sha256:SHA});await rejected;assert(!f.calls.includes('prepare'));assert.equal(f.manager.snapshot().current,null);
});

test('watchdog cancels changed runtime even without a polling renderer',async t=>{
  const f=fixture(t),seen=deferred();f.packages.stage=({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{seen.resolve();reject(error('cancelled'));},{once:true}));const pending=f.manager.execute({action:'prepare'}),rejected=assert.rejects(pending,{code:'changed'});await next();f.console.epoch++;await seen.promise;await rejected;assert.equal(f.manager.snapshot().busy,false);
});

test('activation and rollback pass a live epoch guard and never commit after an asynchronous context change',async t=>{
  for(const action of ['activate','rollback'])await t.test(action,async t=>{const f=fixture(t),gate=deferred();let committed=0;f.selector[action]=async options=>{assert.equal(options.expectedDigest,DIGEST);assert(options.signal instanceof AbortSignal);await gate.promise;options.assertCurrent();committed++;return selection();};const pending=f.manager.execute({action,expectedDigest:DIGEST,...(action==='activate'?{versionId:ID}:{})}),rejected=assert.rejects(pending,{code:'changed'});await next();assert(f.console.busy.has('qq-components'));f.console.epoch++;gate.resolve();await rejected;assert.equal(committed,0);assert.equal(f.console.busy.size,0);});
});

test('a component switch blocks a different account start through the real QQConsole and releases the guard',async t=>{
  const f=fixture(t,{realConsole:true}),gate=deferred();f.selector.activate=async options=>{await gate.promise;options.assertCurrent();return selection({current:candidate(),previous:original(),canRollback:true});};
  const pending=f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST});await next();assert(f.console.busy.has('qq-components'));
  await assert.rejects(f.console.perform('start',{accountId:'123456789'}),{code:'operation_in_progress'});assert(!f.calls.includes('start'));gate.resolve();assert.equal((await pending).committed,true);assert.equal(f.console.busy.size,0);
  await f.console.perform('start',{accountId:'987654321'});assert(f.calls.includes('start'));await f.console.close();
});

test('an existing console operation blocks switching before selection methods run',async t=>{
  const f=fixture(t);f.console.busy.add('123456789');await assert.rejects(f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST}),{code:'operation_in_progress'});assert(!f.calls.includes('activate'));assert.deepEqual([...f.console.busy],['123456789']);
});

test('explicit rollback preview targets previous without inventing a prepared candidate',async t=>{
  const f=fixture(t);f.selector.preview=async options=>{assert.deepEqual(Object.keys(options).sort(),['operation','signal']);assert.equal(options.operation,'rollback');return selection({current:candidate(),previous:original(),candidate:original(),canRollback:true});};const {preview}=await f.manager.execute({action:'preview',operation:'rollback'});assert.equal(preview.operation,'rollback');assert.equal(preview.candidate.kind,'original');assert.equal(preview.digest,DIGEST);assert.doesNotMatch(JSON.stringify(preview),/SECRET/);
});

test('a committed switch remains committed when console refresh fails or returned metadata is invalid',async t=>{
  const f=fixture(t);f.console.refresh=async()=>{throw error('process_check_failed');};let result=await f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST});assert.equal(result.committed,true);assert.equal(result.refreshIssue,'process_check_failed');assert.equal(result.selection.current.kind,'prepared');assert.equal(f.console.refreshRevision,1);assert.equal(f.console.busy.size,0);
  f.selector.activate=async()=>({committed:true,privatePath:'SECRET'});result=await f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST});assert.deepEqual(result,{committed:true,selection:null,refreshIssue:'invalid_response'});
});

test('post-rename selector errors preserve committed outcome and never retry or conceal mutation',async t=>{
  const f=fixture(t);let writes=0;f.selector.activate=async()=>{writes++;throw error('component_io_failed',{committed:true});};const result=await f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST});assert.deepEqual(result,{committed:true,selection:null,refreshIssue:'component_io_failed'});assert.equal(writes,1);assert.equal(f.console.busy.size,0);assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});

test('cancel after commit cannot change the outcome while discovery is still pending',async t=>{
  const f=fixture(t),gate=deferred();f.console.refresh=()=>gate.promise;const pending=f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST});await next();assert.deepEqual(await f.manager.execute({action:'cancel'}),{cancelRequested:false});assert.equal(f.manager.snapshot().busy,true);gate.resolve();assert.equal((await pending).committed,true);
});

test('a context change after commit preserves the mutation result but cannot publish stale selection',async t=>{
  const f=fixture(t),gate=deferred();f.console.refresh=()=>gate.promise;const pending=f.manager.execute({action:'activate',versionId:ID,expectedDigest:DIGEST});await next();f.console.epoch++;f.manager.snapshot();gate.resolve();const result=await pending;assert.equal(result.committed,true);assert.equal(result.refreshIssue,'changed');assert.equal(f.manager.snapshot().current,null);assert.equal(f.console.busy.size,0);
});

test('close waits for cancellation cleanup and rejects later work',async t=>{
  const f=fixture(t),gate=deferred();let signal;f.packages.stage=options=>{signal=options.signal;return gate.promise;};const pending=f.manager.execute({action:'prepare'}),rejected=assert.rejects(pending,{code:'manager_closing'});await next();let closed=false;const closing=f.manager.close().then(()=>{closed=true;});await next();assert(signal.aborted);assert.equal(closed,false);gate.resolve({version:VERSION,sha256:SHA});await Promise.all([closing,rejected]);assert.equal(closed,true);assert.equal(f.manager.snapshot().busy,false);await assert.rejects(f.manager.execute({action:'status'}),{code:'manager_closing'});
});

test('immediate observer shutdown still waits for the owned operation promise',async t=>{
  let f,closing;f=fixture(t,{onChange:()=>{if(f&&!closing&&f.manager.snapshot().busy)closing=f.manager.close();}});await assert.rejects(f.manager.execute({action:'prepare'}),{code:'manager_closing'});assert.deepEqual(await closing,{closed:true});assert.equal(f.manager.snapshot().busy,false);assert.deepEqual(f.calls,[]);
});

test('mismatched package roots are rejected and new contexts cannot reuse the old prepared store',async t=>{
  const f=fixture(t);f.store.root=path.join(f.root,'different');await assert.rejects(f.manager.execute({action:'status'}),{code:'invalid_response'});assert.deepEqual(f.calls,[]);
});
