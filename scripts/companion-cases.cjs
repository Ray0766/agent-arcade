'use strict';
// Fixed offline cases against the selected production modules. No App, user profile,
// native credential vault, external transport or real model is opened by this harness.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const FIXTURE=path.resolve(__dirname,'../test/fixtures/companion-cases.json');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('The bounded fixture wait expired.');await pause();}}
function personaData(persona={}){return {name:String(persona.name||''),description:String(persona.description||'')};}
function referenceContext(rows,{budgetChars=6000,historyMessages=20,persona}={}){
 const kept=rows.slice(-historyMessages).map(({role,text})=>({role,text})),render=()=>JSON.stringify({persona:personaData(persona),messages:kept});
 while(kept.length&&render().length>budgetChars)kept.shift();
 if(render().length>budgetChars)throw Error('The fixed persona does not fit the reference budget.');
 return render();
}
function oracleContext(facts,{budgetChars=6000,persona}={}){
 const context=JSON.stringify({persona:personaData(persona),facts:facts.map(text=>({text}))});
 if(context.length>budgetChars)throw Error('The fixed oracle does not fit its context budget.');
 return context;
}

function contextObservation(prompt,present=[],absent=[]){
 return {chars:prompt.length,sha256:hash(prompt),required:present.map(marker=>({marker,found:prompt.includes(marker)})),forbidden:absent.map(marker=>({marker,found:prompt.includes(marker)}))};
}
function localModules(sourceRoot){
 const load=file=>require(path.join(sourceRoot,'src',file));
 return {BotService:load('bot/service.cjs').BotService,CharacterLibrary:load('bot/character-library.cjs').CharacterLibrary,
  normalizeCard:load('vendor/sillytavern/character-card.cjs').normalizeCard,SourceRegistry:load('sources/registry.cjs').SourceRegistry,
  DesktopChat:load('bot/desktop-chat.cjs').DesktopChat,desktopChatResult:load('bot/desktop-chat.cjs').desktopChatResult,
  observeLocalRunners:load('bot/desktop-chat.cjs').observeLocalRunners,createDeepSeekRunner:load('bot/deepseek-runner.cjs').createDeepSeekRunner,
  proposePolicy:load('bot/wiki/wiki-propose.cjs').RULES};
}
function sourceIdentity(root){
 const files=Object.keys(require.cache).filter(file=>file.startsWith(path.join(root,'src')+path.sep)).sort().map(file=>({file:path.relative(root,file).split(path.sep).join('/'),sha256:hash(fs.readFileSync(file))}));
 const git=spawnSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',timeout:3000});
 return {root,gitHead:git.status===0?git.stdout.trim():null,loadedFiles:files,loadedSourceSha256:hash(JSON.stringify(files))};
}
function caseState(row){
 const checks=[],contexts=[];
 return {id:row.id,title:row.title,required:row.exploratory!==true,exploratory:row.exploratory===true,checks,contexts,
  check:(name,ok,actual)=>checks.push({name,passed:ok===true,...(actual===undefined?{}:{actual})}),
  context:(name,prompt,present=[],absent=[])=>{const observation=contextObservation(prompt,present,absent);contexts.push({name,...observation});checks.push({name:name+' contains required/omits forbidden markers',passed:observation.required.every(item=>item.found)&&observation.forbidden.every(item=>!item.found)});checks.push({name:name+' fits the declared 6000-character budget',passed:observation.chars<=6000});}};
}
async function fixture(modules,spec,parent,{http=false}={}){
 const root=fs.mkdtempSync(path.join(parent,'profile-')),library=new modules.CharacterLibrary({root:path.join(root,'characters')}),services=[],prompts=[],network=[],history=new Map(),events=[];
 const f={root,modules,spec,library,prompts,network,history,role:'claude-ju',clock:{time:Date.parse(spec.clock)},sourceEnabled:true,httpMode:'good',registry:null,events,proposal:false};
 const record=text=>{const rows=history.get(f.role)||[];rows.push({role:'user',text});history.set(f.role,rows);};
 const rejectChannel=()=>{throw Error('A channel was unexpectedly constructed by an offline case.');};
 const factory=options=>{
  let runner;
  if(http)runner=modules.createDeepSeekRunner({...options,fetchImpl:async(url,init)=>{
   if(url!=='https://api.deepseek.com/chat/completions')throw Error('Unexpected provider endpoint.');
   const body=JSON.parse(init.body);network.push({standIn:true,mode:f.httpMode,tools:Array.isArray(body.tools)?body.tools.length:0,stream:body.stream===true});
   if(f.httpMode==='offline')throw TypeError('Synthetic offline transport');
   if(f.httpMode==='401'||f.httpMode==='429')return new Response('Synthetic private error body must not escape',{status:Number(f.httpMode)});
   const answer=spec.syntheticReply;
   return body.stream?new Response('data: '+JSON.stringify({choices:[{delta:{content:answer},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json({choices:[{message:{role:'assistant',content:answer},finish_reason:'stop'}]});
  }});
  const execute=async args=>{
   prompts.push(args.prompt);
   if(args.prompt.startsWith(modules.proposePolicy)){
    const data=JSON.parse(args.prompt.trim().split('\n').at(-2)),entry=data.ownerMessages.find(item=>item.text===spec.notebook.ownerSaid);
    return {outcome:'reply_ended',text:JSON.stringify([{page:spec.notebook.page,section:'关键事实',op:'add',text:spec.notebook.text,evidence:[{messageId:entry.id,quote:spec.notebook.ownerSaid}]}])};
   }
   if(runner)return runner(args);
   if(f.hold){f.hold.started.resolve();await f.hold.promise;}
   args.onDelta?.(spec.syntheticReply);return {outcome:'reply_ended',text:spec.syntheticReply};
  };
  execute.close=async()=>{await runner?.close?.();};return execute;
 };
 f.make=()=>{
  const service=new modules.BotService({root,vault:{isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()},
   clientFactory:rejectChannel,qqClientFactory:rejectChannel,feishuClientFactory:rejectChannel,xClientFactory:rejectChannel,messengerClientFactory:rejectChannel,
   runnerFactory:factory,claudeProgramRunnerFactory:factory,deepseekRunnerFactory:factory,gptRunnerFactory:factory,geminiRunnerFactory:factory,doubaoRunnerFactory:factory,
   characterLibrary:library,knowledgeNow:()=>f.clock.time,dispatcherFetch:async()=>{throw Error('No scorer request is allowed.');}});
  services.push(service);service.socialStore.now=()=>f.clock.time;service.companionNotifier().now=()=>f.clock.time;return service;
 };
 f.service=f.make();f.service.configure(http?{mode:'deepseek',key:'fixture-offline-key'}:{key:'fixture-offline-key'});f.service.stConfigure({contextChars:spec.budgetChars});
 f.service.socialStore.configure({name:spec.persona.name,description:spec.persona.description,sourceNotices:true,noticeStartHour:0,noticeEndHour:24,maxNoticesPerDay:24});
 f.start=async()=>{const result=await f.service.localStart(),manager=f.service.localManager();manager.run.engine.now=()=>f.clock.time;manager.store.now=()=>f.clock.time;return result;};f.stop=()=>f.service.localStop();
 f.send=async text=>{record(text);const result=await f.service.localReply(text);(history.get(f.role)||[]).push({role:'assistant',text:result.text||''});return result;};
 f.facts=()=>f.service.localManager().store.facts(f.service.localConversationContext().scope,100);
 f.evict=async()=>{for(let n=0;n<25;n++)await f.send(spec.distractor+' '+n);};
 f.switchRole=async role=>{await f.stop();f.service.socialConfigure({characterId:role});f.role=role;await f.start();};
 f.restart=async()=>{await f.stop();f.service=f.make();await f.start();};
 f.reference=()=>referenceContext(history.get(f.role)||[],spec);
 f.cleanup=async()=>{f.registry?.close();for(const service of services)await service.localStop().catch(()=>{});};
 f.tick=async()=>{f.clock.time+=15000;const work=f.service.companionNoticeTick({sourceEnabled:id=>f.registry?.snapshot().some(source=>source.id===id&&source.enabled&&['both','companion'].includes(source.notify))===true});if(work.promise)return {reason:work.reason||'',result:await work.promise};return {reason:work.reason||'',action:work.action};};
 f.setupSource=async()=>{
  const folder=path.join(root,'watched');fs.mkdirSync(folder);f.sourceConfigs=[{id:'folder-case',kind:'folder',name:'Synthetic folder',dir:folder,intervalMs:5000,enabled:true,notify:'companion'}];
  const make=()=>new modules.SourceRegistry({file:path.join(root,'sources.json'),now:()=>f.clock.time,publish:(event,source)=>{events.push(event);f.service.companionNotice({...event,notify:source.notify,sourceName:source.name});}});
  f.makeRegistry=make;f.registry=make();f.registry.configure(f.sourceConfigs);f.registry.tick();await until(()=>f.registry.snapshot()[0].lastCheckedAt!==null);
  const input=path.join(folder,'CASE_FOLDER_NOTICE.txt');fs.writeFileSync(input,'Synthetic folder source input');fs.utimesSync(input,new Date(f.clock.time),new Date(f.clock.time));f.clock.time+=5000;f.registry.tick();await until(()=>events.length===1);f.event=events[0];
 };
 f.noticeRows=()=>f.service.socialStore.withDb(db=>db.prepare('SELECT id,state FROM source_notices ORDER BY rowid').all().map(row=>({...row})));
 f.notebookDiagnostic=(query,prompt)=>{
  const page=spec.notebook.page,marker=spec.notebook.marker,snapshot=f.service.stSnapshot(),lexical=f.service.knowledge().parts.search.search(query);
  const stored=f.service.wikiPage(page).text.includes(marker),approved=f.service.wikiProposals({state:'approved'}).proposals.filter(item=>item.page===page).length;
  const read=snapshot.settings.wikiAccess[f.role]?.read===true,selected=lexical.some(item=>item.page===page&&item.lines.some(line=>line.text.includes(marker))),injected=prompt.includes(marker);
  return {storedInNotebook:stored,approvedProposals:approved,readEnabled:read,lexicalSelected:selected,selectedForPrompt:(snapshot.wikiPages||[]).some(item=>item.page===page),markerInPrompt:injected,
   stage:!stored?'not-stored':!approved?'not-approved':!read?'reading-disabled':!selected?'not-selected-by-lexical-retrieval':!injected?'selected-by-lexical-search-but-not-in-prompt':'injected'};
 };
 f.seedNotebook=async({libraryRole=false}={})=>{
  if(libraryRole){const card=modules.normalizeCard({spec:'chara_card_v2',spec_version:'2.0',data:{name:spec.persona.name,description:spec.persona.description,first_mes:'',extensions:{}}});f.role=library.add({card}).id;f.service.stConfigure({characterId:f.role});}
  await f.start();f.service.wikiCreate({domain:'travel',topic:'transit',description:'主人批准的合成交通记录。'});
  await f.send(spec.notebook.ownerSaid);f.service.wikiAccess({characterId:f.role,read:true,propose:true});
  const proposal=await f.service.wikiPropose({characterId:f.role});if(proposal.proposed!==1)throw Error('The real proposal pipeline did not produce the one verified candidate: '+JSON.stringify(proposal));
  const row=f.service.wikiProposals({state:'pending'}).proposals[0];f.service.wikiDecide({id:row.id,action:'approve'});await f.evict();
 };
 return f;
}
async function memoryCase(row,f,s){
 const values=f.spec.memory,marker=values.original,corrected=values.corrected;
 let present=[],absent=[];
 await f.start();
 if(row.scenario==='ordinary'||row.scenario==='decline'){
  const value=row.scenario==='ordinary'?values.ordinary:values.declined;
  await f.send(row.scenario==='ordinary'?'今天临时想到 '+value+'。':'不要记住：'+value+'。');s.check('No structured fact was written',f.facts().length===0,f.facts().length);
  s.reference={historyOnly:{kind:'persona-and-recent-history',...contextObservation(f.reference(),[value])},oracle:{kind:'explicit-fact-reference',factCount:0,...contextObservation(oracleContext([],f.spec),[],[value])}};return;
 }
 if(['lexical','synonym','repeated-page'].includes(row.scenario)){
  await f.stop();await f.seedNotebook({libraryRole:row.scenario!=='lexical'});
  const query=row.scenario==='synonym'?f.spec.notebook.synonymQuery:f.spec.notebook.lexicalQuery;
  await f.send(query);present=[f.spec.notebook.marker];s.context('First notebook query',f.prompts.at(-1),present);s.notebook=[{query, ...f.notebookDiagnostic(query,f.prompts.at(-1))}];
  if(row.scenario==='repeated-page'){await f.send(f.spec.notebook.secondQuery);s.context('Second query about the same page',f.prompts.at(-1),present);s.notebook.push({query:f.spec.notebook.secondQuery,...f.notebookDiagnostic(f.spec.notebook.secondQuery,f.prompts.at(-1))});}
  s.reference={historyOnly:{kind:'persona-and-recent-history',...contextObservation(f.reference(),present)},oracle:{kind:'explicit-owner-approved-notebook-reference',factCount:1,...contextObservation(oracleContext([f.spec.notebook.text],f.spec),present)}};return;
 }
 await f.send('记住：'+marker);const fact=f.facts()[0];s.check('Explicit fact was persisted',fact?.text===marker);
 if(row.scenario==='correct'){
  await f.send('更正 '+fact.id.slice(0,8)+'：'+corrected);present=[corrected];absent=[marker];s.check('The stored fact is the approved correction',f.facts().length===1&&f.facts()[0].text===corrected);
 }else if(row.scenario==='forget'){
  await f.send('忘记 '+fact.id.slice(0,8));absent=[marker];s.check('The structured fact was removed',f.facts().length===0);
 }else{present=[marker];await f.evict();}
 if(row.scenario==='isolation'){
  await f.switchRole('deepseek-whale');await f.send('我的私人歌单代号是什么？');s.context('Other character',f.prompts.at(-1),[],[marker]);s.check('Other character has no copied fact',f.facts().length===0);await f.switchRole('claude-ju');
 }
 if(row.scenario==='restart')await f.restart();
 await f.send('我的私人歌单代号是什么？');s.context('Final question',f.prompts.at(-1),present,absent);
 s.reference={historyOnly:{kind:'persona-and-recent-history',...contextObservation(f.reference(),present,absent)},oracle:{kind:'explicit-fact-reference',factCount:present.length,...contextObservation(oracleContext(present,f.spec),present,absent)}};
}
async function noticeCase(row,f,s){
 await f.start();await f.setupSource();const before=f.prompts.length;
 s.check('Actual folder reader generated one event',!!f.event&&f.registry.snapshot()[0].lastError===null);
 if(row.scenario==='duplicate'){
  const repeated=f.service.companionNotice({...f.event,notify:'companion',sourceName:'Synthetic folder'});s.check('Duplicate is rejected',repeated.accepted===false,repeated.reason);await f.tick();await f.tick();
 }else if(row.scenario==='pause'){
  await f.stop();const withheld=await f.tick();s.check('Paused App creates no model request',f.prompts.length===before,withheld);await f.start();await f.tick();
 }else if(row.scenario==='global-off'||row.scenario==='source-off'){
  if(row.scenario==='global-off')f.service.socialStore.configure({sourceNotices:false});
  else f.registry.configure(f.sourceConfigs.map(source=>({...source,enabled:false})));
  const withheld=await f.tick();s.check('Disabled pending notice creates no model request',f.prompts.length===before,withheld);s.check('Pending notice stays withheld',f.noticeRows()[0].state==='pending',f.noticeRows()[0].state);
  if(row.scenario==='global-off')f.service.socialStore.configure({sourceNotices:true});else f.registry.configure(f.sourceConfigs);
  await f.tick();
 }else if(row.scenario==='sent-restart'){
  await f.tick();f.registry.close();await f.restart();f.registry=f.makeRegistry();f.registry.load();f.clock.time+=5000;f.registry.tick();await until(()=>f.registry.snapshot()[0].lastCheckedAt===f.clock.time);await f.tick();
  s.check('Registry cursor prevents a new event on restart',f.events.length===1,f.events.length);
 }else if(row.scenario==='claimed-restart'){
  const pending=f.service.socialStore.pendingNotices();s.check('A real durable claim is created',!!f.service.socialStore.claimNotices(pending.map(item=>item.id),'fixture-claimed-batch'));
  await f.restart();await f.tick();s.check('Unconfirmed claim is unknown after restart',f.noticeRows()[0].state==='unknown',f.noticeRows()[0].state);
  s.check('An unknown claim is not replayed',f.prompts.length===before);s.reference={historyOnly:{support:'No active-notice capability in the history-only reference; not scored.'},oracle:{requiredNoticeState:'unknown'}};return;
 }
 const delta=f.prompts.length-before;s.check('One stored App notice, exactly one model wording request',delta===1&&f.service.localSnapshot().history.filter(message=>message.id.startsWith('local-out:notice:')).length===1,{requests:delta,states:f.noticeRows().map(item=>item.state)});
 if(delta)s.context('Notice wording input',f.prompts.at(-1),['CASE_FOLDER_NOTICE.txt']);
 s.reference={historyOnly:{support:'No active-notice capability in the history-only reference; not scored.'},oracle:{requiredDeliveries:1}};
}
async function errorCase(row,f,s){
 if(row.scenario==='storage'){
  await f.start();await f.send('记住：CASE_STORAGE_KEEP_92');const store=f.service.localManager().store,file=store.file,saved=file+'.retained';
  fs.renameSync(file,saved);fs.mkdirSync(file);let rejected=false;
  try{await f.send('记住：CASE_STORAGE_MUST_NOT_SAVE_84');}catch{rejected=true;}
  s.check('An actual SQLite path failure rejects the save',rejected||!store.available);s.check('Storage failure did not manufacture a success reply',!f.service.localSnapshot().history.some(message=>message.role==='assistant'&&message.text.includes('CASE_STORAGE_MUST_NOT_SAVE_84')));s.check('No model request was made for the failed save',f.prompts.length===0,f.prompts.length);
  await f.stop();fs.rmdirSync(file);fs.renameSync(saved,file);f.service=f.make();await f.start();await f.send('我明确保存的代号是什么？');s.context('Explicit storage recovery',f.prompts.at(-1),['CASE_STORAGE_KEEP_92'],['CASE_STORAGE_MUST_NOT_SAVE_84']);
  s.check('Previously saved data remains, failed fact is absent',f.facts().length===1&&f.facts()[0].text==='CASE_STORAGE_KEEP_92');s.reference={historyOnly:{support:'Storage is exercised by the production service, not the context reference.'},oracle:{retained:'CASE_STORAGE_KEEP_92'}};return;
 }
 f.modules.observeLocalRunners(f.service);await f.start();
 const chat=new f.modules.DesktopChat({getContext:()=>({...f.service.localConversationContext(),kind:'local',accountId:'fixture',service:f.service})});
 const panel=chat.open({accountId:'fixture',contextId:chat.snapshot().contextId,panelId:'fixture-panel'}),send=(id,text)=>f.modules.desktopChatResult(()=>chat.send({...panel,requestId:id,text}));
 f.httpMode=row.scenario;const result=await send('failed-turn','这是一条合成的首次聊天请求。');
 const expected=row.scenario==='401'?'auth':row.scenario==='429'?'quota':'network';s.check('The real runner failure is classified without its raw body',result.ok===false&&result.failure===expected,result);
 s.check('Failure creates no assistant success row',!f.service.localSnapshot().history.some(message=>message.role==='assistant'));s.check('No automatic immediate retry',f.network.length===1,f.network.length);
 f.httpMode='good';const recovered=await send('explicit-retry','现在请明确重试这条合成请求。');s.check('An explicit retry succeeds with the same runner',recovered.ok===true&&f.network.length===2,{result:recovered,requests:f.network.length});s.check('Provider requests had no tools',f.network.every(request=>request.tools===0));
 s.reference={historyOnly:{support:'HTTP classification is production behaviour, not a context-reference score.'},oracle:{failure:expected}};
}
async function runCases({sourceRoot=path.resolve(__dirname,'..'),fixtureFile=FIXTURE,caseIds=null}={}){
 sourceRoot=fs.realpathSync(path.resolve(sourceRoot));const bytes=fs.readFileSync(fixtureFile),spec=JSON.parse(bytes),all=spec.cases;
 if(spec.version!==1||spec.budgetChars!==6000||spec.historyMessages!==20||!Array.isArray(all)||new Set(all.map(row=>row.id)).size!==all.length)throw Error('Invalid companion case fixture.');
 const rows=caseIds?all.filter(row=>caseIds.includes(row.id)):all;if(caseIds&&rows.length!==new Set(caseIds).size)throw Error('Unknown case id.');
 const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-companion-cases-'))),priorFetch=globalThis.fetch;let denied=0;
 globalThis.fetch=async()=>{denied++;throw Error('External fetch is disabled by the companion case harness.');};
 const results=[];
 try{
  const modules=localModules(sourceRoot);
  for(const row of rows){const state=caseState(row);let f;
   try{f=await fixture(modules,spec,parent,{http:row.id.startsWith('E')&&row.scenario!=='storage'});if(row.id.startsWith('M'))await memoryCase(row,f,state);else if(row.id.startsWith('N'))await noticeCase(row,f,state);else await errorCase(row,f,state);}
   catch(error){state.error={name:error?.name||'Error',code:typeof error?.code==='string'?error.code:null,message:String(error?.message||error).replaceAll(parent,'<temporary-case-root>').slice(0,300)};}
   finally{await f?.cleanup();}
   if(f){const ordinary=f.prompts.filter(prompt=>!prompt.startsWith(modules.proposePolicy));state.check('Conversation requests use the fixed persona description',ordinary.every(prompt=>prompt.includes(spec.persona.description)));}
   const {check,context,...result}=state;result.status=result.error?'error':result.checks.every(check=>check.passed)?'pass':result.exploratory?'exploratory-gap':'fail';results.push(result);
  }
  return {version:1,kind:'offline-production-companion-cases',source:sourceIdentity(sourceRoot),harnessSha256:hash(fs.readFileSync(__filename)),fixtureSha256:hash(bytes),budgetChars:spec.budgetChars,runtime:{node:process.version,platform:process.platform,arch:process.arch,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},
   reference:{persona:spec.persona,personaSha256:hash(JSON.stringify(spec.persona)),description:'History-only reference: the same fixed persona plus same-role last 20 raw messages within a total 6000-character JSON budget, without facts, notebook retrieval or active notices. The separate oracle context has the same persona plus only explicit current facts from the fixture; it is never sent to a model or inserted into a production prompt. Neither reference is a competitor result.'},
   boundaries:{realProfiles:false,keychain:false,realModels:false,appLaunched:false,network:'denied except explicit in-memory provider stand-ins',unexpectedFetchAttempts:denied,temporaryDataRemoved:true},
   summary:{cases:results.length,requiredCases:results.filter(row=>row.required).length,requiredPass:results.filter(row=>row.required&&row.status==='pass').length,requiredFailures:results.filter(row=>row.required&&row.status!=='pass').length,exploratoryCases:results.filter(row=>row.exploratory).length,exploratoryPass:results.filter(row=>row.exploratory&&row.status==='pass').length,exploratoryGaps:results.filter(row=>row.status==='exploratory-gap').length,errors:results.filter(row=>row.status==='error').length},cases:results};
 }finally{globalThis.fetch=priorFetch;fs.rmSync(parent,{recursive:true,force:true});}
}
function cli(argv){let sourceRoot=path.resolve(__dirname,'..'),output=null,caseIds=null;for(let n=0;n<argv.length;n++){
 const flag=argv[n],value=argv[n+1];if(!['--source-root','--output','--cases'].includes(flag)||!value||value.startsWith('--'))throw Error('Usage: node scripts/companion-cases.cjs [--source-root DIRECTORY] [--output FILE] [--cases M01,M02]');n++;
 if(flag==='--source-root')sourceRoot=value;else if(flag==='--output')output=value;else caseIds=value.split(',');
 }return {sourceRoot,output,caseIds};}
if(require.main===module)(async()=>{const options=cli(process.argv.slice(2)),report=await runCases(options),json=JSON.stringify(report,null,2)+'\n';if(options.output){fs.mkdirSync(path.dirname(path.resolve(options.output)),{recursive:true});fs.writeFileSync(path.resolve(options.output),json);}else process.stdout.write(json);if(report.summary.requiredFailures||report.summary.errors||report.boundaries.unexpectedFetchAttempts)process.exitCode=1;})().catch(error=>{console.error(error.message);process.exitCode=2;});
module.exports={runCases,referenceContext,oracleContext,contextObservation,cli};
