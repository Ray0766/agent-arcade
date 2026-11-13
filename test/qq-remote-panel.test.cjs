'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQRemotePanel}=require('../src/bot/qq-remote-panel.cjs');
const {RemoteNapCatRegistry}=require('../src/bot/qq-remote-registry.cjs');
const {validateRemoteOrigin,validateRemoteTrust}=require('../src/bot/qq-remote-transport.cjs');
const {caPem}=require('./helpers/qq-remote-tls-fixture.cjs');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^0x5a),decryptString:value=>Buffer.from(value).map(byte=>byte^0x5a).toString()};
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-remote-panel-')),registry=new RemoteNapCatRegistry({root,vault,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust});
 const state={context:'context-1',visible:true,sessionCalls:[],retire:null,picker:null,time:1000,pickCount:0};
 const session={closeCurrent(){return state.retire?.promise||Promise.resolve();},close(){return this.closeCurrent();},observe(){},read(input){state.sessionCalls.push(input);return Promise.resolve({profile:{source:'synthetic'}});}};
 const panel=new QQRemotePanel({registry,validateTrust:validateRemoteTrust,captureContext:entry=>{if(!state.visible)throw Object.assign(Error('synthetic hidden'),{code:'scope_unavailable'});if(entry?.associatedProfileId)throw Object.assign(Error('synthetic missing profile'),{code:'changed'});return state.context;},sessionFactory:()=>session,sessionResult:async(input,fn)=>{try{return {ok:true,...await fn()};}catch(error){return {ok:false,code:error.code};}},pickCA:async()=>{state.pickCount++;return state.picker?state.picker.promise:null;},monotonic:()=>state.time,now:()=>10000});
 const request=(method,value={panelId:A})=>panel.result(value,()=>panel[method](value));
 t.after(async()=>{state.retire?.resolve();state.picker?.resolve(null);await panel.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,registry,state,panel,session,request};
}
const value=()=>({label:'Remote fixture',origin:'https://remote.arcade.invalid/',expectedQQ:'1000001',token:'synthetic-admin-token-1',trust:{},associatedProfileId:null});
test('opening the registry performs no network and projects no secret',async t=>{const f=fixture(t);assert.deepEqual(await f.request('list'),{ok:true,panelId:A,registry:{state:'ready',items:[]}});const added=await f.request('create',{panelId:A,value:value()});assert.equal(added.ok,true);assert.equal(added.registration.origin,'https://remote.arcade.invalid');assert.equal(f.state.sessionCalls.length,0);assert.doesNotMatch(JSON.stringify(added),/synthetic-admin-token|caPem/);});
test('creation requires an active visible panel and does not accept renderer paths',async t=>{const f=fixture(t);assert.equal((await f.request('create',{panelId:A,value:value()})).ok,false);await f.request('list');assert.equal((await f.request('create',{panelId:A,value:{...value(),file:'C:\\synthetic.pem'}})).ok,false);f.state.visible=false;assert.equal((await f.request('create',{panelId:A,value:value()})).ok,false);assert.equal(f.registry.list().items.length,0);});
test('invalid registry requests cannot retire the existing panel',async t=>{const f=fixture(t);await f.request('list');const active=f.panel.panel;assert.equal((await f.request('list',{panelId:B,route:'/arbitrary'})).ok,false);assert.equal(f.panel.panel,active);});
test('close cancels a list waiting for session retirement and stale close preserves the new panel',async t=>{const f=fixture(t);await f.request('list');f.state.retire=deferred();const reading=f.request('list',{panelId:B});const closing=f.request('closeOwned',{panelId:B});f.state.retire.resolve();assert.equal((await reading).ok,false);await closing;f.state.retire=null;await f.request('list',{panelId:B});await f.request('closeOwned',{panelId:A});assert.equal(f.panel.panel.panelId,B);});
test('registration creation waiting for session close cannot survive a scope change',async t=>{const f=fixture(t);await f.request('list');f.state.retire=deferred();const pending=f.request('create',{panelId:A,value:value()});await Promise.resolve();f.state.context='context-2';f.state.retire.resolve();assert.equal((await pending).ok,false);assert.equal(f.registry.list().items.length,0);});
test('private CA picker is scoped, transient and never returns bytes or paths',async t=>{const f=fixture(t);await f.request('list');const file=path.join(f.root,'synthetic-ca.pem');fs.writeFileSync(file,caPem);f.state.picker=deferred();const picking=f.request('pickCAFile');await Promise.resolve();f.state.picker.resolve(file);const picked=await picking;assert.equal(picked.ok,true);assert.match(picked.ca.subject,/PUBLIC SYNTHETIC/);assert.doesNotMatch(JSON.stringify(picked),/BEGIN CERTIFICATE|synthetic-ca\.pem/);const added=await f.request('create',{panelId:A,value:{...value(),trust:{caSelectionId:picked.ca.selectionId}}});assert.equal(added.ok,true);assert.equal(added.registration.trust.privateCA,true);assert.equal(f.registry.capture(added.registration.remoteId).trust.caPem,caPem);assert.equal(f.panel.ca,null);});
test('cancelled or expired CA draft cannot authorize a new registration',async t=>{const f=fixture(t);await f.request('list');const file=path.join(f.root,'synthetic-ca.pem');fs.writeFileSync(file,caPem);f.state.picker=deferred();const picking=f.request('pickCAFile');await Promise.resolve();f.state.picker.resolve(file);const picked=await picking;f.state.time+=300000;const denied=await f.request('create',{panelId:A,value:{...value(),trust:{caSelectionId:picked.ca.selectionId}}});assert.equal(denied.code,'ca_selection_expired');assert.equal(f.registry.list().items.length,0);f.state.picker=null;assert.equal((await f.request('pickCAFile')).cancelled,true);assert.equal(f.panel.ca,null);});
test('closing a picker retires its result and avoids a late certificate draft',async t=>{const f=fixture(t);await f.request('list');f.state.picker=deferred();const pending=f.request('pickCAFile');await Promise.resolve();const close=f.request('closeOwned');f.state.picker.resolve(path.join(f.root,'never-read.pem'));assert.equal((await pending).ok,false);await close;assert.equal(f.panel.ca,null);});
test('wrong revision and missing profile association do not modify encrypted records',async t=>{const f=fixture(t);await f.request('list');const added=await f.request('create',{panelId:A,value:value()}),r=added.registration;const before=fs.readFileSync(f.registry.file);assert.equal((await f.request('update',{panelId:A,remoteId:r.remoteId,revision:A,patch:{label:'wrong'}})).code,'registration_changed');assert.equal((await f.request('update',{panelId:A,remoteId:r.remoteId,revision:r.revision,patch:{associatedProfileId:'missing'}})).code,'changed');assert.deepEqual(fs.readFileSync(f.registry.file),before);});
test('session request keeps its selected remote and cannot cross a retired registry panel',async t=>{const f=fixture(t);await f.request('list');const added=await f.request('create',{panelId:A,value:value()});const request={panelId:A,remoteId:added.registration.remoteId};assert.equal((await f.panel.call('read',request)).ok,true);await f.request('list',{panelId:B});assert.equal((await f.panel.call('read',request)).ok,false);assert.equal(f.state.sessionCalls.length,1);});
test('forget removes only one encrypted registration and never contacts the server',async t=>{const f=fixture(t);await f.request('list');const added=await f.request('create',{panelId:A,value:value()});const result=await f.request('forget',{panelId:A,remoteId:added.registration.remoteId,revision:added.registration.revision});assert.equal(result.forgotten,true);assert.equal(result.registry.items.length,0);assert.equal(f.state.sessionCalls.length,0);});

test('permanent panel close preserves a failed owned-helper exit for retry',async t=>{
 const f=fixture(t);let attempts=0;const expected=Object.assign(Error('synthetic unconfirmed helper exit'),{code:'webauthn_close_unconfirmed'});
 f.session.close=async()=>{if(++attempts===1)throw expected;return {closed:true};};
 await assert.rejects(f.panel.close(),error=>error===expected);assert.equal(f.panel.session,f.session);
 assert.deepEqual(await f.panel.close(),{closed:true});assert.equal(attempts,2);
});

test('ordinary panel close reports file cleanup failure and the same panel can retry it',async t=>{
 const f=fixture(t);await f.request('list');let attempts=0;
 f.session.closeCurrent=async()=>{if(++attempts===1)throw Object.assign(Error('Synthetic local cleanup'),{code:'file_cleanup_unconfirmed'});return {closed:true};};
 const first=await f.request('closeOwned');assert.equal(first.ok,false);assert.equal(first.code,'file_cleanup_unconfirmed');assert.equal(f.panel.retiringPanelId,A);
 const next=await f.request('closeOwned');assert.equal(next.closed,true);assert.equal(attempts,2);assert.equal(f.panel.retiringPanelId,null);
});

test('new registry list cannot conceal a failed file-owner retirement',async t=>{
 const f=fixture(t);await f.request('list');let fail=true;
 f.session.closeCurrent=async()=>{if(fail)throw Object.assign(Error('Synthetic local cleanup'),{code:'file_cleanup_unconfirmed'});return {closed:true};};
 assert.equal((await f.request('list',{panelId:B})).code,'file_cleanup_unconfirmed');
  assert.equal((await f.request('list',{panelId:B})).code,'file_cleanup_unconfirmed');
 fail=false;assert.equal((await f.request('closeOwned',{panelId:B})).closed,true);assert.equal((await f.request('list',{panelId:B})).ok,true);
});
