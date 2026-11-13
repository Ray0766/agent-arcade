'use strict';
// Actual DOM/main/Console/runtime over temporary owned guard files. Process
// inventory and connected AI services are synthetic. No Electron, QQ or CIM.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {QQConsole,validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt}=require('../src/bot/qq-console.cjs');
const {QQShellOwnerProof}=require('../src/bot/qq-shell-owner-proof.cjs');
const {fixture}=require('../test/helpers/qq-shell-owner-fixture.cjs');
const ROOT=path.resolve(__dirname,'..'),UI=path.join(ROOT,'src/ui'),OUT=path.resolve(ROOT,process.argv[2]||'outputs/qq-orphan-inspection-ui-v1-20261107');
if(!OUT.startsWith(path.join(ROOT,'outputs')+path.sep))throw Error('Output must stay in outputs.');
const clone=value=>JSON.parse(JSON.stringify(value)),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourcePaths=['src/main.cjs','src/bot/qq-console.cjs','src/bot/qq-runtime.cjs','src/bot/qq-shell-orphan-cleanup.cjs','src/bot/qq-shell-owner-proof.cjs','src/ui/qq-runtime.js','src/ui/style.css','test/helpers/qq-shell-owner-fixture.cjs','scripts/qq-orphan-inspection-ui-smoke.cjs'];
const sourceHashes=()=>sourcePaths.map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(ROOT,file)))}));
const main=fs.readFileSync(path.join(ROOT,'src/main.cjs'),'utf8'),start=main.indexOf('    const qqOrphanResult='),end=main.indexOf('    const providerLogin=',start);assert(start>=0&&end>start);
const receipt={kind:'orphan-inspection-resource-production-dom',before:sourceHashes(),productionMainHandlers:true,productionConsole:true,productionRuntime:true,actualTemporaryFiles:true,processInventory:'synthetic',services:'synthetic connected',nativeProcessOrCIM:false,electronStarted:false,realQQ:false,userAccounts:false,modelRequests:false,checks:[],screenshots:[],geometry:[],responses:[],externalRequests:[]};
const cleanups=[],fixtures=[],errors=[],pass=text=>receipt.checks.push(text);
const fileProof=file=>{const s=fs.lstatSync(file,{bigint:true});return {ino:String(s.ino),dev:String(s.dev),birth:String(s.birthtimeNs),links:String(s.nlink),sha256:hash(fs.readFileSync(file))};};
function dispatch(runtime,root,accountId){
  const state={disconnects:0,voiceCloses:0,webuiClientsCreated:0,clientCloses:0,bridgeReads:0};
  const console=new QQConsole({root:path.join(root,'ui-console'),runtimeFactory:()=>runtime,profileFactory:()=>({list:async()=>[]}),clientFactory:()=>{state.webuiClientsCreated++;throw Error('No WebUI client permitted');}});
  const heldClient={closed:false,close(){state.clientCloses++;this.closed=true;},async status(){state.bridgeReads++;throw Error('No bridge reads permitted');}};
  console.clients.set(accountId,{endpointId:'synthetic-held-client',publicId:'synthetic-client',client:heldClient});
  const services=new Map([['synthetic-owner',{status:'connected'}],['synthetic-other',{status:'connected'}]]);
  const rows=[{id:'synthetic-owner',channel:'qq',accountId},{id:'synthetic-other',channel:'qq',accountId:'12345002'}];
  const accounts={services,snapshot:()=>({accounts:rows.map(row=>({...row,status:services.get(row.id).status}))}),disconnect:async id=>{state.disconnects++;services.get(id).status='disconnected';}};
  const handlers=new Map();vm.runInNewContext(main.slice(start,end),{register:(name,fn)=>handlers.set(name,fn),validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt,qqConsole:console,accounts,qqStopping:new Set(),voiceAccount:'synthetic-owner',closeVoice:async()=>{state.voiceCloses++;}});
  return {console,state,accounts,heldClient,invoke:(name,value)=>handlers.get(name)(value)};
}
async function retained(){
  const after=[],f=fixture({after:fn=>after.push(fn)});let runtime;
  cleanups.push(async()=>{if(runtime){for(const owner of runtime._pendingOrphans().owners.values())await owner.proof.close();runtime._pendingOrphans().owners.clear();}for(const fn of after)await fn();});
  await f.runtime.start(f.account);const lease=f.deadManager();f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);
  const marker=f.marker(),journal=f.journal();runtime=f.fresh();
  const unlink=fs.unlinkSync,newGuard=QQShellOwnerProof.prototype._newGuard;
  fs.unlinkSync=function(file){if(String(file).endsWith('.lock.recover'))throw Object.assign(Error('injected guard cleanup failure'),{code:'EIO'});return unlink.apply(this,arguments);};
  QQShellOwnerProof.prototype._newGuard=function(file,value){const guard=newGuard.call(this,file,value);if(String(file).endsWith('.lock.recover'))throw Object.assign(Error('injected before capture'),{code:'EIO'});return guard;};
  try{await assert.rejects(runtime.previewOrphanCleanup(f.account),error=>error.code==='cleanup_unconfirmed');}finally{fs.unlinkSync=unlink;QQShellOwnerProof.prototype._newGuard=newGuard;}
  const owner=runtime._pendingOrphans().owners.get(f.account);assert(owner);assert.equal(owner.selected,undefined);assert.equal(owner.lease,undefined);assert.equal(runtime.hasOrphanInspectionResources(f.account),true);
  const guards=[...owner.proof.guards];assert.equal(guards.length,1);
  const originalClose=runtime.close,counters={managerClose:0};runtime.close=function(){counters.managerClose++;throw Error('Resource settlement must not close manager');};
  const bridge=dispatch(runtime,f.base,f.account),records=[runtime._lockPath(f.account),marker,journal],beforeRecords=records.map(fileProof),beforeRows=clone(f.state.rows);
  const result={...f,runtime,lease,owner,guard:guards[0],guardFd:guards[0].fd,marker,journal,bridge,records,beforeRecords,beforeRows,counters,originalClose};fixtures.push(result);return result;
}
(async()=>{
  fs.mkdirSync(OUT,{recursive:false});let browser,page,current;
  try{
    browser=await chromium.launch({headless:true});
    const styles=fs.readFileSync(path.join(UI,'index.html'),'utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('\n');
    const html=`<!doctype html><html><head><meta charset="UTF-8">${styles}</head><body data-view="qq-runtime"><nav><button data-view="settings">Settings</button></nav><select id="view-picker"></select><main></main><script>
window.view='qq-runtime';window.data=null;window.$=id=>document.getElementById(id);window.el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};window.switchView=()=>{};window.toast=()=>{};
window.arcade=Object.fromEntries(['qqRuntimeRefresh','qqRuntimeOrphanPreview','qqRuntimeOrphanCleanup','qqRuntimeOrphanDiscard'].map(name=>[name,value=>window.inspectionIPC(name,value)]));
</script><script src="/qq-runtime.js"></script></body></html>`;
    const idle=()=>page.waitForFunction(()=>document.querySelector('#qq-runtime-view')?.getAttribute('aria-busy')==='false');
    const publish=async()=>{const state=await current.f.bridge.console.refresh(),snap={config:{language:current.language},accounts:{selectedId:'synthetic-owner',accounts:[]},personas:[],qqRuntime:state};await page.evaluate(s=>{window.probeState=s;renderQQRuntime(s);},snap);await page.locator('#qq-runtime-view').evaluate(node=>node.hidden=false);return state;};
    const open=async f=>{
      if(page)await page.close();current={f,language:'zh',calls:[],after:null,refreshOverride:null};page=await browser.newPage({viewport:{width:1180,height:950},reducedMotion:'reduce'});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:41979'){receipt.externalRequests.push(url.origin);return route.abort();}if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});const file=path.join(UI,url.pathname.slice(1));return /^\/[a-z0-9-]+\.(css|js)$/.test(url.pathname)&&fs.existsSync(file)?route.fulfill({path:file}):route.abort();});
      await page.exposeFunction('inspectionIPC',async(name,value)=>{current.calls.push({name,value});let result=name==='qqRuntimeRefresh'?{ok:true,state:current.refreshOverride||await f.bridge.console.refresh()}:await f.bridge.invoke(name,value);if(current.after)result=await current.after(name,result,value);if(name!=='qqRuntimeRefresh')receipt.responses.push({name,result:clone(result)});return result;});
      await page.goto('http://127.0.0.1:41979/');const state=await publish();await idle();return state;
    };
    const dialog=async()=>{if(!await page.locator('#qq-account-dialog').evaluate(node=>node.open))await page.locator('#qq-overview-more-'+current.f.account).click();};
    const preview=async()=>{await dialog();await page.locator('#qq-orphan-inspect-'+current.f.account).click();await idle();await page.locator('#qq-orphan-clean-'+current.f.account).waitFor();return receipt.responses.at(-1).result.preview;};
    const confirm=async()=>{await page.locator('#qq-orphan-clean-'+current.f.account).click();await idle();return receipt.responses.at(-1).result;};
    const body=()=>page.locator('#qq-account-dialog').innerText();
    const shot=async(name,selector='.qq-orphan-controls')=>{if(await page.locator(selector).count())await page.locator(selector).first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:true});receipt.screenshots.push(name+'.png');};
    const noAuthority=async()=>{assert.equal(await page.locator('#qq-account-dialog [data-runtime-action="qqRuntimeQR"],#qq-account-dialog [data-runtime-action="qqRuntimeQuickLogin"],#qq-account-dialog [data-runtime-action="qqRuntimeStart"],#qq-account-dialog [data-runtime-action="qqRuntimeStop"],#qq-account-dialog [data-runtime-action="qqRuntimeRecover"]').count(),0);};
    const beforeEffects=f=>{assert.equal(f.state.stops.length,0);assert.equal(f.counters.managerClose,0);assert.equal(f.bridge.state.disconnects,0);assert.equal(f.bridge.state.voiceCloses,0);assert.equal(f.bridge.state.webuiClientsCreated,0);assert.equal(f.bridge.state.clientCloses,0);assert.equal(f.bridge.state.bridgeReads,0);assert.equal(f.bridge.heldClient.closed,false);assert(f.bridge.accounts.snapshot().accounts.every(row=>row.status==='connected'));assert.deepEqual(f.records.map(fileProof),f.beforeRecords);assert.deepEqual(f.state.rows,f.beforeRows);};

    const f=await retained(),state=await open(f),row=state.instances.find(v=>v.accountId===f.account);
    assert.equal(row.canSettleOrphanInspection,true);assert.equal(row.processRunning,null);assert.equal(row.login.state,'unknown');assert.equal(row.login.online,null);assert.equal(row.canInspectOrphanCleanup,undefined);for(const key of ['canStart','canStop','canRecover'])assert.equal(row[key],false);
    await dialog();await noAuthority();assert.equal(await page.locator('#qq-account-dialog .qq-runtime-state').innerText(),'状态待核实');await shot('resource-entry-zh-wide');beforeEffects(f);
    pass('Actual pre-capture guard cleanup failure yields only a resource-settlement entrance; unknown process/login state is not displayed as stopped and no QR/start/stop/recover control appears.');

    const first=await preview();assert.deepEqual(Object.keys(first).sort(),['accountId','kind','action','expectedDigest','expiresAt','automaticStart'].sort());assert.equal(first.kind,'pending-shell-inspection-resources');assert.equal(first.action,'settle-resources');assert.equal(Object.hasOwn(first,'count'),false);assert.doesNotMatch(await body(),/已核验 \d+ 个|剩余进程已清理/);await noAuthority();assert(fs.existsSync(f.guard.file));beforeEffects(f);await shot('resource-preview-zh-wide','.qq-orphan-preview');
    pass('Read-only production Preview has the exact resource union without a process count; the original guard, lease, update files and connected services remain.');

    await page.locator('#qq-orphan-cancel-'+f.account).click();await page.waitForFunction(()=>!document.querySelector('.qq-orphan-preview'));await idle();const discard=current.calls.filter(call=>call.name==='qqRuntimeOrphanDiscard').at(-1);assert.deepEqual(discard.value,{accountId:f.account,expectedDigest:first.expectedDigest});const stale=await f.bridge.invoke('qqRuntimeOrphanCleanup',{accountId:f.account,expectedDigest:first.expectedDigest});assert.equal(stale.ok,false);assert.equal(f.runtime._pendingOrphans().owners.get(f.account),f.owner);beforeEffects(f);
    pass('Cancel sends exact Discard, invalidates that confirmation and retains the unconfirmed resource owner without process or service effects.');

    await preview();const close=fs.closeSync;fs.closeSync=function(fd){if(fd===f.guardFd)throw Object.assign(Error('injected exact held-FD close failure'),{code:'EIO'});return close.apply(this,arguments);};let partial;
    try{partial=await confirm();}finally{fs.closeSync=close;}
    assert.equal(partial.ok,false);assert.equal(partial.cleanup.resources,'unconfirmed');assert.equal(partial.cleanup.kind,'pending-shell-inspection-resources');assert.equal(fs.existsSync(f.guard.file),false);assert.doesNotThrow(()=>fs.fstatSync(f.guardFd));assert.match(await body(),/收尾仍未确认/);assert.doesNotMatch(await body(),/进程均不在运行|原管理记录已清除/);beforeEffects(f);await shot('resource-partial-zh-wide','.qq-login-notice');
    pass('Actual owned guard unlink plus injected held-FD close failure produces an explicit unconfirmed resource result; it does not imply process absence or record removal.');

    const retry=await preview();assert.equal(retry.action,'settle-resources');current.language='en';await page.evaluate(()=>{window.probeState.config.language='en';renderQQRuntime(window.probeState);});await page.setViewportSize({width:430,height:950});const clean=page.locator('#qq-orphan-clean-'+f.account);await clean.scrollIntoViewIfNeeded();const bounds=await clean.evaluate(node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,font:getComputedStyle(node).fontSize,documentWidth:document.documentElement.scrollWidth};});assert(bounds.left>=0&&bounds.top>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height);assert(bounds.documentWidth<=bounds.width);assert.equal(bounds.font,'12px');receipt.geometry.push(bounds);await clean.focus();await shot('resource-retry-en-430','.qq-orphan-preview');
    await page.keyboard.press('Enter');await idle();const done=receipt.responses.at(-1).result;assert.equal(done.ok,true);assert.equal(done.recovery,'inspection-resources-settled');assert.equal(done.cleanup.resources,'closed');assert.equal(Object.hasOwn(done,'terminatedCount'),false);assert.equal(f.runtime._pendingOrphans().owners.has(f.account),false);assert.throws(()=>fs.fstatSync(f.guardFd),error=>error.code==='EBADF');assert.match(await body(),/previous inspection is settled/);assert.doesNotMatch(await body(),/processes are confirmed absent|ownership record was cleared/);beforeEffects(f);assert.equal(await page.locator('#qq-orphan-inspect-'+f.account).count(),0);assert.equal(await page.locator('#qq-orphan-clean-'+f.account).count(),0);assert(await page.locator('#qq-orphan-refresh-'+f.account).isEnabled());assert.doesNotMatch(await body(),/inspection still holds resources/);
    await page.evaluate(()=>renderQQRuntime(window.probeState));assert.equal(await page.locator('#qq-orphan-inspect-'+f.account).count(),0);assert(await page.locator('#qq-orphan-refresh-'+f.account).isEnabled());assert.doesNotMatch(await body(),/inspection still holds resources/);await shot('resource-settled-en-430','.qq-login-notice');
    pass('A new explicit preview and 430px English keyboard confirmation close only the remaining descriptor. Known closure hides stale settlement controls and held-resource wording even when the same old snapshot is rendered again, without inventing process success or disconnecting either companion.');

    const sameFields=await page.evaluate(()=>window.probeState.qqRuntime),pollCount=current.calls.filter(call=>call.name==='qqRuntimeRefresh').length,pollStarted=Date.now();current.refreshOverride=clone(sameFields);
    await page.waitForFunction(id=>!document.querySelector('#qq-orphan-refresh-'+id)&&!!document.querySelector('#qq-orphan-inspect-'+id),f.account,{timeout:14000});await idle();assert.equal(current.calls.filter(call=>call.name==='qqRuntimeRefresh').length,pollCount+1);assert.equal(await page.locator('#qq-orphan-refresh-'+f.account).count(),0);assert(await page.locator('#qq-orphan-inspect-'+f.account).isEnabled());assert.doesNotMatch(await body(),/previous inspection is settled|The inspection is settled/);assert.match(await body(),/inspection still holds resources/);beforeEffects(f);await shot('resource-synthetic-same-fields-poll-en-430');
    receipt.syntheticPoll={sameFields:true,fixture:'Clone of the original resource snapshot returned as a separately simulated fresh backend observation, after actual resource closure. This is a renderer refresh-race case, not new resource ownership.',originalProductTimerMs:10000,timerUnchanged:true,waitMs:Date.now()-pollStarted};current.refreshOverride=null;
    const refreshCount=current.calls.filter(call=>call.name==='qqRuntimeRefresh').length;await page.locator('#qq-account-dialog-close').click();await page.locator('#qq-overview-refresh').click();await idle();await dialog();assert.equal(current.calls.filter(call=>call.name==='qqRuntimeRefresh').length,refreshCount+1);assert.equal(f.bridge.console.state.instances.find(row=>row.accountId===f.account).canInspectOrphanCleanup,true);assert.equal(await page.locator('#qq-orphan-refresh-'+f.account).count(),0);assert(await page.locator('#qq-orphan-inspect-'+f.account).isEnabled());beforeEffects(f);
    pass('The unchanged 10-second page poll receives an explicitly synthetic fresh snapshot with identical fields, clears only known-success feedback and redraws the resource entrance. Restoring real Console refresh then returns to the actual process-inspection capability; no process or service effect is inferred from the synthetic observation.');

    const bad=await retained();await open(bad);current.after=async(name,result)=>name==='qqRuntimeOrphanPreview'?{...result,preview:{...result.preview,count:0}}:result;await dialog();await page.locator('#qq-orphan-inspect-'+bad.account).click();await idle();assert.equal(await page.locator('.qq-orphan-preview').count(),0);assert.equal(bad.bridge.console.orphanPreviews.size,0);assert(bad.runtime._pendingOrphans().owners.has(bad.account));beforeEffects(bad);current.after=null;
    await preview();current.after=async(name,result)=>name==='qqRuntimeOrphanCleanup'?{...result,cleanup:{...result.cleanup,count:0}}:result;await confirm();assert.match(await body(),/清理结果未能确认/);assert.doesNotMatch(await body(),/上次检查已收尾/);assert.equal(bad.runtime._pendingOrphans().owners.has(bad.account),false);beforeEffects(bad);await shot('resource-invalid-extra-count-zh-wide','.qq-login-notice');
    pass('Deliberately count-polluted clones of the real resource Preview and known-success receipt are rejected by the renderer; the malformed preview is discarded and no fabricated process fact is shown.');

    assert.deepEqual(errors,[]);assert.deepEqual(receipt.externalRequests,[]);for(const f of fixtures)beforeEffects(f);receipt.serviceEffects=fixtures.map(f=>({...f.bridge.state,managerClose:f.counters.managerClose,processStops:f.state.stops.length,allServicesConnected:f.bridge.accounts.snapshot().accounts.every(row=>row.status==='connected')}));receipt.after=sourceHashes();assert.deepEqual(receipt.after,receipt.before);receipt.status='passed';
    pass('All declared source hashes stayed fixed; no page errors, external requests, WebUI clients, manager close, AI/voice disconnect or process stop occurred.');
  }catch(error){receipt.status='failed';receipt.error=error.stack||String(error);process.exitCode=1;}
  finally{await browser?.close();for(const fn of cleanups.reverse())try{await fn();}catch(error){(receipt.cleanupErrors||=[]).push(error.code||error.message);receipt.status='failed';process.exitCode=1;}fs.writeFileSync(path.join(OUT,'ui.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.length,images:receipt.screenshots.length,receipt:path.join(OUT,'ui.json'),error:receipt.error,cleanupErrors:receipt.cleanupErrors}));}
})();
