'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeGroup,pickSpeakers,groupCardFields,extractAllWords,findMentions,LIMITS}=require('../src/vendor/sillytavern/group-chat.cjs');
const id=n=>n.toString(16).padStart(16,'0');
const [A,B,C,D]=[1,2,3,4].map(id);
const cast=[{id:A,name:'Alice Liddell',talkativeness:0.5},{id:B,name:'Bob',talkativeness:0.5},{id:C,name:'橘娘',talkativeness:0.5},{id:D,name:'Dragon 龙娘'}];
const G=(extra={})=>normalizeGroup({name:'Tea party',members:[A,B,C,D],...extra});
// Deterministic random source: replays the given values, then repeats the last one.
const seq=(...values)=>{let i=0;const fn=()=>values[Math.min(i++,values.length-1)];fn.calls=()=>i;return fn;};
const user=text=>({role:'user',speakerId:null,text});
const from=(speakerId,text='')=>({role:'assistant',speakerId,text});

test('normalizes camelCase and upstream-shaped groups',()=>{
  const group=normalizeGroup({id:id(9),name:' Tea\nparty ',members:[A,B,B,'avatar.png',7,C],disabled_members:[B,'ghost'],activation_strategy:3,allow_self_responses:1,generation_mode:2,auto_mode:true,generation_mode_join_prefix:'<p>'});
  assert.deepEqual({...group,warnings:[]},{id:id(9),name:'Tea party',members:[A,B,C],disabledMembers:[B],activationStrategy:'pooled',allowSelfResponses:true,generationMode:'join',autoMode:false,warnings:[]});
  assert.ok(Object.isFrozen(group)&&Object.isFrozen(group.members));
  assert.equal(group.warnings.length,4); // dropped member, muted-join mode, join affixes, auto mode
  assert.deepEqual(normalizeGroup(group),{...group,warnings:[]});
  assert.deepEqual([0,1,2,3,'list',9,undefined].map(activation_strategy=>normalizeGroup({name:'g',activation_strategy}).activationStrategy),['natural','list','manual','pooled','list','natural','natural']);
  assert.deepEqual([0,1,2,'join',undefined].map(generation_mode=>normalizeGroup({name:'g',generation_mode}).generationMode),['swap','join','join','join','swap']);
  const defaults=normalizeGroup({name:'g'});
  assert.deepEqual(defaults,{name:'g',members:[],disabledMembers:[],activationStrategy:'natural',allowSelfResponses:false,generationMode:'swap',autoMode:false,warnings:[]});
  const many=normalizeGroup({name:'n'.repeat(80),members:Array.from({length:12},(_,i)=>id(i+1))});
  assert.equal(many.name.length,60);assert.equal(many.members.length,LIMITS.members);assert.equal(many.warnings.length,2);
  for(const raw of [null,[],{},{name:' '},{name:5}])assert.throws(()=>normalizeGroup(raw),{code:'group_invalid'});
});
test('word extraction is upstream ASCII-only; CJK names match by substring',()=>{
  // Upstream `\b\w+\b`: CJK text has no words, so upstream can never match a CJK name.
  assert.deepEqual(extractAllWords('Hi, Alice_1! 橘娘你好').map(item=>item.word),['hi','alice_1']);
  assert.deepEqual(extractAllWords('橘娘'),[]);
  const names=cast.map(({id,name})=>({id,name}));
  assert.deepEqual(findMentions('bob and ALICE',names),[B,A]); // order of mention, case-insensitive
  assert.deepEqual(findMentions('Liddell?',names),[A]); // any word of the name
  assert.deepEqual(findMentions('Bobby, Alicia',names),[]); // whole words only
  assert.deepEqual(findMentions('橘娘在吗?还有龙娘',names),[C,D]); // extension: substring of the CJK run
  assert.deepEqual(findMentions('龙娘 then dragon then 橘娘 then Bob',names),[D,C,B]);
  assert.deepEqual(findMentions('橘 娘',names),[]);
  assert.deepEqual(findMentions('',names),[]);
  // Upstream rule: a shared word activates the first member that carries it.
  assert.deepEqual(findMentions('smith',[{id:A,name:'Ann Smith'},{id:B,name:'Bo Smith'}]),[A]);
});
test('natural order: mentions first, then talkativeness rolls in shuffled order',()=>{
  // random 0.99: the shuffle is the identity and every roll fails -> only the mention speaks.
  assert.deepEqual(pickSpeakers({group:G(),characters:cast,lastMessage:user('Bob, 橘娘?'),random:seq(0.99)}),[B,C]);
  // random 0: every roll passes; mentioned member stays first, the rest follow in shuffled order.
  const all=pickSpeakers({group:G(),characters:cast,lastMessage:user('hello Bob'),random:seq(0)});
  assert.equal(all[0],B);assert.deepEqual([...all].sort(),[A,B,C,D]);
  // Rolls: shuffle consumes 4 values (identity), then one roll per member in order A,B,C,D.
  assert.deepEqual(pickSpeakers({group:G(),characters:cast,lastMessage:user('hi'),random:seq(0.99,0.99,0.99,0.99, 0.9,0.5,0.51,0.1)}),[B,D]);
  // Nobody mentioned, nobody rolled: one random member that can talk (talkativeness > 0).
  const quiet=cast.map((item,index)=>({...item,talkativeness:index===2?0.3:0}));
  const random=seq(0.99);
  assert.deepEqual(pickSpeakers({group:G(),characters:quiet,lastMessage:user('hi'),random}),[C]);
  assert.equal(random.calls(),9); // 4 shuffle + 4 rolls + 1 fallback pick
  assert.deepEqual(pickSpeakers({group:G(),characters:cast.map(item=>({...item,talkativeness:0})),lastMessage:user('hi'),random:seq(0.99,0.99,0.99,0.99,0.5,0.5,0.5,0.5,0.3)}),[B]);
  // Default talkativeness is 0.5 (D has none); a non-numeric value also falls back.
  assert.deepEqual(pickSpeakers({group:G({members:[D]}),characters:cast,lastMessage:user('hi'),random:seq(0,0.5)}),[D]);
  assert.deepEqual(pickSpeakers({group:G({members:[A]}),characters:[{id:A,name:'A',talkativeness:'x'}],lastMessage:null,random:seq(0,0.5)}),[A]);
  // A result is a plain array, capped at 8.
  assert.ok(Array.isArray(all)&&all.length<=8);
});
test('self-response rule',()=>{
  // B spoke last and names itself: banned from mentions and rolls unless self-responses are allowed.
  const last=from(B,'I, Bob, agree with Alice');
  assert.deepEqual(pickSpeakers({group:G(),characters:cast,lastMessage:last,random:seq(0.99)}),[A]);
  assert.deepEqual(pickSpeakers({group:G({allowSelfResponses:true}),characters:cast,lastMessage:last,random:seq(0.99)}),[B,A]);
  const everyone=pickSpeakers({group:G(),characters:cast,lastMessage:from(B,'...'),random:seq(0)});
  assert.deepEqual([...everyone].sort(),[A,C,D]);
  // After a user message nobody is banned.
  assert.ok(pickSpeakers({group:G(),characters:cast,lastMessage:user('...'),random:seq(0)}).includes(B));
});
test('disabled and unknown members never speak',()=>{
  const group=G({disabledMembers:[B,C]});
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:user('Bob 橘娘 Alice'),random:seq(0.99)}),[A]);
  assert.deepEqual([...pickSpeakers({group,characters:cast,lastMessage:user('x'),random:seq(0)})].sort(),[A,D]);
  assert.deepEqual(pickSpeakers({group:G({activationStrategy:'list',disabledMembers:[A]}),characters:cast.slice(0,3),lastMessage:user('x')}),[B,C]);
  assert.deepEqual(pickSpeakers({group:G({disabledMembers:[A,B,C,D]}),characters:cast,lastMessage:user('Bob')}),[]);
  assert.deepEqual(pickSpeakers({group:G(),characters:[],lastMessage:user('Bob')}),[]);
  // A raw group is normalized on the way in.
  assert.deepEqual(pickSpeakers({group:{name:'g',members:[A,B],disabled_members:[A],activation_strategy:1},characters:cast,lastMessage:null}),[B]);
});
test('list order: every enabled member in member order',()=>{
  const group=G({activationStrategy:'list',members:[C,A,B]});
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:user('Bob')}),[C,A,B]);
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:from(C,'x')}),[C,A,B]); // upstream: no self-response ban here
});
test('pooled order: someone who has not spoken since the user, else anyone but the last speaker',()=>{
  const group=G({activationStrategy:'pooled',members:[A,B,C]});
  // After a user message everyone is eligible.
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:user('hi'),history:[from(A),user('hi')],random:seq(0.99)}),[C]);
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:user('hi'),random:seq(0)}),[A]);
  // A spoke since the user: B or C.
  const history=[from(C),user('hi'),from(A)];
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:from(A),history,random:seq(0)}),[B]);
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:from(A),history,random:seq(0.99)}),[C]);
  // Everyone spoke: random among all but the last speaker.
  const full=[user('hi'),from(A),from(B),from(C)];
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:from(C),history:full,random:seq(0.99)}),[B]);
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:from(C),history:full,random:seq(0)}),[A]);
  // A single member may answer itself.
  assert.deepEqual(pickSpeakers({group:G({activationStrategy:'pooled',members:[A]}),characters:cast,lastMessage:from(A),history:[from(A)],random:seq(0)}),[A]);
});
test('manual strategy and forced speaker',()=>{
  const group=G({activationStrategy:'manual'});
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:user('Bob')}),[]);
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:user('Bob'),manualSpeakerId:C}),[C]);
  assert.deepEqual(pickSpeakers({group:G({activationStrategy:'manual',disabledMembers:[C]}),characters:cast,lastMessage:null,manualSpeakerId:C}),[]);
  assert.deepEqual(pickSpeakers({group,characters:cast,lastMessage:null,manualSpeakerId:id(99)}),[]);
  // As upstream's forced character, it overrides the other strategies too.
  assert.deepEqual(pickSpeakers({group:G({activationStrategy:'list'}),characters:cast,lastMessage:user('x'),manualSpeakerId:B}),[B]);
});
test('card fields: swap uses the speaker, join combines enabled members',()=>{
  const cards=[
    {id:A,name:'Alice',description:' {{char}} is curious. ',personality:'bold',scenario:'',exampleDialogue:'<START>\n{{char}}: hi'},
    {id:B,card:{name:'Bob',description:'<BOT> builds things; {{user}} helps.',personality:'',scenario:'A workshop.',exampleDialogue:'{{char}}: hm'}},
    {id:C,name:'橘娘',description:'{{Char}} 喜欢橘子。',personality:'gentle',scenario:'Tea.',exampleDialogue:''},
  ];
  const swap=groupCardFields({group:G({members:[A,B,C]}),characters:cards,speakerId:B});
  assert.deepEqual(swap,{description:'<BOT> builds things; {{user}} helps.',personality:'',scenario:'A workshop.',exampleDialogue:'{{char}}: hm',warnings:[]});
  assert.ok(Object.isFrozen(swap));
  const join=groupCardFields({group:G({members:[A,B,C],generationMode:'join'}),characters:cards,speakerId:B});
  assert.deepEqual(join,{
    description:'Alice is curious.\nBob builds things; {{user}} helps.\n橘娘 喜欢橘子。',personality:'bold\ngentle',scenario:'A workshop.\nTea.',
    exampleDialogue:'<START>\nAlice: hi\n<START>\nBob: hm',warnings:[]});
  // Muted members are left out unless they are the speaker; members without a card are skipped.
  const muted=G({members:[A,B,C,D],generationMode:'join',disabledMembers:[A,C]});
  assert.equal(groupCardFields({group:muted,characters:cards,speakerId:B}).description,'Bob builds things; {{user}} helps.');
  assert.equal(groupCardFields({group:muted,characters:cards,speakerId:C}).personality,'gentle');
  assert.equal(groupCardFields({group:muted,characters:cards,speakerId:A}).description,'Alice is curious.\nBob builds things; {{user}} helps.');
  assert.throws(()=>groupCardFields({group:muted,characters:cards,speakerId:D}),{code:'group_invalid'});
  // Bounds with warnings.
  const big=[{id:A,name:'A',description:'x'.repeat(15000)},{id:B,name:'B',description:'y'.repeat(25000)}];
  const cut=groupCardFields({group:G({members:[A,B],generationMode:'join'}),characters:big,speakerId:A});
  assert.equal(cut.description.length,20000);assert.deepEqual(cut.warnings,['The joined description was cut to 20000 characters.']);
  const own=groupCardFields({group:G({members:[A,B]}),characters:big,speakerId:B});
  assert.equal(own.description.length,20000);assert.deepEqual(own.warnings,['The description was cut to 20000 characters.']);
});
