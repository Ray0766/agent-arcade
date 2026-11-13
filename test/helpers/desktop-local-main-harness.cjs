'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const mainFile=path.resolve(__dirname,'../../src/main.cjs');
const source=fs.readFileSync(mainFile,'utf8'),fromMain=createRequire(mainFile);

// Execute the actual main module and actual registered IPC handlers. Services,
// provider responses and speech objects are synthetic: no model/channel/host.
function localMainHarness({asrCleanup,capabilities,imagePicker,imageRead,imagePrepare}={}){
  const handlers=new Map(),appEvents=new Map(),sent=[],calls=[],runtimes=[],quits=[];
  const service=id=>({
    config:{mode:'api',channel:'qq'},status:'connected',generation:1,incomingCount:0,
    socialScope:`${id}-qq-scope`,client:{ready:true,generation:1,socket:{},accountId:id,ownerId:'owner'},
    dispatcher:{},localEngine:{},localActive:false,localGeneration:0,
    socialStore:{config:()=>({characterId:id,enabled:true})},
    socialController(){if(this.status!=='connected')throw Error('channel unavailable');return this.dispatcher;},
    async socialReply(text,options){calls.push({kind:'channel',id,text,options});return {outcome:'reply_ended'};},
    async localStart({assertCurrent}){assertCurrent();calls.push({kind:'start',id});await this.startGate?.promise;assertCurrent();this.localActive=true;this.localGeneration++;},
    localConversationContext(){if(!this.localActive)throw Error('local unavailable');return {kind:'local',dispatcher:this.localEngine,scope:`${id}-local-scope`,character:id,settings:'local-character',generation:this.localGeneration};},
    async localReply(text,options){calls.push({kind:'local',id,text,options});await this.replyGate?.promise;return {outcome:'reply_ended'};},
    async localStop(){calls.push({kind:'stop',id});this.localActive=false;},
    assertLocalStopped(){if(this.localActive)throw Error('local stopping');},
    snapshot(){return {status:this.status,social:{active:this.status==='connected',config:{enabled:true,name:id}},local:{state:this.localActive?'active':'stopped',history:[]}};}
  });
  const a=service('a'),b=service('b'),services=new Map([['a',a],['b',b]]);
  const accounts={selectedId:'a',services,get:id=>{if(!services.has(id))throw Error('unknown account');return services.get(id);},select(id){const item=this.get(id);this.selectedId=id;return item;},snapshot(){return {selectedId:this.selectedId};},close:()=>Promise.allSettled([...services.values()].map(service=>service.localStop()))};
  const windowState={visible:true,minimized:false},frame={url:require('node:url').pathToFileURL(path.join(path.dirname(mainFile),'ui/index.html')).href};
  const win={isDestroyed:()=>false,isVisible:()=>windowState.visible,isMinimized:()=>windowState.minimized,show(){windowState.visible=true;},focus(){},webContents:{mainFrame:frame,send:(_channel,state)=>sent.push(state)}};
  const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,AbortSignal,
    require:id=>{
      if(id==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){quits.push(true);},on:(name,fn)=>appEvents.set(name,fn)},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showOpenDialog:imagePicker||(()=>{throw Error('A file picker must not open in this test.');})},nativeImage:{}};
      if(id==='./bot/qq-media.cjs'&&(imageRead||imagePrepare))return {...fromMain(id),...(imageRead?{readSelected:imageRead}:{}),...(imagePrepare?{canonicalImage:imagePrepare}:{})};
      if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};
      if(id==='./voice/asr-gate.cjs'&&asrCleanup){const Base=fromMain(id).AsrGate;return {AsrGate:class extends Base{async retryCleanup(){await asrCleanup;return super.retryCleanup();}}};}
      if(id==='./voice/runtime.cjs')return {createVoiceRuntime(options){runtimes.push(options);throw Error('A voice host must not start in this test.');},voiceCapabilities:capabilities||(async()=>{throw Error('Devices must not be checked.');})};
      return fromMain(id);
    }};
  const registrations=['accountSelect','voiceStart','voiceCapabilities'].map(name=>{
    const rows=source.split(/\r?\n/).filter(line=>line.trim().startsWith(`register('${name}',`));
    if(rows.length!==1)throw Error(`Expected one actual ${name} handler.`);return rows[0];
  }).join('\n');
  vm.runInNewContext(source+`\nmodule.exports={desktopChat,desktopConversations,desktopChatContext,publish,fullSnapshot,
    setup:(a,m,w)=>{bot=a;accounts=m;win=w;},registerAll:()=>{registerDesktopChatHandlers();${registrations}},
    installVoice:(accountId,value,source)=>{voiceAccount=accountId;voice=value;voiceOwnerSource=source||null;if(value&&source)value.source=source;voicePanel='voice-panel';voiceWatch={bot:accounts.get(accountId),scope:accounts.get(accountId).socialScope,generation:1,incomingCount:0,...source};},
    installMedia:(accountId,close)=>{voiceMediaPanel={accountId,controller:new AbortController(),service:{resetVoices:close}};},
    voiceState:()=>({voice,voiceAccount,voiceEpoch}),shutdownState:()=>({task:shutdownTask,cleanedUp,quitting,problem})};`,context,{filename:mainFile});
  const api=context.module.exports;api.setup(a,accounts,win);api.registerAll();quits.length=0;
  const invoke=(name,value,{untrusted=false}={})=>handlers.get(`arcade:${name}`)({sender:untrusted?{}:win.webContents,senderFrame:frame},value);
  return {api,a,b,accounts,windowState,win,calls,runtimes,sent,quits,invoke,
    quit:async()=>{let prevented=0;appEvents.get('before-quit')({preventDefault(){prevented++;}});await api.shutdownState().task;return {prevented,...api.shutdownState()};},
    choose:(kind='local',accountId=accounts.selectedId)=>invoke('desktopConversationSelect',{accountId,kind}),
    open:()=>invoke('desktopChatOpen',{accountId:accounts.selectedId,contextId:api.desktopChat.snapshot().contextId,panelId:'text-panel'}),
    send:(session,requestId='reply')=>invoke('desktopChatSend',{sessionId:session.sessionId,contextId:session.contextId,requestId,text:'合成的本地文字问题'})};
}
module.exports={localMainHarness,mainFile};
