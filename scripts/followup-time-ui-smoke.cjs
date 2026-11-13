'use strict';
// Headless renderer plus a real temporary SQLite store. No QQ, model, vault,
// audio device or desktop window is used. The clock and time zone are fixtures.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {SocialStore}=require('../src/bot/social-store.cjs');
(async()=>{
  const now=Date.parse('2026-11-05T10:00:00Z'),scope='followup-time-fixture';
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-followup-ui-')),out=path.resolve(__dirname,'../outputs');fs.mkdirSync(out,{recursive:true});
  let store=new SocialStore({root:home,now:()=>now});
  const precise=store.scheduleFollowup(scope,{id:'precise',text:'合成约定：只修改内容，时间保持到秒。',dueAt:Date.parse('2026-11-06T18:00:37+11:00'),timeZone:'Australia/Sydney'});
  const picture='data:image/png;base64,'+fs.readFileSync(path.resolve(__dirname,'../src/ui/portraits/claude-ju-anime-v2.png')).toString('base64');
  const calls=[],snapshot=()=>({config:{language:'zh'},accounts:{selectedId:'primary'},persona:{portrait:picture,name:{zh:'橘',en:'Ju'}},bot:{status:'disconnected',social:{active:false,supported:true,memoryReady:true,config:store.config(),facts:[],followups:store.followups(scope),entries:[]}}});
  const executablePath=process.env.ARCADE_HEADLESS_BROWSER||['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const receipt={synthetic:true,headless:true,clock:'2026-11-05T10:00:00Z',timeZone:'Australia/Sydney',realAccounts:false,realModels:false,realCredentialAccess:false,desktopWindowsOpened:0,localFixtureStore:true};let page;
  try{
    page=await browser.newPage({viewport:{width:850,height:1100},timezoneId:'Australia/Sydney'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html lang="zh-CN"><body><main><nav><button data-view="connections">连接</button></nav><select id="view-picker"></select></main></body></html>');
    for(const file of ['style.css','companions.css'])await page.addStyleTag({content:fs.readFileSync(path.resolve(__dirname,'../src/ui',file),'utf8')});
    await page.exposeFunction('fixtureSnapshot',snapshot);
    await page.exposeFunction('fixtureEdit',value=>{calls.push(value);const {action,id,...record}=value;if(action==='followup-add')store.scheduleFollowup(scope,record);else if(action==='followup-edit')store.updateFollowup(scope,id,record);else throw Error('Unsupported fixture action');return snapshot().bot;});
    await page.evaluate(now=>{Date.now=()=>now;window.el=(tag,cls='',value)=>{const node=document.createElement(tag);node.className=cls;if(value!==undefined)node.textContent=value;return node;};window.$=id=>document.getElementById(id);window.switchView=()=>{};window.arcade={snapshot:()=>window.fixtureSnapshot(),socialEdit:value=>window.fixtureEdit(value)};},now);
    await page.addScriptTag({path:path.resolve(__dirname,'../src/ui/relationship.js')});await page.evaluate(async()=>{window.renderRelationship(await window.arcade.snapshot());document.getElementById('relationship-view').hidden=false;});
    const settle=()=>page.waitForFunction(()=>!document.querySelector('.relationship-feedback')?.textContent.includes('处理中'));
    await page.getByRole('tab',{name:'约定回访',exact:true}).click();await settle();
    await page.getByRole('button',{name:'修改',exact:true}).click();await settle();await page.locator('#followup-text').fill('合成约定：修改后的话题。');
    await page.getByRole('button',{name:'约好回访',exact:true}).click();await settle();
    assert.equal(store.followups(scope)[0].dueAt,precise.dueAt,'editing only the topic must retain the original seconds');
    assert.match(await page.locator('.relationship-feedback').innerText(),/已保存/);receipt.editPreservesExactInstant=true;
    await page.locator('#followup-text').fill('合成约定：不能顺延不存在的时间。');await page.locator('#followup-time').fill('2027-10-03T02:30');const beforeGap=calls.length;
    await page.getByRole('button',{name:'约好回访',exact:true}).click();await settle();
    assert.equal(calls.length,beforeGap,'a nonexistent local time must not silently advance to 03:30 and reach storage');assert.match(await page.locator('.relationship-feedback').innerText(),/不存在|夏令时/);receipt.nonexistentTimeRejected=true;
    await page.locator('#followup-time').fill('2027-04-04T02:30');const beforeOverlap=calls.length;
    await page.getByRole('button',{name:'约好回访',exact:true}).click();await settle();
    assert.equal(calls.length,beforeOverlap,'an ambiguous local time must not silently choose one occurrence');assert.match(await page.locator('.relationship-feedback').innerText(),/两次|重复|夏令时/);receipt.ambiguousTimeRequiresExplicitOffset=true;
    await page.locator('#relationship-view').evaluate(root=>{const mark=document.createElement('p');mark.textContent='合成 UI · 悉尼时间区／固定时钟，未连接 QQ 或模型';mark.style.cssText='padding:9px;background:#fff4cf;color:#55451a;font-size:12px';root.prepend(mark);});
    receipt.screenshot=path.join(out,'followup-time-dst-warning.png');await page.locator('#relationship-view').screenshot({path:receipt.screenshot});
    await page.locator('#followup-text').fill('合成约定：正常时段。');await page.locator('#followup-time').fill('2027-04-04T03:30');await page.getByRole('button',{name:'约好回访',exact:true}).click();await settle();
    const normal=store.followups(scope).find(f=>f.text==='合成约定：正常时段。');assert.equal(normal.dueAt,Date.parse('2027-04-04T03:30:00+10:00'));receipt.validTimeMatchesOffset=true;
    store=new SocialStore({root:home,now:()=>now});assert.equal(store.followups(scope).find(f=>f.id==='precise').dueAt,precise.dueAt);assert(store.followups(scope).every(f=>f.state==='pending'));receipt.futureAppointmentsSurviveStoreReopen=true;
    assert.deepEqual(errors,[]);receipt.result='passed';receipt.persistedAppointments=store.followups(scope).length;
  }catch(error){receipt.result='failed';receipt.error=error.message;throw error;}
  finally{fs.writeFileSync(path.join(out,'followup-time-ui.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();assert(home.startsWith(os.tmpdir()));fs.rmSync(home,{recursive:true,force:true});}
  console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(error);process.exitCode=1;});
