'use strict';
// Actual release archives -> unmodified production ASAR -> normal bootstrap/main.
// Inspector changes only this disposable process's identity, guard namespace and
// network transport. No owner profile, original CLI login or real model is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),http=require('node:http');
const {spawn,execFileSync}=require('node:child_process');
const {createHash,randomBytes}=require('node:crypto');
const PROJECT=path.resolve(__dirname,'..'),FAKE_KEY='fixture-integrated-mac-api-key';
const BOOTSTRAP_URL=/[/\\]app\.asar[/\\]src[/\\]bootstrap\.cjs$/;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const command=(exe,args)=>execFileSync(exe,args,{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
function contained(file,root){const relative=path.relative(fs.realpathSync(root),fs.realpathSync(file));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Test target leaves disposable root.');return fs.realpathSync(file);}
function artifactType(file){if(/\.zip$/i.test(file))return 'zip';if(/\.dmg$/i.test(file))return 'dmg';throw Error('Use the final .zip or .dmg artifact, not an unpacked developer App.');}
function parseArgs(argv){
 const options={artifacts:[]};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!['--artifact','--output','--modules','--seed-app'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Usage: node scripts/integrated-mac-package-smoke.cjs --artifact FINAL.zip [--artifact FINAL.dmg] [--seed-app OLD.app] [--modules NODE_MODULES] [--output DIRECTORY]');
  const value=path.resolve(argv[++i]);if(key==='--artifact'){artifactType(value);options.artifacts.push(value);}else options[key.slice(2).replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase())]=value;
 }
 if(options.artifacts.length<1||options.artifacts.length>2||new Set(options.artifacts).size!==options.artifacts.length)throw Error('Provide one or two distinct final archives.');
 return options;
}
function findApp(root,depth=0){
 if(depth>2)return [];
 return fs.readdirSync(root,{withFileTypes:true}).flatMap(item=>{
  const file=path.join(root,item.name);if(item.isSymbolicLink()||!item.isDirectory())return [];
  return item.name.endsWith('.app')?[contained(file,root)]:findApp(file,depth+1);
 });
}
function extractApp(artifact,root,index){
 const type=artifactType(artifact),folder=path.join(root,'artifact-'+index);fs.mkdirSync(folder,{mode:0o700});let mounted=false;
 try{
  if(type==='zip'){
   const names=command('/usr/bin/zipinfo',['-1',artifact]).split('\n').filter(Boolean);
   if(names.length>50000||names.some(name=>name.startsWith('/')||name.split('/').includes('..')))throw Error('Archive paths are unsafe.');
   command('/usr/bin/ditto',['-x','-k',artifact,folder]);
  }else{command('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',folder,artifact]);mounted=true;}
  const apps=findApp(folder);if(apps.length!==1)throw Error('Expected exactly one App in the final archive.');
  const target=path.join(root,'extracted-'+index+'.app');command('/usr/bin/ditto',[apps[0],target]);
  return {bundle:contained(target,root),format:type,artifactSha256:sha(artifact)};
 }finally{if(mounted)command('/usr/bin/hdiutil',['detach',folder]);}
}
// Manual recovery rehearsal for synthetic data only. Keep the newer directory
// intact under a new name; restore the complete numbered root to its exact
// mapped path so path-bound conversation scopes do not change.
function restoreSyntheticBackup({temporaryRoot,dataRoot,backupFolder,manifest}){
 const owned=fs.realpathSync(temporaryRoot),data=contained(dataRoot,owned),backup=contained(backupFolder,data);
 if(data===owned||manifest.roots.length!==1||manifest.roots[0]!==data)throw Error('Recovery requires one exact synthetic mapped root.');
 const source=path.join(backup,'root-0');contained(source,backup);
 const rows=manifest.files.filter(row=>row.root===0);
 for(const row of rows){if(path.isAbsolute(row.path)||row.path.split(/[\\/]/).includes('..'))throw Error('Unsafe recovery manifest.');}
 const relative=path.relative(data,backup),retained=path.join(owned,'retained-newer-data-'+randomBytes(6).toString('hex'));
 fs.renameSync(data,retained);
 const relocated=path.join(retained,relative,'root-0');
 fs.cpSync(relocated,data,{recursive:true,dereference:false,preserveTimestamps:true,verbatimSymlinks:true,errorOnExist:true,force:false});
 let files=0,wal=0,shm=0;
 for(const row of rows){
  const file=path.join(data,row.path),stat=fs.lstatSync(file);
  if(row.kind==='file'){contained(file,data);assert(stat.isFile());assert.equal(sha(file),row.sha256);files++;if(row.path.endsWith('-wal'))wal++;if(row.path.endsWith('-shm'))shm++;}
  else if(row.kind==='symlink'){assert(stat.isSymbolicLink());assert.equal(fs.readlinkSync(file),row.target);}
  else assert(stat.isDirectory()&&!stat.isSymbolicLink());
  if(row.kind!=='symlink')fs.chmodSync(file,(row.sourceMode??row.mode)&0o777);
 }
 return {retained,restoredRoot:data,files,walFiles:wal,shmFiles:shm,permissionSource:'manifest.sourceMode'};
}
// Test-only envelope: accepts no credential except this harness's literal fake
// key. Determinism is intentional for fixtures and is not a security design.
function createSyntheticVault(namespace,crypto,Bytes){
 if(!/^[a-z0-9-]{1,64}$/.test(namespace))throw Error('Invalid synthetic vault namespace.');
 const stats={availability:0,encrypt:0,decrypt:0,rejected:0};
 const magic=Bytes.from('AA-SYNTHETIC-NO-OS-1\0'),key=crypto.createHash('sha256').update('fixture-only:'+namespace).digest();
 const invalid=()=>{stats.rejected++;throw Error('Only this harness synthetic credential envelope is allowed.');};
 function canonical(text){
  if(typeof text!=='string'||text.length>4096)return invalid();let value;try{value=JSON.parse(text);}catch{return invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const keys=Object.keys(value);if(keys.some(name=>name!=='deepseekKey')||keys.length>1||keys.length===1&&value.deepseekKey!=='fixture-integrated-mac-api-key')return invalid();
  return JSON.stringify(value);
 }
 function encryptString(text){
  const plain=canonical(text),nonce=crypto.createHash('sha256').update(plain).digest().subarray(0,12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
  const body=Bytes.concat([cipher.update(plain,'utf8'),cipher.final()]);stats.encrypt++;return Bytes.concat([magic,nonce,cipher.getAuthTag(),body]);
 }
 function decryptString(bytes){
  if(!Bytes.isBuffer(bytes)||bytes.length<magic.length+28||bytes.length>8192||!bytes.subarray(0,magic.length).equals(magic))return invalid();
  try{const at=magic.length,decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(at,at+12));decipher.setAuthTag(bytes.subarray(at+12,at+28));const text=Bytes.concat([decipher.update(bytes.subarray(at+28)),decipher.final()]).toString('utf8');const plain=canonical(text);stats.decrypt++;return plain;}catch{return invalid();}
 }
 const vault=Object.freeze({
  isEncryptionAvailable(){stats.availability++;return true;},
  async isAsyncEncryptionAvailable(){stats.availability++;return true;},
  encryptString,decryptString,
  async encryptStringAsync(text){return encryptString(text);},
  async decryptStringAsync(bytes){return decryptString(bytes);},
  getSelectedStorageBackend(){return 'synthetic-no-os';},
  setUsePlainTextEncryption(){return invalid();},
 });
 return {vault,stats};
}
// Executed only on the paused production bootstrap call frame. Do not require
// main or bootstrap here: the packaged entry must continue through both itself.
function fixturePrelude(config,createVault){
 // This runs on the first arbitrary JS pause, which can precede bootstrap's
 // CommonJS wrapper. Do not depend on a frame-local require or Electron being
 // initialized yet. Failure leaves the child paused; the host kills it first.
 const modules=process.getBuiltinModule('module'),require=modules.createRequire(process.resourcesPath+'/app.asar/package.json');
 const path=require('node:path'),crypto=require('node:crypto'),Bytes=require('node:buffer').Buffer;
 if(config.vaultMode!=='synthetic-no-os')throw Error('OS vault access is disabled in this harness.');
 if(process.platform!=='darwin'||!process.env.AGENT_ARCADE_HOME?.startsWith(config.root+'/'))throw Error('Unsafe fixture process.');
 const src=path.join(process.resourcesPath,'app.asar','src');
 const probe=globalThis.__integratedMacSmoke={earlyInstalled:false,identityCalls:0,requests:0,blockedNetwork:0,blockedChildren:0,guard:null,app:null};
 const {vault,stats}=createVault(config.namespace,crypto,Bytes),electronProxies=new WeakMap(),load=modules._load;
 probe.syntheticVaultStats=stats;probe.syntheticStorageReads=0;
 // Install before any production safeStorage consumer can load. Do not read
 // the native property even once: Electron exposes it as a lazy getter.
 modules._load=function(request,parent,isMain){
  const exported=Reflect.apply(load,this,[request,parent,isMain]);if(request!=='electron')return exported;
  let proxy=electronProxies.get(exported);if(!proxy){proxy=new Proxy(exported,{get(target,property){if(property==='safeStorage'){probe.syntheticStorageReads++;return vault;}return Reflect.get(target,property,target);}});electronProxies.set(exported,proxy);}return proxy;
 };
 const identity=require(path.join(src,'core/app-identity.cjs')),configure=identity.configureAppIdentity;
 const single=require(path.join(src,'core/single-instance.cjs')),acquire=single.acquireSingleInstance;
 let runtimeInstalled=false;
 function runtime(application){
  if(runtimeInstalled)return;
  const {app,session}=require('electron');
  if(app!==application||!app.isPackaged)throw Error('Fixture requires the packaged production App.');
  probe.app=app;app.setPath('userData',config.profile);
  // Called by production identity before main imports provider discovery. No
  // original CLI installation/login material can become test input.
  const native=require(path.join(src,'bot/native-launch.cjs'));
  native.discoverNative=async()=>{throw Error('Original CLI discovery is disabled for this fixture.');};
  const login=require(path.join(src,'bot/provider-login.cjs')),createLogin=login.createProviderLogin;
  login.createProviderLogin=options=>createLogin({...options,discoverImpl:async()=>null});
  const child=require('node:child_process');
  for(const method of ['spawn','exec','execFile','fork','spawnSync','execSync','execFileSync'])child[method]=()=>{probe.blockedChildren++;throw Error('External processes are disabled in this synthetic App fixture.');};
  const actualFetch=globalThis.fetch;
  if(typeof actualFetch!=='function'||!/^http:\/\/127\.0\.0\.1:[0-9]+\/deepseek$/.test(config.provider))throw Error('Fixture provider must be literal loopback.');
  globalThis.fetch=(url,init={})=>{
   if(String(url)!=='https://api.deepseek.com/chat/completions'){probe.blockedNetwork++;throw Error('Non-fixture network blocked.');}
   probe.requests++;return actualFetch(config.provider,init);
  };
  app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
  runtimeInstalled=true;
 }
 identity.configureAppIdentity=(application,options)=>{
  const result=configure(application,options);if(application.getName()!=='agent-arcade')throw Error('Unexpected production Keychain identity.');
  application.setName(config.name);runtime(application);probe.identityCalls++;return {...result,name:config.name,bundleId:config.bundleId};
 };
 single.acquireSingleInstance=async options=>{
  const scoped={...options,namespace:config.namespace},result=await acquire(scoped);
  probe.guard={namespace:config.namespace,endpoint:single.instanceEndpoint(scoped),primary:result.primary};return result;
 };
 probe.earlyInstalled=true;
 return {installed:true,earlyIsolation:true,fixtureHash:crypto.createHash('sha256').update(config.namespace).digest('hex')};
}
function preludeExpression(config){return `(${fixturePrelude.toString()})(${JSON.stringify({...config,vaultMode:'synthetic-no-os'})},(${createSyntheticVault.toString()}))`;}
class Inspector {
 constructor(socket){
  this.socket=socket;this.sequence=0;this.pending=new Map();this.pauses=[];this.scripts=new Map();
  socket.addEventListener('message',event=>{
   const message=JSON.parse(String(event.data));
   if(message.id){const wait=this.pending.get(message.id);if(wait){this.pending.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(Error(message.error.message)):wait.resolve(message.result);}}
   else if(message.method==='Debugger.scriptParsed')this.scripts.set(message.params.scriptId,message.params.url);
   else if(message.method==='Debugger.paused')this.pauses.push(message.params);
  });
  socket.addEventListener('close',()=>{for(const wait of this.pending.values()){clearTimeout(wait.timer);wait.reject(Error('Owned inspector disconnected.'));}this.pending.clear();});
 }
 static async connect(url){
  if(!/^ws:\/\/127\.0\.0\.1:\d+\//.test(url))throw Error('Only the spawned loopback inspector is allowed.');
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inspector connection timed out.')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Inspector connection failed.'));},{once:true});});return new Inspector(socket);
 }
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Inspector command timed out: '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const answer=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(answer.exceptionDetails)throw Error('Fixture evaluation failed: '+(answer.exceptionDetails.exception?.description||answer.exceptionDetails.text));return answer.result?.value;}
 async inject(config){
  await this.send('Debugger.enable');await this.send('Debugger.setBreakpointByUrl',{urlRegex:BOOTSTRAP_URL.source,lineNumber:0});
  await this.send('Runtime.runIfWaitingForDebugger');const deadline=Date.now()+20000;let pauses=0,early=null;
  while(Date.now()<deadline){
   const pause=this.pauses.shift();if(!pause){await delay(10);continue;}
   const frame=pause.callFrames[0],url=frame.url||this.scripts.get(frame.location.scriptId)||'';
   // No first resume is allowed until both pure-JS identity/guard wrappers are
   // installed, even when this is electron/js2c/browser_init rather than App JS.
   if(!early){
    const answer=await this.send('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:preludeExpression(config),returnByValue:true});
    if(answer.exceptionDetails||answer.result?.value?.installed!==true||answer.result?.value?.earlyIsolation!==true)throw Error('Early isolation failed; paused child must be killed without resume.');
    early={url,line:frame.location.lineNumber+1,installed:true};
   }
   if(BOOTSTRAP_URL.test(url)){
    await this.send('Debugger.resume');await this.send('Debugger.disable');return {url,line:frame.location.lineNumber+1,early};
   }
   if(++pauses>8)throw Error('Production bootstrap breakpoint was not reached after early isolation.');await this.send('Debugger.resume');
  }
  throw Error('Production bootstrap proof timed out; disposable child will be killed before inspector disconnect.');
 }
 close(){this.socket.close();}
}
async function providerServer(){
 const fixture={mode:'reply',serial:0,calls:[],aborted:0};
 const server=http.createServer((request,response)=>{
  if(request.method!=='POST'||request.url!=='/deepseek'){response.writeHead(404).end();return;}
  let input='';request.on('data',chunk=>{input+=chunk;if(input.length>2*1024*1024)request.destroy();});
  request.on('end',()=>{
   let body;try{body=JSON.parse(input);}catch{response.writeHead(400).end();return;}
   fixture.calls.push({stream:body.stream===true,keyMatched:request.headers.authorization==='Bearer '+FAKE_KEY,noTools:!body.tools?.length,messages:body.messages});
   if(fixture.mode==='network'){response.destroy();return;}
   if(typeof fixture.mode==='number'){response.writeHead(fixture.mode,{'content-type':'application/json'}).end('{}');return;}
   const text=`合成服务商回复 ${++fixture.serial}：这是隔离产物测试。`;
   if(!body.stream){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}));return;}
   response.writeHead(200,{'content-type':'text/event-stream'});let index=0,ended=false;
   const timer=setInterval(()=>{
    if(fixture.mode==='hold'){response.write(': synthetic waiting\n\n');return;}
    if(index<text.length)response.write('data: '+JSON.stringify({choices:[{delta:{content:text[index++]},finish_reason:null}]})+'\n\n');
    else{ended=true;clearInterval(timer);response.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
   },35);
   response.on('close',()=>{clearInterval(timer);if(!ended)fixture.aborted++;});
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {fixture,url:`http://127.0.0.1:${server.address().port}/deepseek`,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
function isolatedEnvironment(root,home,source=process.env){
 const env={...source};
 for(const key of Object.keys(env))if(/(?:API_?KEY|TOKEN|PASSWORD|SECRET|AUTHORIZATION)/i.test(key)||/^(?:ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|ANTHROPIC_BASE_URL|OPENAI_BASE_URL|DEEPSEEK_BASE_URL)$/.test(key))delete env[key];
 Object.assign(env,{AGENT_ARCADE_HOME:home,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'tool-config','claude-settings.json'),LOCALAPPDATA:path.join(root,'local-appdata')});
 return env;
}
async function launchBundle({bundle,root,home,profile,identity,provider,chromium,fuses,output,round}){
 // If Electron ignores --inspect-brk it could hit the owner's global guard.
 // Prove support statically before the process can execute a single App line.
 const wire=await fuses.getCurrentFuseWire(bundle);assert.equal(wire[fuses.FuseV1Options.EnableNodeCliInspectArguments],49,'Inspector CLI fuse must be enabled before launching an isolated test copy.');assert.equal(wire[fuses.FuseV1Options.EnableCookieEncryption],48,'Cookie encryption must be disabled before a no-OS-vault fixture can launch.');
 const executableName=command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',path.join(bundle,'Contents/Info.plist')]).trim();
 if(!executableName||/[\/\\]/.test(executableName))throw Error('Invalid bundle executable.');
 const executable=path.join(bundle,'Contents/MacOS',executableName),env=isolatedEnvironment(root,home),log=fs.createWriteStream(path.join(output,round+'-process.log'),{flags:'wx'});
 const child=spawn(executable,['--inspect-brk=127.0.0.1:0','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`],{env,stdio:['ignore','pipe','pipe'],detached:true});
 let buffer='',inspector,browser,page,exitCode,exited=false,startupComplete=false;const exit=new Promise(resolve=>{child.once('exit',(code,signal)=>{exitCode={code,signal};exited=true;resolve(exitCode);});child.once('error',error=>{exitCode={spawnError:error.code||'spawn_failed'};exited=true;resolve(exitCode);});});
 const collect=chunk=>{const text=chunk.toString();buffer=(buffer+text).slice(-128*1024);log.write(text);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const until=async pick=>{const deadline=Date.now()+30000;while(Date.now()<deadline){const value=pick();if(value)return value;if(exited)throw Error('Disposable App exited before startup: '+JSON.stringify(exitCode));await delay(25);}throw Error('Disposable App startup timed out; system Keychain prompts remain a manual gate.');};
 const close=async()=>{
  // Disconnecting the last debugger can resume a paused process. On any
  // startup/injection failure kill our own child first, then disconnect.
  if(!startupComplete&&!exited){try{process.kill(-child.pid,'SIGKILL');}catch{}await Promise.race([exit,delay(5000)]);if(!exited)throw Error('Paused test child exit was not confirmed; inspector was left attached.');}
  if(!exited&&inspector)await inspector.evaluate('setImmediate(()=>globalThis.__integratedMacSmoke.app.quit()); true').catch(()=>{});
  inspector?.close();await Promise.race([exit,delay(10000)]);
  if(!exited){try{process.kill(-child.pid,'SIGTERM');}catch{}await Promise.race([exit,delay(3000)]);}
  if(!exited){try{process.kill(-child.pid,'SIGKILL');}catch{}await Promise.race([exit,delay(3000)]);}
  if(browser)await browser.close().catch(()=>{});log.end();if(!exited)throw Error('Disposable App process exit was not confirmed.');
 };
 try{
  const endpoint=await until(()=>/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(buffer)?.[1]);
  inspector=await Inspector.connect(endpoint);const breakpoint=await inspector.inject({...identity,root,profile,provider});
  const browserEndpoint=await until(()=>/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(buffer)?.[1]);
  browser=await chromium.connectOverCDP(browserEndpoint);page=await until(()=>browser.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().includes('app.asar')));page.setDefaultTimeout(15000);
  await page.waitForFunction(()=>!!window.arcade?.snapshot);
  const scope=await inspector.evaluate('({name:__integratedMacSmoke.app.getName(),profile:__integratedMacSmoke.app.getPath("userData"),packaged:__integratedMacSmoke.app.isPackaged,environment:{platform:process.platform,arch:process.arch,versions:process.versions},identityCalls:__integratedMacSmoke.identityCalls,guard:__integratedMacSmoke.guard})');
  assert.equal(scope.name,identity.name);assert.equal(scope.profile,profile);assert.equal(scope.packaged,true);assert(scope.identityCalls>=2);assert.equal(scope.guard?.namespace,identity.namespace);assert.equal(scope.guard.primary,true);assert(scope.guard.endpoint.includes(identity.namespace));scope.inspectorCliFuse='enabled';scope.preflightCookieEncryptionFuse='already_disabled_read_only';scope.vaultMode='synthetic-no-os';
  startupComplete=true;return {page,inspector,scope,breakpoint,close};
 }catch(error){await close();throw error;}
}
async function run(options){
 assert.equal(process.platform,'darwin','This smoke requires a real Mac.');
 const modules=options.modules||path.join(PROJECT,'node_modules'),load=name=>require(require.resolve(name,{paths:[modules,PROJECT]}));
 const {chromium}=load('playwright'),asar=load('@electron/asar'),fuses=load('@electron/fuses');
 const output=options.output||path.join(PROJECT,'outputs','integrated-mac-package-smoke-'+Date.now());fs.mkdirSync(output,{recursive:true,mode:0o700});
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-integrated-mac-'))),home=path.join(root,'data'),profile=path.join(root,'electron-profile');fs.mkdirSync(home,{mode:0o700});fs.mkdirSync(profile,{mode:0o700});
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({language:'zh',notifications:false}));
 const suffix=randomBytes(6).toString('hex'),identity={name:'agent-arcade-integrated-'+suffix,bundleId:'io.github.agentarcade.integrated.'+suffix,namespace:'arcade-integrated-'+suffix};
 const receipt={schema:1,synthetic:true,realOwnerProfileOpened:false,realAccount:false,realModel:false,humanAcceptance:false,vault:'Synthetic deterministic AES-GCM fixture; no OS encryption',vaultMode:'synthetic-no-os',osKeychainAccessed:false,osEncryptionAccepted:false,crossBuildKeychain:'manual_pending_after_observed_acl_prompt',identity,artifacts:[],checks:[],screenshots:[],errors:[],limits:['Inspector-scoped process wrappers are test instrumentation, not a pristine distribution or human acceptance.','Only the test-copy bundle ID/signature changes; production ASAR stays byte-for-byte unchanged.','System Keychain, Gatekeeper, notification/file dialogs, IME, sleep/wake and second-machine acceptance remain manual.','Earlier source/build evidence is not rerun by this scripted synthetic acceptance.','Prior real safeStorage same-build observations are separate; cross-build Keychain acceptance remains pending after an observed ACL prompt.'],temporaryRoot:root};
 let live,provider;
 const pass=text=>{receipt.checks.push(text);receipt.phase='after-check-'+receipt.checks.length;},snapshot=()=>live.page.evaluate(()=>arcade.snapshot());
 const shot=async name=>{
  await live.page.evaluate(()=>{let label=document.getElementById('synthetic-package-smoke-label');if(!label){label=document.createElement('div');label.id='synthetic-package-smoke-label';label.textContent='SCRIPTED / SYNTHETIC · NO OS VAULT · LOCAL PROVIDER';Object.assign(label.style,{position:'fixed',right:'6px',top:'4px',zIndex:'2147483647',font:'11px sans-serif',background:'#fff4b5',color:'#222',padding:'4px',pointerEvents:'none'});document.body.append(label);}});
  const file=name+'.png';await live.page.screenshot({path:path.join(output,file),fullPage:true,animations:'disabled'});receipt.screenshots.push(file);
 };
 const idle=()=>live.page.waitForFunction(async()=>{const s=await arcade.snapshot();return !s.desktopChat?.busy&&!s.bot?.local?.busy&&!s.bot?.local?.streaming&&document.getElementById('desktop-chat-stop')?.hidden===true;});
 const requestAfter=async before=>{const deadline=Date.now()+10000;while(provider.fixture.calls.length<=before){if(Date.now()>deadline)throw Error('No local provider request after explicit action.');await delay(10);}return provider.fixture.serial;};
 const completeReply=async(serial,{appended=false}={})=>{
  const expected=`合成服务商回复 ${serial}：这是隔离产物测试。`;
  await live.page.waitForFunction(async({expected,appended})=>{const last=(await arcade.snapshot()).bot.local.history.at(-1);return last?.role==='assistant'&&(appended?last.text.includes(expected):last.text===expected);},{expected,appended});
  await idle();
  await live.page.waitForFunction(expected=>document.getElementById('bot-messages')?.textContent.includes(expected)&&!document.querySelector('.desktop-stream'),expected);
  return expected;
 };
 const ensureChatReady=async()=>{
  await live.page.waitForFunction(()=>['desktop-chat-input','desktop-local-start'].some(id=>document.getElementById(id)?.getClientRects().length));
  if(await live.page.locator('#desktop-local-start').isVisible()){assert.equal((await snapshot()).bot.local.canStart,true,'Only explicitly resume a configured synthetic companion.');await live.page.locator('#desktop-local-start').click();}
  await live.page.locator('#desktop-chat-input').waitFor();
 };
 const send=async(text,{finish=true}={})=>{
  const before=provider.fixture.calls.length;await live.page.locator('#desktop-chat-input').fill(text);await live.page.locator('#desktop-chat-send').click();
  const serial=await requestAfter(before);
  if(finish){await completeReply(serial);await live.page.waitForFunction(()=>document.getElementById('desktop-chat-input')?.value==='');}
 };
 try{
  for(const [index,artifact] of options.artifacts.entries()){
   const extracted=extractApp(artifact,root,index),file=path.join(extracted.bundle,'Contents/Resources/app.asar'),metadata=JSON.parse(asar.extractFile(file,'package.json').toString());
   assert.equal(metadata.main,'src/bootstrap.cjs','Final package must use the production bootstrap.');
   receipt.artifacts.push({format:extracted.format,artifactSha256:extracted.artifactSha256,asarSha256:sha(file),packageVersion:metadata.version,main:metadata.main,bundle:extracted.bundle});
  }
  assert(receipt.artifacts.every(row=>row.asarSha256===receipt.artifacts[0].asarSha256),'Final archives must contain the same production ASAR.');
  const bundle=path.join(root,'isolated-test.app');command('/usr/bin/ditto',[receipt.artifacts[0].bundle,bundle]);
  command('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+identity.bundleId,path.join(bundle,'Contents/Info.plist')]);
  command('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);command('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
  const archive=path.join(bundle,'Contents/Resources/app.asar');assert.equal(sha(archive),receipt.artifacts[0].asarSha256);
  provider=await providerServer();
  const launch=async round=>{live=await launchBundle({bundle,root,home,profile,identity,provider:provider.url,chromium,fuses,output,round});live.page.on('pageerror',error=>receipt.errors.push(error.message));receipt[round]={scope:live.scope,bootstrapBreakpoint:live.breakpoint};return live;};
  await launch('first');assert.equal(await live.page.evaluate(()=>arcade.platform.os),'darwin');await live.page.locator('#first-run-card').waitFor();await shot('first-run');
  pass('Actual final archives unpack; test copy preserves production ASAR/main and acquires an independent real bootstrap guard before main.');
  await live.page.locator('#first-run-card [data-provider="deepseek"]').click();await live.page.locator('#first-run-key').fill(FAKE_KEY);await live.page.locator('#first-run-save').click();await live.page.locator('#desktop-chat-input').waitFor();
  assert.equal((await snapshot()).bot.credentialState,'ready');assert.equal(provider.fixture.calls.length,0);pass('Mac first-run saves only the literal fake key through a synthetic no-OS vault shim, without a model call or channel login.');
  await send('SYNTHETIC_WHALE_TURN',{finish:false});await live.page.locator('.desktop-stream').waitFor();await shot('streaming');await idle();
  assert(provider.fixture.calls.at(-1).keyMatched&&provider.fixture.calls.at(-1).noTools&&provider.fixture.calls.at(-1).stream);pass('Production API runner streams from the loopback stand-in with the fake key and no execution tools.');
  receipt.phase='regenerate';const beforeRegenerate=provider.fixture.calls.length;await live.page.locator('[data-tool="regenerate"]').last().click();const regeneratedSerial=await requestAfter(beforeRegenerate);await completeReply(regeneratedSerial);await live.page.waitForFunction(()=>document.querySelector('.desktop-message-swipe-count')?.textContent==='2/2');
  const beforeContinue=provider.fixture.calls.length;receipt.phase='continue';await live.page.locator('[data-tool="continue"]').last().click();const continuedSerial=await requestAfter(beforeContinue);await completeReply(continuedSerial,{appended:true});assert.equal(provider.fixture.calls.length,beforeContinue+1);receipt.phase='edit';
  await live.page.locator('[data-tool="edit"]').last().click();await live.page.locator('.desktop-message-edit-area').fill('SYNTHETIC_OWNER_EDIT');await live.page.locator('.desktop-message-edit-foot button').filter({hasText:'保存'}).click();await live.page.locator('.desktop-message-edit-area').waitFor({state:'detached'});assert.match(await live.page.locator('#bot-messages').innerText(),/SYNTHETIC_OWNER_EDIT/);pass('Real message IPC preserves regenerated alternatives, continuation and explicit owner editing.');
  provider.fixture.mode='hold';await send('SYNTHETIC_STOP',{finish:false});await live.page.locator('#desktop-chat-stop').click();await idle();await live.page.locator('#desktop-chat-status').filter({hasText:/这次回复已停止/}).waitFor();provider.fixture.mode='reply';pass('Stop cancels the held local stream without a late assistant commit.');
  for(const [mode,pattern] of [[401,/密钥/],[429,/额度|余额|用量|频率/],['network',/网络|连接/]]){
   provider.fixture.mode=mode;const draft='SYNTHETIC_ERROR_'+mode;await send(draft,{finish:false});await live.page.locator('#desktop-chat-status').filter({hasText:pattern}).waitFor();assert.equal(await live.page.locator('#desktop-chat-input').inputValue(),draft);
  }
  await shot('classified-error');provider.fixture.mode='reply';await send('SYNTHETIC_EXPLICIT_RECOVERY');pass('401/429/network errors retain drafts; a new explicit Send recovers after the stand-in is restored.');
  const roles=['deepseek-whale','claude-ju','codex-dragon'],histories={};
  for(const role of roles){
   const toggle=live.page.locator('#imm-companion-toggle');if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await live.page.locator('#companion-builtin-persona').selectOption(role);await live.page.waitForFunction(async role=>{const s=await arcade.snapshot();return s.bot.local.characterId===role&&s.bot.local.available;},role);await live.page.locator('#desktop-chat-input').waitFor();
   const marker='SYNTHETIC_ROLE_'+role;await send(marker);const state=await snapshot();assert.equal(state.bot.mode,'deepseek');assert.equal(state.bot.hasKey,true);assert.equal(state.bot.local.characterId,role);
   const turns=state.bot.local.history.map(row=>row.text);assert(turns.includes(marker));for(const other of roles.filter(value=>value!==role))assert(!turns.includes('SYNTHETIC_ROLE_'+other));histories[role]=turns;
  }
  pass('All three built-in personas keep separate synthetic histories while retaining the same DeepSeek configuration/key.');
  for(const layout of ['immersive','messenger','minimal']){
   await live.page.evaluate(async layout=>{await arcade.configure({layout,appearance:'dark'});switchView('bot');},layout);await live.page.waitForFunction(layout=>document.documentElement.dataset.layout===layout,layout);await shot(layout+'-chat');
   for(const view of ['characters','notes','notices','settings']){await live.page.evaluate(view=>switchView(view),view);await live.page.locator('#'+view+'-view').waitFor({state:'visible'});assert(await live.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),layout+'/'+view+' overflow');}
  }
  pass('Three production layouts render Chat, Characters, Notes, Notices and Settings without horizontal overflow.');
  await live.page.evaluate(()=>switchView('bot'));await shot('persona-before-restart');const before=(await snapshot()).bot.local.history.map(row=>row.text),vault=path.join(home,'bot-vault.json'),vaultBefore=sha(vault);
  await live.close();live=null;
  const stateFile=path.join(home,'.update-state.json'),beforeBackups=fs.readdirSync(path.join(home,'update-backups')).filter(name=>!name.startsWith('.')).length;
  receipt.actualBuildId=JSON.parse(fs.readFileSync(stateFile,'utf8')).buildId;
  await launch('restart');const reopened=await snapshot();assert.equal(reopened.bot.credentialState,'ready');assert.deepEqual(reopened.bot.local.history.map(row=>row.text),before);assert.equal(sha(vault),vaultBefore);
  assert.equal(fs.readdirSync(path.join(home,'update-backups')).filter(name=>!name.startsWith('.')).length,beforeBackups);
  await ensureChatReady();await send('SYNTHETIC_AFTER_RESTART');assert(provider.fixture.calls.at(-1).keyMatched);await shot('restarted');pass('Same-build cold restart retains the synthetic credential envelope and SQLite history without creating another update snapshot.');
  const stats=await live.inspector.evaluate('({identityCalls:__integratedMacSmoke.identityCalls,blockedNetwork:__integratedMacSmoke.blockedNetwork,blockedChildren:__integratedMacSmoke.blockedChildren,requests:__integratedMacSmoke.requests,vaultMode:"synthetic-no-os",syntheticStorageReads:__integratedMacSmoke.syntheticStorageReads,syntheticVaultStats:__integratedMacSmoke.syntheticVaultStats})');receipt.processProbe=stats;assert.equal(stats.blockedNetwork,0);assert.equal(stats.blockedChildren,0);assert.deepEqual(receipt.errors,[]);
  await live.close();live=null;assert.equal(sha(archive),receipt.artifacts[0].asarSha256);for(const row of receipt.artifacts)assert.equal(sha(path.join(row.bundle,'Contents/Resources/app.asar')),row.asarSha256);
  if(options.seedApp){
   // This older App is seed input only. Never launch or modify its original path.
   const oldSource=fs.realpathSync(options.seedApp),oldAsar=path.join(oldSource,'Contents/Resources/app.asar'),oldHash=sha(oldAsar),oldMetadata=JSON.parse(asar.extractFile(oldAsar,'package.json').toString());
   assert.equal(oldMetadata.main,'src/bootstrap.cjs');const oldBundle=path.join(root,'isolated-seed.app');command('/usr/bin/ditto',[oldSource,oldBundle]);
   command('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+identity.bundleId,path.join(oldBundle,'Contents/Info.plist')]);command('/usr/bin/codesign',['--force','--deep','--sign','-',oldBundle]);command('/usr/bin/codesign',['--verify','--deep','--strict',oldBundle]);assert.equal(sha(path.join(oldBundle,'Contents/Resources/app.asar')),oldHash);
   const upgradeHome=path.join(root,'upgrade-data'),upgradeProfile=path.join(root,'upgrade-electron-profile');fs.mkdirSync(upgradeHome,{mode:0o700});fs.mkdirSync(upgradeProfile,{mode:0o700});fs.writeFileSync(path.join(upgradeHome,'config.json'),JSON.stringify({language:'zh',notifications:false}));
   live=await launchBundle({bundle:oldBundle,root,home:upgradeHome,profile:upgradeProfile,identity,provider:provider.url,chromium,fuses,output,round:'seed-old'});
   await live.page.locator('#first-run-card [data-provider="deepseek"]').click();await live.page.locator('#first-run-key').fill(FAKE_KEY);await live.page.locator('#first-run-save').click();await live.page.locator('#desktop-chat-input').waitFor();await send('SYNTHETIC_PREVIOUS_PACKAGE_TURN');
   await live.page.locator('#desktop-chat-input').fill('记住：SYNTHETIC_升级偏好松针绿');await live.page.locator('#desktop-chat-send').click();await live.page.waitForFunction(async()=>JSON.stringify((await arcade.snapshot()).bot.local.memory).includes('SYNTHETIC_升级偏好松针绿'));await idle();
   const oldSnapshot=await snapshot(),oldHistory=oldSnapshot.bot.local.history.map(row=>row.text),oldMemory=oldSnapshot.bot.local.memory.facts.map(row=>({id:row.id,text:row.text})),upgradeVault=path.join(upgradeHome,'bot-vault.json'),oldVaultHash=sha(upgradeVault),oldBuildId=JSON.parse(fs.readFileSync(path.join(upgradeHome,'.update-state.json'),'utf8')).buildId;
   await shot('seed-old-synthetic');await live.close();live=null;
   live=await launchBundle({bundle,root,home:upgradeHome,profile:upgradeProfile,identity,provider:provider.url,chromium,fuses,output,round:'upgrade-new'});const updated=await snapshot();assert.equal(updated.bot.credentialState,'ready');assert.deepEqual(updated.bot.local.history.map(row=>row.text),oldHistory);assert.deepEqual(updated.bot.local.memory.facts.map(row=>({id:row.id,text:row.text})),oldMemory);assert.equal(sha(upgradeVault),oldVaultHash);
   const newBuildId=JSON.parse(fs.readFileSync(path.join(upgradeHome,'.update-state.json'),'utf8')).buildId;assert.notEqual(newBuildId,oldBuildId);
   const backupRoot=path.join(upgradeHome,'update-backups'),manifests=fs.readdirSync(backupRoot).filter(name=>!name.startsWith('.')).map(name=>({folder:path.join(backupRoot,name),manifest:JSON.parse(fs.readFileSync(path.join(backupRoot,name,'manifest.json'),'utf8'))}));
   const matching=manifests.find(item=>item.manifest.previousBuildId===oldBuildId&&item.manifest.buildId===newBuildId);assert(matching,'New App must cold-backup synthetic old-build data before store migration.');const transition=matching.manifest;assert(transition.databases>0);
   const validationCopy=path.join(root,'backup-validation-copy');fs.cpSync(matching.folder,validationCopy,{recursive:true,dereference:false,preserveTimestamps:true,verbatimSymlinks:true});
   const {DatabaseSync}=require('node:sqlite');let checkedDatabases=0;
   for(const file of transition.files.filter(item=>item.kind==='file'&&/\.(?:sqlite|sqlite3)$/i.test(item.path))){
    const backup=contained(path.join(validationCopy,'root-'+file.root,file.path),validationCopy);let db;
    try{db=new DatabaseSync(backup,{readOnly:true,allowExtension:false});assert.equal(Object.values(db.prepare('PRAGMA quick_check').get())[0],'ok');checkedDatabases++;}finally{db?.close();}
   }
   assert.equal(checkedDatabases,transition.databases);
   await ensureChatReady();await send('SYNTHETIC_UPGRADE_CONTINUATION');assert(provider.fixture.calls.at(-1).keyMatched);await shot('upgrade-new-retained');await live.close();live=null;
   assert.equal(sha(oldAsar),oldHash);assert.equal(sha(archive),receipt.artifacts[0].asarSha256);receipt.upgrade={tested:true,oldPackageVersion:oldMetadata.version,newPackageVersion:receipt.artifacts[0].packageVersion,oldAsarSha256:oldHash,newAsarSha256:receipt.artifacts[0].asarSha256,previousBuildId:oldBuildId,newBuildId,databases:transition.databases,historyRetained:true,memoryRetained:true,vaultBytesRetained:true,originalSeedBundleUnchanged:true};pass('An isolated older production package seeds synthetic key/chat/memory; the new archive-extracted App preserves them and creates the exact changed-build cold snapshot.');
   const recovery=restoreSyntheticBackup({temporaryRoot:root,dataRoot:upgradeHome,backupFolder:matching.folder,manifest:transition});
   live=await launchBundle({bundle,root,home:upgradeHome,profile:upgradeProfile,identity,provider:provider.url,chromium,fuses,output,round:'restore-new'});const restored=await snapshot();
   assert.equal(restored.bot.credentialState,'ready');assert.deepEqual(restored.bot.local.history.map(row=>row.text),oldHistory);assert.deepEqual(restored.bot.local.memory.facts.map(row=>({id:row.id,text:row.text})),oldMemory);assert.equal(sha(upgradeVault),oldVaultHash);
   const recoveredBackups=path.join(upgradeHome,'update-backups'),recoveredManifests=fs.readdirSync(recoveredBackups).filter(name=>!name.startsWith('.')).map(name=>JSON.parse(fs.readFileSync(path.join(recoveredBackups,name,'manifest.json'),'utf8')));assert(recoveredManifests.some(item=>item.previousBuildId===oldBuildId&&item.buildId===newBuildId));
   await ensureChatReady();
   await send('SYNTHETIC_AFTER_MANUAL_RESTORE');assert(provider.fixture.calls.at(-1).keyMatched);await shot('restored-synthetic-profile');await live.close();live=null;assert(fs.existsSync(recovery.retained));
   receipt.restore={tested:true,synthetic:true,automaticRestore:false,sameMappedRoot:true,historyRetained:true,memoryRetained:true,vaultBytesRetained:true,repeatedColdBackup:true,...recovery};pass('Synthetic profile restored as documented: newer data retained by rename, complete backup root copied to its mapped path with WAL/SHM/modes, and the new App reopens the fake key/chat/memory.');
  }else receipt.upgrade={tested:false,reason:'No --seed-app supplied; cross-build update retention remains untested in this run.'};
  receipt.provider={requests:provider.fixture.calls.length,allFakeKey:provider.fixture.calls.every(call=>call.keyMatched),allToolFree:provider.fixture.calls.every(call=>call.noTools),abortedStreams:provider.fixture.aborted};receipt.passed=true;
 }catch(error){receipt.failure=error.message;receipt.failureStack=error.stack;if(live)await shot('failure').catch(()=>{});throw error;}
 finally{if(live)await live.close().catch(error=>{receipt.shutdownFailure=error.message;});if(provider)await provider.close();fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');}
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output}));
}
module.exports={artifactType,parseArgs,contained,preludeExpression,fixturePrelude,isolatedEnvironment,Inspector,restoreSyntheticBackup,createSyntheticVault};
if(require.main===module)run(parseArgs(process.argv.slice(2))).catch(error=>{console.error(error.message);process.exitCode=1;});
