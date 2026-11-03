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
    await page.locator('#bot-view').waitFor();assert.equal(await page.locator('#bot-start').isDisabled(),true);
    fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/bot-packaged-setup.png':'outputs/bot-setup.png',fullPage:true});
    await page.locator('#bot-key').fill('fixture-invalid-api-key');await page.locator('#bot-save').click();
    await page.locator('#bot-key-status').filter({hasText:'Key saved with OS encryption'}).waitFor();
    assert.equal(await page.locator('#bot-key').inputValue(),'');
    assert.doesNotMatch(fs.readFileSync(path.join(root,'bot-vault.json'),'utf8'),/fixture-invalid-api-key/);
    assert.equal((await page.evaluate(()=>window.arcade.snapshot())).bot.hasKey,true);
    await page.evaluate(async workspace=>window.arcade.botConfigure({workspace}),root);
    await page.locator('#bot-budget').fill('0.5');await page.locator('#bot-budget').press('Tab');
    await page.waitForFunction(async()=> (await window.arcade.snapshot()).bot.budget===0.5);
    await page.locator('#language').click();await page.locator('#bot-view h1').filter({hasText:'发条微信，让 Agent 开工。'}).waitFor();
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
    await page.locator('#compact').click();await page.locator('body.compact').waitFor();
    await page.locator('#view-picker').selectOption('bot');
    await showFixture();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/bot-packaged-compact.png':'outputs/bot-compact.png',fullPage:true});
    await page.evaluate(()=>window.arcade.botForget());
    assert.equal(fs.existsSync(path.join(root,'bot-vault.json')),false);
    assert.deepEqual(errors,[]);
    const appRoot=await app.evaluate(({app})=>app.getAppPath());
    const binaryPath=path.join(appRoot.replace(/app\.asar$/, 'app.asar.unpacked'),'node_modules',`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,process.platform==='win32'?'claude.exe':'claude');
    assert.equal(fs.existsSync(binaryPath),true,'Packaged SDK executable exists outside asar');
    const binary=require('node:child_process').execFileSync(binaryPath,['--version'],{timeout:15000,windowsHide:true,encoding:'utf8'}).trim();
    console.log(JSON.stringify({ui:'passed',osVault:'fixture key encrypted and removed',nativeSdk:binary,liveWeChat:false,liveModel:false}));
  }finally{await app.close();assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
