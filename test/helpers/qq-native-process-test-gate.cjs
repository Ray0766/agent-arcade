'use strict';
// Test scheduling only. Global Windows process snapshots cannot be isolated by
// temp directories: another native fixture may be observed while it is exiting.
// Never import this helper from product code. Crash-worker imports stay inert;
// only the parent fixture acquires the gate, so workers never reenter it.
const net=require('node:net'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),key=x=>path.resolve(x).toLowerCase();
const files=new Set(['qq-shell-owner-live.test.cjs','qq-shell-orphan-live.test.cjs','qq-supervisor-orphan-live.test.cjs','qq-pending-update-lock-crash.test.cjs'].map(x=>key(path.join(root,'test',x))));
const enrolled=process.platform==='win32'&&process.env.NODE_TEST_CONTEXT==='child-v8'&&typeof process.argv[1]==='string'&&files.has(key(process.argv[1]));
const WAIT=900000;
function error(code){return Object.assign(new Error(`Native test inventory gate: ${code}`),{code});}
function endpoint(namespace){
 if(typeof namespace!=='string'||!/^[a-z0-9-]{1,60}$/.test(namespace))throw error('invalid_namespace');
 const id=createHash('sha256').update(os.homedir().toLowerCase()).digest('hex').slice(0,24),name=`agent-arcade-native-tests-${id}-${namespace}`;
 return process.platform==='win32'?`\\\\.\\pipe\\${name}`:`\0${name}`;
}
function owner(server){
 let closed=false,closing=null,lost=false;server.on('error',()=>{lost=true;});
 return {assertHeld(){if(closed||lost||!server.listening)throw error('owner_lost');},async release(){if(closed)return;if(closing)return closing;
  closing=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(error('close_unconfirmed')),5000);server.close(e=>{clearTimeout(timer);if(e)reject(e);else{closed=true;lost?reject(error('owner_lost')):resolve();}});});
  try{await closing;}finally{closing=null;}
 }};
}
function acquire({namespace='inventory',timeoutMs=WAIT,signal}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>WAIT)throw error('invalid_timeout');
 const address=endpoint(namespace);
 return new Promise((resolve,reject)=>{
  let terminal=false,pending=false,requested=null,retry=null;
  const timer=setTimeout(()=>cancel(error('wait_timeout')),timeoutMs);
  const abort=()=>cancel(error('cancelled'));
  function clean(){clearTimeout(timer);clearTimeout(retry);signal?.removeEventListener('abort',abort);}
  function rejectNow(e){if(terminal)return;terminal=true;clean();reject(e);}
  function cancel(e){if(terminal)return;requested=e;clearTimeout(retry);if(!pending)rejectNow(e);}
  function attempt(){
   if(requested)return rejectNow(requested);
   pending=true;const server=net.createServer(socket=>socket.destroy());server.unref();
   server.once('error',e=>{if(terminal)return;pending=false;if(requested)return rejectNow(requested);if(e.code!=='EADDRINUSE')return rejectNow(e);retry=setTimeout(attempt,40);});
   server.once('listening',()=>{pending=false;const lease=owner(server);if(requested){lease.release().then(()=>rejectNow(requested),rejectNow);return;}terminal=true;clean();resolve(lease);});
   try{server.listen(address);}catch(e){pending=false;rejectNow(e);}
  }
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)cancel(error('cancelled'));if(!terminal)attempt();
 });
}

let fileOwner=null,poisoned=false,activeFixtures=0;
const fallbackScopes=new WeakMap();
if(enrolled){
 const test=require('node:test');
 // Queue outside per-case 180/240-second budgets; unrelated test files remain
 // concurrent. Workers load only their normal fixture loader, not these hooks.
 test.before(async()=>{fileOwner=await acquire();},{timeout:WAIT+5000});
 test.after(async()=>{if(poisoned||activeFixtures)throw error('fixture_cleanup_unconfirmed');if(fileOwner)await fileOwner.release();},{timeout:10000});
}
async function withFixture(t,build,{namespace='inventory'}={}){
 if(typeof t?.after!=='function'||typeof build!=='function')throw error('invalid_fixture');
 if(enrolled&&namespace!=='inventory')throw error('invalid_namespace');
 if(poisoned)throw error('fixture_cleanup_unconfirmed');
 if(enrolled&&!fileOwner)throw error('file_gate_missing');
 let scope=null;
 if(!enrolled){
  scope=fallbackScopes.get(t);
  if(scope&&scope.namespace!==namespace)throw error('scope_changed');
  if(!scope){scope={pending:acquire({namespace}),namespace,lease:null,refs:0};fallbackScopes.set(t,scope);}
  try{scope.lease=await scope.pending;}catch(e){fallbackScopes.delete(t);throw e;}
 }
 if(poisoned)throw error('fixture_cleanup_unconfirmed');
 (fileOwner||scope.lease).assertHeld();activeFixtures++;if(scope)scope.refs++;
 let registered=0,finished=0,constructionDone=false,cleanupFailed=false,settled=false;
 async function finishedCleanup(){
  finished++;if(!constructionDone||finished!==registered||settled)return;
  if(cleanupFailed||poisoned)throw error('fixture_cleanup_unconfirmed');
  settled=true;activeFixtures--;
  if(scope&&--scope.refs===0){try{await scope.lease.release();fallbackScopes.delete(t);}catch(e){poisoned=true;throw e;}}
 }
 function register(fn,...options){
  if(typeof fn!=='function')throw error('invalid_cleanup');registered++;
  return t.after(async function(...args){let result,failure;try{result=await fn.apply(this,args);}catch(e){cleanupFailed=true;poisoned=true;failure=e;}try{await finishedCleanup();}catch(e){if(!failure)failure=e;}if(failure)throw failure;return result;},...options);
 }
 const observed=new Proxy(t,{get(target,k){if(k==='after')return register;const v=Reflect.get(target,k,target);return typeof v==='function'?v.bind(target):v;}});
 // Native node:test uses FIFO hooks; existing browser scripts run their fake
 // hooks in reverse. Count completed callbacks, never depend on either order.
 // Multiple fixtures within the same fake context share one scope owner.
 register(async()=>{});
 try{return await build(observed);}catch(e){poisoned=true;throw e;}
 finally{constructionDone=true;}
}
module.exports={acquire,withFixture,endpoint};
