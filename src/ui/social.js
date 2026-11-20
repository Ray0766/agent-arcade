'use strict';
(() => {
  // Keep this panel alive when the connection page refreshes. In particular,
  // receipt polling must not discard a half-written character or memory note.
  const panel = el('details', 'onboarding-extra social-panel');
  panel.id = 'social-panel';
  let latest, appState, language, accountId, savedKey = '', dirty = false, working = false, confirmingForget = false;
  let controls = {}, message = '', refs = {};
  const words = {
    zh: {
      title:'相处方式', subtitle:'让角色延续对话，也有自己的日常。', enabled:'用陪伴模式连接 QQ',
      enabledNote:'这一连接专注聊天，不执行文件或命令。需要派活时，断开后关闭陪伴模式。',
      character:'角色形象', name:'她的名字', description:'公开人设与兴趣（可用于空间文案）', notes:'希望她记住的事 · 私人记忆',
      notesHint:'只用于与你聊天，不用于空间文案。写下你希望保留的偏好、称呼或话题。', notesUnavailable:'先用这位角色连接一次 QQ，确认联系人后，再断开来填写这份私人记忆。',
      proactiveMessages:'让她主动找我聊天', proactiveNote:'私聊只联系你绑定的 QQ 号。单独允许主动消息的群也遵守下方的联系时段和额度。她可以选择不发。',
      qqImageMessages:'看懂我发来的 QQ 图片', qqImageNote:'当前主人私聊的单张 JPG / PNG 会交给所选 AI 看图并以文字回复，按 API 正常计费。支持 Claude API、GPT API 与 DeepSeek Flash；也可明确引用这段私聊中的单张图片，不浏览其他历史。', qqImageUnavailable:'当前接入暂不支持看图，不会上传图片。可选择 Claude API、GPT API 或 DeepSeek Flash。',
      qqVoiceMessages:'听懂我发来的 QQ 语音', qqVoiceNote:'需要本机 Qwen 识别模型。只处理你的私聊语音（最长 30 秒），以文字回复；转写内容会交给所选 AI，不用于发布、授权或修改记忆。默认关闭。',
      qzonePosts:'让她发布 QQ 空间动态', qzoneNote:'文字动态设为仅指定的你可见。真实账号的可见范围仍待验收。',
      timing:'联系时间与频率', activeStart:'开始时间', activeEnd:'结束时间', intervalMinutes:'考虑主动活动的间隔（分钟）',
      maxMessagesPerDay:'每天最多主动聊天次数', maxPostsPerDay:'每天最多空间动态条数', timeNote:'使用这台电脑的本地时间；仅在应用已连接时活动。不补发错过的活动。',
      save:'保存相处方式', saved:'已保存，下次连接生效。', pause:'暂停主动活动', paused:'主动活动已暂停，仍可继续聊天。',
      consider:'现在考虑一次', considerNote:'按已保存的时间与频率限制执行；刚聊过 15 分钟内保持安静，也可能选择不打扰。',
      offline:'保存后，连接 QQ 开始相处。', locked:'连接中可以暂停活动。修改角色或相处方式，请先断开。',
      unsupported:'先选择 QQ 和本机 Claude、Claude API、GPT API、DeepSeek、Gemini 或豆包 API。Codex 陪伴模式尚未支持。',
      unavailable:'此版本尚未提供陪伴模式控制。', active:'陪伴中', ready:'已设置', disabled:'未开启', busy:'正在考虑',
      privacy:'记忆与最近活动', privacyNote:'最近 120 条对话和你填写的记忆保存在本机，按角色与联系人分开。生成回复时会交给所选模型；API 用量照常计费。不是无限记忆。',
      memoryEmpty:'连接后，从 QQ 和她说第一句话。', recent:'最近的主动活动', noActions:'还没有主动活动。',
      forget:'清除这位角色的记忆…', forgetConfirm:'清除对话和记忆', forgetNote:'删除本机保存的当前角色与联系人的对话和记忆，并暂停主动活动。QQ 消息与空间动态保留。', cancel:'保留记忆',
      forgotten:'已清除当前记忆并暂停主动活动。', failed:'操作未完成', unsaved:'有未保存的修改', activityDraft:'草稿', activityWait:'选择等待', activitySending:'正在发送', activitySent:'接口已接受', activityUnknown:'发送结果不确定', activityFailed:'未发送',
      you:'你', characterRole:'角色', history:'最近保存的对话', pending:'请稍候…', selectedIndependent:'形象与 AI 登录分开选择；使用项目原创头像。',
      disconnectForget:'断开连接后可清除记忆。', decisionWait:'这次没有主动活动。', decisionCooldown:'还没到下一次主动活动时间。', decisionQuiet:'当前不在联系时段，或已达到今日频率限制。', decisionBusy:'正在处理对话，这次不主动打扰。', decisionAccepted:'已提交这次活动，接口回执见下方。', decisionFailed:'这次活动未完成，请查看下方记录。'
    },
    en: {
      title:'Companion', subtitle:'A continuing conversation, with a daily life of her own.', enabled:'Use companion mode on QQ',
      enabledNote:'This connection is for conversation, without file or command actions. Disconnect and turn this off to dispatch work.',
      character:'Character portrait', name:'Her name', description:'Public persona and interests (may appear in posts)', notes:'Things to remember · private',
      notesHint:'Used only in your conversation, not for posts. Add preferences, names or topics you want to keep.', notesUnavailable:'Connect this character to QQ once to verify the contact, then disconnect to add private memory notes.',
      proactiveMessages:'Let her start conversations', proactiveNote:'Private chat only contacts your bound QQ account. Groups with proactive messages enabled also follow the hours and limits below. She may choose to stay quiet.',
      qqImageMessages:'Understand my QQ pictures', qqImageNote:'A single current JPG / PNG from your private chat goes to the selected AI for a text reply, with normal API usage. Supports Claude API, GPT API and DeepSeek Flash, including one explicitly quoted picture in this private chat; other history is not browsed.', qqImageUnavailable:'The current connection does not support pictures; no image is uploaded. Choose Claude API, GPT API or DeepSeek Flash.',
      qqVoiceMessages:'Understand my QQ voice messages', qqVoiceNote:'Requires a configured local Qwen model. Your private voice messages (up to 30 seconds) receive text replies. Transcripts go to the selected AI, without triggering posts, approvals or memory commands. Off by default.',
      qzonePosts:'Let her publish Qzone posts', qzoneNote:'Text posts target only your bound account. Visibility still needs real-account acceptance.',
      timing:'Hours and frequency', activeStart:'From', activeEnd:'Until', intervalMinutes:'Consider activity every (minutes)',
      maxMessagesPerDay:'Maximum conversations started per day', maxPostsPerDay:'Maximum Qzone posts per day', timeNote:'Uses this computer’s local time, while connected. Missed activity is not replayed.',
      save:'Save companion settings', saved:'Saved for the next connection.', pause:'Pause proactive activity', paused:'Proactive activity paused. Conversation can continue.',
      consider:'Consider activity now', considerNote:'Respects saved hours and limits, including 15 quiet minutes after conversation. She may choose not to interrupt.',
      offline:'Save, then connect QQ to start.', locked:'You can pause activity while connected. Disconnect to edit the character or settings.',
      unsupported:'Select QQ with local Claude, Claude API, GPT API, DeepSeek, Gemini or Doubao API. Codex companion mode is not supported yet.',
      unavailable:'Companion controls are unavailable in this build.', active:'Together', ready:'Configured', disabled:'Off', busy:'Considering',
      privacy:'Memory and recent activity', privacyNote:'The last 120 messages and your memory notes stay on this device, separated by character and contact. They are sent to your selected model for replies; API usage is billed normally. Memory is not unlimited.',
      memoryEmpty:'Connect, then say hello to her on QQ.', recent:'Recent proactive activity', noActions:'No proactive activity yet.',
      forget:'Clear this character’s memory…', forgetConfirm:'Clear conversation and memory', forgetNote:'Deletes this character/contact’s locally saved conversation and notes, and pauses proactive activity. QQ messages and Qzone posts are kept.', cancel:'Keep memory',
      forgotten:'Current memory cleared and proactive activity paused.', failed:'Action did not finish', unsaved:'Unsaved changes', activityDraft:'Draft', activityWait:'Chose to wait', activitySending:'Sending', activitySent:'Accepted by bridge', activityUnknown:'Delivery uncertain', activityFailed:'Not sent',
      you:'You', characterRole:'Character', history:'Recently saved conversation', pending:'Please wait…', selectedIndependent:'Choose a character separately from the AI login. All portraits are project originals.',
      disconnectForget:'Disconnect before clearing memory.', decisionWait:'No proactive activity this time.', decisionCooldown:'It is not time for another proactive activity yet.', decisionQuiet:'Outside contact hours, or today’s limit has been reached.', decisionBusy:'A conversation is in progress. No proactive interruption.', decisionAccepted:'Activity submitted. See the bridge receipt below.', decisionFailed:'This activity did not finish. See the record below.'
    }
  };
  const defaults = {enabled:false,characterId:'claude-ju',name:'橘',description:'',notes:'',proactiveMessages:false,qzonePosts:false,qqVoiceMessages:false,qqImageMessages:true,activeStart:9,activeEnd:22,intervalMinutes:180,maxMessagesPerDay:2,maxPostsPerDay:1};
  const tr = key => words[language || 'en'][key] || key;
  const setStatus = value => {message = value; if(refs.message) refs.message.textContent = message;};
  const add = (tag, cls, text) => el(tag, cls, text);
  function field(name, type, parent, {maxLength, min, max} = {}) {
    const wrap=add('div','social-field'), label=add('label','',tr(name));label.htmlFor=`social-${name}`;
    const input=add(type==='textarea'?'textarea':'input','');input.id=label.htmlFor;
    if(type!=='textarea')input.type=type;
    if(maxLength)input.maxLength=maxLength;
    if(min!==undefined)input.min=String(min);if(max!==undefined)input.max=String(max);
    if(type==='number')input.step='1';
    if(type==='textarea')input.rows=name==='description'?3:3;
    input.oninput=()=>{dirty=true;setStatus(tr('unsaved'));};
    controls[name]=input;wrap.append(label,input);parent.append(wrap);return input;
  }
  function toggle(name, note, parent) {
    const row=add('div','social-toggle-row'), label=add('label','social-toggle'), input=add('input','');input.type='checkbox';input.id=`social-${name}`;input.onchange=()=>{dirty=true;setStatus(tr('unsaved'));};
    label.append(input,add('span','',tr(name)));row.append(label,add('p','social-hint',tr(note)));parent.append(row);controls[name]=input;return row;
  }
  function build() {
    const wasOpen=panel.open;panel.replaceChildren();controls={};refs={};
    const summary=add('summary','social-summary');summary.append(add('span','',tr('title')));refs.state=add('span','social-state');summary.append(refs.state);panel.append(summary);
    const body=add('div','social-body');body.append(add('p','social-intro',tr('subtitle')));
    refs.notice=add('p','social-notice');body.append(refs.notice);
    const form=add('form','social-form');form.noValidate=false;form.onsubmit=event=>{event.preventDefault();void invoke('socialConfigure',readFields(),tr('saved'));};
    refs.fields=add('fieldset','social-fields');const legend=add('legend','sr-only',tr('title'));refs.fields.append(legend);
    toggle('enabled','enabledNote',refs.fields);refs.imageNote=toggle('qqImageMessages','qqImageNote',refs.fields).querySelector('p');toggle('qqVoiceMessages','qqVoiceNote',refs.fields);
    const identity=add('div','social-identity');refs.avatar=add('img','social-avatar');refs.avatar.alt='';identity.append(refs.avatar);
    const identityFields=add('div','social-identity-fields');
    const choiceWrap=add('div','social-field'),choiceLabel=add('label','',tr('character')),select=add('select','');select.id='social-characterId';choiceLabel.htmlFor=select.id;
    const personas=appState?.personas||[];
    for(const persona of personas){const item=add('option','',persona.name[language]||persona.name.en);item.value=persona.id;select.append(item);}
    if(!personas.length){const fallback=add('option','','橘 / Ju');fallback.value='claude-ju';select.append(fallback);}
    select.onchange=()=>{const persona=personas.find(p=>p.id===select.value);if(persona){controls.name.value=persona.name[language]||persona.name.en;controls.description.value=persona.description[language]||persona.description.en;}controls.notes.value='';controls.proactiveMessages.checked=false;controls.qzonePosts.checked=false;updateAvatar();dirty=true;setStatus(tr('unsaved'));renderControls();};
    controls.characterId=select;choiceWrap.append(choiceLabel,select);identityFields.append(choiceWrap);field('name','text',identityFields,{maxLength:40});identity.append(identityFields);refs.fields.append(identity,add('p','social-hint',tr('selectedIndependent')));
    field('description','textarea',refs.fields,{maxLength:800});field('notes','textarea',refs.fields,{maxLength:1000});refs.notesHint=add('p','social-hint',tr('notesHint'));refs.fields.append(refs.notesHint);
    const activities=add('div','social-activities');toggle('proactiveMessages','proactiveNote',activities);toggle('qzonePosts','qzoneNote',activities);refs.fields.append(activities);
    const hours=add('details','social-hours');hours.append(add('summary','',tr('timing')));const grid=add('div','social-limit-grid');
    field('activeStart','number',grid,{min:0,max:23});field('activeEnd','number',grid,{min:0,max:24});field('intervalMinutes','number',grid,{min:30,max:1440});field('maxMessagesPerDay','number',grid,{min:0,max:10});field('maxPostsPerDay','number',grid,{min:0,max:3});hours.append(grid,add('p','social-hint',tr('timeNote')));refs.fields.append(hours);
    refs.save=add('button','primary',tr('save'));refs.save.type='submit';refs.save.id='social-save';refs.fields.append(refs.save);form.append(refs.fields);body.append(form);
    const live=add('div','social-live-actions');refs.pause=add('button','secondary',tr('pause'));refs.pause.id='social-pause';refs.pause.onclick=()=>void invoke('socialPause',undefined,tr('paused'));
    refs.consider=add('button','plain',tr('consider'));refs.consider.id='social-consider';refs.consider.onclick=()=>void invoke('socialConsider');live.append(refs.pause,refs.consider);body.append(live,add('p','social-hint',tr('considerNote')));
    refs.message=add('p','social-operation');refs.message.id='social-operation';refs.message.setAttribute('role','status');refs.message.setAttribute('aria-live','polite');body.append(refs.message);
    const memory=add('details','social-memory');memory.append(add('summary','',tr('privacy')),add('p','social-hint',tr('privacyNote')));memory.append(add('h3','',tr('history')));refs.history=add('ol','social-history');memory.append(refs.history,add('h3','',tr('recent')));refs.actions=add('ol','social-action-list');memory.append(refs.actions);
    refs.forget=add('button','plain social-forget',tr('forget'));refs.forget.id='social-forget';refs.forget.onclick=()=>{confirmingForget=true;renderControls();};
    refs.forgetBox=add('div','social-forget-confirm');refs.forgetBox.append(add('p','',tr('forgetNote')));const forgetYes=add('button','secondary',tr('forgetConfirm'));forgetYes.id='social-forget-confirm';forgetYes.onclick=()=>void invoke('socialForget',undefined,tr('forgotten'));const forgetNo=add('button','plain',tr('cancel'));forgetNo.onclick=()=>{confirmingForget=false;renderControls();refs.forget.focus();};refs.forgetBox.append(forgetYes,forgetNo);memory.append(refs.forget,refs.forgetBox);body.append(memory);panel.append(body);panel.open=wasOpen;
  }
  function updateAvatar(){const persona=appState?.personas?.find(p=>p.id===controls.characterId.value);refs.avatar.src=persona?.portrait||'portraits/claude-ju-anime-v2.png';}
  function writeFields(config){for(const [key,input]of Object.entries(controls)){if(input.type==='checkbox')input.checked=config[key]===true;else input.value=config[key]??defaults[key];}updateAvatar();}
  function readFields(){const config={};for(const [key,input]of Object.entries(controls))config[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;return config;}
  function renderControls(){
    const social=latest?.social||{}, connected=latest?.status!=='disconnected'&&latest?.status!==undefined;
    const supported=latest?.channel==='qq'&&social.supported===true&&['claude','api','gpt','deepseek','gemini','doubao'].includes(latest?.mode),available=!!window.arcade.socialConfigure;
    refs.fields.disabled=working||connected||!supported||!available;
    const memoryReady=social.memoryReady===true&&controls.characterId.value===social.config?.characterId;
    controls.notes.disabled=!memoryReady;refs.notesHint.textContent=tr(memoryReady?'notesHint':'notesUnavailable');
    refs.imageNote.textContent=tr(social.imageInput?.supported===false?'qqImageUnavailable':'qqImageNote');
    refs.state.textContent=social.busy?tr('busy'):social.active?tr('active'):social.config?.enabled?tr('ready'):tr('disabled');
    refs.state.dataset.active=String(!!social.active);
    refs.notice.textContent=!available?tr('unavailable'):!supported?tr('unsupported'):connected?tr('locked'):tr('offline');
    refs.pause.disabled=working||!available||!(social.config?.proactiveMessages||social.config?.qzonePosts||social.busy);
    refs.consider.disabled=working||!window.arcade.socialConsider||!social.active||!!social.busy;
    refs.forget.disabled=working||connected||!window.arcade.socialForget;refs.forget.title=connected?tr('disconnectForget'):'';
    refs.forget.hidden=confirmingForget;refs.forgetBox.hidden=!confirmingForget;
    refs.forgetBox.querySelectorAll('button').forEach(button=>button.disabled=working||connected);
    refs.message.textContent=working?tr('pending'):message||social.problem||'';
    refs.history.replaceChildren();const history=(social.history||[]).slice(-6);
    if(!history.length)refs.history.append(add('li','social-empty',tr('memoryEmpty')));
    for(const entry of history){const item=add('li',''),who=add('strong','',entry.role==='user'?tr('you'):social.config?.name||tr('characterRole'));item.append(who,add('p','',String(entry.text||'').slice(0,1000)));refs.history.append(item);}
    refs.actions.replaceChildren();const actions=[...(social.actions||[])].sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,6);
    if(!actions.length)refs.actions.append(add('li','social-empty',tr('noActions')));
    const states={draft:'activityDraft',planned:'activityDraft',wait:'activityWait',waiting:'activityWait',attempting:'activitySending',sending:'activitySending',accepted:'activitySent',sent:'activitySent',published:'activitySent',unknown:'activityUnknown',failed:'activityFailed',cancelled:'activityFailed',skipped:'activityWait'};
    for(const entry of actions){const item=add('li',''),meta=add('div','social-action-meta');meta.append(add('strong','',tr(states[entry.state]||'activityUnknown')));if(entry.at){const time=add('time','',new Date(entry.at).toLocaleString(language==='zh'?'zh-CN':'en'));time.dateTime=new Date(entry.at).toISOString();meta.append(time);}item.append(meta,add('p','',String(entry.text||entry.reason||'').slice(0,1000)));refs.actions.append(item);}
  }
  async function invoke(method,value,success=''){
    if(working||!window.arcade[method])return;
    working=true;message='';renderControls();
    try{const result=await window.arcade[method](value);
      // A successful save may normalize settings (for example, pausing activity
      // after a character change). Render that saved state rather than the draft.
      if(method==='socialConfigure'){dirty=false;savedKey='';}
      if(result?.bot)window.renderSocial(result.bot,result);else if(result?.social)window.renderSocial(result,appState);if(method==='socialForget')confirmingForget=false;
      const decision=result?.socialDecision;
      if(method==='socialConsider'&&decision){const reason={busy:'decisionBusy',cooldown:'decisionCooldown',quiet_or_limit:'decisionQuiet',failed:'decisionFailed'}[decision.reason];success=tr(reason||(decision.accepted?'decisionAccepted':'decisionWait'));}
      setStatus(success);}
    catch(error){setStatus(`${tr('failed')}：${error.message}`);}
    finally{working=false;renderControls();}
  }
  window.renderSocial=(bot,full)=>{
    if(full?.accounts?.selectedId!==accountId){accountId=full?.accounts?.selectedId;dirty=false;savedKey='';message='';confirmingForget=false;}
    latest=bot||{};if(full)appState=full;const nextLanguage=appState?.config?.language==='zh'?'zh':'en';
    const config={...defaults,...latest.social?.config};const key=JSON.stringify(config);
    const draft=dirty&&language?readFields():null;
    if(language!==nextLanguage||!panel.childElementCount){language=nextLanguage;build();writeFields(draft||config);}
    else if(!dirty&&savedKey!==key)writeFields(config);
    savedKey=key;renderControls();
    const parent=$('connections-content');if(parent&&!panel.isConnected)parent.insertBefore(panel,$('onboarding-appearance')||null);
  };
  const original=window.renderConnections;
  window.renderConnections=next=>{original?.(next);window.renderSocial(next.bot,next);};
  if(data)window.renderSocial(data.bot,data);
})();
