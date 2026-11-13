'use strict';
// Production DOM/Panel/Session/client/copy staging; synthetic typed remote only.
// No Electron, real registration, external network or live remote filesystem.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http'),https=require('node:https');
const {chromium}=require('playwright');
const {fixture,deferred}=require('../test/helpers/qq-remote-copy-fixture.cjs');
const {QQRemotePanel,METHODS}=require('../src/bot/qq-remote-panel.cjs');
const {remoteResult}=require('../src/bot/qq-remote-session.cjs');
const {validateRemoteTrust}=require('../src/bot/qq-remote-transport.cjs');
const ROOT=path.resolve(__dirname,'..'),UI=path.join(ROOT,'src/ui'),OUT=path.resolve(ROOT,process.argv[2]||'outputs/qq-remote-copy-ui-20261107');
const catalog=require('../src/core/personas.cjs').publicCatalog(),cleanup=[],f=fixture({after:fn=>cleanup.push(fn)}),state=f.state;
const receipt={kind:'production-dom-session-copy',realAccounts:false,actualRemoteFilesystem:false,modelsCalled:0,electronStarted:false,checks:[],screenshots:[]};
const wire={calls:[],patch:null},pass=text=>receipt.checks.push(text);let page,browser,networkFallback=0;
const saved={http:http.request,https:https.request};http.request=https.request=()=>{networkFallback++;throw Error('Network fallback forbidden');};
const panel=new QQRemotePanel({registry:f.registry,validateTrust:validateRemoteTrust,captureContext:()=>state.context,sessionResult:remoteResult,sessionFactory:options=>{f.session.capture=options.capture;return f.session;}});
(async()=>{fs.mkdirSync(OUT,{recursive:true});state.now=Date.now();state.add('/sandbox/binary.bin','file',Buffer.from([0,255,13,10,42]));state.add('/sandbox/a.txt','file','alpha');state.add('/sandbox/b.txt','file','beta');state.add('/sandbox/folder/nested/data.bin','file',Buffer.from([0,1,2,255]));try{
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1180,height:900}});page.setDefaultTimeout(10000);const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());let file;if(u.origin==='http://127.0.0.1:41278'){
    if(u.pathname==='/')file=path.join(UI,'index.html');else if(/^\/[a-z0-9-]+\.(css|js)$/.test(u.pathname))file=path.join(UI,u.pathname.slice(1));else if(/^\/(portraits|ornaments)\/[a-z0-9-]+\.png$/.test(u.pathname))file=path.join(UI,u.pathname.slice(1));else if(u.pathname==='/assets/brand/ribbon-simple-v1.png')file=path.join(ROOT,'src/assets/brand/ribbon-simple-v1.png');}
    if(!file||!fs.existsSync(file)){network.push(u.origin+u.pathname);return route.abort();}return route.fulfill({path:file});});
  const registryMethods={qqRemoteList:'list',qqRemoteRegistryClose:'closeOwned',qqRemoteCreate:'create',qqRemoteUpdate:'update',qqRemoteForget:'forget',qqRemotePickCA:'pickCAFile'},sessionMethods=Object.fromEntries(Object.entries(METHODS).map(([k,v])=>['qqRemote'+k,v]));
  await page.exposeFunction('copyIPC',async(method,input)=>{wire.calls.push({method,input:structuredClone(input)});let result=registryMethods[method]?await panel.result(input,()=>panel[registryMethods[method]](input)):await panel.call(sessionMethods[method],input);if(wire.patch?.method===method){const patch=wire.patch;wire.patch=null;result=structuredClone(result);patch.apply(result);}return result;});
  await page.addInitScript(({catalog,methods})=>{
    const f=window.copyFixture={listeners:[],mutations:[],state:{demo:false,installed:false,problem:'',lastEventAt:0,config:{language:'zh',quiet:false,compact:false,portrait:'anime',character:'default',personaVoice:true,notifications:false,captureResults:false,theme:'workshop'},themes:[],tasks:[],work:{},personas:catalog,accounts:{selectedId:'',accounts:[]},bot:{mode:'api',channel:'wechat',workspace:'',status:'disconnected',paired:false,hasKey:false,problem:'',tasks:{tasks:[],pending:[],messages:[]},social:{supported:false,config:{enabled:false},facts:[],history:[],actions:[],followups:[],entries:[]}},qqRuntime:{configured:false,instances:[]}}};
    f.publish=()=>{f.state.theme=window.arcadePreviewThemes.workshop;f.state.themes=[{id:'workshop',name:'Moss Workshop'}];f.state.persona=catalog[0];for(const fn of f.listeners)fn(structuredClone(f.state));return structuredClone(f.state);};
    window.arcade={snapshot:async()=>f.publish(),subscribe:fn=>{f.listeners.push(fn);return()=>{};}};for(const m of methods)window.arcade[m]=input=>window.copyIPC(m,input);
  },{catalog,methods:[...Object.keys(registryMethods),...Object.keys(sessionMethods)]});
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:41278/');await page.locator('#connections-content h1').waitFor();
  const settle=()=>page.waitForFunction(()=>!document.getElementById('qrf-progress')&&!document.getElementById('qrmt-feedback')?.textContent.match(/正在处理|Working/));
  const click=async id=>{await page.locator('#'+id).click();await settle();},shot=async name=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await page.locator('.qrmt-detail').evaluate(n=>n.scrollWidth<=n.clientWidth));await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:true});receipt.screenshots.push(name+'.png');};
  const open=async()=>{await page.evaluate(()=>switchView('qq-runtime'));await click('qq-remote-open');await click('qrmt-item-'+f.item.remoteId);await click('qrmt-read');await click('qrmt-files-open');await page.locator('#qrf-root').fill('/sandbox');await click('qrf-open');};
  const select=async name=>page.getByRole('checkbox',{name:'选择 '+name,exact:true}).check();
  const directory=async name=>{const row=page.locator('.qrf-row').filter({has:page.locator('strong',{hasText:name})});await row.getByRole('button',{name:/打开|Open/,exact:true}).click();await settle();};
  const destination=async name=>{await click('qrf-browse-destination');if(name)await directory(name);await click('qrf-choose-destination');};
  const preview=()=>click('qrf-preview'),confirm=()=>click('qrf-confirm');
  const freshRoot=async()=>{await click('qrf-result-read');if(await page.locator('#qrf-up').count())await click('qrf-up');};
  await open();
  await select('binary.bin');await click('qrf-copy');assert.equal(await page.locator('#qrf-preview').isEnabled(),false);assert.match(await page.locator('.qrmt-detail').innerText(),/原始文件下载到本机临时区/);assert.equal(state.fileWrites.length,0);await destination('destination');
  const downloads=state.fileRequests.filter(x=>x.route==='download').length;await preview();assert.equal(state.fileWrites.length,0);assert(state.fileRequests.filter(x=>x.route==='download').length>downloads);assert.equal(await page.locator('#qrf-confirm').innerText(),'复制所选项');await shot('file-copy-preview-zh-wide');
  pass('A listed binary file needs an explicit observed destination. Before preview, the UI discloses local raw-byte staging and remote directory ZIP effects; preview downloads but sends no destination write.');
  const scope=page.locator('#qrf-copy-scope');assert.equal(await scope.evaluate(n=>n.open),false);assert.match(await page.locator('.qrmt-detail').innerText(),/中断可能留下部分文件/);assert.doesNotMatch(await page.locator('.qrmt-detail').innerText(),/完整快照|正在使用的配置/);await scope.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await scope.evaluate(n=>n.open),true);assert.match(await scope.innerText(),/无法锁定远端变化/);await shot('copy-scope-keyboard-zh-wide');await page.keyboard.press('Enter');assert.equal(await scope.evaluate(n=>n.open),false);
  pass('Copy preview prioritizes source, destination, counts, bytes and the action. Engineering boundaries remain in a keyboard-operable collapsed disclosure; the partial-file interruption warning stays visible.');
  const source=Buffer.from(state.tree.get('/sandbox/binary.bin').bytes);await confirm();assert.match(await page.locator('#qrf-result').innerText(),/远端请求已应答/);assert.match(await page.locator('#qrf-copy-items').innerText(),/destination\/binary.bin/);assert.deepEqual(state.tree.get('/sandbox/destination/binary.bin').bytes,source);await shot('file-copy-result-zh-wide');await freshRoot();
  pass('Real Session/client/copy staging preserves binary bytes, including NUL; the UI separates acknowledged item/step counts from a later matching content manifest.');

  await select('folder');await click('qrf-copy');await destination('destination');await preview();assert.match(await page.locator('.qrmt-detail').innerText(),/仅复制可观察内容，未发现的空目录及文件属性不能保证保留/);assert.equal(await page.locator('#qrf-copy-scope').evaluate(n=>n.open),false);await shot('directory-copy-preview-zh-wide');await confirm();assert.match(await page.locator('#qrf-result').innerText(),/目录完整性未确认/);assert.equal(state.tree.get('/sandbox/destination/folder/empty').kind,'directory');assert.deepEqual(state.tree.get('/sandbox/destination/folder/nested/data.bin').bytes,state.tree.get('/sandbox/folder/nested/data.bin').bytes);await shot('directory-copy-result-zh-wide');await freshRoot();
  pass('The production ZIP/staging chain copies nested file bytes and an observed empty folder. The result explicitly leaves directory completeness unverified and does not call the operation atomic.');

  await select('a.txt');await select('b.txt');await click('qrf-copy');await destination('destination');await preview();
  let uploads=0;state.fileBefore=async route=>{if(route==='upload')state.fileWriteError=++uploads===2;};await confirm();state.fileBefore=null;state.fileWriteError=false;
  assert.match(await page.locator('#qrf-result').innerText(),/结果尚未确认/);assert.equal(await page.locator('#qrf-copy-items > li').count(),2);assert.match(await page.locator('#qrf-copy-items > li').nth(0).innerText(),/计划写入已应答/);assert.match(await page.locator('#qrf-copy-items > li').nth(1).innerText(),/写入结果未确认/);assert.equal(await page.locator('#qrf-confirm').count(),0);
  const writes=state.fileWrites.length;await page.waitForTimeout(80);assert.equal(state.fileWrites.length,writes);await shot('batch-partial-unknown-zh-wide');await freshRoot();
  pass('A second-root post-submit timeout retains the first root acknowledgement and the second unknown result, even if bytes were written. The one-use ticket is consumed without automatic resend.');

  await select('binary.bin');await click('qrf-copy');await destination();
  // Select the source parent itself: real policy refuses this collision before writing.
  await preview();assert.equal(await page.locator('#qrf-confirm').count(),0);assert.match(await page.locator('#qrf-feedback').innerText(),/重新读取/);await click('qrf-edit-back');
  pass('A same-directory/collision destination is rejected by production policy; the UI offers no confirmation or fake successful copy.');

  // A fresh destination keeps the cancellation and malformed-receipt cases independent.
  state.add('/sandbox/cancel-destination','directory');await click('qrf-refresh');await select('binary.bin');await click('qrf-copy');await destination('cancel-destination');
  const entered=deferred(),held=deferred();state.fileBefore=async route=>{if(route==='download'){entered.resolve();await held.promise;}};const beforeCancel=state.fileWrites.length;
  await page.locator('#qrf-preview').click();await entered.promise;assert.match(await page.locator('#qrf-progress').innerText(),/下载原始文件/);await shot('copy-preparation-cancel-zh-wide');await page.locator('#qrf-cancel').click();assert.equal(await page.locator('#qrf-back').isEnabled(),false);held.resolve();state.fileBefore=null;await settle();assert.equal(state.fileWrites.length,beforeCancel);assert.equal(await page.locator('#qrf-confirm').count(),0);
  const request=wire.calls.filter(c=>c.method==='qqRemoteFilesPreview').at(-1),cancel=wire.calls.filter(c=>c.method==='qqRemoteFilesCancel').at(-1);assert.equal(request.input.operationId,cancel.input.operationId);await click('qrf-edit-back');await click('qrf-up');
  pass('Cancelling copy preparation uses the exact operation UUID, waits for settlement/cleanup, and submits no target write. It does not promise remote ZIP cleanup.');

  await select('binary.bin');await click('qrf-copy');await destination('cancel-destination');await preview();wire.patch={method:'qqRemoteFilesConfirm',apply:r=>{r.change.copy.items[0].relativePath='wrong-target';}};await confirm();assert.match(await page.locator('#qrf-result').innerText(),/未取得可信的逐项计数/);assert.equal(await page.locator('#qrf-copy-items').count(),0);await freshRoot();
  pass('A wrong copy-item destination in a reply cannot be shown as acknowledgement; the UI retains an unknown result with no trusted counters.');

  state.add('/sandbox/refusal-destination','directory');await click('qrf-refresh');await select('binary.bin');await click('qrf-copy');await destination('refusal-destination');await preview();wire.patch={method:'qqRemoteFilesConfirm',apply:r=>{r.change.submission='not_submitted';r.change.outcome='not_submitted';r.change.bridgeResponse='unavailable';}};await confirm();assert.match(await page.locator('#qrf-result').innerText(),/结果尚未确认/);assert.doesNotMatch(await page.locator('#qrf-result').innerText(),/本次变更未提交/);assert.equal(await page.locator('#qrf-copy-items').count(),0);await freshRoot();
  pass('A real completed receipt with only its overall fields changed to not-submitted is rejected; contradictory item/step facts never become a claim that nothing was submitted.');

  state.add('/sandbox/long-synthetic-name-带中文-raw-bytes-for-copy-preview.bin','file',Buffer.from([0,255,42]));state.add('/sandbox/narrow-destination','directory');await click('qrf-refresh');await select('long-synthetic-name-带中文-raw-bytes-for-copy-preview.bin');await click('qrf-copy');await destination('narrow-destination');await preview();
  await page.setViewportSize({width:430,height:900});await page.locator('#qrf-confirm').scrollIntoViewIfNeeded();await shot('copy-preview-zh-430');await page.evaluate(()=>{copyFixture.state.config.language='en';copyFixture.publish();});await page.locator('#qrf-confirm').scrollIntoViewIfNeeded();await shot('copy-preview-en-430');assert.equal(await page.locator('#qrmt-title').evaluate(n=>getComputedStyle(n).fontSize),'17px');assert.equal(await page.locator('.qrmt-detail').evaluate(n=>getComputedStyle(n).fontSize),'14px');
  await page.locator('#qrf-confirm').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'qrf-preview-back');assert.equal(await page.locator('#qrf-preview-back').evaluate(n=>getComputedStyle(n).outlineStyle),'solid');await page.keyboard.press('Enter');await settle();assert.equal(await page.locator('#qrf-confirm').count(),0);
  pass('Chinese/English 430 px, long filenames and reduced-motion keyboard navigation retain the existing 17/14 typography. Back dismisses prepared bytes and the ticket without submitting copy.');

  const owned=f.session.session.client,clients=state.clients;await click('qrf-back');assert.equal(f.session.session.client,owned);assert.equal(state.clients,clients);assert(await page.locator('#qrmt-files-open').isEnabled());
  pass('Files Back awaits owned temporary cleanup and returns to ordinary management with the same authenticated client, without another authentication.');
  assert.equal(networkFallback,0);assert.equal(state.textReads,0);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);receipt.protocol={productionPanel:true,productionSession:true,productionClient:true,productionCopyHelper:true,productionTemporaryStage:true,syntheticRemoteTransport:true,fixturePacingMs:0,externalNetworkCalls:0,textReadCalls:0};receipt.result='passed';
}catch(error){receipt.result='failed';receipt.error=error.stack;if(page)await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await panel.close();for(const fn of cleanup.reverse())await fn();http.request=saved.http;https.request=saved.https;if(browser)await browser.close();fs.writeFileSync(path.join(OUT,'ui.json'),JSON.stringify(receipt,null,2));}
console.log(JSON.stringify({result:receipt.result,checks:receipt.checks.length,screenshots:receipt.screenshots.length,receipt:path.join(OUT,'ui.json')}));})().catch(error=>{console.error(error);process.exitCode=1;});
