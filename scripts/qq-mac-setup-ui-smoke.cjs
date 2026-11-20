'use strict';
// Actual renderer in isolated Chromium; no real runtime, dialogs or bridge.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'outputs/qq-mac-setup-ui'));
fs.mkdirSync(out,{recursive:true});
const code=fs.readFileSync(path.join(root,'scripts/desktop-chat-ui-smoke.cjs'),'utf8');
const marker='await page.addInitScript(({catalog})=>{',start=code.indexOf(marker),end=code.indexOf('},{catalog});',start);
assert(start>=0&&end>start);
const catalog=require('../src/core/personas.cjs').publicCatalog(),fixture=code.slice(start+marker.length,end);
const receipt={passed:false,syntheticIPC:true,actualDialogs:false,realRuntimeStarted:false,realQQ:false,checks:[],screenshots:[],errors:[],external:[]};
const origin='http://127.0.0.1:41458';
const ticket='99c2bc36-fa5b-468b-a5a3-d13df18a5067';

function mock(os,ticket){
 const f=roomFixture,bot=f.bots.ju;
 arcade.platform={os, managedQQ:os==='win32',voice:os==='win32'};
 if(os==='darwin'){
  // Match the packaged sandboxed preload. In particular, the renderer must
  // never need the Windows managed-QQ script to create its Mac controls.
  for(const name of Object.keys(arcade)){
   if(/^(?:qq|onQQ|voice)[A-Z]/.test(name)&&!/^qq(?:Image|Voice)[A-Z]/.test(name))delete arcade[name];
  }
 }
 bot.status='disconnected';bot.qq.ownerId='600002';bot.qq.expectedAccountId='';bot.qq.hasToken=false;
 bot.qq.groups={enabled:false,groupIds:[],proactive:false};
 f.snapshot.config.appearance='light';f.snapshot.appearance={preference:'light',colorScheme:'light'};arcade.initialAppearance=f.snapshot.appearance;
 const state=window.macSetupTrial={calls:[]};
 const call=(name,value)=>state.calls.push({name,value:structuredClone(value)});
 arcade.botQQMacOpenRelease=async()=>{call('release',null);return {ok:true};};
 arcade.botQQMacInspect=async value=>{
  call('inspect',value);
  if(state.hold)await new Promise(resolve=>state.release=resolve);
  if(state.cancel){state.cancel=false;return {ok:true,cancelled:true};}
  if(state.error){const code=state.error;state.error=null;return {ok:false,code,error:'PRIVATE_TEST_PATH'};}
  return {ok:true,ticketId:ticket,release:'8.3.2',nodeVersion:'v24.13.0',filesChecked:4,warning:value.withNode?'bundled_node_rejected_explicit_node_override':null};
 };
 arcade.botQQMacPrepare=async value=>{
  call('prepare',value);
  if(state.cancel){state.cancel=false;return {ok:true,cancelled:true};}
  if(state.error){const code=state.error;state.error=null;return {ok:false,code,error:'PRIVATE_TEST_PATH'};}
  return {ok:true,prepared:true,targetDirectory:'/synthetic/private-llbot',endpoint:'ws://127.0.0.1:'+value.port+'/',
   configFile:'/synthetic/private-llbot/config.json',tokenFile:'/synthetic/private-llbot/onebot-token.txt',token:'MUST_NOT_DISPLAY_PRIVATE_TOKEN'};
 };
 const base=arcade.botConfigure;
 arcade.botConfigure=async value=>{
  for(const [field,key] of [['qqOwnerId','ownerId'],['qqUrl','url'],['qqAccountId','expectedAccountId']])if(value[field]!==undefined)bot.qq[key]=value[field];
  if(value.qqToken)bot.qq.hasToken=true;
  return base(value);
 };
 arcade.botQQTest=async()=>{call('test-connection',null);return {ok:true};};
}

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ARCADE_HEADLESS_BROWSER?{executablePath:process.env.ARCADE_HEADLESS_BROWSER}:{})});
 let page;
 try{
  const openPage=async os=>{
   const next=await browser.newPage({viewport:{width:1130,height:950}});next.setDefaultTimeout(7000);await next.emulateMedia({reducedMotion:'reduce'});
   next.on('pageerror',error=>receipt.errors.push(error.message));
   await next.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){receipt.external.push(url.href);return route.abort();}
    const relative=url.pathname==='/'?'src/ui/index.html':url.pathname.startsWith('/assets/')?'src'+url.pathname:'src/ui'+url.pathname;
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
    return route.fulfill({path:file});
   });
   await next.addInitScript({content:'const catalog='+JSON.stringify(catalog)+';'+fixture+'\n('+mock.toString()+')('+JSON.stringify(os)+','+JSON.stringify(ticket)+');'});
   await next.goto(origin+'/');await next.evaluate(()=>{roomFixture.publish();switchView('connections');});
   const options=next.locator('#onboarding-optional-toggle');
   if(await options.isVisible()&&await options.getAttribute('aria-expanded')==='false')await options.click();
   await next.locator('#onboarding-qq-groups').click();
   return next;
  };
  page=await openPage('darwin');
  const form=page.locator('#bot-qq-mac-setup'),node=name=>form.locator('#bot-qq-mac-'+name);
  const first=node('first'),inspect=node('inspect'),prepare=node('prepare'),status=node('status'),port=node('port'),account=node('account');
  const calls=()=>page.evaluate(()=>macSetupTrial.calls);
  const show=async name=>{
   const file=path.join(out,name+'.png');
   await page.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:file,animations:'disabled'});receipt.screenshots.push(file);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  };
  const pass=value=>receipt.checks.push(value);
  await form.waitFor();
  assert.equal(await page.evaluate(()=>typeof arcade.qqRuntimeRefresh),'undefined');
  assert.equal(await page.locator('#bot-qq-manual').count(),1);
  assert(await node('title').evaluate(title=>document.activeElement===title));
  assert.equal(await form.locator('#bot-qq-manual > summary').innerText(),'使用已有 OneBot 桥接');
  assert.equal(await first.locator('summary').innerText(),'首次准备 LLBot');
  for(const id of ['bot-qq-manage','bot-qq-download','bot-qq-guide','bot-qq-prepare','bot-qq-copy-config','bot-qq-copy-token'])assert(!await page.locator('#'+id).isVisible());
  assert.deepEqual(await calls(),[]);await show('01-zh-mac-entry');
  await first.locator('summary').click();await node('release').click();
  await inspect.click();await node('checked').filter({hasText:'已检查 LLBot v8.3.2 的 4 个固定入口文件'}).waitFor();
  assert.deepEqual(await calls(),[{name:'release',value:null},{name:'inspect',value:{withNode:false}}]);
  await page.evaluate(()=>{macSetupTrial.cancel=true;});await inspect.click();
  await status.filter({hasText:'已取消'}).waitFor();assert(await node('checked').isVisible());
  await account.fill('600002');await prepare.click();
  assert.equal(await account.getAttribute('aria-invalid'),'true');assert.equal((await calls()).at(-1).name,'inspect');
  await account.fill('600001');await port.fill('22');await prepare.click();
  assert.equal(await port.getAttribute('aria-invalid'),'true');assert.equal((await calls()).at(-1).name,'inspect');
  await port.fill('3199');await page.evaluate(()=>{macSetupTrial.cancel=true;});await prepare.click();
  await status.filter({hasText:'已取消'}).waitFor();assert(await node('checked').isVisible());
  await page.evaluate(()=>{macSetupTrial.error='target_exists';});await prepare.click();
  await status.filter({hasText:'该目录已经存在'}).waitFor();assert(await node('checked').isVisible());assert(!await node('result').isVisible());
  await prepare.click();await node('result').waitFor();
  assert.deepEqual((await calls()).at(-1),{name:'prepare',value:{ticketId:ticket,accountId:'600001',port:3199}});
  assert.equal(await node('result-endpoint').innerText(),'ws://127.0.0.1:3199/');
  assert.match(await node('result-token').innerText(),/onebot-token.txt$/);
  assert.doesNotMatch(await form.textContent(),/MUST_NOT_DISPLAY_PRIVATE_TOKEN|PRIVATE_TEST_PATH/);
  assert.deepEqual(await page.evaluate(()=>roomFixture.calls.filter(call=>/botConfigure|botConnect|botLogin/.test(call.name))),[]);
  await node('result').scrollIntoViewIfNeeded();await show('02-zh-prepared-result');
  pass('Mac first use offers the two paths with Windows-only controls hidden. Inspect, cancellation, input bounds and folder collision preserve a valid check; successful preparation displays only paths and the loopback URL, with no settings write or connection.');
  await node('show-existing').click();
  const existing=page.locator('#bot-qq-manual'),url=existing.locator('#bot-qq-url');
  assert(await url.evaluate(el=>el===document.activeElement));
  await url.fill('ws://127.0.0.1:3199/');await existing.locator('#bot-qq-token').fill('synthetic-token-entered-explicitly');
  await existing.locator('#bot-qq-expected-account').fill('600001');
  await existing.locator('#bot-qq-save').click();
  await page.waitForFunction(()=>roomFixture.bots.ju.qq.hasToken);
  await existing.locator('#bot-qq-test').click();
  await page.waitForFunction(()=>macSetupTrial.calls.some(call=>call.name==='test-connection'));
  assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.expectedAccountId),'600001');
  assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.url),'ws://127.0.0.1:3199/');
  assert(await page.locator('#bot-qq-groups-enabled').isVisible());
  pass('The existing OneBot path reveals the same address/token and numbers; the prior Save and Test handlers remain explicitly usable.');
  await page.setViewportSize({width:450,height:820});
  await page.evaluate(()=>{roomFixture.snapshot.config.language='en';roomFixture.publish();});
  await node('with-node').check();await inspect.click();
  await node('checked').filter({hasText:'The separately selected Node was verified.'}).waitFor();
  assert.deepEqual((await calls()).at(-1),{name:'inspect',value:{withNode:true}});
  await node('checked').scrollIntoViewIfNeeded();await show('03-en-separate-node');
  await page.evaluate(()=>{macSetupTrial.hold=true;});await inspect.click();
  await page.waitForFunction(()=>!!macSetupTrial.release);
  await page.evaluate(()=>{
   roomFixture.snapshot.accounts.selectedId='dragon';roomFixture.publish();
   roomFixture.snapshot.accounts.selectedId='ju';roomFixture.publish();macSetupTrial.hold=false;macSetupTrial.release();
  });
  await page.waitForFunction(()=>!document.getElementById('bot-qq-mac-inspect').disabled);
  assert(!await node('checked').isVisible());
  await page.evaluate(()=>{macSetupTrial.error='unsupported_platform';});await inspect.click();
  await status.filter({hasText:'requires Apple Silicon'}).waitFor();
  assert(!await node('checked').isVisible());assert(await form.locator('#bot-qq-manual > summary').isVisible());
  pass('English narrow layout shows signed Node selection and the fallback warning. A late picker response cannot restore a changed companion scope, and an unsupported runtime leaves the existing connection path available.');
  const windows=await openPage('win32');
  assert(!await windows.locator('#bot-qq-mac-setup').isVisible());
  await windows.locator('#bot-qq-manual > summary').click();
  assert(await windows.locator('#bot-qq-guide').isVisible());
  assert(await windows.locator('#bot-qq-copy-config').isVisible());
  assert.deepEqual(await windows.evaluate(()=>macSetupTrial.calls),[]);
  pass('The Windows NapCat setup remains available through the existing form.');
  assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.external,[]);
  receipt.passed=true;
 }catch(error){receipt.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output:out}));
})().catch(error=>{console.error(error);process.exitCode=1;});
