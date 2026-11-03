'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../src/core/events.cjs');
const { Store } = require('../src/core/store.cjs');
const { NotificationGate } = require('../src/core/notify.cjs');
const { validateTheme } = require('../src/core/theme.cjs');
const event = (name, extra={}, at=10000) => normalize({session_id:'s1',hook_event_name:name,cwd:'C:\\projects\\arcade',...extra},{now:at,captureResults:true});
const task = s => s.snapshot(10000)[0];
test('normalizer stores no prompts, tool arguments, paths or raw errors by default',()=>{
 const e=normalize({session_id:'s',hook_event_name:'Stop',cwd:'/private/project',prompt:'SECRET',tool_input:{password:'SECRET'},error:'SECRET',transcript_path:'/SECRET',last_assistant_message:'SECRET'});
 assert(!JSON.stringify(e).includes('SECRET'));assert.equal(e.project,'project');assert.equal(e.result,'');
 assert.equal(normalize({session_id:'s',hook_event_name:'Mystery'}),null);
 assert.equal(normalize({session_id:'s',hook_event_name:'SubagentStart'}),null);
});
test('result capture is explicit and bounded',()=>{assert.equal(event('Stop',{last_assistant_message:'a'.repeat(20000)}).result.length,16000);});
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
test('AskUserQuestion and idle notification wait; irrelevant notifications do not alter state',()=>{
 const s=new Store();s.apply(event('PreToolUse',{tool_name:'AskUserQuestion',tool_use_id:'q'}));assert.equal(task(s).reason,'question');
 s.apply(event('Notification',{notification_type:'auth_success'}));assert.equal(task(s).reason,'question');
 s.apply(event('PostToolUse',{tool_use_id:'q'}));assert.equal(task(s).state,'running');
 s.apply(event('Notification',{notification_type:'idle_prompt'}));assert.equal(task(s).reason,'input');
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
test('silence becomes uncertain, never done; durable state restores correctly',()=>{
 const s=new Store();s.apply(event('UserPromptSubmit'));assert.equal(s.snapshot(400000)[0].displayState,'unknown');assert.equal(task(s).state,'running');
 const restored=new Store(JSON.parse(JSON.stringify(s.export())));assert.equal(restored.snapshot(400000)[0].displayState,'unknown');assert.equal(restored.apply(event('Stop')).task.state,'done');
 assert.doesNotThrow(()=>new Store(null));
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
