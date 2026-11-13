'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {XDirectMessageClient,prepareXInbound,conversation}=require('../src/bot/x-dm.cjs');
const {Dispatcher}=require('../src/bot/dispatcher.cjs');
const {MessageJournal}=require('../src/bot/journal.cjs');
const SELF='910000000000000001',OWNER='920000000000000001',NOW=1793920000000;
const wrapped=data=>({data,rate:{remaining:null,retryAt:null}});
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}assert.fail('Fixture condition did not settle');};

test('production Dispatcher and SQLite require direct exact approval; restart and other-account dedup remain separate',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-x-draft-'));
  const target=path.join(root,'approved.txt'),denied=path.join(root,'denied.txt');
  let now=NOW,rows=[],requestId=930000000000000000n,sentId=940000000000000000n;
  const outbound=[],runs=[],decisions=[],clients=[];
  const journal=new MessageJournal({root,now:()=>now}),scope=`x:${SELF}:${OWNER}`;
  const make=()=>{
    const client=new XDirectMessageClient({accessToken:'synthetic-preauthorized-token',expectedAccountId:SELF,ownerId:OWNER,now:()=>now,
      sleep:async ms=>{now+=ms;},transportFactory:()=>({
        async me({assertCurrent}){assertCurrent();return wrapped({data:{id:SELF}});},
        async events({assertCurrent}){assertCurrent();const response=rows;rows=[];return wrapped({data:response,meta:{result_count:response.length}});},
        async sendText({text,assertCurrent}){assertCurrent();outbound.push(text);return wrapped({data:{dm_event_id:String(++sentId),dm_conversation_id:conversation(SELF,OWNER)}});},
        close(){}
      })});clients.push(client);return client;
  };
  let client=make();await client.connect();
  const dispatcher=new Dispatcher({now:()=>now,send:(text,context)=>client.sendText(OWNER,text,context),
    execute:async({prompt,request})=>{
      runs.push(prompt);const file=prompt==='deny write'?denied:target;
      const choice=await request({kind:'permission',tool:'Write',input:{file_path:file,content:'synthetic approved content'}});decisions.push(choice);
      if(choice.allow)fs.writeFileSync(file,'synthetic approved content');return {outcome:'reply_ended',text:'Synthetic completion'};
    }});
  t.after(async()=>{dispatcher.stop();for(const c of clients)c.close();await dispatcher.whenIdle();
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  async function inbound(body,extra={},specificId){
    const id=specificId||String(++requestId);
    // Events are newer than the next synthetic poll boundary; no historical
    // account content is ever loaded by this fixture.
    now=Math.max(now,client.nextPollAt);
    rows=[{id,event_type:'MessageCreate',sender_id:OWNER,dm_conversation_id:conversation(SELF,OWNER),
      text:body,created_at:new Date(now).toISOString(),...extra}];
    const batch=await client.getUpdates();
    for(const message of batch.messages){
      if(!journal.claim(scope,message.id,'api'))continue;
      const prepared=prepareXInbound(message);
      if(prepared.rejection){journal.disposition(scope,message.id,'rejected');continue;}
      const answer=await dispatcher.receive(prepared);
      journal.disposition(scope,message.id,answer.accepted?'queued':'rejected',answer.taskId||null);
    }
    return id;
  }
  const first=await inbound('write approved file');await until(()=>dispatcher.pending.size===1);
  const approval=dispatcher.snapshot().pending[0].code;
  await inbound(`/allow ${approval}`,{referenced_posts:[{id:'123'}]});
  assert.equal(fs.existsSync(target),false);assert.equal(dispatcher.pending.size,1);assert.equal(runs.length,1);
  await inbound(`/allow ${approval}`);await dispatcher.whenIdle();assert.equal(fs.readFileSync(target,'utf8'),'synthetic approved content');assert.deepEqual(decisions,[{allow:true}]);
  await inbound('deny write');await until(()=>dispatcher.pending.size===1);
  await inbound(`/deny ${dispatcher.snapshot().pending[0].code}`);await dispatcher.whenIdle();assert.equal(fs.existsSync(denied),false);assert.equal(decisions[1].allow,false);
  client.close();client=make();await client.connect();await inbound('must not run after restart',{},first);
  assert.equal(runs.length,2);assert.equal(journal.claim(scope,first,'api'),false);
  assert.equal(journal.claim(`x:910000000000000002:${OWNER}`,first,'api'),true);
  assert.equal(journal.claim(`x:${SELF}:920000000000000002`,first,'api'),true);
  assert(outbound.length>0);assert.equal(journal.snapshot().storage,'sqlite');
});
