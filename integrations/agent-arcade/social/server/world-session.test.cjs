'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {SocialStore}=require('./store.cjs');
const {planetPublishers}=require('./bothouse/planet-residents.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

test('world tickets bind the current session, audience and durable Friends instance',t=>{
  const store=new SocialStore(':memory:');
  const origin='https://world.example', account='harbour';
  const session='synthetic-session';
  const start=()=>planetPublishers({store,socialOrigin:()=>'https://friends.example',
    env:{LITTLE_WORLDS_ORIGIN:origin}});
  const body={expectedAccount:account,worldOrigin:origin};
  const first=start();
  try{
    store.register(account,'Harbour','human','synthetic');
    store.run('INSERT INTO sessions VALUES(?,?,?)',session,account,Date.now()+120000);
    assert.throws(()=>first.issueTicket(account,session,{...body,expectedAccount:'another'}));
    assert.throws(()=>first.issueTicket(account,session,{...body,worldOrigin:'https://other.example'}));
    const mint=()=>first.issueTicket(account,session,body).ticket;
    const redeem=ticket=>first.redeemTicket({ticket,worldOrigin:origin});
    const ticket=mint();
    assert.throws(()=>first.redeemTicket({ticket,worldOrigin:'https://other.example'}));
    const record=redeem(ticket);
    assert.equal(record.account,account);assert.equal(record.legacy,null);
    assert.match(record.instanceId,/^[\da-f-]{36}$/);assert.throws(()=>redeem(ticket));
    const second=start();
    try{
      const another=second.issueTicket(account,session,body);
      assert.equal(second.redeemTicket({...another,worldOrigin:origin}).instanceId,record.instanceId);
      const expired=mint(), now=Date.now();
      const advance=t.mock.method(Date,'now',()=>now+60001);
      assert.throws(()=>redeem(expired));
      advance.mock.restore();
      const original=mint();
      store.run('DELETE FROM sessions WHERE digest=?',session);
      assert.throws(()=>redeem(original));
    }finally{second.close();}
  }finally{first.close();store.db.close();}
});

test('a confirmed publisher survives missing samples and revalidates its original grant',{timeout:15000},async t=>{
  const store=new SocialStore(':memory:');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'friends-resident-test-'));
  const config=path.join(root,'fixture.json'),samplesFile=path.join(root,'fixture.jsonl');
  const sampleState=(activity,empty_snapshot=false)=>fs.writeFileSync(config,JSON.stringify({activity,empty_snapshot}));
  sampleState('working');
  const samples=()=>fs.readFileSync(samplesFile,'utf8').trim().split('\n').map(JSON.parse);
  const account='harbour',session='fixture-session',token='a'.repeat(64);
  const number='bh_'+'1'.repeat(21),sourceId='12345678-1234-1234-1234-123456789abc';
  const planet='p-'+sourceId,world='https://world.example',issuer='https://friends.example';
  store.register(account,'Harbour','human','synthetic');
  let now=Date.now(),directory={contacts:[{number,source:'bothouse'}],directoryStatus:'ready'};
  store.run('INSERT INTO sessions VALUES(?,?,?)',session,account,now+86400000);
  t.mock.method(Date,'now',()=>now);
  let next,workerTimeout,checks=0,pauses=0,checkStatus=200,afterList;
  const timeout=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{
    if(ms===30000)workerTimeout=fn;
    if(ms!==6000)return timeout(fn,ms,...args);
    next=fn;
    return {unref(){}};
  });
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer '+token);
    if(url===world+'/api/resident-feed/pause'){pauses++;return Response.json({ok:true});}
    assert.equal(url,world+'/api/resident-feed/check');
    assert.deepEqual(JSON.parse(options.body),{account,socialOrigin:issuer,sourceId});
    checks++;
    return Response.json({ok:checkStatus===200,planetId:planet},{status:checkStatus});
  });
  const service=planetPublishers({store,socialOrigin:()=>issuer,
    bothouse:{list:async()=>{await afterList?.();return directory;}},
    env:{...process.env,LITTLE_WORLDS_ORIGIN:world,SOCIAL_BOTHOUSE_CONNECTION:config,
      SOCIAL_LITTLE_WORLDS_PUBLISHER:path.resolve(__dirname,'../../test/bothouse/resident-sampler.py')}});
  t.after(()=>{service.close();store.db.close();fs.rmSync(root,{recursive:true,force:true});});
  const change={action:'connect',expectedAccount:account,sourceId,token,worldOrigin:world};
  const saved=()=>store.one('SELECT * FROM world_resident_publishers WHERE account=?',account);
  async function tick(){const fn=next;next=null;assert.ok(fn,'recovery is still scheduled');await fn();}
  await service.change(account,session,change);
  const original=saved();
  assert.deepEqual(samples().at(-1),[{id:number,activity:'working'}]);
  // A saturated directory adapter returns offline. A slow CPU turn can exceed
  // both world freshness and the earlier 60 s recovery window.
  now+=75000;
  directory={contacts:[],directoryStatus:'offline'};
  await tick();
  assert.deepEqual(saved(),original,'a missing sample must not erase the persisted publisher');
  assert.equal(service.view(account).active,false);
  assert.equal(pauses,0);
  assert.equal(samples().length,1,'directory uncertainty must not publish an empty roster');
  directory={contacts:[],directoryStatus:'empty',directoryReason:'no_roles'};
  await tick();
  assert.deepEqual(saved(),original);
  directory={contacts:[{number,source:'bothouse'}],directoryStatus:'ready'};
  sampleState('idle',true);await tick();
  assert.deepEqual(saved(),original,'a missing world snapshot is not loss of a directory grant');
  sampleState('idle');await tick();
  assert.deepEqual(samples().at(-1),[{id:number,activity:'idle'}]);
  assert.ok(service.view(account).active);
  assert.ok(checks>1);
  assert.equal(pauses,0);

  // An actual subprocess is waiting for its directory. Fire its production
  // deadline, then deliver the old async result after the process has exited.
  const waiting=Promise.withResolvers(),release=Promise.withResolvers();
  afterList=()=>{waiting.resolve();return release.promise;};
  const slow=tick();
  await waiting.promise;
  workerTimeout();
  await slow;
  release.resolve();afterList=null;
  assert.deepEqual(saved(),original);
  assert.equal(service.view(account).active,false);
  const before=samples().length;
  assert.equal((await service.change(account,session,change)).active,false);
  assert.equal(samples().length,before,'a concurrent connect for the same grant must not create another worker');
  await tick();
  assert.equal(service.view(account).active,true);

  // A genuine loss of all role grants stops recovery and invalidates the slot.
  directory={contacts:[],directoryStatus:'empty',directoryReason:'not_shared'};
  await tick();
  assert.equal(saved(),undefined);
  assert.equal(pauses,1);
  assert.equal(next,null);
  assert.equal(service.view(account).active,false);

  // A world outage can recover, but a subsequent explicit lease refusal
  // must stop without another sample or any attempt to mint a new token.
  directory={contacts:[{number,source:'bothouse'}],directoryStatus:'ready'};
  await service.change(account,session,change);
  directory={contacts:[],directoryStatus:'offline'};await tick();
  checkStatus=503;await tick();
  assert.deepEqual(saved(),original);
  const previous=samples().length;
  checkStatus=403;await tick();
  assert.equal(next,null);
  assert.equal(saved(),undefined);
  assert.equal(samples().length,previous);
});


test('resident recovery never samples a signed-out, expired or reassigned binding',async t=>{
  const store=new SocialStore(':memory:');
  const world='https://world.example', issuer='https://friends.example';
  const planet='p-12345678-1234-1234-1234-123456789abc',source=planet.slice(2);
  const revoked=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,world+'/api/resident-feed/pause');
    revoked.push(options.headers.Authorization);
    return Response.json({ok:true});
  });
  const service=planetPublishers({store,socialOrigin:()=>issuer,
    bothouse:{list:()=>assert.fail('An invalid grant cannot request a directory')},
    env:{LITTLE_WORLDS_ORIGIN:world}});
  function grant(account,expires,revision,home=planet){
    const session='session-'+account,token=account[0].repeat(64);
    store.register(account,account,'human','synthetic');
    store.run('INSERT INTO sessions VALUES(?,?,?)',session,account,expires);
    store.run(`INSERT INTO friend_world_homes(account,issuer,world,planet,resident_source,visits)
      VALUES(?,?,?,?,?,'allowed')`,account,issuer,world,home,source);
    store.run('INSERT INTO world_resident_publishers VALUES(?,?,?,?,?,?,?,?)',
      account,issuer,world,session,planet,source,token,revision);
    return {session,token};
  }
  try{
    const future=Date.now()+60000;
    const signedOut=grant('alice',future,null);
    store.run('DELETE FROM sessions WHERE digest=?',signedOut.session);
    grant('dave',Date.now()-1,null);
    const roleRevoked=grant('bob',future,'withdrawn-pairing');
    const homeChanged=grant('carol',future,null,'p-12345678-1234-1234-1234-123456789abd');
    service.start();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual(new Set(revoked),new Set([roleRevoked,homeChanged].map(x=>'Bearer '+x.token)));
    assert.equal(store.one('SELECT count(*) AS count FROM world_resident_publishers').count,0);
  }finally{service.close();store.db.close();}
});

test('four busy workers defer valid recovery without deferring revocation',{timeout:15000},async t=>{
  const store=new SocialStore(':memory:');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'friends-resident-capacity-'));
  const config=path.join(root,'fixture.json');
  fs.writeFileSync(config,'{"activity":"idle"}');
  const world='https://world.example',issuer='https://friends.example',ticks=[];
  const blocked=Promise.withResolvers(),started=Promise.withResolvers(),owners=new Set();
  const timeout=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{
    if(ms!==0&&ms!==6000)return timeout(fn,ms,...args);
    ticks.push(fn);return {unref(){}};
  });
  const slots=new Map();
  for(const digit of ['1','2','3','4','5','6']){
    const account='owner'+digit,session='session-'+digit,token=digit.repeat(64),source=randomUUID(),planet='p-'+source;
    slots.set(token,planet);
    store.register(account,account,'human','fixture');
    store.run('INSERT INTO sessions VALUES(?,?,?)',session,account,Date.now()+60000);
    store.run("INSERT INTO friend_world_homes(account,issuer,world,planet,resident_source,visits) VALUES(?,?,?,?,?,'allowed')",account,issuer,world,planet,source);
    store.run('INSERT INTO world_resident_publishers VALUES(?,?,?,?,?,?,?,NULL)',account,issuer,world,session,planet,source,token);
  }
  const pauses=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const token=options.headers.Authorization.slice(7);
    if(url.endsWith('/pause'))pauses.push(token);
    return Response.json({ok:true,planetId:slots.get(token)});
  });
  const service=planetPublishers({store,socialOrigin:()=>issuer,
    env:{...process.env,LITTLE_WORLDS_ORIGIN:world,SOCIAL_BOTHOUSE_CONNECTION:config,
      SOCIAL_LITTLE_WORLDS_PUBLISHER:path.resolve(__dirname,'../../test/bothouse/resident-sampler.py')},
    bothouse:{list:async account=>{
      owners.add(account);
      if(owners.size===4)started.resolve();
      await blocked.promise;
      return {directoryStatus:'ready',contacts:[{source:'bothouse',number:'bh_'+'1'.repeat(21)}]};
    }}});
  t.after(()=>{service.close();store.db.close();fs.rmSync(root,{recursive:true,force:true});});
  service.start();
  const firstFour=ticks.splice(0,4).map(fn=>fn());
  try{
    await started.promise;
    await ticks.shift()(); // Fifth account waits for capacity.
    store.run("INSERT INTO bothouse_links VALUES('owner6','{}','replaced')");
    await ticks.shift()(); // Sixth lost its pairing while all four workers were busy.
    assert.deepEqual(pauses,['6'.repeat(64)]);
    assert.equal(owners.size,4);
    assert.ok(store.one("SELECT 1 FROM world_resident_publishers WHERE account='owner5'"));
  }finally{blocked.resolve();await Promise.all(firstFour);}
  await ticks.shift()();
  assert.ok(service.view('owner5').active);
  assert.ok(!owners.has('owner6'));
});
