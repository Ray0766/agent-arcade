'use strict';
// Actual main IPC in an isolated profile. Only Electron and the remote client
// boundary are injectable; no existing account, credential or QQ is accessed.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const MAIN=path.resolve(__dirname,'../../src/main.cjs'),fromMain=createRequire(MAIN);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',QQ='1000001';
const hold=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
async function until(fn){const end=Date.now()+4000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw Error('Fixture deadline exceeded');}
function fixture(t,{clientFactory}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-supervisor-main-'));
  const handlers=new Map(),events={},state={visible:true,minimized:false,picker:null,picks:0,network:0};
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).map(b=>b^0x5a),decryptString:b=>Buffer.from(b).map(v=>v^0x5a).toString()};
  const services=new Map([['first',{generation:1}],['second',{generation:1}]]);
  for(const service of services.values())Object.defineProperty(service,'secret',{get(){throw Error('Supervisor may not inspect model credentials');}});
  const accounts={selectedId:'first',get(id){if(!services.has(id))throw Error('Missing fixture service');return services.get(id);},snapshot:()=>({accounts:[]})};
  const win={id:1,isDestroyed:()=>false,isVisible:()=>state.visible,isMinimized:()=>state.minimized,on:(key,fn)=>events[key]=fn,webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../../src/ui/index.html')).href},send(){}}};
  const supervisorModule=require('../../src/bot/qq-supervisor-panel.cjs');
  class BoundPanel extends supervisorModule.QQSupervisorPanel{
    constructor(options){super({...options,clientFactory:entry=>{state.network++;if(!clientFactory)throw Error('Unexpected network use');return clientFactory(entry);}});}
  }
  const context={__dirname:path.dirname(MAIN),module:{exports:{}},process:{argv:[],env:{AGENT_ARCADE_HOME:root,LOCALAPPDATA:root}},URL,Buffer,AbortController,structuredClone,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},safeStorage:vault,ipcMain:{handle(name,fn){handlers.set(name,fn);}},dialog:{async showOpenDialog(){state.picks++;return state.picker?state.picker.promise:{canceled:true,filePaths:[]};}}}
      :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}
      :id==='./bot/qq-supervisor-panel.cjs'?{...supervisorModule,QQSupervisorPanel:BoundPanel}:fromMain(id)};
  const source=fs.readFileSync(MAIN,'utf8'),hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closeRemoteManagement'));
  vm.runInNewContext(source+`\nmodule.exports={setup:(a,w)=>{accounts=a;win=w;initializeRemoteManagement();${hide}},registerRemoteHandlers,closeRemoteManagement,fullSnapshot,supervisor:()=>supervisorPanel,remote:()=>remotePanel,observe:()=>supervisorPanel.observe()};`,context,{filename:MAIN});
  const api=context.module.exports;api.setup(accounts,win);api.registerRemoteHandlers();
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  const invoke=(name,value,ev=event)=>handlers.get('arcade:'+name)(ev,structuredClone(value));
  t.after(async()=>{state.picker?.resolve({canceled:true,filePaths:[]});await api.closeRemoteManagement({permanent:true});const resolved=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());if(!resolved.startsWith(base+path.sep)||!path.basename(resolved).startsWith('arcade-supervisor-main-'))throw Error('Unexpected fixture directory');fs.rmSync(resolved,{recursive:true,force:true});});
  return {root,handlers,events,state,accounts,win,event,api,invoke};
}
async function add(f){
  const listed=await f.invoke('qqRemoteList',{panelId:PANEL});if(!listed.ok)throw Error('Remote parent failed');
  const out=await f.invoke('qqRemoteCreate',{panelId:PANEL,value:{label:'Synthetic remote QQ',origin:'https://remote.arcade.invalid',expectedQQ:QQ,token:'synthetic-webui-never-reused',trust:{},associatedProfileId:null}});
  if(!out.ok)throw Error('Remote registration failed');return {...out.registration,panelId:PANEL};
}
const base=row=>({remoteId:row.remoteId,panelId:row.panelId});
module.exports={fixture,add,base,hold,until,PANEL,QQ};
