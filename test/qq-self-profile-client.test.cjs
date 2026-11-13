'use strict';
// Real local WebSocket transport and production QQClient; only original,
// synthetic account/profile data. No real bridge, QQ process or external call.
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events'),{WebSocketServer,WebSocket}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs');
const {QQSelfProfile}=require('../src/bot/qq-self-profile.cjs'),{QQSelfProfileTransport}=require('../src/bot/qq-self-profile-transport.cjs');
const {QQSelfProfilePanel}=require('../src/bot/qq-self-profile-panel.cjs');
const ACCOUNT='87654321',OWNER='12345678';
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={account:ACCOUNT,nickname:'Synthetic nickname',signature:'Original signature',online:true,mode:'ok',native:null,nicknameNative:{result:0,errMsg:''},requests:[],changed:false,afterRead:null};
 server.on('connection',socket=>socket.on('message',raw=>{
  const request=JSON.parse(raw);state.requests.push(request);const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:request.echo,data}));};
  if(request.action==='get_login_info')reply({user_id:state.account,nickname:state.nickname});
  else if(request.action==='get_status')reply({online:state.online,good:true});
  else if(request.action==='get_stranger_info'){assert.deepEqual(request.params,{user_id:ACCOUNT,no_cache:true});reply(state.raw??{user_id:ACCOUNT,uid:'PRIVATE_UID_NOT_PROJECTED',nickname:state.nickname,long_nick:state.signature,sex:'private-other-field',birthday:'PRIVATE_BIRTHDAY'});state.afterRead?.();}
  else if(['set_self_longnick','set_qq_profile'].includes(request.action)){
   const nickname=request.action==='set_qq_profile';assert.deepEqual(Object.keys(request.params),[nickname?'nickname':'longNick']);state.changed=true;if(state.mode!=='stale'){if(nickname)state.nickname=request.params.nickname;else state.signature=request.params.longNick;}
   if(state.mode==='timeout')return;
   if(state.mode==='disconnect'){socket.terminate();return;}
   if(state.mode==='failure'){socket.send(JSON.stringify({status:'failed',retcode:1400,echo:request.echo,data:null,message:'PRIVATE_UPSTREAM_ERROR'}));return;}
   if(state.mode==='wrong-echo'){socket.send(JSON.stringify({status:'ok',retcode:0,echo:'other',data:null}));return;}
   if(state.mode==='malformed-status'){socket.send(JSON.stringify({status:'ok',retcode:'0',echo:request.echo,data:null}));return;}
   reply(nickname?state.nicknameNative:state.native);if(state.mode==='account-after-ack')state.account='99999999';
  }else assert.fail('Unexpected synthetic action '+request.action);
 }));
 const client=new QQClient({url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-local-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:100,socketFactory:(url,options)=>new WebSocket(url,options)});await client.connect();
 const binding={profile:{},profileId:'synthetic-profile',generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-bridge',endpointId:'synthetic-endpoint',accountId:ACCOUNT,client};
 const controller=new QQSelfProfile({getBinding:()=>binding,timeoutMs:2000});
 t.after(async()=>{await controller.close();client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 const preview=async(value,field='signature')=>{const row=await controller.read();return controller.preview({observationId:row.observationId,field,value});};
 return {state,client,binding,controller,preview,writes:()=>state.requests.filter(row=>row.action==='set_self_longnick')};
}
test('official fixed self read and independent signature write never invoke profile/foreign/message actions',async t=>{
 const f=await fixture(t),row=await f.controller.read();assert.equal(row.values.nickname,'Synthetic nickname');assert.equal(row.capabilities.readable.nickname,true);assert.equal(row.capabilities.editable.nickname,true);assert.equal(row.capabilities.editable.signature,true);assert(!JSON.stringify(row).includes('PRIVATE_'));
 const preview=f.controller.preview({observationId:row.observationId,field:'signature',value:'New synthetic signature'}),out=await f.controller.confirm({ticketId:preview.ticketId});assert.equal(out.outcome,'accepted');assert.equal(out.acknowledgement,'bridge-action-only');assert.equal(out.observation.state,'observed_match');assert.equal(f.writes().length,1);
 assert(f.state.requests.every(row=>['get_login_info','get_status','get_stranger_info','set_self_longnick'].includes(row.action)));assert.equal(f.client.queue.length,0);
});

test('nickname uses only the fixed nickname payload and a numeric native success plus independent observation',async t=>{
 const f=await fixture(t),p=await f.preview('New synthetic nickname','nickname');
 assert.equal(p.mutationScope,'profile-save');assert.equal(p.preservedFieldsSource,'bridge-read-at-submit');assert.equal(p.preservationGuaranteed,false);
 const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.field,'nickname');assert.equal(out.outcome,'accepted');assert.equal(out.acknowledgement,'bridge-reported-success');assert.equal(out.observation.state,'observed_match');
 assert.deepEqual(f.state.requests.filter(x=>x.action==='set_qq_profile').map(x=>x.params),[{nickname:'New synthetic nickname'}]);assert.equal(f.state.signature,'Original signature');assert.equal(f.client.queue.length,0);await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});
});

test('nickname missing signature is readable but not writable and never defaults the original signature',async t=>{
 const f=await fixture(t);f.state.raw={user_id:ACCOUNT,nickname:'Synthetic'};const row=await f.controller.read();assert.equal(row.values.nickname,'Synthetic');assert.equal(row.values.signature,null);assert.equal(row.capabilities.editable.nickname,false);assert.equal(row.nicknameUnavailableReason,'signature_unavailable');assert.throws(()=>f.controller.preview({observationId:row.observationId,field:'nickname',value:'New'}),{code:'signature_unavailable'});assert.equal(f.state.requests.some(x=>x.action==='set_qq_profile'),false);
});

test('nickname native result zero, reported failure and absent or malformed data have distinct one-use outcomes',async t=>{
 for(const [native,outcome]of [[{result:0},'accepted'],[{result:-1,errMsg:'PRIVATE_NATIVE_FAILURE'},'rejected'],[{result:1287},'rejected'],[null,'unknown'],[undefined,'unknown'],[{},'unknown'],[{result:'0'},'unknown'],[{result:0.5},'unknown'],[[],'unknown']]){
  const f=await fixture(t),p=await f.preview('Proposed nickname','nickname');f.state.nicknameNative=native;f.state.mode='stale';const before=f.state.requests.length,out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,outcome);assert(!JSON.stringify(out).includes('PRIVATE_NATIVE_FAILURE'));assert.equal(f.state.requests.filter(x=>x.action==='set_qq_profile').length,1);
  if(outcome==='accepted'){assert.equal(out.acknowledgement,'bridge-reported-success');assert.equal(out.observation.state,'observed_different');}else{assert.equal(out.acknowledgement,undefined);assert.equal(out.observation.state,'unavailable');assert.equal(out.code,outcome==='rejected'?'profile_rejected':'change_unknown');assert.equal(f.state.requests.slice(before).filter(x=>x.action==='get_stranger_info').length,1);}
  await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});
 }
});

test('nickname preflight rechecks observed nickname and signature without filling public demographic fields',async t=>{
 for(const mode of ['nickname','signature','missing-signature','self','offline','late-scope']){const f=await fixture(t),p=await f.preview('New nickname','nickname');if(mode==='nickname')f.state.nickname='Another nickname';if(mode==='signature')f.state.signature='Another signature';if(mode==='missing-signature')f.state.raw={user_id:ACCOUNT,nickname:f.state.nickname};if(mode==='self')f.state.account='99999999';if(mode==='offline')f.state.online=false;if(mode==='late-scope')f.state.afterRead=()=>{f.binding.runtimeEpoch++;};const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.field,'nickname');assert.equal(out.outcome,'not_submitted',mode);assert.equal(f.state.requests.some(x=>x.action==='set_qq_profile'),false,mode);}
});

test('nickname timeout and lost acknowledgements consume tickets; late accepted readback failure stays accepted',async t=>{
 for(const mode of ['wrong-echo','malformed-status','disconnect','timeout','failure','account-after-ack']){const f=await fixture(t),p=await f.preview('New nickname','nickname');f.state.mode=mode;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.field,'nickname');assert.equal(out.outcome,mode==='account-after-ack'?'accepted':'unknown');assert.equal(out.observation.state,'unavailable');assert.equal(f.state.requests.filter(x=>x.action==='set_qq_profile').length,1);await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});}
});

test('production panel correlates nickname disclosure and reply field, closing only its management socket',async t=>{
 const f=await fixture(t),input={accountId:'synthetic-profile',panelId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
 const binding={profileId:input.accountId,panelId:input.panelId,profile:{},generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-bridge',qqAccountId:ACCOUNT,ownerId:OWNER,url:f.client.url,token:f.client.token,channel:'qq',status:'disconnected',endpointId:'synthetic-endpoint'};
 const panel=new QQSelfProfilePanel({capture:()=>binding,verifyContext:async()=>({verified:true}),clientFactory:options=>new QQClient({...options,timeoutMs:100})});t.after(()=>panel.close());
 const read=await panel.read(input),preview=panel.preview({...input,observationId:read.profile.observationId,field:'nickname',value:'Panel nickname'});assert.equal(preview.preview.preservationGuaranteed,false);
 const receipt=await panel.confirm({...input,ticketId:preview.preview.ticketId});assert.equal(receipt.accountId,input.accountId);assert.equal(receipt.qqAccountId,ACCOUNT);assert.equal(receipt.change.field,'nickname');assert.equal(receipt.change.acknowledgement,'bridge-reported-success');assert.equal(receipt.change.observation.state,'observed_match');assert.equal(receipt.change.preservationGuaranteed,false);
 const reread=await panel.read(input),second=panel.preview({...input,observationId:reread.profile.observationId,field:'nickname',value:'Another nickname'});panel.session.controller.confirm=async()=>({kind:'self-profile-change',accountId:ACCOUNT,ticketId:second.preview.ticketId,field:'signature',outcome:'accepted',acknowledgement:'bridge-action-only',automaticRetry:false,observation:{state:'unavailable',source:'bridge-observed'}});
 const malformed=await panel.confirm({...input,ticketId:second.preview.ticketId});assert.equal(malformed.change.field,'nickname');assert.equal(malformed.change.outcome,'unknown');assert.equal(f.state.requests.filter(x=>x.action==='set_qq_profile').length,1);await panel.closeOwned(input);assert.equal(f.client.ready,true);
});
test('self close microtask after final verification cannot construct a production client or socket',async t=>{
 const f=await fixture(t),input={accountId:'synthetic-profile',panelId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};let verified=false,queued=false,created=0,sockets=0,closing;
 const binding={profileId:input.accountId,panelId:input.panelId,profile:{},generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-bridge',qqAccountId:ACCOUNT,ownerId:OWNER,url:f.client.url,token:f.client.token,channel:'qq',status:'disconnected',endpointId:'synthetic-endpoint'};
 const panel=new QQSelfProfilePanel({capture:()=>{if(verified&&!queued){queued=true;queueMicrotask(()=>{closing=panel.closeCurrent();});}return binding;},verifyContext:async()=>{verified=true;return {verified:true};},clientFactory:options=>{created++;const client=new QQClient({...options,socketFactory:(...args)=>{sockets++;return new WebSocket(...args);}});t.after(()=>client.close());return client;}});t.after(()=>panel.close());
 await assert.rejects(panel.read(input));await closing;assert.equal(queued,true);assert.deepEqual({created,sockets},{created:0,sockets:0});assert.equal(f.client.ready,true);assert.equal(f.writes().length,0);
});
test('null, omitted and arbitrary native values remain only bridge action acknowledgements',async t=>{
 for(const native of [null,undefined,{result:0,errMsg:''},{result:-1,errMsg:'PRIVATE_NATIVE_RESPONSE'},{unrecognized:'PRIVATE_NATIVE_RESPONSE'}]){const f=await fixture(t),p=await f.preview('New signature');f.state.native=native;f.state.mode='stale';const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'accepted');assert.equal(out.acknowledgement,'bridge-action-only');assert.equal(out.observation.state,'observed_different');assert(!JSON.stringify(out).includes('PRIVATE_NATIVE_RESPONSE'));assert.equal(f.writes().length,1);}
});
test('echo, numeric retcode, socket, timeout and action errors keep unknown writes one-use',async t=>{
 for(const mode of ['wrong-echo','malformed-status','disconnect','timeout','failure']){const f=await fixture(t),p=await f.preview('A changed signature');f.state.mode=mode;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'unknown',mode);assert.equal(out.code,'change_unknown');assert.equal(f.writes().length,1);await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});}
});
test('baseline, self identity and online changes after preview cannot write',async t=>{
 for(const mode of ['baseline','self','offline']){const f=await fixture(t),p=await f.preview('Proposed signature');if(mode==='baseline')f.state.signature='Changed elsewhere';if(mode==='self')f.state.account='99999999';if(mode==='offline')f.state.online=false;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted');assert.equal(f.writes().length,0);}
});
test('late runtime change during read and final asynchronous-guard return prevent all writes',async t=>{
 const f=await fixture(t),p=await f.preview('Proposed signature');f.state.afterRead=()=>{f.binding.runtimeEpoch++;};const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted');assert.equal(f.writes().length,0);
 const transport=new QQSelfProfileTransport(),raw={...f.binding,socket:f.client.socket,clientGeneration:f.client.generation};const direct=await transport.write(raw,{field:'signature',value:'New',expectedValue:f.state.signature},{assertCurrent:async()=>{}});assert.equal(direct.outcome,'not_submitted');assert.equal(direct.code,'invalid_request');assert.equal(f.writes().length,0);
});
test('confirmed outer acknowledgement stays captured when later actual identity readback fails',async t=>{
 const f=await fixture(t),p=await f.preview('Proposed signature');f.state.mode='account-after-ack';const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.accountId,ACCOUNT);assert.equal(out.outcome,'accepted');assert.equal(out.observation.state,'unavailable');assert.equal(f.writes().length,1);
});
test('unsupported or missing original fields never become sanitized writable baselines',async t=>{
 const f=await fixture(t);f.state.signature='private\u202eunsupported';let row=await f.controller.read();assert.equal(row.values.signature,null);assert.equal(row.capabilities.editable.signature,false);assert.equal(row.capabilities.editable.nickname,false);assert(!JSON.stringify(row).includes('private'));f.state.raw={user_id:ACCOUNT,nickname:'Synthetic'};row=await f.controller.read();assert.equal(row.nicknameUnavailableReason,'signature_unavailable');assert.equal(row.values.signature,null);assert.equal(f.writes().length,0);
});
