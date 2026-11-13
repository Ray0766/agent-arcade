'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeCard,normalizeCharacterBook,toCardObject,revalidateCard,LIMITS}=require('../src/vendor/sillytavern/character-card.cjs');
// SillyTavern entry settings an entry gets when its `extensions` carry none (upstream defaults).
const ST_DEFAULTS={placement:'after',depth:4,role:'system',selectiveLogic:'and_any',probability:100,useProbability:true,group:'',groupOverride:false,groupWeight:100,
  sticky:null,cooldown:null,delay:null,scanDepth:null,matchWholeWords:null,excludeRecursion:false,preventRecursion:false,delayUntilRecursion:0,ignoreBudget:false};
const data=(extra={})=>({name:' 合成角色 ',description:'描述',personality:'温和',scenario:'书房',first_mes:'你好，{{user}}。',mes_example:'<START>\n{{user}}: 嗨\n{{char}}: 嗨',
  creator_notes:'notes',system_prompt:'sys',post_history_instructions:'post',alternate_greetings:['早上好','晚上好'],tags:['a','b'],creator:'tester',character_version:'1.2',extensions:{},...extra});
const v2=extra=>({spec:'chara_card_v2',spec_version:'2.0',data:data(extra)});

test('V1 flat cards are normalized, including legacy creator notes and comma tags',()=>{
  const card=normalizeCard({name:'Flat',description:'d',personality:'p',scenario:'s',first_mes:'hi',mes_example:'ex',creatorcomment:'legacy note',tags:'one, two,,one',creator:'me'});
  assert.equal(card.spec,'chara_card_v1');
  assert.deepEqual([card.name,card.description,card.personality,card.scenario,card.firstMessage,card.exampleDialogue],['Flat','d','p','s','hi','ex']);
  assert.equal(card.creatorNotes,'legacy note');assert.deepEqual(card.tags,['one','two']);
  assert.deepEqual(card.alternateGreetings,[]);assert.equal(card.characterBook,null);assert.deepEqual(card.extensions,{});assert.deepEqual(card.warnings,[]);
  assert.equal(normalizeCard({name:'Only name'}).description,'');
});
test('V2 and V3 cards carry greetings, prompts and metadata; data wins over flat fields',()=>{
  const card=normalizeCard({...v2(),name:'flat name',description:'flat description'});
  assert.equal(card.spec,'chara_card_v2');assert.equal(card.name,'合成角色');assert.equal(card.description,'描述');
  assert.equal(card.firstMessage,'你好，{{user}}。');assert.deepEqual(card.alternateGreetings,['早上好','晚上好']);
  assert.equal(card.systemPrompt,'sys');assert.equal(card.postHistoryInstructions,'post');assert.equal(card.creatorNotes,'notes');
  assert.equal(card.creator,'tester');assert.equal(card.characterVersion,'1.2');assert.deepEqual(card.tags,['a','b']);
  const v3=normalizeCard({spec:'chara_card_v3',spec_version:'3.0',data:data({alternate_greetings:'single',group_only_greetings:['x'],assets:[{uri:'https://example.invalid/a.png'}]})});
  assert.equal(v3.spec,'chara_card_v3');assert.deepEqual(v3.alternateGreetings,['single']);
  assert.equal(JSON.stringify(v3).includes('example.invalid'),false);
  // Flat fields fill what a data block lacks (upstream readFromV2 behaviour).
  assert.equal(normalizeCard({spec:'chara_card_v2',spec_version:'2.0',description:'flat only',data:{name:'N'}}).description,'flat only');
  assert.ok(normalizeCard({spec:'chara_card_v2',spec_version:'9',data:{name:'N'}}).warnings.some(text=>text.includes('V2 version')));
});
test('the result is deeply frozen',()=>{
  const card=normalizeCard(v2({extensions:{depth_prompt:{prompt:'x'}},character_book:{entries:[{keys:['k'],content:'c',enabled:true,insertion_order:1,extensions:{}}],extensions:{}}}));
  for(const value of [card,card.tags,card.alternateGreetings,card.extensions,card.extensions.depth_prompt,card.characterBook,card.characterBook.entries,card.characterBook.entries[0],card.characterBook.entries[0].keys,card.warnings])
    assert.ok(Object.isFrozen(value));
});
test('invalid cards are rejected; name is required and never truncated',()=>{
  const invalid=value=>assert.throws(()=>normalizeCard(value),{code:'character_card_invalid'});
  invalid(null);invalid([]);invalid('text');invalid({});invalid({name:'  '});invalid({name:42});
  invalid({spec:'arcade_character_v1',data:{name:'x'}});invalid({spec:'chara_card_v2',spec_version:'2.0'});invalid({spec:'chara_card_v2',data:[]});
  invalid({name:'n'.repeat(LIMITS.name+1)});
  assert.equal(normalizeCard({name:'n'.repeat(LIMITS.name)}).name.length,LIMITS.name);
  assert.equal(normalizeCard({name:'line\nbreak'}).name,'line break');
});
test('oversized fields are truncated with warnings instead of failing',()=>{
  const long='长'.repeat(LIMITS.text+5);
  const card=normalizeCard(v2({description:long,personality:long,scenario:long,first_mes:long,system_prompt:long,post_history_instructions:long,mes_example:long,
    creator_notes:'n'.repeat(LIMITS.creatorNotes+1),alternate_greetings:[...Array(LIMITS.greetings+3).fill('hi'),long],tags:Array.from({length:LIMITS.tags+4},(_, i)=>'t'+i)}));
  for(const key of ['description','personality','scenario','firstMessage','systemPrompt','postHistoryInstructions','exampleDialogue']) assert.equal(card[key].length,LIMITS.text);
  assert.equal(card.creatorNotes.length,LIMITS.creatorNotes);assert.equal(card.alternateGreetings.length,LIMITS.greetings);assert.equal(card.tags.length,LIMITS.tags);
  for(const part of ['the description','the system prompt','the creator notes','alternate greetings','tags']) assert.ok(card.warnings.some(text=>text.includes(part)),part);
  const tagged=normalizeCard(v2({tags:['x'.repeat(LIMITS.tag+9),7,''],alternate_greetings:[long,5]}));
  assert.deepEqual(tagged.tags,['x'.repeat(LIMITS.tag)]);assert.equal(tagged.alternateGreetings[0].length,LIMITS.text);assert.equal(tagged.alternateGreetings.length,1);
  const odd=normalizeCard(v2({description:{a:1},personality:'ok\u0000\u0007 fine',tags:{}}));
  assert.equal(odd.description,'');assert.equal(odd.personality,'ok fine');assert.deepEqual(odd.tags,[]);
  assert.ok(odd.warnings.length<=LIMITS.warnings);
});
test('lorebook entries are normalized with upstream defaults',()=>{
  const book={name:'世界书',scan_depth:4,token_budget:512,recursive_scanning:true,extensions:{},entries:[
    {id:7,keys:[' 月亮 ','moon'],secondary_keys:['night'],content:'月亮很圆。',enabled:true,constant:true,selective:true,insertion_order:10,position:'before_char',comment:'moon',priority:3,case_sensitive:true,extensions:{}},
    {keys:['sun'],content:'sun',insertion_order:'bad',position:'before_char',extensions:{position:4,case_sensitive:false},name:'named'},
    {id:7,keys:'single',content:'dup id',enabled:true,extensions:{position:0}},
    'not an entry',
  ]};
  const result=normalizeCard(v2({character_book:book})).characterBook;
  assert.deepEqual({...result,entries:undefined},{name:'世界书',scanDepth:4,tokenBudget:512,recursiveScanning:true,entries:undefined});
  assert.deepEqual(result.entries[0],{id:7,keys:['月亮','moon'],secondaryKeys:['night'],content:'月亮很圆。',enabled:true,constant:true,selective:true,insertionOrder:10,position:'before_char',caseSensitive:true,comment:'moon',priority:3,...ST_DEFAULTS,placement:'before'});
  // Missing `enabled` means disabled, ST numeric position overrides the spec field, order defaults to 100.
  assert.deepEqual(result.entries[1],{id:1,keys:['sun'],secondaryKeys:[],content:'sun',enabled:false,constant:false,selective:false,insertionOrder:100,position:'after_char',caseSensitive:false,comment:'named',priority:null,...ST_DEFAULTS,placement:'at_depth'});
  assert.equal(result.entries[2].id,0);assert.deepEqual(result.entries[2].keys,['single']);assert.equal(result.entries[2].position,'before_char');
  assert.equal(result.entries.length,3);
  assert.equal(normalizeCard(v2({character_book:{name:'no entries'}})).characterBook,null);
  assert.equal(normalizeCard(v2({character_book:'x'})).characterBook,null);
});
test('lorebook caps: entries, content, key count and key length',()=>{
  const entries=Array.from({length:LIMITS.bookEntries+7},(_, i)=>({keys:['k'],content:'c',enabled:true,insertion_order:i,extensions:{}}));
  entries[0]={keys:Array.from({length:LIMITS.entryKeys+5},(_, i)=>'key'+i),secondary_keys:['x'.repeat(LIMITS.entryKey+1),'ok'],content:'c'.repeat(LIMITS.entryContent+1),enabled:true};
  const card=normalizeCard(v2({character_book:{entries,extensions:{}}}));
  assert.equal(card.characterBook.entries.length,LIMITS.bookEntries);
  assert.equal(card.characterBook.entries[0].keys.length,LIMITS.entryKeys);assert.deepEqual(card.characterBook.entries[0].secondaryKeys,['ok']);
  assert.equal(card.characterBook.entries[0].content.length,LIMITS.entryContent);
  assert.equal(new Set(card.characterBook.entries.map(entry=>entry.id)).size,LIMITS.bookEntries);
  for(const part of ['lorebook entries','lorebook keys','lorebook secondary keys','a lorebook entry']) assert.ok(card.warnings.some(text=>text.includes(part)),part);
});
test('extensions stay inert JSON, are size-capped, and cannot pollute prototypes',()=>{
  const extensions=JSON.parse('{"regex_scripts":[{"findRegex":"/x/","replaceString":"y"}],"tools":["Write"],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
  const card=normalizeCard(v2({extensions}));
  assert.deepEqual(card.extensions.regex_scripts,[{findRegex:'/x/',replaceString:'y'}]);
  assert.equal({}.polluted,undefined);assert.equal(card.polluted,undefined);
  assert.equal(typeof card.extensions.tools[0],'string');
  const big=normalizeCard(v2({extensions:{blob:'x'.repeat(LIMITS.extensionsBytes)}}));
  assert.deepEqual(big.extensions,{});assert.ok(big.warnings.some(text=>text.includes('extensions')));
  assert.deepEqual(normalizeCard(v2({extensions:['array']})).extensions,{});
  const withFunction=normalizeCard(v2({extensions:{run(){return 1;},keep:1}}));
  assert.deepEqual(withFunction.extensions,{keep:1});
});
test('toCardObject and revalidateCard round-trip a normalized card',()=>{
  const card=normalizeCard(v2({character_book:{name:'b',scan_depth:2,entries:[{id:3,keys:['k'],secondary_keys:['s'],content:'c',enabled:true,constant:true,insertion_order:5,position:'before_char',priority:1,case_sensitive:false,comment:'m',extensions:{}}],extensions:{}},extensions:{world:'w'}}));
  for(const [format,spec,version] of [['v2','chara_card_v2','2.0'],['v3','chara_card_v3','3.0']]) {
    const object=toCardObject(card,format);
    assert.equal(object.spec,spec);assert.equal(object.spec_version,version);
    assert.deepEqual({...normalizeCard(JSON.parse(JSON.stringify(object))),spec:card.spec},{...card});
  }
  assert.deepEqual(toCardObject(card,'v3').data.group_only_greetings,[]);
  assert.throws(()=>toCardObject(card,'v9'),{code:'character_card_invalid'});
  assert.deepEqual(revalidateCard(card),card);
  const edited=revalidateCard({...card,description:'d'.repeat(LIMITS.text+1),alternateGreetings:'oops',characterBook:{entries:'bad'},warnings:['kept',5]});
  assert.equal(edited.description.length,LIMITS.text);assert.deepEqual(edited.alternateGreetings,['oops']);assert.equal(edited.characterBook,null);
  assert.equal(edited.warnings[0],'kept');assert.equal(edited.spec,'chara_card_v2');
  assert.throws(()=>revalidateCard({...card,name:''}),{code:'character_card_invalid'});
});
test('lorebook entries carry SillyTavern entry settings as bounded typed fields',()=>{
  const extensions={position:4,depth:2,role:2,selectiveLogic:3,probability:35,useProbability:true,group:' weather ',group_override:true,group_weight:250,
    sticky:3,cooldown:2,delay:5,scan_depth:6,match_whole_words:true,exclude_recursion:true,prevent_recursion:true,delay_until_recursion:true,ignore_budget:true,
    outlet_name:'x',automation_id:'run-me',vectorized:true,triggers:['normal']};
  const {book,warnings}=normalizeCharacterBook({entries:[{keys:['k'],content:'c',enabled:true,extensions}]});
  assert.deepEqual(warnings,[]);
  const entry=book.entries[0];
  assert.deepEqual(Object.fromEntries(Object.keys(ST_DEFAULTS).map(key=>[key,entry[key]])),{placement:'at_depth',depth:2,role:'assistant',selectiveLogic:'and_all',probability:35,useProbability:true,
    group:'weather',groupOverride:true,groupWeight:250,sticky:3,cooldown:2,delay:5,scanDepth:6,matchWholeWords:true,excludeRecursion:true,preventRecursion:true,delayUntilRecursion:1,ignoreBudget:true});
  assert.equal(entry.position,'after_char');
  // Settings the engine does not use are not carried.
  for(const key of ['outletName','automationId','vectorized','triggers','extensions']) assert.equal(key in entry,false,key);
  assert.ok(Object.isFrozen(book)&&Object.isFrozen(entry));
});
test('lorebook entry settings are clamped and wrong types fall back to upstream defaults',()=>{
  const hostile={position:99,depth:-5,role:'system',selectiveLogic:'and_all',probability:1e9,useProbability:'no',group:{a:1},group_override:'yes',group_weight:-3,
    sticky:1e12,cooldown:'2',delay:NaN,scan_depth:5000,match_whole_words:1,exclude_recursion:'true',prevent_recursion:1,delay_until_recursion:99,ignore_budget:{}};
  const {book,warnings}=normalizeCharacterBook({entries:[{keys:['k'],content:'c',enabled:true,position:'before_char',extensions:hostile},{keys:['k'],content:'c',enabled:true,extensions:{group:'g'.repeat(LIMITS.entryGroup+1),probability:-4,depth:2.9}}]});
  const pick=(entry)=>Object.fromEntries(Object.keys(ST_DEFAULTS).map(key=>[key,entry[key]]));
  assert.deepEqual(pick(book.entries[0]),{...ST_DEFAULTS,depth:0,groupWeight:0,sticky:100000,scanDepth:1000,delayUntilRecursion:10});
  assert.equal(book.entries[0].position,'after_char');
  assert.equal(book.entries[1].group.length,LIMITS.entryGroup);assert.equal(book.entries[1].probability,0);assert.equal(book.entries[1].depth,2);
  assert.ok(warnings.some(text=>text.includes('a lorebook group')));
  assert.equal(normalizeCharacterBook('nope').book,null);assert.equal(normalizeCharacterBook(null).book,null);
});
test('entry settings survive a V2 / V3 export round trip; legacy stored entries stay readable',()=>{
  const extensions={position:3,depth:1,role:1,selectiveLogic:2,probability:50,useProbability:false,group:'g',group_override:true,group_weight:7,sticky:2,cooldown:4,delay:6,
    scan_depth:3,match_whole_words:false,exclude_recursion:true,prevent_recursion:true,delay_until_recursion:2,ignore_budget:true};
  const card=normalizeCard(v2({character_book:{entries:[{id:1,keys:['k'],content:'c',enabled:true,insertion_order:5,extensions},{id:2,keys:['b'],content:'d',enabled:true,position:'before_char'}]}}));
  assert.equal(card.characterBook.entries[0].placement,'an_bottom');assert.equal(card.characterBook.entries[1].placement,'before');
  for(const format of ['v2','v3']) assert.deepEqual(normalizeCard(JSON.parse(JSON.stringify(toCardObject(card,format)))).characterBook,card.characterBook);
  assert.deepEqual(toCardObject(card).data.character_book.entries[0].extensions,extensions);
  // An entry stored before this extension has none of the new fields.
  const legacy={...card,characterBook:{...card.characterBook,entries:[{id:9,keys:['k'],secondaryKeys:[],content:'c',enabled:true,constant:false,selective:false,insertionOrder:1,position:'before_char',caseSensitive:null,comment:'',priority:null}]}};
  const entry=revalidateCard(legacy).characterBook.entries[0];
  assert.equal(entry.position,'before_char');assert.equal(entry.placement,'before');assert.equal(entry.probability,100);assert.equal(entry.sticky,null);
});
