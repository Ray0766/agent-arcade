'use strict';
// Application shell shared by every layout: the top bar (logo, workspace switch, navigation,
// quiet / language / compact / layout / accent / settings), the channel sub-navigation, the
// Notices page and the Interface settings card. Presentation only: views are still switched by
// app.js switchView(), and every legacy control keeps its id and handler.
//
//  window.ArcadeShell
//    WORKSPACE_OF            view name -> 'companion' | 'work' (settings belongs to neither)
//    open(view)              switch view (and with it, the workspace)
//    setWorkspace(name)      switch workspace, return to its last view, remember the choice
//    layoutChoice(large)     -> {node, sync(data)}   the three-layout picker
//    accentControl()         -> {node, sync(data)}   follow-character / presets / custom colour
//    icon(paths, box)        small inline SVG built with DOM APIs
//  Layout modules receive a context from renderShell:
//    {view, workspace, language, zh, tr(zh,en), target, bar, main}
(() => {
  const NS='http://www.w3.org/2000/svg';
  const WORKSPACE_OF={bot:'companion',characters:'companion',relationship:'companion',notices:'companion',notes:'companion',tasks:'work',scene:'work',activity:'work',work:'work',connections:'work',accounts:'work','qq-runtime':'work'};
  const ORDER={companion:['bot','characters','relationship','notes','notices'],work:['scene','tasks','activity','work','connections']};
  const CHANNEL=['connections','accounts','qq-runtime'];
  const LABELS={bot:['对话','Chat'],characters:['角色','Characters'],relationship:['相处','Together'],notices:['提醒','Notices'],notes:['笔记','Notes'],tasks:['任务','Tasks'],scene:['会话','Sessions'],activity:['事件','Activity'],work:['工作与结果','Work & results'],connections:['渠道','Channels'],accounts:['搭档与账号','Companions'],'qq-runtime':['QQ 账号','QQ accounts'],settings:['设置','Settings']};
  const LAYOUTS=[
    {id:'immersive',name:['沉浸','Immersive'],note:['角色立绘铺满舞台，对话在右侧的玻璃栏里。','Character art fills the stage; the conversation sits in a glass column.']},
    {id:'messenger',name:['聊天','Messenger'],note:['左边是会话列表，像平时用的聊天软件。','A conversation list on the left, like a familiar messenger.']},
    {id:'minimal',name:['简洁','Minimal'],note:['居中的单栏，只留下文字。','One centred column that keeps to the text.']},
  ];
  const PRESET_NAMES=[['橘','Orange'],['珊瑚红','Coral'],['粉','Pink'],['紫','Violet'],['蓝','Blue'],['青','Teal'],['绿','Green'],['灰','Grey']];
  let zh=true,currentWs=null,lastConfigWs=null,latest=null;
  const remembered={companion:'bot',work:'scene'};
  const tr=(a,b)=>zh?a:b;
  const pair=value=>tr(value[0],value[1]);
  function icon(shapes,box='0 0 24 24',size=18){
    const svg=document.createElementNS(NS,'svg');
    for(const [k,v] of Object.entries({viewBox:box,width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);
    for(const shape of shapes){const [tag,attributes]=typeof shape==='string'?['path',{d:shape}]:shape,node=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attributes))node.setAttribute(k,String(v));svg.append(node);}
    return svg;
  }
  const setText=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};
  const label=(node,text)=>{if(!node)return;if(node.getAttribute('aria-label')!==text)node.setAttribute('aria-label',text);if(node.title!==text)node.title=text;};

  // ---- bar ----
  const bar=el('div','shell-bar');bar.id='shell-bar';bar.setAttribute('role','banner');
  const sidebar=document.querySelector('aside.sidebar'),nav=document.querySelector('nav'),main=document.querySelector('main');
  const brand=document.querySelector('.brand')||el('div','brand');brand.classList.add('shell-brand');
  const ws=el('div','shell-ws');ws.setAttribute('role','group');
  const wsButtons={};
  for(const name of ['companion','work']){const b=el('button','shell-ws-button');b.type='button';b.id='ws-'+name;b.dataset.workspace=name;b.onclick=()=>setWorkspace(name);wsButtons[name]=b;ws.append(b);}
  nav.classList.add('shell-nav');
  const observer=document.querySelector('.connection')||el('div','connection');observer.classList.add('shell-observer');
  const version=observer.querySelector('.version');
  const tools=el('div','shell-tools');
  const picker=$('view-picker'),quiet=$('quiet'),language=$('language'),legacyCompact=$('compact');
  // Quiet becomes an icon toggle; app.js keeps aria-pressed in sync and still owns the click.
  delete quiet.dataset.i18n;quiet.className='shell-tool';quiet.replaceChildren(icon(['M6 16v-5a6 6 0 0 1 9.2-5.1','M18 11v5l1.5 2H8','M10 20a2 2 0 0 0 4 0','M4 4l16 16']));
  language.className='shell-tool shell-tool-text';
  // The legacy Compact button keeps its id, text and handler; this one presses it.
  legacyCompact.hidden=true;
  const compact=el('button','shell-tool');compact.type='button';compact.id='shell-compact';compact.append(icon(['M9 4v5H4','M15 20v-5h5','M20 9h-5V4','M4 15h5v5']));compact.onclick=()=>legacyCompact.click();
  const settings=nav.querySelector('[data-view="settings"]');settings.classList.add('shell-tool');settings.classList.remove('nav');
  // App settings use a gear; the sliders icon stays with the conversation settings on the chat page.
  const GEAR=[['circle',{cx:12,cy:12,r:6.2}],['circle',{cx:12,cy:12,r:2.4}],'M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.49 5.49l1.84 1.84M16.67 16.67l1.84 1.84M5.49 18.51l1.84-1.84M16.67 7.33l1.84-1.84'];
  settings.querySelector('svg')?.replaceWith(icon(GEAR));
  const pops=[];
  function popover(button,panel,name){
    const wrap=el('div','shell-pop');wrap.dataset.pop=name;panel.classList.add('shell-pop-panel');panel.hidden=true;panel.setAttribute('role','dialog');
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
    const close=focus=>{if(panel.hidden)return;panel.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});};
    button.addEventListener('click',()=>{const opening=panel.hidden;for(const other of pops)other(false);if(opening){panel.hidden=false;button.setAttribute('aria-expanded','true');}});
    wrap.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){event.stopPropagation();close(true);}});
    wrap.addEventListener('focusout',event=>{if(event.relatedTarget&&!wrap.contains(event.relatedTarget))close(false);});
    document.addEventListener('pointerdown',event=>{if(!wrap.contains(event.target))close(false);});
    pops.push(close);wrap.append(button,panel);return wrap;
  }

  // ---- layout picker ----
  const SCHEMATIC={
    immersive:[['rect',{x:1.5,y:1.5,width:33,height:21,rx:4}],['circle',{cx:10,cy:10,r:3}],'M4.5 20.5c.8-3.6 2.9-5 5.5-5s4.7 1.4 5.5 5',['rect',{x:20,y:5,width:11.5,height:14,rx:2,class:'schematic-fill'}]],
    messenger:[['rect',{x:1.5,y:1.5,width:33,height:21,rx:4}],'M12.5 1.5v21','M4.5 7h5M4.5 12h5M4.5 17h5',['rect',{x:16,y:5.5,width:9,height:4.5,rx:2,class:'schematic-fill'}],['rect',{x:22,y:13.5,width:9,height:4.5,rx:2}]],
    minimal:[['rect',{x:1.5,y:1.5,width:33,height:21,rx:4}],'M11 8h14M11 12h14M11 16h9'],
  };
  function layoutChoice(large=false){
    const node=el('div',large?'layout-choice layout-choice-large':'layout-choice');node.setAttribute('role','group');
    const rows=LAYOUTS.map(item=>{
      const b=el('button','layout-option');b.type='button';b.dataset.layout=item.id;
      const name=el('strong',''),note=el('span','layout-option-note'),text=el('span','layout-option-text');text.append(name,note);
      b.append(icon(SCHEMATIC[item.id],'0 0 36 24',large?72:36),text);
      b.onclick=()=>{if(latest?.config?.layout!==item.id)action(()=>window.arcade.configure({layout:item.id}));};
      node.append(b);return {item,b,name,note};
    });
    return {node,sync(data){
      node.setAttribute('aria-label',tr('界面布局','Interface layout'));
      const chosen=document.documentElement.dataset.layout;
      for(const row of rows){setText(row.name,pair(row.item.name));setText(row.note,pair(row.item.note));row.b.setAttribute('aria-pressed',String(row.item.id===chosen));}
    }};
  }
  // ---- accent control ----
  function accentControl(){
    const node=el('div','accent-control'),auto=el('button','accent-auto'),swatches=el('div','accent-swatches'),custom=el('label','accent-custom'),customText=el('span',''),input=el('input','');
    auto.type='button';swatches.setAttribute('role','group');input.type='color';
    const set=value=>action(()=>window.arcade.configure({accent:value}));
    auto.onclick=()=>set('auto');
    const buttons=(window.ArcadeTheme?.PRESETS||[]).map((hex,index)=>{const b=el('button','accent-swatch');b.type='button';b.dataset.accent=hex;b.style.setProperty('--swatch',hex);b.onclick=()=>set(hex);swatches.append(b);return {b,hex,index};});
    input.onchange=()=>set(input.value);
    custom.append(customText,input);node.append(auto,swatches,custom);
    return {node,sync(data){
      const chosen=typeof data.config?.accent==='string'&&data.config.accent!=='auto'?data.config.accent.toLowerCase():'auto';
      setText(auto,tr('跟随角色','Follow the character'));auto.setAttribute('aria-pressed',String(chosen==='auto'));
      auto.title=tr('每位角色用自己的颜色','Each character brings its own colour');
      swatches.setAttribute('aria-label',tr('预设颜色','Preset colours'));
      for(const {b,hex,index} of buttons){label(b,pair(PRESET_NAMES[index]||['预设','Preset']));b.setAttribute('aria-pressed',String(chosen===hex));}
      setText(customText,tr('自定义','Custom'));
      const value=chosen==='auto'?window.ArcadeTheme?.accent()||'#b45a86':chosen;if(document.activeElement!==input&&input.value!==value)input.value=value;
      custom.dataset.active=String(chosen!=='auto'&&!buttons.some(row=>row.hex===chosen));
    }};
  }
  const layoutButton=el('button','shell-tool');layoutButton.type='button';layoutButton.id='shell-layout';
  const layoutPanel=el('div','');const layoutTitle=el('p','shell-pop-title');const barLayouts=layoutChoice(false);layoutPanel.append(layoutTitle,barLayouts.node);
  const accentButton=el('button','shell-tool');accentButton.type='button';accentButton.id='shell-accent';accentButton.append(el('span','accent-dot'));
  const accentPanel=el('div','');const accentTitle=el('p','shell-pop-title');const barAccent=accentControl();accentPanel.append(accentTitle,barAccent.node);
  tools.append(picker,quiet,language,compact,popover(layoutButton,layoutPanel,'layout'),popover(accentButton,accentPanel,'accent'),settings);
  bar.append(brand,ws,nav,observer,tools);
  document.body.insertBefore(bar,document.body.firstChild);
  if(sidebar)sidebar.hidden=true;

  // ---- navigation order and grouping ----
  const navButton=name=>nav.querySelector(`[data-view="${name}"]`);
  for(const name of [...ORDER.companion,...ORDER.work]){const b=navButton(name);if(b){b.dataset.ws=WORKSPACE_OF[name];nav.append(b);}}
  const qqNav=navButton('qq-runtime');if(qqNav)qqNav.dataset.ws='sub';
  if(!picker.querySelector('option[value="accounts"]')){const option=el('option','');option.value='accounts';picker.append(option);}
  const subnav=el('div','shell-subnav');subnav.id='shell-subnav';subnav.setAttribute('role','group');subnav.hidden=true;
  const subButtons={};
  for(const name of CHANNEL){const b=el('button','shell-subnav-button');b.type='button';b.dataset.target=name;b.onclick=()=>open(name);subButtons[name]=b;subnav.append(b);}
  main.insertBefore(subnav,main.querySelector('section.view'));

  function open(view){
    if(view==='accounts'&&typeof window.openCompanionManager==='function')window.openCompanionManager();
    else if(view==='qq-runtime'&&navButton('qq-runtime')?.hidden)switchView('connections');
    else switchView(view);
  }
  function setWorkspace(name){
    if(!ORDER[name])return;
    const view=document.body.dataset.view;
    if(WORKSPACE_OF[view]!==name){currentWs=name;open(remembered[name]||ORDER[name][0]);}
    if(latest?.config?.workspace!==name)action(()=>window.arcade.configure({workspace:name}));
  }

  // ---- Notices: recent events get their own block above the sources card ----
  const parts=window.ArcadeSourcesParts,notices=$('notices-content');
  const recentCard=el('article','settings-card notices-recent'),recentTitle=el('h2',''),recentEmpty=el('p','fine notices-empty');
  if(notices){recentCard.append(recentTitle,recentEmpty);if(parts?.recent){parts.recentTitle.remove();recentCard.append(parts.recent);}notices.prepend(recentCard);}

  // ---- Settings: Interface card (layout, accent, day/night) ----
  const grid=document.querySelector('#settings-view .settings-grid'),oldAppearance=grid?.querySelector('.appearance-card');
  const face=el('article','settings-card interface-card'),faceTitle=el('h2',''),layoutHead=el('h3',''),accentHead=el('h3',''),accentNote=el('p',''),schemeHead=el('h3','');
  const cardLayouts=layoutChoice(true),cardAccent=accentControl();
  face.id='interface-card';schemeHead.dataset.i18n='appearanceTitle';
  face.append(faceTitle,layoutHead,cardLayouts.node,accentHead,accentNote,cardAccent.node,schemeHead);
  if(oldAppearance){for(const node of [oldAppearance.querySelector('#appearance-note'),oldAppearance.querySelector('.appearance-options'),oldAppearance.querySelector('#appearance-status')])if(node)face.append(node);oldAppearance.remove();}
  // Language: the same switch as the top-bar button, where people look for it.
  const languageHead=el('h3',''),languageRow=el('div','language-choice');languageRow.setAttribute('role','group');
  const languageButtons=[['zh','中文'],['en','English']].map(([id,text])=>{const b=el('button','accent-auto',text);b.type='button';b.id='settings-language-'+id;b.lang=id==='zh'?'zh-CN':'en';b.onclick=()=>{if((latest?.config?.language==='zh'?'zh':'en')!==id)language.click();};languageRow.append(b);return {id,b};});
  face.append(languageHead,languageRow);
  grid?.prepend(face);
  // AI and key: which AI this profile uses, and the way to change it.
  const AI_NAMES={api:['Claude API','Claude API'],claude:['本机 Claude Code（程序模式）','local Claude Code (program mode)'],native:['Claude Channels（手动启动）','Claude Channels (manual startup)'],codex:['本机 Codex','local Codex'],gpt:['GPT API','GPT API'],deepseek:['DeepSeek API','DeepSeek API'],gemini:['Gemini API','Gemini API'],doubao:['豆包 API','Doubao API']};
  const KEY_MODES=['api','gpt','deepseek','gemini','doubao'];
  const ai=el('article','settings-card ai-card'),aiTitle=el('h2',''),aiState=el('p','ai-card-state'),aiRow=el('div','button-row'),aiButton=el('button','primary');
  ai.id='ai-card';aiState.id='ai-card-state';aiButton.type='button';aiButton.id='ai-card-open';aiRow.append(aiButton);ai.append(aiTitle,aiState,aiRow);
  function openAI(){
    try{if(typeof window.ArcadeFirstRun?.open==='function'){window.ArcadeFirstRun.open();return;}}catch{/* fall back to the connection guide */}
    switchView('connections');
  }
  aiButton.onclick=openAI;
  grid?.prepend(ai);
  // "Set up observer" on the empty Sessions page lands on the observer card, not the top of Settings.
  function openObserver(){
    if(document.body.dataset.view!=='settings')switchView('settings');
    requestAnimationFrame(()=>{const card=document.getElementById('observer-card')||$('install')?.closest('.settings-card');if(!card)return;card.scrollIntoView({block:'start'});($('install')||card).focus({preventScroll:true});});
  }
  $('connect')?.addEventListener('click',openObserver);
  const heading=document.querySelector('#settings-view .page-heading');
  if(heading&&version){const holder=el('span','settings-version');holder.append(version);heading.append(holder);}

  window.ArcadeShell=Object.freeze({WORKSPACE_OF,ORDER,CHANNEL,open,setWorkspace,layoutChoice,accentControl,icon,bar,main,openObserver,openAI});
  // Compact view picker: the current workspace's views in the bar's order, then Settings.
  let pickerKey='';
  function syncPicker(view,data){
    const qqHidden=!qqNav||qqNav.hidden,sub=CHANNEL.includes(view)&&view!=='connections'&&!(view==='qq-runtime'&&qqHidden)?view:'';
    const order=[...ORDER[currentWs]||[],...(sub?[sub]:[]),'settings'].filter(name=>navButton(name)||name==='settings'||name===sub);
    const key=`${currentWs}|${sub}|${order.join(',')}`;
    for(const option of picker.options){const name=option.value;if(LABELS[name])setText(option,pair(LABELS[name]));option.dataset.ws=WORKSPACE_OF[name]||'all';const show=order.includes(name)&&!(navButton(name)?.hidden&&name!==sub);if(option.hidden===show)option.hidden=!show;if(option.disabled===show)option.disabled=!show;}
    if(key===pickerKey)return;pickerKey=key;
    const byName=new Map([...picker.options].map(option=>[option.value,option])),value=picker.value;
    for(const name of order){const option=byName.get(name);if(option)picker.append(option);}
    for(const option of byName.values())if(!order.includes(option.value))picker.append(option);
    picker.value=value;
  }

  window.renderShell=data=>{
    latest=data;zh=data.config?.language==='zh';
    const root=document.documentElement,view=document.body.dataset.view||'scene',preferred=data.config?.workspace==='work'?'work':'companion';
    if(lastConfigWs===null){lastConfigWs=preferred;currentWs=WORKSPACE_OF[view]||preferred;}
    else if(preferred!==lastConfigWs){lastConfigWs=preferred;if((WORKSPACE_OF[view]||currentWs)!==preferred){currentWs=preferred;open(remembered[preferred]||ORDER[preferred][0]);return;}}
    if(WORKSPACE_OF[view]){currentWs=WORKSPACE_OF[view];remembered[currentWs]=view;}
    if(root.dataset.workspace!==currentWs)root.dataset.workspace=currentWs;
    // Workspace switch
    ws.setAttribute('aria-label',tr('工作区','Workspace'));
    setText(wsButtons.companion,tr('陪伴','Companion'));setText(wsButtons.work,tr('工作','Work'));
    for(const [name,b] of Object.entries(wsButtons))b.setAttribute('aria-pressed',String(name===currentWs));
    // Navigation: labels, grouping, current page
    nav.setAttribute('aria-label',tr(currentWs==='work'?'工作':'陪伴',currentWs==='work'?'Work':'Companion'));
    const group=CHANNEL.includes(view)?'connections':view;
    for(const b of nav.querySelectorAll('[data-view]')){
      const name=b.dataset.view,text=pair(LABELS[name]||[name,name]);setText(b.querySelector('span'),text);label(b,text);
      const active=name===group;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
    }
    label(settings,pair(LABELS.settings));settings.classList.toggle('active',view==='settings');if(view==='settings')settings.setAttribute('aria-current','page');else settings.removeAttribute('aria-current');
    syncPicker(view,data);
    // Channel sub-navigation
    subnav.hidden=!CHANNEL.includes(view);subnav.setAttribute('aria-label',pair(LABELS.connections));
    setText(subButtons.connections,tr('连接向导','Connection guide'));setText(subButtons.accounts,pair(LABELS.accounts));setText(subButtons['qq-runtime'],pair(LABELS['qq-runtime']));
    subButtons.accounts.hidden=!data.accounts;subButtons['qq-runtime'].hidden=!qqNav||qqNav.hidden;
    for(const [name,b] of Object.entries(subButtons)){const active=name===view;b.setAttribute('aria-pressed',String(active));}
    // Tools
    label(quiet,tr(data.config?.quiet?'免打扰：已开启':'免打扰：已关闭',data.config?.quiet?'Quiet mode: on':'Quiet mode: off'));
    label(language,tr('Switch to English','切换到中文'));
    label(compact,tr(data.config?.compact?'返回完整视图':'紧凑视图',data.config?.compact?'Full view':'Compact view'));compact.setAttribute('aria-pressed',String(!!data.config?.compact));
    label(layoutButton,tr('界面布局','Interface layout'));
    const chosenLayout=root.dataset.layout;if(layoutButton.dataset.layout!==chosenLayout){layoutButton.dataset.layout=chosenLayout;layoutButton.replaceChildren(icon(SCHEMATIC[chosenLayout]||SCHEMATIC.immersive,'0 0 36 24',24));}
    label(accentButton,tr('强调色','Accent colour'));
    setText(layoutTitle,tr('界面布局','Interface layout'));setText(accentTitle,tr('强调色','Accent colour'));
    barLayouts.sync(data);barAccent.sync(data);cardLayouts.sync(data);cardAccent.sync(data);
    // Observer state (Work workspace)
    const state=data.demo?'sample':data.lastEventAt?'connected':data.installed?'installed':'off';if(observer.dataset.state!==state)observer.dataset.state=state;
    // The observer only matters on the pages that show what it reports. The title doubles as the
    // tooltip when the label is hidden at narrow widths and only the dot is left.
    const observerText=`${tr('观察器','Observer')} · ${$('connection-label')?.textContent||''}`,observerShown=['scene','activity'].includes(view);
    if(observer.hidden===observerShown)observer.hidden=!observerShown;
    label(observer,observerText);if(observer.getAttribute('role')!=='img')observer.setAttribute('role','img');
    // AI and key card
    const bot=data.bot||{},mode=typeof bot.mode==='string'?bot.mode:'',aiName=AI_NAMES[mode]?pair(AI_NAMES[mode]):mode,needsKey=KEY_MODES.includes(mode);
    let needed=needsKey&&!bot.hasKey;try{if(typeof window.ArcadeFirstRun?.needed==='function')needed=!!window.ArcadeFirstRun.needed(data);}catch{/* keep the snapshot's answer */}
    setText(aiTitle,tr('AI 与密钥','AI and key'));
    setText(aiState,!mode?tr('还没有读到 AI 设置。','The AI settings have not been read yet.'):needed?tr(`还没有连接 AI。当前选的是 ${aiName}，${needsKey&&!bot.hasKey?'还没有保存密钥':'还不能开始聊天'}。填一个 API key 就能开始聊。`,`No AI is connected yet. ${aiName} is selected, ${needsKey&&!bot.hasKey?'but no key is saved':'but chat cannot start yet'}. Add one API key to start chatting.`):needsKey?tr(`当前 AI：${aiName}。密钥已保存在本机（系统加密）；这里不检查它是否有效。`,`Current AI: ${aiName}. The key is saved on this computer with OS encryption; it is not checked for validity here.`):tr(`当前 AI：${aiName}。沿用它自己的登录，不需要在这里填密钥。`,`Current AI: ${aiName}. It uses its own sign-in; no key is entered here.`));
    setText(aiButton,needed?tr('连接 AI','Connect an AI'):tr('更换 AI 或密钥','Change the AI or key'));
    setText(languageHead,tr('语言','Language'));languageRow.setAttribute('aria-label',tr('语言','Language'));
    for(const row of languageButtons)row.b.setAttribute('aria-pressed',String(row.id===(zh?'zh':'en')));
    // Notices and Settings copy
    setText(recentTitle,tr('最近的动静','Recent activity'));setText(recentEmpty,tr('还没有新的动静。添加数据源后，日历、文件夹和网页的更新会出现在这里。','Nothing new yet. After you add a source, calendar, folder and web updates appear here.'));
    setText(faceTitle,tr('界面','Interface'));setText(layoutHead,tr('布局','Layout'));setText(accentHead,tr('强调色','Accent colour'));
    setText(accentNote,tr('默认跟随当前角色；也可以固定成一个你喜欢的颜色。文字和按钮会自动保持清晰。','Follows the current character by default, or stays on a colour you pick. Text and buttons keep readable contrast automatically.'));
    window.ArcadeLayouts?.render(data,{view,workspace:currentWs,language:zh?'zh':'en',zh,tr,target:window.ArcadeTheme?.target(data),bar,main});
  };
  if(typeof data!=='undefined'&&data)render();
})();
