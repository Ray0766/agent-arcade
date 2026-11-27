'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createVisitPhotoReturn,installVisitPhoto}=require('../src/core/visit-photo-return.cjs');

function fixture(authorize=async()=>true,decodePng=()=>true){
  const photos=createVisitPhotoReturn(),delivered=[],returns=[];
  const page='http://127.0.0.1:9020/?visit=p-test',frame={url:page};
  const friend={account:'visitor',number:'owner',visitId:'departure'};
  let sourceCurrent=true,call;
  photos.depart({...friend,current:()=>sourceCurrent,deliver:(...args)=>delivered.push(args)});
  assert.equal(photos.claim({...friend,account:'other'}),undefined);
  const binding=photos.claim(friend);
  assert.equal(photos.claim(friend),undefined);
  const wc=Object.assign(new EventEmitter(),{mainFrame:frame,isDestroyed:()=>false,
    ipc:{handle:(_channel,handler)=>{call=handler;}}});
  installVisitPhoto({wc,binding,page,planet:'p-test',current:()=>true,authorize,decodePng,onReturn:key=>returns.push(key)});
  const event={sender:wc,senderFrame:frame};
  const bytes=Uint8Array.from(require('node:fs').readFileSync(require.resolve('../social/client/icon-192.png'))).buffer;
  return {photos,delivered,returns,wc,event,bytes,invoke:(png=bytes,from=event)=>call(from,png),switchChat:()=>{sourceCurrent=false;}};
}

test('one accepted photo needs its matching return receipt; a different destination gets no preview',async()=>{
  const f=fixture();
  assert.deepEqual(await f.invoke(),{ok:true});
  assert.deepEqual(await f.invoke(),{ok:false,reason:'expired'});
  f.photos.receive('other');assert.equal(f.delivered.length,0);
  f.photos.receive(f.returns[0]);f.photos.receive(f.returns[0]);
  assert.deepEqual(f.delivered,[[f.bytes,'p-test']]);
  for(const invalidate of [x=>x.photos.cancel(x.returns[0]),x=>x.switchChat(),x=>x.photos.clear()]){
    const next=fixture();
    assert.deepEqual(await next.invoke(),{ok:true});
    invalidate(next);next.photos.receive(next.returns[0]);
    assert.equal(next.delivered.length,0);
  }
});

test('only the current main frame of a permitted visit can stage a bounded static PNG',async()=>{
  const f=fixture();
  assert.equal((await f.invoke(f.bytes,{sender:f.wc,senderFrame:{url:f.wc.mainFrame.url}})).reason,'expired');
  assert.equal((await f.invoke(new ArrayBuffer(4194305))).reason,'too_large');
  assert.equal((await f.invoke(new ArrayBuffer(14))).reason,'invalid_image');
  assert.equal((await fixture(undefined,()=>false).invoke()).reason,'invalid_image');
  assert.equal((await fixture(async()=>false).invoke()).reason,'expired');
  f.wc.emit('did-start-navigation',{},f.wc.mainFrame.url,false,true);
  assert.equal((await f.invoke()).reason,'expired');assert.equal(f.returns.length,0);
});

test('duplicate clicks and a change during the permission read cannot stage a photo',async()=>{
  let finish;
  const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  const inflight=f.invoke();
  assert.equal((await f.invoke()).reason,'unavailable');
  f.photos.clear();finish(true);
  assert.equal((await inflight).reason,'expired');assert.equal(f.returns.length,0);
});
