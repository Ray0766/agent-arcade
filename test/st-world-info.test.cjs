'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanWorldInfo,parseRegexKey,tokenBudgetToChars,LIMITS}=require('../src/vendor/sillytavern/world-info.cjs');
const {normalizeCharacterBook}=require('../src/vendor/sillytavern/character-card.cjs');
// Synthetic entries in the normalized shape; content defaults to "c<id>".
const E=(id,keys=[],extra={})=>({id,keys,secondaryKeys:[],content:'c'+id,enabled:true,constant:false,selective:false,insertionOrder:100,position:'after_char',placement:'after',...extra});
const say=(...texts)=>texts.map(text=>({role:'user',name:'',text}));
const ids=result=>result.activated.map(item=>item.id);
const scan=(entries,texts,options={})=>scanWorldInfo({entries,messages:say(...[].concat(texts)),random:()=>0,...options});

test('constant, primary key, disabled and key-less entries',()=>{
  const result=scan([E(1,[],{constant:true}),E(2,['Dragon']),E(3,['dragon'],{enabled:false}),E(4,[]),E(5,['unicorn'])],'I saw a DRAGON today');
  assert.deepEqual(ids(result),[1,2]);assert.deepEqual(result.after,['c2','c1']);assert.deepEqual(result.before,[]);
  assert.deepEqual(result.warnings,[]);assert.deepEqual(result.state,{turn:1,sticky:{},cooldown:{}});
  // Entries produced by the card normalizer work unchanged.
  const {book}=normalizeCharacterBook({entries:[{id:9,keys:['dragon'],content:'lore',enabled:true,position:'before_char'}]});
  assert.deepEqual(scan(book.entries,'a dragon').before,['lore']);
});
test('case sensitivity and whole-word matching, per entry and by default',()=>{
  assert.deepEqual(ids(scan([E(1,['Dragon'],{caseSensitive:true}),E(2,['Dragon'],{caseSensitive:false}),E(3,['Dragon'])],'a dragon')),[2,3]);
  assert.deepEqual(ids(scan([E(1,['Dragon'])],'a dragon',{caseSensitive:true})),[]);
  const whole=extra=>ids(scan([E(1,['cat'],{matchWholeWords:true,...extra})],extra.text));
  assert.deepEqual(whole({text:'concatenate'}),[]);assert.deepEqual(whole({text:'a cat.'}),[1]);assert.deepEqual(whole({text:'cat'}),[1]);
  assert.deepEqual(whole({text:'tomcat, cat!'}),[1]);
  assert.deepEqual(ids(scan([E(1,['cat'])],'concatenate')),[1]);
  assert.deepEqual(ids(scan([E(1,['cat'])],'concatenate',{matchWholeWords:true})),[]);
  // Upstream: a multi-word key is a plain substring test even in whole-word mode; CJK neighbours count as boundaries.
  assert.deepEqual(ids(scan([E(1,['big cat'],{matchWholeWords:true})],'the big cats')),[1]);
  assert.deepEqual(ids(scan([E(1,['月亮'],{matchWholeWords:true})],'看月亮吧')),[1]);
});
test('selective secondary keys: AND ANY, AND ALL, NOT ANY, NOT ALL',()=>{
  const run=(selectiveLogic,text,extra={})=>ids(scan([E(1,['moon'],{selective:true,secondaryKeys:['night','sky'],selectiveLogic,...extra})],text)).length;
  assert.deepEqual([run('and_any','moon'),run('and_any','moon sky'),run('and_any','moon night sky')],[0,1,1]);
  assert.deepEqual([run('and_all','moon sky'),run('and_all','moon night sky')],[0,1]);
  assert.deepEqual([run('not_any','moon'),run('not_any','moon sky')],[1,0]);
  assert.deepEqual([run('not_all','moon'),run('not_all','moon sky'),run('not_all','moon night sky')],[1,1,0]);
  assert.equal(run(undefined,'moon night'),1);
  // Secondary keys are ignored unless the entry is selective, and the primary key is always required.
  assert.equal(run('and_all','moon',{selective:false}),1);assert.equal(run('and_any','night sky'),0);
});
test('regex keys match with their flags; plain text containing slashes stays plain',()=>{
  assert.deepEqual(ids(scan([E(1,['/dra(gon|ke)s?\\b/i']),E(2,['/^\\x01A storm/']),E(3,['/dragon/']),E(4,['/a/b/'])],'A storm of DRAKES, /a/b/')),[1,2,4]);
  assert.equal(parseRegexKey('plain'),null);assert.equal(parseRegexKey('/a/b/'),null);
  assert.equal(parseRegexKey('/a\\/b/g').regex.source,'a\\/b');assert.equal(parseRegexKey('/a/gy').regex.flags,'');
});
test('hostile regex keys are rejected or time-bounded, with a warning',()=>{
  for(const key of ['/(a+)+$/','/(.*)*x/','/(a|aa)+$/','/((a+))+$/','/(x(a|b)y){2,}/','/(a)\\1/','/'+'a'.repeat(LIMITS.regexPattern+1)+'/','/(/'])
    assert.ok(parseRegexKey(key).rejected,key);
  const rejected=scan([E(1,['/(a+)+$/']),E(2,['aaa'])],'aaa'+'a'.repeat(40)+'!');
  assert.deepEqual(ids(rejected),[2]);assert.ok(rejected.warnings.some(text=>text.includes('regular-expression key')));
  // Polynomial backtracking passes the static screen; the per-test timeout stops it.
  const started=Date.now();
  const slow=scan([E(1,['/.*.*.*.*.*x$/']),E(2,[],{constant:true})],'b'.repeat(30000));
  assert.deepEqual(ids(slow),[2]);assert.ok(slow.warnings.some(text=>text.includes('ran too long')));
  assert.ok(Date.now()-started<2000);
  assert.equal(parseRegexKey('/.*.*x/').guarded,true);assert.equal(parseRegexKey('/dragons?/').guarded,false);
});
test('probability uses the injected random source',()=>{
  const entries=[E(1,['k'],{probability:40}),E(2,['k'],{probability:60}),E(3,['k'],{probability:0,useProbability:false}),E(4,['k'],{probability:0})];
  assert.deepEqual(ids(scan(entries,'k',{random:()=>0.5})),[2,3]);
  assert.deepEqual(ids(scan(entries,'k',{random:()=>0.99})),[3]);
  // A failed roll is final for the scan: recursion does not retry it.
  const calls=[];
  scan([E(1,['k'],{probability:40,content:'again k'}),E(2,['k'],{content:'k k'})],'k',{random:()=>{calls.push(1);return 0.9;}});
  assert.equal(calls.length,1);
});
test('scan order and placement follow insertion order; merged books keep character entries first',()=>{
  const result=scan([E(1,['k'],{insertionOrder:10,placement:'before'}),E(2,['k'],{insertionOrder:30,placement:'before'}),E(3,['k'],{insertionOrder:20,placement:'before'}),E(4,['k'],{insertionOrder:20,placement:'before'})],'k');
  // Scanned from the highest order down; placed ascending so the highest order sits nearest the chat.
  assert.deepEqual(ids(result),[2,3,4,1]);assert.deepEqual(result.before,['c1','c4','c3','c2']);
  const merged=[{...E(1,['k'],{insertionOrder:50}),book:'world'},{...E(1,['k'],{insertionOrder:10}),book:'char',source:'character'}];
  assert.deepEqual(scan(merged,'k').activated,[{id:1,comment:'',book:'char'},{id:1,comment:'',book:'world'}]);
  assert.deepEqual(scan(merged,'k',{insertionStrategy:'global_first'}).activated.map(item=>item.book),['world','char']);
  assert.deepEqual(scan(merged,'k',{insertionStrategy:'evenly'}).activated.map(item=>item.book),['world','char']);
  const duplicate=scan([E(1,['k']),E(1,['k'])],'k');
  assert.equal(duplicate.activated.length,1);assert.ok(duplicate.warnings.some(text=>text.includes('duplicate id')));
});
test('budget: an entry that would overflow is skipped whole and later entries are not added',()=>{
  const entries=[E(1,['k'],{insertionOrder:300,content:'x'.repeat(10)}),E(2,['k'],{insertionOrder:200,content:'y'.repeat(50)}),E(3,['k'],{insertionOrder:100,content:'z'.repeat(5)})];
  const result=scan(entries,'k',{budgetChars:30});
  assert.deepEqual(ids(result),[1]);assert.deepEqual(result.after,['x'.repeat(10)]);assert.ok(result.warnings.some(text=>text.includes('budget of 30')));
  assert.deepEqual(ids(scan(entries,'k',{budgetChars:80})),[1,2,3]);
  // Constants get no head start (upstream orders by insertion order only); ignore-budget entries still get in.
  const withConstant=[...entries.slice(0,2),E(3,[],{constant:true,insertionOrder:100,content:'z'}),E(4,['k'],{insertionOrder:90,ignoreBudget:true,content:'w'.repeat(500)}),E(5,['k'],{insertionOrder:80,content:'v'})];
  assert.deepEqual(ids(scan(withConstant,'k',{budgetChars:30})),[1,4]);
  // After an overflow there is no recursion pass.
  assert.deepEqual(ids(scan([E(1,['k'],{insertionOrder:300,content:'gold'}),E(2,['k'],{insertionOrder:200,content:'y'.repeat(50)}),E(3,['gold'],{content:'g'})],'k',{budgetChars:30})),[1]);
});
test('recursion: on, off, step limit, exclude, prevent and delay until recursion',()=>{
  const chain=(extra={})=>[E(1,['castle'],{content:'The castle has a dragon.',...extra.a}),E(2,['dragon'],{content:'Dragons hoard gold.',...extra.b}),E(3,['gold'],{content:'Gold is heavy.'})];
  assert.deepEqual(ids(scan(chain(),'castle')),[1,2,3]);
  assert.deepEqual(ids(scan(chain(),'castle',{recursive:false})),[1]);
  assert.deepEqual(ids(scan(chain(),'castle',{maxRecursionSteps:2})),[1,2]);
  assert.deepEqual(ids(scan(chain(),'castle',{maxRecursionSteps:1})),[1]);
  assert.deepEqual(ids(scan(chain({a:{preventRecursion:true}}),'castle')),[1]);
  assert.deepEqual(ids(scan(chain({b:{excludeRecursion:true}}),'castle')),[1]);
  assert.deepEqual(ids(scan(chain({b:{excludeRecursion:true}}),'castle dragon')),[1,2,3]);
  const delayed=[E(1,['castle'],{content:'stone'}),E(2,['castle'],{delayUntilRecursion:1})];
  assert.deepEqual(ids(scan(delayed,'castle')),[1,2]);assert.deepEqual(ids(scan(delayed,'castle',{maxRecursionSteps:1})),[1]);
  // Open delay levels get their own pass even without recursion text.
  const levels=[E(1,['castle'],{delayUntilRecursion:1}),E(2,['castle'],{delayUntilRecursion:2})];
  assert.deepEqual(ids(scan(levels,'castle',{recursive:false})),[1,2]);assert.deepEqual(ids(scan(levels,'castle',{recursive:false,maxRecursionSteps:1})),[]);
  assert.deepEqual(ids(scan(levels.slice(0,1),'castle')),[]);
});
test('inclusion groups pick one entry: prioritised, else weighted by the injected random',()=>{
  const group=[E(1,['k'],{group:'weather',groupWeight:100}),E(2,['k'],{group:'weather',groupWeight:300}),E(3,['k'])];
  assert.deepEqual(ids(scan(group,'k',{random:()=>0.1})),[1,3]);
  assert.deepEqual(ids(scan(group,'k',{random:()=>0.5})),[2,3]);
  const prioritised=[...group.slice(0,2),E(4,['k'],{group:'weather',groupOverride:true,insertionOrder:5}),E(5,['k'],{group:'weather',groupOverride:true,insertionOrder:9})];
  assert.deepEqual(ids(scan(prioritised,'k',{random:()=>0.5})),[5]);
  // An entry can sit in several groups; a group with a winner from an earlier pass admits nobody.
  assert.deepEqual(ids(scan([E(1,['k'],{group:'a, b'}),E(2,['k'],{group:'b'}),E(3,['k'],{group:'a'})],'k',{random:()=>0})),[1]);
  assert.deepEqual(ids(scan([E(1,['k'],{group:'g',content:'second'}),E(2,['second'],{group:'g'})],'k')),[1]);
});
test('sticky, cooldown and delay advance through the serialisable state',()=>{
  const turn=(entries,text,state,options={})=>scan(entries,text,{state:state&&JSON.parse(JSON.stringify(state)),...options});
  // Upstream counts chat messages; one call is one turn of two messages (clock 1, 3, 5, ...).
  const sticky=[E(1,['spark'],{sticky:4})];
  let result=turn(sticky,'spark');
  assert.deepEqual(ids(result),[1]);assert.deepEqual(result.state,{turn:1,sticky:{'.1':{start:1,end:5,protected:false}},cooldown:{}});
  result=turn(sticky,'nothing',result.state);assert.deepEqual(ids(result),[1]);
  result=turn(sticky,'nothing',result.state);assert.deepEqual(ids(result),[]);assert.deepEqual(result.state,{turn:3,sticky:{},cooldown:{}});

  const cooldown=[E(1,['spark'],{cooldown:4})];
  result=turn(cooldown,'spark');assert.deepEqual(ids(result),[1]);
  result=turn(cooldown,'spark',result.state);assert.deepEqual(ids(result),[]);
  result=turn(cooldown,'spark',result.state);assert.deepEqual(ids(result),[1]);

  // When a sticky run ends the cooldown starts from that turn.
  const both=[E(1,['spark'],{sticky:2,cooldown:4})];
  const seen=[];
  result=undefined;
  for(let index=0;index<5;index++){result=turn(both,'spark',result?.state);seen.push(ids(result).length);}
  assert.deepEqual(seen,[1,0,0,1,0]);

  const delay=[E(1,['spark'],{delay:4})];
  const delayed=[];
  result=undefined;
  for(let index=0;index<3;index++){result=turn(delay,'spark',result?.state);delayed.push(ids(result).length);}
  assert.deepEqual(delayed,[0,0,1]);
  // The caller may supply the real chat length as the clock.
  assert.deepEqual(ids(turn(delay,'spark',undefined,{chatLength:4})),[1]);
  // A sticky entry skips its probability roll and wins its inclusion group.
  const first=turn([E(1,['spark'],{sticky:6,probability:50,group:'g'}),E(2,['other'],{group:'g'})],'spark',undefined,{random:()=>0.1});
  assert.deepEqual(ids(turn([E(1,['spark'],{sticky:6,probability:50,group:'g'}),E(2,['other'],{group:'g'})],'other',first.state,{random:()=>0.9})),[1]);
  // Effects of entries that are gone expire; malformed state is ignored.
  assert.deepEqual(turn([],'x',{turn:9,sticky:{'.1':{start:1,end:5,protected:false}},cooldown:{'.2':{start:1,end:99}}}).state,{turn:10,sticky:{},cooldown:{'.2':{start:1,end:99,protected:false}}});
  assert.deepEqual(turn([],'x',{turn:'x',sticky:[1],cooldown:{a:5,b:{start:'1',end:2}}}).state,{turn:1,sticky:{},cooldown:{}});
  assert.ok(turn([],'x','bad').warnings.some(text=>text.includes('state')));
});
test('scan depth, per-entry depth and extra scan text',()=>{
  const texts=['old apple','middle pear','newest plum'];
  assert.deepEqual(ids(scan([E(1,['apple']),E(2,['pear']),E(3,['plum'])],texts)),[2,3]);
  assert.deepEqual(ids(scan([E(1,['apple'],{scanDepth:3}),E(2,['pear'],{scanDepth:1}),E(3,['plum'],{scanDepth:0}),E(4,[],{constant:true,scanDepth:0})],texts)),[1,4]);
  assert.deepEqual(ids(scan([E(1,['apple'])],texts,{scanDepth:0})),[]);
  assert.deepEqual(ids(scan([E(1,['sailor'])],texts)),[]);
  assert.deepEqual(ids(scan([E(1,['sailor'])],texts,{extraScanText:'Ray is a sailor.'})),[1]);
  // Speaker names are part of the scanned text.
  assert.deepEqual(ids(scanWorldInfo({entries:[E(1,['mira:'])],messages:[{role:'assistant',name:'Mira',text:'hello'}]})),[1]);
});
test('positions: at depth with role, and warned fallbacks for unsupported positions',()=>{
  const entries=[E(1,['k'],{placement:'at_depth',depth:2,role:'system',insertionOrder:10}),E(2,['k'],{placement:'at_depth',depth:2,role:'system',insertionOrder:20}),
    E(3,['k'],{placement:'at_depth',depth:2,role:'user'}),E(4,['k'],{placement:'at_depth',depth:0,role:'assistant'}),
    E(5,['k'],{placement:'an_top'}),E(6,['k'],{placement:'an_bottom'}),E(7,['k'],{placement:'em_top'}),E(8,['k'],{placement:'outlet'}),E(9,['k'],{placement:undefined,position:'before_char'})];
  const result=scan(entries,'k',{authorsNoteDepth:7});
  assert.deepEqual(result.atDepth,[{depth:2,role:'user',content:'c3'},{depth:0,role:'assistant',content:'c4'},{depth:7,role:'system',content:'c6\nc5'},{depth:2,role:'system',content:'c1\nc2'}]);
  assert.deepEqual(result.after,['c7']);assert.deepEqual(result.before,['c9']);
  assert.equal(result.warnings.filter(text=>text.includes('Author\'s Note')).length,1);
  assert.equal(result.warnings.filter(text=>text.includes('Example-message')).length,1);
  assert.equal(result.warnings.filter(text=>text.includes('Outlet')).length,1);
  assert.equal(scan(entries.slice(4,6),'k').atDepth[0].depth,4);
});
test('decorators and macro substitution in keys and content',()=>{
  assert.deepEqual(ids(scan([E(1,[],{content:'@@activate\nforced'}),E(2,['k'],{content:'@@dont_activate\nnever'}),E(3,['k'],{content:'@@unknown\nkept'})],'k')),[1,3]);
  assert.deepEqual(scan([E(1,[],{content:'@@activate\nforced'})],'x').after,['forced']);
  const result=scan([E(1,['{{char}}'],{content:'{{char}} greets {{user}}.'}),E(2,['greets Ray'])],'hello mira',{macroEnv:{char:'Mira',user:'Ray'}});
  assert.deepEqual(result.after,['c2','Mira greets Ray.']);
  assert.deepEqual(scan([E(1,['{{char}}'])],'hello mira').activated,[]);
});
test('hard caps and the scan time budget',()=>{
  const many=Array.from({length:LIMITS.entries+5},(_, index)=>E(index,[],{constant:true,content:'c'}));
  const capped=scan(many,'x',{budgetChars:1e6});
  assert.equal(capped.activated.length,LIMITS.activated);
  assert.ok(capped.warnings.some(text=>text.includes(`first ${LIMITS.entries}`)));assert.ok(capped.warnings.some(text=>text.includes(`${LIMITS.activated} lorebook entries`)));
  // Scanned text is cut; a key beyond the cut is not found.
  const long=scan([E(1,['needle'])],'x'.repeat(LIMITS.scanChars)+' needle');
  assert.deepEqual(ids(long),[]);assert.ok(long.warnings.some(text=>text.includes('Scanned only')));
  assert.equal(scan([E(1,['k'],{content:'y'.repeat(LIMITS.content+50)})],'k').after[0].length,LIMITS.content);
  // Injected clock: 30 ms per reading. The second keyed entry is past the 50 ms budget; constants still activate.
  let clock=0;
  const timed=scan([E(1,['k'],{insertionOrder:30}),E(2,['k'],{insertionOrder:20}),E(3,[],{constant:true,insertionOrder:10,content:'k again'})],'k',{now:()=>clock+=30});
  assert.deepEqual(ids(timed),[1,3]);assert.ok(timed.warnings.some(text=>text.includes('exceeded 50 ms')));
  // Tracked timed effects are bounded.
  const stickyMany=Array.from({length:LIMITS.stateEntries+20},(_, index)=>E(index,[],{constant:true,sticky:4+index,content:''}));
  const state=scan(stickyMany,'x',{budgetChars:1e6}).state;
  assert.ok(Object.keys(state.sticky).length<=LIMITS.activated);
  const bloated={turn:0,sticky:Object.fromEntries(Array.from({length:LIMITS.stateEntries+50},(_, index)=>['.'+index,{start:0,end:900+index,protected:true}])),cooldown:{}};
  assert.ok(Object.keys(scan([],'x',{state:bloated}).state.sticky).length<=LIMITS.stateEntries);
  assert.ok(scan([],'x').warnings.length<=LIMITS.warnings);
});
test('wrong types throw; malformed entries and messages are skipped',()=>{
  const invalid=options=>assert.throws(()=>scanWorldInfo(options),{code:'world_info_invalid'});
  invalid(null);invalid({entries:{},messages:[]});invalid({entries:[],messages:'x'});invalid({entries:[],messages:[],random:1});invalid({entries:[],messages:[],extraScanText:5});invalid({entries:[],messages:[],macroEnv:[]});
  const result=scanWorldInfo({entries:[null,'x',{keys:['k'],content:'no id',enabled:true},E(1,['k',5,'','x'.repeat(LIMITS.key+1)]),E(2,'k')],messages:[null,{text:5},{role:'user',text:'k'}]});
  assert.deepEqual(ids(result),[1]);assert.ok(result.warnings.some(text=>text.includes('without an id')));
  assert.deepEqual(scanWorldInfo({entries:[],messages:[]}),{before:[],after:[],atDepth:[],activated:[],state:{turn:1,sticky:{},cooldown:{}},warnings:[]});
});
test('token budget conversion uses 4 characters per token, 1.5 for CJK-heavy text',()=>{
  assert.equal(tokenBudgetToChars(100),400);assert.equal(tokenBudgetToChars(100,'plain english text'),400);
  assert.equal(tokenBudgetToChars(100,'月亮很圆，今晚的风很轻。'),150);assert.equal(tokenBudgetToChars(100,'mostly english 月'),400);
  assert.equal(tokenBudgetToChars(-1),0);assert.equal(tokenBudgetToChars('x'),0);
});
