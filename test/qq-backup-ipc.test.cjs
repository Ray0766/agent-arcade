'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const {validateBackupRequest}=require('../src/bot/qq-profile-backups.cjs');
const source=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
const start=source.indexOf("    register('qqRuntimeBackups'"),end=source.indexOf("    register('qqRuntimeConfigure'",start);
assert(start>=0&&end>start,'Locate the production backup registrations');
const id='12345001',sha='a'.repeat(64),request={accountId:id,backupId:`${createHash('sha256').update(id).digest('hex')}-1793880000000-11111111-2222-3333-4444-555555555555.json`,sha256:sha,currentSha256:'b'.repeat(64)};
function fixture(){
  const handlers=new Map(),rows=[],qqStopping=new Set(),calls=[];
  const qqConsole={listBackups:(...args)=>{calls.push(['list',...args]);return {backups:[]};},previewBackup:(...args)=>{calls.push(['preview',...args]);return {unchanged:true};},restoreBackup:async(...args)=>{calls.push(['restore',...args]);return {restored:true};}};
  vm.runInNewContext(source.slice(start,end),{register:(name,handler)=>handlers.set(name,handler),validateBackupRequest,qqConsole,qqStopping,accounts:{snapshot:()=>({accounts:rows})},qqResult:async operation=>{try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:error.code||'operation_failed'};}}});
  return {handlers,rows,qqStopping,calls,qqConsole};
}
test('production backup IPC rejects extra paths and does not call storage for malformed selections',async()=>{
  const f=fixture();assert.equal((await f.handlers.get('qqRuntimeBackups')({accountId:id,path:'private'})).code,'invalid_config');assert.equal((await f.handlers.get('qqRuntimeBackupRestore')({...request,currentSha256:'bad'})).code,'invalid_config');assert.equal(f.calls.length,0);
  assert.equal((await f.handlers.get('qqRuntimeBackups')({accountId:id,limit:30})).ok,true);assert.equal(f.calls[0][0],'list');
});
test('production restore IPC rejects known or unverified active QQ companions, but does not disconnect them',async()=>{
  const f=fixture();for(const row of [{channel:'qq',status:'connected',expectedQQAccountId:id},{channel:'qq',status:'connecting'},{channel:'qq',status:'checking',qqBinding:{accountId:id}}]){f.rows.splice(0,f.rows.length,row);assert.equal((await f.handlers.get('qqRuntimeBackupRestore')(request)).code,'account_connected');}assert.equal(f.calls.length,0);
  f.rows.splice(0,f.rows.length,{channel:'qq',status:'connected',accountId:'12345002'});assert.equal((await f.handlers.get('qqRuntimeBackupRestore')(request)).restored,true);
});
test('production restore blocks another operation for its account until completion and releases the guard after failure',async()=>{
  const f=fixture();let reject;f.qqConsole.restoreBackup=()=>new Promise((_resolve,no)=>{reject=no;});
  const first=f.handlers.get('qqRuntimeBackupRestore')(request);assert(f.qqStopping.has(id));assert.equal((await f.handlers.get('qqRuntimeBackupRestore')(request)).code,'operation_in_progress');reject(Object.assign(Error('Changed'),{code:'config_changed'}));assert.equal((await first).code,'config_changed');assert.equal(f.qqStopping.size,0);
});
