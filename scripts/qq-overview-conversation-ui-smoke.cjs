'use strict';
// Synthetic renderer acceptance: actual index.html shell, production accounts/runtime
// renderers and CSS. Unrelated page actions are fixtures; no Electron main or QQ.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),UI=path.join(ROOT,'src/ui'),out=path.resolve(process.env.ARCADE_UI_OUTPUT_DIR||path.join(ROOT,'outputs/design-20261108')),prefix='qq-overview-conversation';
const receipt={synthetic:true,realAccountActions:0,modelCalls:0,sourceScope:'renderer contract fixture; no Electron main or QQ',actualIndexShell:true,checks:[],screenshots:[]};
const prod=fs.readFileSync(path.join(UI,'index.html'),'utf8');
// Keep the product shell; replace only preload/global state for inert acceptance.
const html=prod.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/g,'').replace(/<link[^>]+rel="stylesheet"[^>]*>/g,'');
(async()=>{const browser=await chromium.launch({headless:true});try{
  fs.mkdirSync(out,{recursive:true});const page=await browser.newPage({viewport:{width:1180,height:830}}),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin==='http://127.0.0.1:41274'&&u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(u.origin==='http://127.0.0.1:41274'&&u.pathname==='/assets/brand/ribbon-simple-v1.png')return route.fulfill({path:path.join(ROOT,'src/assets/brand/ribbon-simple-v1.png')});if(u.origin==='http://127.0.0.1:41274'&&['/ornaments/persona-motifs-v1.png','/ornaments/cherry-branch-v1.png'].includes(u.pathname))return route.fulfill({path:path.join(UI,u.pathname.slice(1))});if(u.origin==='http://127.0.0.1:41274'&&/^\/portraits\/[a-z0-9-]+\.png$/.test(u.pathname))return route.fulfill({path:path.join(UI,u.pathname.slice(1))});network.push(u.origin+u.pathname);return route.abort();});await page.goto('http://127.0.0.1:41274/');
  for(const file of ['style.css','companions.css','qq-directory-members.css','qq-friend-requests.css','qq-first-setup.css','qq-component-repair.css'])await page.addStyleTag({content:fs.readFileSync(path.join(UI,file),'utf8')});await page.addStyleTag({content:fs.readFileSync(path.join(UI,'qq-login.css'),'utf8')});
  await page.addStyleTag({content:fs.readFileSync(path.join(UI,'qq-dialog.css'),'utf8')});
  await page.evaluate(()=>{
    window.view='qq-runtime';window.data=null;window.$=id=>document.getElementById(id);window.el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};window.action=async fn=>{try{await fn();}catch(error){fixture.errors.push(error.message);}};
    const icon=()=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','1.6');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d','M5 7h14M5 12h14M5 17h9');s.append(p);return s;};
    const names={bot:'对话',scene:'会话',activity:'事件',relationship:'相处',work:'工作与结果',connections:'连接搭档',settings:'设置'};
    for(const key of ['relationship','work','connections']){const b=el('button','nav');b.dataset.view=key;b.append(icon(),el('span','',names[key]));document.querySelector('nav [data-view=settings]').before(b);}
    for(const b of document.querySelectorAll('nav .nav')){b.classList.remove('active');b.querySelector('span').textContent=names[b.dataset.view];b.onclick=()=>window.switchView(b.dataset.view);}
    window.switchView=name=>{window.view=name;document.body.dataset.view=name;for(const b of document.querySelectorAll('nav .nav'))b.classList.toggle('active',b.dataset.view===name);for(const node of document.querySelectorAll('main>.view'))node.hidden=node.id!==name+'-view';window.fixture?.publish();};
    const oldSwitch=window.switchView;window.switchView=name=>{document.getElementById('view-picker').value=name;oldSwitch(name);};document.getElementById('view-picker').onchange=e=>window.switchView(e.target.value);
    document.querySelector('main>header .breadcrumb').append(el('span','sr-only',' — Synthetic UI fixture'));
    for(const key of ['relationship','work','connections']){const o=el('option','',names[key]);o.value=key;document.getElementById('view-picker').append(o);}
    const f=window.fixture={calls:[],pending:[],errors:[],modalOpens:0,selectPending:[],mode:'normal',scope:1};
    f.snapshot={config:{language:'zh'},personas:[{id:'claude-ju',portrait:'portraits/claude-ju-anime-v2.png'},{id:'codex-dragon',portrait:'portraits/codex-dragon-anime-v2.png'},{id:'deepseek-whale',portrait:'portraits/deepseek-whale-anime-v2.png'}],accounts:{selectedId:'ju',accounts:[{id:'ju',name:'橘娘',characterId:'claude-ju',mode:'api',channel:'qq',status:'disconnected',accountId:'100001',expectedQQAccountId:'100001',qqOwnerId:'200001',credentialState:'ready'},{id:'dragon',name:'龙娘',characterId:'codex-dragon',mode:'gpt',channel:'qq',status:'disconnected',accountId:'100002',expectedQQAccountId:'100002',qqOwnerId:'200001',credentialState:'ready'},{id:'whale',name:'鲸鱼娘',characterId:'deepseek-whale',mode:'deepseek',channel:'qq',status:'connected',accountId:'100003',expectedQQAccountId:'100003',qqOwnerId:'200001',credentialState:'ready'}]},qqRuntime:{configured:true,desktopRunning:false,desktopDataRoot:'C:\\Synthetic setup',componentsRoot:'C:\\Synthetic setup\\components',installationKind:'legacy',installation:{current:{kind:'legacy'}},components:{qqVersion:'9.9.36',napcatVersion:'4.18.42'},instances:[{accountId:'100001',processRunning:true,management:'owned',canStart:false,canStop:true,runtimeRevision:'ju-1',login:{state:'login_required'}},{accountId:'100002',processRunning:false,management:'none',canStart:true,canStop:false,runtimeRevision:null,login:{state:'stopped'}},{accountId:'100003',processRunning:true,management:'owned',canStart:false,canStop:true,runtimeRevision:'whale-1',login:{state:'online',online:true}}].map(item=>({...item,bridges:[{serverName:'local',port:3301,enabled:true,loopbackOnly:true,hasToken:true}]}))}};
    f.publish=()=>{const en={bot:'Chat',scene:'Sessions',activity:'Activity',relationship:'Together',work:'Work & results',connections:'Connections',settings:'Settings'};for(const node of document.querySelectorAll('nav .nav')){if(node.dataset.view==='qq-runtime')continue;node.querySelector('span').textContent=f.snapshot.config.language==='en'?en[node.dataset.view]:names[node.dataset.view];}for(const option of document.querySelectorAll('#view-picker option'))if(option.value!=='qq-runtime')option.textContent=f.snapshot.config.language==='en'?en[option.value]:names[option.value];window.renderAccounts?.(structuredClone(f.snapshot));window.renderQQRuntime?.(structuredClone(f.snapshot));};f.hold=result=>new Promise(resolve=>f.pending.push(()=>resolve(result)));
    const simple=(name,fn)=>async value=>{f.calls.push({name,value});return fn?fn(value):{ok:true,state:structuredClone(f.snapshot.qqRuntime)};};
    f.qr='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="white"/><g fill="#3c424a"><path d="M16 16h56v56H16zM168 16h56v56h-56zM16 168h56v56H16z"/><path d="M88 16h12v20H88zM118 16h28v12h-28zM88 48h52v12H88zM20 88h24v12H20zM58 80h12v32H58zM16 122h24v12H16zM88 190h16v34H88zM120 180h12v20h-12zM144 212h20v12h-20zM184 182h12v30h-12zM208 160h16v64h-16zM176 88h48v12h-48z"/></g><g fill="white"><path d="M26 26h36v36H26zM178 26h36v36h-36zM26 178h36v36H26z"/></g><g fill="#3c424a"><path d="M36 36h16v16H36zM188 36h16v16h-16zM36 188h16v16H36z"/></g><rect x="47" y="102" width="146" height="58" rx="5" fill="#fff4e9"/><text x="120" y="126" text-anchor="middle" font-size="13" font-family="Arial" fill="#76543c">SYNTHETIC</text><text x="120" y="145" text-anchor="middle" font-size="10" font-family="Arial" fill="#76543c">NOT A LOGIN CODE</text></svg>');
    window.arcade={snapshot:async()=>structuredClone(f.snapshot),qqRuntimeRefresh:simple('refresh'),qqRuntimeStart:simple('start',v=>{const r=f.snapshot.qqRuntime.instances.find(x=>x.accountId===v.accountId);r.processRunning=true;r.canStart=false;r.canStop=true;r.management='owned';r.runtimeRevision='new-1';r.login={state:'login_required'};return {ok:true,state:structuredClone(f.snapshot.qqRuntime)};}),qqRuntimeStop:simple('stop',v=>{const r=f.snapshot.qqRuntime.instances.find(x=>x.accountId===v.accountId);r.processRunning=false;r.canStart=true;r.canStop=false;r.login={state:'stopped'};return {ok:true,state:structuredClone(f.snapshot.qqRuntime)};}),qqRuntimeQR:simple('qr',v=>{const r=f.snapshot.qqRuntime.instances.find(x=>x.accountId===v.accountId),result={ok:true,image:f.qr,runtimeRevision:r.runtimeRevision};return f.delayQR?f.hold(result):result;}),qqRuntimeQuickLogin:simple('quickLogin'),qqRuntimeLogs:simple('logs',v=>({ok:true,events:[{type:'runtime_started',time:'12:00:00'}]})),qqRuntimeRecover:simple('recover'),qqRuntimeChoose:simple('choose'),qqRuntimeConfigure:simple('configure'),qqRuntimeLink:simple('link'),qqRuntimeBackups:simple('backups',()=>({ok:true,backups:[],hasMore:false})),accountSelect:simple('accountSelect'),accountConnect:simple('accountConnect'),
      qqRuntimeDirectory:simple('directory',v=>({ok:true,directory:{kind:v.kind,accountId:v.accountId,items:[],fetchedAt:new Date().toISOString(),source:'bridge-cache'}})),
      qqOwnerFriendAvailability:simple('friendAvailability',v=>({ok:true,...v,available:true,qqAccountId:'100001',ownerId:'200001',status:'not_started'})),qqOwnerFriendStart:simple('friendStart',v=>({ok:true,...v,kind:'owner-friend-setup',status:'listening',qqAccountId:'100001',ownerId:'200001',inbox:{source:'current-connection-events',complete:false,available:true,accountId:'100001',connectedAt:new Date().toISOString(),busy:false,overflow:false,items:[]}})),qqOwnerFriendClose:simple('friendClose',v=>({ok:true,...v,closed:true})),
      qqFirstSetup:simple('firstSetup',v=>({ok:true,...v,state:{busy:false,phase:'idle',engine:'managed-shell',version:'4.18.42',program:null,preparedVersionId:null,setups:[],installation:{current:{kind:'legacy'},previous:null,canReturn:false},lastCode:null,capabilities:[{engine:'managed-shell',version:'4.18.42',versionId:'napcat-shell-4.18.42-02e5ff0f79916c1e',available:true},{engine:'managed-node',version:'4.18.42',versionId:'napcat-node-4.18.42-77397ac38d66f463',available:true}]}})),qqFirstSetupClose:simple('firstSetupClose'),qqComponents:simple('components',()=>({ok:true,state:{busy:false,phase:'idle',version:'4.18.42',current:{kind:'original',version:'4.18.42',verification:'not-checked'},previous:null,prepared:[],preparedIssues:[],lastCode:null}}))};
    const modalShow=HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal=function(){if(this.id==='qq-account-dialog')f.modalOpens++;return modalShow.call(this);};
    window.arcade.accountSelect=async id=>{
      f.calls.push({name:'accountSelect',value:id});
      if(f.rejectSelection)throw Error('synthetic-selection-rejected');
      if(f.delayBeforeSelection)await new Promise(resolve=>f.selectPending.push(resolve));
      f.snapshot.accounts.selectedId=id;f.publish();
      if(f.delaySelection)await new Promise(resolve=>f.selectPending.push(resolve));
      return structuredClone(f.snapshot);
    };
    const originalStart=window.arcade.qqRuntimeStart;window.arcade.qqRuntimeStart=async value=>{const result=await originalStart(value);if(fixture.startWarning)result.lockRecoveryIssue='component_lock_retained';if(fixture.startPublish)fixture.publish();return result;};
    const originalQR=window.arcade.qqRuntimeQR;window.arcade.qqRuntimeQR=async value=>{if(!f.errorQR)return originalQR(value);f.calls.push({name:'qr',value});const result={ok:false,code:'account_changed'};return f.delayQR?f.hold(result):result;};
    window.arcade.qqRuntimeBackupPreview=simple('backupPreview');window.arcade.qqRuntimeBackupRestore=simple('backupRestore');
    window.arcade.qqRuntimeOrphanPreview=simple('orphanPreview',v=>({ok:true,preview:{accountId:v.accountId,count:2,expectedDigest:'a'.repeat(64),automaticStart:false}}));window.arcade.qqRuntimeOrphanCleanup=simple('orphanCleanup',v=>({ok:true,accountId:v.accountId,recovery:'orphans-cleared',terminatedCount:2,automaticStart:false}));
    window.openCompanionManager=()=>{f.calls.push({name:'manageCompanion'});};
    document.getElementById('language').onclick=()=>{f.snapshot.config.language=f.snapshot.config.language==='zh'?'en':'zh';f.publish();};
  });
  for(const file of ['accounts.js','qq-directory.js','qq-friend-requests.js','qq-components.js','qq-first-setup.js'])await page.addScriptTag({content:fs.readFileSync(path.join(UI,file),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(process.argv[3]||path.join(UI,'qq-runtime.js'),'utf8')});await page.evaluate(()=>{fixture.publish();switchView('qq-runtime');});
  const mode=process.argv[2]||'candidate',checks=receipt.checks;
  const ready=()=>page.waitForFunction(()=>document.querySelector('#qq-runtime-view').getAttribute('aria-busy')==='false');
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const state=()=>page.evaluate(()=>({view,selected:fixture.snapshot.accounts.selectedId,dialog:document.getElementById('qq-account-dialog').open,opens:fixture.modalOpens,calls:fixture.calls.filter(c=>c.name==='accountSelect'),pending:fixture.selectPending.length,errors:fixture.errors}));
  await ready();
  await page.evaluate(()=>{fixture.original=structuredClone(fixture.snapshot);});
  await page.locator('#qq-overview-action-100003').click();await frame();
  const immediate=await state();
  assert.equal(immediate.calls.length,1);assert.equal(immediate.selected,'whale');assert.equal(immediate.view,'bot');
  checks.push({name:'outer one-click immediate selection',observed:immediate});
  if(mode==='candidate')assert.equal(immediate.opens,0);
  await page.evaluate(()=>{switchView('qq-runtime');fixture.delaySelection=true;});await ready();
  await page.locator('#qq-overview-action-100003').click();await frame();
  const held=await state();assert.equal(held.pending,1);assert.equal(held.view,'qq-runtime');
  checks.push({name:'outer deferred selection before resolution',observed:held});
  if(mode==='candidate')assert.equal(held.dialog,false);
  await page.evaluate(()=>{switchView('settings');fixture.selectPending.shift()();});await frame();
  const afterLeave=await state();
  assert.equal(afterLeave.view,mode==='baseline'?'bot':'settings');
  checks.push({name:'deferred result after explicit page leave',observed:afterLeave});
  if(mode==='candidate'){
    const reset=async()=>{await page.evaluate(()=>{fixture.snapshot=structuredClone(fixture.original);fixture.delaySelection=false;fixture.delayBeforeSelection=false;fixture.rejectSelection=false;fixture.errors=[];fixture.calls=[];fixture.modalOpens=0;fixture.publish();switchView('qq-runtime');});await ready();};
    await reset();await page.evaluate(()=>{fixture.delaySelection=true;const b=document.getElementById('qq-overview-action-100003');b.click();b.click();});await frame();
    assert.equal((await state()).calls.length,1);assert.equal((await state()).pending,1);assert(await page.locator('#qq-overview-action-100003').isDisabled());
    await page.evaluate(()=>fixture.selectPending.shift()());await frame();assert.equal((await state()).view,'bot');
    checks.push({name:'Repeated click while resource cleanup is pending submits selection once; completion navigates only after await.'});
    const mutations={
      runtime:()=>{const r=fixture.snapshot.qqRuntime.instances[2];r.runtimeRevision='whale-next';fixture.publish();r.runtimeRevision='whale-1';fixture.publish();},
      owner:()=>{const p=fixture.snapshot.accounts.accounts[2];p.qqOwnerId='200002';fixture.publish();p.qqOwnerId='200001';fixture.publish();},
      connection:()=>{const p=fixture.snapshot.accounts.accounts[2];p.status='disconnected';p.accountId='';fixture.publish();p.status='connected';p.accountId='100003';fixture.publish();},
      selected:()=>{fixture.snapshot.accounts.selectedId='ju';fixture.publish();fixture.snapshot.accounts.selectedId='whale';fixture.publish();},
      view:()=>{switchView('settings');switchView('qq-runtime');},
      installation:()=>{fixture.snapshot.qqRuntime.desktopDataRoot+='-next';fixture.publish();fixture.snapshot.qqRuntime.desktopDataRoot=fixture.snapshot.qqRuntime.desktopDataRoot.slice(0,-5);fixture.publish();},
      binding:()=>{const p=fixture.snapshot.accounts.accounts[2];p.qqBinding={source:'last_verified',accountId:'100003',verifiedAt:2};fixture.publish();delete p.qqBinding;fixture.publish();},
      visibility:()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));}
    };
    for(const [name,mutate]of Object.entries(mutations)){
      await reset();await page.evaluate(()=>{fixture.delaySelection=true;document.getElementById('qq-overview-action-100003').click();});await frame();
      assert.equal((await state()).pending,1);await page.evaluate(mutate);await page.evaluate(()=>fixture.selectPending.shift()());await frame();
      const actual=await state();assert.equal(actual.view,'qq-runtime',name);assert.equal(actual.calls.length,1,name);assert.equal(actual.dialog,false,name);
      checks.push({name:`A→B→A ${name} observation permanently invalidates the old navigation intent.`});
    }
    const refused={
      expectedOnly:()=>{fixture.snapshot.accounts.accounts[2].accountId='';},
      lastVerifiedOnly:()=>{const p=fixture.snapshot.accounts.accounts[2];p.accountId='';p.qqBinding={source:'last_verified',accountId:'100003'};},
      conflicting:()=>{fixture.snapshot.accounts.accounts[2].expectedQQAccountId='199999';},
      duplicate:()=>{fixture.snapshot.accounts.accounts.push({...fixture.snapshot.accounts.accounts[2],id:'other'});},
      invalidOwner:()=>{fixture.snapshot.accounts.accounts[2].qqOwnerId='100003';},
      offline:()=>{fixture.snapshot.qqRuntime.instances[2].login={state:'offline'};},
      recovery:()=>{fixture.snapshot.qqRuntime.instances[2].recoveryRequired=true;}
    };
    for(const [name,change]of Object.entries(refused)){
      await reset();await page.evaluate(change);await page.evaluate(()=>fixture.publish());
      await page.evaluate(()=>document.getElementById('qq-overview-action-100003').click());await frame();
      const actual=await state();assert.equal(actual.calls.length,0,name);assert.equal(actual.view,'qq-runtime',name);
      checks.push({name:`${name} cannot use the direct conversation route.`});
      if(actual.dialog)await page.locator('#qq-account-dialog-close').click();
    }
    await reset();await page.locator('#qq-overview-more-100003').click();assert.equal((await state()).dialog,true);assert.equal((await state()).calls.length,0);
    await page.locator('#qq-ai-open-100003').click();await frame();assert.equal((await state()).view,'bot');assert.equal((await state()).calls.length,1);
    checks.push({name:'More still opens management; its existing inner conversation button uses the same verified helper.'});
    for(const dismiss of ['close','escape','before-selection-publish']){
      await reset();await page.locator('#qq-overview-more-100003').click();
      await page.evaluate(name=>{fixture.delaySelection=name!=='before-selection-publish';fixture.delayBeforeSelection=name==='before-selection-publish';},dismiss);
      await page.locator('#qq-ai-open-100003').click();assert.equal((await state()).pending,1);
      if(dismiss==='escape')await page.keyboard.press('Escape');else await page.locator('#qq-account-dialog-close').click();
      await page.evaluate(()=>fixture.selectPending.shift()());await frame();
      assert.equal((await state()).view,'qq-runtime');assert.equal((await state()).dialog,false);assert.equal((await state()).calls.length,1);
      checks.push({name:`Inner ${dismiss} invalidates late navigation without claiming to cancel account selection.`});
    }
    await reset();await page.evaluate(()=>{fixture.delaySelection=true;});await page.locator('#qq-overview-action-100003').click();
    await page.locator('#qq-overview-more-100001').click();await page.locator('#qq-account-dialog-close').click();
    await page.locator('#qq-overview-more-100003').click();await page.locator('#qq-account-dialog-close').click();
    await page.evaluate(()=>fixture.selectPending.shift()());await frame();assert.equal((await state()).view,'qq-runtime');assert.equal((await state()).dialog,false);
    checks.push({name:'Opening and closing other/same account management dialogs invalidates the outer pending conversation intent.'});
    await reset();await page.evaluate(()=>{const old=document.getElementById('qq-overview-action-100003');fixture.snapshot.accounts.accounts[2].status='disconnected';fixture.publish();old.click();});await frame();assert.equal((await state()).calls.length,0);
    checks.push({name:'A detached overview button cannot select its previously connected account.'});
    await reset();await page.evaluate(()=>{fixture.rejectSelection=true;});await page.locator('#qq-overview-action-100003').click();await frame();
    assert.equal((await state()).view,'qq-runtime');assert.deepEqual((await state()).errors,['synthetic-selection-rejected']);assert.equal((await state()).dialog,false);assert(await page.locator('#qq-overview-action-100003').isEnabled());
    checks.push({name:'Selection rejection reaches the existing action error handler and releases the pending control without navigation.'});
    await reset();await page.locator('#qq-overview-action-100003').focus();await page.keyboard.press('Enter');await frame();assert.equal((await state()).view,'bot');assert.equal((await state()).opens,0);
    checks.push({name:'Keyboard Enter on the actual outer button opens the conversation without management.'});
    await reset();await page.evaluate(()=>{fixture.delaySelection=true;document.getElementById('qq-overview-action-100003').click();});await frame();
    const screenshot=path.join(out,prefix+'-awaiting-selection.png');await page.screenshot({path:screenshot,fullPage:true});receipt.screenshots.push(screenshot);
    assert.equal((await state()).dialog,false);assert.equal(await page.locator('.qq-overview-card').count(),3);
    assert.equal(await page.locator('.qq-overview-card h2').first().evaluate(node=>getComputedStyle(node).fontSize),'17px');
    await page.evaluate(()=>fixture.selectPending.shift()());await frame();
    const actions=await page.evaluate(()=>fixture.calls.filter(c=>!['refresh','accountSelect'].includes(c.name)));assert.deepEqual(actions,[]);
    checks.push({name:'Pending route keeps the original 17px overview without a dialog or any start/connect/QR/model action.'});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  receipt.mode=mode;receipt.source=process.argv[3]||path.join(UI,'qq-runtime.js');receipt.complete=true;
  fs.writeFileSync(path.join(out,prefix+'-'+mode+'-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
