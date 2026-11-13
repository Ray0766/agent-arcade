'use strict';
// Shared fixture for the imported-character tests of the App conversation: a real BotService
// and SQLite store in a temporary profile, real character / lorebook libraries in a temporary
// directory, inert channels and an injected runner. No network and no model.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BotService}=require('../src/bot/service.cjs');
const {CharacterLibrary}=require('../src/bot/character-library.cjs');
const {LorebookLibrary}=require('../src/bot/st/lorebooks.cjs');
const {RegexLibrary}=require('../src/bot/st/regex-library.cjs');
const {GroupLibrary}=require('../src/bot/st/group-library.cjs');
const {normalizeCard,normalizeCharacterBook}=require('../src/vendor/sillytavern/character-card.cjs');

const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const card=(name,data={})=>normalizeCard({spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'合成样例角色。',first_mes:'你好。',extensions:{},...data}});
const book=entries=>normalizeCharacterBook({entries:entries.map((entry,index)=>({enabled:true,insertion_order:index+1,extensions:{},...entry})),extensions:{}}).book;

function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-st-local-')),library=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-st-library-'));
  const characters=new CharacterLibrary({root:path.join(library,'characters')}),lorebooks=new LorebookLibrary({root:path.join(library,'lorebooks')}),regexes=new RegexLibrary({root:path.join(library,'regex')}),groups=new GroupLibrary({root:path.join(library,'groups')});
  // state.random drives group speaker selection (default: every roll 0).
  const calls=[],services=[],state={execute:options.execute||null,random:options.random||(()=>0)};
  const factory=()=>()=>{const run=async args=>{calls.push(args);return state.execute?state.execute(args,calls.length):{outcome:'reply_ended',text:'角色回复。'};};run.close=async()=>{};return run;};
  const rejectChannel=()=>assert.fail('The App conversation must not construct a channel client');
  const make=(extra={})=>{
    const service=new BotService({root,vault,clientFactory:rejectChannel,qqClientFactory:rejectChannel,feishuClientFactory:rejectChannel,xClientFactory:rejectChannel,messengerClientFactory:rejectChannel,
      runnerFactory:factory(),claudeProgramRunnerFactory:factory(),codexRunnerFactory:factory(),deepseekRunnerFactory:factory(),gptRunnerFactory:factory(),geminiRunnerFactory:factory(),doubaoRunnerFactory:factory(),
      ...(options.libraries===false?{}:{characterLibrary:characters,lorebookLibrary:lorebooks,regexLibrary:regexes,groupLibrary:groups,groupRandom:()=>state.random()}),...extra});
    services.push(service);return service;
  };
  const service=make();service.configure({key:'fixture-api-key'});
  t.after(async()=>{
    for(const item of services)await item.disconnect().catch(()=>{});
    for(const dir of [root,library]){const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('arcade-st-'));fs.rmSync(resolved,{recursive:true,force:true});}
  });
  const history=()=>service.localSnapshot().history;
  // Selects a library character and opens its conversation.
  const open=async(id,settings={})=>{service.stConfigure({characterId:id,...settings});await service.localStop();return service.localStart();};
  return {root,service,make,characters,lorebooks,regexes,groups,calls,state,history,open,store:()=>service.localManager().store,scope:()=>service.localConversationContext().scope};
}
module.exports={fixture,card,book,deferred,vault};
