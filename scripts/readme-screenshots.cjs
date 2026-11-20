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
const [sourceArg, archiveArg] = process.argv.slice(2);
const archive = sourceArg === '--asar' && archiveArg ? path.resolve(archiveArg) : null;
assert(sourceArg !== '--asar' || archive, 'Usage: readme-screenshots.cjs --asar /path/to/app.asar');
const source = archive ? root : path.resolve(sourceArg || root);
const asar = archive ? require('@electron/asar') : null;
const hasRendererFile = archive
  ? file => {
      try { return Number.isInteger(asar.statFile(archive, file).size); } catch { return false; }
    }
  : file => fs.existsSync(path.join(source, file)) && fs.statSync(path.join(source, file)).isFile();
const readRendererFile = archive
  ? file => asar.extractFile(archive, file)
  : file => fs.readFileSync(path.join(source, file));
const packageMetadata = JSON.parse(readRendererFile('package.json'));
const {version: packageVersion, buildSourceCommit} = packageMetadata;
const sourceCommit = archive
  ? buildSourceCommit
  : execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8'}).trim();
assert.match(sourceCommit, /^[0-9a-f]{40}$/);
const macPreview = hasRendererFile('src/ui/qq-mac-setup.js');
const preview = /-preview\.(\d+)$/.exec(packageVersion);
assert(preview, 'Expected a preview source checkout');
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src', 'package.json', 'scripts/companion-switcher-ui-smoke.cjs'], {cwd: source});
const output = path.join(root, 'docs/images', 'preview' + preview[1]);
const receiptPath = path.join(root, 'outputs/readme-media/receipt.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = archive ? hash(fs.readFileSync(archive)) : null;
const inputs = new Map();
const read = (file, readFile = readRendererFile) => {
  const bytes = readFile(file);
  inputs.set(file, {sha256: hash(bytes), readFile});
  return bytes;
};
// Reuse the established isolated renderer fixture, rather than inventing a
// second UI implementation or reading a running application's saved state.
const fixtureFile = 'scripts/companion-switcher-ui-smoke.cjs';
const raw = read(fixtureFile, file => fs.readFileSync(path.join(source, file))).toString();
const marker = 'await page.addInitScript(({catalog,settings})=>{';
const start = raw.indexOf(marker), end = raw.indexOf('  },{catalog,settings:', start);
assert(start >= 0 && end > start, 'Renderer fixture boundaries changed');
const fixture = raw.slice(start + marker.length, end);
const catalog = require(path.join(source, 'src/core/personas.cjs')).publicCatalog();
const settings = require(path.join(source, 'src/bot/st/local-settings.cjs')).defaults();

async function main() {
  fs.mkdirSync(output, {recursive: true});
  fs.mkdirSync(path.dirname(receiptPath), {recursive: true});
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.ARCADE_HEADLESS_BROWSER || (fs.existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({headless: true, executablePath});
  const receipt = {
    schema: 'readme-media/2', sourceCommit, packageVersion, archiveSha256,
    productionRenderer: true, syntheticData: true, realModel: false, browser: browser.version(),
    ownerProfileRead: false, credentialStoreRead: false, passed: false,
    viewport: {width: 1160, height: 760}, macViewport: {width: 1160, height: 1080}, images: [], errors: [], externalRequests: [],
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
        if (path.posix.normalize(relative) !== relative || !hasRendererFile(relative)) return route.abort();
        const file = relative;
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
        const settingsByView = {
          chat: {layout: 'immersive', appearance: 'dark'},
          memory: {layout: 'minimal', appearance: 'day'},
          'first-run': {layout: 'messenger', appearance: 'day'},
          'mac-qq': {layout: 'messenger', appearance: 'day'},
        };
        const publish = f.publish;
        f.publish = () => {
          // The fixture's original publisher notifies listeners. Build its
          // snapshot without notifying, then deliver one complete media state.
          const listeners = f.listeners;
          f.listeners = [];
          const s = publish();
          f.listeners = listeners;
          const zh = language === 'zh';
          const {layout, appearance} = settingsByView[f.mediaView];
          s.config = {...s.config, layout, appearance};
          s.appearance = {preference: appearance, colorScheme: appearance === 'day' ? 'light' : 'dark'};
          s.accounts.accounts[0].name = zh ? '演示档案' : 'Demo profile';
          s.accounts.accounts[0].mode = 'deepseek';
          s.bot.mode = 'deepseek';
          if (f.mediaView === 'mac-qq') {
            s.accounts.accounts[0].channel = 'qq';
            s.bot.channel = 'qq';
            s.bot.qq = {url: '', ownerId: '', hasToken: false, groups: {enabled: false, groupIds: []}};
          }
          s.bot.hasKey = f.mediaView !== 'first-run';
          s.bot.credentialState = 'ready';
          s.bot.social.config.name = zh ? '鲸鱼娘' : 'Whale Girl';
          s.bot.local.available = f.mediaView !== 'first-run';
          s.bot.local.state = s.bot.local.available ? 'active' : 'stopped';
          s.bot.local.history = f.mediaView === 'first-run' ? [] : [
            {id: 'demo-question', role: 'user', text: zh ? '演示：周六想去看海，能按我喜欢的方式安排个半天吗？' : 'Demo: I’d like to go to the coast on Saturday. Can you plan a half day around the things I enjoy?', at: 1795000000000},
            {id: 'demo-answer', role: 'assistant', text: zh ? '演示回复：早一点沿海边走走，顺路拍几张照片。中午找家安静的咖啡馆，带上你那本还没读完的书。' : 'Demo reply: Take an early walk by the water and stop for a few photos. Around noon, find a quiet café and bring the book you’re halfway through.', at: 1795000001000, swipeCount: 1, swipeIndex: 0},
          ];
          s.bot.local.memory = {id: 'demo-memory', memoryId: 'demo-memory', available: true, reason: null, facts: [
            {id: 'demo-cafe', revision: 1, text: zh ? '演示记忆：喜欢在安静的咖啡馆读书。' : 'Demo memory: likes reading in quiet cafés.', updatedAt: 1795000000000, sourceIds: []},
            {id: 'demo-walk', revision: 1, text: zh ? '演示记忆：喜欢沿海散步和拍照。' : 'Demo memory: enjoys coastal walks and taking photos.', updatedAt: 1795000000000, sourceIds: []},
          ]};
          s.desktopChat = {kind: 'local', available: s.bot.local.available};
          f.snapshot = s;
          for (const fn of listeners) fn(structuredClone(s));
          return structuredClone(s);
        };
        window.arcade.initialAppearance = {preference: 'dark', colorScheme: 'dark'};
        window.arcade.desktopLocalMemory = async () => ({ok: false, code: 'documentation_only'});
        window.arcade.botQQMacInspect = async () => ({
          ok: true, ticketId: '99c2bc36-fa5b-468b-a5a3-d13df18a5067', release: '8.3.2',
          nodeVersion: 'v24.13.0', filesChecked: 4, warning: null, recommendedPort: 3002,
        });
        window.arcade.botQQMacOpenRelease = window.arcade.botQQMacPrepare =
          async () => ({ok: false, code: 'documentation_only'});
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
        await page.screenshot({path: file, fullPage: ['memory', 'mac-qq'].includes(name), animations: 'disabled'});
        const {layout, appearance} = await page.evaluate(() => pickerFixture.snapshot.config);
        receipt.images.push({path: path.relative(root, file), sha256: hash(fs.readFileSync(file)), layout, appearance});
      };
      await capture('companion-chat');
      await page.locator('#imm-companion-toggle').click();
      await page.locator('#companion-builtin-persona').waitFor();
      await capture('companion-switcher');
      await page.locator('#imm-companion-toggle').click();
      await page.evaluate(() => {pickerFixture.mediaView = 'memory'; pickerFixture.publish(); switchView('relationship');});
      await page.waitForFunction(() => document.documentElement.dataset.layout === 'minimal');
      await page.getByText(language === 'zh' ? '演示记忆：喜欢在安静的咖啡馆读书。' : 'Demo memory: likes reading in quiet cafés.', {exact: true}).waitFor();
      await capture('memory');
      await page.evaluate(() => {pickerFixture.mediaView = 'first-run'; pickerFixture.publish(); switchView('bot');});
      await page.waitForFunction(() => document.documentElement.dataset.layout === 'messenger');
      await page.locator('#first-run-save').waitFor();
      const gpt = page.locator('.first-run-choice[data-provider="gpt"]');
      await gpt.click();
      assert.equal(await page.locator('#first-run-key').inputValue(), '');
      await capture('first-run');
      if (macPreview) {
        await page.setViewportSize(receipt.macViewport);
        await page.evaluate(() => {pickerFixture.mediaView = 'mac-qq'; pickerFixture.publish(); switchView('connections');});
        const optional = page.locator('#onboarding-optional-toggle');
        if (await optional.isVisible() && await optional.getAttribute('aria-expanded') === 'false') await optional.click();
        await page.locator('#onboarding-qq-groups').click();
        await page.locator('#bot-qq-mac-first > summary').click();
        await page.locator('#bot-qq-mac-inspect').click();
        const suggestion = page.locator('#bot-qq-mac-port-suggestion').filter({hasText: '3002'});
        await suggestion.waitFor();
        await suggestion.scrollIntoViewIfNeeded();
        assert((await suggestion.boundingBox()).y < receipt.macViewport.height - 25);
        assert.equal(await page.locator('#bot-qq-mac-port').inputValue(), '3002');
        assert.equal(await page.locator('#bot-qq-mac-account').inputValue(), '');
        await capture('mac-qq');
      }
      await page.close();
    }
    assert.deepEqual(receipt.errors, []);
    assert.deepEqual(receipt.externalRequests, []);
    assert([...inputs].every(([file, {sha256, readFile}]) => hash(readFile(file)) === sha256));
    receipt.inputs = [...inputs].map(([file, {sha256}]) => ({path: file, sha256}));
    receipt.passed = true;
  } finally {
    await browser.close();
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
  console.log(JSON.stringify({passed: receipt.passed, images: receipt.images.length, inputs: inputs.size}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
