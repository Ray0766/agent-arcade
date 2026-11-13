'use strict';
// Synthetic renderer acceptance only. Every exercised IPC route is replaced
// inside a fresh, credential-free profile. No live model or social account.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../outputs');
const prefix=process.env.ARCADE_UI_PREFIX||'companion-nine';
if(!/^[a-z0-9-]{1,72}$/.test(prefix))throw Error('Use a short filename-only ARCADE_UI_PREFIX.');
const includeQQRuntime=process.env.ARCADE_UI_QQ_RUNTIME==='1';
const receipt={kind:'synthetic-renderer-acceptance',synthetic:true,liveAccounts:false,liveModels:false,realMessagesSent:0,realPostsPublished:0,checks:[],screenshots:[],limitations:['IPC fixtures do not verify storage, account routing, model behavior or external delivery.','Source fixtures enter main.cjs with an isolated profile; the production global single-instance bootstrap is not exercised.']};
const passed=name=>receipt.checks.push(name);
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-nine-ui-'));
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({language:'zh',portrait:'anime'}));
  fs.writeFileSync(path.join(home,'bot-config.json'),JSON.stringify({mode:'claude',channel:'qq',workspace:home}));
  const env={...process.env,AGENT_ARCADE_HOME:home,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(home,'observer.json')};delete env.ELECTRON_RUN_AS_NODE;
  // A renderer fixture must not raise or contend with the user's live window.
  // Production bootstrap ownership has its own tests; retain main's normal
  // per-profile Electron lock inside this fresh, credential-free fixture.
  const args=[`--user-data-dir=${path.join(home,'profile')}`];if(!process.env.ARCADE_EXECUTABLE)args.unshift(path.resolve(__dirname,'../src/main.cjs'));
  const app=await electron.launch({executablePath:process.env.ARCADE_EXECUTABLE||require('electron'),args,env});
  let page;
  try{
    page=await app.firstWindow();page.setDefaultTimeout(10000);
    // Windows display scaling can round native content sizes. Pin CSS pixels
    // for responsive checks rather than claiming a rounded native size is 430.
    const resize=async(width,height)=>{await app.evaluate(({BrowserWindow},{width,height})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(400,380);w.setContentSize(width,height);},{width,height});await page.setViewportSize({width,height});await page.waitForFunction(w=>innerWidth===w,width);};
    const errors=[],network=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
    await page.route(/^https?:/,r=>{network.push(r.request().url());return r.abort();});
    await page.locator('#relationship-view').waitFor({state:'attached'});
    const base=await page.evaluate(()=>window.arcade.snapshot());
    await app.evaluate(({ipcMain,BrowserWindow},snapshot)=>{
      const now=Date.now();
      const profiles=[['primary','橘娘','claude-ju','claude'],['fixture-dragon','龙娘','codex-dragon','codex'],['fixture-whale','鲸鱼娘','deepseek-whale','deepseek']];
      const bots={};
      for(const [id,name,characterId,mode]of profiles){
        bots[id]={...structuredClone(snapshot.bot),mode,channel:'qq',status:id==='fixture-dragon'?'disconnected':'connected',problem:'',social:{
          config:{enabled:mode!=='codex',characterId,name,description:'合成人设：喜欢散步、阅读与观察天空。',notes:`${name}的私人草稿`,proactiveMessages:true,qzonePosts:false,activeStart:9,activeEnd:22,intervalMinutes:180,maxMessagesPerDay:2,maxPostsPerDay:1,speechExamples:[{user:'今天有点累。',assistant:'那就先歇一会儿，我陪你聊。'}]},
          active:mode!=='codex',supported:mode!=='codex',memoryReady:true,busy:false,problem:'',history:[],actions:[],
          facts:[{id:`${id}-fact`,text:`${name}的合成记忆：喜欢无糖茶。<script>window.fixtureInjected=true</script>`,sourceIds:['fixture-message'],sourceAt:now-60000,createdAt:now-60000,updatedAt:now-60000,revision:1}],
          followups:[{id:`${id}-future`,text:'合成约定：明天傍晚聊聊读到的故事。',dueAt:now+86400000,timeZone:'Australia/Sydney',state:'pending'},
            {id:`${id}-unknown`,text:'合成记录：提交过程中连接中断。',dueAt:now-3600000,timeZone:'Australia/Sydney',state:'unknown'}],
          entries:[{id:`${id}-draft`,text:'合成公开日记：窗边的阳光慢慢移到了书页上。',at:now-30000,state:'draft'},
            {id:`${id}-published`,text:'合成公开日记：今天给故事里的小岛取了一个名字。',at:now-86400000,state:'published',receipt:'fixture-only'}]
        }};
      }
      snapshot.accounts={selectedId:'primary',accounts:profiles.map(([id,name,characterId,mode],index)=>({id,name,characterId,mode,accountId:String(100001+index),qqOwnerId:String(200001+index),expectedQQAccountId:String(100001+index),channel:'qq',status:bots[id].status,problem:''}))};
      const fixture=globalThis.companionNineFixture={snapshot,bots,calls:[]};
      const select=()=>{snapshot.bot=bots[snapshot.accounts.selectedId];snapshot.persona=snapshot.personas.find(p=>p.id===snapshot.bot.social.config.characterId)||snapshot.personas[0];for(const item of snapshot.accounts.accounts)item.status=bots[item.id].status;};
      select();
      // Keep observer refreshes from replacing the explicitly synthetic state.
      for(const w of BrowserWindow.getAllWindows()){
        w.setTitle('Agent Arcade — Synthetic UI acceptance');
        const send=w.webContents.send.bind(w.webContents);
        w.webContents.send=(channel,...values)=>send(channel,...(channel==='arcade:snapshot'?[snapshot]:values));
      }
      fixture.publish=()=>{select();for(const w of BrowserWindow.getAllWindows())w.webContents.send('arcade:snapshot',snapshot);return structuredClone(snapshot);};
      const install=(name,fn)=>{ipcMain.removeHandler(`arcade:${name}`);ipcMain.handle(`arcade:${name}`,(_event,value)=>fn(value));};
      const record=(method,value)=>fixture.calls.push({method,accountId:snapshot.accounts.selectedId,value});
      install('snapshot',()=>snapshot);
      snapshot.qqRuntime={configured:true,desktopDataRoot:'C:\\Synthetic fixture only\\NapCat\\data',components:{qqVersion:'fixture',napcatVersion:'fixture'},desktopRunning:true,instances:[
        {accountId:'100001',runtimeRevision:'fixture-runtime-ju',processRunning:true,management:'external',canStart:false,canStop:false,reason:'desktop_running',login:{state:'online'}},
        {accountId:'100002',runtimeRevision:'fixture-runtime-dragon',processRunning:true,management:'owned',canStart:false,canStop:true,login:{state:'login_required'}},
        {accountId:'100003',processRunning:false,management:'none',canStart:true,canStop:false,login:{state:'stopped'}},
      ]};
      fixture.runtimeCalls=[];
      install('qqRuntimeRefresh',()=>{fixture.runtimeCalls.push({method:'refresh'});if(fixture.delayRuntime)return new Promise(resolve=>{fixture.finishRuntime=()=>{fixture.delayRuntime=false;resolve({ok:true,state:snapshot.qqRuntime});};});return {ok:true,state:snapshot.qqRuntime};});
      install('qqRuntimeQR',value=>{fixture.runtimeCalls.push({method:'qr',...value});if(fixture.nextQRError){const code=fixture.nextQRError;fixture.nextQRError=null;return {ok:false,code,state:snapshot.qqRuntime};}return {ok:true,state:snapshot.qqRuntime,runtimeRevision:snapshot.qqRuntime.instances.find(row=>row.accountId===value.accountId).runtimeRevision,image:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/><rect x="14" y="14" width="212" height="212" rx="6" fill="none" stroke="#777" stroke-dasharray="5 5"/><text x="120" y="110" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#444">SYNTHETIC</text><text x="120" y="140" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#777">NOT A LOGIN CODE</text></svg>').toString('base64')};});
      install('qqRuntimeLogs',value=>{fixture.runtimeCalls.push({method:'logs',...value});return {ok:true,events:[{time:'12:00:00',type:'runtime_started'},{time:'12:00:02',type:'login_required'}]};});
      install('qqRuntimeRecover',value=>{fixture.runtimeCalls.push({method:'recover',...value});if(fixture.nextRecoveryError){const code=fixture.nextRecoveryError;fixture.nextRecoveryError=null;return {ok:false,code,state:snapshot.qqRuntime};}Object.assign(snapshot.qqRuntime.instances.find(row=>row.accountId===value.accountId),{management:'owned',canRecover:false,recoveryRequired:false,reason:null,processRunning:true,canStart:false,canStop:true,runtimeRevision:'fixture-runtime-recovered',login:{state:'login_required'}});return {ok:true,state:snapshot.qqRuntime};});
      install('qqRuntimeConfigure',value=>{
        fixture.runtimeCalls.push({method:'configure',...value});if(fixture.nextConfigError){const code=fixture.nextConfigError;fixture.nextConfigError=null;return {ok:false,code};}
        let row=snapshot.qqRuntime.instances.find(row=>row.accountId===value.accountId);
        if(value.create){if(row)return {ok:false,code:'profile_exists'};row={accountId:value.accountId,management:'stopped',processRunning:false,canStart:true,canStop:false,login:{state:'stopped'},bridges:[]};snapshot.qqRuntime.instances.push(row);}
        const bridges=row.bridges||(row.bridges=[]);if(bridges.length>1&&!value.serverName)return {ok:false,code:'server_ambiguous'};
        let bridge=bridges.find(item=>item.serverName===value.serverName)||(!value.serverName&&bridges.length===1?bridges[0]:null);
        if(!bridge){bridge={serverName:value.serverName||'agent-arcade',port:value.port||3104};bridges.push(bridge);}
        Object.assign(bridge,{port:value.port||bridge.port,enabled:true,loopbackOnly:true,hasToken:true,token:'FIXTURE_TOKEN_MUST_NOT_REACH_DOM'});
        const result={ok:true,configured:true,created:!!value.create,backupCreated:!value.create};
        if(fixture.nextConfigRefreshIssue){fixture.nextConfigRefreshIssue=false;return {...result,refreshIssue:'connection_failed'};}return {...result,state:snapshot.qqRuntime};
      });
      install('qqRuntimeLink',value=>{fixture.runtimeCalls.push({method:'link',...value});if(fixture.nextLinkError){const code=fixture.nextLinkError;fixture.nextLinkError=null;return {ok:false,code};}const profile=snapshot.accounts.accounts.find(row=>row.id===value.companionId);profile.expectedQQAccountId=value.accountId;profile.qqOwnerId=value.ownerId;return {ok:true,linked:true,companionId:value.companionId,state:snapshot.qqRuntime};});
      install('qqRuntimeBackups',value=>{fixture.runtimeCalls.push({method:'backups',...value});return {ok:true,backups:[{id:'fixture-selected-backup',createdAt:1793880000000,sha256:'a'.repeat(64),size:640,valid:true},{id:'fixture-corrupt-backup',createdAt:1793870000000,valid:false,issue:'backup_invalid'}],hasMore:false,scanLimited:false};});
      install('qqRuntimeBackupPreview',value=>{fixture.runtimeCalls.push({method:'backup-preview',...value});return {ok:true,backupId:value.backupId,sha256:value.sha256,currentSha256:'b'.repeat(64),unchanged:false,changes:{currentValid:true,credentialsMayChange:true,groups:[{kind:'websocketServers',rows:[{index:0,before:{port:3305,enabled:true,loopbackOnly:true,hasToken:true},after:{port:3001,enabled:true,loopbackOnly:true,hasToken:true},changedFields:['port','token'],otherFieldsChanged:true}]}],otherTopLevelFieldsChanged:true},privateCanary:'FIXTURE_TOKEN_MUST_NOT_REACH_DOM'};});
      install('qqRuntimeBackupRestore',value=>{fixture.runtimeCalls.push({method:'backup-restore',...value});if(fixture.nextRestoreError){const code=fixture.nextRestoreError;fixture.nextRestoreError=null;return {ok:false,code};}return {ok:true,restored:true,sha256:value.sha256,preservedBackupId:'fixture-preserved-backup',recheckBinding:true,companionCredentialsUpdated:false,onlineIdentityVerified:false,refreshIssue:'connection_failed'};});
      install('config',patch=>{Object.assign(snapshot.config,patch);return fixture.publish();});
      install('accountSelect',id=>{assertAccount(id);record('accountSelect',id);snapshot.accounts.selectedId=id;return fixture.publish();});
      function assertAccount(id){if(!bots[id])throw Error('Unknown fixture account');}
      install('socialConfigure',patch=>{record('socialConfigure',patch);Object.assign(snapshot.bot.social.config,patch);fixture.publish();return snapshot.bot;});
      install('socialEdit',value=>{
        record('socialEdit',value);const s=snapshot.bot.social,at=Date.now();
        if(value.action==='remember')s.facts.push({id:`fixture-fact-${fixture.calls.length}`,text:value.text,sourceIds:[],createdAt:at,updatedAt:at,revision:1});
        else if(value.action==='correct'){const fact=s.facts.find(x=>x.id===value.id);if(fact){fact.text=value.text;fact.updatedAt=at;fact.revision++;}}
        else if(value.action==='forget')s.facts=s.facts.filter(x=>x.id!==value.id);
        else if(value.action==='followup-add')s.followups.push({...value,id:`fixture-followup-${fixture.calls.length}`,state:'pending'});
        else if(value.action==='followup-edit')Object.assign(s.followups.find(x=>x.id===value.id),value);
        else if(value.action==='followup-cancel')s.followups.find(x=>x.id===value.id).state='cancelled';
        else if(value.action==='entry-add')s.entries.unshift({id:`fixture-entry-${fixture.calls.length}`,text:value.text,at,state:'draft'});
        else if(value.action==='entry-edit')s.entries.find(x=>x.id===value.id).text=value.text;
        else if(value.action==='entry-delete')s.entries=s.entries.filter(x=>x.id!==value.id);
        else throw Error('Unsupported fixture edit');
        fixture.publish();return snapshot.bot;
      });
      install('socialDraft',()=>{record('socialDraft');const draft={id:`fixture-generated-${fixture.calls.length}`,text:'合成模型草稿：想给窗台的小盆栽画张像。',at:Date.now(),state:'draft'};snapshot.bot.social.entries.unshift(draft);fixture.publish();return draft;});
      install('socialPublish',id=>{record('socialPublish',id);const item=snapshot.bot.social.entries.find(x=>x.id===id),result=fixture.publishResult||{accepted:true,contentVerified:false,visibilityVerified:false};item.state=result.accepted?'published':result.unknown?'unknown':'cancelled';item.receipt=result.accepted?'synthetic-no-post':'';fixture.publish();return result;});
      install('characterImport',()=>{record('characterImport');const result={card:{name:'合成角色卡',description:'只用于隔离的界面测试。',speechExamples:[{user:'你好',assistant:'你好呀'}]},warnings:['合成导入：不会连接模型或改变权限。']};return fixture.delayImport?new Promise(resolve=>{fixture.finishImport=()=>resolve(result);}):result;});
      install('characterApply',card=>{record('characterApply',card);Object.assign(snapshot.bot.social.config,card);fixture.publish();return snapshot.bot;});
      install('characterExport',()=>{record('characterExport');return {cancelled:true};});
      install('accountConnect',id=>{assertAccount(id);record('accountConnect',id);bots[id].status='connected';return fixture.publish();});
      install('accountDisconnect',id=>{assertAccount(id);record('accountDisconnect',id);bots[id].status='disconnected';return fixture.publish();});
      // Remaining account routes are not exercised. Guard them rather than
      // reaching real services from the isolated renderer.
      for(const name of ['accountImport','accountRemove','accountRename','accountCreate','botConfigure','botConnect','botLogin','botDisconnect'])install(name,()=>{throw Error(`Live route forbidden in synthetic UI smoke: ${name}`);});
      fixture.publish();
    },base);
    const calls=()=>app.evaluate(()=>structuredClone(globalThis.companionNineFixture.calls));
    const publish=()=>app.evaluate(()=>globalThis.companionNineFixture.publish());
    const settle=()=>page.waitForFunction(()=>!document.querySelector('#relationship-view .relationship-feedback')?.textContent.match(/处理中|Working/));
    const tab=async name=>{await page.getByRole('tab',{name,exact:true}).click();await settle();};
    const account=async id=>{await page.locator(`#companion-switcher [data-account-id="${id}"]`).click();await page.locator(`#companion-switcher [data-account-id="${id}"][aria-pressed=true]`).waitFor();};
    const capture=async(name,{viewportOnly=false}={})=>{
      await page.evaluate(()=>{let label=document.querySelector('#fixture-label');if(!label){label=document.createElement('p');label.id='fixture-label';label.style.cssText='margin:0;padding:8px 16px;background:#fff4cf;color:#55451a;font-size:12px;line-height:1.6';document.querySelector('main>header').after(label);}label.textContent=document.documentElement.lang==='zh-CN'?'合成 UI 验收 · 未调用模型、发送消息或发布空间':'Synthetic UI acceptance · no models, messages or posts';});
      await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
      const file=path.join(out,`${prefix}-${name}.png`);await page.screenshot({path:file,fullPage:!viewportOnly,scale:'css'});receipt.screenshots.push(file);
    };
    await page.evaluate(()=>{const label=document.createElement('p');label.id='fixture-label';label.style.cssText='margin:0;padding:8px 16px;background:#fff4cf;color:#55451a;font-size:12px;line-height:1.6';label.textContent='合成 UI 验收 · 未调用模型、发送消息或发布空间';document.querySelector('main>header').after(label);});
    await page.locator('nav [data-view="bot"]').click();
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.tasks={tasks:[{id:'synthetic-reply',state:'running'}],messages:[{id:'fixture-user',role:'user',direction:'incoming',text:'合成对话：今天想休息一下。'},{id:'fixture-reply',role:'assistant',direction:'outgoing',text:'合成回复：好，那就慢慢来。'}],pending:[]};f.publish();});
    await page.waitForFunction(()=>document.querySelector('#bot-task-state').textContent==='正在回复');
    assert.match(await page.locator('[data-bot="inboxNote"]').innerText(),/陪伴聊天/);
    assert.equal(await page.locator('[data-bot="preview"]').isVisible(),false);
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.tasks.tasks[0].state='reply_ended';f.publish();});
    await page.locator('#bot-task-state').waitFor({state:'hidden'});await capture('zh-companion-chat');
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.social.config.enabled=false;f.snapshot.bot.social.active=false;f.publish();});
    await page.locator('#bot-task-state').waitFor({state:'visible'});assert.match(await page.locator('#bot-task-state').innerText(),/任务结果未验证/);
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.social.config.enabled=true;f.snapshot.bot.social.active=true;f.snapshot.bot.tasks={tasks:[],messages:[],pending:[]};f.publish();});
    passed('Companion chat uses reply states and hides completed task chrome; task mode retains unverified-outcome wording.');
    await page.locator('nav [data-view="relationship"]').click();
    assert.equal(await page.locator('#companion-switcher .companion-tab').count(),3);passed('Three independent companion tabs are visible; switching preserves the other connection statuses.');
    assert.match(await page.locator('.relationship-records').innerText(),/橘娘的合成记忆/);
    assert.equal(await page.evaluate(()=>window.fixtureInjected),undefined);passed('Stored untrusted text is rendered literally, without script execution.');
    await page.locator('#memory-text').fill('未保存的橘娘草稿');await page.locator('#memory-text').focus();await publish();
    assert.equal(await page.locator('#memory-text').inputValue(),'未保存的橘娘草稿');assert.equal(await page.locator('#memory-text').evaluate(n=>n===document.activeElement),true);passed('Snapshot polling preserves a current memory draft and focus.');
    await account('fixture-whale');assert.equal(await page.locator('#memory-text').inputValue(),'');assert.match(await page.locator('.relationship-records').innerText(),/鲸鱼娘的合成记忆/);passed('Changing account clears the previous memory draft and displays only the selected fixture records.');
    await page.locator('#memory-text').fill('合成偏好：喜欢听海浪。');await page.getByRole('button',{name:'记住这件事',exact:true}).click();await settle();assert.equal((await calls()).at(-1).accountId,'fixture-whale');assert.equal((await calls()).at(-1).value.action,'remember');
    await page.locator('.relationship-record').last().getByRole('button',{name:'修改',exact:true}).click();await settle();await page.locator('#memory-text').fill('合成偏好：喜欢听雨。');await page.getByRole('button',{name:'记住这件事',exact:true}).click();await settle();assert.equal((await calls()).at(-1).value.action,'correct');
    page.once('dialog',d=>d.accept());await page.locator('.relationship-record').last().getByRole('button',{name:'忘记',exact:true}).click();await settle();assert.equal((await calls()).at(-1).value.action,'forget');passed('Memory add, correction and confirmed forgetting use the selected account IPC.');
    await tab('约定回访');assert.match(await page.locator('.relationship-records').innerText(),/结果未确认，不重发/);
    const localFuture=await page.evaluate(()=>{const d=new Date(Date.now()+86400000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});
    await page.locator('#followup-text').fill('合成预约：聊书。');await page.locator('#followup-time').fill(localFuture);await page.getByRole('button',{name:'约好回访',exact:true}).click();await settle();let last=(await calls()).at(-1);assert.equal(last.value.action,'followup-add');assert.equal(last.value.timeZone,'Australia/Sydney');assert.ok(Number.isFinite(last.value.dueAt));
    await page.locator('.relationship-record').last().getByRole('button',{name:'取消约定',exact:true}).click();await settle();assert.equal((await calls()).at(-1).value.action,'followup-cancel');passed('Follow-up schedule transmits a timestamp and time zone; cancel and uncertain-delivery states are explicit.');
    await page.locator('#followup-text').fill('不能跨账号的回访草稿');await account('primary');assert.equal(await page.locator('#followup-text').inputValue(),'');assert.equal(await page.locator('#followup-time').inputValue(),'');passed('Changing account clears follow-up topic and date drafts.');
    await tab('她的日记');await page.locator('#journal-text').fill('不能跨账号的公开草稿');await account('fixture-whale');assert.equal(await page.locator('#journal-text').inputValue(),'');
    await page.locator('#journal-text').fill('合成草稿：天色逐渐变蓝。');await page.getByRole('button',{name:'保存草稿',exact:true}).click();await settle();assert.equal((await calls()).at(-1).value.action,'entry-add');
    await page.locator('.relationship-record').first().getByRole('button',{name:'发布到她的空间',exact:true}).click();await settle();assert.equal((await calls()).at(-1).method,'socialPublish');assert.match(await page.locator('.relationship-record').first().innerText(),/发布接口已接受/);assert.match(await page.locator('.relationship-feedback').innerText(),/空间接口已接受.*尚未核验/);passed('Public drafts clear across accounts; publishing has an explicit action and labels only interface acceptance.');
    await page.getByRole('button',{name:'让她写一则草稿',exact:true}).click();await settle();assert.match(await page.locator('.relationship-feedback').innerText(),/草稿已保存，尚未发布/);
    await app.evaluate(()=>{globalThis.companionNineFixture.publishResult={accepted:false,unknown:true,visibilityVerified:false};});await page.locator('.relationship-record').first().getByRole('button',{name:'发布到她的空间',exact:true}).click();await settle();assert.match(await page.locator('.relationship-feedback').innerText(),/发布结果未确认，未自动重发/);assert.equal(await page.locator('.relationship-record').first().getByRole('button',{name:'发布到她的空间',exact:true}).count(),0);
    await page.getByRole('button',{name:'让她写一则草稿',exact:true}).click();await settle();await app.evaluate(()=>{globalThis.companionNineFixture.publishResult={accepted:false,cancelled:true};});await page.locator('.relationship-record').first().getByRole('button',{name:'发布到她的空间',exact:true}).click();await settle();assert.match(await page.locator('.relationship-feedback').innerText(),/发布已取消，未提交帖子/);passed('Generated drafts, uncertain publication and cancelled publication have distinct outcomes; uncertain entries cannot be republished.');
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.social.active=false;f.snapshot.bot.status='disconnected';f.snapshot.accounts.accounts.find(x=>x.id===f.snapshot.accounts.selectedId).status='disconnected';f.publish();});
    await tab('角色卡');await page.getByRole('button',{name:'导入角色卡…',exact:true}).click();await settle();assert.match(await page.locator('.relationship-card-preview').innerText(),/合成角色卡/);await account('primary');assert.equal(await page.locator('.relationship-card-preview').innerText(),'');assert.equal(await page.getByRole('button',{name:'使用这张角色卡',exact:true}).isVisible(),false);passed('Changing account drops the imported character preview before it can be applied elsewhere.');
    await app.evaluate(()=>{globalThis.companionNineFixture.delayImport=true;});await page.getByRole('button',{name:'导入角色卡…',exact:true}).click();await account('fixture-whale');await app.evaluate(()=>globalThis.companionNineFixture.finishImport());await page.getByRole('button',{name:'导入角色卡…',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#relationship-view .relationship-actions button')?.disabled);await settle();assert.equal(await page.locator('.relationship-card-preview').innerText(),'','an old account import must not arrive in the newly selected account');assert.equal(await page.getByRole('button',{name:'使用这张角色卡',exact:true}).isVisible(),false);assert.equal(await page.locator('.relationship-feedback').innerText(),'');passed('A delayed character import and its completion feedback are discarded if the selected account changes before it returns.');await account('primary');
    // Same-account persona changes must not retain drafts intended for the old
    // character, even though the account selector itself has not changed.
    await tab('记得的事');await page.locator('#memory-text').fill('旧角色未保存记忆');
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.social.config.characterId='gemini-cat';f.publish();});
    assert.equal(await page.locator('#memory-text').inputValue(),'','same-account persona change must clear memory draft');passed('Changing persona within the same account clears the old character draft.');
    await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.bot.social.config.characterId='claude-ju';f.snapshot.bot.status='disconnected';f.snapshot.bot.social.active=false;f.publish();});
    await page.locator('nav [data-view="connections"]').click();if(!await page.locator('#social-panel').evaluate(n=>n.open))await page.locator('#social-panel>summary').click();
    await page.locator('#social-notes').fill('只属于橘娘的未保存私人笔记');await account('fixture-whale');assert.equal(await page.locator('#social-notes').inputValue(),'鲸鱼娘的私人草稿');passed('Changing account resets unsaved companion settings to that account’s saved values.');
    await page.locator('#social-characterId').selectOption('codex-dragon');assert.equal(await page.locator('#social-notes').inputValue(),'');assert.equal(await page.locator('#social-notes').isEnabled(),false);assert.equal(await page.locator('#social-proactiveMessages').isChecked(),false);passed('Changing character clears private note drafts and disables notes until contact scope is verified.');
    await page.locator('nav [data-view="relationship"]').click();await account('primary');await tab('记得的事');
    await resize(1180,980);await capture('zh-memory');
    await page.getByRole('button',{name:'管理搭档',exact:true}).click();assert.equal(await page.locator('#companion-manager .companion-manage-row').count(),3);
    await page.locator('#companion-manager .companion-manage-row').first().getByRole('button',{name:'连接',exact:true}).click();await page.locator('#companion-manager .companion-manage-row').first().getByRole('button',{name:'断开',exact:true}).waitFor();assert.equal((await calls()).at(-1).method,'accountConnect');
    await page.locator('#companion-manager .companion-manage-row').first().getByRole('button',{name:'断开',exact:true}).click();await page.locator('#companion-manager .companion-manage-row').first().getByRole('button',{name:'连接',exact:true}).waitFor();assert.equal((await calls()).at(-1).method,'accountDisconnect');passed('The account page refreshes its connect/disconnect action after each synthetic state change.');
    await capture('zh-accounts');await page.locator('#companion-manager').getByRole('button',{name:'关闭',exact:true}).click();passed('Companion manager lists all three independent accounts.');
    await page.locator('nav [data-view="relationship"]').click();await resize(430,1050);await page.emulateMedia({reducedMotion:'reduce'});
    const overflow=()=>page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    assert.ok((await overflow()).document<=430);await capture('zh-narrow-memory');await tab('约定回访');assert.ok((await overflow()).document<=430);await capture('zh-narrow-followups');await tab('她的日记');assert.ok((await overflow()).document<=430);await capture('zh-narrow-journal');
    await page.locator('#language').click();await page.getByRole('tab',{name:'Her journal',exact:true}).waitFor();assert.ok((await overflow()).document<=430);await capture('en-narrow-journal');await tab('Character card');assert.ok((await overflow()).document<=430);await capture('en-narrow-card');
    await page.getByRole('button',{name:'Manage companions',exact:true}).click();assert.ok((await overflow()).document<=430);await capture('en-narrow-accounts');await page.locator('#companion-manager').getByRole('button',{name:'Close',exact:true}).click();passed('Chinese and English layouts fit 430 CSS px, including diary, follow-ups, character cards and the account page; reduced motion enabled.');
    if(includeQQRuntime){
      const clockTime=Date.now();await page.clock.install({time:clockTime});await page.clock.pauseAt(clockTime+1000);
      await page.locator('#language').click();await resize(1180,980);
      const entryConfig=()=>app.evaluate(()=>{const b=globalThis.companionNineFixture.snapshot.bot;return {mode:b.mode,hasKey:b.hasKey,channel:b.channel,workspace:b.workspace};});
      const originalEntryConfig=await entryConfig(),entryCalls=(await calls()).length;
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.bots.primary.status='connected';f.publish();});
      await page.locator('nav [data-view="bot"]').click();
      if(!await page.locator('#bot-setup-panel').evaluate(n=>n.open))await page.locator('#bot-settings-toggle').click();
      await page.locator('#bot-qq-manage').waitFor();
      assert.equal(await page.locator('#bot-qq-manage').isEnabled(),true);
      assert.equal(await page.locator('#bot-qq-manual').evaluate(n=>n.open),false);
      assert.equal(await page.locator('#bot-qq-copy-config').isVisible(),false);
      assert.match(await page.locator('#bot-qq-managed').innerText(),/保存绑定后.*管理搭档.*连接/);
      await capture('zh-qq-setup-entry');
      await page.locator('#bot-qq-manual>summary').click();
      await page.locator('#bot-qq-copy-config').waitFor();
      assert.equal(await page.locator('#bot-qq-owner').count(),1);
      assert.equal(await page.locator('#bot-qq-token').count(),1);
      assert.equal(await page.locator('#bot-qq-advanced').count(),1);
      await page.locator('#bot-qq-manual>summary').click();
      await page.locator('#bot-qq-manage').click();await page.locator('#qq-runtime-view').waitFor();
      assert.equal(await page.locator('#bot-setup-panel').evaluate(n=>n.open),false);
      passed('Conversation settings routes to QQ account management while connected; manual configuration stays collapsed and all original controls remain available.');
      await page.locator('nav [data-view="connections"]').click();
      const qqEntry=page.locator('[data-onboard-channel="qq"]');
      assert.equal(await qqEntry.isEnabled(),true);assert.equal(await qqEntry.innerText(),'选择 QQ 并绑定搭档');
      await capture('zh-qq-onboarding-entry');await qqEntry.click();await page.locator('#qq-runtime-view').waitFor();
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.bots.primary.status='disconnected';f.publish();});
      await page.locator('nav [data-view="connections"]').click();assert.equal(await qqEntry.isEnabled(),true);
      assert.deepEqual(await entryConfig(),originalEntryConfig);assert.equal((await calls()).length,entryCalls);
      passed('Both QQ onboarding states open management without an AI readiness prerequisite, configuration write, credential change or automatic connection.');
      await resize(430,1050);assert.ok((await overflow()).document<=430);await capture('zh-narrow-qq-onboarding-entry');
      await page.locator('#language').click();assert.ok((await overflow()).document<=430);await capture('en-narrow-qq-onboarding-entry');
      await page.locator('#view-picker').selectOption('bot');
      if(!await page.locator('#bot-setup-panel').evaluate(n=>n.open))await page.locator('#bot-settings-toggle').click();
      assert.equal(await page.locator('#bot-qq-manage').innerText(),'Manage QQ accounts');
      assert.equal(await page.locator('#bot-qq-manual').evaluate(n=>n.open),false);
      assert.ok((await overflow()).document<=430);await page.locator('#bot-qq-managed').scrollIntoViewIfNeeded();await capture('en-narrow-qq-setup-entry');
      await page.locator('#bot-qq-manage').click();await page.locator('#qq-runtime-view').waitFor();
      await page.locator('#language').click();
      passed('QQ setup and onboarding entry points remain reachable in Chinese and English at 430 CSS px.');
      await page.locator('#qq-runtime-view .qq-runtime-card').first().waitFor();
      await page.waitForFunction(()=>!document.querySelector('#qq-runtime-view .page-heading button').disabled);
      const external=page.locator('.qq-runtime-card[data-account-id="100001"]'),signin=page.locator('.qq-runtime-card[data-account-id="100002"]'),stopped=page.locator('.qq-runtime-card[data-account-id="100003"]');
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.desktopRunning=false;f.publish();});
      await page.waitForFunction(()=>!document.querySelector('#qq-runtime-view').textContent.includes('迁移前请在原管理器停止对应 Bot'));
      for(const [width,height]of [[1200,830],[900,640]]){
        await resize(width,height);await page.evaluate(()=>window.scrollTo(0,0));
        const positions=await page.locator('.qq-runtime-card').evaluateAll(cards=>cards.map(card=>({top:card.getBoundingClientRect().top,controls:[...card.querySelectorAll('.qq-runtime-actions>button')].slice(0,2).map(button=>button.getBoundingClientRect().bottom)})));
        assert.equal(positions.length,3);assert.ok(Math.max(...positions.map(row=>row.top))-Math.min(...positions.map(row=>row.top))<2,JSON.stringify({width,height,positions}));assert.ok(positions.every(row=>row.controls.every(bottom=>bottom<height)),JSON.stringify(positions));
        assert.equal(await page.locator('.qq-runtime-installation').evaluate(node=>node.open),false);assert.equal(await page.locator('.qq-runtime-create').evaluate(node=>node.open),false);
        await capture(`zh-qq-first-screen-${width}x${height}`,{viewportOnly:true});
      }
      await page.locator('.qq-runtime-installation>summary').click();await page.getByRole('button',{name:'选择数据目录…',exact:true}).waitFor();assert.match(await page.locator('.qq-runtime-path').innerText(),/Synthetic fixture only/);
      await app.evaluate(()=>globalThis.companionNineFixture.publish());assert.equal(await page.locator('.qq-runtime-installation').evaluate(node=>node.open),true);await page.locator('.qq-runtime-installation>summary').click();
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.desktopRunning=true;f.publish();});
      passed('At 1200×830 and 900×640 all three QQ cards and their start/stop actions fit the first screen; component details remain expandable across state refreshes.');
      assert.equal(await external.getByRole('button',{name:'停止 QQ',exact:true}).isDisabled(),true);
      assert.equal(await external.getByRole('button',{name:'启动 QQ',exact:true}).isDisabled(),true);
      assert.equal(await stopped.getByRole('button',{name:'启动 QQ',exact:true}).isEnabled(),true);
      assert.match(await page.locator('#qq-runtime-view').innerText(),/迁移前请在原管理器停止对应 Bot/);
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
      passed('QQ account management is a normal page in the single existing window; external runtimes cannot be started or stopped.');
      await app.evaluate(()=>{const f=globalThis.companionNineFixture,p=f.snapshot.accounts.accounts[0];p.accountId='';p.qqBinding={accountId:'100001',source:'last_verified',verifiedAt:Date.now()-86400000};f.publish();});
      assert.match(await external.locator('.qq-runtime-identity').innerText(),/橘娘[\s\S]*上次关联/);
      assert.equal(await external.locator('.qq-runtime-state').innerText(),'QQ 已登录');
      passed('A last-verified binding restores the companion identity with an explicit historical label; live QQ state remains separate.');
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.accounts.accounts[0].qqBinding.accountId='100002';f.publish();});
      assert.equal(await signin.locator('h2').innerText(),'龙娘');assert.doesNotMatch(await signin.locator('.qq-runtime-identity').innerText(),/上次关联/);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture,p=f.snapshot.accounts.accounts[0];p.accountId='100009';p.qqBinding.accountId='100001';f.publish();});
      assert.equal(await external.locator('h2').innerText(),'QQ 账号');assert.doesNotMatch(await external.locator('.qq-runtime-identity').innerText(),/上次关联/);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.accounts.accounts[0].accountId='';f.publish();});
      passed('Current account identity wins over historical bindings; a known different current identity cannot claim its former QQ card.');
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;Object.assign(f.snapshot.qqRuntime.instances[2],{management:'recoverable',canRecover:true,recoveryRequired:true,canStart:false,reason:'recovery_required'});f.nextRecoveryError='owner_alive';f.publish();});
      await stopped.getByRole('button',{name:'恢复管理',exact:true}).waitFor();
      assert.equal(await stopped.getByRole('button',{name:'启动 QQ',exact:true}).isDisabled(),true);
      await stopped.getByRole('button',{name:'恢复管理',exact:true}).click();
      await page.locator('#qq-runtime-view [role="alert"]').waitFor();assert.match(await page.locator('#qq-runtime-view [role="alert"]').innerText(),/另一个 Agent Arcade/);
      await capture('zh-qq-runtime-recovery');
      await stopped.getByRole('button',{name:'恢复管理',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.qq-runtime-card[data-account-id="100003"]').textContent.includes('恢复管理'));
      assert.equal(await stopped.getByRole('button',{name:'停止 QQ',exact:true}).isEnabled(),true);
      passed('Recovery uses its dedicated action, preserves an owner-alive rejection, and replaces recovery controls after a confirmed fixture adoption.');
      await signin.getByRole('button',{name:'显示二维码',exact:true}).click();await signin.locator('.qq-runtime-qr').waitFor();
      await signin.getByRole('button',{name:'查看诊断',exact:true}).click();await signin.getByRole('log').waitFor();
      assert.match(await signin.getByRole('log').innerText(),/需要重新登录/);
      await resize(1180,980);
      assert.ok((await overflow()).document<=1180);await capture('zh-qq-runtime');
      passed('Synthetic QR and bounded diagnostic events stay with the selected QQ card; all runtime calls use fixture handlers.');
      const refreshCount=()=>app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.filter(row=>row.method==='refresh').length);
      let before=await refreshCount();await signin.getByRole('button',{name:'查看诊断',exact:true}).focus();
      await page.clock.runFor(10000);await page.waitForFunction(()=>document.querySelector('.qq-runtime-qr'));
      assert.equal(await refreshCount(),before+1);assert.equal(await signin.locator('.qq-runtime-qr').count(),1);
      assert.equal(await signin.getByRole('button',{name:'查看诊断',exact:true}).evaluate(node=>node===document.activeElement),true);
      passed('An unchanged 10-second QQ poll preserves the displayed QR and keyboard focus.');
      await app.evaluate(()=>{globalThis.companionNineFixture.delayRuntime=true;});before=await refreshCount();await page.clock.runFor(10000);
      assert.equal(await refreshCount(),before+1);await page.clock.runFor(30000);assert.equal(await refreshCount(),before+1);
      await app.evaluate(()=>globalThis.companionNineFixture.finishRuntime());
      await page.locator('nav [data-view="relationship"]').click();before=await refreshCount();await page.clock.runFor(30000);assert.equal(await refreshCount(),before);
      await page.locator('nav [data-view="qq-runtime"]').click();
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
      before=await refreshCount();await page.clock.runFor(30000);assert.equal(await refreshCount(),before);
      await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
      passed('QQ polls never overlap a pending refresh, and navigation away or a hidden document stops new refreshes.');
      await app.evaluate(()=>{globalThis.companionNineFixture.snapshot.qqRuntime.instances[1].runtimeRevision='fixture-runtime-replaced';});
      await page.clock.runFor(10000);await signin.locator('.qq-runtime-qr').waitFor({state:'detached'});
      await signin.getByRole('button',{name:'显示二维码',exact:true}).click();await signin.locator('.qq-runtime-qr').waitFor();
      await app.evaluate(()=>{globalThis.companionNineFixture.snapshot.qqRuntime.instances[1].login={state:'online',online:true};});
      await page.clock.runFor(10000);await signin.locator('.qq-runtime-qr').waitFor({state:'detached'});
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.instances[1].login={state:'login_required'};f.publish();});
      await signin.getByRole('button',{name:'显示二维码',exact:true}).click();await signin.locator('.qq-runtime-qr').waitFor();
      await app.evaluate(()=>{delete globalThis.companionNineFixture.snapshot.qqRuntime.instances[1].runtimeRevision;});
      await page.clock.runFor(10000);await signin.locator('.qq-runtime-qr').waitFor({state:'detached'});
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.instances[1].runtimeRevision='fixture-runtime-replaced';f.publish();});
      passed('A replacement or unknown runtime identity, or a completed login, invalidates the displayed QR without a user refresh.');
      await app.evaluate(()=>{globalThis.companionNineFixture.delayRuntime=true;});
      await page.locator('#qq-runtime-view .page-heading').getByRole('button',{name:'刷新状态',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#qq-runtime-view .page-heading button').disabled);
      assert.equal(await page.locator('#qq-runtime-view').getAttribute('aria-busy'),'true');
      assert.match(await page.locator('#qq-runtime-view [role="status"]').first().innerText(),/正在核对本机账号/);
      assert.equal(await signin.getByRole('button',{name:'停止 QQ',exact:true}).isDisabled(),true);await capture('zh-qq-runtime-pending');
      await app.evaluate(()=>globalThis.companionNineFixture.finishRuntime());
      await page.waitForFunction(()=>!document.querySelector('#qq-runtime-view .page-heading button').disabled);
      passed('Pending QQ operations disable conflicting runtime controls and restore them after the fixture response.');
      await signin.getByRole('button',{name:'显示二维码',exact:true}).click();await signin.locator('.qq-runtime-qr').waitFor();
      await app.evaluate(()=>{globalThis.companionNineFixture.nextQRError='account_changed';});
      await signin.getByRole('button',{name:'刷新二维码',exact:true}).click();
      await page.locator('#qq-runtime-view [role="alert"]').waitFor();
      assert.match(await page.locator('#qq-runtime-view [role="alert"]').innerText(),/登录账号与所选账号不同/);
      assert.equal(await signin.locator('.qq-runtime-qr').count(),0);await capture('zh-qq-runtime-error');
      passed('A failed QR refresh removes the previous code and shows the account-identity error instead of a stale sign-in image.');
      await resize(430,1050);
      await signin.getByRole('button',{name:'显示二维码',exact:true}).click();await signin.locator('.qq-runtime-qr').waitFor();
      assert.ok((await overflow()).document<=430);await capture('zh-narrow-qq-runtime');
      const refresh=page.locator('#qq-runtime-view .page-heading').getByRole('button',{name:'刷新状态',exact:true});await refresh.focus();await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>['BUTTON','SUMMARY'].includes(document.activeElement?.tagName)),true);
      const focus=await page.evaluate(()=>{const style=getComputedStyle(document.activeElement);return {width:parseFloat(style.outlineWidth),style:style.outlineStyle};});
      // The host's 175% display scale snaps a 2 CSS px outline to device pixels.
      assert.equal(focus.style,'solid');assert.ok(focus.width>=1.5&&focus.width<=2.5);
      await page.locator('#language').click();assert.ok((await overflow()).document<=430);
      assert.doesNotMatch(await page.locator('#qq-runtime-view').innerText(),/用这个 AI 的手机 QQ 扫码/);await capture('en-narrow-qq-runtime');
      passed('QQ sign-in cards, long Chinese guidance, QR and controls fit 430 px; keyboard focus remains on visible page controls.');
      await page.locator('#language').click();await resize(1180,980);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.desktopRunning=false;f.publish();});
      await page.locator('.qq-runtime-create>summary').click();
      const create=page.locator('.qq-runtime-create form'),addId=page.locator('#qq-runtime-add-id');
      assert.equal(await create.locator('input').count(),1);await addId.fill('100004');await create.getByRole('button',{name:'添加账号',exact:true}).click();
      const fresh=page.locator('.qq-runtime-card[data-account-id="100004"]');await fresh.waitFor();
      assert.deepEqual(await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.findLast(row=>row.method==='configure')),{method:'configure',accountId:'100004',create:true});
      assert.match(await page.locator('#qq-runtime-view [role="status"]').first().innerText(),/已添加，尚未登录/);
      passed('Adding a QQ account sends only its number and create intent; port selection stays in the backend and no login is claimed.');
      await fresh.locator('.qq-runtime-configuration>summary').click();
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.instances.find(row=>row.accountId==='100004').bridges=[{serverName:'primary-local',port:3104,enabled:true,loopbackOnly:true,hasToken:true,token:'FIXTURE_TOKEN_MUST_NOT_REACH_DOM'},{serverName:'legacy-extra',port:3105,enabled:false,loopbackOnly:false,hasToken:false}];f.publish();});
      const configServer=page.locator('#qq-config-server-100004'),configPort=page.locator('#qq-config-port-100004');
      await configServer.locator('option[value="legacy-extra"]').waitFor({state:'attached'});assert.equal(await configServer.inputValue(),'');
      const configuredCount=()=>app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.filter(row=>row.method==='configure').length);
      before=await configuredCount();await fresh.getByRole('button',{name:'准备本机连接',exact:true}).click();assert.equal(await configuredCount(),before);
      await configServer.selectOption('legacy-extra');await configPort.fill('3305');
      await app.evaluate(()=>{globalThis.companionNineFixture.nextConfigError='port_conflict';});await fresh.getByRole('button',{name:'准备本机连接',exact:true}).click();
      await page.locator('#qq-runtime-view [role="alert"]').waitFor();assert.match(await page.locator('#qq-runtime-view [role="alert"]').innerText(),/端口已被/);
      await fresh.getByRole('button',{name:'准备本机连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#qq-runtime-view [role="status"]')?.textContent.includes('本机连接已保存'));
      assert.deepEqual(await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.findLast(row=>row.method==='configure')),{method:'configure',accountId:'100004',serverName:'legacy-extra',port:3305});
      passed('Stopped QQ configuration requires an explicit choice among multiple servers; port failures are actionable and the selected server alone is submitted.');
      await configPort.fill('3399');await app.evaluate(()=>{globalThis.companionNineFixture.nextConfigRefreshIssue=true;});
      await fresh.getByRole('button',{name:'准备本机连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#qq-runtime-view [role="status"]')?.textContent.includes('配置已写入'));
      assert.equal(await configPort.inputValue(),'3399');assert.equal(await page.locator('#qq-runtime-view [role="alert"]').count(),0);
      passed('A saved configuration followed by refresh failure is reported as saved with stale status, and preserves the requested port.');
      const companion=page.locator('#qq-link-companion-100004'),owner=page.locator('#qq-link-owner-100004'),linkServer=page.locator('#qq-link-server-100004'),saveLink=fresh.getByRole('button',{name:'保存绑定',exact:true});
      await companion.selectOption('primary');assert.equal(await owner.inputValue(),'200001');await companion.selectOption('fixture-dragon');assert.equal(await owner.inputValue(),'200002');
      await linkServer.selectOption('legacy-extra');await owner.fill('200099');
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.bots['fixture-dragon'].status='connected';f.publish();});
      await page.waitForFunction(()=>document.querySelector('.qq-runtime-card[data-account-id="100004"] .qq-runtime-configuration form:last-of-type button').disabled);
      assert.match(await fresh.locator('.qq-runtime-configuration .qq-runtime-form').last().innerText(),/断开这位 AI/);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.bots['fixture-dragon'].status='disconnected';f.publish();});
      await page.waitForFunction(()=>!document.querySelector('.qq-runtime-card[data-account-id="100004"] .qq-runtime-configuration form:last-of-type button').disabled);
      const connectionCallsBefore=await app.evaluate(()=>globalThis.companionNineFixture.calls.filter(row=>['accountConnect','accountDisconnect'].includes(row.method)).length);
      await app.evaluate(()=>{globalThis.companionNineFixture.nextLinkError='account_connected';});await saveLink.click();
      await page.locator('#qq-runtime-view [role="alert"]').waitFor();assert.match(await page.locator('#qq-runtime-view [role="alert"]').innerText(),/断开这位 AI/);
      await app.evaluate(()=>{globalThis.companionNineFixture.nextLinkError='configuration_rollback_failed';});await saveLink.click();
      await page.waitForFunction(()=>document.querySelector('#qq-runtime-view [role="alert"]')?.textContent.includes('恢复状态未确认'));
      assert.doesNotMatch(await page.locator('#qq-runtime-view [role="alert"]').innerText(),/未改变|未保存/);
      await saveLink.click();await page.waitForFunction(()=>document.querySelector('#qq-runtime-view [role="status"]')?.textContent.includes('绑定已保存'));
      assert.deepEqual(await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.findLast(row=>row.method==='link')),{method:'link',accountId:'100004',companionId:'fixture-dragon',ownerId:'200099',serverName:'legacy-extra'});
      assert.equal(await app.evaluate(()=>globalThis.companionNineFixture.calls.filter(row=>['accountConnect','accountDisconnect'].includes(row.method)).length),connectionCallsBefore);
      passed('Binding selects a registered companion, resets owner defaults across companions, rejects a connected-AI race, and saves without connecting or invoking a model.');
      await owner.fill('200088');await owner.focus();
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.instances[0].login={state:'reconnecting'};f.publish();});
      await page.waitForFunction(()=>document.querySelector('.qq-runtime-card[data-account-id="100001"] .qq-runtime-state').textContent.includes('正在恢复'));
      assert.equal(await owner.inputValue(),'200088');assert.equal(await owner.evaluate(node=>node===document.activeElement),true);
      assert.equal(await sectionHasToken(page),false);assert.equal(await page.locator('#qq-runtime-view input[type="password"]').count(),0);
      passed('Runtime updates preserve an edited binding and focus; bridge token canaries never enter the DOM or form values.');
      await capture('zh-qq-configuration');await resize(430,1050);assert.ok((await overflow()).document<=430);await capture('zh-narrow-qq-configuration');
      await page.locator('#language').click();assert.equal(await owner.inputValue(),'200088');assert.ok((await overflow()).document<=430);await capture('en-narrow-qq-configuration');
      passed('The QQ create and binding forms fit Chinese and English 430 CSS px layouts without dropping an unsaved owner field.');
      await page.locator('#language').click();await resize(1180,980);
      const writesBefore=await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.filter(row=>['configure','link'].includes(row.method)).length);
      await fresh.locator('.qq-runtime-backups>summary').click();await fresh.getByRole('button',{name:'列出备份',exact:true}).click();
      const backupChoice=page.locator('#qq-backup-select-100004');await backupChoice.waitFor();assert.equal(await backupChoice.locator('option[value="fixture-corrupt-backup"]').evaluate(node=>node.disabled),true);
      assert.equal(await fresh.getByRole('button',{name:'预览变更',exact:true}).isDisabled(),true);
      await backupChoice.selectOption('fixture-selected-backup');await fresh.getByRole('button',{name:'预览变更',exact:true}).click();await fresh.locator('.qq-backup-preview').waitFor();
      assert.match(await fresh.locator('.qq-backup-preview').innerText(),/3305 → 3001/);assert.equal(await sectionHasToken(page),false);
      const restore=fresh.getByRole('button',{name:'恢复这份配置',exact:true});assert.equal(await restore.isEnabled(),true);
      assert.equal(await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.filter(row=>row.method==='backup-restore').length),0);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.bots['fixture-dragon'].status='connected';f.publish();});assert.equal(await restore.isDisabled(),true);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.bots['fixture-dragon'].status='disconnected';f.snapshot.qqRuntime.instances.find(row=>row.accountId==='100004').processRunning=true;f.publish();});assert.equal(await restore.isDisabled(),true);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.instances.find(row=>row.accountId==='100004').processRunning=false;f.snapshot.qqRuntime.desktopRunning=true;f.publish();});assert.equal(await restore.isDisabled(),true);
      await app.evaluate(()=>{const f=globalThis.companionNineFixture;f.snapshot.qqRuntime.desktopRunning=false;f.publish();});assert.equal(await restore.isEnabled(),true);
      passed('Backup restoration requires an explicit valid selection and preview; running QQ, Desktop or the bound AI disables the restore action, and secrets stay out of the preview.');
      await capture('zh-qq-backup-preview');await resize(430,1050);assert.ok((await overflow()).document<=430);await capture('zh-narrow-qq-backup-preview');
      await page.locator('#language').click();assert.ok((await overflow()).document<=430);await capture('en-narrow-qq-backup-preview');await page.locator('#language').click();
      await app.evaluate(()=>{globalThis.companionNineFixture.nextRestoreError='backup_changed';});await restore.click();await page.locator('#qq-runtime-view [role="alert"]').waitFor();assert.match(await page.locator('#qq-runtime-view [role="alert"]').innerText(),/备份内容已变化/);assert.equal(await fresh.locator('.qq-backup-preview').count(),0);
      await fresh.getByRole('button',{name:'预览变更',exact:true}).click();await fresh.locator('.qq-backup-preview').waitFor();await restore.click();
      await fresh.locator('.qq-backup-receipt').waitFor();assert.match(await fresh.locator('.qq-backup-receipt').innerText(),/文件已恢复，但状态暂未刷新/);assert.equal(await fresh.locator('.qq-backup-preview').count(),0);assert.equal(await page.locator('#qq-runtime-view [role="alert"]').count(),0);
      assert.deepEqual(await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.findLast(row=>row.method==='backup-restore')),{method:'backup-restore',accountId:'100004',backupId:'fixture-selected-backup',sha256:'a'.repeat(64),currentSha256:'b'.repeat(64)});
      assert.equal(await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls.filter(row=>['configure','link'].includes(row.method)).length),writesBefore);assert.equal(await sectionHasToken(page),false);
      passed('A stale backup error requires another preview; a committed restore with failed refresh stays reported as restored without rebinding or changing AI configuration.');
      receipt.runtimeCalls=await app.evaluate(()=>globalThis.companionNineFixture.runtimeCalls);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);passed('No renderer errors or attempted HTTP requests.');receipt.result='passed';receipt.ipcCalls=await calls();
  }catch(error){receipt.result='failed';receipt.failure=error.stack||error.message;if(page){const file=path.join(out,`${prefix}-failure.png`);await page.screenshot({path:file,fullPage:true,scale:'css'}).catch(()=>{});receipt.screenshots.push(file);}throw error;}
  finally{fs.writeFileSync(path.join(out,`${prefix}-ui.json`),JSON.stringify(receipt,null,2)+'\n');await app.close();}
  console.log(JSON.stringify({result:receipt.result,synthetic:true,checks:receipt.checks.length,screenshots:receipt.screenshots.length,receipt:path.join(out,`${prefix}-ui.json`)}));
})().catch(error=>{console.error(error);process.exitCode=1;});

async function sectionHasToken(page){return page.locator('#qq-runtime-view').evaluate(node=>node.outerHTML.includes('FIXTURE_TOKEN_MUST_NOT_REACH_DOM')||[...node.querySelectorAll('input,textarea')].some(input=>input.value.includes('FIXTURE_TOKEN_MUST_NOT_REACH_DOM')));}
