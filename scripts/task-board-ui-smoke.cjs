'use strict';
// Real git/worktree, production IPC and real Electron UI; only task state is
// seeded. No Claude launch, account, model call or user data is involved.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {TaskWorktrees}=require('../src/bot/task-worktree.cjs');
(async()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-task-ui-')),project=path.join(root,"project with ' spaces"),home=path.join(root,'home');
  fs.mkdirSync(project);fs.mkdirSync(home);
  const git=args=>execFileSync('git',args,{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git(['init']);git(['config','user.name','Task fixture']);git(['config','user.email','fixture@example.invalid']);
  fs.writeFileSync(path.join(project,'sample.txt'),'original\n');git(['add','.']);git(['commit','-m','Local UI fixture']);
  const worktrees=new TaskWorktrees({home}),wt=await worktrees.create({taskId:'history001',project}),now=Date.now(),past=now-3*86400000;
  fs.writeFileSync(path.join(wt.worktree,'sample.txt'),'keep this uncommitted change\n');
  const base={brief:'Isolated fixture, no model execution',project,createdAt:past,updatedAt:past,finishedAt:past,rework:0,reworkLog:[]};
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({language:'zh'}));
  fs.writeFileSync(path.join(home,'task-board.json'),JSON.stringify({version:1,tasks:[{...base,...wt,id:'history001',title:'合成验收样例 · 旧任务的改动',state:'verified',acceptNote:'Synthetic acceptance fixture'},
    {...base,id:'reported01',title:'合成样例 · 待返工任务',state:'reported',finishedAt:null}]}));
  const env={...process.env,AGENT_ARCADE_HOME:home,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'claude-settings.json')};delete env.ELECTRON_RUN_AS_NODE;
  // main.cjs deliberately isolates this script from another running desktop
  // window; standard bootstrap/single-instance is tested separately.
  const app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'../src/main.cjs'),`--user-data-dir=${path.join(root,'profile')}`],env});
  const checks={},screenshots=[],network=[],errors=[];
  try{
    const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,route=>{network.push(route.request().url());return route.abort();});
    await page.locator('#ws-work').click();await page.locator('nav [data-view="tasks"]').click();
    const history=page.locator('.tb-history'),card=history.locator('[data-id="history001"]');
    await history.locator('summary').click();await card.waitFor({state:'visible'});checks.historyVisible=true;
    await card.locator('[data-fk="t:history001:diff"]').click();await page.locator('dialog.tb-detail').waitFor({state:'visible'});
    await page.locator('dialog.tb-detail').getByText('sample.txt',{exact:true}).waitFor();assert.match(await page.locator('dialog.tb-detail').textContent(),/没提交：1/);
    await page.locator('dialog.tb-detail').getByRole('button',{name:'关闭',exact:true}).click();checks.realWorktreeDiff=true;
    await page.locator('[data-fk="t:reported01:rework"]').click();assert.match(await page.locator('[data-id="reported01"] .tb-step').textContent(),/同一个 worktree/);checks.reworkExplanation=true;
    await page.locator('[data-fk="t:reported01:rework-cancel"]').click();
    fs.mkdirSync('outputs',{recursive:true});
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(400,380);w.setContentSize(1200,900);});
    await history.scrollIntoViewIfNeeded();await page.screenshot({path:'outputs/task-board-history-zh.png'});screenshots.push('task-board-history-zh.png');
    await page.locator('#language').click();await history.locator('summary').getByText('Finished history (1)',{exact:true}).waitFor();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(430,760));await history.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'outputs/task-board-history-en-narrow.png'});screenshots.push('task-board-history-en-narrow.png');checks.languagesAndNarrow=true;
    const remove=card.locator('[data-fk="t:history001:remove"]');await remove.click();assert.equal(fs.existsSync(wt.worktree),true);await remove.click();
    const discard=card.locator('[data-fk="t:history001:discard"]');await discard.waitFor({state:'visible'});assert.equal(fs.existsSync(wt.worktree),true);checks.dirtyRemovalRefused=true;
    await page.screenshot({path:'outputs/task-board-discard-en-narrow.png'});screenshots.push('task-board-discard-en-narrow.png');
    await discard.click();assert.equal(fs.existsSync(wt.worktree),true);await discard.click();
    await card.waitFor({state:'detached'});assert.equal(fs.existsSync(wt.worktree),false);assert(!JSON.parse(fs.readFileSync(path.join(home,'task-board.json'),'utf8')).tasks.some(task=>task.id==='history001'));checks.explicitDiscardRemovesWorktreeAndRecord=true;
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    const result={scope:'Isolated real Electron + real git worktree + production IPC; task states are synthetic; no Claude launch or live model',checks,screenshots,noNetwork:true,bootstrapGuardTested:false};
    fs.writeFileSync('outputs/task-board-ui.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
