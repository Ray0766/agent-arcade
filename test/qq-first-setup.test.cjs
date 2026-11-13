'use strict';
// Synthetic local directories and injected services only. No QQ/model/network.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {QQFirstSetup,validateFirstSetupRequest,firstSetupErrorCode}=require('../src/bot/qq-first-setup.cjs');
const {RELEASE_ID,VERSION}=require('../src/bot/qq-managed-setup.cjs');
const HASH='a'.repeat(64),ZIP=RELEASE_ID.slice(-16)+'0'.repeat(48);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-first-setup-coordinator-')),setupId=randomUUID(),ticketId=randomUUID(),observed=new Map();fs.mkdirSync(path.join(root,'qq-installations'));fs.mkdirSync(path.join(root,'qq-installations',setupId));
  const calls=[],state={binding:'visible-panel-account-1',cancelPicker:false,pending:null,prepared:true,current:{kind:'legacy'},previous:null,readable:true,recoverable:false,receipt:null};
  const runtime={host:{snapshot:async()=>[]},componentSelection:()=>assert.fail('First setup must not need the original installation selector')};
  const console={runtime,epoch:0,closed:false,busy:new Set(),check(r,e){if(r!==this.runtime||e!==this.epoch||this.closed)throw Object.assign(Error('PRIVATE'),{code:'changed'});},installationSelection:()=>({current:state.current,previous:state.previous,canReturn:state.previous!==null}),async setManagedSetup(value,options){assert.deepEqual([...this.busy],['qq-setup']);assert.equal(options.operationMarker,'qq-setup');options.assertCurrent();calls.push(['use',value]);this.epoch++;state.previous=state.current;state.current={kind:'managed-shell',setupId:value.setupId};return{committed:true,installation:this.installationSelection(),automaticStart:false,privatePath:'PRIVATE'};},async setPreviousInstallation(options){options.assertCurrent();calls.push(['return']);[state.current,state.previous]=[state.previous,state.current];this.epoch++;return{committed:true,installation:this.installationSelection(),automaticStart:false};}};
  const prepared={root,listPrepared:async()=>({items:state.prepared?[{versionId:RELEASE_ID,version:VERSION,manifestSha256:HASH}]:[],issues:[]}),prepare:async()=>{calls.push(['prepare']);return{versionId:RELEASE_ID,version:VERSION,manifestSha256:HASH};},resolvePrepared:async()=>{calls.push(['resolve']);return{versionId:RELEASE_ID,version:VERSION,manifestSha256:HASH};}};
  const packages={root,stage:async({signal,version})=>{calls.push(['stage',version]);if(state.pending)await state.pending.promise;if(signal.aborted)throw Object.assign(Error('PRIVATE'),{code:'cancelled'});return{version:VERSION,sha256:ZIP,file:'PRIVATE'};}};
  const view={ticketId,expiresAt:Date.now()+300000,canInitialize:true,compatibility:'not-tested',qq:{version:'9.9.36.53644',architecture:'x64',size:2048,sha256:HASH,signature:{status:'Valid',subject:'PRIVATE CERT',thumbprint:'b'.repeat(40)}}};
  const setup={root,discardTickets(){calls.push(['discard']);},async inspect({qqExe}){calls.push(['inspect',typeof qqExe]);return structuredClone(view);},async initialize(options){calls.push(['create',options.ticketId]);options.assertCurrent();return state.receipt||{committed:true,setupId,automaticStart:false,current:{versionId:RELEASE_ID},installationRoot:'PRIVATE'};},async inspectRecovery({setupId:id}){if(!state.recoverable)throw Error('PRIVATE');return {setupId:id,expectedDigest:HASH,temporaryLinksToRemove:1,descriptorPreserved:true,automaticStart:false};},async confirmRecovery(options){calls.push(['recover']);options.assertCurrent();return{committed:true,recovered:true,setupId:options.setupId,automaticStart:false,descriptorSha256:HASH};}};
  const options={componentStoreRoot:root,console,capture:()=>state.binding,programPicker:async()=>{calls.push(['picker']);return state.cancelPicker?null:path.join(root,'PRIVATE','QQ.exe');},packages,prepared,setup,readSetup:({setupId:id})=>{observed.set(id,true);if(!state.readable)throw Error('PRIVATE');return{setupId:id,descriptorSha256:HASH,current:{versionId:RELEASE_ID},qq:{version:'9.9.36.53644'},privatePath:'PRIVATE'};}};
  const coordinator=new QQFirstSetup(options);t.after(async()=>{await coordinator.close();const real=fs.realpathSync(root),temp=fs.realpathSync(os.tmpdir());assert(real.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  return{root,setupId,ticketId,state,calls,console,setup,prepared,packages,coordinator,options,observed};
}
const noPrivate=v=>assert.doesNotMatch(JSON.stringify(v),/PRIVATE|installationRoot|qqExe|privatePath|thumbprint|subject/);

test('status is local, bounded and metadata-only without an original selector',async t=>{
  const f=fixture(t),result=await f.coordinator.execute({action:'status'});assert.equal(result.state.busy,false);assert.equal(result.state.phase,'idle');assert.equal(result.state.setups[0].setupId,f.setupId);assert.equal(result.state.setups[0].verification,'metadata-only');assert.equal(result.state.preparedVersionId,RELEASE_ID);assert(!f.calls.some(([name])=>['stage','prepare','create','picker'].includes(name)));noPrivate(result);
});
test('picker, fixed preparation, create and explicit use are separate safe actions',async t=>{
  const f=fixture(t);await f.coordinator.execute({action:'status'});const chosen=await f.coordinator.execute({action:'choose-program'});noPrivate(chosen);assert.equal(chosen.program.qq.signature.status,'Valid');
  const prepared=await f.coordinator.execute({action:'prepare'});assert.equal(prepared.prepared.automaticStart,false);assert.deepEqual(f.calls.find(x=>x[0]==='stage'),['stage',VERSION]);
  const created=await f.coordinator.execute({action:'create',ticketId:f.ticketId});assert.equal(created.committed,true);assert.equal(created.setupId,f.setupId);assert(!f.calls.some(x=>x[0]==='use'));noPrivate(created);
  await assert.rejects(f.coordinator.execute({action:'create',ticketId:f.ticketId}),{code:'stale_ticket'});
  await f.coordinator.execute({action:'status'});const used=await f.coordinator.execute({action:'use',setupId:f.setupId});assert.equal(used.committed,true);assert.equal(used.installation.current.kind,'managed-shell');assert.equal(used.automaticStart,false);noPrivate(used);assert.equal(f.console.busy.size,0);
});
test('unlisted IDs and caller-provided path/version/marker fields are rejected',async t=>{
  const f=fixture(t);await assert.rejects(f.coordinator.execute({action:'use',setupId:f.setupId}),{code:'setup_unavailable'});
  for(const value of [{action:'prepare',version:'9.0.0'},{action:'choose-program',qqExe:'PRIVATE'},{action:'create',ticketId:f.ticketId,operationMarker:'qq-setup'},{action:'status',root:f.root},{action:'use',setupId:['bad']},{action:'arbitrary'}])assert.throws(()=>validateFirstSetupRequest(value),{code:'invalid_request'});
  assert(!f.calls.some(x=>x[0]==='use'));
});
test('create requires a current prepared listing and current one-use program ticket',async t=>{
  const f=fixture(t);f.state.prepared=false;await f.coordinator.execute({action:'status'});await f.coordinator.execute({action:'choose-program'});await assert.rejects(f.coordinator.execute({action:'create',ticketId:f.ticketId}),{code:'prepared_required'});assert(!f.calls.some(x=>x[0]==='create'));
});
test('cancelled native picker does not inspect or fabricate a selection',async t=>{
  const f=fixture(t);f.state.cancelPicker=true;assert.deepEqual(await f.coordinator.execute({action:'choose-program'}),{cancelled:true});assert(!f.calls.some(x=>x[0]==='inspect'));assert.equal(f.coordinator.snapshot().program,null);
});
test('global busy prevents start of setup work and remains held through cancelled preparation settlement',async t=>{
  const f=fixture(t);f.console.busy.add('other-account');await assert.rejects(f.coordinator.execute({action:'prepare'}),{code:'operation_in_progress'});f.console.busy.clear();const wait=deferred();f.state.pending=wait;
  const operation=f.coordinator.execute({action:'prepare'});await new Promise(r=>setImmediate(r));assert.deepEqual([...f.console.busy],['qq-setup']);const cancelled=f.coordinator.execute({action:'cancel'});assert(f.console.busy.has('qq-setup'));const rejection=assert.rejects(operation,{code:'cancelled'});wait.resolve();await rejection;assert.deepEqual(await cancelled,{cancelled:true,settled:true});assert.equal(f.console.busy.size,0);assert(!f.calls.some(x=>x[0]==='prepare'));
});
test('changing panel or runtime epoch invalidates old program and in-flight output',async t=>{
  for(const kind of ['panel','epoch'])await t.test(kind,async t=>{const f=fixture(t);await f.coordinator.execute({action:'status'});await f.coordinator.execute({action:'choose-program'});if(kind==='panel')f.state.binding='other-panel';else f.console.epoch++;await assert.rejects(f.coordinator.execute({action:'create',ticketId:f.ticketId}),{code:'stale_ticket'});assert(!f.calls.some(x=>x[0]==='create'));});
  const f=fixture(t),wait=deferred();f.state.pending=wait;const operation=f.coordinator.execute({action:'prepare'});await new Promise(r=>setImmediate(r));f.state.binding='other-panel';wait.resolve();await assert.rejects(operation,{code:'changed'});assert(!f.calls.some(x=>x[0]==='prepare'));
});
test('a late inspect after close cannot retain a reusable ticket',async t=>{
  const f=fixture(t),wait=deferred();f.setup.inspect=async()=>{await wait.promise;return{ticketId:f.ticketId};};const operation=f.coordinator.execute({action:'choose-program'});await new Promise(r=>setImmediate(r));const close=f.coordinator.close(),rejected=assert.rejects(operation,{code:'manager_closing'});wait.resolve();await rejected;await close;assert.equal(f.coordinator.snapshot().program,null);assert(f.calls.filter(x=>x[0]==='discard').length>=3);await assert.rejects(f.coordinator.execute({action:'status'}),{code:'manager_closing'});
});
test('late scope changes and malformed post-commit receipts cannot erase created filesystem fact',async t=>{
  for(const kind of ['late-scope','error','malformed'])await t.test(kind,async t=>{const f=fixture(t);await f.coordinator.execute({action:'status'});await f.coordinator.execute({action:'choose-program'});f.setup.initialize=async()=>{if(kind==='error')throw Object.assign(Error('PRIVATE'),{committed:true,setupId:f.setupId,code:'setup_readback_failed'});if(kind==='malformed')return {committed:true,setupId:f.setupId};f.state.binding='new-panel';return{committed:true,setupId:f.setupId,automaticStart:false,current:{versionId:RELEASE_ID}};};const value=await f.coordinator.execute({action:'create',ticketId:f.ticketId});assert.equal(value.committed,true);assert.equal(value.setupId,f.setupId);if(kind!=='late-scope')assert(value.refreshIssue);noPrivate(value);});
});
test('recoverable initialization needs a matching current preview and consumes it once',async t=>{
  const f=fixture(t);f.state.readable=false;f.state.recoverable=true;const listing=await f.coordinator.execute({action:'status'});assert.equal(listing.state.setups[0].state,'recoverable');await assert.rejects(f.coordinator.execute({action:'recovery-confirm',setupId:f.setupId,expectedDigest:HASH}),{code:'preview_required'});
  const result=await f.coordinator.execute({action:'recovery-preview',setupId:f.setupId});assert.equal(result.preview.temporaryLinksToRemove,1);const value=await f.coordinator.execute({action:'recovery-confirm',setupId:f.setupId,expectedDigest:result.preview.expectedDigest});assert.equal(value.recovered,true);noPrivate(value);await assert.rejects(f.coordinator.execute({action:'recovery-confirm',setupId:f.setupId,expectedDigest:HASH}),{code:'preview_required'});
});
test('uncertain recovery effects retain explicit attempted flag and never replay',async t=>{
  const f=fixture(t);f.state.readable=false;f.state.recoverable=true;await f.coordinator.execute({action:'status'});await f.coordinator.execute({action:'recovery-preview',setupId:f.setupId});f.setup.confirmRecovery=async()=>{throw Object.assign(Error('PRIVATE'),{code:'recovery_unconfirmed',recoveryAttempted:true});};await assert.rejects(f.coordinator.execute({action:'recovery-confirm',setupId:f.setupId,expectedDigest:HASH}),e=>e.code==='recovery_unconfirmed'&&e.recoveryAttempted===true&&!e.message.includes('PRIVATE'));await assert.rejects(f.coordinator.execute({action:'recovery-confirm',setupId:f.setupId,expectedDigest:HASH}),{code:'preview_required'});
});
test('an already prepared version is reverified locally instead of trusted by filename',async t=>{
  const f=fixture(t);f.prepared.prepare=async()=>{throw Object.assign(Error('PRIVATE'),{code:'version_exists'});};await f.coordinator.execute({action:'prepare'});assert(f.calls.some(x=>x[0]==='resolve'));
});
test('directory junctions, excessive listings and unsupported records are bounded',async t=>{
  const f=fixture(t),base=path.join(f.root,'qq-installations');for(let i=0;i<34;i++)fs.mkdirSync(path.join(base,randomUUID()));const value=await f.coordinator.execute({action:'status'});assert.equal(value.state.setups.length,32);assert.equal(value.state.lastCode,'list_limit');noPrivate(value);
  const other=fixture(t),source=path.join(other.root,'elsewhere');fs.mkdirSync(source);fs.renameSync(path.join(other.root,'qq-installations'),path.join(other.root,'saved'));fs.symlinkSync(source,path.join(other.root,'qq-installations'),'junction');const result=await other.coordinator.execute({action:'status'});assert.equal(result.state.lastCode,'unsafe_path');assert.equal(other.observed.size,0);
});
test('switch receipts discard global state and paths while preserving committed errors',async t=>{
  const f=fixture(t);await f.coordinator.execute({action:'status'});f.console.setManagedSetup=async()=>({committed:true,automaticStart:false,installation:{current:{kind:'managed-shell',setupId:f.setupId},previous:{kind:'legacy'},canReturn:true},state:{secret:'PRIVATE'},refreshIssue:'changed'});const value=await f.coordinator.execute({action:'use',setupId:f.setupId});assert.equal(value.refreshIssue,'changed');assert.equal(value.committed,true);noPrivate(value);
});

test('changed managed descriptor remains actionable while unknown error details are withheld',()=>{
  assert.equal(firstSetupErrorCode({code:'managed_installation_changed'}),'managed_installation_changed');assert.equal(firstSetupErrorCode({code:'PRIVATE_UPSTREAM_VALUE'}),'setup_failed');
});

test('synchronous close observer waits for the published operation without starting I/O',async t=>{
  const f=fixture(t);let close;const coordinator=new QQFirstSetup({...f.options,onChange:()=>{if(!close)close=coordinator.close();}});
  await assert.rejects(coordinator.execute({action:'prepare'}),{code:'manager_closing'});await close;assert(!f.calls.some(x=>x[0]==='stage'));assert.equal(f.console.busy.size,0);
});

test('native AbortError is classified as cancellation without upstream text',async t=>{
  const f=fixture(t),entered=deferred();f.packages.stage=async({signal})=>{entered.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};const operation=f.coordinator.execute({action:'prepare'}),rejected=assert.rejects(operation,{code:'cancelled'});await entered.promise;await f.coordinator.cancel();await rejected;assert.equal(f.console.busy.size,0);
});

test('scope watcher aborts pending preparation even without another renderer request',async t=>{
  const f=fixture(t),entered=deferred();let signal;f.packages.stage=async options=>{signal=options.signal;entered.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  const operation=f.coordinator.execute({action:'prepare'}),rejected=assert.rejects(operation,{code:'changed'});await entered.promise;f.state.binding='different-selected-account';await rejected;assert(signal.aborted);assert.equal(f.console.busy.size,0);assert(!f.calls.some(x=>x[0]==='prepare'));
});

test('production initializer creates a separate managed installation through the coordinator',{skip:require('./helpers/platform-skip.cjs').ownedIpcSkip()},async t=>{
  const {QQManagedShellSetup,readManagedShellInstallation}=require('../src/bot/qq-managed-setup.cjs'),{createHash}=require('node:crypto');
  const f=fixture(t),qqExe=path.join(f.root,'PRIVATE','QQ.exe');fs.mkdirSync(path.dirname(qqExe));const pe=Buffer.alloc(2048);pe.write('MZ');pe.writeUInt32LE(128,60);pe.writeUInt32LE(0x4550,128);pe.writeUInt16LE(0x8664,132);pe.writeUInt16LE(0x20b,152);fs.writeFileSync(qqExe,pe);fs.writeFileSync(path.join(path.dirname(qqExe),'existing-login-fixture'),'DO_NOT_COPY');
  const versionRoot=path.join(f.root,'qq-component-versions','napcat-shell',RELEASE_ID),codeRoot=path.join(versionRoot,'code'),manifestPath=path.join(versionRoot,'prepared.json');fs.mkdirSync(codeRoot,{recursive:true});fs.writeFileSync(manifestPath,'{"synthetic":"prepared resolver fixture"}');const manifestSha256=createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  f.prepared.resolvePrepared=async()=>({versionId:RELEASE_ID,version:VERSION,codeRoot,manifestPath,manifestSha256});
  const setup=new QQManagedShellSetup({root:f.root,prepared:f.prepared,processHost:{snapshot:async()=>[]},programObserver:async()=>({version:'9.9.36.53644',productName:'QQ',companyName:'Tencent',signature:{status:'Valid',subject:'CN=Tencent',thumbprint:'b'.repeat(40)}})});
  const coordinator=new QQFirstSetup({...f.options,setup,readSetup:readManagedShellInstallation});t.after(()=>coordinator.close());await coordinator.execute({action:'status'});const chosen=await coordinator.execute({action:'choose-program'});const result=await coordinator.execute({action:'create',ticketId:chosen.program.ticketId});assert.equal(result.committed,true);const read=readManagedShellInstallation({root:f.root,setupId:result.setupId});assert.equal(read.previous,null);assert.equal(read.current.kind,'prepared');assert.deepEqual(fs.readdirSync(read.qqDataDir),[]);assert.deepEqual(fs.readdirSync(read.configDir),[]);assert(fs.readFileSync(qqExe).equals(pe));assert.equal(fs.readFileSync(path.join(path.dirname(qqExe),'existing-login-fixture'),'utf8'),'DO_NOT_COPY');assert(!f.calls.some(x=>x[0]==='use'));noPrivate(result);
  const listed=await coordinator.execute({action:'status'});assert.equal(listed.state.setups.find(row=>row.setupId===result.setupId).state,'ready');noPrivate(listed);
});
