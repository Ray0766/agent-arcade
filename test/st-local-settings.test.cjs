'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const settings=require('../src/bot/st/local-settings.cjs');
const {DEFAULT_PRESET}=require('../src/bot/st/prompt-builder.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-st-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const ID='0123456789abcdef',OTHER='fedcba9876543210';

test('defaults are valid, complete and stable under validation',()=>{
  const base=settings.defaults();
  assert.deepEqual(Object.keys(base),['version','characterId','builtinPersonaId','greeting','user','lorebookIds','useCharacterBook','authorsNote','preset','sampling','contextChars','worldInfo','regex','streaming','branchId','groupId','wikiAccess']);
  assert.deepEqual({...base,preset:null},{version:1,characterId:null,builtinPersonaId:null,greeting:0,user:{name:'你',description:''},lorebookIds:[],useCharacterBook:true,authorsNote:{text:'',depth:4,role:'system'},preset:null,
    sampling:{temperature:null,topP:null,maxTokens:null},contextChars:24000,worldInfo:{budgetChars:6000,scanDepth:2,recursive:true},regex:{enabled:true},streaming:true,branchId:null,groupId:null,wikiAccess:{}});
  assert.equal(base.preset.mainPrompt,DEFAULT_PRESET.mainPrompt);assert.deepEqual(base.preset.order,[...DEFAULT_PRESET.order]);assert.equal(base.preset.sections.enhanceDefinitions.enabled,false);
  assert.deepEqual(settings.validate(base),base);assert.deepEqual(settings.validate({}),base);
  assert.deepEqual(settings.validate(JSON.parse(JSON.stringify(base))),base);
});

test('strict validation rejects unknown keys, wrong types and out-of-range values',()=>{
  const bad=[null,[],'x',{extra:1},{version:2},{characterId:'abc'},{characterId:ID.toUpperCase()},{characterId:5},{greeting:-1},{greeting:101},{greeting:1.5},
    {user:{name:''}},{user:{name:' x'}},{user:{name:'名'.repeat(41)}},{user:{name:'a\nb'}},{user:{description:'述'.repeat(2001)}},{user:{nickname:'x'}},{user:'Ray'},
    {lorebookIds:[ID,ID]},{lorebookIds:['nope']},{lorebookIds:Array.from({length:11},(_,i)=>String(i).padStart(16,'0'))},{lorebookIds:ID},
    {useCharacterBook:'yes'},{authorsNote:{text:'x'.repeat(2001)}},{authorsNote:{depth:-1}},{authorsNote:{depth:101}},{authorsNote:{role:'tool'}},{authorsNote:{text:'a\x00b'}},{authorsNote:{position:1}},
    {preset:{unknown:true}},{preset:'default'},{preset:{mainPrompt:'x'.repeat(8001)}},{preset:{order:['nope']}},
    {sampling:{temperature:3}},{sampling:{topP:-0.1}},{sampling:{maxTokens:10}},{sampling:{maxTokens:100.5}},{sampling:{seed:1}},{sampling:{temperature:'0.5'}},
    {contextChars:3999},{contextChars:24001},{contextChars:8000.5},{worldInfo:{budgetChars:499}},{worldInfo:{budgetChars:12001}},{worldInfo:{scanDepth:0}},{worldInfo:{scanDepth:21}},{worldInfo:{recursive:1}},{worldInfo:{depth:2}}];
  for(const value of bad)assert.throws(()=>settings.validate(value),{code:'st_settings_invalid'},JSON.stringify(value)?.slice(0,80));
  const full=settings.validate({characterId:ID,greeting:3,user:{name:'Ray',description:'多行\n描述'},lorebookIds:[ID,OTHER],useCharacterBook:false,authorsNote:{text:'note',depth:0,role:'assistant'},
    preset:{name:'Mine',mainPrompt:'MAIN',postHistory:'POST',preferCardSystemPrompt:false,sampling:{temperature:1}},sampling:{temperature:0,topP:1,maxTokens:8192},contextChars:4000,worldInfo:{budgetChars:500,scanDepth:20,recursive:false}});
  assert.equal(full.characterId,ID);assert.equal(full.preset.name,'Mine');assert.equal(full.preset.preferCardSystemPrompt,false);assert.equal(full.preset.sampling.temperature,1);assert.deepEqual(full.sampling,{temperature:0,topP:1,maxTokens:8192});
  assert.deepEqual(settings.validate(full),full);
});

test('patch merges nested sections, replaces lists and preset, and validates the merged result',()=>{
  const base=settings.defaults();
  const one=settings.patch(base,{authorsNote:{text:'remember the rain'},user:{name:'Ray'},sampling:{temperature:0.8}});
  assert.deepEqual(one.authorsNote,{text:'remember the rain',depth:4,role:'system'});assert.deepEqual(one.user,{name:'Ray',description:''});assert.deepEqual(one.sampling,{temperature:0.8,topP:null,maxTokens:null});
  const two=settings.patch(one,{authorsNote:{depth:2},lorebookIds:[ID],characterId:OTHER,preset:{name:'Short',mainPrompt:'M'},sampling:{temperature:null}});
  assert.deepEqual(two.authorsNote,{text:'remember the rain',depth:2,role:'system'});assert.deepEqual(two.lorebookIds,[ID]);assert.equal(two.characterId,OTHER);assert.equal(two.preset.mainPrompt,'M');assert.equal(two.sampling.temperature,null);
  assert.equal(two.user.name,'Ray');
  for(const partial of [null,{nope:1},{authorsNote:{depth:500}},{user:{name:''}},{worldInfo:{scanDepth:99}},{authorsNote:{unknown:1}}])assert.throws(()=>settings.patch(two,partial),{code:'st_settings_invalid'});
  assert.deepEqual(base,settings.defaults());
});

test('load is tolerant, save is strict and atomic',t=>{
  const dir=temp(t),file=path.join(dir,'nested','st-settings.json');
  assert.deepEqual(settings.load(file),{settings:settings.defaults(),problem:null});
  const stored=settings.save(file,settings.patch(settings.defaults(),{characterId:ID,contextChars:9000}));
  assert.equal(stored.characterId,ID);assert.deepEqual(settings.load(file),{settings:stored,problem:null});
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['st-settings.json']);
  assert.throws(()=>settings.save(file,{contextChars:1}),{code:'st_settings_invalid'});assert.deepEqual(settings.load(file).settings,stored);
  for(const text of ['{not json','[]',JSON.stringify({...stored,extra:true}),JSON.stringify({...stored,version:9}),' '.repeat(200001)]){
    fs.writeFileSync(file,text);assert.deepEqual(settings.load(file),{settings:settings.defaults(),problem:'invalid'});
  }
  fs.rmSync(file);fs.mkdirSync(file);assert.equal(settings.load(file).problem,'invalid');
});
