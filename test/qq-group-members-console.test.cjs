'use strict';
// Synthetic integration only: production lifecycle and reader, no real QQ.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQConsole,validateDirectoryRequest}=require('../src/bot/qq-console.cjs');

const A='12345001',B='12345002',G='12345111',H='12345222',MEMBER='12345999',TOKEN='SYNTHETIC_GROUP_DIRECTORY_TOKEN';
const now='2026-11-06T01:00:00.000Z',tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};
const members=(accountId=A,groupId=G)=>({kind:'members',accountId,groupId,items:[{id:MEMBER,nickname:'Synthetic member',card:'<b>literal card</b>',role:'member'}],fetchedAt:now,source:'bridge-cache'});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-members-')),calls=[],state={endpoint:'endpoint-A',connection:{serverName:'selected',url:'ws://127.0.0.1:3001/',token:TOKEN},read:null};
 const runtime={instance:id=>{if(![A,B].includes(id))throw Object.assign(Error('fixture account'),{code:'invalid_account'});return {};},getConnection:async()=>({endpointId:state.endpoint,ownershipVerified:true}),getConnections:async()=>new Map(),discover:async()=>({configured:true,instances:[]}),start:async()=>{},stop:async()=>{},recover:async()=>{},assertWritable:async()=>{},close:async()=>({closed:true})};
 const profiles={list:async()=>[],connection:(id,name)=>{if(name&&name!==state.connection.serverName)throw Object.assign(Error('fixture missing server'),{code:'server_missing'});return {accountId:id,...state.connection};},configure:async()=>({created:false,backupCreated:true})};
 
 const manager=new QQConsole({root,runtimeFactory:()=>runtime,profileFactory:()=>profiles,backupFactory:()=>({restore:async()=>({restored:true})}),directoryFactory:()=>({read:async options=>{calls.push({route:'old',options});return {kind:options.kind,accountId:options.expectedAccountId,items:[],fetchedAt:now,source:'bridge-cache'};}})});
 manager.groupMembersFactory=()=>({read:async options=>{calls.push({route:'members',options});return state.read?state.read(options):members(options.expectedAccountId,options.groupId);}});
 t.after(async()=>{await manager.close();const absolute=fs.realpathSync(root),temp=fs.realpathSync(os.tmpdir());assert(absolute.toLowerCase().startsWith(temp.toLowerCase()+path.sep)&&path.basename(absolute).startsWith('arcade-group-members-'));fs.rmSync(absolute,{recursive:true,force:true});});
 return {manager,state,runtime,profiles,calls};
}
test('fixed members request requires a canonical group string; legacy lists forbid it',()=>{
 const base={accountId:A,kind:'members',groupId:G};assert.deepEqual(validateDirectoryRequest(base),{...base,fresh:false});
 for(const value of [null,[],{...base,groupId:Number(G)},{...base,groupId:'0'+G},{...base,groupId:' '+G},{...base,groupId:undefined},{...base,accountId:Number(A)},{...base,kind:'get_group_member_list'},{...base,action:'set_group_ban'},{...base,url:'ws://127.0.0.1:1'},{...base,token:TOKEN},{...base,fresh:'true'},{...base,serverName:' bad '},{accountId:A,kind:'groups',groupId:G},{accountId:A,kind:'friends',groupId:undefined}])assert.throws(()=>validateDirectoryRequest(value),{code:'invalid_config'});
 for(const kind of ['friends','groups'])assert.deepEqual(validateDirectoryRequest({accountId:A,kind}),{accountId:A,kind,fresh:false});
});
test('only members reaches the new reader; no token, raw profile or member extras leave the private result',async t=>{
 const f=fixture(t);f.state.read=async options=>({...members(options.expectedAccountId,options.groupId),token:TOKEN,items:[{...members().items[0],age:99,sex:'synthetic',join_time:1,secret:TOKEN}]});
 const result=await f.manager.directory(A,{kind:'members',groupId:G,serverName:'selected',fresh:true});
 assert.deepEqual(result,members());assert.equal(f.manager.snapshot(),null);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_GROUP_DIRECTORY_TOKEN|join_time|secret|age|sex/);assert.equal(f.calls[0].options.groupId,G);assert.equal(f.calls[0].options.token,TOKEN);assert.equal(f.calls[0].options.fresh,true);assert.equal(f.calls[0].options.kind,undefined);assert(f.calls[0].options.signal.aborted);
 await f.manager.directory(A,{kind:'friends'});await f.manager.directory(A,{kind:'groups'});assert.deepEqual(f.calls.map(row=>row.route),['members','old','old']);assert.equal(f.calls[1].options.groupId,undefined);
});
test('member result must retain exact account/group, valid role, bounded text, unique IDs and cache semantics',async t=>{
 const f=fixture(t),request={kind:'members',groupId:G};
 for(const [patch,code]of [[{accountId:B},'account_changed'],[{groupId:H},'group_changed'],[{source:'live'},'invalid_response'],[{fetchedAt:'yesterday'},'invalid_response'],[{items:[{...members().items[0],role:'superadmin'}]},'invalid_response'],[{items:[{...members().items[0],nickname:'a'.repeat(501)}]},'invalid_response'],[{items:[{...members().items[0],card:'bad\u0000value'}]},'invalid_response'],[{items:[{...members().items[0],nickname:'bad\ud800'}]},'invalid_response'],[{items:[{...members().items[0],id:Number(MEMBER)}]},'invalid_response'],[{items:[members().items[0],members().items[0]]},'invalid_response'],[{items:Array(10001).fill(members().items[0])},'response_too_large']]){
   f.state.read=async()=>({...members(),...patch});await assert.rejects(f.manager.directory(A,request),{code});
 }
 f.state.read=async()=>({...members(),items:[]});assert.deepEqual((await f.manager.directory(A,request)).items,[]);
 f.state.read=async()=>members();assert.equal((await f.manager.directory(A,request)).items[0].card,'<b>literal card</b>');
});
test('unsupported or unjoined group fails rather than returning empty success',async t=>{
 const f=fixture(t);for(const code of ['group_not_joined','group_changed','account_offline','timeout']){f.state.read=async()=>{throw Object.assign(Error('synthetic private reader details'),{code});};await assert.rejects(f.manager.directory(A,{kind:'members',groupId:G}),{code});assert.equal(f.manager.directoryRequests.size,0);assert.equal(f.manager.snapshot(),null);}
 await assert.rejects(f.manager.directory(A,{kind:'members',groupId:G,accountId:B}),{code:'invalid_config'});
});
test('changed bridge or endpoint discards all member rows both before and after the read',async t=>{
 for(const mutate of [f=>{f.state.endpoint='different';},f=>{f.state.connection.token='SYNTHETIC_CHANGED_TOKEN';},f=>{f.state.connection.url='ws://127.0.0.1:3002/';},f=>{f.state.connection.serverName='other';}]){const f=fixture(t);f.state.read=async()=>{mutate(f);return members();};await assert.rejects(f.manager.directory(A,{kind:'members',groupId:G}),{code:'changed'});}
 const f=fixture(t);f.runtime.getConnection=async()=>{f.state.connection.token='SYNTHETIC_CHANGED_BEFORE_READ';return {ownershipVerified:true,endpointId:'same'};};await assert.rejects(f.manager.directory(A,{kind:'members',groupId:G}),{code:'changed'});assert.equal(f.calls.length,0);
});
test('same-account group navigation cancels old read; different accounts remain independent',async t=>{
 const f=fixture(t),first=defer(),second=defer(),other=defer();f.state.read=options=>options.expectedAccountId===B?other.promise:options.groupId===G?first.promise:second.promise;
 const old=f.manager.directory(A,{kind:'members',groupId:G});await tick();const oldSignal=f.calls[0].options.signal;
 const independent=f.manager.directory(B,{kind:'members',groupId:G});await tick();const otherSignal=f.calls[1].options.signal;
 const replacement=f.manager.directory(A,{kind:'members',groupId:H});await tick();assert(oldSignal.aborted);assert(!otherSignal.aborted);
 first.resolve(members());await assert.rejects(old,{code:'cancelled'});assert.equal(f.manager.directoryRequests.size,2);
 other.resolve(members(B));assert.equal((await independent).accountId,B);second.resolve(members(A,H));assert.equal((await replacement).groupId,H);assert.equal(f.manager.directoryRequests.size,0);
});
test('existing stop, configure, backup restore and close invalidate pending member reads',async t=>{
 for(const action of ['stop','configure','restore','close'])await t.test(action,async t=>{const f=fixture(t),held=defer();f.state.read=()=>held.promise;const read=f.manager.directory(A,{kind:'members',groupId:G});await tick();
   if(action==='stop')await f.manager.perform('stop',{accountId:A});else if(action==='configure')await f.manager.configure(A,{});else if(action==='restore')await f.manager.restoreBackup(A,{});else await f.manager.close();
   assert(f.calls[0].options.signal.aborted);held.resolve(members());await assert.rejects(read,error=>['cancelled','changed'].includes(error.code));assert.equal(f.manager.directoryRequests.size,0);
 });
});
test('installation epoch replacement invalidates late reads; global operations prevent new reads',async t=>{
 const f=fixture(t),held=defer();f.state.read=()=>held.promise;const reading=f.manager.directory(A,{kind:'members',groupId:G});await tick();f.manager.epoch++;held.resolve(members());await assert.rejects(reading,{code:'changed'});
 for(const marker of ['qq-components','qq-setup','qq-installation-switch',B]){f.manager.busy.add(marker);await assert.rejects(f.manager.directory(A,{kind:'members',groupId:G}),{code:'operation_in_progress'});f.manager.busy.delete(marker);}assert.equal(f.calls.length,1);
});
test('production coordinator and the independent reader complete one bounded loopback roster without entering snapshots',async t=>{
 const {WebSocketServer}=require('ws'),{once}=require('node:events'),{QQGroupMembersReader}=require('../src/bot/qq-group-members.cjs');
 const f=fixture(t),server=new WebSocketServer({host:'127.0.0.1',port:0}),calls=[];await once(server,'listening');t.after(async()=>{for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 f.state.connection.url=`ws://127.0.0.1:${server.address().port}/`;f.manager.groupMembersFactory=()=>new QQGroupMembersReader();
 server.on('connection',(socket,request)=>{assert.equal(request.headers.authorization,`Bearer ${TOKEN}`);socket.on('message',raw=>{const call=JSON.parse(raw);calls.push(call.action);let data;
   if(call.action==='get_login_info')data={user_id:A};else if(call.action==='get_status')data={online:true,good:true};else if(call.action==='get_group_list')data=[{group_id:G}];else if(call.action==='get_group_member_list')data=[{group_id:G,user_id:MEMBER,nickname:'Synthetic loopback member',card:'<script>literal</script>',role:'admin',age:42}];else assert.fail('Only fixed read actions are allowed');socket.send(JSON.stringify({echo:call.echo,status:'ok',retcode:0,data}));
 });});
 const result=await f.manager.directory(A,{kind:'members',groupId:G});assert.equal(result.items[0].role,'admin');assert.equal(result.items[0].card,'<script>literal</script>');assert.equal(result.items[0].age,undefined);assert.equal(f.manager.snapshot(),null);assert.deepEqual(calls,['get_login_info','get_status','get_group_list','get_group_member_list','get_group_list','get_login_info','get_status']);
});
test('the existing private IPC admits only the fixed members contract and returns safe errors',async t=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),f=fixture(t),handlers=new Map();
 const start=source.indexOf("    register('qqRuntimeDirectory'"),end=source.indexOf("    register('qqRuntimeBackups'",start),replyStart=source.indexOf('    const qqResult='),replyEnd=source.indexOf('    const qqArguments=',replyStart);assert(start>=0&&end>start&&replyStart>=0&&replyEnd>replyStart);
 vm.runInNewContext(source.slice(replyStart,replyEnd)+source.slice(start,end),{register:(name,handler)=>handlers.set(name,handler),validateDirectoryRequest,qqConsole:f.manager});const invoke=handlers.get('qqRuntimeDirectory');
 for(const value of [{accountId:A,kind:'members'},{accountId:A,kind:'members',groupId:G,action:'send_group_msg'},{accountId:A,kind:'members',groupId:G,userId:MEMBER},{accountId:A,kind:'groups',groupId:G}])assert.deepEqual(JSON.parse(JSON.stringify(await invoke(value))),{ok:false,code:'invalid_config'});
 assert.equal(f.calls.length,0);const result=await invoke({accountId:A,kind:'members',groupId:G});assert.equal(result.ok,true);assert.equal(result.directory.groupId,G);
 f.state.read=async()=>{throw Object.assign(Error('SYNTHETIC_PRIVATE_DETAIL'),{code:'group_not_joined'});};assert.deepEqual(JSON.parse(JSON.stringify(await invoke({accountId:A,kind:'members',groupId:G}))),{ok:false,code:'group_not_joined'});
});
