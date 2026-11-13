'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQConsole,validateDirectoryRequest}=require('../src/bot/qq-console.cjs');
const A='12345001',B='12345002',SECRET='SYNTHETIC_DIRECTORY_TOKEN_ONLY';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-directory-console-')),alternative=path.join(root,'alternative');fs.mkdirSync(alternative);
  const calls=[],state={endpoint:'endpoint-1',connection:{url:'ws://127.0.0.1:3001',token:SECRET,serverName:'selected'},read:null};
  const runtime={instance:id=>{if(![A,B].includes(id))throw Object.assign(Error('Unknown fixture account'),{code:'invalid_account'});return {};},getConnection:async()=>({endpointId:state.endpoint,ownershipVerified:true}),getConnections:async()=>new Map(),discover:async()=>({configured:true,instances:[]}),start:async()=>{},stop:async()=>{},recover:async()=>{},assertWritable:async()=>{},close:async()=>({closed:true})};
  const profiles={list:async()=>[],connection:(id,name)=>{calls.push({type:'selection',id,name});if(name&&name!==state.connection.serverName)throw Object.assign(Error('Missing selected server'),{code:'server_missing'});return {accountId:id,...state.connection};},configure:async()=>({created:false,backupCreated:true})};
  const backup={restore:async()=>({restored:true})};
  const payload=options=>({accountId:options.expectedAccountId,kind:options.kind,items:options.kind==='friends'?[{id:'12345999',nickname:'Fixture contact',remark:''}]:[{id:'12345111',name:'Fixture group'}],fetchedAt:new Date().toISOString(),source:'bridge-cache'});
  const manager=new QQConsole({root,runtimeFactory:()=>runtime,profileFactory:()=>profiles,backupFactory:()=>backup,clientFactory:()=>({quickLogin:async()=>({requested:true}),qr:async()=>({state:'login_required',url:null}),close(){}}),directoryFactory:()=>({read:async options=>{calls.push({type:'read',options});return state.read?state.read(options):payload(options);}})});
  t.after(async()=>{await manager.close();const resolved=fs.realpathSync(root),temp=fs.realpathSync(os.tmpdir());assert(resolved.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {manager,runtime,profiles,backup,state,calls,payload,root,alternative};
}

test('directory selects the exact bridge in main and returns only its minimal result outside snapshots',async t=>{
  const f=fixture(t);f.state.read=async options=>({...f.payload(options),token:SECRET,url:options.url,extra:'not-public'});
  const result=await f.manager.directory(A,{kind:'friends',serverName:'selected'}),call=f.calls.find(row=>row.type==='read').options;
  assert.equal(call.token,SECRET);assert.equal(call.expectedAccountId,A);assert.equal(call.fresh,false);assert.equal(call.signal.aborted,true);
  assert.equal(result.accountId,A);assert.equal(result.items[0].nickname,'Fixture contact');assert.equal(f.manager.snapshot(),null);
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_DIRECTORY_TOKEN|ws:|not-public|extra/);assert.equal(f.manager.directoryRequests.size,0);
  assert(f.calls.filter(row=>row.type==='selection').every(row=>row.id===A&&row.name==='selected'));
});

test('only fixed directory request fields, string identities and boolean freshness are admitted',async t=>{
  const f=fixture(t),base={accountId:A,kind:'friends'};
  assert.deepEqual(validateDirectoryRequest(base),{...base,fresh:false});
  for(const value of [null,[],{...base,accountId:Number(A)},{...base,accountId:'0'+A},{...base,kind:'send_private_msg'},{...base,action:'get_cookies'},{...base,url:'ws://example.com'},{...base,token:'private'},{...base,path:'private'},{...base,fresh:'true'},{...base,serverName:' bad '},{...base,serverName:'x'.repeat(65)}])assert.throws(()=>validateDirectoryRequest(value),{code:'invalid_config'});
  await assert.rejects(f.manager.directory(A,{kind:'friends',accountId:B}),{code:'invalid_config'});await assert.rejects(f.manager.directory(A,{kind:'friends',serverName:'other'}),{code:'server_missing'});
  assert.equal(f.calls.some(row=>row.type==='read'),false);
});

test('offline or wrong-identity reader errors remain errors rather than empty successful directories',async t=>{
  const f=fixture(t);for(const code of ['account_offline','account_mismatch','timeout','invalid_response']){f.state.read=async()=>{throw Object.assign(Error('synthetic upstream detail must stay in main'),{code});};await assert.rejects(f.manager.directory(A,{kind:'groups'}),{code});assert.equal(f.manager.directoryRequests.size,0);}
  f.state.read=async options=>({...f.payload(options),accountId:B});await assert.rejects(f.manager.directory(A,{kind:'groups'}),{code:'account_changed'});
  f.state.read=async options=>({...f.payload(options),source:'claimed-real-time'});await assert.rejects(f.manager.directory(A,{kind:'groups'}),{code:'invalid_response'});
});

test('runtime endpoint or selected bridge changes before or after a read discard all result rows',async t=>{
  for(const change of [f=>{f.state.endpoint='endpoint-2';},f=>{f.state.connection.token='SYNTHETIC_REPLACEMENT';},f=>{f.state.connection.url='ws://127.0.0.1:3002';},f=>{f.state.connection.serverName='replacement';}]){
    const f=fixture(t);f.state.read=async options=>{change(f);return f.payload(options);};await assert.rejects(f.manager.directory(A,{kind:'friends'}),{code:'changed'});assert.equal(f.manager.snapshot(),null);
  }
  const f=fixture(t);f.runtime.getConnection=async()=>{f.state.connection.token='SYNTHETIC_CHANGED_BEFORE_READ';return {ownershipVerified:true,endpointId:'same'};};await assert.rejects(f.manager.directory(A,{kind:'friends'}),{code:'changed'});assert.equal(f.calls.some(row=>row.type==='read'),false);
});

test('an unverified management endpoint never opens the independent directory connection',async t=>{
  const f=fixture(t);f.runtime.getConnection=async()=>({ownershipVerified:false,endpointId:'unverified'});await assert.rejects(f.manager.directory(A,{kind:'friends'}),{code:'endpoint_unverified'});assert.equal(f.calls.some(row=>row.type==='read'),false);
});

test('a new read cancels only the same account and late old results cannot remove its replacement ticket',async t=>{
  const f=fixture(t),old=deferred(),next=deferred(),other=deferred();let count=0;
  f.state.read=options=>options.expectedAccountId===B?other.promise:++count===1?old.promise:next.promise;
  const first=f.manager.directory(A,{kind:'friends'});await tick();const aSignal=f.calls.find(row=>row.type==='read').options.signal;
  const independent=f.manager.directory(B,{kind:'groups'});await tick();const bSignal=f.calls.filter(row=>row.type==='read').at(-1).options.signal;
  const replacement=f.manager.directory(A,{kind:'groups',fresh:true});await tick();assert(aSignal.aborted);assert(!bSignal.aborted);
  old.resolve(f.payload({expectedAccountId:A,kind:'friends'}));await assert.rejects(first,{code:'cancelled'});assert.equal(f.manager.directoryRequests.size,2);
  next.resolve(f.payload({expectedAccountId:A,kind:'groups'}));other.resolve(f.payload({expectedAccountId:B,kind:'groups'}));assert.equal((await replacement).kind,'groups');assert.equal((await independent).accountId,B);assert.equal(f.manager.directoryRequests.size,0);
});

test('stop, configuration, restoration and login mutation abort the affected directory read',async t=>{
  for(const operation of [f=>f.manager.perform('stop',{accountId:A}),f=>f.manager.configure(A,{}),f=>f.manager.restoreBackup(A,{}),f=>f.manager.perform('start',{accountId:A}),f=>f.manager.perform('recover',{accountId:A}),f=>f.manager.perform('quick',{accountId:A}),f=>f.manager.perform('qr',{accountId:A,refresh:true})]){
    const f=fixture(t),gate=deferred();f.state.read=()=>gate.promise;const pending=f.manager.directory(A,{kind:'friends'});await tick();const signal=f.calls.find(row=>row.type==='read').options.signal;
    await operation(f);assert(signal.aborted);gate.resolve(f.payload({expectedAccountId:A,kind:'friends'}));await assert.rejects(pending,{code:'cancelled'});assert.equal(f.manager.snapshot()?.directory,undefined);
  }
});

test('changing installation or closing invalidates in-flight queries, including an unfinished endpoint check',async t=>{
  for(const operation of [f=>f.manager.setDirectory(f.alternative),f=>f.manager.close()]){
    const f=fixture(t),gate=deferred();f.state.read=()=>gate.promise;const pending=f.manager.directory(A,{kind:'friends'});await tick();const signal=f.calls.find(row=>row.type==='read').options.signal;
    await operation(f);assert(signal.aborted);gate.resolve(f.payload({expectedAccountId:A,kind:'friends'}));await assert.rejects(pending,{code:'changed'});
  }
  const f=fixture(t),gate=deferred();f.runtime.getConnection=()=>gate.promise;const pending=f.manager.directory(A,{kind:'friends'});await tick();await f.manager.close();gate.resolve({ownershipVerified:true,endpointId:'old'});await assert.rejects(pending,{code:'changed'});assert.equal(f.calls.some(row=>row.type==='read'),false);
});

test('ongoing mutations reject a new directory read without interrupting existing account services',async t=>{
  const f=fixture(t);f.manager.busy.add(B);await assert.rejects(f.manager.directory(A,{kind:'friends'}),{code:'operation_in_progress'});assert.equal(f.calls.length,0);f.manager.busy.delete(B);
});

test('production reader and coordinator work together over a real loopback fixture and reject a changed bridge afterwards',async t=>{
  const {WebSocketServer}=require('ws'),{once}=require('node:events'),{QQDirectoryReader}=require('../src/bot/qq-directory.cjs');
  const f=fixture(t),server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  t.after(async()=>{for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
  f.state.connection.url=`ws://127.0.0.1:${server.address().port}/`;f.manager.directoryFactory=()=>new QQDirectoryReader({timeoutMs:1500});let mutate=false;const actions=[];
  server.on('connection',(socket,request)=>{assert.equal(request.headers.authorization,`Bearer ${SECRET}`);socket.on('message',bytes=>{
    const call=JSON.parse(bytes);actions.push(call.action);let data;
    if(call.action==='get_login_info')data={user_id:Number(A)};
    else if(call.action==='get_status')data={online:true,good:true};
    else if(call.action==='get_friend_list'){data=[{user_id:12345999,nickname:'Readonly fixture',remark:'',phone_num:'PRIVATE_PHONE',email:'PRIVATE_EMAIL'}];if(mutate)f.state.connection.token='SYNTHETIC_ROTATED_TOKEN';}
    else return assert.fail('Only fixed read APIs are permitted');
    socket.send(JSON.stringify({status:'ok',retcode:0,echo:call.echo,data}));
  });});
  const result=await f.manager.directory(A,{kind:'friends'});assert.equal(result.items[0].id,'12345999');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|phone|email|TOKEN/);assert.deepEqual(actions,['get_login_info','get_status','get_friend_list','get_login_info','get_status']);
  mutate=true;await assert.rejects(f.manager.directory(A,{kind:'friends'}),{code:'changed'});assert.equal(f.manager.snapshot(),null);assert.equal(f.manager.directoryRequests.size,0);
});
