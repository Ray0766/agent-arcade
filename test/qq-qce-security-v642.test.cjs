'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,deferred,TOKEN}=require('./helpers/qq-qce-security-fixture.cjs');
const P=require('../src/bot/qq-qce-security-policy.cjs');
const {QQQCESecurityClient}=require('../src/bot/qq-qce-security-client.cjs');
// Real ephemeral loopback HTTP and actual Session/client; fixed Rust 6.4.2
// envelopes are synthetic. No plugin, credentials, account or public network.
async function rustFixture(t){
 const f=await fixture(t),s=f.state;s.version='6.4.2';f.binding.pluginVersion='6.4.2';
 s.handle=async(row,res,send,error)=>{
  if(await s.rustHandle?.(row,res,send,error))return true;
  if(s.enforce&&row.path!=='/security-status'&&!P.allowsLoopback({rules:s.rules,disabled:s.disabled},'6.4.2')){error(403,'IP_NOT_ALLOWED');return true;}
  if(row.path==='/auth'){assert.equal(row.method,'POST');assert.deepEqual(row.body,{token:TOKEN});await s.onAuth?.();send(s.authData??{authenticated:true,serverIP:s.displayHost,clientIP:s.currentClientIP});return true;}
  if(row.path==='/api/security/ip-whitelist'&&row.method==='GET'){await s.rustList?.();send({allowedIPs:s.rules,disabled:s.disabled,isDocker:false,currentClientIP:s.currentClientIP});return true;}
  if(row.path==='/security-status'){send({hasConfig:true,tokenExpired:false,requiresAuth:true});return true;}
  return false;
 };
 f.mutations=()=>f.writes().filter(r=>r.path!=='/auth');return f;
}
test('642 minimal status/list/auth schemas remain separate from the strict old baseline',()=>{
 const list={allowedIPs:['127.0.0.1'],disabled:false,isDocker:false,currentClientIP:'127.0.0.1'};
 assert.throws(()=>P.whitelist(list),{code:'invalid_response'});const v=P.whitelist(list,'6.4.2');assert(!Object.hasOwn(v,'configPath'));
 assert.deepEqual(P.status({hasConfig:true,tokenExpired:false,requiresAuth:true},'6.4.2'),{hasConfig:true,tokenExpired:false,requiresAuth:true});
 for(const auth of [{authenticated:false,serverIP:null,clientIP:'127.0.0.1'},{authenticated:true,clientIP:'127.0.0.1'},{authenticated:true,serverIP:null,clientIP:null}])assert.throws(()=>P.authentication(auth),{code:'invalid_response'});
 assert.throws(()=>P.combine(v,P.authentication({authenticated:true,serverIP:null,clientIP:'::1'}),'6.4.2'),{code:'baseline_changed'});
 assert.equal(P.combine(v,P.authentication({authenticated:true,serverIP:null,clientIP:'127.0.0.1'}),'6.4.2').displayHost,null);
 assert.throws(()=>new QQQCESecurityClient({version:'6.4.3',token:TOKEN}),{code:'qce_version_unsupported'});
});
test('642 host and CIDR prediction follow the pinned Rust grammar without changing 5577',()=>{
 assert.equal(P.host('2001:db8::1'),'2001:db8::1');assert.throws(()=>P.host('2001:db8::1','6.4.2'),{code:'invalid_host'});
 const allows=(rule,version)=>P.allowsLoopback({rules:[rule],disabled:false},version);
 assert.equal(allows('127oops.0.0.1/8junk','5.5.77'),true);assert.equal(allows('127oops.0.0.1/8junk','6.4.2'),false);
 for(const v of ['127.0.0.1/+08','127.000.0.1/8','+127.0.0.1/8','::ffff:127.0.0.0/8'])assert.equal(allows(v,'6.4.2'),true,v);
 for(const v of ['127.0.0.1/4294967296','127.0.0.1/-0','127.0.0.1/8/0','127.0.0.1/8junk','127x.0.0.1/8'])assert.equal(allows(v,'6.4.2'),false,v);
 assert.equal(allows('::1','6.4.2'),false);
});
test('642 read authenticates only with owned captured token and brackets matching rule reads',async t=>{
 const f=await rustFixture(t),r=await f.session.read(f.input);assert.equal(r.profile.version,'6.4.2');
 assert.deepEqual(f.state.requests.map(x=>[x.method,x.path]),[['GET','/api/system/info'],['GET','/api/security/ip-whitelist'],['POST','/auth'],['GET','/api/security/ip-whitelist'],['GET','/api/system/info']]);
 assert.doesNotMatch(JSON.stringify(r),/SSSSSS|security\.json|configPath|PRIVATE_SYNTHETIC/);assert.equal(f.created[0].version,'6.4.2');
 for(const row of f.state.requests){assert.equal(row.headers.authorization,'Bearer '+TOKEN);assert.equal(row.headers.cookie,undefined);assert.equal(row.headers['x-forwarded-for'],undefined);assert(!row.path.includes('?'));}
 const old=new QQQCESecurityClient(f.clientOptions);t.after(()=>old.close());assert.throws(()=>old.authenticate(),{code:'invalid_request'});assert.equal(f.mutations().length,0);
});
test('642 executes the existing five actions with exact one-use previews and no persistence claim',async t=>{
 const f=await rustFixture(t);
 for(const [action,value]of [['addRule','192.0.2.8'],['setDisabled',true],['setDisplayHost','example.invalid']]){const p=await f.preview(action,value),r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'match');assert.equal(r.change.effects.persistenceVerified,false);await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});}
 f.state.rules=['::1'];let p=await f.preview('addCurrent',null);assert.equal((await f.session.confirm({...f.input,ticketId:p.preview.ticketId})).change.observation.state,'match');
 const r=await f.session.read(f.input);p=f.session.preview({...f.input,observationId:r.profile.observationId,action:'removeRule',value:r.profile.state.rules[0].ruleId});assert.equal((await f.session.confirm({...f.input,ticketId:p.preview.ticketId})).change.outcome,'accepted');assert.equal(f.mutations().length,5);
 const read=await f.session.read(f.input);assert.throws(()=>f.session.preview({...f.input,observationId:read.profile.observationId,action:'setDisplayHost',value:'::1'}),{code:'invalid_host'});assert.equal(f.mutations().length,5);
});
test('642 version mismatch or changed rule/auth correlation cannot mint a baseline',async t=>{
 const f=await rustFixture(t);f.state.version='5.5.77';await assert.rejects(f.session.read(f.input),{code:'qce_version_unsupported'});assert.equal(f.state.requests.length,1);f.state.version='6.4.2';
 f.state.authData={authenticated:true,serverIP:'127.0.0.1',clientIP:'::1'};await assert.rejects(f.session.read(f.input),{code:'baseline_changed'});f.state.authData=null;
 f.state.onAuth=()=>f.state.rules.push('192.0.2.7');await assert.rejects(f.session.read(f.input),{code:'baseline_changed'});assert.equal(f.mutations().length,0);
});
test('642 confirm rechecks complete observable baseline, binding version and credential revision',async t=>{
 const f=await rustFixture(t);
 for(const [key,value]of [['displayHost','changed.invalid'],['currentClientIP','::ffff:127.0.0.1'],['rules',['127.0.0.1']]]){const p=await f.preview();f.state[key]=value;assert.equal((await f.session.confirm({...f.input,ticketId:p.preview.ticketId})).change.code,'baseline_changed');}
 let p=await f.preview();f.binding.pluginVersion='5.5.77';await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'changed'});await f.session.closeCurrent();f.binding.pluginVersion='6.4.2';
 p=await f.preview();f.binding.credentialRevision=randomUUID();await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'changed'});assert.equal(f.mutations().length,0);
});
test('642 self-lock ACK and dropped ACK retain different truthful outcomes with no replay',async t=>{
 const f=await rustFixture(t);f.state.enforce=true;const read=await f.session.read(f.input),p=f.session.preview({...f.input,observationId:read.profile.observationId,action:'removeRule',value:read.profile.state.rules[0].ruleId});assert.equal(p.preview.effects.mayBlockThisConnection,true);
 let r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'unavailable');
 f.state.rules=['127.0.0.1'];const next=await f.preview('setDisplayHost','new.invalid');f.state.writeMode='disconnect';r=await f.session.confirm({...f.input,ticketId:next.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.observation.state,'match');assert.equal(f.mutations().length,2);
});
test('642 cancellation during captured-token auth settles and cannot submit a later mutation',async t=>{
 const f=await rustFixture(t),entered=deferred(),release=deferred();f.state.onAuth=async()=>{entered.resolve();await release.promise;};
 const pending=f.session.read(f.input),rejected=assert.rejects(pending,{code:'cancelled'});await entered.promise;const closed=f.session.closeOwned(f.input);release.resolve();await rejected;assert.equal((await closed).closed,true);assert.equal(f.mutations().length,0);assert.equal(f.created[0].token,'');
});
