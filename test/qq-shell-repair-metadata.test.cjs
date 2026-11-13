'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const F=require('../src/bot/qq-node-repair-fs.cjs'),M=require('../src/bot/qq-managed-shell-repair-metadata.cjs');
const {readManagedShellInstallation}=require('../src/bot/qq-managed-setup.cjs');
const {QQNodeRepairStage}=require('../src/bot/qq-node-repair-stage.cjs');
function fixture(t,{missing=false}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-shell-metadata-')),root=path.join(temp,'components'),setupId=randomUUID(),p=M.paths(root,setupId);
 for(const dir of [p.configDir,p.qqDataDir,p.versionRoot])fs.mkdirSync(dir,{recursive:true});if(!missing)fs.mkdirSync(p.codeRoot);
 const manifest={schema:'qq_component_prepared_v1',component:'napcat-shell',versionId:M.RELEASE_ID,version:M.VERSION,source:{...M.SOURCE},preparedAt:new Date().toISOString(),requiredFiles:[...M.REQUIRED],directories:['static'],files:[...M.REQUIRED,'static/index.html'].sort().map(name=>({path:name,size:1,sha256:F.sha(name)}))};
 fs.writeFileSync(p.manifestPath,JSON.stringify(manifest));
 const value={schema:'qq_managed_shell_v1',setupId,installationId:F.sha(p.installationRoot.toLowerCase()),engine:'managed-shell',dataPolicy:'isolated-new',createdAt:new Date().toISOString(),publication:{method:'exclusive-link-v1',temporaryFile:`installation.${randomUUID()}.part`},qq:{file:path.join(temp,'QQ.exe'),architecture:'x64',size:2048,sha256:'a'.repeat(64),identity:{dev:1,ino:2,size:2048,mtimeMs:3},version:'9.9.36.53644',productName:'QQ',companyName:'Tencent',signature:{status:'Valid',subject:'CN=Tencent',thumbprint:'a'.repeat(40)},observedAt:new Date().toISOString()},current:{kind:'prepared',version:M.VERSION,versionId:M.RELEASE_ID,manifestSha256:F.sha(fs.readFileSync(p.manifestPath))},previous:null};
 fs.writeFileSync(p.descriptor,JSON.stringify(value));fs.writeFileSync(path.join(p.configDir,'private.json'),'DO_NOT_READ');fs.writeFileSync(path.join(p.qqDataDir,'private.db'),'DO_NOT_READ');if(!missing)fs.writeFileSync(path.join(p.codeRoot,'damaged.bin'),'DAMAGED');
 t.after(()=>{const actual=fs.realpathSync(temp),base=fs.realpathSync(os.tmpdir());assert.equal(path.dirname(actual).toLowerCase(),base.toLowerCase());assert(path.basename(actual).startsWith('arcade-shell-metadata-'));fs.rmSync(actual,{recursive:true,force:true});});
 const io=Object.create(fs),opens=[];io.openSync=(file,...args)=>{opens.push(String(file));assert(!String(file).startsWith(p.configDir+path.sep));assert(!String(file).startsWith(p.qqDataDir+path.sep));assert(!String(file).startsWith(p.codeRoot+path.sep));assert.notEqual(file,value.qq.file);return fs.openSync(file,...args);};
 return {root,setupId,p,value,manifest,io,opens,read:()=>M.readManagedShellRepairMetadata({root,setupId,io})};
}
test('damaged and absent Shell code remain metadata-readable without opening program, configuration or data',t=>{
 for(const missing of [false,true]){const f=fixture(t,{missing}),before=fs.readFileSync(f.p.descriptor),r=f.read();assert.equal(r.verification,'repair-metadata-only');assert.equal(r.repairMetadata.codePresence,missing?'absent':'present');assert.equal(r.prepared.versionId,M.RELEASE_ID);assert.equal(r.descriptorSha256,F.sha(before));assert.deepEqual(r.qq,readManagedShellInstallation({root:f.root,setupId:f.setupId}).qq);assert(r.repairMetadata.workIdentity&&r.repairMetadata.configIdentity&&r.repairMetadata.qqDataIdentity);assert(fs.readFileSync(f.p.descriptor).equals(before));assert(f.opens.length>0);}
});
test('descriptor digest, fixed selection, signature and unexpected descriptor fields are not relaxed',t=>{
 const f=fixture(t);assert.throws(()=>M.readManagedShellRepairMetadata({root:f.root,setupId:f.setupId,descriptorSha256:'f'.repeat(64)}),{code:'managed_installation_changed'});
 for(const mutate of [v=>v.current.version='4.18.41',v=>v.qq.signature.status='NotSigned',v=>v.previous={kind:'original'},v=>v.unknown='untrusted']){const v=structuredClone(f.value);mutate(v);fs.writeFileSync(f.p.descriptor,JSON.stringify(v));assert.throws(f.read);}
});
test('prepared manifest must match descriptor and fixed archive, bounded names and complete layout',t=>{
 const f=fixture(t);fs.appendFileSync(f.p.manifestPath,' ');assert.throws(f.read,{code:'manifest_invalid'});
 for(const mutate of [v=>v.source.sha256='b'.repeat(64),v=>v.files.push({...v.files[0]}),v=>v.files[0].path='../outside',v=>v.files[0].size=F.LIMITS.maxFileBytes+1,v=>v.directories=[],v=>v.files=v.files.filter(r=>r.path!==M.REQUIRED[0]),v=>v.files=v.files.filter(r=>!r.path.startsWith('static/'))]){const v=structuredClone(f.manifest);mutate(v);assert.throws(()=>M.manifestValue(v));}
});
test('unexpected installation content and code junctions are kept and rejected',t=>{
 const f=fixture(t),extra=path.join(f.p.installationRoot,'unexpected');fs.writeFileSync(extra,'retain');assert.throws(f.read,{code:'shell_repair_unavailable'});assert.equal(fs.readFileSync(extra,'utf8'),'retain');fs.unlinkSync(extra);
 fs.renameSync(f.p.codeRoot,path.join(f.root,'held-code'));fs.symlinkSync(path.join(f.root,'held-code'),f.p.codeRoot,'junction');assert.throws(f.read,{code:'unsafe_path'});
});
test('descriptor replacement during authoritative metadata read is detected even with equal bytes',t=>{
 const f=fixture(t);let reads=0;f.io.openSync=(file,...args)=>{if(file===f.p.descriptor&&++reads===2){const original=fs.readFileSync(file),replacement=path.join(f.root,'descriptor-copy');fs.writeFileSync(replacement,original);fs.renameSync(replacement,file);}return fs.openSync(file,...args);};assert.throws(f.read,{code:'program_changed'});
});
test('pending marker and unterminated durable intent block starts until an exact terminal is present',t=>{
 const f=fixture(t);assert.equal(M.assertManagedShellRepairReady({root:f.root}),undefined);fs.mkdirSync(f.p.operationsRoot,{recursive:true});fs.writeFileSync(f.p.pending,'partial');assert.throws(()=>M.assertManagedShellRepairReady({root:f.root}),{code:'shell_repair_recovery_required'});fs.unlinkSync(f.p.pending);
 const id=randomUUID(),dir=path.join(f.p.operationsRoot,id);fs.mkdirSync(dir);const intent=Buffer.from('durable-owned-intent');fs.writeFileSync(path.join(dir,'intent.json'),intent);assert.throws(()=>M.assertManagedShellRepairReady({root:f.root}),{code:'shell_repair_recovery_required'});
 const terminal={schema:'qq_shell_code_terminal_v1',operationId:id,intentSha256:F.sha(intent),outcome:'completed',at:123};fs.writeFileSync(path.join(dir,'terminal.json'),JSON.stringify(terminal));assert.equal(M.assertManagedShellRepairReady({root:f.root}),undefined);
 fs.writeFileSync(path.join(dir,'intent.json'),'changed');assert.throws(()=>M.assertManagedShellRepairReady({root:f.root}),{code:'shell_repair_recovery_required'});
});
test('Shell stage is cache-only while Node default keeps its original package staging fallback',async t=>{
 const f=fixture(t);let verified=0,staged=0;const packages={verify:async({version})=>{assert.equal(version,M.VERSION);verified++;throw Object.assign(Error('not cached'),{code:'package_not_staged'});},stage:async()=>{staged++;return null;}};
 const shell=new QQNodeRepairStage({component:'napcat-shell',packages});await assert.rejects(shell.prepare({operationDir:f.root,manifest:f.manifest}),{code:'shell_repair_source_unavailable'});assert.equal(verified,1);assert.equal(staged,0);assert.equal(shell.handles.size,0);await shell.close();
 const node=new QQNodeRepairStage({packages});await assert.rejects(node.prepare({operationDir:f.root,manifest:f.manifest}),{code:'node_repair_source_unavailable'});assert.equal(verified,2);assert.equal(staged,1);await node.close();
});
test('Shell refuses a Node or mismatched source before opening it, and cancellation makes no stage',async t=>{
 const f=fixture(t);let opened=0;const io=Object.create(fs);io.openSync=()=>{opened++;assert.fail('No artifact must be opened');};
 const stage=new QQNodeRepairStage({component:'napcat-shell',io,packages:{verify:async()=>({component:'napcat-node',version:M.VERSION,state:'verified-staged',...M.SOURCE,file:'not-used'})}});await assert.rejects(stage.prepare({operationDir:f.root,manifest:f.manifest}),{code:'shell_repair_source_unavailable'});assert.equal(opened,0);await stage.close();
 const controller=new AbortController();controller.abort();const cancelled=new QQNodeRepairStage({component:'napcat-shell',packages:{verify:()=>assert.fail('No verify after cancellation')}});await assert.rejects(cancelled.prepare({operationDir:f.root,manifest:f.manifest,signal:controller.signal}),{code:'cancelled'});assert(!fs.existsSync(path.join(f.root,'staged-code')));await cancelled.close();
});
