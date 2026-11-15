'use strict';
// Actual local lifecycle/storage; synthetic encryption and inert runners only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {DesktopConversations}=require('../src/bot/desktop-conversations.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('same-provider key save retires the old reply and force admission uses only the replacement key',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-key-resume-')),entered=deferred(),finish=deferred(),factories=[],closed=[];
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const service=new BotService({root,vault,deepseekRunnerFactory:options=>{
  factories.push(options);const run=async args=>{if(factories.length===1){entered.resolve(args);return finish.promise;}return {outcome:'reply_ended',text:'Synthetic replacement reply'};};run.close=async()=>{closed.push(options.key);};return run;
 }});
 const conversations=new DesktopConversations({getSelection:()=>({accountId:'primary',service}),retire(){}});
 t.after(async()=>{finish.resolve({outcome:'cancelled'});conversations.close();await service.disconnect();const actual=fs.realpathSync(root);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));fs.rmSync(actual,{recursive:true,force:true});});
 service.configure({mode:'deepseek',key:'synthetic-original-key'});await conversations.select({accountId:'primary',kind:'local'});
 const pending=service.localReply('Synthetic pending input'),old=await entered.promise;
 service.configure({mode:'deepseek',key:'synthetic-replacement-key'});assert.equal(old.signal.aborted,true);assert.equal(service.localSnapshot().available,false);
 finish.resolve({outcome:'reply_ended',text:'STALE_REPLY_MUST_NOT_APPEAR'});assert.equal((await pending).outcome,'cancelled');
 await conversations.select({accountId:'primary',kind:'local'});
 assert.deepEqual(closed,['synthetic-original-key']);assert.equal(factories.length,2);assert.equal(factories[1].key,'synthetic-replacement-key');assert.equal(factories[1].conversationOnly,true);
 assert.equal(service.snapshot().hasKey,true);assert.equal(service.localSnapshot().available,true);assert.equal((await service.localReply('Synthetic new input')).text,'Synthetic replacement reply');
 const history=service.localSnapshot().history;assert(history.some(row=>row.text==='Synthetic replacement reply'));assert(!history.some(row=>row.text==='STALE_REPLY_MUST_NOT_APPEAR'));
 assert(!JSON.stringify(service.snapshot()).includes('synthetic-replacement-key'));
});
