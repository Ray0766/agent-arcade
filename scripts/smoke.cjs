'use strict';
// Desktop smoke test. Runs in a disposable home; never touches real Claude settings.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-smoke-'));
 const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'claude-settings.json')};
 delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.ARCADE_EXECUTABLE || require('electron');
 const args=process.env.ARCADE_EXECUTABLE?['--demo']:[path.resolve(__dirname,'..'),'--demo'];
 const app=await electron.launch({executablePath,args,env,timeout:30000});
 const errors=[];
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.task-card').first().waitFor();assert.equal(await page.locator('.task-card').count(),4);
  await page.locator('.task-card').filter({hasText:'agent-arcade'}).click();assert.equal(await page.locator('#detail').evaluate(n=>n.open),true);assert.match(await page.locator('#detail-body').innerText(),/demonstration result/);await page.locator('#close-detail').click();
  await page.locator('#language').click();await page.locator('h1').filter({hasText:'小小世界，认真干活。'}).waitFor();
  await page.locator('[data-view="settings"]').click();await page.locator('#theme').selectOption('moonbase');await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--sky')==='#E2E5F1');
  await page.locator('#install').click();await page.locator('#install-status').filter({hasText:'钩子已安装'}).waitFor();assert(fs.existsSync(path.join(root,'bin','hook.cjs')));
  await page.locator('#uninstall').click();await page.locator('#install-status').filter({hasText:'钩子已移除'}).waitFor();
  await page.locator('[data-view="scene"]').click();await page.locator('#live').click();await page.locator('#empty').waitFor();assert.equal(await page.locator('.task-card').count(),0);
  const hook=spawnSync(process.execPath,[path.join(root,'bin','hook.cjs')],{input:JSON.stringify({session_id:'smoke-live',hook_event_name:'PermissionRequest',cwd:'/test/real-pipeline',tool_name:'Bash',tool_use_id:'safe-tool'}),env,encoding:'utf8'});assert.equal(hook.status,0);
  await page.locator('.task-card').filter({hasText:'real-pipeline'}).waitFor();assert.match(await page.locator('.task-card').innerText(),/等你确认/);
  await page.locator('#demo').click();await page.locator('.task-card').filter({hasText:'orbit-api'}).waitFor();
  await page.locator('#quiet').click();await page.locator('#quiet[aria-pressed="true"]').waitFor();
  await page.locator('#compact').click();await page.locator('body.compact').waitFor();await page.locator('#compact').click();await page.locator('body:not(.compact)').waitFor();
  await page.locator('#language').click();await page.locator('[data-view="settings"]').click();await page.locator('#theme').selectOption('workshop');await page.locator('[data-view="scene"]').click();
  fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/packaged-smoke.png':'outputs/workshop.png'});
  assert.deepEqual(errors,[]);console.log('Desktop smoke passed: demo, live hooks, results, Chinese, themes, quiet, compact, install/remove.');
 }finally{await app.close();if(!root.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
