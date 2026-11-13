'use strict';
// Production companion renderer/CSS with synthetic settings and IPC only.
// No QQ, microphone, speech model, external message or real configuration is used.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs');
  fs.mkdirSync(out, { recursive: true });
  const prefix = 'qq-inbound-voice-formal-20261106';
  const receipt = { kind: 'synthetic-qq-inbound-voice-settings-ui', synthetic: true,
    source: 'src/ui/social.js and production CSS', liveAccounts: false, microphone: false,
    modelsStarted: 0, externalMessages: 0, checks: [], screenshots: [] };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:/, route => route.abort());
    await page.setContent('<!doctype html><html lang="zh-CN"><body><main><p id="fixture-mark">合成 UI · 无真实账号、语音模型或消息</p><section id="connections-view" class="view"><div id="connections-content" class="onboarding-shell"><div id="onboarding-appearance"></div></div></section></main></body></html>');
    for (const file of ['style.css', 'companions.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'src/ui', file), 'utf8') });
    const portraits = ['claude-ju', 'deepseek-whale'].map(id => `data:image/png;base64,${fs.readFileSync(path.join(root, `src/ui/portraits/${id}-anime-v2.png`)).toString('base64')}`);
    await page.evaluate(portraits => {
      window.data = null;
      window.$ = id => document.getElementById(id);
      window.el = (tag, cls = '', text) => { const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node; };
      window.fixtureCalls = [];
      const config = { enabled: true, characterId: 'claude-ju', name: '橘', description: '合成测试用公开人设。', notes: '', proactiveMessages: false, qzonePosts: false, activeStart: 9, activeEnd: 22, intervalMinutes: 180, maxMessagesPerDay: 2, maxPostsPerDay: 1 };
      window.fixtureProfiles = {
        ju: { status: 'disconnected', channel: 'qq', mode: 'api', social: { supported: true, memoryReady: true, active: false, config } },
        whale: { status: 'disconnected', channel: 'qq', mode: 'deepseek', social: { supported: true, memoryReady: true, active: false, config: { ...config, characterId: 'deepseek-whale', name: '鲸鱼娘', qqVoiceMessages: true } } }
      };
      window.fixtureState = { config: { language: 'zh' }, accounts: { selectedId: 'ju' }, personas: [
        { id: 'claude-ju', name: { zh: '橘', en: 'Ju' }, description: { zh: '合成测试人设', en: 'Synthetic persona' }, portrait: portraits[0] },
        { id: 'deepseek-whale', name: { zh: '鲸鱼娘', en: 'Whale' }, description: { zh: '合成测试人设', en: 'Synthetic persona' }, portrait: portraits[1] }
      ] };
      window.fixtureRender = () => {
        window.fixtureState.bot = structuredClone(window.fixtureProfiles[window.fixtureState.accounts.selectedId]);
        window.renderSocial(window.fixtureState.bot, structuredClone(window.fixtureState));
      };
      window.arcade = { socialConfigure: async value => {
        const id = window.fixtureState.accounts.selectedId;
        window.fixtureCalls.push({ method: 'socialConfigure', id, value: structuredClone(value) });
        window.fixtureProfiles[id].social.config = structuredClone(value);
        return structuredClone({ ...window.fixtureState, bot: window.fixtureProfiles[id] });
      } };
    }, portraits);
    await page.addScriptTag({ path: path.join(root, 'src/ui/social.js') });
    const render = () => page.evaluate(() => window.fixtureRender());
    const toggle = page.locator('#social-qqVoiceMessages');
    const calls = () => page.evaluate(() => window.fixtureCalls);
    const check = text => receipt.checks.push(text);
    const shot = async name => {
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('main').scrollTop = 0; });
      const file = path.join(out, `${prefix}-${name}.png`);
      await page.screenshot({ path: file }); receipt.screenshots.push(file);
    };
    const save = async () => {
      await page.locator('#social-save').click();
      await page.waitForFunction(() => /已保存|Saved for/.test(document.getElementById('social-operation').textContent));
    };
    const bounded = async () => {
      assert.equal(await page.evaluate(() => {
        const row = document.getElementById('social-qqVoiceMessages').closest('.social-toggle-row');
        const box = row.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth + 1 && row.scrollWidth <= row.clientWidth + 1 && box.left >= 0 && box.right <= innerWidth + 1;
      }), true);
    };

    await render(); await page.locator('#social-panel > summary').click();
    assert.equal(await toggle.isChecked(), false); assert.equal(await toggle.isDisabled(), false);
    assert.deepEqual(await calls(), []); check('An older saved configuration without qqVoiceMessages defaults off; opening settings calls no API.');
    const zhNote = await toggle.locator('xpath=ancestor::div[contains(@class,"social-toggle-row")]').innerText();
    for (const text of ['本机 Qwen', '最长 30 秒', '文字回复', '转写内容会交给所选 AI', '不用于发布、授权或修改记忆', '默认关闭']) assert(zhNote.includes(text));
    check('Chinese copy states local Qwen, owner-private 30-second audio, text replies, model disclosure, command restrictions and default off.');
    await shot('default-zh-wide');

    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.isChecked(), true); assert.deepEqual(await calls(), []);
    assert.match(await page.locator('#social-operation').innerText(), /未保存/);
    await render(); assert.equal(await toggle.isChecked(), true);
    check('Keyboard changes only the draft; ordinary snapshots retain the draft without configuring or starting anything.');
    await save(); assert.equal((await calls()).length, 1); assert.equal((await calls())[0].value.qqVoiceMessages, true);
    assert.equal((await calls())[0].id, 'ju'); assert.equal(await toggle.isChecked(), true);
    check('Explicit Save sends qqVoiceMessages:true in the existing socialConfigure payload and displays the saved state.');
    await toggle.uncheck(); assert.equal((await calls()).length, 1); await save();
    assert.equal((await calls()).length, 2); assert.equal((await calls())[1].value.qqVoiceMessages, false);
    check('Disabling also requires Save and submits the boolean false; no separate recognition or model call exists in the fixture.');

    await toggle.check();
    await page.evaluate(() => { window.fixtureState.accounts.selectedId = 'whale'; window.fixtureRender(); });
    assert.equal(await toggle.isChecked(), true); assert.equal(await page.locator('#social-name').inputValue(), '鲸鱼娘');
    await toggle.uncheck();
    await page.evaluate(() => { window.fixtureState.accounts.selectedId = 'ju'; window.fixtureRender(); });
    assert.equal(await toggle.isChecked(), false); assert.equal(await page.locator('#social-name').inputValue(), '橘');
    await page.evaluate(() => { window.fixtureState.accounts.selectedId = 'whale'; window.fixtureRender(); });
    assert.equal(await toggle.isChecked(), true); assert.equal((await calls()).length, 2);
    check('Switching accounts discards each unsaved voice toggle and restores the selected profile’s saved setting without API calls.');

    for (const status of ['connecting', 'connected']) {
      await page.evaluate(status => { window.fixtureProfiles.whale.status = status; window.fixtureRender(); }, status);
      assert.equal(await toggle.isDisabled(), true); assert.equal(await page.locator('#social-save').isDisabled(), true);
    }
    assert.match(await page.locator('.social-notice').innerText(), /请先断开/);
    await shot('connected-zh-wide');
    check('Connecting and connected states disable both the opt-in and Save, with an explicit disconnect-to-edit instruction.');
    await page.evaluate(() => { window.fixtureProfiles.whale.status = 'disconnected'; window.fixtureRender(); });
    assert.equal(await toggle.isDisabled(), false);
    check('After disconnection, the saved setting becomes editable again.');

    await page.setViewportSize({ width: 430, height: 900 }); await bounded(); await shot('zh-430');
    check('The Chinese opt-in and its complete long disclosure wrap within a 430 CSS-pixel window.');
    await page.evaluate(() => { window.fixtureState.config.language = 'en'; document.documentElement.lang = 'en'; document.getElementById('fixture-mark').textContent = 'Synthetic UI · no account, speech model or message'; window.fixtureRender(); });
    const enNote = await toggle.locator('xpath=ancestor::div[contains(@class,"social-toggle-row")]').innerText();
    for (const text of ['local Qwen model', 'up to 30 seconds', 'text replies', 'selected AI', 'without triggering posts, approvals or memory commands', 'Off by default']) assert(enNote.includes(text));
    await bounded(); await shot('en-430');
    await page.setViewportSize({ width: 320, height: 900 }); await bounded(); await shot('en-320');
    check('English preserves the same limits and command boundary at 430 and 320 CSS pixels without horizontal overflow.');
    assert.equal(await toggle.isChecked(), true); assert.equal((await calls()).length, 2);
    check('Language and viewport changes preserve the selected account’s setting without saving it again.');

    for (const change of [{ channel: 'wechat', mode: 'api' }, { channel: 'qq', mode: 'codex' }]) {
      await page.evaluate(change => { Object.assign(window.fixtureProfiles.whale, change); window.fixtureRender(); }, change);
      assert.equal(await toggle.isDisabled(), true); assert.equal(await page.locator('#social-save').isDisabled(), true);
    }
    check('The voice opt-in follows the existing QQ companion/backend gate and remains disabled for WeChat or Codex dispatch mode.');
    assert.deepEqual(errors, []); receipt.passed = true;
  } catch (error) { receipt.passed = false; receipt.error = error.stack || String(error); throw error; }
  finally {
    receipt.capturedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, `${prefix}-ui.json`), JSON.stringify(receipt, null, 2) + '\n');
    await browser.close();
  }
  console.log(JSON.stringify({ passed: receipt.passed, checks: receipt.checks.length, screenshots: receipt.screenshots.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
