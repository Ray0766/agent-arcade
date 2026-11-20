'use strict';

// Fixed, synthetic test for the two native QA entry points. No caller supplies
// JavaScript, URLs, credentials, profile paths or operating-system commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const {randomBytes} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {setTimeout:delay} = require('node:timers/promises');
const {WebSocketServer, WebSocket} = require('ws');

const owner = 423000;
const companion = 423001;
const sender = 423002;
const group = 600011;
const qaKey = 'synthetic-deepseek-qq-qa';
const qaToken = 'synthetic-onebot-qq-qa';
const qaModel = 'https://api.deepseek.com/chat/completions';

function arm({app, root}) {
  const evidence = {appVersion:app.getVersion(), packaged:app.isPackaged, arch:process.arch,
    electron:process.versions.electron, node:process.versions.node, sqlite:process.versions.sqlite,
    source:require('../../package.json').buildSourceCommit, synthetic:true, realQQ:false,
    realModel:false, nativeVaultUsed:false, rendererErrors:[], blockedExternalRequests:0,
    checks:[], wire:[], model:[], screenshots:[]};
  console.log('QA_PROFILE ' + root);
  app.whenReady().then(()=>{
    require('electron').session.defaultSession.webRequest.onBeforeRequest(
      {urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},
      (_details,callback)=>{evidence.blockedExternalRequests++;callback({cancel:true});});
  });
  const data = process.env.AGENT_ARCADE_HOME;
  fs.mkdirSync(data, {mode:0o700});
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({language:'zh', layout:'messenger', appearance:'day', desktopPets:false}));

  // Only the two hard-coded test values, or a vault record containing just
  // those values, can be stored. No persisted encryption key or OS vault.
  const vault = require('../core/application-credential-vault.cjs');
  const encrypted = new Map();
  vault.applicationCredentialVault = () => ({
    isEncryptionAvailable:()=>true,
    encryptString(text) {
      const parsed = JSON.parse(text);
      assert.deepEqual(Object.values(parsed).sort(), Object.values(parsed).filter(value=>[qaKey,qaToken,'',null].includes(value)).sort());
      const bytes = randomBytes(24);
      encrypted.set(bytes.toString('hex'), text);
      return bytes;
    },
    decryptString(bytes) {
      const value = encrypted.get(bytes.toString('hex'));
      assert.equal(typeof value, 'string', 'only vault records from this process are readable');
      return value;
    },
  });

  // Simulate the installed LLBot launch files. The real status IPC is still
  // scoped to the selected profile, and the real OneBot client tests friendship.
  const setup = require('../bot/mac-qq-setup.cjs');
  const create = setup.createMacQQSetup;
  setup.createMacQQSetup = options => {
    const service = create(options);
    return {...service, async launchStatus(value) {
      const status = await service.launchStatus(value);
      if (!status.ok || status.state !== 'unlinked') return status;
      return {ok:true,state:'ready',targetDirectory:path.join(root,'synthetic-llbot'),authorization:'missing'};
    }};
  };

  let modelState = 'reject', friends = false, nextMessage = 500001;
  const send = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) !== qaModel || init?.headers?.Authorization !== 'Bearer ' + qaKey) {
      evidence.blockedExternalRequests++;
      throw Error('QA refuses unexpected network activity');
    }
    const input = JSON.parse(init.body);
    const gate = input.messages.some(message=>String(message.content).includes('Decide whether this character should answer'));
    evidence.model.push({stage:gate?'gate':'reply', fixture:modelState});
    if (modelState === 'reject') return new Response('synthetic 401', {status:401});
    const content = gate ? JSON.stringify({action:modelState === 'wait'?'wait':'message',text:modelState === 'wait'?'':'fixture reply is appropriate'}) :
      '隔离测试回复。';
    if (input.stream) {
      const chunks = [
        {choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]},
        {choices:[{index:0,delta:{},finish_reason:'stop'}]},
      ];
      return new Response(chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n',
        {headers:{'Content-Type':'text/event-stream'}});
    }
    return Response.json({choices:[{message:{role:'assistant',content},finish_reason:'stop'}]});
  };

  const server = new WebSocketServer({host:'127.0.0.1', port:0});
  const listening = once(server,'listening');
  server.on('connection',(socket, request)=>{
    if (request.headers.authorization !== 'Bearer ' + qaToken) {
      socket.close(1008,'synthetic token required');
      return;
    }
    socket.on('message',payload=>{
      const {action,echo,params} = JSON.parse(String(payload));
      evidence.wire.push(action);
      const data = {
        get_login_info:{user_id:companion,nickname:'QA Whale'},
        get_status:{online:true,good:true},
        get_friend_list:friends?[{user_id:owner,nickname:'QA Owner'}]:[],
        get_group_list:[{group_id:group,group_name:'QA Group',member_count:3,max_member_count:50}],
        get_group_info:{group_id:group,group_name:'QA Group',member_count:3,max_member_count:50},
        get_group_member_list:[{user_id:owner},{user_id:companion},{user_id:sender}],
        get_group_member_info:{group_id:group,user_id:params?.user_id,nickname:'QA Member',role:'member'},
        send_group_msg:{message_id:nextMessage++},
      }[action];
      if (action==='send_group_msg') send.push({groupId:params?.group_id});
      socket.send(JSON.stringify(data===undefined?{status:'failed',retcode:100,echo}:
        {status:'ok',retcode:0,echo,data}));
    });
  });

  async function groupEvent(text) {
    const socket = [...server.clients].find(client=>client.readyState===WebSocket.OPEN);
    assert(socket,'connected OneBot client required');
    socket.send(JSON.stringify({
      self_id:companion, post_type:'message', message_type:'group', sub_type:'normal',
      time:Math.floor(Date.now()/1000), user_id:sender, group_id:group, message_id:nextMessage++,
      sender:{user_id:sender,nickname:'QA Group Member'},
      message:[{type:'at',data:{qq:String(companion)}},{type:'text',data:{text:' '+text}}],
    }));
  }

  async function verify(win) {
    await listening;
    assert.equal(app.isPackaged,true);
    const wc=win.webContents;
    assert.equal(wc.getURL(),pathToFileURL(path.join(app.getAppPath(),'src/ui/index.html')).href);
    const evaluate=(fn,...args)=>wc.executeJavaScript('('+fn.toString()+')(...'+JSON.stringify(args)+')');
    const wait=async (label,fn,...args)=>{
      const until=Date.now()+9000;
      while(Date.now()<until){
        const value=await evaluate(fn,...args);
        if(value)return value;
        await delay(60);
      }
      throw Error('Timed out: '+label);
    };
    const waitText=(selector,text)=>wait(selector+' '+text,(selector,text)=>{
      const el=document.querySelector(selector);
      return el&&!el.closest('[hidden]')&&el.getClientRects().length>0&&el.textContent.includes(text);
    },selector,text);
    const click=async selector=>assert(await evaluate(selector=>{
      const el=document.querySelector(selector);
      if (!el || el.disabled || el.closest('[hidden]') || !el.getClientRects().length) return false;
      el.click();
      return true;
    },selector),'button is available: '+selector);
    const shot=async name=>{
      const file=name+'.png';
      fs.writeFileSync(path.join(root,file),(await wc.capturePage()).toPNG());
      evidence.screenshots.push(file);
    };

    await wait('preload startup',()=>window.arcade&&window.data!==null&&document.body.dataset.view==='bot');
    assert.equal(await evaluate(()=>window.arcade.platform.os),'darwin');
    const port=server.address().port;
    await evaluate(async (id, owner, port, qaKey, qaToken, group)=>{
      await window.arcade.botConfigure({mode:'deepseek',channel:'qq'});
      const s=await window.arcade.snapshot();
      await window.arcade.botConfigure({profileId:s.accounts.selectedId,expectedMode:'deepseek',expectedChannel:'qq',
        key:qaKey,qqToken:qaToken,qqUrl:'ws://127.0.0.1:'+port+'/',qqAccountId:String(id),qqOwnerId:String(owner),
        qqGroups:{enabled:true,groupIds:[String(group)],proactive:false}});
      await window.arcade.socialConfigure({enabled:true});
      const after=await window.arcade.snapshot();
      const reply=await window.arcade.desktopConversationSelect({accountId:after.accounts.selectedId,kind:'channel'});
      if (!reply?.ok) throw Error('cannot select QQ conversation: '+JSON.stringify(reply));
      switchView('connections');
    },companion,owner,port,qaKey,qaToken,group);

    await waitText('#onboarding-qq-groups','设置 QQ 群聊');
    await click('#onboarding-qq-groups');
    await evaluate(()=>{const pane=document.querySelector('#bot-qq-manual');pane.open=true;});
    await click('#bot-qq-test');
    await waitText('#bot-qq-mac-launch-next','前往复查 QQ 好友关系');
    await waitText('#bot-status','请核对 QQ 好友关系');
    await evaluate(()=>document.querySelector('#bot-qq-mac-launch-next').scrollIntoView({block:'center'}));
    await shot('01-friendship-recheck');
    await click('#bot-qq-mac-launch-next');
    assert.equal(await evaluate(()=>document.activeElement.id),'bot-qq-test');
    assert(!(await evaluate(async()=>{try{await window.arcade.botConnect();return (await window.arcade.snapshot()).bot.status==='connected';}catch{return false;}})));
    friends=true;
    // A connection attempt can close the setup panel as its phase changes.
    // Re-enter via the same channel settings user flow before testing again.
    await evaluate(()=>switchView('connections'));
    await waitText('#onboarding-qq-groups','设置 QQ 群聊');
    await click('#onboarding-qq-groups');
    await evaluate(()=>{document.querySelector('#bot-qq-manual').open=true;});
    await click('#bot-qq-test');
    await waitText('#bot-qq-mac-launch-next','前往填写群号');
    await click('#bot-qq-mac-launch-next');
    assert.equal(await evaluate(()=>document.activeElement.id),'bot-qq-group-ids');
    evidence.checks.push('Work > Channels > QQ group setup: actual Test connection rejects missing friendship, focuses retest, then advances after the bridge reports mutual friendship');

    await evaluate(()=>window.arcade.botConnect());
    await waitText('#bot-status','QQ 已连接');
    await groupEvent('可以帮我想一个周末出游的点子吗？');
    await waitText('#bot-qq-provider-problem-details','查看群聊诊断');
    assert.equal(send.length,0,'failed model never sends a reply');
    assert(evidence.model.some(row=>row.stage==='gate'&&row.fixture==='reject'));
    await shot('02-model-failure-on-qq-chat');
    await click('#bot-qq-provider-problem-details');
    assert.equal(await evaluate(()=>document.activeElement.id),'bot-qq-groups-runtime');
    await waitText('#bot-qq-groups-runtime','API key');
    await waitText('#bot-qq-groups-runtime','600011');
    await shot('03-group-diagnostics');
    await groupEvent('群聊帮助');
    const helpDeadline=Date.now()+9000;
    while (send.length<1 && Date.now()<helpDeadline) await delay(50);
    assert.equal(send.length,1,'local help is delivered while provider is unavailable');
    await waitText('#bot-qq-provider-problem-details','查看群聊诊断');

    modelState='reply';
    await groupEvent('你建议我们周六上午去哪里？');
    const replyDeadline=Date.now()+12000;
    while (send.length<2 && Date.now()<replyDeadline) await delay(50);
    assert.equal(send.length,2,'same group resumes from a new message');
    await wait('provider warning cleared',()=>document.querySelector('#bot-qq-provider-problem').hidden);
    await waitText('#bot-status','QQ 已连接');
    modelState='wait';
    await groupEvent('我在整理包里的雨伞。');
    const quietDeadline=Date.now()+9000;
    while (!evidence.model.some(row=>row.fixture==='wait')&&Date.now()<quietDeadline) await delay(50);
    assert(evidence.model.some(row=>row.stage==='gate'&&row.fixture==='wait'));
    await delay(500);
    assert.equal(send.length,2,'normal model decision to wait is silent');
    assert.equal(await evaluate(()=>document.querySelector('#bot-qq-provider-problem').hidden),true);
    assert(send.every(row=>String(row.groupId)===String(group)));
    evidence.checks.push('Actual QQ conversation: synthetic 401 preserves connected state and opens exact per-group diagnostic; local help keeps the fault; success clears it; ordinary wait remains silent');

    await evaluate(()=>window.arcade.botDisconnect());
    assert.equal(evidence.blockedExternalRequests,0);
    assert.deepEqual(evidence.rendererErrors,[]);
    return true;
  }

  let windowStarted=false;
  let finishing=false;
  async function finish(error) {
    if(finishing)return;
    finishing=true;
    clearTimeout(deadline);
    for (const socket of server.clients) socket.terminate();
    server.close();
    evidence.passed=!error;
    if(error)evidence.error=String(error.stack||error);
    fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(evidence,null,2)+'\n');
    console.log('QA_RECEIPT ' + path.join(root,'receipt.json'));
    process.exitCode=error?1:0;
    app.quit();
  }
  const deadline=setTimeout(()=>{void finish(Error('QA scenario timed out'));},55000);
  app.on('browser-window-created',(_event,win)=>{
    if (windowStarted)return;
    windowStarted=true;
    win.webContents.on('console-message',(_event,info)=>{
      if(info?.level==='error')evidence.rendererErrors.push(info.message);
    });
    win.webContents.once('did-finish-load',()=>{void verify(win).then(()=>finish(),finish);});
  });
}

module.exports={arm};
