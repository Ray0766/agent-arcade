'use strict';
(() => {
  const words={en:{nav:'WeChat tasks',title:'Send a message. Give your agent a job.',subtitle:'WeChat is the conversation. This workshop runs the work.',preview:'Experimental connection · live WeChat acceptance pending.',setup:'Connect your workshop',scope:'One WeChat owner, one local project, one Claude agent. Your computer must stay on.',project:'Project folder',choose:'Choose folder',save:'Save key',budget:'Maximum cost per task (USD)',privacy:'Messages and task output pass through Tencent and Anthropic. Credentials use OS encryption; local chat history stays in memory. The SDK also keeps local session files.',pair:'Pair WeChat',start:'Start receiving tasks',stop:'Disconnect & cancel',scan:'Scan in WeChat and confirm. Codes expire after three minutes.',forget:'Forget credentials',inbox:'Task inbox',inboxNote:'Task acknowledgements, requests for input and final replies go back to WeChat.',empty:'After connecting, send your bot a message in WeChat. Tasks and replies will appear here.',commands:'Chat commands & permissions',help:'Send a task in plain language. /status checks progress; /cancel stops the task and clears the queue; /new starts fresh. Tool actions ask for a one-time /allow code or /deny code. Questions accept /answer code text.',risk:'An approved command can affect your computer beyond the selected folder. A reply ending does not prove the work succeeded. Disconnection cancels active work; tasks are never resumed automatically.',keySet:'Key saved with OS encryption. It is never sent to this view.',keyEmpty:'API billing required. Claude subscription login is not used.',noProject:'Choose a project before connecting.',disconnected:'Disconnected',connecting:'Connecting…',connected:'Receiving tasks',pairing:'Waiting for WeChat scan',paired:'WeChat paired',you:'You',agent:'Sprout Bot',notDesktop:'Open the desktop app to connect WeChat.',saved:'Key saved',confirmForget:'Forget API key and WeChat credentials? Active tasks will be cancelled.'},zh:{nav:'微信派活',title:'发条微信，让 Agent 开工。',subtitle:'微信里说清任务，小工坊在电脑上执行。',preview:'实验接入 · 尚未完成真实微信全链路验收。',setup:'连接你的工坊',scope:'一个微信主人、一个本机项目、一个 Claude Agent。运行时电脑需要保持开机。',project:'项目目录',choose:'选择文件夹',save:'保存密钥',budget:'每条任务的费用上限（美元）',privacy:'消息与任务输出会经过腾讯和 Anthropic。凭证使用系统加密；本页聊天仅保留在内存。SDK 另在本机保留会话文件。',pair:'连接微信',start:'开始接收任务',stop:'断开并取消任务',scan:'用微信扫码并确认，二维码三分钟后失效。',forget:'忘记凭证',inbox:'任务收件箱',inboxNote:'微信只收到接收确认、需要你介入的问题和最终回复。',empty:'连接后，在微信向 Bot 发一条任务。任务与回复会出现在这里。',commands:'聊天命令与操作权限',help:'直接用自然语言派活。/status 查看进度；/cancel 停止任务并清空队列；/new 开启新会话。工具操作需回复一次性的 /allow 验证码 或 /deny 验证码；问题可用 /answer 验证码 回答。',risk:'批准的命令可能影响所选文件夹以外的本机内容。回复结束不代表任务已成功。断开会取消执行，重启不会自动续跑。',keySet:'已使用系统加密保存。密钥不会回传到本页面。',keyEmpty:'需要 API 计费，不使用 Claude 订阅登录。',noProject:'先选择一个项目。',disconnected:'未连接',connecting:'正在连接…',connected:'正在接收任务',pairing:'等待微信扫码',paired:'微信已配对',you:'你',agent:'Sprout Bot',notDesktop:'请在桌面应用中连接微信。',saved:'密钥已保存',confirmForget:'忘记 API 密钥和微信凭证？当前任务会被取消。'}};
  Object.assign(words.en,{geminiNote:'Use a Google AI Studio API key. API billing is separate from a Gemini app subscription. Approved project file tools are available; shell commands are not.',doubaoNote:'Use a Volcengine Ark API key, not a Doubao app login. Approved project file tools are available; shell commands are not.'});
  Object.assign(words.zh,{geminiNote:'使用 Google AI Studio API key，按 API 用量计费，与 Gemini 应用订阅分开。项目文件操作需批准，不执行终端命令。',doubaoNote:'使用火山方舟 API key，不使用豆包应用登录。项目文件操作需批准，不执行终端命令。'});
  let lastCredentialScope='',credentialContext={profileId:'',expectedMode:'api',expectedChannel:'wechat'};
  const connectionDrafts=new Set(),connectionDraftIds=['bot-feishu-app-id','bot-feishu-owner','bot-x-account','bot-x-owner','bot-messenger-app','bot-messenger-page','bot-messenger-owner','bot-messenger-relay'];
  function sameCredentialOwner(scope){try{return JSON.stringify(JSON.parse(scope).slice(0,3))===JSON.stringify(JSON.parse(lastCredentialScope).slice(0,3));}catch{return false;}}
  function acceptConnectionDraft(scope,values){if(scope!==lastCredentialScope)return;for(const [id,value] of Object.entries(values))if($(id).value===value)connectionDrafts.delete(id);}
  Object.assign(words.en,{feishuChannel:'Feishu app bot',feishuSetup:'Use a Feishu internal app bot with the official long connection. No public callback URL is required. Only the configured owner’s private messages are accepted.',feishuOwner:'Your open_id in this app',feishuOwnerHint:'Use the owner’s open_id for this Feishu app. The first message never chooses the owner automatically.',feishuSave:'Save Feishu connection',feishuLimit:'App bot, not a personal account. No group chat or autonomous companion activity.'});
  Object.assign(words.zh,{feishuChannel:'飞书应用机器人',feishuSetup:'连接飞书企业自建应用机器人，使用官方长连接，无需公网回调地址。仅接收指定主人的私聊。',feishuOwner:'你在此应用内的 open_id',feishuOwnerHint:'填写主人在此飞书应用内的 open_id，不会把第一条消息的发送者自动设为主人。',feishuSave:'保存飞书连接',feishuLimit:'这是应用机器人，不是普通个人账号；不接群聊或自主陪伴活动。'});
  Object.assign(words.en,{xChannel:'X standard DMs · experimental',xSetup:'Connect standard one-to-one X DMs from one configured owner. Checks run about every 75 seconds; X API reads and writes may incur charges, in addition to AI usage.',xAccount:"AI account’s numeric X user ID",xOwner:'Your numeric X user ID',xOwnerHint:'Use account IDs, not @usernames. Only this owner’s direct text is accepted.',xSave:'Save X connection',xLimit:'Use a user-authorized token with dm.read, dm.write, users.read and tweet.read. App-only tokens and encrypted X Chat are unsupported. Expired tokens need reauthorization. Confirm applicable X automation requirements before connecting; the app cannot verify platform approval.',xStopped:'X receiving was stopped with /unsubscribe. It stays off after restarting the app.',xResume:'Re-enable X receiving',xResumeHint:'This only clears the local stop. Choose Connect afterward to start receiving again.'});
  Object.assign(words.zh,{xChannel:'X 标准私信 · 实验',xSetup:'接收指定主人的 X 一对一普通私信，约 75 秒检查一次。除 AI 用量外，X API 的读取与发送也可能收费。',xAccount:'AI 账号的 X 数字用户 ID',xOwner:'你的 X 数字用户 ID',xOwnerHint:'填写数字账号 ID，不是 @用户名。仅接收这位主人的直接文字。',xSave:'保存 X 连接',xLimit:'需要用户已授权的令牌及 dm.read、dm.write、users.read、tweet.read 权限。不接 App-only 令牌或加密 X Chat；令牌过期后需重新授权。连接前核实适用的 X 自动化要求，应用不能验证平台批准。',xStopped:'已通过 /unsubscribe 停止 X 接收，重启应用后也保持停用。',xResume:'重新启用 X 接收',xResumeHint:'这里只解除本机停用状态；之后仍需点击连接，才开始接收。'});
  Object.assign(words.en,{messengerChannel:'Messenger Page · experimental',messengerSetup:'Connect a Facebook Page to one configured owner. This needs a separately deployed public HTTPS relay; it is not a personal Facebook login.',messengerApp:'Meta App ID',messengerPage:'Facebook Page ID',messengerOwner:"Owner’s Page-scoped ID (PSID)",messengerRelay:'HTTPS relay origin',messengerRelayHint:'Use the origin only, without a path, query or credentials. The relay receives plaintext messages.',messengerRelayToken:'Relay access token',messengerSave:'Save Messenger connection',messengerRequirements:'Connection requirements',messengerLimit:'Requires approved Page messaging access, a subscribed webhook and a relay with a publicly trusted HTTPS certificate. App Secret and webhook verification token belong on the relay. Ordinary replies are limited to 24 hours after the owner’s message; no groups or autonomous activity.',messengerStopped:'Messenger receiving was stopped with /unsubscribe. It stays off after restarting the app.',messengerResume:'Re-enable Messenger receiving',messengerResumeHint:'This only clears the local stop. Choose Connect afterward to receive messages again.'});
  Object.assign(words.zh,{messengerChannel:'Messenger Page · 实验',messengerSetup:'让 Facebook Page 接收指定主人的私信。需要另行部署公网 HTTPS 中转服务，不是普通 Facebook 个人账号登录。',messengerApp:'Meta 应用 ID',messengerPage:'Facebook Page ID',messengerOwner:'主人在此 Page 内的 ID（PSID）',messengerRelay:'HTTPS 中转服务地址',messengerRelayHint:'只填协议与域名，不含路径、查询或凭据。中转服务会处理明文消息。',messengerRelayToken:'中转服务访问令牌',messengerSave:'保存 Messenger 连接',messengerRequirements:'连接前需要准备',messengerLimit:'需要适用的 Page 消息权限、已订阅的 webhook 和有公共可信证书的 HTTPS 中转服务。App Secret 与 webhook 验证令牌只放在中转服务器。普通回复限主人发消息后的 24 小时内；不接群聊或自主活动。',messengerStopped:'已通过 /unsubscribe 停止 Messenger 接收，重启应用后也保持停用。',messengerResume:'重新启用 Messenger 接收',messengerResumeHint:'这里只解除本机停用状态；之后仍需点击连接，才开始接收。'});
  let language='en',lastMessages='',lastMascot='',lastMode,state,setupPhase,persona={id:'sprout',name:{en:'Sprout',zh:'小芽'},portrait:'portraits/sprout-anime.png'};
  const savedConnectionHost=el('div');savedConnectionHost.id='bot-saved-connection-host';$('bot-problem').after(savedConnectionHost);
  const messageNodes=new Map();
  let localHistory=null,lastMessageScope='',threadNeedsBottom=false;
  function historyWords(){return language==='zh'?{earlier:'查看更早消息',loading:'正在读取…',end:'已显示本机保留的聊天记录',failed:'暂时无法读取，请重试。'}:{earlier:'View earlier messages',loading:'Loading…',end:'Showing the chat records kept on this device',failed:'Could not load earlier messages. Try again.'};}
  function historyPosition(){
    const pane=$('bot-thread-scroll'),top=pane.getBoundingClientRect().top;
    for(const row of $('bot-messages').children){const rect=row.getBoundingClientRect();if(row.dataset.messageId&&rect.bottom>top&&rect.top<top+pane.clientHeight)return {key:row.dataset.messageId,offset:rect.top-top};}
    return null;
  }
  function restoreHistoryPosition(anchor,scroll){
    const pane=$('bot-thread-scroll'),row=anchor&&messageNodes.get(anchor.key)?.row;
    if(row?.isConnected)pane.scrollTop+=row.getBoundingClientRect().top-pane.getBoundingClientRect().top-anchor.offset;
    else pane.scrollTop=scroll;
    $('bot-latest').hidden=atBottom();
  }
  function drawLocalHistory(){
    const current=localHistory;if(!current)return;
    const anchor=historyPosition(),scroll=$('bot-thread-scroll').scrollTop;
    const words=historyWords(),local=current.kind==='local'?state?.local:state?.tasks,initial=current.kind==='local'?30:60,rows=current.kind==='local'?local?.history:local?.messages,visible=local?.hasEarlierHistory===true||(local?.historyLimit>initial&&rows?.length>0);
    current.host.hidden=!visible;
    current.button.hidden=local?.hasEarlierHistory!==true;
    current.button.disabled=current.pending;
    current.button.textContent=current.pending?words.loading:words.earlier;
    current.host.setAttribute('aria-busy',String(current.pending));
    current.feedback.textContent=current.error?words.failed:local?.hasEarlierHistory===false&&local?.historyLimit>initial&&rows?.length?words.end:'';
    current.feedback.hidden=!current.feedback.textContent;
    if(anchor)restoreHistoryPosition(anchor,scroll);
  }
  function syncLocalHistory(next){
    const kind=next.desktopChat?.kind==='local'?'local':'channel',local=kind==='local'?next.bot?.local:next.bot?.channel==='qq'?next.bot?.tasks:null,accountId=next.accounts?.selectedId,historyId=local?.historyId;
    const method=kind==='local'?'desktopLocalHistory':'desktopChannelHistory';
    const key=typeof accountId==='string'&&typeof historyId==='string'&&historyId&&typeof window.arcade[method]==='function'?JSON.stringify([accountId,kind,historyId]):null;
    if(localHistory?.key!==key){
      localHistory?.host.remove();localHistory=null;
      if(key){
        const host=el('div','local-history-control'),button=el('button','plain'),feedback=el('p','local-history-feedback');
        host.id='desktop-history';button.id='desktop-history-earlier';button.type='button';feedback.id='desktop-history-feedback';feedback.tabIndex=-1;feedback.setAttribute('role','status');host.append(button,feedback);$('bot-messages').before(host);
        const current=localHistory={key,kind,accountId,historyId,host,button,feedback,pending:false,error:false};
        button.onclick=async()=>{
          if(localHistory!==current||current.pending||(current.kind==='local'?state?.local:state?.tasks)?.hasEarlierHistory!==true)return;
          const ownedFocus=document.activeElement===button;
          current.pending=true;current.error=false;drawLocalHistory();
          try{const result=await window.arcade[method]({accountId,historyId});if(localHistory===current&&(result?.ok!==true||result.historyId!==historyId))current.error=true;}
          catch{if(localHistory===current)current.error=true;}
          finally{if(localHistory===current){current.pending=false;drawLocalHistory();if(ownedFocus&&document.body.dataset.view==='bot'&&[document.body,button].includes(document.activeElement)){if(!button.hidden)button.focus({preventScroll:true});else if(!feedback.hidden)feedback.focus({preventScroll:true});}}}
        };
      }
    }
    drawLocalHistory();
  }

  words.en.access='On your phone, open WeChat → Me → Settings → Plugins → ClawBot, enable it, then scan below. Send tasks in the ClawBot conversation, not to an ordinary contact named Agent Arcade. If this entry is missing, client compatibility or account availability remains unverified.';
  words.zh.access='手机微信：我 → 设置 → 插件 → ClawBot，启用后再扫码。任务入口是 ClawBot 对话，不是名为 Agent Arcade 的普通好友。若没有此入口，当前客户端适配或账号可用性仍待核实。';
  words.en.scan='Enable ClawBot in mobile WeChat, then scan and confirm. Codes expire after three minutes.';words.zh.scan='在手机微信启用 ClawBot 后扫码并确认，二维码三分钟后失效。';
  words.en.empty='After starting reception, send a task in the WeChat ClawBot conversation. Tasks and replies will appear here.';words.zh.empty='开始接收任务后，在微信 ClawBot 对话中发一条任务。任务与回复会出现在这里。';
  words.en.paired='Authorization credentials saved';words.zh.paired='授权凭证已保存';
  words.en.repair='Pair WeChat again';words.zh.repair='重新扫码配对';
  words.en.connected='You can send a message';words.zh.connected='可以发消息';
  words.en.received='WeChat message received';words.zh.received='已收到微信消息';
  words.en.incoming='Texts received this connection';words.zh.incoming='本次连接收到文本';
  words.en.outgoing='returns accepted by platform';words.zh.outgoing='平台受理回传';
  words.en.notRead='not read receipts';words.zh.notRead='不代表已读';
  words.en.connectionDetails='Connection details';words.zh.connectionDetails='连接详情';
  Object.assign(words.en,{nav:'WeChat',title:'WeChat',setup:'Connection settings',pair:'Pair WeChat',pairStep:'Pair WeChat',projectStep:'Choose a project and execution method',startStep:'Start the connection',startNote:'Pairing alone does not start work. Send your instruction from WeChat after connecting.',privacyTitle:'Privacy and saved credentials',nativeRequirements:'Login, requirements and permissions',messageEntry:'Send messages in WeChat → ClawBot. This window displays the conversation.',preview:'Preview · live WeChat acceptance is incomplete.',inbox:'Conversation',inboxNote:'Received WeChat messages and agent replies.',access:'On your phone, enable WeChat → Me → Settings → Plugins → ClawBot, then scan below. Use the ClawBot conversation, not an Agent Arcade contact. If the entry is missing, client or account availability is unverified.'});
  Object.assign(words.zh,{nav:'微信',title:'微信',setup:'连接设置',pair:'配对微信',pairStep:'配对微信',projectStep:'选择项目和执行方式',startStep:'启动连接',startNote:'配对不会自动开始执行。连接后请从微信发出指令。',privacyTitle:'隐私与已保存凭证',nativeRequirements:'登录、运行要求与权限',messageEntry:'消息入口：微信 → ClawBot。本窗口用于查看对话。',preview:'预览版 · 微信集成仍有未验收项。',inbox:'对话',inboxNote:'收到的微信消息与 Agent 回复。',access:'手机微信：我 → 设置 → 插件 → ClawBot，启用后扫码。入口是 ClawBot 对话，不是 Agent Arcade 普通好友；如果没有此入口，客户端或账号可用性仍待核实。'});
  Object.assign(words.en,{
    mode:'Execution method',modeApi:'API agent',modeNative:'Claude Channels · manual startup',modeClaude:'Local Claude · program mode',claudeSetup:'Uses your installed original Claude Code and its existing login, without loading custom Channels or opening a terminal for each connection. Requires Claude Code 2.1.317. Tool actions still need approval; this app does not read Claude credentials.',
    budget:'SDK cost threshold (USD)',budgetNote:'In-flight requests may exceed this threshold. It is not a hard billing cap.',
    nativeSetup:'Uses Claude Code and its existing login; this app does not read Claude credentials. Requires Node.js 22.13+ and local Claude Code 2.1.317. Open Claude below, then complete the original CLI prompts and confirm the custom Channels research preview yourself.',
    nativeReplyPermission:'This launch pre-allows WeChat replies for this session, so ordinary chat does not need repeated confirmation. Other actions still follow your CLI permissions.',
    nativeStopNote:'Disconnecting WeChat also stops a session launched by this app. A manually opened CLI must be stopped in its original terminal with Ctrl+C. Stop verification covers this app’s Claude process tree; independent background jobs are not confirmed.',
    keyRetained:'Your saved API key stays stored when switching modes.',nativeCommand:'Manual launch command',copyCommand:'Copy launch command',copied:'Launch command copied',
    nativeLaunch:'Open Claude',nativeResume:'Resume last session',nativeNew:'Open new session',nativeHalt:'Stop local session',nativeStarting:'Opening Claude…',nativeStopping:'Stopping this session…',nativeRunning:'Claude is open; the channel is not connected yet. Check the original terminal for startup prompts.',nativeSessionReady:'Keep this Claude session open and continue in your chat.',nativeStoppedMain:'Local session stopped',nativeStopped:'This local session has stopped. Resume it when you are ready.',nativeUnknown:'The local process state could not be confirmed. Check its original terminal.',nativeLaunchNote:'Open the original Claude terminal and complete its prompts yourself.',nativeStopScope:'Only this app’s Claude process tree is checked; independent background jobs are not confirmed.',
    nativeStart:'Connect WeChat',nativeStop:'Disconnect WeChat (CLI may keep running)',nativeDisconnecting:'Disconnecting WeChat…',nativeStartNote:'After connecting, open Claude below and complete its prompts. Then send a message in WeChat.',
    nativePrivacy:'WeChat messages pass through Tencent. The original Claude Code CLI uses its normal service and local session storage. WeChat credentials use OS encryption.',
    nativeInbox:'Conversation',nativeInboxNote:'Your current Claude conversation, continued from WeChat.',
    nativeEmpty:'Open Claude in Conversation settings, then send a message from WeChat.',
    nativeHelp:'Chat normally in ClawBot; messages share one Claude conversation. WeChat replies are pre-allowed for this session; other actions follow existing CLI permissions. For a new permission, review the request and copy its /allow CODE or /deny CODE. /status checks the connection and current requests. Send 停止 or /cancel to stop a session launched by this app; /resume explicitly resumes that session. For a manually opened CLI, stop it in its original terminal.',
    nativeRisk:'The CLI keeps its normal local permissions. Commands may affect files beyond the selected folder. A response ending does not verify the work. Disconnecting WeChat does not guarantee that Claude stops.',
    nativeConfirmForget:'Forget the saved API key and WeChat credentials? Forwarding will stop, but Claude may keep running in its terminal.',
    nativeOpenClaude:'Waiting for you to open Claude',nativeAwaitingChannel:'Waiting for Claude channel',nativeAwaitingHint:'Claude is open. Complete its channel startup prompt in the original terminal; you do not need to reconnect the chat account.',nativeNeedsApproval:'Waiting for your approval',nativePausedMain:'WeChat forwarding paused',
    nativeOpenHint:'Open Conversation settings, choose Open Claude, and complete the original CLI prompts yourself.',nativeReadyHint:'Say what you need in the WeChat ClawBot conversation.',nativeReceivedHint:'Your message arrived. Look for the reply in WeChat.',nativeApprovalHint:'Review the operation request in WeChat before allowing it.',nativePausedHint:'Check the local session in Conversation settings. A manually opened CLI must be stopped in its original terminal.',
    nativeDiagnosticNote:'MCP initialization does not confirm that Claude registered the channel, received a message, or started work. A connection or reply does not prove task success.',
    nativeAttached:'MCP bridge initialized · CLI receipt and execution unverified',nativeDetached:'Waiting for CLI connection',nativePaused:'New WeChat forwarding paused · CLI may keep running',nativeForwarded:'submitted to local channel',nativeReplies:'replies from CLI',nativeDeliveryFailed:'WeChat delivery failed. Use /status to retrieve pending permission requests; inspect ordinary replies here.'
  });
  Object.assign(words.zh,{
    mode:'执行方式',modeApi:'API Agent',modeNative:'Claude Channels · 手动启动',modeClaude:'本机 Claude · 程序模式',claudeSetup:'使用已安装的原版 Claude Code 和既有登录，不加载自定义 Channels，也不需要每次连接打开终端确认。需要 Claude Code 2.1.317。工具操作仍需批准；本应用不读取 Claude 凭据。',
    budget:'SDK 费用阈值（美元）',budgetNote:'在途请求可能超过此阈值，它不是计费硬上限。',
    nativeSetup:'使用 Claude Code 的既有登录，本应用不读取 Claude 凭据。需要 Node.js 22.13+ 和本机 Claude Code 2.1.317。点击下方“打开 Claude”，再由你完成原版 CLI 的启动提示及自定义 Channels 研究预览确认。',
    nativeReplyPermission:'本次启动预先允许微信回复，避免普通聊天重复确认；其他操作仍遵循 CLI 权限。',
    nativeStopNote:'断开微信也会停止此应用启动的会话；手动打开的 CLI 请在原终端按 Ctrl+C 停止。停止核验只覆盖此应用启动的 Claude 进程树，独立后台作业未确认。',
    keyRetained:'切换方式会保留已保存的 API key。',nativeCommand:'手动启动命令',copyCommand:'复制启动命令',copied:'启动命令已复制',
    nativeLaunch:'打开 Claude',nativeResume:'恢复上次会话',nativeNew:'打开新会话',nativeHalt:'停止本机会话',nativeStarting:'正在打开 Claude…',nativeStopping:'正在停止本机会话…',nativeRunning:'Claude 已打开，通道尚未连接。请查看原版终端的启动提示。',nativeSessionReady:'保持此 Claude 会话打开，继续在聊天中发送消息。',nativeStoppedMain:'本机会话已停止',nativeStopped:'本机会话已停止，需要时可恢复继续。',nativeUnknown:'尚未确认本机进程状态，请在原终端检查。',nativeLaunchNote:'会打开原版 Claude 终端，启动和权限提示由你亲自确认。',nativeStopScope:'仅核验此应用启动的 Claude 进程树；独立后台作业未确认。',
    nativeStart:'连接微信',nativeStop:'断开微信（CLI 可能仍运行）',nativeDisconnecting:'正在断开微信…',nativeStartNote:'连接后点击下方“打开 Claude”，完成原版 CLI 提示，再到微信发消息。',
    nativePrivacy:'微信消息经过腾讯。原版 Claude Code CLI 使用其常规服务与本机会话存储；微信凭证使用系统加密。',
    nativeInbox:'对话',nativeInboxNote:'在微信延续当前 Claude 会话。',
    nativeEmpty:'在对话设置中打开 Claude，再到微信发消息。',
    nativeHelp:'在 ClawBot 里正常聊天，消息共用同一个 Claude 会话。本次会话预许可微信回复工具，其他操作沿用 CLI 既有权限。请求新权限时，先核对操作，再复制对应的 /allow CODE 或 /deny CODE。/status 查看连接和当前请求。发送“停止”或 /cancel 可停止此应用启动的会话；/resume 明确恢复该会话。手动打开的 CLI 仍需在原终端停止。',
    nativeRisk:'CLI 保留其正常本机权限，命令可能影响所选目录以外的内容。回复结束不代表任务通过验证。断开微信不能保证 Claude 停止。',
    nativeConfirmForget:'忘记已保存的 API key 和微信凭证？转发会停止，但终端中的 Claude 可能仍在运行。',
    nativeOpenClaude:'等你打开 Claude',nativeAwaitingChannel:'等待 Claude 通道连接',nativeAwaitingHint:'Claude 已打开。请在原版终端完成通道启动提示，不需要重新连接聊天账号。',nativeNeedsApproval:'等你确认操作',nativePausedMain:'微信转发已暂停',
    nativeOpenHint:'展开对话设置，点击“打开 Claude”，亲自完成原版 CLI 提示。',nativeReadyHint:'到微信 ClawBot 对话里说需求。',nativeReceivedHint:'消息已到，请留意微信中的回复。',nativeApprovalHint:'请先核对微信里的操作请求，再决定是否允许。',nativePausedHint:'可在对话设置中查看本机会话；手动打开的 CLI 请在原终端停止。',
    nativeDiagnosticNote:'MCP 初始化不代表 Claude 已注册通道、接收消息或开始执行。连接和回复都不能证明任务成功。',
    nativeAttached:'MCP 桥接已初始化·CLI 接收和执行未验证',nativeDetached:'等待 CLI 连接',nativePaused:'新微信转发已暂停·CLI 可能仍运行',nativeForwarded:'已提交本机通道',nativeReplies:'CLI 回传',nativeDeliveryFailed:'微信回传失败。权限请求可发 /status 重取；普通回复请在本机检查。'
  });
  words.en.disconnecting='Stopping the local task…';words.zh.disconnecting='正在停止本机任务…';
  copy.en.localNote='Observer events stay on this device.';copy.zh.localNote='观察器事件留在本机。';
  const word=k=>words[language][k]||k;
  const run=fn=>action(async()=>{if(!window.arcade.botConfigure)throw Error(word('notDesktop'));try{await fn();}catch(error){if(error?.code==='credentials_busy'||String(error?.message||'').endsWith('(credentials_busy)'))throw Error(language==='zh'?'这位搭档的凭据正在清除。请等待完成后重新打开设置，再保存或连接。':'This companion’s credentials are being cleared. Wait for completion, then reopen settings before saving or connecting.');if(error?.code==='credential_scope_changed'||String(error?.message||'').endsWith('(credential_scope_changed)'))throw Error(language==='zh'?'搭档或连接方式已变化。请重新打开对应搭档的连接设置，再修改凭据。':'The companion or connection method changed. Reopen that companion’s connection settings before changing credentials.');throw error;}});
  Object.assign(words.en,{title:'WeChat conversation',settingsToggle:'Connection',closeSettings:'Close connection settings',copyReply:'Copy reply',replyCopied:'Reply copied',latest:'Latest messages',emptyTitle:'Your conversation starts in WeChat',emptySetup:'Connect ClawBot and choose where Claude will work. Messages and replies will appear here.',emptyReady:'Send your first message to ClawBot on your phone.',openSetup:'Set up connection'});
  Object.assign(words.zh,{title:'微信对话',settingsToggle:'连接设置',closeSettings:'收起连接设置',copyReply:'复制回复',replyCopied:'回复已复制',latest:'查看最新消息',emptyTitle:'从微信，开始一段对话',emptySetup:'连接 ClawBot，选择 Claude 的工作目录。你发出的消息和收到的回复，会显示在这里。',emptyReady:'到手机微信的 ClawBot 对话里，发出第一条消息。',openSetup:'设置连接'});
  Object.assign(words.en,{nativeStop:'Disconnect WeChat',nativeInboxNote:'Local Claude Code',received:'Message received',connected:'WeChat connected'});
  Object.assign(words.zh,{nativeStop:'断开微信',nativeInboxNote:'本机 Claude Code',received:'已收到消息',connected:'微信已连接'});
  Object.assign(words.en,{nav:'Chats',title:'Sprout',agent:'Sprout',emptyTitle:'Your AI, one conversation away',emptySetup:'Choose a channel and an AI connection. WeChat and Claude are available in this preview.',inboxNote:'WeChat / Claude',settingsToggle:'Conversation settings'});
  Object.assign(words.zh,{nav:'对话',title:'小芽',agent:'小芽',emptyTitle:'和你的 AI 搭档聊聊',emptySetup:'选好聊天渠道和 AI 接入方式，就可以开始。目前可连接微信与 Claude。',inboxNote:'微信 / Claude',settingsToggle:'对话设置'});
  Object.assign(words.en,{channel:'Chat channel',qqSetup:'Use a separate QQ account signed into a local OneBot bridge, such as NapCat. Unofficial and experimental; private text from the configured owner only. Add that QQ account as a friend. Account availability is not guaranteed.',qqUrl:'Local WebSocket address',qqOwner:'Your QQ number (allowed sender)',qqSave:'Save QQ connection',modeApi:'Claude API',modeCodex:'Local Codex',model:'Model',gptNote:'Use a separate OpenAI API key; API usage is billed. Local Codex login does not replace this key. Approved project file tools are available; shell commands are not. There is no dollar cap.',deepseekNote:'DeepSeek API billing applies. Approved local file tools are available; shell commands are not. Limits are per request and turn, not a dollar cap.',codexSetup:'Uses your installed Codex and its existing login through App Server; no separate API key. Workspace changes use Codex sandbox rules. When Codex asks, review and approve the exact action. Stops interrupt the current turn.',emptySetup:'Choose a chat channel and an AI connection. Your messages and replies will appear here.',emptyReady:'Send a private message from the configured account to begin.',confirmForget:'Forget all saved API keys and messaging credentials? Active work will be cancelled.'});
  Object.assign(words.zh,{channel:'聊天渠道',qqSetup:'用独立 QQ 账号登录本机 OneBot 桥接（例如 NapCat），然后加它为好友。此接入非官方、属实验功能，目前只接指定主人的私聊文字；账号可用性不作保证。',qqUrl:'本机 WebSocket 地址',qqOwner:'你的 QQ 号（允许派活的人）',qqSave:'保存 QQ 连接',modeApi:'Claude API',modeCodex:'本机 Codex',model:'模型',gptNote:'使用独立 OpenAI API key，按 API 用量计费；本机 Codex 登录不代替此密钥。支持经批准的项目文件操作，不执行终端命令，不设美元费用上限。',deepseekNote:'使用 DeepSeek API 计费。支持经批准的本地文件操作，暂不执行终端命令。限制请求次数与长度，不设美元费用上限。',codexSetup:'通过 App Server 使用本机 Codex 的既有登录，无需另配 API key。项目内操作遵循 Codex 沙箱规则；遇到权限请求时核对并批准具体操作。“停止”会中断当前回合。',emptySetup:'选择聊天渠道和 AI 接入方式。你发出的消息和收到的回复，会显示在这里。',emptyReady:'从指定的账号发一条私聊，即可开始。',confirmForget:'忘记所有已保存的 API key 与聊天渠道凭证？当前执行会被取消。'});
  Object.assign(words.en,{
    qqSetup:'Give your AI its own QQ account. Add it as a friend and chat or send tasks privately. This experimental bridge is not an official Tencent integration.',
    qqLoginTitle:"Sign in to the AI's QQ",qqLoginNote:"Install NapCat separately and sign in with the AI's QQ account. Add it from your own QQ, then accept the friend request in that account.",qqDownload:'Get NapCat',qqGuide:'Connection guide',
    qqBridgeTitle:'Connect on this computer',qqBridgeNote:'In NapCat, add a forward WebSocket server: Universal (API + events), Array format, host 127.0.0.1, port 3001, path /. Turn off self-message reporting and keep the 30-second heartbeat.',qqPrepare:'Generate connection token',qqPrepared:'Token ready',qqCopyConfig:'Copy NapCat configuration',qqCopyToken:'Copy token only',qqConfigHelp:'Where to use the copied configuration',qqConfigHelpNote:'The configuration is one websocketServers entry, not a whole file. In NapCat Desktop, fill the fields above and paste the token. Save the connection, then save the Bot configuration; restart if prompted.',qqAdvanced:'Use an existing connection or another port',qqTokenHint:'Use the OneBot token, not the WebUI password. Leave blank to keep the saved token.',
    qqCheckTitle:'Check which account is connected',qqOwnerNote:"Enter your own QQ number, not the AI's. Only your friend-private messages are accepted; groups and other senders are ignored.",qqTest:'Test connection',qqTesting:'Checking QQ…',checking:'Checking QQ…',qqSaved:'QQ connection saved',qqTokenPrepared:'Connection token saved with OS encryption',qqConfigCopied:'NapCat configuration copied. It contains your connection token.',qqTokenCopied:'Connection token copied',qqCheckEmpty:'Account not checked yet',qqCheckEmptyNote:'Save your QQ number and connection settings, then test. No message or AI task will be sent.',qqCheckFailed:'Could not check the QQ connection',qqCheckOnly:'This checks the bridge and account; a real private-message round trip is still unverified.'
  });
  Object.assign(words.zh,{
    qqSetup:'让 AI 使用独立 QQ 账号。加它为好友，在私聊里聊天或派活。此桥接为实验功能，非腾讯官方接入。',
    qqLoginTitle:'登录 AI 的 QQ',qqLoginNote:'独立安装 NapCat，用 AI 的 QQ 账号登录。再用你自己的 QQ 加它为好友，并在 AI 账号里手动通过申请。',qqDownload:'获取 NapCat',qqGuide:'配置指引',
    qqBridgeTitle:'配置本机连接',qqBridgeNote:'在 NapCat 新建 WS 正向服务器：Universal（API＋事件）、Array 格式，主机 127.0.0.1、端口 3001、路径 /。关闭自身消息上报，保留 30 秒心跳。',qqPrepare:'生成连接令牌',qqPrepared:'令牌已准备',qqCopyConfig:'复制 NapCat 配置',qqCopyToken:'只复制令牌',qqConfigHelp:'复制后怎么用',qqConfigHelpNote:'配置是 websocketServers 里的单个条目，不是整份文件。使用 NapCat Desktop 时，按上方逐项填写并粘贴令牌。先保存连接，再保存 Bot 配置；有提示时重启。',qqAdvanced:'已有连接或需要更换端口',qqTokenHint:'填写 OneBot token，不是 WebUI 密码。留空保留已保存令牌。',
    qqCheckTitle:'核对连接的账号',qqOwnerNote:'填你自己的 QQ，不是 AI 的 QQ。只接收你的好友私聊，群聊及其他人不会触发任务。',qqTest:'测试连接',qqTesting:'正在检查 QQ…',checking:'正在检查 QQ…',qqSaved:'QQ 连接已保存',qqTokenPrepared:'连接令牌已使用系统加密保存',qqConfigCopied:'NapCat 配置已复制，其中含连接令牌。',qqTokenCopied:'连接令牌已复制',qqCheckEmpty:'尚未核对账号',qqCheckEmptyNote:'保存你的 QQ 号与连接设置后再检查。检查不会发消息，也不会派发 AI 任务。',qqCheckFailed:'未能检查 QQ 连接',qqCheckOnly:'这里只核对本机连接与账号；真实私聊收发仍待验证。'
  });
  Object.assign(words.en,{setup:'Conversation settings',closeSettings:'Close conversation settings',advancedGroup:'Channels and tasks (advanced)',projectStep:'AI',aiService:'AI service',localControls:'The App conversation replies only in this window and is stored separately on this computer.',characterSettings:'Preset, lorebook and sampling for this character are in the character library'});
  Object.assign(words.zh,{setup:'对话设置',closeSettings:'收起对话设置',advancedGroup:'渠道与派活（高级）',projectStep:'AI',aiService:'AI 服务',localControls:'App 对话只在这个窗口里回复，聊天记录单独保存在这台电脑上。',characterSettings:'这位角色的预设、世界书和采样，在角色库里设置'});
  // Conversation settings panel. The App conversation needs only the AI service, its model and
  // key; channel pairing, the project folder, the SDK threshold, connection start, diagnostics and
  // chat commands sit in one disclosure below. Every control keeps its id, handler and value.
  const setupSteps=document.querySelectorAll('.bot-setup-content>fieldset.setup-step'),aiStep=setupSteps[1];
  const advancedGroup=el('details','bot-help bot-advanced');advancedGroup.id='bot-advanced';
  {
    const summary=el('summary'),project=el('div','bot-advanced-project');summary.dataset.bot='advancedGroup';
    project.append(document.querySelector('label[for="bot-project"]'),document.querySelector('.bot-project-row'));
    advancedGroup.append(summary,setupSteps[0],project,$('bot-claude-budget'),setupSteps[2],$('bot-connection-details'),document.querySelector('[data-bot="commands"]').closest('details'));
  }
  // desktop-chat.js puts "Pause App chat" here; the note says what the App conversation is.
  const localControls=el('div','bot-local-controls'),localNote=el('p','bot-fine');localControls.id='bot-local-controls';localControls.hidden=true;localNote.dataset.bot='localControls';localControls.append(localNote);
  const characterSettings=el('button','plain bot-character-settings');characterSettings.id='bot-character-settings';characterSettings.type='button';characterSettings.hidden=true;characterSettings.dataset.bot='characterSettings';
  characterSettings.onclick=()=>{setSetupOpen(false);if(window.ArcadeCharactersTabs?.open)window.ArcadeCharactersTabs.open('settings');else switchView('characters');};
  aiStep.after(localControls,characterSettings,advancedGroup);
  let advancedPhase;
  const managedQQ=typeof window.arcade.qqRuntimeRefresh==='function';
  if(managedQQ){
    Object.assign(words.en,{qqManageTitle:'Choose a QQ account and bind a companion',qqManage:'Manage QQ accounts',qqManageNote:'Add or select a QQ account, sign in when needed, then bind it to a companion. After saving the binding, open Manage companions and choose Connect.',qqManual:'Advanced: manual connection settings'});
    Object.assign(words.zh,{qqManageTitle:'选择 QQ 并绑定搭档',qqManage:'管理 QQ 账号',qqManageNote:'添加或选择 QQ 账号，按需登录后绑定搭档。保存绑定后，在「管理搭档」中点击「连接」。',qqManual:'高级配置：手动连接'});
    const options=$('bot-qq-options'),manual=el('details','bot-help');manual.id='bot-qq-manual';
    const summary=el('summary');summary.dataset.bot='qqManual';manual.append(summary);
    // Move the original controls once: keep their IDs, handlers and saved values.
    for(const section of [...options.children])if(section.classList.contains('qq-setup-part'))manual.append(section);
    const managed=el('div','qq-setup-part');managed.id='bot-qq-managed';
    const heading=el('h3'),note=el('p'),button=el('button','primary');
    heading.dataset.bot='qqManageTitle';note.dataset.bot='qqManageNote';button.dataset.bot='qqManage';
    button.id='bot-qq-manage';button.type='button';button.onclick=()=>{setSetupOpen(false);const current=data?.accounts?.accounts?.find(row=>row.id===data.accounts.selectedId);window.openQQRuntime?.({accountId:current?.expectedQQAccountId||current?.accountId||current?.qqBinding?.accountId});};
    managed.append(heading,note,button);options.append(managed,manual);
    const runtime=el('button','plain');runtime.id='bot-problem-qq-runtime';runtime.hidden=true;runtime.onclick=button.onclick;$('bot-problem').after(runtime);
  }
  function renderQQCheck(qqState,status){
    const check=qqState?.check,zh=language==='zh',node=$('bot-qq-check');
    node.dataset.state=check?.state||'empty';
    let title=word('qqCheckEmpty'),detail=word('qqCheckEmptyNote');
    if(status==='checking'||check?.state==='checking'){
      title=word('qqTesting');detail=zh?'正在读取登录账号、在线状态和好友关系。不会发送消息或启动 AI。':'Reading the login identity, online status and friendship. No message or AI request is sent.';
    }else if(check?.state==='checked'){
      const name=[check.nickname,check.accountId?`(${check.accountId})`:''].filter(Boolean).join(' ');
      title=(zh?'已识别 QQ：':'QQ identified: ')+name;
      const online=check.online===true?(zh?'账号在线。':'The account is online.'):check.online===false?(managedQQ?(zh?'账号当前离线。请打开“管理 QQ 账号”核对登录后重新检查。':'The account is offline. Open Manage QQ accounts, check sign-in, then test again.'):(zh?'账号当前离线。请在 NapCat 登录后重新检查。':'The account is offline. Sign in through NapCat and test again.')):(managedQQ?(zh?'在线状态尚未核实。请打开“管理 QQ 账号”核对对应账号。':'Online status is unknown. Inspect the account in Manage QQ accounts.'):(zh?'在线状态尚未核实。请在 NapCat 确认已登录。':'Online status is unknown. Confirm the login in NapCat.'));
      const friend=check.ownerIsFriend===true?(zh?'已核对：你的 QQ 在此账号的好友列表中。':'Your QQ is in this account’s friend list.'):check.ownerIsFriend===false?(zh?'尚未找到你的 QQ 好友关系。请互加好友，在 AI 账号通过申请后重新检查。':'Your QQ was not found as a friend. Add the accounts as friends, accept in the AI account, then test again.'):(zh?'好友关系尚未核实。请确认已互加好友。':'Friendship is unverified. Confirm the accounts are friends.');
      detail=[online,friend,word('qqCheckOnly')].join(' ');
      if(check.online===false||check.ownerIsFriend===false)node.dataset.state='attention';
      else if(check.online!==true||check.ownerIsFriend!==true)node.dataset.state='unknown';
    }else if(check?.state==='failed'){
      title=word('qqCheckFailed');
      const reasons={
        unauthorized:zh?'令牌未通过验证。请核对 NapCat 的 OneBot token，不要使用 WebUI 密码。':'Authentication failed. Match the NapCat OneBot token; do not use the WebUI password.',
        invalid_token:zh?'请生成连接令牌，或保存有效的 OneBot token。':'Generate a connection token or save a valid OneBot token.',
        invalid_owner:zh?'请填写你自己的有效 QQ 号，再保存设置。':'Enter your valid QQ number and save the settings.',
        invalid_bridge_url:zh?'请使用本机 WebSocket 地址，例如 ws://127.0.0.1:3001/。':'Use a local WebSocket address such as ws://127.0.0.1:3001/.',
        owner_is_agent_account:zh?'你填写的是 AI 自己的 QQ。请改为你用来发消息的 QQ 号。':'The allowed sender is the AI account itself. Enter the QQ number you will message from.',
        account_changed:zh?'桥接登录账号已变化。请核对 NapCat 账号后重新检查。':'The bridge account changed. Check the NapCat account and test again.',
        invalid_login_info:zh?'桥接未返回有效的登录账号。请确认 QQ 已登录，并使用 WS 正向 Universal 连接。':'The bridge did not return a valid account. Confirm QQ is signed in and use a forward Universal WebSocket connection.',
        account_offline:managedQQ?(zh?'QQ 当前离线。请打开“管理 QQ 账号”核对状态，按需登录后重新检查。':'QQ is offline. Inspect Manage QQ accounts, sign in if needed, then test again.'):(zh?'QQ 当前离线。请在 NapCat 登录后重新检查。':'QQ is offline. Sign in through NapCat and test again.'),
        connect_timeout:zh?'检查超时。请确认 QQ 已登录、连接已启用并保存，且端口与令牌一致。':'The check timed out. Confirm QQ is signed in, the connection is enabled and saved, and the port and token match.',
        timeout:zh?'检查超时。请确认 QQ 已登录、连接已启用并保存，且端口与令牌一致。':'The check timed out. Confirm QQ is signed in, the connection is enabled and saved, and the port and token match.'
      };
      detail=reasons[check.code]||(zh?'无法连接本机 QQ。请确认 NapCat 正在运行、WS 正向连接已启用并保存，地址和令牌一致。':'Could not reach the local QQ bridge. Confirm NapCat is running and the forward WebSocket connection is enabled, saved, and uses the same address and token.');
    }
    $('bot-qq-check-title').textContent=title;$('bot-qq-check-detail').textContent=detail;
  }
  async function saveQQSettings(requireOwner=true){
    const context=credentialContext,scope=lastCredentialScope,token=$('bot-qq-token').value;$('bot-qq-token').value='';
    const owner=$('bot-qq-owner').value;
    await window.arcade.botConfigure({...context,qqUrl:$('bot-qq-url').value,...(requireOwner||owner?{qqOwnerId:owner}:{}),...(token?{qqToken:token}:{})});
    if(!sameCredentialOwner(scope))throw Object.assign(Error('(credential_scope_changed)'),{code:'credential_scope_changed'});
  }
  function setSetupOpen(open,focus=false){
    const panel=$('bot-setup-panel');
    const inside=panel.contains(document.activeElement);
    panel.open=open;
    $('bot-settings-toggle').setAttribute('aria-expanded',String(open));
    if(focus){if(open){if(innerWidth<=800||document.body.classList.contains('compact'))panel.scrollIntoView({block:'start',behavior:'auto'});$('bot-settings-close').focus();}else $('bot-settings-toggle').focus({preventScroll:true});}
    else if(!open&&inside)$('bot-settings-toggle').focus({preventScroll:true});
  }
  window.openConversationSetup=({section,pair=false}={})=>{
    switchView('bot');setSetupOpen(true,true);
    if(section)advancedGroup.open=true;
    const target=section==='channel'?$('bot-channel'):section==='project'?$('bot-pick'):section==='advanced'?advancedGroup.querySelector('summary'):null;
    if(target){target.scrollIntoView({block:'center',behavior:'auto'});target.focus({preventScroll:true});}
    // A saved pairing is retained. Only an explicit, unpaired WeChat setup
    // starts a new QR flow; opening connection settings never resets a login.
    if(pair&&state?.channel==='wechat'&&!state?.paired&&state?.status==='disconnected')void run(()=>window.arcade.botLogin());
  };
  function atBottom(){const pane=$('bot-thread-scroll');return pane.scrollHeight-pane.scrollTop-pane.clientHeight<64;}
  function showLatest(){const pane=$('bot-thread-scroll');pane.scrollTop=pane.scrollHeight;$('bot-latest').hidden=true;}
  function renderMessages(messages,native,active,portrait,desktopAvailable=false,localConversation=false,position=null){
    const pane=$('bot-thread-scroll'),follow=position?.follow??atBottom(),oldScroll=position?.scroll??pane.scrollTop,anchor=position?.anchor??historyPosition();
    const first=messages[0]?.id,prepend=!!first&&messageNodes.size>0&&!messageNodes.has(first)&&messages.some(m=>messageNodes.has(m.id));
    const hadMessages=messageNodes.size>0;
    const alive=new Set();
    if(!messages.length){
      messageNodes.clear();
      // No usable AI yet: the empty state is the first-run key entry card (first-run.js).
      const firstRunCard=window.ArcadeFirstRun?.inline(data);
      if(firstRunCard){if(firstRunCard.parentNode!==$('bot-messages')||$('bot-messages').childElementCount!==1){$('bot-messages').replaceChildren(firstRunCard);threadNeedsBottom=false;pane.scrollTop=0;}$('bot-latest').hidden=true;return;}
      const empty=el('div','chat-empty');
      const saved=window.selectedSavedConnection?.(data);
      empty.append(el('h2','',word('emptyTitle')),el('p','',desktopAvailable?(language==='zh'?'在下方输入，开始聊天。':'Type below to start chatting.'):localConversation?(language==='zh'?'准备好后，点击上方开始聊天。':'Choose Start chatting above when you are ready.'):!active&&saved?(language==='zh'?'已有连接配置。连接后，你和搭档的消息会显示在这里。':'Your connection is already configured. Messages will appear here after connecting.'):word(active?'emptyReady':'emptySetup')));
      if(!active&&!saved){const connect=el('button','primary',word('openSetup'));connect.id='bot-empty-connect';connect.onclick=()=>window.openConnectionOnboarding?window.openConnectionOnboarding():setSetupOpen(true,true);empty.append(connect);}
      $('bot-messages').replaceChildren(empty);$('bot-latest').hidden=true;return;
    }
    // Keep existing message nodes intact when only a new message arrives. Polls
    // must not replace the text the owner is currently reading or selecting.
    $('bot-messages').querySelectorAll('.chat-empty,.bot-empty,#first-run-card').forEach(node=>node.remove());
    let cursor=$('bot-messages').firstElementChild;
    for(const [index,m] of messages.entries()){
      const key=m.id||`position-${index}`;alive.add(key);
      const stamp=JSON.stringify([language,native,state?.channel,portrait,persona.id,m]);
      let entry=messageNodes.get(key);
      if(!entry){entry={row:el('article',''),stamp:''};messageNodes.set(key,entry);}
      if(entry.stamp!==stamp){
        const row=entry.row,user=m.role==='user';
        row.className=`bot-message ${user?'from-user':'from-agent'}`;row.dataset.role=user?'user':'assistant';row.dataset.messageId=key;
        const meta=el('div','message-meta');if(!user&&portrait==='anime'){const image=el('img','message-avatar');image.src=persona.portrait;image.alt='';meta.append(image);}meta.append(el('span','message-author',word(user?'you':'agent')));
        if(typeof m.at==='number'&&Number.isFinite(m.at)&&!Number.isNaN(new Date(m.at).getTime())){const time=el('time','',new Date(m.at).toLocaleTimeString(language==='zh'?'zh-CN':'en',{hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(m.at).toISOString();meta.append(time);}
        if(typeof m.id==='string'&&/^local(?:-out)?:/.test(m.id))meta.append(el('span','message-local',language==='zh'?'桌面':'Desktop'));
        row.replaceChildren(meta,el('div','message-body',m.text||''));
        if(m.deliveryFailed)row.append(el('p','message-delivery-error',state?.channel==='messenger'?(language==='zh'?'Messenger 发送结果未确认。请检查对话，不要重复派活。':'Messenger delivery is unconfirmed. Check the conversation; do not repeat the task.'):state?.channel==='x'?(language==='zh'?'X 私信发送结果未确认。请检查对话，不要重复派活。':'X DM delivery is unconfirmed. Check the conversation; do not repeat the task.'):state?.channel==='feishu'?(language==='zh'?'飞书发送结果未确认。请检查对话，不要重复派活。':'Feishu delivery is unconfirmed. Check the conversation; do not repeat the task.'):state?.channel==='qq'?(language==='zh'?'未发送到 QQ。请在本机查看结果；不要重复派活。':'Not delivered to QQ. Inspect the result here; do not repeat the task.'):native?word('nativeDeliveryFailed'):language==='zh'?'未发送到微信。连接尚在时发 /status 重取结果；断开后请在本机检查。':'Not delivered to WeChat. Use /status within this connection; after disconnecting, inspect the project locally.'));
        if(!user){const actions=el('div','message-actions'),copy=el('button','message-copy',word('copyReply'));copy.type='button';copy.onclick=()=>action(async()=>{if(window.arcade.copyText)await window.arcade.copyText(m.text||'');else await navigator.clipboard.writeText(m.text||'');toast(word('replyCopied'));});actions.append(copy);row.append(actions);}
        entry.stamp=stamp;
      }
      if(entry.row!==cursor)$('bot-messages').insertBefore(entry.row,cursor);
      cursor=entry.row.nextElementSibling;
    }
    for(const [key,entry] of messageNodes)if(!alive.has(key)){entry.row.remove();messageNodes.delete(key);}
    if(!hadMessages||(follow&&!prepend))showLatest();else restoreHistoryPosition(anchor,oldScroll);
  }
  window.renderBot=next=>{
    language=next.config.language;state=next.bot;
    const firstRunApi=window.ArcadeFirstRun,firstRun=firstRunApi?.needed(next)===true,hasChannel=firstRunApi?firstRunApi.hasChannel(next):true;
    const qq=state?.channel==='qq',feishu=state?.channel==='feishu',x=state?.channel==='x',messenger=state?.channel==='messenger',mode=state?.mode||'api',deepseek=mode==='deepseek',gpt=mode==='gpt',gemini=mode==='gemini',doubao=mode==='doubao',codex=mode==='codex',claude=mode==='claude',zh=language==='zh';
    const companion=qq&&state?.social?.config?.enabled&&state?.social?.supported;
    const credentialScope=JSON.stringify([next.accounts?.selectedId||'',mode,state?.channel||'wechat',state?.x?.expectedAccountId||'',state?.feishu?.appId||'',state?.messenger?.appId||'',state?.messenger?.pageId||'',state?.messenger?.ownerId||'',state?.messenger?.relayOrigin||'']);
    const credentialScopeChanged=lastCredentialScope!==credentialScope;
    credentialContext={profileId:next.accounts?.selectedId||'',expectedMode:mode,expectedChannel:state?.channel||'wechat'};
    if(credentialScopeChanged){$('bot-key').value='';$('bot-qq-token').value='';$('bot-feishu-secret').value='';$('bot-x-token').value='';$('bot-messenger-page-token').value='';$('bot-messenger-relay-token').value='';connectionDrafts.clear();lastCredentialScope=credentialScope;}
    if(lastMode!==mode){$('bot-key').value='';lastMode=mode;}
    const channelName=qq?'QQ':feishu?(zh?'飞书':'Feishu'):x?'X':messenger?'Messenger Page':zh?'微信':'WeChat',backendName=({native:'Claude Channels',claude:'Claude Code',api:'Claude API',codex:'Codex',gpt:'GPT API',deepseek:'DeepSeek API',gemini:'Gemini API',doubao:'Doubao API'})[mode];
    words[language].connected=zh?`${channelName}已连接`:`${channelName} connected`;
    words[language].paired=messenger?(zh?'Messenger 配置已保存':'Messenger settings saved'):x?(zh?'X 配置已保存':'X settings saved'):feishu?(zh?'飞书配置已保存':'Feishu settings saved'):qq?(zh?'QQ 配置已保存':'QQ settings saved'):(zh?'微信已配对':'WeChat paired');
    words[language].nativeStart=zh?`连接${channelName}`:`Connect ${channelName}`;
    words[language].nativeStop=zh?`断开${channelName}`:`Disconnect ${channelName}`;
    persona=(next.desktopChat?.kind==='local'?(next.personas||[]).find(p=>p.id===state?.local?.characterId):null)||next.persona||{id:'sprout',name:{en:'Sprout',zh:'小芽'},portrait:'portraits/sprout-anime.png'};
    if(next.desktopChat?.kind==='local'&&typeof state?.social?.config?.name==='string'&&state.social.config.name.trim())persona={...persona,name:{...persona.name,[language]:state.social.config.name.trim()}};
    words[language].title=persona.name[language];words[language].agent=persona.name[language];
    document.querySelectorAll('[data-bot]').forEach(n=>n.textContent=word(n.dataset.bot));
    $('bot-settings-toggle').setAttribute('aria-label',word('settingsToggle'));$('bot-settings-toggle').title=word('settingsToggle');
    $('bot-settings-close').setAttribute('aria-label',word('closeSettings'));
    $('bot-latest').textContent=word('latest');$('bot-thread-scroll').setAttribute('aria-label',word('inbox'));
    document.querySelector('.breadcrumb>span:last-child').textContent=view==='bot'?word('nav'):view==='connections'?(language==='zh'?'AI 与渠道':'AI and channels'):t({scene:'workshop',activity:'activity',settings:'settings'}[view]);
    const incoming=Number(state?.incomingCount)||0,outgoing=Number(state?.outgoingAccepted)||0;
    const status=state?.status||'disconnected',native=state?.mode==='native',process=state?.native?.process||{};
    const processRunning=process.owned&&process.status==='running',processStopped=['stopped','exited'].includes(process.status),processBusy=!!process.busy||process.status==='starting';
    const nativeStep=processStopped?'nativeStoppedMain':state?.native?.paused?'nativePausedMain':state?.tasks?.pending?.length?'nativeNeedsApproval':!state?.native?.attached?(processRunning?'nativeAwaitingChannel':'nativeOpenClaude'):incoming>0?'received':'connected';
    const statusWord=native&&status==='connected'?nativeStep:native&&status==='disconnecting'?'nativeDisconnecting':status==='connected'?(incoming>0?'received':'connected'):status==='disconnected'&&state?.paired?'paired':status;
    // No channel and no App conversation yet: plain words instead of "Disconnected".
    const appOnlyIdle=next.desktopChat?.kind!=='local'&&!hasChannel,statusText=appOnlyIdle?(firstRun?(zh?'还没有 AI':'No AI yet'):(zh?'还没开始':'Not started')):word(statusWord);
    if($('bot-status').textContent!==statusText)$('bot-status').textContent=statusText;
    $('bot-project').textContent=state?.workspace||word('noProject');
    $('bot-key-status').textContent=state?.hasKey?word('keySet'):gpt?(zh?'需要 OpenAI API key，按 API 用量计费。':'Requires an OpenAI API key; API usage is billed.'):deepseek?(zh?'需要 DeepSeek API key，按调用计费。':'Requires a DeepSeek API key; usage is billed by DeepSeek.'):gemini?(zh?'需要 Google AI Studio API key，按 API 用量计费。':'Requires a Google AI Studio API key; API usage is billed.'):doubao?(zh?'需要火山方舟 API key，按 API 用量计费。':'Requires a Volcengine Ark API key; API usage is billed.'):word('keyEmpty');
    $('bot-pair').textContent=word(state?.paired?'repair':'pair');
    $('bot-mode').value=mode;$('bot-channel').value=messenger?'messenger':x?'x':feishu?'feishu':qq?'qq':'wechat';
    $('bot-wechat-options').hidden=qq||feishu||x||messenger;$('bot-messenger-options').hidden=!messenger;$('bot-qq-options').hidden=!qq;$('bot-feishu-options').hidden=!feishu;$('bot-x-options').hidden=!x;
    $('bot-api-options').hidden=native||codex||claude;$('bot-native-options').hidden=!native;
    $('bot-claude-options').hidden=!claude;$('bot-codex-options').hidden=!codex;$('bot-deepseek-options').hidden=!deepseek;$('bot-gpt-options').hidden=!gpt;$('bot-claude-budget').hidden=mode!=='api';$('bot-gemini-options').hidden=!gemini;$('bot-doubao-options').hidden=!doubao;
    $('bot-key-label').textContent=gpt?'OpenAI API key':deepseek?'DeepSeek API key':gemini?'Google AI Studio API key':doubao?'Volcengine Ark API key':'Anthropic API key';$('bot-key').placeholder=state?.hasKey?(zh?'已保存，无需重复填写':'Saved; no need to re-enter'):gemini?'Google AI Studio key':doubao?'Volcengine Ark key':deepseek||gpt?'sk-…':'sk-ant-…';
    for(const [id,value] of [['bot-feishu-app-id',state?.feishu?.appId||''],['bot-feishu-owner',state?.feishu?.ownerId||''],['bot-qq-url',state?.qq?.url||'ws://127.0.0.1:3001'],['bot-qq-owner',state?.qq?.ownerId||''],['bot-deepseek-model',state?.deepseekModel||'deepseek-flash'],['bot-gpt-model',state?.gptModel||'gpt-6.1-sol'],['bot-gemini-model',state?.geminiModel||'gemini-3.6-flash'],['bot-doubao-model',state?.doubaoModel||'doubao-seed-2-0-lite-260428']])if(credentialScopeChanged||!connectionDrafts.has(id)&&document.activeElement!==$(id))$(id).value=value;
    $('bot-feishu-secret-status').textContent=state?.feishu?.hasSecret?(zh?'App Secret 已加密保存；留空保留，更换 App ID 时请填写新 Secret。保存配置不代表已连接。':'App Secret saved with OS encryption; leave blank to keep. A different App ID needs its own Secret. Saved settings do not mean connected.'):(zh?'填写应用的 App Secret；不会显示或回传已保存值。':'Enter the app’s App Secret; saved values are never displayed or returned.');
    for(const [id,value] of [['bot-x-account',state?.x?.expectedAccountId||''],['bot-x-owner',state?.x?.ownerId||'']])if(credentialScopeChanged||!connectionDrafts.has(id)&&document.activeElement!==$(id))$(id).value=value;
    $('bot-x-token-status').textContent=state?.x?.hasToken?(zh?'用户令牌已加密保存，留空保留。保存不代表账号、私信权限或平台批准已核实。':'User token saved with OS encryption; leave blank to keep. Saving does not verify identity, DM access or platform approval.'):(zh?'填写用户授权得到的令牌；不会显示或回传已保存值。':'Enter a user-authorized token; saved values are never displayed or returned.');
    for(const [id,value] of [['bot-messenger-app',state?.messenger?.appId||''],['bot-messenger-page',state?.messenger?.pageId||''],['bot-messenger-owner',state?.messenger?.ownerId||''],['bot-messenger-relay',state?.messenger?.relayOrigin||'']])if(credentialScopeChanged||!connectionDrafts.has(id)&&document.activeElement!==$(id))$(id).value=value;
    $('bot-messenger-page-token-status').textContent=state?.messenger?.hasPageToken?(zh?'Page 令牌已加密保存；留空保留。更换应用或 Page 时需新令牌。':'Page token saved with OS encryption; leave blank to keep. A different App or Page needs a new token.'):(zh?'填写 Page Access Token；不会回传已保存值。':'Enter the Page Access Token; saved values are never returned.');
    $('bot-messenger-relay-token-status').textContent=state?.messenger?.hasRelayToken?(zh?'中转令牌已加密保存；留空保留。更换应用、Page、主人或中转地址时需新令牌。保存不代表权限或连通已验证。':'Relay token saved with OS encryption; leave blank to keep. A different App, Page, owner or relay needs a new token. Saving does not verify permissions or connectivity.'):(zh?'填写此身份组合专用的中转令牌；不是 App Secret 或 webhook 验证令牌。':'Enter the relay token for this identity binding, not App Secret or the webhook verification token.');
    $('bot-messenger-stopped').hidden=!state?.messenger?.optedOut;
    const messengerCheck=state?.messenger?.check||{};
    if(messengerCheck.code==='optout_save_failed')document.querySelector('[data-bot="messengerStopped"]').textContent=zh?'本次接收已停止，但停用设置未保存。请修复本机存储，勿在重启后直接连接。':'Receiving stopped for this session, but the stop setting could not be saved. Fix local storage before connecting after a restart.';
    $('bot-messenger-check').textContent=messengerCheck.state==='verified'&&messengerCheck.code!=='response_window_closed'?(zh?'Page 与中转身份已核实；不代表消息已送达、已读或平台已批准。':'Page and relay identities verified; not delivery, read or platform approval proof.'):messengerCheck.state==='failed'&&messengerCheck.code==='rate_limited'?(zh?'Messenger 连接受限，请稍后手动重新连接；当前没有自动等待。':'Messenger connection was rate limited. Reconnect manually later; no automatic wait is running.'):messengerCheck.state==='rate_limited'?(zh?'Messenger 检查已限流，正在等待；可随时断开。':'Messenger checks are rate limited. Waiting; you can disconnect at any time.'):messengerCheck.code==='response_window_closed'?(zh?'回复窗口已结束，未提交此回复。等待指定主人向 Page 发新消息；不会自动重发旧回复。':'The reply window has ended; this reply was not submitted. Wait for a new owner message. Old replies are not resent automatically.'):'';
    $('bot-x-stopped').hidden=!state?.x?.optedOut;
    const xCheck=state?.x?.check||{},xRateAt=Number(xCheck.retryAt);
    $('bot-x-check').textContent=xCheck.state==='failed'&&xCheck.code==='rate_limited'?(zh?`X 连接受限，${Number.isFinite(xRateAt)&&xRateAt>0?new Date(xRateAt).toLocaleTimeString('zh-CN')+' 后':'稍后'}请手动重新连接。当前没有自动等待。`:`X connection was rate limited. ${Number.isFinite(xRateAt)&&xRateAt>0?'Try connecting after '+new Date(xRateAt).toLocaleTimeString('en')+'.':'Try connecting later.'} No automatic wait is running.`):xCheck.state==='rate_limited'?(zh?`X 请求已限流，${Number.isFinite(xRateAt)&&xRateAt>0?new Date(xRateAt).toLocaleTimeString('zh-CN')+' 后':'稍后'}重试。等待期间可断开。`:`X requests are rate limited. ${Number.isFinite(xRateAt)&&xRateAt>0?'Retry after '+new Date(xRateAt).toLocaleTimeString('en')+'.':'Waiting before retrying.'} You can disconnect while waiting.`):xCheck.state==='verified'?(zh?'账号身份已核实；尚不能证明私信已送达或任务成功。':'Account identity verified; this does not prove DM delivery or task success.'):'';
    $('bot-qq-token-state').textContent=state?.qq?.hasToken?(zh?'Token 已加密保存。留空保留原值。':'Token saved with OS encryption. Leave blank to keep it.'):(zh?'填写 OneBot token，不是 WebUI 密码。':'Use the OneBot token, not the WebUI password.');
    $('bot-qq-prepare').textContent=word(state?.qq?.hasToken?'qqPrepared':'qqPrepare');
    renderQQCheck(state?.qq,status);
    $('bot-native-key-retained').hidden=!state?.hasKey;
    $('bot-privacy').textContent=claude||codex||deepseek||gpt||gemini||doubao||qq||feishu?(zh?`消息经过腾讯及所选 AI 服务${gpt?' OpenAI':deepseek?' DeepSeek':''}${qq?'；QQ 桥接也会处理消息':''}。API key 与连接令牌使用系统加密。本页聊天在内存中，本机 AI 可能另存会话。`:`Messages pass through Tencent and the selected AI service${gpt?' (OpenAI)':deepseek?' (DeepSeek)':''}${qq?'; a QQ bridge also processes QQ messages':''}. Keys and tokens use OS encryption. This view is in memory; local AI tools may retain sessions.`):word(native?'nativePrivacy':'privacy');
    if(feishu)$('bot-privacy').textContent=zh?'消息经过飞书与所选 AI 服务。App Secret 与模型密钥在本机使用系统加密保存。此接入仅指定主人的私聊，不开启群聊。':'Messages pass through Feishu and your selected AI service. App Secret and model keys use local OS encryption. Only the configured owner’s private chat is accepted, not groups.';
    if(messenger)$('bot-privacy').textContent=zh?'消息经过 Meta、你配置的中转服务与所选 AI。中转服务可读取明文并有短期队列，本机令牌使用系统加密。仅接收指定主人，不自动创建 Page 或部署服务器。':'Messages pass through Meta, your relay and the selected AI. The relay sees plaintext and keeps a short-lived queue; local tokens use OS encryption. Only the configured owner is accepted. No automatic Page creation or relay deployment.';
    if(x)$('bot-privacy').textContent=zh?'消息经过 X 与所选 AI 服务。用户令牌和模型密钥使用本机系统加密；仅接收指定主人的普通私信，不读取加密 X Chat。':'Messages pass through X and the selected AI service. User tokens and model keys use local OS encryption. Only the configured owner’s standard DMs are accepted, not encrypted X Chat.';
    if(state?.social?.active)$('bot-privacy').textContent=zh?'陪伴模式会在本机保存最近 120 条聊天与手动记忆，并将相关上下文交给所选 AI 服务。空间文案单独生成，不提供私聊记忆。可在「相处方式」暂停活动或清除记忆。':'Companion mode keeps up to 120 messages and editable notes locally and sends relevant context to the selected AI. Space posts are generated separately without private chat memory. Pause activity or clear memory in Companion settings.';
    for(const [key,nativeKey] of [['inbox','nativeInbox'],['inboxNote','nativeInboxNote'],['help','nativeHelp'],['risk','nativeRisk']])document.querySelector(`[data-bot="${key}"]`).textContent=word(native?nativeKey:key);
    $('bot-start').textContent=word(native?'nativeStart':'start');$('bot-stop').textContent=word(native?'nativeStop':'stop');
    $('bot-stop').title=word(native?'nativeStopNote':'stop');
    const projectName=state?.workspace?.split(/[\\/]/).filter(Boolean).at(-1);
    document.querySelector('[data-bot="inboxNote"]').textContent=[channelName,backendName,companion?(zh?'陪伴聊天':'Companion chat'):projectName].filter(Boolean).join(' / ');
    $('bot-problem').hidden=!state?.problem;$('bot-problem').textContent=qq&&managedQQ?window.qqConnectionGuidance?.(state?.problem,language)||state?.problem||'':state?.problem||'';
    if(managedQQ){const runtime=$('bot-problem-qq-runtime');runtime.hidden=!(qq&&state?.problem);runtime.textContent=zh?'QQ 登录与运行':'QQ sign-in & runtime';}
    const active=['connected','connecting','disconnecting'].includes(state?.status),pairing=state?.status==='pairing',checking=state?.status==='checking';
    const localConversation=next.desktopChat?.kind==='local',savedConnection=window.selectedSavedConnection?.(next),nextSetupPhase=JSON.stringify([next.accounts?.selectedId,active,!!savedConnection,localConversation]);
    // A profile without any channel is an App-conversation profile: its settings panel starts
    // closed and nothing about chat software is shown until the owner asks for it.
    if(setupPhase!==nextSetupPhase&&(firstRunApi||setupPhase!==undefined)){setSetupOpen(!localConversation&&!active&&!savedConnection&&hasChannel);setupPhase=nextSetupPhase;}
    else if(setupPhase===undefined&&!firstRunApi)setSetupOpen(false);
    const nextAdvancedPhase=JSON.stringify([next.accounts?.selectedId,localConversation]);
    if(advancedPhase!==nextAdvancedPhase&&firstRunApi){advancedGroup.open=!localConversation&&hasChannel;advancedPhase=nextAdvancedPhase;}
    document.querySelector('label[for="bot-mode"]').textContent=word(localConversation||!hasChannel?'aiService':'mode');
    // The App conversation is chat only: the provider notes about file tools do not apply to it.
    if(localConversation)for(const key of ['gptNote','deepseekNote','geminiNote','doubaoNote'])document.querySelector(`[data-bot="${key}"]`).textContent=zh?'按这个服务的 API 用量计费。App 对话只聊天，不操作文件，也不执行命令。':'Billed by this service’s API usage. The App conversation only chats: no file actions, no commands.';
    localControls.hidden=!localConversation;
    characterSettings.hidden=!(localConversation&&(state?.local?.libraryCharacterId||state?.local?.libraryGroupId));
    savedConnectionHost.hidden=localConversation||!savedConnection||(active&&!window.ArcadeQQStartConnect?.isRunning());
    window.ArcadeQQStartConnect?.mount(savedConnectionHost,{id:'bot-saved-connection',settings:()=>setSetupOpen(true,true)});
    $('bot-view').classList.toggle('bot-connected',active||localConversation);
    $('bot-setup-summary').textContent=[state?.workspace?.split(/[\\/]/).filter(Boolean).at(-1),backendName].filter(Boolean).join(' · ');
    $('bot-start-note').textContent=word(native?'nativeStartNote':'startNote');
    document.querySelector('[data-bot="messageEntry"]').textContent=native?(language==='zh'?'在微信 → ClawBot 发消息。本机会话可在对话设置中停止。':'Send messages in WeChat → ClawBot. Manage the local session in Conversation settings.'):word('messageEntry');
    if(feishu)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'在飞书私聊应用机器人。当前只处理指定主人的消息。':'Message the Feishu app bot privately from the configured owner’s account.';
    if(messenger)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'指定主人从 Messenger 私信此 Facebook Page。发 /unsubscribe 可停止后续接收。':'The configured owner can message this Facebook Page in Messenger. /unsubscribe stops future receiving.';
    if(x)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'从指定主人账号向 AI 账号发 X 普通私信。约 75 秒检查一次；发 /unsubscribe 可停止今后接收。':'Send a standard X DM from the configured owner. Checks run about every 75 seconds; /unsubscribe stops future receiving.';
    if(qq)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'在 QQ 私聊 AI 的独立账号。当前仅处理指定主人的消息。':'Message your AI’s QQ account privately. Only the configured owner is accepted.';
    if(claude||codex||deepseek||gpt||gemini||doubao||qq||feishu||x||messenger){
      $('bot-start-note').textContent=zh?'连接后从指定账号发出消息。聊天直接回复；需要权限时才请你确认。':'After connecting, message from the configured account. Ordinary chat replies directly; actions ask when approval is needed.';
      document.querySelector('[data-bot="preview"]').textContent=zh?'预览版 · 新接入的真实账号验收仍待完成。':'Preview · live acceptance of the new integrations remains pending.';
    }
    // Lines about a chat channel (the WeChat entry, the preview note) belong to a channel conversation only.
    document.querySelector('[data-bot="preview"]').hidden=!!companion||localConversation||!hasChannel;
    document.querySelector('.bot-input-note').classList.toggle('bot-note-off',firstRun||!hasChannel);
    if(qq&&state?.qq?.check?.state==='checked'&&(state.qq.check.online===false||state.qq.check.ownerIsFriend===false))$('bot-start-note').textContent=state.qq.check.online===false?(managedQQ?(zh?'QQ 当前离线。打开「管理 QQ 账号」登录，再从「管理搭档」连接。':'QQ is offline. Sign in under Manage QQ accounts, then connect from Manage companions.'):(zh?'QQ 当前离线。先在 NapCat 登录并重新检查，再开始接收任务。':'QQ is offline. Sign in through NapCat and test again before receiving tasks.')):(zh?'先加 AI 的 QQ 为好友，并在 AI 账号里通过申请，再重新检查。':'Add the AI’s QQ as a friend, accept in that account, then test again.');
    if(deepseek||gpt||gemini||doubao||codex||claude)document.querySelector('[data-bot="help"]').textContent=zh?'直接聊天或派活。“状态”查看当前请求，“停止”中断当前任务，/new 开启新会话。需要确认时回复“同意 确认码”或“拒绝 确认码”；问题可直接回答。断开后不会自动恢复旧任务。':'Chat or give a task. /status shows requests; /cancel interrupts the current task; /new starts a fresh conversation. Approve only the reviewed /allow CODE or /deny CODE request. Disconnected work never replays automatically.';
    if(messenger){$('bot-start-note').textContent=zh?'连接后接收指定主人的新消息并回复；需先完成 Page 权限与 HTTPS 中转配置，普通回复窗口为 24 小时。':'Connect after Page permissions and HTTPS relay setup are ready. Receive new owner messages and reply within the ordinary 24-hour window.';document.querySelector('[data-bot="help"]').textContent+=zh?' 单独输入 /unsubscribe 会停止后续接收；重新启用需在本机明确操作。':' Send /unsubscribe as direct text to stop receiving; resuming requires an explicit local action.';}
    if(x){$('bot-start-note').textContent=zh?'连接会开始付费 API 检查并自动回复指定主人的新消息；确认账号和平台条件后再连接。':'Connecting starts API checks that may be billed and automatic replies to the configured owner’s new messages. Confirm account and platform prerequisites first.';document.querySelector('[data-bot="help"]').textContent+=zh?' 单独输入 /unsubscribe 会停止后续接收和回复；重新启用需回到此处操作。':' Send /unsubscribe as direct text to stop future receiving and replies. Re-enabling requires an action here.';}
    if(claude)document.querySelector('[data-bot="risk"]').textContent=zh?'工具操作按次确认，批准的命令仍可能影响项目以外的数据。停止会取消当前请求并清理应用启动的进程；已写入内容不会撤销，独立后台作业未确认。回复结束不代表任务成功。':'Tool actions need a specific approval; approved commands can still affect data outside the project. Stop cancels the current request and cleans up the app-started process. Existing changes are not rolled back and independent background jobs are unconfirmed. A reply ending does not prove success.';
    if(deepseek||gpt||gemini||doubao)document.querySelector('[data-bot="risk"]').textContent=zh?'仅提供经批准的项目文件操作，不执行终端命令；此文件接口不是系统沙箱。停止或断开不会撤销已写入的内容，回复结束也不代表任务已验证成功。':'Only approved project file actions are available, with no shell. This file interface is not an OS sandbox. Stopping or disconnecting does not undo existing changes, and a reply ending does not verify task success.';
    if(qq)for(const selector of ['[data-bot="nativeSetup"]','[data-bot="nativeReplyPermission"]','[data-bot="nativeStopNote"]','[data-bot="help"]','[data-bot="risk"]']){const node=document.querySelector(selector);node.textContent=node.textContent.replaceAll('微信','QQ').replaceAll('WeChat','QQ').replaceAll('ClawBot','QQ');}
    if(companion){
      $('bot-stop').textContent=zh?'断开连接':'Disconnect';$('bot-stop').title=zh?'停止当前回复并断开 QQ':'Stop the current reply and disconnect QQ';
      $('bot-start-note').textContent=zh?'连接后，在 QQ 私聊她。记忆、回访和日记都在「相处」里。':'After connecting, chat with her privately in QQ. Open Together for memories, follow-ups and her journal.';
      document.querySelector('[data-bot="help"]').textContent=zh?'直接聊天；发“停止”可打断当前回复，发“暂停主动”可暂停主动联系。记忆、约定回访和日记可在「相处」查看与修改。':'Chat normally. Send /cancel to interrupt the current reply, or 暂停主动 to pause proactive contact. View and edit memories, agreed follow-ups and her journal in Together.';
      document.querySelector('[data-bot="risk"]').textContent=zh?'陪伴聊天不执行文件或命令。已发送的 QQ 消息不会因停止而撤回。':'Companion chat does not use file or command tools. Stopping does not recall QQ messages already sent.';
    }
    for(const id of ['bot-mode','bot-channel','bot-pick','bot-key','bot-save','bot-budget','bot-pair','bot-qq-url','bot-qq-owner','bot-qq-token','bot-qq-save','bot-feishu-app-id','bot-feishu-owner','bot-feishu-secret','bot-feishu-save','bot-x-account','bot-x-owner','bot-x-token','bot-x-save','bot-x-resume','bot-messenger-app','bot-messenger-page','bot-messenger-owner','bot-messenger-relay','bot-messenger-page-token','bot-messenger-relay-token','bot-messenger-save','bot-messenger-resume','bot-deepseek-model','bot-gpt-model','bot-gemini-model','bot-doubao-model','bot-qq-download','bot-qq-guide'])$(id).disabled=active||pairing||checking;
    const qqLocked=active||pairing||checking;
    $('bot-qq-prepare').disabled=qqLocked||!!state?.qq?.hasToken;
    for(const id of ['bot-qq-copy-config','bot-qq-copy-token'])$(id).disabled=qqLocked||!state?.qq?.hasToken;
    $('bot-qq-test').disabled=qqLocked||!state?.qq?.hasToken;
    $('bot-qq-test').textContent=word(checking?'qqTesting':'qqTest');
    $('bot-mode').querySelector('[value="native"]').disabled=feishu||x||messenger;
    $('bot-start').hidden=active||pairing;$('bot-start').disabled=((feishu||x||messenger)&&native)||(x&&!!state?.x?.optedOut)||(messenger&&!!state?.messenger?.optedOut)||checking||!((state?.workspace||(state?.social?.config.enabled&&state?.social?.supported))&&state?.paired&&(native||codex||claude||state?.hasKey));
    $('bot-forget').disabled=checking;
    $('bot-stop').hidden=!(active||pairing);
    if(checking){$('bot-stop').hidden=false;$('bot-stop').textContent=zh?'取消检查':'Cancel check';$('bot-stop').title=$('bot-stop').textContent;}
    const command=typeof state?.native?.command==='string'?state.native.command:'';
    $('bot-native-launch').hidden=!native||(!command&&!process.owned&&!process.canResume&&process.status!=='unknown');
    $('bot-native-command').textContent=command;$('bot-native-copy').disabled=!command||!native||!active;
    $('bot-native-command').closest('details').hidden=!command;
    $('bot-native-open').hidden=!!processRunning;
    $('bot-native-open').textContent=word(process.status==='starting'?'nativeStarting':process.canResume?'nativeResume':'nativeLaunch');
    $('bot-native-open').disabled=processBusy||['unknown','running'].includes(process.status)||!['connected','connecting'].includes(status)||(!process.canResume&&!!state?.native?.attached);
    $('bot-native-new').hidden=!process.canResume;
    $('bot-native-new').disabled=processBusy||!['connected','connecting'].includes(status)||!!state?.native?.attached;
    $('bot-native-halt').hidden=!processRunning;
    $('bot-native-halt').disabled=processBusy;
    $('bot-native-halt').textContent=word(processBusy?'nativeStopping':'nativeHalt');
    const processNote=process.status==='unknown'?'nativeUnknown':process.status==='starting'?'nativeStarting':processStopped?'nativeStopped':processRunning?(state?.native?.attached?'nativeSessionReady':'nativeRunning'):'nativeLaunchNote';
    $('bot-native-process-note').textContent=[word(processNote),processStopped?word('nativeStopScope'):''].filter(Boolean).join(' ');
    if(document.activeElement!==$('bot-budget'))$('bot-budget').value=state?.budget||1;
    $('bot-qr-wrap').hidden=!state?.qr;
    if(state?.qr&&$('bot-qr').getAttribute('src')!==state.qr)$('bot-qr').src=state.qr;
    if(!state?.qr)$('bot-qr').removeAttribute('src');
    const messages=localConversation?(Array.isArray(state?.local?.history)?state.local.history:[]):(Array.isArray(state?.tasks?.messages)?state.tasks.messages:[]), fingerprint=JSON.stringify([firstRun,firstRunApi?.stateKey(),language,mode,state?.channel,active,!!savedConnection,next.accounts?.selectedId,next.config.portrait,persona.id,localConversation,!!next.desktopChat?.available,messages]);
    $('bot-inbox').hidden=false;
    const latest=state?.tasks?.tasks?.at(-1),labels=language==='zh'?{queued:'排队中',running:'执行中',waiting_permission:'等待你的批准',waiting_question:'等待你的回答',cancelling:'正在中止',reply_ended:'回复结束 · 任务结果未验证',error:'执行出错 · 结果未验证',limit:'达到执行限制',cancelled:'已取消'}:{queued:'Queued',running:'Running',waiting_permission:'Waiting for approval',waiting_question:'Waiting for your answer',cancelling:'Cancelling',reply_ended:'Response ended · outcome unverified',error:'Execution error · outcome unverified',limit:'Execution limit reached',cancelled:'Cancelled'};
    if(companion)Object.assign(labels,zh?{queued:'等一下，马上回复',running:'正在回复',cancelling:'正在停止回复',reply_ended:'回复已结束',error:'这次没能回复，请稍后再试',limit:'这次回复已达到限制',cancelled:'已停止回复'}:{queued:'Reply queued',running:'Replying',cancelling:'Stopping reply',reply_ended:'Reply ended',error:'Could not reply. Please try again later.',limit:'Reply limit reached',cancelled:'Reply stopped'});
    const nativeHint={nativeOpenClaude:'nativeOpenHint',nativeAwaitingChannel:'nativeAwaitingHint',nativeNeedsApproval:'nativeApprovalHint',nativePausedMain:'nativePausedHint',nativeStoppedMain:'nativeStopped',received:'nativeReceivedHint',connected:'nativeReadyHint'};
    const taskState=localConversation?'':native?(active?word(status==='disconnecting'?'nativeDisconnecting':nativeHint[nativeStep]):''):latest?`${labels[latest.state]||latest.state}${latest.activity?' · '+latest.activity:''}`:'';
    if($('bot-task-state').textContent!==taskState)$('bot-task-state').textContent=taskState;
    $('bot-task-state').hidden=!taskState||(companion&&latest?.state==='reply_ended')||(native&&active&&!processStopped&&state?.native?.attached&&!state?.native?.paused&&!state?.tasks?.pending?.length&&messages.length>0);
    const nativeDiagnostic=native&&active?`${word(state?.native?.paused?'nativePaused':state?.native?.attached?'nativeAttached':'nativeDetached')}\n${word('nativeForwarded')}: ${Number(state?.native?.forwarded)||0}\n${word('nativeReplies')}: ${Number(state?.native?.replies)||0}`:'';
    const channelDiagnostic=status==='connected'||incoming>0||outgoing>0?`${word('incoming')}: ${incoming}\n${word('outgoing')}: ${outgoing} (${word('notRead')})`:'';
    $('bot-connection-details').hidden=!(active||incoming>0||outgoing>0);
    $('bot-connection-state').textContent=[nativeDiagnostic,channelDiagnostic].filter(Boolean).join('\n');
    $('bot-native-diagnostic-note').hidden=!native;
    const messageScope=JSON.stringify([next.accounts?.selectedId,localConversation?'local':'channel',persona.id,localConversation?state?.local?.historyId:state?.tasks?.historyId||state?.channel]);
    if(lastMessageScope!==messageScope){messageNodes.clear();$('bot-messages').replaceChildren();lastMessages='';lastMessageScope=messageScope;threadNeedsBottom=true;}
    const historyAnchor=historyPosition(),historyScroll=$('bot-thread-scroll').scrollTop,historyFollow=atBottom();
    syncLocalHistory(next);
    const messagesChanged=lastMessages!==fingerprint;
    if(messagesChanged){
      lastMessages=fingerprint;
      renderMessages(messages,localConversation?false:native,localConversation||active,next.config.portrait||'anime',next.desktopChat?.available===true,localConversation,{anchor:historyAnchor,scroll:historyScroll,follow:historyFollow});
    }
    if(!messagesChanged&&historyAnchor)restoreHistoryPosition(historyAnchor,historyScroll);
    const mascot=native?(state?.tasks?.pending?.length?'waiting':'idle'):state?.tasks?.pending?.length?'waiting':state?.tasks?.currentTaskId?'running':messages.length?'done':'idle';
    const portrait=next.config.portrait||'anime';
    if(lastMascot!==`${mascot}:${next.config.theme}:${portrait}:${persona.id}`){lastMascot=`${mascot}:${next.config.theme}:${portrait}:${persona.id}`;$('bot-mascot').className=`scene ${mascot}`;if(portrait==='anime'){const img=el('img','portrait');img.src=persona.portrait;img.alt='';$('bot-mascot').replaceChildren(img);}else $('bot-mascot').replaceChildren(sprite(mascot));}
    document.body.dataset.desktopConversation=localConversation?'local':'channel';$('bot-status').classList.toggle('waiting',localConversation&&['starting','stopping'].includes(state?.local?.state));$('bot-status').classList.toggle('unknown',localConversation&&!state?.local?.available&&!['starting','stopping'].includes(state?.local?.state));$('bot-status').classList.toggle('error',localConversation&&state?.local?.reason==='stop_failed');if(localConversation)document.querySelector('[data-bot="messageEntry"]').textContent=zh?'App 聊天与 QQ 分开保存。准备好后可在上方继续。':'App chat is saved separately from QQ. Continue above when you are ready.';if(localConversation){$('bot-status').textContent=state?.local?.state==='starting'?(zh?'正在准备聊天':'Preparing chat'):state?.local?.state==='stopping'?(zh?'正在暂停':'Pausing'):state?.local?.available?(zh?'可以聊天':'Ready to chat'):(zh?'App聊天已暂停':'App chat paused');$('bot-stop').hidden=true;$('bot-problem').hidden=true;document.querySelector('[data-bot="inboxNote"]').textContent=[zh?'App对话':'App conversation',backendName].filter(Boolean).join(' / ');$('bot-privacy').textContent=zh?'这段聊天与记忆独立保存在本机，相关内容会交给所选 AI。不会同步到 QQ，也不发布动态。可在聊天中查看、更正或忘记记忆。':'This conversation and its memory are stored separately on this device. Relevant context goes to the selected AI. It is not synced to QQ or used for social posts. Ask in chat to view, correct or forget memories.';}
    // No channel and no App conversation yet: say so in plain words instead of "WeChat / … · Disconnected".
    if(appOnlyIdle)document.querySelector('[data-bot="inboxNote"]').textContent=firstRun?(zh?'先选一个 AI 并保存密钥':'Choose an AI and save its key first'):[zh?'App对话':'App conversation',backendName].filter(Boolean).join(' / ');
    document.body.dataset.firstRun=String(firstRun);
    document.body.dataset.portrait=portrait;
    if(threadNeedsBottom&&document.body.dataset.view==='bot')requestAnimationFrame(()=>{
      if(threadNeedsBottom&&lastMessageScope===messageScope&&document.body.dataset.view==='bot'&&$('bot-thread-scroll').clientHeight){threadNeedsBottom=false;showLatest();}
    });
  };
  $('bot-settings-toggle').onclick=()=>setSetupOpen(!$('bot-setup-panel').open,true);
  $('bot-settings-close').onclick=()=>setSetupOpen(false,true);
  $('bot-setup-panel').addEventListener('toggle',()=>$('bot-settings-toggle').setAttribute('aria-expanded',String($('bot-setup-panel').open)));
  $('bot-setup-panel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();setSetupOpen(false,true);}});
  $('bot-latest').onclick=showLatest;
  $('bot-thread-scroll').addEventListener('scroll',()=>{if(atBottom())$('bot-latest').hidden=true;},{passive:true});
  $('bot-pick').onclick=()=>run(()=>window.arcade.botProject());
  $('bot-mode').onchange=()=>run(async()=>{const previous=state?.mode||'api';$('bot-key').value='';try{await window.arcade.botConfigure({mode:$('bot-mode').value});}catch(error){$('bot-mode').value=previous;throw error;}});
  $('bot-channel').onchange=()=>run(async()=>{const previous=state?.channel||'wechat';try{await window.arcade.botConfigure({channel:$('bot-channel').value});}catch(error){$('bot-channel').value=previous;throw error;}});
  $('bot-deepseek-model').onchange=()=>run(()=>window.arcade.botConfigure({deepseekModel:$('bot-deepseek-model').value}));
  $('bot-gpt-model').onchange=()=>run(()=>window.arcade.botConfigure({gptModel:$('bot-gpt-model').value}));
  $('bot-gemini-model').onchange=()=>run(()=>window.arcade.botConfigure({geminiModel:$('bot-gemini-model').value}));
  $('bot-doubao-model').onchange=()=>run(()=>window.arcade.botConfigure({doubaoModel:$('bot-doubao-model').value}));
  $('bot-qq-save').onclick=()=>run(async()=>{await saveQQSettings();toast(word('qqSaved'));});
  $('bot-qq-prepare').onclick=()=>run(async()=>{if(!window.arcade.botQQPrepare)throw Error(word('notDesktop'));await saveQQSettings(false);await window.arcade.botQQPrepare();toast(word('qqTokenPrepared'));});
  $('bot-qq-copy-config').onclick=()=>run(async()=>{if(!window.arcade.botQQCopyConfig)throw Error(word('notDesktop'));await saveQQSettings(false);await window.arcade.botQQCopyConfig();toast(word('qqConfigCopied'));});
  $('bot-qq-copy-token').onclick=()=>run(async()=>{if(!window.arcade.botQQCopyToken)throw Error(word('notDesktop'));await window.arcade.botQQCopyToken();toast(word('qqTokenCopied'));});
  $('bot-qq-test').onclick=()=>run(async()=>{if(!window.arcade.botQQTest)throw Error(word('notDesktop'));await saveQQSettings();await window.arcade.botQQTest();});
  for(const [id,kind] of [['bot-qq-download','download'],['bot-qq-guide','connections']])$(id).onclick=()=>run(async()=>{if(!window.arcade.botQQOpenGuide)throw Error(word('notDesktop'));await window.arcade.botQQOpenGuide(kind);});
  for(const id of connectionDraftIds)$(id).addEventListener('input',()=>connectionDrafts.add(id));
  $('bot-feishu-save').onclick=()=>run(async()=>{const scope=lastCredentialScope,secret=$('bot-feishu-secret').value;$('bot-feishu-secret').value='';const patch={...credentialContext,channel:'feishu',feishuAppId:$('bot-feishu-app-id').value,feishuOwnerId:$('bot-feishu-owner').value};if(secret)patch.feishuAppSecret=secret;await window.arcade.botConfigure(patch);acceptConnectionDraft(scope,{'bot-feishu-app-id':patch.feishuAppId,'bot-feishu-owner':patch.feishuOwnerId});if(sameCredentialOwner(scope))toast(language==='zh'?'飞书配置已保存':'Feishu settings saved');});
  $('bot-x-save').onclick=()=>run(async()=>{const scope=lastCredentialScope,token=$('bot-x-token').value;$('bot-x-token').value='';const patch={...credentialContext,channel:'x',xAccountId:$('bot-x-account').value,xOwnerId:$('bot-x-owner').value};if(token)patch.xAccessToken=token;await window.arcade.botConfigure(patch);acceptConnectionDraft(scope,{'bot-x-account':patch.xAccountId,'bot-x-owner':patch.xOwnerId});if(sameCredentialOwner(scope))toast(language==='zh'?'X 配置已保存':'X settings saved');});
  $('bot-messenger-save').onclick=()=>run(async()=>{const scope=lastCredentialScope,pageToken=$('bot-messenger-page-token').value,relayToken=$('bot-messenger-relay-token').value;$('bot-messenger-page-token').value='';$('bot-messenger-relay-token').value='';const patch={...credentialContext,channel:'messenger',messengerAppId:$('bot-messenger-app').value,messengerPageId:$('bot-messenger-page').value,messengerOwnerId:$('bot-messenger-owner').value,messengerRelayOrigin:$('bot-messenger-relay').value};if(pageToken)patch.messengerPageAccessToken=pageToken;if(relayToken)patch.messengerRelayToken=relayToken;await window.arcade.botConfigure(patch);acceptConnectionDraft(scope,{'bot-messenger-app':patch.messengerAppId,'bot-messenger-page':patch.messengerPageId,'bot-messenger-owner':patch.messengerOwnerId,'bot-messenger-relay':patch.messengerRelayOrigin});if(sameCredentialOwner(scope))toast(language==='zh'?'Messenger 配置已保存':'Messenger settings saved');});
  $('bot-messenger-resume').onclick=()=>run(async()=>{const scope=lastCredentialScope;await window.arcade.botConfigure({messengerResume:true});if(sameCredentialOwner(scope))toast(language==='zh'?'已解除本机停用；尚未连接 Messenger。':'Local stop cleared; Messenger has not been connected.');});
  $('bot-x-resume').onclick=()=>run(async()=>{await window.arcade.botConfigure({xResume:true});toast(language==='zh'?'已解除本机停用；尚未连接 X。':'Local stop cleared; X has not been connected.');});
  // What was typed stays in the field until the key is actually saved; format problems are said in plain words.
  $('bot-save').onclick=()=>run(async()=>{
    const context=credentialContext,scope=lastCredentialScope,key=$('bot-key').value.trim(),zh=language==='zh';
    if(!key){toast(state?.hasKey?(zh?'密钥未更改。':'Key unchanged.'):(zh?'请先输入 API key。':'Enter an API key first.'));return;}
    const problem=window.ArcadeFirstRun?.keyProblem(key,zh);if(problem){toast(problem);$('bot-key').focus();return;}
    try{await window.arcade.botConfigure({...context,key});}catch(error){const known=window.ArcadeFirstRun?.known(error,zh);if(known){toast(known);$('bot-key').focus();return;}throw error;}
    if(sameCredentialOwner(scope)){$('bot-key').value='';toast(word('saved'));}
  });
  $('bot-budget').onchange=()=>run(()=>window.arcade.botConfigure({budget:Number($('bot-budget').value)}));
  $('bot-pair').onclick=()=>run(()=>window.arcade.botLogin());
  $('bot-start').onclick=()=>run(()=>window.arcade.botConnect());
  $('bot-stop').onclick=()=>run(()=>window.arcade.botDisconnect());
  $('bot-native-copy').onclick=()=>run(async()=>{if(!window.arcade.botCopyNative)throw Error(word('notDesktop'));await window.arcade.botCopyNative();toast(word('copied'));});
  $('bot-native-open').onclick=()=>run(async()=>{if(!window.arcade.botNativeStart)throw Error(word('notDesktop'));await window.arcade.botNativeStart({resume:state?.native?.process?.canResume===true});});
  $('bot-native-new').onclick=()=>run(async()=>{if(!window.arcade.botNativeStart)throw Error(word('notDesktop'));await window.arcade.botNativeStart({resume:false});});
  $('bot-native-halt').onclick=()=>run(async()=>{if(!window.arcade.botNativeStop)throw Error(word('notDesktop'));await window.arcade.botNativeStop();});
  $('bot-forget').onclick=()=>run(async()=>{const profileId=credentialContext.profileId;if(window.confirm(word('confirmForget')))await window.arcade.botForget({profileId});});
  // No fabricated chat or successful execution in the standalone preview.
  if(data)window.renderBot(data);
})();
