'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeRegexScript,importRegexScripts,applyRegexScripts,parseFindRegex,LIMITS}=require('../src/vendor/sillytavern/regex-scripts.cjs');
const {screenPattern,guardedMatches}=require('../src/vendor/sillytavern/safe-regex.cjs');
// Synthetic script in the shape SillyTavern exports (numeric placement and substituteRegex).
const upstream=(extra={})=>({id:'3f0c5d5e-8a55-4c62-9d3c-0d6f6f1f2a11',scriptName:'Strip think',findRegex:'/<think>([\\s\\S]*?)<\\/think>/gi',replaceString:'',trimStrings:[],placement:[2],disabled:false,markdownOnly:false,promptOnly:false,runOnEdit:true,substituteRegex:0,minDepth:null,maxDepth:null,...extra});
const S=(findRegex,replaceString,extra={})=>normalizeRegexScript({scriptName:'s',findRegex,replaceString,placement:[2],...extra});
const run=(text,scripts,options={})=>applyRegexScripts(text,{scripts:[].concat(scripts),placement:'ai_output',...options});

test('imports an upstream-shaped script, an array, and rejects what is not a script',()=>{
  const one=importRegexScripts(JSON.stringify(upstream()));
  assert.equal(one.scripts.length,1);assert.deepEqual(one.warnings,[]);
  const script=one.scripts[0];
  assert.ok(Object.isFrozen(script)&&Object.isFrozen(script.placement)&&Object.isFrozen(script.trimStrings));
  // As upstream, an import gets a new id.
  assert.match(script.id,/^[0-9a-f-]{36}$/);assert.notEqual(script.id,upstream().id);
  assert.deepEqual({...script,id:''},{id:'',scriptName:'Strip think',findRegex:upstream().findRegex,replaceString:'',trimStrings:[],placement:['ai_output'],disabled:false,markdownOnly:false,promptOnly:false,runOnEdit:true,substituteRegex:'none',minDepth:null,maxDepth:null,warnings:[]});
  assert.equal(run('a<think>secret</think>b<THINK>x</THINK>',script).text,'ab');
  // Array, buffer with BOM, one invalid member skipped with a warning.
  const many=importRegexScripts(Buffer.from('﻿'+JSON.stringify([upstream(),{findRegex:'x'},upstream({scriptName:'Second',placement:[1,3]})])));
  assert.deepEqual(many.scripts.map(item=>item.scriptName),['Strip think','Second']);
  assert.match(many.warnings.join('\n'),/Script 2 was skipped: The regex script has no name/);
  assert.match(many.warnings.join('\n'),/Second: The slash-command placement is not supported/);
  assert.equal(importRegexScripts(upstream()).scripts.length,1);
  for(const input of ['{','[]','[1,2]','"text"',JSON.stringify({scriptName:''}),'x'.repeat(LIMITS.importBytes+1),JSON.stringify(Array.from({length:101},()=>upstream()))])
    assert.throws(()=>importRegexScripts(input),{code:'regex_script_invalid'});
});
test('normalization bounds and keeps a valid id',()=>{
  assert.equal(normalizeRegexScript(upstream()).id,upstream().id);
  assert.equal(normalizeRegexScript(upstream({id:'00ff00ff00ff00ff'})).id,'00ff00ff00ff00ff');
  assert.notEqual(normalizeRegexScript(upstream({id:'../x'})).id,'../x');
  const long=normalizeRegexScript(upstream({scriptName:'n'.repeat(150),trimStrings:[...Array.from({length:25},(_,i)=>'t'+i),'',7,'x'.repeat(201)]}));
  assert.equal(long.scriptName.length,100);assert.equal(long.trimStrings.length,20);assert.equal(long.warnings.length,2);
  assert.match(normalizeRegexScript(upstream({trimStrings:['x'.repeat(201)]})).warnings[0],/trim string longer/);
  assert.throws(()=>normalizeRegexScript(upstream({findRegex:'a'.repeat(1001)})),{code:'regex_script_invalid'});
  assert.throws(()=>normalizeRegexScript(upstream({replaceString:'a'.repeat(4001)})),{code:'regex_script_invalid'});
  assert.throws(()=>normalizeRegexScript(upstream({findRegex:5})),{code:'regex_script_invalid'});
  assert.throws(()=>normalizeRegexScript(null),{code:'regex_script_invalid'});
  assert.deepEqual([normalizeRegexScript(upstream({minDepth:'2',maxDepth:5.9})).minDepth,normalizeRegexScript(upstream({minDepth:'2',maxDepth:5.9})).maxDepth],[2,5]);
  assert.deepEqual([true,1,2,'escaped',0,false,9].map(substituteRegex=>normalizeRegexScript(upstream({substituteRegex})).substituteRegex),['raw','raw','escaped','escaped','none','none','none']);
  // A normalized script normalizes to itself.
  const first=normalizeRegexScript(upstream({placement:[1,2,5,6],substituteRegex:2,minDepth:1}));
  assert.deepEqual(normalizeRegexScript(first),first);
});
test('placement mapping, including the legacy MD-display and sendAs values',()=>{
  const placed=placement=>normalizeRegexScript(upstream({placement}));
  assert.deepEqual(placed([6,5,2,1,1]).placement,['user_input','ai_output','world_info','reasoning']);
  const slash=placed([3,2]);
  assert.deepEqual(slash.placement,['ai_output']);assert.match(slash.warnings[0],/slash-command/);
  assert.deepEqual(placed([3]).placement,[]);assert.match(placed([3]).warnings.join(' '),/will not run/);
  // Upstream migration: MD display alone means every placement, markdown and prompt only.
  const md=placed([0]);
  assert.deepEqual(md.placement,['user_input','ai_output','world_info','reasoning']);assert.ok(md.markdownOnly&&md.promptOnly);
  const mdPlus=placed([0,1]);
  assert.deepEqual(mdPlus.placement,['user_input']);assert.ok(mdPlus.markdownOnly&&mdPlus.promptOnly);
  assert.deepEqual(placed([4]).placement,[]);assert.deepEqual(placed([4,2]).placement,['ai_output']);
  assert.match(placed([2,99,'nope']).warnings[0],/unknown placement/i);
  // Only scripts placed on the requested target run.
  const scripts=[S('a','1',{placement:[1]}),S('a','2',{placement:[2]}),S('a','5',{placement:[5]}),S('a','6',{placement:[6]})];
  assert.deepEqual(['user_input','ai_output','world_info','reasoning'].map(placement=>applyRegexScripts('a',{scripts,placement}).text),['1','2','5','6']);
  assert.throws(()=>applyRegexScripts('a',{scripts,placement:'slash_command'}),{code:'regex_script_invalid'});
  assert.throws(()=>applyRegexScripts(5,{scripts,placement:'ai_output'}),{code:'regex_script_invalid'});
});
test('markdownOnly / promptOnly selection matrix follows upstream',()=>{
  const kinds={plain:{},markdown:{markdownOnly:true},prompt:{promptOnly:true},both:{markdownOnly:true,promptOnly:true}};
  const ran=(kind,options)=>run('a',S('a','b',kinds[kind]),options).text==='b';
  const table={ // [stored text, isMarkdown, isPrompt, both flags]
    plain:[true,false,false,false],markdown:[false,true,false,true],prompt:[false,false,true,true],both:[false,true,true,true],
  };
  for(const [kind,expected] of Object.entries(table))
    assert.deepEqual([{},{isMarkdown:true},{isPrompt:true},{isMarkdown:true,isPrompt:true}].map(options=>ran(kind,options)),expected,kind);
});
test('disabled scripts, runOnEdit and the depth window',()=>{
  assert.equal(run('a',S('a','b',{disabled:true})).text,'a');
  assert.equal(run('a',S('a','b'),{isEdit:true}).text,'a');
  assert.equal(run('a',S('a','b',{runOnEdit:true}),{isEdit:true}).text,'b');
  const windowed=S('a','b',{minDepth:2,maxDepth:4});
  assert.deepEqual([0,1,2,3,4,5,null].map(depth=>run('a',windowed,{depth}).text),['a','a','b','b','b','a','b']);
  // Upstream ignores a minDepth below -1 and a negative maxDepth.
  assert.equal(run('a',S('a','b',{minDepth:-5,maxDepth:-1}),{depth:3}).text,'b');
  assert.equal(run('a',S('a','b',{minDepth:null,maxDepth:0}),{depth:1}).text,'a');
  assert.equal(run('a',S('a','b',{minDepth:0}),{depth:-1}).text,'a');
});
test('capture groups, named groups, {{match}} and scripts chained in list order',()=>{
  assert.equal(run('John Smith, Ann Lee',S('/(\\w+) (\\w+)/g','$2 $1')).text,'Smith John, Lee Ann');
  assert.equal(run('John Smith, Ann Lee',S('(\\w+) (\\w+)','$2 $1')).text,'Smith John, Ann Lee'); // bare pattern: first match only
  assert.equal(run('x=1',S('/(?<key>\\w)=(?<value>\\d)/','$<value>:$<key>:$<missing>:$9')).text,'1:x::');
  assert.equal(run('hello world',S('/o/g','[{{match}}|{{MATCH}}|$0]')).text,'hell[o|o|o] w[o|o|o]rld');
  // A group that did not take part is empty; replacement text is data, not a JS replacement pattern.
  assert.equal(run('ac',S('/a(b)?c/','<$1>$&$`')).text,'<>$&$`');
  assert.equal(run('aXb',S('/x/i','$$')).text,'a$$b');
  const result=run('cat',[S('cat','dog'),S('dog','bird'),S('zzz','never')]);
  assert.equal(result.text,'bird');assert.equal(result.applied.length,2);assert.deepEqual(result.warnings,[]);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.applied));
  // Empty matches of a global pattern advance like String.prototype.replace.
  assert.equal(run('ab',S('/x*/g','-')).text,'-a-b-');
  assert.equal(run('a\u{1F600}b',S('/(?:)/gu','-')).text,'-a-\u{1F600}-b-');
  assert.equal(run('',S('/^/','x')).text,'');
  // Upstream flag handling: an unsupported flag letter turns the whole input into the pattern.
  assert.equal(run('a/b/y',S('/b/y','!')).text,'a!');
  assert.match(run('abc',S('/b/x','!')).warnings[0],/invalid syntax or unsupported flags/);
});
test('trim strings are removed from captured text, with macros',()=>{
  const script=S('/"(.*?)"/g','<$1>',{trimStrings:['*','{{user}}']});
  assert.equal(run('"*hi* Ray" and "plain"',script,{macroEnv:{user:'Ray',char:'Ju'}}).text,'<hi > and <plain>');
  // Trim strings apply to {{match}} as well, not to the surrounding replacement text.
  assert.equal(run('a*b',S('/a\\*b/','*{{match}}*',{trimStrings:['*']})).text,'*ab*');
});
test('macros in the replacement and the three find-pattern substitution modes',()=>{
  const macroEnv={user:'Ray',char:'J.u'};
  assert.equal(run('hi',S('hi','{{char}} greets {{user}}'),{macroEnv}).text,'J.u greets Ray');
  const find='/{{char}}/g';
  assert.equal(run('J.u Jxu {{char}}',S(find,'#',{substituteRegex:0}),{macroEnv}).text,'J.u Jxu #'); // not substituted: the braces are literal text
  assert.equal(run('J.u Jxu',S(find,'#',{substituteRegex:1}),{macroEnv}).text,'# #');
  assert.equal(run('J.u Jxu',S(find,'#',{substituteRegex:2}),{macroEnv}).text,'# Jxu');
  // Escaped mode keeps a hostile name from becoming pattern syntax.
  const hostile=run('aaaa (a+)+$',S('/{{user}}/','#',{substituteRegex:2}),{macroEnv:{user:'(a+)+$'}});
  assert.equal(hostile.text,'aaaa #');assert.deepEqual(hostile.warnings,[]);
  assert.match(run('aaaa',S('/{{user}}/','#',{substituteRegex:1}),{macroEnv:{user:'(a+)+$'}}).warnings[0],/nested repeated group/);
});
test('hostile or broken patterns are skipped and leave the text unchanged',()=>{
  const text='a'.repeat(40)+'!';
  const nested=run(text,[S('/(a+)+$/','x'),S('!','?')]);
  assert.equal(nested.text,'a'.repeat(40)+'?');assert.equal(nested.applied.length,1);
  assert.match(nested.warnings[0],/Regex script "s" was skipped: it has a nested repeated group/);
  // Not caught by the static screen: stopped by the timeout instead.
  const started=Date.now();
  const slow=run('a'.repeat(60)+'!',[S('/(a|aa)+$/','x'),S('/^(a|a)*$/','y')],{timeBudgetMs:200});
  assert.equal(slow.text,'a'.repeat(60)+'!');assert.deepEqual(slow.applied,[]);
  assert.equal(slow.warnings.filter(warning=>/ran too long/.test(warning)).length,1); // identical warnings are merged
  assert.ok(Date.now()-started<2000);
  // The shared budget stops later scripts once it is spent. The clock is the test's own (start, before the first
  // script, before the second): with the real one the 5 ms pattern timeout and Date.now() disagreed by a millisecond
  // on a fast machine, 1 ms looked left over and the second script ran (seen on ubuntu-latest).
  const clock=[0,0,5],budget=run('a'.repeat(60)+'!',[S('/(a|aa)+$/','x'),S('!','?')],{timeBudgetMs:5,now:()=>clock.length>1?clock.shift():clock[0]});
  assert.equal(budget.text,'a'.repeat(60)+'!');assert.match(budget.warnings.join('\n'),/remaining scripts were not applied/);
  for(const pattern of ['/(/','/[a/','/a)/','/(?<n>a)(?<n>b)/'])assert.equal(run('(a)[a',S(pattern,'x')).text,'(a)[a',pattern);
  assert.match(run('a',{scriptName:5,findRegex:'a'}).warnings[0],/invalid regex script was skipped/);
  // Legitimate alternation and backreferences still run.
  assert.equal(run('"a" \'b\'',S('/(["\'])(.*?)\\1/g','<$2>')).text,'<a> <b>');
  assert.equal(run('foo bar baz',S('/(?:foo|bar)+ /g','')).text,'baz');
  assert.ok(parseFindRegex('/a+/g').regex instanceof RegExp);assert.match(parseFindRegex('').rejected,/empty/);
  assert.equal(screenPattern('(a|b)+'),'a nested or alternating repeated group');assert.equal(screenPattern('\\1'),'a backreference');
  assert.equal(guardedMatches(/a/g,'aaa',20,2).tooMany,true);
});
test('input and output caps',()=>{
  const big=run('a'.repeat(LIMITS.inputChars+1),S('/a/g','b'));
  assert.equal(big.text.length,LIMITS.inputChars+1);assert.ok(big.text.startsWith('aaa'));assert.match(big.warnings[0],/were not applied/);
  // 3000 matches x 100 characters would exceed the output cap: the script and those after it stop.
  const grow=run('a'.repeat(3000),[S('/^a/','b'),S('/a/g','x'.repeat(100)),S('b','c')]);
  assert.equal(grow.text,'b'+'a'.repeat(2999));assert.equal(grow.applied.length,1);assert.match(grow.warnings[0],/beyond 200000 characters/);
  const many=Array.from({length:101},(_,index)=>S('a','a',{scriptName:'n'+index}));
  assert.match(run('a',many).warnings[0],/Only the first 100/);
});

test('zero-width matches respect the match cap', () => {
  // Give the count check its own watchdog so it does not race the production time limit.
  const atLimit = guardedMatches(/(?:)/g, 'a'.repeat(LIMITS.matches - 1), 1000, LIMITS.matches);
  assert.equal(atLimit.done, true);
  assert.equal(atLimit.matches.length, LIMITS.matches);
  const overLimit = guardedMatches(/(?:)/g, 'a'.repeat(LIMITS.matches), 1000, LIMITS.matches);
  assert.equal(overLimit.tooMany, true);
});
