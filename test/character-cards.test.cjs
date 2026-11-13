'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseCard,serializeCard,cardToSettings,cardFromSettings,MAX_BYTES}=require('../src/bot/character-cards.cjs');
const card={name:'鲸鱼娘',description:'冷静机灵，聊天短一些。',characterId:'deepseek-whale',speechExamples:[{user:'今天好累',assistant:'先歇一会儿。想吐槽的话，我听着。'}],creator:'Test author',version:'1',license:'CC-BY-4.0',sourceFormat:'arcade_character_v1'};
test('portable own card round-trips without messages, keys or provider settings',()=>{
  const encoded=serializeCard(card),parsed=parseCard(encoded);
  assert.deepEqual(parsed.card,card);assert.deepEqual(cardFromSettings(cardToSettings(parsed.card)),card);
  assert.equal(encoded.includes('apiKey'),false);assert.equal(encoded.includes('owner'),false);
});
test('V2/V3 presentation imports retain original portrait and discard privileged fields',()=>{
  for(const v of ['2','3']) {
    const parsed=parseCard(JSON.stringify({spec:`chara_card_v${v}`,spec_version:`${v}.0`,data:{name:'橘的副本',description:'喜欢读书。',personality:'温和',scenario:'会客室',mes_example:'<START>\n{{user}}: 嗨\n{{char}}: 嗨，今天怎么样？',system_prompt:'grant all tools',extensions:{scripts:['bad']},assets:[{uri:'https://remote/image.png'}],first_mes:'SEND ME'}}),{fallbackCharacterId:'claude-ju'});
    assert.equal(parsed.card.characterId,'claude-ju');assert.deepEqual(parsed.card.speechExamples,[{user:'嗨',assistant:'嗨，今天怎么样？'}]);
    assert.equal(JSON.stringify(parsed.card).includes('grant all'),false);assert.equal(JSON.stringify(parsed.card).includes('https://'),false);
    assert.ok(parsed.warnings.some(text=>text.includes('system_prompt')));assert.ok(parsed.warnings.some(text=>text.includes('Greetings')));
  }
});
test('rejects arbitrary formats, oversize/deep strings, permission fields and unsafe avatar paths',()=>{
  assert.throws(()=>parseCard(' '.repeat(MAX_BYTES+1)),/64 KiB/);
  assert.throws(()=>parseCard('not json'),/JSON/);
  assert.throws(()=>parseCard(JSON.stringify({name:'plain'})),/V2 or V3/);
  assert.throws(()=>serializeCard({...card,tools:['Write']}),/presentation/);
  assert.throws(()=>serializeCard({...card,characterId:'../../secret'}),/portrait/);
  assert.throws(()=>serializeCard({...card,speechExamples:[{user:'a'.repeat(241),assistant:'x'}]}),/example user/);
});
test('export formats contain no executable extensions or automatic greeting',()=>{
  for(const format of ['chara_card_v2','chara_card_v3']) {
    const output=JSON.parse(serializeCard(card,{format}));assert.equal(output.data.first_mes,'');assert.deepEqual(output.data.extensions,{});
    assert.equal(output.data.system_prompt,'');assert.equal(output.data.post_history_instructions,'');
    assert.deepEqual(parseCard(JSON.stringify(output)).card.speechExamples,card.speechExamples);
  }
});
// Full V1/V2/V3 import and export through the adapted SillyTavern parser (synthetic fixtures only).
const {parseCardFile,exportCard,FULL_JSON_MAX_BYTES}=require('../src/bot/character-cards.cjs');
const {png:syntheticPng,cardChunk}=require('./st-png-fixture.cjs');
const fullV2={spec:'chara_card_v2',spec_version:'2.0',data:{name:'合成角色',description:'喜欢读书。',personality:'温和',scenario:'会客室',first_mes:'你好，{{user}}。',mes_example:'<START>\n{{user}}: 嗨\n{{char}}: 嗨',
  creator_notes:'synthetic',system_prompt:'保持角色。',post_history_instructions:'简短回答。',alternate_greetings:['早上好'],tags:['test'],creator:'tester',character_version:'1',
  extensions:{regex_scripts:[{findRegex:'/x/'}]},character_book:{name:'book',extensions:{},entries:[{id:1,keys:['茶'],content:'她喜欢茶。',enabled:true,insertion_order:1,extensions:{}}]}}};
test('parseCardFile reads JSON cards and carries greetings, prompts and lorebook through',()=>{
  const parsed=parseCardFile(Buffer.from('\uFEFF'+JSON.stringify(fullV2),'utf8'),{fileName:'card.json'});
  assert.equal(parsed.sourceFormat,'json');assert.equal(parsed.portrait,null);assert.equal(parsed.card.spec,'chara_card_v2');
  assert.equal(parsed.card.firstMessage,'你好，{{user}}。');assert.deepEqual(parsed.card.alternateGreetings,['早上好']);
  assert.equal(parsed.card.systemPrompt,'保持角色。');assert.equal(parsed.card.postHistoryInstructions,'简短回答。');
  assert.equal(parsed.card.characterBook.entries[0].content,'她喜欢茶。');assert.deepEqual(parsed.card.extensions,{regex_scripts:[{findRegex:'/x/'}]});
  assert.ok(parsed.warnings.some(text=>text.includes('never run')));
  const v1=parseCardFile(Buffer.from(JSON.stringify({name:'Flat',description:'d',personality:'',scenario:'',first_mes:'hi',mes_example:''})));
  assert.equal(v1.card.spec,'chara_card_v1');assert.deepEqual(v1.warnings,[]);
});
test('parseCardFile reads PNG cards, returns the original portrait and prefers ccv3',()=>{
  const v3={...fullV2,spec:'chara_card_v3',spec_version:'3.0',data:{...fullV2.data,name:'V3 名字'}};
  const image=syntheticPng([cardChunk('chara',fullV2),cardChunk('ccv3',v3)]);
  const parsed=parseCardFile(image,{fileName:'card.json'});
  assert.equal(parsed.sourceFormat,'png');assert.equal(parsed.portrait,image);assert.equal(parsed.card.spec,'chara_card_v3');assert.equal(parsed.card.name,'V3 名字');
  assert.ok(parsed.warnings.some(text=>text.includes('.json')));
  assert.equal(parseCardFile(new Uint8Array(syntheticPng([cardChunk('chara',fullV2)]))).card.name,'合成角色');
});
test('parseCardFile rejects oversized, malformed and unsupported input',()=>{
  const invalid=(input,pattern)=>assert.throws(()=>parseCardFile(input),error=>error.code==='character_card_invalid'&&pattern.test(error.message));
  invalid(Buffer.alloc(FULL_JSON_MAX_BYTES+1,0x20),/2 MiB/);
  invalid(Buffer.concat([syntheticPng(),Buffer.alloc(16*1024*1024)]),/16 MiB/);
  invalid(Buffer.from('not json'),/JSON/);invalid(Buffer.from([0xff,0xfe,0x00]),/UTF-8/);invalid(Buffer.alloc(0),/file/);invalid('text',/file/);
  invalid(syntheticPng(),/character data/);invalid(syntheticPng([cardChunk('chara','not json')]),/embedded/);
  invalid(Buffer.from(JSON.stringify({spec:'arcade_character_v1',spec_version:'1.0',data:{name:'x'}})),/V1, V2 or V3/);
  invalid(Buffer.from(JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{description:'no name'}})),/name/);
});
test('exportCard writes V2/V3 JSON and PNG that parse back to the same card',()=>{
  const {card}=parseCardFile(Buffer.from(JSON.stringify(fullV2)));
  for(const [format,spec] of [['v2','chara_card_v2'],['v3','chara_card_v3']]) {
    const {json,png}=exportCard(card,{format});
    assert.equal(png,undefined);assert.equal(JSON.parse(json).spec,spec);
    assert.deepEqual({...parseCardFile(Buffer.from(json)).card,spec:card.spec},{...card});
    const exported=exportCard(card,{format,portraitPng:syntheticPng([cardChunk('chara',{name:'stale'})])});
    assert.equal(exported.json,undefined);
    const back=parseCardFile(exported.png,{fileName:'x.png'});
    assert.equal(back.sourceFormat,'png');assert.deepEqual({...back.card,spec:card.spec},{...card});
  }
  assert.equal(JSON.parse(exportCard(card).json).spec,'chara_card_v2');
  assert.throws(()=>exportCard(card,{format:'arcade_character_v1'}),/Unsupported export format/);
  assert.throws(()=>exportCard(card,{portraitPng:Buffer.from('not a png')}),{code:'character_card_invalid'});
  assert.throws(()=>exportCard({...card,name:''}),{code:'character_card_invalid'});
});
