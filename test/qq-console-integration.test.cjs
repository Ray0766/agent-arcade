'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {QQConsole}=require('../src/bot/qq-console.cjs');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {QQProfileConfig}=require('../src/bot/qq-profile-config.cjs');

// Real temporary files and production config/runtime modules; process queries
// and the destination vault are synthetic. No installed QQ instance is touched.
const A='12345001',B='12345002',OWNER='12345999';
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-integration-')),root=path.join(dir,'app'),desktop=path.join(dir,'desktop'),alternate=path.join(dir,'alternate');
  fs.mkdirSync(root,{recursive:true});
  const installation=base=>{const config=path.join(base,'components','NapCatQQ','config'),runtime=path.dirname(config),qq=path.join(base,'components','QQ');fs.mkdirSync(config,{recursive:true});fs.mkdirSync(qq,{recursive:true});fs.writeFileSync(path.join(qq,'QQ.exe'),'synthetic');for(const file of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'])fs.writeFileSync(path.join(runtime,file),'synthetic');return config;};
  const config=installation(desktop);installation(alternate);
  fs.writeFileSync(path.join(config,`onebot11_${A}.json`),JSON.stringify({network:{websocketServers:[{name:'existing',host:'127.0.0.1',port:3001,enable:true,token:'INTEGRATION_TOKEN_NOT_REAL'}]},unknown:{preserved:true}}));
  const state={port:52000,portCheck:async p=>p||state.port,processActions:0,rows:[{pid:process.pid,parentPid:1,name:'node.exe',executable:process.execPath,createdAt:'2026-11-06T01:00:00Z'}]};
  const host={snapshot:async()=>state.rows.map(v=>({...v})),inspect:async ids=>state.rows.filter(v=>ids.includes(v.pid)),listeners:async()=>[],start:async()=>{state.processActions++;throw Error('No real process action is allowed in this fixture');},stop:async()=>{state.processActions++;throw Error('No real process action is allowed in this fixture');}};
  const manager=new QQConsole({root,qrEncoder:async()=>assert.fail('No QR in config tests'),runtimeFactory:options=>new QQRuntimeManager({...options,desktopDataRoot:options.desktopDataRoot||desktop,lockRoot:path.join(dir,'locks'),platform:'win32',processHost:host}),profileFactory:options=>new QQProfileConfig({...options,checkPort:p=>state.portCheck(p)})});
  const service={status:'disconnected',config:{channel:'wechat',mode:'gpt',character:'codex-dragon'},vault:{modelKey:'SYNTHETIC_MODEL_KEY'},writes:0,connections:0,assertCredentialsAvailable(){},configure({qqToken,...patch}){this.writes++;this.vault.qqToken=qqToken;Object.assign(this.config,patch);},connect(){this.connections++;}};
  t.after(async()=>{await manager.close();const resolved=fs.realpathSync(dir),temp=fs.realpathSync(os.tmpdir());assert(resolved.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,root,desktop,alternate,config,state,manager,service,file:id=>path.join(config,`onebot11_${id}.json`)};
}
async function gatePort(f){let release,entered;const ready=new Promise(r=>{entered=r;});f.state.portCheck=p=>{entered();return new Promise(r=>{release=()=>r(p||f.state.port);});};return {ready,release:()=>release()};}

test('new config flows through console into the selected companion with explicit expected QQ identity',async t=>{
  const f=fixture(t),saved=await f.manager.configure(B,{create:true,serverName:'arcade-new'});
  assert(saved.configured&&saved.created);assert.equal(saved.state.instances.find(v=>v.accountId===B).bridges[0].hasToken,true);assert.equal(f.service.writes,0);
  const linked=f.manager.link(B,{ownerId:OWNER,serverName:'arcade-new'},f.service),config=JSON.parse(fs.readFileSync(f.file(B),'utf8'));
  assert.deepEqual(linked,{linked:true});assert.equal(f.service.config.qqAccountId,B);assert.equal(f.service.config.qqOwnerId,OWNER);assert.equal(f.service.config.qqUrl,'ws://127.0.0.1:52000');assert.equal(f.service.vault.qqToken,config.network.websocketServers[0].token);assert.match(f.service.vault.qqToken,/^[a-f0-9]{64}$/);
  assert.equal(f.service.config.mode,'gpt');assert.equal(f.service.config.character,'codex-dragon');assert.equal(f.service.vault.modelKey,'SYNTHETIC_MODEL_KEY');assert.equal(f.service.connections,0);assert.equal(f.state.processActions,0);assert(!JSON.stringify(saved).includes(f.service.vault.qqToken));assert(!JSON.stringify(linked).includes(f.service.vault.qqToken));
});

test('failed new configuration cannot be imported and never writes the companion vault',async t=>{
  const f=fixture(t);await assert.rejects(f.manager.configure(B,{create:true,port:3001}),{code:'port_conflict'});
  assert(!fs.existsSync(f.file(B)));assert.throws(()=>f.manager.link(B,{ownerId:OWNER},f.service),{code:'invalid_account'});assert.equal(f.service.writes,0);assert.equal(f.service.config.channel,'wechat');assert.equal(f.state.processActions,0);
});

test('pending config commit blocks linking and switching component directories',async t=>{
  const f=fixture(t),gate=await gatePort(f),saving=f.manager.configure(B,{create:true});await gate.ready;
  assert.throws(()=>f.manager.link(A,{ownerId:OWNER},f.service),{code:'operation_in_progress'});await assert.rejects(f.manager.setDirectory(f.alternate),{code:'operation_in_progress'});assert.equal(f.service.writes,0);assert(!fs.existsSync(f.manager.file));
  gate.release();assert((await saving).configured);assert.equal(f.manager.runtime.desktopDataRoot,f.desktop);
});

test('a directory switch invalidates an old account choice instead of importing from the previous folder',async t=>{
  const f=fixture(t);const state=await f.manager.setDirectory(f.alternate);assert.equal(state.instances.length,0);assert.equal(f.manager.runtime.desktopDataRoot,fs.realpathSync(f.alternate));
  assert.throws(()=>f.manager.link(A,{ownerId:OWNER},f.service),{code:'invalid_account'});assert.equal(f.service.writes,0);assert(fs.existsSync(f.file(A)));
});

test('a closed console refuses new configuration and linking without touching files or vault',async t=>{
  const f=fixture(t);await f.manager.close();await assert.rejects(f.manager.configure(B,{create:true}),{code:'changed'});assert.throws(()=>f.manager.link(A,{ownerId:OWNER},f.service),{code:'changed'});assert(!fs.existsSync(f.file(B)));assert.equal(f.service.writes,0);
});

test('close during a pending config write preserves an explicit committed result',async t=>{
  const f=fixture(t),gate=await gatePort(f),saving=f.manager.configure(B,{create:true});await gate.ready;
  let closed=false;const closing=f.manager.close().then(result=>{closed=true;return result;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);assert(!fs.existsSync(f.file(B)));
  gate.release();const [saved]=await Promise.all([saving,closing]);assert.equal(closed,true);
  assert.equal(saved.configured,true);assert.equal(saved.refreshIssue,'changed');assert(fs.existsSync(f.file(B)));assert.equal(f.service.writes,0);assert.equal(f.state.processActions,0);
});
