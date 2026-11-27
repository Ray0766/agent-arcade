'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {SocialStore}=require('./store.cjs');

test('a file forward copies only the sender’s visible file and keeps the original recipient snapshot',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const account of ['owner','sender','reader'])store.register(account,account,'human','fixture');
  store.register('robot','robot','ai',null);
  store.decide('owner',store.request('sender','owner').id,true);
  const direct=store.decide('reader',store.request('sender','reader').id,true).conversation.id;
  const source=store.createGroup('owner','周末河边散步',['sender']).id;
  const group=store.createGroup('sender','周日河边小队',['reader']).id;
  const revision=(account,chat)=>store.access(account,chat).membershipRevision;
  const bytes=Buffer.from('十点半在北门蓝色长椅集合。\n');
  const digest=createHash('sha256').update(bytes).digest('hex');
  const name='周末散步集合说明.txt';
  const file=(sender,nonce)=>store.transaction(()=>store.sendFile(sender,source,{
    clientId:nonce,name,bytes,digest,
  },revision(sender,source)));
  const own=file('sender','file-original'),other=file('owner','file-other');
  const history=(chat,account='sender')=>store.history(account,chat,new URLSearchParams());
  const request={kind:'file',expectedAccount:'sender',sourceRevision:revision('sender',source),target:group,ids:[own.id]};
  const preview=body=>store.messageForwardPreview('sender',source,body);
  const send=(body,review,nonce)=>store.transaction(()=>{
    return store.forwardMessages('sender',source,{...body,review,clientId:nonce.repeat(32)});
  });

  assert.throws(()=>preview({...request,ids:[other.id]}),{code:'forward_file'});
  assert.throws(()=>preview({...request,ids:[own.id,other.id]}),{code:'forward_selection'});
  assert.throws(()=>preview({...request,kind:'text'}),{code:'forward_selection'});
  const original=preview(request);
  assert.deepEqual(original.entries,[{id:own.id,name,bytes:bytes.length}]);
  assert.equal(original.recipient.title,'周日河边小队');
  assert.deepEqual(original.recipient.members.map(member=>member.number),['reader']);
  assert.deepEqual(history(group),[]);

  store.remove('sender',group,'reader',false);
  assert.throws(()=>send(request,original.review,'1'),{code:'forward_changed'});
  store.addMembers('sender',group,['reader']);
  assert.throws(()=>send(request,original.review,'1'),{code:'forward_changed'});
  store.run('INSERT INTO members VALUES(?,?,0)',group,'robot');
  assert.throws(()=>preview(request),{code:'forward_target'});
  assert.throws(()=>send(request,original.review,'1'),{code:'forward_target'});
  store.remove('sender',group,'robot',false);
  assert.deepEqual(history(group),[]);

  const {review}=preview(request);
  assert.deepEqual(send(request,review,'1'),{count:1});
  assert.deepEqual(send(request,review,'1'),{count:1});
  assert.throws(()=>send({...request,kind:'text'},review,'1'),{code:'forward_request'});
  const [received]=history(group,'reader');
  assert.equal(history(group,'reader').length,1);
  assert.equal(received.forwarded,true);
  assert.deepEqual(received.attachment,{type:'file',name,bytes:bytes.length});
  const copy=store.messageFile('reader',group,received.id);
  assert.equal(copy.digest,digest);
  assert.deepEqual(Buffer.from(copy.bytes),bytes);
  assert.throws(()=>store.messageFile('reader',source,own.id),{code:'unknown_chat'});

  const toDirect={...request,target:direct};
  const directPreview=preview(toDirect);
  store.removeFriend('sender',direct,{expectedAccount:'sender',number:'reader',revision:revision('sender',direct)});
  assert.throws(()=>send(toDirect,directPreview.review,'2'),{code:'friend_removed'});
  store.decide('reader',store.request('sender','reader').id,true);
  assert.throws(()=>send(toDirect,directPreview.review,'2'),{code:'forward_changed'});
  assert.deepEqual(history(direct),[]);
  const fresh=preview(toDirect);
  store.remove('owner',source,'sender',false);
  assert.throws(()=>send(toDirect,fresh.review,'2'),{code:'unknown_chat'});
  store.addMembers('owner',source,['sender']);
  assert.throws(()=>preview({...toDirect,sourceRevision:revision('sender',source)}),{code:'forward_source'});
  assert.deepEqual(history(direct),[]);
  assert.deepEqual(Buffer.from(store.messageFile('reader',group,received.id).bytes),bytes);
});
