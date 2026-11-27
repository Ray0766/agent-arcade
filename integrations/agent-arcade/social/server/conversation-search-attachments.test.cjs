'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SocialStore}=require('./store.cjs');

test('file name search respects the message cursor, current membership and history floor',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const name of ['owner','guest'])store.register(name,name,'human','fixture');
  store.decide('guest',store.request('owner','guest').id,true);
  const group=store.createGroup('owner','散步小队',['guest']).id;
  const revision=store.access('owner',group).membershipRevision;
  const params=(q,extra={})=>new URLSearchParams({account:'guest',q,...extra});
  const search=(q,extra)=>store.searchConversationMessages('guest',params(q,extra));
  const files=[];
  for(let i=0;i<21;i++)files.push(store.sendFile('owner',group,{
    clientId:'instructions-'+i,name:'散步集合说明.txt',bytes:Buffer.from(String(i)),digest:'file-'+i
  },revision).id);
  const first=search('集合说明');
  assert.deepEqual(first.results.map(row=>row.id),files.slice(1).reverse());
  assert.equal(first.results[0].attachmentKind,'file');
  assert.deepEqual(search('集合说明',{before:first.next}).results.map(row=>row.id),[files[0]]);
  assert.deepEqual(search('没有这句话').results,[]);
  store.run('UPDATE messages SET removed=1 WHERE id=?',files.at(-1));
  assert(!search('集合说明').results.some(row=>row.id===files.at(-1)));
  assert.throws(()=>store.messageFile('guest',group,files.at(-1)),{code:'unknown_file'});
  store.remove('owner',group,'guest',false);
  assert.deepEqual(search('集合说明').results,[]);
  assert.throws(()=>store.messageFile('guest',group,files[0]),{code:'unknown_chat'});
  store.addMembers('owner',group,['guest']);
  assert.deepEqual(search('集合说明').results,[]);
  assert.throws(()=>store.messageFile('guest',group,files[0]),{code:'unknown_file'});
  assert.throws(()=>store.historySearch('guest',group,new URLSearchParams({account:'guest',around:files[0]})),{code:'unknown_message'});
});
