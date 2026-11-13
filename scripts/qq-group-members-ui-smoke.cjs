'use strict';
// Synthetic, hidden Electron renderer. No production main, QQ, model or account data.
const {_electron:electron}=require('playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs'),prefix=process.env.ARCADE_UI_PREFIX||'qq-group-members-20261106';
if(!/^[a-z0-9-]{1,72}$/.test(prefix))throw Error('Invalid output prefix.');
const receipt={synthetic:true,visibleWindow:false,liveAccounts:false,realQQRequests:0,modelsInvoked:0,checks:[],screenshots:[],geometry:[]};
const pass=value=>receipt.checks.push(value);
(async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-member-ui-'));
 const styles=['style.css','companions.css','qq-directory-members.css'],index=fs.readFileSync(path.join(root,'src/ui/index.html'),'utf8');
 for(const name of styles)assert(index.includes(`href="${name}"`),`Production index is missing ${name}`);
 const css=styles.map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(root,'src/ui',name)).href}">`).join('');
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(home,'fixture.html'),`<!doctype html><html><head><meta charset="utf-8">${css}</head><body><main><h1>QQ · 合成界面</h1><p>Isolated fixture — no account connected</p><button id="fixture-open" class="secondary">好友与群组</button></main></body></html>`);
 fs.writeFileSync(path.join(home,'fixture-main.cjs'),`'use strict';
const {app,BrowserWindow,session}=require('electron');
app.whenReady().then(()=>{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 const win=new BrowserWindow({show:false,width:1180,height:830,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.loadFile(require('node:path').join(__dirname,'fixture.html'));
});app.on('window-all-closed',()=>app.quit());
`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:[path.join(home,'fixture-main.cjs'),`--user-data-dir=${path.join(home,'profile')}`],env});
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(10000);await page.waitForLoadState('domcontentloaded');const errors=[],network=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{
   window.$=id=>document.getElementById(id);window.el=(tag,className='',text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};window.view='qq-runtime';
   const f=window.fixture={calls:[],pending:[],next:null,state:{language:'zh',accounts:{selectedId:'fixture-ju',accounts:[]},runtime:{installationKind:'managed-shell',desktopDataRoot:null,componentsRoot:'Synthetic components',managedSetupId:'synthetic-a',installation:{current:{kind:'managed-shell',setupId:'synthetic-a'}},instances:['100001','100002'].map(accountId=>({accountId,processRunning:true,runtimeRevision:'',bridges:[{serverName:'local',port:3301}]}))}}};
   f.groups=Array.from({length:121},(_,i)=>({id:String(800001+i),name:`合成读书群 ${i+1}`,memberCount:117,maxMemberCount:200}));
   f.members=Array.from({length:117},(_,i)=>({id:String(900001+i),nickname:i===0?'<img src=x onerror="window.memberInjected=true">':i===1?'很长的合成昵称'.repeat(30):`合成成员 ${i+1}`,card:i===0?'小林':i===1?'很长的合成群名片'.repeat(30):i===2?'阅读领队':'',role:i===0?'owner':i===2?'admin':'member'}));
   window.arcade={qqRuntimeDirectory:async request=>{
    f.calls.push(structuredClone(request));const behavior=f.next;f.next=null;
    let result={ok:true,directory:{accountId:request.accountId,kind:request.kind,...(request.kind==='members'?{groupId:request.groupId}:{}),items:structuredClone(request.kind==='members'?f.members:request.kind==='groups'?f.groups:[{id:'100001',nickname:'合成自己',remark:''}]),fetchedAt:'2026-11-06T00:00:00.000Z',source:'bridge-cache'}};
    if(behavior?.error)result={ok:false,code:behavior.error,error:'PRIVATE_SECRET_MUST_NOT_RENDER'};
    if(behavior?.wrongGroup)result.directory.groupId='899999';if(behavior?.wrongAccount)result.directory.accountId='199999';
    if(behavior?.unknownRole)result.directory.items[0].role='moderator';if(behavior?.duplicate)result.directory.items[1].id=result.directory.items[0].id;
    if(behavior?.wrongSource)result.directory.source='live';if(behavior?.oversize)result.directory.items=Array.from({length:10001},(_,i)=>({id:String(600000+i),nickname:'x',card:'',role:'member'}));
    if(behavior?.longText)result.directory.items[0].card='x'.repeat(501);if(behavior?.empty)result.directory.items=[];
    if(behavior?.delay)return new Promise(resolve=>f.pending.push(()=>resolve(result)));return result;
   }};
   f.publish=()=>window.renderQQDirectory(f.state);
  });
  await page.addScriptTag({path:path.join(root,'src/ui/qq-directory.js')});await page.evaluate(()=>{fixture.publish();$('fixture-open').onclick=()=>window.openQQDirectory({accountId:'100001',name:'合成橘娘'});});
  const drawer=page.locator('#qq-directory'),set=behavior=>page.evaluate(behavior=>fixture.next=behavior,behavior),calls=()=>page.evaluate(()=>fixture.calls.length);
  const open=async(accountId='100001')=>{await page.evaluate(accountId=>window.openQQDirectory({accountId,name:'合成搭档'}),accountId);await page.waitForFunction(()=>document.querySelector('#qq-directory .qq-directory-row')||document.getElementById('qq-directory-server'));};
  const groups=async()=>{await drawer.locator('#qq-directory-tab-groups').click();await drawer.locator('[data-members-group]').first().waitFor();};
  const member=async id=>{await drawer.locator(id?`[data-members-group="${id}"]`:'[data-members-group]').first().click();await drawer.locator('.qq-members-row').first().waitFor();};
  const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const resize=async(width,height,zoom=1)=>{await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(width,height);w.webContents.setZoomFactor(zoom);},{width,height,zoom});await settle();};
  const capture=async name=>{
   await settle();
   const file=path.join(out,`${prefix}-${name}-synthetic.png`),dataURL=await app.evaluate(async({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0],contents=window.webContents,[width,height]=window.getContentSize();
    const paint=()=>new Promise((resolve,reject)=>{const done=(_event,_rect,image)=>{const size=image.getSize();if(Math.abs(size.width-width)>2||Math.abs(size.height-height)>2){setImmediate(()=>contents.invalidate());return;}clearTimeout(timer);contents.removeListener('paint',done);resolve(image.toDataURL());};const timer=setTimeout(()=>{contents.removeListener('paint',done);reject(Error('Synthetic paint size timed out'));},3000);contents.on('paint',done);contents.invalidate();});
    await paint();return paint();
   });fs.writeFileSync(file,Buffer.from(dataURL.split(',')[1],'base64'));receipt.screenshots.push(file);
   const box=await drawer.evaluate(node=>{const r=node.getBoundingClientRect(),c=node.querySelector('#qq-directory-close').getBoundingClientRect(),body=node.querySelector('.qq-members-body'),s=(body&&getComputedStyle(body).display!=='contents'?body:node.querySelector('.qq-directory-scroll'))?.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},drawer:{left:r.left,right:r.right,bottom:r.bottom},close:{left:c.left,right:c.right,top:c.top,bottom:c.bottom},scrollHeight:s?.height||0,horizontal:node.scrollWidth-node.clientWidth};});receipt.geometry.push({name,...box});
   assert(box.drawer.left>=-1&&box.drawer.right<=box.viewport.width+1&&box.close.left>=0&&box.close.right<=box.viewport.width&&box.close.bottom<=box.viewport.height&&box.horizontal<=1&&box.scrollHeight>45,JSON.stringify({name,...box}));
  };
  await open();await groups();await drawer.locator('#qq-directory-search').fill('合成读书群');await drawer.getByRole('button',{name:'下一页',exact:true}).click();assert.match(await drawer.locator('#qq-directory-paging').innerText(),/第 2 \/ 3 页/);
  const before=await calls();await member('800051');assert.equal(await calls(),before+1);assert.deepEqual(await page.evaluate(()=>fixture.calls.at(-1)),{accountId:'100001',kind:'members',groupId:'800051',fresh:false});
  assert.match(await drawer.locator('.qq-directory-account').innerText(),/100001/);assert.match(await drawer.locator('.qq-members-identity').innerText(),/合成读书群 51[\s\S]*800051/);assert.equal(await drawer.locator('.qq-members-row').count(),50);pass('Only a returned group row opens members for the exact selected QQ/group, with bounded first page.');
  const text=await drawer.innerText();assert.match(text,/群主/);assert.match(text,/管理员/);assert.match(text,/未设置群名片/);assert.match(text,/<img src=x/);assert.equal(await page.evaluate(()=>window.memberInjected),undefined);assert.equal(await drawer.locator('img').count(),0);assert.doesNotMatch(text,/踢出|禁言|发送消息/);pass('Nickname, group card and all three roles are text-only; this read-only fixture has no exact configured binding and exposes no member write or group-chat controls.');
  assert.match(text,/缓存/);assert.match(text,/不保证完整实时/);await capture('zh-members-wide');
  const local=await calls();await drawer.getByRole('button',{name:'下一页',exact:true}).click();assert.match(await drawer.locator('.qq-members-row').first().innerText(),/900051/);await drawer.locator('#qq-members-search').fill('900117');assert.equal(await drawer.locator('.qq-members-row').count(),1);assert.equal(await calls(),local);await drawer.locator('#qq-members-search').fill('不存在');assert.match(await drawer.locator('#qq-members-status').innerText(),/没有匹配/);pass('Member search and pagination are local, including a no-match state; no bridge calls are added.');
  await drawer.locator('#qq-members-back').click();assert.equal(await drawer.locator('#qq-directory-search').inputValue(),'合成读书群');assert.match(await drawer.locator('#qq-directory-paging').innerText(),/第 2 \/ 3 页/);assert.equal(await calls(),local);assert.equal(await page.evaluate(()=>document.activeElement.dataset.membersGroup),'800051');pass('Back restores the exact group query/page and focuses its group action without another read.');
  await set({error:'group_not_joined'});await drawer.locator('[data-members-group="800051"]').click();await page.waitForFunction(()=>$('qq-members-status').textContent.includes('当前群列表中没有'));assert.equal(await drawer.locator('.qq-members-row').count(),0);assert.doesNotMatch(await drawer.innerText(),/PRIVATE_SECRET/);await capture('zh-members-missing');await drawer.locator('#qq-members-back').click();assert.match(await drawer.locator('#qq-directory-paging').innerText(),/第 2 \/ 3 页/);pass('A missing group shows a fixed actionable error and Back still restores the group list.');
  await member('800051');await set({empty:true});await drawer.locator('#qq-members-refresh').click();await page.waitForFunction(()=>$('qq-members-status').textContent.includes('列表为空'));assert.equal(await page.evaluate(()=>fixture.calls.at(-1).fresh),true);await capture('zh-members-empty');pass('Explicit refresh sends fresh=true; an empty cache does not imply that a group has no members.');
  for(const behavior of [{wrongGroup:true},{wrongAccount:true},{unknownRole:true},{duplicate:true},{wrongSource:true},{oversize:true},{longText:true}]){await set(behavior);await drawer.locator('#qq-members-refresh').click();await page.waitForFunction(()=>$('qq-members-status').textContent.includes('格式无法识别'));assert.equal(await drawer.locator('.qq-members-row').count(),0);}pass('Wrong account/group/source, unknown roles, duplicate IDs, more than 10000 rows and overlong text fail closed.');
  await set({error:'group_changed'});await drawer.locator('#qq-members-refresh').click();await page.waitForFunction(()=>$('qq-members-status').textContent.includes('群列表已变化'));await drawer.locator('#qq-members-refresh').click();await drawer.locator('.qq-members-row').first().waitFor();pass('A group disappearing during a read is distinct from transport failure; explicit reread recovers.');
  await set({delay:true});await drawer.locator('#qq-members-refresh').click();await page.waitForFunction(()=>$('qq-members-status').textContent.includes('正在读取'));await drawer.locator('#qq-members-back').click();await drawer.locator('[data-members-group="800052"]').click();await drawer.locator('.qq-members-row').first().waitFor();await page.evaluate(()=>fixture.pending.shift()());await settle();assert.match(await drawer.locator('.qq-members-identity').innerText(),/800052/);pass('A delayed member result cannot overwrite another group opened after Back.');
  await resize(430,830);await capture('zh-members-430');await page.evaluate(()=>{fixture.state.language='en';fixture.publish();});await capture('en-members-430');pass('Chinese and English 430px production CSS layouts keep identity, Close, list scrolling and paging visible.');
  await resize(430,830,1.5);await capture('en-members-150pct');await drawer.locator('#qq-members-body').evaluate(node=>node.scrollTop=350);await settle();await capture('en-members-150pct-scrolled');assert(await drawer.locator('.qq-members-row').first().evaluate(node=>{const r=node.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}));await resize(1180,830);await page.evaluate(()=>{fixture.state.language='zh';fixture.publish();});pass('At 150% zoom Close and Back stay visible while the combined body scrolls to the member rows.');
  await set({delay:true});await drawer.locator('#qq-members-refresh').click();await drawer.locator('#qq-members-back').click();await page.evaluate(()=>{fixture.state.runtime.instances[0].bridges.push({serverName:'second',port:3302});fixture.publish();});await drawer.waitFor({state:'hidden'});await open();await drawer.locator('#qq-directory-server').selectOption('second');await drawer.locator('.qq-directory-row').first().waitFor();await groups();await member();await page.evaluate(()=>fixture.pending.shift()());await settle();assert.match(await drawer.locator('.qq-members-identity').innerText(),/本机连接：second/);assert.equal(await page.evaluate(()=>fixture.calls.at(-1).serverName),'second');pass('Bridge changes clear the prior view; a member result from the old bridge cannot revive after reopen.');
  for(const change of ['setup','runtime','account','hide']){
   await set({delay:true});await drawer.locator('#qq-members-refresh').click();
   await page.evaluate(change=>{if(change==='setup'){fixture.state.runtime.managedSetupId='synthetic-b';fixture.state.runtime.installation.current={kind:'managed-node',setupId:'synthetic-b'};fixture.state.runtime.installationKind='managed-node';}else if(change==='runtime')fixture.state.runtime.instances[0].runtimeRevision='restarted';else if(change==='account')fixture.state.accounts.selectedId='fixture-whale';else{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;}if(change!=='hide')fixture.publish();},change);
   await drawer.waitFor({state:'hidden'});await page.evaluate(()=>fixture.pending.shift()());assert.equal(await drawer.innerHTML(),'');
   await open();await drawer.locator('#qq-directory-server').selectOption('second');await drawer.locator('.qq-directory-row').first().waitFor();await groups();await member();
  }pass('Same-number managed installation, runtime, companion selection and window visibility changes clear both views and all late responses.');
  await set({delay:true});await drawer.locator('#qq-members-refresh').click();await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});await page.evaluate(()=>fixture.pending.shift()());assert.equal(await drawer.innerHTML(),'');assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('qq-directory-open')),false);pass('Escape clears member/group data and restores document scrolling; no late response reopens the drawer.');
  await open('100002');await groups();await member();assert.match(await drawer.locator('.qq-directory-account').innerText(),/100002/);await capture('zh-second-account');pass('Another QQ opens a fresh group/member view without the previous account’s query or page.');
  await drawer.locator('#qq-directory-close').click();
  await page.evaluate(()=>{
   fixture.state.accounts={selectedId:'fixture-whale',accounts:[{id:'fixture-whale',name:'合成鲸',channel:'qq',status:'connected',accountId:'100002',expectedQQAccountId:'100002',qqOwnerId:'200001',characterId:'deepseek-whale',mode:'deepseek'}]};
   const directory=arcade.qqRuntimeDirectory;arcade.qqRuntimeDirectory=async request=>{const result=await directory(request);if(request.kind==='friends'&&result.ok)result.directory.items.push({id:'200001',nickname:'合成主人',remark:'  旧备注  '});return result;};
   const recipient={accountId:'100002',ownerId:'200001',role:'合成鲸'};fixture.ownerCloses=[];
   arcade.qqOwnerRemarkAvailability=async request=>({ok:true,...request,available:true,recipient});
   arcade.qqOwnerRemarkRead=async request=>{const result={ok:true,...request,kind:'owner-remark',recipient,editable:true,ticketId:'11111111-1111-4111-8111-111111111111',expiresAt:Date.now()+300000,observed:{nickname:'合成主人',remark:'  旧备注  ',source:'bridge-cache',fetchedAt:new Date().toISOString()},restore:{available:false}};if(fixture.delayRemark)return new Promise(resolve=>fixture.remarkPending=()=>resolve(result));return result;};
   arcade.qqOwnerRemarkSet=async()=>{throw Error('No remark writes in this fixture');};arcade.qqOwnerRemarkRestore=arcade.qqOwnerRemarkSet;
   arcade.qqOwnerRemarkClose=async request=>{fixture.ownerCloses.push(request);return {ok:true};};
   window.openQQFriendRequests=request=>{fixture.requestEntrance=request;};fixture.publish();
  });
  await open('100002');await drawer.locator('#qq-directory-requests').click();await drawer.waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>fixture.requestEntrance),{accountId:'100002'});pass('The existing friend-request entrance remains enabled for the matching connected QQ and uses its exact identity.');
  await open('100002');await drawer.locator('#qq-owner-remark-open').waitFor();await drawer.locator('#qq-directory-search').fill('200001');await drawer.locator('#qq-owner-remark-open').click();await drawer.locator('#qq-owner-remark-input').waitFor();assert.equal(await drawer.locator('#qq-owner-remark-input').inputValue(),'  旧备注  ');await drawer.locator('#qq-owner-remark-input').fill('未保存');await drawer.locator('#qq-owner-remark-back').click();assert.equal(await drawer.locator('#qq-directory-search').inputValue(),'200001');await capture('zh-owner-return');pass('Owner remark reading/edit draft/back remains intact with exact spaces and the saved friend search; no write occurs.');
  await page.evaluate(()=>fixture.delayRemark=true);await drawer.locator('#qq-owner-remark-open').click();await page.waitForFunction(()=>typeof fixture.remarkPending==='function');await page.evaluate(()=>{fixture.state.runtime.managedSetupId='synthetic-owner-changed';fixture.state.runtime.installation.current.setupId='synthetic-owner-changed';fixture.publish();});await drawer.waitFor({state:'hidden'});await page.evaluate(()=>fixture.remarkPending());assert.equal(await drawer.innerHTML(),'');pass('The strengthened installation scope also clears a pending owner-remark view and rejects its old read result.');
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.state).includes('阅读领队')),false);pass('The isolated window stayed hidden; no external requests, renderer errors or member rows in application snapshots.');
  receipt.result='passed';
 }catch(error){receipt.result='failed';receipt.error=error.stack||String(error);throw error;}
 finally{fs.writeFileSync(path.join(out,`${prefix}-ui.json`),JSON.stringify(receipt,null,2)+'\n');await app.close();}
 console.log(JSON.stringify({result:receipt.result,checks:receipt.checks.length,screenshots:receipt.screenshots.length,receipt:path.join(out,`${prefix}-ui.json`)}));
})().catch(error=>{console.error(error);process.exitCode=1;});
