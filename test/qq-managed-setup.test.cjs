'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {QQManagedShellSetup,readManagedShellInstallation,createWindowsProgramObserver,RELEASE_ID}=require('../src/bot/qq-managed-setup.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const OBS={version:'9.9.36.53644',productName:'QQ',companyName:'Tencent',signature:{status:'Valid',subject:'CN=Tencent Technology (Shenzhen) Company Limited',thumbprint:'a'.repeat(40)}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-managed-setup-')),root=path.join(temp,'private-components'),source=path.join(temp,'existing-program'),qqExe=path.join(source,'QQ.exe');fs.mkdirSync(root);fs.mkdirSync(source);
  const pe=Buffer.alloc(2048,0);pe.write('MZ');pe.writeUInt32LE(128,60);pe.writeUInt32LE(0x4550,128);pe.writeUInt16LE(0x8664,132);pe.writeUInt16LE(0x20b,152);fs.writeFileSync(qqExe,pe);fs.writeFileSync(path.join(source,'existing-data-do-not-copy'),'SYNTHETIC_PRIVATE_DATA');
  const codeRoot=path.join(root,'qq-component-versions','napcat-shell',RELEASE_ID,'code'),manifestPath=path.join(path.dirname(codeRoot),'prepared.json');fs.mkdirSync(codeRoot,{recursive:true});const manifest=Buffer.from(JSON.stringify({schema:'qq_component_prepared_v1',files:[{path:'napcat.mjs',sha256:'b'.repeat(64)}]}));fs.writeFileSync(manifestPath,manifest);
  const state={now:10000,rows:[],snapshots:0,observers:0,prepared:0,onSnapshot:null,onObserve:null,onPrepared:null,observation:structuredClone(OBS)};
  const io=Object.create(fs);
  const options={root,io,now:()=>state.now,programObserver:async file=>{state.observers++;await state.onObserve?.(file);return structuredClone(state.observation);},processHost:{snapshot:async()=>{state.snapshots++;await state.onSnapshot?.();return structuredClone(state.rows);}},prepared:{resolvePrepared:async id=>{state.prepared++;await state.onPrepared?.();assert.equal(id,RELEASE_ID);return {versionId:RELEASE_ID,version:'4.18.42',codeRoot,manifestPath,manifestSha256:sha(fs.readFileSync(manifestPath))};}}};
  const setup=new QQManagedShellSetup(options),inspect=()=>setup.inspect({qqExe});
  t.after(()=>{const real=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());assert(real.toLowerCase().startsWith(parent.toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  return {temp,root,source,qqExe,pe,state,io,options,setup,inspect,manifestPath,base:path.join(root,'qq-installations')};
}
function installations(f){return fs.existsSync(f.base)?fs.readdirSync(f.base):[];}
function assertNoDescriptor(f){for(const id of installations(f))assert(!fs.existsSync(path.join(f.base,id,'installation.json')));}

test('valid first setup references QQ without copying data, starts prepared with no previous',async t=>{
  const f=fixture(t),before=sha(fs.readFileSync(f.qqExe)),view=await f.inspect();assert.equal(view.canInitialize,true);assert.equal(view.compatibility,'not-tested');assert.doesNotMatch(JSON.stringify(view),/existing-program|existing-data-do-not-copy/);
  const result=await f.setup.initialize({ticketId:view.ticketId});assert.equal(result.committed,true);assert.equal(result.automaticStart,false);assert.equal(result.previous,null);assert.equal(result.current.kind,'prepared');const read=readManagedShellInstallation({root:f.root,setupId:result.setupId});assert.equal(read.installationId,result.installationId);assert.equal(read.qq.file,f.qqExe);assert.equal(read.prepared.versionId,RELEASE_ID);assert.equal(read.verification,'metadata-only');assert.deepEqual(fs.readdirSync(read.qqDataDir),[]);assert.deepEqual(fs.readdirSync(read.configDir),[]);assert.deepEqual(fs.readdirSync(read.installationRoot).sort(),['installation.json','qq-data','work']);assert.equal(sha(fs.readFileSync(f.qqExe)),before);assert.equal(fs.readFileSync(path.join(f.source,'existing-data-do-not-copy'),'utf8'),'SYNTHETIC_PRIVATE_DATA');
  await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'stale_ticket'});
});
test('untrusted signature is only an observation and cannot initialize',async t=>{
  const f=fixture(t);f.state.observation.signature={status:'NotSigned',subject:null,thumbprint:null};const view=await f.inspect();assert.equal(view.canInitialize,false);await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'program_unverified'});assert.deepEqual(installations(f),[]);
});
test('another signed product and invalid metadata fail closed without echoing private text',async t=>{
  const f=fixture(t);f.state.observation.productName='WeChat';await assert.rejects(f.inspect(),error=>error.code==='program_unverified'&&!error.message.includes('WeChat'));f.state.observation=structuredClone(OBS);f.state.observation.signature.subject='PRIVATE\nSECRET';await assert.rejects(f.inspect(),{code:'program_unverified'});
});
test('only bounded x64 PE QQ.exe inputs and local regular paths are eligible',async t=>{
  for(const kind of ['name','header','arch','optional','hardlink','directory','UNC','NUL','ADS'])await t.test(kind,async t=>{
    const f=fixture(t);let file=f.qqExe;
    if(kind==='name'){file=path.join(f.source,'other.exe');fs.copyFileSync(f.qqExe,file);}
    if(kind==='header')fs.writeFileSync(file,Buffer.alloc(2048));
    if(kind==='arch'){const b=Buffer.from(f.pe);b.writeUInt16LE(0x14c,132);fs.writeFileSync(file,b);}
    if(kind==='optional'){const b=Buffer.from(f.pe);b.writeUInt16LE(0x10b,152);fs.writeFileSync(file,b);}
    if(kind==='hardlink')fs.linkSync(file,path.join(f.source,'link.exe'));
    if(kind==='directory')file=f.source;
    if(kind==='UNC')file='//server/share/QQ.exe';
    if(kind==='NUL')file+='\0bad';
    if(kind==='ADS')file+=':payload';
    await assert.rejects(f.setup.inspect({qqExe:file}),error=>['invalid_program','unsupported_architecture','unsafe_path'].includes(error.code));assert.equal(f.state.observers,0);
  });
});
test('ancestor junctions are rejected before reading executable metadata',async t=>{
  const f=fixture(t),alias=path.join(f.temp,'alias');fs.symlinkSync(f.source,alias,'junction');await assert.rejects(f.setup.inspect({qqExe:path.join(alias,'QQ.exe')}),{code:'unsafe_path'});assert.equal(f.state.observers,0);
});
test('filesystem errors cannot expose a selected private path',async t=>{
  const f=fixture(t);await assert.rejects(f.setup.inspect({qqExe:path.join(f.source,'missing','QQ.exe')}),error=>error.code==='setup_failed'&&!error.message.includes(f.source));
});
test('QQ bytes changed after selection or during signature inspection cannot be used',async t=>{
  for(const when of ['after-inspect','during-observe'])await t.test(when,async t=>{const f=fixture(t);if(when==='during-observe'){f.state.onObserve=()=>fs.appendFileSync(f.qqExe,'change');await assert.rejects(f.inspect(),{code:'program_changed'});}else{const view=await f.inspect();fs.appendFileSync(f.qqExe,'change');await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'program_changed'});}assertNoDescriptor(f);});
});
test('ticket expiry and cancellation consume the ticket without publishing a descriptor',async t=>{
  for(const kind of ['expiry','cancel'])await t.test(kind,async t=>{const f=fixture(t),view=await f.inspect(),a=new AbortController();if(kind==='expiry')f.state.now+=300001;else a.abort();await assert.rejects(f.setup.initialize({ticketId:view.ticketId,signal:a.signal}),{code:kind==='expiry'?'expired_ticket':'cancelled'});await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'stale_ticket'});assertNoDescriptor(f);});
});
test('discardTickets revokes selections without touching files or an active setup',async t=>{
  const f=fixture(t),one=await f.inspect(),two=await f.inspect(),entered=deferred(),wait=deferred();f.state.onSnapshot=async()=>{entered.resolve();await wait.promise;};const running=f.setup.initialize({ticketId:one.ticketId});await entered.promise;f.setup.discardTickets();assert.equal(f.setup.busy,true);wait.resolve();assert.equal((await running).committed,true);await assert.rejects(f.setup.initialize({ticketId:two.ticketId}),{code:'stale_ticket'});assert.equal(installations(f).length,1);
});
test('cancellation and stale scope after durable temp write remove no unknown data',async t=>{
  for(const kind of ['cancel','scope'])await t.test(kind,async t=>{const f=fixture(t),view=await f.inspect(),a=new AbortController();let stale=false;f.io.fsyncSync=fd=>{fs.fsyncSync(fd);if(kind==='cancel')a.abort();else stale=true;};await assert.rejects(f.setup.initialize({ticketId:view.ticketId,signal:a.signal,assertCurrent:()=>{if(stale)throw Object.assign(Error('PRIVATE'),{code:'changed'});}}),{code:kind==='cancel'?'cancelled':'changed'});assertNoDescriptor(f);assert.deepEqual(installations(f),[]);});
});
test('prepared bytes and metadata are rechecked immediately before commit',async t=>{
  const f=fixture(t),view=await f.inspect();f.state.onPrepared=()=>{if(f.state.prepared===2)fs.appendFileSync(f.manifestPath,' ');};await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'prepared_changed'});assertNoDescriptor(f);
});
test('a same-executable QQ or Desktop process blocks setup, including a late start',async t=>{
  for(const kind of ['early','late','desktop','unknown'])await t.test(kind,async t=>{const f=fixture(t),view=await f.inspect();const inject=()=>f.state.rows.push({pid:123,name:kind==='desktop'?'NapCatQQ-Desktop.exe':'QQ.exe',executable:kind==='unknown'?'':f.qqExe});if(kind==='late')f.state.onSnapshot=()=>{if(f.state.snapshots===2)inject();};else inject();await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'program_running'});assertNoDescriptor(f);});
});
test('unknown new directory contents are preserved and prevent setup publication',async t=>{
  const f=fixture(t),view=await f.inspect();let privateFile;f.io.fsyncSync=fd=>{fs.fsyncSync(fd);privateFile=path.join(f.base,installations(f)[0],'qq-data','unexpected.db');fs.writeFileSync(privateFile,'DO_NOT_DELETE');};await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'setup_conflict'});assert.equal(fs.readFileSync(privateFile,'utf8'),'DO_NOT_DELETE');assertNoDescriptor(f);
});
test('an existing descriptor inserted at the final publish boundary is never overwritten',async t=>{
  const f=fixture(t),view=await f.inspect();let target;f.io.linkSync=(a,b)=>{target=b;fs.writeFileSync(b,'UNKNOWN_EXISTING_DESCRIPTOR');fs.linkSync(a,b);};await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),{code:'setup_failed'});assert.equal(fs.readFileSync(target,'utf8'),'UNKNOWN_EXISTING_DESCRIPTOR');
});
test('link success followed by an exception is recognized as committed',async t=>{
  const f=fixture(t),view=await f.inspect();f.io.linkSync=(a,b)=>{fs.linkSync(a,b);throw Error('AFTER_SUCCESS_PRIVATE');};const result=await f.setup.initialize({ticketId:view.ticketId});assert.equal(result.committed,true);assert.equal(readManagedShellInstallation({root:f.root,setupId:result.setupId}).prepared.kind,'prepared');
});
test('post-commit temp cleanup and readback failure retain the committed fact',async t=>{
  for(const kind of ['cleanup','readback'])await t.test(kind,async t=>{const f=fixture(t),view=await f.inspect();if(kind==='cleanup')f.io.unlinkSync=file=>{if(file.endsWith('.part'))throw Error('PRIVATE');return fs.unlinkSync(file);};else f.io.linkSync=(a,b)=>{fs.linkSync(a,b);f.io.openSync=(file,...args)=>{if(String(file).endsWith('installation.json'))throw Error('PRIVATE');return fs.openSync(file,...args);};};await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),error=>error.committed===true&&typeof error.setupId==='string'&&!error.message.includes('PRIVATE'));assert.equal(installations(f).length,1);assert(fs.existsSync(path.join(f.base,installations(f)[0],'installation.json')));});
});
test('aborting immediately after publish cannot be reported as an uncommitted cancellation',async t=>{
  const f=fixture(t),view=await f.inspect(),a=new AbortController();f.io.linkSync=(from,to)=>{fs.linkSync(from,to);a.abort();};const result=await f.setup.initialize({ticketId:view.ticketId,signal:a.signal});assert.equal(result.committed,true);
});
test('concurrent operation is rejected without consuming its independent ticket',async t=>{
  const f=fixture(t),one=await f.inspect(),two=await f.inspect(),wait=deferred(),entered=deferred();f.state.onSnapshot=async()=>{entered.resolve();await wait.promise;};const first=f.setup.initialize({ticketId:one.ticketId});await entered.promise;await assert.rejects(f.setup.initialize({ticketId:two.ticketId}),{code:'setup_busy'});wait.resolve();await first;f.state.onSnapshot=null;await f.setup.initialize({ticketId:two.ticketId});assert.equal(installations(f).length,2);
});
test('descriptor cannot choose its own paths, change data policy or swap setup identity',async t=>{
  const f=fixture(t),view=await f.inspect(),result=await f.setup.initialize({ticketId:view.ticketId}),file=path.join(result.installationRoot,'installation.json'),original=fs.readFileSync(file);
  for(const field of ['dataPolicy','installationId','setupId','current']){const value=JSON.parse(original);value[field]=field==='current'?{kind:'original'}:'bad';fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>readManagedShellInstallation({root:f.root,setupId:result.setupId}),{code:'setup_readback_failed'});}fs.writeFileSync(file,original);const value=JSON.parse(original);value.workDir=f.source;fs.writeFileSync(file,JSON.stringify(value));assert.notEqual(readManagedShellInstallation({root:f.root,setupId:result.setupId}).workDir,f.source);
});
test('Windows metadata observer only invokes the fixed hidden shell with bounded encoded input',async()=>{
  let call;const observe=createWindowsProgramObserver({platform:'win32',env:{SystemRoot:'C:\\Windows',PRIVATE_SECRET:'do-not-forward'},runImpl:async(file,args,options)=>{call={file,args,options};return {stdout:JSON.stringify(OBS)};}});await observe('F:\\program with spaces\\QQ.exe');assert.equal(path.basename(call.file).toLowerCase(),'powershell.exe');assert.equal(call.options.windowsHide,true);assert.equal(call.options.shell,false);assert.equal(call.options.env.PRIVATE_SECRET,undefined);assert.equal(call.options.timeout,15000);assert.equal(call.options.maxBuffer,8192);const script=Buffer.from(call.args.at(-1),'base64').toString('utf16le');assert.match(script,/Get-AuthenticodeSignature -LiteralPath/);assert.doesNotMatch(script,/Start-Process|Invoke-Expression/);assert.doesNotMatch(script,/F:\\program with spaces/);
});

async function crashFixture(t){
  const f=fixture(t),view=await f.inspect();f.io.unlinkSync=file=>{if(file.endsWith('.part'))throw Error('simulated exit between publication and cleanup');return fs.unlinkSync(file);};let setupId;
  await assert.rejects(f.setup.initialize({ticketId:view.ticketId}),error=>{setupId=error.setupId;return error.committed===true&&error.code==='setup_cleanup_incomplete';});delete f.io.unlinkSync;
  const install=path.join(f.base,setupId),descriptor=path.join(install,'installation.json'),raw=fs.readFileSync(descriptor),value=JSON.parse(raw),part=path.join(install,value.publication.temporaryFile);
  assert.equal(fs.statSync(descriptor).nlink,2);assert.equal(fs.statSync(part).ino,fs.statSync(descriptor).ino);assert.throws(()=>readManagedShellInstallation({root:f.root,setupId}),{code:'unsafe_path'});
  return {...f,setupId,install,descriptor,raw,part};
}
test('explicit recovery removes only the recorded real NTFS temporary hard link',async t=>{
  const f=await crashFixture(t),workFile=path.join(f.install,'work','config','preserve.json');fs.writeFileSync(workFile,'SYNTHETIC_ACCOUNT_DATA');const preview=await f.setup.inspectRecovery({setupId:f.setupId});assert.equal(preview.temporaryLinksToRemove,1);assert.equal(fs.statSync(f.descriptor).nlink,2);assert.doesNotMatch(JSON.stringify(preview),/\.part|private-components|QQ\.exe/);
  const result=await f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest});assert.equal(result.recovered,true);assert.equal(result.committed,true);assert.equal(result.automaticStart,false);assert.equal(fs.existsSync(f.part),false);assert(fs.readFileSync(f.descriptor).equals(f.raw));assert.equal(fs.statSync(f.descriptor).nlink,1);assert.equal(readManagedShellInstallation({root:f.root,setupId:f.setupId}).prepared.versionId,RELEASE_ID);assert.equal(fs.readFileSync(workFile,'utf8'),'SYNTHETIC_ACCOUNT_DATA');
  await assert.rejects(f.setup.inspectRecovery({setupId:f.setupId}),{code:'recovery_unavailable'});
});
test('recovery preview and confirmation cancellation preserve both known links',async t=>{
  for(const phase of ['preview','confirm','final-scope'])await t.test(phase,async t=>{const f=await crashFixture(t),a=new AbortController(),preview=await f.setup.inspectRecovery({setupId:f.setupId});if(phase!=='final-scope')a.abort();let checks=0;
    await assert.rejects(phase==='preview'?f.setup.inspectRecovery({setupId:f.setupId,signal:a.signal}):f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest,signal:a.signal,assertCurrent:()=>{if(++checks===2)a.abort();}}),{code:'cancelled'});assert(fs.existsSync(f.part));assert(fs.readFileSync(f.descriptor).equals(f.raw));assert.equal(fs.statSync(f.descriptor).nlink,2);});
});
test('unknown, extra and renamed links are never removed by recovery',async t=>{
  for(const kind of ['extra-link','renamed-part','extra-file','old-no-publication'])await t.test(kind,async t=>{const f=await crashFixture(t);let keep=f.part;
    if(kind==='extra-link'){keep=path.join(f.install,'work','another-link');fs.linkSync(f.descriptor,keep);}
    if(kind==='renamed-part'){keep=path.join(f.install,'installation.00000000-0000-0000-0000-000000000000.part');fs.renameSync(f.part,keep);}
    if(kind==='extra-file'){keep=path.join(f.install,'unknown.txt');fs.writeFileSync(keep,'UNKNOWN');}
    if(kind==='old-no-publication'){const v=JSON.parse(f.raw);delete v.publication;fs.writeFileSync(f.descriptor,JSON.stringify(v));}
    await assert.rejects(f.setup.inspectRecovery({setupId:f.setupId}),{code:'recovery_unavailable'});assert(fs.existsSync(f.descriptor));assert(fs.existsSync(keep));});
});
test('descriptor or temporary replacement after preview cannot consume the replacement',async t=>{
  for(const kind of ['descriptor','part'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId}),file=kind==='descriptor'?f.descriptor:f.part;fs.unlinkSync(file);fs.writeFileSync(file,f.raw);await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),error=>['unsafe_path','recovery_changed'].includes(error.code));assert(fs.existsSync(f.part));assert(fs.existsSync(f.descriptor));});
});
test('changing either link in the final synchronous caller check is refused',async t=>{
  const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});let checks=0;await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest,assertCurrent:()=>{if(++checks===2){fs.unlinkSync(f.part);fs.writeFileSync(f.part,'UNKNOWN_REPLACEMENT');}}}),error=>['unsafe_path','recovery_changed'].includes(error.code));assert.equal(fs.readFileSync(f.part,'utf8'),'UNKNOWN_REPLACEMENT');assert(fs.readFileSync(f.descriptor).equals(f.raw));
});
test('changing the installation directory identity invalidates its preview',async t=>{
  const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId}),moved=f.install+'-moved';fs.renameSync(f.install,moved);fs.mkdirSync(f.install);fs.renameSync(path.join(moved,'work'),path.join(f.install,'work'));fs.renameSync(path.join(moved,'qq-data'),path.join(f.install,'qq-data'));fs.renameSync(path.join(moved,'installation.json'),f.descriptor);fs.renameSync(path.join(moved,path.basename(f.part)),f.part);await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),{code:'recovery_changed'});assert(fs.existsSync(f.part));
});
test('known unlink failure is distinct from a completed unlink whose wrapper throws',async t=>{
  for(const kind of ['before','after'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});f.io.unlinkSync=file=>{if(kind==='after')fs.unlinkSync(file);throw Error('PRIVATE_IO_ERROR');};if(kind==='before'){await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),error=>error.code==='recovery_failed'&&error.committed!==true&&!error.message.includes('PRIVATE'));assert(fs.existsSync(f.part));}else{const result=await f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest});assert.equal(result.recovered,true);assert.equal(result.committed,true);assert(!fs.existsSync(f.part));}});
});
test('a successful unlink keeps committed fact if final readback or close fails',async t=>{
  for(const kind of ['stat','close'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});f.io.unlinkSync=file=>{fs.unlinkSync(file);if(kind==='stat')f.io.lstatSync=file=>{if(file===f.descriptor)throw Error('PRIVATE');return fs.lstatSync(file);};else f.io.closeSync=fd=>{fs.closeSync(fd);throw Error('PRIVATE');};};const result=await f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest});assert.equal(result.committed,true);assert.equal(result.recovered,true);assert.equal(result.recoveryIssue,'recovery_unconfirmed');assert(!fs.existsSync(f.part));assert(fs.readFileSync(f.descriptor).equals(f.raw));});
});
test('uncertain unlink effects never masquerade as unchanged state',async t=>{
  const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});f.io.unlinkSync=file=>{fs.unlinkSync(file);f.io.lstatSync=()=>{throw Error('IO unavailable');};throw Error('after action');};await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),error=>error.code==='recovery_unconfirmed'&&error.recoveryAttempted===true);assert(!fs.existsSync(f.part));assert(fs.existsSync(f.descriptor));
});
test('two independent callers cannot replay removal into a different file',async t=>{
  const f=await crashFixture(t),other=new QQManagedShellSetup(f.options),preview=await f.setup.inspectRecovery({setupId:f.setupId});const result=await Promise.allSettled([f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),other.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result[0].value.recovered,true);assert(!fs.existsSync(f.part));assert(fs.readFileSync(f.descriptor).equals(f.raw));assert.equal(fs.statSync(f.descriptor).nlink,1);
});
test('recovery digests require an exact string rather than array coercion',async t=>{
  const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:[preview.expectedDigest]}),{code:'invalid_request'});assert.equal(fs.statSync(f.descriptor).nlink,2);assert(fs.existsSync(f.part));
});
