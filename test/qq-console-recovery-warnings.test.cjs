'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQConsole}=require('../src/bot/qq-console.cjs');
const A='12345001';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-recovery-warnings-')),calls=[];
  const runtime={instance:()=>({accountId:A}),discover:async()=>({configured:true,instances:[]}),start:async()=>{calls.push('start');return {management:'owned'};},close:async()=>({closed:true})};
  const profiles={list:async()=>[],configure:async()=>{calls.push('configure');return {created:false,backupCreated:true};}};
  const backups={restore:async()=>{calls.push('restore');return {restored:true,recheckBinding:true};}};
  const console=new QQConsole({root,runtimeFactory:()=>runtime,profileFactory:()=>profiles,backupFactory:()=>backups});
  t.after(async()=>{await console.close();fs.rmSync(root,{recursive:true,force:true});});return {console,runtime,profiles,backups,calls};
}
test('saved configuration preserves fixed cleanup warnings without changing the successful write receipt',async t=>{
  const f=fixture(t);f.profiles.configure=async()=>({created:false,backupCreated:true,configurationRecoveryIssue:'configuration_marker_retained',lockRecoveryIssue:'component_lock_handle_close_failed',privatePath:'SECRET'});
  const result=await f.console.configure(A,{});assert.equal(result.configured,true);assert.equal(result.backupCreated,true);assert.equal(result.configurationRecoveryIssue,'configuration_marker_retained');assert.equal(result.lockRecoveryIssue,'component_lock_handle_close_failed');assert(result.state);assert.doesNotMatch(JSON.stringify(result),/SECRET|privatePath/);
});
test('post-save discovery failure preserves both successful write and cleanup diagnostics',async t=>{
  const f=fixture(t);f.profiles.configure=async()=>({created:true,backupCreated:false,configurationRecoveryIssue:'configuration_handle_close_failed',lockRecoveryIssue:'component_lock_retained'});f.runtime.discover=async()=>{throw Object.assign(Error('private read failure'),{code:'process_check_failed'});};
  assert.deepEqual(await f.console.configure(A,{}),{configured:true,created:true,backupCreated:false,configurationRecoveryIssue:'configuration_handle_close_failed',lockRecoveryIssue:'component_lock_retained',refreshIssue:'process_check_failed'});
});
test('unknown or malformed cleanup diagnostics are projected to fixed uncertainty codes, never raw values',async t=>{
  const f=fixture(t);for(const value of ['PRIVATE_TOKEN_OR_PATH',{secret:'PRIVATE'},null]){f.profiles.configure=async()=>({created:false,backupCreated:false,configurationRecoveryIssue:value,lockRecoveryIssue:value});const result=await f.console.configure(A,{});assert.equal(result.configured,true);assert.equal(result.configurationRecoveryIssue,'configuration_cleanup_unverified');assert.equal(result.lockRecoveryIssue,'component_lock_state_unverified');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|secret/);}
});
test('successful start preserves its fixed lock cleanup warning without exposing the runtime internals',async t=>{
  const f=fixture(t);f.runtime.start=async()=>({management:'owned',lockRecoveryIssue:'component_lock_state_unverified',pid:700001,executable:'PRIVATE_PATH'});const result=await f.console.perform('start',{accountId:A});assert.equal(result.lockRecoveryIssue,'component_lock_state_unverified');assert(result.state);assert.doesNotMatch(JSON.stringify(result),/700001|PRIVATE_PATH|executable/);
});
test('backup restore keeps the actual restoration receipt while sanitizing cleanup diagnostics',async t=>{
  const f=fixture(t);f.backups.restore=async()=>({restored:true,recheckBinding:true,configurationRecoveryIssue:'PRIVATE_DIAGNOSTIC',lockRecoveryIssue:'component_lock_retained'});const result=await f.console.restoreBackup(A,{});assert.equal(result.restored,true);assert.equal(result.recheckBinding,true);assert.equal(result.configurationRecoveryIssue,'configuration_cleanup_unverified');assert.equal(result.lockRecoveryIssue,'component_lock_retained');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  f.runtime.discover=async()=>{throw Object.assign(Error('read failure'),{code:'process_check_failed'});};const failedRefresh=await f.console.restoreBackup(A,{});assert.equal(failedRefresh.restored,true);assert.equal(failedRefresh.configurationRecoveryIssue,'configuration_cleanup_unverified');assert.equal(failedRefresh.refreshIssue,'process_check_failed');
});
test('ordinary config and start results do not acquire a misleading cleanup warning',async t=>{
  const f=fixture(t);for(const result of [await f.console.configure(A,{}),await f.console.perform('start',{accountId:A}),await f.console.restoreBackup(A,{})]){assert.equal(Object.hasOwn(result,'configurationRecoveryIssue'),false);assert.equal(Object.hasOwn(result,'lockRecoveryIssue'),false);}assert.deepEqual(f.calls,['configure','start','restore']);
});
