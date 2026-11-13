'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),sourceRoot=process.env.ARCADE_DESKTOP_CHAT_ROOT||root,mainFile=path.join(sourceRoot,'src/main.cjs'),source=fs.readFileSync(mainFile,'utf8'),fromMain=createRequire(path.join(root,'src/main.cjs'));
function mainHarness({capabilityProbe}={}){
  const handlers=new Map(),sent=[],voices=[],sends=[];
  const service=id=>({config:{mode:'api',channel:'qq'},status:'connected',generation:1,incomingCount:0,socialScope:`${id}-owner-scope`,client:{ready:true,generation:1,socket:{},accountId:id,ownerId:'owner'},dispatcher:{},socialStore:{config:()=>({characterId:id,enabled:true})},
    socialController(){if(this.status!=='connected')throw Error('unavailable');return this.dispatcher;},async socialReply(text,opts){sends.push({id,text,...opts});return {outcome:'reply_ended'};},snapshot(){return {social:{active:true,config:{enabled:true}},status:this.status};}});
  const a=service('a'),b=service('b'),accounts={selectedId:'a',snapshot(){return {selectedId:this.selectedId};}},windowState={visible:true,minimized:false},frame={url:require('node:url').pathToFileURL(path.join(path.dirname(mainFile),'ui/index.html')).href},win={isDestroyed:()=>false,isVisible:()=>windowState.visible,isMinimized:()=>windowState.minimized,webContents:{mainFrame:frame,send:(_channel,state)=>sent.push(state)}};
  const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,AbortSignal,require:id=>{
    if(id==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
    if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};
    if(id==='./voice/runtime.cjs'&&capabilityProbe)return {...fromMain(id),voiceCapabilities:capabilityProbe};
    return fromMain(id);
  }};
  vm.runInNewContext(source+`\nmodule.exports={checkVoiceCapabilities,desktopChat,desktopChatContext,registerDesktopChatHandlers,publish,setup:(a,m,w)=>{bot=a;accounts=m;win=w;},select:a=>{bot=a;},installVoice:(a,v)=>{voiceAccount=a;voice=v;voicePanel='voice-panel';voiceWatch={bot,scope:bot.socialScope,generation:bot.generation,incomingCount:bot.incomingCount};},pendingVoice:a=>{voiceAccount=a;voiceWatch=null;},voiceEpoch:()=>voiceEpoch,registerDummy:()=>register('voiceStart',()=>({started:true}))};`,context,{filename:mainFile});
  const api=context.module.exports;api.setup(a,accounts,win);api.registerDesktopChatHandlers();
  const invoke=(name,value,untrusted=false)=>handlers.get(`arcade:${name}`)({sender:untrusted?{}:win.webContents,senderFrame:frame},value);
  return {api,a,b,accounts,win,windowState,sends,invoke,open:()=>invoke('desktopChatOpen',{accountId:accounts.selectedId,contextId:api.desktopChat.snapshot().contextId,panelId:'text-panel'})};
}
module.exports={mainHarness};
