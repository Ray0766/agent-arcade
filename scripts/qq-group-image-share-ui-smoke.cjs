'use strict';
// Product renderer with synthetic QQ IPC and a PNG generated in the test window.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'outputs/qq-group-image-share-ui'));
fs.mkdirSync(out,{recursive:true});
const code=fs.readFileSync(path.join(root,'scripts/desktop-chat-ui-smoke.cjs'),'utf8');
const marker='await page.addInitScript(({catalog})=>{',start=code.indexOf(marker),end=code.indexOf('},{catalog});',start);
assert(start>=0&&end>start);
const catalog=require('../src/core/personas.cjs').publicCatalog(),fixture=code.slice(start+marker.length,end);
const targets=[{groupId:'567890',role:'海岸绘图员',roleId:'card-coast'},{groupId:'678901',role:'午后修表师',roleId:'card-clock'}];
const receipt={synthetic:true,actualBackend:false,realQQ:false,realFilePicker:false,realImageFile:false,checks:[],screenshots:[],errors:[],externalRequests:[],passed:false};

function mockRenderer(targets){
 const f=window.roomFixture,media=window.imageTrial={calls:[],targets,counter:0};
 arcade.platform={os:'darwin'};
 const bot=f.bots.ju;
 bot.qq.expectedAccountId='100001';
 const scope=bot.media={supported:true,available:true,groupTargets:[],draft:null};
 f.snapshot.config.appearance='light';f.snapshot.appearance={preference:'light',colorScheme:'light'};arcade.initialAppearance=f.snapshot.appearance;
 const image=document.createElement('canvas');image.width=540;image.height=300;
 const ctx=image.getContext('2d');
 ctx.fillStyle='#d9e6f1';ctx.fillRect(0,0,540,300);
 ctx.fillStyle='#486c82';ctx.fillRect(0,180,540,120);
 ctx.fillStyle='#fbf1dc';ctx.beginPath();ctx.arc(430,105,41,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#253745';ctx.font='22px system-ui';ctx.fillText('Synthetic local image',24,43);
 ctx.font='15px system-ui';ctx.fillText('Fixture only · no QQ send',24,70);
 const preview=image.toDataURL('image/png');
 const log=(name,args)=>media.calls.push({name,...structuredClone(args)});
 const matches=(a,b)=>a?.accountId===b.accountId&&a?.panelId===b.panelId&&a?.groupId===b.groupId;
 arcade.qqImagePick=async args=>{
  log('pick',args);media.panel=args;scope.draft=null;f.publish();
  if(media.cancel){media.cancel=false;return {ok:true,cancelled:true};}
  const target=scope.groupTargets.find(row=>row.groupId===args.groupId);
  const recipient=target?{accountId:'100001',...target,groupName:'合成同名群 <b>样例</b>'}:{accountId:'100001',ownerId:'200001',role:'橘娘'};
  if(media.wrongRole){media.wrongRole=false;recipient.roleId='incorrect-role';}
  if(media.noGroupName){media.noGroupName=false;delete recipient.groupName;}
  const meta={ticketId:'00000000-0000-4000-8000-'+String(++media.counter).padStart(12,'0'),kind:'image',width:540,height:300,bytes:16893,expiresAt:Date.now()+300000,recipient};
  const malformed=media.badImage;media.badImage=false;
  const alteredGroup=media.wrongPickGroup;media.wrongPickGroup=false;
  const done=()=>{
   if(matches(media.panel,args)){scope.draft=meta;f.publish();}
   media.finished=(media.finished||0)+1;
   return {ok:true,...args,...(alteredGroup?{groupId:'567890'}:{}),draft:{...meta,preview:malformed?'data:image/png;base64,YWJj':preview}};
  };
  if(media.holdPick){media.holdPick=false;return new Promise(resolve=>media.releasePick=()=>resolve(done()));}
  return done();
 };
 arcade.qqImageDiscard=async args=>{
  log('discard',args);scope.draft=null;f.publish();return {ok:true,discarded:true};
 };
 arcade.qqImageClose=async args=>{
  log('close',args);
  if(matches(media.panel,args)){media.panel=null;scope.draft=null;f.publish();}
  return {ok:true,closed:true};
 };
 arcade.qqImageSend=async args=>{
  log('send',args);scope.draft=null;f.publish();
  if(media.rejectSend){media.rejectSend=false;return {ok:true,...args,kind:'image',outcome:'not_sent',code:'send_rejected'};}
  return {ok:true,...args,kind:'image',outcome:'accepted',messageId:'8249',...(media.wrongReceipt?{groupId:'567890'}:{}),path:'PRIVATE_TEST_FIELD'};
 };
}

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ARCADE_HEADLESS_BROWSER?{executablePath:process.env.ARCADE_HEADLESS_BROWSER}:{})});
 let page;
 try{
  page=await browser.newPage({viewport:{width:1130,height:820}});page.setDefaultTimeout(7000);
  await page.emulateMedia({reducedMotion:'reduce'});
  page.on('pageerror',error=>receipt.errors.push(error.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://127.0.0.1:41446'){receipt.externalRequests.push(url.href);return route.abort();}
   const relative=url.pathname==='/'?'src/ui/index.html':url.pathname.startsWith('/assets/')?'src'+url.pathname:'src/ui'+url.pathname;
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
   return route.fulfill({path:file});
  });
  await page.addInitScript({content:'const catalog='+JSON.stringify(catalog)+';'+fixture+'\n('+mockRenderer.toString()+')('+JSON.stringify(targets)+');'});
  await page.goto('http://127.0.0.1:41446/');await page.evaluate(()=>{roomFixture.publish();switchView('bot');});
  const entry=page.locator('#qq-media-open'),drawer=page.locator('#qq-media'),node=name=>drawer.locator('#qq-media-'+name);
  const group=node('target'),choose=node('choose'),send=node('send'),status=node('status'),preview=drawer.locator('.qq-media-preview img'),recipient=node('recipient'),details=node('receipt');
  const log=type=>page.evaluate(type=>imageTrial.calls.filter(call=>!type||call.name===type),type);
  const pass=note=>receipt.checks.push(note);
  const shot=async name=>{
   const file=path.join(out,name+'.png');await page.screenshot({path:file,animations:'disabled'});receipt.screenshots.push(file);
   assert(await drawer.evaluate(n=>{const bounds=n.getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth+1&&n.scrollWidth<=n.clientWidth;}));
  };
  const open=async()=>{await entry.click();await drawer.waitFor();};
  const ready=async()=>{
   await preview.waitFor();
   await preview.evaluate(image=>image.decode());assert(await preview.evaluate(image=>image.naturalWidth>0));
   assert(await send.isEnabled());
  };
  await entry.waitFor({state:'hidden'});
  await page.evaluate(()=>{
   const {media}=roomFixture.bots.ju;
   media.groupTargets=imageTrial.targets;media.available=false;roomFixture.publish();
  });
  assert(await entry.isVisible());assert(await entry.isDisabled());
  await page.evaluate(()=>{roomFixture.bots.ju.media.available=true;roomFixture.publish();});
  await open();assert.equal(await group.inputValue(),'');assert.equal(await choose.count(),0);assert(await send.isDisabled());
  assert.equal(await group.locator('option').count(),3);assert.deepEqual(await log(),[]);
  await shot('01-mac-explicit-group');
  await group.selectOption('567890');assert.deepEqual(await log(),[]);assert(await send.isDisabled());
  await page.evaluate(()=>{imageTrial.cancel=true;});await choose.click();await status.getByText(/取消选择/).waitFor();
  assert.equal(await preview.count(),0);assert(await send.isDisabled());assert.deepEqual(await log('send'),[]);
  assert.equal((await log('pick')).at(-1).groupId,'567890');
  pass('Mac hides owner image sharing. Without an eligible available group the drawer cannot start. Selecting a group or cancelling its picker does not submit an image.');
  await choose.click();await ready();
  assert.match(await recipient.innerText(),/海岸绘图员[\s\S]*100001[\s\S]*567890 · 合成同名群 <b>样例<\/b>/);
  assert.equal(await recipient.locator('b').count(),0);
  assert.equal(await send.innerText(),'发送到群 567890');assert.deepEqual(await log('send'),[]);
  assert.match(await drawer.locator('.qq-media-content > .qq-media-note').innerText(),/开启该群识图时，成员随后引用图片，正式回复可在短时间内读到图片/);
  await shot('02-zh-group-preview');
  const old=(await log('pick')).at(-1);
  await group.selectOption('678901');await page.waitForFunction(()=>!document.getElementById('qq-media-target').disabled);
  assert.equal(await preview.count(),0);assert(await send.isDisabled());
  assert.deepEqual((await log('close')).at(-1),{name:'close',accountId:old.accountId,panelId:old.panelId,groupId:'567890'});
  await page.evaluate(()=>{imageTrial.wrongPickGroup=true;});await choose.click();await status.getByText(/连接已变化/).waitFor();assert.equal(await preview.count(),0);
  await page.evaluate(()=>{imageTrial.wrongRole=true;});await choose.click();await status.getByText(/预览暂不可用/).waitFor();assert.equal(await preview.count(),0);
  await page.evaluate(()=>{imageTrial.badImage=true;});await choose.click();await status.getByText(/预览暂不可用/).waitFor();assert.equal(await preview.count(),0);
  assert(await send.isDisabled());assert.deepEqual(await log('send'),[]);
  await choose.click();await ready();
  const second=(await log('pick')).at(-1);
  assert.notEqual(second.panelId,old.panelId);
  assert.match(await recipient.innerText(),/午后修表师[\s\S]*678901 · 合成同名群/);
  assert.equal(await send.innerText(),'发送到群 678901');
  pass('Identical group names differ by ID and approved role. Switching clears and closes the earlier panel; mismatched envelope/role and a failed PNG decode cannot enable confirmation.');
  await node('remove').click();await page.waitForFunction(()=>!document.getElementById('qq-media-choose').disabled);
  assert.equal(await preview.count(),0);assert(await send.isDisabled());assert.deepEqual(await log('send'),[]);
  assert.equal((await log('discard')).at(-1).panelId,second.panelId);assert.equal((await log('discard')).at(-1).groupId,'678901');
  const finished=await page.evaluate(()=>imageTrial.finished);await page.evaluate(()=>{imageTrial.holdPick=true;});await choose.click();
  await page.waitForFunction(()=>!!imageTrial.releasePick);
  await page.evaluate(()=>{
   const media=roomFixture.bots.ju.media;
   media.groupTargets=media.groupTargets.map(target=>target.groupId==='678901'?{...target,roleId:'card-clock-updated'}:target);roomFixture.publish();
  });
  await drawer.waitFor({state:'hidden'});assert.equal(await drawer.innerHTML(),'');
  await page.evaluate(()=>imageTrial.releasePick());await page.waitForFunction(prior=>imageTrial.finished===prior+1,finished);
  assert.equal(await drawer.innerHTML(),'');assert.deepEqual(await log('send'),[]);
  assert.equal((await log('close')).at(-1).groupId,'678901');
  pass('Removing a preview discards only its exact group ticket. Changing the approved role identity closes an in-flight old picker; the later result cannot open the dialog or be sent.');
  await page.setViewportSize({width:430,height:720});
  await page.evaluate(()=>{roomFixture.snapshot.config.language='en';roomFixture.publish();});
  await open();assert.equal(await group.inputValue(),'');
  await group.selectOption('678901');await choose.click();await ready();
  assert.match(await drawer.locator('.qq-media-content > .qq-media-note').innerText(),/With image input enabled, a member can quote the image for a reply shortly after/);
  await shot('03-en-narrow-confirmation');
  await send.evaluate(button=>{button.click();button.click();});
  await status.getByText(/QQ accepted/).waitFor();
  const sent=await log('send');assert.equal(sent.length,1);
  assert.equal(sent[0].groupId,'678901');assert.equal(sent[0].accountId,'ju');assert(await send.isDisabled());
  await details.locator('summary').click();
  assert.match(await details.innerText(),/8249[\s\S]*100001[\s\S]*678901 · 合成同名群[\s\S]*午后修表师/);
  assert.doesNotMatch(await drawer.textContent(),/PRIVATE_TEST_FIELD/);
  await shot('04-en-narrow-receipt');
  await page.evaluate(()=>{imageTrial.noGroupName=true;});await choose.click();await ready();
  assert.match(await recipient.innerText(),/Recipient: QQ group 678901$/);
  await page.evaluate(()=>{imageTrial.wrongReceipt=true;});await send.click();await status.getByText(/outcome is unconfirmed/).waitFor();
  assert.equal((await log('send')).length,2);assert.equal(await details.count(),0);assert(await send.isDisabled());
  await page.evaluate(()=>{imageTrial.rejectSend=true;imageTrial.wrongReceipt=false;});
  await choose.click();await ready();await send.click();
  await status.getByText('QQ rejected the send request. No image was sent.',{exact:true}).waitFor();
  assert.equal(await status.getAttribute('role'),'alert');
  const rejected=await log('send');
  assert.equal(rejected.length,3);assert.equal(rejected.at(-1).groupId,'678901');
  assert.equal(await details.count(),0);assert.equal(await preview.count(),0);assert(await send.isDisabled());
  await shot('05-en-explicit-rejection');
  await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert(await entry.evaluate(node=>node===document.activeElement));
  pass('Only an explicit click submits one exact group ticket. Missing verified names use the group ID. Matching accepted receipts show group and role; a mismatched group stays unconfirmed, and an explicit refusal reports that no image was sent. Neither retries.');
  await page.evaluate(()=>{arcade.platform.os='win32';imageTrial.wrongReceipt=false;roomFixture.publish();});
  await open();await ready();assert.equal(await group.count(),0);
  assert.match(await recipient.innerText(),/100001[\s\S]*Owner: QQ 200001/);
  assert.equal(await send.innerText(),'Send to owner');assert.equal(Object.hasOwn((await log('pick')).at(-1),'groupId'),false);
  assert.match(await drawer.locator('.qq-media-content > .qq-media-note').innerText(),/not sent to an AI for analysis, a group or Qzone/);
  await drawer.locator('#qq-media-close').click();
  assert.equal(Object.hasOwn((await log('close')).at(-1),'groupId'),false);
  await page.evaluate(()=>{arcade.platform.os='darwin';roomFixture.bots.ju.channel='qqofficial';roomFixture.publish();});
  await entry.waitFor({state:'hidden'});
  assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.externalRequests,[]);
  pass('Existing Windows owner picker still opens directly with an owner-only envelope. The official QQ channel does not show the ordinary group control.');
  receipt.passed=true;
 }catch(error){receipt.failure=error.stack;if(page)await page.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output:out}));
})().catch(error=>{console.error(error);process.exitCode=1;});
