'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {SocialStore}=require('./store.cjs');

test('forwarding an owned photo rechecks access and commits one independent copy',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const person of ['owner','sender','reader'])store.register(person,person,'human','fixture');
  store.decide('owner',store.request('sender','owner').id,true);
  const target=store.decide('reader',store.request('sender','reader').id,true).conversation.id;
  const source=store.createGroup('owner','周末散步',['sender']).id;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=','base64');
  const image={mime:'image/png',width:1,height:1,bytes,digest:createHash('sha256').update(bytes).digest('hex')};
  const photo=store.sendImage('sender',source,'photo-own',image,'院落合影。');
  const other=store.sendImage('owner',source,'photo-other',image);
  const request={kind:'photo',expectedAccount:'sender',sourceRevision:store.access('sender',source).membershipRevision,
    target,ids:[photo.id]};
  const preview=body=>store.messageForwardPreview('sender',source,body);
  assert.throws(()=>preview({...request,ids:[other.id]}),{code:'forward_photo'});
  assert.throws(()=>preview({...request,target:source}),{code:'forward_target'});
  const {review}=preview(request);
  const send=clientId=>store.transaction(()=>store.forwardMessages('sender',source,{...request,review,clientId}));
  const history=()=>store.history('reader',target,new URLSearchParams());
  assert.equal(history().length,0);
  send('1'.repeat(32));
  send('1'.repeat(32));
  const [copy]=history();
  assert.equal(history().length,1);
  assert(copy.forwarded);
  assert.equal(copy.attachment.caption,'院落合影。');
  store.remove('owner',source,'sender',false);
  assert.throws(()=>send('2'.repeat(32)),{code:'unknown_chat'});
  store.addMembers('owner',source,['sender']);
  assert.throws(()=>preview({...request,sourceRevision:store.access('sender',source).membershipRevision}),{code:'forward_source'});
  assert.deepEqual(Buffer.from(store.messageImage('reader',target,copy.id).bytes),bytes);
  assert.throws(()=>store.messageImage('owner',target,copy.id),{code:'unknown_chat'});
});

test('a group photo confirmation binds current human memberships and can be retried',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const person of ['sender','peer','third'])store.register(person,person,'human','fixture');
  store.register('robot','robot','ai',null);
  const source=store.decide('peer',store.request('sender','peer').id,true).conversation.id;
  store.decide('third',store.request('sender','third').id,true);
  const target=store.createGroup('sender','周日河边小队',['peer','third']).id;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=','base64');
  const image={mime:'image/png',width:1,height:1,bytes,digest:createHash('sha256').update(bytes).digest('hex')};
  const photo=store.sendImage('sender',source,'photo-own',image,'河边见。');
  const request={kind:'photo',expectedAccount:'sender',sourceRevision:store.access('sender',source).membershipRevision,
    target,ids:[photo.id]};
  const preview=()=>store.messageForwardPreview('sender',source,request);
  const send=review=>store.transaction(()=>store.forwardMessages('sender',source,{...request,review,clientId:'a'.repeat(32)}));
  const original=preview();
  assert.deepEqual(original.recipient.members.map(member=>member.number),['peer','third']);
  store.remove('sender',target,'third',false);
  assert.throws(()=>send(original.review),{code:'forward_changed'});
  store.addMembers('sender',target,['third']);
  assert.throws(()=>send(original.review),{code:'forward_changed'});
  store.run('INSERT INTO members VALUES(?,?,0)',target,'robot');
  assert.throws(()=>preview(),{code:'forward_target'});
  assert.throws(()=>send(original.review),{code:'forward_target'});
  store.remove('sender',target,'robot',false);
  assert.equal(store.history('third',target,new URLSearchParams()).length,0);
  const {review}=preview();
  send(review);
  send(review);
  const copies=store.history('third',target,new URLSearchParams());
  assert.equal(copies.length,1);
  assert.equal(copies[0].attachment.caption,'河边见。');
  assert.deepEqual(Buffer.from(store.messageImage('third',target,copies[0].id).bytes),bytes);
  assert.throws(()=>store.messageImage('third',source,photo.id),{code:'unknown_chat'});
});

test('owned photo batch confirms and commits the entire ordered selection exactly once',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const person of ['sender','peer','reader'])store.register(person,person,'human','fixture');
  const source=store.decide('peer',store.request('sender','peer').id,true).conversation.id;
  const target=store.decide('reader',store.request('sender','reader').id,true).conversation.id;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=','base64');
  const image={mime:'image/png',width:1,height:1,bytes,digest:createHash('sha256').update(bytes).digest('hex')};
  const first=store.sendImage('sender',source,'coffee',image,'先到街角喝咖啡。');
  const second=store.sendImage('sender',source,'camera',image,'再沿河拍照。');
  const other=store.sendImage('peer',source,'peer-photo',image);
  const request={kind:'photo',expectedAccount:'sender',sourceRevision:store.access('sender',source).membershipRevision,
    target,ids:[second.id,first.id]};
  const preview=body=>store.messageForwardPreview('sender',source,body);
  assert.throws(()=>preview({...request,ids:[first.id,other.id]}),{code:'forward_photo'});
  const {entries,review}=preview(request);
  assert.deepEqual(entries.map(entry=>entry.id),[first.id,second.id]);
  const send=()=>store.transaction(()=>store.forwardMessages('sender',source,{...request,review,clientId:'b'.repeat(32)}));
  const received=()=>store.history('reader',target,new URLSearchParams());

  // A failed second insert must roll back the first copy and its retry receipt.
  store.db.exec("CREATE TEMP TRIGGER fail_second BEFORE INSERT ON message_image_captions "+
    "WHEN NEW.caption='再沿河拍照。' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END");
  assert.throws(send,/fixture write failure/);
  assert.equal(received().length,0);
  assert.equal(store.one('SELECT count(*) AS n FROM message_forward_batches').n,0);
  store.db.exec('DROP TRIGGER fail_second');
  assert.deepEqual(send(),{count:2});
  assert.deepEqual(send(),{count:2});
  assert.deepEqual(received().map(message=>message.attachment.caption),entries.map(entry=>entry.caption));

  const third=store.sendImage('sender',source,'last-photo',image,'最后一张。');
  const stale={...request,ids:[first.id,third.id]};
  const nextReview=preview(stale).review;
  store.run('UPDATE messages SET removed=1 WHERE id=?',third.id);
  assert.throws(()=>store.transaction(()=>store.forwardMessages('sender',source,
    {...stale,review:nextReview,clientId:'c'.repeat(32)})),{code:'forward_source'});
  assert.equal(received().length,2);
});
