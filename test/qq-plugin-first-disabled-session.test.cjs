'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {IDS}=require('../src/bot/qq-plugin-deployment.cjs');
const {pluginPackageRequest,profileProjection,previewProjection,changeProjection}=require('../src/bot/qq-plugin-package-session.cjs');
const pluginId='napcat-plugin-builtin';
const scope={kind:'installation',affectedProfiles:[{accountId:'fixture',label:'Fixture'}]};
const session={binding:{workScopeKind:scope.kind,affectedProfiles:scope.affectedProfiles}};
function preview(initialDisabled=true){
 const input={accountId:'fixture',panelId:randomUUID(),observationId:randomUUID(),operation:'install',pluginId,preparedId:randomUUID(),...(initialDisabled?{initialDisabled:true}:{})};
 const raw={kind:'plugin-package-preview',ticketId:randomUUID(),expiresAt:Date.now()+300000,operation:'install',mode:'install',pluginId,preparedId:input.preparedId,backupId:null,before:null,after:{version:'1.0.0',sha256:'a'.repeat(64),files:4,bytes:200},scope,preservesConfiguration:true,preservesOldTree:true,preservesData:true,existingEnableStatePreserved:!initialDisabled,laterStartMayLoad:!initialDisabled,automaticStart:false,executesPlugin:false,pendingRecovery:false,initialDisabled,enablePreferenceEffect:initialDisabled?'set_initial_disabled':'preserve'};
 return {raw,input,ticket:previewProjection(raw,session,input)};
}
function change(ticket){return {kind:'plugin-package-change',ticketId:ticket.ticketId,operation:ticket.operation,mode:ticket.mode,pluginId,outcome:'committed',committed:true,backupId:randomUUID(),readbackVerified:true,configurationPreserved:false,requiresRecovery:false,automaticRetry:false,automaticStart:false,pluginExecuted:false,laterStartMayLoad:ticket.laterStartMayLoad,initialDisabled:ticket.initialDisabled,enablePreferenceEffect:ticket.enablePreferenceEffect,enablePreferenceChanged:true,initialDisableVerified:true};}

test('only explicit true on an installation can request the initial preference',()=>{
 const {input}=preview();assert.equal(pluginPackageRequest(input,'preview'),input);
 const {initialDisabled,...legacy}=input;assert.equal(pluginPackageRequest(legacy,'preview'),legacy);
 for(const value of [false,null,1,'true'])assert.throws(()=>pluginPackageRequest({...input,initialDisabled:value},'preview'),{code:'invalid_request'});
 for(const operation of ['remove','restore']){const {preparedId,...other}=input;assert.throws(()=>pluginPackageRequest({...other,operation,...(operation==='restore'?{backupId:randomUUID()}:{})},'preview'),{code:'invalid_request'});}
});

test('availability is backend evidence, not inferred from an absent package',()=>{
 const raw={kind:'plugin-files',observationId:randomUUID(),fetchedAt:new Date().toISOString(),scope,plugins:[],backups:[],recovery:{required:false,backupId:null,pluginId:null},requiresStopped:true,pluginCodeAuthenticated:false};
 assert.equal(profileProjection(raw,session).initialDisableOptions,undefined);
 const options=IDS.map(id=>({pluginId:id,available:true,reason:null,privatePath:'must-not-leak'}));
 const projected=profileProjection({...raw,initialDisableOptions:options},session);
 assert.equal(projected.initialDisableOptions.length,4);assert.equal(JSON.stringify(projected).includes('must-not-leak'),false);
 assert.throws(()=>profileProjection({...raw,initialDisableOptions:[...options.slice(1),options[1]]},session),{code:'invalid_response'});
 assert.throws(()=>profileProjection({...raw,initialDisableOptions:options.map(x=>({...x,reason:'preference_present'}))},session),{code:'invalid_response'});
});

test('preview cannot turn an update or legacy receipt into an initial-disable authorization',()=>{
 const {raw,input}=preview();
 for(const patch of [{mode:'update'},{before:raw.after},{pendingRecovery:true},{initialDisabled:false},{existingEnableStatePreserved:true},{laterStartMayLoad:true}])assert.throws(()=>previewProjection({...raw,...patch},session,input),{code:'invalid_response'});
 const {initialDisabled,enablePreferenceEffect,...missing}=raw;
 assert.throws(()=>previewProjection(missing,session,input),{code:'invalid_response'});
 const legacy=preview(false);const {initialDisabled:oldFlag,enablePreferenceEffect:oldEffect,...oldRaw}=legacy.raw;
 assert.equal(previewProjection(oldRaw,session,legacy.input).enablePreferenceEffect,'preserve');
 assert.throws(()=>previewProjection({...oldRaw,initialDisabled:null},session,legacy.input),{code:'invalid_response'});
 assert.throws(()=>previewProjection({...legacy.raw,enablePreferenceEffect:null},session,legacy.input),{code:'invalid_response'});
});

test('a committed file change is insufficient to claim verified initial disable',()=>{
 const {ticket}=preview(),raw=change(ticket);assert.equal(changeProjection(raw,ticket).initialDisableVerified,true);
 for(const patch of [{initialDisableVerified:false},{enablePreferenceChanged:false},{readbackVerified:false},{configurationPreserved:true},{initialDisabled:false},{enablePreferenceEffect:'preserve'}])assert.throws(()=>changeProjection({...raw,...patch},ticket),{code:'invalid_response'});
 const {initialDisableVerified,...partial}=raw;assert.throws(()=>changeProjection(partial,ticket),{code:'invalid_response'});
});

test('unknown and not-submitted outcomes never claim a disabled plugin',()=>{
 const {ticket}=preview(),raw=change(ticket);
 const unknown={...raw,outcome:'unknown',committed:null,readbackVerified:false,configurationPreserved:false,requiresRecovery:true,enablePreferenceChanged:null,initialDisableVerified:false};
 const got=changeProjection(unknown,ticket);assert.equal(got.initialDisableVerified,false);assert.equal(got.enablePreferenceChanged,null);
 assert.throws(()=>changeProjection({...unknown,initialDisableVerified:true},ticket),{code:'invalid_response'});
 const refused={...unknown,outcome:'not_committed',committed:false,requiresRecovery:false,backupId:null,enablePreferenceChanged:false};
 assert.equal(changeProjection(refused,ticket).enablePreferenceChanged,false);
 assert.throws(()=>changeProjection({...refused,enablePreferenceChanged:true},ticket),{code:'invalid_response'});
});

test('pending preference recovery is explicit and separate from normal code restoration',()=>{
 const {raw}=preview(false),backupId=randomUUID();
 const input={accountId:'fixture',panelId:randomUUID(),observationId:randomUUID(),operation:'restore',pluginId,backupId};
 const restored={...raw,operation:'restore',mode:'restore',preparedId:null,backupId,pendingRecovery:true,enablePreferenceEffect:'restore_initial_preference',existingEnableStatePreserved:false};
 const ticket=previewProjection(restored,session,input);
 const receipt={...change(ticket),initialDisableVerified:false,configurationPreserved:true};
 assert.equal(changeProjection(receipt,ticket).enablePreferenceEffect,'restore_initial_preference');
 assert.throws(()=>previewProjection({...restored,pendingRecovery:false},session,input),{code:'invalid_response'});
 assert.throws(()=>changeProjection({...receipt,initialDisableVerified:true},ticket),{code:'invalid_response'});
 const ordinary={...restored,pendingRecovery:false,enablePreferenceEffect:'preserve',existingEnableStatePreserved:true};
 const ordinaryTicket=previewProjection(ordinary,session,input);
 assert.throws(()=>changeProjection({...receipt,enablePreferenceEffect:'preserve'},ordinaryTicket),{code:'invalid_response'});
 assert.throws(()=>changeProjection({...receipt,enablePreferenceEffect:'preserve',enablePreferenceChanged:null},ordinaryTicket),{code:'invalid_response'});
 assert.throws(()=>changeProjection({...receipt,enablePreferenceEffect:null,enablePreferenceChanged:false},ordinaryTicket),{code:'invalid_response'});
});
