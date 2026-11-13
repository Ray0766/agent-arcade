'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {QQComponents}=require('../src/bot/qq-components.cjs');
const DIGEST='d'.repeat(64),next=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const error=(code,extra={})=>Object.assign(Error('PRIVATE token, path and message'),{code,...extra});
const targets={component:['preview','recover'],recovery:['previewGuardRecovery','recoverGuard'],configuration:['previewConfigurationRecovery','recoverConfiguration']};
const base=()=>({automaticStart:false,selectionChanged:false});
function raw(target,preview){return {...base(),...(preview?{digest:DIGEST}:{recovered:true,previousDigest:DIGEST}),
  ...(target==='component'?{...(preview?{recovery:'eligible'}:{guardRemaining:false})}:target==='recovery'?{recovery:preview?'guard-eligible':'guard-cleared',componentLockRemaining:true}:{recovery:preview?'configuration-eligible':'configuration-cleared',componentLockRemaining:true,recoveryGuardRemaining:true,configurationRestored:false}),
  owner:{pid:999,executable:'PRIVATE path',token:'PRIVATE token'},token:'PRIVATE token'};}
function fixture(t){
  const calls=[],root=path.join(os.tmpdir(),'arcade-recovery-coordinator'),packages={root,inspect:async()=>{},stage:async()=>{}};
  const prepared={root,packages,prepare:async()=>{},resolvePrepared:async()=>{},listPrepared:async()=>({items:[],issues:[]})};
  const selector={installationId:'i'.repeat(64),lockFile:path.join(root,'installation.lock'),configLock:path.join(root,'configuration.edit'),prepared,
    status:()=>({current:{kind:'original',version:'4.18.42'},previous:null,canRollback:false,digest:null,scope:'napcat-only',automaticStart:false}),preview:async()=>{},activate:async()=>{},rollback:async()=>{}};
  const recovery={};for(const [target,[preview,recover]]of Object.entries(targets)){recovery[preview]=async()=>{calls.push(preview);return raw(target,true);};recovery[recover]=async options=>{calls.push(recover);assert(options.signal instanceof AbortSignal);options.assertCurrent();return raw(target,false);};}
  const runtime={componentStoreRoot:root,componentSelection:()=>selector,host:{}};
  const console={runtime,epoch:0,busy:new Set(),closed:false,refreshRevision:0,refreshing:null,check(r,e){if(this.closed||r!==this.runtime||e!==this.epoch)throw error('changed');},refresh:async()=>{calls.push('refresh');},abortDirectory:()=>{}};
  const manager=new QQComponents({console,lockRecoveryFactory:options=>{assert.equal(options.selection,selector);assert.equal(options.processHost,runtime.host);return recovery;}});t.after(()=>manager.close());
  const preview=target=>manager.execute({action:'lock-preview',target}),recover=target=>manager.execute({action:'lock-recover',target,expectedDigest:DIGEST});
  return {calls,selector,recovery,runtime,console,manager,preview,recover};
}

test('lock request boundary accepts only fixed targets and a digest, never process or file authority',async t=>{
  const f=fixture(t);for(const request of [
    {action:'lock-preview'},{action:'lock-preview',target:['component']},{action:'lock-preview',target:'__proto__'},
    {action:'lock-preview',target:'component',path:'PRIVATE'}, {action:'lock-recover',target:'component',expectedDigest:DIGEST,pid:42},
    {action:'lock-recover',target:'recovery',expectedDigest:'x'.repeat(64)}, {action:'lock-preview',target:'configuration',token:'PRIVATE'}
  ])await assert.rejects(f.manager.execute(request),{code:'invalid_request'});assert.deepEqual(f.calls,[]);
});

for(const target of Object.keys(targets))test(`${target}: preview, explicit one-use recovery, bounded receipt and reopening state`,async t=>{
  const f=fixture(t),{lockPreview}=await f.preview(target);
  assert.equal(lockPreview.target,target);assert.equal(lockPreview.expectedDigest,DIGEST);assert.equal(lockPreview.configurationRestored,false);assert.doesNotMatch(JSON.stringify(lockPreview),/PRIVATE|owner|pid|executable|token/);
  // An ordinary read refresh does not authorize or invalidate an unchanged preview.
  await f.manager.execute({action:'status'});const result=await f.recover(target);
  assert.equal(result.target,target);assert.equal(result.committed,true);assert.equal(result.recovery.recovered,true);assert.equal(result.recovery.automaticStart,false);assert.equal(result.recovery.selectionChanged,false);assert.equal(result.recovery.configurationRestored,false);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|owner|pid|executable|token|previousDigest/);
  assert.deepEqual(f.calls,[...targets[target],'refresh']);assert.deepEqual(f.manager.snapshot().lastRecovery,result);
  const copy=f.manager.snapshot();copy.lastRecovery.target='bad';assert.equal(f.manager.snapshot().lastRecovery.target,target);
  await assert.rejects(f.recover(target),{code:'preview_required'});assert.equal(f.calls.filter(v=>v===targets[target][1]).length,1);
});

test('a preview cannot be changed to a different target or digest and failed consumption is one-use',async t=>{
  const f=fixture(t);await f.preview('component');await assert.rejects(f.recover('recovery'),{code:'preview_required'});await assert.rejects(f.recover('component'),{code:'preview_required'});
  await f.preview('component');await assert.rejects(f.manager.execute({action:'lock-recover',target:'component',expectedDigest:'e'.repeat(64)}),{code:'preview_required'});
  assert.deepEqual(f.calls,['preview','preview']);
});

test('cancel or a new target inspection invalidates the previous server-side preview',async t=>{
  const f=fixture(t);await f.preview('component');assert.deepEqual(await f.manager.execute({action:'cancel'}),{cancelRequested:false});await assert.rejects(f.recover('component'),{code:'preview_required'});
  await f.preview('component');await f.preview('configuration');await assert.rejects(f.recover('component'),{code:'preview_required'});assert(!f.calls.includes('recover'));
});

test('existing console work excludes recovery and recovery excludes other console operations',async t=>{
  const f=fixture(t);f.console.busy.add('other');await assert.rejects(f.preview('component'),{code:'operation_in_progress'});assert.deepEqual(f.calls,[]);f.console.busy.clear();
  const gate=deferred();f.recovery.preview=async()=>{assert(f.console.busy.has('qq-components'));await gate.promise;return raw('component',true);};
  const pending=f.preview('component');await next();assert(f.console.busy.has('qq-components'));await assert.rejects(f.preview('configuration'),{code:'operation_in_progress'});gate.resolve();await pending;assert.equal(f.console.busy.size,0);
});

test('changed console epoch, selector identity or fixed installation path prevents mutation',async t=>{
  for(const change of [f=>f.console.epoch++,f=>{f.runtime.componentSelection=()=>({...f.selector});},f=>{f.selector.lockFile+='-changed';}]){
    const f=fixture(t);await f.preview('component');change(f);await assert.rejects(f.recover('component'),e=>['changed','preview_required'].includes(e.code));assert(!f.calls.includes('recover'));
  }
});

test('late preview after cancellation cannot seed a reusable cached result',async t=>{
  const f=fixture(t),gate=deferred();f.recovery.preview=()=>gate.promise;const pending=f.preview('component'),rejected=assert.rejects(pending,{code:'cancelled'});await next();await f.manager.execute({action:'cancel'});gate.resolve(raw('component',true));await rejected;await assert.rejects(f.recover('component'),{code:'preview_required'});
});

test('recovery checks the current epoch and cancellation again before its actual mutation',async t=>{
  for(const change of [f=>f.console.epoch++,f=>f.manager.execute({action:'cancel'})]){
    const f=fixture(t),gate=deferred();await f.preview('component');let writes=0;
    f.recovery.recover=async options=>{await gate.promise;options.assertCurrent();writes++;return raw('component',false);};
    const pending=f.recover('component'),rejected=assert.rejects(pending,e=>['changed','cancelled'].includes(e.code));await next();await change(f);gate.resolve();await rejected;assert.equal(writes,0);assert.equal(f.manager.snapshot().lastRecovery,null);
  }
});

test('legacy, live-owner and malformed records remain actionable fixed errors, with no private payload',async t=>{
  const f=fixture(t);for(const code of ['lock_proof_unavailable','configuration_proof_unavailable','owner_alive','owner_identity_changed','configuration_link_changed','recovery_guard_missing','recovery_in_progress','private_dynamic_error']){
    f.recovery.preview=async()=>{throw error(code);};await assert.rejects(f.preview('component'),e=>e.code===(code==='private_dynamic_error'?'components_failed':code)&&!e.message.includes('PRIVATE'));
  }assert.equal(f.manager.snapshot().lastRecovery,null);
});

test('invalid preview summaries never permit recovery',async t=>{
  const f=fixture(t);for(const value of [{...raw('component',true),automaticStart:true},{...raw('component',true),digest:null},{...raw('component',true),selectionChanged:true},{...raw('component',true),recovery:'guard-eligible'}]){
    f.recovery.preview=async()=>value;await assert.rejects(f.preview('component'),{code:'invalid_response'});await assert.rejects(f.recover('component'),{code:'preview_required'});
  }
});

test('confirmed cleanup survives a failed refresh and retains secondary cleanup diagnostics',async t=>{
  const f=fixture(t);await f.preview('component');f.recovery.recover=async()=>({...raw('component',false),guardRemaining:true,recoveryIssue:'recovery_guard_retained'});f.console.refresh=async()=>{throw error('process_check_failed');};
  const result=await f.recover('component');assert.equal(result.committed,true);assert.equal(result.recovery.recoveryGuardRemaining,true);assert.equal(result.recovery.componentLockRemaining,false);assert.equal(result.recoveryIssue,'recovery_guard_retained');assert.equal(result.refreshIssue,'process_check_failed');assert.deepEqual(f.manager.snapshot().lastRecovery,result);
});

test('post-deletion error retains committed outcome without inventing remaining-file flags',async t=>{
  const f=fixture(t);await f.preview('configuration');f.recovery.recoverConfiguration=async()=>{throw error('recovery_readback_failed',{committed:true});};
  const result=await f.recover('configuration');assert.deepEqual(result,{target:'configuration',committed:true,recovery:null,refreshIssue:'recovery_readback_failed'});assert.deepEqual(f.manager.snapshot().lastRecovery,result);await assert.rejects(f.recover('configuration'),{code:'preview_required'});
});

test('an unreadable cleanup guard retains the unknown flag and its specific diagnostic',async t=>{
  const f=fixture(t);await f.preview('component');f.recovery.recover=async()=>({...raw('component',false),guardRemaining:null,recoveryIssue:'recovery_guard_state_unverified'});
  const result=await f.recover('component');assert.equal(result.recovery.recovered,true);assert.equal(result.recovery.recoveryGuardRemaining,null);assert.equal(result.recoveryIssue,'recovery_guard_state_unverified');assert.equal(result.refreshIssue,undefined);
});

test('invalid cleanup response is not presented as a verified recovered record',async t=>{
  const f=fixture(t);await f.preview('recovery');f.recovery.recoverGuard=async()=>({recovered:true,automaticStart:true,token:'PRIVATE'});const result=await f.recover('recovery');assert.equal(result.recovery,null);assert.equal(result.refreshIssue,'invalid_response');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('drawer closure-equivalent cancel after commit cannot erase the receipt while refresh is pending',async t=>{
  const f=fixture(t),gate=deferred();await f.preview('component');f.console.refresh=()=>gate.promise;const pending=f.recover('component');await next();assert.equal(f.manager.snapshot().lastRecovery.committed,true);assert.deepEqual(await f.manager.execute({action:'cancel'}),{cancelRequested:false});gate.resolve();assert.equal((await pending).recovery.recovered,true);
});

test('installation change after commit retains direct receipt but removes old installation snapshot',async t=>{
  const f=fixture(t),gate=deferred();await f.preview('component');f.console.refresh=()=>gate.promise;const pending=f.recover('component');await next();f.console.epoch++;assert.equal(f.manager.snapshot().lastRecovery,null);gate.resolve();const result=await pending;assert.equal(result.committed,true);assert.equal(result.refreshIssue,'changed');assert.equal(f.manager.snapshot().lastRecovery,null);
});

test('a saved component choice retains its nonfatal lock cleanup warning',async t=>{
  const f=fixture(t);f.selector.rollback=async()=>({...f.selector.status(),lockRecoveryIssue:'component_lock_retained'});
  const result=await f.manager.execute({action:'rollback',expectedDigest:DIGEST});assert.equal(result.committed,true);assert.equal(result.lockRecoveryIssue,'component_lock_retained');assert.equal(f.manager.snapshot().lastCode,'component_lock_retained');
});
