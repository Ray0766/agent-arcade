'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {QQPluginAdmin}=require('../src/bot/qq-plugin-admin.cjs'),{QQPluginAdminSession}=require('../src/bot/qq-plugin-admin-session.cjs'),{NapCatWebUI}=require('../src/bot/napcat-webui.cjs');
const {fixture,ACCOUNT,OWNER,deferred}=require('./helpers/qq-plugin-admin-fixture.cjs');
const ID='napcat-plugin-qce';
async function prepare(f,enable=true,controller=f.controller){const read=await controller.read();return controller.preview({observationId:read.observationId,pluginId:ID,enable});}
const qce=f=>{f.state.plugins=[{id:ID,name:'Synthetic QCE',version:'6.4.2',status:'disabled'}];return f;};
test('6.4.2 plugin enable is not submitted without a managed launch verifier; disable remains available',async t=>{
 const f=qce(await fixture(t)),p=await prepare(f),r=await f.controller.confirm({ticketId:p.ticketId});assert.equal(r.outcome,'not_submitted');assert.equal(r.code,'qce_process_unverified');assert.equal(f.writes().length,0);
 const d=await prepare(f,false);assert.equal((await f.controller.confirm({ticketId:d.ticketId})).outcome,'acknowledged');assert.deepEqual(f.writes().map(r=>r.body),[{id:ID,enable:false}]);
});
test('verified enable runs the exact returned synchronous guard through the client send boundary',async t=>{
 const f=qce(await fixture(t));let checks=0,calls=0;const c=new QQPluginAdmin({...f.controllerOptions,verifyEnable:async options=>{calls++;options.assertCurrent();return {assertCurrent:()=>{options.assertCurrent();checks++;}};}});t.after(()=>c.close());
 const p=await prepare(f,true,c),r=await c.confirm({ticketId:p.ticketId});assert.equal(r.outcome,'acknowledged');assert.equal(calls,1);assert(checks>=2);assert.equal(f.writes().length,1);await assert.rejects(c.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});
});
test('changed startup after preflight prevents the final SetStatus write with an accurate not-submitted result',async t=>{
 const f=qce(await fixture(t));let calls=0;const original=f.client.setPluginStatus.bind(f.client);f.client.setPluginStatus=async(input,options)=>{calls++;f.state.startupChanged=true;return original(input,options);};
 const c=new QQPluginAdmin({...f.controllerOptions,verifyEnable:async()=>({assertCurrent:()=>{if(f.state.startupChanged)throw Object.assign(Error('synthetic change'),{code:'qce_startup_changed'});}})});t.after(()=>c.close());
 const p=await prepare(f,true,c),r=await c.confirm({ticketId:p.ticketId});assert.equal(calls,1);assert.equal(r.outcome,'not_submitted');assert.equal(r.code,'qce_startup_changed');assert.equal(f.writes().length,0);
});
test('older QCE enable does not invoke the new version verifier',async t=>{
 const f=qce(await fixture(t));f.state.plugins[0].version='5.5.77';let calls=0;const c=new QQPluginAdmin({...f.controllerOptions,verifyEnable:async()=>{calls++;throw Error('must not run');}});t.after(()=>c.close());const p=await prepare(f,true,c);assert.equal((await c.confirm({ticketId:p.ticketId})).outcome,'acknowledged');assert.equal(calls,0);assert.equal(f.writes().length,1);
});
async function sessionFixture(t,verifyEnable){
 const f=qce(await fixture(t)),input={accountId:'synthetic-a',panelId:randomUUID()},context={profileId:input.accountId,panelId:input.panelId,profile:{},generation:1,characterId:'synthetic-persona',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-revision',qqAccountId:ACCOUNT,ownerId:OWNER,url:'ws://127.0.0.1:3001/',token:'synthetic-onebot-token',channel:'qq',status:'disconnected',endpointId:'synthetic-endpoint',componentVersion:'4.18.42',workScope:'a'.repeat(64),workScopeKind:'installation',affectedProfiles:f.scope.affectedProfiles};
 const session=new QQPluginAdminSession({capture:v=>({...context,panelId:v.panelId}),verifyContext:async()=>({verified:true,endpoint:{port:f.options.port,token:f.options.token,endpointId:context.endpointId}}),verifyEnable:(binding,options)=>verifyEnable(binding,options,context),clientFactory:o=>new NapCatWebUI({...f.options,...o}),controllerFactory:o=>new QQPluginAdmin({...o,now:()=>f.state.now,monotonic:()=>f.state.mono,timeoutMs:2000})});t.after(()=>session.close());return {...f,session,input,context};
}
test('session forwards its captured runtime; closing during enable preflight revokes the late verifier',async t=>{
 const entered=deferred(),held=deferred();const f=await sessionFixture(t,async(binding,options,context)=>{assert.equal(binding.runtime,context.runtime);assert.equal(binding.qqAccountId,ACCOUNT);entered.resolve();await held.promise;return {assertCurrent:()=>options.assertCurrent()};});const read=await f.session.read(f.input),p=f.session.preview({...f.input,observationId:read.profile.observationId,pluginId:ID,enable:true});const pending=f.session.confirm({...f.input,ticketId:p.preview.ticketId});await entered.promise;const close=f.session.closeOwned(f.input);held.resolve();const r=await pending;await close;assert.equal(r.change.outcome,'not_submitted');assert.equal(f.writes().length,0);assert.equal(f.session.session,null);
});
test('actual registered main plugin route supplies fixed runtime and surfaces refusal, then accepts one verified enable',async t=>{
 const {fixture:mainFixture}=require('./helpers/qq-qce-main-fixture.cjs'),f=await mainFixture(t);f.state.plugins[0].version='6.4.2';f.state.plugins[0].status='disabled';const invoke=(name,input=f.input)=>f.handlers.get('arcade:qqPluginAdmin'+name)(f.event,input);
 const preview=async()=>{const r=await invoke('Read');assert.equal(r.ok,true);const p=await invoke('Preview',{...f.input,observationId:r.profile.observationId,pluginId:ID,enable:true});assert.equal(p.ok,true);return p.preview;};
 let p=await preview(),r=await invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(r.change.outcome,'not_submitted');assert.equal(r.change.code,'qce_process_unverified');assert.equal(f.calls.filter(r=>r.path==='/api/Plugin/SetStatus').length,0);
 f.state.enableVerify=async options=>({assertCurrent:()=>options.assertCurrent()});p=await preview();r=await invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(r.change.outcome,'acknowledged');assert.equal(f.state.enableProofs,2);assert.deepEqual(f.calls.filter(r=>r.path==='/api/Plugin/SetStatus').map(r=>r.body),[{id:ID,enable:true}]);
});
