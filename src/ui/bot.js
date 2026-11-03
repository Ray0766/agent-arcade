'use strict';
(() => {
  const words={en:{nav:'WeChat tasks',title:'Send a message. Give your agent a job.',subtitle:'WeChat is the conversation. This workshop runs the work.',preview:'Experimental connection · live WeChat acceptance pending.',setup:'Connect your workshop',scope:'One WeChat owner, one local project, one Claude agent. Your computer must stay on.',project:'Project folder',choose:'Choose folder',save:'Save key',budget:'Maximum cost per task (USD)',privacy:'Messages and task output pass through Tencent and Anthropic. Credentials use OS encryption; local chat history stays in memory. The SDK also keeps local session files.',pair:'Pair WeChat',start:'Start receiving tasks',stop:'Disconnect & cancel',scan:'Scan in WeChat and confirm. Codes expire after three minutes.',forget:'Forget credentials',inbox:'Task inbox',inboxNote:'Task acknowledgements, requests for input and final replies go back to WeChat.',empty:'After connecting, send your bot a message in WeChat. Tasks and replies will appear here.',commands:'Chat commands & permissions',help:'Send a task in plain language. /status checks progress; /cancel stops the task and clears the queue; /new starts fresh. Tool actions ask for a one-time /allow code or /deny code. Questions accept /answer code text.',risk:'An approved command can affect your computer beyond the selected folder. A reply ending does not prove the work succeeded. Disconnection cancels active work; tasks are never resumed automatically.',keySet:'Key saved with OS encryption. It is never sent to this view.',keyEmpty:'API billing required. Claude subscription login is not used.',noProject:'Choose a project before connecting.',disconnected:'Disconnected',connecting:'Connecting…',connected:'Receiving tasks',pairing:'Waiting for WeChat scan',paired:'WeChat paired',you:'You',agent:'Sprout Bot',notDesktop:'Open the desktop app to connect WeChat.',saved:'Key saved',confirmForget:'Forget API key and WeChat credentials? Active tasks will be cancelled.'},zh:{nav:'微信派活',title:'发条微信，让 Agent 开工。',subtitle:'微信里说清任务，小工坊在电脑上执行。',preview:'实验接入 · 尚未完成真实微信全链路验收。',setup:'连接你的工坊',scope:'一个微信主人、一个本机项目、一个 Claude Agent。运行时电脑需要保持开机。',project:'项目目录',choose:'选择文件夹',save:'保存密钥',budget:'每条任务的费用上限（美元）',privacy:'消息与任务输出会经过腾讯和 Anthropic。凭证使用系统加密；本页聊天仅保留在内存。SDK 另在本机保留会话文件。',pair:'连接微信',start:'开始接收任务',stop:'断开并取消任务',scan:'用微信扫码并确认，二维码三分钟后失效。',forget:'忘记凭证',inbox:'任务收件箱',inboxNote:'微信只收到接收确认、需要你介入的问题和最终回复。',empty:'连接后，在微信向 Bot 发一条任务。任务与回复会出现在这里。',commands:'聊天命令与操作权限',help:'直接用自然语言派活。/status 查看进度；/cancel 停止任务并清空队列；/new 开启新会话。工具操作需回复一次性的 /allow 验证码 或 /deny 验证码；问题可用 /answer 验证码 回答。',risk:'批准的命令可能影响所选文件夹以外的本机内容。回复结束不代表任务已成功。断开会取消执行，重启不会自动续跑。',keySet:'已使用系统加密保存。密钥不会回传到本页面。',keyEmpty:'需要 API 计费，不使用 Claude 订阅登录。',noProject:'先选择一个项目。',disconnected:'未连接',connecting:'正在连接…',connected:'正在接收任务',pairing:'等待微信扫码',paired:'微信已配对',you:'你',agent:'Sprout Bot',notDesktop:'请在桌面应用中连接微信。',saved:'密钥已保存',confirmForget:'忘记 API 密钥和微信凭证？当前任务会被取消。'}};
  let language='en',lastMessages='',lastMascot='',state;
  words.en.budget='Task cost limit (SDK, USD)';words.zh.budget='任务费用限制（SDK，美元）';
  words.en.disconnecting='Stopping the local task…';words.zh.disconnecting='正在停止本机任务…';
  copy.en.localNote='◎ Observer events stay on this device.';copy.zh.localNote='◎ 观察器事件留在本机。';
  const word=k=>words[language][k]||k;
  const run=fn=>action(async()=>{if(!window.arcade.botConfigure)throw Error(word('notDesktop'));await fn();});
  window.renderBot=next=>{
    language=next.config.language;state=next.bot;
    document.querySelectorAll('[data-bot]').forEach(n=>n.textContent=word(n.dataset.bot));
    document.querySelector('.breadcrumb>span:last-child').textContent=view==='bot'?word('nav'):t({scene:'workshop',activity:'activity',settings:'settings'}[view]);
    $('bot-status').textContent=word(state?.status||'disconnected');
    $('bot-project').textContent=state?.workspace||word('noProject');
    $('bot-key-status').textContent=word(state?.hasKey?'keySet':'keyEmpty');
    $('bot-pair').textContent=word(state?.paired?'paired':'pair');
    $('bot-problem').hidden=!state?.problem;$('bot-problem').textContent=state?.problem||'';
    const active=['connected','connecting','disconnecting'].includes(state?.status),pairing=state?.status==='pairing';
    for(const id of ['bot-pick','bot-key','bot-save','bot-budget','bot-pair'])$(id).disabled=active||pairing;
    $('bot-start').hidden=active||pairing;$('bot-start').disabled=!(state?.hasKey&&state?.workspace&&state?.paired);
    $('bot-stop').hidden=!(active||pairing);
    if(document.activeElement!==$('bot-budget'))$('bot-budget').value=state?.budget||1;
    $('bot-qr-wrap').hidden=!state?.qr;
    if(state?.qr&&$('bot-qr').getAttribute('src')!==state.qr)$('bot-qr').src=state.qr;
    if(!state?.qr)$('bot-qr').removeAttribute('src');
    const messages=state?.tasks?.messages||[], fingerprint=JSON.stringify([language,messages]);
    const latest=state?.tasks?.tasks?.at(-1),labels=language==='zh'?{queued:'排队中',running:'执行中',waiting_permission:'等待你的批准',waiting_question:'等待你的回答',cancelling:'正在中止',reply_ended:'回复结束 · 任务结果未验证',error:'执行出错 · 结果未验证',limit:'达到执行限制',cancelled:'已取消'}:{queued:'Queued',running:'Running',waiting_permission:'Waiting for approval',waiting_question:'Waiting for your answer',cancelling:'Cancelling',reply_ended:'Response ended · outcome unverified',error:'Execution error · outcome unverified',limit:'Execution limit reached',cancelled:'Cancelled'};
    $('bot-task-state').textContent=latest?`${labels[latest.state]||latest.state}${latest.activity?' · '+latest.activity:''}`:'';
    if(lastMessages!==fingerprint){
      lastMessages=fingerprint;
      if(messages.length){
        $('bot-messages').replaceChildren(...messages.map(m=>{const row=el('article',`bot-message ${m.role==='user'?'from-user':'from-agent'}`);row.append(el('small','',word(m.role==='user'?'you':'agent')),el('pre','',m.text||''));if(m.deliveryFailed)row.append(el('small','',language==='zh'?'未发送到微信。连接尚在时发 /status 重取结果；断开后请在本机检查。':'Not delivered to WeChat. Use /status within this connection; after disconnecting, inspect the project locally.'));return row;}));
      }else{const empty=el('p','bot-empty',word('empty'));$('bot-messages').replaceChildren(empty);}
    }
    const mascot=state?.tasks?.pending?.length?'waiting':state?.tasks?.currentTaskId?'running':messages.length?'done':'idle';
    if(lastMascot!==`${mascot}:${next.config.theme}`){lastMascot=`${mascot}:${next.config.theme}`;$('bot-mascot').className=`scene ${mascot}`;$('bot-mascot').replaceChildren(sprite(mascot));}
  };
  $('bot-pick').onclick=()=>run(()=>window.arcade.botProject());
  $('bot-save').onclick=()=>run(async()=>{const key=$('bot-key').value;$('bot-key').value='';await window.arcade.botConfigure({key});toast(word('saved'));});
  $('bot-budget').onchange=()=>run(()=>window.arcade.botConfigure({budget:Number($('bot-budget').value)}));
  $('bot-pair').onclick=()=>run(()=>window.arcade.botLogin());
  $('bot-start').onclick=()=>run(()=>window.arcade.botConnect());
  $('bot-stop').onclick=()=>run(()=>window.arcade.botDisconnect());
  $('bot-forget').onclick=()=>run(async()=>{if(window.confirm(word('confirmForget')))await window.arcade.botForget();});
  // No fabricated chat or successful execution in the standalone preview.
  if(data)window.renderBot(data);
})();
