'use strict';
// Actual main/preload/registry/session/client chain with inert remote responses.
// Local picker fixtures use fresh temporary files, never a real account/vault.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fixture,add,base,hold,until}=require('./helpers/qq-remote-login-main-fixture.cjs');
const {zip}=require('./helpers/qq-plugin-artifact-fixture.cjs');
const TEXT='SYNTHETIC_FILE_TEXT_NOT_GLOBAL',STAMP='2026-11-07T00:00:00.000Z';
const fileBytes=row=>row.bytes??Buffer.from(row.text);
function setup(t){
 const files=new Map([['/fixture',{directory:true}],['/fixture/notes',{directory:true}],['/fixture/hello.txt',{text:TEXT}]]),wire=[];
 let f;
 const factory=({state})=>({closed:false,close(){this.closed=true;},async json(route,options){
  await state.beforeFile?.(route,options);options.assertCurrent();if(options.signal.aborted)throw Object.assign(Error('Cancelled'),{code:'cancelled',submitted:false});
  options.onAttempt?.();wire.push({route,body:structuredClone(options.body),query:structuredClone(options.query),credential:options.credential});
  let data=true;const query=options.query,body=options.body;
  if(route==='fileList'){const prefix=query.path+'/';data=[...files].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,row])=>({name:p.slice(prefix.length),isDirectory:!!row.directory,size:row.directory?0:fileBytes(row).length,mtime:STAMP}));}
  else if(route==='fileRead')data=files.get(query.path).text;
  else if(route==='fileCreate')files.set(body.path,{text:''});
  else if(route==='fileMkdir')files.set(body.path,{directory:true});
  else if(route==='fileWrite')files.set(body.path,{text:body.content});
  else if(route==='fileDelete')files.delete(body.path);
  else throw Error('Unexpected synthetic route '+route);
  if(state.dropFileReply&&!['fileList','fileRead'].includes(route))throw Object.assign(Error('Synthetic lost response'),{code:'timeout',submitted:true});
  await state.afterFile?.(route,options);return {code:0,data};
 },async upload(input,options){
  options.assertCurrent();await input.sources.verify(options);options.onAttempt?.();wire.push({route:'fileUpload'});
  for(let i=0;i<input.sources.files.length;i++){const chunks=[];for await(const chunk of input.sources.chunks(i,options))chunks.push(chunk);const bytes=Buffer.concat(chunks);files.set(input.remoteDirectory+'/'+input.sources.files[i].name,{text:bytes.toString('utf8'),bytes});}
  return {code:0,data:true};
 },async download(input,options){
  options.assertCurrent();assert.equal(input.remotePaths.length,1);wire.push({route:'fileDownload'});
  // The fixed server decides compression from filesystem type, not our sink flag.
  const source=input.remotePaths[0],prefix=source+'/',bytes=files.get(source).directory?await zip([...files].filter(([p,row])=>p.startsWith(prefix)&&!row.directory).map(([p,row])=>[path.posix.basename(source)+p.slice(source.length),fileBytes(row)])):fileBytes(files.get(source));
  await input.sink.write(bytes,options);return input.sink.finish({...options,archive:input.archive});
 }});
 f=fixture(t,{fileTransportFactory:factory});f.state.isLogin=true;return {...f,files,wire};
}
async function open(f){const row=await add(f),read=await f.invoke('Read',base(row));assert.equal(read.ok,true,JSON.stringify(read));const result=await f.invoke('FilesOpen',{...base(row),observationId:read.profile.observationId,operationId:randomUUID(),rootPath:'/fixture'});assert.equal(result.ok,true,JSON.stringify(result));return {...base(row),files:result.files,profile:read.profile};}
const view=row=>({...base(row),fileViewId:row.files.fileViewId});
async function previewCreate(f,row,name='new.txt'){const r=await f.invoke('FilesPreview',{...view(row),operationId:randomUUID(),observationId:row.files.observationId,directoryId:row.files.directory.directoryId,operation:'create',selectionIds:[],value:{name}});assert.equal(r.ok,true,JSON.stringify(r));return r.preview;}
const confirm=(f,row,preview)=>f.invoke('FilesConfirm',{...view(row),operationId:randomUUID(),ticketId:preview.ticketId,expectedDigest:preview.expectedDigest});
async function previewCopy(f,row){return f.invoke('FilesPreview',{...view(row),operationId:randomUUID(),observationId:row.files.observationId,directoryId:row.files.directory.directoryId,operation:'copy',selectionIds:[row.files.entries.find(e=>e.name==='hello.txt').entryId],value:{destinationId:row.files.entries.find(e=>e.name==='notes').entryId}});}
test('actual file IPC reuses verified authentication and keeps content out of snapshots',async t=>{
 const f=setup(t),row=await open(f);assert.equal(f.requests.filter(r=>r.route==='login').length,1);assert.equal(row.files.entries.length,2);
 const entry=row.files.entries.find(e=>e.name==='hello.txt'),read=await f.invoke('FilesRead',{...view(row),entryId:entry.entryId,operationId:randomUUID()});assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.document.text,TEXT);assert.equal(read.document.exactRemoteBytesVerified,false);
 assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/SYNTHETIC_FILE_TEXT|syntheticLoginCredential|\/fixture/);
 assert(f.wire.every(row=>row.credential==='syntheticLoginCredential'));assert.doesNotMatch(JSON.stringify(read),/syntheticLoginCredential/);
});

test('actual main copy previews bytes privately, writes once and observes the destination',async t=>{
 const f=setup(t),row=await open(f),prepared=await previewCopy(f,row);assert.equal(prepared.ok,true,JSON.stringify(prepared));
 assert.equal(prepared.preview.operation,'copy');assert.equal(prepared.preview.copy.bytes,Buffer.byteLength(TEXT));assert.equal(prepared.preview.copy.sourceSnapshotVerified,false);
 assert.equal(f.wire.filter(r=>r.route==='fileUpload').length,0);assert.equal(f.state.pickerCalls.length,0);assert.doesNotMatch(JSON.stringify(prepared),/SYNTHETIC_FILE_TEXT|syntheticLoginCredential/);
 assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/SYNTHETIC_FILE_TEXT|syntheticLoginCredential|\/fixture/);
 const result=await confirm(f,row,prepared.preview);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.change.outcome,'acknowledged');assert.equal(result.change.observation.state,'match');
 assert.equal(f.files.get('/fixture/notes/hello.txt').text,TEXT);assert.equal(f.files.get('/fixture/hello.txt').text,TEXT);assert.equal(f.wire.filter(r=>r.route==='fileUpload').length,1);
 assert.equal(result.change.copy.cleanupVerified,true);assert.equal((await confirm(f,row,prepared.preview)).ok,false);assert.equal(f.wire.filter(r=>r.route==='fileUpload').length,1);
 assert.equal((await f.invoke('FilesClose',view(row))).closed,true);assert.equal(f.api.panel().session.fileStages.size,0);
});

test('actual main rejects copy authority injection before raw downloads or writes',async t=>{
 const f=setup(t),row=await open(f),before=f.wire.length;
 const input={...view(row),operationId:randomUUID(),observationId:row.files.observationId,directoryId:row.files.directory.directoryId,operation:'copy',selectionIds:[row.files.entries.find(e=>e.name==='hello.txt').entryId],value:{destinationId:row.files.entries.find(e=>e.name==='notes').entryId}};
 for(const extra of [{remotePath:'/another'},{url:'https://other.invalid'},{localPath:'C:\\not-picked.txt'}])assert.equal((await f.invoke('FilesPreview',{...input,value:{...input.value,...extra}})).ok,false);
 assert.equal(f.wire.length,before);assert(!f.files.has('/fixture/notes/hello.txt'));
});

test('actual account replacement revokes a prepared copy without a late remote write',async t=>{
 const f=setup(t),row=await open(f),prepared=await previewCopy(f,row);assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const session=f.api.panel().session;f.accounts.selectedId='second';f.api.observe();
 const result=await confirm(f,row,prepared.preview);assert.equal(result.ok,false);await session.retiring;
 assert.equal(f.wire.filter(r=>r.route==='fileUpload').length,0);assert(!f.files.has('/fixture/notes/hello.txt'));assert.equal(session.fileStages.size,0);
});
async function extractionFixture(t){
 const {QQRemoteFileExtract}=require('../src/bot/qq-remote-files-extract.cjs');
 const f=setup(t),binary=Buffer.from([0,255,128,13,10,42]),content=Buffer.from('SYNTHETIC_ARCHIVE_CONTENT_NOT_GLOBAL');
 const archive=await zip([['parcel/nested/payload.bin',binary],['parcel/empty/',''],['readme.txt',content]]);
 f.files.set('/fixture/parcel.zip',{bytes:archive});const row=await open(f);
 f.api.panel().session.fileExtractFactory=args=>new QQRemoteFileExtract({...args,paceMs:0});
 const input={...view(row),operationId:randomUUID(),observationId:row.files.observationId,directoryId:row.files.directory.directoryId,operation:'extract',selectionIds:[row.files.entries.find(e=>e.name==='parcel.zip').entryId],value:{destinationId:row.files.entries.find(e=>e.name==='notes').entryId}};
 return {...f,row,input,binary,content,archive};
}

test('actual main extraction binds original ZIP bytes and output roots to one confirmation',async t=>{
 const f=await extractionFixture(t),prepared=await f.invoke('FilesPreview',f.input);assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const preview=prepared.preview;assert.equal(preview.operation,'extract');assert.equal(preview.targets.length,1);assert.equal(preview.extraction.archiveBytes,f.archive.length);assert.equal(preview.extraction.archiveEntriesVerified,true);assert.equal(preview.extraction.sourceSnapshotVerified,false);
 assert.deepEqual(preview.extraction.targets.map(x=>x.relativePath),['notes/parcel','notes/readme.txt']);assert.equal(f.wire.filter(x=>['fileMkdir','fileUpload'].includes(x.route)).length,0);assert.equal(f.state.pickerCalls.length,0);
 assert.doesNotMatch(JSON.stringify(prepared),/SYNTHETIC_ARCHIVE_CONTENT_NOT_GLOBAL|syntheticLoginCredential/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/SYNTHETIC_ARCHIVE_CONTENT_NOT_GLOBAL|syntheticLoginCredential|\/fixture/);
 const result=await confirm(f,f.row,preview);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.change.outcome,'acknowledged');assert.equal(result.change.observation.state,'match');
 assert.deepEqual(fileBytes(f.files.get('/fixture/notes/parcel/nested/payload.bin')),f.binary);assert.deepEqual(fileBytes(f.files.get('/fixture/notes/readme.txt')),f.content);assert.equal(f.files.get('/fixture/notes/parcel/empty').directory,true);assert.deepEqual(fileBytes(f.files.get('/fixture/parcel.zip')),f.archive);
 assert.equal(result.change.extraction.completedItems,2);assert.equal(result.change.extraction.cleanupVerified,true);const writes=f.wire.filter(x=>['fileMkdir','fileUpload'].includes(x.route)).length;
 assert.equal((await confirm(f,f.row,preview)).ok,false);assert.equal(f.wire.filter(x=>['fileMkdir','fileUpload'].includes(x.route)).length,writes);assert.equal((await f.invoke('FilesClose',view(f.row))).closed,true);assert.equal(f.api.panel().session.fileStages.size,0);
});

test('actual main extraction rejects renderer paths and executable flags before any download',async t=>{
 const f=await extractionFixture(t),before=f.wire.length;
 for(const extra of [{remotePath:'/another'},{localPath:'C:\\not-picked.zip'},{overwrite:true},{command:'unzip'}])assert.equal((await f.invoke('FilesPreview',{...f.input,value:{...f.input.value,...extra}})).ok,false);
 assert.equal(f.wire.length,before);assert(!f.files.has('/fixture/notes/parcel'));assert(!f.files.has('/fixture/notes/readme.txt'));
});

test('actual account replacement revokes prepared extraction and its owned temporary bytes',async t=>{
 const f=await extractionFixture(t),prepared=await f.invoke('FilesPreview',f.input);assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const session=f.api.panel().session;f.accounts.selectedId='second';f.api.observe();const result=await confirm(f,f.row,prepared.preview);assert.equal(result.ok,false);await session.retiring;
 assert.equal(f.wire.filter(x=>['fileMkdir','fileUpload'].includes(x.route)).length,0);assert(!f.files.has('/fixture/notes/parcel'));assert.equal(session.fileStages.size,0);assert.deepEqual(fileBytes(f.files.get('/fixture/parcel.zip')),f.archive);
});

test('actual main preview/confirm creates once and lost response stays unknown',async t=>{
 const f=setup(t),row=await open(f),preview=await previewCreate(f,row);f.state.dropFileReply=true;const result=await confirm(f,row,preview);
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.change.outcome,'unknown');assert.equal(result.change.automaticRetry,false);assert(f.files.has('/fixture/new.txt'));
 assert.equal((await confirm(f,row,preview)).ok,false);assert.equal(f.wire.filter(r=>r.route==='fileCreate').length,1);
});
test('main rejects untrusted sender and arbitrary file authority before requests',async t=>{
 const f=setup(t),row=await open(f),before=f.wire.length;
 await assert.rejects(f.invoke('FilesRead',{...view(row),entryId:row.files.entries[0].entryId,operationId:randomUUID()},{sender:{},senderFrame:{}}),/Untrusted sender/);
 for(const extra of [{path:'/another'},{credential:'injected'},{url:'https://other.invalid'},{localPath:'C:\\not-picked.txt'}])assert.equal((await f.invoke('FilesRead',{...view(row),operationId:randomUUID(),entryId:row.files.entries[0].entryId,...extra})).ok,false);
 assert.equal(f.wire.length,before);
});
test('actual selected-companion change retires a held confirmation before remote mutation',async t=>{
 const f=setup(t),row=await open(f),preview=await previewCreate(f,row),gate=hold();let held=false;f.state.beforeFile=async route=>{if(route==='fileList'){held=true;await gate.promise;}};
 const pending=confirm(f,row,preview);await until(()=>held);f.accounts.selectedId='second';f.api.observe();gate.resolve();const r=await pending;
 assert(r.ok===false||r.change?.outcome==='not_submitted');assert.equal(f.wire.filter(r=>r.route==='fileCreate').length,0);assert(!f.files.has('/fixture/new.txt'));
});
test('actual native upload pick is owned and late minimize result is discarded',async t=>{
 const f=setup(t),row=await open(f),source=path.join(f.root,'source.txt');fs.writeFileSync(source,'only synthetic source');f.state.pickerGate=hold();
 const pending=f.invoke('FilesPickUpload',{...view(row),operationId:randomUUID()});await until(()=>f.state.pickerCalls.length===1);
 f.state.minimized=true;f.events.minimize();f.state.pickerGate.resolve({canceled:false,filePaths:[source]});const r=await pending;assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/source\.txt|synthetic source/);assert.equal(f.wire.filter(r=>/Upload/.test(r.route)).length,0);
});
test('exact operation cancel stops held preflight and leaves no remote write',async t=>{
 const f=setup(t),row=await open(f),preview=await previewCreate(f,row),gate=hold(),operationId=randomUUID();let held=false;f.state.beforeFile=async route=>{if(route==='fileList'){held=true;await gate.promise;}};
 const pending=f.invoke('FilesConfirm',{...view(row),operationId,ticketId:preview.ticketId,expectedDigest:preview.expectedDigest});await until(()=>held);
 const foreign=await f.invoke('FilesCancel',{...base(row),operationId:randomUUID()});assert.equal(foreign.cancelRequested,false);
 const cancel=await f.invoke('FilesCancel',{...base(row),operationId});assert.equal(cancel.cancelRequested,true);gate.resolve();const r=await pending;assert.equal(r.change.outcome,'not_submitted');assert.equal(f.wire.filter(r=>r.route==='fileCreate').length,0);
});
test('old file view close cannot retire a newly opened view',async t=>{
 const f=setup(t),row=await open(f);assert.equal((await f.invoke('FilesClose',view(row))).closed,true);
 const next=await f.invoke('FilesOpen',{...base(row),operationId:randomUUID(),observationId:row.profile.observationId,rootPath:'/fixture'});assert.equal(next.ok,true,JSON.stringify(next));assert.notEqual(next.files.fileViewId,row.files.fileViewId);
 assert.equal((await f.invoke('FilesClose',view(row))).closed,true);
 const refreshed=await f.invoke('FilesList',{...base(row),fileViewId:next.files.fileViewId,operationId:randomUUID(),directoryId:next.files.directory.directoryId});assert.equal(refreshed.ok,true,JSON.stringify(refreshed));
});
test('native download cancellation does not start a transfer or disclose a local path',async t=>{
 const f=setup(t),row=await open(f),entry=row.files.entries.find(e=>e.name==='hello.txt');f.state.pickerResult={canceled:true};
 const result=await f.invoke('FilesDownload',{...view(row),operationId:randomUUID(),selectionIds:[entry.entryId]});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.cancelled,true);assert.equal(f.state.pickerCalls[0].kind,'save');assert.equal(f.state.pickerCalls[0].parent,f.win);
});

test('actual native upload selection uses held local bytes and a one-use confirmation',async t=>{
 const f=setup(t),row=await open(f),source=path.join(f.root,'picked-source.txt');fs.writeFileSync(source,'SYNTHETIC_PICKED_BYTES');f.state.pickerResult={canceled:false,filePaths:[source]};
 const picked=await f.invoke('FilesPickUpload',{...view(row),operationId:randomUUID()});assert.equal(picked.ok,true,JSON.stringify(picked));assert.equal(picked.upload.files[0].name,'picked-source.txt');assert.doesNotMatch(JSON.stringify(picked),/SYNTHETIC_PICKED_BYTES|arcade-remote-login-main-/);
 const preview=await f.invoke('FilesPreview',{...view(row),operationId:randomUUID(),observationId:row.files.observationId,directoryId:row.files.directory.directoryId,operation:'upload',selectionIds:[],value:{uploadId:picked.upload.uploadId}});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(f.wire.filter(r=>r.route==='fileUpload').length,0);
 const result=await confirm(f,row,preview.preview);assert.equal(result.change.outcome,'acknowledged');assert.equal(result.change.observation.state,'ambiguous');assert.equal(f.files.get('/fixture/picked-source.txt').text,'SYNTHETIC_PICKED_BYTES');
 assert.equal((await confirm(f,row,preview.preview)).ok,false);assert.equal(f.wire.filter(r=>r.route==='fileUpload').length,1);assert.equal(fs.readFileSync(source,'utf8'),'SYNTHETIC_PICKED_BYTES');
 assert.equal((await f.invoke('FilesClose',view(row))).closed,true);assert.equal(f.api.panel().session.fileStages.size,0);
});

test('actual native download target is published and read back without leaking its local path',async t=>{
 const f=setup(t),row=await open(f),entry=row.files.entries.find(e=>e.name==='hello.txt'),destination=path.join(f.root,'chosen-download.txt');f.state.pickerResult={canceled:false,filePath:destination};
 const result=await f.invoke('FilesDownload',{...view(row),operationId:randomUUID(),selectionIds:[entry.entryId]});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.download.saved,true);assert.equal(result.download.bytes,Buffer.byteLength(TEXT));assert.deepEqual(fs.readFileSync(destination),Buffer.from(TEXT));assert.equal(result.download.sourceSnapshotVerified,false);
 assert.doesNotMatch(JSON.stringify(result),/chosen-download|arcade-remote-login-main-|SYNTHETIC_FILE_TEXT/);assert.equal((await f.invoke('FilesClose',view(row))).closed,true);assert.equal(f.api.panel().session.fileStages.size,0);
});
