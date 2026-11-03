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
 // Start deterministically; the real app follows the Windows locale on first run.
 fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'en'}));
 const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'claude-settings.json')};
 delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.ARCADE_EXECUTABLE || require('electron');
 const profile=`--user-data-dir=${path.join(root,'electron-profile')}`;
 const args=process.env.ARCADE_EXECUTABLE?['--demo',profile]:[path.resolve(__dirname,'..'),'--demo',profile];
 const app=await electron.launch({executablePath,args,env,timeout:30000});
 const errors=[];
 try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  const icon=require('../src/core/icon.cjs').createIcon().toString('base64');assert.equal(await app.evaluate(({nativeImage},base64)=>nativeImage.createFromBuffer(Buffer.from(base64,'base64')).isEmpty(),icon),false);
  await page.locator('.task-card').first().waitFor();assert.equal(await page.locator('.task-card').count(),4);
  await page.locator('[data-filter="attentionFilter"]').focus();await page.waitForTimeout(1200);assert.equal(await page.locator('[data-filter="attentionFilter"]').evaluate(n=>n===document.activeElement),true);
  await page.locator('.task-card').filter({hasText:'agent-arcade'}).click();assert.equal(await page.locator('#detail').evaluate(n=>n.open),true);assert.match(await page.locator('#detail-body').innerText(),/demonstration result/);await page.locator('#close-detail').click();
  await page.locator('#language').click();await page.locator('#scene-view h1').filter({hasText:'会话'}).waitFor();
  await page.locator('[data-view="settings"]').click();await page.locator('#theme').selectOption('moonbase');await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--sky')==='#E2E5F1');
  await page.locator('#install').click();await page.locator('#install-status').filter({hasText:'钩子已安装'}).waitFor();assert(fs.existsSync(path.join(root,'bin','hook.cjs')));
  await page.locator('#uninstall').click();await page.locator('#install-status').filter({hasText:'钩子已移除'}).waitFor();
  await page.locator('[data-view="scene"]').click();await page.locator('#live').click();await page.locator('#empty').waitFor();assert.equal(await page.locator('.task-card').count(),0);
  const hook=spawnSync(process.execPath,[path.join(root,'bin','hook.cjs')],{input:JSON.stringify({session_id:'smoke-live',hook_event_name:'PermissionRequest',cwd:'/test/real-pipeline',tool_name:'Bash',tool_use_id:'safe-tool'}),env,encoding:'utf8'});assert.equal(hook.status,0);
  const liveCard=page.locator('.task-card').filter({hasText:'real-pipeline'});
  await liveCard.waitFor();assert.match(await liveCard.innerText(),/等你确认/);
  await liveCard.focus();
  const resumed=spawnSync(process.execPath,[path.join(root,'bin','hook.cjs')],{input:JSON.stringify({session_id:'smoke-live',hook_event_name:'PostToolUse',cwd:'/test/real-pipeline',tool_name:'Bash',tool_use_id:'safe-tool'}),env,encoding:'utf8'});assert.equal(resumed.status,0);
  await page.waitForFunction(()=>document.querySelector('.task-card .state-pill')?.textContent==='施工中');assert.equal(await liveCard.evaluate(n=>n===document.activeElement),true);
  await liveCard.press('Enter');
  const stopped=spawnSync(process.execPath,[path.join(root,'bin','hook.cjs')],{input:JSON.stringify({session_id:'smoke-live',hook_event_name:'Stop',cwd:'/test/real-pipeline'}),env,encoding:'utf8'});assert.equal(stopped.status,0);
  await page.locator('#detail-body .eyebrow').filter({hasText:'回复结束'}).waitFor();assert.match(await page.locator('.outcome-note').innerText(),/不判定任务是否成功/);await page.locator('#close-detail').click();
  await page.locator('#demo').click();await page.locator('.task-card').filter({hasText:'orbit-api'}).waitFor();
  await page.locator('#quiet').click();await page.locator('#quiet[aria-pressed="true"]').waitFor();
  await page.locator('#compact').click();await page.locator('body.compact').waitFor();
  await page.locator('#view-picker').selectOption('settings');await page.locator('#install').waitFor();
  await page.locator('#view-picker').selectOption('activity');await page.locator('#activity-view').waitFor();
  await page.locator('#view-picker').selectOption('scene');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.scene.running .robot').evaluate(n=>getComputedStyle(n).animationName),'none');
  await page.locator('#toast').waitFor({state:'hidden'});
  fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/packaged-compact-zh.png':'outputs/compact-zh.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('#compact').click();await page.locator('body:not(.compact)').waitFor();
  await page.locator('#language').click();await page.locator('[data-view="settings"]').click();await page.locator('#theme').selectOption('workshop');await page.locator('[data-view="scene"]').click();
  fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/packaged-smoke.png':'outputs/workshop.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Desktop smoke passed: demo, live hooks, results, Chinese, themes, quiet, compact navigation, reduced motion, focus retention, live details, install/remove.');
 }catch(error){const page=await app.firstWindow();fs.mkdirSync('outputs',{recursive:true});await page.screenshot({path:'outputs/smoke-failure.png'}).catch(()=>{});console.error('UI diagnostic:',await page.locator('#toast').textContent(),await page.locator('#install-status').textContent());throw error;}finally{await app.close();if(!root.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe test cleanup');fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
