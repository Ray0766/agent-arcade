'use strict';
// Isolated Electron renderer fixtures. No WeChat pairing, live Claude, or model
// requests. Clipboard verification reads only text this script just copied.
const {_electron: electron} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-chat-ui-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({language: 'zh'}));
  const env = {...process.env, AGENT_ARCADE_HOME: root,
    AGENT_ARCADE_CLAUDE_SETTINGS: path.join(root, 'observer-settings.json')};
  delete env.ELECTRON_RUN_AS_NODE;
  const profile = `--user-data-dir=${path.join(root, 'electron-profile')}`;
  const app = await electron.launch({
    executablePath: process.env.ARCADE_EXECUTABLE || require('electron'),
    args: process.env.ARCADE_EXECUTABLE ? [profile] : [path.resolve(__dirname, '..'), profile], env,
  });
  const stage = process.env.ARCADE_EXECUTABLE ? 'packaged' : 'source';
  try {
    const page = await app.firstWindow(), errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => { externalRequests.push(route.request().url()); return route.abort(); });
    await page.locator('nav [data-view="bot"]').click();
    await page.locator('#bot-view').waitFor();
    await page.locator('#bot-settings-toggle').waitFor();
    const size = async (width, height) => {
      await app.evaluate(({BrowserWindow}, dimensions) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setMinimumSize(400, 380);
        window.setContentSize(...dimensions);
      }, [width, height]);
      await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
    };
    await size(1280, 820);
    await page.emulateMedia({reducedMotion: 'reduce'});
    // Real observer/service snapshots keep arriving while fixtures are visible.
    // Wrap only this test page's renderer, so each refresh retains the explicit
    // fixture instead of silently replacing screenshot evidence with real state.
    await page.evaluate(() => {
      const realRender = render;
      render = () => {
        const fixture = window.__chatUiFixture;
        if (fixture) data = {...data, config: {...data.config, ...fixture.config}, bot: fixture.bot};
        realRender();
        document.querySelector('.bot-preview').textContent = '合成界面样例 / Synthetic UI fixture · 未连接微信或模型';
      };
    });
    let currentFixture = null;
    const panelOpen = () => page.locator('#bot-setup-panel').evaluate(node => node.open);
    const focused = id => page.waitForFunction(value => document.activeElement?.id === value, id);
    const labelFixture = () => page.evaluate(() => {
      const label = document.querySelector('.bot-preview');
      label.textContent = '合成界面样例 / Synthetic UI fixture · 未连接微信或模型';
      document.querySelector('[data-ui-fixture-watermark]')?.remove();
      const rect = label.getBoundingClientRect();
      // The compact inspector can scroll the normal footer out of view. Keep
      // every exported screenshot explicitly labelled, including that state.
      if (rect.top < 0 || rect.bottom > innerHeight || rect.height === 0) {
        const watermark = document.createElement('div');
        watermark.dataset.uiFixtureWatermark = '';
        watermark.textContent = '合成界面样例 / Synthetic UI fixture · 无真实连接';
        watermark.style.cssText = 'position:fixed;z-index:10000;bottom:5px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 12px);padding:3px 6px;background:#fff;color:#625e57;border:1px solid #d9dfe5;border-radius:4px;font:9px/1.5 sans-serif;text-align:center;pointer-events:none';
        document.body.append(watermark);
      }
    });
    const fixture = async ({messages = [], mode = 'native', language = 'zh', compact = false, portrait = 'anime',
      status = 'connected', pending = [], native = {}} = {}) => {
      currentFixture = {messages, mode, language, compact, portrait, status, pending, native};
      await page.evaluate(value => {
        window.__chatUiFixture = {config: {language: value.language, compact: value.compact, portrait: value.portrait},
          bot: {...data.bot, workspace: 'F:\\Example\\agent-arcade', mode: value.mode,
            status: value.status, paired: true, hasKey: false, problem: '',
            incomingCount: value.messages.filter(message => message.role === 'user').length,
            outgoingAccepted: value.messages.filter(message => message.role === 'assistant').length,
            native: {attached: true, paused: false, forwarded: 1, replies: 1, command: '', process: {status: 'idle', owned: false, canResume: false}, ...value.native},
            tasks: {messages: value.messages, pending: value.pending, tasks: [], currentTaskId: null, queue: []}}};
        render();
        document.querySelector('.bot-preview').textContent = '合成界面样例 / Synthetic UI fixture · 未连接微信或模型';
      }, {messages, mode, language, compact, portrait, status, pending, native});
    };
    const capture = async (suffix, fullPage = false) => {
      fs.mkdirSync('outputs', {recursive: true});
      // Exercise the same data assignment used by the actual subscription.
      await page.evaluate(async () => {data = await window.arcade.snapshot(); render();});
      if(suffix.startsWith('native-')) await page.locator('#bot-native-process-note').scrollIntoViewIfNeeded();
      const assertCaptureState = async () => {
        const expectedMessages = currentFixture?.messages || [];
        assert.deepEqual(await page.locator('#bot-messages .message-body').allTextContents(), expectedMessages.map(message => message.text));
        assert.equal(await page.locator('#bot-messages .bot-message').count(), expectedMessages.length);
        let expectedStatus = currentFixture
          ? currentFixture.language === 'zh'
            ? (expectedMessages.some(message => message.role === 'user') ? '已收到消息' : '微信已连接')
            : (expectedMessages.some(message => message.role === 'user') ? 'Message received' : 'WeChat connected')
          : '未连接';
        if(currentFixture?.mode === 'native' && currentFixture.status === 'connected') {
          if(['stopped','exited'].includes(currentFixture.native.process?.status)) expectedStatus=currentFixture.language==='zh'?'本机会话已停止':'Local session stopped';
          else if(currentFixture.native.attached===false) expectedStatus=currentFixture.language==='zh'?'等你打开 Claude':'Waiting for you to open Claude';
        }
        assert.equal(await page.locator('#bot-status').textContent(), expectedStatus, 'Screenshot status matches the selected fixture');
        assert.equal(await panelOpen(), suffix === 'setup' || suffix === 'compact-settings' || suffix.startsWith('native-'));
        assert.match(await page.locator('.bot-preview').textContent(), /Synthetic UI fixture/);
        assert.equal(await page.evaluate(() => {
          const node = document.querySelector('[data-ui-fixture-watermark]') || document.querySelector('.bot-preview');
          const rect = node.getBoundingClientRect();
          return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
        }), true, 'Synthetic label is inside the screenshot viewport');
      };
      await labelFixture();
      await assertCaptureState();
      await page.screenshot({path: `outputs/chat-redesign-${stage}-${suffix}.png`, fullPage});
      await assertCaptureState();
    };

    assert.equal(await panelOpen(), true, 'First launch exposes connection setup');
    assert.equal(await page.locator('#bot-start').isDisabled(), true);
    await capture('setup');
    await page.locator('#bot-settings-close').click();
    assert.equal(await panelOpen(), false);
    await focused('bot-settings-toggle');
    await page.locator('#bot-settings-toggle').click();
    assert.equal(await panelOpen(), true);
    await focused('bot-settings-close');
    await page.keyboard.press('Escape');
    assert.equal(await panelOpen(), false);
    await focused('bot-settings-toggle');

    const conversation = [
      {id: 'intro-user', role: 'user', text: '帮我检查项目的启动说明，告诉我还缺哪些步骤。'},
      {id: 'intro-reply', role: 'assistant', text: '可以。我会先核对安装环境、依赖和启动命令，再把需要补充的地方列给你。'},
      {id: 'follow-user', role: 'user', text: '先列出问题，等我确认再改。'},
      {id: 'follow-reply', role: 'assistant', text: '好，先给你检查结果。需要修改时，我会说明具体改动，再等你确认。'},
    ];
    await fixture({messages: conversation});
    assert.equal(await panelOpen(), false, 'Connected state initially closes setup');
    assert.equal(await page.locator('#bot-messages time').count(), 0, 'Native messages have no invented timestamps');
    assert.equal(await page.locator('#bot-mascot').getAttribute('class'), 'scene idle', 'Forwarding does not imply native execution');
    await page.waitForFunction(() => [...document.querySelectorAll('#bot-mascot img, .message-avatar')].length === 3 &&
      [...document.querySelectorAll('#bot-mascot img, .message-avatar')].every(image => image.complete && image.naturalWidth > 0));
    await page.locator('#bot-settings-toggle').click();
    await fixture({messages: conversation});
    assert.equal(await panelOpen(), true, 'A poll must preserve manually opened setup');
    await page.locator('#bot-settings-close').click();

    await page.locator('.message-copy').first().click();
    // This is the first clipboard read: the preceding action wrote our fixture.
    assert.equal(await app.evaluate(({clipboard}) => clipboard.readText()), conversation[1].text);
    const rejected = await page.evaluate(async () => {
      const results = [];
      for (const value of [42, 'x'.repeat(32769)]) {
        try { await window.arcade.copyText(value); results.push(false); } catch { results.push(true); }
      }
      return results;
    });
    assert.deepEqual(rejected, [true, true], 'Clipboard IPC rejects non-string and oversized input');
    await page.locator('#toast').waitFor({state: 'hidden'});
    await capture('conversation');

    // Stub only this isolated app's lifecycle IPC. Clicking these controls must
    // never launch or stop a real Claude process during renderer acceptance.
    await app.evaluate(({ipcMain}) => {
      global.__nativeUiCalls=[];
      for(const [channel,method] of [['arcade:botNativeStart','start'],['arcade:botNativeStop','stop'],['arcade:botDisconnect','disconnect']]) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel,(_event,value)=>{global.__nativeUiCalls.push({method,...(value===undefined?{}:{value})});return {synthetic:true};});
      }
    });
    const nativeCalls=()=>app.evaluate(()=>global.__nativeUiCalls);
    const launchFixture={command:'claude [synthetic launch command]',attached:false,process:{status:'idle',owned:false,canResume:false}};
    await fixture({messages:conversation,native:launchFixture});
    await page.locator('#bot-settings-toggle').click();
    await page.locator('#bot-native-open').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#bot-native-open').textContent(),'打开 Claude');
    assert.equal(await page.locator('#bot-native-open').isEnabled(),true);
    assert.equal(await page.locator('#bot-native-halt').isVisible(),false);
    assert.equal(await page.locator('#bot-native-new').isVisible(),false);
    assert.equal(await page.locator('#bot-native-copy').isEnabled(),true,'Manual command remains a fallback');
    await page.locator('#bot-native-open').click();
    assert.deepEqual(await nativeCalls(),[{method:'start',value:{resume:false}}]);
    await capture('native-ready');
    await fixture({messages:conversation,native:{...launchFixture,attached:true,process:{status:'running',owned:true,canResume:false}}});
    assert.equal(await page.locator('#bot-native-open').isVisible(),false);
    assert.equal(await page.locator('#bot-native-halt').isEnabled(),true);
    await page.locator('#bot-native-halt').click();
    assert.deepEqual((await nativeCalls()).at(-1),{method:'stop'});
    await capture('native-running');
    await fixture({messages:conversation,native:{...launchFixture,attached:true,process:{status:'running',owned:true,canResume:false,busy:true}}});
    assert.equal(await page.locator('#bot-native-halt').isDisabled(),true,'Repeated stop is unavailable while lifecycle work is pending');
    await fixture({messages:conversation,native:{...launchFixture,command:'',process:{status:'stopped',owned:false,canResume:true}}});
    assert.equal(await page.locator('#bot-native-open').textContent(),'恢复上次会话');
    assert.equal(await page.locator('#bot-native-open').isEnabled(),true);
    assert.equal(await page.locator('#bot-native-new').isEnabled(),true);
    assert.equal(await page.locator('#bot-native-copy').isDisabled(),true,'A stopped relay cannot copy its revoked launch command');
    assert.equal(await page.locator('#bot-native-command-label').isVisible(),false,'No empty manual command disclosure remains after revocation');
    assert.match(await page.locator('#bot-native-process-note').textContent(),/独立后台作业未确认/);
    await page.locator('#bot-native-open').click();
    assert.deepEqual((await nativeCalls()).at(-1),{method:'start',value:{resume:true}});
    await page.locator('#bot-native-new').click();
    assert.deepEqual((await nativeCalls()).at(-1),{method:'start',value:{resume:false}},'Starting fresh is an explicit alternative to resuming');
    await capture('native-stopped');
    await fixture({messages:conversation,language:'en',compact:true,native:{...launchFixture,command:'',process:{status:'stopped',owned:false,canResume:true}}});
    await size(430,720);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Native lifecycle controls fit a compact viewport');
    await capture('native-compact');
    await size(1280,820);
    await fixture({messages:conversation,native:{...launchFixture,attached:true,process:{status:'running',owned:false,canResume:false}}});
    assert.equal(await page.locator('#bot-native-halt').isVisible(),false,'A manually launched CLI has no app-owned stop button');
    assert.equal(await page.locator('#bot-native-open').isDisabled(),true,'An attached manual CLI must not be launched again');
    await page.locator('#bot-settings-close').click();
    await page.locator('#bot-stop').click();
    assert.deepEqual((await nativeCalls()).at(-1),{method:'disconnect'},'Disconnect remains separate from stopping execution');

    const actualAt = Date.parse('2026-11-04T01:00:00+11:00');
    await fixture({mode: 'api', messages: [{id: 'dated', role: 'assistant', text: 'Synthetic API message with supplied timestamp.', at: actualAt}]});
    assert.equal(await page.locator('#bot-messages time').count(), 1);
    assert.equal(await page.locator('#bot-messages time').getAttribute('datetime'), new Date(actualAt).toISOString());

    const hostile = '<img src=x onerror="window.__chatFixtureExecuted=true"><script>window.__chatFixtureExecuted=true</script>';
    const longMessages = Array.from({length: 14}, (_, index) => ({
      id: `long-${index}`, role: index % 2 ? 'assistant' : 'user',
      text: `合成样例 ${index + 1} / Synthetic message ${index + 1}\n` +
        '长消息用于检查阅读位置和自动换行。This is a renderer-only sample, with no task executed. '.repeat(6) +
        (index === 1 ? `\n${hostile}\n` + 'unbroken-'.repeat(90) : ''),
    }));
    await fixture({messages: longMessages});
    assert.equal(await page.locator('.message-body script, .message-body img').count(), 0);
    assert.equal(await page.evaluate(() => window.__chatFixtureExecuted), undefined);
    assert((await page.locator('.message-body').nth(1).textContent()).includes(hostile));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#bot-thread-scroll').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    assert.equal(await page.locator('#bot-thread-scroll').evaluate(node => node.scrollHeight > node.clientHeight), true);

    const firstRow = await page.locator('.bot-message').first().elementHandle();
    const readingPosition = await page.locator('#bot-thread-scroll').evaluate(node => {
      node.scrollTop = 160;
      node.dispatchEvent(new Event('scroll'));
      return node.scrollTop;
    });
    const appended = [...longMessages, {id: 'new-arrival', role: 'assistant', text: '合成样例：这是一条新消息。旧消息的阅读位置应保留。'}];
    await fixture({messages: appended});
    assert.equal(await firstRow.evaluate(node => node === document.querySelector('.bot-message')), true, 'Existing message DOM identity is preserved');
    assert(Math.abs(await page.locator('#bot-thread-scroll').evaluate(node => node.scrollTop) - readingPosition) <= 1, 'New messages must not move the reader');
    assert.equal(await page.locator('#bot-latest').isVisible(), true);
    await page.locator('#bot-latest').click();
    assert.equal(await page.locator('#bot-thread-scroll').evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight < 2), true);
    assert.equal(await page.locator('#bot-latest').isVisible(), false);
    await firstRow.dispose();

    await fixture({messages: conversation, language: 'en', compact: true});
    await size(430, 720);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Compact viewport has no horizontal overflow');
    assert.equal(await page.locator('#bot-thread-scroll').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await capture('compact');
    await page.locator('#bot-settings-toggle').click();
    assert.equal(await panelOpen(), true);
    await page.locator('#bot-mode').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#bot-mode').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await capture('compact-settings');
    await page.locator('#bot-settings-close').click();
    await focused('bot-settings-toggle');

    await fixture({messages: conversation});
    await size(1280, 820);
    await page.locator('nav [data-view="connections"]').click();
    await page.locator('#connections-view').waitFor();
    const planned = ['feishu', 'messenger', 'x', 'doubao', 'gemini'];
    const implemented = ['claude', 'gpt', 'deepseek'];
    for (const id of planned) {
      const row = page.locator(`.connection-item[data-connection="${id}"]`);
      assert.equal(await row.locator('button').count(), 0, `${id} is a plan, with no misleading action`);
      assert.equal(await row.locator('.availability.planned').count(), 1);
    }
    assert.deepEqual(await page.locator('.partner-choice').evaluateAll(rows => rows.map(row => row.dataset.provider)), implemented);
    for (const id of ['wechat','qq']) assert.equal(await page.locator(`[data-onboard-channel="${id}"]`).count(), 1);
    await page.locator('#onboarding-appearance summary').click();

    const modeBeforePortrait = await page.evaluate(async () => (await window.arcade.snapshot()).bot.mode);
    await page.evaluate(() => window.arcade.configure({portrait: 'pixel'}));
    assert.equal(await page.evaluate(async () => (await window.arcade.snapshot()).config.portrait), 'pixel');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).portrait, 'pixel');
    await fixture({messages: conversation, portrait: 'pixel'});
    assert.equal(await page.locator('.portrait-choice[data-portrait="pixel"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#bot-mascot img, .message-avatar').count(), 0);
    assert.equal(await page.locator('#bot-mascot svg.robot').count(), 1);
    assert.equal(await page.evaluate(async () => (await window.arcade.snapshot()).bot.mode), modeBeforePortrait);

    await page.evaluate(() => window.arcade.configure({portrait: 'anime'}));
    assert.equal(await page.evaluate(async () => (await window.arcade.snapshot()).config.portrait), 'anime');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).portrait, 'anime');
    await fixture({messages: conversation, portrait: 'anime'});
    await page.waitForFunction(() => {
      const image = document.querySelector('.portrait-choice[data-portrait="anime"] img');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.locator('.portrait-choice[data-portrait="anime"]').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.arcade.configure({portrait: 'https://example.invalid/untrusted-portrait.png'}));
    assert.equal(await page.evaluate(async () => (await window.arcade.snapshot()).config.portrait), 'anime', 'Unknown portraits do not become persisted resource paths');
    assert.equal(await page.evaluate(async () => (await window.arcade.snapshot()).bot.mode), modeBeforePortrait, 'Appearance never changes execution mode');
    assert.equal(await page.locator('img').evaluateAll(images => images.every(image => !/^https?:/i.test(image.getAttribute('src') || ''))), true);
    await capture('connections', true);

    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, [], 'The UI fixture must not make external requests');
    const receipt = {stage, ui: 'passed', synthetic: true, liveWeChat: false, liveModel: false,
      setupFocusAndPolling: true, screenshotStateCheckedBeforeAndAfter: true, realTimestampsOnly: true, messageTextEscaped: true,
      clipboardRoundTrip: true, clipboardBounds: true, messageNodePreserved: true,
      readingPositionPreserved: true, latestMessageNavigation: true, compactNoHorizontalOverflow: true,
      localPortraitLoaded: true, portraitPersisted: true, unknownPortraitIgnored: true,
      appearancePreservesExecutionMode: true, plannedConnectionsHaveNoActions: true,
      nativeLifecycleControls: 'start/resume/stop IPC fixture; busy and unowned states guarded; disconnect remains separate',
      viewportChecks: [[1280, 820], [430, 720]], limitations: 'Renderer fixtures do not establish live delivery, native execution, or task success.'};
    fs.writeFileSync(`outputs/chat-redesign-${stage}.json`, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } finally {
    await app.close();
    const resolved = path.resolve(root), temp = path.resolve(os.tmpdir()) + path.sep;
    assert(resolved.startsWith(temp) && path.basename(resolved).startsWith('arcade-chat-ui-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
