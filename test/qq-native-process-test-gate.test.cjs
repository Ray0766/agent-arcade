'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {acquire,withFixture}=require('./helpers/qq-native-process-test-gate.cjs');
const options={skip:process.platform!=='win32',timeout:20000};
function child(t,namespace,timeoutMs=4000){
 const helper=path.join(__dirname,'helpers','qq-native-process-test-gate.cjs');
 const code=`const {acquire}=require(${JSON.stringify(helper)});const controller=new AbortController();let lease;process.on('message',async message=>{if(message==='cancel')controller.abort();if(message==='release'&&lease){await lease.release();process.exit(0);}if(message==='exit')process.exit(86);});process.send({event:'attempting'});acquire({namespace:${JSON.stringify(namespace)},timeoutMs:${timeoutMs},signal:controller.signal}).then(value=>{lease=value;process.send({event:'acquired'});},e=>{process.send({event:'rejected',code:e.code},()=>process.exit(0));});`;
 const p=spawn(process.execPath,['-e',code],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']}),messages=[],waiters=[];let stderr='';p.stderr.on('data',b=>stderr+=b);
 const exited=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',code=>{for(const w of waiters.splice(0))w.reject(Error('child closed before event: '+stderr));resolve(code);});});
 p.on('message',m=>{messages.push(m);for(const w of [...waiters])if(w.event===m.event){waiters.splice(waiters.indexOf(w),1);w.resolve(m);}});
 t.after(async()=>{if(p.exitCode===null&&p.connected)p.send('exit');await exited;});
 return {p,exited,wait(event){const old=messages.find(m=>m.event===event);if(old)return Promise.resolve(old);if(p.exitCode!==null)return Promise.reject(Error('child already closed'));return new Promise((resolve,reject)=>waiters.push({event,resolve,reject}));}};
}
test('native test inventory gate excludes an independent process then allows explicit handoff',options,async t=>{
 const namespace='test-'+randomUUID(),held=await acquire({namespace});t.after(()=>held.release());
 const blocked=child(t,namespace,180);assert.equal((await blocked.wait('rejected')).code,'wait_timeout');assert.equal(await blocked.exited,0);held.assertHeld();
 await held.release();const next=child(t,namespace);await next.wait('acquired');next.p.send('release');assert.equal(await next.exited,0);
});
test('cancelling a separate waiting process leaves the current test owner intact',options,async t=>{
 const namespace='test-'+randomUUID(),held=await acquire({namespace});t.after(()=>held.release());const waiting=child(t,namespace);await waiting.wait('attempting');waiting.p.send('cancel');
 assert.equal((await waiting.wait('rejected')).code,'cancelled');assert.equal(await waiting.exited,0);held.assertHeld();await held.release();
 const after=await acquire({namespace,timeoutMs:1000});await after.release();
});
test('test gate held by an independently exited process leaves no stale disk lock',options,async t=>{
 const namespace='test-'+randomUUID(),first=child(t,namespace);await first.wait('acquired');first.p.send('exit');assert.equal(await first.exited,86);
 const next=await acquire({namespace,timeoutMs:2000});next.assertHeld();await next.release();
});
for(const reverse of [false,true])test(`multiple native fixtures share a fake context until all ${reverse?'reverse':'FIFO'} cleanup callbacks finish`,options,async()=>{
 const namespace='test-'+randomUUID(),callbacks=[],done=[],scope={after:fn=>callbacks.push(fn)};
 for(const name of ['first','second'])await withFixture(scope,async t=>{t.after(async()=>{done.push(name);});},{namespace});
 await assert.rejects(acquire({namespace,timeoutMs:80}),{code:'wait_timeout'});
 const ordered=reverse?[...callbacks].reverse():callbacks;
 for(let i=0;i<ordered.length-1;i++)await ordered[i]();
 await assert.rejects(acquire({namespace,timeoutMs:80}),{code:'wait_timeout'});
 await ordered.at(-1)();assert.equal(done.length,2);const next=await acquire({namespace,timeoutMs:1000});await next.release();
 // A reused fake context must get a fresh owner, never a previously closed one.
 callbacks.length=0;await withFixture(scope,async t=>{t.after(async()=>{});},{namespace});for(const fn of callbacks)await fn();
});
test('an original cleanup error immediately prevents a later fixture in the same process',options,async t=>{
 const helper=path.join(__dirname,'helpers','qq-native-process-test-gate.cjs'),namespace='test-'+randomUUID();
 const code=`const assert=require('node:assert/strict'),{withFixture}=require(${JSON.stringify(helper)});(async()=>{const hooks=[],t={after:fn=>hooks.push(fn)};await withFixture(t,async s=>{s.after(async()=>{throw Object.assign(Error('original cleanup failed'),{code:'ORIGINAL'});});},{namespace:${JSON.stringify(namespace)}});await hooks[0]();await assert.rejects(hooks[1](),{code:'ORIGINAL'});let started=false;await assert.rejects(withFixture({after(){}},async()=>{started=true;}),{code:'fixture_cleanup_unconfirmed'});assert.equal(started,false);process.stdout.write('CONFIRMED');})().catch(e=>{console.error(e);process.exitCode=1;});`;
 const p=spawn(process.execPath,['-e',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);const codeExit=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});assert.equal(codeExit,0,err);assert.equal(out,'CONFIRMED');
 const after=await acquire({namespace,timeoutMs:1000});await after.release();
});
