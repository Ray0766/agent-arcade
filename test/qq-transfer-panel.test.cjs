'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {QQTransferLinks}=require('../src/bot/qq-transfer-links.cjs');
const {QQTransferPanel}=require('../src/bot/qq-transfer-panel.cjs');
const {validateRemoteOrigin:validateOrigin,validateRemoteTrust:validateTrust}=require('../src/bot/qq-remote-transport.cjs');
const TLS=require('./helpers/qq-remote-tls-fixture.cjs');
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).map(b=>b^0x5a),decryptString:b=>Buffer.from(b).map(v=>v^0x5a).toString()};
const value=()=>({label:'Optional helper',origin:'https://helper.example',instanceId:randomUUID(),token:'synthetic-helper-token-not-real-000000000000000001',trust:{}});
const hold=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const code=c=>e=>e.code===c;
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-transfer-panel-')),B={remoteId:randomUUID(),panelId:randomUUID()};
 const parent={...B,contextKey:'same-window-owner',entry:{remoteId:B.remoteId,revision:randomUUID()}},state={pick:null,closeGate:null,rows:[],scopes:new Map(),network:0,closed:0,verify:0};
 const links=new QQTransferLinks({root,vault,validateOrigin,validateTrust});let captured,session;
 const jobs={list(){if(state.locked)throw Object.assign(Error('synthetic'),{code:'transfer_locked'});return structuredClone(state.rows);},get:id=>({scope:state.scopes.get(id)})};
 const panel=new QQTransferPanel({links,jobs,captureParent:input=>{if(input.remoteId!==parent.remoteId||input.panelId!==parent.panelId)throw Object.assign(Error('synthetic'),{code:'changed'});return structuredClone(parent);},verifyParent:async(_input,options)=>{options.assertCurrent();state.verify++;return {verified:true};},validateTrust,pickCA:async()=>state.pick?state.pick.promise:null,sessionFactory:options=>{captured=options;session={async closeCurrent(){state.closed++;await state.closeGate?.promise;return {closed:true};},async close(){return {closed:true};},async open(input){state.network++;return {viewId:randomUUID(),helperId:input.helperId};}};return session;}});
 t.after(async()=>{state.closeGate?.resolve();state.pick?.resolve(null);await panel.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,B,parent,state,links,jobs,panel,session,get captured(){return captured;},async settings(){return panel.settings(B);},async create(){await panel.settings(B);return panel.create({...B,value:value()});}};
}
test('local settings/jobs inspection never contacts parent or helper and scopes unrelated jobs out',async t=>{const f=fixture(t);f.state.rows=[{jobId:randomUUID(),remoteId:randomUUID()}];const r=await f.settings();assert.deepEqual(r,{links:{state:'ready',items:[]},jobs:{state:'ready',items:[]}});assert.equal(f.state.network,0);assert.equal(f.state.verify,0);});
test('link save binds parent revision in main, hides key, and refuses renderer-invented parent fields',async t=>{
 const f=fixture(t);await f.settings();const v=value(),r=await f.panel.create({...f.B,value:v});assert.equal(r.link.remoteRevision,f.parent.entry.revision);assert.equal(r.link.remoteId,f.B.remoteId);assert.equal(JSON.stringify(r).includes(v.token),false);assert.throws(()=>f.panel.create({...f.B,value:{...value(),remoteRevision:randomUUID()}}));assert.equal(f.state.network,0);
});
test('empty token omission keeps credential while explicit update rebinds stale parent only on save',async t=>{
 const f=fixture(t),{link}=await f.create(),token=f.links.capture(link.helperId).token;f.parent.entry.revision=randomUUID();const settings=await f.settings();assert.equal(settings.links.items[0].parentChanged,true);assert.equal(f.links.capture(link.helperId).remoteRevision,link.remoteRevision);
 const r=await f.panel.update({...f.B,helperId:link.helperId,revision:link.revision,patch:{label:'Updated'}});assert.equal(r.link.remoteRevision,f.parent.entry.revision);assert.equal(f.links.capture(link.helperId).token,token);assert.equal(r.link.credentialRevision,link.credentialRevision);
});
test('forget removes only helper credential and retains recovery jobs',async t=>{const f=fixture(t),{link}=await f.create();assert.deepEqual(await f.panel.forget({...f.B,helperId:link.helperId,revision:link.revision}),{forgotten:true,jobsRetained:true});assert.equal(f.links.snapshot().items.length,0);assert.equal(f.state.network,0);});
test('private job scope disables stale-link and expired actions without changing stored jobs',async t=>{
 const f=fixture(t),{link}=await f.create(),jobId=randomUUID();f.state.rows=[{jobId,remoteId:f.B.remoteId,helperId:link.helperId,expiresAt:Date.now()+10000,canResume:true,canReconcile:true,canFinish:true}];f.state.scopes.set(jobId,{remoteRevision:link.remoteRevision,helperRevision:link.revision,origin:link.origin,instanceId:link.instanceId,trustRevision:link.trustRevision,credentialRevision:link.credentialRevision});assert.equal((await f.settings()).jobs.items[0].canResume,true);
 f.links.update({helperId:link.helperId,revision:link.revision,patch:{label:'Changed'}});const r=await f.settings();assert.equal(r.jobs.items[0].canResume,false);assert.equal(r.jobs.items[0].canFinish,false);assert.equal(f.state.rows[0].canResume,true);
});
test('locked recovery store does not pretend empty-ready or prevent inspecting encrypted links',async t=>{const f=fixture(t);f.state.locked=true;assert.deepEqual((await f.settings()).jobs,{state:'locked',items:[]});});
test('parent changes during picker discard the selection and prevent link mutation',async t=>{
 const f=fixture(t);await f.settings();f.state.pick=hold();const pending=f.panel.pickCAFile(f.B);await new Promise(r=>setImmediate(r));f.parent.contextKey='new-account';f.state.pick.resolve(null);await assert.rejects(pending,code('changed'));assert.equal(f.links.snapshot().items.length,0);
});
test('CA chooser returns a short-lived reference and fingerprints, never file path or PEM',async t=>{
 const f=fixture(t);await f.settings();const file=path.join(f.root,'synthetic-ca.pem');fs.writeFileSync(file,TLS.caPem);f.state.pick=hold();f.state.pick.resolve(file);const picked=await f.panel.pickCAFile(f.B);assert.equal(JSON.stringify(picked).includes(f.root),false);assert.equal(JSON.stringify(picked).includes('BEGIN CERTIFICATE'),false);const r=await f.panel.create({...f.B,value:{...value(),trust:{caSelectionId:picked.ca.selectionId}}});assert.equal(r.link.trust.privateCA,true);assert.equal(f.links.capture(r.link.helperId).trust.caPem,TLS.caPem);
});
test('fresh proof binds exact helper and parent; no expected identity is accepted as actual proof',async t=>{
 const f=fixture(t),{link}=await f.create(),entry=f.links.capture(link.helperId),context=f.captured.captureContext();assert.deepEqual(await f.captured.verifyScope({entry,context},{assertCurrent(){}}),{verified:true});assert.equal(f.state.verify,1);
 await assert.rejects(f.captured.verifyScope({entry:{...entry,token:'altered'},context},{assertCurrent(){}}));f.parent.entry.revision=randomUUID();await assert.rejects(f.captured.verifyScope({entry,context},{assertCurrent(){}}));assert.equal(f.state.verify,1);
});
test('foreign close cannot end current transfer; current close invalidates pending returns',async t=>{
 const f=fixture(t);await f.settings();const n=f.state.closed;assert.deepEqual(await f.panel.closeOwned({...f.B,panelId:randomUUID()}),{closed:true});assert.equal(f.state.closed,n);await f.panel.closeOwned(f.B);assert.throws(()=>f.captured.captureContext(),code('scope_unavailable'));
});
test('overlapping settings cannot let an older completion adopt a newer owner',async t=>{
 const f=fixture(t);f.state.closeGate=hold();const first=f.settings(),second=f.settings();f.state.closeGate.resolve();await assert.rejects(first,code('changed'));assert.equal((await second).links.state,'ready');
});
test('unexpected private errors are reduced to a fixed code',async t=>{const f=fixture(t);const r=await f.panel.result(f.B,()=>{throw Error('synthetic-private-key-never-echo');});assert.equal(r.code,'transfer_failed');assert.equal(JSON.stringify(r).includes('private-key'),false);});
