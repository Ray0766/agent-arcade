'use strict';
// Regex scripts in the App conversation with an imported character: the stored-text, prompt-only
// and display passes, edits, warnings and the library methods of the service. Synthetic scripts
// and an injected runner only.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,card}=require('./st-local-fixture.cjs');
const pipeline=require('../src/bot/st/regex-pipeline.cjs');
const settings=require('../src/bot/st/local-settings.cjs');
const mira=extra=>card('Mira',{description:'Keeper of the light.',first_mes:'Hello.',...extra});
const numbered=()=>async(_args,count)=>({outcome:'reply_ended',text:'REPLY_'+count});
// Upstream placements: 1 user input, 2 AI output, 5 world info.
const script=(scriptName,findRegex,replaceString,extra={})=>({scriptName,findRegex,replaceString,placement:[2],...extra});

test('stored pass: owner text and model reply are rewritten before they are stored',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});
  f.regexes.add(script('user','/cat/g','dog',{placement:[1]}));f.regexes.add(script('reply','REPLY','ANSWER'));
  f.regexes.add(script('prompt only','dog','PROMPT_ONLY',{placement:[1,2],promptOnly:true,disabled:true}));f.regexes.add(script('named','(?<n>_\\d)$','$<n>!{{match}}',{trimStrings:['_']}));
  await f.open(a.id);const result=await f.service.localReply('my cat and another cat');
  assert.deepEqual([result.outcome,result.text,result.chunks],['reply_ended','ANSWER1!1',['ANSWER1!1']]);
  assert.deepEqual(f.history().map(row=>[row.role,row.text]),[['assistant','Hello.'],['user','my dog and another dog'],['assistant','ANSWER1!1']]);
  // The model saw the stored owner text; nothing else changed.
  assert.match(f.calls[0].prompt,/BEGIN ARCADE_INPUT_0000\nmy dog and another dog\nEND ARCADE_INPUT_0000/);assert.doesNotMatch(f.calls[0].prompt,/cat/);
  assert.deepEqual(f.service.stSnapshot().lastWarnings,[]);
  // Regenerate and continue store rewritten text too; a continuation is rewritten on its own.
  assert.equal((await f.service.localMessage({action:'regenerate'})).message.text,'ANSWER2!2');
  f.state.execute=async()=>({outcome:'reply_ended',text:' and REPLY again'});
  assert.equal((await f.service.localMessage({action:'continue'})).message.text,'ANSWER2!2 and ANSWER again');
  // Memory commands are read from what was typed; the stored message is still rewritten.
  f.state.execute=numbered();const before=f.calls.length;
  assert.match((await f.service.localReply('记住：the cat sleeps')).text,/^记住了：the cat sleeps/);assert.equal(f.calls.length,before);
  assert.equal(f.history().at(-2).text,'记住：the dog sleeps');assert.deepEqual(f.service.localSnapshot().memory.facts.map(fact=>fact.text),['the cat sleeps']);
  // Switched off: text is stored as written. Switched on again: applied again.
  assert.equal(f.service.stConfigure({regex:{enabled:false}}).settings.regex.enabled,false);
  assert.equal((await f.service.localReply('a cat')).text,'REPLY_'+f.calls.length);assert.equal(f.history().at(-2).text,'a cat');
  f.service.stConfigure({regex:{enabled:true}});await f.service.localReply('one more cat');assert.equal(f.history().at(-2).text,'one more dog');
  assert.throws(()=>f.service.stConfigure({regex:{enabled:'yes'}}),{code:'invalid_request'});assert.throws(()=>f.service.stConfigure({regex:{mode:1}}),{code:'invalid_request'});
});

test('prompt-only pass: history by depth, the incoming message and lorebook content change in the prompt only',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira({character_book:{entries:[
    {keys:['harbour'],content:'LORE about the harbour',comment:'harbour',enabled:true,insertion_order:1,extensions:{}},
    {keys:['harbour'],content:'DEEP LORE note',comment:'deep',enabled:true,insertion_order:2,extensions:{position:4,depth:1,role:0}}],extensions:{}}})});
  f.regexes.add(script('old replies','REPLY','OLD',{promptOnly:true,minDepth:2}));
  f.regexes.add(script('hide','secret','[hidden]',{placement:[1],promptOnly:true,maxDepth:0}));
  f.regexes.add(script('lore','LORE','CANON',{placement:[5],promptOnly:true}));
  f.regexes.add(script('not for prompts','harbour','NEVER',{placement:[1,2,5]}).scriptName&&script('display only','REPLY','NEVER',{markdownOnly:true}));
  await f.open(a.id);await f.service.localReply('first secret');await f.service.localReply('second secret');await f.service.localReply('third secret about the harbour');
  const prompt=f.calls[2].prompt;
  // Depths at the third turn: incoming 0, REPLY_2 1, "second secret" 2, REPLY_1 3.
  assert.match(prompt,/Mira: OLD_1\n/);assert.match(prompt,/Mira: REPLY_2\n/);assert.doesNotMatch(prompt,/REPLY_1|OLD_2/);
  assert.match(prompt,/BEGIN ARCADE_INPUT_0000\nthird \[hidden\] about the harbour\nEND ARCADE_INPUT_0000/);assert.match(prompt,/: first secret\n/);assert.match(prompt,/: second secret\n/);
  assert.match(prompt,/CANON about the harbour/);assert.match(prompt,/DEEP CANON note/);assert.doesNotMatch(prompt,/LORE|NEVER/);
  // Stored text is untouched by every prompt-only script, and lorebook keys matched the stored text.
  assert.deepEqual(f.history().map(row=>row.text),['Hello.','first secret','REPLY_1','second secret','REPLY_2','third secret about the harbour','REPLY_3']);
  assert.deepEqual(f.service.stSnapshot().activatedEntries.map(entry=>entry.comment).sort(),['deep','harbour']);assert.deepEqual(f.service.stSnapshot().lastWarnings,[]);
  // Regenerate composes the same way (the question is the incoming message again).
  await f.service.localMessage({action:'regenerate'});assert.match(f.calls[3].prompt,/third \[hidden\] about the harbour/);assert.match(f.calls[3].prompt,/Mira: OLD_1\n/);
});

test('display pass: markdown-only scripts add `display` to snapshot rows and never change stored text',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});
  const shown=f.regexes.add(script('bold','/REPLY_(\\d)/g','<b>$1</b> for {{user}}',{markdownOnly:true}));f.regexes.add(script('newest only','Hello','Hi',{markdownOnly:true,maxDepth:0}));
  await f.open(a.id,{user:{name:'Ray'}});
  assert.deepEqual(f.history().map(row=>[row.text,row.display]),[['Hello.','Hi.']]);
  await f.service.localReply('show REPLY_9');
  const rows=f.history();assert.deepEqual(rows.map(row=>[row.text,row.display]),[['Hello.',undefined],['show REPLY_9',undefined],['REPLY_1','<b>1</b> for Ray']]);
  assert(!Object.hasOwn(rows[0],'display'));assert(!Object.hasOwn(rows[1],'display'));
  assert.deepEqual(f.store().history(f.scope(),10).map(row=>row.text),['Hello.','show REPLY_9','REPLY_1']);assert.match(f.calls[0].prompt,/show REPLY_9/);
  // The same rows are served again without recomputation, and follow edits, settings and the library.
  assert.deepEqual(f.history(),rows);
  await f.service.localMessage({action:'edit',id:rows[2].id,text:'now REPLY_7'});assert.equal(f.history()[2].display,'now <b>7</b> for Ray');
  f.service.stConfigure({user:{name:'Kay'}});assert.equal(f.history()[2].display,'now <b>7</b> for Kay');
  f.service.stConfigure({regex:{enabled:false}});assert(f.history().every(row=>!Object.hasOwn(row,'display')));f.service.stConfigure({regex:{enabled:true}});
  f.service.regexUpdate(shown.id,{disabled:true});assert.equal(f.history()[2].display,undefined);
  f.service.regexUpdate(shown.id,{disabled:false,replaceString:'[$1]'});assert.equal(f.history()[2].display,'now [7]');
  // A built-in persona conversation is never passed through the scripts.
  f.service.stConfigure({characterId:null});await f.service.localStop();f.state.execute=async()=>({outcome:'reply_ended',text:'REPLY_5'});await f.service.localStart();await f.service.localReply('cat REPLY_1');
  assert.deepEqual(f.history().map(row=>[row.text,row.display]),[['cat REPLY_1',undefined],['REPLY_5',undefined]]);
});

test('edits run only the scripts marked run-on-edit',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});
  f.regexes.add(script('on edit','typo','fixed',{placement:[1,2],runOnEdit:true}));f.regexes.add(script('never on edit','REPLY','ANSWER'));
  await f.open(a.id);await f.service.localReply('a typo here');
  const [,user,reply]=f.history();assert.deepEqual([user.text,reply.text],['a fixed here','ANSWER_1']);
  assert.equal((await f.service.localMessage({action:'edit',id:reply.id,text:'typo REPLY'})).message.text,'fixed REPLY');
  assert.equal((await f.service.localMessage({action:'edit',id:user.id,text:'my typo'})).message.text,'my fixed');
  f.service.stConfigure({regex:{enabled:false}});assert.equal((await f.service.localMessage({action:'edit',id:user.id,text:'typo stays'})).message.text,'typo stays');
});

test('a refused, failing or destructive script is reported and never blocks a reply',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});
  f.regexes.add(script('nested','(a+)+$','x',{placement:[1,2]}));f.regexes.add(script('erase','[\\s\\S]+','',{}));f.regexes.add(script('grow','^','x'.repeat(4000),{placement:[1]}));
  f.regexes.add(script('prompt nested','(b+)+$','x',{placement:[1,2,5],promptOnly:true}));f.regexes.add(script('display nested','(c+)+$','x',{markdownOnly:true}));
  await f.open(a.id);const result=await f.service.localReply('plain aaa');
  assert.deepEqual([result.outcome,result.text],['reply_ended','REPLY_1']);assert.deepEqual(f.history().map(row=>row.text),['Hello.','plain aaa','REPLY_1']);
  const warnings=f.service.snapshot().st.lastWarnings;assert(warnings.length<=10);assert(warnings.every(item=>typeof item==='string'&&item.length<=200));
  for(const pattern of [/"nested" was skipped/,/emptied a message; it was stored as written/,/grown a message beyond 2000 characters/,/"prompt nested" was skipped/,/"display nested" was skipped/])assert(warnings.some(item=>pattern.test(item)),String(pattern)+' in '+JSON.stringify(warnings));
  // An unreadable library is one warning; the conversation goes on without scripts.
  require('node:fs').writeFileSync(f.regexes.file,'{not json');f.service.localManager().regexRefresh();
  assert.equal((await f.service.localReply('still works')).text,'REPLY_2');assert(f.service.snapshot().st.lastWarnings.some(item=>/could not be read/.test(item)));
});

test('service: list, import, update, remove and reorder the shared library',async t=>{
  const f=fixture(t),changes=[];const service=f.make({onChange:()=>changes.push(1)});
  assert.deepEqual(service.regexScripts(),[]);
  const imported=service.regexImport(JSON.stringify([script('One','cat','dog'),{scriptName:'',findRegex:'x'},script('Two','/x/g','y'.repeat(3000),{placement:[1,3],trimStrings:['t']}),'nope']));
  assert.equal(imported.added,2);assert.equal(imported.warnings.length,3);assert(imported.warnings.some(item=>/Script 2 was skipped/.test(item)));assert(imported.warnings.some(item=>/slash-command placement/.test(item)));
  assert(changes.length>0);
  const [one,two]=service.regexScripts();
  assert.deepEqual({...one,addedAt:0,updatedAt:0},{id:one.id,scriptName:'One',findRegex:'cat',replaceString:'dog',replaceTruncated:false,trimStrings:[],placement:['ai_output'],disabled:false,markdownOnly:false,promptOnly:false,runOnEdit:false,substituteRegex:'none',minDepth:null,maxDepth:null,addedAt:0,updatedAt:0});
  assert.match(one.id,/^[0-9a-f]{16}$/);assert.deepEqual([two.replaceString.length,two.replaceTruncated,two.placement,two.trimStrings],[2000,true,['user_input'],['t']]);
  assert.equal(service.regexImport(Buffer.from(JSON.stringify(script('Three','a','b')))).added,1);
  assert.equal(service.regexUpdate(one.id,{disabled:true,scriptName:'Renamed'}).scriptName,'Renamed');assert.deepEqual(service.regexScripts().map(item=>[item.scriptName,item.disabled]),[['Renamed',true],['Two',false],['Three',false]]);
  const ids=service.regexScripts().map(item=>item.id);assert.deepEqual(service.regexReorder([ids[2],ids[0],ids[1]]),[ids[2],ids[0],ids[1]]);assert.deepEqual(service.regexScripts().map(item=>item.scriptName),['Three','Renamed','Two']);
  assert.deepEqual(service.regexRemove(ids[1]),{removed:true});assert.deepEqual(service.regexRemove(ids[1]),{removed:false,reason:'not_found'});assert.equal(service.regexScripts().length,2);
  // The other profile's service reads the same library.
  assert.deepEqual(f.service.regexScripts().map(item=>item.scriptName),['Three','Renamed']);
  assert.throws(()=>service.regexImport('{not json'),{code:'regex_script_invalid'});assert.throws(()=>service.regexImport({scriptName:'object'}),{code:'regex_script_invalid'});assert.throws(()=>service.regexImport(Buffer.alloc(1024*1024+1,32)),{code:'regex_script_invalid'});
  assert.throws(()=>service.regexUpdate(ids[0],{id:'x'}),{code:'regex_script_update_invalid'});assert.throws(()=>service.regexUpdate('nope',{disabled:true}),{code:'regex_script_id_invalid'});
  assert.throws(()=>service.regexReorder([ids[0]]),{code:'regex_script_order_invalid'});assert.throws(()=>service.regexRemove(5),{code:'regex_script_id_invalid'});
  // Without a library the feature is absent and nothing is applied.
  const bare=fixture(t,{libraries:false});assert.deepEqual(bare.service.regexScripts(),[]);
  for(const call of [()=>bare.service.regexImport('[]'),()=>bare.service.regexUpdate(ids[0],{disabled:true}),()=>bare.service.regexRemove(ids[0]),()=>bare.service.regexReorder([])])assert.throws(call,{code:'unavailable'});
});

test('pipeline functions are pure and bounded; settings default to enabled',()=>{
  const scripts=pipeline.prepareScripts([script('a','cat','dog',{placement:[1,2]}),script('off','dog','x',{disabled:true}),script('p','dog','PROMPT',{placement:[1,2],promptOnly:true}),script('m','dog','SHOWN',{placement:[1,2],markdownOnly:true}),
    script('e','typo','fixed',{runOnEdit:true}),{nope:true},script('none','x','y',{placement:[3]})]);
  assert(Object.isFrozen(scripts));assert.deepEqual(scripts.map(item=>item.scriptName),['a','p','m','e']);
  assert.deepEqual(pipeline.forPass(scripts,'stored').map(item=>item.scriptName),['a','e']);assert.deepEqual(pipeline.forPass(scripts,'prompt').map(item=>item.scriptName),['p']);assert.deepEqual(pipeline.forPass(scripts,'display').map(item=>item.scriptName),['m']);
  assert.deepEqual(pipeline.storedText(' cat ',{scripts,role:'user',maxChars:2000}),{text:'dog',warnings:[]});
  assert.deepEqual(pipeline.storedText(' cat ',{scripts,role:'assistant',maxChars:2000,trim:false}),{text:' dog ',warnings:[]});
  assert.deepEqual(pipeline.storedText(' untouched ',{scripts,role:'user',maxChars:2000}),{text:' untouched ',warnings:[]});
  assert.deepEqual(pipeline.storedText('cat typo',{scripts,role:'assistant',isEdit:true,maxChars:2000}),{text:'cat fixed',warnings:[]});
  assert.deepEqual(pipeline.storedText('cat',{scripts,role:'tool',maxChars:2000}),{text:'cat',warnings:[]});assert.deepEqual(pipeline.storedText('cat',{scripts:[],role:'user',maxChars:2000}),{text:'cat',warnings:[]});
  const control=pipeline.prepareScripts([script('c','cat','d\ro\x00g')]);assert.equal(pipeline.storedText('cat',{scripts:control,role:'assistant',maxChars:10}).text,'dog');
  const history=[{role:'assistant',text:'dog 1'},{role:'user',text:'dog 2'},{role:'assistant',text:'dog 3'}];
  assert.deepEqual(pipeline.promptHistory(history,{scripts}).history.map(item=>item.text),['PROMPT 1','PROMPT 2','PROMPT 3']);assert.deepEqual(history.map(item=>item.text),['dog 1','dog 2','dog 3']);
  let clock=0;const late=pipeline.promptHistory(history,{scripts,now:()=>(clock+=300)});assert.deepEqual(late.history.map(item=>item.text),['dog 1','dog 2','PROMPT 3']);assert.match(late.warnings[0],/took too long/);
  assert.equal(pipeline.promptHistory(history,{scripts:[]}).history,history);
  assert.deepEqual(pipeline.promptText('dog',{scripts,placement:'user_input',depth:0}),{text:'PROMPT',warnings:[]});
  assert.equal(pipeline.displayText('dog',{scripts,role:'assistant'}).text,'SHOWN');assert.equal(pipeline.displayText('dog',{scripts,role:'system'}).text,'dog');
  assert.deepEqual(settings.defaults().regex,{enabled:true});assert.deepEqual(settings.validate({regex:{}}).regex,{enabled:true});assert.equal(settings.patch(settings.defaults(),{regex:{enabled:false}}).regex.enabled,false);
});
