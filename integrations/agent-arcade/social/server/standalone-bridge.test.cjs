'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFile, fork, spawn} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createInterface} = require('node:readline');
const {DatabaseSync} = require('node:sqlite');
const {setTimeout:delay} = require('node:timers/promises');
const {promisify} = require('node:util');

const execute = promisify(execFile);
const getFirst = (child, source, event) => Promise.race([
  once(source, event),
  once(child, 'exit').then(([code]) => {throw new Error('Fixture or Friends service exited before readiness: ' + code);}),
]);

test('the Friends entry point sends a SQLite-backed task over the stock Bridge protocol', {timeout:60000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'arcade-bridge-ci-'));
  const children = [];
  t.after(async () => {
    for (const child of children.reverse()) {
      if (!child.pid || child.exitCode!==null || child.signalCode!==null) continue;
      const done = once(child,'exit');
      child.kill();
      await done;
    }
    await fs.rm(root,{recursive:true,force:true,maxRetries:4});
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>
    /^(path|systemroot|windir|comspec|pathext|temp|tmp|localappdata|appdata)$/i.test(key)));
  Object.assign(env,{HOME:root, USERPROFILE:root, BOTHOUSE_DATA_DIR:root});
  const python = process.env.ARCADE_TEST_PYTHON || (process.platform==='win32'?'python':'python3');
  const fixture = spawn(python,['-I','-B',path.resolve(__dirname,'../../test/bothouse/standalone-bridge-fixture.py'),root],
    {env,windowsHide:true,stdio:['ignore','pipe','inherit']});
  children.push(fixture);
  const lines = createInterface({input:fixture.stdout});
  const [config] = await getFirst(fixture,lines,'line');
  lines.close();

  const filename = path.join(root,'friends.sqlite');
  Object.assign(env,{
    SOCIAL_BOTHOUSE_CONNECTION:config,SOCIAL_BOTHOUSE_PYTHON:python,
    SOCIAL_HOST:'127.0.0.1',SOCIAL_PORT:'0',SOCIAL_DB:filename,
  });
  const service = fork(path.join(__dirname,'main.cjs'),[],
    {env,windowsHide:true,stdio:['ignore','ignore','inherit','ipc']});
  children.push(service);
  const [{port}] = await getFirst(service,service,'message');
  const apiOrigin = 'http://127.0.0.1:' + port + '/api/v1/';
  let cookie;
  async function api(route,body) {
    const response = await fetch(apiOrigin+route,{
      method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie && {cookie})},
      ...(body && {body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000),
    });
    if (response.headers.has('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    const data=await response.json();
    assert.equal(response.status,200,route+' '+JSON.stringify(data));
    return data;
  }
  const account='fixture_reader';
  await api('register',{number:account,displayName:'Fixture reader',password:'local-fixture-only'});
  assert.deepEqual((await api('ai-contacts')).contacts,[]);
  const {stdout} = await execute(process.execPath,[path.join(__dirname,'bothouse','pair.cjs'),'share',account,'fixture-bridge'],
    {env,windowsHide:true,timeout:12000});
  assert.equal(JSON.parse(stdout).shared,true);
  const {contacts} = await api('ai-contacts');
  assert.equal(contacts.length,1);
  assert.equal(contacts[0].configured,true);
  const {conversation} = await api('ai-contacts/start',{number:contacts[0].number,expectedAccount:account});
  const route='conversations/'+conversation.id+'/messages';
  const body={text:'给你一个任务：给海边读书会想两个名字',clientId:'stock-bridge-task'};
  const sent=await api(route,body);
  const prompt = sent.message ?? sent;
  assert.ok(prompt.task && Number.isSafeInteger(prompt.id),JSON.stringify(sent));

  let messages;
  const text='Two names: Tide Readers and Shoreline Shelf.';
  const artifact = '任务 #'+prompt.id+' · 已交回\n'+text;
  const deadline=Date.now()+20000;
  do {
    messages=(await api(route)).messages;
    if (messages.some(message=>message.text===artifact)) break;
    await delay(200);
  } while (Date.now()<deadline);
  await api(route,body);
  assert.equal((await api(route)).messages.filter(message=>message.text===artifact).length,1,
    'The task result should arrive once in the original chat. Seen: '+JSON.stringify(messages));
  assert.equal((await api(route)).messages.filter(message=>message.text===body.text).length,1);
  const frames=(await fs.readFile(path.join(root,'messages.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(frames.length,1,'There should be no duplicate Bridge message for the retry.');
  assert.match(frames[0].content,/海边读书会/);
  const db=new DatabaseSync(filename,{readOnly:true});
  try {
    assert.deepEqual(db.prepare('SELECT state,result FROM bothouse_task_claims').all().map(row=>({...row})),
      [{state:'returned',result:text}]);
  } finally {db.close();}
});
