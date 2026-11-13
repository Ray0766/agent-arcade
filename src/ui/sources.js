'use strict';
// Settings card for listen/notify data sources. The list is redrawn from the
// snapshot; the add form is built once so typing is never interrupted.
(() => {
  const card=el('article','settings-card sources-card');
  const title=el('h2',''),note=el('p',''),list=el('div','sources-list'),empty=el('p','fine'),form=el('form','sources-form'),status=el('div','');status.setAttribute('role','status');
  const kind=el('select',''),name=el('input',''),target=el('input',''),pick=el('button','secondary'),notify=el('select',''),add=el('button','primary');
  const recentTitle=el('h3',''),recent=el('ul','sources-recent');
  kind.id='source-kind';name.id='source-name';target.id='source-target';notify.id='source-notify';name.maxLength=60;target.maxLength=2000;pick.type='button';add.type='submit';
  const field=(control,labelNode)=>{const wrap=el('label','sources-field');wrap.append(labelNode,control);return wrap;};
  const labels={kind:el('span',''),name:el('span',''),target:el('span',''),notify:el('span','')};
  form.append(field(kind,labels.kind),field(name,labels.name),field(target,labels.target),pick,field(notify,labels.notify),add);
  // Quick starts: three common things to watch. Each preselects the type and moves to the next field.
  const QUICK=[
    {kind:'ics-file',zh:['日历','.ics 文件或订阅链接，如课程表'],en:['Calendar','An .ics file or subscription link, such as a timetable']},
    {kind:'folder',zh:['文件夹','如下载目录有新文件时'],en:['Folder','Such as new files in Downloads']},
    {kind:'feed',zh:['RSS 或网页','如博客更新时'],en:['RSS or web page','Such as a blog being updated']},
  ];
  const quick=el('div','sources-quick'),quickTitle=el('p','sources-quick-title');quick.setAttribute('role','group');
  const quickButtons=QUICK.map(item=>{
    const b=el('button','sources-quick-button'),head=el('strong',''),hint=el('span','');b.type='button';b.dataset.kind=item.kind;b.append(head,hint);
    b.onclick=()=>{if(busy)return;kind.value=item.kind;target.value='';syncForm();form.scrollIntoView({block:'nearest'});name.focus({preventScroll:true});};
    quick.append(b);return {item,b,head,hint};
  });
  card.append(title,note,list,empty,quickTitle,quick,form,status,recentTitle,recent);
  // Lives on the Notices page; Settings is the fallback when that page is absent.
  (document.getElementById('notices-content')||document.querySelector('#settings-view .settings-grid')).append(card);
  // The recent events can be shown as their own block by the shell.
  window.ArcadeSourcesParts={card,recentTitle,recent};
  const KINDS=[
    {id:'ics-file',kind:'ics',pick:'file',zh:'日历文件（.ics）',en:'Calendar file (.ics)'},
    {id:'ics-url',kind:'ics',zh:'日历订阅链接',en:'Calendar subscription link'},
    {id:'folder',kind:'folder',pick:'folder',zh:'文件夹',en:'Folder'},
    {id:'feed',kind:'feed',mode:'feed',zh:'RSS / Atom 订阅',en:'RSS / Atom feed'},
    {id:'page',kind:'feed',mode:'page',zh:'网页变化',en:'Web page change'},
  ];
  const NOTIFY=[['desktop','桌面通知','Desktop notification'],['companion','让搭档告诉我','Let my companion tell me'],['both','两者都要','Both'],['none','只记录','Record only']];
  let zh=true,busy=false,feedback='',key='',lang='';
  const tr=(a,b)=>zh?a:b;
  const kindLabel=row=>{const match=KINDS.find(k=>k.kind===row.kind&&(row.kind!=='feed'||k.mode===(row.mode||'feed'))&&(row.kind!=='ics'||(k.pick==='file')===!/^https:/i.test(row.target||'')));return match?tr(match.zh,match.en):row.kind;};
  const current=()=>KINDS.find(k=>k.id===kind.value)||KINDS[0];
  function syncForm(){
    const choice=current(),local=!!choice.pick;
    target.readOnly=local;target.placeholder=local?tr('点「选择」','Use Choose'):'https://';pick.hidden=!local;
    pick.textContent=tr('选择…','Choose…');
    for(const control of [kind,name,target,pick,notify,add,...quickButtons.map(row=>row.b)])control.disabled=busy;  }
  function fillOptions(){
    const keep=[kind.value,notify.value];
    kind.replaceChildren(...KINDS.map(k=>{const o=el('option','',tr(k.zh,k.en));o.value=k.id;return o;}));
    notify.replaceChildren(...NOTIFY.map(([id,a,b])=>{const o=el('option','',tr(a,b));o.value=id;return o;}));
    if(keep[0])kind.value=keep[0];if(keep[1])notify.value=keep[1];
  }
  async function run(fn){
    if(busy)return;busy=true;feedback='';syncForm();
    try{await fn();}catch(error){feedback=`${tr('没有保存','Not saved')}: ${error.message}`;}
    finally{busy=false;status.textContent=feedback;syncForm();}
  }
  kind.onchange=()=>{target.value='';syncForm();};
  pick.onclick=()=>run(async()=>{const chosen=await window.arcade.sourcesPick(current().pick);if(chosen)target.value=chosen;});
  form.onsubmit=event=>{
    event.preventDefault();const choice=current(),value=target.value.trim();
    if(!value){feedback=tr('先填写或选择要留意的位置。','Enter or choose what to watch first.');status.textContent=feedback;(choice.pick?pick:target).focus();return;}
    run(async()=>{
      await window.arcade.sourcesAdd({kind:choice.kind,mode:choice.mode,name:name.value.trim(),target:value,notify:notify.value});
      name.value='';target.value='';feedback=tr('已添加。','Added.');
    });
  };
  function row(source){
    const item=el('div','sources-row'),body=el('div','sources-row-body');item.dataset.sourceId=source.id;
    const checked=source.lastCheckedAt?new Date(source.lastCheckedAt).toLocaleString(zh?'zh-CN':'en'):tr('尚未检查','Not checked yet');
    body.append(el('strong','',source.name||kindLabel(source)),el('span','sources-meta',`${kindLabel(source)} · ${source.target||''}`),
      el('span',source.lastError?'sources-meta sources-error':'sources-meta',source.lastError?`${tr('上次检查失败','Last check failed')}: ${source.lastError.message||source.lastError.code||''}`:`${tr('上次检查','Last checked')}: ${checked}`));
    const enabled=el('input','');enabled.type='checkbox';enabled.checked=!!source.enabled;enabled.setAttribute('aria-label',`${tr('启用','Enable')} ${source.name||''}`);
    enabled.onchange=()=>run(()=>window.arcade.sourcesUpdate(source.id,{enabled:enabled.checked}));
    const how=el('select','');how.setAttribute('aria-label',tr('提醒方式','How to notify'));how.append(...NOTIFY.map(([id,a,b])=>{const o=el('option','',tr(a,b));o.value=id;return o;}));how.value=source.notify;
    how.onchange=()=>run(()=>window.arcade.sourcesUpdate(source.id,{notify:how.value}));
    const remove=el('button','plain',tr('移除','Remove'));remove.type='button';remove.setAttribute('aria-label',`${tr('移除','Remove')} ${source.name||''}`);
    remove.onclick=()=>run(()=>window.arcade.sourcesRemove(source.id));
    item.append(body,enabled,how,remove);return item;
  }
  window.renderSources=data=>{
    if(typeof window.arcade?.sourcesAdd!=='function'){card.hidden=true;return;}
    zh=data.config?.language==='zh';
    const sources=data.sources?.list||[],events=data.sources?.recent||[];
    if(lang!==data.config?.language){
      lang=data.config?.language;key='';
      title.textContent=tr('数据源','Data sources');
      note.textContent=tr('让 Agent Arcade 留意日历、文件夹和网页更新，并按你选的方式提醒。默认没有任何来源；网络来源只访问你填写的地址，文件夹只看文件名。','Let Agent Arcade watch calendars, folders and web updates, and tell you the way you choose. Nothing is watched by default; network sources only contact the address you enter, and folders are read for file names only.');
      labels.kind.textContent=tr('类型','Type');labels.name.textContent=tr('名称（可选）','Name (optional)');labels.target.textContent=tr('位置','Location');labels.notify.textContent=tr('提醒方式','How to notify');
      quickTitle.textContent=tr('想留意什么？点一个开始：','What should be watched? Pick one to start:');quick.setAttribute('aria-label',tr('常见的数据源','Common sources'));
      for(const row of quickButtons){const [a,b]=zh?row.item.zh:row.item.en;row.head.textContent=a;row.hint.textContent=b;}
      add.textContent=tr('添加数据源','Add source');recentTitle.textContent=tr('最近事件','Recent events');fillOptions();syncForm();
    }
    const next=JSON.stringify([sources,events,data.sources?.problem]);
    if(next===key)return;key=next;
    const focusedId=list.contains(document.activeElement)?document.activeElement.closest('.sources-row')?.dataset.sourceId:null,focusedTag=document.activeElement?.tagName;
    list.replaceChildren(...sources.map(row));
    if(focusedId){const again=[...list.children].find(item=>item.dataset.sourceId===focusedId);(again?.querySelector(focusedTag?.toLowerCase()||'input')||add).focus({preventScroll:true});}
    empty.hidden=sources.length>0;empty.textContent=data.sources?.problem?`${tr('数据源配置无法读取','The source list could not be read')}: ${data.sources.problem}`:tr('还没有数据源。','No sources yet.');
    recentTitle.hidden=recent.hidden=!events.length;
    recent.replaceChildren(...events.slice(0,8).map(event=>{const li=el('li','');li.append(el('span','',event.title||''),el('time','sources-meta',event.at?new Date(event.at).toLocaleString(zh?'zh-CN':'en'):''));return li;}));
  };
})();
