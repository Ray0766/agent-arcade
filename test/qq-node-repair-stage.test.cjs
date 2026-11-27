'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const yazl=require('yazl'),F=require('../src/bot/qq-node-repair-fs.cjs'),{QQNodeRepairStage}=require('../src/bot/qq-node-repair-stage.cjs');
async function zip(entries){const z=new yazl.ZipFile(),parts=[];const done=new Promise((resolve,reject)=>{z.outputStream.on('data',x=>parts.push(x));z.outputStream.on('end',()=>resolve(Buffer.concat(parts)));z.outputStream.on('error',reject);});for(const [name,bytes]of entries)z.addBuffer(Buffer.from(bytes),name,{compress:false});z.end();return done;}
async function fixture(t,entries=[['index.js','SYNTHETIC_NO_EXECUTION'],['nested/value.bin',Buffer.from([0,255,3])]],mutate=x=>x){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-repair-stage-')),operationDir=path.join(root,'operation');fs.mkdirSync(operationDir);const file=path.join(root,'archive.zip');fs.writeFileSync(file,mutate(await zip(entries)));const io=Object.create(fs),options={packages:{verify:async()=>assert.fail('Synthetic parser fixture bypasses only official pin lookup'),stage:async()=>assert.fail('No network')},io};
 class SyntheticArchiveStage extends QQNodeRepairStage{async _artifact(){return {artifact:{file},proof:F.read(file,{bytes:false,io})};}}
 const stage=new SyntheticArchiveStage(options),manifest={files:entries.map(([name,body])=>({path:name,size:Buffer.byteLength(body),sha256:F.sha(Buffer.from(body))})),directories:[...new Set(entries.flatMap(([name])=>{const parts=name.split('/'),dirs=[];for(let n=1;n<parts.length;n++)dirs.push(parts.slice(0,n).join('/'));return dirs;}))]};
 t.after(async()=>{await stage.close();const resolved=fs.realpathSync(root);assert(resolved.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});return {root,operationDir,file,io,stage,manifest};
}
test('actual parser/streams write exact binary bytes with one owned archive fd and full manifest proof',async t=>{
 const f=await fixture(t);let open=0,close=0;f.io.openSync=(...a)=>{open++;return fs.openSync(...a);};f.io.closeSync=fd=>{close++;fs.closeSync(fd);};const r=await f.stage.prepare({operationDir:f.operationDir,manifest:f.manifest});assert.equal(r.proof.files,2);assert.deepEqual(fs.readFileSync(path.join(r.path,'nested','value.bin')),Buffer.from([0,255,3]));assert.equal(f.stage.handles.size,0);assert.equal(open,close);assert.equal(f.stage.captureOwnedTree(f.operationDir).digest,r.proof.digest);
});
test('real CRC mismatch and forged manifest SHA fail before publication and keep only proven disposable stage',async t=>{
 for(const kind of ['crc','sha']){const f=await fixture(t,undefined,raw=>{if(kind==='crc'){const at=raw.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));raw.writeUInt32LE((raw.readUInt32LE(at+16)^123)>>>0,at+16);}return raw;});if(kind==='sha')f.manifest.files[0].sha256='a'.repeat(64);await assert.rejects(f.stage.prepare({operationDir:f.operationDir,manifest:f.manifest}),{code:'archive_invalid'});assert.equal(f.stage.handles.size,0);assert(f.stage.captureOwnedTree(f.operationDir).present);}
});
test('path traversal, duplicate case, unexpected inventory and expansion limits reject exact synthetic ZIP inputs',async t=>{
 const scenarios=[{entries:[['safe.js','x']],mutate:raw=>Buffer.from(raw.toString('latin1').replaceAll('safe.js','../x.js'),'latin1')},{entries:[['a.js','x'],['A.js','y']]},{entries:[['a.js','x']],manifest:true},{entries:[['a.js','x']],mutate:raw=>{const at=raw.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));raw.writeUInt32LE(134217729,at+24);return raw;}}];
 for(const item of scenarios){const f=await fixture(t,item.entries,item.mutate);if(item.manifest)f.manifest.files=[];await assert.rejects(f.stage.prepare({operationDir:f.operationDir,manifest:f.manifest}));assert.equal(f.stage.handles.size,0);assert(!fs.existsSync(path.join(f.operationDir,'staged-code')));}
});
test('source pin mismatch is rejected by the unmodified production stage before opening an archive',async t=>{
 const f=await fixture(t),stage=new QQNodeRepairStage({packages:{verify:async()=>({component:'napcat-node',version:'4.18.42',state:'verified-staged',file:f.file,size:10,sha256:'a'.repeat(64),assetId:1}),stage:async()=>assert.fail('No retry')}});await assert.rejects(stage.prepare({operationDir:f.operationDir,manifest:f.manifest}),{code:'node_repair_source_unavailable'});await stage.close();
});
test('unknown initial output fstat proof never closes a reused foreign descriptor',async t=>{
 const f=await fixture(t);
 const unknown=path.join(f.operationDir,'unknown'),foreignFile=path.join(f.operationDir,'foreign');
 const slot=41;
 let backing=null,firstStat=true,closeCalls=0;
 f.io.openSync=(...args)=>{
   assert.equal(backing,null);
   backing=fs.openSync(...args);
   return slot;
 };
 f.io.fstatSync=(fd,options)=>{
   assert.equal(fd,slot);
   if(firstStat)throw Object.assign(Error('Synthetic first fstat failure'),{code:'EIO'});
   if(backing===null)throw Object.assign(Error('Closed fixture slot'),{code:'EBADF'});
   return fs.fstatSync(backing,options);
 };
 f.io.closeSync=fd=>{
   assert.equal(fd,slot);
   closeCalls++;
   fs.closeSync(backing);
   backing=null;
 };
 try{
   assert.throws(()=>f.stage._open(unknown,'wx'),{code:'node_repair_cleanup_unconfirmed'});
   assert(f.stage.handles.has(slot));
   fs.closeSync(backing);
   backing=null;
   // The same stage-visible slot now designates a different, real open file.
   backing=fs.openSync(foreignFile,'wx');
   firstStat=false;
   assert.throws(()=>f.stage._close(slot),{code:'node_repair_cleanup_unconfirmed'});
   assert.equal(closeCalls,0);
   fs.writeSync(backing,Buffer.from('foreign survives'));
 }finally{
   if(backing!==null)fs.closeSync(backing);
   backing=null;
   firstStat=false;
 }
 await f.stage.close();
 assert.equal(f.stage.handles.size,0);
 assert.equal(fs.readFileSync(foreignFile,'utf8'),'foreign survives');
});
test('held archive close failure retains the exact descriptor until a separate cleanup succeeds',async t=>{
 const f=await fixture(t);let failedFd;f.io.closeSync=fd=>{if(f.stage.handles.has(fd)&&f.stage.handles.get(fd).file===f.file){failedFd=fd;throw Object.assign(Error('Synthetic close failure'),{code:'EIO'});}fs.closeSync(fd);};await assert.rejects(f.stage.prepare({operationDir:f.operationDir,manifest:f.manifest}),{code:'node_repair_cleanup_unconfirmed'});assert(f.stage.handles.has(failedFd));f.io.closeSync=fs.closeSync;await f.stage.close();assert.equal(f.stage.handles.size,0);
});
