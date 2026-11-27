'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {test}=require('node:test');
const {SocialStore}=require('./store.cjs');
const {groupSharedFiles}=require('./group-shared-media.cjs');

test('group files search and paginate only the currently visible history',()=>{
  const store=new SocialStore(':memory:');
  try{
    for(const [number,name] of [['owner','Owner'],['reader','Reader'],['outsider','Outsider']])
      store.register(number,name,'human','fixture-password');
    store.decide('reader',store.request('owner','reader').id,true);
    const {id:chat}=store.createGroup('owner','Weekend walk',['reader']);
    const bytes=Buffer.from('Bring a bottle of water.');
    const file={name:'plan.txt',mime:'application/octet-stream',bytes,
      digest:createHash('sha256').update(bytes).digest('hex')};
    const send=(i,name=file.name)=>store.sendFile('owner',chat,
      {...file,name,clientId:'fixture-file-'+i},store.group('owner',chat).membershipRevision).id;
    const ids=Array.from({length:26},(_,i)=>send(i));
    send(26,'notes.txt');
    store.run('UPDATE messages SET removed=1 WHERE id=?',ids[10]);
    const list=(viewer,query)=>groupSharedFiles(store,viewer,chat,new URLSearchParams(query));
    const first=list('reader',{q:'PLAN'});
    assert.equal(first.items.length,24);
    assert.equal(first.items[0].attachment.name,'plan.txt');
    assert.equal(first.items[0].sender.displayName,'Owner');
    const next=list('reader',{q:'PLAN',before:first.nextBefore});
    assert.deepEqual(next.items.map(item=>item.id),[ids[0]]);
    assert.equal(next.nextBefore,null);
    assert.throws(()=>list('outsider',{}),{status:404});
    store.remove('owner',chat,'reader');
    assert.throws(()=>list('reader',{}),{status:404});
    store.addMembers('owner',chat,['reader']);
    assert.deepEqual(list('reader',{}).items,[]);
  }finally{store.db.close();}
});
