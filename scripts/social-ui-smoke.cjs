'use strict';
// Renderer acceptance with explicit IPC fixtures. Never connects a social
// account, calls a model, sends a message, or publishes a post.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-social-ui-'));
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'zh',portrait:'anime'}));
  fs.writeFileSync(path.join(root,'bot-config.json'),JSON.stringify({mode:'claude',channel:'qq',workspace:root}));
  const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'observer.json')};delete env.ELECTRON_RUN_AS_NODE;
  const args=[`--user-data-dir=${path.join(root,'profile')}`];if(!process.env.ARCADE_EXECUTABLE)args.unshift(path.resolve(__dirname,'..'));
  const app=await electron.launch({executablePath:process.env.ARCADE_EXECUTABLE||require('electron'),args,env});
  try{
    const page=await app.firstWindow(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.stack||e.message));await page.route(/^https?:/,r=>{network.push(r.request().url());return r.abort();});
    await page.locator('#social-panel').waitFor({state:'attached'});
    const base=await page.evaluate(()=>window.arcade.snapshot());
    await app.evaluate(({ipcMain,BrowserWindow},snapshot)=>{
      const config={enabled:false,characterId:'claude-ju',name:'橘',description:'温和、好奇，喜欢科幻和轻松的日常聊天。',notes:'',proactiveMessages:false,qzonePosts:false,activeStart:9,activeEnd:22,intervalMinutes:180,maxMessagesPerDay:2,maxPostsPerDay:1};
      globalThis.socialFixture={snapshot,calls:[]};snapshot.bot={...snapshot.bot,mode:'claude',channel:'qq',status:'disconnected',social:{config,active:false,supported:true,memoryReady:false,busy:false,problem:'',history:[],actions:[]}};
      const publish=()=>{for(const window of BrowserWindow.getAllWindows())window.webContents.send('arcade:snapshot',snapshot);return structuredClone(snapshot.bot);};
      globalThis.socialFixture.publish=publish;
      for(const name of ['snapshot','config','botConfigure','socialConfigure','socialPause','socialConsider','socialForget'])ipcMain.removeHandler(`arcade:${name}`);
      ipcMain.handle('arcade:snapshot',()=>snapshot);
      ipcMain.handle('arcade:config',(_e,patch)=>{Object.assign(snapshot.config,patch);publish();return snapshot;});
      ipcMain.handle('arcade:botConfigure',(_e,patch)=>{Object.assign(snapshot.bot,patch);publish();return snapshot.bot;});
      ipcMain.handle('arcade:socialConfigure',(_e,patch)=>{globalThis.socialFixture.calls.push({method:'configure',patch});const changedCharacter=patch.characterId!==snapshot.bot.social.config.characterId;Object.assign(snapshot.bot.social.config,patch);if(changedCharacter){snapshot.bot.social.config.proactiveMessages=false;snapshot.bot.social.config.qzonePosts=false;}return publish();});
      ipcMain.handle('arcade:socialPause',()=>{globalThis.socialFixture.calls.push({method:'pause'});snapshot.bot.social.config.proactiveMessages=false;snapshot.bot.social.config.qzonePosts=false;return publish();});
      ipcMain.handle('arcade:socialConsider',()=>{globalThis.socialFixture.calls.push({method:'consider'});const result=publish();result.socialDecision={action:'wait',reason:'cooldown'};return result;});
      ipcMain.handle('arcade:socialForget',()=>{globalThis.socialFixture.calls.push({method:'forget'});snapshot.bot.social.config.notes='';snapshot.bot.social.history=[];snapshot.bot.social.config.proactiveMessages=false;snapshot.bot.social.config.qzonePosts=false;return publish();});
      publish();
    },base);
    await page.locator('nav [data-view="connections"]').click();await page.locator('#social-panel>summary').click();await page.locator('#social-name').waitFor();
    assert.equal(await page.locator('#social-characterId option').count(),base.personas.length);
    await page.locator('#social-characterId').selectOption('codex-dragon');assert.equal(await page.locator('#social-name').inputValue(),'龙娘');
    await page.locator('#social-name').fill('小龙');await page.locator('#social-description').fill('喜欢星空和推理故事，聊天直接又有一点俏皮。');assert.equal(await page.locator('#social-notes').isEnabled(),false,'unverified character/contact cannot receive private notes');
    await page.locator('#social-enabled').check();await page.locator('#social-proactiveMessages').check();await page.locator('#social-qzonePosts').check();await page.locator('#social-save').click();await page.locator('#social-operation').filter({hasText:'已保存'}).waitFor();
    assert.equal(await page.locator('#social-proactiveMessages').isChecked(),false,'successful save shows the service-paused conversation policy after a character change');assert.equal(await page.locator('#social-qzonePosts').isChecked(),false,'successful save shows the service-paused publication policy');
    await app.evaluate(()=>{globalThis.socialFixture.snapshot.bot.social.memoryReady=true;globalThis.socialFixture.publish();});
    await page.locator('#social-notes').fill('我喜欢无糖茶。<script>window.fixtureInjected=true</script>');await page.locator('#social-proactiveMessages').check();
    await page.locator('#social-notes').focus();await app.evaluate(()=>globalThis.socialFixture.publish());
    assert.match(await page.locator('#social-notes').inputValue(),/无糖茶/);assert.equal(await page.locator('#social-notes').evaluate(n=>n===document.activeElement),true,'polling preserves draft and focus');
    await page.locator('#social-save').click();await page.locator('#social-operation').filter({hasText:'已保存'}).waitFor();
    const calls=await app.evaluate(()=>globalThis.socialFixture.calls);assert.equal(calls.length,2);assert.equal(calls[0].patch.characterId,'codex-dragon');assert.equal(calls[1].patch.proactiveMessages,true);assert.equal(calls[1].patch.qzonePosts,false);
    await app.evaluate(()=>{const s=globalThis.socialFixture.snapshot.bot;s.status='connected';s.social.active=true;s.social.history=[{id:'fixture-1',role:'user',text:'记住我喜欢无糖茶。',at:1},{id:'fixture-2',role:'assistant',text:'记住了，下次聊茶的时候我会想到这个。',at:2}];s.social.actions=Array.from({length:7},(_,i)=>({id:`fixture-action-${i}`,kind:'message',state:i?'skipped':'unknown',text:i?'合成记录：暂不联系。':'<script>window.fixtureInjected=true</script>合成记录：发送状态不确定。',at:1700000000000-i*1000}));globalThis.socialFixture.publish();});
    await page.locator('.social-state').filter({hasText:'陪伴中'}).waitFor();assert.equal(await page.locator('#social-save').isEnabled(),false);assert.equal(await page.locator('#social-forget').isEnabled(),false);assert.equal(await page.locator('#social-pause').isEnabled(),true);
    await page.locator('#social-consider').click();await page.locator('#social-operation').filter({hasText:'还没到'}).waitFor();assert.doesNotMatch(await page.locator('#social-operation').innerText(),/已发送|已发布/);
    await page.locator('#social-pause').click();await page.locator('#social-operation').filter({hasText:'主动活动已暂停'}).waitFor();assert.equal(await page.locator('#social-pause').isEnabled(),false);
    await page.locator('.social-memory>summary').click();assert.match(await page.locator('.social-action-list>li').first().innerText(),/发送结果不确定/);assert.equal(await page.locator('.social-action-list>li').count(),6);assert.equal(await page.evaluate(()=>window.fixtureInjected),undefined);
    await app.evaluate(()=>{const s=globalThis.socialFixture.snapshot.bot;s.status='disconnected';s.social.active=false;globalThis.socialFixture.publish();});
    await page.locator('#social-forget').click();assert.equal((await app.evaluate(()=>globalThis.socialFixture.calls)).filter(c=>c.method==='forget').length,0);await page.locator('#social-forget-confirm').click();await page.locator('#social-operation').filter({hasText:'已清除'}).waitFor();
    assert.equal((await app.evaluate(()=>globalThis.socialFixture.calls)).filter(c=>c.method==='forget').length,1);assert.match(await page.locator('.social-history').innerText(),/第一句话/);assert.match(await page.locator('.social-action-list').innerText(),/发送结果不确定/,'forgetting conversation keeps action receipts');
    await page.locator('.social-memory>summary').click();
    await app.evaluate(()=>{globalThis.socialFixture.snapshot.bot.mode='codex';globalThis.socialFixture.publish();});await page.locator('.social-notice').filter({hasText:'Codex'}).waitFor();assert.equal(await page.locator('#social-save').isEnabled(),false);
    await app.evaluate(()=>{globalThis.socialFixture.snapshot.bot.mode='claude';globalThis.socialFixture.publish();});
    // Pin only screenshot input: the real observer can publish an unrelated
    // snapshot while a screenshot is being resized. The displayed state remains
    // an explicitly labelled renderer fixture, never a live connection claim.
    const captureBot=await app.evaluate(()=>structuredClone(globalThis.socialFixture.snapshot.bot));
    await page.evaluate(bot=>{window.socialCaptureBot=bot;window.socialCaptureLanguage='zh';const render=window.renderSocial;window.renderSocial=(next,full)=>render(window.socialCaptureBot,{...full,config:{...full.config,language:window.socialCaptureLanguage}});window.renderConnections({...data,bot});},captureBot);
    fs.mkdirSync('outputs',{recursive:true});
    const capture=async name=>{await page.locator('#social-panel').evaluate(panel=>{let label=panel.querySelector('.fixture-label');if(!label){label=document.createElement('p');label.className='fixture-label social-hint';label.textContent='合成 UI 验收 · 未调用模型、发送消息或发布动态';panel.querySelector('.social-body').prepend(label);}});await page.locator('#social-panel').scrollIntoViewIfNeeded();await page.locator('#social-panel').screenshot({path:`outputs/social-${name}.png`});};
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(400,380);w.setContentSize(1180,1450);});await capture('zh');
    await page.evaluate(()=>{window.socialCaptureLanguage='en';window.renderConnections({...data,bot:window.socialCaptureBot,config:{...data.config,language:'en'}});});await page.locator('#social-save').filter({hasText:'Save companion settings'}).waitFor();
    await page.locator('.social-hours>summary').click();await page.locator('#social-activeEnd').fill('24');assert.equal(await page.locator('#social-activeEnd').evaluate(n=>n.checkValidity()),true);await page.locator('#social-maxMessagesPerDay').fill('0');assert.equal(await page.locator('#social-maxMessagesPerDay').evaluate(n=>n.checkValidity()),true);await page.locator('.social-hours>summary').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(430,1450));await page.waitForFunction(()=>innerWidth===430);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.emulateMedia({reducedMotion:'reduce'});await capture('en-narrow');assert.equal(await page.locator('#social-save').innerText(),'Save companion settings');
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    const receipt={ui:'passed',synthetic:true,liveAccounts:false,liveModels:false,realMessagesSent:0,realPostsPublished:0,independentCharacterSelection:true,savedPolicyReflectsServicePause:true,privateNotesRequireVerifiedContact:true,publicPersonaAndPrivateMemorySeparated:true,pollingPreservesDraftAndFocus:true,connectedSettingsLocked:true,pauseKeepsConversation:true,considerWaitDoesNotClaimSent:true,clearMemoryRequiresSecondClick:true,clearMemoryKeepsReceipts:true,unknownDeliveryVisible:true,literalUntrustedText:true,codexUnsupportedExplicit:true,languages:['zh','en'],narrowWidth:430,reducedMotion:true};
    fs.writeFileSync('outputs/social-ui.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
