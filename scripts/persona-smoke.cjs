'use strict';
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-personas-')),stage=process.env.ARCADE_EXECUTABLE?'packaged':'source';
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'zh',portrait:'anime'}));
  const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'settings.json')};delete env.ELECTRON_RUN_AS_NODE;
  const args=[`--user-data-dir=${path.join(root,'profile')}`];if(!process.env.ARCADE_EXECUTABLE)args.unshift(path.resolve(__dirname,'..'));
  const app=await electron.launch({executablePath:process.env.ARCADE_EXECUTABLE||require('electron'),args,env});
  try{
    const page=await app.firstWindow(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>{network.push(r.request().url());return r.abort();});
    await page.locator('nav [data-view="bot"]').click();await page.locator('#bot-view').waitFor();assert.equal(await page.locator('#bot-view h1').textContent(),'橘');
    const defaults=await page.evaluate(()=>window.arcade.snapshot());assert.equal(defaults.persona.id,'claude-ju');assert.equal(defaults.config.personaVoice,true);
    await page.locator('#ws-work').click();await page.locator('nav [data-view="connections"]').click();await page.locator('#onboarding-optional-toggle').click();await page.locator('#onboarding-appearance summary').click();await page.locator('#persona-character').waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('#connections-view img')].every(i=>i.complete&&i.naturalWidth>0));
    // Gemini and Doubao are selectable providers now; the page no longer lists planned connections.
    const expected={claude:'claude-ju',gpt:'codex-dragon',deepseek:'deepseek-whale',gemini:'gemini-cat',doubao:'doubao-girl'};
    for(const [backend,persona] of Object.entries(expected))assert.match(await page.locator(`#connections-view [data-provider="${backend}"] img`).getAttribute('src'),new RegExp(`${persona}-anime-v2\\.png$`));
    await page.locator('#persona-voice').uncheck();await page.waitForFunction(async()=>(await window.arcade.snapshot()).config.personaVoice===false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).personaVoice,false);
    await page.locator('#persona-character').selectOption('sprout');await page.waitForFunction(async()=>(await window.arcade.snapshot()).persona.id==='sprout');
    await page.locator('#ws-companion').click();await page.locator('nav [data-view="bot"]').click();assert.equal(await page.locator('#bot-view h1').textContent(),'小芽');assert.match(await page.locator('#bot-mascot img').getAttribute('src'),/sprout-anime/);
    await page.evaluate(()=>window.arcade.configure({character:'https://example.invalid/persona'}));assert.equal((await page.evaluate(()=>window.arcade.snapshot())).config.character,'sprout');
    await page.evaluate(()=>window.arcade.configure({character:'default',personaVoice:true,portrait:'pixel'}));await page.waitForFunction(()=>document.querySelector('#bot-view h1').textContent==='橘');assert.equal(await page.locator('#bot-mascot svg').count(),1);
    await page.evaluate(()=>window.arcade.configure({portrait:'anime'}));await page.waitForFunction(()=>document.querySelector('#bot-mascot img')?.naturalWidth>0);
    await page.evaluate(async()=>{await window.arcade.botConfigure({mode:'native'});});assert.equal((await page.evaluate(()=>window.arcade.snapshot())).persona.id,'claude-ju');
    await page.locator('#ws-work').click();await page.locator('nav [data-view="connections"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('#connections-view img')].every(i=>i.complete&&i.naturalWidth>0));
    fs.mkdirSync('outputs',{recursive:true});await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(400,380);w.setContentSize(1150,900);});
    await page.screenshot({path:path.join('outputs',`personas-${stage}.png`),fullPage:true});
    await page.locator('#language').click();assert.equal(await page.locator('.persona-active h3').textContent(),'Ju');await page.locator('#language').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(430,760));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join('outputs',`personas-${stage}-compact.png`),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    const result={stage,defaultClaude:'claude-ju',providerAvatarChoicesLoaded:5,voiceSettingPersisted:true,characterSwitchAndInvalidValue:true,pixelStyleKeepsIdentity:true,nativeAndApiSameClaudePersona:true,languages:['zh','en'],narrowWidth:430,noNetwork:true,livePersonaReply:false};
    fs.writeFileSync(path.join('outputs',`personas-${stage}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
