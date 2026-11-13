'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt}=require('../src/bot/qq-console.cjs');
const A='12345001',B='12345002',DIGEST='a'.repeat(64),clone=value=>JSON.parse(JSON.stringify(value));
const source=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
const start=source.indexOf('    const qqOrphanResult='),end=source.indexOf('    const providerLogin=',start);assert(start>=0&&end>start);
function fixture(){
  const calls=[],handlers=new Map(),rows=[{id:'target',channel:'qq',status:'connected',accountId:A},{id:'expected',channel:'qq',status:'reconnecting',expectedQQAccountId:A},{id:'historical',channel:'qq',status:'connecting',qqBinding:{accountId:A}},{id:'unknown',channel:'qq',status:'connecting'},{id:'other',channel:'qq',status:'connected',accountId:B,expectedQQAccountId:B,qqBinding:{accountId:B}},{id:'wechat',channel:'wechat',status:'connected',accountId:A},{id:'already-offline',channel:'qq',status:'disconnected',accountId:A}];
  const accounts={services:new Map(rows.map(row=>[row.id,{status:row.status}])),snapshot:()=>({accounts:rows.map(row=>({...row}))}),disconnect:async id=>{calls.push(`disconnect:${id}`);accounts.services.get(id).status='disconnected';rows.find(row=>row.id===id).status='disconnected';}};
  const qqConsole={busy:new Set(),previewOrphanCleanup:async accountId=>{calls.push('preview');return {accountId,count:5,expectedDigest:DIGEST,automaticStart:false};},cleanupOrphans:async(accountId,options,beforeStop)=>{calls.push('proof');await beforeStop();calls.push('stop');return {recovery:'orphans-cleared',terminatedCount:5,automaticStart:false,state:{instances:[]}};}};
  const context={register:(name,handler)=>handlers.set(name,handler),validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt,qqConsole,accounts,qqStopping:new Set(),voiceAccount:'target',closeVoice:async reason=>{calls.push(`voice:${reason}`);}};
  vm.runInNewContext(source.slice(start,end),context);
  return {calls,rows,accounts,qqConsole,context,preview:handlers.get('qqRuntimeOrphanPreview'),cleanup:handlers.get('qqRuntimeOrphanCleanup'),discard:handlers.get('qqRuntimeOrphanDiscard')};
}
test('orphan IPC rejects process identities, paths and arbitrary commands before any coordinator call',async()=>{
  const f=fixture();for(const value of [null,{accountId:A,pid:123},{accountId:A,paths:['private']},{accountId:A,action:'stop'}])assert.deepEqual(clone(await f.preview(value)),{ok:false,code:'invalid_config'});
  for(const value of [null,{accountId:A,expectedDigest:DIGEST,pids:[1]},{accountId:A,expectedDigest:DIGEST,url:'private'},{accountId:A,expectedDigest:'wrong'}])assert.deepEqual(clone(await f.cleanup(value)),{ok:false,code:'invalid_config'});assert.deepEqual(f.calls,[]);assert.equal(f.context.qqStopping.size,0);
});
test('preview remains read-only and proof rejection leaves every companion connected',async()=>{
  const f=fixture();const preview=await f.preview({accountId:A});assert.equal(preview.ok,true);assert.deepEqual(f.calls,['preview']);f.qqConsole.cleanupOrphans=async()=>{throw Object.assign(Error('private proof'),{code:'orphan_cleanup_changed'});};assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'orphan_cleanup_changed'});assert.deepEqual(f.calls,['preview']);assert.equal(f.accounts.services.get('target').status,'connected');assert.equal(f.context.qqStopping.size,0);
});
test('validated cleanup disconnects only bound or unknown QQ services and closes their voice before stopping',async()=>{
  const f=fixture();const result=await f.cleanup({accountId:A,expectedDigest:DIGEST});assert.equal(result.ok,true);assert.equal(result.terminatedCount,5);assert.deepEqual(f.calls,['proof','voice:connection-ended','disconnect:target','disconnect:expected','disconnect:historical','disconnect:unknown','stop']);assert.equal(f.accounts.services.get('other').status,'connected');assert.equal(f.accounts.services.get('wechat').status,'connected');assert.equal(f.context.qqStopping.size,0);
});
test('a service replaced during voice shutdown is not disconnected under the old cleanup confirmation',async()=>{
  const f=fixture();const replacement={status:'connected'};f.context.closeVoice=async()=>{f.accounts.services.set('target',replacement);};const result=await f.cleanup({accountId:A,expectedDigest:DIGEST});assert.deepEqual(clone(result),{ok:false,code:'changed'});assert.deepEqual(f.calls,['proof']);assert.equal(replacement.status,'connected');assert.equal(f.context.qqStopping.size,0);
});
test('failed disconnection prevents stop and always releases the account connect guard',async()=>{
  const f=fixture();f.accounts.disconnect=async()=>{};assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'account_connected'});assert(!f.calls.includes('stop'));assert.equal(f.context.qqStopping.size,0);
  f.accounts.disconnect=async()=>{throw Object.assign(Error('PRIVATE_TOKEN'),{code:'disconnect_failed_secret'});};assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'operation_failed'});assert(!f.calls.includes('stop'));assert.equal(f.context.qqStopping.size,0);
});
test('an account remains guarded across asynchronous cleanup and duplicate confirmation is rejected',async()=>{
  const f=fixture();let release;f.qqConsole.cleanupOrphans=()=>new Promise(resolve=>{release=resolve;});const pending=f.cleanup({accountId:A,expectedDigest:DIGEST});assert(f.context.qqStopping.has(A));assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'operation_in_progress'});release({recovery:'orphans-cleared',terminatedCount:5,automaticStart:false,refreshIssue:'process_check_failed'});assert.deepEqual(clone(await pending),{ok:true,recovery:'orphans-cleared',terminatedCount:5,automaticStart:false,refreshIssue:'process_check_failed'});assert.equal(f.context.qqStopping.size,0);
});
test('the existing account connection entrypoint refuses the cleanup target and unverified QQ profiles while allowing known others',async()=>{
  const f=fixture(),connectStart=source.indexOf('    const connectCompanion='),connectEnd=source.indexOf("    register('accountConnect'",connectStart);assert(connectStart>=0&&connectEnd>connectStart);f.accounts.connect=id=>{f.calls.push(`connect:${id}`);return id;};vm.runInNewContext(source.slice(connectStart,connectEnd)+'globalThis.connectCompanion=connectCompanion;',f.context);f.context.qqStopping.add(A);
  for(const id of ['target','expected','historical','unknown','already-offline'])assert.throws(()=>f.context.connectCompanion(id),{code:'operation_in_progress'});assert.equal(f.context.connectCompanion('other'),'other');assert.equal(f.context.connectCompanion('wechat'),'wechat');assert.deepEqual(f.calls,['connect:other','connect:wechat']);
  f.context.qqStopping.clear();f.qqConsole.busy.add('qq-setup');for(const id of ['target','other','unknown'])assert.throws(()=>f.context.connectCompanion(id),{code:'operation_in_progress'});assert.equal(f.context.connectCompanion('wechat'),'wechat');
});
test('IPC preserves attempted-but-unconfirmed results with fixed codes and no invented partial counts',async()=>{
  const f=fixture();f.qqConsole.cleanupOrphans=async()=>{throw Object.assign(Error('RAW_TOKEN_AND_PATH'),{code:'orphan_cleanup_incomplete',cleanupAttempted:true,terminatedCount:3,pids:[1],path:'private'});};assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'orphan_cleanup_incomplete',cleanupAttempted:true});
  f.qqConsole.cleanupOrphans=async()=>{throw Object.assign(Error('PRIVATE'),{code:'valid_identifier_is_still_secret',cleanupAttempted:'true'});};assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'operation_failed'});
});
test('discard IPC validates the exact receipt without disconnecting services or starting work',async()=>{
  const f=fixture();f.qqConsole.discardOrphanPreview=(id,options)=>{f.calls.push(['discard',id,options.expectedDigest]);return {discarded:true};};
  for(const value of [null,{accountId:A},{accountId:A,expectedDigest:DIGEST,pids:[1]}])assert.deepEqual(clone(await f.discard(value)),{ok:false,code:'invalid_config'});
  assert.deepEqual(clone(await f.discard({accountId:A,expectedDigest:DIGEST})),{ok:true,discarded:true});assert.deepEqual(f.calls,[['discard',A,DIGEST]]);assert.equal(f.context.qqStopping.size,0);assert.equal(f.accounts.services.get('target').status,'connected');
});
test('IPC carries only exact typed partial facts for the requested account',async()=>{
  const f=fixture(),detail={kind:'pending-shell-orphan-cleanup',accountId:A,selectedCount:2,confirmedAbsentCount:2,terminationAttempted:true,processes:'confirmed-absent',lease:'retained',resources:'unconfirmed',automaticStart:false,pendingUpdateRecoveryRequired:true};
  f.qqConsole.cleanupOrphans=async()=>{throw Object.assign(Error('PRIVATE'),{code:'cleanup_unconfirmed',cleanupAttempted:true,cleanup:detail});};assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'cleanup_unconfirmed',cleanupAttempted:true,cleanup:detail});
  detail.accountId=B;assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'cleanup_unconfirmed',cleanupAttempted:true});detail.accountId=A;detail.path='PRIVATE';assert.deepEqual(clone(await f.cleanup({accountId:A,expectedDigest:DIGEST})),{ok:false,code:'cleanup_unconfirmed',cleanupAttempted:true});
});
test('preload exposes fixed orphan preview, cleanup and discard, with no process or generic execution API',async()=>{
  let api;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {ok:true};}}};}});
  const preview={accountId:A},cleanup={accountId:A,expectedDigest:DIGEST};await api.qqRuntimeOrphanPreview(preview);await api.qqRuntimeOrphanCleanup(cleanup);await api.qqRuntimeOrphanDiscard(cleanup);assert.deepEqual(calls,[['arcade:qqRuntimeOrphanPreview',preview],['arcade:qqRuntimeOrphanCleanup',cleanup],['arcade:qqRuntimeOrphanDiscard',cleanup]]);assert.equal(api.killProcess,undefined);assert.equal(api.qqAction,undefined);assert.equal(api.qqRequest,undefined);
});
