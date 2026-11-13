'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QQGroupProfile,groupName}=require('../src/bot/qq-group-profile.cjs');
const {fixture,ACCOUNT,GROUP,OTHER,flush,deferred}=require('./helpers/qq-group-profile-fixture.cjs');
test('private explicit read-preview-confirm and one-use result use only fixed requests',async t=>{
 const f=await fixture(t),row=await f.controller.read({groupId:GROUP});assert.equal(row.groupId,GROUP);assert.equal(row.capabilities.editName,true);assert.equal(row.selfRole,'owner');assert(!JSON.stringify(row).includes('PRIVATE_'));
 const preview=f.controller.preview({observationId:row.observationId,field:'name',value:' New name '});assert.equal(f.writes().length,0);assert.equal(preview.before,'Synthetic group');
 const out=await f.controller.confirm({ticketId:preview.ticketId});assert.equal(out.outcome,'accepted');assert.equal(out.acknowledgement,'bridge-reported-success');assert.equal(out.observation.state,'observed_match');assert.equal(out.observation.value,' New name ');assert.equal(out.automaticRestore,false);assert.equal(f.writes().length,1);
 await assert.rejects(f.controller.confirm({ticketId:preview.ticketId}),{code:'stale_ticket'});assert.equal(f.client.queue.length,0);assert.deepEqual(f.controller.snapshot(),{busy:false,available:true});
 const actions=new Set(f.state.requests.map(row=>row.action));assert.deepEqual(actions,new Set(['get_login_info','get_status','get_group_list','get_group_info','get_group_member_info','set_group_name']));
});
test('observed ordinary member is read-only; unsupported original name is withheld not repaired',async t=>{
 const f=await fixture(t);f.state.role='member';let row=await f.controller.read({groupId:GROUP});assert.equal(row.capabilities.readName,true);assert.equal(row.capabilities.editName,false);assert.throws(()=>f.controller.preview({observationId:row.observationId,field:'name',value:'New'}),{code:'insufficient_role'});
 f.state.role='owner';f.state.name='PRIVATE\u202ename';row=await f.controller.read({groupId:GROUP});assert.equal(row.name,null);assert.equal(row.capabilities.readName,false);assert(!JSON.stringify(row).includes('PRIVATE'));assert.throws(()=>f.controller.preview({observationId:row.observationId,field:'name',value:'New'}),{code:'original_unsupported'});assert.equal(f.writes().length,0);
});
test('local name policy preserves valid bytes and rejects unsupported text without normalization',()=>{
 for(const value of [' 正常名称 ','🐳'.repeat(60)])assert.equal(groupName(value),value);
 for(const value of ['', '  ','a'.repeat(61),'🐳'.repeat(61),'x\n','x\u200d','x\u2028','\ud800'])assert.throws(()=>groupName(value),{code:'invalid_value'});
});
test('read cannot probe unlisted groups, duplicate lists or mismatched group/self members',async t=>{
 for(const variant of ['absent','duplicate','info-id','member-id','member-group']){const f=await fixture(t);if(variant==='absent')f.state.groups=[];if(variant==='duplicate')f.state.groups=[GROUP,GROUP];if(variant==='info-id')f.state.infoOverride={group_id:OTHER,group_name:'Synthetic'};if(variant==='member-id')f.state.memberOverride={group_id:GROUP,user_id:'99999999',role:'owner'};if(variant==='member-group')f.state.memberOverride={group_id:OTHER,user_id:ACCOUNT,role:'owner'};
  await assert.rejects(f.controller.read({groupId:GROUP}));assert.equal(f.writes().length,0);if(variant==='absent')assert.equal(f.state.requests.filter(row=>row.action==='get_group_info').length,0);
 }
});
test('a newer list name cannot be overwritten using stale group-info baseline',async t=>{
 const f=await fixture(t),p=await f.preview();let lists=0;f.state.before=req=>{if(req.action==='get_group_list'&&++lists===2)f.state.listName='Changed elsewhere';};const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted');assert.equal(out.code,'baseline_changed');assert.equal(f.writes().length,0);
});
test('membership and both role observations must remain consistent during reads',async t=>{
 for(const variant of ['leave','role']){const f=await fixture(t);let count=0;f.state.before=req=>{if(variant==='leave'&&req.action==='get_group_list'&&++count===2)f.state.groups=[];if(variant==='role'&&req.action==='get_group_member_info'&&++count===2)f.state.role='member';};await assert.rejects(f.controller.read({groupId:GROUP}),{code:variant==='leave'?'group_changed':'role_changed'});assert.equal(f.writes().length,0);}
});
test('role owner-to-admin is changed even though both are privileged; other changes never write',async t=>{
 for(const variant of ['admin','member','name','leave','account','offline']){const f=await fixture(t),p=await f.preview();if(['admin','member'].includes(variant))f.state.role=variant;if(variant==='name')f.state.name='Changed elsewhere';if(variant==='leave')f.state.groups=[];if(variant==='account')f.state.account='99999999';if(variant==='offline')f.state.online=false;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted',variant);assert.equal(f.writes().length,0,variant);}
});
test('all local identities and same-object reconnect invalidate a ticket',async t=>{
 for(const [key,value]of Object.entries({profile:{},profileId:'other',generation:2,characterId:'other',runtime:{},installation:{},runtimeEpoch:2,bridgeRevision:'other',endpointId:'other'})){const f=await fixture(t),p=await f.preview();f.binding[key]=value;assert.equal((await f.controller.confirm({ticketId:p.ticketId})).outcome,'not_submitted',key);assert.equal(f.writes().length,0);}
 const f=await fixture(t),p=await f.preview();f.client.generation++;assert.equal((await f.controller.confirm({ticketId:p.ticketId})).outcome,'not_submitted');assert.equal(f.writes().length,0);
});
test('strict null success; omitted/object/number data cannot invent native success or retry',async t=>{
 for(const native of [undefined,{},0,{result:0}]){const f=await fixture(t),p=await f.preview();f.state.native=native;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'unknown');assert.equal(out.observation.state,'unavailable');assert.equal(f.writes().length,1);await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});}
});
test('failed/malformed/echo/timeout/closed response after action stays unknown and one-use',async t=>{
 for(const mode of ['wrong-echo','malformed-status','timeout','disconnect','failure']){const f=await fixture(t),p=await f.preview();f.state.writeMode=mode;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'unknown',mode);assert.equal(f.writes().length,1);assert(!JSON.stringify(out).includes('PRIVATE_ERROR'));await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});}
});
test('accepted acknowledgement remains separate from stale or unavailable readback',async t=>{
 for(const mode of ['stale','account-after-ack']){const f=await fixture(t),p=await f.preview();f.state.writeMode=mode;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'accepted');assert.equal(out.observation.state,mode==='stale'?'observed_different':'unavailable');assert.equal(out.accountId,ACCOUNT);assert.equal(out.groupId,GROUP);assert.equal(f.writes().length,1);}
});
test('monotonic expiry, aborted operation and target injection cannot submit',async t=>{
 const f=await fixture(t),row=await f.controller.read({groupId:GROUP});assert.throws(()=>f.controller.preview({observationId:row.observationId,field:'name',value:'New',groupId:OTHER}),{code:'invalid_request'});
 const p=f.controller.preview({observationId:row.observationId,field:'name',value:'New'});f.state.now-=86400000;f.state.mono+=300001;assert.equal((await f.controller.confirm({ticketId:p.ticketId})).code,'expired_ticket');
 const next=await f.preview(),abort=new AbortController();abort.abort();assert.equal((await f.controller.confirm({ticketId:next.ticketId},{signal:abort.signal})).outcome,'not_submitted');assert.equal(f.writes().length,0);
});
test('partial dismissal retains observation but old tickets never replay',async t=>{
 const f=await fixture(t),row=await f.controller.read({groupId:GROUP}),p=f.controller.preview({observationId:row.observationId,field:'name',value:'A'});f.controller.discardPreview();await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});const next=f.controller.preview({observationId:row.observationId,field:'name',value:'B'});assert.equal((await f.controller.confirm({ticketId:next.ticketId})).outcome,'accepted');
});
test('final guard catches local changes and rejects asynchronous guard returns',async t=>{
 const f=await fixture(t),p=await f.preview();let identities=0;f.state.after=req=>{if(req.action==='get_status'&&++identities===2)f.binding.runtimeEpoch++;};assert.equal((await f.controller.confirm({ticketId:p.ticketId})).outcome,'not_submitted');assert.equal(f.writes().length,0);
 const result=await f.transport.write({...f.binding,socket:f.client.socket,clientGeneration:f.client.generation},{groupId:GROUP,value:'New',expectedValue:f.state.name,expectedRole:f.state.role},{assertCurrent:async()=>{}});assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'invalid_request');
});
test('invoked transport throw is unknown; close waits for and retains late captured acceptance',async t=>{
 const f=await fixture(t),p=await f.preview(),held=deferred();f.transport.write=()=>held.promise;const changing=f.controller.confirm({ticketId:p.ticketId});await flush();let done=false;const closing=f.controller.close().then(()=>{done=true;});await flush();assert.equal(done,false);held.resolve({outcome:'accepted',acknowledgement:'bridge-reported-success'});const out=await changing;assert.equal(out.outcome,'accepted');assert.equal(out.observation.state,'unavailable');await closing;
 const g=await fixture(t),q=await g.preview();g.transport.write=async()=>{throw Error('PRIVATE');};assert.equal((await g.controller.confirm({ticketId:q.ticketId})).outcome,'unknown');
});
