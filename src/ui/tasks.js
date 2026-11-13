'use strict';
// Tasks page (Work workspace): a board of background Claude Code tasks, each in its own git
// worktree. The board is drawn from the snapshot (data.taskBoard); what the owner is typing is
// kept in this file and a redraw waits while a text field on the page has focus.
// "Handed back" is never shown as done: only the owner's Accept marks a task verified.
(() => {
  const root=document.getElementById('tasks-content'),K=window.ArcadeKit,api=window.arcade;
  if(!root||!K||typeof api?.taskCapabilities!=='function')return;
  const CODES={
    project_not_picked:['请先用“选择项目文件夹…”选一个文件夹。任务只能建在这样选出来的文件夹上。','Choose a folder with “Choose project folder…” first. A task can only be created for a folder picked that way.'],
    invalid_title:['标题不能为空，最多 80 个字，不能换行。','The title cannot be empty, holds up to 80 characters and no line breaks.'],
    invalid_brief:['任务说明不能为空，最多 2000 个字。','The brief cannot be empty and holds up to 2000 characters.'],
    too_many_unfinished:['没做完的任务已达上限。请先验收、停止或移除一些。','Too many unfinished tasks. Accept, stop or remove some first.'],
    not_a_git_repository:['这个文件夹不在 git 仓库里。任务需要一个 git 仓库来建 worktree。','This folder is not inside a git repository. A task needs one to create its worktree.'],
    invalid_project:['这个文件夹不能用作项目。','This folder cannot be used as a project.'],
    git_unavailable:['这台电脑上没有找到 git。','git was not found on this computer.'],
    claude_unavailable:['这台电脑上没有找到 Claude Code。','Claude Code was not found on this computer.'],
    workspace_untrusted:['Claude Code 还没有被告知信任这个任务的 worktree 文件夹，应用不会替你同意。','Claude Code has not been told to trust this task’s worktree folder, and the app will not approve that for you.'],
    launch_uncertain:['不确定会话有没有启动。请到“会话”页或 Claude Code 里核对后再决定。','It is unclear whether the session started. Check the Sessions page or Claude Code before deciding.'],
    previous_launch_uncertain:['上一次派出有没有启动还不确定，所以没有再派一次。请先核对。','It is still unclear whether the previous launch started, so it was not launched again. Check first.'],
    too_many_sessions:['后台会话已达上限。请先停止一些。','Too many background sessions. Stop some first.'],
    nested_session:['应用本身运行在一个 Claude Code 会话里，不能从这里再启动会话。','The app itself runs inside a Claude Code session, so it cannot start another from here.'],
    background_unavailable:['这台电脑上的 Claude Code 不能启动后台会话。','Claude Code on this computer cannot start background sessions.'],
    launch_failed:['会话没有启动成功。','The session did not start.'],
    bad_state:['任务现在的状态不能做这个操作。','The task’s current state does not allow this.'],
    not_draft:['只有草稿可以修改。','Only a draft can be edited.'],
    unknown_task:['这个任务已经不存在。','This task no longer exists.'],
    reason_required:['请写下返工的原因。','Write down why it needs rework.'],
    reason_too_long:['原因太长了，请写短一些。','The reason is too long. Shorten it.'],
    stop_unconfirmed:['没能确认会话已经停止。请到 Claude Code 里核对。','The session could not be confirmed as stopped. Check in Claude Code.'],
    not_finished:['只有已结束的任务和草稿可以移除。请先停止会话。','Only finished tasks and drafts can be removed. Stop the session first.'],
    worktree_has_changes:['这个任务的 worktree 里还有没合并或没提交的改动。','This task’s worktree still holds unmerged or uncommitted changes.'],
    worktree_mismatch:['worktree 文件夹和记录的不一致，没有动它。请手动检查。','The worktree folder does not match the record, so it was left alone. Check it by hand.'],
    worktree_remove_failed:['worktree 没能删除。请关掉占用它的程序后再试，或手动删除。','The worktree could not be removed. Close programs using it and try again, or remove it by hand.'],
    no_worktree:['这个任务还没有 worktree（还没派出过）。','This task has no worktree yet (it was never dispatched).'],
    no_commits:['这个仓库还没有任何提交，无法建立 worktree。请先提交一次。','The repository has no commit yet, so a worktree cannot be created. Make a first commit.'],
    cancelled:['已取消。','Cancelled.'],
    busy:['上一项操作还没结束，请稍后再试。','Another action is still running. Try again shortly.'],
    internal:['操作没有完成，请稍后再试。','The action did not complete. Please try again.'],
  };
  const STATES={draft:['草稿','Draft'],dispatched:['已派出，等会话出现','Dispatched; waiting for the session'],running:['在做','Working'],rework:['返工中','Reworking'],needs_input:['等你处理','Needs you'],reported:['已交回，未验收','Handed back, not verified'],stalled:['没有新进展','No progress'],paused:['已暂停跟踪','Tracking paused'],unknown:['状态不明','State unknown'],stopped:['会话已停止，未验收','Session stopped, not verified'],verified:['你已验收','Verified by you']};
  const REASONS={reply_ended:['会话的回复结束了。这不代表任务已经做完。','The session’s reply ended. That does not mean the task is done.'],session_ended:['会话已经结束。这不代表任务已经做完。','The session ended. That does not mean the task is done.'],observer_unknown:['观察器给不出这个会话的状态。','The observer cannot tell this session’s state.'],restart_unmatched:['应用重启后没能对上原来的会话。请到 Claude Code 里核对。','After the app restarted, the original session could not be matched. Check in Claude Code.'],no_progress:['有一段时间没有看到新进展了。','No new progress has been seen for a while.'],launch_uncertain:['不确定会话有没有启动。','It is unclear whether the session started.'],launch_not_started:['上次派出没有启动会话，任务回到了草稿。','The last launch did not start a session, so the task is a draft again.'],session_waiting:['会话在等你：可能要你批准一个操作，或回答一个问题。请到那个 Claude Code 会话里处理。','The session is waiting for you: to approve something or answer a question. Handle it in that Claude Code session.'],session_failed:['会话报告了失败。','The session reported a failure.'],session_stopped:['会话已停止。','The session was stopped.'],accepted_by_owner:['你已验收。','You accepted it.'],rework_sent:['返工原因已送到会话。','The rework reason was delivered to the session.'],rework_not_delivered:['返工原因已记下，但没有送到会话。请你自己在那个会话里说明。','The rework reason is recorded but was not delivered to the session. Say it in that session yourself.'],stop_unconfirmed:['没能确认会话已经停止。','The session could not be confirmed as stopped.']};
  const FLAGS={unformatted:['交回的文字没有按约定的四段来写。','The hand-back text does not follow the agreed four parts.'],claims_fixed_without_check_table:['交回里说“修好了”，但没有附核对表。','The hand-back says “fixed” without a check table.'],bugfix_without_check_table:['这是修 bug 的任务，但交回里没有核对表。','This is a bug-fix task, but the hand-back has no check table.']};
  const PREAUTH={claude_unavailable:['没有找到 Claude Code','Claude Code was not found'],background_sessions_unavailable:['这台电脑上的 Claude Code 不能启动后台会话','Claude Code here cannot start background sessions'],accept_edits_mode_not_listed_by_cli:['这个版本的 Claude Code 没有列出“接受文件修改”模式','this Claude Code version does not list the accept-edits mode']};
  const COLUMNS=[['doing','在做','Working'],['waiting','等你','Waiting for you'],['stalled','停滞与暂停','Stalled & paused'],['finishedToday','今天完成','Finished today']];
  let zh=true,lang='',latest=null,board=null,caps=null,capsAt=0,busy=false,boardKey='',pending=false,form=null,detail=null,topMessage='',topError=false;
  const ui=new Map(); // per task: {mode, note, why, title, brief, message, error, untrusted, discard}
  const state=id=>{if(!ui.has(id))ui.set(id,{mode:'',note:'',why:'',message:'',error:false});return ui.get(id);};
  const tr=(a,b)=>zh?a:b,colon=()=>tr('：',': ');
  const explain=result=>{const code=K.codeOf(result);return Object.hasOwn(CODES,code)?tr(...CODES[code]):tr(...CODES.internal);};
  const fk=(node,key)=>{node.dataset.fk=key;return node;};
  const words=(map,id)=>Object.hasOwn(map,id)?tr(...map[id]):String(id||'');
  const sandboxText=()=>caps?.notSandbox?.[zh?'zh':'en']||'';
  const baseName=path=>String(path||'').split(/[\\/]/).filter(Boolean).pop()||String(path||'');

  const banner=el('section','tb-banner'),tools=el('div','button-row'),create=fk(K.button('primary',''),'new'),topStatus=K.status('st-status tb-status'),formCard=el('article','settings-card st-card kn-card tb-form'),drafts=el('section','tb-drafts'),grid=el('div','tb-board'),summary=el('section','settings-card st-card kn-card tb-rework'),dialog=el('dialog','tb-detail');
  formCard.hidden=true;dialog.setAttribute('aria-labelledby','tasks-detail-title');tools.append(create,topStatus.node);
  root.append(banner,tools,formCard,drafts,grid,summary,dialog);

  function syncBusy(){for(const node of root.querySelectorAll('button,input,select,textarea'))node.disabled=busy||node.dataset.locked==='true';}
  function focusKey(key){const target=[...root.querySelectorAll('[data-fk]')].find(node=>node.dataset.fk===key&&!node.disabled&&node.offsetParent!==null);if(target)target.focus({preventScroll:true});return !!target;}
  const typing=()=>{const node=document.activeElement;return !!node&&root.contains(node)&&!dialog.contains(node)&&(node.tagName==='TEXTAREA'||node.tagName==='INPUT'&&node.type==='text');};
  async function run(fn){
    if(busy)return;
    const held=root.contains(document.activeElement)?document.activeElement.dataset.fk||'':'';
    busy=true;syncBusy();let next;
    try{next=await fn();}finally{busy=false;}
    board=latest?.taskBoard||board;draw();
    if(document.body.dataset.view!=='tasks')return;
    const lost=[document.body,null].includes(document.activeElement)||document.activeElement?.disabled||!document.activeElement?.isConnected;
    if(lost&&!(typeof next==='string'&&focusKey(next))&&!(held&&focusKey(held)))create.focus({preventScroll:true});
  }
  async function loadCaps(force=false){
    if(!force&&caps&&Date.now()-capsAt<60000)return;
    capsAt=Date.now();const result=await K.call(()=>api.taskCapabilities());
    caps=result.ok===false?{problem:explain(result)}:result;drawBanner();if(form)drawForm();
  }
  // "Limits and notes": the verbatim not-a-sandbox text from the main process plus the note that the
  // real launch path has not been exercised. `open` is the starting state; the board remembers a toggle.
  let limitsOpen=false;
  function limits(open,id){
    const box=el('details','more-note tb-limits'),summary=el('summary','',tr('限制与须知','Limits and notes'));
    if(id){box.open=limitsOpen;box.addEventListener('toggle',()=>{limitsOpen=box.open;});fk(summary,'limits');}else box.open=open;
    box.append(summary);
    if(sandboxText()){const note=el('p','tb-sandbox',sandboxText());if(id)note.id=id;box.append(note);}
    box.append(el('p','tb-caps',tr('真实的派出流程还没有用真实会话跑过一遍；第一次用时请留意它实际做了什么。','The real launch path has not yet been run end to end with a real session; watch what it actually does the first time.')));
    return box;
  }
  function drawBanner(){
    const nodes=[];
    if(latest&&!latest.taskBoard)nodes.push(el('p','st-problem',tr('任务看板现在不能使用。','The task board is not available right now.')));
    if(board?.problem)nodes.push(el('p','st-problem',`${tr('任务记录读取有问题','The task records could not be read cleanly')}${colon()}${board.problem}`));
    if(caps?.problem)nodes.push(el('p','st-problem',caps.problem));
    else if(caps){
      const missing=[];
      if(!caps.git?.available)missing.push(tr('没有找到 git，不能建立 worktree，所以现在不能派出任务。','git was not found, so no worktree can be created and tasks cannot be dispatched.'));
      if(!caps.claude?.available)missing.push(tr('没有找到 Claude Code，所以现在不能派出任务。','Claude Code was not found, so tasks cannot be dispatched.'));
      if(caps.claude?.available&&!caps.preauthorization?.available)missing.push(`${tr('不能预授权文件修改','File edits cannot be pre-authorized')}${colon()}${words(PREAUTH,caps.preauthorization?.reason)}${tr('。派出的任务里，文件修改也会由 Claude Code 逐次向你确认。','. In a dispatched task, Claude Code will ask you about each file edit as well.')}`);
      for(const text of missing)nodes.push(el('p','st-problem',text));
      const facts=el('p','tb-caps',[caps.git?.available?`git ${caps.git.version||''}`.trim():'',caps.claude?.available?`Claude Code ${caps.claude.version||''}`.trim():'',caps.preauthorization?.available?tr('可以预授权 worktree 内的文件修改','file edits inside the worktree can be pre-authorized'):''].filter(Boolean).join(' · '));
      if(facts.textContent)nodes.push(facts);
      // Collapsed on the board so the board itself is on the first screen; the create form and the
      // dispatch confirmation show the same text expanded.
      nodes.push(limits(false,'tasks-not-sandbox'));
    }else nodes.push(el('p','st-note',tr('正在检查这台电脑上的 git 和 Claude Code…','Checking git and Claude Code on this computer…')));
    banner.replaceChildren(...nodes);
  }

  // ---------- create form ----------
  function drawForm(){
    if(!form){formCard.hidden=true;formCard.replaceChildren();create.setAttribute('aria-expanded','false');return;}
    const held=formCard.contains(document.activeElement)?document.activeElement.dataset.fk||'':'';
    const f=form,pick=fk(K.button('secondary',tr('选择项目文件夹…','Choose project folder…')),'form-pick'),where=el('p','tb-path',f.project||tr('还没有选择文件夹。','No folder chosen yet.')),title=K.input(80,f.title),brief=K.area(2000,6,f.brief),save=fk(K.button('primary',tr('保存为草稿','Save as draft')),'form-save'),cancel=fk(K.button('secondary',tr('取消','Cancel')),'form-cancel'),status=K.status(),row=el('div','st-save-row'),pickRow=el('div','tb-pick');
    fk(title,'form-title');fk(brief,'form-brief');where.id='tasks-form-project';pick.setAttribute('aria-describedby',where.id);
    title.oninput=()=>{f.title=title.value;};brief.oninput=()=>{f.brief=brief.value;};
    const tell=(text,error=false)=>{f.message=text;f.error=error;status.say(text,error);};status.say(f.message,f.error);
    pick.onclick=()=>void run(async()=>{
      const result=await K.call(()=>api.taskPickProject());
      if(result.ok===false){if(K.codeOf(result)!=='cancelled')tell(`${tr('没有选好','Not chosen')}${colon()}${explain(result)}`,true);return 'form-pick';}
      f.project=result.project;f.repository=typeof result.repository==='string'?result.repository:'';tell('');drawForm();return 'form-title';
    });
    cancel.onclick=()=>{form=null;drawForm();create.focus({preventScroll:true});};
    save.onclick=()=>{
      if(!f.project){tell(tr(...CODES.project_not_picked),true);pick.focus();return;}
      if(!title.value.trim()){tell(tr('请填写标题。','Enter a title.'),true);title.focus();return;}
      if(!brief.value.trim()){tell(tr('请写下要做什么。','Describe what to do.'),true);brief.focus();return;}
      void run(async()=>{
        tell(tr('正在保存…','Saving…'));
        const result=await K.call(()=>api.taskCreate({title:title.value.trim(),brief:brief.value.trim(),project:f.project}));
        if(result.ok===false){tell(`${tr('没有保存','Not saved')}${colon()}${explain(result)}`,true);return 'form-save';}
        form=null;drawForm();topMessage=tr('已保存为草稿。草稿不会自己开始：在下面的草稿上点“派出…”才会启动会话。','Saved as a draft. A draft does not start on its own: choose “Dispatch…” on it below to start a session.');topError=false;
        const id=result.task?.id;return id?`t:${id}:dispatch`:'new';
      });
    };
    pickRow.append(pick,where);row.append(save,cancel,status.node);
    const nodes=[el('h2','',tr('新建任务','New task')),el('p','st-note',tr('先选项目文件夹（要在一个 git 仓库里），再写标题和说明。保存后只是草稿；派出是单独的一步。','Choose the project folder first (it must be inside a git repository), then write a title and a brief. Saving only makes a draft; dispatching is a separate step.')),pickRow];
    if(f.repository)nodes.push(el('p','tb-caps',`${tr('所在仓库','Repository')}${colon()}${f.repository}`));
    nodes.push(K.field(tr('标题（最多 80 字）','Title (up to 80 characters)'),title,'tasks-form-title'),K.field(tr('任务说明（最多 2000 字）','Brief (up to 2000 characters)'),brief,'tasks-form-brief',tr('写清要做什么、做到什么算交回。这段文字会原样交给会话。','Say what to do and what counts as handing back. This text is given to the session as written.')));
    nodes.push(limits(true),row);
    formCard.hidden=false;formCard.replaceChildren(...nodes);create.setAttribute('aria-expanded','true');syncBusy();
    if(held&&[document.body,null].includes(document.activeElement))focusKey(held);
  }

  // ---------- cards ----------
  function hints(task){
    const out=[],last=task.boundary?.last;
    if(task.reason&&task.state!=='verified')out.push(words(REASONS,task.reason));
    if(['reported','needs_input','paused','stopped'].includes(task.state)&&task.reportStatus==='no_reply_text')out.push(tr('没有交回文字可看：“保存最终回复文字”是关着的（设置 → 观察器隐私）。','There is no hand-back text to show: “Save final response text” is off (Settings → Observer privacy).'));
    for(const flag of task.claimFlags||[])out.push(words(FLAGS,flag));
    if(last?.sourceRepoChanged===true)out.push(tr('任务运行期间，你的主检出发生了变化；应用无法判断是谁改的。','Your main checkout changed while this task ran; the app cannot tell who changed it.'));
    if(last?.outsidePaths?.length)out.push(tr(`主检出里有 ${last.outsidePaths.length} 个路径和派出时不一样，详情见“查看改动”。`,`${last.outsidePaths.length} path(s) in your main checkout differ from dispatch time; see “View changes”.`));
    if(task.rework>0)out.push(tr(`已返工 ${task.rework} 次${task.reworkWhy?`，最近一次原因：${task.reworkWhy}`:''}`,`Reworked ${task.rework} time(s)${task.reworkWhy?`; latest reason: ${task.reworkWhy}`:''}`));
    if(task.state==='verified'&&task.acceptNote)out.push(`${tr('验收备注','Acceptance note')}${colon()}${task.acceptNote}`);
    return out;
  }
  function taskCard(task){
    const s=state(task.id),key='t:'+task.id,box=el('article','tb-card'),head=el('div','tb-card-head'),pill=el('span','tb-state',words(STATES,task.state)),actions=el('div','tb-actions'),status=K.status('st-status tb-card-status');
    box.dataset.state=task.state;box.dataset.id=task.id;pill.dataset.state=task.state;
    head.append(el('h3','',task.title||tr('（没有标题）','(untitled)')),pill);
    const project=el('p','tb-meta',`${baseName(task.project)} · ${task.progressAt?`${tr('上次进展','Last progress')} ${K.ago(task.progressAt,zh)}`:`${tr('更新于','Updated')} ${K.ago(task.updatedAt,zh)}`}`);project.title=String(task.project||'');
    box.append(head,project);
    if(task.state==='draft'&&task.brief)box.append(el('p','tb-brief',task.brief));
    if(task.report){const line=task.report.done||task.report.todo||task.report.background||'';if(line)box.append(el('p','tb-brief',`${tr('交回里写的“已做”','“Done” as handed back')}${colon()}${line}`));}
    const notes=hints(task);if(notes.length){const list=el('ul','tb-hints');list.append(...notes.map(text=>el('li','',text)));box.append(list);}
    const act=(name,cls,text,runIt)=>{const b=fk(K.button(cls,text,runIt),`${key}:${name}`);b.setAttribute('aria-label',`${text}${colon()}${task.title||''}`);actions.append(b);return b;};
    const say=(text,error=false)=>{s.message=text;s.error=error;status.say(text,error);};status.say(s.message,s.error);
    const simple=(call,done,to)=>()=>void run(async()=>{const result=await K.call(call);if(result.ok===false)say(`${tr('没有完成','Not done')}${colon()}${explain(result)}`,true);else say(typeof done==='function'?done(result):done);return to;});
    const open=mode=>{s.mode=s.mode===mode?'':mode;draw();if(s.mode)focusKey(`${key}:${mode}-field`)||focusKey(`${key}:${mode}-go`);else focusKey(`${key}:${mode}`);};
    const live=['dispatched','running','rework','needs_input','stalled','unknown','paused','reported'].includes(task.state),finished=['stopped','verified'].includes(task.state);
    if(task.state==='draft'){
      act('dispatch','primary',tr('派出…','Dispatch…'),()=>open('dispatch')).setAttribute('aria-expanded',String(s.mode==='dispatch'));
      act('edit','secondary',tr('编辑','Edit'),()=>{if(s.mode!=='edit'){s.title=task.title;s.brief=task.brief;}open('edit');}).setAttribute('aria-expanded',String(s.mode==='edit'));
    }
    if(task.state==='reported'){
      act('accept','primary',tr('验收…','Accept…'),()=>open('accept')).setAttribute('aria-expanded',String(s.mode==='accept'));
      act('rework','secondary',tr('返工…','Rework…'),()=>open('rework')).setAttribute('aria-expanded',String(s.mode==='rework'));
    }
    if(task.state!=='draft')act('diff','secondary',tr('查看改动','View changes'),()=>void openDetail(task.id,`${key}:diff`));
    if(live&&task.state!=='reported')act('pause','plain',task.state==='paused'?tr('继续跟踪','Resume tracking'):tr('暂停跟踪','Pause tracking'),simple(()=>api.taskPause(task.id),task.state==='paused'?tr('已继续跟踪。','Tracking resumed.'):tr('已暂停跟踪。会话本身没有停止。','Tracking is paused. The session itself was not stopped.'),`${key}:pause`));
    if(live)K.twoClick(act('stop','plain',tr('停止会话','Stop the session')),tr('再点一次确认停止','Click again to stop'),simple(()=>api.taskStop(task.id),tr('会话已停止。任务没有验收。','The session was stopped. The task is not verified.'),`${key}:diff`));
    if(task.state==='draft'||finished){
      K.twoClick(act('remove','plain',tr('移除','Remove')),tr('再点一次确认移除','Click again to remove'),()=>void run(async()=>{
        const result=await K.call(()=>api.taskRemove({id:task.id}));
        if(result.ok===false){if(K.codeOf(result)==='worktree_has_changes'){s.discard={dirty:result.dirty,unmerged:result.unmerged};say(`${tr('没有移除','Not removed')}${colon()}${explain(result)}`,true);return `${key}:discard`;}say(`${tr('没有移除','Not removed')}${colon()}${explain(result)}`,true);return `${key}:remove`;}
        ui.delete(task.id);topMessage=tr(`已移除任务“${task.title}”。`,`Removed the task “${task.title}”.`);topError=false;return 'new';
      }));
    }
    box.append(actions);
    // Inline steps
    if(s.mode==='dispatch'&&task.state==='draft'){
      const step=el('div','tb-step'),pre=caps?.preauthorization?.available,go=fk(K.button('primary',tr('确认派出','Dispatch now')),`${key}:dispatch-go`),cancel=fk(K.button('secondary',tr('取消','Cancel')),`${key}:dispatch-cancel`),row=el('div','st-save-row');
      step.append(el('p','',tr('派出后，应用会为这个任务新建一个 git worktree，并在里面启动一个后台 Claude Code 会话，用的是你本机 Claude Code 的登录和额度。','Dispatching creates a new git worktree for this task and starts a background Claude Code session in it, using your local Claude Code login and quota.')),
        el('p','',pre?tr('这个 worktree 里的文件修改不会逐次向你确认（预授权）。命令执行仍由 Claude Code 自己向你确认。','File edits inside this worktree will not be confirmed one by one (pre-authorized). Command execution is still confirmed by Claude Code itself.'):tr('现在不能预授权，所以文件修改和命令执行都会由 Claude Code 逐次向你确认。','Pre-authorization is not available now, so Claude Code will ask you about file edits and commands one by one.')));
      step.append(limits(true));
      go.dataset.locked=String(!!caps&&(!caps.git?.available||!caps.claude?.available));
      go.onclick=()=>void run(async()=>{
        say(tr('正在派出…','Dispatching…'));s.untrusted='';
        const result=await K.call(()=>api.taskDispatch(task.id));
        if(result.ok===false){
          if(K.codeOf(result)==='workspace_untrusted'){s.untrusted=result.task?.worktree||result.worktree||latest?.taskBoard?.columns?.drafts?.find(item=>item.id===task.id)?.worktree||task.worktree||'';s.mode='';say(explain(result),true);return `${key}:dispatch`;}
          say(`${tr('没有派出','Not dispatched')}${colon()}${explain(result)}`,true);return `${key}:dispatch-go`;
        }
        s.mode='';say(result.preauthorized?tr('已派出。worktree 内的文件修改已预授权；命令仍会逐次确认。','Dispatched. File edits inside the worktree are pre-authorized; commands are still confirmed one by one.'):tr('已派出。这次没有预授权，文件修改也会逐次确认。','Dispatched. Nothing was pre-authorized this time, so file edits are confirmed one by one too.'));return `${key}:diff`;
      });
      cancel.onclick=()=>open('dispatch');row.append(go,cancel);step.append(row);box.append(step);
    }
    if(s.untrusted&&task.state==='draft'){
      const note=el('div','tb-step tb-untrusted'),path=el('code','tb-path',s.untrusted);path.tabIndex=0;path.setAttribute('aria-label',tr('worktree 文件夹路径','Worktree folder path'));
      note.append(el('p','',tr('要继续，请你自己在终端里进入下面这个文件夹运行一次 claude，在它询问时选择信任这个文件夹；然后回到这里再点“派出…”。任务已回到草稿，worktree 保留着。','To continue, open a terminal in the folder below, run claude once and choose to trust the folder when it asks. Then come back and choose “Dispatch…” again. The task is a draft again and keeps its worktree.')),path);box.append(note);
    }
    if(s.mode==='edit'&&task.state==='draft'){
      const step=el('div','tb-step'),title=K.input(80,s.title??task.title),brief=K.area(2000,5,s.brief??task.brief),save=fk(K.button('primary',tr('保存修改','Save changes')),`${key}:edit-go`),cancel=fk(K.button('secondary',tr('取消','Cancel')),`${key}:edit-cancel`),row=el('div','st-save-row');
      fk(title,`${key}:edit-field`);fk(brief,`${key}:edit-brief`);title.oninput=()=>{s.title=title.value;};brief.oninput=()=>{s.brief=brief.value;};
      save.onclick=()=>void run(async()=>{const result=await K.call(()=>api.taskUpdate({id:task.id,title:title.value.trim(),brief:brief.value.trim()}));if(result.ok===false){say(`${tr('没有保存','Not saved')}${colon()}${explain(result)}`,true);return `${key}:edit-go`;}s.mode='';say(tr('已保存修改。','Changes saved.'));return `${key}:edit`;});
      cancel.onclick=()=>open('edit');row.append(save,cancel);
      step.append(K.field(tr('标题（最多 80 字）','Title (up to 80 characters)'),title,`tasks-edit-title-${task.id}`),K.field(tr('任务说明（最多 2000 字）','Brief (up to 2000 characters)'),brief,`tasks-edit-brief-${task.id}`),row);box.append(step);
    }
    if(s.mode==='accept'&&task.state==='reported'){
      const step=el('div','tb-step'),note=K.input(200,s.note),go=fk(K.button('primary',tr('我已核对，验收','I have checked it: accept')),`${key}:accept-go`),cancel=fk(K.button('secondary',tr('取消','Cancel')),`${key}:accept-cancel`),row=el('div','st-save-row');
      fk(note,`${key}:accept-field`);note.oninput=()=>{s.note=note.value;};
      go.onclick=()=>void run(async()=>{const text=note.value.trim(),result=await K.call(()=>api.taskAccept({id:task.id,...(text?{note:text}:{})}));if(result.ok===false){say(`${tr('没有验收','Not accepted')}${colon()}${explain(result)}`,true);return `${key}:accept-go`;}s.mode='';s.note='';say(tr('已记为“你已验收”。','Recorded as verified by you.'));return `${key}:diff`;});
      cancel.onclick=()=>open('accept');row.append(go,cancel);
      step.append(el('p','',tr('验收表示你自己看过结果并认可。应用不会替你检查改动对不对。','Accepting means you looked at the result yourself and agree. The app does not check the changes for you.')),K.field(tr('验收备注（可选）','Acceptance note (optional)'),note,`tasks-accept-note-${task.id}`),row);box.append(step);
    }
    if(s.mode==='rework'&&task.state==='reported'){
      const step=el('div','tb-step'),why=K.area(500,3,s.why),go=fk(K.button('primary',tr('记为返工','Mark for rework')),`${key}:rework-go`),cancel=fk(K.button('secondary',tr('取消','Cancel')),`${key}:rework-cancel`),row=el('div','st-save-row');
      fk(why,`${key}:rework-field`);why.oninput=()=>{s.why=why.value;};
      go.onclick=()=>{
        const text=why.value.trim();if(!text){say(tr(...CODES.reason_required),true);why.focus();return;}
        void run(async()=>{const result=await K.call(()=>api.taskRework({id:task.id,why:text}));if(result.ok===false){say(`${tr('没有记下','Not recorded')}${colon()}${explain(result)}`,true);return `${key}:rework-go`;}s.mode='';s.why='';say(result.delivered===true?tr('返工原因已记下，并已送到会话。','The rework reason is recorded and was delivered to the session.'):tr('返工原因已记下，但没有送到会话。请你自己到那个 Claude Code 会话里把原因告诉它。','The rework reason is recorded but was NOT delivered to the session. Tell that Claude Code session the reason yourself.'),result.delivered!==true);return `${key}:diff`;});
      };
      cancel.onclick=()=>open('rework');row.append(go,cancel);
      step.append(el('p','',tr('原因会记在看板上并计入返工统计。应用不会把它发给会话：需要你自己在那个 Claude Code 会话里说明。','The reason is recorded on the board and counted in the rework summary. The app does not send it to the session: say it in that Claude Code session yourself.')),K.field(tr('返工原因（必填）','Reason for rework (required)'),why,`tasks-rework-why-${task.id}`),row);box.append(step);
    }
    if(s.discard&&(task.state==='draft'||finished)){
      const step=el('div','tb-step tb-untrusted'),go=fk(K.button('secondary tb-danger',tr('丢弃 worktree 和里面的改动','Discard the worktree and its changes')),`${key}:discard`),parts=[];
      if(s.discard.dirty)parts.push(tr('有没提交的修改','uncommitted changes'));if(s.discard.unmerged)parts.push(tr('有没合并进主分支的提交','commits not merged into your branch'));
      go.setAttribute('aria-label',`${tr('丢弃 worktree 和里面的改动','Discard the worktree and its changes')}${colon()}${task.title||''}`);
      K.twoClick(go,tr('再点一次：改动将无法找回','Click again: the changes cannot be recovered'),()=>void run(async()=>{const result=await K.call(()=>api.taskRemove({id:task.id,discard:true}));if(result.ok===false){say(`${tr('没有移除','Not removed')}${colon()}${explain(result)}`,true);return `${key}:discard`;}ui.delete(task.id);topMessage=tr(`已移除任务“${task.title}”，并丢弃了它的 worktree。`,`Removed the task “${task.title}” and discarded its worktree.`);topError=false;return 'new';}));
      step.append(el('p','',`${tr('这个任务的 worktree 里','This task’s worktree holds')}${parts.length?parts.join(tr('，也',' and ')):tr('还有改动','changes')}${tr('。如果还想留着，请先自己合并或备份；丢弃后找不回来。','. If you want to keep them, merge or back them up yourself first; discarding cannot be undone.')}`),go);box.append(step);
    }
    box.append(status.node);return box;
  }
  function draw(){
    pending=false;
    const held=root.contains(document.activeElement)&&!dialog.contains(document.activeElement)?document.activeElement.dataset.fk||'':'',columns=board?.columns||{},counts=board?.counts||{};
    create.textContent=tr('新建任务…','New task…');topStatus.say(topMessage,topError);
    const draftRows=columns.drafts||[];
    drafts.hidden=!draftRows.length;
    drafts.replaceChildren(el('h2','tb-column-title',tr(`草稿（${counts.drafts??draftRows.length}）`,`Drafts (${counts.drafts??draftRows.length})`)),el('p','tb-meta',tr('草稿不会自己开始。','A draft does not start on its own.')),(()=>{const strip=el('div','tb-strip');strip.append(...draftRows.map(taskCard));return strip;})());
    grid.replaceChildren(...COLUMNS.map(([id,a,b])=>{
      const column=el('section','tb-column'),rows=columns[id]||[],total=counts[id]??rows.length,title=el('h2','tb-column-title',`${tr(a,b)}（${total}）`);
      column.dataset.column=id;title.id=`tasks-column-${id}`;column.setAttribute('aria-labelledby',title.id);column.append(title);
      if(id==='finishedToday')column.append(el('p','tb-meta',tr('包括“你已验收”和“会话已停止”。只有前者算做完。','Holds “verified by you” and “session stopped”. Only the first counts as done.')));
      if(!rows.length)column.append(el('p','tb-empty',id==='doing'?tr('现在没有在做的任务。','Nothing is being worked on.'):id==='waiting'?tr('没有等你处理的任务。','Nothing is waiting for you.'):id==='stalled'?tr('没有停滞或暂停的任务。','Nothing is stalled or paused.'):tr('今天还没有结束的任务。','Nothing finished today yet.')));
      column.append(...rows.map(taskCard));
      if(total>rows.length)column.append(el('p','tb-meta',tr(`还有 ${total-rows.length} 个没有显示。`,`${total-rows.length} more are not shown.`)));
      return column;
    }));
    const rework=board?.rework;
    summary.hidden=!board;
    if(board){
      const nodes=[el('h2','',tr(`最近 ${rework?.days||14} 天的返工`,`Rework in the last ${rework?.days||14} days`))];
      if(!rework?.count)nodes.push(el('p','st-note',tr('这段时间没有返工记录。','No rework was recorded in this period.')));
      else{nodes.push(el('p','st-note',tr(`共 ${rework.count} 次。原因按次数排列：`,`${rework.count} in total. Reasons, most frequent first:`)));const list=el('ul','tb-reasons');for(const item of rework.reasons||[]){const li=el('li','');li.append(el('span','',String(item.why||'')),el('span','st-count',`× ${item.count}`));list.append(li);}nodes.push(list);}
      if(board.limits)nodes.push(el('p','tb-caps',tr(`没做完的任务最多 ${board.limits.unfinished} 个（现在 ${counts.unfinished??0} 个）；已结束的任务最多保留 ${board.limits.finished} 个。更早结束的任务不在这一页显示。`,`Up to ${board.limits.unfinished} unfinished tasks (now ${counts.unfinished??0}); up to ${board.limits.finished} finished tasks are kept. Tasks finished before today are not shown on this page.`)));
      summary.replaceChildren(...nodes);
    }
    drawBanner();syncBusy();
    if(held&&[document.body,null].includes(document.activeElement))focusKey(held);
  }

  // ---------- detail ----------
  async function openDetail(id,returnKey){
    detail={id,returnKey,loading:true,result:null};drawDetail();if(!dialog.open)dialog.showModal();
    const result=await K.call(()=>api.taskDiff(id));
    if(detail?.id!==id)return;detail.loading=false;detail.result=result;drawDetail();
  }
  function selectable(text){const node=el('code','tb-path',String(text||''));node.tabIndex=0;return node;}
  function drawDetail(){
    if(!detail)return;
    const result=detail.result,task=result?.task,close=K.button('secondary',tr('关闭','Close'),()=>dialog.close()),title=el('h2','',task?.title||tr('任务改动','Task changes')),nodes=[title];
    title.id='tasks-detail-title';title.tabIndex=-1;
    if(detail.loading)nodes.push(el('p','st-note',tr('正在读取…','Loading…')));
    else if(result.ok===false)nodes.push(el('p','st-problem',explain(result)));
    else{
      nodes.push(el('p','tb-meta',`${words(STATES,task.state)}`));
      // Hand-back
      nodes.push(el('h3','',tr('交回的内容','What was handed back')));
      const report=task.report;
      if(report){const list=el('dl','tb-report');for(const [id,a,b] of [['background','背景','Background'],['done','已做','Done'],['todo','没做 / 待你决定','Not done / for you to decide'],['added','额外做的','Added beyond the brief']]){list.append(el('dt','',tr(a,b)),el('dd','',report[id]||tr('（没写）','(not written)')));}nodes.push(list,el('p','tb-caps',tr('这是会话自己写的，应用没有核对其中任何一条。','The session wrote this itself; the app has not checked any of it.')));}
      else if(task.reportStatus==='no_reply_text')nodes.push(el('p','st-note',tr('没有交回文字可看：“保存最终回复文字”是关着的。到 设置 → 观察器隐私 打开后，之后的交回才会保存在本机。','There is no hand-back text to show: “Save final response text” is off. Turn it on under Settings → Observer privacy and later hand-backs are kept on this computer.')));
      else if(task.reportStatus==='unformatted'){nodes.push(el('p','st-note',tr('交回的文字没有按约定的四段来写，下面是原文。','The hand-back does not follow the agreed four parts; the original text is below.')));if(task.reportRaw)nodes.push(el('pre','tb-raw',String(task.reportRaw)));}
      else nodes.push(el('p','st-note',tr('还没有交回。','Nothing has been handed back yet.')));
      for(const flag of task.claimFlags||[])nodes.push(el('p','tb-caps',words(FLAGS,flag)));
      // Changes
      const diff=result.diff;
      nodes.push(el('h3','',tr('改动的文件','Changed files')));
      if(!diff?.exists)nodes.push(el('p','st-note',tr('worktree 不存在，或读不到改动。','The worktree does not exist, or its changes could not be read.')));
      else{
        const committed=diff.committed||{},uncommitted=diff.uncommitted||{};
        nodes.push(el('p','tb-meta',tr(`已提交：${diff.commits||0} 个提交，${committed.fileCount||0} 个文件，+${committed.insertions||0} / −${committed.deletions||0}`,`Committed: ${diff.commits||0} commit(s), ${committed.fileCount||0} file(s), +${committed.insertions||0} / −${committed.deletions||0}`)));
        if(committed.files?.length){const list=el('ul','tb-files');for(const file of committed.files){const li=el('li','');li.append(el('span','tb-file',String(file.path||'')),el('span','tb-plus',`+${file.insertions??0}`),el('span','tb-minus',`−${file.deletions??0}`));list.append(li);}nodes.push(list);}
        if(committed.truncated)nodes.push(el('p','tb-caps',tr('文件很多，只列出了一部分。','There are many files; only some are listed.')));
        nodes.push(el('p','tb-meta',tr(`没提交：${uncommitted.fileCount||0} 个文件`,`Uncommitted: ${uncommitted.fileCount||0} file(s)`)));
        if(uncommitted.files?.length){const list=el('ul','tb-files');for(const file of uncommitted.files){const li=el('li','');li.append(el('span','tb-file',String(file.path||'')),el('span','tb-caps',String(file.status||'')));list.append(li);}nodes.push(list);}
        if(uncommitted.truncated)nodes.push(el('p','tb-caps',tr('文件很多，只列出了一部分。','There are many files; only some are listed.')));
      }
      // Boundary
      const edge=result.boundary?.last||result.boundary||task.boundary?.last;
      nodes.push(el('h3','',tr('主检出有没有被动过','Whether your main checkout changed')));
      if(!edge||edge.sourceRepoChanged===null||edge.sourceRepoChanged===undefined)nodes.push(el('p','st-note',tr('还没有检查结果。','No check result yet.')));
      else{
        nodes.push(el('p',edge.sourceRepoChanged?'st-problem':'st-note',edge.sourceRepoChanged?tr('任务运行期间，你的主检出发生了变化。应用无法判断是谁改的：可能是这个会话，也可能是你自己或别的程序。','Your main checkout changed while this task ran. The app cannot tell who changed it: this session, you, or another program.'):tr('和派出时相比，没有发现主检出的变化。这个检查可能漏报，不能当作隔离的证明。','No change in your main checkout was found compared with dispatch time. This check can miss changes and is not proof of isolation.')));
        if(edge.outsidePaths?.length){const list=el('ul','tb-files');list.append(...edge.outsidePaths.map(path=>{const li=el('li','');li.append(el('span','tb-file',String(path)));return li;}));nodes.push(list);}
        if(edge.checkedAt)nodes.push(el('p','tb-caps',`${tr('检查时间','Checked')}${colon()}${K.stamp(edge.checkedAt,zh)}`));
      }
      // Where
      nodes.push(el('h3','',tr('位置','Where')));
      const where=el('dl','tb-report');
      where.append(el('dt','',tr('项目','Project')),(()=>{const dd=el('dd','');dd.append(selectable(task.project));return dd;})());
      if(task.worktree){where.append(el('dt','','worktree'),(()=>{const dd=el('dd','');dd.append(selectable(task.worktree));return dd;})());}
      if(task.branch){where.append(el('dt','',tr('分支','Branch')),(()=>{const dd=el('dd','');dd.append(selectable(task.branch));return dd;})());}
      nodes.push(where);
      if(task.brief){const more=el('details','tb-brief-full');more.append(el('summary','',tr('任务说明原文','The brief as written')),el('p','',task.brief));nodes.push(more);}
    }
    const foot=el('div','st-save-row');foot.append(close);nodes.push(foot);
    dialog.replaceChildren(...nodes);
    if(dialog.open&&!dialog.contains(document.activeElement))title.focus({preventScroll:true});
  }
  dialog.addEventListener('close',()=>{const key=detail?.returnKey;detail=null;dialog.replaceChildren();if(key&&!focusKey(key))create.focus({preventScroll:true});});
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  create.onclick=()=>{form=form||{project:'',repository:'',title:'',brief:'',message:'',error:false};drawForm();focusKey(form.project?'form-title':'form-pick');void loadCaps();};
  root.addEventListener('focusout',()=>{if(pending)requestAnimationFrame(()=>{if(pending&&!busy&&!typing()){board=latest?.taskBoard||null;draw();}});});

  window.renderTasks=data=>{
    latest=data;zh=data.config?.language==='zh';
    const next=data.taskBoard||null,key=JSON.stringify(next);
    if(lang!==data.config?.language){lang=data.config?.language;board=next;boardKey=key;draw();drawForm();if(detail)drawDetail();}
    else if(key!==boardKey){boardKey=key;if(busy||typing())pending=true;else{board=next;draw();}}
    if(document.body.dataset.view==='tasks')void loadCaps();
  };
  // Relative times ("5 min ago") are refreshed once a minute while the page is shown.
  setInterval(()=>{if(document.body.dataset.view==='tasks'&&!document.hidden&&!busy&&!typing()&&!dialog.open)draw();},60000);
})();
