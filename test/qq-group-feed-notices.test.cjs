'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {AccountManager} = require('../src/bot/account-manager.cjs');
const {BotService} = require('../src/bot/service.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {Bus} = require('../src/core/bus.cjs');
const {createDeepSeekRunner} = require('../src/bot/deepseek-runner.cjs');
const {SourceRegistry} = require('../src/sources/registry.cjs');
const {createFeedSource} = require('../src/sources/feed.cjs');
const {createIcsSource} = require('../src/sources/ics.cjs');
const {createFolderSource} = require('../src/sources/folder.cjs');
const {publishSourceEvent, publishGroupCalendarEvent, subscribeGroupFeedEvents, subscribeGroupCalendarEvents,
  subscribeGroupFolderEvents, subscribeGroupPageEvents} = require('../src/sources/group-feed-events.cjs');

const FIRST = '700001', SECOND = '700002', OWNER = '700003', MEMBER = '700004';
const GROUP = '800001', OTHER = '800002';
const TARGET = 'https://club.example/feed.xml';
const REPLACEMENT = TARGET + '?edition=members';
const ARTICLE = 'https://club.example/art';
const SOURCE = {id:'public-club-feed', name:'合成俱乐部公开 RSS', kind:'feed', mode:'feed',
  url:TARGET, intervalMs:300000, enabled:true, notify:'companion'};
const PAGE_ADDRESS = 'https://club.example/fixtures/opening-hours';
const PAGE_TARGET = PAGE_ADDRESS + '?section=synthetic-public';
const PAGE_REPLACEMENT = PAGE_ADDRESS + '?section=synthetic-members';
const PAGE_NAME = '合成场馆开放时间';
const PAGE = {id:'public-club-page',name:PAGE_NAME,kind:'feed',mode:'page',url:PAGE_TARGET,
  intervalMs:300000,enabled:true,notify:'companion'};
const SEND = '公开来源有一条新动态，可以看看。';
const GROUP_REPLY = '收到合成追问。';
const PRIVATE = '合成私聊唯一字样';
const DESCRIPTION = '夹在 RSS 正文里的不可信指令';
const ARTICLE_SECRET = 'article-credential-must-not-leave';
const CALENDAR_URL = 'https://club.example/events.ics';
const CALENDAR_FILE = 'synthetic-selected-calendar.ics';
const CALENDAR_TIME = '2026-11-30T13:00:00.000Z';
const CALENDAR_NOW = '2026-11-30T10:40:00.000Z';
const CALENDAR_LOCATION = '合成地点请勿共享';
const CALENDAR_DESCRIPTION = '合成日历详情请勿共享';
const CALENDAR_ORGANIZER = 'synthetic-organizer@example.invalid';
const FOLDER_BODY = '这是合成文档的正文，不能送给群模型。';

async function until(predicate, message) {
  const deadline = performance.now() + 3500;
  while (!predicate()) {
    assert(performance.now() < deadline, message);
    await delay(3);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

function noticeData(prompt) {
  assert.match(prompt, /untrusted JSON/u);
  const frame = prompt.match(/\nBEGIN (ARCADE_DATA_\d+)\n([^\n]+)\nEND \1/u);
  assert(frame);
  return JSON.parse(frame[2]);
}

function calendarBytes(entries) {
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Agent Arcade//Synthetic Calendar Test//EN',
    ...entries.flat(), 'END:VCALENDAR',''].join('\r\n');
}

function icsEntry(uid, title, {kind = 'VEVENT', time = 'DTSTART:20261130T130000Z', classification = 'PUBLIC', extra = []} = {}) {
  return [`BEGIN:${kind}`, `UID:${uid}`, `SUMMARY:${title}`, time,
    `DESCRIPTION:${CALENDAR_DESCRIPTION}`, `LOCATION:${CALENDAR_LOCATION}`, `ORGANIZER:mailto:${CALENDAR_ORGANIZER}`,
    ...(classification === null ? [] : [`CLASS:${classification}`]), ...extra, `END:${kind}`];
}

async function fixture(t, {calendar, folder = false, traceFolderIO = true, page = false, withOtherSources = false,
  startAt = calendar ? CALENDAR_NOW : '2026-12-01T03:00:00Z'} = {}) {
  t.mock.timers.enable({apis:['Date'], now:Date.parse(startAt)});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qq-public-source-'));
  const calendarFile = path.join(root, CALENDAR_FILE);
  const folderDirectory = path.join(root, 'synthetic-selected-folder');
  const calendarSource = {id:'public-club-calendar', name:'合成俱乐部公开日历', kind:'ics',
    ...(calendar === 'remote' ? {url:CALENDAR_URL} : {file:calendarFile}), timeZone:'Australia/Sydney',
    leadMinutes:120, enabled:true, notify:'companion'};
  const folderSource = {id:'public-club-folder', name:'合成俱乐部的资料目录', kind:'folder',
    dir:folderDirectory, intervalMs:5000, enabled:true, notify:'companion'};
  const initialSource = calendar ? calendarSource : folder ? folderSource : page ? PAGE : SOURCE;
  const otherSources = withOtherSources ? [SOURCE,calendarSource,folderSource] : [];
  const sockets = [], sent = [], actions = [], wire = [], events = [], groupOnlyCalendar = [], requests = [], folderIO = [], managers = [], holds = [];
  const pages = new Map([[TARGET, []], [REPLACEMENT, []]]);
  const htmlPages = new Map([[PAGE_TARGET,'旧网页合成内容'],[PAGE_REPLACEMENT,'替换网页合成基线']]);
  const settings = {receipt:'accepted', hold:null, feedText:SEND};
  let registry, bus, manager, stopGroup, stopCalendar, stopFolder, stopPage, stopPrivate;
  let nextReceipt = 9000, nextInbound = 500, config = initialSource;
  const writePage = text => {assert(htmlPages.has(config.url));htmlPages.set(config.url,text);};
  let remoteCalendar = calendarBytes([]);
  const writeCalendar = entries => {
    const content = calendarBytes(entries);
    if (calendar === 'remote') remoteCalendar = content;
    else fs.writeFileSync(calendarFile, content);
  };
  if (calendar || withOtherSources) writeCalendar([]);
  if (folder || withOtherSources) fs.mkdirSync(folderDirectory);

  class Bridge extends EventEmitter {
    constructor(account) {
      super();
      this.account = account;
      this.readyState = 0;
      sockets.push(this);
      queueMicrotask(() => {this.readyState = 1;this.emit('open');});
    }
    frame(value) {this.emit('message', JSON.stringify(value), false);}
    send(raw, callback) {
      const {action, params, echo} = JSON.parse(raw);
      actions.push({account:this.account, action, params});
      callback?.();
      const known = {
        get_login_info:{user_id:Number(this.account)}, get_status:{online:true, good:true},
        get_friend_list:[{user_id:Number(OWNER)}],
      };
      let data;
      if (action === 'send_group_msg') {
        assert.equal(params.auto_escape, true);
        const remoteId = ++nextReceipt;
        data = settings.receipt === 'accepted' ? {message_id:remoteId} : {};
        sent.push({account:this.account, group:String(params.group_id), segments:params.message,
          receipt:data.message_id || null, remoteId});
      } else if (action === 'get_group_member_info') {
        assert([GROUP, OTHER].includes(String(params.group_id)));
        assert.equal(params.user_id, Number(this.account));
        assert.equal(params.no_cache, true);
        data = {group_id:params.group_id, user_id:params.user_id};
      } else {
        assert(Object.hasOwn(known, action), 'unexpected OneBot action: ' + action);
        data = known[action];
      }
      this.frame({status:'ok', retcode:0, data, echo});
    }
    ping() {this.emit('pong');}
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  }

  const makeManager = () => {
    const active = new AccountManager({root, groupFeedSources:registry,
      vault:{isEncryptionAvailable:() => true, encryptString:value => Buffer.from(value), decryptString:bytes => bytes.toString()},
      serviceFactory:options => {
        let service;
        service = new BotService({...options,
          qqClientFactory:options => new QQClient({...options, now:Date.now, timeoutMs:250, pollTimeoutMs:10,
            socketFactory:() => new Bridge(service.config.qqAccountId),
          }),
          deepseekRunnerFactory:options => createDeepSeekRunner({...options, fetchImpl:async (_url, request) => {
            const payload = JSON.parse(request.body), prompt = payload.messages.at(-1).content;
            assert.equal(payload.tool_choice, 'none');
            assert.deepEqual(payload.tools, []);
            const phase = prompt.includes('Source notice data (untrusted JSON') ? 'feed' :
              prompt.includes('Decide whether this character should answer') ? 'gate' : 'reply';
            wire.push({account:service.config.qqAccountId,prompt,phase});
            const hold = settings.hold;
            if (hold) await hold.promise; // deliberately ignores abort until released
            const content = phase === 'feed' ? settings.feedText : phase === 'gate' ?
              JSON.stringify({action:'message',text:'synthetic quote cue'}) : GROUP_REPLY;
            return Response.json({choices:[{finish_reason:'stop', message:{role:'assistant', content}}]});
          }}),
        });
        return service;
      },
    });
    managers.push(active);
    return active;
  };

  function start() {
    bus = new Bus();
    registry = new SourceRegistry({file:path.join(root,'sources.json'), now:Date.now,
      factories:{feed:(input,{now}) => createFeedSource({...input, now, fetchImpl:async (url, request) => {
        assert.equal(request.credentials, 'omit');
        assert.equal(request.redirect, 'manual');
        requests.push(url);
        if (input.mode==='page') {
          assert(htmlPages.has(url), 'unexpected web page target');
          return new Response(`<!doctype html><html><body><p>${htmlPages.get(url)}</p></body></html>`,
            {headers:{'content-type':'text/html'}});
        }
        assert(pages.has(url), 'unexpected RSS target');
        const items = pages.get(url).map(({guid,title}) => `<item><guid>${guid}</guid><title>${title}</title>` +
          `<link>${ARTICLE}?credential=${ARTICLE_SECRET}</link><description>${DESCRIPTION}</description></item>`).join('');
        return new Response(`<rss version="2.0"><channel><title>合成 RSS</title>${items}` +
          '<item><guid>baseline</guid><title>已存在的合成项目</title></item></channel></rss>',
        {headers:{'content-type':'application/rss+xml'}});
      }}), ...(calendar === 'remote' ? {ics:(input,{now}) => createIcsSource({...input,now,fetchImpl:async (url,request) => {
        assert.equal(url, CALENDAR_URL);
        assert.equal(request.credentials, 'omit');
        assert.equal(request.redirect, 'manual');
        requests.push(url);
        return new Response(remoteCalendar, {headers:{'content-type':'text/calendar'}});
      }})} : {}), ...(folder && traceFolderIO ? {folder:(input,{now}) => createFolderSource({...input,now,captureGroupRoot:true,fsImpl:{
        readdir:(target,options) => {folderIO.push({operation:'readdir',target});return fs.promises.readdir(target,options);},
        lstat:target => {folderIO.push({operation:'lstat',target});return fs.promises.lstat(target);},
      }})} : {})},
      publish:(event, source, identity, occurrence) => {
        events.push({event, source, identity, occurrence});
        return publishSourceEvent(bus, event, source, identity, occurrence);
      },
      publishCalendar:(occurrence,source,identity,at) => {
        groupOnlyCalendar.push({occurrence,identity,at});
        return publishGroupCalendarEvent(bus,source,identity,occurrence,at);
      },
    });
    manager = makeManager();
    const listeners = {registry,services:() => manager.services.values(),active:() => true};
    stopGroup = subscribeGroupFeedEvents(bus, listeners);
    if (calendar || withOtherSources) stopCalendar = subscribeGroupCalendarEvents(bus, listeners);
    if (folder || withOtherSources) stopFolder = subscribeGroupFolderEvents(bus, listeners);
    if (page) stopPage = subscribeGroupPageEvents(bus, listeners);
    stopPrivate = bus.subscribe(event => ['companion','both'].includes(event.notify), event => manager.current().companionNotice(event));
  }

  t.after(async () => {
    for (const hold of holds) hold.resolve();
    stopPrivate?.();stopGroup?.();stopCalendar?.();stopFolder?.();stopPage?.();registry?.close();
    for (const item of managers) await item.close();
    assert(sockets.every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive:true, force:true});
  });

  start();
  registry.configure([config,...otherSources]);
  const primary = manager.selectedId;
  const profiles = new Map([[FIRST, primary]]);
  for (const [account, port] of [[FIRST,3001], [SECOND,3002]]) {
    const service = account === FIRST ? manager.current() : manager.add({name:'第二个合成本机档案'});
    profiles.set(account, manager.selectedId);
    service.configure({channel:'qq', mode:'deepseek', key:'synthetic-qq-feed-model-key', qqAccountId:account,
      qqOwnerId:OWNER, qqUrl:'ws://127.0.0.1:'+port, qqToken:'synthetic-qq-feed-bridge-token',
      qqGroups:{enabled:true, groupIds:[GROUP, OTHER], proactive:true},
    });
    service.socialConfigure({enabled:true, proactiveMessages:true, activeStart:0, activeEnd:24,
      intervalMinutes:30, maxMessagesPerDay:10, qzonePosts:false,
    });
  }
  const serviceFor = account => manager.get(profiles.get(account));
  const connect = async () => {
    for (const [account, profile] of profiles) {
      const result = await manager.connect(profile);
      assert.equal(result.status, 'connected', result.problem);
      assert.equal(result.qq.check.accountId, account);
      serviceFor(account).groupRoute.flow = {debounceMs:0,bubbleDelayMs:0};
    }
  };
  await connect();
  assert.equal(manager.current(), serviceFor(SECOND));
  const warm = serviceFor(FIRST);
  warm.socialStore.append(warm.socialScope, {role:'user', text:PRIVATE});
  const advance = minutes => t.mock.timers.setTime(Date.now() + minutes * 60000);
  const poll = async (minutes = calendar ? 1 : 40) => {
    advance(minutes);
    registry.tick();
    const enabled = () => registry.snapshot().filter(entry=>entry.enabled);
    await until(() => {
      const finished = enabled().every(entry=>entry.lastCheckedAt===Date.now());
      if (!finished) registry.tick();
      return finished;
    }, 'source poll did not finish');
    for (const entry of enabled()) assert.equal(entry.lastError,null);
  };
  const add = async (guid, title) => {pages.get(config.url).unshift({guid,title});await poll();};
  const source = () => {
    if (calendar) return registry.groupCalendar(initialSource.id);
    if (folder) return registry.groupFolder(initialSource.id);
    if (page) return registry.groupPage(initialSource.id);
    return registry.groupFeed(initialSource.id);
  };
  const setGrant = enabled => {
    const service = serviceFor(FIRST);
    const identity = source().identity;
    assert.equal(typeof identity, 'string');
    const binding = {expectedAccountId:FIRST, groupId:GROUP, roleId:service.groupRoute.characterFor(GROUP),
      sourceId:initialSource.id, identity, enabled};
    if (calendar) return service.groupCalendarSet(binding);
    if (folder) return service.groupFolderSet(binding);
    if (page) return service.groupPageSet(binding);
    return service.groupFeedSet(binding);
  };
  const grantOtherSources = () => {
    const service = serviceFor(FIRST), roleId = service.groupRoute.characterFor(OTHER);
    const binding = source => ({expectedAccountId:FIRST,groupId:OTHER,roleId,sourceId:source.id,identity:source.identity,enabled:true});
    service.groupFeedSet(binding(registry.groupFeed(SOURCE.id)));
    service.groupCalendarSet(binding(registry.groupCalendar(calendarSource.id)));
    service.groupFolderSet(binding(registry.groupFolder(folderSource.id)));
  };
  const tick = () => Promise.all([FIRST, SECOND].map(account => serviceFor(account).groupFeedTick()));
  const quote = async (group, target, text) => {
    const first = wire.length, id = ++nextInbound;
    const bridge = sockets.findLast(socket => socket.account === FIRST && socket.readyState === 1);
    bridge.frame({post_type:'message', message_type:'group', sub_type:'normal', self_id:Number(FIRST),
      user_id:Number(MEMBER), sender:{user_id:Number(MEMBER), nickname:'合成读者'}, group_id:Number(group),
      time:Math.floor(Date.now() / 1000), message_id:id, message:[{type:'reply',data:{id:target,user_id:FIRST}},
        {type:'text',data:{text}}],
    });
    await until(() => wire.length >= first + 2, 'native quote did not reach gate and formal reply');
    await serviceFor(FIRST).groupRoute.actor(group,MEMBER).engine.whenIdle();
    assert.equal(wire.length, first + 2);
    assert.deepEqual(wire.slice(first).map(call => call.phase), ['gate','reply']);
    assert.deepEqual(sent.at(-1).segments, [{type:'reply',data:{id:String(id)}},{type:'text',data:{text:GROUP_REPLY}}]);
    return wire.slice(first).map(call => call.prompt);
  };
  const replay = item => publishSourceEvent(bus, item.event, item.source, item.identity, item.occurrence);
  const reopen = async () => {
    stopPrivate();stopGroup();stopCalendar?.();stopFolder?.();stopPage?.();registry.close();
    await manager.close();
    start();registry.load();
    await connect();
  };
  const configure = patch => {config = {...initialSource,...patch};registry.configure([config,...otherSources]);};
  const hold = () => {
    const current = deferred();holds.push(current);settings.hold = current;
    return () => {settings.hold = null;current.resolve();};
  };
  const noticeState = (account = FIRST) => serviceFor(account).snapshot().qq.groups[
    calendar?'calendarNotices':folder?'folderNotices':page?'pageNotices':'feedNotices'];
  const recorded = (account = FIRST) => serviceFor(account).groupRoute.journal.snapshot()
    .channelDelivery.map(item => item.state).sort();
  return {poll, add, source, setGrant, grantOtherSources, tick, quote, replay, reopen, configure, hold, noticeState, writeCalendar, writePage,
    recorded, serviceFor, events, groupOnlyCalendar, wire, sent, actions, requests, folderDirectory, folderIO, settings};
}

test('an explicit public RSS grant uses one exact QQ profile and group, sanitized model data, and durable send receipts', async t => {
  const f = await fixture(t);
  await f.poll();
  assert.deepEqual(f.events, []);
  await f.add('unapproved', '没有批准时只进原提醒流程');
  await f.tick();
  assert.equal(f.events.length, 1);
  assert.deepEqual([f.wire.length, f.sent.length], [0,0]);
  assert.equal(f.noticeState().binding, null);
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, 1);

  await f.setGrant(true);
  const identity = f.source().identity;
  const {binding} = f.noticeState();
  assert.deepEqual([binding.groupId,binding.roleId,binding.sourceId,binding.identity,binding.status],
    [GROUP,f.serviceFor(FIRST).groupRoute.characterFor(GROUP),SOURCE.id,identity,'ready']);
  assert.equal(f.noticeState(SECOND).binding, null);
  const safeTitle = '公开周末画展';
  await f.add('public-art',safeTitle);
  await f.tick();
  assert.deepEqual(f.wire.map(call => call.account), [FIRST]);
  assert.deepEqual(noticeData(f.wire[0].prompt), {title:safeTitle});
  for (const excluded of [DESCRIPTION,ARTICLE_SECRET,ARTICLE,TARGET,PRIVATE,FIRST,SECOND,OWNER,GROUP,OTHER,
    'synthetic-qq-feed-model-key','public-art']) {
    assert(!f.wire[0].prompt.includes(excluded), 'not permitted in RSS prompt: ' + excluded);
  }
  assert.equal(f.sent.length, 1);
  assert.deepEqual([f.sent[0].account,f.sent[0].group,f.sent[0].segments],
    [FIRST,GROUP,[{type:'text',data:{text:SEND}}]]);
  assert.equal(f.noticeState().lastOutcome, 'accepted');
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, 2);
  assert(f.actions.some(({action,account,params}) => action === 'get_group_member_info' && account === FIRST &&
    String(params.group_id) === GROUP && params.no_cache === true));
  const accepted = f.events.at(-1);

  f.configure({notify:'none'});
  assert.equal(f.source().identity, identity);
  f.settings.receipt = 'missing';
  await f.add('unknown', '合成回执不明');
  await f.tick();
  const uncertain = f.events.at(-1);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].receipt, null);
  assert.equal(f.noticeState().lastOutcome, 'unknown');
  assert.deepEqual(f.recorded(), ['accepted','unknown']);
  assert.deepEqual(f.recorded(SECOND), []);
  assert.equal(f.serviceFor(FIRST).groupRoute.rhythm(GROUP).state.attempts.length, 2);
  assert.deepEqual(f.serviceFor(FIRST).groupRoute.rhythm(OTHER).state.attempts, []);
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, 2);
  f.replay(uncertain);
  await f.tick();
  assert.equal(f.sent.length, 2);

  await f.reopen();
  assert.equal(f.source().identity, identity);
  await f.poll();
  assert.equal(f.events.length, 3, 'cold poll must keep the RSS cursor');
  f.replay(accepted);f.replay(uncertain);
  assert.equal(f.noticeState().pending, 0, 'the durable journal must reject duplicate queue entries');
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [2,2], 'fresh bus must not resurrect either attempted item');
  assert.deepEqual(f.recorded(), ['accepted','unknown']);
  f.settings.receipt = 'accepted';
  await f.add('fresh-after-reopen','冷启动后自然到达的新项目');
  await f.tick();
  const originalEditionItem = f.events.at(-1);
  assert.deepEqual([f.wire.length,f.sent.length], [3,3], 'a genuinely new item still reaches the saved destination');
  assert.deepEqual([f.sent.at(-1).account,f.sent.at(-1).group], [FIRST,GROUP]);
  assert.equal(f.noticeState().lastOutcome, 'accepted');

  f.configure({url:REPLACEMENT});
  await f.poll();
  await f.add('public-art', '同路径但查询不同的替换源');
  await f.add('replacement-unique','替换源的全新项目');
  await f.tick();
  assert(f.requests.includes(REPLACEMENT));
  assert.equal(f.noticeState().binding.status, 'source_changed');
  assert.equal(f.events.at(-2).event.id, accepted.event.id, 'display subject and logical item id still collide');
  assert.notEqual(f.events.at(-1).identity, identity);
  assert.deepEqual([f.wire.length,f.sent.length], [3,3]);

  await f.setGrant(true);
  assert.equal(f.noticeState().binding.status, 'ready');
  assert.equal(f.noticeState().pending, 0, 'new approval does not backfill seen items');
  const existingPrivate = f.serviceFor(SECOND).companionNoticeStatus().pending;
  const replacementTitle = '另一个已批准订阅的新项目';
  await f.add('fresh-after-reopen',replacementTitle);
  const replacementEditionItem = f.events.at(-1);
  assert.equal(replacementEditionItem.event.id, originalEditionItem.event.id);
  assert.notEqual(replacementEditionItem.identity, originalEditionItem.identity);
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, existingPrivate,
    'original private notifier keeps its old event dedup key');
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [4,4]);
  assert(f.wire.at(-1).prompt.includes(replacementTitle));
  assert.deepEqual([f.sent.at(-1).account,f.sent.at(-1).group], [FIRST,GROUP]);
  const published = f.events.length;
  await f.add('fresh-after-reopen','同一个替换订阅项目重复出现');
  f.replay(replacementEditionItem);
  await f.tick();
  assert.deepEqual([f.events.length,f.wire.length,f.sent.length], [published,4,4]);
});

test('only an accepted native feed receipt can resolve the public quote in its own group', async t => {
  const f = await fixture(t);
  await f.poll();
  await f.setGrant(true);
  const acceptedText = '经过群确认的画展通知。';
  f.settings.feedText = acceptedText;
  await f.add('accepted-to-quote','合成画展条目');
  await f.tick();
  assert.equal(f.noticeState().lastOutcome, 'accepted');
  const {receipt:acceptedId} = f.sent.at(-1);
  assert(Number.isInteger(acceptedId));

  const unconfirmedText = '回执不明的另一条合成通知。';
  f.settings.feedText = unconfirmedText;
  f.settings.receipt = 'missing';
  await f.add('unknown-to-quote','合成美术馆条目');
  await f.tick();
  assert.equal(f.noticeState().lastOutcome, 'unknown');
  const {remoteId:unconfirmedId, receipt} = f.sent.at(-1);
  assert.equal(receipt, null);
  f.settings.receipt = 'accepted';

  const question = '接着刚才那条说。';
  for (const [group, target, expectedReference, expectedText] of [[GROUP,acceptedId,'self',acceptedText],
    [OTHER,acceptedId,'unknown',null],[GROUP,unconfirmedId,'unknown',null]]) {
    const prompts = await f.quote(group,target,question);
    for (const prompt of prompts) {
      const addressing = prompt.split('\n').find(line => line.startsWith('Group addressing from the bridge'));
      assert(addressing);
      assert.deepEqual(JSON.parse(addressing.split(' Data: ')[1]), [[0,question.length,[],expectedReference]]);
      const targets = prompt.split('\n').find(line => line.startsWith('Observed quote targets '));
      if (expectedText) {
        assert(targets);
        assert.deepEqual(JSON.parse(targets.slice(targets.indexOf(': [') + 2)), [{row:0,speaker:'self',text:expectedText}]);
      } else assert.equal(targets, undefined);
      assert(!prompt.includes(String(target)) && !prompt.includes(unconfirmedText));
      if (group === OTHER) assert(!prompt.includes(acceptedText));
    }
  }
  assert.deepEqual(f.recorded(), ['accepted','unknown']);
});

test('revoking the saved group grant or disabling the saved feed blocks a model response already in flight', async t => {
  const f = await fixture(t);
  await f.poll();
  await f.setGrant(true);
  for (const [guid,title,retire] of [
    ['revoked','生成期间撤销群授权',() => f.setGrant(false)],
    ['disabled','生成期间停用源',() => f.configure({enabled:false})],
  ]) {
    const resume = f.hold(), count = f.wire.length;
    await f.add(guid,title);
    const run = f.tick();
    await until(() => f.wire.length > count, 'model did not begin the notice');
    const call = f.wire.at(-1);
    assert(call.prompt.includes(title));
    await retire();
    if (guid === 'revoked') assert.equal(f.noticeState().binding, null);
    else assert.equal(f.noticeState().binding.status, 'source_disabled');
    resume();
    await run;
    assert.deepEqual(f.sent, [], 'retired notice cannot submit a group message');
    if (guid === 'revoked') await f.setGrant(true);
  }
  f.configure({enabled:true});
  await f.poll();
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [2,0]);
  assert.deepEqual(f.recorded(), []);
  assert.deepEqual(f.serviceFor(FIRST).groupRoute.rhythm(GROUP).state.attempts, []);
});

test('ordinary numeric dates keep their exact text while paths, URLs and query strings stay out of group notices', async t => {
  const f = await fixture(t);
  await f.poll();
  await f.setGrant(true);
  const dates = [['bare-date','11/21','11/21'],
    ['gallery-date','11/21 周末水彩展开放报名','11/21 开放报名，想去的可以留意。']];
  for (const [index,[id,title,answer]] of dates.entries()) {
    f.settings.feedText = answer;
    await f.add(id,title);
    await f.tick();
    assert.equal(f.wire.length, index + 1, `public numeric date did not reach model: ${title}`);
    assert.deepEqual(noticeData(f.wire.at(-1).prompt), {title});
    assert.deepEqual(f.sent.at(-1).segments, [{type:'text',data:{text:answer}}]);
    assert.equal(f.noticeState().lastOutcome, 'accepted');
  }
  assert.deepEqual([f.wire.length,f.sent.length], [2,2]);

  for (const [id,title] of [['path-title','11/21 内部档案 /private/synthetic/attendees.md'],
    ['url-title','11/21 内部入口 https://club.example/11/21'],['query-title','11/21 报名信息 ?session=synthetic']]) {
    await f.add(id,title);
    await f.tick();
    assert.equal(f.events.at(-1).event.title, title);
    assert.equal(f.noticeState().pending, 0);
    assert.deepEqual([f.wire.length,f.sent.length], [2,2]);
  }

  f.settings.feedText = '11/21 访问 https://club.example/11/21?session=synthetic';
  await f.add('unsafe-answer','11/21 另一个正常公开项目');
  await f.tick();
  assert.equal(f.noticeState().lastOutcome, 'failed');
  assert.deepEqual([f.wire.length,f.sent.length], [3,2]);
  assert.deepEqual(f.recorded(), ['accepted','accepted']);
});

test('the selected ordinary QQ group gets only explicitly public calendar events with authoritative local display times', async t => {
  const f = await fixture(t, {calendar:'local'});
  const unapproved = icsEntry('unguarded-owner-only','只进原提醒渠道的合成日历活动',{time:'DTSTART:20261130T124500Z'});
  f.writeCalendar([unapproved]);
  await f.poll(6);
  assert.equal(f.events.length, 1);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [0,0]);
  assert.equal(f.noticeState().binding, null);
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, 1);

  await f.setGrant(true);
  const identity = f.source().identity;
  const {binding} = f.noticeState();
  assert.deepEqual([binding.groupId,binding.roleId,binding.identity,binding.status],
    [GROUP,f.serviceFor(FIRST).groupRoute.characterFor(GROUP),identity,'ready']);
  assert.equal(f.noticeState(SECOND).binding, null);

  const publicRows = [
    {uid:'all-day',title:'悉尼全天展览',time:'DTSTART;VALUE=DATE:20261201',localTime:'2026-12-01',
      timeZone:'Australia/Sydney',allDay:true,line:'活动日期 2026-12-01（全天，Australia/Sydney）'},
    {uid:'local-midnight',title:'悉尼午夜朗读',time:'DTSTART;TZID=Australia/Sydney:20261201T000000',localTime:'2026-12-01T00:00:00',
      timeZone:'Australia/Sydney',allDay:false,line:'活动时间 2026-12-01 00:00:00（Australia/Sydney）'},
    {uid:'ny-local',title:'纽约晨读',time:'DTSTART;TZID=America/New_York:20261130T080000',localTime:'2026-11-30T08:00:00',
      timeZone:'America/New_York',allDay:false,line:'活动时间 2026-11-30 08:00:00（America/New_York）'},
    {uid:'utc-event',title:'国际直播',time:'DTSTART:20261130T130000Z',localTime:'2026-11-30T13:00:00',
      timeZone:'UTC',allDay:false,line:'活动时间 2026-11-30 13:00:00（UTC）'},
  ];
  const ownerOnly = [
    icsEntry('private-only','原提醒私有事件',{classification:'PRIVATE'}),
    icsEntry('confidential-only','原提醒保密事件',{classification:'CONFIDENTIAL'}),
    icsEntry('class-missing','原提醒缺分类事件',{classification:null}),
    icsEntry('class-unknown','原提醒未知分类事件',{classification:'X-UNKNOWN'}),
    icsEntry('public-todo','原提醒公开待办',{kind:'VTODO',time:'DUE:20261130T130000Z'}),
  ];
  const publicEntries = publicRows.map(({uid,title,time}) => icsEntry(uid,title,{time}));
  f.writeCalendar([unapproved,...ownerOnly,publicEntries[0]]);
  await f.poll(15);
  assert.equal(f.events.length, 2 + ownerOnly.length);
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, f.events.length);
  const start = Date.parse(CALENDAR_TIME);
  for (const forbidden of ownerOnly) {
    const title = forbidden.find(line => line.startsWith('SUMMARY:')).slice(8);
    assert(f.events.some(({event}) => event.title === title));
  }
  for (const [index,{uid,title,localTime,timeZone,allDay,line}] of publicRows.entries()) {
    if (index) {
      // Observe each new instance after the group pacing interval, inside
      // the same time window and before its own short reminder lifetime.
      f.writeCalendar([unapproved,...ownerOnly,...publicEntries.slice(0,index+1)]);
      await f.poll(31);
    }
    assert.equal(f.noticeState().pending, 1);
    await f.tick();
    const {event} = f.events.find(item => item.event.title === title);
    assert.equal(event.kind, 'calendar.upcoming');
    assert.equal(event.detail, CALENDAR_TIME);
    assert.deepEqual(event.data, {start,allDay});
    const call = f.wire.at(-1);
    assert.equal(call.account, FIRST);
    assert.deepEqual(noticeData(call.prompt), {title,start,localTime,timeZone,allDay});
    for (const excluded of [uid,CALENDAR_FILE,CALENDAR_LOCATION,CALENDAR_DESCRIPTION,CALENDAR_ORGANIZER,PRIVATE,FIRST,SECOND,GROUP,OTHER]) {
      assert(!call.prompt.includes(excluded), 'private calendar or group field reached the model: ' + excluded);
    }
    assert.deepEqual([f.sent.at(-1).account,f.sent.at(-1).group,f.sent.at(-1).segments],
      [FIRST,GROUP,[{type:'text',data:{text:`${SEND}\n${line}`}}]]);
    assert.equal(f.noticeState().lastOutcome, 'accepted');
  }
  assert.deepEqual([f.wire.length,f.sent.length], [4,4]);
  assert.equal(f.events.length, 1 + ownerOnly.length + publicRows.length);
  const published = f.events.length;
  await f.reopen();
  assert.equal(f.source().identity, identity);
  await f.poll();
  assert.equal(f.events.length, published, 'owner cursor must survive a real service reopen');
  f.events.forEach(f.replay);
  assert.equal(f.noticeState().pending, 0, 'old calendar events cannot requeue on a fresh bus');
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [4,4]);
  assert.deepEqual(f.recorded(), Array(4).fill('accepted'));
  assert.deepEqual(f.recorded(SECOND), []);
});

test('fresh local calendar reads retire queued cancelled, private, removed and renamed occurrences behind the old owner cursor', async t => {
  const f = await fixture(t, {calendar:'local'});
  await f.setGrant(true);
  const before = [['will-cancel','待取消的公开活动'],['will-hide','待私有的公开活动'],
    ['will-remove','待删除的公开活动'],['will-rename','待改名的公开活动']];
  f.writeCalendar(before.map(([uid,title]) => icsEntry(uid,title)));
  await f.poll(21);
  assert.equal(f.noticeState().pending, 4);
  assert.equal(f.events.length, 4);

  f.writeCalendar([icsEntry(...before[0],{extra:['STATUS:CANCELLED']}),
    icsEntry(...before[1],{classification:'PRIVATE'}),icsEntry(before[3][0],'同一预约已改名')]);
  await f.poll();
  assert.deepEqual(f.events.map(({event}) => event.title), before.map(([,title]) => title), 'legacy reminder cursor does not renotify edits');
  for (let i=0;i<before.length;i++) await f.tick();
  assert.deepEqual([f.noticeState().pending,f.wire.length,f.sent.length], [0,0,0]);
  assert.deepEqual(f.recorded(), []);

  const control = '全新且仍公开的活动';
  f.writeCalendar([icsEntry('new-control',control)]);
  await f.poll();
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [1,1]);
  assert.equal(noticeData(f.wire[0].prompt).title, control);
  assert.equal(f.noticeState().lastOutcome, 'accepted');
});

test('a refreshed HTTPS calendar and explicit revocation suppress held calendar model output before OneBot submission', async t => {
  const f = await fixture(t, {calendar:'remote'});
  await f.setGrant(true);
  const originalTitle = '将转为私有的合成公开活动';
  f.writeCalendar([icsEntry('held-public',originalTitle)]);
  await f.poll(21);
  const releasePrivate = f.hold();
  const originalRun = f.tick();
  await until(() => f.wire.length === 1, 'calendar model did not begin');
  assert.equal(noticeData(f.wire[0].prompt).title, originalTitle);
  f.writeCalendar([icsEntry('held-public',originalTitle,{classification:'PRIVATE'})]);
  const before = f.requests.length;
  await f.poll(16);
  assert(f.requests.length > before, 'production HTTPS refresh must observe the new status');
  assert.equal(f.events.length, 1, 'the owner stream keeps the previously seen reminder');
  releasePrivate();
  await originalRun;
  assert.deepEqual(f.sent, []);

  const revokedTitle = '生成时撤销授权的合成活动';
  f.writeCalendar([icsEntry('held-revoke',revokedTitle)]);
  await f.poll(16);
  const releaseRevoked = f.hold();
  const revokedRun = f.tick();
  await until(() => f.wire.length === 2, 'second calendar model did not begin');
  assert.equal(noticeData(f.wire[1].prompt).title, revokedTitle);
  await f.setGrant(false);
  releaseRevoked();
  await revokedRun;
  assert.equal(f.noticeState().binding, null);
  assert.deepEqual([f.wire.length,f.sent.length], [2,0]);
  assert.deepEqual(f.recorded(), []);
  assert.deepEqual(f.serviceFor(FIRST).groupRoute.rhythm(GROUP).state.attempts, []);
});

test('a public this-and-future move corrects the third start for the owner and the authorized group', async t => {
  const f = await fixture(t, {calendar:'local',startAt:'2026-11-30T22:40:00.000Z'});
  f.configure({leadMinutes:15});
  await f.setGrant(true);
  const uid = 'synthetic-ranged-recurring-series', title = '公开连载水彩课';
  f.writeCalendar([
    icsEntry(uid,title,{time:'DTSTART;TZID=Australia/Sydney:20261201T100000',extra:['RRULE:FREQ=DAILY;COUNT=3']}),
    icsEntry(uid,title,{time:'DTSTART;TZID=Australia/Sydney:20261202T110000',
      extra:['RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Australia/Sydney:20261202T100000']}),
  ]);

  await f.poll(5);
  await f.tick();
  const first = Date.parse('2026-11-30T23:00:00.000Z');
  assert.deepEqual([f.wire.length,f.sent.length], [1,1]);
  assert.deepEqual(noticeData(f.wire[0].prompt), {title,start:first,localTime:'2026-12-01T10:00:00',
    timeZone:'Australia/Sydney',allDay:false});
  assert.deepEqual(f.sent[0].segments, [{type:'text',data:{text:`${SEND}\n活动时间 2026-12-01 10:00:00（Australia/Sydney）`}}]);
  assert.deepEqual(f.events.map(({event}) => event.data.start), [first]);
  assert.deepEqual(f.groupOnlyCalendar, []);

  await f.poll(48*60);
  assert.deepEqual(f.events.map(({event}) => event.data.start), [first], 'the old 10:00 window produces no owner event');
  const ownerPending = () => f.serviceFor(SECOND).socialStore.pendingNotices();
  assert.deepEqual(ownerPending(), []);
  assert.equal(f.noticeState().pending, 0);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [1,1]);
  assert.deepEqual(f.groupOnlyCalendar, []);

  await f.poll(57);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length,f.groupOnlyCalendar.length], [1,1,0]);
  assert.equal(f.events.length, 1);
  await f.poll(3);
  assert.equal(f.noticeState().pending, 1);
  const correctedUtc = '2026-12-03T00:00:00.000Z';
  const shifted = Date.parse(correctedUtc);
  assert.deepEqual(f.events.map(({event}) => event.data.start), [first,shifted]);
  const {event:ownerEvent,identity,occurrence} = f.events[1];
  assert.equal(ownerEvent.at, shifted - 15*60000);
  assert.equal(ownerEvent.detail, correctedUtc);
  assert.equal(identity, f.source().identity);
  assert.equal(occurrence.id, ownerEvent.id);
  assert.deepEqual(ownerPending().map(row => [row.id,JSON.parse(row.payload).detail]), [[ownerEvent.id,correctedUtc]]);
  assert.deepEqual(f.groupOnlyCalendar, []);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [2,2]);
  assert.deepEqual(noticeData(f.wire[1].prompt), {title,start:shifted,localTime:'2026-12-03T11:00:00',
    timeZone:'Australia/Sydney',allDay:false});
  assert(!f.wire[1].prompt.includes(uid));
  assert.deepEqual([f.sent[1].account,f.sent[1].group,f.sent[1].segments],
    [FIRST,GROUP,[{type:'text',data:{text:`${SEND}\n活动时间 2026-12-03 11:00:00（Australia/Sydney）`}}]]);
  assert.deepEqual(f.recorded(), ['accepted','accepted']);

  await f.reopen();
  await f.poll();
  await f.tick();
  assert.deepEqual([f.events.length,f.groupOnlyCalendar.length,f.wire.length,f.sent.length], [2,0,2,2]);
  assert.equal(f.noticeState().pending, 0);
  assert.deepEqual(ownerPending().map(row => row.id), [ownerEvent.id]);
});

test('an explicit folder grant sends only top-level file change names to the saved ordinary QQ group', async t => {
  const f = await fixture(t, {folder:true});
  const directory = f.folderDirectory;
  const nested = path.join(directory,'subdirectory');
  const sibling = path.join(path.dirname(directory),'unapproved-sibling');
  fs.mkdirSync(nested);
  fs.mkdirSync(sibling);
  const name = '周末展览时间.txt';
  const nestedName = '深层未公开的清单.txt', siblingName = '未选目录的清单.txt';
  const metadata = ['.DS_Store','._'+name];
  fs.writeFileSync(path.join(directory,'已有安排.txt'), FOLDER_BODY);
  await f.poll();
  assert.deepEqual(f.events, []);

  const unapproved = '默认只进原提醒.txt';
  fs.writeFileSync(path.join(directory,unapproved), FOLDER_BODY);
  await f.poll();
  await f.tick();
  assert.deepEqual(f.events.map(({event}) => [event.kind,event.data.name]), [['folder.added',unapproved]]);
  assert.equal(f.noticeState().binding, null);
  assert.deepEqual([f.wire.length,f.sent.length], [0,0]);
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, 1);

  await f.setGrant(true);
  const originalIdentity = f.source().identity;
  const {binding} = f.noticeState();
  assert.deepEqual([binding.groupId,binding.roleId,binding.identity,binding.status],
    [GROUP,f.serviceFor(FIRST).groupRoute.characterFor(GROUP),originalIdentity,'ready']);
  assert.equal(f.noticeState(SECOND).binding, null);
  fs.writeFileSync(path.join(nested,nestedName), FOLDER_BODY);
  fs.writeFileSync(path.join(sibling,siblingName), FOLDER_BODY);

  const watched = [...metadata,name].sort();
  const transitions = [
    ['added','新增文件',target => fs.writeFileSync(target,FOLDER_BODY)],
    ['changed','修改文件',target => fs.appendFileSync(target,'合成正文更新')],
    ['removed','移除文件',target => fs.unlinkSync(target)],
  ];
  for (const [index,[change,label,write]] of transitions.entries()) {
    const before = f.events.length;
    for (const value of watched) write(path.join(directory,value));
    await f.poll();
    assert.equal(f.noticeState().pending, 1, 'Finder metadata must not enter the group queue');
    const events = f.events.slice(before).map(({event}) => [event.kind,event.data.name]);
    assert.deepEqual(events, watched.map(value => ['folder.'+change,value]));
    if (change === 'added') {
      const {event} = f.events.find(item => item.event.data.name === name);
      assert.equal(event.data.size, Buffer.byteLength(FOLDER_BODY));
    }
    await f.tick();
    assert.deepEqual([f.wire.length,f.sent.length], [index+1,index+1]);
    const call = f.wire.at(-1), lastSend = f.sent.at(-1);
    assert.deepEqual(noticeData(call.prompt), {name,change});
    for (const excluded of [directory,sibling,nestedName,siblingName,FOLDER_BODY,PRIVATE, ...metadata]) {
      assert(!call.prompt.includes(excluded), 'unexpected private folder data in model prompt: ' + excluded);
    }
    assert.deepEqual([call.account,lastSend.account,lastSend.group,lastSend.segments],
      [FIRST,FIRST,GROUP,[{type:'text',data:{text:`${SEND}\n${label}「${name}」。`}}]]);
    assert.equal(f.noticeState().lastOutcome, 'accepted');
  }

  assert.deepEqual([...new Set(f.folderIO.map(row=>row.operation))].sort(), ['lstat','readdir']);
  assert(f.folderIO.filter(row=>row.operation==='readdir').every(row=>row.target===directory));
  assert(f.folderIO.filter(row=>row.operation==='lstat').every(row=>path.dirname(row.target)===directory));
  assert.equal(f.serviceFor(SECOND).companionNoticeStatus().pending, f.events.length);
  assert.deepEqual(f.recorded(), ['accepted','accepted','accepted']);
  assert.deepEqual(f.recorded(SECOND), []);

  const count = f.events.length;
  await f.reopen();
  assert.equal(f.source().identity, originalIdentity);
  await f.poll();
  assert.equal(f.events.length, count);
  f.events.forEach(f.replay);
  assert.equal(f.noticeState().pending, 0);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [3,3]);

  f.configure({dir:sibling});
  await f.poll();
  fs.writeFileSync(path.join(sibling,'替换目录新增.txt'), FOLDER_BODY);
  await f.poll();
  assert.equal(f.noticeState().binding.status, 'source_changed');
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [3,3]);
});

test('a wrong action in folder model prose is replaced with the exact authoritative file change', async t => {
  const f = await fixture(t, {folder:true,traceFolderIO:false});
  await f.poll();
  await f.setGrant(true);
  const name = '现场登记表.txt';
  f.settings.feedText = `文件「${name}」已移除。`;
  fs.writeFileSync(path.join(f.folderDirectory,name), FOLDER_BODY);
  await f.poll();
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [1,1]);
  assert.deepEqual(noticeData(f.wire[0].prompt), {name,change:'added'});
  assert.deepEqual([f.sent[0].account,f.sent[0].group,f.sent[0].segments],
    [FIRST,GROUP,[{type:'text',data:{text:`新增文件「${name}」。`}}]]);
  assert.equal(f.noticeState().lastOutcome,'accepted');
});

test('revoking a folder grant or switching off the folder suppresses an already generating group notice', async t => {
  const f = await fixture(t, {folder:true});
  await f.poll();
  await f.setGrant(true);
  for (const [name,retire,expected] of [
    ['生成中撤销权限.txt',() => f.setGrant(false),null],
    ['生成中停用来源.txt',() => f.configure({enabled:false}),'source_disabled'],
  ]) {
    const count = f.wire.length, resume = f.hold();
    fs.writeFileSync(path.join(f.folderDirectory,name), FOLDER_BODY);
    await f.poll();
    const run = f.tick();
    await until(() => f.wire.length > count, 'folder notice model did not start');
    assert.deepEqual(noticeData(f.wire.at(-1).prompt), {name,change:'added'});
    await retire();
    assert.equal(f.noticeState().binding?.status ?? null, expected);
    resume();
    await run;
    assert.deepEqual(f.sent, []);
    if (expected===null) await f.setGrant(true);
  }
  f.configure({enabled:true});
  await f.reopen();
  await f.poll();
  f.events.forEach(f.replay);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length,f.noticeState().pending], [2,0,0]);
  assert.deepEqual(f.recorded(), []);
});

test('a new physical folder at the same path cannot inherit an approved group destination', async t => {
  const f = await fixture(t, {folder:true,traceFolderIO:false});
  const directory = f.folderDirectory;
  const original = '已授权目录的原文件.txt';
  const queued = '刚排队还未发送.txt';
  const newRootBaseline = '替换目录预存文件.txt';
  fs.writeFileSync(path.join(directory,original), FOLDER_BODY);
  await f.poll();
  await f.setGrant(true);
  const originalIdentity = f.source().identity;
  fs.writeFileSync(path.join(directory,queued), FOLDER_BODY);
  await f.poll();
  assert.equal(f.noticeState().pending, 1);

  fs.renameSync(directory, directory+'-retired');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,newRootBaseline), FOLDER_BODY);
  const oldEvents = f.events.length;
  await f.tick();
  assert.deepEqual([f.noticeState().pending,f.wire.length,f.sent.length], [0,0,0],
    'a replaced filesystem root invalidates work before the next watch poll');

  await f.poll();
  assert.deepEqual(new Set(f.events.slice(oldEvents).map(({event}) => `${event.kind}:${event.data.name}`)),
    new Set([`folder.removed:${original}`,`folder.removed:${queued}`,`folder.added:${newRootBaseline}`]));
  const replacementIdentity = f.source().identity;
  assert.notEqual(replacementIdentity, originalIdentity);
  assert.equal(f.noticeState().binding.status, 'source_changed');
  await f.tick();
  assert.deepEqual([f.noticeState().pending,f.wire.length,f.sent.length], [0,0,0]);

  await f.setGrant(true);
  assert.equal(f.noticeState().binding.identity, replacementIdentity);
  const replacedEvents = f.events.length;
  await f.poll();
  await f.tick();
  assert.deepEqual([f.events.length,f.wire.length,f.sent.length], [replacedEvents,0,0]);

  const fresh = '重新确认之后新增.txt';
  fs.writeFileSync(path.join(directory,fresh), FOLDER_BODY);
  await f.poll();
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [1,1]);
  assert.deepEqual(noticeData(f.wire[0].prompt), {name:fresh,change:'added'});
  assert.deepEqual([f.sent[0].account,f.sent[0].group,f.sent[0].segments],
    [FIRST,GROUP,[{type:'text',data:{text:`${SEND}\n新增文件「${fresh}」。`}}]]);
  assert.deepEqual(f.recorded(), ['accepted']);
  const accepted = f.events.at(-1);

  await f.reopen();
  assert.equal(f.source().identity, replacementIdentity);
  await f.poll();
  assert.equal(f.events.length, replacedEvents+1);
  f.replay(accepted);
  await f.tick();
  assert.deepEqual([f.noticeState().pending,f.wire.length,f.sent.length], [0,1,1]);
});

test('moving the same file out and back yields distinct owner and group change occurrences across cold reopen', async t => {
  const f = await fixture(t, {folder:true,traceFolderIO:false});
  const name = '往返回来的活动安排.txt';
  const watchedFile = path.join(f.folderDirectory,name);
  const parkedFile = path.join(path.dirname(f.folderDirectory),name);
  fs.writeFileSync(parkedFile, FOLDER_BODY);
  const signature = target => {
    const {ino,size,mtimeMs} = fs.statSync(target);
    return [ino,size,mtimeMs];
  };
  const original = signature(parkedFile);
  await f.poll();
  await f.setGrant(true);

  const moves = [
    ['added',parkedFile,watchedFile,'加入共享目录'],
    ['removed',watchedFile,parkedFile,'离开共享目录'],
    ['added',parkedFile,watchedFile,'再次加入共享目录'],
  ];
  for (const [index,[change,from,to,wording]] of moves.entries()) {
    fs.renameSync(from,to);
    assert.deepEqual(signature(to), original, 'renaming must preserve the same inode, size and modification time');
    f.settings.feedText = `「${name}」${wording}。`;
    await f.poll();
    assert.equal(f.events.length,index+1);
    assert.equal(f.noticeState().pending,1);
    await f.tick();
    assert.deepEqual([f.wire.length,f.sent.length], [index+1,index+1]);
    assert.deepEqual(noticeData(f.wire.at(-1).prompt), {name,change});
    const sent = f.sent.at(-1);
    assert.deepEqual([sent.account,sent.group,sent.segments],
      [FIRST,GROUP,[{type:'text',data:{text:f.settings.feedText}}]]);
    assert.equal(f.noticeState().lastOutcome,'accepted');
    if (index===1) {
      await f.reopen();
      await f.poll();
      await f.tick();
      assert.deepEqual([f.events.length,f.wire.length,f.sent.length], [2,2,2]);
    }
  }
  const ids = f.events.map(({event}) => event.id);
  assert.equal(new Set(ids).size,3);
  const ownerIds = () => f.serviceFor(SECOND).socialStore.pendingNotices().map(row=>row.id);
  assert.deepEqual(ownerIds(),ids);
  assert.deepEqual(f.recorded(),['accepted','accepted','accepted']);

  await f.reopen();
  await f.poll();
  assert.equal(f.events.length,3);
  f.events.forEach(f.replay);
  assert.equal(f.noticeState().pending,0);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [3,3]);
  assert.deepEqual(ownerIds(),ids);
  assert.deepEqual(f.recorded(),['accepted','accepted','accepted']);
});

test('page mode preserves distinct A to B and B to A occurrences with exact grant, facts and native receipts', async t => {
  const f = await fixture(t, {page:true});
  const a = '合成 HTML 正文 A，周六开放。', b = '合成 HTML 正文 B，周日开放。';
  const invented = '它的票价降了一半，从下周开始凌晨开放。';
  const text = `网页「${PAGE_NAME}」有更新。`;
  const privateIds = () => f.serviceFor(SECOND).socialStore.pendingNotices().map(row=>row.id);
  await f.poll();
  assert.deepEqual(f.events,[]);
  f.writePage(a);
  await f.poll();
  await f.tick();
  assert.equal(f.noticeState().binding,null);
  assert.deepEqual([f.events.length,f.wire.length,f.sent.length], [1,0,0]);
  const preGrant = f.events[0];
  assert.deepEqual(privateIds(),[preGrant.event.id]);

  const identity = f.source().identity;
  const roleId = f.serviceFor(FIRST).groupRoute.characterFor(GROUP);
  const exact = {expectedAccountId:FIRST,groupId:GROUP,roleId,sourceId:PAGE.id,identity,enabled:true};
  assert.throws(() => f.serviceFor(SECOND).groupPageSet(exact), {code:'group_source_changed'});
  assert.throws(() => f.serviceFor(FIRST).groupPageSet({...exact,roleId:'unapproved-role'}), {code:'group_source_changed'});
  await f.setGrant(true);
  assert.deepEqual(f.noticeState().pages.map(({id,name})=>[id,name]), [[PAGE.id,PAGE_NAME]]);
  const {binding} = f.noticeState();
  assert.deepEqual([binding.groupId,binding.roleId,binding.sourceId,binding.identity,binding.status],
    [GROUP,roleId,PAGE.id,identity,'ready']);
  assert.equal(f.noticeState(SECOND).binding,null);

  const transitionIds = [];
  const steps = [[a,'unchanged'],[a,'unchanged'],[b,'accepted'],[a,'unknown'],[b,'accepted']];
  for (const [bytes,outcome] of steps) {
    const before = f.events.length;
    f.writePage(bytes);
    f.settings.feedText = invented;
    f.settings.receipt = outcome==='unknown'?'missing':'accepted';
    await f.poll();
    if (outcome==='unchanged') {
      await f.tick();
      assert.deepEqual([f.events.length,f.wire.length,f.sent.length], [before,0,0]);
      continue;
    }
    assert.equal(f.events.length,before+1);
    const {event} = f.events.at(-1);
    assert.equal(event.kind,'page.changed');
    assert.equal(event.subject,PAGE_ADDRESS);
    transitionIds.push(event.id);
    assert.equal(f.noticeState().pending,1);
    await f.tick();
    assert.deepEqual([f.wire.length,f.sent.length], [transitionIds.length,transitionIds.length]);
    const call = f.wire.at(-1), send = f.sent.at(-1);
    assert.deepEqual(noticeData(call.prompt), {name:PAGE_NAME});
    for (const excluded of [a,b,PAGE_ADDRESS,'synthetic-public','/fixtures/opening-hours',PRIVATE,String(event.at),FIRST,SECOND,GROUP,OTHER]) {
      assert(!call.prompt.includes(excluded), 'private page metadata entered the model prompt: '+excluded);
    }
    assert.deepEqual([call.account,send.account,send.group,send.segments],
      [FIRST,FIRST,GROUP,[{type:'text',data:{text}}]]);
    assert.equal(f.noticeState().lastOutcome,outcome);
    assert.deepEqual(privateIds(),[preGrant.event.id,...transitionIds]);
    if (outcome==='unknown') {
      assert.equal(send.receipt,null);
      await f.reopen();
      assert.equal(f.source().identity,identity);
      await f.poll();
      assert.equal(f.events.length,before+1);
      f.events.forEach(f.replay);
      await f.tick();
      assert.deepEqual([f.noticeState().pending,f.wire.length,f.sent.length], [0,2,2]);
    } else assert(Number.isInteger(send.receipt));
  }
  assert.equal(new Set(transitionIds).size,3);
  assert.deepEqual(f.recorded(),['accepted','accepted','unknown']);
  assert.deepEqual(f.recorded(SECOND),[]);
  const previousCount = f.events.length;
  await f.reopen();
  await f.poll();
  assert.equal(f.events.length,previousCount);
  f.events.forEach(f.replay);
  assert.equal(f.noticeState().pending,0);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [3,3]);

  f.configure({url:PAGE_REPLACEMENT});
  await f.poll();
  f.writePage('替换订阅只应出现在原提醒的私有样例');
  await f.poll();
  assert(f.requests.includes(PAGE_REPLACEMENT));
  assert.equal(f.events.at(-1).event.subject,PAGE_ADDRESS);
  assert.notEqual(f.source().identity,identity);
  assert.equal(f.noticeState().binding.status,'source_changed');
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [3,3]);

  await f.setGrant(true);
  assert.equal(f.noticeState().binding.status,'ready');
  assert.equal(f.noticeState().pending,0);
  f.writePage('新批准订阅的另一条真实变化');
  await f.poll();
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [4,4]);
  assert.deepEqual(noticeData(f.wire.at(-1).prompt),{name:PAGE_NAME});
  assert.deepEqual(f.sent.at(-1).segments,[{type:'text',data:{text}}]);
  assert.deepEqual(f.recorded(),['accepted','accepted','accepted','unknown']);
});

test('renaming a page requires renewed group approval while keeping its owner URL cursor and other source grants', async t => {
  const f = await fixture(t, {page:true,withOtherSources:true});
  f.writePage('第一个网页状态');
  await f.poll();
  f.grantOtherSources();
  const otherGrants = () => {
    const groups = f.serviceFor(FIRST).snapshot().qq.groups;
    return ['feedNotices','calendarNotices','folderNotices'].map(kind=>groups[kind].binding);
  };
  const stable = otherGrants();
  assert.deepEqual(stable.map(binding=>[binding.groupId,binding.status]), Array.from({length:3},()=>[OTHER,'ready']));

  await f.setGrant(true);
  assert.equal(f.noticeState().binding.status,'ready');
  assert.deepEqual(otherGrants(),stable);
  await f.setGrant(false);
  assert.equal(f.noticeState().binding,null);
  assert.deepEqual(otherGrants(),stable);
  await f.setGrant(true);
  const originalIdentity = f.source().identity;
  f.configure({enabled:false});
  assert.equal(f.noticeState().binding.status,'source_disabled');
  assert.deepEqual(otherGrants(),stable);
  f.configure({enabled:true});
  assert.equal(f.noticeState().binding.status,'ready');

  const renamed = '场馆开放时间新名称';
  f.configure({name:renamed});
  assert.notEqual(f.source().identity,originalIdentity);
  assert.equal(f.noticeState().binding.status,'source_changed');
  assert.deepEqual(otherGrants(),stable);
  await f.reopen();
  f.writePage('第二个网页状态');
  await f.poll();
  assert.deepEqual(f.events.map(({event,source})=>[event.kind,event.subject,source.name]),
    [['page.changed',PAGE_ADDRESS,renamed]], 'first post-rename poll must use the stored URL cursor');
  const row = f.serviceFor(SECOND).socialStore.pendingNotices()[0];
  assert.equal(row.id,f.events[0].event.id);
  assert.equal(JSON.parse(row.payload).sourceName,renamed);
  assert.equal(f.noticeState().binding.status,'source_changed');
  assert.deepEqual(otherGrants(),stable);
  await f.tick();
  assert.deepEqual([f.wire.length,f.sent.length], [0,0]);

  await f.setGrant(true);
  assert.equal(f.noticeState().binding.status,'ready');
  f.writePage('第三个网页状态');
  await f.poll();
  await f.tick();
  assert.deepEqual([f.events.length,f.wire.length,f.sent.length], [2,1,1]);
  assert.deepEqual(noticeData(f.wire[0].prompt),{name:renamed});
  assert.deepEqual([f.sent[0].account,f.sent[0].group,f.sent[0].segments],
    [FIRST,GROUP,[{type:'text',data:{text:`网页「${renamed}」有更新。`}}]]);
  assert.deepEqual(otherGrants(),stable);
});
