'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');

test('private calls bind signaling to the current friend, session and accepted window',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(done=>server.close(done));
    store.db.close();
  });
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  async function account(number){
    const response=await fetch(base+'/api/v1/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName:number,password:'synthetic call fixture'})});
    assert.equal(response.status,200);
    return {number,cookie:response.headers.getSetCookie()[0].split(';')[0]};
  }
  const alice=await account('call_alice');
  const ben=await account('call_ben');
  const outsider=await account('call_other');
  const chat=store.decide(ben.number,store.request(alice.number,ben.number).id,true).conversation.id;
  const group=store.createGroup(alice.number,'Synthetic group',[ben.number]).id;
  const windowFor=({number,cookie})=>{
    const device=randomUUID();
    return async(body,{status=200,known='',expectedAccount=number}={})=>{
      const response=await fetch(base+'/api/v1/calls/'+device+(known?'?known='+known:''),{
        method:body?'POST':'GET',headers:{Cookie:cookie,'X-Social-Account':expectedAccount,'Content-Type':'application/json'},
        body:body&&JSON.stringify(body)});
      const result=await response.json();
      assert.equal(response.status,status,JSON.stringify(result));
      return result;
    };
  };
  const caller=windowFor(alice),callee=windowFor(ben),second=windowFor(ben),unrelated=windowFor(outsider);
  const page=await fetch(base+'/');
  assert.match(page.headers.get('permissions-policy'),/camera=\(self\).*display-capture=\(\)/u);
  const versionedApp=(await page.text()).match(/\/_friends\/[a-f0-9]{64}\/app\.js/u)[0];
  const moduleResponse=await fetch(base+versionedApp.replace(/app\.js$/u,'live-calls.js'));
  assert.equal(moduleResponse.status,200);
  assert.match(await moduleResponse.text(),/export function mountLiveCalls/u);

  await caller({action:'dial',kind:'audio',chat:group},{status:403});
  assert.equal((await caller(undefined,{status:409,expectedAccount:ben.number})).error.code,'call_session');
  const video=(await caller({action:'dial',kind:'video',chat})).call;
  assert.equal(video.accepted,false);
  assert.equal((await unrelated()).call,null);
  assert.equal((await callee()).call.id,video.id);
  const offer='v=0\r\ns=synthetic-offer\r\n',answer='v=0\r\ns=synthetic-answer\r\n';
  await caller({action:'signal',id:video.id,sdp:offer},{status:409});
  assert.equal((await callee({action:'accept',id:video.id})).call.accepted,true);
  assert.equal((await second()).call,null);
  await second({action:'end',id:video.id},{status:409});
  await caller({action:'signal',id:video.id,sdp:offer});
  assert.equal((await callee()).call.remote,offer);
  await callee({action:'signal',id:video.id,sdp:answer});
  assert.equal((await caller()).call.remote,answer);
  assert.equal((await caller(undefined,{known:video.id})).call.remote,undefined);

  await fetch(base+'/api/v1/logout',{method:'POST',headers:{Cookie:ben.cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await caller()).call,null);
  const audio=(await caller({action:'dial',kind:'audio',chat})).call;
  assert.equal(audio.kind,'audio');
  const membership=store.access(alice.number,chat);
  store.removeFriend(alice.number,chat,{number:ben.number,expectedAccount:alice.number,revision:membership.membershipRevision});
  assert.equal((await caller()).call,null);
  assert.equal(store.one('SELECT count(*) n FROM messages').n,0);
});