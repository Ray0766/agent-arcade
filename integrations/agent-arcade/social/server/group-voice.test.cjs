'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {once}=require('node:events');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {createGroupVoice}=require('./group-voice.cjs');

const people=[['lin_xiao','林晓'],['zhou_ning','周宁'],['chen_yu','陈屿']];
const description=label=>'v=0\r\ns='+label+'\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
function makeGroup(store){
  for(const [number] of people.slice(1))
    store.decide(number,store.request('lin_xiao',number).id,true);
  return store.createGroup('lin_xiao','周日河边小队',['zhou_ning','chen_yu']).id;
}

async function httpGroup(t){
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.db.close();});
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  let requests=0,chat;
  function windowFor(number){
    const device=randomUUID(),joinId=randomUUID();
    let cookie;
    async function api(path,body,status=200,expected=number){
      const res=await fetch(base+path,{method:body?'POST':'GET',headers:{
        'Content-Type':'application/json','X-Social-Account':expected,...(cookie&&{Cookie:cookie})
      },body:JSON.stringify(body)});
      requests++;
      const set=res.headers.get('set-cookie');
      if(set)cookie=set.split(';')[0];
      if(res.headers.get('content-type')==='image/png'){
        assert.equal(res.status,status);
        assert.equal(res.headers.get('cache-control'),'no-store');
        return Buffer.from(await res.arrayBuffer());
      }
      const result=await res.json();
      assert.equal(res.status,status,path+' '+JSON.stringify(result));
      return result;
    }
    const path=()=>'/conversations/'+chat+'/group-voice/'+device;
    const w={number,api,device,joinId,
      get:(extra={},status=200,account)=>api(path()+'?'+new URLSearchParams({revision:w.revision,...extra}),undefined,status,account),
      post:(action,extra={},status=200)=>api(path(),{action,revision:w.revision,...extra},status),
      joined:()=>({roomId:w.roomId,self:w.self}),
      async join(attempt=joinId,video){
        const {room}=await w.post('join',{joinId:attempt,video});
        w.self=room.self;
        w.roomId=room.id;
        return room;
      }};
    return w;
  }
  const users=people.map(([number])=>windowFor(number));
  const [lin,zhou,chen]=users,other=windowFor('guest_he');
  const password='group voice fixture';
  for(const [i,w] of [...users,other].entries())
    await w.api('/register',{number:w.number,displayName:people[i]?.[1]||'何雨',password});
  chat=makeGroup(store);
  for(const w of users)w.revision=store.access(w.number,chat).membershipRevision;
  return {store,chat,lin,zhou,chen,other,windowFor,password,requests:()=>requests};
}

test('three real HTTP sessions share one room, with private pairwise signaling, departure and account switching',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.db.close();});
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  let requests=0,chat;
  function windowFor(number){
    const device=randomUUID(),joinId=randomUUID();
    let cookie;
    async function api(path,body,status=200,expected=number){
      const res=await fetch(base+path,{method:body?'POST':'GET',headers:{
        'Content-Type':'application/json','X-Social-Account':expected,...(cookie&&{Cookie:cookie})
      },body:JSON.stringify(body)});
      requests++;
      const set=res.headers.get('set-cookie');
      if(set)cookie=set.split(';')[0];
      const result=await res.json();
      assert.equal(res.status,status,path+' '+JSON.stringify(result));
      return result;
    }
    const path=()=>'/conversations/'+chat+'/group-voice/'+device;
    const w={number,api,device,joinId,
      get:(extra={},status=200,account)=>api(path()+'?'+new URLSearchParams({revision:w.revision,...extra}),undefined,status,account),
      post:(action,extra={},status=200)=>api(path(),{action,revision:w.revision,...extra},status),
      joined:()=>({roomId:w.roomId,self:w.self}),
      async join(attempt=joinId){
        const {room}=await w.post('join',{joinId:attempt});
        w.self=room.self;
        w.roomId=room.id;
        return room;
      }};
    return w;
  }
  const users=people.map(([number])=>windowFor(number));
  const [lin,zhou,chen]=users,other=windowFor('guest_he');
  const password='group voice fixture';
  for(const [i,w] of [...users,other].entries())
    await w.api('/register',{number:w.number,displayName:people[i]?.[1]||'何雨',password});
  chat=makeGroup(store);
  for(const w of users)w.revision=store.access(w.number,chat).membershipRevision;
  await other.get({},404);
  const writes=()=>store.one('SELECT total_changes() AS n').n;
  const before=writes();
  assert.deepEqual(await lin.get(),{room:null});
  const [lr,zr]=await Promise.all([lin.join(),zhou.join()]);
  assert.equal(lr.id,zr.id);
  assert.equal((await lin.join()).self,lr.self);
  const discovery=(await chen.get()).room;
  assert.equal(discovery.self,null);
  assert.equal(discovery.signals,undefined);
  assert.equal(discovery.participants.length,2);
  const signal=(from,to,type,sdp,status=200)=>from.post('signal',{...from.joined(),to:to.self,type,sdp},status);
  const offer=description('lin-to-zhou');
  await signal(lin,zhou,'offer',offer);
  await signal(lin,zhou,'offer',offer);
  assert.deepEqual((await zhou.get(zhou.joined())).room.signals,[{from:lin.self,type:'offer',sdp:offer}]);
  await chen.get(zhou.joined(),409);
  await chen.post('ice',zhou.joined(),409);
  const withThree=await chen.join();
  assert.equal(withThree.id,lr.id);
  assert.equal(withThree.participants.length,3);
  assert.deepEqual(withThree.signals,[]);
  for(const peer of [lin,zhou]){
    await signal(chen,peer,'offer',description('chen-to-'+peer.number));
    await signal(peer,chen,'answer',description(peer.number+'-to-chen'));
  }
  await signal(zhou,lin,'answer',description('zhou-to-lin'));
  await signal(lin,zhou,'offer',offer+'m=video 9 RTP/AVP 96\r\n',409);
  const intact=(await lin.get(lin.joined())).room.signals.find(s=>s.from===zhou.self);
  assert.equal(intact.sdp,description('zhou-to-lin'));
  assert.deepEqual(await chen.post('ice',chen.joined()),{iceServers:[]});
  assert.equal(writes(),before,'discovery, joins and all six SDP directions do not write to SQLite');

  const old=chen.joined();
  await chen.post('leave',old);
  assert.deepEqual((await lin.get(lin.joined())).room.signals,[intact]);
  await signal(lin,chen,'answer',description('late'),409);
  await chen.post('join',{joinId:chen.joinId},409);
  assert.notEqual((await chen.join(randomUUID())).self,old.self);
  await chen.post('leave',old,409);
  assert.deepEqual((await chen.get(chen.joined())).room.signals,[]);
  store.remove('chen_yu',chat,'chen_yu',true);
  await chen.get(chen.joined(),404);
  assert.equal((await lin.get(lin.joined())).room.participants.length,2);
  store.addMembers('lin_xiao',chat,['chen_yu']);
  await chen.get(chen.joined(),409);
  chen.revision=store.access(chen.number,chat).membershipRevision;
  await chen.get(chen.joined(),409);
  await chen.join(randomUUID());

  const second=windowFor(zhou.number);
  await second.api('/login',{number:zhou.number,password});
  second.revision=zhou.revision;
  await second.get(zhou.joined(),409);
  await second.post('join',{joinId:second.joinId},409);
  const direct=store.direct(lin.number,zhou.number).id;
  await second.api('/calls/'+second.device,{action:'dial',chat:direct,kind:'audio'},409);
  await chen.api('/login',{number:other.number,password});
  await chen.get(chen.joined(),409);
  await chen.get(chen.joined(),404,other.number);
  assert.deepEqual((await lin.get(lin.joined())).room.signals,[intact]);
  await zhou.api('/logout',{});
  assert.equal((await lin.get(lin.joined())).room.participants.length,1);
  await lin.post('leave',lin.joined());
  assert.deepEqual(await lin.get(),{room:null});
  const privateCall=(await second.api('/calls/'+second.device,{action:'dial',chat:direct,kind:'audio'})).call;
  await lin.post('join',{joinId:randomUUID()},409);
  await second.api('/calls/'+second.device,{action:'end',id:privateCall.id});
  t.diagnostic(requests+' isolated HTTP requests; 3 peers, 3 pairs, 6 targeted descriptions');
});

test('shared group photo is scoped to the original message and the current seats',async t=>{
  const {store,chat,lin,zhou,chen,other,requests}=await httpGroup(t);
  const direct=store.direct(lin.number,zhou.number).id;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=','base64');
  const image={mime:'image/png',width:1,height:1,bytes,digest:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};
  const caption='';
  function fillUntil(id){
    while(store.one('SELECT coalesce(max(id),0) AS id FROM messages').id<id)
      store.send(lin.number,direct,{clientId:randomUUID(),text:'散步路线记录'});
  }
  fillUntil(21);
  assert.equal(store.sendImage(lin.number,direct,randomUUID(),image,caption).id,22);
  fillUntil(92);
  assert.equal(store.sendImage(lin.number,chat,randomUUID(),image,caption).id,93);
  const count=()=>store.one('SELECT count(*) AS n FROM messages WHERE chat=?',chat).n,before=count();
  const share=(who,id,status=200)=>who.post('share-photo',{...who.joined(),messageId:id},status);
  const stop=(who,status=200)=>who.post('stop-photo',{...who.joined(),messageId:93},status);
  const projected=async who=>(await who.get(who.joined())).room.sharedPhoto;
  const read=(who,status=200,from=lin.self,messageId=93)=>who.api('/conversations/'+chat+'/group-voice/'+who.device+
    '/photo?'+new URLSearchParams({revision:who.revision,...who.joined(),from,messageId}),undefined,status);
  await lin.join();
  await zhou.join();
  await share(lin,22,404);
  await share(lin,93);
  await share(lin,93);
  await share(zhou,93,409);
  await stop(zhou,409);
  assert.equal((await chen.get()).room.sharedPhoto,undefined);
  await read(chen,409);
  await read(other,404);
  await chen.join();
  for(const viewer of [zhou,chen]){
    assert.deepEqual(await projected(viewer),{from:lin.self,messageId:93,width:1,height:1,caption});
    assert.deepEqual(await read(viewer),bytes);
  }
  await read(zhou,404,lin.self,22);
  await stop(lin);
  await stop(lin);
  assert.equal(await projected(zhou),undefined);
  await read(zhou,404);
  await share(lin,93);
  const previous=lin.self;
  await lin.post('leave',lin.joined());
  await read(zhou,404,previous);
  await lin.join(randomUUID());
  await share(lin,93);
  await read(zhou,404,previous);
  store.remove(chen.number,chat,chen.number,true);
  await read(chen,404);
  store.addMembers(lin.number,chat,[chen.number]);
  chen.revision=store.access(chen.number,chat).membershipRevision;
  await chen.join(randomUUID());
  assert.equal(await projected(chen),undefined);
  await read(chen,404);
  await share(chen,93,404);
  assert.deepEqual(await read(zhou),bytes);
  store.run('UPDATE messages SET removed=1 WHERE id=93');
  assert.equal(await projected(zhou),undefined);
  await read(lin,404);
  assert.equal(count(),before);
  t.diagnostic(requests()+' isolated HTTP requests; private #22 and group #93 have identical bytes; zero new group messages');
});

test('lease expiry, revoked membership, group size and session validity are checked before peer delivery',t=>{
  let time=Date.now();
  const store=new SocialStore(':memory:'),voice=createGroupVoice(store,()=>false,()=>time);
  t.after(()=>{voice.close();store.db.close();});
  for(const [number,name] of people)store.register(number,name,'human','test');
  const chat=makeGroup(store);
  function connect(number){
    const session=randomUUID(),device=randomUUID();
    store.run('INSERT INTO sessions VALUES(?,?,?)',session,number,time+1_000_000);
    const revision=store.access(number,chat).membershipRevision;
    return {session,run:(action,fields)=>voice.handle(number,session,chat,device,{action,revision,...fields})};
  }
  const [a,b,c]=people.map(([number])=>connect(number));
  const join=w=>{const {room}=w.run('join',{joinId:randomUUID()});return {self:room.self,roomId:room.id};};
  const x=join(a),y=join(b),z=join(c);
  time+=30_000;
  a.run('poll',x);
  b.run('poll',y);
  time+=16_000;
  assert.throws(()=>c.run('poll',z),{code:'group_voice_ended'});
  assert.equal(a.run('poll',x).room.participants.length,2);
  assert.notEqual(join(c).self,z.self);
  store.run('DELETE FROM sessions WHERE digest=?',c.session);
  assert.equal(a.run('poll',x).room.participants.length,2);
  store.remove('chen_yu',chat,'chen_yu',true);
  store.register('ai_extra','小星','ai',null);
  store.run('INSERT INTO members VALUES(?,?,0)',chat,'ai_extra');
  assert.throws(()=>a.run('poll',x),{code:'group_voice_unavailable'});
  store.run('DELETE FROM members WHERE chat=? AND account=?',chat,'ai_extra');
  store.addMembers('lin_xiao',chat,['chen_yu']);
  assert.deepEqual(a.run('poll'),{room:null});
  store.register('guest_he','何雨','human','test');
  store.run('INSERT INTO members VALUES(?,?,0)',chat,'guest_he');
  assert.throws(()=>join(a),{code:'group_voice_unavailable'});
});
