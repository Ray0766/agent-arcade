'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {randomBytes}=require('node:crypto');
const {acquireSingleInstance,instanceEndpoint,socketIdentity,STALE_TIMING}=require('../src/core/single-instance.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const namespace=()=>`arcade-guard-test-${randomBytes(8).toString('hex')}`;
const protocol='agent-arcade-window-v1';

function rawRequest(endpoint,payload){
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(endpoint);let text='';socket.setEncoding('utf8');
    socket.setTimeout(2500,()=>{socket.destroy();reject(Error('fixture socket timeout'));});
    socket.on('connect',()=>socket.write(payload));socket.on('data',chunk=>{text+=chunk;});
    socket.on('error',error=>{if(error.code!=='ECONNRESET')reject(error);});socket.on('close',()=>resolve(text));
  });
}

test('the endpoint follows the effective OS user, not a workspace or profile',()=>{
  const options={namespace:'agent-arcade',platform:'win32',hostname:'fixture-host',user:{username:'fixture-user',homedir:'C:\\Users\\fixture'}};
  const endpoint=instanceEndpoint(options);assert.match(endpoint,/^\\\\\.\\pipe\\agent-arcade-[a-f0-9]{32}$/);
  assert.equal(instanceEndpoint({...options,profile:'other',home:'different'}),endpoint);
  assert.notEqual(instanceEndpoint({...options,user:{...options.user,homedir:'C:\\Users\\other'}}),endpoint);
  assert.equal(endpoint.includes('fixture'),false);
  assert.throws(()=>instanceEndpoint({...options,namespace:'../../other'}),{code:'INSTANCE_UNAVAILABLE'});
});

test('a second invocation only raises the primary and close releases the guard',async t=>{
  const name=namespace();let raised=0;const first=await acquireSingleInstance({namespace:name,onRaise:()=>raised++});t.after(()=>first.close());
  assert.equal(first.primary,true);const second=await acquireSingleInstance({namespace:name});assert.equal(second.primary,false);assert.equal(raised,1);
  await second.close();await first.close();await first.close();
  const replacement=await acquireSingleInstance({namespace:name});assert.equal(replacement.primary,true);await replacement.close();
});

test('close releases the pipe even if a client has not finished its handshake',async t=>{
  const name=namespace(),first=await acquireSingleInstance({namespace:name});t.after(()=>first.close());
  const socket=net.createConnection(instanceEndpoint({namespace:name}));socket.on('error',()=>{});
  const closed=new Promise(resolve=>socket.once('close',resolve));await new Promise(resolve=>socket.once('connect',resolve));
  socket.write('{');await first.close();await closed;
  const next=await acquireSingleInstance({namespace:name});assert.equal(next.primary,true);await next.close();
});

test('oversized or unknown commands cannot raise the window or carry extra profile data',async t=>{
  const name=namespace();let raised=0;const primary=await acquireSingleInstance({namespace:name,onRaise:()=>raised++});t.after(()=>primary.close());
  const endpoint=instanceEndpoint({namespace:name}),base={protocol,command:'raise',nonce:'a'.repeat(32)};
  for(const payload of ['x'.repeat(513),JSON.stringify({...base,command:'open'})+'\n',JSON.stringify({...base,profile:'different'})+'\n',JSON.stringify(base)+'\n{}\n']){
    assert.equal(await rawRequest(endpoint,payload),'');assert.equal(raised,0);
  }
  const reply=JSON.parse(await rawRequest(endpoint,JSON.stringify(base)+'\n'));assert.equal(reply.event,'ack');assert.equal(reply.nonce,base.nonce);assert.equal(raised,1);
});

test('an unrelated listener or wrong challenge fails closed instead of opening another window',async t=>{
  const name=namespace(),endpoint=instanceEndpoint({namespace:name});
  const server=net.createServer(socket=>{socket.on('error',()=>{});socket.on('data',()=>socket.end(JSON.stringify({protocol,event:'ack',nonce:'0'.repeat(32)})+'\n'));});
  await new Promise(resolve=>server.listen(endpoint,resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  await assert.rejects(acquireSingleInstance({namespace:name}),{code:'INSTANCE_UNKNOWN'});
});

test('a nonresponsive listener has a finite handshake deadline',async t=>{
  const name=namespace(),endpoint=instanceEndpoint({namespace:name}),sockets=[];
  const server=net.createServer(socket=>{sockets.push(socket);socket.on('error',()=>{});socket.resume();});
  await new Promise(resolve=>server.listen(endpoint,resolve));t.after(()=>{for(const socket of sockets)socket.destroy();return new Promise(resolve=>server.close(resolve));});
  await assert.rejects(acquireSingleInstance({namespace:name}),{code:'INSTANCE_UNKNOWN'});
});

function helper(name,profile){
  const source=`const {acquireSingleInstance}=require(process.argv[1]);let guard;process.on('message',async message=>{if(message==='close'){await guard?.close();process.disconnect();}});void acquireSingleInstance({namespace:process.argv[2],onRaise:()=>process.send({kind:'raised'})}).then(value=>{guard=value;process.send({kind:'ready',primary:guard.primary});}).catch(error=>{process.send({kind:'failure',code:error.code});process.disconnect();});`;
  const child=spawn(process.execPath,['-e',source,path.resolve(__dirname,'../src/core/single-instance.cjs'),name,`--user-data-dir=${profile}`],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,AGENT_ARCADE_HOME:profile}});
  const messages=[];let stderr='';child.stderr.on('data',value=>{stderr+=value.toString().slice(0,1000);});child.stdout.resume();
  child.on('message',message=>messages.push(message));
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('fixture helper did not start')),5000);
    child.on('message',message=>{if(message.kind==='ready'){clearTimeout(timer);resolve(message);}else if(message.kind==='failure'){clearTimeout(timer);reject(Error(message.code));}});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);if(!messages.some(message=>message.kind==='ready'))reject(Error(`fixture exit ${code}: ${stderr}`));});
  });
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const close=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;const timer=setTimeout(()=>child.kill(),1500);if(child.connected)child.send('close');else child.kill();await exited;clearTimeout(timer);};
  const waitForRaises=count=>new Promise((resolve,reject)=>{
    let timer;const check=()=>{if(messages.filter(row=>row.kind==='raised').length>=count){clearTimeout(timer);child.removeListener('message',check);resolve();}};
    timer=setTimeout(()=>{child.removeListener('message',check);reject(Error('fixture raise not received'));},2000);child.on('message',check);check();
  });
  return {child,ready,messages,exited,close,waitForRaises};
}

test('real separate Node processes with different profiles contend for one primary',async t=>{
  const name=namespace(),children=[helper(name,'fixture-profile-a'),helper(name,'fixture-profile-b'),helper(name,'fixture-profile-c')];
  t.after(()=>Promise.all(children.map(item=>item.close())));
  const results=await Promise.all(children.map(item=>item.ready));assert.equal(results.filter(row=>row.primary).length,1);assert.equal(results.filter(row=>!row.primary).length,2);
  const primary=children[results.findIndex(row=>row.primary)];await primary.waitForRaises(2);assert.equal(primary.messages.filter(row=>row.kind==='raised').length,2);
  await Promise.all(children.map(item=>item.close()));
  const fresh=await acquireSingleInstance({namespace:name});assert.equal(fresh.primary,true);await fresh.close();
});

test('an exited owned helper cannot leave a Windows or Linux abstract pipe locked',{skip:!['win32','linux'].includes(process.platform)},async t=>{
  const name=namespace(),child=helper(name,'fixture-crash-profile');t.after(()=>child.close());
  assert.equal((await child.ready).primary,true);child.child.kill();await child.exited;
  const fresh=await acquireSingleInstance({namespace:name});assert.equal(fresh.primary,true);await fresh.close();
});

// The remaining cases are about a socket that is a file (macOS and other Unix).
// A Windows pipe or a Linux abstract socket leaves nothing behind.
const fileSocketOnly={skip:['win32','linux'].includes(process.platform)&&'Windows pipes and Linux abstract sockets leave no file behind'};
async function leftover(t,name){
  const child=helper(name,'fixture-leftover-profile');t.after(()=>child.close());
  assert.equal((await child.ready).primary,true);child.child.kill('SIGKILL');await child.exited;
  const endpoint=instanceEndpoint({namespace:name}),identity=socketIdentity(endpoint);
  assert(identity,'a killed owner leaves its socket file behind');t.after(()=>fs.rmSync(endpoint,{force:true}));
  return {endpoint,identity};
}

test('a socket file left by a killed owner is replaced, but only after repeated refused connections',fileSocketOnly,async t=>{
  const name=namespace(),{endpoint,identity}=await leftover(t,name),timing={...STALE_TIMING,freshMs:0,retryMs:50,refusals:4,settleMs:20};
  const started=Date.now(),fresh=await acquireSingleInstance({namespace:name,timing});t.after(()=>fresh.close());
  assert.equal(fresh.primary,true);
  // Four refusals with a pause after each of the first three: one refusal alone removes nothing.
  assert(Date.now()-started>=3*timing.retryMs,'the leftover was removed before the refusals were repeated');
  const replaced=socketIdentity(endpoint);assert(replaced);assert.notDeepEqual(replaced,identity);
  const second=await acquireSingleInstance({namespace:name,timing});assert.equal(second.primary,false);
  await fresh.close();assert.equal(socketIdentity(endpoint),null);
});

test('a new socket file is given time to start listening before refusals are believed',fileSocketOnly,async t=>{
  const name=namespace(),{endpoint,identity}=await leftover(t,name),timing={...STALE_TIMING,freshMs:900,retryMs:20,refusals:2,settleMs:20};
  const age=Date.now()-identity.birth;assert(age<timing.freshMs-300,'fixture: the leftover must still be new');
  // Whatever the outcome, the guard is closed so a failed check cannot keep this file's process alive.
  let done=false,guard;t.after(()=>guard?.close());const pending=acquireSingleInstance({namespace:name,timing}).then(value=>{done=true;guard=value;return value;});
  // Far more than two refusals fit in this wait; the file is new, so it stays.
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(done,false);assert.deepEqual(socketIdentity(endpoint),identity);
  const fresh=await pending;assert.equal(fresh.primary,true);
  assert(Date.now()-identity.birth>=timing.freshMs);await fresh.close();
});

test('the age of a live owner\'s socket file never removes it',fileSocketOnly,async t=>{
  const name=namespace(),endpoint=instanceEndpoint({namespace:name});let raised=0;
  const owner=await acquireSingleInstance({namespace:name,onRaise:()=>raised++});t.after(()=>owner.close());
  const identity=socketIdentity(endpoint);await new Promise(resolve=>setTimeout(resolve,60));
  const second=await acquireSingleInstance({namespace:name,timing:{...STALE_TIMING,freshMs:0,refusals:1,retryMs:1}});
  assert.equal(second.primary,false);assert.equal(raised,1);assert.deepEqual(socketIdentity(endpoint),identity);
});

test('something that is not a socket at the endpoint is left alone and the start fails closed',fileSocketOnly,async t=>{
  const name=namespace(),endpoint=instanceEndpoint({namespace:name});
  fs.writeFileSync(endpoint,'not a socket',{flag:'wx'});t.after(()=>fs.rmSync(endpoint,{force:true}));
  // Connecting to it fails with an error that is not "nobody listens", so nothing is retried or removed.
  await assert.rejects(acquireSingleInstance({namespace:name,timing:{...STALE_TIMING,acquireMs:250}}),{code:'INSTANCE_UNKNOWN'});
  assert.equal(fs.readFileSync(endpoint,'utf8'),'not a socket');
});

test('a starter whose new socket file was replaced lets go without removing the replacement',fileSocketOnly,async t=>{
  const name=namespace(),{endpoint,identity}=await leftover(t,name),timing={...STALE_TIMING,freshMs:0,retryMs:20,refusals:2,settleMs:400};
  let lost=0,raisedHere=0,raisedThere=0,guard;t.after(()=>guard?.close());
  const pending=acquireSingleInstance({namespace:name,timing,onRaise:()=>raisedHere++,onLost:()=>lost++}).then(value=>guard=value);
  // Wait until the starter has replaced the leftover with its own file ...
  let mine;for(const until=Date.now()+3000;Date.now()<until;await new Promise(resolve=>setTimeout(resolve,2))){
    mine=socketIdentity(endpoint);if(mine&&mine.ino!==identity.ino)break;mine=null;
  }
  assert(mine,'fixture: the starter never bound its own file');
  // ... then act as another starter that removed that file in the same instant and listens itself.
  fs.unlinkSync(endpoint);
  const rival=net.createServer(socket=>{socket.on('error',()=>{});let text='';socket.on('data',chunk=>{text+=chunk;if(!text.endsWith('\n'))return;raisedThere++;socket.end(JSON.stringify({protocol,event:'ack',nonce:JSON.parse(text).nonce})+'\n');});});
  await new Promise(resolve=>rival.listen(endpoint,resolve));t.after(()=>new Promise(resolve=>rival.close(resolve)));
  const theirs=socketIdentity(endpoint),result=await pending;
  assert.equal(result.primary,false);assert.equal(raisedThere,1);assert.equal(raisedHere,0);assert.equal(lost,0);
  await result.close();assert.deepEqual(socketIdentity(endpoint),theirs,'letting go must not remove the other starter\'s file');
});

function bootstrap({primary=true,worker=false,error,earlyRaise=false}={}){
  const app=new EventEmitter(),calls={main:0,worker:0,outputGuard:0,close:0,quits:0,exits:[],dialogs:[],raised:0,restored:0},windows=[];let ready=false,onRaise,onLost;
  Object.assign(app,{isReady:()=>ready,exit:code=>calls.exits.push(code),quit:()=>{calls.quits++;app.emit('will-quit');}});
  app.on('second-instance',(_event,argv,cwd)=>{calls.raised++;assert.deepEqual(Array.from(argv),[]);assert.equal(cwd,'fixture-primary-cwd');});
  const context={module:{exports:{}},process:{argv:worker?['electron','--arcade-vault-migration-worker']:['electron','--user-data-dir=fixture-secondary'],cwd:()=> 'fixture-primary-cwd'},setImmediate,
    require:name=>{
      if(name==='./bot/vault-migration-worker.cjs'){calls.worker++;return {run:async()=> 'worker-only'};}
      if(worker)throw Error('migration loaded ordinary application modules');
      if(name==='./core/desktop-stdio.cjs')return {guardDesktopOutput:()=>{calls.outputGuard++;}};      if(name==='electron')return {app,BrowserWindow:{getAllWindows:()=>windows},dialog:{showErrorBox:(title,message)=>calls.dialogs.push({title,message})}};
      if(name==='./core/single-instance.cjs')return {acquireSingleInstance:async options=>{onRaise=options.onRaise;onLost=options.onLost;if(earlyRaise)onRaise();if(error)throw error;return {primary,close:async()=>{calls.close++;}};}};
      if(name==='./main.cjs'){assert.equal(calls.outputGuard,1);calls.main++;return {};}
      throw Error('unexpected module');
    }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/bootstrap.cjs'),'utf8'),context);
  return {calls,app,completion:context.module.exports,raise:()=>onRaise(),loseOwnership:()=>onLost(),setReady:()=>{ready=true;app.emit('ready');},createWindow:()=>{windows.push({isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.restored++});app.emit('browser-window-created');}};
}

test('bootstrap queues raise until ready and a window exists, then releases on quit',async()=>{
  const h=bootstrap({earlyRaise:true});await h.completion;await tick();assert.equal(h.calls.main,1);assert.equal(h.calls.raised,0);
  h.setReady();await tick();assert.equal(h.calls.raised,0);h.createWindow();await tick();assert.equal(h.calls.raised,1);assert.equal(h.calls.restored,1);
  h.app.emit('will-quit');await tick();assert.equal(h.calls.close,1);h.raise();await tick();assert.equal(h.calls.raised,1);
});

test('secondary bootstrap never loads account services or creates a window',async()=>{
  const h=bootstrap({primary:false});await h.completion;assert.equal(h.calls.main,0);assert.deepEqual(h.calls.exits,[0]);assert.deepEqual(h.calls.dialogs,[]);
});

test('bootstrap quits normally when pipe ownership is unexpectedly lost',async()=>{
  const h=bootstrap();await h.completion;h.setReady();h.createWindow();await tick();h.loseOwnership();await tick();
  assert.equal(h.calls.quits,1);assert.equal(h.calls.close,1);h.raise();await tick();assert.equal(h.calls.raised,0);
});

test('unknown-listener bootstrap exits without exposing an arbitrary error message',async()=>{
  const h=bootstrap({error:Object.assign(Error('private arbitrary text'),{code:'INSTANCE_UNKNOWN'})});await h.completion;
  assert.equal(h.calls.main,0);assert.deepEqual(h.calls.exits,[1]);assert.equal(h.calls.dialogs.length,1);assert.equal(h.calls.dialogs[0].message.includes('private'),false);
});

test('migration bootstrap bypasses desktop guard, Electron window imports and main',async()=>{
  const h=bootstrap({worker:true});assert.equal(await h.completion,'worker-only');assert.equal(h.calls.worker,1);assert.equal(h.calls.main,0);assert.deepEqual(h.calls.exits,[]);
});
