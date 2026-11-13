'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture}=require('./helpers/qq-transfer-service-fixture.cjs');
const P=require('../src/bot/qq-transfer-client.cjs');
const {QQTransferStage}=require('../src/bot/qq-transfer-stage.cjs');
test('formal helper tus + desktop job/stage uploads exact bytes and publishes once',async t=>{
 const f=await fixture(t),bytes=Buffer.alloc(P.LIMITS.chunk+35,0xad);fs.writeFileSync(f.state.uploadPath,bytes);const p=await f.preview('upload'),r=await f.confirm(p);
 assert.equal(r.job.state,'completed');assert.equal(r.job.published,true);assert.deepEqual(fs.readFileSync(path.join(f.dirs.files,'source.bin')),bytes);
 const j=await f.request('GET','/v1/jobs/'+r.job.jobId);assert.equal(j.json.job.published,true);assert.equal(j.json.job.sha256,P.sha(bytes));
 await f.reopen();const before=f.state.requestCount;assert.equal(f.jobs.list()[0].published,true);assert.equal(f.state.requestCount,before);
});
test('formal helper directory and batch immutable ZIP are saved through manifest-bound Range type',async t=>{
 const f=await fixture(t),dir=path.join(f.dirs.files,'tree');fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'empty'));fs.writeFileSync(path.join(dir,'binary.bin'),Buffer.from([0,255,128,10]));fs.writeFileSync(path.join(f.dirs.files,'second.txt'),'synthetic');
 for(const batch of [false,true]){const listing=await f.open(),ids=listing.entries.filter(e=>batch||e.name==='tree').map(e=>e.entryId);f.state.downloadPath=path.join(f.local,batch?'batch.zip':'tree.zip');
 const p=await f.session.preview({...f.base,viewId:f.viewId,rootId:'files',directoryId:listing.directory.directoryId,operation:'download',selectionId:null,entryIds:ids,operationId:randomUUID()}),r=await f.confirm(p);
 if(r.job.state!=='completed'){let stored=null,readbackCode=null;try{stored=f.jobs.get(r.job.jobId);}catch(e){readbackCode=typeof e?.code==='string'?e.code:'unavailable';}t.diagnostic(JSON.stringify({kind:'zip_download_failure',mode:batch?'batch':'directory',state:r.job.state,code:r.job.code,phase:stored?.pending?.kind??null,attempt:stored?.pending?.state??null,bytes:r.job.completedBytes,totalBytes:r.job.totalBytes,saved:r.job.saved,published:r.job.published,archive:r.job.archive,cleanupPending:r.job.cleanupPending,remoteState:stored?.remote?.state??null,localRecordPublished:stored?.target?.published??null,readbackCode}));}
 assert.equal(r.job.state,'completed');assert.equal(r.job.saved,true);assert.equal(r.job.archive,true);const bytes=fs.readFileSync(f.state.downloadPath);assert.equal(P.sha(bytes),r.job.sha256);assert.equal(bytes.readUInt32LE(0),0x04034b50);
 }
});
test('formal helper fixed JSON errors survive status mapping and cannot overwrite existing target',async t=>{
 const f=await fixture(t),client=new P.QQTransferClient(f.clientOptions);t.after(()=>client.close());const listing=await client.list({rootId:'files',directoryId:null}),bytes=Buffer.from('new');const id=randomUUID(),created=await client.createUpload({clientJobId:id,rootId:'files',directoryId:listing.directory.directoryId,name:'existing.bin',sha256:P.sha(bytes),length:bytes.length});await client.uploadChunk(created.uploadId,0,bytes);fs.writeFileSync(path.join(f.dirs.files,'existing.bin'),'original');
 await assert.rejects(client.finalize(created.uploadId,id),{code:'target_exists',submitted:true});assert.equal(fs.readFileSync(path.join(f.dirs.files,'existing.bin'),'utf8'),'original');
});

test('actual desktop child exit after durable PATCH resumes only after explicit reconcile, including helper restart',async t=>{
 const {spawn}=require('node:child_process'),{createService}=require('../src/transfer-helper/server.cjs'),TLS=require('./helpers/qq-remote-tls-fixture.cjs');
 const f=await fixture(t),bytes=Buffer.alloc(P.LIMITS.chunk+191,0x91);fs.writeFileSync(f.state.uploadPath,bytes);
 const config=path.join(f.local,'synthetic-child.json');fs.writeFileSync(config,JSON.stringify({local:f.local,syntheticVaultKey:f.vaultKey.toString('hex'),base:f.base,revision:f.link.revision,source:f.state.uploadPath}),{mode:0o600});
 const child=spawn(process.execPath,[path.join(__dirname,'helpers/qq-transfer-crash-child.cjs'),config],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',b=>{stderr+=b;if(stderr.length>16384)child.kill();});
 const outcome=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Owned crash child timeout'));},15000);child.once('error',reject);child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});assert.deepEqual(outcome,{code:86,signal:null});assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
 const retained=f.jobs.list();assert.equal(retained.length,1);assert.equal(retained[0].state,'reconcile_required');assert.equal(retained[0].completedBytes,0);const port=f.port;await f.close();f.service=await createService({config:f.config,tls:TLS});await f.service.listen({port});
 await f.reopen();const checked=await f.session.reconcile({...f.base,viewId:f.viewId,jobId:retained[0].jobId,operationId:randomUUID()});assert.equal(checked.job.completedBytes,P.LIMITS.chunk);assert.equal(checked.job.canResume,true);
 const done=await f.session.resume({...f.base,viewId:f.viewId,jobId:retained[0].jobId,operationId:randomUUID()});assert.equal(done.job.published,true);assert.deepEqual(fs.readFileSync(path.join(f.dirs.files,'source.bin')),bytes);assert.equal(done.job.sha256,P.sha(bytes));
});

test('actual desktop exit during second Range retains first durable local prefix, then explicit recovery verifies final hash',async t=>{
 const {spawn}=require('node:child_process');const f=await fixture(t),bytes=Buffer.alloc(P.LIMITS.chunk+193,0x82);fs.writeFileSync(path.join(f.dirs.files,'download-source.bin'),bytes);
 const config=path.join(f.local,'synthetic-child.json');fs.writeFileSync(config,JSON.stringify({kind:'download',local:f.local,syntheticVaultKey:f.vaultKey.toString('hex'),base:f.base,revision:f.link.revision,target:f.state.downloadPath}),{mode:0o600});
 const child=spawn(process.execPath,[path.join(__dirname,'helpers/qq-transfer-crash-child.cjs'),config],{windowsHide:true,stdio:'ignore'});const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Owned child timeout'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});assert.equal(exit,86);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
 const retained=f.jobs.list()[0];assert.equal(retained.state,'reconcile_required');assert.equal(retained.completedBytes,P.LIMITS.chunk);assert.equal(fs.existsSync(f.state.downloadPath),false);
 await f.reopen();const checked=await f.session.reconcile({...f.base,viewId:f.viewId,jobId:retained.jobId,operationId:randomUUID()});assert.equal(checked.job.canResume,true);
 const done=await f.session.resume({...f.base,viewId:f.viewId,jobId:retained.jobId,operationId:randomUUID()});assert.equal(done.job.saved,true);assert.equal(done.job.sha256,P.sha(bytes));assert.deepEqual(fs.readFileSync(f.state.downloadPath),bytes);
});

test('zero-byte upload and download complete without a fabricated Range or retry',async t=>{const f=await fixture(t);fs.writeFileSync(f.state.uploadPath,Buffer.alloc(0));assert.equal((await f.confirm(await f.preview('upload'))).job.published,true);assert.equal(fs.statSync(path.join(f.dirs.files,'source.bin')).size,0);const listing=await f.open(),entry=listing.entries.find(e=>e.name==='source.bin'),p=await f.session.preview({...f.base,viewId:f.viewId,rootId:'files',directoryId:listing.directory.directoryId,operation:'download',selectionId:null,entryIds:[entry.entryId],operationId:randomUUID()}),r=await f.confirm(p);assert.equal(r.job.saved,true);assert.equal(r.job.sha256,P.sha(Buffer.alloc(0)));assert.equal(fs.statSync(f.state.downloadPath).size,0);});
