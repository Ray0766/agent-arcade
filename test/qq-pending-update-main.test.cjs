'use strict';
// Real main and its exact IPC/lifecycle callbacks; inert app/account services.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const MAIN=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(MAIN,'utf8'),fromMain=createRequire(MAIN);
function fixture(){
 const handlers=new Map(),events=new Map(),calls=[];let liveTicket=true;
 const components={snapshot:()=>({}),execute(value){calls.push(value.action);if(value.action==='pending-dismiss')liveTicket=false;return Promise.resolve({cancelRequested:true});}};
 const bot={config:{mode:'api',channel:'qq'},status:'disconnected',snapshot:()=>({social:{active:false,config:{enabled:false}}})};
 const accounts={selectedId:'first',get:id=>{if(!['first','second'].includes(id))throw Error('invalid account');return bot;},select(id){assert.equal(liveTicket,false,'The old pending ticket must be revoked before account selection');this.selectedId=id;return bot;},snapshot:()=>({selectedId:accounts.selectedId,accounts:[]})};
 const win={id:1,isDestroyed:()=>false,webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(){}},on(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);}};
 const electron={app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle(name,fn){handlers.set(name,fn);}}};
 class Panel{observe(){}async close(){return {closed:true};}async closeCurrent(){return {closed:true};}}
 class Renderer{get busy(){return false;}async cancel(){return {cancelled:true};}}
 const context={__dirname:path.dirname(MAIN),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,
  require:id=>id==='electron'?electron:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./core/integration.cjs'?{installed:()=>false}:id==='./voice/qq-render.cjs'?{QQVoiceRenderer:Renderer}:id==='./bot/qq-owner-remark-panel.cjs'?{QQOwnerRemarkPanel:Panel}:id==='./bot/qq-friend-requests-panel.cjs'?{QQFriendRequestsPanel:Panel}:id==='./bot/qq-first-setup-panel.cjs'?{QQFirstSetupPanel:Panel}:fromMain(id)};
 const lines=source.split('\n'),required=["const qqResult=", "register('qqComponents'", "register('accountSelect'"].map(text=>{const line=lines.find(s=>s.includes(text));if(!line)throw Error('Main registration missing');return line;});
 const lifecycle=lines.find(s=>s.includes("for(const event of ['hide','minimize'])")&&s.includes('dismissPendingUpdate'));if(!lifecycle)throw Error('Main lifecycle binding missing');
 vm.runInNewContext(source+`\nmodule.exports={setup:(a,b,w,c)=>{accounts=a;bot=b;win=w;qqComponents=c;${required.join('\n')}\n${lifecycle}},dismissPendingUpdate};`,context,{filename:MAIN});
 context.module.exports.setup(accounts,bot,win,components);
 const ev={sender:win.webContents,senderFrame:win.webContents.mainFrame},invoke=(name,value,event=ev)=>handlers.get('arcade:'+name)(event,value);
 return {calls,accounts,win,events,ev,invoke,ticket:()=>liveTicket};
}

test('pending recovery uses the existing main-only component IPC without a renderer path gateway',async()=>{
 const f=fixture();const out=await f.invoke('qqComponents',{action:'pending-list'});assert.equal(out.ok,true);assert.deepEqual(f.calls,['pending-list']);
 for(const event of [{...f.ev,sender:{}},{...f.ev,senderFrame:{}},{...f.ev,senderFrame:{...f.ev.senderFrame,url:'https://other.invalid'}}])await assert.rejects(f.invoke('qqComponents',{action:'pending-confirm'},event),/Untrusted sender/);assert.deepEqual(f.calls,['pending-list']);
});

test('minimize and hide synchronously revoke only the pending-update operation',()=>{
 for(const event of ['hide','minimize']){const f=fixture();for(const action of f.events.get(event))action();assert.equal(f.ticket(),false);assert.deepEqual(f.calls,['pending-dismiss']);}
});

test('selecting another valid companion revokes a pending update before publishing the new selection',async()=>{
 const f=fixture();await f.invoke('accountSelect','second');assert.equal(f.accounts.selectedId,'second');assert.equal(f.ticket(),false);assert.deepEqual(f.calls,['pending-dismiss']);
});

test('an invalid or untrusted companion change does not revoke someone else’s pending operation',async()=>{
 const f=fixture();await assert.rejects(f.invoke('accountSelect','absent'),/invalid account/);await assert.rejects(f.invoke('accountSelect','second',{...f.ev,sender:{}}),/Untrusted sender/);assert.equal(f.ticket(),true);assert.deepEqual(f.calls,[]);
});
