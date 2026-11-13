'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const F=require('../src/bot/qq-node-repair-fs.cjs'),M=require('../src/bot/qq-managed-node-repair-metadata.cjs');
const {metadataFixture}=require('./helpers/qq-node-repair-fixture.cjs');
test('metadata-only recovery admits absent code without weakening the ordinary reader',t=>{
 const f=metadataFixture(t,{missingCode:true}),selected=f.records[0],v=M.readManagedNodeRepairMetadata({root:f.root,setupId:selected.setupId,descriptorSha256:selected.descriptorSha256});assert.equal(v.repairMetadata.codePresence,'absent');assert.equal(v.verification,'repair-metadata-only');assert.equal(v.manifestBytes.toString(),f.manifestRaw.toString());assert.equal(v.current.manifestSha256,F.sha(f.manifestRaw));assert.throws(()=>require('../src/bot/qq-managed-node-setup.cjs').readManagedNodeInstallation({root:f.root,setupId:selected.setupId}));assert.equal(fs.existsSync(f.p.codeRoot),false);
 const actual=fs.statSync(selected.paths.descriptor,{bigint:true});assert.equal(v.repairMetadata.descriptorIdentity.ino,actual.ino.toString());assert.equal(v.repairMetadata.descriptorIdentity.birthtimeNs,actual.birthtimeNs.toString());assert.doesNotThrow(()=>JSON.stringify(v.repairMetadata));
});
test('descriptor, complete manifest, source and non-reference paths fail closed',t=>{
 const f=metadataFixture(t),record=f.records[0],read=()=>M.readManagedNodeRepairMetadata({root:f.root,setupId:record.setupId,descriptorSha256:record.descriptorSha256});const bytes=fs.readFileSync(record.paths.descriptor);
 for(const mutate of [v=>v.engine='managed-shell',v=>v.previous={},v=>v.current.version='4.18.43',v=>v.node.sha256='0'.repeat(64),v=>v.codeRoot=f.temp]){const v=JSON.parse(bytes);mutate(v);fs.writeFileSync(record.paths.descriptor,JSON.stringify(v));assert.throws(read);fs.writeFileSync(record.paths.descriptor,bytes);}
 for(const mutate of [v=>delete v.directories,v=>v.source.assetId++,v=>v.files.push({...v.files[0],path:v.files[0].path.toUpperCase()}),v=>v.directories.push('../outside'),v=>v.requiredFiles.pop()]){const v=structuredClone(f.manifest);mutate(v);assert.throws(()=>M.manifestValue(v));}
 fs.appendFileSync(f.p.manifestPath,' ');assert.throws(read,{code:'manifest_invalid'});fs.writeFileSync(f.p.manifestPath,f.manifestRaw);fs.linkSync(record.paths.descriptor,path.join(record.paths.installationRoot,'other'));assert.throws(read,{code:'unsafe_path'});
});
test('code junctions, unexpected parent contents and same-byte descriptor replacements are rejected by captures',t=>{
 const f=metadataFixture(t,{missingCode:true}),r=f.records[0],first=M.readManagedNodeRepairMetadata({root:f.root,setupId:r.setupId});fs.symlinkSync(f.temp,f.p.codeRoot,'junction');assert.throws(()=>M.readManagedNodeRepairMetadata({root:f.root,setupId:r.setupId}),{code:'unsafe_path'});fs.unlinkSync(f.p.codeRoot);
 const old=path.join(f.temp,'old-descriptor');fs.renameSync(r.paths.descriptor,old);fs.copyFileSync(old,r.paths.descriptor);const second=M.readManagedNodeRepairMetadata({root:f.root,setupId:r.setupId});assert.equal(second.descriptorSha256,first.descriptorSha256);assert.equal(F.sameIdentity(first.repairMetadata.descriptorIdentity,second.repairMetadata.descriptorIdentity),false);
});
test('exact BigInt identities preserve differences which Number would collapse',()=>{
 const a={dev:1n,ino:9007199254740992n,birthtimeNs:1800000000000000000n,mtimeNs:1n,ctimeNs:2n,size:0n,nlink:1n},b={...a,ino:a.ino+1n};assert.equal(Number(a.ino),Number(b.ino));assert.equal(F.sameIdentity(F.proof(a),F.proof(b)),false);assert.equal(JSON.parse(JSON.stringify(F.proof(a))).birthtimeNs,a.birthtimeNs.toString());
});
test('live pending and malformed terminal block start while retirement-only metadata does not',t=>{
 const f=metadataFixture(t);M.assertManagedNodeRepairReady({root:f.root});fs.mkdirSync(f.p.retirementsRoot,{recursive:true});fs.writeFileSync(path.join(f.p.retirementsRoot,randomUUID()+'.json'),'SYNTHETIC_RETIREMENT');M.assertManagedNodeRepairReady({root:f.root});fs.writeFileSync(f.p.pending,'{');assert.throws(()=>M.assertManagedNodeRepairReady({root:f.root}),{code:'node_repair_recovery_required'});fs.unlinkSync(f.p.pending);
 const id=randomUUID(),dir=path.join(f.p.operationsRoot,id);fs.mkdirSync(dir,{recursive:true});const intent=Buffer.from('{"synthetic":true}');fs.writeFileSync(path.join(dir,'intent.json'),intent);assert.throws(()=>M.assertManagedNodeRepairReady({root:f.root}),{code:'node_repair_recovery_required'});fs.writeFileSync(path.join(dir,'terminal.json'),'{');assert.throws(()=>M.assertManagedNodeRepairReady({root:f.root}),{code:'node_repair_recovery_required'});fs.writeFileSync(path.join(dir,'terminal.json'),JSON.stringify({schema:'qq_node_code_terminal_v1',operationId:id,intentSha256:F.sha(intent),outcome:'completed',at:1}));M.assertManagedNodeRepairReady({root:f.root});
});
test('failed metadata close retains the exact descriptor and can be retried',t=>{
 const f=metadataFixture(t);let fd,once=true;f.io.closeSync=n=>{if(once){once=false;fd=n;throw Object.assign(Error('SYNTHETIC_CLOSE'),{code:'EIO'});}return fs.closeSync(n);};assert.throws(()=>F.read(f.p.manifestPath,{io:f.io}),{code:'node_repair_cleanup_unconfirmed'});assert(fs.fstatSync(fd).isFile());F.retryCloses(f.io);assert.throws(()=>fs.fstatSync(fd),{code:'EBADF'});assert.equal(F.read(f.p.manifestPath,{io:f.io}).sha256,F.sha(f.manifestRaw));
});
