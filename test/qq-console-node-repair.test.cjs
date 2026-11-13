'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash,randomUUID}=require('node:crypto');
const {QQConsole}=require('../src/bot/qq-console.cjs');
const {metadataValues,SOURCE,REQUIRED,RELEASE_ID,VERSION}=require('../src/bot/qq-managed-node-repair-metadata.cjs');
const {NODE_FILES}=require('../src/bot/qq-managed-node-setup.cjs');
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-repair-console-')),root=path.join(base,'home'),store=path.join(base,'components'),setupId=randomUUID(),installationRoot=path.join(store,'qq-node-installations',setupId),versionRoot=path.join(store,'qq-component-versions','napcat-node',RELEASE_ID);
 fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(installationRoot,'instances'),{recursive:true});fs.mkdirSync(versionRoot,{recursive:true});
 // Synthetic metadata only. Pinned mandatory entries are not executed or
 // represented as an actual verified official archive/code tree.
 const manifest={schema:'qq_node_component_prepared_v1',component:'napcat-node',versionId:RELEASE_ID,version:VERSION,source:SOURCE,preparedAt:new Date().toISOString(),requiredFiles:REQUIRED,directories:['napcat','napcat/static'],files:[...Object.entries(NODE_FILES).map(([p,v])=>({path:p,...v})),{path:'napcat/static/fixture.txt',size:1,sha256:hash('x')}]};
 const manifestPath=path.join(versionRoot,'prepared.json'),manifestBytes=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(manifestPath,manifestBytes);
 const descriptor={schema:'qq_managed_node_v1',setupId,installationId:hash(installationRoot.toLowerCase()),engine:'managed-node',dataPolicy:'isolated-new',createdAt:new Date().toISOString(),publication:{method:'exclusive-link-v1',temporaryFile:`installation.${randomUUID()}.part`},...metadataValues(),current:{kind:'prepared',version:VERSION,versionId:RELEASE_ID,manifestSha256:hash(manifestBytes)},previous:null};
 const descriptorPath=path.join(installationRoot,'installation.json'),descriptorBytes=Buffer.from(JSON.stringify(descriptor));fs.writeFileSync(descriptorPath,descriptorBytes);
 const settingsPath=path.join(root,'qq-runtime-settings.json'),settings={version:2,current:{kind:'managed-node',setupId,descriptorSha256:hash(descriptorBytes)},previous:null};fs.writeFileSync(settingsPath,JSON.stringify(settings));
 let constructions=0;const runtime={discover:async()=>({configured:true,components:{available:true},instances:[]}),close:async()=>({closed:true})};
 const console=new QQConsole({root,componentStoreRoot:store,runtimeFactory:()=>{constructions++;return runtime;},profileFactory:()=>({list:async()=>[]})});
 t.after(async()=>{await console.close();fs.rmSync(base,{recursive:true,force:true});});
 return {console,base,root,store,setupId,manifestPath,descriptorPath,settingsPath,versionRoot,constructions:()=>constructions};
}
test('missing code keeps normal runtime unavailable but exposes metadata-only recovery without rewriting saved bytes',async t=>{
 const f=fixture(t),before=[f.manifestPath,f.descriptorPath,f.settingsPath].map(p=>hash(fs.readFileSync(p)));
 assert.equal(f.console.runtime,null);assert.equal(f.constructions(),0);const state=await f.console.refresh();assert.equal(state.configured,false);assert.equal(state.canInspectNodeRepair,true);
 assert.throws(()=>f.console.check(null,f.console.epoch));const capture=f.console.captureNodeRepairSelection({contextKey:'a'.repeat(64),knownRegisteredProfiles:[{profileId:'fixture_1',label:'搭档'}]});assert.equal(capture.setupId,f.setupId);assert.equal(capture.epoch,0);assert.doesNotMatch(JSON.stringify(capture),/manifestBytes|codeRoot|instancesRoot/);
 assert.deepEqual([f.manifestPath,f.descriptorPath,f.settingsPath].map(p=>hash(fs.readFileSync(p))),before);assert.equal(f.constructions(),0);
});
test('modified original manifest or changed installation selection removes recovery availability',async t=>{
 const f=fixture(t);fs.appendFileSync(f.manifestPath,' ');assert.equal(f.console.canInspectNodeRepair(),false);assert.throws(()=>f.console.captureNodeRepairSelection({contextKey:'a'.repeat(64)}),{code:'manifest_invalid'});
 const selected=JSON.parse(fs.readFileSync(f.settingsPath));selected.current.setupId=randomUUID();fs.writeFileSync(f.settingsPath,JSON.stringify(selected));assert.equal(f.console.canInspectNodeRepair(),false);assert.throws(()=>f.console.captureNodeRepairSelection({contextKey:'a'.repeat(64)}),{code:'node_repair_unavailable'});
});
test('post-repair refresh reuses original selection and only reconstructs a runtime, without starting QQ',async t=>{
 const f=fixture(t),captured=f.console.captureNodeRepairSelection({contextKey:'a'.repeat(64)}),before=fs.readFileSync(f.settingsPath);
 // The backend's full archive/code proof is a different suite. This test only
 // restores the structural precondition and verifies coordinator side effects.
 fs.mkdirSync(path.join(f.versionRoot,'code'));const state=await f.console.refreshAfterNodeRepair(captured);
 assert.equal(state.configured,true);assert.equal(f.constructions(),1);assert.equal(f.console.epoch,1);assert.equal(f.console.selectionIssue,null);assert(fs.readFileSync(f.settingsPath).equals(before));
 await assert.rejects(f.console.refreshAfterNodeRepair(captured),{code:'changed'});
});
