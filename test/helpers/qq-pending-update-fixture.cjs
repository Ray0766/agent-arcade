'use strict';
// Synthetic code/process metadata only; no native executable or real QQ data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {QQComponentSelection}=require('../../src/bot/qq-component-selection.cjs');
const {QQNodeSelection}=require('../../src/bot/qq-node-selection.cjs');
const {QQPendingUpdateRecovery}=require('../../src/bot/qq-pending-update-recovery.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,{node=false,io=fs}={}){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-pending-update-')),store=path.join(base,'store'),componentsRoot=path.join(base,'components'),lockRoot=path.join(base,'locks'),engine=node?'napcat-node':'napcat-shell',versionId=`${engine}-4.18.42-${node?'77397ac38d66f463':'0123456789abcdef'}`,preparedRoot=path.join(store,'qq-component-versions',engine),codeRoot=path.join(preparedRoot,versionId,'code'),manifestPath=path.join(path.dirname(codeRoot),'prepared.json'),workDir=path.join(componentsRoot,'NapCatQQ'),qqExe=path.join(componentsRoot,'QQ','QQ.exe');
  for(const dir of [codeRoot,lockRoot,path.join(workDir,'config'),path.dirname(qqExe)])fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(qqExe,'SYNTHETIC QQ PROGRAM');
  const content=node?{'node.exe':'SYNTHETIC NODE','index.js':'SYNTHETIC ENTRY','napcat/napcat.mjs':'SYNTHETIC CORE'}:{'NapCatWinBootMain.exe':'SYNTHETIC BOOT','NapCatWinBootHook.dll':'SYNTHETIC HOOK','napcat.mjs':'SYNTHETIC CORE','qqnt.json':'{}','static/index.html':'SYNTHETIC UI'};
  const files=Object.entries(content).map(([name,text])=>{const file=path.join(codeRoot,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);if(!node){const original=path.join(workDir,...name.split('/'));fs.mkdirSync(path.dirname(original),{recursive:true});fs.writeFileSync(original,text);}return {path:name,size:Buffer.byteLength(text),sha256:hash(text)};}).sort((a,b)=>a.path.localeCompare(b.path));
  fs.writeFileSync(manifestPath,JSON.stringify({schema:'qq_component_prepared_v1',component:engine,version:'4.18.42',versionId,files}));
  const manifestSha256=hash(fs.readFileSync(manifestPath)),current={kind:'prepared',version:'4.18.42',versionId,manifestSha256};
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-06T01:00:00.0000000Z',name:'test.exe',executable:process.execPath},state={rows:[self],verifications:0,onVerify:null,onSnapshot:null,mono:0,now:1793920000000};
  const host={snapshot:async()=>{await state.onSnapshot?.();return structuredClone(state.rows);},inspect:async ids=>structuredClone(state.rows.filter(p=>ids.includes(p.pid)))};
  const prepared={component:engine,resolvePrepared:async id=>{assert.equal(id,versionId);state.verifications++;await state.onVerify?.();if(hash(fs.readFileSync(manifestPath))!==manifestSha256)throw Object.assign(Error('synthetic'),{code:'prepared_invalid'});for(const row of files)if(hash(fs.readFileSync(path.join(codeRoot,...row.path.split('/'))))!==row.sha256)throw Object.assign(Error('synthetic'),{code:'component_changed'});return {versionId,version:'4.18.42',manifestSha256,manifestPath,codeRoot,files};}};
  let selection,descriptor,configDirs;
  if(node){const installationRoot=path.join(store,'qq-node-installations',randomUUID()),instancesRoot=path.join(installationRoot,'instances');fs.mkdirSync(instancesRoot,{recursive:true});configDirs=['synthetic-a','synthetic-b'].map(id=>{const config=path.join(instancesRoot,hash(id),'work','config');fs.mkdirSync(config,{recursive:true});return config;});descriptor={installationRoot,instancesRoot,codeRoot,manifestPath,installationId:hash(installationRoot.toLowerCase()),descriptorSha256:hash('synthetic descriptor'),current,node:{sha256:files.find(r=>r.path==='node.exe').sha256},entry:{sha256:files.find(r=>r.path==='index.js').sha256}};selection=new QQNodeSelection({root:store,read:()=>structuredClone(descriptor),lockRoot,processHost:host,prepared});}
  else{configDirs=[path.join(workDir,'config')];selection=new QQComponentSelection({componentsRoot,lockRoot,preparedRoot,prepared,processHost:host,qqExe});}
  const recovery=new QQPendingUpdateRecovery({selection,io,now:()=>state.now,monotonic:()=>state.mono});
  const activate=async()=>{if(!node)await selection.activate({versionId,expectedDigest:(await selection.preview({versionId})).digest});state.verifications=0;};
  const marker=(index=0,bytes=Buffer.from('NOT JSON: SYNTHETIC_PLAN_SECRET_DO_NOT_EXPOSE'))=>{const file=path.join(configDirs[index],'napcat-update.json');fs.writeFileSync(file,bytes);return file;};
  const makeRecovery=options=>new QQPendingUpdateRecovery({selection,now:()=>state.now,monotonic:()=>state.mono,...options});
  t.after(()=>{recovery.close();const real=fs.realpathSync(base),parent=fs.realpathSync(os.tmpdir());assert(real.toLowerCase().startsWith(parent.toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  return {base,store,componentsRoot,workDir,lockRoot,qqExe,codeRoot,manifestPath,configDirs,selection,descriptor,host,state,recovery,activate,marker,makeRecovery,hash};
}
module.exports={fixture,hash};
