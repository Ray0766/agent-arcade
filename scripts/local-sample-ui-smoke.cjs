'use strict';
// Production DOM + real in-memory Workbench/MCP inspection. This does not start
// Electron, discover a CLI, connect an account, or use a model or user files.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const {Workbench}=require('../src/workbench.cjs');
const ROOT=path.resolve(__dirname,'..'),UI=path.join(ROOT,'src/ui'),OUT=path.resolve(ROOT,process.argv[2]||'outputs/local-sample-ui-20261107');
const catalog=require('../src/core/personas.cjs').publicCatalog();
const SAMPLE='{"sample":"Agent Arcade","purpose":"Local artifact inspection; no model task"}\n';
const receipt={kind:'production-dom-real-workbench',syntheticAccountState:true,realAccounts:false,modelsCalled:0,electronStarted:false,checks:[],screenshots:[]};
const pass=text=>receipt.checks.push(text);
(async()=>{
  fs.mkdirSync(OUT,{recursive:true});const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-local-sample-ui-'));
  const browser=await chromium.launch({headless:true,...(process.env.ARCADE_HEADLESS_BROWSER?{executablePath:process.env.ARCADE_HEADLESS_BROWSER}:{})});let page,acceptPublish=true,publishQueue=Promise.resolve(),discoverCalls=0,failNext=false,releaseSample=null,sampleCalls=0;
  const errors=[],blockedNetwork=[],bridgeCalls=[];
  const workbench=new Workbench({root:temporaryRoot,discover:async()=>{discoverCalls++;throw Error('CLI discovery forbidden in this test');},onChange:()=>{
    const state=workbench.snapshot();publishQueue=publishQueue.then(async()=>{if(acceptPublish&&page&&!page.isClosed())await page.evaluate(work=>{if(window.sampleFixture){sampleFixture.state.work=work;sampleFixture.publish();}},state);});
  }});
  try{
    page=await browser.newPage({viewport:{width:1180,height:900}});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());let file;
      if(u.origin==='http://127.0.0.1:41278'){
        if(u.pathname==='/')file=path.join(UI,'index.html');
        else if(/^\/[a-z0-9-]+\.(css|js)$/.test(u.pathname))file=path.join(UI,u.pathname.slice(1));
        else if(/^\/(portraits|ornaments)\/[a-z0-9-]+\.png$/.test(u.pathname))file=path.join(UI,u.pathname.slice(1));
        else if(u.pathname==='/assets/brand/ribbon-simple-v1.png')file=path.join(ROOT,'src/assets/brand/ribbon-simple-v1.png');
      }
      if(!file||!fs.existsSync(file)){blockedNetwork.push(u.origin+u.pathname);return route.abort();}return route.fulfill({path:file});
    });
    await page.exposeFunction('sampleWorkbench',async(method,id)=>{
      bridgeCalls.push(method);
      if(method==='sample'){
        sampleCalls++;if(failNext){failNext=false;throw Error('Synthetic unavailable inspection adapter');}
        if(releaseSample!==null)await new Promise(resolve=>{releaseSample=resolve;});
        return workbench.sample();
      }
      if(method==='result')return workbench.result(id);
      if(method==='resource')return workbench.resource();
      if(method==='cancel')return workbench.cancel(id);
      throw Error('Unexpected Workbench method');
    });
    await page.addInitScript(({catalog,work})=>{
      const f=window.sampleFixture={listeners:[],writes:[],state:{demo:false,installed:false,problem:'',lastEventAt:0,
        config:{language:'zh',quiet:false,compact:false,portrait:'anime',character:'default',personaVoice:true,notifications:false,captureResults:false,theme:'workshop'},
        themes:[],tasks:[],work,personas:catalog,accounts:{selectedId:'',accounts:[]},
        bot:{mode:'api',channel:'wechat',workspace:'',status:'disconnected',paired:false,hasKey:false,problem:'',tasks:{tasks:[],pending:[],messages:[]},social:{supported:false,config:{enabled:false},facts:[],history:[],actions:[],followups:[],entries:[]}},
        qqRuntime:{configured:false,instances:[]}}};
      f.publish=()=>{f.state.theme=window.arcadePreviewThemes.workshop;f.state.themes=[{id:'workshop',name:'Moss Workshop'}];f.state.persona=catalog[0];for(const fn of f.listeners)fn(structuredClone(f.state));return structuredClone(f.state);};
      const forbidden=name=>async()=>{f.writes.push(name);throw Error('No configuration or account action is permitted in this fixture');};
      window.arcade={snapshot:async()=>f.publish(),subscribe:fn=>{f.listeners.push(fn);return()=>{};},
        inspectSample:()=>window.sampleWorkbench('sample'),inspectionResult:id=>window.sampleWorkbench('result',id),resultApp:()=>window.sampleWorkbench('resource'),inspectionCancel:id=>window.sampleWorkbench('cancel',id),
        configure:forbidden('configure'),botConfigure:forbidden('botConfigure'),botConnect:forbidden('botConnect'),botLogin:forbidden('botLogin'),accountSelect:forbidden('accountSelect'),workChooseFolder:forbidden('workChooseFolder'),backgroundCreate:forbidden('backgroundCreate'),inspectArtifact:forbidden('inspectArtifact')};
    },{catalog,work:workbench.snapshot()});
    await page.emulateMedia({reducedMotion:'reduce'});await page.goto('http://127.0.0.1:41278/');
    // Follow the current first-run disclosure to Channels, then open the optional local-work controls.
    const enterChannels=async()=>{if(!await page.locator('#first-run-other').evaluate(n=>n.open))await page.locator('#first-run-other > summary').click();await page.locator('#first-run-open-wizard').click();if(await page.locator('#onboarding-optional-toggle').getAttribute('aria-expanded')==='false')await page.locator('#onboarding-optional-toggle').click();};
    const openGuide=async()=>{if(await page.locator('#view-picker').isVisible())await page.locator('#view-picker').selectOption('settings');else await page.locator('#shell-bar [data-view=settings]').click();await page.locator('#ai-card-open').click();await enterChannels();};
    await enterChannels();
    const entry=page.locator('#onboarding-local-sample');await entry.waitFor();
    const capture=async name=>{
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');
      const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage:true});receipt.screenshots.push(file);
    };
    assert.equal(await page.evaluate(()=>document.body.dataset.view),'connections');assert.equal(sampleCalls,0);
    assert.equal(await page.locator('#onboarding-sample-note').evaluate(n=>getComputedStyle(n).fontSize),'15px');
    assert.match(await entry.getAttribute('aria-describedby'),/onboarding-sample-note/);await capture('first-open-zh-wide');
    pass('An empty profile reaches Channels through the real first-run disclosure, then opens the optional no-account/no-AI sample entry without inspection or configuration; --fs-md=15px matches theme.css.');

    // Keep the invocation pending long enough to exercise actual keyboard focus
    // and the renderer single-flight guard; completion still uses real sample().
    releaseSample=()=>{};await entry.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.body.dataset.view==='work'&&document.getElementById('artifact-sample').disabled);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'work-artifact-title');
    assert.equal(await page.locator('#work-artifact-title').evaluate(n=>getComputedStyle(n).fontSize),'17px');
    await page.evaluate(()=>{void window.openLocalSample();});assert.equal(sampleCalls,1);
    releaseSample();releaseSample=null;
    const resultFrame=page.frameLocator('#artifact-app');await resultFrame.locator('#artifact-body').getByText('no model task',{exact:false}).waitFor();
    const completed=workbench.snapshot().inspections.find(t=>t.status==='completed');assert(completed);
    const result=(await workbench.result(completed.taskId)).structuredContent;
    assert.equal(result.preview,SAMPLE);assert.equal(result.bytes,Buffer.byteLength(SAMPLE));assert.equal(result.lines,2);assert.equal(result.sha256,createHash('sha256').update(SAMPLE).digest('hex'));
    assert.equal(await resultFrame.locator('#artifact-body').innerText(),SAMPLE);
    assert.match(await resultFrame.locator('#artifact-facts').innerText(),new RegExp(result.sha256));
    assert.equal(await page.locator('#artifact-app').getAttribute('sandbox'),'allow-scripts');
    await page.locator('#artifact-app').scrollIntoViewIfNeeded();await capture('sample-result-zh-wide');
    pass('Enter runs one real Workbench.sample/MCP task, moves focus to the 17 px artifact heading, and displays the exact 79-byte, 2-line content and independently computed SHA-256.');
    await resultFrame.locator('#artifact-text').focus();await page.keyboard.press('Tab');
    assert(await resultFrame.locator('#artifact-json').evaluate(n=>document.activeElement===n));await page.keyboard.press('Enter');
    assert.equal(await resultFrame.locator('#artifact-body').innerText(),JSON.stringify(JSON.parse(SAMPLE),null,2));
    pass('Keyboard navigation enters the sandboxed real result app and formats its actual JSON; no account, project directory, model, or tool approval is needed.');

    // Failure is an injected adapter outage, followed by the real service retry.
    await openGuide();failNext=true;await entry.click();
    await page.waitForFunction(()=>!document.getElementById('artifact-sample').disabled&&document.getElementById('work-error').textContent.includes('重试'));
    await page.locator('#work-error').scrollIntoViewIfNeeded();await capture('sample-failure-retry-zh-wide');
    assert.equal(workbench.snapshot().inspections.length,1);const beforeRetry=sampleCalls;
    await page.locator('#artifact-sample').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>!document.getElementById('artifact-sample').disabled&&document.getElementById('work-inspections').querySelectorAll('article').length===2);
    assert.equal(sampleCalls,beforeRetry+1);assert.equal(await page.locator('#work-error').innerText(),'');
    assert.equal(workbench.snapshot().inspections.filter(t=>t.status==='completed').length,2);
    pass('An adapter failure shows localized retry guidance without a fabricated result or automatic retry; the existing sample button retries once and clears the error.');

    await page.setViewportSize({width:430,height:900});await openGuide();await entry.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.equal(await entry.evaluate(n=>document.activeElement===n),true);
    assert.equal(await entry.evaluate(n=>getComputedStyle(n).outlineStyle),'solid');await capture('first-open-zh-430-keyboard');
    await page.evaluate(()=>{sampleFixture.state.config.language='en';sampleFixture.publish();});await entry.focus();await capture('first-open-en-430-keyboard');
    const original=sampleCalls;failNext=true;await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('work-error').textContent.includes('retry'));
    assert.equal(sampleCalls,original+1);await page.locator('#work-error').scrollIntoViewIfNeeded();await capture('sample-failure-en-430');
    await page.locator('#artifact-sample').click();await page.waitForFunction(()=>document.getElementById('work-inspections').querySelectorAll('article').length===3);
    await page.locator('#artifact-app').scrollIntoViewIfNeeded();await capture('sample-result-en-430');
    pass('430 CSS px Chinese/English entry, failure guidance, retry and result remain readable and keyboard reachable with reduced motion.');
    await page.setViewportSize({width:787,height:600});await openGuide();await capture('first-open-en-150pct');
    pass('A 1180 × 900 window at 150% equivalent CSS dimensions retains the sample entry; this is layout coverage, not an OS DPI claim.');

    await publishQueue;assert.equal(discoverCalls,0);assert.deepEqual(fs.readdirSync(temporaryRoot),[]);assert.deepEqual(await page.evaluate(()=>sampleFixture.writes),[]);
    assert.deepEqual(errors,[]);assert.deepEqual(blockedNetwork,[]);assert(await page.evaluate(()=>[...document.images].filter(n=>n.offsetParent).every(n=>n.complete&&n.naturalWidth>0)));
    assert(bridgeCalls.every(m=>['sample','result','resource','cancel'].includes(m)));
    receipt.sample={bytes:result.bytes,lines:result.lines,sha256:result.sha256};receipt.adapterAttempts=sampleCalls;receipt.completedInspections=workbench.snapshot().inspections.filter(t=>t.status==='completed').length;
    pass('No CLI discovery, model, external network, account/configuration call, user file access, or disk output occurred; all visible bundled assets decoded without renderer errors.');
    receipt.result='passed';
  }catch(error){receipt.result='failed';receipt.error=error.stack;if(page)await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{
    acceptPublish=false;await publishQueue;await workbench.close();await browser.close();
    // This exact empty directory was created by this fixture and was verified
    // never to receive output. Non-recursive removal cannot affect other files.
    fs.rmdirSync(temporaryRoot);fs.writeFileSync(path.join(OUT,'ui.json'),JSON.stringify(receipt,null,2));
  }
  console.log(JSON.stringify({result:receipt.result,checks:receipt.checks.length,screenshots:receipt.screenshots.length,receipt:path.join(OUT,'ui.json')}));
})().catch(error=>{console.error(error);process.exitCode=1;});
