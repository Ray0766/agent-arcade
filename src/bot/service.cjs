'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {atomicJSON,readJSON}=require('../core/files.cjs');
const {Dispatcher}=require('./dispatcher.cjs');
const {WeixinClient,prepareInbound}=require('./weixin.cjs');
const {MessageJournal}=require('./journal.cjs');
const {SocialStore}=require('./social-store.cjs');
const {LocalCompanion}=require('./local-companion.cjs');
const {GroupDispatcher}=require('./group-dispatcher.cjs');
const {CompanionNotifier}=require('./companion-notifier.cjs');
const {scope:manualQQScope}=require('./manual-qq-receipts.cjs');
const {SocialCompanion,SUPPORTED_MODES,scopeFor}=require('./social-companion.cjs');
const {createRunner}=require('./runner.cjs');
const {createCodexRunner}=require('./codex-runner.cjs');
const {createClaudeProgramRunner}=require('./claude-program-runner.cjs');
const {createDeepSeekRunner}=require('./deepseek-runner.cjs');
const {createGPTRunner,DEFAULT_MODEL:DEFAULT_GPT_MODEL,MODELS:GPT_MODELS}=require('./gpt-runner.cjs');
const {createGeminiRunner,DEFAULT_MODEL:DEFAULT_GEMINI_MODEL,MODELS:GEMINI_MODELS}=require('./gemini-runner.cjs');
const {createDoubaoRunner,DEFAULT_MODEL:DEFAULT_DOUBAO_MODEL,MODELS:DOUBAO_MODELS}=require('./doubao-runner.cjs');
const {FeishuClient,validateFeishuAppId,validateFeishuOwner,prepareFeishuInbound,feishuConnectionProblem}=require('./feishu.cjs');
const {XDirectMessageClient,prepareXInbound}=require('./x-dm.cjs');
const XPolicy=require('./x-channel-policy.cjs');
const {MessengerClient,prepareMessengerInbound}=require('./messenger.cjs');
const MessengerPolicy=require('./messenger-channel-policy.cjs');
const {QQClient,validateQQUrl,validateQQOwner,prepareQQInbound}=require('./qq.cjs');
const {napCatConnection,qqIssue}=require('./qq-setup.cjs');
const {NativeBroker}=require('./native-broker.cjs');
const {QQMediaError}=require('./qq-media.cjs');
const {QQVoiceError}=require('./qq-voice-payload.cjs');
const {OwnerImageReader}=require('./qq-inbound-image.cjs');
const {CompanionImageError,capability:imageCapability}=require('./companion-image.cjs');
const {FriendRequestInbox}=require('./qq-friend-requests.cjs');
const {personaForBackend}=require('../core/personas.cjs');
const {isControlText}=require('./commands.cjs');
function pause(ms,signal){return new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}
const API_KEY_SLOT={api:'key',native:'key',deepseek:'deepseekKey',gpt:'openaiKey',gemini:'geminiKey',doubao:'doubaoKey'};
const API_MODELS={gpt:{default:DEFAULT_GPT_MODEL,models:GPT_MODELS},gemini:{default:DEFAULT_GEMINI_MODEL,models:GEMINI_MODELS},doubao:{default:DEFAULT_DOUBAO_MODEL,models:DOUBAO_MODELS}};
const LOCKED_CREDENTIALS='Saved credentials are locked in this app profile. The existing vault was preserved. Restore access or explicitly forget these credentials before replacing them.';
function qqConnectionProblem(code,{retrying=false,exhausted=false}={}){
  if(code==='account_mismatch')return '桥接当前登录的 QQ 与这位搭档绑定的账号不一致，已停止连接。请核对 QQ 账号和桥接地址，再点击“连接”。';
  if(code==='login_required')return 'QQ 报告当前登录已失效。请本人在 NapCat 完成重新登录，再点击“连接”；应用不会重启或退出 QQ。';
  if(code==='account_offline')return retrying?'QQ 当前离线，正在等待 NapCat 恢复并重新检查。仅当 NapCat 显示待扫码时才需本人登录。':'QQ 当前离线，自动连接已暂停。请在 NapCat 核对状态，恢复后点击“连接”；仅显示待扫码时才需本人登录。';
  if(code==='status_unverified')return retrying?'尚未核实 QQ 在线状态，正在重新检查本机桥接。':'尚未核实 QQ 在线状态，未启动消息接收。请检查 NapCat 的 Universal（API + events）连接，再点击“连接”。';
  if(exhausted)return '本机 QQ 桥接连接仍未恢复，已暂停自动重连。请检查 NapCat 和本机连接地址，再点击“连接”。';
  if(retrying)return '本机 QQ 桥接连接中断，正在自动重连；任务记录保留，不会自动重发。';
  if(code==='bridge_unhealthy')return '本机 QQ 桥接状态异常。请检查 NapCat，恢复后点击“连接”。';
  return qqIssue(code);
}
const MAX_VAULT_BYTES=64000;
const vaultFingerprint=bytes=>createHash('sha256').update(bytes).digest('hex');
function vaultBytes(file){if(fs.statSync(file).size>MAX_VAULT_BYTES)throw Error('Credential vault is too large.');return fs.readFileSync(file);}

// Electron's OS-backed vault is deliberately injected. No plaintext fallback.
class BotService {
  constructor({root,vault,vaultFile,onChange=()=>{},claimIdentity=()=>()=>{},clientFactory=opts=>new WeixinClient(opts),qqClientFactory=opts=>new QQClient(opts),feishuClientFactory=opts=>new FeishuClient(opts),xClientFactory=opts=>new XDirectMessageClient(opts),xRateBudgetFor=XPolicy.sharedRateBudget,messengerClientFactory=opts=>new MessengerClient(opts),runnerFactory=createRunner,codexRunnerFactory=createCodexRunner,claudeProgramRunnerFactory=createClaudeProgramRunner,deepseekRunnerFactory=createDeepSeekRunner,gptRunnerFactory=createGPTRunner,geminiRunnerFactory=createGeminiRunner,doubaoRunnerFactory=createDoubaoRunner,nativeFactory,nativeProcessFactory,qrEncoder,imageFactory,voiceFactory,inboundImageReaderFactory=()=>new OwnerImageReader(),inboundImagePrepare,inboundVoiceFactory,inboundVoiceAvailability=()=>({available:false}),journalFactory=opts=>new MessageJournal(opts),personaOptions=()=>({enabled:true,selection:'default'}),characterLibrary=null,lorebookLibrary=null,regexLibrary=null,groupLibrary=null,groupRandom=Math.random,dispatcherFetch=globalThis.fetch,knowledgeNow=Date.now}) {
    // Group dispatcher scorer transport and the clock of the wiki / reflection features (injectable for tests).
    this.dispatcherFetch=dispatcherFetch;this.knowledgeNow=knowledgeNow;this.groupDispatcherState=null;
    // Optional shared libraries for the App conversation's imported characters
    // (see local-companion.cjs). Absent: that feature reports 'unavailable'.
    this.characterLibrary=characterLibrary;this.lorebookLibrary=lorebookLibrary;
    // Optional shared regex-script library (st/regex-library.cjs). Absent: no script is applied.
    this.regexLibrary=regexLibrary&&typeof regexLibrary.list==='function'?regexLibrary:null;
    // Optional shared group-chat library (st/group-library.cjs). Absent: groups are unavailable.
    // groupRandom drives speaker selection (injectable for tests).
    this.groupLibrary=groupLibrary&&typeof groupLibrary.get==='function'?groupLibrary:null;this.groupRandom=groupRandom;
    if(typeof personaOptions!=='function')throw Error('Persona options must be supplied by the application.');
    if(vaultFile!==undefined&&(typeof vaultFile!=='string'||!path.isAbsolute(vaultFile)))throw Error('The application must provide an absolute credential vault path.');
    if(imageFactory!==undefined&&typeof imageFactory!=='function')throw new QQMediaError('invalid_request');
    if(voiceFactory!==undefined&&typeof voiceFactory!=='function')throw new QQVoiceError('invalid_request');
    Object.assign(this,{root,vault,onChange,clientFactory,qqClientFactory,feishuClientFactory,runnerFactory,codexRunnerFactory,claudeProgramRunnerFactory,deepseekRunnerFactory,gptRunnerFactory,geminiRunnerFactory,doubaoRunnerFactory,nativeFactory,nativeProcessFactory,qrEncoder,personaOptions});
    this.claimIdentity=claimIdentity;
    if(typeof xClientFactory!=='function'||typeof xRateBudgetFor!=='function')throw Error('Invalid X channel provider.');
    this.xClientFactory=xClientFactory;this.xRateBudgetFor=xRateBudgetFor;this.xCheck=null;
    if(typeof messengerClientFactory!=='function')throw Error('Invalid Messenger channel provider.');
    this.messengerClientFactory=messengerClientFactory;this.messengerCheck=null;
    this.imageFactory=imageFactory;this.images=null;this.imageReset=null;this.imagePersona=null;
    this.voiceFactory=voiceFactory;this.voices=null;this.voiceReset=null;
    this.friendRequests=null;
    if(typeof inboundImageReaderFactory!=='function'||inboundImagePrepare!==undefined&&typeof inboundImagePrepare!=='function')throw Error('Invalid inbound image provider.');
    this.inboundImageReaderFactory=inboundImageReaderFactory;this.inboundImagePrepare=inboundImagePrepare;
    if(inboundVoiceFactory!==undefined&&typeof inboundVoiceFactory!=='function'||typeof inboundVoiceAvailability!=='function')throw Error('Invalid inbound voice provider.');
    this.inboundVoiceFactory=inboundVoiceFactory;this.inboundVoiceAvailability=inboundVoiceAvailability;this.inboundVoiceTask=null;this.inboundVoiceIdle=null;this.inboundVoiceClosing=null;
    this.imageProfileId=createHash('sha256').update(process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root)).digest('hex');
    this.file=vaultFile||path.join(root,'bot-vault.json'); this.config=readJSON(path.join(root,'bot-config.json'));
    if(!['api','native','claude','codex','deepseek','gpt','gemini','doubao'].includes(this.config.mode))this.config.mode='api';
    if(!['wechat','qq','feishu','x','messenger'].includes(this.config.channel))this.config.channel='wechat';
    this.secret={};this.credentialState='empty';this.credentialProblem='';this.vaultFingerprint=null;this.forgetting=false; this.status='disconnected'; this.problem=''; this.inputProblem=''; this.dispatcher=null; this.qr=null;this.generation=0;this.incomingCount=0;this.outgoingAccepted=0;this.qqCheck=null;
    this.journal=journalFactory({root});
    this.socialStore=new SocialStore({root});
    const previousScope=readJSON(path.join(root,'social-scope.json'),{}).scope;
    this.socialScope=typeof previousScope==='string'&&/^[a-f0-9]{64}$/.test(previousScope)?previousScope:null;
    this.socialConsent=readJSON(path.join(root,'social-consent.json'),{}).scope||null;
    if(fs.existsSync(this.file)){
      try{
        const bytes=vaultBytes(this.file);this.vaultFingerprint=vaultFingerprint(bytes);
        if(!vault?.isEncryptionAvailable())throw Error('OS credential encryption is unavailable.');
        const stored=JSON.parse(bytes.toString('utf8'));
        if(!stored||typeof stored.data!=='string'||!stored.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(stored.data))throw Error('Invalid encrypted vault.');
        const secret=JSON.parse(vault.decryptString(Buffer.from(stored.data,'base64')));
        if(!secret||typeof secret!=='object'||Array.isArray(secret))throw Error('Invalid credentials.');
        this.secret=secret;this.credentialState='ready';
      }catch{this.lockCredentials();}
    }
  }
  localBinding(){
    const settings=this.socialStore.config(),mode=this.config.mode,slot=API_KEY_SLOT[mode];
    const reason=!SUPPORTED_MODES.has(mode)?'unsupported':this.forgetting?'credentials_busy':this.credentialState==='locked'?'credentials_locked':mode!=='claude'&&!this.secret[slot]?'credentials_missing':!this.socialStore.available?'storage_unavailable':null;
    return {mode,configuration:JSON.stringify(this.config),settings:JSON.stringify(settings),character:settings.characterId,credentials:JSON.stringify([this.credentialState,this.vaultFingerprint,createHash('sha256').update(this.secret[slot]||'').digest('hex')]),reason};
  }
  localManager(){return this.localCompanion||=(new LocalCompanion({root:this.root,capture:()=>this.localBinding(),createExecute:(binding,workspace)=>{
    this.assertCredentialsAvailable();const mode=binding.mode,factory={api:this.runnerFactory,claude:this.claudeProgramRunnerFactory,deepseek:this.deepseekRunnerFactory,gpt:this.gptRunnerFactory,gemini:this.geminiRunnerFactory,doubao:this.doubaoRunnerFactory}[mode];
    if(!factory)throw Object.assign(Error('This backend cannot disable all tools.'),{code:'unsupported'});
    return factory({workspace,key:this.secret[API_KEY_SLOT[mode]],model:API_MODELS[mode]?(this.config[mode+'Model']||API_MODELS[mode].default):mode==='deepseek'?(this.config.deepseekModel||'deepseek-flash'):undefined,configDir:path.join(this.root,'local-companion','agent'),budget:this.config.budget||1,persona:{enabled:false,selection:'default'},conversationOnly:true});
  },onChange:()=>this.changed(),characterLibrary:this.characterLibrary,lorebookLibrary:this.lorebookLibrary,regexLibrary:this.regexLibrary,groupLibrary:this.groupLibrary,random:()=>this.groupRandom(),groupDispatcher:this.groupDispatcher(),now:this.knowledgeNow}));}
  // Group-chat dispatcher of this profile (group-dispatcher.cjs): default off per group. Its
  // scorer configuration {endpoint, model, keySlot} lives in local-companion/dispatcher.json and
  // never holds a key: keySlot names one of the existing provider key slots of this vault
  // (API_KEY_SLOT values), read at call time and only sent to that provider's own host.
  groupDispatcher(){
    return this.groupDispatcherState||=new GroupDispatcher({file:path.join(this.root,'local-companion','dispatcher.json'),fetchImpl:this.dispatcherFetch,now:this.knowledgeNow,
      keyFor:slot=>this.credentialState==='ready'&&!this.forgetting&&Object.values(API_KEY_SLOT).includes(slot)&&typeof this.secret[slot]==='string'?this.secret[slot]:''});
  }
  // Results are plain values; errors carry a code (not_configured, invalid_endpoint, invalid_model,
  // invalid_key_slot, key_host_mismatch, invalid_request, storage_unavailable).
  dispatcherStatus(){return this.groupDispatcher().status();}
  dispatcherConfigure(value){const status=this.groupDispatcher().configure(value);this.changed();return status;}
  async dispatcherProbe(){const result=await this.groupDispatcher().probe();this.changed();return result;}
  // Memory wiki and nightly reflection of this profile's App conversation (companion-knowledge.cjs).
  // Everything is off until the owner switches it on per character. Synchronous unless noted;
  // errors carry a code. A model only ever adds pending proposals / candidates; wikiDecide and
  // reflectionDecide are the owner's one-at-a-time decisions.
  knowledge(){return this.localManager().knowledge();}
  wikiTree(){return this.knowledge().wikiTree();}
  wikiPage(rel){return this.knowledge().wikiPage(rel);}
  wikiLint(){return this.knowledge().wikiLint();}
  wikiCreate(value){return this.knowledge().wikiCreate(value);}
  wikiProposals(value){return this.knowledge().wikiProposals(value);}
  // async: {problem, read, proposed, dropped}
  wikiPropose(value){return this.knowledge().wikiPropose(value);}
  wikiDecide(value){return this.knowledge().wikiDecide(value);}
  wikiAccess(value){return this.localManager().wikiAccess(value);}
  reflectionStatus(value){return this.knowledge().reflectionStatus(value);}
  reflectionConfigure(value){return this.knowledge().reflectionConfigure(value);}
  // async: {outcome, read, created, merged, pending}
  reflectionRun(value){return this.knowledge().reflectionRun(value);}
  reflectionCandidates(value){return this.knowledge().reflectionCandidates(value);}
  reflectionDecide(value){return this.knowledge().reflectionDecide(value);}
  reflectionRules(value){return this.knowledge().reflectionRules(value);}
  reflectionRule(value){return this.knowledge().reflectionRule(value);}
  // For the app's poll: cheap; starts at most one scheduled run. Never throws.
  reflectionDue(now=this.knowledgeNow()){try{return this.knowledge().reflectionDue(now);}catch{return [];}}
  reflectionTick(now=this.knowledgeNow()){try{return this.knowledge().reflectionTick(now);}catch{return {started:[]};}}
  localSnapshot(){return this.localManager().snapshot();}
  // Imported-character settings and message operations of the App conversation.
  // stSnapshot/stConfigure/stRefresh/stConversations/stClearConversation are
  // synchronous; localMessage always returns a promise.
  stSnapshot(){try{return this.localManager().stSnapshot();}catch{return {available:false,settings:null,presetTruncated:null,character:null,problem:'unavailable',lastWarnings:[],lastUsed:null,activatedEntries:[],branch:null,branchCount:0,group:null};}}
  stConfigure(partial){return this.localManager().stConfigure(partial);}
  stRefresh(){return this.localManager().stRefresh();}
  stConversations(){return this.localManager().stConversations();}
  // target: a character id, {characterId} or {groupId}.
  stClearConversation(target){return this.localManager().stClearConversation(target);}
  // Group chats of the App conversation (several library characters; never on QQ). Synchronous;
  // errors carry a local-companion code (busy, group_invalid, group_not_found, group_limit,
  // group_active, character_missing, unavailable, ...). Switch with stConfigure({groupId}).
  groups(){return this.localManager().groups();}
  groupSave(value){return this.localManager().groupSave(value);}
  groupRemove(id){return this.localManager().groupRemove(id);}
  localMessage(value,options){return this.localManager().message(value,options);}
  // Branches (checkpoints) of the selected library character's conversation. Synchronous;
  // errors carry a local-companion code (busy, unsupported, message_not_found, branch_not_found,
  // branch_active, branch_limit, scope_limit, invalid_request, ...). Switch with stConfigure({branchId}).
  branches(){return this.localManager().branches();}
  branchFrom(messageId,name){return this.localManager().branchFrom(messageId,name);}
  branchRename(id,name){return this.localManager().branchRename(id,name);}
  branchRemove(id){return this.localManager().branchRemove(id);}
  // Regex scripts of the App conversation's imported characters. The library is shared by all
  // profiles; scripts are data and are only ever run by the guarded engine.
  _regexLibrary(){if(!this.regexLibrary)throw Object.assign(Error('Regex scripts are unavailable.'),{code:'unavailable'});return this.regexLibrary;}
  _regexChanged(){this.localCompanion?.regexRefresh();this.changed();}
  regexScripts(){
    if(!this.regexLibrary)return [];
    return this.regexLibrary.list().slice(0,100).map(item=>({id:item.id,scriptName:item.scriptName,findRegex:item.findRegex,replaceString:item.replaceString.slice(0,2000),replaceTruncated:item.replaceString.length>2000,
      trimStrings:[...item.trimStrings],placement:[...item.placement],disabled:item.disabled,markdownOnly:item.markdownOnly,promptOnly:item.promptOnly,runOnEdit:item.runOnEdit,substituteRegex:item.substituteRegex,minDepth:item.minDepth,maxDepth:item.maxDepth,addedAt:item.addedAt,updatedAt:item.updatedAt}));
  }
  // One SillyTavern regex export (a script or an array of scripts) as JSON text or a buffer.
  regexImport(json){
    const library=this._regexLibrary(),{importRegexScripts}=require('../vendor/sillytavern/regex-scripts.cjs');
    if(!Buffer.isBuffer(json)&&typeof json!=='string')throw Object.assign(Error('Choose a regex script JSON file.'),{code:'regex_script_invalid'});
    const parsed=importRegexScripts(json),warnings=[...parsed.warnings];let added=0;
    try{
      for(const script of parsed.scripts){
        try{library.add(script);added++;}
        catch(error){if(!['regex_library_full','regex_library_too_large'].includes(error?.code))throw error;warnings.push(`${parsed.scripts.length-added} script(s) were not added: ${error.message}`);break;}
      }
    }finally{if(added)this._regexChanged();}
    return {added,warnings:warnings.slice(0,40).map(item=>String(item).slice(0,300))};
  }
  regexUpdate(id,patch){const record=this._regexLibrary().update(id,patch);this._regexChanged();return record;}
  regexRemove(id){const result=this._regexLibrary().remove(id);if(result.removed)this._regexChanged();return result;}
  regexReorder(ids){const order=this._regexLibrary().reorder(ids);this._regexChanged();return order;}
  localHistory(historyId){return this.localManager().expandHistory(historyId);}
  resetChannelHistory(){this.channelHistoryView=null;}
  channelHistoryViewForCurrent(){
    const dispatcher=this.dispatcher,settings=this.socialStore.config();
    if(this.config.channel!=='qq'||!settings.enabled||!this.socialScope||!this.socialStore.available||!(dispatcher instanceof SocialCompanion)||dispatcher.scope!==this.socialScope){this.resetChannelHistory();return null;}
    const binding=JSON.stringify([this.config,this.socialScope,settings.characterId,this.generation]);
    if(this.channelHistoryView?.binding!==binding||this.channelHistoryView?.dispatcher!==dispatcher)this.channelHistoryView={binding,dispatcher,id:randomUUID(),limit:60};
    return this.channelHistoryView;
  }
  channelTaskSnapshot(){
    const view=this.channelHistoryViewForCurrent();
    return this.dispatcher?.snapshot(view?{historyId:view.id,historyLimit:view.limit}:undefined)||null;
  }
  channelHistory(historyId){
    const view=this.channelHistoryViewForCurrent();
    if(!view||view.id!==historyId)throw Object.assign(Error('The saved QQ conversation changed.'),{code:'changed'});
    const limit=Math.min(120,view.limit+30);
    try{this.socialStore.historyWindow(this.socialScope,limit);}catch{throw Object.assign(Error('Saved conversation could not be read.'),{code:'storage_unavailable'});}
    view.limit=limit;this.changed();return {historyId:view.id,historyLimit:limit};
  }
  localMemory(value,options){return this.localManager().editMemory(value,options);}
  localConversationContext(){return this.localManager().context();}
  localStart(options){return this.localManager().start(options);}
  localReply(text,options){return this.localManager().reply(text,options);}
  localStop(){return this.localCompanion?.stop()||Promise.resolve();}
  assertLocalStopped(){this.localCompanion?.assertStopped();}
  retireLocal(){void this.localCompanion?.stop({retry:false}).catch(()=>{});}
  // Source notices for the companion (see companion-notifier.cjs). The App
  // conversation is the sink whenever it is running; QQ is used only through a
  // connected companion's existing proactive gates. Nothing here starts a
  // conversation, a runner or a connection.
  companionNotifier(){return this.notifier||=new CompanionNotifier({store:this.socialStore,config:()=>this.socialStore.config(),onChange:()=>this.changed(),
    app:()=>{
      const manager=this.localCompanion,run=manager?.run;if(!run)return null;
      let context;try{context=manager.context();}catch{return null;}
      return {busy:()=>run.pendingReplies.size>0||context.dispatcher.noticeBusy(),lastOwnerAt:()=>context.dispatcher.lastOwnerAt(),deliver:(batch,options)=>manager.notify(batch,options)};
    },
    qq:()=>{
      const controller=this.dispatcher;
      if(!(controller instanceof SocialCompanion)||this.status!=='connected'||this.config.channel!=='qq'||controller.scope!==this.socialScope)return null;
      return {eligible:()=>this.socialStore.config().proactiveMessages===true&&!controller.noticeBusy()&&controller.eligibility().message===true,deliver:(batch,options)=>controller.announceNotice(batch,options)};
    }});}
  // Synchronous, never throws. event: a source event republished on the bus
  // with notify/sourceName. Returns {accepted:boolean, reason?:string}.
  companionNotice(event){try{return this.companionNotifier().accept(event);}catch{return {accepted:false,reason:'unavailable'};}}
  // Cheap and non-throwing; call from the 1-second poll for the selected
  // service only. options.onAppMessage({service,at,count}) runs after a notice
  // was stored in the App conversation.
  companionNoticeTick({onAppMessage}={}){
    try{return this.companionNotifier().tick({onAppMessage:typeof onAppMessage==='function'?info=>onAppMessage({...info,service:this}):undefined});}
    catch{return {action:'wait',reason:'unavailable'};}
  }
  companionNoticeStatus(){try{return this.companionNotifier().status();}catch{return {pending:0,lastDeliveredAt:null,lastProblem:'unavailable'};}}
  lockCredentials(){this.retireLocal();this.secret={};this.credentialState='locked';this.credentialProblem=LOCKED_CREDENTIALS;}
  assertNotForgetting(){if(this.forgetting)throw Object.assign(Error('Credentials are being cleared. Wait for that operation to finish. (credentials_busy)'),{code:'credentials_busy'});}
  assertCredentialsAvailable(){this.assertNotForgetting();if(this.credentialState==='locked')throw Object.assign(Error(LOCKED_CREDENTIALS),{code:'credentials_locked'});}
  persist(next=this.secret,onPrepared){
    this.assertCredentialsAvailable();this.retireLocal();
    // A vault that appeared or changed after opening belongs to another writer.
    // Never replace it with our stale (possibly empty) in-memory credentials.
    let current;
    try{current=fs.existsSync(this.file)?vaultFingerprint(vaultBytes(this.file)):null;}catch{this.lockCredentials();this.changed();this.assertCredentialsAvailable();}
    if(current!==this.vaultFingerprint){this.lockCredentials();this.changed();this.assertCredentialsAvailable();}
    let encoded;
    try{
      if(!this.vault?.isEncryptionAvailable())throw Error('OS credential encryption is unavailable.');
      if(!next||typeof next!=='object'||Array.isArray(next))throw Error('Invalid credentials.');
      encoded={data:this.vault.encryptString(JSON.stringify(next)).toString('base64')};
      if(Buffer.byteLength(JSON.stringify(encoded,null,2))>MAX_VAULT_BYTES)throw Error('Credential vault is too large.');
    }catch{
      if(current!==null){this.lockCredentials();this.changed();this.assertCredentialsAvailable();}
      throw Error('OS credential encryption is unavailable. Credentials were not saved.');
    }
    const fingerprint=vaultFingerprint(Buffer.from(JSON.stringify(encoded,null,2)));
    onPrepared?.(fingerprint);
    atomicJSON(this.file,encoded);this.vaultFingerprint=fingerprint;this.secret=next;this.credentialState='ready';this.credentialProblem='';
  }
  persistConfiguration(config,secret){
    // Stage the nonsecret settings before changing credentials. A failed config
    // commit restores only our exact new ciphertext; observed concurrent writes
    // are retained. The previous encrypted bytes remain in memory during this
    // bounded operation, and no plaintext credential backup is created.
    this.assertCredentialsAvailable();
    const configFile=path.join(this.root,'bot-config.json'),staged=`${configFile}.${randomBytes(12).toString('hex')}.tmp`;
    const previous={secret:this.secret,fingerprint:this.vaultFingerprint,state:this.credentialState,problem:this.credentialProblem};
    let originalVault,writtenFingerprint,preparedFingerprint,desiredConfigHash;
    const rollbackFailure=()=>{
      this.lockCredentials();this.credentialProblem='Connection settings were not saved and credential rollback could not be verified. The credential file was retained; restore access before reconnecting.';this.changed();
      return Object.assign(Error(this.credentialProblem),{code:'configuration_rollback_failed'});
    };
    const configHash=()=>{
      if(!fs.existsSync(configFile))return null;
      if(fs.statSync(configFile).size>64000)throw Error('Connection settings are too large.');
      return vaultFingerprint(fs.readFileSync(configFile));
    };
    const exactVault=hash=>{
      const stat=fs.lstatSync(this.file);
      return stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=MAX_VAULT_BYTES&&vaultFingerprint(vaultBytes(this.file))===hash;
    };
    try{
      const originalConfigHash=configHash();
      const configBytes=Buffer.from(JSON.stringify(config,null,2));if(configBytes.length>64000)throw Error('Connection settings are too large.');
      desiredConfigHash=vaultFingerprint(configBytes);fs.writeFileSync(staged,configBytes,{flag:'wx',mode:0o600});
      originalVault=fs.existsSync(this.file)?vaultBytes(this.file):null;
      if((originalVault===null?null:vaultFingerprint(originalVault))!==previous.fingerprint){this.lockCredentials();this.changed();this.assertCredentialsAvailable();}
      this.persist(secret,fingerprint=>{preparedFingerprint=fingerprint;});writtenFingerprint=this.vaultFingerprint;
      if(!exactVault(writtenFingerprint)||configHash()!==originalConfigHash)throw Error('Configuration changed during save.');
      fs.renameSync(staged,configFile);
    }catch(error){
      // A vault rename may itself report an uncertain outcome. Record its exact
      // intended ciphertext hash before writing, so we can recognize our own
      // committed bytes without reading or guessing another writer's secret.
      if(!writtenFingerprint&&preparedFingerprint){
        let currentFingerprint;
        try{currentFingerprint=fs.existsSync(this.file)?vaultFingerprint(vaultBytes(this.file)):null;}catch{throw rollbackFailure();}
        if(currentFingerprint===preparedFingerprint)writtenFingerprint=preparedFingerprint;
        else if(currentFingerprint!==previous.fingerprint)throw rollbackFailure();
      }
      if(writtenFingerprint){
        // A filesystem error can leave commit outcome uncertain. If both exact
        // intended files are present, keep the completed save instead of
        // restoring credentials underneath an already committed configuration.
        try{if(exactVault(writtenFingerprint)&&configHash()===desiredConfigHash){this.secret=secret;this.vaultFingerprint=writtenFingerprint;this.credentialState='ready';this.credentialProblem='';return;}}catch{/* Continue with ownership-checked rollback. */}
        let restoreFile;
        try{
          if(!exactVault(writtenFingerprint))throw Error('Credential copy changed.');
          if(originalVault===null)fs.unlinkSync(this.file);
          else{
            restoreFile=`${this.file}.${randomBytes(12).toString('hex')}.restore.tmp`;
            fs.writeFileSync(restoreFile,originalVault,{flag:'wx',mode:0o600});
            if(!exactVault(writtenFingerprint))throw Error('Credential copy changed.');
            fs.renameSync(restoreFile,this.file);
          }
          this.secret=previous.secret;this.vaultFingerprint=previous.fingerprint;this.credentialState=previous.state;this.credentialProblem=previous.problem;
        }catch{
          throw rollbackFailure();
        }finally{if(restoreFile){try{if(fs.existsSync(restoreFile))fs.unlinkSync(restoreFile);}catch{/* Retain uncertain encrypted staging bytes rather than mask the failure. */}}}
        throw Object.assign(Error('Connection settings were not saved. Previous saved credentials were restored.'),{code:'configuration_save_failed'});
      }
      throw error;
    }finally{try{if(fs.existsSync(staged))fs.unlinkSync(staged);}catch{/* Never hide the original save result. */}}
  }
  snapshot(){return this.socialStore.withConnection(()=>this._snapshot());}
  _snapshot(){const native=this.dispatcher?.nativeSnapshot?.()||{command:null,attached:false,forwarded:0,replies:0};return {mode:this.config.mode,channel:this.config.channel,status:this.status,credentialState:this.credentialState,problem:this.credentialProblem||this.problem||this.inputProblem,recovery:this.journal.snapshot(),social:this.socialSnapshot(),local:this.localSnapshot(),st:this.stSnapshot(),companionNotices:this.companionNoticeStatus(),media:this.imageSnapshot(),voiceMedia:this.voiceSnapshot(),workspace:this.config.workspace||'',budget:this.config.budget||1,hasKey:!!this.secret[API_KEY_SLOT[this.config.mode]],x:{expectedAccountId:this.config.xAccountId||'',ownerId:this.config.xOwnerId||'',hasToken:!!this.secret.xAccessToken,optedOut:this.config.xOptedOut===true,check:this.xCheck},messenger:{appId:this.config.messengerAppId||'',pageId:this.config.messengerPageId||'',ownerId:this.config.messengerOwnerId||'',relayOrigin:this.config.messengerRelayOrigin||'',hasPageToken:!!this.secret.messengerPageAccessToken,hasRelayToken:!!this.secret.messengerRelayToken,optedOut:this.config.messengerOptedOut===true,check:this.messengerCheck},paired:this.config.channel==='messenger'?!!(this.config.messengerAppId&&this.config.messengerPageId&&this.config.messengerOwnerId&&this.config.messengerRelayOrigin&&this.secret.messengerPageAccessToken&&this.secret.messengerRelayToken):this.config.channel==='x'?!!(this.config.xAccountId&&this.config.xOwnerId&&this.secret.xAccessToken):this.config.channel==='qq'?!!(this.secret.qqToken&&this.config.qqOwnerId):this.config.channel==='feishu'?!!(this.config.feishuAppId&&this.config.feishuOwnerId&&this.secret.feishuAppSecret):!!this.secret.token,qq:{url:this.config.qqUrl||'ws://127.0.0.1:3001',ownerId:this.config.qqOwnerId||'',expectedAccountId:this.config.qqAccountId||'',hasToken:!!this.secret.qqToken,check:this.qqCheck},deepseekModel:this.config.deepseekModel||'deepseek-flash',gptModel:this.config.gptModel||DEFAULT_GPT_MODEL,geminiModel:this.config.geminiModel||DEFAULT_GEMINI_MODEL,doubaoModel:this.config.doubaoModel||DEFAULT_DOUBAO_MODEL,feishu:{appId:this.config.feishuAppId||'',ownerId:this.config.feishuOwnerId||'',hasSecret:!!this.secret.feishuAppSecret},qr:this.qr,incomingCount:this.incomingCount,outgoingAccepted:this.outgoingAccepted,native:this.config.mode==='native'?{...native,process:{...this.nativeProcess?.snapshot(),busy:!!this.nativeOperation}}:null,tasks:this.channelTaskSnapshot()};}
  accountSnapshot(){
    // Account tabs need identity/status, not every companion's private history.
    // Keep retirement checks for a background App conversation without reading
    // its history or creating an otherwise unused local manager.
    this.localCompanion?.observe();
    const settings=this.socialStore.config(),social=this.dispatcher instanceof SocialCompanion;
    return {mode:this.config.mode,channel:this.config.channel,status:this.status,credentialState:this.credentialState,problem:this.credentialProblem||this.problem||this.inputProblem,
      qq:{check:this.qqCheck},social:{config:{enabled:settings.enabled,characterId:settings.characterId},supported:this.config.channel==='qq'&&SUPPORTED_MODES.has(this.config.mode),busy:social&&this.socialStore.available&&!!(this.dispatcher.current||this.dispatcher.initiative||this.dispatcher.queue.length)},
      incomingCount:this.incomingCount,outgoingAccepted:this.outgoingAccepted};
  }
  // Main-process binding only. Never return this object through IPC: it contains
  // the existing client. Renderer snapshots receive just media metadata.
  imageBinding(){
    const client=this.client;
    if(this.status!=='connected'||this.config.channel!=='qq'||!client||!client.ready||client.closed||client.socket?.readyState!==1)throw new QQMediaError('disconnected');
    if(!client.accountId||client.ownerId!==this.config.qqOwnerId||(this.config.qqAccountId&&this.config.qqAccountId!==client.accountId))throw new QQMediaError('account_mismatch');
    const settings=this.socialStore.config(),social=settings.enabled&&SUPPORTED_MODES.has(this.config.mode);
    const fallback=this.imagePersona||personaForBackend(({native:'claude-native',claude:'claude-native',api:'claude-api',codex:'codex',deepseek:'deepseek',gpt:'gpt',gemini:'gemini',doubao:'doubao'})[this.config.mode]||'claude-api');
    const characterId=social?settings.characterId:fallback.id,role=social?settings.name:fallback.name.zh;
    return {status:this.status,channel:'qq',generation:this.generation,scopeId:`${this.imageProfileId}:${characterId}`,characterId,accountId:client.accountId,ownerId:this.config.qqOwnerId,role,client};
  }
  manualQQRecorder(context){
    const record=this.socialStore.captureManualQQ(manualQQScope(context));
    return value=>{try{return record(value);}catch{this.inputProblem='手动发送的本地记录未能保存；原发送结果不变，未自动重发。';this.changed();return {recorded:false};}};
  }
  imageSnapshot(){
    const supported=typeof this.imageFactory==='function'&&this.config.channel==='qq';let available=false;
    if(supported){try{this.imageBinding();available=!this.imageReset;}catch{}}
    const state=this.images?.snapshot()||{busy:false,draft:null,last:null};return {supported,available,...state,busy:!!this.imageReset||state.busy};
  }
  imageController(){
    if(this.imageReset)throw new QQMediaError('operation_in_progress');if(!this.imageFactory)throw new QQMediaError('media_unavailable');this.imageBinding();
    if(!this.images){let controller;controller=this.imageFactory({getBinding:()=>this.imageBinding(),onChange:()=>{if(this.images===controller)this.changed();}});if(!controller||['select','send','discard','snapshot','close'].some(name=>typeof controller[name]!=='function'))throw new QQMediaError('media_unavailable');this.images=controller;}
    return this.images;
  }
  selectImage(file,options){return this.imageController().select(file,options);}
  async sendImage(value,options){
    if(!this.images)throw new QQMediaError('stale_ticket');const binding=this.imageBinding(),record=this.manualQQRecorder({accountId:binding.accountId,ownerId:binding.ownerId,characterId:binding.characterId});
    const controller=this.images,generation=this.generation,result=await controller.send(value,options);
    record({id:value.ticketId,media:'image',outcome:result.outcome==='not_sent'?'not_submitted':result.outcome,messageId:result.messageId});
    if(result.outcome==='accepted'&&this.images===controller&&generation===this.generation){this.outgoingAccepted++;this.changed();}return result;
  }
  discardImage(value){if(!this.images)throw new QQMediaError('stale_ticket');return this.images.discard(value);}
  resetImages(){
    const previous=this.images;this.images=null;if(!previous)return this.imageReset||Promise.resolve({closed:true});
    const operation=Promise.resolve(previous.close()).finally(()=>{if(this.imageReset===operation){this.imageReset=null;this.changed();}});this.imageReset=operation;this.changed();return operation;
  }
  voiceBinding(){try{return this.imageBinding();}catch(error){throw new QQVoiceError(error?.code);}}
  voiceSnapshot(){
    const supported=typeof this.voiceFactory==='function'&&this.config.channel==='qq';let available=false;
    if(supported){try{this.voiceBinding();available=!this.voiceReset;}catch{}}
    const state=this.voices?.snapshot()||{busy:false,draft:null,last:null};return {supported,available,...state,busy:!!this.voiceReset||state.busy};
  }
  voiceController(){
    if(this.voiceReset)throw new QQVoiceError('operation_in_progress');if(!this.voiceFactory)throw new QQVoiceError('media_unavailable');this.voiceBinding();
    if(!this.voices){let controller;controller=this.voiceFactory({getBinding:()=>this.voiceBinding(),onChange:()=>{if(this.voices===controller)this.changed();}});if(!controller||['select','send','discard','snapshot','close'].some(name=>typeof controller[name]!=='function'))throw new QQVoiceError('media_unavailable');this.voices=controller;}
    return this.voices;
  }
  selectVoice(file,options){return this.voiceController().select(file,options);}
  prepareVoice(bytes,options){const controller=this.voiceController();if(typeof controller.prepare!=='function')throw new QQVoiceError('media_unavailable');return controller.prepare(bytes,options);}
  async sendVoice(value,options){
    if(!this.voices)throw new QQVoiceError('stale_ticket');const binding=this.voiceBinding(),record=this.manualQQRecorder({accountId:binding.accountId,ownerId:binding.ownerId,characterId:binding.characterId});
    const controller=this.voices,generation=this.generation,result=await controller.send(value,options);
    record({id:value.ticketId,media:'voice',outcome:result.outcome==='not_sent'?'not_submitted':result.outcome,messageId:result.messageId});
    if(result.outcome==='accepted'&&this.voices===controller&&generation===this.generation){this.outgoingAccepted++;this.changed();}return result;
  }
  discardVoice(value){if(!this.voices)throw new QQVoiceError('stale_ticket');return this.voices.discard(value);}
  resetVoices(){
    const previous=this.voices;this.voices=null;if(!previous)return this.voiceReset||Promise.resolve({closed:true});
    const operation=Promise.resolve(previous.close()).finally(()=>{if(this.voiceReset===operation){this.voiceReset=null;this.changed();}});this.voiceReset=operation;this.changed();return operation;
  }
  socialSnapshot(){
    const settings=this.socialStore.config();if(this.socialScope&&this.socialStore.available){try{settings.notes=this.socialStore.getNotes(this.socialScope);}catch{}}
    const base={config:settings,imageInput:{supported:this.config.channel==='qq'&&imageCapability(this.config.mode,this.config[this.config.mode+'Model']||({gpt:DEFAULT_GPT_MODEL,deepseek:'deepseek-flash'})[this.config.mode])&&typeof this.inboundImagePrepare==='function'},memoryReady:!!this.socialScope,supported:this.config.channel==='qq'&&SUPPORTED_MODES.has(this.config.mode),active:false,busy:false,problem:this.socialStore.problem||'',history:[],actions:[],facts:[],followups:[],entries:[]};
    if(this.socialScope&&this.socialStore.available){try{base.facts=this.socialStore.facts?.(this.socialScope)||[];base.followups=this.socialStore.followups?.(this.socialScope)||[];base.entries=this.socialStore.publicEntries?.(this.socialScope)||[];}catch{}}
    try{return {...base,...(this.dispatcher instanceof SocialCompanion?this.dispatcher.socialSnapshot():this.socialScope&&this.socialStore.available?{history:this.socialStore.history(this.socialScope,30),actions:this.socialStore.actions(this.socialScope,20)}:{})};}
    catch{return {...base,problem:'本地记忆无法读取，陪伴活动已暂停。'};}
  }
  socialConfigure(patch){
    if(this.status!=='disconnected')throw Error('请先断开连接，再修改相处方式；暂停主动活动随时可用。');
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Invalid companion settings.');
    const {notes,...settings}=patch;
    if(notes!==undefined&&(typeof notes!=='string'||notes.length>1000||/[\x00-\x08\x0b-\x1f\x7f]/.test(notes)))throw Error('Invalid memory notes.');
    const changingCharacter=settings.characterId!==undefined&&settings.characterId!==this.socialStore.config().characterId;
    if(notes!==undefined&&(!this.socialScope||changingCharacter)&&notes!=='')throw Error('请先用这位角色连接一次 QQ，再保存属于这位好友的记忆。');
    this.retireLocal();this.socialStore.configure(settings);
    void this.resetImages();void this.resetVoices();
    if(changingCharacter){this.socialPause();this.clearSocialScope();}
    if(notes!==undefined&&this.socialScope)this.socialStore.setNotes(this.socialScope,notes);
    this.changed();return this.snapshot();
  }
  socialPause(){
    if(this.dispatcher instanceof SocialCompanion)this.dispatcher.pause();
    else this.socialStore.configure({proactiveMessages:false,qzonePosts:false});
    this.changed();return this.snapshot();
  }
  clearSocialScope(){this.socialScope=null;if(this.dispatcher instanceof SocialCompanion)this.dispatcher=null;atomicJSON(path.join(this.root,'social-scope.json'),{});}
  async socialConsider(){
    if(!(this.dispatcher instanceof SocialCompanion)||this.status!=='connected')throw Error('请先连接 QQ 陪伴模式。');
    const result=await this.dispatcher.consider();this.changed();return {...this.snapshot(),socialDecision:result};
  }
  socialForget(){
    if(this.status!=='disconnected')throw Error('请先断开连接，再清除记忆。');
    this.socialPause();if(this.socialScope)this.socialStore.clear(this.socialScope);
    if(this.dispatcher instanceof SocialCompanion)this.dispatcher=null;
    this.changed();return this.snapshot();
  }
  async socialEdit(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.action!=='string')throw Error('Choose a relationship action.');
    if(!this.socialScope||!this.socialStore.available)throw Error('Connect this character to its QQ owner once before managing relationship records.');
    const scope=this.socialScope,store=this.socialStore,controller=this.dispatcher instanceof SocialCompanion?this.dispatcher:null;
    // An edit invalidates a prompt already carrying old private information.
    controller?.cancel();await controller?.whenIdle();
    if(scope!==this.socialScope)throw Error('The active relationship changed. Please review the edit again.');
    const {action,id,...record}=value;
    switch(action){
      case 'remember':store.remember(scope,record);break;
      case 'correct':store.correctFact(scope,id,record);break;
      case 'forget':store.forgetFact(scope,id,{revision:record.revision});break;
      case 'followup-add':store.scheduleFollowup(scope,record);break;
      case 'followup-edit':store.updateFollowup(scope,id,record);break;
      case 'followup-cancel':store.cancelFollowup(scope,id);break;
      case 'entry-add':store.addPublicEntry(scope,record);break;
      case 'entry-edit':store.updatePublicEntry(scope,id,record);break;
      case 'entry-delete':store.deletePublicEntry(scope,id);break;
      default:throw Error('Unknown relationship action.');
    }
    if(['correct','forget'].includes(action))await controller?.invalidateMemory?.();
    this.changed();return this.snapshot();
  }
  socialController(){if(!(this.dispatcher instanceof SocialCompanion)||this.status!=='connected')throw Error('Connect QQ companion mode first.');return this.dispatcher;}
  async socialDraft(){const result=await this.socialController().publicDraft();this.changed();return result;}
  async socialPublish(id){if(typeof id!=='string'||id.length>180)throw Error('Choose a saved public draft.');const result=await this.socialController().publishDraft(id);this.changed();return result;}
  socialReply(text,options){return this.socialController().respondLocally(text,options);}
  changed(){this.onChange();}
  configure({key,workspace,budget,mode,channel,qqUrl,qqOwnerId,qqAccountId,qqToken,deepseekModel,gptModel,geminiModel,doubaoModel,feishuAppId,feishuOwnerId,feishuAppSecret,xAccountId,xOwnerId,xAccessToken,xResume,xOptedOut,messengerAppId,messengerPageId,messengerOwnerId,messengerRelayOrigin,messengerPageAccessToken,messengerRelayToken,messengerResume,messengerOptedOut}={}){
    this.assertNotForgetting();
    if(this.status!=='disconnected')throw Error('Disconnect before changing the project or API key.');
    const next={...this.config},secret={...this.secret};let secretChanged=false;
    if(mode!==undefined){if(!['api','native','claude','codex','deepseek','gpt','gemini','doubao'].includes(mode))throw Error('Choose an available AI backend.');next.mode=mode;}
    if(channel!==undefined){if(!['wechat','qq','feishu','x','messenger'].includes(channel))throw Error('Choose an available chat channel.');next.channel=channel;}
    if(next.channel==='feishu'&&next.mode==='native')throw Error('Feishu does not support the legacy Claude Channels backend. Choose program mode or an API.');
    if(next.channel==='x'&&next.mode==='native')throw Error('X does not support the legacy Claude Channels backend. Choose program mode or an API.');
    if(next.channel==='messenger'&&next.mode==='native')throw Error('Messenger does not support the legacy Claude Channels backend. Choose program mode or an API.');
    if(messengerOptedOut!==undefined)throw Error('Use the explicit local Messenger resume action to change the opt-out state.');
    if(messengerResume!==undefined){if(messengerResume!==true||next.channel!=='messenger')throw Error('Choose Messenger and explicitly resume reception.');next.messengerOptedOut=false;}
    for(const [field,value] of Object.entries({messengerAppId,messengerPageId,messengerOwnerId}))if(value!==undefined)next[field]=MessengerPolicy.validateId(value);
    if(messengerRelayOrigin!==undefined)next.messengerRelayOrigin=MessengerPolicy.validateOrigin(messengerRelayOrigin);
    if(next.messengerPageId&&next.messengerPageId===next.messengerOwnerId)throw Error('The Messenger Page must differ from its owner.');
    const pageChanged=next.messengerAppId!==this.config.messengerAppId||next.messengerPageId!==this.config.messengerPageId;
    const relayChanged=pageChanged||next.messengerOwnerId!==this.config.messengerOwnerId||next.messengerRelayOrigin!==this.config.messengerRelayOrigin;
    if(pageChanged&&secret.messengerPageAccessToken&&messengerPageAccessToken===undefined)throw Error('Enter a new Page token for the new Messenger App or Page.');
    if(relayChanged&&secret.messengerRelayToken&&messengerRelayToken===undefined)throw Error('Enter a new relay token for the changed Messenger binding.');
    if(messengerPageAccessToken!==undefined){secret.messengerPageAccessToken=MessengerPolicy.validateToken(messengerPageAccessToken);secretChanged=true;}
    if(messengerRelayToken!==undefined){secret.messengerRelayToken=MessengerPolicy.validateToken(messengerRelayToken,{relay:true});secretChanged=true;}
    if(xOptedOut!==undefined)throw Error('Use the explicit local X resume action to change the opt-out state.');
    if(xResume!==undefined){if(xResume!==true||next.channel!=='x')throw Error('Choose X and explicitly resume reception.');next.xOptedOut=false;}
    if(xAccountId!==undefined)next.xAccountId=XPolicy.validateXId(xAccountId);
    if(xOwnerId!==undefined)next.xOwnerId=XPolicy.validateXId(xOwnerId);
    if(next.xAccountId&&next.xAccountId===next.xOwnerId)throw Error('The X account must differ from its owner.');
    if(xAccountId!==undefined&&xAccountId!==this.config.xAccountId&&secret.xAccessToken&&xAccessToken===undefined)throw Error('Enter a new user token for the new X account; the previous token was not reused.');
    if(xAccessToken!==undefined){secret.xAccessToken=XPolicy.validateXToken(xAccessToken);secretChanged=true;}
    if(workspace!==undefined){if(typeof workspace!=='string'||!path.isAbsolute(workspace)||!fs.statSync(workspace).isDirectory())throw Error('Choose an existing project folder.');next.workspace=fs.realpathSync(workspace);}
    if(budget!==undefined){if(typeof budget!=='number'||!Number.isFinite(budget)||budget<0.05||budget>5)throw Error('Task budget must be between $0.05 and $5.');next.budget=budget;}
    if(qqUrl!==undefined)next.qqUrl=validateQQUrl(qqUrl);
    if(qqOwnerId!==undefined)next.qqOwnerId=validateQQOwner(qqOwnerId);
    if(qqAccountId!==undefined)next.qqAccountId=validateQQOwner(qqAccountId);
    if(next.qqAccountId&&next.qqAccountId===next.qqOwnerId)throw Error('The companion QQ account must differ from its owner QQ account.');
    if(deepseekModel!==undefined){if(!['deepseek-flash','deepseek-v4-pro'].includes(deepseekModel))throw Error('Choose an available DeepSeek model.');next.deepseekModel=deepseekModel;}
    if(gptModel!==undefined){if(!GPT_MODELS.includes(gptModel))throw Error('Choose an available GPT model.');next.gptModel=gptModel;}
    if(geminiModel!==undefined){if(!GEMINI_MODELS.includes(geminiModel))throw Error('Choose an available Gemini model.');next.geminiModel=geminiModel;}
    if(doubaoModel!==undefined){if(!DOUBAO_MODELS.includes(doubaoModel))throw Error('Choose an available Doubao model.');next.doubaoModel=doubaoModel;}
    if(feishuAppId!==undefined)next.feishuAppId=validateFeishuAppId(feishuAppId);
    if(feishuOwnerId!==undefined)next.feishuOwnerId=validateFeishuOwner(feishuOwnerId);
    if(feishuAppId!==undefined&&feishuAppId!==this.config.feishuAppId&&secret.feishuAppSecret&&feishuAppSecret===undefined)throw Error('Enter the App Secret for the new Feishu application; the previous application secret was not reused.');
    if(feishuAppSecret!==undefined){if(typeof feishuAppSecret!=='string'||!feishuAppSecret.trim()||feishuAppSecret.length>4096||/[\p{Cc}\p{Cf}]/u.test(feishuAppSecret))throw Error('Enter a valid Feishu App Secret.');secret.feishuAppSecret=feishuAppSecret;secretChanged=true;}
    if(key!==undefined){if(typeof key!=='string'||key.length>500||key.length<10||/[\s\x00-\x1f\x7f]/.test(key))throw Error('Enter a valid API key without whitespace.');const slot=API_KEY_SLOT[next.mode];if(!slot)throw Error('The selected local backend does not use an API key.');secret[slot]=key;secretChanged=true;}
    if(qqToken!==undefined){if(typeof qqToken!=='string'||qqToken.length<16||qqToken.length>256||/[^\x21-\x7e]/.test(qqToken))throw Error('Use a OneBot token of 16–256 printable ASCII characters without spaces.');secret.qqToken=qqToken;secretChanged=true;}
    const qqIdentityChanged=next.qqAccountId!==this.config.qqAccountId||next.qqOwnerId!==this.config.qqOwnerId||next.qqUrl!==this.config.qqUrl||secret.qqToken!==this.secret.qqToken;
    this.retireLocal();
    if(secretChanged)this.persistConfiguration(next,secret);
    else atomicJSON(path.join(this.root,'bot-config.json'),next);
    if(qqUrl!==undefined||qqOwnerId!==undefined||qqAccountId!==undefined||qqToken!==undefined||channel!==undefined){this.qqCheck=null;this.problem='';}
    if(xAccountId!==undefined||xOwnerId!==undefined||xAccessToken!==undefined||xResume!==undefined||channel!==undefined){this.xCheck=null;this.problem='';}
    if([messengerAppId,messengerPageId,messengerOwnerId,messengerRelayOrigin,messengerPageAccessToken,messengerRelayToken,messengerResume,channel].some(value=>value!==undefined)){this.messengerCheck=null;this.problem='';}
    this.config=next;
    void this.resetImages();void this.resetVoices();
    if(qqIdentityChanged){this.socialPause();this.clearSocialScope();}
    if(mode!==undefined||channel!==undefined){this.dispatcher=null;this.incomingCount=0;this.outgoingAccepted=0;}
    this.changed();
  }
  qqSetupReady(){
    if(this.status!=='disconnected'||this.config.channel!=='qq')throw Error('Select QQ and disconnect before changing or checking its connection.');
  }
  prepareQQ(){
    this.qqSetupReady();
    this.assertCredentialsAvailable();
    if(!this.secret.qqToken){this.persist({...this.secret,qqToken:randomBytes(32).toString('hex')});this.qqCheck=null;}
    this.changed();return this.snapshot();
  }
  // Only main-process clipboard handlers may consume these secret-bearing values.
  qqSetupToken(){
    this.qqSetupReady();
    this.assertCredentialsAvailable();
    if(!this.secret.qqToken)throw Error('Prepare or save a OneBot token first.');
    return this.secret.qqToken;
  }
  qqSetupConfig(){return napCatConnection(this.config.qqUrl||'ws://127.0.0.1:3001/',this.qqSetupToken());}
  testQQ(){
    this.qqSetupReady();
    this.assertCredentialsAvailable();
    if(!this.config.qqOwnerId||!this.secret.qqToken)throw Error('Save your QQ number and prepare the OneBot token first.');
    const generation=++this.generation,controller=new AbortController();
    this.qqTestController=controller;this.qqCheck={state:'checking'};this.status='checking';this.problem='';this.inputProblem='';this.changed();
    const operation=this.checkQQConnection(controller,generation);
    this.qqTestOperation=operation;
    return operation.finally(()=>{if(this.qqTestOperation===operation)this.qqTestOperation=null;});
  }
  async checkQQConnection(controller,generation){
    let client,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},15000);
    try{
      client=this.qqClientFactory({url:this.config.qqUrl||'ws://127.0.0.1:3001/',token:this.secret.qqToken,ownerId:this.config.qqOwnerId,expectedAccountId:this.config.qqAccountId});
      const result=await client.inspect(controller.signal);
      if(generation===this.generation&&!controller.signal.aborted)this.qqCheck={...result,state:'checked',checkedAt:Date.now()};
    }catch(error){
      if(generation===this.generation){
        const code=timedOut?'connect_timeout':error.code||'connect_failed';
        this.qqCheck={state:'failed',code,checkedAt:Date.now()};this.problem=qqConnectionProblem(code);
      }
    }finally{
      clearTimeout(timer);await client?.close?.();
      if(this.qqTestController===controller)this.qqTestController=null;
      if(generation===this.generation){this.status='disconnected';this.changed();}
    }
    return this.snapshot();
  }
  async login(){
    if(this.config.channel==='messenger')throw Error('Messenger uses a Facebook Page token and a configured HTTPS webhook relay; this app does not perform personal Facebook login.');
    if(this.config.channel!=='wechat')throw Error(this.config.channel==='x'?'X uses an explicitly configured user-context token; this app does not perform OAuth or token refresh.':this.config.channel==='feishu'?'Feishu uses an enterprise app and long connection; configure its App ID, App Secret and owner open_id.':'QQ uses a locally logged-in OneBot bridge; configure its address and token.');
    this.assertCredentialsAvailable();
    const disconnectedGeneration=this.generation+1;
    await this.disconnect();this.assertCredentialsAvailable();
    if(this.generation!==disconnectedGeneration)throw Object.assign(Error('The connection changed.'),{code:'changed'});
    const generation=++this.generation,controller=new AbortController(),signal=controller.signal;
    const current=()=>this.generation===generation&&!signal.aborted;
    this.status='pairing';this.problem='';this.loginController=controller;this.dispatcher=null;this.incomingCount=0;this.outgoingAccepted=0;this.changed();
    try {
      const client=this.clientFactory({});const code=await client.startLogin(signal);if(!current())return;
      const qr=await this.qrEncoder(code.qrContent);if(!current())return;this.qr=qr;this.changed();
      const expires=Date.now()+180000;
      while(current()&&Date.now()<expires){
        const state=await client.pollLogin(code.qrcode,signal);
        if(!current())return;
        if(state.status==='confirmed'){
          if(!state.token||!state.ownerId)throw Error('Incomplete login');
          this.persist({...this.secret,token:state.token,ownerId:state.ownerId,baseUrl:state.baseUrl});
          this.qr=null;this.status='disconnected';this.changed();return;
        }
        if(['expired','need_verifycode','verify_code_blocked','binded_redirect'].includes(state.status)){
          this.problem=state.status==='need_verifycode'?'This WeChat login requires phone verification, which this preview does not support. Try pairing again or use the official Tencent client.':'WeChat could not complete pairing. Request a new code.';return;
        }
        await pause(1000,signal);
      }
      if(!signal.aborted)throw Error('Login timed out');
    }catch{if(current())this.problem='WeChat login did not complete. Request a new code and scan it in WeChat.';}
    finally{if(this.generation===generation){this.qr=null;if(this.status==='pairing')this.status='disconnected';this.changed();}}
  }
  async connect({assertCurrent}={}){
    if(assertCurrent!==undefined&&(typeof assertCurrent!=='function'||this.config.channel!=='qq'))throw Object.assign(Error('Invalid connection guard.'),{code:'invalid_request'});
    const initialGeneration=this.generation;let connectionOwner=null;
    const checkConnection=()=>{
      this.assertNotForgetting();
      if(connectionOwner?this.generation!==connectionOwner.generation||this.controller!==connectionOwner.controller||connectionOwner.controller.signal.aborted:this.generation!==initialGeneration||assertCurrent&&this.status!=='disconnected')throw Object.assign(Error('The connection changed.'),{code:'changed'});
      if(!assertCurrent)return;
      const result=assertCurrent(connectionOwner?{phase:'connecting',...connectionOwner}:{phase:'preflight',generation:initialGeneration,controller:null});
      if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw Object.assign(Error('A synchronous connection guard is required.'),{code:'changed'});}
    };
    checkConnection();
    if(this.status==='connected'||this.status==='connecting')return;
    if(this.status!=='disconnected')throw Error('Finish pairing or wait for the previous task to stop first.');
    this.assertCredentialsAvailable();
    await this.closeInboundVoice();
    checkConnection();
    if(this.status!=='disconnected')throw Error('Connection state changed while stopping recognition.');
    if(!this.journal.available)throw Error(this.journal.snapshot().problem);
    const native=this.config.mode==='native',qq=this.config.channel==='qq',feishu=this.config.channel==='feishu',x=this.config.channel==='x',messenger=this.config.channel==='messenger',mode=this.config.mode;
    if(feishu&&native)throw Error('Feishu does not support the legacy Claude Channels backend. Choose program mode or an API.');
    const social=qq&&this.socialStore.config().enabled;
    if(social&&(!SUPPORTED_MODES.has(mode)||!this.socialStore.available))throw Error('陪伴模式当前支持本机 Claude、Claude API、GPT API、DeepSeek、Gemini 和豆包 API，并需要可用的本地记忆存储。');
    const ownerId=qq?this.config.qqOwnerId:feishu?this.config.feishuOwnerId:x?this.config.xOwnerId:messenger?this.config.messengerOwnerId:this.secret.ownerId;
    if(messenger){
      if(native)throw Error('Messenger does not support the legacy Claude Channels backend.');
      if(this.config.messengerOptedOut!==undefined&&this.config.messengerOptedOut!==false)throw Error('Messenger reception is stopped. Explicitly resume it locally, then connect.');
      MessengerPolicy.validateId(this.config.messengerAppId);MessengerPolicy.validateId(this.config.messengerPageId);MessengerPolicy.validateId(ownerId);MessengerPolicy.validateOrigin(this.config.messengerRelayOrigin);
      MessengerPolicy.validateToken(this.secret.messengerPageAccessToken);MessengerPolicy.validateToken(this.secret.messengerRelayToken,{relay:true});
      if(this.config.messengerPageId===ownerId)throw Error('The Messenger Page must differ from its owner.');
    }
    if(x){
      if(native)throw Error('X does not support the legacy Claude Channels backend.');
      if(this.config.xOptedOut!==undefined&&this.config.xOptedOut!==false)throw Error('X reception is stopped. Explicitly resume it locally, then connect.');
      XPolicy.validateXId(this.config.xAccountId);XPolicy.validateXId(ownerId);XPolicy.validateXToken(this.secret.xAccessToken);
      if(this.config.xAccountId===ownerId)throw Error('The X account must differ from its owner.');
    }
    if(!ownerId||!(qq?this.secret.qqToken:feishu?this.secret.feishuAppSecret&&this.config.feishuAppId:x?this.secret.xAccessToken:messenger?this.secret.messengerPageAccessToken&&this.secret.messengerRelayToken:this.secret.token)||(!social&&!this.config.workspace))throw Error(qq?'Choose a project and configure the QQ bridge and owner first.':feishu?'Choose a project and configure the Feishu application and owner open_id first.':x?'Choose a project and configure the X account, owner and user token first.':messenger?'Choose a project and configure the Messenger Page, owner and HTTPS relay first.':'Choose a project and pair WeChat first.');
    if(feishu){validateFeishuAppId(this.config.feishuAppId);validateFeishuOwner(ownerId);}
    if(['api','deepseek','gpt','gemini','doubao'].includes(mode)&&!this.secret[API_KEY_SLOT[mode]])throw Error('Save the selected provider’s API key first.');
    if(API_MODELS[mode]&&!API_MODELS[mode].models.includes(this.config[`${mode}Model`]||API_MODELS[mode].default))throw Error('Choose an available model for the selected API provider.');
    const workspace=social?path.join(this.root,'social-workspace'):this.config.workspace;
    if(social)fs.mkdirSync(workspace,{recursive:true});
    if(!fs.statSync(workspace).isDirectory())throw Error('Project folder is unavailable.');
    const selectedPersona=this.personaOptions(),persona={enabled:selectedPersona?.enabled === undefined || selectedPersona.enabled === true,selection:selectedPersona?.selection === 'sprout' ? 'sprout' : 'default'};
    this.imagePersona=personaForBackend(({native:'claude-native',claude:'claude-native',api:'claude-api',codex:'codex',deepseek:'deepseek',gpt:'gpt',gemini:'gemini',doubao:'doubao'})[mode]||'claude-api',persona.selection);
    this.status='connecting';this.problem='';this.inputProblem='';this.controller=new AbortController();
    if(qq)this.qqCheck=null;if(x)this.xCheck={state:'unverified'};if(messenger)this.messengerCheck={state:'unverified'};
    const signal=this.controller.signal,generation=++this.generation;
    connectionOwner={generation,controller:this.controller};
    this.incomingCount=0;this.outgoingAccepted=0;
    let client,startedBroker,preparedLaunch,releaseIdentity,deliveryOwner,ownedRequests,ownedDispatcher,ownedExecute,ownedNativeProcess,ready=false;
    const xSendFailure=error=>{
      if(!x||generation!==this.generation||signal.aborted)return;
      if(error?.code==='journal_unavailable'){
        this.problem=this.journal.snapshot().problem;client.close();this.controller.abort();this.dispatcher?.stop();void this.disconnect().catch(()=>{});return;
      }
      const code=XPolicy.codeOf(error);this.problem=XPolicy.problem(code);
      if(code==='rate_limited'){this.problem='';this.inputProblem='X 发送被限流，本条未提交且不会自动重发；接收仍可继续。请稍后发送新的请求。';this.changed();return;}
      if(code==='send_unknown'||XPolicy.FATAL.has(code)){
        this.xCheck={state:'failed',code,checkedAt:Date.now()};client.close();this.controller.abort();this.dispatcher?.stop();
        // Do not await the dispatcher from inside its own send. Stop prevents
        // /status from replaying an uncertain final via the generic dispatcher.
        void this.disconnect().catch(()=>{});
      }
    };
    const messengerSendFailure=error=>{
      if(!messenger||generation!==this.generation||signal.aborted)return;
      const code=MessengerPolicy.codeOf(error);
      if(code==='rate_limited'||code==='response_window_closed'){
        this.inputProblem=code==='rate_limited'?'Messenger 发送被限流，本条未提交且不会自动重发；接收仍可继续。':MessengerPolicy.problem(code);this.changed();return;
      }
      this.problem=error?.code==='journal_unavailable'?this.journal.snapshot().problem:MessengerPolicy.problem(code);
      this.messengerCheck={state:'failed',code,checkedAt:Date.now()};
      // Stop synchronously but never await this dispatcher's own send frame.
      client.close();this.controller.abort();this.dispatcher?.stop();void this.disconnect().catch(()=>{});
    };
    const sendFailure=error=>{xSendFailure(error);messengerSendFailure(error);};
    const send=async(text,contextToken)=>{
      const deliveryId=x||messenger?randomUUID():undefined;let receipt,recorded=false;
      try{
        if(x||messenger){this.journal.attemptDelivery(deliveryOwner,deliveryId);recorded=true;}
        receipt=await client.sendText(ownerId,text,contextToken,deliveryId,signal);
      }catch(error){
        if(recorded){try{this.journal.completeDelivery(deliveryOwner,deliveryId,error.code==='send_unknown'||error.submitted===true?'unknown':'not_submitted');}catch(storage){sendFailure(storage);}}
        sendFailure(error);throw error;
      }
      if(generation===this.generation&&!signal.aborted){this.outgoingAccepted++;this.changed();}
      if(recorded){try{this.journal.completeDelivery(deliveryOwner,deliveryId,'accepted');}catch(error){sendFailure(error);}}
      return receipt;
    };
    const onChange=()=>{if(generation===this.generation){
      try{this.journal.observe(this.dispatcher?.snapshot());}catch{this.problem=this.journal.snapshot().problem;}
      this.changed();
    }};
    try{
      checkConnection();
      if(qq)this.friendRequests=new FriendRequestInbox({getBinding:()=>this.imageBinding()});
      const friendRequests=this.friendRequests;ownedRequests=friendRequests;
      client=qq?this.qqClientFactory({url:this.config.qqUrl||'ws://127.0.0.1:3001',token:this.secret.qqToken,ownerId,expectedAccountId:this.config.qqAccountId,
        allowOwnerImage:social,
        allowOwnerVoice:social&&this.socialStore.config().qqVoiceMessages===true&&typeof this.inboundVoiceFactory==='function',
        onFriendRequest:(event,source)=>{if(generation===this.generation&&this.friendRequests===friendRequests)friendRequests.receive(event,source);}
      }):messenger?this.messengerClientFactory({appId:this.config.messengerAppId,pageId:this.config.messengerPageId,ownerId,pageAccessToken:this.secret.messengerPageAccessToken,relayOrigin:this.config.messengerRelayOrigin,relayToken:this.secret.messengerRelayToken}):x?this.xClientFactory({accessToken:this.secret.xAccessToken,expectedAccountId:this.config.xAccountId,ownerId,rateBudget:this.xRateBudgetFor(this.config.xAccountId)}):feishu?this.feishuClientFactory({appId:this.config.feishuAppId,appSecret:this.secret.feishuAppSecret,ownerId}):this.clientFactory({token:this.secret.token,ownerId,baseUrl:this.secret.baseUrl});
      this.client=client;await client.connect?.(signal);checkConnection();
      if(messenger){if(client.accountId!==this.config.messengerPageId||client.accountId===ownerId)throw Object.assign(Error('Messenger Page identity changed.'),{code:'page_changed'});if(!signal.aborted&&generation===this.generation)this.messengerCheck={state:'verified',checkedAt:Date.now()};}
      if(x){if(client.accountId!==this.config.xAccountId||client.accountId===ownerId)throw Object.assign(Error('X identity changed.'),{code:'account_mismatch'});if(!signal.aborted&&generation===this.generation)this.xCheck={state:'verified',checkedAt:Date.now()};}
      if(feishu){validateFeishuOwner(client.accountId);if(client.accountId===ownerId)throw Object.assign(Error('The Feishu bot cannot be its owner.'),{code:'account_changed'});}
      if(qq&&client.inspect){
        const result=await client.inspect(signal);
        checkConnection();
        if(generation===this.generation&&!signal.aborted)this.qqCheck={...result,state:'checked',checkedAt:Date.now()};
        if(result.online!==true)throw Object.assign(Error('QQ online status is not verified'),{code:result.online===false?'account_offline':'status_unverified'});
        if(result.ownerIsFriend===false)throw Object.assign(Error('QQ owner is not a friend'),{code:'owner_not_friend'});
      }
      if(signal.aborted||generation!==this.generation){await client.close?.();return;}
      checkConnection();
      if(messenger)deliveryOwner=MessengerPolicy.namespace(this.config.messengerAppId,client.accountId,ownerId);
      if(x)deliveryOwner=`x:${createHash('sha256').update(JSON.stringify([client.accountId,ownerId])).digest('hex')}`;
      releaseIdentity=this.claimIdentity({channel:this.config.channel,accountId:qq||x||messenger?client.accountId:feishu?`${this.config.feishuAppId}:${client.accountId}`:ownerId});this.releaseIdentity=releaseIdentity;
      if(native){
        if(!this.nativeFactory)throw Error('Native mode is unavailable in this environment.');
        const broker=await new NativeBroker({send,onChange,
          onCancel:()=>this.stopNative(),onResume:()=>this.resumeNative(),
          onClose:()=>{if(ready&&generation===this.generation){this.problem='电脑端连接已断开。请重新连接；旧消息和旧权限不会重放。';void this.disconnect();}}}).start();startedBroker=broker;
        checkConnection();
        if(signal.aborted||generation!==this.generation){await broker.close();return;}
        this.dispatcher=broker;ownedDispatcher=broker;
        const launch=await this.nativeFactory({root:this.root,workspace:this.config.workspace,url:broker.url,token:broker.token,persona});preparedLaunch=launch;
        checkConnection();
        if(signal.aborted||generation!==this.generation){launch.cleanup();await broker.close();return;}
        this.nativeLaunch=launch;broker.command=launch.command;this.nativeOptions={root:this.root,workspace:this.config.workspace,url:broker.url,token:broker.token,persona};
        const nativeProcess=this.nativeProcessFactory?await this.nativeProcessFactory({...launch,root:this.root}):null;ownedNativeProcess=nativeProcess;checkConnection();this.nativeProcess=nativeProcess;
        await nativeProcess?.refresh();checkConnection();
        if(signal.aborted||generation!==this.generation){launch.cleanup();await broker.close();return;}
      }else{
        const factory={api:this.runnerFactory,claude:this.claudeProgramRunnerFactory,codex:this.codexRunnerFactory,deepseek:this.deepseekRunnerFactory,gpt:this.gptRunnerFactory,gemini:this.geminiRunnerFactory,doubao:this.doubaoRunnerFactory}[mode];
        const execute=factory({workspace,...(mode==='claude'?{}:{key:this.secret[API_KEY_SLOT[mode]],model:API_MODELS[mode]?(this.config[`${mode}Model`]||API_MODELS[mode].default):mode==='deepseek'?(this.config.deepseekModel||'deepseek-flash'):undefined,configDir:path.join(this.root,'bot-agent'),budget:this.config.budget||1}),persona:social?{enabled:false,selection:'default'}:persona,...(social?{conversationOnly:true}:{})});
        this.execute=execute;ownedExecute=execute;
        if(social){
          if(!client.accountId||!client.sendProactiveText||!client.publishQzoneText||!client.getOwnQzonePost)throw Error('QQ social transport unavailable.');
          this.socialScope=scopeFor(client.accountId,ownerId,this.socialStore.config().characterId);
          const identityChanged=this.socialConsent&&this.socialConsent!==this.socialScope;
          if(identityChanged)this.socialStore.configure({proactiveMessages:false,qzonePosts:false});
          this.socialConsent=this.socialScope;atomicJSON(path.join(this.root,'social-consent.json'),{scope:this.socialScope});
          atomicJSON(path.join(this.root,'social-scope.json'),{scope:this.socialScope});
          const current=()=>generation===this.generation&&!signal.aborted&&this.status==='connected';
          this.dispatcher=new SocialCompanion({store:this.socialStore,scope:this.socialScope,execute,send,onChange,isOnline:current,
            sendProactive:async(text,id,abort)=>{if(!current())throw Error('Connection ended.');const receipt=await client.sendProactiveText(ownerId,text,id,AbortSignal.any([signal,abort]));if(current()){this.outgoingAccepted++;this.changed();}return receipt;},
            publishPost:async(text,id,abort)=>{if(!current())throw Error('Connection ended.');return client.publishQzoneText(text,{audience:'owner',clientId:id},AbortSignal.any([signal,abort]));},
            readPost:(id,abort)=>client.getOwnQzonePost(id,AbortSignal.any([signal,abort]))});
          if(identityChanged)this.dispatcher.problem='账号、联系人或角色已改变，主动活动已暂停。请核对后重新设置。';
        }else this.dispatcher=new Dispatcher({execute,send,onChange});
        ownedDispatcher=this.dispatcher;
      }
      checkConnection();
      ready=true;
      if(qq||feishu||x||messenger)this.status='connected';
      this.changed();checkConnection();
    // No auto-connect or replay after app restart. Old approvals cannot survive.
      const journalOwner=x||messenger?deliveryOwner:qq?`qq:${client.accountId}:${ownerId}`:feishu?`feishu:${createHash('sha256').update(JSON.stringify([this.config.feishuAppId,client.accountId,ownerId])).digest('hex')}`:ownerId;
      this.loop=this.poll(client,signal,this.dispatcher,generation,{ownerId,journalOwner,channel:this.config.channel,xSendFailure,sendX:send,messengerSendFailure,sendMessenger:send});return;
    }catch(error){
      if(assertCurrent){
        // Retire only objects created by this invocation. Cleanup can await;
        // a newer connection must survive every late completion below.
        connectionOwner.controller.abort();
        if(this.friendRequests===ownedRequests)this.friendRequests=null;
        const cleanup=await Promise.allSettled([Promise.resolve().then(()=>ownedRequests?.close()),Promise.resolve().then(()=>ownedDispatcher?.stop()),Promise.resolve().then(()=>startedBroker?.close()),Promise.resolve().then(()=>ownedExecute?.close?.()),Promise.resolve().then(()=>client?.close?.()),Promise.resolve().then(()=>{if(ownedNativeProcess?.snapshot().owned)return ownedNativeProcess.stop();})]);
        preparedLaunch?.cleanup();releaseIdentity?.();
        if(this.releaseIdentity===releaseIdentity)this.releaseIdentity=null;
        if(this.client===client&&cleanup[4].status==='fulfilled')this.client=null;if(this.dispatcher===ownedDispatcher&&cleanup[1].status==='fulfilled'&&cleanup[2].status==='fulfilled')this.dispatcher=null;if(this.execute===ownedExecute&&cleanup[3].status==='fulfilled')this.execute=null;
        if(this.nativeLaunch===preparedLaunch)this.nativeLaunch=null;if(this.nativeProcess===ownedNativeProcess&&cleanup[5].status==='fulfilled')this.nativeProcess=null;
        if(generation!==this.generation||this.controller!==connectionOwner.controller)throw Object.assign(Error('The QQ connection changed.'),{code:'changed'});
        const cleanupFailed=cleanup.some(row=>row.status==='rejected');
        if(cleanup[0].status==='rejected'&&!this.friendRequests)this.friendRequests=ownedRequests;
        this.status=cleanupFailed?'disconnecting':'disconnected';this.problem=cleanupFailed?'连接清理尚未确认，请再次断开后再连接。':qqConnectionProblem(error.code);this.changed();
        return;
      }
      preparedLaunch?.cleanup();await startedBroker?.close();await client?.close?.();releaseIdentity?.();if(this.releaseIdentity===releaseIdentity)this.releaseIdentity=null;if(generation===this.generation){this.controller.abort();await this.closeFriendRequests();this.nativeLaunch=null;this.status='disconnected';if(messenger)this.messengerCheck={state:'failed',code:MessengerPolicy.codeOf(error),checkedAt:Date.now(),...(error.code==='rate_limited'?{retryAt:MessengerPolicy.retryAt(error)}:{})};if(x)this.xCheck={state:'failed',code:XPolicy.codeOf(error),checkedAt:Date.now(),...(error.code==='rate_limited'?{retryAt:XPolicy.retryAt(error)}:{})};this.problem=error.code==='account_in_use'?'This social account is already connected by another companion.':x?(error.code==='rate_limited'?'X API 已限流，本次未连接。请等到允许时间后手动连接；应用不会自动重试此启动。':XPolicy.problem(XPolicy.codeOf(error))):messenger?(error.code==='rate_limited'?'Messenger API 已限流，本次未连接。请到允许时间后手动连接；不会自动重试启动。':MessengerPolicy.problem(MessengerPolicy.codeOf(error))):qq?qqConnectionProblem(error.code):feishu?feishuConnectionProblem(error.code):native?'Could not prepare local mode. Install Node.js 22.13+ and Claude Code 2.1.317+, then retry.':'Could not start the bot. Check the project and saved connection.';this.changed();}return;
    }
  }
  async poll(client,signal,dispatcher,generation,{ownerId=this.secret.ownerId,journalOwner=ownerId,channel='wechat',xSendFailure=()=>{},sendX,messengerSendFailure=()=>{},sendMessenger}={}){
    let cursor='',failures=0,voiceClientGeneration=client.generation,voiceSocket=client.socket;
    while(!signal.aborted){
      try {
        const batch=await client.getUpdates(cursor,signal);if(signal.aborted||generation!==this.generation)break;
        let messages=batch.messages;
        if(channel==='messenger'){
          if(!Array.isArray(messages)||messages.length>50||messages.some(row=>!row||row.from!==ownerId)||new Set(messages.map(row=>row.id)).size!==messages.length||
            (messages.length?!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(batch.deliveryId):batch.deliveryId!==null))throw Object.assign(Error('Invalid Messenger batch.'),{code:'invalid_response'});
          if(messages.length){
            const rows=messages.map(message=>({rawId:message.id,message:{...message,id:MessengerPolicy.messageKey(message.id)}}));
            const claims=this.journal.claimBatch(journalOwner,rows.map(row=>row.message.id),this.config.mode);
            const claimed=new Set(claims.claimedIds),newIds=new Set(claims.newIds),rawToKey=new Map(rows.map(row=>[row.rawId,row.message.id]));
            messages=rows.filter(row=>newIds.has(row.message.id)).map(row=>row.message);
            // Stopping locally is not dispatch. Honor a newly claimed direct
            // owner opt-out immediately, without waiting for any network ACK.
            // The relay batch remains unacknowledged; durable IDs prevent replay.
            const stop=messages.find(message=>!message.unsupported&&!message.quote&&typeof message.text==='string'&&message.text.trim()==='/unsubscribe');
            if(stop){
              this.config={...this.config,messengerOptedOut:true};client.close();this.controller.abort();dispatcher.stop();
              this.messengerCheck={state:'stopped',code:'unsubscribed',checkedAt:Date.now()};this.incomingCount++;
              try{atomicJSON(path.join(this.root,'bot-config.json'),this.config);this.problem='已按主人要求停止 Messenger 接收；需在本机明确重新启用后再手动连接。';}
              catch{this.messengerCheck={state:'stopped',code:'optout_save_failed',checkedAt:Date.now()};this.problem='Messenger 接收已停止，但退出设置未能保存。请修复本机存储；不要在重启后连接 Messenger。';}
              try{for(const message of messages)this.journal.disposition(journalOwner,message.id,message===stop?'command_handled':'cancelled');}
              catch{this.problem+=' 退出事件的恢复记录无法保存，请检查本机存储。';}
              await this.disconnect();return;
            }
            const acknowledgement=await client.acknowledge(batch.deliveryId,{signal,durablyClaimed:id=>!signal.aborted&&generation===this.generation&&client===this.client&&claimed.has(rawToKey.get(id))});
            if(acknowledgement?.acknowledged!==true)throw Object.assign(Error('Messenger acknowledgement is unconfirmed.'),{code:'ack_unknown'});
            if(signal.aborted||generation!==this.generation||client!==this.client)break;
          }
        }
        // Reconnecting the same client object still invalidates its old idle
        // model. Never retain one across an unobserved socket generation.
        if(channel==='qq'&&(voiceClientGeneration!==client.generation||voiceSocket!==client.socket)){
          dispatcher?.cancelImages?.();
          try{await this.closeInboundVoice();}catch{this.inputProblem='语音识别停止尚未确认；文字聊天仍可继续。';this.changed();}
          if(signal.aborted)break;voiceClientGeneration=client.generation;voiceSocket=client.socket;
        }
        cursor=batch.cursor;failures=0;this.status='connected';this.problem='';if(channel==='x')this.xCheck={state:'verified',checkedAt:Date.now()};if(channel==='messenger')this.messengerCheck={state:'verified',checkedAt:Date.now()};this.changed();
        for(const message of messages){
          if(signal.aborted)break;
          // Commit receipt before any command/model dispatch. A crash in the gap
          // becomes an uncertain recovery record, never an automatic replay.
          if(channel!=='messenger'&&!this.journal.claim(journalOwner,message.id,this.config.mode))continue;
          this.incomingCount++;this.changed();
          if(channel==='x'&&message.from===ownerId&&!message.unsupported&&!message.quote&&typeof message.text==='string'&&message.text.trim()==='/unsubscribe'){
            // This direct owner command stops pending work before any further
            // send. No acknowledgement DM is sent. The local flag survives
            // restart and only the explicit disconnected resume action clears it.
            this.config={...this.config,xOptedOut:true};client.close();this.controller.abort();dispatcher.stop();
            this.xCheck={state:'stopped',code:'unsubscribed',checkedAt:Date.now()};
            try{atomicJSON(path.join(this.root,'bot-config.json'),this.config);this.problem='已按主人要求停止 X 接收；重新启用需在本机明确操作后再连接。';}
            catch{this.problem='X 接收已停止，但退出设置未能保存。请修复本机存储；不要在重启后连接 X。';}
            try{this.journal.disposition(journalOwner,message.id,'command_handled');}catch{this.problem='X 接收已停止，但退出事件的恢复记录无法保存。请检查本机存储。';}
            await this.disconnect();return;
          }
          if(channel==='qq'&&message.voice){this.receiveInboundVoice(message,{client,signal,dispatcher,generation,journalOwner});continue;}
          // A newer text message supersedes pending transcription. It must not
          // arrive after that text as a stale reply or interpreted command.
          if(this.inboundVoiceTask){try{await this.closeInboundVoice();}catch{this.inputProblem='语音识别停止尚未确认；文字聊天仍可继续。';this.changed();}}
          else if(this.inboundVoiceIdle){
            // A clean idle model has no transcript to race this text. Closing
            // it can take seconds, so retain the close promise but do not
            // delay ordinary chat. Further voice messages stay busy.
            const cleanupGeneration=client.generation,cleanupSocket=client.socket;
            void this.closeInboundVoice().catch(()=>{
              if(!signal.aborted&&generation===this.generation&&client===this.client&&dispatcher===this.dispatcher&&this.status==='connected'&&client.generation===cleanupGeneration&&client.socket===cleanupSocket){this.inputProblem='语音识别停止尚未确认；文字聊天仍可继续。';this.changed();}
            });
          }
          if(signal.aborted)break;
          if(channel==='qq'&&message.image){await this.receiveInboundImage(message,{client,signal,dispatcher,generation,journalOwner});continue;}
          const prepared=channel==='qq'?prepareQQInbound(message):channel==='feishu'?prepareFeishuInbound(message):channel==='x'?prepareXInbound(message):channel==='messenger'?prepareMessengerInbound(message):prepareInbound(message);
          if(prepared.rejection){
            this.journal.disposition(journalOwner,message.id,'rejected');
            this.inputProblem=prepared.rejection;this.changed();
            try{
              if(channel==='x')await sendX(prepared.rejection,message.contextToken);
              else if(channel==='messenger')await sendMessenger(prepared.rejection,message.contextToken);
              else await client.sendText(ownerId,prepared.rejection,message.contextToken,undefined,signal);
              if(channel!=='x'&&channel!=='messenger'&&!signal.aborted){this.outgoingAccepted++;this.changed();}
            }catch(error){
              if(channel==='x')xSendFailure(error);if(channel==='messenger')messengerSendFailure(error);
              if(signal.aborted)break;
              this.inputProblem=`${prepared.rejection}\n这条说明未能回传到${channel==='qq'?'QQ':channel==='feishu'?'飞书':channel==='x'?'X':channel==='messenger'?'Messenger':'微信'}，请在本机查看；原消息没有作为任务执行。`;this.changed();
              if(error.code==='session_expired')throw error;
            }
            continue;
          }
          this.inputProblem='';
          const before=dispatcher.seq;
          const result=await dispatcher.receive(prepared);
          const task=result?.taskId&&dispatcher.snapshot().tasks.find(value=>value.id===result.taskId);
          const state=task?.state||(result?.status||isControlText(prepared.text)?'command_handled':
            this.config.mode==='native'&&dispatcher.seq>before?'forwarded_unverified':'rejected');
          this.journal.disposition(journalOwner,message.id,state,task?.id||null);
          this.journal.observe(dispatcher.snapshot());this.changed();
        }
        await pause(500,signal);
      }catch(error){
        if(signal.aborted)break;
        if(error.code==='journal_unavailable'){this.problem=this.journal.snapshot().problem;this.changed();break;}
        if(channel==='messenger'){
          const code=MessengerPolicy.codeOf(error);this.problem=MessengerPolicy.problem(code);
          if(code==='rate_limited'){
            const retryAt=MessengerPolicy.retryAt(error);this.messengerCheck={state:'rate_limited',code,retryAt,checkedAt:Date.now()};this.status='connecting';this.changed();
            await pause(Math.max(0,retryAt-Date.now()),signal);continue;
          }
          this.messengerCheck={state:'failed',code,checkedAt:Date.now()};client.close();dispatcher.stop();this.changed();break;
        }
        if(channel==='x'){
          const code=XPolicy.codeOf(error);this.problem=XPolicy.problem(code);
          if(code==='rate_limited'){
            const retryAt=XPolicy.retryAt(error);this.xCheck={state:'rate_limited',code,retryAt,checkedAt:Date.now()};this.status='connecting';this.changed();
            await pause(Math.max(0,retryAt-Date.now()),signal);continue;
          }
          // X never starts a generic reconnect storm. Fatal identity/auth or
          // ambiguous protocol failures require an explicit new connection.
          this.xCheck={state:'failed',code,checkedAt:Date.now()};this.changed();break;
        }
        failures++;this.status='connecting';this.problem=channel==='qq'?qqConnectionProblem(error.code,{retrying:true}):channel==='feishu'?feishuConnectionProblem(error.code,{retrying:true}):'WeChat is unavailable. Retrying; the task state is preserved locally.';this.changed();
        if(channel==='qq'){dispatcher?.cancelImages?.();try{await this.closeInboundVoice();}catch{this.inputProblem='语音识别停止尚未确认；文字聊天仍可继续。';this.changed();}}
        if(error.code==='session_expired'){this.problem='WeChat authorization expired. Pair WeChat again.';break;}
        if(channel==='qq'&&error.code==='login_required')break;
        if(channel==='qq'&&error.code==='account_mismatch')break;
        if(channel==='feishu'&&['account_changed','queue_overflow','permission_denied','invalid_response','closed'].includes(error.code)){this.problem=feishuConnectionProblem(error.code);break;}
        if(channel!=='feishu'&&['account_changed','unauthorized','invalid_owner'].includes(error.code)){this.problem='QQ bridge identity or authorization changed. Check its account and reconnect explicitly.';break;}
        if(failures>=5){this.problem=channel==='qq'?qqConnectionProblem(error.code,{exhausted:true}):channel==='feishu'?'飞书连接在多次检查后仍未恢复，已停止接收。请检查应用设置并明确重新连接，旧任务不会重放。':'WeChat connection stopped after five failures. Check the connection settings.';break;}
        await pause(Math.min(30000,1000*2**failures),signal);
      }
    }
    if(!signal.aborted&&generation===this.generation){
      await this.disconnect();
    }
  }
  nativeAction(action){
    if(this.nativeOperation)return Promise.reject(Error('正在处理本机会话，请稍候。'));
    const operation=Promise.resolve().then(async()=>{await this.nativeProbe;return action();});
    this.nativeOperation=operation;this.changed();
    return operation.finally(()=>{if(this.nativeOperation===operation)this.nativeOperation=null;this.changed();});
  }
  startNative({resume=false}={}){
    if(typeof resume!=='boolean')return Promise.reject(Error('Invalid resume selection.'));
    return this.nativeAction(async()=>{
      if(this.config.mode!=='native'||!['connecting','connected'].includes(this.status)||!this.nativeProcess||!this.nativeOptions)throw Error('请先连接微信，再打开本机 Claude。');
      const broker=this.dispatcher,manager=this.nativeProcess,generation=this.generation;
      if(broker.closed||broker.clientId)throw Error('已有 Claude 连接。请先停止当前会话。');
      await manager.refresh();
      if(generation!==this.generation||broker.closed)throw Error('连接已结束，请重新连接。');
      const process=manager.snapshot();
      if(['running','unknown','starting'].includes(process.status))throw Error('请先在原终端完成启动或停止当前 Claude，再打开另一会话。');
      if(resume&&!process.canResume)throw Error('上次会话尚未确认停止，暂时不能恢复。');
      const resumeSessionId=resume?manager.getResumeSessionId():undefined;
      if(resume&&!resumeSessionId)throw Error('没有可恢复的本机会话，请先在桌面打开 Claude。');
      const launch=await this.nativeFactory({...this.nativeOptions,...(resume?{resumeSessionId}:{})});
      if(generation!==this.generation||broker.closed){launch.cleanup();throw Error('连接已结束，请重新连接。');}
      const previous=this.nativeLaunch;this.nativeLaunch=launch;previous?.cleanup();
      broker.resetChannel({paused:false});broker.command=launch.command;broker.managedDetach=false;
      try{await manager.start(launch);}catch(error){broker.pause();throw error;}
      // Disconnect may have been requested while Windows opened the console.
      // Its barrier below waits for this operation before stopping that exact process.
      if(generation!==this.generation)throw Error('连接已结束，正在清理刚启动的会话。');
      const started=manager.snapshot();
      if(started.owned&&started.status==='running')broker.renewStartupLease();
      this.watchNative();
      this.problem='';this.changed();return this.snapshot();
    });
  }
  async resumeNative(){
    await this.startNative({resume:true});
    return '已打开上次会话。若电脑端需要确认，请先完成确认，再发新消息；之前未处理的消息不会重放。';
  }
  watchNative(){
    clearInterval(this.nativeTimer);
    this.nativeTimer=setInterval(()=>{void this.refreshNative();},5000);this.nativeTimer.unref();
  }
  refreshNative(){
    if(this.nativeProbe)return this.nativeProbe;
    if(this.nativeOperation||!['connected','connecting'].includes(this.status)||!this.nativeProcess?.snapshot().owned)return Promise.resolve();
    const manager=this.nativeProcess,broker=this.dispatcher,generation=this.generation;
    const probe=Promise.resolve().then(async()=>{
      await manager.refresh();
      if(generation!==this.generation||broker!==this.dispatcher||broker.closed)return;
      const process=manager.snapshot();
      if(process.owned&&process.status==='running')broker.renewStartupLease();
      if(process.status==='exited'){
        broker.resetChannel({paused:true});
        this.problem='Claude 已退出。可以尝试恢复；若尚未创建会话，请打开新会话。';
      }
      this.changed();
    }).catch(()=>{if(generation===this.generation){this.problem='暂时无法检查 Claude 进程，请查看原终端。';this.changed();}});
    this.nativeProbe=probe;
    return probe.finally(()=>{if(this.nativeProbe===probe)this.nativeProbe=null;});
  }
  stopNative(){
    return this.nativeAction(async()=>{
      if(this.config.mode!=='native'||!this.dispatcher||this.dispatcher.closed)throw Error('请先连接本机模式。');
      const broker=this.dispatcher,manager=this.nativeProcess;
      broker.pause();
      if(!manager?.snapshot().owned){
        if(['stopped','exited'].includes(manager?.snapshot().status))return '这次 Claude 会话已经停止。可发“恢复会话”继续；独立后台作业是否停止尚未确认。';
        return '已暂停接收新任务。这个 Claude 不是由当前应用启动的，无法确认它已停止；请在原终端按 Ctrl+C。';
      }
      broker.managedDetach=true;
      try{await manager.stop();}catch{this.problem='未能确认 Claude 已停止，请查看原终端。';this.changed();throw Error(this.problem);}
      broker.resetChannel({paused:true});this.changed();
      return '已停止这次 Claude 会话，可发“恢复会话”继续。独立后台作业是否停止尚未确认。';
    });
  }
  closeFriendRequests(){const inbox=this.friendRequests;this.friendRequests=null;return inbox?.close()||Promise.resolve();}
  inboundImageBinding(){
    const binding=this.imageBinding(),settings=this.socialStore.config();
    if(!(this.dispatcher instanceof SocialCompanion)||!settings.enabled)throw new CompanionImageError('changed');
    return {...binding,dispatcher:this.dispatcher,socket:this.client.socket,clientGeneration:this.client.generation,
      fingerprint:JSON.stringify([this.socialScope,settings.characterId,settings.name,settings.description,settings.qqImageMessages,this.config.mode,this.config[this.config.mode+'Model']||'']),
      enabled:settings.qqImageMessages!==false,mode:this.config.mode,model:this.config[this.config.mode+'Model']||({gpt:DEFAULT_GPT_MODEL,deepseek:'deepseek-flash'})[this.config.mode],
      url:this.config.qqUrl||'ws://127.0.0.1:3001',token:this.secret.qqToken};
  }
  async receiveInboundImage(message,{client,signal,dispatcher,generation,journalOwner}){
    // This is already the poll loop's durable inbound claim. Admission returns
    // before media/model work, leaving literal Stop/new messages observable.
    let captured,descriptor=message.image,retired=false,source;
    const assertCurrent=taskSignal=>{
      if(retired||signal.aborted||taskSignal?.aborted)throw new CompanionImageError('cancelled');
      let next;try{next=this.inboundImageBinding();}catch{throw new CompanionImageError('changed');}
      if(generation!==this.generation||client!==this.client||dispatcher!==this.dispatcher||
        ['client','dispatcher','socket','clientGeneration','generation','accountId','ownerId','scopeId','fingerprint','url','token'].some(key=>next[key]!==captured[key]))throw new CompanionImageError('changed');
    };
    try{
      captured=this.inboundImageBinding();
      source={kind:'qq-owner-image',quoted:descriptor?.kind==='qq-owner-quote',assertCurrent,release:()=>{retired=true;descriptor=null;},load:async taskSignal=>{
        const combined=AbortSignal.any([signal,taskSignal]);assertCurrent(combined);
        // Text references do not need vision or image consent. Their fixed
        // same-owner lookup cannot turn them into tool/authorization commands.
        const assertImageAllowed=()=>{assertCurrent(combined);
          if(!captured.enabled)throw new CompanionImageError('disabled');
          if(!imageCapability(captured.mode,captured.model))throw new CompanionImageError(captured.mode==='deepseek'&&captured.model==='deepseek-v4-pro'?'pro_no_vision':'unsupported_model');
          if(!this.inboundImagePrepare)throw new CompanionImageError('unavailable');
        };
        if(descriptor?.kind!=='qq-owner-quote')assertImageAllowed();
        let raw,prepared,imagePolicyError;
        try{
          const reader=this.inboundImageReaderFactory();
          raw=await reader.read(descriptor,{url:captured.url,token:captured.token,signal:combined,assertCurrent:()=>assertCurrent(combined),assertImageAllowed:()=>{try{assertImageAllowed();}catch(error){imagePolicyError=error;throw error;}}});assertCurrent(combined);
          if(source.quoted&&raw?.kind==='qq-quoted-text'&&Object.keys(raw).length===1){raw=null;return {kind:'qq-quoted-text',release:()=>{}};}
          if(!Buffer.isBuffer(raw))throw new CompanionImageError('invalid_image');
          prepared=this.inboundImagePrepare(raw,raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':'.jpg');
          if(!prepared||!Buffer.isBuffer(prepared.bytes))throw new CompanionImageError('invalid_image');
          assertCurrent(combined);const bytes=prepared.bytes,width=prepared.width,height=prepared.height;prepared=null;let released=false;
          return {mimeType:'image/png',bytes,width,height,release:()=>{if(!released){released=true;bytes.fill(0);}}};
        }catch(error){
          prepared?.bytes?.fill(0);assertCurrent(combined);if(imagePolicyError)throw imagePolicyError;
          if(error instanceof CompanionImageError)throw error;
          throw new CompanionImageError(['source_too_large','response_too_large','image_too_large'].includes(error?.code)?'too_large':['image_invalid','image_format','image_animated'].includes(error?.code)?'invalid_image':source.quoted?'quote_source_failed':'source_failed');
        }finally{if(Buffer.isBuffer(raw))raw.fill(0);}
      }};
      const result=await dispatcher.receiveImage({id:message.id,text:message.text||'',contextToken:message.contextToken,...(source.quoted?{quote:message.quote}:{})},source);
      const task=result?.taskId&&dispatcher.snapshot().tasks.find(value=>value.id===result.taskId);
      this.journal.disposition(journalOwner,message.id,task?.state||'rejected',task?.id||null);this.journal.observe(dispatcher.snapshot());this.changed();
    }catch(error){source?.release();this.journal.disposition(journalOwner,message.id,'rejected');if(!signal.aborted&&generation===this.generation){this.inputProblem='这张图片没有处理，请重新发送单张 JPG 或 PNG。';this.changed();}}
  }
  inboundVoiceBinding(){
    const binding=this.imageBinding();
    if(!(this.dispatcher instanceof SocialCompanion)||!this.socialStore.config().qqVoiceMessages)throw Object.assign(Error('QQ voice is not enabled for this companion.'),{code:'wrong_scope'});
    return {...binding,companion:true,dispatcher:this.dispatcher,url:this.config.qqUrl||'ws://127.0.0.1:3001',token:this.secret.qqToken};
  }
  async closeInboundVoiceIdle(cleanup=this.inboundVoiceIdle){
    if(!cleanup)return;
    // This handle captures only the original gate lease. After a new job
    // claims its resource, closing this old handle is deliberately a no-op.
    try{await cleanup.close();}catch{throw Object.assign(Error('Voice cleanup is unconfirmed.'),{code:'asr_exit_unconfirmed'});}
    if(this.inboundVoiceIdle===cleanup)this.inboundVoiceIdle=null;
  }
  async takeInboundVoiceIdle(pipeline){
    const cleanup=pipeline.idleCleanup;if(!cleanup)return null;
    if(typeof cleanup.close!=='function')throw Object.assign(Error('Invalid voice cleanup.'),{code:'asr_cleanup_unconfirmed'});
    // Do not overwrite an unknown prior close. The global gate makes a
    // resumed job's old handle stale, so this normally closes no process.
    if(this.inboundVoiceIdle&&this.inboundVoiceIdle!==cleanup)await this.closeInboundVoiceIdle(this.inboundVoiceIdle);
    this.inboundVoiceIdle=cleanup;pipeline.idleCleanup=null;return cleanup;
  }
  closeInboundVoice(){
    if(this.inboundVoiceClosing)return this.inboundVoiceClosing;
    const task=this.inboundVoiceTask;task?.controller.abort();
    const operation=Promise.resolve().then(async()=>{
      let error;
      if(task){try{await task.pipeline.close();}catch(cause){error=cause;}
        // The service may already own the parked handle while the companion
        // enqueue is awaiting persistence. Stop that resource before waiting
        // for the handoff, then check again for a concurrent late transfer.
        try{await this.closeInboundVoiceIdle();}catch(cause){error ||= cause;}await task.promise;
        if(!task.pipeline.busy&&!task.pipeline.idleCleanup&&this.inboundVoiceTask===task)this.inboundVoiceTask=null;}
      try{await this.closeInboundVoiceIdle();}catch(cause){error ||= cause;}
      if(error)throw error;
    });
    this.inboundVoiceClosing=operation.finally(()=>{if(this.inboundVoiceClosing===closing)this.inboundVoiceClosing=null;});
    const closing=this.inboundVoiceClosing;return closing;
  }
  receiveInboundVoice(message,{client,signal,dispatcher,generation,journalOwner}){
    let binding;
    const current=()=>!signal.aborted&&generation===this.generation&&client===this.client&&dispatcher===this.dispatcher&&this.status==='connected';
    const reject=(code)=>{
      this.journal.disposition(journalOwner,message.id,'rejected');
      if(current()){
        this.inputProblem=code==='busy'?'上一次语音识别尚未结束。请稍后重发，或用文字聊天。':code==='asr_unavailable'?'本机 QQ 语音识别尚未配置，请先用文字聊天。':code==='asr_exit_unconfirmed'||code==='asr_cleanup_unconfirmed'?'无法确认上次语音识别已结束。请断开后重新连接；暂未处理这条语音。':'这条语音没有识别成功，请改用文字或稍后重发。';this.changed();
        const busyOwner=this.inboundVoiceTask||this.inboundVoiceClosing;
        if(code==='busy'&&busyOwner?.notifiedBusy)return;
        if(code==='busy'&&busyOwner)busyOwner.notifiedBusy=true;
        const text=code==='busy'?'上一条语音还没处理完，请稍后再发，或直接发文字。':'这条语音没能识别出来，可以先发文字吗？';
        void client.sendText(binding?.ownerId||this.config.qqOwnerId,text,message.contextToken,undefined,signal).then(()=>{if(current()){this.outgoingAccepted++;this.changed();}}).catch(()=>{});
      }
    };
    if(this.inboundVoiceTask||this.inboundVoiceClosing){reject('busy');return;}
    try{binding=this.inboundVoiceBinding();binding={...binding,clientGeneration:client.generation,socket:client.socket};if(!this.inboundVoiceFactory||this.inboundVoiceAvailability().available!==true)throw Object.assign(Error('ASR unavailable'),{code:'asr_unavailable'});}catch(error){reject(error?.code);return;}
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let claimed=false;
    // The poll loop already durably claimed this exact message. The pipeline's
    // one-use claim adapter acknowledges that claim without writing it twice.
    let pipeline;
    try{pipeline=this.inboundVoiceFactory({getBinding:()=>this.inboundVoiceBinding(),claim:(scope,id)=>{if(claimed||scope!==binding.scopeId||id!==message.id)return false;claimed=true;return true;},
      disposition:(scope,id,state)=>{if(scope!==binding.scopeId||id!==message.id)throw Error('Voice journal identity changed.');this.journal.disposition(journalOwner,id,state);}});
      if(!pipeline||typeof pipeline.process!=='function'||typeof pipeline.close!=='function')throw Error('Invalid voice pipeline.');
    }catch{reject('asr_unavailable');return;}
    dispatcher.preempt();dispatcher.cancelQueued();
    const task={controller,pipeline,promise:null};this.inboundVoiceTask=task;
    task.promise=Promise.resolve().then(async()=>{
      let idle=null,keepIdle=false;
      const exactBinding=()=>{
        if(!current()||combined.aborted)return false;
        const next=this.inboundVoiceBinding();
        return next.scopeId===binding.scopeId&&next.accountId===binding.accountId&&next.ownerId===binding.ownerId&&next.generation===binding.generation&&next.client===client&&client.generation===binding.clientGeneration&&client.socket===binding.socket;
      };
      try{
        const result=await pipeline.process(message.voice,{signal:combined,acceptAfter:client.acceptAfter});
        idle=await this.takeInboundVoiceIdle(pipeline);
        if(!exactBinding())throw Object.assign(Error('Voice binding changed.'),{code:'account_changed'});
        if(result?.outcome!=='transcribed'||result.id!==message.id||result.target!=='companion-chat-only'||result.allowCommands!==false)throw Error('Invalid voice result.');
        this.inputProblem='';
        const queued=await dispatcher.receiveVoice({id:message.id,text:result.text,contextToken:message.contextToken});
        const entry=queued?.taskId&&dispatcher.snapshot().tasks.find(value=>value.id===queued.taskId);
        this.journal.disposition(journalOwner,message.id,entry?.state||'rejected',entry?.id||null);this.journal.observe(dispatcher.snapshot());this.changed();
        keepIdle=queued?.accepted===true&&exactBinding();
      }catch(error){if(!combined.aborted&&current())reject(error?.code);else this.journal.disposition(journalOwner,message.id,'rejected');}
      finally{
        if(!keepIdle){
          try{if(idle)await this.closeInboundVoiceIdle(idle);if(pipeline.idleCleanup)await pipeline.closeIdle();}
          catch{if(current()){this.inputProblem='无法确认语音识别进程已停止；请断开后重新连接以重试清理。';this.changed();}}
        }
        // A failed untransferred cleanup stays reachable through the active
        // task for retry. Successful idle state never retains that task or its
        // message/pipeline closure: only the minimal lease handle above.
        if(!pipeline.busy&&!pipeline.idleCleanup&&this.inboundVoiceTask===task)this.inboundVoiceTask=null;
      }
    }).catch(()=>{if(current()){this.problem=this.journal.snapshot().problem||'语音记录未能保存，请断开后检查本地存储。';this.changed();}});
  }
  async disconnect(){
    const localStopped=this.localStop();
    const generation=++this.generation,dispatcher=this.dispatcher,launch=this.nativeLaunch,execute=this.execute,client=this.client,releaseIdentity=this.releaseIdentity;
    this.qqTestController?.abort();if(this.qqCheck?.state==='checking')this.qqCheck=null;
    clearInterval(this.nativeTimer);this.loginController?.abort();this.controller?.abort();const stopped=dispatcher?.stop(),imagesStopped=this.resetImages(),voicesStopped=this.resetVoices(),requestsStopped=this.closeFriendRequests(),inboundStopped=this.closeInboundVoice();
    this.status='disconnecting';this.qr=null;if(this.config.channel==='messenger'&&['verified','unverified','rate_limited'].includes(this.messengerCheck?.state))this.messengerCheck={state:'stopped',code:'closed',checkedAt:Date.now()};if(this.config.channel==='x'&&['verified','unverified','rate_limited'].includes(this.xCheck?.state))this.xCheck={state:'stopped',code:'closed',checkedAt:Date.now()};this.changed();
    let localError;try{await localStopped;}catch(error){localError=error;}await stopped;await imagesStopped;await voicesStopped;await requestsStopped;let inboundError;try{await inboundStopped;}catch(error){inboundError=error;}await this.qqTestOperation?.catch(()=>{});await this.nativeOperation?.catch(()=>{});await this.nativeProbe;
    // Only the exact process launched by this app instance can be stopped here.
    if(this.nativeProcess?.snapshot().owned){try{await this.nativeProcess.stop();}catch{this.problem='微信已断开，但未能确认本机 Claude 停止，请查看原终端。';}}
    await dispatcher?.whenIdle();await execute?.close?.();await client?.close?.();
    releaseIdentity?.();if(this.releaseIdentity===releaseIdentity)this.releaseIdentity=null;
    if(this.execute===execute)this.execute=null;if(this.client===client)this.client=null;
    launch?.cleanup();if(this.nativeLaunch===launch)this.nativeLaunch=null;
    if(generation===this.generation&&this.journal.available){try{this.journal.observe(dispatcher?.snapshot?.());}catch{this.problem=this.journal.snapshot().problem;}}
    if(generation===this.generation){this.status='disconnected';if(inboundError)this.problem='未能确认语音识别进程已停止，识别暂不可用；重新连接前会再次核对。';this.changed();}
    if(localError)throw localError;
  }
  async forget(){
    this.assertNotForgetting();this.forgetting=true;
    // Disconnect can yield while a second disconnect makes the UI editable.
    // Keep the credential operation owned until every awaited cleanup settles.
    try{await this.disconnect();if(fs.existsSync(this.file))fs.unlinkSync(this.file);this.secret={};this.credentialState='empty';this.credentialProblem='';this.vaultFingerprint=null;this.qqCheck=null;this.xCheck=null;this.messengerCheck=null;if(this.journal.available)this.journal.clear();this.dispatcher=null;this.incomingCount=0;this.outgoingAccepted=0;this.inputProblem='';this.changed();}
    finally{this.forgetting=false;}
  }
}
module.exports={BotService};
