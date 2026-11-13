'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePreset,importSillyTavernPreset,LIMITS}=require('../src/bot/st/presets.cjs');
const {SECTION_IDS,DEFAULT_PRESET,buildPrompt}=require('../src/bot/st/prompt-builder.cjs');

test('an empty preset normalizes to the defaults and is frozen',()=>{
  const preset=validatePreset({});
  assert.deepEqual(preset,{name:'Default',order:[...SECTION_IDS],sections:Object.fromEntries(SECTION_IDS.map(id=>[id,{enabled:id!=='enhanceDefinitions'}])),
    mainPrompt:DEFAULT_PRESET.mainPrompt,postHistory:'',preferCardSystemPrompt:true,preferCardPostHistory:true,sampling:{temperature:null,topP:null,maxTokens:null}});
  for(const value of [preset,preset.order,preset.sections,preset.sections.main,preset.sampling]) assert.ok(Object.isFrozen(value));
  assert.deepEqual(validatePreset(JSON.parse(JSON.stringify(preset))),preset);
});
test('a full preset is kept; missing order ids are inserted at their default position',()=>{
  const preset=validatePreset({name:'  Cosy  ',order:['chatHistory','jailbreak','main'],sections:{enhanceDefinitions:{enabled:true},scenario:{enabled:false},main:{enabled:false}},mainPrompt:'Main\nprompt',postHistory:'',
    preferCardSystemPrompt:false,preferCardPostHistory:false,sampling:{temperature:0.7,topP:1,maxTokens:1024}});
  assert.equal(preset.name,'Cosy');assert.deepEqual(preset.order.slice(-4),['dialogueExamples','chatHistory','jailbreak','main']);assert.equal(preset.order.length,SECTION_IDS.length);
  assert.equal(preset.sections.enhanceDefinitions.enabled,true);assert.equal(preset.sections.scenario.enabled,false);assert.equal(preset.sections.main.enabled,true);
  assert.equal(preset.mainPrompt,'Main\nprompt');assert.equal(preset.preferCardSystemPrompt,false);assert.deepEqual(preset.sampling,{temperature:0.7,topP:1,maxTokens:1024});
  assert.deepEqual(validatePreset({sampling:{temperature:null}}).sampling,{temperature:null,topP:null,maxTokens:null});
  // A validated preset is accepted by the prompt builder as is.
  assert.ok(buildPrompt({card:{name:'Mira'},preset,policy:{system:'P'}}).system.startsWith('P\n\n'));
});
test('strict validation rejects unknown keys, wrong types and out-of-range values',()=>{
  const invalid=value=>assert.throws(()=>validatePreset(value),{code:'preset_invalid'},JSON.stringify(value)?.slice(0,80));
  invalid(null);invalid([]);invalid('x');invalid({extra:1});invalid({tools:['Write']});invalid({name:''});invalid({name:5});invalid({name:'n'.repeat(LIMITS.name+1)});
  invalid({order:'main'});invalid({order:['main','nope']});invalid({order:['main','main']});invalid({order:[5]});invalid({order:Array(LIMITS.order+1).fill('main')});
  invalid({sections:[]});invalid({sections:{nope:{enabled:true}}});invalid({sections:{main:true}});invalid({sections:{main:{enabled:'yes'}}});invalid({sections:{main:{enabled:true,content:'x'}}});
  invalid({mainPrompt:5});invalid({mainPrompt:'m'.repeat(LIMITS.prompt+1)});invalid({postHistory:'p'.repeat(LIMITS.prompt+1)});invalid({mainPrompt:'nul\u0000'});
  invalid({preferCardSystemPrompt:'no'});invalid({preferCardPostHistory:1});
  invalid({sampling:[]});invalid({sampling:{seed:1}});invalid({sampling:{temperature:2.1}});invalid({sampling:{temperature:-0.1}});invalid({sampling:{topP:1.5}});invalid({sampling:{topP:'1'}});
  invalid({sampling:{maxTokens:63}});invalid({sampling:{maxTokens:8193}});invalid({sampling:{maxTokens:100.5}});invalid({sampling:{temperature:NaN}});
  assert.equal(validatePreset({mainPrompt:'m'.repeat(LIMITS.prompt)}).mainPrompt.length,LIMITS.prompt);
});
test('a SillyTavern chat-completion preset is mapped; the rest is ignored with a warning',()=>{
  const source={temperature:0.9,top_p:0.95,openai_max_tokens:600,openai_max_context:200000,frequency_penalty:0.2,stream_openai:true,wi_format:'{0}',names_behavior:0,
    prompts:[{identifier:'main',name:'Main Prompt',role:'system',content:'Write {{char}}\'s reply to {{user}} ({{charIfNotGroup}}).',system_prompt:true},
      {identifier:'jailbreak',content:'Stay in character.',forbid_overrides:true},{identifier:'nsfw',content:'aux text'},{identifier:'custom-1234',content:'custom prompt'},
      {identifier:'chatHistory',marker:true},'junk'],
    prompt_order:[{character_id:100000,order:[{identifier:'main',enabled:true}]},
      {character_id:100001,order:[{identifier:'main',enabled:true},{identifier:'charDescription',enabled:true},{identifier:'custom-1234',enabled:true},{identifier:'scenario',enabled:false},
        {identifier:'chatHistory',enabled:true},{identifier:'jailbreak',enabled:true},{identifier:'main',enabled:false}]}]};
  const {preset,warnings}=importSillyTavernPreset(JSON.stringify(source),{name:'my preset.json'});
  assert.equal(preset.name,'my preset.json');assert.equal(preset.mainPrompt,'Write {{char}}\'s reply to {{user}} ({{char}}).');assert.equal(preset.postHistory,'Stay in character.');
  assert.equal(preset.preferCardSystemPrompt,true);assert.equal(preset.preferCardPostHistory,false);
  assert.deepEqual(preset.order.filter(id=>['main','charDescription','scenario','chatHistory','jailbreak'].includes(id)),['main','charDescription','scenario','chatHistory','jailbreak']);
  assert.equal(preset.order.length,SECTION_IDS.length);assert.equal(preset.sections.scenario.enabled,false);assert.equal(preset.sections.main.enabled,true);
  assert.deepEqual(preset.sampling,{temperature:0.9,topP:0.95,maxTokens:600});
  assert.ok(warnings.some(text=>text.includes('2 custom or auxiliary prompt')));assert.ok(warnings.some(text=>text.includes('custom-1234')&&text.includes('prompt order')));
  const ignored=warnings.find(text=>text.includes('other setting'));
  assert.ok(ignored.includes('Ignored 5 other')&&ignored.includes('openai_max_context')&&ignored.includes('names_behavior'));
  assert.ok(Object.isFrozen(preset));
});
test('preset import bounds: size, sampling ranges, long text, long key lists, odd shapes',()=>{
  const invalid=value=>assert.throws(()=>importSillyTavernPreset(value),{code:'preset_invalid'});
  invalid('{not json');invalid('[]');invalid(5);invalid('"text"');invalid(' '.repeat(LIMITS.jsonBytes+1));invalid(Buffer.alloc(LIMITS.jsonBytes+1,0x20));invalid(Buffer.from([0xff,0xfe,0xfd]));
  const {preset,warnings}=importSillyTavernPreset(Buffer.from('﻿'+JSON.stringify({temperature:5,top_p:'x',openai_max_tokens:20000.4,prompts:[{identifier:'main',content:'m'.repeat(LIMITS.prompt+10)+'\u0000'}],prompt_order:'bad',
    ...Object.fromEntries(Array.from({length:60},(_, index)=>['setting <'+index+'>',index]))})));
  assert.equal(preset.name,'Imported preset');assert.equal(preset.mainPrompt.length,LIMITS.prompt);assert.deepEqual(preset.sampling,{temperature:2,topP:null,maxTokens:8192});
  assert.deepEqual(preset.order,[...SECTION_IDS]);
  for(const part of ['Shortened the main prompt','Adjusted temperature to 2','Ignored top_p','Adjusted openai_max_tokens to 8192']) assert.ok(warnings.some(text=>text.includes(part)),part);
  const ignored=warnings.find(text=>text.includes('other setting'));
  assert.ok(ignored.includes('Ignored 60 other')&&ignored.endsWith(', ....')&&ignored.split(', ').length===LIMITS.ignoredKeys+1&&!ignored.includes('<'));
  // A flat prompt_order list and an empty file are accepted too.
  assert.deepEqual(importSillyTavernPreset(JSON.stringify({prompt_order:[{identifier:'chatHistory',enabled:true},{identifier:'main',enabled:true}]})).preset.order.slice(-3),['chatHistory','main','jailbreak']);
  assert.deepEqual(importSillyTavernPreset('{}'),{preset:validatePreset({name:'Imported preset'}),warnings:[]});
});
