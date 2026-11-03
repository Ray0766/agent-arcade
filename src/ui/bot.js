'use strict';
(() => {
  const words={en:{nav:'WeChat tasks',title:'Send a message. Give your agent a job.',subtitle:'WeChat is the conversation. This workshop runs the work.',preview:'Experimental connection · live WeChat acceptance pending.',setup:'Connect your workshop',scope:'One WeChat owner, one local project, one Claude agent. Your computer must stay on.',project:'Project folder',choose:'Choose folder',save:'Save key',budget:'Maximum cost per task (USD)',privacy:'Messages and task output pass through Tencent and Anthropic. Credentials use OS encryption; local chat history stays in memory. The SDK also keeps local session files.',pair:'Pair WeChat',start:'Start receiving tasks',stop:'Disconnect & cancel',scan:'Scan in WeChat and confirm. Codes expire after three minutes.',forget:'Forget credentials',inbox:'Task inbox',inboxNote:'Task acknowledgements, requests for input and final replies go back to WeChat.',empty:'After connecting, send your bot a message in WeChat. Tasks and replies will appear here.',commands:'Chat commands & permissions',help:'Send a task in plain language. /status checks progress; /cancel stops the task and clears the queue; /new starts fresh. Tool actions ask for a one-time /allow code or /deny code. Questions accept /answer code text.',risk:'An approved command can affect your computer beyond the selected folder. A reply ending does not prove the work succeeded. Disconnection cancels active work; tasks are never resumed automatically.',keySet:'Key saved with OS encryption. It is never sent to this view.',keyEmpty:'API billing required. Claude subscription login is not used.',noProject:'Choose a project before connecting.',disconnected:'Disconnected',connecting:'Connecting…',connected:'Receiving tasks',pairing:'Waiting for WeChat scan',paired:'WeChat paired',you:'You',agent:'Sprout Bot',notDesktop:'Open the desktop app to connect WeChat.',saved:'Key saved',confirmForget:'Forget API key and WeChat credentials? Active tasks will be cancelled.'},zh:{nav:'微信派活',title:'发条微信，让 Agent 开工。',subtitle:'微信里说清任务，小工坊在电脑上执行。',preview:'实验接入 · 尚未完成真实微信全链路验收。',setup:'连接你的工坊',scope:'一个微信主人、一个本机项目、一个 Claude Agent。运行时电脑需要保持开机。',project:'项目目录',choose:'选择文件夹',save:'保存密钥',budget:'每条任务的费用上限（美元）',privacy:'消息与任务输出会经过腾讯和 Anthropic。凭证使用系统加密；本页聊天仅保留在内存。SDK 另在本机保留会话文件。',pair:'连接微信',start:'开始接收任务',stop:'断开并取消任务',scan:'用微信扫码并确认，二维码三分钟后失效。',forget:'忘记凭证',inbox:'任务收件箱',inboxNote:'微信只收到接收确认、需要你介入的问题和最终回复。',empty:'连接后，在微信向 Bot 发一条任务。任务与回复会出现在这里。',commands:'聊天命令与操作权限',help:'直接用自然语言派活。/status 查看进度；/cancel 停止任务并清空队列；/new 开启新会话。工具操作需回复一次性的 /allow 验证码 或 /deny 验证码；问题可用 /answer 验证码 回答。',risk:'批准的命令可能影响所选文件夹以外的本机内容。回复结束不代表任务已成功。断开会取消执行，重启不会自动续跑。',keySet:'已使用系统加密保存。密钥不会回传到本页面。',keyEmpty:'需要 API 计费，不使用 Claude 订阅登录。',noProject:'先选择一个项目。',disconnected:'未连接',connecting:'正在连接…',connected:'正在接收任务',pairing:'等待微信扫码',paired:'微信已配对',you:'你',agent:'Sprout Bot',notDesktop:'请在桌面应用中连接微信。',saved:'密钥已保存',confirmForget:'忘记 API 密钥和微信凭证？当前任务会被取消。'}};
  let language='en',lastMessages='',lastMascot='',state;
  words.en.access='On your phone, open WeChat → Me → Settings → Plugins → ClawBot, enable it, then scan below. Send tasks in the ClawBot conversation, not to an ordinary contact named Agent Arcade. If this entry is missing, client compatibility or account availability remains unverified.';
  words.zh.access='手机微信：我 → 设置 → 插件 → ClawBot，启用后再扫码。任务入口是 ClawBot 对话，不是名为 Agent Arcade 的普通好友。若没有此入口，当前客户端适配或账号可用性仍待核实。';
  words.en.scan='Enable ClawBot in mobile WeChat, then scan and confirm. Codes expire after three minutes.';words.zh.scan='在手机微信启用 ClawBot 后扫码并确认，二维码三分钟后失效。';
  words.en.empty='After starting reception, send a task in the WeChat ClawBot conversation. Tasks and replies will appear here.';words.zh.empty='开始接收任务后，在微信 ClawBot 对话中发一条任务。任务与回复会出现在这里。';
  words.en.paired='Authorization credentials saved';words.zh.paired='授权凭证已保存';
  words.en.repair='Pair WeChat again';words.zh.repair='重新扫码配对';
  words.en.connected='Channel online · no WeChat message received yet';words.zh.connected='通道在线·尚未收到微信消息';
  words.en.received='WeChat message received';words.zh.received='已收到微信消息';
  words.en.incoming='Texts received this connection';words.zh.incoming='本次连接收到文本';
  words.en.outgoing='returns accepted by platform';words.zh.outgoing='平台受理回传';
  words.en.notRead='not read receipts';words.zh.notRead='不代表已读';
  Object.assign(words.en,{
    mode:'Execution method',modeApi:'API agent',modeNative:'Local Claude Code CLI',
    budget:'SDK cost threshold (USD)',budgetNote:'In-flight requests may exceed this threshold. It is not a hard billing cap.',
    nativeSetup:'Uses the original Claude Code CLI and its existing login. Agent Arcade does not read Claude credentials. Requires Node.js 22.13+ and local Claude Code 2.1.317. After connecting, run the command below yourself, confirm the custom Channels research preview in the terminal, and keep it open. The CLI follows its existing permissions; already allowed tools may run automatically.',
    nativeStopNote:'Stop Claude locally with Ctrl+C. WeChat /cancel and Disconnect only stop forwarding; they cannot guarantee that Claude stops.',
    keyRetained:'Your saved API key stays stored when switching modes.',nativeCommand:'Run in your terminal',copyCommand:'Copy launch command',copied:'Launch command copied',
    nativeStart:'Start WeChat forwarding',nativeStop:'Disconnect forwarding (CLI may keep running)',nativeDisconnecting:'Stopping WeChat forwarding…',
    nativePrivacy:'WeChat messages pass through Tencent. The original Claude Code CLI uses its normal service and local session storage. WeChat credentials use OS encryption.',
    nativeInbox:'CLI conversation',nativeInboxNote:'Messages share one Claude Code conversation and its existing permissions. Pending approvals belong to that CLI session.',
    nativeEmpty:'Connect WeChat, run the launch command in your terminal, then send a message in the ClawBot conversation.',
    nativeHelp:'Messages share the running CLI conversation; each message is not a separate task. Existing CLI permissions apply, and already allowed tools may run automatically. For a relayed approval, use the exact /allow CODE or /deny CODE. The preview comes from the CLI; a local decision may make the remote code stale. /status checks forwarding. /cancel pauses new forwarding, not Claude. Start a new conversation or stop Claude with Ctrl+C in the terminal.',
    nativeRisk:'The CLI keeps its normal local permissions. Commands may affect files beyond the selected folder. A response ending does not verify the work. Disconnecting WeChat does not guarantee that Claude stops.',
    nativeConfirmForget:'Forget the saved API key and WeChat credentials? Forwarding will stop, but Claude may keep running in its terminal.',
    nativeAttached:'MCP bridge initialized · CLI receipt and execution unverified',nativeDetached:'Waiting for CLI connection',nativePaused:'New WeChat forwarding paused · CLI may keep running',nativeForwarded:'submitted to local channel',nativeReplies:'replies from CLI',nativeDeliveryFailed:'WeChat return failed. Inspect the reply locally; /status does not retry it.'
  });
  Object.assign(words.zh,{
    mode:'执行方式',modeApi:'API Agent',modeNative:'本机 Claude Code CLI',
    budget:'SDK 费用阈值（美元）',budgetNote:'在途请求可能超过此阈值，它不是计费硬上限。',
    nativeSetup:'使用原版 Claude Code CLI 及其既有登录，本应用不读取 Claude 凭据。需要 Node.js 22.13+ 和本机 Claude Code 2.1.317。连接后，由你在终端运行下方命令，亲自确认自定义 Channels 研究预览，并保持终端运行。CLI 沿用既有权限，已允许的工具可能自动执行。',
    nativeStopNote:'在本机终端按 Ctrl+C 可停止 Claude。微信 /cancel 和断开连接仅停止转发，不能保证 Claude 停止。',
    keyRetained:'切换方式会保留已保存的 API key。',nativeCommand:'在终端运行',copyCommand:'复制启动命令',copied:'启动命令已复制',
    nativeStart:'开始微信转发',nativeStop:'断开微信转发（CLI 可能仍运行）',nativeDisconnecting:'正在停止微信转发…',
    nativePrivacy:'微信消息经过腾讯。原版 Claude Code CLI 使用其常规服务与本机会话存储；微信凭证使用系统加密。',
    nativeInbox:'CLI 会话',nativeInboxNote:'消息共用一个 Claude Code 会话及其既有权限；待批准项属于该 CLI 会话。',
    nativeEmpty:'连接微信后，在终端运行启动命令，再到 ClawBot 对话中发消息。',
    nativeHelp:'消息共用正在运行的 CLI 会话，每条消息不等于独立任务。CLI 沿用既有权限，已允许的工具可能自动执行。转来的批准请求可用原码 /allow CODE 或 /deny CODE 处理；参数预览来自 CLI，本机先行处理可能使远端确认码失效。/status 查看转发状态；/cancel 只暂停新消息转发，不保证停止 Claude。新会话或 Ctrl+C 停止操作请回到本机终端。',
    nativeRisk:'CLI 保留其正常本机权限，命令可能影响所选目录以外的内容。回复结束不代表任务通过验证。断开微信不能保证 Claude 停止。',
    nativeConfirmForget:'忘记已保存的 API key 和微信凭证？转发会停止，但终端中的 Claude 可能仍在运行。',
    nativeAttached:'MCP 桥接已初始化·CLI 接收和执行未验证',nativeDetached:'等待 CLI 连接',nativePaused:'新微信转发已暂停·CLI 可能仍运行',nativeForwarded:'已提交本机通道',nativeReplies:'CLI 回传',nativeDeliveryFailed:'微信回传失败，请在本机检查回复；/status 不会重试此回复。'
  });
  words.en.disconnecting='Stopping the local task…';words.zh.disconnecting='正在停止本机任务…';
  copy.en.localNote='◎ Observer events stay on this device.';copy.zh.localNote='◎ 观察器事件留在本机。';
  const word=k=>words[language][k]||k;
  const run=fn=>action(async()=>{if(!window.arcade.botConfigure)throw Error(word('notDesktop'));await fn();});
  window.renderBot=next=>{
    language=next.config.language;state=next.bot;
    document.querySelectorAll('[data-bot]').forEach(n=>n.textContent=word(n.dataset.bot));
    document.querySelector('.breadcrumb>span:last-child').textContent=view==='bot'?word('nav'):t({scene:'workshop',activity:'activity',settings:'settings'}[view]);
    const incoming=Number(state?.incomingCount)||0,outgoing=Number(state?.outgoingAccepted)||0;
    const status=state?.status||'disconnected',native=state?.mode==='native';
    $('bot-status').textContent=word(status==='connected'?(incoming>0?'received':'connected'):status==='disconnected'&&state?.paired?'paired':status);
    if(native&&status==='disconnecting')$('bot-status').textContent=word('nativeDisconnecting');
    $('bot-project').textContent=state?.workspace||word('noProject');
    $('bot-key-status').textContent=word(state?.hasKey?'keySet':'keyEmpty');
    $('bot-pair').textContent=word(state?.paired?'repair':'pair');
    $('bot-mode').value=native?'native':'api';
    $('bot-api-options').hidden=native;$('bot-native-options').hidden=!native;
    $('bot-native-key-retained').hidden=!state?.hasKey;
    $('bot-privacy').textContent=word(native?'nativePrivacy':'privacy');
    for(const [key,nativeKey] of [['inbox','nativeInbox'],['inboxNote','nativeInboxNote'],['help','nativeHelp'],['risk','nativeRisk']])document.querySelector(`[data-bot="${key}"]`).textContent=word(native?nativeKey:key);
    $('bot-start').textContent=word(native?'nativeStart':'start');$('bot-stop').textContent=word(native?'nativeStop':'stop');
    $('bot-problem').hidden=!state?.problem;$('bot-problem').textContent=state?.problem||'';
    const active=['connected','connecting','disconnecting'].includes(state?.status),pairing=state?.status==='pairing';
    for(const id of ['bot-mode','bot-pick','bot-key','bot-save','bot-budget','bot-pair'])$(id).disabled=active||pairing;
    $('bot-start').hidden=active||pairing;$('bot-start').disabled=!(state?.workspace&&state?.paired&&(native||state?.hasKey));
    $('bot-stop').hidden=!(active||pairing);
    const command=typeof state?.native?.command==='string'?state.native.command:'';
    $('bot-native-launch').hidden=!native||!['connected','connecting'].includes(status)||!command;
    $('bot-native-command').textContent=command;$('bot-native-copy').disabled=!command||!native||!active;
    if(document.activeElement!==$('bot-budget'))$('bot-budget').value=state?.budget||1;
    $('bot-qr-wrap').hidden=!state?.qr;
    if(state?.qr&&$('bot-qr').getAttribute('src')!==state.qr)$('bot-qr').src=state.qr;
    if(!state?.qr)$('bot-qr').removeAttribute('src');
    const messages=Array.isArray(state?.tasks?.messages)?state.tasks.messages:[], fingerprint=JSON.stringify([language,native,messages]);
    const latest=state?.tasks?.tasks?.at(-1),labels=language==='zh'?{queued:'排队中',running:'执行中',waiting_permission:'等待你的批准',waiting_question:'等待你的回答',cancelling:'正在中止',reply_ended:'回复结束 · 任务结果未验证',error:'执行出错 · 结果未验证',limit:'达到执行限制',cancelled:'已取消'}:{queued:'Queued',running:'Running',waiting_permission:'Waiting for approval',waiting_question:'Waiting for your answer',cancelling:'Cancelling',reply_ended:'Response ended · outcome unverified',error:'Execution error · outcome unverified',limit:'Execution limit reached',cancelled:'Cancelled'};
    const taskState=native?(active?`${word(state?.native?.paused?'nativePaused':state?.native?.attached?'nativeAttached':'nativeDetached')} · ${word('nativeForwarded')}: ${Number(state?.native?.forwarded)||0} · ${word('nativeReplies')}: ${Number(state?.native?.replies)||0}`:''):latest?`${labels[latest.state]||latest.state}${latest.activity?' · '+latest.activity:''}`:'';
    const channelState=status==='connected'||incoming>0||outgoing>0?`${word('incoming')}: ${incoming} · ${word('outgoing')}: ${outgoing} (${word('notRead')})`:'';
    $('bot-task-state').textContent=[taskState,channelState].filter(Boolean).join(' · ');
    if(lastMessages!==fingerprint){
      lastMessages=fingerprint;
      if(messages.length){
        $('bot-messages').replaceChildren(...messages.map(m=>{const row=el('article',`bot-message ${m.role==='user'?'from-user':'from-agent'}`);row.append(el('small','',word(m.role==='user'?'you':'agent')),el('pre','',m.text||''));if(m.deliveryFailed)row.append(el('small','',native?word('nativeDeliveryFailed'):language==='zh'?'未发送到微信。连接尚在时发 /status 重取结果；断开后请在本机检查。':'Not delivered to WeChat. Use /status within this connection; after disconnecting, inspect the project locally.'));return row;}));
      }else{const empty=el('p','bot-empty',word(native?'nativeEmpty':'empty'));$('bot-messages').replaceChildren(empty);}
    }
    const mascot=native?(state?.tasks?.pending?.length?'waiting':'idle'):state?.tasks?.pending?.length?'waiting':state?.tasks?.currentTaskId?'running':messages.length?'done':'idle';
    if(lastMascot!==`${mascot}:${next.config.theme}`){lastMascot=`${mascot}:${next.config.theme}`;$('bot-mascot').className=`scene ${mascot}`;$('bot-mascot').replaceChildren(sprite(mascot));}
  };
  $('bot-pick').onclick=()=>run(()=>window.arcade.botProject());
  $('bot-mode').onchange=()=>run(async()=>{const previous=state?.mode==='native'?'native':'api';try{await window.arcade.botConfigure({mode:$('bot-mode').value});}catch(error){$('bot-mode').value=previous;throw error;}});
  $('bot-save').onclick=()=>run(async()=>{const key=$('bot-key').value;$('bot-key').value='';await window.arcade.botConfigure({key});toast(word('saved'));});
  $('bot-budget').onchange=()=>run(()=>window.arcade.botConfigure({budget:Number($('bot-budget').value)}));
  $('bot-pair').onclick=()=>run(()=>window.arcade.botLogin());
  $('bot-start').onclick=()=>run(()=>window.arcade.botConnect());
  $('bot-stop').onclick=()=>run(()=>window.arcade.botDisconnect());
  $('bot-native-copy').onclick=()=>run(async()=>{if(!window.arcade.botCopyNative)throw Error(word('notDesktop'));await window.arcade.botCopyNative();toast(word('copied'));});
  $('bot-forget').onclick=()=>run(async()=>{if(window.confirm(word(state?.mode==='native'?'nativeConfirmForget':'confirmForget')))await window.arcade.botForget();});
  // No fabricated chat or successful execution in the standalone preview.
  if(data)window.renderBot(data);
})();
