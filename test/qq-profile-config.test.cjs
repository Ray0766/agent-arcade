'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {QQProfileConfig,MAX_CONFIG_BYTES}=require('../src/bot/qq-profile-config.cjs');
const A='12345001',B='12345002',C='12345003',SECRET='BRIDGE_PRIVATE_TOKEN_123456';

test('Node port conflicts read each verified account directory, never a shared fallback',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-node-config-ports-')),files={};
  t.after(()=>{const real=fs.realpathSync(root);assert(real.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  for(const [id,number]of [[A,3001],[B,3002]]){const dir=path.join(root,id,'work','config');fs.mkdirSync(dir,{recursive:true});files[id]=path.join(dir,`onebot11_${id}.json`);fs.writeFileSync(files[id],JSON.stringify({network:{websocketServers:[{name:'agent-arcade',port:number,enable:false}]}}));}
  const runtime={root,instance:id=>({onebotConfigPath:files[id]}),withConfigurationLock:()=>assert.fail('Read-only port inspection')},editor=new QQProfileConfig({runtime});
  const install={installationKind:'managed-node',accounts:[A,B],configDir:path.join(root,'unused'),accountConfigPaths:files};assert.deepEqual([...editor._configuredPorts(install,A,{name:'agent-arcade'})],[3002]);
  assert.throws(()=>editor._configuredPorts({...install,accountConfigPaths:{[A]:files[A],[B]:files[A]}},A,null),{code:'config_invalid'});assert.throws(()=>editor._configuredPorts({...install,accountConfigPaths:undefined},A,null),{code:'config_invalid'});
});
function server(name='agent-arcade',port=3001){return {name,enable:true,host:'127.0.0.1',port,token:SECRET,messagePostFormat:'array',unknownServerValue:{keep:true}};}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-config-')),root=path.join(dir,'app'),desktopDataRoot=path.join(dir,'desktop'),config=path.join(desktopDataRoot,'components','NapCatQQ','config'),runtimeDir=path.dirname(config),qqDir=path.join(desktopDataRoot,'components','QQ');
  fs.mkdirSync(config,{recursive:true});fs.mkdirSync(qqDir,{recursive:true});fs.writeFileSync(path.join(qqDir,'QQ.exe'),'fixture');
  for(const n of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'])fs.writeFileSync(path.join(runtimeDir,n),'fixture');
  const files={};for(const id of [A,B]){files[id]=path.join(config,`onebot11_${id}.json`);fs.writeFileSync(files[id],JSON.stringify({network:{websocketServers:[server('agent-arcade',id===A?3001:3002)],plugins:[{enabled:false,unknown:'keep'}]},unknownTop:{keep:true}},null,1));}
  const state={rows:[{pid:process.pid,parentPid:1,name:'node.exe',executable:process.execPath,createdAt:'2026-11-06T01:00:00Z'}],allocated:[51000],checks:[],started:0};
  const processHost={snapshot:async()=>state.rows,inspect:async pids=>state.rows.filter(p=>pids.includes(p.pid)),start:async()=>{state.started++;throw Error('must not start');}};
  const runtime=new QQRuntimeManager({root,desktopDataRoot,lockRoot:path.join(dir,'locks'),platform:'win32',processHost});
  const profiles=new QQProfileConfig({runtime,checkPort:async p=>{state.checks.push(p);return p||state.allocated.shift()||51001;}});
  t.after(()=>{const resolved=fs.realpathSync(dir);assert(resolved.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,root,desktopDataRoot,config,runtimeDir,qqDir,files,state,runtime,profiles,read:id=>JSON.parse(fs.readFileSync(path.join(config,`onebot11_${id}.json`),'utf8')),write:(id,value)=>fs.writeFileSync(path.join(config,`onebot11_${id}.json`),JSON.stringify(value))};
}

test('list exposes only safe bridge choices while connection keeps its token main-only',async t=>{
  const f=fixture(t),list=await f.profiles.list();assert.deepEqual(list[0],{accountId:A,servers:[{serverName:'agent-arcade',port:3001,enabled:true,loopbackOnly:true,hasToken:true}]});
  assert.doesNotMatch(JSON.stringify(list),/BRIDGE_PRIVATE|unknown|plugins/);assert.deepEqual(f.profiles.connection(A),{accountId:A,serverName:'agent-arcade',url:'ws://127.0.0.1:3001',token:SECRET});assert.equal(f.state.started,0);
});

test('configure updates only the selected bridge, preserving unknown fields and a byte-exact original backup',async t=>{
  const f=fixture(t),before=fs.readFileSync(f.files[A]),originalB=fs.readFileSync(f.files[B]);const result=await f.profiles.configure(A,{port:3101});
  assert.equal(result.created,false);assert.equal(result.backupCreated,true);assert.doesNotMatch(JSON.stringify(result),/BRIDGE_PRIVATE/);
  const saved=f.read(A);assert.equal(saved.network.websocketServers[0].port,3101);assert.equal(saved.network.websocketServers[0].token,SECRET);assert.deepEqual(saved.network.websocketServers[0].unknownServerValue,{keep:true});assert.deepEqual(saved.unknownTop,{keep:true});assert.equal(saved.network.plugins[0].unknown,'keep');assert(fs.readFileSync(f.files[B]).equals(originalB));
  const backups=fs.readdirSync(f.profiles.backupRoot);assert.equal(backups.length,1);assert(fs.readFileSync(path.join(f.profiles.backupRoot,backups[0])).equals(before));assert.equal(f.state.started,0);
});

test('create uses an explicit numeric account and generates a strong token without exposing it in the result',async t=>{
  const f=fixture(t),result=await f.profiles.configure(C,{create:true});assert(result.created);assert(!result.backupCreated);assert.equal(result.servers[0].port,51000);assert.equal(result.servers[0].hasToken,true);
  const secret=f.profiles.connection(C);assert.match(secret.token,/^[a-f0-9]{64}$/);assert(!JSON.stringify(result).includes(secret.token));assert.equal((await f.profiles.list()).length,3);assert.equal(f.state.started,0);
  await assert.rejects(f.profiles.configure(C,{create:true}),{code:'profile_exists'});await assert.rejects(f.profiles.configure('../12345004',{create:true}),{code:'invalid_account'});
});

test('automatic port selection excludes configured disabled servers as well as other accounts',async t=>{
  const f=fixture(t),a=f.read(A);a.network.httpServers=[{port:51000,enable:false}];f.write(A,a);f.state.allocated=[3002,51000,51002];
  const result=await f.profiles.configure(C,{create:true});assert.equal(result.servers[0].port,51002);assert.deepEqual(f.state.checks,[0,0,0]);
  await assert.rejects(f.profiles.configure(A,{port:3002}),{code:'port_conflict'});await assert.rejects(f.profiles.configure(A,{port:51000}),{code:'port_conflict'});
});

test('existing default configuration preserves its port and replaces a missing token',async t=>{
  const f=fixture(t),value=f.read(A);value.network.websocketServers[0].token='';f.write(A,value);
  const result=await f.profiles.configure(A);assert.equal(result.servers[0].port,3001);assert.match(f.profiles.connection(A).token,/^[a-f0-9]{64}$/);assert.deepEqual(f.state.checks,[3001]);
});

test('multiple servers require a selected name and untouched servers remain byte-equivalent as JSON',async t=>{
  const f=fixture(t),value=f.read(A);value.network.websocketServers.push(server('second',3201));f.write(A,value);
  await assert.rejects(f.profiles.configure(A),{code:'server_ambiguous'});assert.throws(()=>f.profiles.connection(A),{code:'server_ambiguous'});
  await f.profiles.configure(A,{serverName:'second',port:3202});assert.deepEqual(f.read(A).network.websocketServers[0],value.network.websocketServers[0]);assert.equal(f.profiles.connection(A,'second').url,'ws://127.0.0.1:3202');
  const duplicate=f.read(A);duplicate.network.websocketServers[1].name='agent-arcade';f.write(A,duplicate);assert.throws(()=>f.profiles.connection(A,'agent-arcade'),{code:'server_ambiguous'});await assert.rejects(f.profiles.configure(A,{serverName:'agent-arcade'}),{code:'server_ambiguous'});
});

test('only one eligible connection may be inferred and remote, disabled or short-token entries are refused',async t=>{
  const f=fixture(t);for(const change of [{host:'localhost'},{host:'0.0.0.0'},{host:'remote.example'},{enable:false},{token:'short'},{port:'3001'}]){f.write(A,{network:{websocketServers:[{...server(),...change}]}});assert.throws(()=>f.profiles.connection(A,'agent-arcade'),{code:'server_invalid'});}
  f.write(A,{network:{websocketServers:[{...server(),host:'::1'},{...server('disabled',3201),enable:false}]}});assert.equal(f.profiles.connection(A).url,'ws://[::1]:3001');assert.throws(()=>f.profiles.connection(A,'missing'),{code:'server_missing'});
});

test('Desktop running and an external runtime block edits while read-only connection import remains available',async t=>{
  const f=fixture(t),original=fs.readFileSync(f.files[A]);f.state.rows.push({pid:900001,parentPid:1,name:'NapCatQQ-Desktop.exe',executable:path.join(f.dir,'NapCatQQ-Desktop.exe'),createdAt:'2026-11-06T01:00:01Z'});
  await assert.rejects(f.profiles.configure(A),{code:'desktop_running'});assert.equal(f.profiles.connection(A).token,SECRET);assert(fs.readFileSync(f.files[A]).equals(original));
  f.state.rows.pop();f.state.rows.push({pid:900002,parentPid:1,name:'NapCatWinBootMain.exe',executable:path.join(f.runtimeDir,'NapCatWinBootMain.exe'),accountId:A,createdAt:'2026-11-06T01:00:02Z'});
  await assert.rejects(f.profiles.configure(A),{code:'external_process'});assert(fs.readFileSync(f.files[A]).equals(original));
});

test('invalid and oversized JSON are shown as a safe per-account issue and never overwritten',async t=>{
  const f=fixture(t);fs.writeFileSync(f.files[A],'SECRET malformed');const list=await f.profiles.list();assert.equal(list[0].issue,'config_invalid');assert.doesNotMatch(JSON.stringify(list),/SECRET/);await assert.rejects(f.profiles.configure(A),{code:'config_invalid'});assert.equal(fs.readFileSync(f.files[A],'utf8'),'SECRET malformed');
  fs.writeFileSync(f.files[A],' '.repeat(MAX_CONFIG_BYTES+1));await assert.rejects(f.profiles.configure(A),{code:'invalid_account'});
});

test('an external edit during asynchronous validation aborts before backup or replacement',async t=>{
  const f=fixture(t);f.profiles.checkPort=async p=>{const value=f.read(A);value.externalEdit=true;f.write(A,value);return p;};
  await assert.rejects(f.profiles.configure(A,{port:3101}),{code:'config_changed'});assert(f.read(A).externalEdit);assert.equal(f.read(A).network.websocketServers[0].port,3001);assert(!fs.existsSync(f.profiles.backupRoot));
});

test('unsafe backup destination aborts the configuration write',async t=>{
  const f=fixture(t),original=fs.readFileSync(f.files[A]);fs.mkdirSync(f.root,{recursive:true});fs.writeFileSync(f.profiles.backupRoot,'not a directory');
  await assert.rejects(f.profiles.configure(A,{port:3101}),{code:'backup_failed'});assert(fs.readFileSync(f.files[A]).equals(original));
});

test('ports already listening are refused by a real loopback socket check without changing a config',async t=>{
  const f=fixture(t),listener=net.createServer();await new Promise(r=>listener.listen({host:'127.0.0.1',port:0},r));t.after(()=>listener.close());const profiles=new QQProfileConfig({runtime:f.runtime}),before=fs.readFileSync(f.files[A]);
  await assert.rejects(profiles.configure(A,{port:listener.address().port}),{code:'port_unavailable'});assert(fs.readFileSync(f.files[A]).equals(before));
});

test('invalid names and port ranges are rejected before saving anything',async t=>{
  const f=fixture(t);for(const value of [0,80,65536,3001.5,'3001'])await assert.rejects(f.profiles.configure(A,{port:value}),{code:'invalid_port'});
  for(const serverName of ['', 'x\nPRIVATE', 'x'.repeat(65)])await assert.rejects(f.profiles.configure(A,{serverName}),{code:'invalid_server_name'});assert.equal(f.read(A).network.websocketServers[0].port,3001);
});
