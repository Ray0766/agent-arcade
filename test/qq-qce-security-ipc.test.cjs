'use strict';
// Actual main and production transport; all account, vault and QCE data are synthetic.
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,TOKEN,PANEL,NEXT,until,deferred}=require('./helpers/qq-qce-main-fixture.cjs');

async function setup(t){
 const f=await fixture(t);await f.save();
 const security={allowedIPs:['127.0.0.1'],disabled:false,isDocker:false,configPath:'C:\\Synthetic-QCE\\PRIVATE_SECURITY_CONFIG.json',currentClientIP:'127.0.0.1',displayHost:'127.0.0.1',writes:[]};
 const deny=res=>{res.statusCode=403;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:{context:{code:'IP_NOT_ALLOWED'},message:'Synthetic protected route denied'},timestamp:'2026-11-07T00:00:00.000Z',requestId:randomUUID()}));};
 f.qce.state.handle=async(row,res,send)=>{
  if(security.denied&&row.path.startsWith('/api/')){deny(res);return true;}
  if(row.path==='/security-status'&&row.method==='GET'){
   send({hasConfig:true,tokenExpired:false,publicIP:security.displayHost,serverIP:security.displayHost,createdAt:'2026-11-07T00:00:00.000Z',lastAccess:new Date(f.qce.state.now).toISOString(),requiresAuth:true,isDocker:false,ipWhitelistDisabled:security.disabled,allowedIPs:[...security.allowedIPs],currentClientIP:security.currentClientIP,configPath:security.configPath});return true;
  }
  if(row.path==='/api/security/ip-whitelist'&&row.method==='GET'){send({allowedIPs:[...security.allowedIPs],disabled:security.disabled,isDocker:false,configPath:security.configPath,currentClientIP:security.currentClientIP});return true;}
  if(row.method!=='GET'&&['/api/security/ip-whitelist','/api/security/ip-whitelist/toggle','/api/server/host'].includes(row.path)){
   security.writes.push(row);
   if(row.path==='/api/server/host')security.displayHost=row.body.host==='0.0.0.0'?'127.0.0.1':row.body.host;
   else if(row.path.endsWith('/toggle'))security.disabled=row.body.disabled;
   else if(row.method==='DELETE'){const index=security.allowedIPs.indexOf(row.body.ip);if(index>=0)security.allowedIPs.splice(index,1);}
   else if(!security.allowedIPs.includes(row.body.ip))security.allowedIPs.push(row.body.ip);
   await security.onWrite?.(row,res);
   if(security.loseAck){res.destroy();return true;}
   if(row.path==='/api/server/host')send({message:'Synthetic display-host acknowledgment',serverAddresses:{local:'http://127.0.0.1:40653',...(security.displayHost==='127.0.0.1'?{}:{external:`http://${security.displayHost}:40653`})}});
   else if(row.path.endsWith('/toggle'))send({message:'Synthetic toggle acknowledgment',disabled:security.disabled});
   else send({message:'Synthetic rule acknowledgment',allowedIPs:[...security.allowedIPs]});
   if(security.denyAfterWrite)security.denied=true;
   return true;
  }
  return false;
 };
 const read=async(input=f.input)=>{const r=await f.invoke('SecurityRead',input);assert.equal(r.ok,true,JSON.stringify(r));return r.profile;};
 const preview=async(action='addRule',value='192.0.2.4',input=f.input)=>{const p=await read(input),r=await f.invoke('SecurityPreview',{...input,observationId:p.observationId,action,value});assert.equal(r.ok,true,JSON.stringify(r));return r.preview;};
 return {...f,security,read,preview};
}

test('security main uses existing token, protected identity and one confirmed rule request',async t=>{
 const f=await setup(t),secrets=JSON.stringify(f.service.secret),p=await f.preview();
 assert.equal(p.effects.sharedOSscope,true);assert.equal(p.effects.persistenceVerified,false);assert.equal(f.security.writes.length,0);
 const r=await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'match');assert.equal(r.change.effects.persistenceVerified,false);
 assert.deepEqual(f.security.writes.map(x=>[x.method,x.path,x.body]),[['POST','/api/security/ip-whitelist',{ip:'192.0.2.4'}]]);
 assert(f.state.nativeProofs>=3);assert(f.calls.some(x=>x.path==='/api/Plugin/List'));assert(f.qce.state.requests.every(x=>x.authorization==='Bearer '+TOKEN));
 assert.equal(JSON.stringify(f.service.secret),secrets);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SECURITY_CONFIG|SYNTHETIC_QCE_ONEBOT|SYNTHETIC_QCE_WEBUI/);
 assert.equal((await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.security.writes.length,1);assert.equal(f.pollingClosed,0);
});

test('renderer authority fields and foreign senders are rejected without retiring a valid security preview',async t=>{
 const f=await setup(t),p=await f.preview(),before=f.qce.state.requests.length;
 for(const extra of [{background:true},{host:'example.invalid'},{port:1},{token:TOKEN},{path:'security.json'}])assert.equal((await f.invoke('SecurityRead',{...f.input,...extra})).ok,false);
 await assert.rejects(f.invoke('SecurityRead',f.input,{sender:{},senderFrame:f.event.senderFrame}));
 await assert.rejects(f.invoke('SecurityRead',f.input,{sender:f.event.sender,senderFrame:{url:'https://example.invalid/'}}));
 assert.equal(f.qce.state.requests.length,before);
 assert.equal((await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId})).change.outcome,'accepted');assert.equal(f.security.writes.length,1);
});

test('unsupported registry and actual QQ mismatch do not expose security configuration',async t=>{
 for(const mutate of [f=>f.state.plugins[0].version='6.3.2',f=>f.state.plugins[0].status='disabled',f=>f.state.account='300001',f=>f.qce.state.account='300001']){
  const f=await setup(t);mutate(f);const r=await f.invoke('SecurityRead');assert.equal(r.ok,false);assert.equal(f.qce.state.requests.filter(x=>x.path==='/api/security/ip-whitelist').length,0);assert.equal(f.security.writes.length,0);
 }
});

test('changing runtime or actual QQ after preview prevents security write',async t=>{
 for(const mutate of [f=>f.console.epoch++,f=>f.state.account='300001',f=>f.qce.state.account='300001']){
  const f=await setup(t),p=await f.preview();mutate(f);const r=await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId});
  assert(r.ok===false||r.change.submission==='not_submitted',JSON.stringify(r));assert.equal(f.security.writes.length,0);
 }
});

test('security read retires old settings and local credential entry retires security without changing AI secrets',async t=>{
 const f=await setup(t),secrets=JSON.stringify(f.service.secret);assert.equal((await f.invoke('Read')).ok,true);
 const p=await f.preview();assert.equal(f.api.qceSession.accountId,null);assert.equal(f.api.qceSecuritySession.accountId,'whale');
 const count=f.qce.state.requests.length,s=await f.invoke('Status');assert.equal(s.ok,true);assert.equal(f.qce.state.requests.length,count);assert.equal(f.api.qceSecuritySession.accountId,null);
 assert.equal((await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.security.writes.length,0);assert.equal(JSON.stringify(f.service.secret),secrets);
});

test('QCE child close retires its local credential panel without retiring a newer owner',async t=>{
 for(const suffix of ['SecurityClose','ExportClose','ScheduleClose','NativePlansClose']){
  const f=await setup(t),status=await f.invoke('Status');assert.equal(status.ok,true);
  assert.equal((await f.invoke(suffix)).closed,true);assert.equal(f.api.localPanel(),null);
  assert.equal((await f.invoke('SaveCredential',{...f.input,expectedRevision:status.credential.revision,token:'R'.repeat(40)})).ok,false);
  const next={...f.input,panelId:NEXT},replacement=await f.invoke('Status',next);assert.equal(replacement.ok,true);
  await f.invoke(suffix);assert.equal(f.api.localPanel().panelId,NEXT);
 }
});

test('security close during local-status retirement prevents a late credential panel',async t=>{
 const f=await setup(t),gate=deferred(),original=f.api.pluginAdminSession.closeCurrent.bind(f.api.pluginAdminSession);let entered=false;
 f.api.pluginAdminSession.closeCurrent=async()=>{entered=true;await original();await gate.promise;};
 const pending=f.invoke('Status');await until(()=>entered);assert.equal((await f.invoke('SecurityClose')).closed,true);gate.resolve();
 assert.equal((await pending).ok,false);assert.equal(f.api.localPanel(),null);assert.equal(f.qce.state.requests.length,0);
});

test('minimize while security read waits for another owner prevents late client creation',async t=>{
 const f=await setup(t),gate=deferred(),original=f.api.pluginAdminSession.closeCurrent.bind(f.api.pluginAdminSession);let entered=false;
 f.api.pluginAdminSession.closeCurrent=async()=>{entered=true;await original();await gate.promise;};
 const pending=f.invoke('SecurityRead');await until(()=>entered);f.win.minimized=true;f.emit('minimize');gate.resolve();const r=await pending;
 assert.equal(r.ok,false);assert.equal(f.api.qceSecuritySession.accountId,null);assert.equal(f.qce.state.requests.length,0);assert.equal(f.security.writes.length,0);
});

test('old security close cannot retire a replacement panel and dismiss retains a usable baseline',async t=>{
 const f=await setup(t),input={...f.input,panelId:NEXT},p=await f.preview('addRule','192.0.2.5',input);
 assert.equal((await f.invoke('SecurityClose')).closed,true);assert.equal(f.api.qceSecuritySession.panelId,NEXT);
 assert.equal((await f.invoke('SecurityDismiss',input)).dismissed,true);
 const before=f.qce.state.requests.length,next=await f.invoke('SecurityPreview',{...input,observationId:p.observationId,action:'addRule',value:'192.0.2.6'});
 assert.equal(next.ok,true,JSON.stringify(next));assert.equal(f.qce.state.requests.length,before);
 assert.equal((await f.invoke('SecurityConfirm',{...input,ticketId:next.preview.ticketId})).change.outcome,'accepted');
});

test('self-locking rule removal preserves accepted acknowledgment when protected readback fails',async t=>{
 const f=await setup(t);f.security.allowedIPs=['127.0.0.1','::1'];const p=await f.read();
 const preview=await f.invoke('SecurityPreview',{...f.input,observationId:p.observationId,action:'removeRule',value:p.state.rules[0].ruleId});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(preview.preview.effects.mayBlockThisConnection,true);
 f.security.denyAfterWrite=true;const r=await f.invoke('SecurityConfirm',{...f.input,ticketId:preview.preview.ticketId});
 assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'unavailable');assert.equal(r.change.automaticRestore,false);assert.deepEqual(f.security.allowedIPs,['::1']);assert.equal(f.security.writes.length,1);
});

test('lost security acknowledgment remains unknown despite matching readback and is not replayed',async t=>{
 const f=await setup(t),p=await f.preview();f.security.loseAck=true;const r=await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId});
 assert.equal(r.change.outcome,'unknown');assert.equal(r.change.observation.state,'match');assert.equal(r.change.automaticRetry,false);assert.equal(f.security.writes.length,1);
 assert.equal((await f.invoke('SecurityConfirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.security.writes.length,1);
});

test('preload exposes only five fixed security methods and no credential getter or generic request',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 const suffixes=['Read','Preview','Confirm','Dismiss','Close'],input={accountId:'whale',panelId:PANEL};
 assert.deepEqual(Object.keys(exposed.arcade).filter(k=>k.startsWith('qqQceSecurity')),suffixes.map(s=>'qqQceSecurity'+s));for(const s of suffixes)exposed.arcade['qqQceSecurity'+s](input);assert.equal(calls.length,5);assert(calls.every(([,v])=>v===input));
});
