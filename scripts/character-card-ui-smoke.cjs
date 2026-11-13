'use strict';
// Real character parser, local SQLite/config store and renderer, with headless
// fixture IPC. No account, model, OS vault, desktop window or external action.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {SocialStore}=require('../src/bot/social-store.cjs');
const cards=require('../src/bot/character-cards.cjs');
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-card-ui-')),store=new SocialStore({root:home}),out=path.resolve(__dirname,'../outputs');fs.mkdirSync(out,{recursive:true});
  const imported=cards.parseCard(fs.readFileSync(path.resolve(__dirname,'../examples/characters/ju-bookish.json'),'utf8'));
  const picture='data:image/png;base64,'+fs.readFileSync(path.resolve(__dirname,'../src/ui/portraits/claude-ju-anime-v2.png')).toString('base64');
  let selectedCard=imported;const calls=[];
  const snapshot=()=>({config:{language:'zh'},accounts:{selectedId:'primary'},persona:{portrait:picture,name:{zh:'橘',en:'Ju'}},bot:{status:'disconnected',social:{active:false,supported:true,memoryReady:true,config:store.config(),facts:[],followups:[],entries:[]}}});
  const executablePath=process.env.ARCADE_HEADLESS_BROWSER||['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const receipt={synthetic:true,headless:true,desktopWindowsOpened:0,realAccounts:false,realModels:false,realCredentialAccess:false,localFixtureStore:true,card:'examples/characters/ju-bookish.json'};
  let page;
  try{
    page=await browser.newPage({viewport:{width:850,height:1350}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html lang="zh-CN"><body><main><header>Agent Arcade · Synthetic fixture</header><nav><button data-view="connections">连接</button></nav><select id="view-picker"></select></main></body></html>');
    for(const file of ['style.css','companions.css'])await page.addStyleTag({content:fs.readFileSync(path.resolve(__dirname,'../src/ui',file),'utf8')});
    await page.exposeFunction('fixtureSnapshot',snapshot);await page.exposeFunction('fixtureImport',()=>selectedCard);
    await page.exposeFunction('fixtureApply',card=>{calls.push({method:'apply',count:card.speechExamples.length});store.configure(cards.cardToSettings(card));return snapshot().bot;});
    await page.exposeFunction('fixtureConfigure',patch=>{calls.push({method:'save',count:patch.speechExamples.length});store.configure(patch);return snapshot().bot;});
    await page.evaluate(()=>{window.el=(tag,cls='',value)=>{const node=document.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=value;return node;};window.$=id=>document.getElementById(id);window.switchView=()=>{};window.arcade={snapshot:()=>window.fixtureSnapshot(),characterImport:()=>window.fixtureImport(),characterApply:card=>window.fixtureApply(card),socialConfigure:patch=>window.fixtureConfigure(patch),characterExport:async()=>({saved:false})};});
    await page.addScriptTag({path:path.resolve(__dirname,'../src/ui/relationship.js')});await page.evaluate(async()=>{window.renderRelationship(await window.arcade.snapshot());document.getElementById('relationship-view').hidden=false;});
    const wait=()=>page.waitForFunction(()=>!document.querySelector('.relationship-feedback')?.textContent.includes('处理中'));
    await page.getByRole('tab',{name:'角色卡',exact:true}).click();await wait();assert.equal(await page.locator('#card-examples .relationship-example').count(),0);
    await page.getByRole('button',{name:'导入角色卡…',exact:true}).click();await wait();assert.match(await page.locator('.relationship-card-preview').innerText(),/今天脑子好乱/);assert.equal(await page.locator('#card-examples .relationship-example').count(),0,'preview alone must not overwrite the editor');
    await page.getByRole('button',{name:'使用这张角色卡',exact:true}).click();await wait();assert.match(await page.locator('.relationship-feedback').innerText(),/角色卡已应用/);
    assert.equal(await page.locator('#card-examples .relationship-example').count(),3,'applying the same account and character must refresh the editor immediately');
    const values=await page.locator('#card-examples .relationship-example').evaluateAll(rows=>rows.map(row=>({user:row.querySelector('[data-role=user]').value,assistant:row.querySelector('[data-role=assistant]').value})));assert.deepEqual(values,imported.card.speechExamples);
    await page.evaluate(async()=>window.renderRelationship(await window.arcade.snapshot()));assert.equal(await page.locator('#card-examples .relationship-example').count(),3);
    await page.getByRole('button',{name:'保存说话示例',exact:true}).click();await wait();
    const disk=JSON.parse(fs.readFileSync(path.join(home,'social-config.json'),'utf8'));assert.deepEqual(disk.speechExamples,imported.card.speechExamples,'saving immediately after apply must not replace imported examples with an empty list');
    await page.locator('#relationship-view').evaluate(root=>{const mark=document.createElement('p');mark.textContent='合成 UI · 使用本地测试存储，未连接账号或模型';mark.style.cssText='padding:9px;background:#fff4cf;color:#55451a;font-size:12px';root.prepend(mark);});
    const screenshot=path.join(out,'character-card-applied-examples.png');await page.locator('#relationship-view').screenshot({path:screenshot});receipt.screenshot=screenshot;
    selectedCard={...imported,card:{...imported.card,speechExamples:[]}};await page.getByRole('button',{name:'导入角色卡…',exact:true}).click();await wait();await page.getByRole('button',{name:'使用这张角色卡',exact:true}).click();await wait();assert.equal(await page.locator('#card-examples .relationship-example').count(),0,'an explicitly empty imported card must replace old examples too');
    assert.deepEqual(errors,[]);Object.assign(receipt,{result:'passed',initialExamples:0,importedExamples:3,visibleAppliedExamples:3,pollingRetainsAppliedExamples:true,independentFileReadMatches:true,explicitEmptyCardClearsExamples:true,calls});
  }catch(error){receipt.result='failed';receipt.error=error.message;if(page)await page.screenshot({path:path.join(out,'character-card-ui-failure.png'),fullPage:true});throw error;}
  finally{fs.writeFileSync(path.join(out,'character-card-ui.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();assert(home.startsWith(os.tmpdir()));fs.rmSync(home,{recursive:true,force:true});}
  console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(error);process.exitCode=1;});
