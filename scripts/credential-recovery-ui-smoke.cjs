'use strict';
// Production renderer, synthetic IPC. No keys, Keychain, accounts or models.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve('outputs/credential-recovery-ui');fs.mkdirSync(out,{recursive:true});
 const installed='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',browserPath=process.env.ARCADE_HEADLESS_BROWSER||(fs.existsSync(installed)?installed:null);
 const browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});
 const receipt={synthetic:true,credentialsRead:false,keychainAccessed:false,modelsCalled:false,checks:[],screenshots:[]};
 try{
  const page=await browser.newPage({viewport:{width:1180,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><html><body><p>SYNTHETIC UI · No saved credentials or Keychain accessed</p><main><header>Agent Arcade</header><section id="bot-view"><div id="host"></div></section></main></body></html>');
  for(const file of ['style.css','companions.css','theme.css','first-run.css'])if(fs.existsSync(path.resolve('src/ui',file)))await page.addStyleTag({content:fs.readFileSync(path.resolve('src/ui',file),'utf8')});
  await page.evaluate(()=>{
   window.el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
   window.calls=[];window.view='bot';document.body.dataset.view='bot';window.fixture={demo:false,config:{language:'zh'},accounts:{selectedId:'primary',accounts:[{id:'primary',name:'橘',mode:'api',channel:'wechat',status:'disconnected',credentialState:'locked'}]},bot:{mode:'api',channel:'wechat',status:'disconnected',credentialState:'locked',hasKey:false}};
   window.toast=text=>{window.lastToast=text;};window.switchView=v=>{window.view=v;document.body.dataset.view=v;for(const node of document.querySelectorAll('main>.view'))node.hidden=node.id!==v+'-view';};window.action=fn=>fn();
   window.arcade={platform:{os:'darwin'},snapshot:async()=>structuredClone(window.fixture),accountRetryCredentials:async value=>{calls.push(['retry',value]);return window.holdRetry?new Promise(resolve=>{window.finishRetry=resolve;}):{recovered:false,code:'keychain_restart_required'};},accountResetCredentials:async value=>{calls.push(['reset',value]);if(value.action==='prepare')return {prepared:true,ticket:'fixture-ticket',allProfileCredentials:true,conversationsRetained:true};window.fixture.bot.credentialState='empty';window.fixture.accounts.accounts[0].credentialState='empty';return {reset:true,encryptedBackupKept:true,conversationsRetained:true,allProfileCredentials:true};}};
   window.render=()=>{window.renderFirstRun(fixture);const card=ArcadeFirstRun.inline(fixture);if(card)document.getElementById('host').replaceChildren(card);};
  });
  await page.addScriptTag({path:path.resolve('src/ui/first-run.js')});await page.evaluate(()=>render());
  assert.match(await page.locator('#first-run-title').innerText(),/已保存的密钥暂时无法打开/);assert(await page.locator('#first-run-key').isHidden());
  await page.locator('#first-run-retry-credentials').click();await page.locator('#first-run-recovery-status').filter({hasText:'完全退出并重新打开 App'}).waitFor();
  assert.equal((await page.evaluate(()=>calls))[0][1].profileId,'primary');receipt.checks.push('Locked API profile has safe Keychain retry and restart guidance; no key input or automatic model start.');
  await page.screenshot({path:path.join(out,'locked-zh.png'),fullPage:true,animations:'disabled'});receipt.screenshots.push('locked-zh.png');
  await page.locator('#first-run-reset-credentials').click();assert.match(await page.locator('#first-run-recovery-status').innerText(),/全部 API key 和渠道登录凭据/);assert.equal((await page.evaluate(()=>calls)).filter(c=>c[0]==='reset'&&c[1].action==='confirm').length,0);
  await page.screenshot({path:path.join(out,'reset-confirm-zh.png'),fullPage:true,animations:'disabled'});receipt.screenshots.push('reset-confirm-zh.png');
  await page.locator('#first-run-reset-cancel').click();assert(await page.locator('#first-run-reset-cancel').isHidden());
  await page.locator('#first-run-reset-credentials').click();await page.locator('#first-run-reset-credentials').click();
  assert.match(await page.evaluate(()=>lastToast),/原加密凭据已备份.*聊天和记忆保留/);receipt.checks.push('Reset requires two actions, warns about all profile credentials, supports cancel, and says chat/memory remain.');
  await page.evaluate(()=>{fixture.bot.credentialState='locked';fixture.accounts.accounts[0].credentialState='locked';fixture.config.language='en';render();});await page.setViewportSize({width:430,height:950});
  await page.screenshot({path:path.join(out,'locked-en-narrow.png'),fullPage:true,animations:'disabled'});receipt.screenshots.push('locked-en-narrow.png');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.match(await page.locator('#first-run-title').innerText(),/Saved keys could not be opened/);
  await page.evaluate(()=>{window.holdRetry=true;});await page.locator('#first-run-retry-credentials').click();
  await page.evaluate(()=>{fixture.accounts.selectedId='other';render();finishRetry({recovered:false,code:'keychain_restart_required'});});
  await page.waitForFunction(()=>!document.getElementById('first-run-retry-credentials').disabled);assert.equal(await page.locator('#first-run-recovery-status').innerText(),'');receipt.checks.push('English 430px is readable; a late result cannot write recovery feedback into another companion.');
  await page.evaluate(()=>{fixture.accounts.selectedId='primary';render();window.snapshotBeforeSwitch=structuredClone(fixture);window.previousToast=lastToast;window.arcade.accountRetryCredentials=async value=>{calls.push(['retry',value]);return {recovered:true};};window.arcade.snapshot=()=>new Promise(resolve=>{window.finishSnapshot=resolve;});});
  await page.locator('#first-run-retry-credentials').click();await page.waitForFunction(()=>typeof window.finishSnapshot==='function');
  await page.evaluate(()=>{fixture.accounts.selectedId='other';render();finishSnapshot(snapshotBeforeSwitch);});await page.waitForFunction(()=>!document.getElementById('first-run-retry-credentials').disabled);
  assert.equal(await page.evaluate(()=>lastToast),await page.evaluate(()=>previousToast));
  await page.evaluate(()=>{window.arcade.snapshot=async()=>structuredClone(fixture);window.arcade.accountRetryCredentials=async value=>{calls.push(['retry',value]);return {recovered:false,code:'keychain_restart_required'};};});
  await page.locator('#first-run-retry-credentials').click();await page.waitForFunction(()=>!document.getElementById('first-run-retry-credentials').disabled);assert.equal((await page.evaluate(()=>calls)).at(-1)[1].profileId,'other');receipt.checks.push('A late successful recovery snapshot cannot restore the previous selection or show a success toast after switching companions.');
  await page.setViewportSize({width:1100,height:1000});
  await page.evaluate(()=>{document.querySelector('main').innerHTML='<header>Agent Arcade</header>';fixture.accounts.selectedId='primary';fixture.config.language='zh';fixture.accounts.accounts[0].credentialState='locked';view='accounts';document.body.dataset.view='accounts';});
  await page.addScriptTag({path:path.resolve('src/ui/accounts.js')});await page.evaluate(()=>{renderAccounts(fixture);openCompanionManager();});
  assert.equal(await page.getByRole('button',{name:'迁移原应用凭据…',exact:true}).count(),0);assert(await page.getByRole('button',{name:'恢复已保存凭据…',exact:true}).isEnabled());
  await page.screenshot({path:path.join(out,'manager-mac-zh.png'),fullPage:true,animations:'disabled'});receipt.screenshots.push('manager-mac-zh.png');receipt.checks.push('Mac manager offers selected-profile recovery instead of Windows Electron-profile migration.');
  assert.deepEqual(errors,[]);receipt.passed=true;
 }finally{await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');}
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
