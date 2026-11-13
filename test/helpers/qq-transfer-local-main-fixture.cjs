'use strict';
// Actual main IPC with fresh local SQLite/vault and inert remote clients only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const MAIN=path.resolve(__dirname,'../../src/main.cjs'),SOURCE=fs.readFileSync(MAIN,'utf8'),fromMain=createRequire(MAIN);
const remoteModule=require('../../src/bot/qq-remote-session.cjs'),transferModule=require('../../src/bot/qq-transfer-session.cjs');
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',LOCAL='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hold=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-transfer-local-main-')),handlers=new Map(),events={};
 const state={visible:true,minimized:false,network:0,pickers:0};
 const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(b=>b^0x5a),decryptString:value=>Buffer.from(value).map(b=>b^0x5a).toString()};
 const never=()=>{state.network++;throw Error('PRIVATE_NETWORK_CANARY');};
 class Remote extends remoteModule.QQRemoteSession{constructor(options){super({...options,clientFactory:never});}}
 class Transfer extends transferModule.QQTransferSession{constructor(options){super({...options,clientFactory:never});}}
 const accounts={selectedId:'first',get(){throw Error('Must not inspect companion credentials');},snapshot:()=>({accounts:[]})};
 const win={id:1,isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>false,on:(name,fn)=>events[name]=fn,
  webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../../src/ui/index.html')).href},send(){}}};
 const context={__dirname:path.dirname(MAIN),module:{exports:{}},process:{argv:[],env:{AGENT_ARCADE_HOME:root,LOCALAPPDATA:root}},Buffer,URL,structuredClone,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},safeStorage:vault,ipcMain:{handle(name,fn){handlers.set(name,fn);}},dialog:{showOpenDialog(){state.pickers++;throw Error('No picker');}}}:
   id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:
   id==='./bot/qq-remote-session.cjs'?{...remoteModule,QQRemoteSession:Remote}:
   id==='./bot/qq-transfer-session.cjs'?{...transferModule,QQTransferSession:Transfer}:fromMain(id)};
 const hide=SOURCE.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closeRemoteManagement'));
 vm.runInNewContext(SOURCE+`\nmodule.exports={setup:(a,w)=>{accounts=a;win=w;initializeRemoteManagement();${hide}},registerRemoteHandlers,closeRemoteManagement,fullSnapshot,observe:()=>transferLocal.observe(),local:()=>transferLocal,jobs:()=>transferJobs,remote:()=>remotePanel,transfer:()=>transferPanel,describe:scope=>describeTransferLocalBinding(scope,remotePanel.registry,transferPanel.links)};`,context,{filename:MAIN});
 const api=context.module.exports;api.setup(accounts,win);api.registerRemoteHandlers();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const invoke=(name,value={panelId:PANEL,localId:LOCAL},ev=event)=>handlers.get('arcade:qqTransferLocal'+name)(ev,value);
 const remote=(name,value={panelId:PANEL})=>handlers.get('arcade:qqRemote'+name)(event,value);
 t.after(async()=>{await api.closeRemoteManagement({permanent:true});const target=path.resolve(root);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected fixture root');fs.rmSync(target,{recursive:true,force:true});});
 return {root,api,state,accounts,win,handlers,events,event,invoke,remote};
}
async function open(f){const parent=await f.remote('List');if(!parent.ok)throw Error(JSON.stringify(parent));return f.invoke('List');}
function job(f,{state='reconcile_required',cleanupPending=true,...patch}={}){
 const source=path.join(f.root,'PRIVATE_SOURCE_CANARY'),target=path.join(f.root,'PRIVATE_TARGET_CANARY');
 fs.writeFileSync(source,'source retained');fs.writeFileSync(target,'target retained');
 const jobs=f.api.jobs(),priorNow=jobs.now;const createdAt=Date.now()-60000;jobs.now=()=>createdAt;
 try{return jobs.create({jobId:randomUUID(),kind:'download',name:'retained-result.txt',state,scope:{remoteId:randomUUID(),remoteRevision:randomUUID(),helperId:randomUUID(),helperRevision:randomUUID(),origin:'https://private-helper.invalid',instanceId:randomUUID(),rootId:'shared',trustRevision:randomUUID(),credentialRevision:randomUUID()},totalBytes:10,completedBytes:3,sha256:null,archive:false,published:null,saved:null,cleanupPending,source:{source},target:{target},remote:null,pending:{kind:'publish',operationId:randomUUID(),from:3,to:3,state:'attempted'},expiresAt:Date.now()-1,code:'transfer_unknown',...patch});}finally{jobs.now=priorNow;}
}
module.exports={fixture,open,job,hold,tick,PANEL,LOCAL};
