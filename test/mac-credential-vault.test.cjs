'use strict';
// Synthetic helper and fake secrets only. These tests never invoke Keychain.
const nodeTest=require('node:test'),test=(name,fn)=>nodeTest(name,{skip:process.platform==='win32'?'POSIX helper ownership contract':false},fn),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createMacCredentialVault,inspectHelper,validateProfile,MacCredentialError,MAX_BYTES,HEADER_BYTES}=require('../src/core/mac-credential-vault.cjs');
const {runHelperRequest}=require('../src/core/mac-credential-worker.cjs');
const PIN='61B339CA14A652471B585499FE49F8C3615CDEBD',HASH='a'.repeat(40),SECRET='SYNTHETIC_PRIVATE_KEY_SHOULD_NOT_LEAK';
function fixture(t){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-native-broker-')));fs.chmodSync(dir,0o700);const helper=path.join(dir,'helper-v1');fs.writeFileSync(helper,'synthetic executable bytes',{mode:0o500});
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const profile={schema:1,protocol:1,helperPath:helper,helperSha256:crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),helperCdHash:HASH,identitySha1:PIN,sourceSha256:'b'.repeat(64),service:'agent-arcade Safe Storage',account:'agent-arcade Key'};
 return {dir,helper,profile,options:{trustedIdentity:PIN,pathRoot:dir}};
}
function fakeNative(f,{readyPid=4321,result={version:1,status:'ok',available:true},neverReady=false,beforeReady=null,firstFrame=null,signatureFails=false,signatureFailureOutput='',cdHash=HASH,liveCdHash=cdHash,flags='10200',liveFlags=flags,extraFrame=false,code=0}={}){
 const calls=[],writes=[];let child,killed=false;
 const execFile=(file,args,options,done)=>{calls.push(args);queueMicrotask(()=>signatureFails&&args.at(-1).startsWith('+')?done(Error(SECRET),'',signatureFailureOutput):done(null,'',args.includes('-d')?`CodeDirectory v=20500 size=1 flags=0x${args.at(-1).startsWith('+')?liveFlags:flags}(runtime,kill) hashes=1\nCDHash=${args.at(-1).startsWith('+')?liveCdHash:cdHash}\n`:''));};
 const spawn=(file,args,options)=>{
  child=new EventEmitter();child.pid=4321;child.stdout=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,callback){writes.push(Buffer.from(chunk).toString());callback();}});
  child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.write(JSON.stringify(result)+'\n'+(extraFrame?'{}\n':''));child.stdout.end();child.emit('close',code);}));
  child.kill=()=>{killed=true;queueMicrotask(()=>child.emit('close',null));return true;};
  queueMicrotask(()=>{beforeReady?.();if(!neverReady)child.stdout.write(JSON.stringify(firstFrame||{version:1,status:'ready',pid:readyPid})+'\n');});return child;
 };
 return {options:{...f.options,execFile,spawn},calls,writes,killed:()=>killed};
}

test('profile refuses changed pin, arbitrary helper and unexpected metadata',t=>{
 const f=fixture(t);
 assert.throws(()=>validateProfile({...f.profile,account:'agent-arcade'},f.options),{code:'INVALID_PROFILE'});
 assert.throws(()=>validateProfile({...f.profile,identitySha1:'0'.repeat(40)},f.options),{code:'IDENTITY_MISMATCH'});
 assert.throws(()=>validateProfile({...f.profile,helperPath:'/tmp/evil'},f.options),{code:'INVALID_PROFILE'});
 assert.throws(()=>validateProfile({...f.profile,debug:true},f.options),{code:'INVALID_PROFILE'});
 assert.throws(()=>validateProfile(f.profile,{pathRoot:f.dir}),{code:'INVALID_PROFILE'});
});
test('private parent, owned non-linked executable and hash are enforced',t=>{
 const f=fixture(t);assert.ok(inspectHelper(f.profile));fs.chmodSync(f.dir,0o755);assert.throws(()=>inspectHelper(f.profile),{code:'UNSAFE_HELPER'});fs.chmodSync(f.dir,0o700);
 fs.chmodSync(f.helper,0o755);assert.throws(()=>inspectHelper(f.profile),{code:'UNSAFE_HELPER'});fs.chmodSync(f.helper,0o500);
 assert.throws(()=>inspectHelper({...f.profile,helperSha256:'0'.repeat(64)}),{code:'HELPER_CHANGED'});
 fs.renameSync(f.helper,f.helper+'.original');fs.symlinkSync(f.helper+'.original',f.helper);assert.throws(()=>inspectHelper(f.profile),{code:'UNSAFE_HELPER'});
});
test('plaintext is sent only after actual child PID signature and live CDHash pass',async t=>{
 const f=fixture(t),n=fakeNative(f,{result:{version:1,status:'ok',data:Buffer.from('fake-ciphertext').toString('base64')}});
 const result=await runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},n.options);
 assert.equal(result.status,'ok');assert.equal(n.writes.length,1);assert.equal(JSON.parse(n.writes[0]).text,SECRET);
 assert.equal(n.calls.length,4);assert.equal(n.calls[2].at(-1),'+4321');assert.equal(n.calls[3].at(-1),'+4321');
 assert.deepEqual(n.calls[2],['--verify','+4321']);
 assert.ok(n.calls[0].includes('--strict'));assert.ok(n.calls[0].includes('-R'));
 assert.ok(n.calls[0].includes(`=identifier "io.github.agentarcade.credentials.v1" and certificate root=H"${PIN}"`));
});
test('spoofed ready PID and failed live signature kill without sending plaintext',async t=>{
 for(const variant of [{readyPid:9},{signatureFails:true},{liveCdHash:'0'.repeat(40)},{liveFlags:'10202'},{liveFlags:'10204'},{liveFlags:'10000'}]){const f=fixture(t),n=fakeNative(f,variant);await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},n.options),{code:'IDENTITY_MISMATCH'});assert.deepEqual(n.writes,[]);assert.equal(n.killed(),true);}
});
test('wrong CDHash or missing hardened runtime and kill flags prevents spawning',async t=>{
 for(const variant of [{cdHash:'0'.repeat(40)},{flags:'10000'},{flags:'10204'},{flags:'10202'}]){const f=fixture(t),n=fakeNative(f,variant);await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'status'},n.options),{code:'IDENTITY_MISMATCH'});assert.equal(n.killed(),false);assert.deepEqual(n.writes,[]);}
});
test('bounded timeout kills and reaps helper without retry or plaintext',async t=>{
 const f=fixture(t),n=fakeNative(f,{neverReady:true});await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},{...n.options,timeoutMs:30}),{code:'HELPER_TIMEOUT'});assert.equal(n.killed(),true);assert.equal(n.writes.length,0);assert.equal(n.calls.length,2);
});
test('oversized request is rejected before code or helper execution',async t=>{
 const f=fixture(t),n=fakeNative(f);await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:'x'.repeat(MAX_BYTES)},n.options),{code:'INVALID_REQUEST'});assert.equal(n.calls.length,0);assert.deepEqual(n.writes,[]);
});
test('helper error bodies and extra response fields cannot leak secrets',async t=>{
 for(const result of [{version:1,status:'error',code:SECRET},{version:1,status:'error',code:'internal_error',message:SECRET},{version:1,status:'ok',available:true,text:SECRET}]){
  const f=fixture(t),n=fakeNative(f,{result});await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'status'},n.options),failure=>failure instanceof MacCredentialError&&failure.code==='INVALID_RESPONSE'&&!failure.message.includes(SECRET));
 }
 const f=fixture(t),n=fakeNative(f,{result:{version:1,status:'error',code:'keychain_locked'},code:1});assert.deepEqual(await runHelperRequest(f.profile,{version:1,operation:'status'},n.options),{version:1,status:'error',code:'KEYCHAIN_LOCKED'});
});
test('extra frame and nonzero successful exit are rejected',async t=>{
 for(const variant of [{extraFrame:true},{code:1}]){const f=fixture(t),n=fakeNative(f,variant);await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'status'},n.options),{code:variant.extraFrame?'INVALID_RESPONSE':'HELPER_FAILED'});}
});
test('authorization accepts only explicit status and passes one fixed argument',async t=>{
 const f=fixture(t),n=fakeNative(f);await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},{...n.options,authorize:true}),{code:'INVALID_REQUEST'});assert.equal(n.calls.length,0);
});
test('synchronous vault sanitizes worker failures and clears shared plaintext/result',t=>{
 const f=fixture(t);let captured;
 const vault=createMacCredentialVault({...f.options,profile:f.profile,workerFactory(filename,{workerData}){
  captured=workerData.shared;const control=new Int32Array(captured,0,4),input=new Uint8Array(captured,HEADER_BYTES,MAX_BYTES),output=new Uint8Array(captured,HEADER_BYTES+MAX_BYTES,MAX_BYTES);
  assert.match(Buffer.from(input.subarray(0,control[1])).toString(),new RegExp(SECRET));
  const bytes=Buffer.from(JSON.stringify({version:1,status:'error',code:'HELPER_FAILED'}));output.set(bytes);control[2]=bytes.length;control[0]=1;return {on(){},unref(){}};
 }});
 assert.throws(()=>vault.encryptString(SECRET),failure=>failure.code==='HELPER_FAILED'&&!failure.message.includes(SECRET));assert.ok(new Uint8Array(captured,HEADER_BYTES).every(byte=>byte===0));
});
test('synchronous compatibility returns binary ciphertext and original Unicode text',t=>{
 const f=fixture(t),seen=[];
 const vault=createMacCredentialVault({...f.options,profile:f.profile,workerFactory(filename,{workerData}){
  const control=new Int32Array(workerData.shared,0,4),input=new Uint8Array(workerData.shared,HEADER_BYTES,MAX_BYTES),output=new Uint8Array(workerData.shared,HEADER_BYTES+MAX_BYTES,MAX_BYTES),request=JSON.parse(Buffer.from(input.subarray(0,control[1])).toString());seen.push(request);
  const response=request.operation==='status'?{available:true}:request.operation==='encrypt'?{data:Buffer.from([0,255,1]).toString('base64')}:{text:'鲸鱼娘 🔐'};
  const bytes=Buffer.from(JSON.stringify({version:1,status:'ok',...response}));output.set(bytes);control[2]=bytes.length;control[0]=1;return {on(){},unref(){}};
 }});
 assert.equal(vault.isEncryptionAvailable(),true);assert.deepEqual(vault.encryptString('假密钥'),Buffer.from([0,255,1]));assert.equal(vault.decryptString(Buffer.from([0,255,1])),'鲸鱼娘 🔐');assert.equal(seen.length,3);
});
test('real Node Worker wakes the synchronous SAB bridge without the main event loop',t=>{
 const f=fixture(t),{Worker}=require('node:worker_threads');let captured;
 const vault=createMacCredentialVault({...f.options,profile:f.profile,workerFactory(filename,{workerData}){
  captured=workerData.shared;
  return new Worker(`const {workerData}=require('node:worker_threads');const control=new Int32Array(workerData.shared,0,4);const input=new Uint8Array(workerData.shared,${HEADER_BYTES},${MAX_BYTES});const request=JSON.parse(Buffer.from(input.subarray(0,control[1])).toString());input.fill(0);const bytes=Buffer.from(JSON.stringify({version:1,status:'ok',text:request.operation==='decrypt'?'synthetic-thread-roundtrip':'wrong'}));new Uint8Array(workerData.shared,${HEADER_BYTES+MAX_BYTES},${MAX_BYTES}).set(bytes);control[2]=bytes.length;bytes.fill(0);Atomics.store(control,0,1);Atomics.notify(control,0);`,{eval:true,workerData});
 }});
 assert.equal(vault.decryptString(Buffer.from('synthetic ciphertext')),'synthetic-thread-roundtrip');assert.ok(new Uint8Array(captured,HEADER_BYTES).every(byte=>byte===0));
});
test('replacement after static verification is detected before spawn',async t=>{
 const f=fixture(t),n=fakeNative(f);let checks=0;
 const original=n.options.execFile;n.options.execFile=(file,args,options,done)=>original(file,args,options,(...result)=>{if(++checks===2){fs.renameSync(f.helper,f.helper+'.old');fs.writeFileSync(f.helper,'replacement bytes',{mode:0o500});}done(...result);});
 await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},n.options),{code:'HELPER_CHANGED'});assert.deepEqual(n.writes,[]);
});
test('native rejection before ready reports CALLER_REJECTED without live checks or plaintext',async t=>{
 const f=fixture(t),n=fakeNative(f,{firstFrame:{version:1,status:'error',code:'unauthorized'}});
 await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},n.options),{code:'CALLER_REJECTED'});
 assert.equal(n.calls.length,2);assert.deepEqual(n.writes,[]);assert.equal(n.killed(),true);
});
test('nonzero PID verification fails even when codesign prints dynamically valid',async t=>{
 const f=fixture(t),n=fakeNative(f,{signatureFails:true,signatureFailureOutput:'+4321: dynamically valid\n+4321: UNIX[Invalid argument]\n'});
 await assert.rejects(runHelperRequest(f.profile,{version:1,operation:'encrypt',text:SECRET},n.options),{code:'IDENTITY_MISMATCH'});
 assert.deepEqual(n.calls[2],['--verify','+4321']);assert.equal(n.calls.length,3);assert.deepEqual(n.writes,[]);assert.equal(n.killed(),true);
});
test('runtime plus hard and kill flags from real macOS metadata are accepted',async t=>{
 const f=fixture(t),n=fakeNative(f,{flags:'10300'});
 assert.deepEqual(await runHelperRequest(f.profile,{version:1,operation:'status'},n.options),{version:1,status:'ok',available:true});
});
