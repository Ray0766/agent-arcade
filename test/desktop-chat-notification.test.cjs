'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DesktopChat}=require('../src/bot/desktop-chat.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
function fixture({kind='local',reply=async()=>({outcome:'reply_ended'}),onReply}={}){
 const events=[],context={kind,accountId:'profile-a',character:'ju',generation:1,scope:'private-scope',service:{localReply:reply,socialReply:reply},dispatcher:{},settings:'settings'},state={context};
 const chat=new DesktopChat({getContext:()=>state.context,onReply:event=>{events.push(event);return onReply?.(event);}}),open=()=>chat.open({accountId:state.context.accountId,contextId:chat.snapshot().contextId,panelId:'panel'}),session=open();
 return {chat,events,state,context,session,open,send:(id='renderer-id')=>chat.send({...session,requestId:id,text:'PRIVATE_PROMPT'})};
}
test('only a current completed App turn mints an opaque one-use notice, with no text or renderer nonce',async()=>{
 const f=fixture();assert.equal((await f.send()).outcome,'reply_ended');assert.equal(f.events.length,1);const event=f.events[0];assert(Object.isFrozen(event));assert.notEqual(event.id,'renderer-id');assert.deepEqual(Object.keys(event).sort(),['accountId','character','completedAt','contextId','id','sourceKind']);assert(!JSON.stringify(event).includes('PRIVATE_PROMPT'));assert.equal(f.chat.claimReplyNotice({...event}),false);assert.equal(f.chat.claimReplyNotice(event),true);assert.equal(f.chat.claimReplyNotice(event),false);await assert.rejects(f.send(),{code:'duplicate'});assert.equal(f.events.length,1);
});
test('channel, failed, cancelled and changed-scope turns never announce an App reply',async()=>{
 const channel=fixture({kind:'channel'});await channel.send();assert.equal(channel.events.length,0);
 const failed=fixture({reply:async()=>({outcome:'error'})});await assert.rejects(failed.send(),{code:'reply_failed'});assert.equal(failed.events.length,0);
 for(const operation of ['cancel','scope','close']){const gate=deferred(),f=fixture({reply:()=>gate.promise}),pending=f.send();await turn();if(operation==='cancel')f.chat.cancel({...f.session,requestId:'renderer-id'});if(operation==='scope'){f.state.context={...f.context,generation:2};f.chat.observe();}if(operation==='close')f.chat.close(f.session);gate.resolve({outcome:'reply_ended'});assert.equal((await pending).outcome,'cancelled');assert.equal(f.events.length,0,operation);}
});
test('new send admission or a new panel invalidates an old unclaimed completion notice',async()=>{
 const f=fixture();await f.send();const old=f.events[0],gate=deferred();f.context.service.localReply=()=>gate.promise;const pending=f.send('second');assert.equal(f.chat.claimReplyNotice(old),false);gate.resolve({outcome:'reply_ended'});await pending;const fresh=f.events[1];f.open();assert.equal(f.chat.claimReplyNotice(fresh),false);
});
test('optional notification sync or async failure never turns the completed reply into an error',async()=>{
 for(const onReply of [()=>{throw Error('synthetic OS failure');},async()=>{throw Error('synthetic asynchronous OS failure');}]){const f=fixture({onReply});assert.equal((await f.send()).outcome,'reply_ended');await turn();assert.equal(f.events.length,1);}
});
