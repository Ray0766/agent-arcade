'use strict';
// Synthetic IPC and virtual renderer time. No real QQ, model or contact writes.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../outputs'),prefix=process.env.ARCADE_UI_PREFIX||'qq-directory-poll-20261106';
if(!/^[a-z0-9-]{1,72}$/.test(prefix))throw Error('Use a filename-only prefix.');
const receipt={synthetic:true,realQQRequests:0,contactWrites:0,modelsInvoked:0,checks:[],screenshots:[]};
const pass=value=>receipt.checks.push(value);
(async()=>{
  fs.mkdirSync(out,{recursive:true});const home=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-directory-poll-ui-'));
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({language:'zh'}));
  const env={...process.env,AGENT_ARCADE_HOME:home,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(home,'observer.json')};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'../src/main.cjs'),`--user-data-dir=${path.join(home,'profile')}`],env});
  try{
    const page=await app.firstWindow();page.setDefaultTimeout(10000);const errors=[],network=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>{network.push(r.request().url());return r.abort();});await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#qq-directory').waitFor({state:'attached'});const snapshot=await page.evaluate(()=>window.arcade.snapshot());
    await app.evaluate(({ipcMain,BrowserWindow},snapshot)=>{
      snapshot.demo=false;snapshot.config.language='zh';snapshot.bot={...snapshot.bot,channel:'qq',status:'connected'};
      snapshot.accounts={selectedId:'fixture-ju',accounts:[{id:'fixture-ju',name:'合成橘',characterId:'claude-ju',mode:'api',channel:'qq',status:'connected',accountId:'100001',qqOwnerId:'200001'}]};
      snapshot.qqRuntime={configured:true,desktopDataRoot:'C:\\Synthetic polling fixture',desktopRunning:false,components:{qqVersion:'fixture',napcatVersion:'fixture'},instances:[{accountId:'100001',processRunning:true,management:'owned',canStop:true,runtimeRevision:'fixture-runtime',login:{state:'online',online:true},bridges:[{serverName:'local',port:3301,enabled:true,loopbackOnly:true,hasToken:true}]}]};
      const f=globalThis.directoryPollFixture={snapshot,refreshes:0,pending:null,delay:false};
      for(const w of BrowserWindow.getAllWindows()){w.setTitle('Agent Arcade — Synthetic directory polling');const send=w.webContents.send.bind(w.webContents);w.webContents.send=(channel,...args)=>send(channel,...(channel==='arcade:snapshot'?[snapshot]:args));}
      f.publish=()=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('arcade:snapshot',snapshot);};
      const install=(name,fn)=>{ipcMain.removeHandler(`arcade:${name}`);ipcMain.handle(`arcade:${name}`,(_e,v)=>fn(v));};
      install('snapshot',()=>snapshot);
      install('qqRuntimeRefresh',()=>{f.refreshes++;if(f.delay){f.delay=false;return new Promise(resolve=>{f.pending=()=>{const row=f.snapshot.qqRuntime.instances[0];delete row.runtimeRevision;row.login={state:'unknown',online:false,issue:'endpoint_recheck_unavailable'};resolve({ok:true,state:structuredClone(f.snapshot.qqRuntime)});f.pending=null;};});}return {ok:true,state:snapshot.qqRuntime};});
      install('qqRuntimeDirectory',v=>({ok:true,directory:{accountId:v.accountId,kind:v.kind,source:'bridge-cache',fetchedAt:new Date().toISOString(),items:[{id:'200001',nickname:'合成主人',remark:'合成备注'}]}}));
      const recipient={accountId:'100001',ownerId:'200001',role:'合成橘'};
      install('qqOwnerRemarkAvailability',v=>({ok:true,...v,available:true,recipient}));
      install('qqOwnerRemarkRead',v=>({ok:true,...v,kind:'owner-remark',recipient,editable:true,ticketId:'11111111-1111-4111-8111-111111111111',expiresAt:Date.now()+300000,observed:{nickname:'合成主人',remark:'合成备注',source:'bridge-cache',fetchedAt:new Date().toISOString()},restore:{available:false}}));
      install('qqOwnerRemarkClose',()=>({ok:true,closed:true}));
      f.publish();
    },snapshot);
    await page.clock.install();
    const count=()=>app.evaluate(()=>directoryPollFixture.refreshes),drawer=page.locator('#qq-directory');
    const open=async()=>{await page.locator('.qq-runtime-card[data-account-id="100001"]').getByRole('button',{name:'好友与群组',exact:true}).click();await drawer.locator('.qq-directory-row').waitFor();};
    const screenshot=async name=>{const file=path.join(out,`${prefix}-${name}-synthetic.png`);await page.screenshot({path:file});receipt.screenshots.push(file);};
    await page.locator('nav [data-view="qq-runtime"]').click();await page.waitForFunction(()=>document.querySelector('.qq-runtime-card'));const initial=await count();assert.equal(initial,1);
    await open();await page.clock.fastForward(30000);assert.equal(await count(),initial);pass('Opening the directory stops periodic management refreshes; no 10-second polling occurs while it is open.');
    await drawer.locator('#qq-owner-remark-open').click();await drawer.locator('#qq-owner-remark-input').waitFor();await page.clock.fastForward(30000);assert.equal(await count(),initial);await screenshot('zh-owner-paused');pass('Owner remark editing shares the directory pause and does not cause a new management request.');
    await drawer.locator('#qq-directory-close').click();await drawer.waitFor({state:'hidden'});await page.clock.fastForward(9999);assert.equal(await count(),initial);await page.clock.fastForward(1);await app.evaluate(()=>{});await page.waitForFunction(()=>!!document.querySelector('.qq-runtime-card'));assert.equal(await count(),initial+1);pass('Closing restores the normal full 10-second interval instead of immediately refreshing or permanently stopping polling.');
    await app.evaluate(()=>{directoryPollFixture.delay=true;});await page.clock.fastForward(10000);await app.evaluate(()=>{if(!directoryPollFixture.pending)throw Error('No in-flight fixture refresh');});
    await open();const before=await count();await page.clock.fastForward(30000);assert.equal(await count(),before);pass('Opening during an in-flight refresh does not start an overlapping request.');
    await app.evaluate(()=>directoryPollFixture.pending());await drawer.waitFor({state:'hidden'});const card=page.locator('.qq-runtime-card[data-account-id="100001"]');
    assert.match(await card.innerText(),/在线状态待核实/);assert.doesNotMatch(await card.innerText(),/管理目录或账号状态已变化/);assert.equal(await drawer.innerHTML(),'');await screenshot('zh-recheck-unavailable');pass('An already-started refresh is still applied: unknown identity closes and clears the drawer and never retains online status.');
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(400,380);w.setContentSize(430,830);directoryPollFixture.snapshot.config.language='en';directoryPollFixture.publish();});await page.setViewportSize({width:430,height:830});await page.waitForFunction(()=>document.querySelector('.qq-runtime-card').textContent.includes('could not be rechecked'));assert(await page.locator('#qq-runtime-view').evaluate(n=>n.scrollWidth<=innerWidth));await screenshot('en-recheck-narrow');
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);pass('Chinese and English narrow status copy remains inside the same window, with no renderer errors or external requests.');receipt.passed=true;
  }finally{fs.writeFileSync(path.join(out,`${prefix}-ui.json`),JSON.stringify(receipt,null,2)+'\n');await app.close();}
  console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
