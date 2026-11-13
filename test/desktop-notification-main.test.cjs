'use strict';
// Actual main module and registered IPC; only providers/window/OS Notification
// are synthetic. No OS preference, model, account or desktop is operated.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{EventEmitter}=require('node:events');
const mainFile=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(mainFile,'utf8'),fromMain=createRequire(mainFile);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};},turn=()=>new Promise(r=>setImmediate(r));
function harness(options={}){
 const handlers=new Map(),appEvents=new Map(),calls=[],notices=[],os={supported:true,fail:'',clockOffset:0};
 class FakeNotification extends EventEmitter{static isSupported(){if(os.fail==='supported')throw Error('synthetic');return os.supported;}constructor(value){super();if(os.fail==='construct')throw Error('synthetic');this.options=value;this.shows=0;this.closes=0;notices.push(this);}show(){if(os.fail==='show')throw Error('synthetic');this.shows++;}close(){this.closes++;this.emit('close');}}
 const service=id=>({config:{mode:'api',channel:'qq'},status:'connected',generation:1,incomingCount:0,socialScope:id+'-qq',dispatcher:{},localEngine:{},localActive:false,localGeneration:0,client:{ready:true,generation:1,socket:{},accountId:id,ownerId:'owner'},socialStore:{config:()=>({characterId:id,enabled:true})},
  socialController(){return this.dispatcher;},async socialReply(){calls.push('channel-reply');return {outcome:'reply_ended'};},async localStart({assertCurrent}){assertCurrent();calls.push('start-'+id);this.localActive=true;this.localGeneration++;},localConversationContext(){if(!this.localActive)throw Error('stopped');return {kind:'local',dispatcher:this.localEngine,scope:id+'-app',character:id,settings:'settings',generation:this.localGeneration};},async localReply(_text,{signal}){calls.push('reply-'+id);await this.gate?.promise;return this.result||{outcome:'reply_ended',text:'PRIVATE_REPLY'};},async localStop(){calls.push('stop-'+id);this.localActive=false;},snapshot(){return {status:this.status,social:{active:true,config:{enabled:true}},local:{state:this.localActive?'active':'stopped',history:[]}};}});
 const a=service('a'),b=service('b'),services=new Map([['a',a],['b',b]]),accounts={selectedId:'a',services,get:id=>services.get(id),snapshot(){return {selectedId:this.selectedId};}};
 const windowState={visible:true,minimized:false,focused:false,destroyed:false,restores:0,shows:0,focuses:0},frame={url:require('node:url').pathToFileURL(path.join(path.dirname(mainFile),'ui/index.html')).href},win={isDestroyed:()=>windowState.destroyed,isVisible:()=>windowState.visible,isMinimized:()=>windowState.minimized,isFocused:()=>windowState.focused,restore(){windowState.restores++;windowState.minimized=false;},show(){windowState.shows++;windowState.visible=true;},focus(){windowState.focuses++;windowState.focused=true;},webContents:{mainFrame:frame,send(){}}};
 const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,AbortSignal,Date:class extends Date{static now(){return Date.now()+os.clockOffset;}},require:id=>{
  if(id==='electron')return {Notification:FakeNotification,app:{requestSingleInstanceLock:()=>false,quit(){},on:(name,fn)=>appEvents.set(name,fn)},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
  if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};return fromMain(id);
 }};
 vm.runInNewContext(source+`\nmodule.exports={desktopChat,desktopConversations,notifyDesktopReply,closeDesktopReplyNotification,publish,setup:(a,m,w)=>{bot=a;accounts=m;win=w;config.notifications=true;config.quiet=false;config.language='zh';},preference:patch=>Object.assign(config,patch),select:s=>{desktopConversations.invalidate();bot=s;},registerAll:()=>registerDesktopChatHandlers(),installVoice:v=>{voice=v;voiceAccount=accounts.selectedId;},notice:()=>desktopReplyNotification};`,context,{filename:mainFile});
 const api=context.module.exports;api.setup(a,accounts,win);api.registerAll();api.preference(options);
 const invoke=(name,value,untrusted=false)=>handlers.get('arcade:'+name)({sender:untrusted?{}:win.webContents,senderFrame:frame},value);
 const choose=kind=>invoke('desktopConversationSelect',{accountId:accounts.selectedId,kind:kind||'local'}),open=()=>invoke('desktopChatOpen',{accountId:accounts.selectedId,contextId:api.desktopChat.snapshot().contextId,panelId:'panel'});
 // Renderer receives an IPC envelope; send only its admitted session fields.
 const submit=(session,requestId='request')=>invoke('desktopChatSend',{sessionId:session.sessionId,contextId:session.contextId,requestId,text:'PRIVATE_PROMPT'});
 return {api,a,b,accounts,windowState,win,calls,notices,os,invoke,choose,open,send:submit};
}
test('registered App reply creates one silent fixed-content notice; channel and forged events cannot',async()=>{
 const h=harness();await h.choose();const s=await h.open();assert.equal((await h.send(s)).outcome,'reply_ended');assert.equal(h.notices.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.notices[0].options)),{title:'Agent Arcade',body:'App 对话有新回复。',silent:true});assert.equal(h.notices[0].shows,1);assert(!JSON.stringify(h.notices[0].options).includes('PRIVATE'));
 h.api.notifyDesktopReply({id:'fake',accountId:'b',character:'b',sourceKind:'local',completedAt:Date.now()});assert.equal(h.notices.length,1);await h.choose('channel');const next=await h.open();await h.send(next);assert.equal(h.notices.length,1);await assert.rejects(h.invoke('desktopChatSend',{},true),/Untrusted/);
});
test('existing preference, quiet, foreground, freshness and platform support suppress the notice',async()=>{
 for(const mode of ['disabled','quiet','focused','expired','unsupported']){const h=harness();if(mode==='disabled')h.api.preference({notifications:false});if(mode==='quiet')h.api.preference({quiet:true});if(mode==='focused')h.windowState.focused=true;if(mode==='expired')h.os.clockOffset=31000;if(mode==='unsupported')h.os.supported=false;await h.choose();const s=await h.open();assert.equal((await h.send(s)).outcome,'reply_ended');assert.equal(h.notices.length,0,mode);}
});
test('same account/character cooldown survives a new request and new session; another scope is independent',async()=>{
 const h=harness();await h.choose();let s=await h.open();await h.send(s,'one');await h.send(s,'two');s=await h.open();await h.send(s,'three');assert.equal(h.notices.length,1);
 h.api.select(h.b);h.accounts.selectedId='b';await h.choose();s=await h.open();await h.send(s,'four');assert.equal(h.notices.length,2);assert.equal(h.notices[0].closes,1);
 h.api.select(h.a);h.accounts.selectedId='a';await h.choose();s=await h.open();await h.send(s,'five');assert.equal(h.notices.length,2);
});
test('cancelled, failed and retired pending turns never produce a completed-reply notice',async()=>{
 for(const mode of ['cancel','failed','scope']){const h=harness();await h.choose();h.a.gate=deferred();const s=await h.open(),pending=h.send(s);await turn();if(mode==='cancel')await h.invoke('desktopChatCancel',{sessionId:s.sessionId,contextId:s.contextId,requestId:'request'});if(mode==='failed')h.a.result={outcome:'error'};if(mode==='scope'){h.accounts.selectedId='b';h.api.select(h.b);}h.a.gate.resolve();const result=await pending;assert(mode==='failed'?result.code==='reply_failed':result.outcome==='cancelled');assert.equal(h.notices.length,0,mode);}
});
test('OS construction/show/failed events cannot corrupt reply success and release owned references',async()=>{
 for(const fail of ['supported','construct','show']){const h=harness();h.os.fail=fail;await h.choose();assert.equal((await h.send(await h.open())).outcome,'reply_ended',fail);assert.equal(h.api.notice(),null);}
 const h=harness();await h.choose();await h.send(await h.open());h.notices[0].emit('failed','synthetic OS failure');assert.equal(h.api.notice(),null);
});
test('click restores only the current window and never switches or stops newer work',async()=>{
 const h=harness();await h.choose();await h.send(await h.open());const notice=h.notices[0];h.api.select(h.b);h.accounts.selectedId='b';await h.choose();const before=h.calls.slice();let closes=0;h.api.installVoice({close:async()=>{closes++;}});h.windowState.minimized=true;h.windowState.visible=false;notice.emit('click');assert.equal(h.windowState.restores,1);assert.equal(h.windowState.shows,1);assert.equal(h.windowState.focuses,1);assert.equal(h.accounts.selectedId,'b');assert.equal(h.api.desktopConversations.kind(),'local');assert.deepEqual(h.calls,before);assert.equal(closes,0);notice.emit('click');assert.equal(h.windowState.shows,1);
});
test('same-scope pending reply survives minimize and notices restore its original view without a new start',async()=>{
 const h=harness();await h.choose();h.a.gate=deferred();const s=await h.open(),pending=h.send(s);await turn();h.windowState.minimized=true;h.windowState.visible=false;h.api.publish();h.a.gate.resolve();assert.equal((await pending).outcome,'reply_ended');assert.equal(h.notices.length,1);const before=h.calls.slice();h.notices[0].emit('click');assert.equal(h.accounts.selectedId,'a');assert.equal(h.api.desktopChat.snapshot().contextId,s.contextId);assert.deepEqual(h.calls,before);h.api.closeDesktopReplyNotification();assert.equal(h.api.notice(),null);
});
