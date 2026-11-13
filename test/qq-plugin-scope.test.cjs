'use strict';
// Synthetic temporary installation metadata only; no QQ/plugin execution.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {capturePluginWorkScope}=require('../src/bot/qq-plugin-scope.cjs');
const {scopeProjection}=require('../src/bot/qq-plugin-admin.cjs');
const QQ='123456789',OTHER='234567891',OUTSIDE='345678912';
function fixture(t){
 const temp=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'qq-plugin-scope-'));
 t.after(()=>{assert(root.startsWith(temp+path.sep+'qq-plugin-scope-'));fs.rmSync(root,{recursive:true,force:true});});
 const make=name=>{const workDir=path.join(root,name),configDir=path.join(workDir,'config'),core=path.join(root,name+'.mjs');fs.mkdirSync(configDir,{recursive:true});fs.writeFileSync(core,'SYNTHETIC NONEXECUTABLE CORE');return {available:true,accounts:[QQ,OTHER],workDir,configDir,core,napcatVersion:'4.18.42',installationKind:'legacy'};};
 const first=make('work'),second=make('other-work'),rows=new Map([[QQ,first],[OTHER,first]]),calls=[];
 const runtime={instance(id){calls.push(id);if(!rows.has(id))throw Error('synthetic unknown installation');return rows.get(id);}};
 const profiles=[{accountId:'zeta',qqAccountId:QQ,label:'Synthetic current'},{accountId:'alpha',qqAccountId:OTHER,label:'Synthetic offline'}];
 const read=()=>capturePluginWorkScope({runtime,qqAccountId:QQ,profileId:'zeta',profiles});
 return {root,first,second,rows,calls,runtime,profiles,read};
}
test('shared work includes registered offline companions and returns no raw filesystem paths',t=>{
 const f=fixture(t),r=f.read();assert.equal(r.workScopeKind,'installation');assert.equal(r.componentVersion,'4.18.42');assert.match(r.workScope,/^[a-f0-9]{64}$/);
 assert.deepEqual(r.affectedProfiles,[{accountId:'alpha',label:'Synthetic offline'},{accountId:'zeta',label:'Synthetic current'}]);assert(!JSON.stringify(r).includes(f.root));
 f.profiles.reverse();assert.equal(f.read().workScope,r.workScope);
});
test('Node account directories isolate the preference scope instead of sharing codeRoot',t=>{
 const f=fixture(t);f.first.installationKind='managed-node';f.second.installationKind='managed-node';f.rows.set(OTHER,f.second);
 assert.equal(f.read().workScopeKind,'account');assert.deepEqual(f.read().affectedProfiles,[{accountId:'zeta',label:'Synthetic current'}]);
 f.rows.set(OTHER,f.first);assert.equal(f.read().affectedProfiles.length,2,'actual same directory is still disclosed');
});
test('unknown uninstalled registered accounts are skipped but a known account with unknown layout is rejected',t=>{
 const f=fixture(t);f.profiles.push({accountId:'outside',qqAccountId:OUTSIDE,label:'Synthetic other installation'});f.read();assert(!f.calls.includes(OUTSIDE));
 f.rows.delete(OTHER);assert.throws(f.read,{code:'changed'});
});
test('existing other work cannot be silently omitted when its metadata becomes unreadable',t=>{
 const f=fixture(t);f.rows.set(OTHER,{...f.second,workDir:path.join(f.root,'missing')});assert.throws(f.read,{code:'component_unavailable'});
});
test('version and selected installation availability fail closed',t=>{
 const f=fixture(t);f.first.available=false;assert.throws(f.read,{code:'component_unavailable'});f.first.available=true;
 f.first.napcatVersion='4.18.41';assert.throws(f.read,{code:'plugin_version_unsupported'});
 f.first.selectedNapcatVersion='4.18.42';assert.equal(f.read().componentVersion,'4.18.42');
 f.first.accounts=null;assert.throws(f.read,{code:'component_unavailable'});
});
test('canonical aliases are recognized as the same shared work identity',t=>{
 const f=fixture(t),alias=path.join(f.root,'work-alias');fs.symlinkSync(f.first.workDir,alias,process.platform==='win32'?'junction':'dir');
 f.rows.set(OTHER,{...f.first,workDir:alias});assert.equal(f.read().affectedProfiles.length,2);
});
test('directory replacement or core modification invalidates the captured scope',t=>{
 const f=fixture(t),before=f.read().workScope;
 fs.renameSync(f.first.workDir,path.join(f.root,'old-work'));fs.mkdirSync(f.first.configDir,{recursive:true});assert.notEqual(f.read().workScope,before);
 const next=f.read().workScope;fs.appendFileSync(f.first.core,' CHANGED');assert.notEqual(f.read().workScope,next);
});
test('shared registered identity changes bind a different scope, while labels remain separately observable',t=>{
 const f=fixture(t),before=f.read();f.profiles[1].accountId='beta';assert.notEqual(f.read().workScope,before.workScope);
 const renamed=f.read();f.profiles[1].label='Synthetic renamed';assert.notDeepEqual(f.read().affectedProfiles,renamed.affectedProfiles);
});
test('profile bounds, duplicate IDs and absence of the selected profile cannot create a scope',t=>{
 for(const change of [f=>f.profiles.push({...f.profiles[0]}),f=>f.profiles[0].accountId='bad/id',f=>f.profiles[0].label='bad\nlabel',f=>f.profiles[0].qqAccountId=OUTSIDE,f=>{while(f.profiles.length<33)f.profiles.push({accountId:'p'+f.profiles.length,qqAccountId:QQ,label:'Synthetic'});}]){
  const f=fixture(t);change(f);assert.throws(f.read,{code:'changed'});
 }
});
test('production helper ordering is accepted by the production controller projection for every valid ID case',t=>{
 const f=fixture(t);f.profiles.splice(0,f.profiles.length,{accountId:'A',qqAccountId:QQ,label:'Synthetic uppercase'},{accountId:'a',qqAccountId:OTHER,label:'Synthetic lowercase'});
 const r=capturePluginWorkScope({runtime:f.runtime,qqAccountId:QQ,profileId:'A',profiles:f.profiles});
 assert.deepEqual(scopeProjection({kind:r.workScopeKind,affectedProfiles:r.affectedProfiles}),{kind:r.workScopeKind,affectedProfiles:r.affectedProfiles});
});
