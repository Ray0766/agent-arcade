'use strict';
// Real Electron/SQLite/OS vault, isolated profile, fake key and HTTP provider.
// No real model, channel login, system permission prompt or human IME acceptance.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');

(async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-app-mac-')));
  const out=path.resolve('outputs/app-macos-smoke');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'zh',notifications:false}));
  const receipt={platform:process.platform,syntheticProvider:true,realModel:false,humanAcceptance:false,checks:[],screenshots:[]};
  const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'settings.json')};delete env.ELECTRON_RUN_AS_NODE;
  let app,page;
  const installStandIn=()=>{
      globalThis.appSmoke={mode:'reply',calls:[],serial:0};
      globalThis.fetch=async(url,init={})=>{
        if(url!=='https://api.deepseek.com/chat/completions')throw Error('Unexpected network blocked by smoke');
        const f=globalThis.appSmoke,body=JSON.parse(init.body);f.calls.push({stream:body.stream===true,hasKey:init.headers.Authorization==='Bearer fixture-macos-api-key',noTools:!body.tools||body.tools.length===0,prompt:body.messages.at(-1).content});
        if(f.mode==='network')throw TypeError('fetch failed');
        if(typeof f.mode==='number')return new Response('',{status:f.mode});
        const answer=`隔离服务商替身回复${++f.serial}：我在这里。`;
        if(!body.stream)return Response.json({choices:[{message:{role:'assistant',content:answer},finish_reason:'stop'}]});
        let timer,index=0;const hold=f.mode==='hold',encoder=new TextEncoder();
        const stream=new ReadableStream({start(controller){
          timer=setInterval(()=>{try{
            if(init.signal?.aborted){clearInterval(timer);controller.error(new DOMException('Aborted','AbortError'));return;}
            if(hold){controller.enqueue(encoder.encode(': waiting\n\n'));return;}
            if(index<answer.length)controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:answer[index++]},finish_reason:null}]})+'\n\n'));
            else {clearInterval(timer);controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();}
          }catch{clearInterval(timer);}},40);
        },cancel(){clearInterval(timer);}});
        return new Response(stream,{headers:{'content-type':'text/event-stream'}});
      };
  };
  // Install before loading bootstrap: restored conversations capture fetch during startup.
  const entry=path.join(root,'smoke-entry.cjs');
  fs.writeFileSync(entry,`(${installStandIn.toString()})();\nrequire('electron').app.setName('agent-arcade');\nrequire(${JSON.stringify(path.resolve(__dirname,'../src/bootstrap.cjs'))});\n`);
  const launch=async()=>{
    app=await electron.launch({executablePath:require('electron'),args:[entry,`--user-data-dir=${path.join(root,'electron-profile')}`],env});
    page=await app.firstWindow();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>receipt.errors.push(error.message));
  };
  receipt.errors=[];
  const pass=text=>receipt.checks.push(text);
  const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});receipt.screenshots.push(name+'.png');};
  const idle=()=>page.waitForFunction(()=>document.querySelector('#desktop-chat-stop')?.hidden===true);
  const send=async text=>{const before=await app.evaluate(()=>globalThis.appSmoke.calls.length);await page.locator('#desktop-chat-input').fill(text);await page.locator('#desktop-chat-send').click();await app.evaluate(async(_electron,count)=>{const deadline=Date.now()+5000;while(globalThis.appSmoke.calls.length<=count){if(Date.now()>deadline)throw Error('No intercepted request after Send');await new Promise(resolve=>setTimeout(resolve,10));}},before);};
  try{
    await launch();
    await page.locator('#first-run-card').waitFor();await shot('first-run');
    assert.equal(await page.evaluate(()=>window.arcade.platform.os),process.platform);
    await page.locator('#first-run-card [data-provider="deepseek"]').click();
    await page.locator('#first-run-key').fill('fixture-macos-api-key');await page.locator('#first-run-save').click();
    await page.locator('#desktop-chat-input').waitFor();pass('First-run AI selection saves a fake key through the real OS vault and opens App chat without QQ.');
    // Welcome is UI copy: even choosing a starter cannot fabricate a turn.
    const starters=page.locator('[aria-label="聊天起步建议"] button');
    await starters.first().click();assert.equal((await page.evaluate(()=>arcade.snapshot())).bot.local.history.length,0);
    assert.equal(await app.evaluate(()=>globalThis.appSmoke.calls.length),0);await shot('empty-starters');
    await send('这是隔离输入，和我聊一句。');
    await page.locator('.desktop-stream').waitFor();
    await shot('streaming');await idle();
    assert.match(await page.locator('#bot-messages').innerText(),/隔离服务商替身回复/);
    let calls=await app.evaluate(()=>globalThis.appSmoke.calls);
    assert(calls[0].stream);assert(calls[0].hasKey&&calls[0].noTools);pass('Built-in App reply streams through the actual API runner; no execution tools are supplied.');
    await page.locator('[data-tool="regenerate"]').click();
    await page.waitForFunction(()=>document.querySelector('.desktop-message-swipe-count')?.textContent==='2/2');
    await page.locator('[data-tool="continue"]').click();
    await page.waitForFunction(()=>document.querySelector('#bot-messages')?.textContent.includes('替身回复3'));
    await page.locator('[data-tool="edit"]').last().click();
    await page.locator('.desktop-message-edit-area').fill('这是主人编辑后的隔离回复。');
    await page.locator('.desktop-message-edit-foot button').filter({hasText:'保存'}).click();
    await page.waitForFunction(()=>document.querySelector('#bot-messages')?.textContent.includes('这是主人编辑后的隔离回复。'));
    await page.locator('.desktop-message-edit-area').waitFor({state:'detached'});
    pass('Built-in regenerate keeps two alternatives; continue appends and owner edit persists through real IPC.');
    await app.evaluate(()=>{globalThis.appSmoke.mode='hold';});await send('停止这一条。');
    await page.locator('#desktop-chat-stop').waitFor({state:'visible'});await page.locator('#desktop-chat-stop').click();
    await page.locator('#desktop-chat-status').filter({hasText:'这次回复已停止'}).waitFor();pass('Stop cancels the in-flight request without committing a late answer.');
    for(const [mode,pattern] of [[401,/密钥/],[402,/额度|余额|用量/],[429,/额度|余额|用量|频率/],['network',/网络|连接/]]){
      await app.evaluate((_electron,mode)=>{globalThis.appSmoke.mode=mode;},mode);
      const text='隔离失败测试 '+mode;await send(text);
      await page.locator('#desktop-chat-status').filter({hasText:pattern}).waitFor();assert.equal(await page.locator('#desktop-chat-input').inputValue(),text);
    }
    await shot('error');pass('401, 402, 429 and network failures show actionable classified copy and retain the draft.');
    await app.evaluate(()=>{globalThis.appSmoke.mode='reply';});
    await page.evaluate(()=>arcade.configure({sendShortcut:'ctrl-enter'}));
    const input=page.locator('#desktop-chat-input');await input.fill('Command 快捷键');
    const before=await app.evaluate(()=>globalThis.appSmoke.calls.length);
    await input.press('Enter');assert.equal(await app.evaluate(()=>globalThis.appSmoke.calls.length),before);
    await input.press(process.platform==='darwin'?'Meta+Enter':'Control+Enter');await idle();
    assert.equal(await app.evaluate(()=>globalThis.appSmoke.calls.length),before+1);pass('Configured Command+Enter sends; Enter inserts a line.');
    if(process.platform==='darwin'){
      await input.fill('仅测试自己的剪贴板');await input.press('Meta+A');await input.press('Meta+C');
      assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'仅测试自己的剪贴板');
      await input.press('Meta+X');assert.equal(await input.inputValue(),'');await input.press('Meta+V');assert.equal(await input.inputValue(),'仅测试自己的剪贴板');
      pass('Real Edit-menu Command+A/C/X/V shortcuts work in the composer (only this smoke text is read).');
    }
    for(const layout of ['immersive','messenger','minimal']){
      await page.evaluate(layout=>arcade.configure({layout,appearance:'dark'}),layout);
      await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(layout+'-dark');
    }
    await page.evaluate(()=>arcade.configure({appearance:'system',compact:true}));
    await app.evaluate(({nativeTheme})=>{globalThis.appSmoke.themeDescriptor=Object.getOwnPropertyDescriptor(nativeTheme,'shouldUseDarkColors');Object.defineProperty(nativeTheme,'shouldUseDarkColors',{configurable:true,get:()=>false});nativeTheme.emit('updated');});
    await page.waitForFunction(()=>document.documentElement.dataset.colorScheme==='light'||document.documentElement.dataset.theme==='light');
    await app.evaluate(({nativeTheme})=>{Object.defineProperty(nativeTheme,'shouldUseDarkColors',{configurable:true,get:()=>true});nativeTheme.emit('updated');});
    await page.waitForFunction(()=>document.documentElement.dataset.colorScheme==='dark'||document.documentElement.dataset.theme==='dark');
    await app.evaluate(({nativeTheme})=>{const d=globalThis.appSmoke.themeDescriptor;if(d)Object.defineProperty(nativeTheme,'shouldUseDarkColors',d);else delete nativeTheme.shouldUseDarkColors;nativeTheme.emit('updated');});
    pass('All layouts render without horizontal overflow; compact mode follows injected nativeTheme update events (OS appearance itself was not changed).');
    const history=(await page.evaluate(()=>arcade.snapshot())).bot.local.history;
    await app.close();app=null;await launch();
    await page.locator('#desktop-chat-input').waitFor();
    assert.deepEqual((await page.evaluate(()=>arcade.snapshot())).bot.local.history.map(m=>m.text),history.map(m=>m.text));
    await send('重启后接着聊。');
    await page.waitForFunction(async()=>{const s=await arcade.snapshot();return s.bot.local.history.at(-1)?.role==='assistant'&&!s.bot.local.streaming;});
    await idle();calls=await app.evaluate(()=>globalThis.appSmoke.calls);
    assert(calls[0].hasKey);assert.match(calls[0].prompt,/Command 快捷键/);
    if(await page.locator('#bot-latest').isVisible())await page.locator('#bot-latest').click();await shot('restarted');
    pass('Restart retains encrypted fake key, SQLite history and conversation context.');
    await page.evaluate(()=>ArcadeCharactersTabs.open('settings'));
    await page.locator('#st-settings-card').waitFor();
    assert.match(await page.locator('#st-settings-card > .st-note').first().innerText(),/流式显示开关也适用于内置角色/);
    await shot('settings-scope');pass('Conversation settings describe which switch applies to built-in companions.');
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }finally{
    if(page&&!receipt.passed){await shot('failed').catch(()=>{});receipt.lastText=await page.locator('body').innerText().catch(()=>null);}
    if(app)await app.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  }
  console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
