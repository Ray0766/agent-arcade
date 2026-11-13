'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {QCEExportJobs,record,digest}=require('../src/bot/qq-qce-export-jobs.cjs');
const {vault}=require('./helpers/qq-transfer-fixture.cjs');
function setup(t){const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'arcade-qce-jobs-')),v=vault(),stores=[];const open=()=>{const j=new QCEExportJobs({root,vault:v});stores.push(j);return j;};t.after(()=>{for(const j of stores)j.close();assert(root.startsWith(base+path.sep+'arcade-qce-jobs-'));fs.rmSync(root,{recursive:true,force:true});});return {root,v,open};}
const scope=()=>({accountId:'synthetic-whale',qqAccountId:'100001',workScope:'a'.repeat(64),credentialRevision:randomUUID()});
function input(){const operationId=randomUUID(),outputDir=path.win32.join('C:\\Synthetic-QCE-Exports','agent-arcade-exports',operationId);return {operationId,outputDir,request:{peer:{chatType:1,peerUid:'u_SyntheticPrivatePeer'},format:'JSON',filter:{startTime:1700000000000,endTime:1700001000000},options:{outputDir,batchSize:100,includeResourceLinks:true,includeSystemMessages:false,preferGroupMemberName:true,prettyFormat:true,embedAvatarsAsBase64:false,useNameInFileName:false,useFriendlyFileName:false,skipDownloadResourceTypes:['image','video','audio','file'],filterPureImageMessages:true,exportAsZip:false}}};}
function attempted(j,s){const v=j.begin(s,input());return j.change(s,v.operationId,v.revision,'attempted');}
test('private export request and QQ ownership survive encrypted reopen without any retry',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s);j.close();
 const bytes=fs.readFileSync(path.join(f.root,'qce-export-jobs.sqlite'));for(const text of [s.qqAccountId,s.workScope,v.outputDir,v.request.peer.peerUid])assert.equal(bytes.includes(Buffer.from(text)),false);
 const reopened=f.open(),listed=reopened.list(s);assert.equal(listed.length,1);assert.equal(listed[0].submission,'attempted');assert.equal(listed[0].taskId,null);assert.deepEqual(reopened.get(s,v.operationId),v);
});
test('acknowledged export identity and request digest persist; later state cannot manufacture a replacement task',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s),ack=j.change(s,v.operationId,v.revision,'acknowledged','export_1700000000000_abc123','export.json');
 assert.equal(ack.requestDigest,digest(ack.request));assert.throws(()=>j.change(s,ack.operationId,ack.revision,'acknowledged','export_1700000000001_xyz','other.json'),{code:'invalid_request'});
 j.close();assert.equal(f.open().get(s,v.operationId).fileName,'export.json');
});
test('scope cannot move between profiles, actual QQ or work directories',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s);
 for(const other of [{...s,accountId:'synthetic-other'},{...s,qqAccountId:'200001'},{...s,workScope:'b'.repeat(64)}]){
  assert.deepEqual(j.list(other),[]);assert.throws(()=>j.get(other,v.operationId),{code:'qce_jobs_changed'});assert.throws(()=>j.forget(other,v.operationId,v.revision),{code:'qce_jobs_changed'});
 }
 assert.equal(j.get(s,v.operationId).submission,'attempted');
});
test('credential rotation keeps same-account local metadata removable without adopting task ownership',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s),next={...s,credentialRevision:randomUUID()};
 const records=j.list(next);assert.equal(records.length,1);assert.equal(records[0].scope.credentialRevision,s.credentialRevision);
 assert.throws(()=>j.get(next,v.operationId),{code:'qce_jobs_changed'});assert.throws(()=>j.change(next,v.operationId,v.revision,'unknown'),{code:'qce_jobs_changed'});
 assert.equal(j.forget(next,v.operationId,v.revision).forgotten,true);assert.deepEqual(j.list(next),[]);
});
test('two open journals enforce exact CAS and single attempt before external dispatch',t=>{
 const f=setup(t),a=f.open(),b=f.open(),s=scope(),v=a.begin(s,input()),claimed=a.change(s,v.operationId,v.revision,'attempted');
 assert.throws(()=>b.change(s,v.operationId,v.revision,'attempted'),{code:'qce_jobs_changed'});
 assert.throws(()=>b.change(s,v.operationId,claimed.revision,'attempted'),{code:'invalid_request'});
 const uncertain=b.change(s,v.operationId,claimed.revision,'unknown');assert.equal(a.get(s,v.operationId).revision,uncertain.revision);
 assert.throws(()=>a.change(s,v.operationId,uncertain.revision,'prepared'),{code:'invalid_request'});
});
test('late known receipt can be retained after unknown without creating or adopting another job',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s),unknown=j.change(s,v.operationId,v.revision,'unknown');
 const ack=j.change(s,v.operationId,unknown.revision,'acknowledged','export_1700000000000_a','same.json');assert.equal(ack.taskId,'export_1700000000000_a');assert.equal(j.list(s).length,1);
});
test('lost/invalid ciphertext locks storage and is not replaced by plaintext',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s);j.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(Buffer.from('invalid ciphertext'),v.operationId);j.close();
 const next=f.open();assert.equal(next.state,'locked');assert.throws(()=>next.list(s),{code:'qce_jobs_locked'});assert.equal(fs.readFileSync(path.join(f.root,'qce-export-jobs.sqlite')).includes(Buffer.from('SyntheticPrivatePeer')),false);
});
test('encryption unavailability stops new durable admission before any row is written',t=>{
 const f=setup(t),j=f.open(),s=scope();f.v.isEncryptionAvailable=()=>false;assert.throws(()=>j.begin(s,input()),{code:'qce_jobs_locked'});assert.equal(j.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
});
test('record schema rejects arbitrary routes, credentials, unsafe filenames and output rebinding',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=j.begin(s,input());
 const invalid=[{...v,outputDir:'C:\\Other'}, {...v,request:{...v.request,token:'synthetic'}}, {...v,request:{...v.request,peer:{chatType:9,peerUid:'u_test'}}}, {...v,taskId:'../../other',fileName:'file.json',submission:'acknowledged'}, {...v,taskId:'export_1700000000000_a',fileName:'..\\secret.json',submission:'acknowledged'}, {...v,requestDigest:'0'.repeat(64)}];
 for(const row of invalid)assert.throws(()=>record(row));
 const b=input();b.request.options.outputDir='C:\\Outside';assert.throws(()=>j.begin(s,b));assert.equal(j.list(s).length,1);
});
test('capacity requires explicit local forgetting, preserving upstream task and output bytes',t=>{
 const f=setup(t),j=f.open(),s=scope(),first=attempted(j,s);for(let i=1;i<64;i++)j.begin(s,input());assert.throws(()=>j.begin(s,input()),{code:'qce_jobs_limit'});
 const output=path.join(f.root,'synthetic-output.json');fs.writeFileSync(output,'retained synthetic output');
 assert.deepEqual(j.forget(s,first.operationId,first.revision),{forgotten:true,remoteTaskCancelled:false,filesDeleted:false});assert.equal(fs.readFileSync(output,'utf8'),'retained synthetic output');assert.equal(j.list(s).length,63);assert.equal(j.begin(s,input()).submission,'prepared');
});
test('forget rejects stale revision and cannot consume a later acknowledged receipt',t=>{
 const f=setup(t),j=f.open(),s=scope(),v=attempted(j,s),ack=j.change(s,v.operationId,v.revision,'acknowledged','export_1700000000000_a','test.json');
 assert.throws(()=>j.forget(s,v.operationId,v.revision),{code:'qce_jobs_changed'});assert.equal(j.get(s,v.operationId).revision,ack.revision);
});
test('owned child exit after durable attempt reopens as an uncertain unclaimed job',t=>{
 const {spawnSync}=require('node:child_process'),base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'arcade-qce-jobs-exit-')),s=scope(),v=input(),key=Buffer.alloc(32,19);
 let reopened;
 t.after(()=>{reopened?.close();assert(root.startsWith(base+path.sep+'arcade-qce-jobs-exit-'));fs.rmSync(root,{recursive:true,force:true});});
 const program=`const {QCEExportJobs}=require('./src/bot/qq-qce-export-jobs.cjs');const {vault}=require('./test/helpers/qq-transfer-fixture.cjs');const x=JSON.parse(process.env.QCE_SYNTHETIC_CHILD);const j=new QCEExportJobs({root:x.root,vault:vault(Buffer.alloc(32,19))});const r=j.begin(x.scope,x.input);j.change(x.scope,r.operationId,r.revision,'attempted');process.exit(86);`;
 const child=spawnSync(process.execPath,['-e',program],{cwd:path.resolve(__dirname,'..'),env:{...process.env,QCE_SYNTHETIC_CHILD:JSON.stringify({root,scope:s,input:v})},encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(child.status,86,child.stderr);assert.equal(child.signal,null);assert.throws(()=>process.kill(child.pid,0));
 reopened=new QCEExportJobs({root,vault:vault(key)});const row=reopened.get(s,v.operationId);assert.equal(row.submission,'attempted');assert.equal(row.taskId,null);assert.equal(reopened.list(s).length,1);
});
module.exports={input,scope};
test('a missing named primary journal after binding cannot continue via its open SQLite handle',t=>{
 const f=setup(t),j=f.open(),s=scope();j.begin(s,input());
 const original=fs.lstatSync;
 // Inject only the observed pathname absence; do not claim NTFS removed an
 // open database. The held SQLite connection still contains the real row.
 fs.lstatSync=function(file,...args){if(file===j.file)throw Object.assign(Error('Synthetic primary path absence'),{code:'ENOENT'});return original.call(this,file,...args);};
 try{assert.throws(()=>j.list(s),{code:'qce_jobs_locked'});}finally{fs.lstatSync=original;}
});
