'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createQQDiagnosticReport,encodeQQDiagnosticReport,writeQQDiagnosticReport,SCHEMA,MAX_BYTES}=require('../src/bot/qq-diagnostic-report.cjs');
const accountId='123456789',stamp='2026-11-06T01:02:03.000Z';
function input(){return {version:'0.4.0-preview.1',platform:'win32',accountId,capturedAt:stamp,runtimeState:{installationKind:'managed-node',components:{available:true,selectionKind:'prepared',napcatVersion:'4.18.42',qqVersion:'9.9.31-49738',nodeVersion:'22.11.0'},desktopRunning:false,issue:null,instances:[{accountId,processRunning:true,management:'owned',reason:null,login:{state:'online',online:true}}]},diagnosticEvents:[{type:'session_expired',time:'11-05 22:30:27'},{type:'launcher_stopped',time:stamp}]};}
function files(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-report-')),file=path.join(dir,'report.json');t.after(()=>{assert(dir.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return {dir,file};}
const code=(name)=>error=>error?.code===name;

test('projection exports fixed status and event facts without nested private fields or toJSON hooks',()=>{
  const value=input(),secret='synthetic-private-key-path-and-message',row=value.runtimeState.instances[0];
  value.runtimeState.desktopDataRoot=secret;value.runtimeState.componentsRoot=secret;value.runtimeState.token=secret;
  value.runtimeState.components.secret=secret;value.runtimeState.components.toJSON=()=>({leaked:secret});
  Object.assign(row,{nickname:secret,ownerId:'987654321',token:secret,url:secret,qr:secret,logs:secret});
  value.diagnosticEvents[0].text=secret;value.diagnosticEvents[0].token=secret;value.diagnosticEvents[0].toJSON=()=>({leaked:secret});
  const body=encodeQQDiagnosticReport(value),report=JSON.parse(body);
  assert.equal(report.schema,SCHEMA);assert.equal(report.account.alias,'selected-account');assert.equal(report.account.login,'online');assert.equal(report.components.qqVersion,'9.9.31-49738');
  for(const forbidden of [accountId,'987654321',secret,'desktopDataRoot','componentsRoot','nickname','toJSON'])assert(!body.includes(Buffer.from(forbidden)),forbidden);
  assert.deepEqual(report.events,[{type:'session_expired',time:'11-05 22:30:27',timeBasis:'local-log-unspecified'},{type:'launcher_stopped',time:stamp,timeBasis:'utc'}]);assert.equal(report.privacy.uploaded,false);
});
test('unknown codes, versions, states and malformed timestamp never leak their source strings',()=>{
  const value=input(),marker='synthetic-private-marker';value.version=marker;value.platform=marker;value.runtimeState.issue=marker;value.runtimeState.components.napcatVersion=marker;
  Object.assign(value.runtimeState.instances[0],{management:marker,reason:marker,login:{state:marker,issue:marker,online:marker}});
  value.diagnosticEvents=[{type:marker,time:stamp},{type:'session_expired',time:marker}];const report=createQQDiagnosticReport(value),body=JSON.stringify(report);
  assert(!body.includes(marker));assert.equal(report.application.version,null);assert.equal(report.account.online,null);assert.equal(report.bounds.droppedEvents,1);assert.equal(report.events[0].time,null);assert.equal(report.account.reason,'unknown');
});

test('the existing export includes only the bounded prior status issue and distinguishes it from current online',()=>{
 const value=input(),row=value.runtimeState.instances[0];row.lastStatusIssue={code:'endpoint_recheck_unavailable',phase:'endpoint-after:tree-stability',at:stamp,token:'PRIVATE',path:'PRIVATE',accountId,run:{pid:123,executable:'PRIVATE'},toJSON:()=>({leaked:'PRIVATE'})};const report=createQQDiagnosticReport(value);
 assert.equal(report.account.login,'online');assert.deepEqual(report.account.lastStatusIssue,{code:'endpoint_recheck_unavailable',phase:'endpoint-after:tree-stability',at:stamp});assert(!JSON.stringify(report).includes('PRIVATE'));assert(!JSON.stringify(report).includes(accountId));
});

test('prior status issue rejects unknown phases and invalid dates, and replaces unknown error codes',()=>{
 for(const invalid of [{code:'timeout',phase:'PRIVATE',at:stamp},{code:'timeout',phase:'webui-status',at:'2026-02-30T00:00:00.000Z'}]){const value=input();value.runtimeState.instances[0].lastStatusIssue=invalid;assert(!createQQDiagnosticReport(value).account.lastStatusIssue);}
 const value=input();value.runtimeState.instances[0].lastStatusIssue={code:'PRIVATE',phase:'webui-status',at:stamp};assert.equal(createQQDiagnosticReport(value).account.lastStatusIssue.code,'unknown');
});
test('bounded tail and empty list are incomplete evidence, not invented events or successful diagnosis',()=>{
  const value=input();value.diagnosticEvents=Array.from({length:200},(_,i)=>({type:i===199?'private-unknown':'runtime_started',time:stamp}));const report=createQQDiagnosticReport(value);
  assert.equal(report.events.length,159);assert.equal(report.bounds.droppedEvents,41);assert.equal(report.bounds.completeHistory,false);assert(encodeQQDiagnosticReport(value).length<MAX_BYTES);
  value.diagnosticEvents=[];assert.equal(createQQDiagnosticReport(value).bounds.includedEvents,0);
});
test('wrong/duplicate account, invalid capture date and excessive input fail closed',()=>{
  for(const alter of [v=>v.accountId='00000',v=>v.runtimeState.instances=[],v=>v.runtimeState.instances.push({...v.runtimeState.instances[0]}),v=>v.capturedAt='2026-02-30T01:02:03.000Z',v=>v.diagnosticEvents=Array(10001).fill({})]){const v=input();alter(v);assert.throws(()=>createQQDiagnosticReport(v),code('report_invalid'));}
});
test('native file save creates and explicitly replaces a normal file, with exact byte readback',t=>{
  const {file,dir}=files(t),bytes=encodeQQDiagnosticReport(input());assert.deepEqual(writeQQDiagnosticReport(file,bytes),{saved:true,schema:SCHEMA});assert.deepEqual(fs.readFileSync(file),bytes);
  fs.writeFileSync(file,'old report');assert.equal(writeQQDiagnosticReport(file,bytes).saved,true);assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readdirSync(dir),['report.json']);
});
test('save rejects links, oversized body and non-JSON names without modifying the linked file',t=>{
  const {dir,file}=files(t),original=path.join(dir,'original.json'),bytes=encodeQQDiagnosticReport(input());fs.writeFileSync(original,'preserve');fs.linkSync(original,file);
  assert.throws(()=>writeQQDiagnosticReport(file,bytes),code('save_failed'));assert.equal(fs.readFileSync(original,'utf8'),'preserve');
  assert.throws(()=>writeQQDiagnosticReport(path.join(dir,'unsafe.txt'),bytes),code('save_failed'));assert.throws(()=>writeQQDiagnosticReport(path.join(dir,'huge.json'),Buffer.alloc(MAX_BYTES+1)),code('report_too_large'));
});
test('a linked save directory cannot redirect the output outside the selected real folder',t=>{
  const {dir}=files(t),target=path.join(dir,'target'),link=path.join(dir,'linked');fs.mkdirSync(target);fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>writeQQDiagnosticReport(path.join(link,'report.json'),encodeQQDiagnosticReport(input())),code('save_failed'));assert.deepEqual(fs.readdirSync(target),[]);
});
test('scope or destination replacement during temp write blocks publication and preserves replacement',t=>{
  const {dir,file}=files(t),bytes=encodeQQDiagnosticReport(input());let calls=0;
  assert.throws(()=>writeQQDiagnosticReport(file,bytes,{assertCurrent:()=>{if(++calls===2)throw Object.assign(Error('private'),{code:'changed'});}}),code('save_failed'));assert(!fs.existsSync(file));assert.deepEqual(fs.readdirSync(dir),[]);
  fs.writeFileSync(file,'original');const io={...fs,fsyncSync(fd){fs.fsyncSync(fd);fs.writeFileSync(file,'someone else changed it');}};
  assert.throws(()=>writeQQDiagnosticReport(file,bytes,{io}),code('save_failed'));assert.equal(fs.readFileSync(file,'utf8'),'someone else changed it');
});
test('rename performed then throws is confirmed from exact owned inode and bytes',t=>{
  const {file}=files(t),bytes=encodeQQDiagnosticReport(input()),io={...fs,renameSync(from,to){fs.renameSync(from,to);throw Error('synthetic transport-like filesystem ambiguity');}};
  assert.equal(writeQQDiagnosticReport(file,bytes,{io}).saved,true);assert.deepEqual(fs.readFileSync(file),bytes);
});
test('post-publication verification failure is unknown, never a false not-saved receipt',t=>{
  const {file}=files(t),bytes=encodeQQDiagnosticReport(input());let published=false;const io={...fs,renameSync(from,to){fs.renameSync(from,to);published=true;},lstatSync(name,options){if(published&&name===file)throw Object.assign(Error('private path'),{code:'EACCES'});return fs.lstatSync(name,options);}};
  assert.throws(()=>writeQQDiagnosticReport(file,bytes,{io}),e=>e.code==='save_unconfirmed'&&e.saveAttempted===true);assert.deepEqual(fs.readFileSync(file),bytes);
});
test('async guards cannot authorize publication; failed writes only leave owned redacted data eligible for cleanup',t=>{
  const {file,dir}=files(t),bytes=encodeQQDiagnosticReport(input());assert.throws(()=>writeQQDiagnosticReport(file,bytes,{assertCurrent:async()=>{}}),code('save_failed'));
  const io={...fs,writeFileSync(){throw Error('synthetic write failure');}};assert.throws(()=>writeQQDiagnosticReport(file,bytes,{io}),code('save_failed'));assert.deepEqual(fs.readdirSync(dir),[]);
});
test('concurrent growth during owned-file readback remains bounded and cannot publish the changed bytes',t=>{
  const {file,dir}=files(t),bytes=encodeQQDiagnosticReport(input());let temp,grown=false,maxRead=0;
  const io={...fs,openSync(name,flags,...rest){if(flags==='wx')temp=name;return fs.openSync(name,flags,...rest);},readSync(fd,buffer,offset,length,position){maxRead=Math.max(maxRead,length);if(!grown){grown=true;fs.appendFileSync(temp,Buffer.alloc(512*1024,1));}return fs.readSync(fd,buffer,offset,length,position);},readFileSync(){throw Error('unbounded read is forbidden');}};
  assert.throws(()=>writeQQDiagnosticReport(file,bytes,{io}),code('save_failed'));assert(maxRead<=bytes.length+1);assert(!fs.existsSync(file));assert.deepEqual(fs.readdirSync(dir),[]);
});
test('Windows rename onto a recently deleted filename confirms the held file identity despite tunneled creation time',{skip:process.platform!=='win32'},async t=>{
  const {file}=files(t),bytes=encodeQQDiagnosticReport(input());fs.writeFileSync(file,'native-dialog-style-placeholder');const original=fs.statSync(file,{bigint:true});fs.unlinkSync(file);await new Promise(resolve=>setTimeout(resolve,40));
  let before,after;const io={...fs,renameSync(from,to){before=fs.lstatSync(from,{bigint:true});fs.renameSync(from,to);after=fs.lstatSync(to,{bigint:true});}};
  assert.deepEqual(writeQQDiagnosticReport(file,bytes,{io}),{saved:true,schema:SCHEMA});assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);assert.equal(after.size,before.size);
  // This NTFS behavior is actually observed here, not simulated by an fs stub.
  assert.equal(after.birthtimeNs,original.birthtimeNs);assert.notEqual(before.birthtimeNs,after.birthtimeNs);
});
test('held handle blocks a same-content replacement or detects the changed file ID',t=>{
  const {file,dir}=files(t),bytes=encodeQQDiagnosticReport(input()),replacement=path.join(dir,'replacement.json');fs.writeFileSync(replacement,bytes);let ownedId,replaced=false,blocked;
  const io={...fs,renameSync(from,to){ownedId=fs.lstatSync(from,{bigint:true}).ino;fs.renameSync(from,to);try{fs.renameSync(replacement,to);replaced=true;}catch(error){blocked=error.code;throw error;}}};
  let result,error;try{result=writeQQDiagnosticReport(file,bytes,{io});}catch(value){error=value;}
  if(replaced){assert.equal(error?.code,'save_unconfirmed');assert.equal(error.saveAttempted,true);assert.notEqual(fs.lstatSync(file,{bigint:true}).ino,ownedId);}
  else{assert(['EPERM','EACCES','EBUSY'].includes(blocked));assert.equal(result?.saved,true);assert.equal(fs.lstatSync(file,{bigint:true}).ino,ownedId);}
  assert.deepEqual(fs.readFileSync(file),bytes);
});
test('file identity comparison retains exact 64-bit precision instead of rounded Number IDs',t=>{
  const {file}=files(t),bytes=encodeQQDiagnosticReport(input());let published=false,sawBigInt=false;
  const io={...fs,renameSync(from,to){fs.renameSync(from,to);published=true;},lstatSync(name,options){const stat=fs.lstatSync(name,options);if(published&&name===file){assert.equal(typeof stat.ino,'bigint');sawBigInt=true;stat.ino+=1n;}return stat;}};
  assert.throws(()=>writeQQDiagnosticReport(file,bytes,{io}),code('save_unconfirmed'));assert(sawBigInt);assert.deepEqual(fs.readFileSync(file),bytes);
});
