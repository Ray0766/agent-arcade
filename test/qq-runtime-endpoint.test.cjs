'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {QQRuntimeEndpointStore,MAX_PAYLOAD,MAX_FILE}=require('../src/bot/qq-runtime-endpoint.cjs');
const A='12345001',B='12345002';
function vault(){const key=crypto.randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},decryptString(data){const d=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAuthTag(data.subarray(12,28));return Buffer.concat([d.update(data.subarray(28)),d.final()]).toString('utf8');}};}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-endpoint-'));t.after(()=>{assert(fs.realpathSync(root).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const options={root,profileRoot:path.join(root,'profile'),componentsRoot:path.join(root,'components'),vault:vault()};
  const value={runtime:{pid:123,createdAt:'2026-11-06T01:00:00Z',executable:path.join(root,'launcher.exe')},listener:{pid:124,createdAt:'2026-11-06T01:00:01Z',executable:path.join(root,'QQ.exe')},endpoint:{baseUrl:'http://127.0.0.1:6123',port:6123,token:'ONLY_SYNTHETIC_PRIVATE_TOKEN'}};
  return {root,options,value,store:new QQRuntimeEndpointStore(options)};
}
test('endpoint recovery stores only bounded ciphertext including all binding metadata',t=>{
  const f=fixture(t);f.store.save(A,f.value);const bytes=fs.readFileSync(f.store.file(A));assert(bytes.length<=MAX_FILE);assert(!bytes.includes(Buffer.from(f.value.endpoint.token)));assert(!bytes.includes(Buffer.from(f.root)));assert(!bytes.includes(Buffer.from(A)));
  assert.deepEqual(f.store.load(A,f.value.runtime).endpoint,f.value.endpoint);const original=bytes.toString('hex');f.store.save(A,f.value);assert.equal(fs.readFileSync(f.store.file(A)).toString('hex'),original);
});
test('swapped account ciphertext, process reuse, profile and component changes are rejected',t=>{
  const f=fixture(t);f.store.save(A,f.value);fs.copyFileSync(f.store.file(A),f.store.file(B));assert.throws(()=>f.store.load(B,f.value.runtime),{code:'endpoint_recovery_unavailable'});
  assert.throws(()=>f.store.save(B,f.value),{code:'endpoint_recovery_unavailable'});
  assert.throws(()=>f.store.load(A,{...f.value.runtime,createdAt:'2026-11-06T02:00:00Z'}),{code:'endpoint_recovery_unavailable'});
  for(const patch of [{profileRoot:path.join(f.root,'other-profile')},{componentsRoot:path.join(f.root,'other-components')},{vault:vault()}])assert.throws(()=>new QQRuntimeEndpointStore({...f.options,...patch}).load(A,f.value.runtime),{code:'endpoint_recovery_unavailable'});
});
test('corrupt or oversized files and overlarge payloads remain unavailable without replacement',t=>{
  const f=fixture(t);f.store.save(A,f.value);const file=f.store.file(A);fs.writeFileSync(file,Buffer.alloc(MAX_FILE+1));assert.throws(()=>f.store.load(A,f.value.runtime),{code:'endpoint_recovery_unavailable'});assert.throws(()=>f.store.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert.equal(fs.statSync(file).size,MAX_FILE+1);
  fs.unlinkSync(file);assert.throws(()=>f.store.save(A,{...f.value,extra:'x'.repeat(MAX_PAYLOAD),runtime:{...f.value.runtime,extra:'x'.repeat(MAX_PAYLOAD)}}),{code:'endpoint_recovery_unavailable'});assert(!fs.existsSync(file));
});
test('symbolic directories and files are never traversed or overwritten',t=>{
  const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,f.store.directory,'junction');assert.throws(()=>f.store.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert.deepEqual(fs.readdirSync(outside),[]);fs.unlinkSync(f.store.directory);
  fs.mkdirSync(f.store.directory);const target=path.join(outside,'keep');fs.writeFileSync(target,'unchanged');fs.linkSync(target,f.store.file(A));assert.throws(()=>f.store.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert.equal(fs.readFileSync(target,'utf8'),'unchanged');
});
test('write staging failure preserves the previous ciphertext and does not expose the underlying error',t=>{
  const f=fixture(t);f.store.save(A,f.value);const before=fs.readFileSync(f.store.file(A));const rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===f.store.file(A))throw Error(f.value.endpoint.token);return rename(from,to);};
  try{assert.throws(()=>f.store.save(A,{...f.value,endpoint:{...f.value.endpoint,port:6124,baseUrl:'http://127.0.0.1:6124'}}),error=>error.code==='endpoint_recovery_unavailable'&&!error.message.includes(f.value.endpoint.token));}finally{fs.renameSync=rename;}
  assert.deepEqual(fs.readFileSync(f.store.file(A)),before);assert.equal(fs.readdirSync(f.store.directory).length,1);
});
test('unsafe paths, missing encryption and foreign files fail closed',t=>{
  const f=fixture(t);assert.throws(()=>new QQRuntimeEndpointStore({...f.options,profileRoot:'//host/share'}),{code:'endpoint_recovery_unavailable'});assert.throws(()=>new QQRuntimeEndpointStore({...f.options,profileRoot:f.root+'\0'}),{code:'endpoint_recovery_unavailable'});
  const denied=new QQRuntimeEndpointStore({...f.options,vault:{isEncryptionAvailable:()=>false}});assert.throws(()=>denied.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert(!fs.existsSync(denied.directory));
  fs.mkdirSync(f.store.directory);fs.writeFileSync(f.store.file(A),'unknown');assert.throws(()=>f.store.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert.equal(fs.readFileSync(f.store.file(A),'utf8'),'unknown');
});
test('managed installations isolate the same account while retaining the exact legacy path and ciphertext',t=>{
  const f=fixture(t);f.store.save(A,f.value);const legacy=fs.readFileSync(f.store.file(A));
  assert.equal(f.store.file(A),path.join(f.root,'qq-runtime-endpoints',crypto.createHash('sha256').update(A).digest('hex')+'.bin'));
  const stores=['a'.repeat(64),'b'.repeat(64)].map(installationId=>new QQRuntimeEndpointStore({...f.options,installationId,componentsRoot:path.join(f.root,installationId)}));
  assert.notEqual(stores[0].file(A),stores[1].file(A));assert.notEqual(stores[0].file(A),f.store.file(A));
  for(const store of stores){store.save(A,f.value);assert.deepEqual(store.load(A,f.value.runtime).endpoint,f.value.endpoint);assert.equal(store.read(A).value.version,2);}
  assert.deepEqual(fs.readFileSync(f.store.file(A)),legacy);assert.equal(f.store.read(A).value.version,1);assert.deepEqual(f.store.load(A,f.value.runtime).endpoint,f.value.endpoint);
  const reopened=new QQRuntimeEndpointStore({...f.options,installationId:'a'.repeat(64),componentsRoot:path.join(f.root,'a'.repeat(64))});assert.deepEqual(reopened.load(A,f.value.runtime).endpoint,f.value.endpoint);
});
test('managed stores never fall back to or overwrite legacy ciphertext and reject copied installation records',t=>{
  const f=fixture(t);f.store.save(A,f.value);const legacy=fs.readFileSync(f.store.file(A)),first=new QQRuntimeEndpointStore({...f.options,installationId:'a'.repeat(64)}),other=new QQRuntimeEndpointStore({...f.options,installationId:'b'.repeat(64)});
  assert.throws(()=>first.load(A,f.value.runtime),{code:'endpoint_recovery_unavailable'});first.save(A,f.value);fs.mkdirSync(other.directory,{recursive:true});fs.copyFileSync(first.file(A),other.file(A));const copied=fs.readFileSync(other.file(A));
  assert.throws(()=>other.load(A,f.value.runtime),{code:'endpoint_recovery_unavailable'});assert.throws(()=>other.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert.deepEqual(fs.readFileSync(other.file(A)),copied);assert.deepEqual(fs.readFileSync(f.store.file(A)),legacy);
});
test('managed namespace requires a fixed installation identity and rejects linked parents',t=>{
  const f=fixture(t);for(const installationId of [null,'','../escape','a'.repeat(63),'A'.repeat(64),{},1])assert.throws(()=>new QQRuntimeEndpointStore({...f.options,installationId}),{code:'endpoint_recovery_unavailable'});
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.mkdirSync(path.join(f.root,'qq-runtime-endpoints'));fs.symlinkSync(outside,path.join(f.root,'qq-runtime-endpoints','installations'),'junction');const managed=new QQRuntimeEndpointStore({...f.options,installationId:'a'.repeat(64)});
  assert.throws(()=>managed.save(A,f.value),{code:'endpoint_recovery_unavailable'});assert.deepEqual(fs.readdirSync(outside),[]);
});
