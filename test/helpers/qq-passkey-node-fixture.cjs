'use strict';
const {load}=require('./qq-passkey-production-modules.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {QQRuntimeManager}=load('src/bot/qq-runtime.cjs');
const {QQNodeSelection}=load('src/bot/qq-node-selection.cjs');
const {withNodeCodeGate}=load('src/bot/qq-node-code-gate.cjs');
const {NODE_FILES,RELEASE_ID}=load('src/bot/qq-managed-node-setup.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex'),A='12345001',B='12345002';
const startDeferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
// All files and process observations here are synthetic. The resolver fixture
// is deliberately injected; no package executable, QQ account or native stop runs.
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-node-runtime-')),root=path.join(dir,'home'),store=path.join(dir,'store'),setupId=randomUUID(),installationRoot=path.join(store,'qq-node-installations',setupId),instancesRoot=path.join(installationRoot,'instances'),codeRoot=path.join(store,'qq-component-versions','napcat-node',RELEASE_ID,'code'),manifestPath=path.join(path.dirname(codeRoot),'prepared.json');
  for(const p of [root,instancesRoot,codeRoot])fs.mkdirSync(p,{recursive:true});for(const name of Object.keys(NODE_FILES)){const file=path.join(codeRoot,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic code marker, never executable');}fs.writeFileSync(manifestPath,'synthetic manifest');
  const selected={kind:'prepared',version:'4.18.42',versionId:RELEASE_ID,manifestSha256:hash('synthetic manifest')},descriptor={schema:'qq_managed_node_v1',engine:'managed-node',dataPolicy:'isolated-new',previous:null,setupId,installationRoot,instancesRoot,codeRoot,manifestPath,installationId:hash(installationRoot.toLowerCase()),descriptorSha256:hash('synthetic descriptor'),current:selected,prepared:selected,node:{version:'22.11.0',architecture:'x64',file:'node.exe',...NODE_FILES['node.exe']},qq:{version:'9.9.31-49738'},entry:{file:'index.js',...NODE_FILES['index.js']},native:{}};
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-06T01:00:00.0000000Z',name:'test.exe',executable:process.execPath};
  const state={rows:[self],starts:[],stops:[],next:810000,listeners:[],resolves:0};
  const host={allocatePort:async()=>54000+state.starts.length,snapshot:async()=>structuredClone(state.rows),inspect:async pids=>structuredClone(state.rows.filter(row=>pids.includes(row.pid))),listeners:async()=>structuredClone(state.listeners),start:async plan=>{state.starts.push(plan);const pid=state.next++;state.rows.push({pid,parentPid:process.pid,createdAt:'2026-11-06T02:00:00.0000000Z',name:'node.exe',executable:plan.file});state.rows.push({pid:state.next++,parentPid:pid,createdAt:'2026-11-06T02:00:01.0000000Z',name:'node.exe',executable:plan.file});return {pid};},stop:async(proofs,options)=>{state.stops.push({proofs,options});state.rows=state.rows.filter(row=>!proofs.some(proof=>proof.pid===row.pid));}};
  const prepared={component:'napcat-node',resolvePrepared:async id=>{state.resolves++;assert.equal(id,RELEASE_ID);return {versionId:id,version:'4.18.42',codeRoot,manifestPath,manifestSha256:selected.manifestSha256,files:Object.entries(NODE_FILES).map(([p,v])=>({path:p,...v}))};}};
  const options={root,profileRoot:path.join(dir,'profile'),lockRoot:path.join(dir,'locks'),componentStoreRoot:store,platform:'win32',processHost:host,managedNodeInstallation:()=>structuredClone(descriptor),componentSelectionFactory:opts=>new QQNodeSelection({...opts,prepared})};
  const manager=new QQRuntimeManager(options);
  const configure=async(id,which=manager)=>which.withConfigurationLock(id,{create:true},async install=>{await install.assertStopped();fs.writeFileSync(install.onebotConfigPath,JSON.stringify({network:{websocketServers:[]}}),{flag:'wx'});return {configured:true};});
  t.after(()=>{const real=fs.realpathSync(dir);assert(real.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  return {dir,root,store,descriptor,codeRoot,instancesRoot,state,host,options,manager,configure,prepared};
}


module.exports={fixture,A,B};
