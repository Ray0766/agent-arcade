'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {RemoteNapCatRegistry,MAX_ENTRIES}=require('../src/bot/qq-remote-registry.cjs');
// Synthetic storage transform; these tests do not claim OS encryption acceptance.
const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^0x5a),decryptString:bytes=>Buffer.from(bytes).map(byte=>byte^0x5a).toString()};
function validateOrigin(value){const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw Error('invalid');return value;}
function validateTrust(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['caPem','spkiSha256'].includes(k)))throw Error('invalid');return structuredClone(value);}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-remote-registry-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const options={root,vault,validateOrigin,validateTrust};return {...options,options,registry:new RemoteNapCatRegistry(options),file:path.join(root,'qq-remote-registry.json')};}
const input=(n=1)=>({label:`Remote ${n}`,origin:`https://fixture-${n}.example`,expectedQQ:'1000001',token:'synthetic-old-token-1',trust:{},associatedProfileId:null});
const code=expected=>error=>error.code===expected;

test('new isolated registry is empty and does not create a credential file',t=>{const f=fixture(t);assert.deepEqual(f.registry.list(),{state:'ready',items:[]});assert.equal(fs.existsSync(f.file),false);});
test('encrypted single-container reopen retains separate metadata and secret, public list hides secret',t=>{
 const f=fixture(t),row=f.registry.create(input());assert.equal(row.credentialState,'saved');assert.equal(row.version,'4.18.42');
 assert.equal(JSON.stringify(row).includes('synthetic-old-token'),false);assert.equal(fs.readFileSync(f.file,'utf8').includes('fixture-1.example'),false);
 const reopened=new RemoteNapCatRegistry(f.options),entry=reopened.capture(row.remoteId);assert.equal(entry.token,input().token);assert.deepEqual(reopened.list(),f.registry.list());
 entry.token='synthetic-tampered-copy';assert.equal(reopened.capture(row.remoteId).token,input().token);
});
test('invalid and duplicate origins, unsupported fields and identities cannot persist',t=>{
 const f=fixture(t);for(const bad of [{...input(),origin:'http://fixture.example'},{...input(),expectedQQ:'me'},{...input(),label:' bad '},{...input(),label:'bad\u202ename'},{...input(),token:'short'},{...input(),token:'synthetic\u0000invalid'},{...input(),extra:true}])assert.throws(()=>f.registry.create(bad));
 assert.equal(fs.existsSync(f.file),false);f.registry.create(input());const bytes=fs.readFileSync(f.file);assert.throws(()=>f.registry.create(input()),code('origin_registered'));assert.deepEqual(fs.readFileSync(f.file),bytes);
});
test('registration count is bounded',t=>{const f=fixture(t);for(let n=0;n<MAX_ENTRIES;n++)f.registry.create(input(n));assert.throws(()=>f.registry.create(input(99)),code('registration_limit'));assert.equal(f.registry.list().items.length,MAX_ENTRIES);});
test('encryption unavailable never falls back to plaintext',t=>{const f=fixture(t),registry=new RemoteNapCatRegistry({...f.options,vault:{isEncryptionAvailable:()=>false}});assert.throws(()=>registry.create(input()),code('encryption_unavailable'));assert.equal(fs.existsSync(f.file),false);});
test('an existing vault cannot be replaced when encryption is locked',t=>{const f=fixture(t);f.registry.create(input());const bytes=fs.readFileSync(f.file),r=new RemoteNapCatRegistry({...f.options,vault:{isEncryptionAvailable:()=>false}});assert.deepEqual(r.list(),{state:'locked',items:[]});assert.throws(()=>r.create(input(2)),code('credentials_locked'));assert.deepEqual(fs.readFileSync(f.file),bytes);});
test('corrupt envelope and decrypt failure preserve existing bytes',t=>{const f=fixture(t);fs.writeFileSync(f.file,'{"version":1,"data":"broken"}');const bytes=fs.readFileSync(f.file),r=new RemoteNapCatRegistry(f.options);assert.equal(r.list().state,'locked');assert.throws(()=>r.create(input()),code('credentials_locked'));assert.deepEqual(fs.readFileSync(f.file),bytes);});
test('external replacement locks the live registry and cannot be overwritten',t=>{const f=fixture(t),row=f.registry.create(input());fs.writeFileSync(f.file,'external replacement');assert.throws(()=>f.registry.capture(row.remoteId),code('credentials_locked'));assert.equal(fs.readFileSync(f.file,'utf8'),'external replacement');});
test('stale revisions cannot change or forget a registration',t=>{const f=fixture(t),a=f.registry.create(input()),b=f.registry.update({remoteId:a.remoteId,revision:a.revision,patch:{label:'Renamed'}});assert.notEqual(a.revision,b.revision);assert.equal(a.credentialRevision,b.credentialRevision);assert.throws(()=>f.registry.forget({remoteId:a.remoteId,revision:a.revision}),code('registration_changed'));assert.throws(()=>f.registry.update({remoteId:a.remoteId,revision:a.revision,patch:{label:'Stale'}}),code('registration_changed'));});
test('trust and credential changes advance their own revisions without touching another record',t=>{const f=fixture(t),a=f.registry.create(input()),other=f.registry.create(input(2));const b=f.registry.update({remoteId:a.remoteId,revision:a.revision,patch:{trust:{spkiSha256:'a'.repeat(64)}}});assert.notEqual(b.trustRevision,a.trustRevision);assert.equal(b.credentialRevision,a.credentialRevision);const c=f.registry.update({remoteId:b.remoteId,revision:b.revision,patch:{token:'synthetic-new-token-2'}});assert.notEqual(c.credentialRevision,b.credentialRevision);assert.equal(c.trustRevision,b.trustRevision);assert.deepEqual(f.registry.list().items.find(row=>row.remoteId===other.remoteId),other);});
test('operation lease blocks overlapping mutations and expires on settlement',async t=>{
 const f=fixture(t),row=f.registry.create(input());let finish,owned;
 const running=f.registry.withOperation(row,async lease=>{owned=lease;await new Promise(resolve=>{finish=resolve;});return lease.capture().token;});
 // Public rows deliberately contain more fields; operation input is exact.
 await assert.rejects(running,code('invalid_request'));
 const operation=f.registry.withOperation({remoteId:row.remoteId,revision:row.revision},async lease=>{owned=lease;await new Promise(resolve=>{finish=resolve;});return lease.capture().token;});
 assert.throws(()=>f.registry.forget({remoteId:row.remoteId,revision:row.revision}),code('operation_in_progress'));
 await assert.rejects(f.registry.withOperation({remoteId:row.remoteId,revision:row.revision},()=>{}),code('operation_in_progress'));
 finish();assert.equal(await operation,input().token);assert.throws(()=>owned.capture(),code('operation_closed'));
 assert.deepEqual(f.registry.forget({remoteId:row.remoteId,revision:row.revision}),{forgotten:true});
});
test('failure releases only its own lease; another registration can still be saved',async t=>{const f=fixture(t),a=f.registry.create(input()),b=f.registry.create(input(2));await assert.rejects(f.registry.withOperation({remoteId:a.remoteId,revision:a.revision},async lease=>{f.registry.update({remoteId:b.remoteId,revision:b.revision,patch:{label:'Other renamed'}});lease.assertCurrent();throw Error('synthetic operation failure');}));f.registry.update({remoteId:a.remoteId,revision:a.revision,patch:{label:'Available again'}});});
test('rotation candidates persist before any remote submission and acknowledgement retains both',async t=>{
 const f=fixture(t),row=f.registry.create(input());await f.registry.withOperation({remoteId:row.remoteId,revision:row.revision},async lease=>{
  const prepared=lease.prepareRotation('synthetic-candidate-token-2');assert.equal(prepared.pendingRotation.outcome,'prepared');assert.equal(prepared.token,input().token);
  const reopened=new RemoteNapCatRegistry(f.options).capture(row.remoteId);assert.equal(reopened.pendingRotation.candidateToken,'synthetic-candidate-token-2');
  assert.equal(lease.recordRotation('acknowledged').pendingRotation.oldToken,input().token);
 });
 const current=f.registry.capture(row.remoteId);assert.throws(()=>f.registry.update({remoteId:row.remoteId,revision:current.revision,patch:{token:'synthetic-replacement-token-3'}}),code('rotation_unresolved'));
 assert.equal(JSON.stringify(f.registry.list()).includes('synthetic-candidate'),false);
});
test('unknown rotation needs explicit candidate choice and never discards the old token',async t=>{
 const f=fixture(t),row=f.registry.create(input());await f.registry.withOperation({remoteId:row.remoteId,revision:row.revision},async lease=>{lease.prepareRotation('synthetic-candidate-token-2');lease.recordRotation('unknown');});
 const entry=f.registry.capture(row.remoteId);assert.equal(entry.token,input().token);
 await f.registry.withOperation({remoteId:row.remoteId,revision:entry.revision},async lease=>{const chosen=lease.selectCredential('candidate');assert.equal(chosen.token,'synthetic-candidate-token-2');assert.equal(chosen.pendingRotation.oldToken,input().token);assert.equal(lease.selectCredential('current').token,input().token);});
});
test('failed candidate encryption prevents a prepared receipt and preserves original bytes',async t=>{
 const f=fixture(t),row=f.registry.create(input()),bytes=fs.readFileSync(f.file);f.registry.vault={...vault,encryptString(){throw Error('synthetic encryption failure');}};
 await assert.rejects(f.registry.withOperation({remoteId:row.remoteId,revision:row.revision},lease=>lease.prepareRotation('synthetic-candidate-token-2')),code('encryption_unavailable'));
 assert.deepEqual(fs.readFileSync(f.file),bytes);assert.equal(f.registry.capture(row.remoteId).pendingRotation,null);
});
test('explicit recovery completion keeps the selected credential and permits a subsequent rotation',async t=>{
 const f=fixture(t),row=f.registry.create(input());await f.registry.withOperation({remoteId:row.remoteId,revision:row.revision},lease=>{
  lease.prepareRotation('synthetic-candidate-token-2');lease.recordRotation('unknown');lease.selectCredential('candidate');
  const settled=lease.clearRotation();assert.equal(settled.pendingRotation,null);assert.equal(settled.token,'synthetic-candidate-token-2');
  const next=lease.prepareRotation('synthetic-candidate-token-3');assert.equal(next.pendingRotation.oldToken,'synthetic-candidate-token-2');
 });
});
test('file links and oversized containers fail closed',t=>{
 const f=fixture(t);f.registry.create(input());const link=path.join(f.root,'alias.json');fs.linkSync(f.file,link);assert.equal(new RemoteNapCatRegistry(f.options).list().state,'locked');
 fs.unlinkSync(link);fs.writeFileSync(f.file,Buffer.alloc(2*1024*1024+1));assert.equal(new RemoteNapCatRegistry(f.options).list().state,'locked');
});
