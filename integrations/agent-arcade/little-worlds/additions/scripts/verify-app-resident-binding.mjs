import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openStore} from '../src/server/store.ts';
import {appResidents} from '../src/server/app-residents.ts';
import {planetResidents} from '../src/server/planet-residents.ts';
import {withResidentArt} from '../src/server/resident-art.ts';

test('keeps an independently paired source and refuses an old App publisher after rotation or pause',()=>{
  const store=openStore(':memory:');
  try{
    store.create('owner',0);store.create('visitor',0);
    const planet=store.universe('owner').planets.find(p=>p.kind==='garden').id;
    store.claim('owner',planet);
    store.db.prepare('UPDATE players SET planet_id=?').run(planet);
    const sources=withResidentArt(store.db,planetResidents(store.db));
    const manage=appResidents(store.db,sources);
    const details={account:'friend_a',socialOrigin:'https://friends.example'};
    const connect=()=>manage.change('owner',{action:'connect',...details});
    const manual=sources.connect('owner',planet);
    assert.equal(manage.status('visitor').owned,false);
    assert.throws(()=>manage.change('visitor',{action:'connect',...details}));
    const old=connect(),next=connect();
    assert.equal(next.sourceId,old.sourceId);
    assert.throws(()=>manage.pause(old.token));
    assert.throws(()=>manage.change('owner',{action:'disconnect',ifToken:old.token}));
    assert.throws(()=>manage.check(next.token,{...details,sourceId:next.sourceId,account:'friend_b'}));
    assert.throws(()=>manage.check(next.token,{...details,sourceId:next.sourceId,socialOrigin:'https://other.example'}));
    assert.throws(()=>manage.pause(manual.token));
    assert.deepEqual(manage.check(next.token,{...details,sourceId:next.sourceId}),{ok:true,planetId:planet});
    const fixture={instance:'1'.repeat(64),residents:[{project:'companion',source:'bridge',displayName:'Test Companion',appearanceKey:'default',activity:'working'}]};
    sources.publish(next.token,fixture);
    sources.publish(manual.token,{...fixture,instance:'2'.repeat(64)});
    assert.equal(manage.read('visitor',planet).residents.length,2);
    store.db.prepare("UPDATE planet_resident_sources SET sampled=sampled-31000").run();
    const stale=manage.read('visitor',planet);
    assert.equal(stale.residents.length,1);assert.equal(stale.residents[0].activity,'unknown');
    // A later fresh, authorized update can repopulate the same App slot.
    sources.publish(next.token,fixture);assert.equal(manage.read('visitor',planet).residents.length,2);
    manage.pause(next.token);
    assert.throws(()=>sources.authorize(next.token));
    // A failed first publication can still be rolled back after the service paused that lease.
    manage.change('owner',{action:'disconnect',ifToken:next.token});
    assert.equal(manage.status('owner').connected,false);
    sources.authorize(manual.token);
  }finally{store.close();}
});

test('stores bodies by planet, Friends identity and native role number',()=>{
  const store=openStore(':memory:');
  try{
    store.create('owner',0);store.create('visitor',0);
    const planet=store.universe('owner').planets.find(p=>p.kind==='garden').id;
    store.claim('owner',planet);
    store.db.prepare('UPDATE players SET planet_id=?').run(planet);
    const sources=withResidentArt(store.db,planetResidents(store.db));
    const manage=appResidents(store.db,sources);
    const connect=account=>manage.change('owner',{action:'connect',account,socialOrigin:'https://friends.example'});
    const [one,two]=['first','second'].map(project=>({
      project,source:'bridge',displayName:'Same name',appearanceKey:'orange',activity:'idle'
    }));
    const feed=(slot,rows)=>sources.publish(slot.token,{instance:'1'.repeat(64),residents:rows});
    const read=()=>manage.withBodies(planet,manage.read('visitor',planet)).residents;
    const slot=connect('friend_a');feed(slot,[one,two]);
    const [a,b]=read().map(r=>r.id);
    const pick=(sourceId,residentId,body)=>({action:'set-body',sourceId,residentId,body});
    assert.deepEqual(read().map(r=>r.appearanceKey),['orange','orange']);
    assert.throws(()=>manage.change('visitor',pick(slot.sourceId,a,'whale')),e=>e.status===403);
    assert.throws(()=>manage.change('owner',pick(slot.sourceId,a,'custom')),e=>e.status===400);
    manage.change('owner',pick(slot.sourceId,a,'whale'));
    manage.change('owner',pick(slot.sourceId,b,'lanxi'));
    feed(slot,[{...one,appearanceKey:'default'},two]);
    assert.deepEqual(read().map(r=>r.appearanceKey),['whale','lanxi']);
    assert.deepEqual(manage.status('owner').bodyResidents.map(r=>r.body),['whale','lanxi']);
    feed(slot,[two]);
    assert.throws(()=>manage.change('owner',pick(slot.sourceId,a,'dragon')),e=>e.status===409);
    manage.change('owner',{action:'disconnect',sourceId:slot.sourceId});
    const other=connect('friend_b');feed(other,[one,two]);
    assert.deepEqual(read().map(r=>r.appearanceKey),['orange','orange']);
    assert.throws(()=>manage.change('owner',pick(slot.sourceId,b,'dragon')),e=>e.status===409);
    manage.change('owner',{action:'disconnect',sourceId:other.sourceId});
    const returned=connect('friend_a');feed(returned,[one,two]);
    assert.deepEqual(read().map(r=>r.appearanceKey),['whale','lanxi']);
    manage.change('owner',pick(returned.sourceId,a,'auto'));
    assert.deepEqual(read().map(r=>r.appearanceKey),['orange','lanxi']);
  }finally{store.close();}
});

