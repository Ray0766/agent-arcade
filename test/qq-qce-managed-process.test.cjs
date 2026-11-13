'use strict';
// Fixed official ZIP bytes are read statically. Process inventory/launcher here
// are synthetic; the separate native case proves actual owned-child shutdown.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./helpers/qq-shell-owner-fixture.cjs');
const QCE=require('../src/bot/qq-qce-managed-process.cjs');
const {verifyQCEListener}=require('../src/bot/qq-qce-binding.cjs');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {QQNodeRuntimeManager}=require('../src/bot/qq-node-runtime.cjs');
const archiveRoot=process.env.ARCADE_QCE_642_CODE;
const options={skip:!archiveRoot?'Fixed official QCE 6.4.2 static fixture not provided':false};
function setup(t){
 const f=fixture(t),plugin=path.join(f.workDir,'plugins','napcat-plugin-qce');fs.mkdirSync(path.dirname(plugin));fs.cpSync(archiveRoot,plugin,{recursive:true});
 const home=path.join(f.base,'home');fs.mkdirSync(home);const savedHome=process.env.USERPROFILE;process.env.USERPROFILE=home;t.after(()=>{if(savedHome===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=savedHome;});
 let nextPort=53010;f.host.allocatePort=async()=>nextPort++;const start=f.host.start;
 f.host.start=async p=>{f.env={...p.env};const child=await start(p),parent=f.state.rows.find(r=>r.parentPid===child.pid),rust={pid:f.state.next++,parentPid:parent.pid,name:'qce-server.exe',executable:path.join(plugin,QCE.EXECUTED[4]),createdAt:'2026-11-07T00:01:02.0000000Z'};f.rust=rust;f.parent=parent;f.state.rows.push(rust);return child;};
 f.listeners=[];f.host.listeners=async()=>f.state.starts?[{pid:f.rust.pid,port:40653,address:'0.0.0.0'},{pid:f.parent.pid,port:Number(f.env.QCE_BRIDGE_PORT),address:'127.0.0.1'},...f.listeners]:f.listeners;
 f.verify=(more={})=>verifyQCEListener({runtime:f.runtime,qqAccountId:f.account,expectedVersion:'6.4.2',assertCurrent(){},...more});return Object.assign(f,{plugin});
}
test('fixed release metadata preserves the old runtime boundary',t=>{assert.equal(QCE.RELEASE.archiveSha256,'625964ba92cb82bb121f94cc3694ab649d6f438d338674f48cfd0722bd708d1b');assert.equal(QCE.RELEASE.files.length,140);assert.equal(QCE.RELEASE.files.find(f=>f.path===QCE.EXECUTED[4]).sha256,'5fb373c12e4d00f721efdb792d3c6bce973e2dd5443dcfd43988e56a8777329a');const f=fixture(t);assert.equal(QCE.installedVersion(f.runtime.instance(f.account)),null);});
test('old legacy 5.5.77 version capture remains readable without granting a new listener permission',t=>{const f=fixture(t),plugin=path.join(f.workDir,'plugins','napcat-plugin-qce');fs.mkdirSync(plugin,{recursive:true});fs.writeFileSync(path.join(plugin,'package.json'),JSON.stringify({name:QCE.PLUGIN,version:'5.5.77'}));const runtime={managed:null,instance:()=>({...f.runtime.instance(f.account),installationKind:'legacy'})};assert.equal(QCE.readManagedQCEVersion({runtime,qqAccountId:f.account}),'5.5.77');});
test('fixed official code produces a launch-bound child and two matching host/child listener observations',options,async t=>{
 const f=setup(t);await f.runtime.start(f.account);const run=f.runtime.runs.get(f.account);assert.equal(run.lease.binding.version,2);assert.equal(run.lease.binding.qce.version,'6.4.2');assert.equal(f.env.QCE_NO_AUTO_OPEN,'1');assert.equal(f.env.QCE_BRIDGE_PORT,'53010');assert.equal(f.env.QCE_SERVER_PORT,'40653');assert.equal(f.env.QCE_RUST_SERVER_PATH,f.rust.executable);assert.equal(QCE.readManagedQCEVersion({runtime:f.runtime,qqAccountId:f.account}),'6.4.2');
 let observes=0;const original=f.host.listeners;f.host.listeners=async()=>{observes++;return original();};const result=await f.verify();assert.equal(result.ownershipVerified,true);assert.equal(observes,2);assert.equal(result.port,40653);assert(run.lease.runtimeTree.some(p=>p.pid===f.rust.pid));
 await f.runtime.stop(f.account);assert.equal(f.state.stops.length,1);assert(f.state.stops[0].some(p=>p.pid===f.rust.pid));assert.equal(f.state.rows.length,1);assert.equal(fs.existsSync(run.lease.file),false);
});
test('wrong binary bytes or same-byte replacement never become a newly owned runtime',options,async t=>{
 for(const kind of ['bytes','inode']){await t.test(kind,async t=>{const f=setup(t),binary=path.join(f.plugin,QCE.EXECUTED[4]);if(kind==='bytes'){fs.writeFileSync(binary,'not the fixed executable');await assert.rejects(f.runtime.start(f.account),{code:'qce_process_unverified'});assert.equal(f.state.starts,0);}else{await f.runtime.start(f.account);fs.renameSync(binary,binary+'.retained');fs.copyFileSync(binary+'.retained',binary);await assert.rejects(f.verify(),{code:'qce_process_unverified'});await assert.rejects(f.runtime.stop(f.account));assert.equal(f.state.stops.length,0);}});}
});
test('default bridge, occupied private bridge and another account API reject before spawn without stopping its owner',options,async t=>{
 for(const kind of ['default','occupied','other-api'])await t.test(kind,async t=>{const f=setup(t);if(kind==='default')f.host.allocatePort=async()=>40654;else f.listeners.push({pid:888888,port:kind==='other-api'?40653:53010,address:'127.0.0.1'});await assert.rejects(f.runtime.start(f.account));assert.equal(f.state.starts,0);assert.equal(f.state.stops.length,0);assert.equal(f.listeners.length,kind==='default'?0:1);});
});
test('QCE overrides never leak from the app environment into a managed launch',options,async t=>{
 const f=setup(t),names=['QCE_BRIDGE_PORT','QCE_SERVER_PORT','QCE_CONFIG_DIR','QCE_SERVER_PATH','QCE_SERVER_BIN','QCE_RUST_SERVER_PATH','QCE_BRIDGE_ENDPOINT','QCE_STATIC_DIR','QCE_NO_AUTO_OPEN'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));for(const n of names)process.env[n]='SYNTHETIC_FORBIDDEN_OVERRIDE';try{await f.runtime.start(f.account);assert.equal(f.env.QCE_BRIDGE_PORT,'53010');assert.equal(f.env.QCE_SERVER_PORT,'40653');assert.equal(f.env.QCE_NO_AUTO_OPEN,'1');assert.equal(f.env.USERPROFILE,path.join(f.base,'home'));for(const n of ['QCE_CONFIG_DIR','QCE_SERVER_PATH','QCE_SERVER_BIN','QCE_BRIDGE_ENDPOINT','QCE_STATIC_DIR'])assert.equal(Object.hasOwn(f.env,n),false);await f.runtime.stop(f.account);}finally{for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}
});
test('an unrelated executable, extra child, or another Rust sibling is never admitted by name',options,async t=>{
 const f=setup(t);await f.runtime.start(f.account);const original=f.state.rows.map(r=>({...r}));for(const kind of ['path','child','sibling']){f.state.rows=original.map(r=>({...r}));const rust=f.state.rows.find(r=>r.pid===f.rust.pid);if(kind==='path')rust.executable=path.join(f.base,'qce-server.exe');else if(kind==='child')f.state.rows.push({...rust,pid:999901,parentPid:rust.pid});else f.state.rows.push({...rust,pid:999902});await assert.rejects(f.runtime.stop(f.account));assert.equal(f.state.stops.length,0);}
});
test('bridge belongs to the exact Rust parent; PID reuse, wrong endpoint and a second-round change reject',options,async t=>{
 const f=setup(t);await f.runtime.start(f.account);const original=f.host.listeners;
 for(const kind of ['foreign-bridge','wildcard-bridge','api-qq','late-change']){let rounds=0;f.host.listeners=async()=>{const rows=await original();rounds++;if(kind==='foreign-bridge')rows[1].pid=999999;if(kind==='wildcard-bridge')rows[1].address='0.0.0.0';if(kind==='api-qq')rows[0].pid=f.parent.pid;if(kind==='late-change'&&rounds===2)rows[1].pid=999998;return rows;};await assert.rejects(f.verify(),{code:'qce_listener_unverified'});}
 f.host.listeners=original;f.rust.createdAt='2026-11-07T02:01:02.0000000Z';await assert.rejects(f.verify(),{code:'qce_listener_unverified'});
});
test('missing launch proof cannot be repaired by discovering a new qce-server and Node stays unsupported',options,async t=>{
 const f=setup(t);await f.runtime.start(f.account);const run=f.runtime.runs.get(f.account),saved=run.lease.binding;run.lease.binding={...saved,version:1};delete run.lease.binding.qce;assert.throws(()=>QCE.readManagedQCEVersion({runtime:f.runtime,qqAccountId:f.account}),{code:'qce_process_unverified'});await assert.rejects(f.verify(),{code:'qce_process_unverified'});run.lease.binding=saved;
 const node=Object.create(QQNodeRuntimeManager.prototype);Object.assign(node,{managed:{},runs:f.runtime.runs,instance:()=>({...f.runtime.instance(f.account),installationKind:'managed-node'})});await assert.rejects(verifyQCEListener({runtime:node,qqAccountId:f.account,expectedVersion:'6.4.2',assertCurrent(){}}),{code:'qce_version_unsupported'});
});
test('dead-manager recovery retains the fixed binary proof and stops only its recorded tree',options,async t=>{
 const f=setup(t);await f.runtime.start(f.account);const old=f.deadManager(),next=f.fresh();const recovered=await next.recover(f.account);assert.equal(recovered.recovery,'adopted');assert.equal(next.runs.get(f.account).lease.binding.qce.archiveSha256,QCE.RELEASE.archiveSha256);await next.stop(f.account);assert.equal(f.state.stops.length,1);assert(f.state.stops[0].some(p=>p.pid===f.rust.pid));assert.equal(fs.existsSync(old.file),false);
});
test('a recorded dead launcher may clean its exact surviving QQ and Rust descendants without new permission',options,async t=>{
 const f=setup(t);await f.runtime.start(f.account);const lease=f.deadManager();f.state.rows=f.state.rows.filter(r=>r.pid!==lease.runtime.pid);const next=f.fresh();const preview=await next.previewOrphanCleanup(f.account);assert.equal(preview.count,2);const result=await next.cleanupOrphans(f.account,{expectedDigest:preview.expectedDigest});assert.equal(result.recovery,'orphans-cleared');assert.equal(f.state.stops.length,1);assert(f.state.stops[0].some(p=>p.pid===f.rust.pid));
});
test('disabled fixed QCE can be explicitly enabled only on the prepared host, with fresh migration and free-port proofs',options,async t=>{
 const f=setup(t),start=f.host.start;f.host.start=async p=>{const child=await start(p);f.state.rows=f.state.rows.filter(r=>r.pid!==f.rust.pid);return child;};f.host.listeners=async()=>f.listeners;
 await f.runtime.start(f.account);const request={runtime:f.runtime,qqAccountId:f.account,assertCurrent(){}};let calls=0;const listeners=f.host.listeners;f.host.listeners=async()=>{calls++;return listeners();};
 const guard=await QCE.verifyManagedQCEEnable(request);assert.equal(calls,2);guard.assertCurrent();
 for(const port of [40653,Number(f.env.QCE_BRIDGE_PORT)]){f.listeners=[{pid:888888,port,address:'127.0.0.1'}];await assert.rejects(QCE.verifyManagedQCEEnable(request),{code:'qce_port_unavailable'});assert.equal(f.state.stops.length,0);}f.listeners=[];
 const base=path.join(f.env.USERPROFILE,'.qq-chat-exporter');fs.mkdirSync(path.join(base,'exports'),{recursive:true});assert.throws(()=>guard.assertCurrent(),{code:'qce_startup_changed'});await assert.rejects(QCE.verifyManagedQCEEnable(request),{code:'qce_startup_migration_required'});
 fs.rmdirSync(path.join(base,'exports'));fs.rmdirSync(base);const fresh=await QCE.verifyManagedQCEEnable(request),run=f.runtime.runs.get(f.account);f.runtime.runs.delete(f.account);assert.throws(()=>fresh.assertCurrent(),{code:'qce_process_unverified'});f.runtime.runs.set(f.account,run);
 const controller=new AbortController();controller.abort();await assert.rejects(QCE.verifyManagedQCEEnable({...request,signal:controller.signal}),{code:'qce_process_unverified'});
 await f.runtime.stop(f.account);
});
