'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {QQRuntimeManager,classifyLogLine,MAX_LOG_BYTES}=require('../src/bot/qq-runtime.cjs');

// Synthetic installed files/process tables. These tests never launch or stop QQ.
const A='12345001',B='12345002';
const startDeferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t,extra={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-runtime-'));
  const root=path.join(dir,'arcade'),desktopDataRoot=path.join(dir,'desktop'),componentsRoot=path.join(desktopDataRoot,'components'),runtime=path.join(componentsRoot,'NapCatQQ'),config=path.join(runtime,'config'),qq=path.join(componentsRoot,'QQ','versions','9.9.36-53644');
  for(const p of [root,config,qq])fs.mkdirSync(p,{recursive:true});
  for(const name of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'])fs.writeFileSync(path.join(runtime,name),'fixture');
  fs.writeFileSync(path.join(runtime,'loadNapCat.js'),'original loader must remain unchanged');
  fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify({version:'0.0.1'}));
  fs.writeFileSync(path.join(qq,'QQ.exe'),'fixture');fs.writeFileSync(path.join(componentsRoot,'QQ','current.txt'),'9.9.36-53644');
  for(const id of [A,B])fs.writeFileSync(path.join(config,`onebot11_${id}.json`),'SECRET_NEVER_EXPORT');
  fs.writeFileSync(path.join(config,'webui.json'),'WEBUI_SECRET_NEVER_EXPORT');
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-05T12:00:00.0000000Z',name:'test.exe',executable:process.execPath};
  const state={rows:[self],starts:[],stops:[],next:800000,onSnapshot:null};
  const host={allocatePort:async()=>53000+state.starts.length,listeners:async()=>state.listeners||[],inspect:async pids=>state.rows.filter(p=>pids.includes(p.pid)).map(x=>({...x})),snapshot:async()=>{if(state.onSnapshot)await state.onSnapshot();return state.rows.map(x=>({...x}));},
    start:async plan=>{state.starts.push(plan);const pid=state.next++;state.rows.push({pid,parentPid:process.pid,name:'NapCatWinBootMain.exe',executable:plan.file,createdAt:'2026-11-05T13:00:00.1234567Z',accountId:plan.args.at(-1)});state.rows.push({pid:state.next++,parentPid:pid,name:'QQ.exe',executable:plan.args[0],createdAt:'2026-11-05T13:00:01.0000000Z'});return {pid};},
    stop:async proofs=>{state.stops.push(proofs);state.rows=state.rows.filter(p=>!proofs.some(v=>v.pid===p.pid));},
  };
  const options={root,desktopDataRoot,lockRoot:path.join(dir,'shared-locks'),platform:'win32',processHost:host,profileRoot:path.join(dir,'electron-profile'),...extra};
  const manager=new QQRuntimeManager(options);
  t.after(()=>{const resolved=fs.realpathSync(dir);assert(resolved.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const addDesktop=()=>state.rows.push({pid:999001,parentPid:1,name:'NapCatQQ-Desktop.exe',executable:path.join(dir,'NapCatQQ-Desktop.exe'),createdAt:'2026-11-05T12:00:00Z'});
  return {dir,root,desktopDataRoot,componentsRoot,runtime,config,qq,state,host,options,manager,addDesktop};
}

test('owned run display generation is stable and contains no proof or credentials',async t=>{
 const f=fixture(t);await f.manager.start(A);const a=(await f.manager.discover()).instances.find(x=>x.accountId===A),again=(await f.manager.discover()).instances.find(x=>x.accountId===A);assert.match(a.processGeneration,/^[a-f0-9]{64}$/);assert.equal(again.processGeneration,a.processGeneration);assert.doesNotMatch(JSON.stringify(a),/SECRET|token|createdAt|executable|pid/);await f.manager.stop(A);assert.equal((await f.manager.discover()).instances.find(x=>x.accountId===A).processGeneration,undefined);await f.manager.start(A);assert.notEqual((await f.manager.discover()).instances.find(x=>x.accountId===A).processGeneration,a.processGeneration);await f.manager.stop(A);
});
test('unverified process metadata or operation reason never projects continuity',async t=>{
 const f=fixture(t);await f.manager.start(A);f.state.onSnapshot=()=>{throw Error('synthetic inspection failure');};let row=(await f.manager.discover()).instances.find(x=>x.accountId===A);assert.equal(row.processGeneration,undefined);f.state.onSnapshot=null;f.manager.pending.add(A);row=(await f.manager.discover()).instances.find(x=>x.accountId===A);assert.equal(row.reason,'operation_in_progress');assert.equal(row.processGeneration,undefined);f.manager.pending.delete(A);await f.manager.stop(A);
});
test('actual Console keeps only display continuity across status and second endpoint failures',async t=>{
 const {QQConsole}=require('../src/bot/qq-console.cjs'),f=fixture(t);await f.manager.start(A);let phase='online',calls=0;
 f.manager.getConnections=async ids=>{calls++;return new Map(ids.map(id=>[id,phase==='endpoint'&&calls%2===0?{error:{code:'webui_unavailable'}}:{connection:{port:6000,token:'synthetic-webui-token',endpointId:'fixed-endpoint',ownershipVerified:true}}]));};
 const client={status:async()=>{if(phase==='status')throw Object.assign(Error('synthetic timeout'),{code:'timeout'});return {state:'online',online:true};},close(){}};
 const console=new QQConsole({root:f.root,runtimeFactory:()=>f.manager,clientFactory:()=>client,profileFactory:()=>({list:async()=>[]})});
 let row=(await console.refresh()).instances.find(x=>x.accountId===A);const display=row.processGeneration,revision=row.runtimeRevision;assert.match(display,/^[a-f0-9]{64}$/);assert(revision);
 phase='status';calls=0;row=(await console.refresh()).instances.find(x=>x.accountId===A);assert.equal(row.processGeneration,display);assert.equal(row.login.issue,'timeout');assert.equal(row.runtimeRevision,undefined);
 phase='endpoint';calls=0;row=(await console.refresh()).instances.find(x=>x.accountId===A);assert.equal(row.processGeneration,display);assert.equal(row.login.issue,'endpoint_recheck_unavailable');assert.equal(row.runtimeRevision,undefined);
 phase='online';calls=0;row=(await console.refresh()).instances.find(x=>x.accountId===A);assert.equal(row.processGeneration,display);assert.notEqual(row.runtimeRevision,revision);await console.close();
});
