'use strict';
// Real local ICS/folder readers, durable registry and SQLite conversation.
// Only clock and model are controlled; no real accounts or paid requests.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {SourceRegistry}=require('../src/sources/registry.cjs');
const {BotService}=require('../src/bot/service.cjs');
const {until}=require('./helpers/until.cjs');

test('local calendar and folder reach App chat, respect source disable and do not replay after restart',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-source-flow-')));
  const folder=path.join(root,'watched'),calendar=path.join(root,'calendar.ics'),file=path.join(root,'sources.json');fs.mkdirSync(folder);
  const start=Date.now(),clock={now:start},calls=[],events=[];
  const utc=ms=>new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  fs.writeFileSync(calendar,`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:local-test\r\nDTSTART:${utc(start+5*60000)}\r\nSUMMARY:课程提醒\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`);
  const configs=[{id:'calendar',kind:'ics',name:'测试课程表',file:calendar,enabled:true,notify:'companion'},
    {id:'folder',kind:'folder',name:'测试文件夹',dir:folder,intervalMs:5000,enabled:true,notify:'companion'}];
  let service,registry;
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const runner=()=>Object.assign(async args=>{calls.push(args);return {outcome:'reply_ended',text:'隔离替身：收到这条数据源提醒。'};},{close:async()=>{}});
  const makeService=()=>{
    service=new BotService({root:path.join(root,'profile'),vault,runnerFactory:runner});
    service.companionNotifier().now=()=>clock.now;
  };
  const sourceEnabled=id=>registry.snapshot().some(s=>s.id===id&&s.enabled&&['both','companion'].includes(s.notify));
  const makeRegistry=()=>new SourceRegistry({file,now:()=>clock.now,publish:(event,source)=>{events.push(event);service.companionNotice({...event,notify:source.notify,sourceName:source.name});}});
  t.after(async()=>{registry?.close();await service?.localStop();fs.rmSync(root,{recursive:true,force:true});});
  makeService();service.configure({key:'fixture-source-flow-key'});service.socialStore.configure({noticeStartHour:0,noticeEndHour:24,maxNoticesPerDay:24});
  registry=makeRegistry();registry.configure(configs);registry.tick();
  await until(()=>registry.snapshot().every(s=>s.lastCheckedAt!==null),{timeoutMs:3000});
  assert.deepEqual(events.map(e=>e.title),['课程提醒']);
  assert.equal(service.companionNoticeTick({sourceEnabled}).reason,'no_conversation');assert.equal(calls.length,0);
  await service.localStart();let delivery=service.companionNoticeTick({sourceEnabled});
  // Previous no-conversation check is throttled until the next controller tick.
  if(!delivery.promise){clock.now+=15000;delivery=service.companionNoticeTick({sourceEnabled});}
  assert.deepEqual(await delivery.promise,{app:'delivered',qq:null});assert.match(calls[0].prompt,/课程提醒/);
  assert.match(calls[0].prompt,/untrusted JSON/);assert.deepEqual(await calls[0].request({tool:'Write'}),{allow:false});
  fs.writeFileSync(path.join(folder,'新文件.txt'),'local source fixture');clock.now+=5000;registry.tick();
  await until(()=>events.length===2,{timeoutMs:3000});
  registry.configure(configs.map(c=>c.id==='folder'?{...c,enabled:false}:c));
  clock.now+=6*60000;assert.equal(service.companionNoticeTick({sourceEnabled}).reason,'source_disabled');assert.equal(calls.length,1);
  registry.configure(configs);clock.now+=15000;delivery=service.companionNoticeTick({sourceEnabled});
  assert.deepEqual(await delivery.promise,{app:'delivered',qq:null});assert.match(calls[1].prompt,/新文件.txt/);
  const history=service.localSnapshot().history.map(m=>m.text);assert.equal(history.length,2);
  registry.close();await service.localStop();makeService();registry=makeRegistry();registry.load();await service.localStart();registry.tick();
  await until(()=>registry.snapshot().every(s=>s.lastCheckedAt!==null),{timeoutMs:3000});
  clock.now+=6*60000;assert.equal(service.companionNoticeTick({sourceEnabled}).reason,'empty');
  assert.equal(events.length,2);assert.equal(calls.length,2);assert.deepEqual(service.localSnapshot().history.map(m=>m.text),history);
});
