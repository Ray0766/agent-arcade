'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {SocialStore}=require('./store.cjs');
const {createWorkOrders}=require('./bothouse/work-orders.cjs');
const {stockTaskReceiver}=require('./bothouse/stock-tasks.cjs');

for(const mode of ['restore','revoke','missing']){
  test('stock handback: '+mode,async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'friends-handback-'));
    const filename=path.join(root,'test.sqlite');
    const human='reader',ai='bh_'+'a'.repeat(21),project='fixture';
    const reply=Promise.withResolvers();
    let directoryStatus='ready',executions=0,lookups=0;
    const directory={
      async list(){
        lookups++;
        const contacts=directoryStatus==='ready'?[{number:ai,id:project,configured:true}]:[];
        return {contacts,directoryStatus};
      },
      async textTaskCapability(){return {available:true};},
      async runTextTask(){executions++;return reply.promise;},
    };
    const processes=new Set();
    function open(){
      const store=new SocialStore(filename);
      const orders=createWorkOrders(store,stockTaskReceiver(store,directory));
      const instance={store,orders};
      processes.add(instance);
      return instance;
    }
    function close(instance){
      instance.orders.stop();instance.store.db.close();processes.delete(instance);
    }
    t.after(()=>{for(const process of processes)close(process);fs.rmSync(root,{recursive:true,force:true});});
    let service=open();
    const {store,orders}=service;
    store.register(human,'Reader','human','fixture');store.register(ai,'Role','ai',null);
    const chat=store.openDirect(human,ai).id;
    const body={text:'请把物品分类：信封；土豆',clientId:'fixture-handback'};
    const prepared=await orders.prepare(human,chat,body);
    const message=store.send(human,chat,body,row=>orders.stage(human,row,body,prepared));
    const id=message.id;
    const state=()=>service.store.one('SELECT state FROM bothouse_work_orders WHERE prompt=?',id).state;
    const claim=()=>service.store.one('SELECT state,result FROM bothouse_task_claims WHERE prompt=? AND attempt=0',id);
    const delivered=()=>service.store.one("SELECT count(*) n FROM messages WHERE chat=? AND sender=? AND nonce LIKE '%_returned'",chat,ai).n;
    async function pollUntil(predicate){
      for(let i=0;i<100;i++){
        service.store.run('UPDATE bothouse_work_orders SET next_check=0 WHERE prompt=?',id);
        for(const item of processes)item.orders.wake();
        await delay(5);
        if(predicate())return;
      }
      assert.fail('did not reach expected handback state');
    }
    await pollUntil(()=>executions===1&&state()==='running');
    if(mode==='missing'){
      reply.resolve({error:'receipt_unknown'});
      await pollUntil(()=>state()==='uncertain');
      assert.equal(claim().result,null);
    }else{
      directoryStatus='offline';
      reply.resolve({text:'["纸品","蔬菜"]'});
      const before=lookups;
      await pollUntil(()=>claim()?.state==='verified'&&lookups>before);
      assert.equal(state(),'running');assert.equal(delivered(),0);
      close(service);service=open();
      assert.equal(claim().state,'verified');
      directoryStatus=mode==='revoke'?'empty':'ready';
      open(); // Two independent pollers compete for the same verified receipt.
      await pollUntil(()=>state()===(mode==='restore'?'returned':'cancelled'));
      if(mode==='revoke')assert.equal(claim().result,null);
      else assert.equal(claim().state,'returned');
    }
    assert.equal(delivered(),mode==='restore'?1:0);
    assert.equal(executions,1);
  });
}
