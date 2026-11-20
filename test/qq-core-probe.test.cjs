'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {PassThrough}=require('node:stream');
const {finished}=require('node:stream/promises');
const asar=require('@electron/asar');
const {probeInstallation,inspectPe}=require('../scripts/qq-install-probe.cjs');
const {PROTOCOL,BASELINE,createProbeSession,evaluateFingerprint,serve}=require('../scripts/qq-core-probe-host.cjs');
const request=(id,method)=>({protocol:PROTOCOL,id,method});
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-probe-'));t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.match(path.basename(dir),/^arcade-qq-probe-/);fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function pe(){
  const b=Buffer.alloc(2048);b.writeUInt16LE(0x5a4d,0);b.writeUInt32LE(64,60);b.writeUInt32LE(0x4550,64);b.writeUInt16LE(0x8664,68);b.writeUInt16LE(1,70);b.writeUInt16LE(240,84);
  const optional=88;b.writeUInt16LE(0x20b,optional);b.writeUInt32LE(512,optional+60);b.writeUInt32LE(0x1000,optional+112);
  const section=328;b.writeUInt32LE(512,section+8);b.writeUInt32LE(0x1000,section+12);b.writeUInt32LE(512,section+16);b.writeUInt32LE(512,section+20);
  b.writeUInt32LE(1,512+20);b.writeUInt32LE(1,512+24);b.writeUInt32LE(0x1040,512+32);b.writeUInt32LE(0x1060,576);b.write('napi_register_module_v1\0',608);return b;
}
async function fixture(t){
  const root=temp(t),app=path.join(root,'versions',BASELINE.version,'resources','app'),content=path.join(root,'archive-fixture');fs.mkdirSync(app,{recursive:true});fs.mkdirSync(path.join(content,'app_launcher'),{recursive:true});
  const marker=path.join(root,'MUST_NOT_EXIST');
  fs.writeFileSync(path.join(content,'app_launcher','index.js'),`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');`);
  await finished(await asar.createPackage(content,path.join(app,'application.asar')));
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'qq-chat',version:BASELINE.version,main:'./application.asar/app_launcher/index.js'}));
  fs.writeFileSync(path.join(root,'QQ.exe'),pe());fs.writeFileSync(path.join(app,'wrapper.node'),pe());return {root,app,marker};
}
function baselineReport(){
  return {installationRoot:'private-installation-location',package:{version:BASELINE.version},nativeFiles:Object.entries(BASELINE.hashes).filter(([name])=>name!=='application.asar').map(([relativePath,sha256])=>({relativePath,sha256})),applicationArchive:{relativePath:'application.asar',sha256:BASELINE.hashes['application.asar']}};
}
function child(root,frames){
  return new Promise((resolve,reject)=>{
    const process=spawn(global.process.execPath,[path.resolve(__dirname,'../scripts/qq-core-probe-host.cjs'),root,BASELINE.version],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{process.kill();reject(Error('probe fixture deadline'));},8000);
    process.stdout.on('data',v=>out+=v);process.stderr.on('data',v=>err+=v);process.on('error',reject);process.once('exit',code=>{clearTimeout(timer);resolve({code,lines:out.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)),err});});process.stdin.end(frames);
  });
}

test('actual fixture installation metadata is read without evaluating its launcher or native addon',async t=>{
  const {root,marker}=await fixture(t),result=probeInstallation(root,BASELINE.version);
  assert.equal(result.package.version,BASELINE.version);assert.equal(result.nativeFiles[0].pe.architecture,'x64');assert.deepEqual(result.nativeFiles[0].pe.registrationExports,['napi_register_module_v1']);assert.equal(result.applicationArchive.launcherPresent,true);assert.equal(result.boundaries.nativeModulesLoaded,false);assert.equal(result.boundaries.qqProtocolValidated,false);assert.equal(fs.existsSync(marker),false);
});
test('malformed PE pointers fail before unbounded reads',t=>{
  const file=path.join(temp(t),'invalid.exe'),bytes=pe();bytes.writeUInt32LE(0xffffffff,60);fs.writeFileSync(file,bytes);assert.throws(()=>inspectPe(file),/PE offset/);
});
test('paths and version inputs cannot select UNC, traversal or another version manifest',async t=>{
  assert.throws(()=>probeInstallation('\\\\server\\share',BASELINE.version),/local QQ/);assert.throws(()=>probeInstallation('//server/share',BASELINE.version),/local QQ/);assert.throws(()=>probeInstallation(path.resolve('.'),'..\\secret'),/explicit version/);
  const {root,app}=await fixture(t);fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'qq-chat',version:'other',main:'index.js'}));assert.throws(()=>probeInstallation(root,BASELINE.version),/does not match/);
});
test('a matching fingerprint is only an observed installation, never protocol compatibility',()=>{
  const report=baselineReport();assert.equal(evaluateFingerprint(report).state,'matches_observed_installation');assert.equal(evaluateFingerprint(report).protocolCompatible,'unverified');
  report.nativeFiles[0].sha256='0'.repeat(64);assert.deepEqual(evaluateFingerprint(report).changed,['QQ.exe']);assert.equal(evaluateFingerprint(report).state,'same_version_different_files');report.package.version='9.9.37-53645';assert.equal(evaluateFingerprint(report).state,'unobserved_version');
});
test('session pins paths, rejects extra fields and duplicate commands, and omits installation location',()=>{
  let inspected=0;const session=createProbeSession({installRoot:'parent-selected',version:BASELINE.version,inspect:(root)=>{assert.equal(root,'parent-selected');inspected++;return baselineReport();}});
  assert.equal(session.handle({...request('1','inspect-installation'),path:'somewhere'}).error,'INVALID_REQUEST');assert.equal(inspected,0);
  const result=session.handle(request('2','inspect-installation'));assert.equal(result.ok,true);assert.equal('installationRoot' in result.result,false);assert.equal(session.handle(request('2','inspect-installation')).error,'DUPLICATE_REQUEST');assert.equal(inspected,1);
  assert.equal(session.handle(request('3','send-text')).error,'CAPABILITY_NOT_IMPLEMENTED');assert.equal(session.handle(request('4','login')).error,'CAPABILITY_NOT_IMPLEMENTED');
  assert.equal(session.handle(request('5','inspect-installation')).ok,true);assert.equal(session.handle(request('6','inspect-installation')).error,'INSPECTION_LIMIT');assert.equal(inspected,2);
});
test('probe errors do not leak selected locations or arbitrary exception text',()=>{
  const session=createProbeSession({installRoot:'private',version:BASELINE.version,inspect:()=>{throw Error('private data');}});const result=session.handle(request('1','inspect-installation'));assert.equal(result.error,'INSTALLATION_PROBE_FAILED');assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(session.handle(request('2','status')).result.state,'installation_not_inspected');
});
test('real helper process completes bounded metadata IPC, refuses account action and exits',async t=>{
  const {root,marker}=await fixture(t);const result=await child(root,['capabilities','inspect-installation','status','send-text','close'].map((method,index)=>JSON.stringify(request(String(index),method))+'\n').join(''));
  assert.equal(result.code,0);assert.equal(result.err,'');assert.equal(result.lines.length,6);assert.equal(result.lines[0].event,'ready');assert.equal(result.lines[2].result.fingerprint.state,'same_version_different_files');assert.equal(result.lines[3].result.accountState,'unverified');assert.equal(result.lines[4].error,'CAPABILITY_NOT_IMPLEMENTED');assert.equal(result.lines[5].result.state,'closed');assert.equal(fs.existsSync(marker),false);assert.equal(JSON.stringify(result.lines).includes(root),false);
});
test('real helper refuses oversized and invalid UTF-8 frames without echoing payload',async t=>{
  const root=temp(t);const large=await child(root,'x'.repeat(2048));assert.equal(large.lines.at(-1).error,'FRAME_LIMIT');assert.equal(JSON.stringify(large).includes('x'.repeat(50)),false);
  const invalid=await child(root,Buffer.from([0xff,10]));assert.equal(invalid.lines.at(-1).error,'INVALID_JSON');
});
test('partial-frame EOF and idle deadlines are explicit and release streams',async()=>{
  const input=new PassThrough(),output=new PassThrough();let data='';output.on('data',chunk=>data+=chunk);serve({input,output,installRoot:'unused',version:BASELINE.version,timeoutMs:20});input.end('{');await new Promise(resolve=>setTimeout(resolve,30));assert.match(data,/INCOMPLETE_FRAME/);assert.doesNotMatch(data,/SESSION_TIMEOUT/);
  const idle=new PassThrough(),out=new PassThrough();let text='';out.on('data',chunk=>text+=chunk);serve({input:idle,output:out,installRoot:'unused',version:BASELINE.version,timeoutMs:15});await new Promise(resolve=>setTimeout(resolve,25));assert.match(text,/SESSION_TIMEOUT/);assert.equal(idle.listenerCount('data'),0);
});
