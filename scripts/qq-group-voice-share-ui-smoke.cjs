'use strict';
// Production renderer, synthetic ordinary QQ IPC, and fake local playback only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'outputs/qq-group-voice-share-ui'));
fs.mkdirSync(out,{recursive:true});
const code=fs.readFileSync(path.join(root,'scripts/desktop-chat-ui-smoke.cjs'),'utf8');
const marker='await page.addInitScript(({catalog})=>{',start=code.indexOf(marker),end=code.indexOf('},{catalog});',start);
assert(start>=0&&end>start);
const catalog=require('../src/core/personas.cjs').publicCatalog(),fixture=code.slice(start+marker.length,end);
const targets=[{groupId:'567890',role:'海岸绘图员',roleId:'card-coast'},{groupId:'678901',role:'午后修表师',roleId:'card-clock'}];
const preview='data:audio/wav;base64,'+Buffer.alloc(16044).toString('base64');
const receipt={synthetic:true,actualBackend:false,realQQ:false,realFilePicker:false,realAudio:false,checks:[],screenshots:[],errors:[],externalRequests:[],passed:false};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ARCADE_HEADLESS_BROWSER?{executablePath:process.env.ARCADE_HEADLESS_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1180,height:900}});page.setDefaultTimeout(7000);await page.emulateMedia({reducedMotion:'reduce'});
  page.on('pageerror',error=>receipt.errors.push(error.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://127.0.0.1:41432'){receipt.externalRequests.push(url.href);return route.abort();}
   const relative=url.pathname==='/'?'src/ui/index.html':url.pathname.startsWith('/assets/')?'src'+url.pathname:'src/ui'+url.pathname;
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
   return route.fulfill({path:file});
  });
  await page.addInitScript({content:'const catalog='+JSON.stringify(catalog)+';'+fixture});
  await page.addInitScript(({targets,preview})=>{
   const f=window.roomFixture,voice=window.voiceTrial={calls:[],plays:0,instances:[],targets,counter:0};
   arcade.platform={os:'darwin'};
   const bot=f.bots.ju,media=bot.voiceMedia={supported:true,available:true,groupTargets:[],draft:null};
   bot.media={supported:false,available:false};
   f.snapshot.config.appearance='light';f.snapshot.appearance={preference:'light',colorScheme:'light'};
   arcade.initialAppearance=f.snapshot.appearance;
   const log=(name,args)=>voice.calls.push({name,...structuredClone(args)});
   window.Audio=class {
    constructor(){this.src='';this.currentTime=0;this.playing=false;this.muted=true;voice.instances.push(this);}
    play(){voice.plays++;if(voice.failPlayback){voice.failPlayback=false;return Promise.reject(Error('synthetic playback refusal'));}this.playing=true;return Promise.resolve();}
    pause(){this.playing=false;}
    removeAttribute(name){if(name==='src')this.src='';}
    load(){}
   };
   const matches=(a,b)=>a?.accountId===b.accountId&&a.panelId===b.panelId&&a.groupId===b.groupId;
   const generatorAvailable=()=>arcade.platform.os==='win32'||voice.macGeneratorConfigured===true;
   arcade.qqVoiceAvailability=async args=>{
    log('availability',args);
    const available=generatorAvailable(),stage=matches(voice.generation?.scope,args)?'generating':'idle';
    return {ok:true,...args,available,progress:{stage},...(available?{}:{reason:'voice_render_unsupported_platform'})};
   };
   function makeDraft(scope){
    const target=targets.find(row=>row.groupId===scope.groupId);
    const recipient=target?{accountId:'100001',...structuredClone(target)}:{accountId:'100001',ownerId:'200001',role:'橘娘'};
    if(scope.groupId==='678901')recipient.groupName='合成试用群';
    if(voice.wrongRole){voice.wrongRole=false;recipient.roleId='wrong-role-id';}
    const ticketId=`00000000-0000-4000-8000-${String(++voice.counter).padStart(12,'0')}`;
    return {ticketId,kind:'voice',bytes:16044,channels:1,bits:16,sampleRate:16000,durationSeconds:0.5,expiresAt:Date.now()+300000,recipient};
   }
   function completeDraft(scope,draft){
    if(voice.panel===scope){
     const {groupName,...recipient}=draft.recipient;
     media.draft={...draft,recipient};f.publish();
    }
    return {ok:true,...scope,draft:{...draft,preview}};
   }
   arcade.qqVoiceRender=async ({text,...scope})=>{
    log('render',{...scope,text});
    if(!generatorAvailable())return {ok:false,code:'voice_render_unsupported_platform'};
    voice.panel=scope;media.draft=null;f.publish();
    if(voice.holdRender){
     voice.holdRender=false;
     return new Promise(resolve=>{voice.generation={scope,resolve};});
    }
    return completeDraft(scope,makeDraft(scope));
   };
   arcade.qqVoiceCancelRender=async args=>{
    log('cancel-render',args);
    const held=voice.generation;
    if(!matches(held?.scope,args))return {ok:false,code:'changed'};
    voice.generation=null;held.resolve({ok:false,code:'cancelled'});
    return {ok:true,cancelled:true};
   };
   arcade.qqVoicePick=async args=>{
    log('pick',args);voice.panel=args;
    const draft=makeDraft(args),complete=()=>completeDraft(args,draft);
    if(voice.holdPick){voice.holdPick=false;return new Promise(resolve=>voice.releasePick=()=>resolve(complete()));}
    return complete();
   };
   arcade.qqVoiceClose=async args=>{log('close',args);if(voice.panel?.panelId===args.panelId){voice.panel=null;media.draft=null;f.publish();}return {ok:true,closed:true};};
   arcade.qqVoiceDiscard=async args=>{log('discard',args);media.draft=null;f.publish();return {ok:true,discarded:true};};
   arcade.qqVoiceSend=async args=>{
    log('send',args);media.draft=null;f.publish();
    return {ok:true,...args,kind:'voice',outcome:'accepted',messageId:'8201',...(voice.wrongReceipt?{groupId:'567890'}:{}),path:'PRIVATE_TEST_FIELD'};
   };
  },{targets,preview});
  await page.goto('http://127.0.0.1:41432/');await page.evaluate(()=>{roomFixture.publish();switchView('bot');});
  const entry=page.locator('#qq-voice-open'),drawer=page.locator('#qq-voice'),target=drawer.locator('#qq-voice-target');
  const choose=drawer.locator('#qq-voice-choose'),send=drawer.locator('#qq-voice-send'),listen=drawer.locator('#qq-voice-preview');
  const player=drawer.locator('.qq-voice-player'),details=drawer.locator('#qq-voice-receipt'),status=drawer.locator('#qq-voice-status');
  const allCalls=()=>page.evaluate(()=>voiceTrial.calls),calls=async name=>(await allCalls()).filter(item=>item.name===name);
  const fixtureUpdate=fn=>page.evaluate(fn);
  const pass=message=>receipt.checks.push(message);
  const shot=async name=>{await drawer.waitFor();assert(await drawer.evaluate(node=>node.scrollWidth<=innerWidth+1));const file=path.join(out,name+'.png');await page.screenshot({path:file,animations:'disabled'});receipt.screenshots.push(file);};
  const open=async()=>{await entry.click();await drawer.waitFor();};
  const close=async()=>{await drawer.locator('#qq-voice-close').click();await drawer.waitFor({state:'hidden'});};
  const pick=async()=>{await choose.click();await player.waitFor();};
  const play=async()=>{await listen.click();await page.waitForFunction(()=>document.getElementById('qq-voice-preview')?.getAttribute('aria-pressed')==='true');};
  const releaseProof=async()=>assert(await page.evaluate(()=>voiceTrial.instances.every(audio=>!audio.src&&!audio.playing)));
  assert(!await entry.isVisible());
  await fixtureUpdate(()=>{const media=roomFixture.bots.ju.voiceMedia;media.groupTargets=[...voiceTrial.targets,{groupId:'群名',role:'invalid',roleId:'invalid'}];roomFixture.publish();});
  await open();assert.equal(await target.inputValue(),'');assert.equal(await target.locator('option').count(),3);
  assert.equal(await choose.count(),0);assert(await send.isDisabled());assert.deepEqual(await allCalls(),[]);
  await shot('01-mac-no-target');
  pass('Mac voice sharing is visible only with eligible group targets and opens empty; no owner target, picker or availability request is invoked automatically.');

  await target.selectOption('567890');await drawer.getByText(/此平台暂不能生成语音/).waitFor();
  assert.match(await drawer.locator('.qq-voice-recipient').innerText(),/海岸绘图员[\s\S]*100001[\s\S]*567890/);
  assert.equal(await drawer.locator('#qq-voice-generate').count(),0);
  const firstPanel=(await calls('availability')).at(-1).panelId;
  assert.deepEqual((await calls('availability')).at(-1),{name:'availability',accountId:'ju',panelId:firstPanel,groupId:'567890'});
  await fixtureUpdate(()=>voiceTrial.wrongRole=true);await choose.click();await status.filter({hasText:'语音预览暂不可用'}).waitFor();
  assert.equal(await player.count(),0);assert(await send.isDisabled());assert.equal(await page.evaluate(()=>voiceTrial.instances.length),0);
  await pick();assert(await send.isEnabled());assert.equal(await page.evaluate(()=>voiceTrial.plays),0);assert.deepEqual(await calls('send'),[]);
  assert.match(await drawer.locator('.qq-voice-recipient').innerText(),/目标 QQ 群 567890$/);
  await fixtureUpdate(()=>voiceTrial.failPlayback=true);await listen.click();await drawer.locator('#qq-voice-playback').filter({hasText:'试听失败'}).waitFor();assert(await send.isEnabled());assert.deepEqual(await calls('send'),[]);
  await send.click();await status.filter({hasText:/QQ 已接受/}).waitFor();assert.equal((await calls('send')).length,1);assert(await send.isDisabled());
  await pick();await play();await drawer.locator('#qq-voice-playback').filter({hasText:'正在本机播放'}).waitFor();
  assert.equal((await calls('send')).length,1);await shot('02-mac-optional-local-preview');
  pass('Only an exact group-role draft opens confirmation. Picking starts no playback or send, playback failure leaves manual Send enabled, and optional playback never sends the next clip. A missing verified name shows the exact numeric ID.');

  await target.selectOption('678901');await drawer.getByText(/此平台暂不能生成语音/).waitFor();
  await releaseProof();assert.equal(await player.count(),0);assert(await send.isDisabled());
  assert.deepEqual((await calls('close')).at(-1),{name:'close',accountId:'ju',panelId:firstPanel,groupId:'567890'});
  const secondPanel=(await calls('availability')).at(-1).panelId;assert.notEqual(secondPanel,firstPanel);
  assert.equal((await calls('availability')).at(-1).groupId,'678901');
  await pick();await drawer.locator('#qq-voice-remove').click();await player.waitFor({state:'hidden'});
  assert.equal((await calls('discard')).at(-1).groupId,'678901');await releaseProof();
  await pick();assert(await send.isEnabled());
  assert.match(await drawer.locator('.qq-voice-recipient').innerText(),/678901 · 合成试用群/);
  const beforeMutedSend=await page.evaluate(()=>voiceTrial.plays);assert(await page.evaluate(()=>voiceTrial.instances.at(-1).muted));
  await send.click();await status.filter({hasText:/QQ 已接受/}).waitFor();
  await send.evaluate(button=>button.click());
  assert.equal((await calls('send')).length,2);assert.equal((await calls('send')).at(-1).groupId,'678901');
  assert.equal(await page.evaluate(()=>voiceTrial.plays),beforeMutedSend);
  await details.locator('summary').click();assert.match(await details.innerText(),/8201[\s\S]*100001[\s\S]*678901 · 合成试用群[\s\S]*午后修表师/);
  assert.equal(await details.locator('[data-field="ownerId"]').count(),0);assert.doesNotMatch(await details.innerText(),/PRIVATE_TEST_FIELD/);
  await shot('03-mac-unplayed-accepted');
  pass('Retargeting stops old playback and retires its group-scoped panel. A muted, unplayed new clip can be explicitly sent once. Verified group name and numeric ID stay paired in preview and receipt.');

  await fixtureUpdate(()=>{voiceTrial.wrongReceipt=true;roomFixture.snapshot.config.language='en';roomFixture.publish();});
  await page.setViewportSize({width:430,height:700});await pick();
  const beforeUnknown=(await calls('send')).length;await send.click();await status.filter({hasText:/unconfirmed/}).waitFor();
  assert.equal(await details.count(),0);assert.equal((await calls('send')).length,beforeUnknown+1);
  assert(await send.isDisabled());assert.equal(await player.count(),0);await shot('04-mac-unconfirmed');
  await fixtureUpdate(()=>{voiceTrial.holdPick=true;});await choose.click();await page.waitForFunction(()=>!!voiceTrial.releasePick);
  await fixtureUpdate(()=>{const media=roomFixture.bots.ju.voiceMedia;media.groupTargets=media.groupTargets.map(row=>row.groupId==='678901'?{...row,roleId:'card-updated'}:row);roomFixture.publish();});
  await drawer.waitFor({state:'hidden'});await fixtureUpdate(()=>voiceTrial.releasePick());await releaseProof();
  assert.equal((await calls('close')).at(-1).groupId,'678901');assert.equal((await calls('send')).length,beforeUnknown+1);
  pass('An unmatched receipt consumes the selected ticket without retry or success details. A same-name role revision closes the drawer and suppresses a late picker result.');

  await open();await target.selectOption('567890');await pick();
  await fixtureUpdate(()=>{roomFixture.bots.ju.voiceMedia.groupTargets=[];roomFixture.publish();});
  await drawer.waitFor({state:'hidden'});await entry.waitFor({state:'hidden'});await releaseProof();
  assert.equal((await calls('close')).at(-1).groupId,'567890');
  await fixtureUpdate(()=>{arcade.platform={os:'win32'};voiceTrial.wrongReceipt=false;roomFixture.bots.ju.voiceMedia.groupTargets=voiceTrial.targets;roomFixture.publish();});
  await open();assert.equal(await target.inputValue(),'owner');await pick();assert(!await send.isDisabled());
  assert.match(await drawer.locator('.qq-voice-recipient').innerText(),/Owner: QQ 200001/);
  await send.click();await status.filter({hasText:/QQ accepted/}).waitFor();await close();
  assert((await allCalls()).slice(-4).every(row=>!Object.hasOwn(row,'groupId')));
  pass('Target disappearance immediately closes an in-flight group drawer. Windows still defaults to the owner and sends through the existing ungrouped controls.');
  await fixtureUpdate(()=>{arcade.platform={os:'darwin'};voiceTrial.macGeneratorConfigured=true;roomFixture.publish();});
  const text=drawer.locator('#qq-voice-text'),generate=drawer.locator('#qq-voice-generate'),cancel=drawer.locator('#qq-voice-cancel-render');
  const phrase='晚安，记得给自己留一点时间。',rendersBefore=(await calls('render')).length,sendsBefore=(await calls('send')).length;
  const picksBefore=(await calls('pick')).length,playsBefore=await page.evaluate(()=>voiceTrial.plays);
  await open();assert.equal(await target.inputValue(),'');assert.equal(await generate.count(),0);
  await target.selectOption('678901');await text.waitFor();await drawer.getByText(/Local Serena voice/).waitFor();
  assert.equal(await text.inputValue(),'');assert(await generate.isDisabled());
  const generationPanel=(await calls('availability')).at(-1).panelId;
  const scope={accountId:'ju',panelId:generationPanel,groupId:'678901'};
  await text.fill(phrase);await fixtureUpdate(()=>voiceTrial.holdRender=true);await generate.click();
  await status.filter({hasText:'Creating this voice clip'}).waitFor();await generate.evaluate(button=>button.click());
  assert.equal((await calls('render')).length,rendersBefore+1);
  assert.deepEqual((await calls('render')).at(-1),{name:'render',...scope,text:phrase});
  assert.deepEqual((await calls('availability')).at(-1),{name:'availability',...scope});
  assert(await send.isDisabled());assert.equal((await calls('send')).length,sendsBefore);assert.equal(await page.evaluate(()=>voiceTrial.plays),playsBefore);
  await shot('05-mac-serena-progress');await cancel.click();
  await status.filter({hasText:/Generation cancelled.*Your text is kept/}).waitFor();
  assert.deepEqual((await calls('cancel-render')).at(-1),{name:'cancel-render',...scope});
  assert.equal(await target.inputValue(),'678901');assert.equal(await text.inputValue(),phrase);
  assert.equal(await player.count(),0);assert(await send.isDisabled());
  assert.equal((await calls('send')).length,sendsBefore);assert.equal(await page.evaluate(()=>voiceTrial.plays),playsBefore);
  pass('A configured Mac Serena composer starts one explicitly requested generation, shows a target-scoped progress update, and cancels without discarding the selected group or the text. No picker, play or send is automatic.');
  await generate.click();await player.waitFor();
  assert.equal((await calls('render')).length,rendersBefore+2);
  assert.deepEqual((await calls('render')).at(-1),{name:'render',...scope,text:phrase});
  assert.match(await drawer.locator('.qq-voice-recipient').innerText(),/午后修表师[\s\S]*100001[\s\S]*678901 · 合成试用群/);
  assert.match(await player.innerText(),/Voice generated from your text/);
  assert.equal((await calls('pick')).length,picksBefore);assert.equal((await calls('send')).length,sendsBefore);
  assert.equal(await page.evaluate(()=>voiceTrial.plays),playsBefore);assert(await send.isEnabled());
  await player.scrollIntoViewIfNeeded();await shot('06-mac-serena-generated');
  await play();assert.equal(await page.evaluate(()=>voiceTrial.plays),playsBefore+1);assert.equal((await calls('send')).length,sendsBefore);
  await send.click();await status.filter({hasText:/QQ accepted/}).waitFor();await send.evaluate(button=>button.click());
  assert.equal((await calls('send')).length,sendsBefore+1);assert.equal((await calls('send')).at(-1).groupId,'678901');
  assert(await send.isDisabled());await close();await releaseProof();
  pass('A fresh synthetic Serena generation returns a scoped draft with the approved role, group number and verified group name. Optional local playback is explicit, and explicit Send consumes exactly one accepted ticket.');
  assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.externalRequests,[]);receipt.passed=true;
 }finally{await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');}
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length,receipt:path.join(out,'receipt.json')}));
})().catch(error=>{console.error(error);process.exitCode=1;});
