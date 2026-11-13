'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,ID}=require('./helpers/qq-plugin-deployment-fixture.cjs');
const {QQPluginDeployment,assertPluginDeploymentReady}=require('../src/bot/qq-plugin-deployment.cjs');
const original=Buffer.from('{\r\n  "future-key": {"wide":9007199254740993,"nested":{"x":true}},\r\n  "napcat-plugin-cleaner": false\r\n}\r\n');
function fresh(t,{absent=false}={}){
  const f=fixture(t,{installed:false});f.pref=path.join(f.configDir,'plugins.json');
  if(absent)fs.unlinkSync(f.pref);else fs.writeFileSync(f.pref,original);
  f.start=()=>f.preview('install',{initialDisabled:true});
  return f;
}
function restart(f){return new QQPluginDeployment(f.options);}
async function recover(f,id){const c=restart(f),r=c.read(),p=await c.preview({observationId:r.observationId,operation:'restore',pluginId:ID,backupId:id});assert.equal(p.enablePreferenceEffect,'restore_initial_preference');assert.equal(p.initialDisabled,false);const result=await c.confirm({ticketId:p.ticketId});return result;}

test('fresh disabled install writes only the new preference before exposing code and keeps exact other text',async t=>{
  const f=fresh(t),config=fs.readFileSync(path.join(f.configDir,'plugins',ID,'config.json'));
  const option=f.read().initialDisableOptions.find(x=>x.pluginId===ID);assert.deepEqual(option,{pluginId:ID,available:true,reason:null});
  const p=await f.start();assert.equal(p.initialDisabled,true);assert.equal(p.enablePreferenceEffect,'set_initial_disabled');assert.equal(p.existingEnableStatePreserved,false);assert.equal(p.laterStartMayLoad,false);
  const rename=fs.renameSync;let observed=false;
  const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.current){observed=true;assert.equal(JSON.parse(fs.readFileSync(f.pref))[ID],false);assert.throws(()=>assertPluginDeploymentReady(f.workDir),{code:'deployment_recovery_required'});}return rename(from,to);});
  const r=await f.controller.confirm({ticketId:p.ticketId});mock.mock.restore();assert.equal(observed,true);assert.equal(r.committed,true);assert.equal(r.initialDisableVerified,true);assert.equal(r.enablePreferenceChanged,true);assert.equal(r.configurationPreserved,false);
  const after=fs.readFileSync(f.pref,'utf8');assert.equal(after.replace(',"napcat-plugin-builtin":false',''),original.toString());assert.equal(after.includes('9007199254740993'),true);
  assert.deepEqual(fs.readFileSync(path.join(f.configDir,'plugins',ID,'config.json')),config);
  const tx=path.join(f.workDir,'.agent-arcade-plugin-history',r.backupId),plan=JSON.parse(fs.readFileSync(path.join(tx,'plan.json')));
  assert.equal(plan.schema,'qq_plugin_deployment_v2');assert.deepEqual(fs.readFileSync(path.join(tx,'preferences-before.json')),original);assertPluginDeploymentReady(f.workDir);
  await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});
});

test('absent preferences are created as a disabled record, normal completed restore leaves the preference untouched',async t=>{
  const f=fresh(t,{absent:true}),p=await f.start(),r=await f.controller.confirm({ticketId:p.ticketId});assert.equal(r.committed,true);assert.deepEqual(JSON.parse(fs.readFileSync(f.pref)),{[ID]:false});
  const before=fs.readFileSync(f.pref),p2=await f.preview('restore',{backupId:r.backupId});assert.equal(p2.enablePreferenceEffect,'preserve');assert.equal(p2.existingEnableStatePreserved,true);const r2=await f.controller.confirm({ticketId:p2.ticketId});assert.equal(r2.committed,true);assert.equal(r2.enablePreferenceChanged,false);assert.deepEqual(fs.readFileSync(f.pref),before);assert.equal(fs.existsSync(f.current),false);
});

test('existing preference and installed plugin never get silently overwritten by the new option',async t=>{
  for(const enabled of [true,false,null])await t.test('existing '+enabled,async t=>{const f=fresh(t);fs.writeFileSync(f.pref,JSON.stringify({[ID]:enabled}));const before=fs.readFileSync(f.pref);assert.equal(f.read().initialDisableOptions.find(x=>x.pluginId===ID).reason,'preference_present');await assert.rejects(f.start(),{code:'preference_present'});assert.deepEqual(fs.readFileSync(f.pref),before);assert.equal(fs.existsSync(f.current),false);});
  await t.test('update',async t=>{const f=fixture(t);assert.equal(f.read().initialDisableOptions.find(x=>x.pluginId===ID).reason,'already_installed');await assert.rejects(f.preview('install',{initialDisabled:true}),{code:'initial_disable_unavailable'});});
});

test('option is literal true only for install; omission keeps the original V1 behavior and bytes',async t=>{
  const f=fresh(t),before=fs.readFileSync(f.pref);
  for(const initialDisabled of [false,0,'true',null])await assert.rejects(f.preview('install',{initialDisabled}),{code:'invalid_request'});
  await assert.rejects(f.preview('remove',{initialDisabled:true}),{code:'invalid_request'});
  const p=await f.preview(),r=await f.controller.confirm({ticketId:p.ticketId});assert.equal(p.initialDisabled,false);assert.equal(p.enablePreferenceEffect,'preserve');assert.equal(r.enablePreferenceChanged,false);assert.deepEqual(fs.readFileSync(f.pref),before);const plan=JSON.parse(fs.readFileSync(path.join(f.workDir,'.agent-arcade-plugin-history',r.backupId,'plan.json')));assert.equal(plan.schema,'qq_plugin_deployment_v1');
});

test('malformed, duplicate and non-object preferences block the new option but remain untouched',async t=>{
  const cases=['{','[]','null','{"x":1,"x":2}','{"x":{"a":1,"\\u0061":2}}','{"napcat-plugin-builtin":false,"napcat-plugin-builtin":true}','{"x":1} trailing','\ufeff{}'];
  for(const [i,text] of cases.entries())await t.test(String(i),async t=>{const f=fresh(t);fs.writeFileSync(f.pref,text);assert.equal(f.read().initialDisableOptions.find(x=>x.pluginId===ID).reason,'preferences_invalid');await assert.rejects(f.start(),{code:'preferences_invalid'});assert.equal(fs.readFileSync(f.pref,'utf8'),text);assert.equal(fs.existsSync(f.current),false);});
});

test('changed preference after preview refuses before journal or code changes',async t=>{
  const f=fresh(t),p=await f.start();fs.writeFileSync(f.pref,'{"later":true}');const r=await f.controller.confirm({ticketId:p.ticketId});assert.equal(r.committed,false);assert.equal(r.code,'deployment_changed');assert.equal(r.enablePreferenceChanged,false);assert.equal(fs.existsSync(f.current),false);assert.equal(fs.readFileSync(f.pref,'utf8'),'{"later":true}');
});

test('every rename boundary remains startup-blocked and recovers original preference bytes across reopen',async t=>{
  for(const point of ['before-backup','after-backup','before-preference-publish','after-preference-publish','before-code-publish','after-code-publish'])await t.test(point,async t=>{
    const f=fresh(t),p=await f.start(),rename=fs.renameSync;let fired=false;
    const mock=t.mock.method(fs,'renameSync',(from,to)=>{
      const stage=from===f.pref?'backup':to===f.pref?'preference-publish':to===f.current?'code-publish':null;
      if(stage&&point==='before-'+stage&&!fired){fired=true;throw Error('synthetic before '+stage);}
      const result=rename(from,to);if(stage&&point==='after-'+stage&&!fired){fired=true;throw Error('synthetic after '+stage);}return result;
    });
    const r=await f.controller.confirm({ticketId:p.ticketId});mock.mock.restore();assert.equal(fired,true);assert.equal(r.committed,null);assert.equal(r.enablePreferenceChanged,null);assert.equal(r.initialDisableVerified,false);assert.throws(()=>assertPluginDeploymentReady(f.workDir),{code:'deployment_recovery_required'});
    const result=await recover(f,r.backupId);assert.equal(result.committed,true);assert.equal(result.configurationPreserved,true);assert.deepEqual(fs.readFileSync(f.pref),original);assert.equal(fs.existsSync(f.current),false);assertPluginDeploymentReady(f.workDir);
  });
});

test('interrupted installation restores original preference absence without deleting unrecognized data',async t=>{
  const f=fresh(t,{absent:true}),p=await f.start(),rename=fs.renameSync;
  const mock=t.mock.method(fs,'renameSync',(from,to)=>{const r=rename(from,to);if(to===f.current)throw Error('synthetic lost publish ack');return r;});
  const r=await f.controller.confirm({ticketId:p.ticketId});mock.mock.restore();assert.equal(r.committed,null);assert.equal((await recover(f,r.backupId)).committed,true);assert.equal(fs.existsSync(f.pref),false);assertPluginDeploymentReady(f.workDir);
});

test('recovery refuses an externally changed preference or same-byte replacement identity',async t=>{
  for(const replacement of [false,true])await t.test(String(replacement),async t=>{
    const f=fresh(t),p=await f.start(),rename=fs.renameSync;
    const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.current)throw Error('synthetic interrupted');return rename(from,to);});
    const r=await f.controller.confirm({ticketId:p.ticketId});mock.mock.restore();const bytes=fs.readFileSync(f.pref);if(replacement){rename(f.pref,path.join(f.workDir,'external-preserved.json'));fs.writeFileSync(f.pref,bytes);}else fs.writeFileSync(f.pref,'{"external":true}');
    const current=fs.readFileSync(f.pref),result=await recover(f,r.backupId);assert.equal(result.committed,null);assert.deepEqual(fs.readFileSync(f.pref),current);assert.throws(()=>assertPluginDeploymentReady(f.workDir),{code:'deployment_recovery_required'});
  });
});

test('an interruption during preference recovery is recoverable without deleting either retained file',async t=>{
  const f=fresh(t),p=await f.start(),rename=fs.renameSync;
  let mock=t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.current)throw Error('synthetic install');return rename(from,to);});const r=await f.controller.confirm({ticketId:p.ticketId});mock.mock.restore();
  mock=t.mock.method(fs,'renameSync',(from,to)=>{const value=rename(from,to);if(to.endsWith('preferences-displaced.json'))throw Error('synthetic recovery ack');return value;});const first=await recover(f,r.backupId);mock.mock.restore();assert.equal(first.committed,null);
  const second=await recover(f,r.backupId);assert.equal(second.committed,true);assert.deepEqual(fs.readFileSync(f.pref),original);assertPluginDeploymentReady(f.workDir);
});

test('new initial state does not bypass a late shared-runtime stop guard',async t=>{
  const f=fresh(t),p=await f.start();f.state.stoppedHook=n=>{if(n===4)throw Object.assign(Error('synthetic runtime'),{code:'runtime_running'});};const r=await f.controller.confirm({ticketId:p.ticketId});assert.equal(r.committed,null);assert.equal(fs.existsSync(f.current),false);assert.equal(JSON.parse(fs.readFileSync(f.pref))[ID],false);assert.throws(()=>assertPluginDeploymentReady(f.workDir),{code:'deployment_recovery_required'});f.state.stoppedHook=null;assert.equal((await recover(f,r.backupId)).committed,true);
});
