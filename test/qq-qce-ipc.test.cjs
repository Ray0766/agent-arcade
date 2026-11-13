'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture,TOKEN,PANEL,NEXT,until,deferred}=require('./helpers/qq-qce-main-fixture.cjs');

test('QCE local credential entry preserves model/QQ secrets and sends zero requests',async t=>{
 const f=await fixture(t),secrets=JSON.stringify(f.service.secret),s=await f.invoke('Status');
 assert.equal(s.ok,true);assert.equal(s.credential.state,'empty');assert.equal(s.authenticated,false);
 const saved=await f.invoke('SaveCredential',{...f.input,token:TOKEN,expectedRevision:s.credential.revision});
 assert.equal(saved.credential.saved,true);assert.equal(saved.authenticated,false);assert.notEqual(saved.credential.revision,s.credential.revision);
 assert.equal(f.calls.length,0);assert.equal(f.qce.state.requests.length,0);assert.equal(f.state.nativeProofs,0);
 assert.equal(JSON.stringify(f.service.secret),secrets);assert.doesNotMatch(JSON.stringify(saved),new RegExp(TOKEN));
 assert(!fs.readFileSync(path.join(f.root,'qq-qce-credentials.bin')).includes(Buffer.from(TOKEN)));
 assert.equal((await f.invoke('SaveCredential',{...f.input,token:TOKEN,expectedRevision:s.credential.revision})).ok,false);
 const removed=await f.invoke('RemoveCredential',{...f.input,expectedRevision:saved.credential.revision});
 assert.equal(removed.removed,true);assert.equal(removed.credential.saved,false);assert.equal(f.calls.length,0);assert.equal(f.qce.state.requests.length,0);
});

test('actual main verifies separate NapCat and QCE identities then writes exactly one chosen field',async t=>{
 const f=await fixture(t);await f.save();const p=await f.preview('customScheduledExportDir','C:\\Synthetic-QCE\\scheduled-next');
 assert.equal(p.scope.accountIsolated,false);assert.equal(f.qce.writes().length,0);
 const r=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'match');assert.equal(r.change.effects.durablePersistenceVerified,false);
 assert.deepEqual(f.qce.writes().map(row=>row.body),[{customScheduledExportDir:'C:\\Synthetic-QCE\\scheduled-next'}]);
 assert(f.state.nativeProofs>=3);assert(f.qce.state.requests.every(row=>row.authorization==='Bearer '+TOKEN));
 assert(f.calls.some(row=>row.path==='/api/Plugin/List'));assert(f.calls.every(row=>!/(?:SetStatus|Config|Register|Export)/.test(row.path)));
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE|SYNTHETIC_QCE_WEBUI|SYNTHETIC_QCE_ONEBOT/);assert.equal(f.pollingClosed,0);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.qce.writes().length,1);
});

test('a received QCE failure stays unknown even when independent readback matches',async t=>{
 const f=await fixture(t);await f.save();const p=await f.preview();f.qce.state.writeMode='error';
 const r=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});
 assert.equal(r.change.outcome,'unknown');assert.equal(r.change.bridgeResponse,'received');assert.equal(r.change.observation.state,'match');assert.equal(f.qce.writes().length,1);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);
});

test('unsupported, inactive, duplicate or foreign registry state blocks QCE authentication',async t=>{
 for(const mutate of [f=>f.state.plugins[0].version='6.3.2',f=>f.state.plugins[0].status='disabled',f=>f.state.plugins.push({...f.state.plugins[0]}),f=>f.state.account='300001',f=>f.state.online=false]){
  const f=await fixture(t);await f.save();mutate(f);const r=await f.invoke('Read');assert.equal(r.ok,false);assert.equal(f.qce.state.requests.length,0);assert.equal(f.qce.writes().length,0);
 }
});

test('actual QCE account mismatch refuses settings despite a valid managed NapCat account',async t=>{
 const f=await fixture(t);await f.save();f.qce.state.account='300001';const r=await f.invoke('Read');assert.equal(r.ok,false);assert.equal(r.code,'qq_mismatch');assert.equal(f.qce.state.requests.filter(row=>row.path==='/api/config').length,0);
});

test('renderer cannot supply hosts, ports, plugin IDs, tokens on read or foreign frames',async t=>{
 const f=await fixture(t);await f.save();
 for(const extra of [{host:'example.invalid'},{port:40654},{pluginId:'napcat-plugin-qce'},{token:TOKEN},{path:'C:\\Synthetic-QCE'}])assert.equal((await f.invoke('Read',{...f.input,...extra})).ok,false);
 await assert.rejects(f.invoke('Status',f.input,{sender:{},senderFrame:f.event.senderFrame}));
 await assert.rejects(f.invoke('Status',f.input,{sender:f.event.sender,senderFrame:{url:'https://example.invalid/'}}));
 assert.equal(f.qce.state.requests.length,0);assert.equal(f.calls.length,0);
});

test('hide and selection invalidate local credential panels without changing stored credentials',async t=>{
 const f=await fixture(t);await f.save();const s=await f.invoke('Status');f.emit('hide');
 const r=await f.invoke('SaveCredential',{...f.input,expectedRevision:s.credential.revision,token:'R'.repeat(40)});assert.equal(r.ok,false);
 const next=await f.invoke('Status');assert.equal(next.credential.revision,s.credential.revision);
 await f.handlers.get('arcade:accountSelect')(f.event,'other');await f.handlers.get('arcade:accountSelect')(f.event,'whale');
 assert.equal((await f.invoke('RemoveCredential',{...f.input,expectedRevision:next.credential.revision})).ok,false);assert.equal(f.calls.length,0);
});

test('old-panel close cannot discard a replacement local credential entry',async t=>{
 const f=await fixture(t);const one=await f.invoke('Status'),next={...f.input,panelId:NEXT},two=await f.invoke('Status',next);
 await f.invoke('Close');assert.equal(f.api.localPanel().panelId,NEXT);
 const out=await f.invoke('SaveCredential',{...next,token:TOKEN,expectedRevision:two.credential.revision});assert.equal(out.ok,true);assert.equal(one.credential.revision,two.credential.revision);assert.equal(f.calls.length,0);
});

test('credential management retires the prior remote ticket and never automatically reads',async t=>{
 const f=await fixture(t);await f.save();const p=await f.preview(),before=f.qce.state.requests.length;
 const s=await f.invoke('Status');assert.equal(f.clients[0].closed,true);assert.equal(f.qce.state.requests.length,before);
 await f.invoke('SaveCredential',{...f.input,expectedRevision:s.credential.revision,token:'R'.repeat(40)});
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.qce.writes().length,0);assert.equal(f.pollingClosed,0);
});

test('hide during a pending local status handoff cannot resurrect a credential editor',async t=>{
 const f=await fixture(t),gate=deferred(),original=f.api.pluginAdminSession.closeCurrent.bind(f.api.pluginAdminSession);let entered=false;
 f.api.pluginAdminSession.closeCurrent=async()=>{entered=true;await original();await gate.promise;};
 const read=f.invoke('Status');await until(()=>entered);f.emit('hide');gate.resolve();const r=await read;
 assert.equal(r.ok,false);assert.equal(f.api.localPanel(),null);assert.equal(f.qce.state.requests.length,0);
});

test('changed runtime scope while authenticating refuses any QCE request',async t=>{
 const f=await fixture(t);await f.save();f.state.before=row=>{if(row.path==='/api/Plugin/List')f.console.epoch++;};
 const r=await f.invoke('Read');assert.equal(r.ok,false);assert.equal(f.qce.state.requests.length,0);assert.equal(f.pollingClosed,0);
});

test('preload exposes eight fixed QCE methods without credential getters or arbitrary URLs',()=>{
 const exposed={},calls=[],input={accountId:'whale',panelId:PANEL};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}};}});
 const suffixes=['Status','SaveCredential','RemoveCredential','Read','Preview','Confirm','Dismiss','Close'];
 for(const suffix of suffixes)exposed.arcade['qqQce'+suffix](input);
 assert.equal(calls.length,8);assert.deepEqual(Object.keys(exposed.arcade).filter(key=>key.startsWith('qqQce')&&!['Export','Schedule','Security','NativePlans'].some(group=>key.startsWith('qqQce'+group))),suffixes.map(key=>'qqQce'+key));assert(calls.every(([,value])=>value===input));
});
