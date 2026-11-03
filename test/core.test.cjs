'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../src/core/events.cjs');
const { Store } = require('../src/core/store.cjs');
const { NotificationGate, coalesceChanges } = require('../src/core/notify.cjs');
const { validateTheme } = require('../src/core/theme.cjs');
const event = (name, extra={}, at=10000) => normalize({session_id:'s1',hook_event_name:name,cwd:'C:\\projects\\arcade',...extra},{now:at,captureResults:true});
const task = s => s.snapshot(10000)[0];
const observerKey = Buffer.alloc(32, 7);
const correlated = (name, extra = {}, at = 10000) => normalize({ session_id: 's1', cwd: '/demo/project', hook_event_name: name, tool_name: 'Bash', ...extra }, { now: at, observerKey });
test('normalizer stores no prompts, tool arguments, paths or raw errors by default',()=>{
 const e=normalize({session_id:'s',hook_event_name:'Stop',cwd:'/private/project',prompt:'SECRET',tool_input:{password:'SECRET'},error:'SECRET',transcript_path:'/SECRET',last_assistant_message:'SECRET'});
 assert(!JSON.stringify(e).includes('SECRET'));assert.equal(e.project,'project');assert.equal(e.result,'');
 assert.equal(normalize({session_id:'s',hook_event_name:'Mystery'}),null);
 assert.equal(normalize({session_id:'s',hook_event_name:'SubagentStart'}),null);
});
test('result capture is explicit and bounded',()=>{assert.equal(event('Stop',{last_assistant_message:'a'.repeat(20000)}).result.length,16000);});

test('tool correlation uses a local keyed digest, canonical JSON and no stored arguments',()=>{
 const pre=correlated('PreToolUse',{tool_use_id:'a',tool_input:{command:'PRIVATE',nested:{b:2,a:1}}});
 const permission=correlated('PermissionRequest',{tool_input:{nested:{a:1,b:2},command:'PRIVATE'}});
 assert.match(pre.toolKey,/^[a-f0-9]{64}$/);assert.equal(pre.toolKey,permission.toolKey);
 assert(!JSON.stringify(pre).includes('PRIVATE'));
 const another=normalize({session_id:'s1',hook_event_name:'PermissionRequest',tool_name:'Bash',tool_input:{command:'PRIVATE',nested:{b:2,a:1}}},{observerKey:Buffer.alloc(32,8)});
 assert.notEqual(pre.toolKey,another.toolKey);assert.equal(correlated('PermissionRequest').toolKey,'');
});

test('official ID-less PermissionRequest matches the exact input among same-tool calls',()=>{
 const s=new Store();
 s.apply(correlated('PreToolUse',{tool_use_id:'a',tool_input:{command:'one'}}));
 s.apply(correlated('PreToolUse',{tool_use_id:'b',tool_input:{command:'two'}}));
 s.apply(correlated('PermissionRequest',{tool_input:{command:'one'}}));assert.deepEqual(task(s).waitFor,['a']);
 s.apply(correlated('PostToolUse',{tool_use_id:'b',tool_input:{command:'two'}}));assert.equal(task(s).state,'waiting');
 s.apply(correlated('PostToolUse',{tool_use_id:'a',tool_input:{command:'one'}}));assert.equal(task(s).state,'running');
});

test('two ID-less permissions remain independent across persistence, success and tool failure',()=>{
 let s=new Store();
 for(const [id,command] of [['a','one'],['b','two']]){
  s.apply(correlated('PreToolUse',{tool_use_id:id,tool_input:{command}}));s.apply(correlated('PermissionRequest',{tool_input:{command}}));
 }
 s=new Store(JSON.parse(JSON.stringify(s.export())));
 s.apply(correlated('PostToolUse',{tool_use_id:'a',tool_input:{command:'one'}}));assert.equal(task(s).state,'waiting');assert.deepEqual(task(s).waitFor,['b']);
 s.apply(correlated('PostToolUseFailure',{tool_use_id:'b',tool_input:{command:'two'}}));assert.equal(task(s).state,'error');assert.equal(task(s).reason,'tool_error');
});

test('identical concurrent inputs are uncertain instead of guessing which permission resolved',()=>{
 for(const permissionBeforeSecondPre of [true,false]){
  const s=new Store();s.apply(correlated('PreToolUse',{tool_use_id:'a',tool_input:{command:'same'}}));
  if(permissionBeforeSecondPre)s.apply(correlated('PermissionRequest',{tool_input:{command:'same'}}));
  s.apply(correlated('PreToolUse',{tool_use_id:'b',tool_input:{command:'same'}}));
  if(!permissionBeforeSecondPre)s.apply(correlated('PermissionRequest',{tool_input:{command:'same'}}));
  s.apply(correlated('PostToolUse',{tool_use_id:'a',tool_input:{command:'same'}}));
  s.apply(correlated('PostToolUse',{tool_use_id:'b',tool_input:{command:'same'}}));
  assert.equal(task(s).state,'unknown');assert.equal(task(s).reason,'permission_unknown');assert.equal(task(s).waitFor.length,1);
 }
});

test('legacy or missing-input permission events remain uncertain after an uncorrelated completion',()=>{
 const s=new Store();const legacy=event('PreToolUse',{tool_use_id:'a'});delete legacy.toolKey;s.apply(legacy);
 const permission=event('PermissionRequest');delete permission.toolKey;s.apply(permission);
 s.apply(event('PostToolUse',{tool_use_id:'a'}));assert.equal(task(s).state,'unknown');assert.deepEqual(task(s).waitFor,['unknown']);
 s.apply(event('UserPromptSubmit'));assert.equal(task(s).state,'running');
});

test('station positions stay stable when existing sessions receive new events',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit',{session_id:'old'},10000));s.apply(event('UserPromptSubmit',{session_id:'new'},11000));
 assert.deepEqual(s.snapshot(12000).map(t=>t.session),['new','old']);
 s.apply(event('PreToolUse',{session_id:'old'},12000));assert.deepEqual(s.snapshot(13000).map(t=>t.session),['new','old']);
});
test('running → permission → resumed → delivered → next prompt',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));assert.equal(task(s).state,'running');
 s.apply(event('PermissionRequest',{tool_use_id:'a'}));assert.equal(task(s).state,'waiting');
 s.apply(event('PostToolUse',{tool_use_id:'a'}));assert.equal(task(s).state,'running');
 s.apply(event('Stop',{last_assistant_message:'Ready'}));assert.equal(task(s).result,'Ready');assert.equal(task(s).state,'done');
 s.apply(event('UserPromptSubmit'));assert.equal(task(s).result,'');assert.equal(task(s).state,'running');
});
test('concurrent tool completion cannot clear a different pending permission',()=>{
 const s=new Store();s.apply(event('PermissionRequest',{tool_use_id:'a'}));s.apply(event('PreToolUse',{tool_use_id:'b'}));s.apply(event('PostToolUse',{tool_use_id:'b'}));assert.equal(task(s).state,'waiting');
 s.apply(event('PostToolUse',{tool_use_id:'a'}));assert.equal(task(s).state,'running');
 s.apply(event('PermissionRequest',{tool_use_id:'a'}));assert.equal(task(s).state,'running');
});
test('tool errors can recover; API errors and user interrupts remain distinct',()=>{
 const s=new Store();s.apply(event('PostToolUseFailure'));assert.equal(task(s).reason,'tool_error');
 s.apply(event('PreToolUse'));assert.equal(task(s).state,'running');
 s.apply(event('StopFailure'));assert.equal(task(s).reason,'turn_error');
 s.apply(event('PostToolUseFailure',{is_interrupt:true}));assert.equal(task(s).state,'unknown');
});
test('AskUserQuestion waits; idle reminders and irrelevant notifications do not alter state',()=>{
 const s=new Store();s.apply(event('PreToolUse',{tool_name:'AskUserQuestion',tool_use_id:'q'}));assert.equal(task(s).reason,'question');
 s.apply(event('Notification',{notification_type:'auth_success'}));assert.equal(task(s).reason,'question');
 s.apply(event('PostToolUse',{tool_use_id:'q'}));assert.equal(task(s).state,'running');
 s.apply(event('Stop'));
 assert.equal(s.apply(event('Notification',{notification_type:'idle_prompt'},70000)),null);
 assert.equal(task(s).state,'done');assert.equal(task(s).updatedAt,10000);
 s.apply(event('Notification',{notification_type:'agent_needs_input'},80000));assert.equal(task(s).reason,'input');
});

test('elicitation notifications distinguish a question from approval and resume after response',()=>{
 const s=new Store();s.apply(event('Notification',{notification_type:'elicitation_url_dialog'}));assert.equal(task(s).state,'waiting');assert.equal(task(s).reason,'question');
 s.apply(event('Notification',{notification_type:'elicitation_response'}));assert.equal(task(s).state,'running');
 s.apply(event('PermissionRequest',{tool_use_id:'approval'}));
 s.apply(event('Notification',{notification_type:'elicitation_dialog'}));
 s.apply(event('Notification',{notification_type:'elicitation_complete'}));assert.equal(task(s).state,'waiting');assert.deepEqual(task(s).waitFor,['approval']);
 s.apply(event('PostToolUse',{tool_use_id:'approval'}));assert.equal(task(s).state,'running');
});

test('quota resume notification is activity, not success; stale resume needs input',()=>{
 const s=new Store();s.apply(event('Notification',{notification_type:'quota_auto_resume_stale'}));assert.equal(task(s).reason,'input');
 s.apply(event('Notification',{notification_type:'quota_auto_resume_fired'}));assert.equal(task(s).state,'running');
});

test('batch notifications show settled state and suppress resolved transient permission alerts',()=>{
 const s=new Store(),g=new NotificationGate();s.apply(event('UserPromptSubmit'));
 const changes=[s.apply(event('PermissionRequest',{tool_use_id:'a'},11000)),s.apply(event('PostToolUse',{tool_use_id:'a'},12000)),s.apply(event('Stop',{},13000))];
 const batch=coalesceChanges(changes);assert.equal(batch.length,1);assert.equal(batch[0].task.state,'done');assert.equal(g.allow(batch[0],{enabled:true},13000),true);
 s.apply(event('UserPromptSubmit',{},20000));
 const recovered=coalesceChanges([s.apply(event('PermissionRequest',{tool_use_id:'b'},21000)),s.apply(event('PostToolUse',{tool_use_id:'b'},22000))]);
 assert.equal(recovered[0].changed,false);assert.equal(g.allow(recovered[0],{enabled:true},40000),false);
});

test('batch coalescing retains a new wait when a parallel event leaves it unchanged',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));
 const batch=coalesceChanges([s.apply(event('PermissionRequest',{tool_use_id:'a'},11000)),s.apply(event('PreToolUse',{tool_use_id:'b'},12000))]);
 assert.equal(batch[0].changed,true);assert.equal(batch[0].task.state,'waiting');
});
test('session/subagent identities stay independent and parent exit is not child success',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));s.apply(event('SubagentStart',{agent_id:'worker'}));s.apply(event('SubagentStart',{session_id:'s2',agent_id:'worker'}));assert.equal(s.tasks.size,3);
 s.apply(event('SessionEnd'));assert.equal(s.snapshot(10000).find(t=>t.session==='s1'&&t.agent==='worker').state,'unknown');
 assert.equal(s.snapshot(10000).find(t=>t.session==='s2').state,'running');
});
test('subagent result does not finish parent; background Stop is not done',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));s.apply(event('SubagentStop',{agent_id:'worker',last_assistant_message:'child'}));assert.equal(s.snapshot(10000).find(t=>!t.agent).state,'running');
 s.apply(event('Stop',{background_tasks:[{id:'job'}]}));assert.equal(s.snapshot(10000).find(t=>!t.agent).reason,'background');
 s.apply(event('Stop',{session_crons:[{id:'wake'}]}));assert.equal(s.snapshot(10000).find(t=>!t.agent).reason,'scheduled');
});
test('duplicate, malformed and late events cannot regress newer state',()=>{
 const s=new Store();const done=event('Stop',{},20000);s.apply(done);assert.equal(s.apply(done),null);assert.equal(s.apply({}),null);s.apply(event('PreToolUse',{},15000));assert.equal(task(s).state,'done');
});

test('malformed inbox subagent events and flags cannot finish a parent or invent background work',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));
 const malformed={...event('SubagentStop',{agent_id:'child'}),agent:''};
 assert.equal(s.apply(malformed),null);assert.equal(task(s).state,'running');
 assert.equal(s.apply({...event('Stop'),background:'false'}),null);assert.equal(task(s).state,'running');
 assert.equal(s.apply({...event('Stop'),id:''}),null);assert.equal(task(s).state,'running');
});
test('silence becomes uncertain, never done; durable state restores correctly',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));assert.equal(s.snapshot(400000)[0].displayState,'unknown');assert.equal(task(s).state,'running');
 const restored=new Store(JSON.parse(JSON.stringify(s.export())));assert.equal(restored.snapshot(400000)[0].displayState,'unknown');assert.equal(restored.apply(event('Stop')).task.state,'done');
 assert.doesNotThrow(()=>new Store(null));
});

test('corrupt saved entries are skipped and valid stations can receive new events',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));
 const saved=JSON.parse(JSON.stringify(s.export()));const valid=saved.tasks[0];
 valid.history.push(null,{event:'Stop',at:1,state:'invented',tool:''});
 valid.result={unexpected:'object'};valid.tools=null;valid.waitFor={unexpected:true};
 saved.tasks.unshift(null,{}, {...valid,id:'wrong identity'}, {...valid,state:'invented'});
 saved.lastEventAt='bad';saved.seen.push(null,{},'x'.repeat(200));
 const restored=new Store(saved);assert.equal(restored.tasks.size,1);assert.equal(restored.lastEventAt,0);
 assert.equal(task(restored).result,'');assert.equal(task(restored).history.length,1);assert.deepEqual(task(restored).waitFor,[]);
 assert.equal(restored.apply(event('PermissionRequest',{tool_use_id:'a'},11000)).task.state,'waiting');
});
test('acknowledgements reset on state change and clear only removes finished tasks',()=>{
 const s=new Store();s.apply(event('PermissionRequest'));s.acknowledge(task(s).id);assert.equal(task(s).acknowledged,true);s.apply(event('Stop'));assert.equal(task(s).acknowledged,false);s.clearFinished();assert.equal(s.tasks.size,0);
 s.apply(event('UserPromptSubmit'));s.clearFinished();assert.equal(s.tasks.size,1);
});
test('notification gate respects opt-in, focus, quiet, cooldown and old backlog',()=>{
 const g=new NotificationGate();const c={changed:true,task:{id:'a',state:'waiting',updatedAt:10000}};
 assert.equal(g.allow(c,{},10000),false);assert.equal(g.allow(c,{enabled:true,quiet:true},10000),false);assert.equal(g.allow(c,{enabled:true,focused:true},10000),false);
 assert.equal(g.allow(c,{enabled:true},10000),true);assert.equal(g.allow(c,{enabled:true},20000),false);assert.equal(g.allow(c,{enabled:true},26000),true);assert.equal(g.allow(c,{enabled:true},80000),false);
});
test('built-in themes validate; external content is not accepted as colors or sprite code',()=>{
 for(const name of ['workshop','moonbase'])assert.equal(validateTheme(require(`../src/themes/${name}.json`)).version,1);
 const theme=structuredClone(require('../src/themes/workshop.json'));theme.colors.sky='url(https://example.com)';assert.throws(()=>validateTheme(theme));
 theme.colors.sky='#123456';theme.sprites.running[0]='<script>alert(1)';assert.throws(()=>validateTheme(theme));
});
test('native icon is a PNG with expected dimensions, not an unsupported SVG',()=>{const png=require('../src/core/icon.cjs').createIcon();assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),32);assert.equal(png.readUInt32BE(20),32);});
