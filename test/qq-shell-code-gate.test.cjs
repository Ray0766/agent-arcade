'use strict';
// Real OS-held gates and isolated directories; no QQ code, network or account.
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {withShellCodeGate,shellCodeRoot}=require('../src/bot/qq-shell-code-gate.cjs');
const {RELEASE_ID}=require('../src/bot/qq-managed-setup.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-shell-gate-'));t.after(()=>{const value=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());assert(value.toLowerCase().startsWith(parent.toLowerCase()+path.sep));fs.rmSync(value,{recursive:true,force:true});});return root;}

test('fixed canonical code scope is independent of installation and allows an absent code leaf',async t=>{
 const root=fixture(t),code=shellCodeRoot(root);assert.equal(code,path.join(root,'qq-component-versions','napcat-shell',RELEASE_ID,'code'));
 const entered=deferred(),release=deferred();const first=withShellCodeGate({root},async gate=>{gate();entered.resolve();await release.promise;gate();return 'one';});await entered.promise;
 try{await assert.rejects(withShellCodeGate({root:path.join(root,'.')},()=>assert.fail('second installation entered')),{code:'shell_repair_busy'});const other=path.join(root,'other-store');fs.mkdirSync(other);assert.equal(await withShellCodeGate({root:other},()=>2),2);}
 finally{release.resolve();}
 assert.equal(await first,'one');assert.equal(fs.existsSync(code),false);assert.equal(await withShellCodeGate({root},()=>3),3);
});

test('capabilities cannot be forged, moved to another root or used after their scope',async t=>{
 const root=fixture(t);let stale,inner;
 await assert.rejects(withShellCodeGate({root,gate:()=>{}},()=>{}),{code:'shell_repair_changed'});
 await withShellCodeGate({root},async gate=>{stale=gate;await withShellCodeGate({root,gate},async nested=>{inner=nested;nested();});assert.throws(inner,{code:'shell_repair_changed'});gate();await assert.rejects(withShellCodeGate({root:path.join(root,'different'),gate},()=>{}),{code:'shell_repair_changed'});});
 assert.throws(stale,{code:'shell_repair_changed'});await assert.rejects(withShellCodeGate({root,gate:stale},()=>{}),{code:'shell_repair_changed'});
});

test('nested cancellation does not authorize work or invalidate an unrelated outer owner',async t=>{
 const root=fixture(t),abort=new AbortController();
 await withShellCodeGate({root},async gate=>{await withShellCodeGate({root,gate,signal:abort.signal},nested=>{abort.abort();assert.throws(nested,{code:'cancelled'});});gate();});
 let entered=false;await assert.rejects(withShellCodeGate({root,signal:abort.signal},()=>{entered=true;}),{code:'cancelled'});assert.equal(entered,false);assert.equal(await withShellCodeGate({root},()=>true),true);
});

test('original parent replacement and junction aliases cannot retain a valid code gate',async t=>{
 const root=fixture(t),parent=path.dirname(shellCodeRoot(root));fs.mkdirSync(parent,{recursive:true});
 await withShellCodeGate({root},gate=>{fs.renameSync(parent,parent+'-old');fs.mkdirSync(parent);assert.throws(gate,{code:'shell_repair_changed'});});
 const outside=path.join(root,'other');fs.mkdirSync(outside);const alias=path.join(root,'alias');fs.symlinkSync(outside,alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(withShellCodeGate({root:alias},()=>assert.fail('alias entered')),{code:'shell_repair_unavailable'});fs.unlinkSync(alias);
});

test('gate releases on operation failure and keeps the original error facts',async t=>{
 const root=fixture(t),failure=Object.assign(new Error('synthetic operation failure'),{code:'shell_repair_unconfirmed',committed:null});
 await assert.rejects(withShellCodeGate({root},()=>{throw failure;}),error=>error===failure&&error.committed===null);
 assert.equal(await withShellCodeGate({root},()=>true),true);
});

test('a hidden separate process holds the shared gate until its actual exit',async t=>{
 const root=fixture(t),modulePath=require.resolve('../src/bot/qq-shell-code-gate.cjs');
 const script="const {withShellCodeGate}=require(process.argv[1]);withShellCodeGate({root:process.argv[2]},async gate=>{gate();process.send({held:true});await new Promise(resolve=>process.once('message',resolve));process.disconnect();}).catch(e=>{process.send({code:e.code});process.exitCode=2;});";
 const child=spawn(process.execPath,['-e',script,modulePath,root],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let exited=false;const exit=once(child,'exit').then(value=>{exited=true;return value;});let errorOutput='';child.stderr.on('data',chunk=>{errorOutput+=chunk;assert(errorOutput.length<4096);});
 t.after(async()=>{if(!exited)child.kill();await exit;});
 const message=await Promise.race([once(child,'message').then(([m])=>m),exit.then(()=>{throw Error('owned worker exited before gate');})]);assert.deepEqual(message,{held:true});
 await assert.rejects(withShellCodeGate({root},()=>assert.fail('parent entered owned child gate')),{code:'shell_repair_busy'});
 child.send({finish:true});const ended=await exit;assert.deepEqual(ended,[0,null]);assert.equal(errorOutput,'');assert.equal(await withShellCodeGate({root},()=>true),true);
});
