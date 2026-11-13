'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,ID,deferred}=require('./helpers/qq-plugin-deployment-fixture.cjs');
const {QQPluginPackageSession,pluginPackageRequest,pluginPackageResult}=require('../src/bot/qq-plugin-package-session.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t){
 const f=fixture(t),input={accountId:'fixture-profile',panelId:randomUUID()},binding={profileId:input.accountId,panelId:input.panelId,profile:{},generation:0,characterId:'fixture',runtime:{},installation:{},runtimeEpoch:1,qqAccountId:'100001',channel:'qq',status:'disconnected',componentVersion:'4.18.42',workScope:'c'.repeat(64),workScopeKind:'installation',affectedProfiles:[{accountId:input.accountId,label:'Fixture'}],workDir:f.workDir,configDir:f.configDir};
 const state={created:0,closed:0,reads:0,previews:0,confirms:0,options:null,readHold:null,confirmHold:null,readPatch:{},previewPatch:{},changePatch:{}};
 const catalog={list:async()=>({catalogId:'d'.repeat(64),source:'https://github.com/NapNeko/napcat-plugin-index',archived:true,indexLicense:'readme-mit-declaration',authorAuthenticated:false,items:[]})};
 const session=new QQPluginPackageSession({capture:()=>({...binding}),withDeploymentLock:(capture,options,fn)=>f.options.withDeploymentLock(options,fn),picker:async()=>null,artifacts:f.artifacts,catalog,now:f.options.now,monotonic:f.options.monotonic,replyFactory:options=>{
  state.created++;state.options=options;let observation=null,ticket=null,closed=false;
  const check=signal=>{options.assertCurrent();if(closed||signal?.aborted)throw Object.assign(Error('closed synthetic'),{code:'changed'});};
  const base=()=>({pluginId:ID,version:'1.0.0',scope:options.scope,pluginStarted:false,privatePath:'SYNTHETIC_PRIVATE_CONFIG',text:'SYNTHETIC_PRIVATE_BODY'});
  return {async read({signal}){state.reads++;check(signal);if(state.readHold)await state.readHold.promise;check(signal);observation=randomUUID();return {...base(),kind:'builtin-offline-replies',observationId:observation,fetchedAt:new Date(f.state.now).toISOString(),enabled:false,before:{present:false,value:null,effective:true,private:'SYNTHETIC_PRIVATE'},unchanged:false,requiresStopped:true,...state.readPatch};},
   preview({observationId},{signal}){check(signal);state.previews++;if(!observation||observation!==observationId)throw Object.assign(Error('stale synthetic'),{code:'stale_observation'});ticket=randomUUID();return {...base(),kind:'builtin-offline-replies-preview',ticketId:ticket,observationId,expiresAt:f.state.now+300000,enabled:false,before:{present:false,value:null,effective:true},after:{present:true,value:false,effective:false},requiresStopped:true,backup:{willPreserve:true,originalPresent:true,private:'SYNTHETIC_PRIVATE'},automaticRetry:false,...state.previewPatch};},
   async confirm({ticketId},{signal}){check(signal);if(!ticket||ticket!==ticketId)throw Object.assign(Error('stale synthetic'),{code:'stale_ticket'});ticket=null;state.confirms++;if(state.confirmHold)await state.confirmHold.promise;return {...base(),kind:'builtin-offline-replies-change',ticketId,outcome:'committed',committed:true,readbackVerified:true,backupId:randomUUID(),originalPreserved:true,otherFieldsPreserved:true,replyDisabledVerified:true,automaticRetry:false,...state.changePatch};},
   discardPreview(){ticket=null;},close(){closed=true;observation=null;ticket=null;state.closed++;return Promise.resolve({closed:true});}};
 }});t.after(()=>session.close());
 const read=()=>session.read(input),replyRead=async()=>{await read();return session.builtinRead(input);},preview=async()=>{const r=await replyRead();return session.builtinPreview({...input,observationId:r.replySettings.observationId});};
 return {...f,input,binding,state,session,read,replyRead,preview};
}

test('builtin requests have only fixed correlation, observation or ticket IDs',()=>{
 const input={accountId:'fixture-profile',panelId:randomUUID()};
 for(const action of ['builtinRead','builtinDismiss']){assert.equal(pluginPackageRequest(input,action),input);assert.throws(()=>pluginPackageRequest({...input,pluginId:ID},action),{code:'invalid_request'});}
 for(const [action,key]of [['builtinPreview','observationId'],['builtinConfirm','ticketId']]){assert(pluginPackageRequest({...input,[key]:randomUUID()},action));for(const value of [null,'arbitrary',1])assert.throws(()=>pluginPackageRequest({...input,[key]:value},action),{code:'invalid_request'});assert.throws(()=>pluginPackageRequest({...input,[key]:randomUUID(),enableReply:false},action),{code:'invalid_request'});}
});
test('builtin read requires an existing package panel and receives its exact captured lease scope',async t=>{
 const f=setup(t);assert.throws(()=>f.session.builtinRead(f.input),{code:'changed'});assert.equal(f.state.created,0);
 const r=await f.replyRead();assert.equal(f.state.created,1);assert.equal(f.state.options.workDir,f.workDir);assert.equal(f.state.options.configDir,f.configDir);assert.deepEqual(f.state.options.scope,{kind:'installation',affectedProfiles:f.binding.affectedProfiles});assert.equal(r.qqAccountId,f.binding.qqAccountId);assert.equal(r.replySettings.before.value,null);assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'),false);assert.equal(JSON.stringify(r).includes(f.workDir),false);
 f.binding.generation++;assert.throws(()=>f.state.options.assertCurrent(),{code:'changed'});
});
test('builtin result projection rejects contradictory settings and previews, strips private fields',async t=>{
 const f=setup(t);await f.read();
 for(const patch of [{unchanged:true},{enabled:true},{before:{present:false,value:false,effective:false}},{before:{present:true,value:false,effective:true}},{version:'2.0.0'},{scope:{kind:'installation',affectedProfiles:[{accountId:'other',label:'Other'}]}}]){f.state.readPatch=patch;await assert.rejects(f.session.builtinRead(f.input),{code:'invalid_response'});}f.state.readPatch={};
 let r=await f.session.builtinRead(f.input);
 for(const patch of [{observationId:randomUUID()},{after:{present:true,value:true,effective:true}},{backup:{willPreserve:false,originalPresent:true}},{automaticRetry:true},{pluginStarted:true}]){f.state.previewPatch=patch;await assert.rejects(f.session.builtinPreview({...f.input,observationId:r.replySettings.observationId}),{code:'invalid_response'});}
 f.state.previewPatch={};const p=await f.session.builtinPreview({...f.input,observationId:r.replySettings.observationId});assert.equal(JSON.stringify(p).includes('SYNTHETIC_PRIVATE'),false);assert.equal(p.replyPreview.after.value,false);
});
test('file operations and both dismiss routes invalidate reply observations as well as tickets',async t=>{
 const f=setup(t);
 for(const action of ['catalog','prepareLocal','read','dismiss','builtinDismiss','preview']){
  const r=await f.replyRead(),p=await f.session.builtinPreview({...f.input,observationId:r.replySettings.observationId});
  if(action==='preview'){const observationId=f.session.session.controller.baseline.id;await f.session.preview({...f.input,observationId,operation:'install',pluginId:ID,preparedId:f.preparedId});}
  else await f.session[action](f.input);
  assert.throws(()=>f.session.builtinConfirm({...f.input,ticketId:p.replyPreview.ticketId}),{code:'stale_ticket'});
  await assert.rejects(f.session.builtinPreview({...f.input,observationId:r.replySettings.observationId}),{code:'stale_observation'});
 }
});
test('reply actions revoke file tickets and the two confirmation families cannot cross-use IDs',async t=>{
 const f=setup(t),r=await f.read(),p=await f.session.preview({...f.input,observationId:r.profile.observationId,operation:'install',pluginId:ID,preparedId:f.preparedId});
 assert.throws(()=>f.session.builtinConfirm({...f.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});
 const settings=await f.session.builtinRead(f.input);assert.throws(()=>f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});
 const reply=await f.session.builtinPreview({...f.input,observationId:settings.replySettings.observationId});assert.throws(()=>f.session.confirm({...f.input,ticketId:reply.replyPreview.ticketId}),{code:'stale_ticket'});
 const changed=await f.session.builtinConfirm({...f.input,ticketId:reply.replyPreview.ticketId});assert.equal(changed.replyChange.replyDisabledVerified,true);assert.equal(JSON.stringify(changed).includes('SYNTHETIC_PRIVATE'),false);assert.throws(()=>f.session.builtinConfirm({...f.input,ticketId:reply.replyPreview.ticketId}),{code:'stale_ticket'});assert.equal(f.state.confirms,1);
});
test('busy mutual exclusion preserves executing controller; owned close waits and prevents late read',async t=>{
 const f=setup(t);await f.read();f.state.readHold=deferred();const pending=f.session.builtinRead(f.input);await flush();
 for(const action of ['builtinRead','builtinDismiss','catalog','dismiss'])assert.throws(()=>f.session[action](f.input),{code:'operation_in_progress'});assert.equal(f.state.closed,0);
 let settled=false;const closing=f.session.closeOwned(f.input).then(()=>{settled=true;});await flush();assert.equal(settled,false);assert.equal(f.state.closed,1);f.state.readHold.resolve();await assert.rejects(pending,{code:'changed'});await closing;
});
test('close before builtin read microtask never constructs a late controller',async t=>{
 const f=setup(t);await f.read();const pending=f.session.builtinRead(f.input),closing=f.session.closeOwned(f.input);await assert.rejects(pending,{code:'changed'});await closing;assert.equal(f.state.created,0);
});
test('late known commit keeps original correlation and cleanup issue; old close cannot retire new panel',async t=>{
 const f=setup(t),p=await f.preview();f.state.confirmHold=deferred();f.state.changePatch={code:'configuration_marker_retained',configurationRecoveryIssue:'configuration_marker_retained'};const old={...f.input},pending=f.session.builtinConfirm({...old,ticketId:p.replyPreview.ticketId});await flush();const closing=f.session.closeOwned(old);
 f.input.panelId=randomUUID();f.binding.panelId=f.input.panelId;const opening=f.read();await flush();f.state.confirmHold.resolve();const r=await pending;assert.equal(r.panelId,old.panelId);assert.equal(r.replyChange.committed,true);assert.equal(r.replyChange.configurationRecoveryIssue,'configuration_marker_retained');await closing;await opening;await f.session.closeOwned(old);assert.equal(f.session.session.panelId,f.input.panelId);
});
test('unknown/not-committed metadata cannot turn into verified disable and malformed results are rejected',async t=>{
 const f=setup(t);
 for(const outcome of ['unknown','not_committed']){const p=await f.preview();f.state.changePatch={outcome,committed:outcome==='unknown'?null:false,readbackVerified:false,otherFieldsPreserved:false,replyDisabledVerified:false,backupId:null,originalPreserved:false,code:'write_unknown'};const r=await f.session.builtinConfirm({...f.input,ticketId:p.replyPreview.ticketId});assert.equal(r.replyChange.outcome,outcome);assert.equal(r.replyChange.replyDisabledVerified,false);}
 for(const patch of [{outcome:'unknown',committed:null},{backupId:null},{configurationRecoveryIssue:'raw private path'},{ticketId:randomUUID()},{otherFieldsPreserved:false}]){f.state.changePatch=patch;const p=await f.preview();await assert.rejects(f.session.builtinConfirm({...f.input,ticketId:p.replyPreview.ticketId}),{code:'invalid_response'});assert.throws(()=>f.session.builtinConfirm({...f.input,ticketId:p.replyPreview.ticketId}),{code:'stale_ticket'});}
});
test('new fixed errors remain safe, while arbitrary failures expose no body or path',async()=>{
 const input={accountId:'fixture-profile',panelId:randomUUID()};
 for(const code of ['builtin_not_supported','plugin_not_disabled','config_invalid','config_changed','no_changes','backup_failed','write_unknown','configuration_marker_retained']){const r=await pluginPackageResult(input,()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_BODY'),{code});});assert.equal(r.code,code);assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'),false);}
 const r=await pluginPackageResult(input,()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_BODY'),{code:'SYNTHETIC_PRIVATE_PATH'});});assert.equal(r.code,'deployment_failed');assert.equal(JSON.stringify(r).includes('SYNTHETIC_PRIVATE'),false);
});
