'use strict';
// Actual Electron UI + OS vault with a deliberately invalid fixture key.
// No WeChat pairing, messages, model requests, or commands are executed.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-bot-ui-'));
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'en'}));
  const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'observer-settings.json')};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.ARCADE_EXECUTABLE||require('electron');
  const profile=`--user-data-dir=${path.join(root,'electron-profile')}`;
  const app=await electron.launch({executablePath,args:process.env.ARCADE_EXECUTABLE?[profile]:[path.resolve(__dirname,'..'),profile],env});
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.locator('nav [data-view="bot"]').click();
    await page.locator('#bot-view').waitFor();assert.equal(await page.locator('#bot-start').isDisabled(),true);
    fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/bot-packaged-setup.png':'outputs/bot-setup.png',fullPage:true});
    // Conversation settings start closed for an App-only profile; the owner opens them from the chat header.
    await page.locator('#bot-settings-toggle').click();
    await page.locator('#bot-key').fill('fixture-invalid-api-key');await page.locator('#bot-save').click();
    await page.locator('#bot-key-status').filter({hasText:'Key saved with OS encryption'}).waitFor();
    assert.equal(await page.locator('#bot-key').inputValue(),'');
    assert.doesNotMatch(fs.readFileSync(path.join(root,'bot-vault.json'),'utf8'),/fixture-invalid-api-key/);
    assert.equal((await page.evaluate(()=>window.arcade.snapshot())).bot.hasKey,true);
    await page.evaluate(async workspace=>window.arcade.botConfigure({workspace}),root);
    await page.locator('#bot-advanced>summary').click();await page.locator('#bot-budget').fill('0.5');await page.locator('#bot-budget').press('Tab');
    await page.waitForFunction(async()=> (await window.arcade.snapshot()).bot.budget===0.5);
    await page.locator('#language').click();await page.locator('#bot-view h1').filter({hasText:'橘'}).waitFor();
    await page.emulateMedia({reducedMotion:'reduce'});
    // Clearly labelled synthetic output exercises long text and semantic states.
    const showFixture=()=>page.evaluate(()=>{
      window.renderBot({...data,bot:{...data.bot,workspace:'F:\\Example\\orbit-api',status:'disconnected',tasks:{currentTaskId:null,pending:[],messages:[
        {role:'user',text:'合成演示：检查这个项目的启动步骤，把缺失的说明补进 README。'},
        {role:'assistant',text:'合成演示：请求一次性权限\nRead {"file_path":"README.md"}\n/allow FIXTURE-CODE'},
        {role:'assistant',text:'合成演示：回复结束 · 任务结果尚未验证\nREADME 已补充步骤（示例文字，未执行文件修改）。\n实际检查：此截图仅验证界面。'},
      ]}}});document.querySelector('.bot-preview').textContent='合成界面样例 · 未连接真实微信或模型，未执行任务。';
    });await showFixture();await page.locator('#toast').waitFor({state:'hidden'});
    fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/bot-packaged-zh.png':'outputs/bot-zh.png',fullPage:true});
    // Render-only fixture: no Claude process, QQ transport or account is used.
    const showNativeStartup=async(language,attached,running=true)=>page.evaluate(({language,attached,running})=>{
      window.renderBot({...data,config:{...data.config,language},bot:{...data.bot,channel:'qq',mode:'native',workspace:'F:\\Example\\native-startup',status:'connected',paired:true,incomingCount:0,outgoingAccepted:0,
        native:{attached,paused:false,forwarded:0,replies:0,process:{owned:running,status:running?'running':'idle'}},tasks:{currentTaskId:null,pending:[],messages:[]}}});
      document.querySelector('.bot-preview').textContent=language==='zh'?'合成界面样例 · 未连接 QQ 或 Claude，未执行任务。':'Synthetic UI fixture · no QQ or Claude connection; no task executed.';
      document.querySelector('#bot-setup-panel').open=true;
      return Object.fromEntries(['bot-status','bot-task-state','bot-native-process-note'].map(id=>[id,document.getElementById(id).textContent]).concat([['openHidden',document.getElementById('bot-native-open').hidden]]));
    },{language,attached,running});
    for(const language of ['en','zh']){
      const unopened=await showNativeStartup(language,false,false);
      assert.match(unopened['bot-status'],language==='zh'?/等你打开 Claude/:/Waiting for you to open Claude/);
      assert.equal(unopened.openHidden,false);
      const waiting=await showNativeStartup(language,false);
      assert.match(waiting['bot-status'],language==='zh'?/等待 Claude 通道连接/:/Waiting for Claude channel/);
      assert.match(waiting['bot-task-state'],language==='zh'?/原版终端完成通道启动提示/:/channel startup prompt in the original terminal/);
      assert.equal(waiting.openHidden,true,'An already running Claude must not invite another launch');
      await page.screenshot({path:`outputs/native-startup-waiting-${language}.png`,fullPage:true});
      const attached=await showNativeStartup(language,true);
      assert.match(attached['bot-native-process-note'],language==='zh'?/保持此 Claude 会话打开/:/Keep this Claude session open/);
      assert.doesNotMatch(attached['bot-native-process-note']+attached['bot-task-state'],/startup|reconnect|log.?in|登录|启动提示|重新连接/i);
      assert.equal(attached.openHidden,true);
    }
    await showFixture();
    await page.locator('#shell-compact').click();await page.locator('body.compact').waitFor();
    await page.locator('#view-picker').selectOption('bot');
    await showFixture();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/bot-packaged-compact.png':'outputs/bot-compact.png',fullPage:true});
    await page.evaluate(async()=>{const state=await window.arcade.snapshot();return window.arcade.botForget({profileId:state.accounts.selectedId});});
    assert.equal(fs.existsSync(path.join(root,'bot-vault.json')),false);
    assert.deepEqual(errors,[]);
    // A source run's application root is this repository, whichever entry file Electron was started with.
    const appRoot=process.env.ARCADE_EXECUTABLE?await app.evaluate(({app})=>app.getAppPath()):path.resolve(__dirname,'..');
    const binaryPath=path.join(appRoot.replace(/app\.asar$/, 'app.asar.unpacked'),'node_modules',`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,process.platform==='win32'?'claude.exe':'claude');
    // The proprietary Claude Agent SDK is an optional dependency for source runs and is excluded from
    // packages (package.json build.files), so a packaged run proves that it was not shipped.
    let binary='not shipped in the package';
    if(process.env.ARCADE_EXECUTABLE)assert.equal(fs.existsSync(binaryPath),false,'The proprietary SDK executable is not packaged');
    else{assert.equal(fs.existsSync(binaryPath),true,'Optional SDK executable is installed for the source run');binary=require('node:child_process').execFileSync(binaryPath,['--version'],{timeout:15000,windowsHide:true,encoding:'utf8'}).trim();}
    console.log(JSON.stringify({ui:'passed',osVault:'fixture key encrypted and removed',nativeSdk:binary,liveWeChat:false,liveModel:false}));
  }finally{await app.close();assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
