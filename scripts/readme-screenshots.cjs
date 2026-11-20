'use strict';
// Render public documentation from production UI files with synthetic IPC only.
// No Electron, user profile, credential store, provider or external network.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/images');
const receiptPath = path.join(root, 'outputs/readme-media/receipt.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputs = new Map();
const read = file => {
  const bytes = fs.readFileSync(file);
  inputs.set(path.relative(root, file).split(path.sep).join('/'), hash(bytes));
  return bytes;
};
// Reuse the established isolated renderer fixture, rather than inventing a
// second UI implementation or reading a running application's saved state.
const fixtureFile = path.join(root, 'scripts/companion-switcher-ui-smoke.cjs');
const raw = read(fixtureFile).toString();
const marker = 'await page.addInitScript(({catalog,settings})=>{';
const start = raw.indexOf(marker), end = raw.indexOf('  },{catalog,settings:', start);
assert(start >= 0 && end > start, 'Renderer fixture boundaries changed');
const fixture = raw.slice(start + marker.length, end);
const catalog = require('../src/core/personas.cjs').publicCatalog();
const settings = require('../src/bot/st/local-settings.cjs').defaults();

async function main() {
  fs.mkdirSync(output, {recursive: true});
  fs.mkdirSync(path.dirname(receiptPath), {recursive: true});
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.ARCADE_HEADLESS_BROWSER || (fs.existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({headless: true, executablePath});
  const receipt = {
    schema: 'readme-media/1', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    productionRenderer: true, syntheticData: true, realModel: false,
    ownerProfileRead: false, credentialStoreRead: false, passed: false,
    viewport: {width: 1280, height: 900}, images: [], errors: [], externalRequests: [],
  };
  try {
    for (const language of ['zh', 'en']) {
      const page = await browser.newPage({viewport: receipt.viewport, deviceScaleFactor: 1});
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => receipt.errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:41279') {
          receipt.externalRequests.push(url.origin);
          return route.abort();
        }
        const relative = url.pathname === '/' ? 'src/ui/index.html' :
          url.pathname.startsWith('/assets/') ? 'src' + url.pathname : 'src/ui' + url.pathname;
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
        const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' :
          file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : undefined;
        return route.fulfill({body: read(file), contentType});
      });
      await page.addInitScript({content: 'const catalog=' + JSON.stringify(catalog) + ',settings=' + JSON.stringify(settings) + ';' + fixture});
      await page.addInitScript(({language}) => {
        const f = window.pickerFixture;
        f.base.config.language = language;
        f.base.config.appearance = 'dark';
        f.roles.primary = 'deepseek-whale';
        f.mediaView = 'chat';
        const publish = f.publish;
        f.publish = () => {
          // The fixture's original publisher notifies listeners. Build its
          // snapshot without notifying, then deliver one complete media state.
          const listeners = f.listeners;
          f.listeners = [];
          const s = publish();
          f.listeners = listeners;
          const zh = language === 'zh';
          s.config.appearance = 'dark';
          s.appearance = {preference: 'dark', colorScheme: 'dark'};
          s.accounts.accounts[0].name = zh ? '演示档案' : 'Demo profile';
          s.accounts.accounts[0].mode = 'deepseek';
          s.bot.mode = 'deepseek';
          s.bot.hasKey = f.mediaView !== 'first-run';
          s.bot.credentialState = 'ready';
          s.bot.social.config.name = zh ? '鲸鱼娘' : 'Whale Girl';
          s.bot.local.available = f.mediaView !== 'first-run';
          s.bot.local.state = s.bot.local.available ? 'active' : 'stopped';
          s.bot.local.history = f.mediaView === 'first-run' ? [] : [
            {id: 'demo-question', role: 'user', text: zh ? '演示对话：今天有点累，想聊点轻松的。' : 'Demo conversation: I am a little tired today. Can we keep things light?', at: 1795000000000},
            {id: 'demo-answer', role: 'assistant', text: zh ? '演示回复：那今天先慢下来吧。泡杯不加糖的茶，坐一会儿。\n想说说今天的小事，还是一起想想周末去哪儿散步？' : 'Demo reply: Let us slow down for a moment. Make a cup of tea without sugar and take a seat.\nWould you like to talk about today, or think of somewhere to walk this weekend?', at: 1795000001000, swipeCount: 1, swipeIndex: 0},
          ];
          s.bot.local.memory = {id: 'demo-memory', memoryId: 'demo-memory', available: true, reason: null, facts: [
            {id: 'demo-tea', revision: 1, text: zh ? '演示记忆：喝茶不加糖。' : 'Demo memory: prefers tea without sugar.', updatedAt: 1795000000000, sourceIds: []},
            {id: 'demo-walk', revision: 1, text: zh ? '演示记忆：周末喜欢去公园散步。' : 'Demo memory: enjoys walking in the park at weekends.', updatedAt: 1795000000000, sourceIds: []},
          ]};
          s.desktopChat = {kind: 'local', available: s.bot.local.available};
          f.snapshot = s;
          for (const fn of listeners) fn(structuredClone(s));
          return structuredClone(s);
        };
        window.arcade.initialAppearance = {preference: 'dark', colorScheme: 'dark'};
        window.arcade.desktopLocalMemory = async () => ({ok: false, code: 'documentation_only'});
      }, {language});
      await page.goto('http://127.0.0.1:41279/', {waitUntil: 'networkidle'});
      await page.evaluate(() => {pickerFixture.publish(); switchView('bot');});
      await page.locator('#desktop-chat-input').waitFor();
      const capture = async name => {
        await page.evaluate(async () => {
          window.scrollTo(0, 0);
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const file = path.join(output, name + '-' + language + '.png');
        await page.screenshot({path: file, fullPage: name === 'memory', animations: 'disabled'});
        receipt.images.push({path: path.relative(root, file), sha256: hash(fs.readFileSync(file))});
      };
      await capture('companion-chat');
      await page.evaluate(() => switchView('relationship'));
      await page.getByText(language === 'zh' ? '演示记忆：喝茶不加糖。' : 'Demo memory: prefers tea without sugar.', {exact: true}).waitFor();
      await capture('memory');
      await page.evaluate(() => {pickerFixture.mediaView = 'first-run'; pickerFixture.publish(); switchView('bot');});
      await page.locator('#first-run-card').waitFor();
      await capture('first-run');
      await page.close();
    }
    assert.deepEqual(receipt.errors, []);
    assert.deepEqual(receipt.externalRequests, []);
    assert([...inputs].every(([file, digest]) => hash(fs.readFileSync(path.join(root, file))) === digest));
    receipt.inputs = [...inputs].map(([file, sha256]) => ({path: file, sha256}));
    receipt.passed = true;
  } finally {
    await browser.close();
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  console.log(JSON.stringify({passed: receipt.passed, images: receipt.images.length, inputs: inputs.size}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
