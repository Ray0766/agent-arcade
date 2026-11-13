'use strict';
// Synthetic headless UI + real temporary SQLite. No live account, credential,
// microphone, model, publication or external message is used by this check.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {SocialStore}=require('../src/bot/social-store.cjs');
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-scope-ui-')),out=path.resolve(__dirname,'../outputs');fs.mkdirSync(out,{recursive:true});
  const now=Date.now(),store=new SocialStore({root:home,now:()=>now}),calls=[];
  const state={config:{language:'zh'},accounts:{selectedId:'primary'},persona:{name:{zh:'合成橘',en:'Synthetic Ju'}},bot:{status:'disconnected',channel:'qq',qq:{ownerId:'fixture-owner',check:{accountId:'fixture-account'}},social:{active:false,supported:true,memoryReady:true,config:store.config()}}};
  const scope=()=>JSON.stringify([state.bot.qq.check.accountId,state.bot.qq.ownerId,state.bot.social.config.characterId]);
  const snapshot=()=>structuredClone({...state,bot:{...state.bot,social:{...state.bot.social,facts:store.facts(scope()),followups:store.followups(scope()),entries:store.publicEntries(scope())}}});
  const seededScope=scope();
  store.remember(seededScope,{id:'tea',text:'Original synthetic preference.'});
  store.scheduleFollowup(seededScope,{id:'f',text:'Original synthetic appointment.',dueAt:now+86400000,timeZone:'Australia/Sydney'});
  const executablePath=process.env.ARCADE_HEADLESS_BROWSER||['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const receipt={kind:'synthetic-relationship-scope-ui',synthetic:true,localFixtureStore:true,liveAccounts:false,liveModels:false,externalMessages:0,checks:[],screenshots:[]};
  try{
    const page=await browser.newPage({viewport:{width:900,height:1100},timezoneId:'Australia/Sydney'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());
    await page.setContent('<!doctype html><html lang="zh-CN"><body><main><p id="fixture-mark">合成 UI · 临时本地数据，无真实账号或模型</p><nav><button data-view="connections">连接</button></nav><select id="view-picker"></select></main></body></html>');
    for(const file of ['style.css','companions.css'])await page.addStyleTag({content:fs.readFileSync(path.resolve(__dirname,'../src/ui',file),'utf8')});
    await page.exposeFunction('fixtureSnapshot',snapshot);
    await page.exposeFunction('fixtureEdit',value=>{
      calls.push(value);const {action,id,...record}=value;
      if(action==='correct')store.correctFact(scope(),id,record);
      else if(action==='followup-edit')store.updateFollowup(scope(),id,record);
      else if(action==='remember')store.remember(scope(),record);
      else throw Error('Unsupported fixture edit');
      return snapshot().bot;
    });
    await page.evaluate(()=>{window.el=(tag,cls='',value)=>{const node=document.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=value;return node;};window.$=id=>document.getElementById(id);window.switchView=()=>{};window.arcade={snapshot:()=>window.fixtureSnapshot(),socialEdit:value=>window.fixtureEdit(value)};});
    await page.addScriptTag({path:path.resolve(__dirname,'../src/ui/relationship.js')});
    const render=()=>page.evaluate(async()=>{window.renderRelationship(await window.arcade.snapshot());document.getElementById('relationship-view').hidden=false;});
    const settle=()=>page.waitForFunction(()=>!document.querySelector('.relationship-feedback')?.textContent.match(/处理中|Working/));
    const tab=async label=>{await page.getByRole('tab',{name:label,exact:true}).click();await settle();};
    const shot=async name=>{const file=path.join(out,`relationship-scope-${name}.png`);await page.screenshot({path:file,fullPage:true});receipt.screenshots.push(file);};
    await render();await page.getByRole('button',{name:'修改',exact:true}).click();await settle();
    await page.locator('#memory-text').fill('Stale edit must not overwrite.');
    store.correctFact(seededScope,'tea',{text:'Newer preference saved elsewhere.',revision:1});await render();
    await page.getByRole('button',{name:'记住这件事',exact:true}).click();await settle();
    assert.equal(calls.at(-1).revision,1);assert.equal(store.facts(seededScope)[0].text,'Newer preference saved elsewhere.');
    assert.match(await page.locator('.relationship-feedback').innerText(),/记忆已被更新.*重新点/);receipt.checks.push('A stale fact edit submits its displayed revision and cannot overwrite newer stored text.');await shot('stale-memory-zh');
    // Correcting memory deliberately cancelled the earlier linked appointment.
    // Start a fresh independent agreement for the concurrent-editor check.
    store.scheduleFollowup(seededScope,{id:'current-f',text:'A new synthetic appointment.',dueAt:now+86400000,timeZone:'Australia/Sydney'});await render();
    await tab('约定回访');await page.getByRole('button',{name:'修改',exact:true}).click();await settle();
    await page.locator('#followup-text').fill('Stale appointment edit.');store.updateFollowup(seededScope,'current-f',{text:'Newer appointment saved elsewhere.',revision:1});await render();
    await page.getByRole('button',{name:'约好回访',exact:true}).click();await settle();
    assert.equal(calls.at(-1).revision,1);assert.equal(store.followups(seededScope).find(row=>row.id==='current-f').text,'Newer appointment saved elsewhere.');
    assert.match(await page.locator('.relationship-feedback').innerText(),/回访已被更新.*重新点/);receipt.checks.push('A stale follow-up editor cannot overwrite a newer agreement.');
    state.bot.qq.ownerId='other-owner';await render();assert.equal(await page.locator('#followup-text').inputValue(),'');assert.equal(await page.locator('#followup-time').inputValue(),'');receipt.checks.push('Changing the QQ owner in the same profile clears the old appointment editor.');
    await tab('记得的事');await page.locator('#memory-text').fill('Private draft for the old actual account.');state.bot.qq.check.accountId='other-account';await render();assert.equal(await page.locator('#memory-text').inputValue(),'');receipt.checks.push('Changing the verified QQ account clears private drafts even when profile and character are unchanged.');
    await tab('她的日记');await page.locator('#journal-text').fill('Draft for an established relationship.');state.bot.social.memoryReady=false;await render();assert.equal(await page.locator('#journal-text').inputValue(),'');assert.equal(await page.getByRole('button',{name:'保存草稿',exact:true}).isDisabled(),true);receipt.checks.push('Losing the verified relationship clears the public editor and disables saving.');
    state.bot.social.memoryReady=true;await render();await page.locator('#journal-text').fill('New relationship draft survives ordinary refresh.');await render();assert.equal(await page.locator('#journal-text').inputValue(),'New relationship draft survives ordinary refresh.');receipt.checks.push('Ordinary snapshots retain drafts for the same verified relationship.');
    state.config.language='en';await page.setViewportSize({width:430,height:1000});await render();await page.evaluate(()=>{document.documentElement.lang='en';document.querySelector('#fixture-mark').textContent='Synthetic UI · local fixture only';});await shot('new-relationship-en-430');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);assert.deepEqual(errors,[]);receipt.result='passed';
  }catch(error){receipt.result='failed';receipt.error=error.message;throw error;}
  finally{receipt.capturedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'relationship-scope-ui.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();assert(home.startsWith(os.tmpdir()+path.sep));fs.rmSync(home,{recursive:true,force:true});}
  console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(error);process.exitCode=1;});
