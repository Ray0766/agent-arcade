'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {SocialStore}=require('./store.cjs');

test('ordinary photo retries bind the caption to the original image message',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const number of ['reader','sender'])store.register(number,number,'human','fixture');
  store.decide('reader',store.request('sender','reader').id,true);
  const group=store.createGroup('sender','周末散步',['reader']).id;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=','base64');
  const image={bytes,mime:'image/png',width:1,height:1,digest:createHash('sha256').update(bytes).digest('hex')};
  const send=(nonce,caption)=>store.transaction(()=>store.sendImage('sender',group,nonce,image,caption));
  const old=send('plain-photo');
  assert.equal(old.attachment.caption,undefined);
  assert.equal(send('plain-photo','').id,old.id);
  const text='岚汐拿着工作册来迎我。',message=send('captioned-photo',text);
  assert.equal(send('captioned-photo',text).id,message.id);
  for(const changed of ['','另一天的合影'])assert.throws(()=>send('captioned-photo',changed),{code:'message_conflict'});
  assert.throws(()=>send('plain-photo',text),{code:'message_conflict'});
  const page=store.history('reader',group,new URLSearchParams({after:'0'}));
  assert.equal(page.filter(row=>row.attachment?.caption===text).length,1);
  assert.deepEqual(Buffer.from(store.messageImage('reader',group,message.id).bytes),bytes);
  store.run('UPDATE messages SET removed=1 WHERE id=?',message.id);
  assert.equal(send('captioned-photo',text).attachment,undefined);
});
