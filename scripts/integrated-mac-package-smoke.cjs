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
  const key=argv[i];if(key==='--group-roles-only'){options.groupRolesOnly=true;continue;}
  if(key==='--group-images-only'){options.groupImagesOnly=true;continue;}
  if(key==='--group-voice-only'){options.groupVoiceOnly=true;continue;}
  if(key==='--group-worldbooks-only'){options.groupWorldbooksOnly=true;continue;}
  if(!['--artifact','--output','--modules','--seed-app'].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Usage: node scripts/integrated-mac-package-smoke.cjs --artifact FINAL.zip [--artifact FINAL.dmg] [--seed-app OLD.app] [--modules NODE_MODULES] [--output DIRECTORY] [--group-roles-only | --group-images-only | --group-voice-only | --group-worldbooks-only]');
  const value=path.resolve(argv[++i]);if(key==='--artifact'){artifactType(value);options.artifacts.push(value);}else options[key.slice(2).replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase())]=value;
 }
 if(options.artifacts.length<1||options.artifacts.length>2||new Set(options.artifacts).size!==options.artifacts.length)throw Error('Provide one or two distinct final archives.');
 if([options.groupRolesOnly,options.groupImagesOnly,options.groupVoiceOnly,options.groupWorldbooksOnly].filter(Boolean).length>1)throw Error('Choose one group-only fixture.');
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
function createSyntheticVault(namespace,crypto,Bytes,groupVoiceOnly=false){
 if(!/^[a-z0-9-]{1,64}$/.test(namespace))throw Error('Invalid synthetic vault namespace.');
 const stats={availability:0,encrypt:0,decrypt:0,rejected:0};
 const magic=Bytes.from('AA-SYNTHETIC-NO-OS-1\0'),key=crypto.createHash('sha256').update('fixture-only:'+namespace).digest();
 const invalid=()=>{stats.rejected++;throw Error('Only this harness synthetic credential envelope is allowed.');};
 function canonical(text){
  if(typeof text!=='string'||text.length>4096)return invalid();let value;try{value=JSON.parse(text);}catch{return invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const expected={deepseekKey:'fixture-integrated-mac-api-key',...(groupVoiceOnly?{qqToken:'fixture-group-voice-loopback-token'}:{})};
  if(Object.keys(value).some(name=>!Object.hasOwn(expected,name)||value[name]!==expected[name]))return invalid();
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
function fixturePrelude(config,createVault,installGroupVoice){
 // This runs on the first arbitrary JS pause, which can precede bootstrap's
 // CommonJS wrapper. Do not depend on a frame-local require or Electron being
 // initialized yet. Failure leaves the child paused; the host kills it first.
 const modules=process.getBuiltinModule('module'),require=modules.createRequire(process.resourcesPath+'/app.asar/package.json');
 const path=require('node:path'),crypto=require('node:crypto'),Bytes=require('node:buffer').Buffer;
 if(config.vaultMode!=='synthetic-no-os')throw Error('OS vault access is disabled in this harness.');
 if(process.platform!=='darwin'||!process.env.AGENT_ARCADE_HOME?.startsWith(config.root+'/'))throw Error('Unsafe fixture process.');
 const src=path.join(process.resourcesPath,'app.asar','src');
 const probe=globalThis.__integratedMacSmoke={earlyInstalled:false,identityCalls:0,requests:0,blockedNetwork:0,blockedChildren:0,guard:null,app:null};
 const {vault,stats}=createVault(config.namespace,crypto,Bytes,config.groupVoiceOnly===true),electronProxies=new WeakMap(),load=modules._load;
 probe.syntheticVaultStats=stats;probe.syntheticStorageReads=0;
 // Only an explicitly labelled, keyless verification artifact may use these
 // inspector shims. Production/fixed-helper builds retain their startup policy
 // and must not be turned into programmable credential clients by this test.
 if(config.verificationOnly===true){
  const metadata=require(process.resourcesPath+'/app.asar/package.json');
  if(metadata.verificationOnly!==true||metadata.macCredentialBroker)throw Error('Not a keyless verification artifact.');
  const startup=require(path.join(src,'core/credential-startup-policy.cjs'));
  if(startup.credentialStartupAllowed(process.argv)!==false)throw Error('Expected debug-only fixture arguments.');
  startup.credentialStartupAllowed=argv=>argv===process.argv;
  const policy=require(path.join(src,'core/application-credential-vault.cjs'));
  policy.applicationCredentialVault=()=>vault;
  probe.verificationPoliciesInjected=true;
 }
 const groupVoice=config.groupVoiceOnly===true?installGroupVoice(config,require,probe):null;
 // Install before any production safeStorage consumer can load. Do not read
 // the native property even once: Electron exposes it as a lazy getter.
 modules._load=function(request,parent,isMain){
  if(groupVoice&&request==='ws'){
   if(parent?.filename!==path.join(src,'bot/qq.cjs'))throw Error('Non-QQ WebSocket is disabled in the synthetic voice fixture.');
   return groupVoice.Socket;
  }
  const exported=Reflect.apply(load,this,[request,parent,isMain]);if(request!=='electron')return exported;
  let proxy=electronProxies.get(exported);
  if(!proxy){
   proxy=new Proxy(exported,{get(target,property){
    if(property==='safeStorage'){probe.syntheticStorageReads++;return vault;}
    const result=Reflect.get(target,property,target);
    return groupVoice&&property==='dialog'?groupVoice.dialog(result):result;
   }});
   electronProxies.set(exported,proxy);
  }
  return proxy;
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
function installGroupVoiceFixture(config,require,probe){
 if(config.verificationOnly!==true)throw Error('Group voice isolation requires a keyless verification artifact.');
 const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events'),{createHash}=require('node:crypto');
 const file=path.join(config.root,'synthetic-group-recording.wav'),stat=fs.lstatSync(file);
 if(stat.size!==8044||!stat.isFile()||fs.realpathSync(file)!==file)throw Error('Invalid owned WAV fixture.');
 const bytes=fs.readFileSync(file),digest=buffer=>createHash('sha256').update(buffer).digest('hex');
 const evidence=probe.groupVoice={admissions:0,memberChecks:[],nameChecks:[],sends:[],pickers:0,unexpected:0};
 const refuse=()=>{evidence.unexpected++;throw Error('The synthetic voice bridge refused an unexpected action.');};
 const groups=[500001,500002],account=600001,owner=600002;
 const frame=(socket,echo,data)=>socket.emit('message',JSON.stringify({status:'ok',retcode:0,echo,data}),false);
 class Socket extends EventEmitter{
  constructor(url,options){
   super();this.readyState=0;
   if(String(url)!=='ws://127.0.0.1:41434/'||options?.headers?.Authorization!=='Bearer fixture-group-voice-loopback-token')refuse();
   evidence.admissions++;
   queueMicrotask(()=>{if(this.readyState===0){this.readyState=1;this.emit('open');}});
  }
  send(raw,callback){
   if(typeof raw!=='string'||raw.length>32000||this.readyState!==1)refuse();
   const row=JSON.parse(raw);let data;
   if(row.action==='get_login_info')data={user_id:account,nickname:'Synthetic QQ bridge'};
   else if(row.action==='get_status')data={online:true,good:true};
   else if(row.action==='get_friend_list')data=[{user_id:owner}];
   else if(row.action==='get_group_member_info'){
    if(!groups.includes(row.params?.group_id)||row.params?.user_id!==account||row.params?.no_cache!==true)refuse();
    evidence.memberChecks.push(row.params.group_id);
    data={group_id:row.params.group_id,user_id:account};
   }else if(row.action==='get_group_info'){
    if(!groups.includes(row.params?.group_id)||row.params?.no_cache!==true)refuse();
    evidence.nameChecks.push(row.params.group_id);
    data={group_id:row.params.group_id,group_name:row.params.group_id===groups[1]?'合成试用群':'合成备选群'};
   }else if(row.action==='send_group_msg'){
    const segment=row.params?.message?.[0];
    if(row.params?.group_id!==groups[1]||Object.keys(row.params).length!==2||row.params?.message?.length!==1||
       segment?.type!=='record'||segment?.data?.file!=='base64://'+bytes.toString('base64')||evidence.sends.length)refuse();
    evidence.sends.push({groupId:row.params.group_id,bytes:bytes.length,sha256:digest(bytes)});
    data={message_id:8301};
   }else refuse();
   callback?.();setImmediate(()=>{if(this.readyState===1)frame(this,row.echo,data);});
  }
  ping(){this.emit('pong');}
  terminate(){if(this.readyState!==3){this.readyState=3;this.emit('close');}}
 }
 return {Socket,dialog:actual=>new Proxy(actual,{get(target,property){
  if(property==='showOpenDialog')return async (_window,options)=>{
   if(options?.properties?.length!==1||options.properties[0]!=='openFile'||options.filters?.[0]?.extensions?.[0]!=='wav')refuse();
   evidence.pickers++;return {canceled:false,filePaths:[file]};
  };
  return Reflect.get(target,property,target);
 }})};
}
function preludeExpression(config){return `(${fixturePrelude.toString()})(${JSON.stringify({...config,vaultMode:'synthetic-no-os'})},(${createSyntheticVault.toString()}),(${installGroupVoiceFixture.toString()}))`;}
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
   const serial=++fixture.serial;
   const gate=body.messages?.at(-1)?.content?.includes('Decide whether this character should answer');
   const text=gate?'{"action":"message","text":"synthetic group admission"}':`合成服务商回复 ${serial}：这是隔离产物测试。`;
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
async function launchBundle({bundle,root,home,profile,identity,provider,chromium,fuses,output,round,verificationOnly=false,groupVoiceOnly=false}){
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
  return exitCode;
 };
 try{
  const endpoint=await until(()=>/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(buffer)?.[1]);
  inspector=await Inspector.connect(endpoint);const breakpoint=await inspector.inject({...identity,root,profile,provider,verificationOnly,groupVoiceOnly});
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
   receipt.artifacts.push({format:extracted.format,artifactSha256:extracted.artifactSha256,asarSha256:sha(file),packageVersion:metadata.version,main:metadata.main,verificationOnly:metadata.verificationOnly===true,bundle:extracted.bundle});
  }
  assert(receipt.artifacts.every(row=>row.asarSha256===receipt.artifacts[0].asarSha256),'Final archives must contain the same production ASAR.');
  const bundle=path.join(root,'isolated-test.app');command('/usr/bin/ditto',[receipt.artifacts[0].bundle,bundle]);
  command('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+identity.bundleId,path.join(bundle,'Contents/Info.plist')]);
  command('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);command('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
  const archive=path.join(bundle,'Contents/Resources/app.asar');assert.equal(sha(archive),receipt.artifacts[0].asarSha256);
  provider=await providerServer();
  if(receipt.artifacts[0].verificationOnly)receipt.limits.push('Explicit keyless verification artifact: no fixed-helper pins; startup-policy and vault facade are instrumented only in this disposable process. This is not an owner update or real credential acceptance.');
  const launch=async round=>{live=await launchBundle({bundle,root,home,profile,identity,provider:provider.url,chromium,fuses,output,round,verificationOnly:receipt.artifacts[0].verificationOnly,groupVoiceOnly:options.groupVoiceOnly===true});live.page.on('pageerror',error=>receipt.errors.push(error.message));receipt[round]={scope:live.scope,bootstrapBreakpoint:live.breakpoint};return live;};
  const openGroupForm=async()=>{
   await live.page.evaluate(()=>switchView('connections'));
   const optional=live.page.locator('#onboarding-optional-toggle');
   if(await optional.isVisible()&&await optional.getAttribute('aria-expanded')==='false')await optional.click();
   await live.page.locator('#onboarding-qq-groups').click();
  };
  if(options.groupRolesOnly){
   assert.equal(receipt.artifacts[0].verificationOnly,true,'Use a keyless verification artifact for the group role fixture.');
   const openRoleForm=async()=>{
    await openGroupForm();
    await live.page.locator('#bot-qq-group-roles > summary').click();
   };
   await launch('group-role-first');
   assert.equal(await live.page.evaluate(()=>arcade.platform.os),'darwin');
   const sample={name:'合成角色阿青',description:'观察海岸潮汐。',mes_example:'<START>\n{{char}}: 海边风轻。',creatorcomment:'不公开的合成校验记号'};
   const card=await live.page.evaluate(async sample=>{
    const card=await arcade.charactersAddExample(sample);
    const state=await arcade.snapshot();
    await arcade.botConfigure({profileId:state.accounts.selectedId,expectedMode:state.bot.mode,expectedChannel:state.bot.channel,channel:'qq',qqAccountId:'600001',qqOwnerId:'600002',qqGroups:{enabled:true,groupIds:['500001'],proactive:false}});
    return card;
   },sample);
   assert.equal((await snapshot()).bot.status,'disconnected');
   await openRoleForm();
   const cardPicker=live.page.locator('#bot-qq-group-role-card');
   assert.match(card.id,/^[a-f0-9]{16}$/);
   await cardPicker.locator('option').filter({hasText:sample.name}).waitFor({state:'attached'});
   await cardPicker.selectOption(card.id);
   await live.page.locator('#bot-qq-group-role-review').click();
   const preview=live.page.locator('#bot-qq-group-role-preview');
   await preview.waitFor();
   assert.match(await preview.innerText(),/600001 · 群 500001/);
   assert.equal(await live.page.locator('#bot-qq-group-role-preview-description').innerText(),sample.description);
   assert.equal(await live.page.locator('#bot-qq-group-role-preview-examples').innerText(),sample.mes_example);
   assert(!((await preview.innerText()).includes(sample.creatorcomment)));
   assert.deepEqual((await snapshot()).bot.qq.groups.roles,[]);
   await preview.scrollIntoViewIfNeeded();
   await shot('group-role-preview');
   await live.page.locator('#bot-qq-group-role-approve').click();
   await live.page.locator('#bot-qq-group-role-current').filter({hasText:'已批准'}).waitFor();
   const binding={groupId:'500001',cardId:card.id,name:sample.name};
   assert.deepEqual((await snapshot()).bot.qq.groups.roles,[binding]);
   pass('A real packaged window uses its preload and main IPC to review public fields and explicitly approve the chosen library card.');
   assert.deepEqual(await live.close(),{code:0,signal:null});live=null;
   await launch('group-role-reopen');
   assert.deepEqual((await snapshot()).bot.qq.groups.roles,[binding]);
   await openRoleForm();
   await live.page.locator('#bot-qq-group-role-current').filter({hasText:'已批准'}).waitFor();
   await live.page.locator('#bot-qq-group-role-clear').click();
   await live.page.locator('#bot-qq-group-role-current').filter({hasText:'此群使用默认搭档人设'}).waitFor();
   assert.deepEqual((await snapshot()).bot.qq.groups.roles,[]);
   assert.equal((await snapshot()).bot.status,'disconnected');
   assert.equal(provider.fixture.calls.length,0);
   await shot('group-role-default-restored');
   assert.deepEqual(await live.close(),{code:0,signal:null});live=null;
   assert.deepEqual(receipt.errors,[]);
   assert.equal(sha(archive),receipt.artifacts[0].asarSha256);
   receipt.groupRole={actualPackagedRenderer:true,actualPreloadIPC:true,coldReadback:true,cleared:true,providerRequests:0,realQQ:false,isolatedQuit:true};
   pass('Cold start retains the approved role; the owner restores the default from the same window without starting QQ or a provider.');
   receipt.passed=true;
   console.log(JSON.stringify({passed:true,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output}));
   return;
  }
  if(options.groupImagesOnly){
   assert.equal(receipt.artifacts[0].verificationOnly,true,'Use a keyless verification artifact for the group image fixture.');
   const modules=['src/main.cjs','src/bot/service.cjs','src/bot/group-companion-route.cjs','src/bot/qq-group-image.cjs'];
   const archiveEntries=asar.listPackage(archive);
   assert(modules.every(file=>archiveEntries.includes('/'+file)),'Use a verification archive containing the ordinary QQ image implementation.');
   const groupIds=['500001','500002'],accountId='600001',ownerId='600002',permitted=groupIds.slice(0,1);
   const permissionBox=()=>live.page.locator('#bot-qq-group-images');
   const readBack=async imageGroupIds=>{
    const {bot}=await snapshot();
    assert.equal(bot.channel,'qq');assert.equal(bot.status,'disconnected');assert.equal(bot.hasKey,false);
    assert.equal(bot.qq.expectedAccountId,accountId);assert.equal(bot.qq.ownerId,ownerId);assert.equal(bot.qq.hasToken,false);
    assert.equal(bot.qq.groups.enabled,true);assert.deepEqual(bot.qq.groups.groupIds,groupIds);
    assert.deepEqual(bot.qq.groups.imageGroupIds||[],imageGroupIds);
    assert.equal(Object.hasOwn(bot.qq.groups,'imageGroupIds'),imageGroupIds.length>0);
    return bot.qq.groups.imageGroupIds||[];
   };
   const verifyCheckboxes=async imageGroupIds=>{
    await permissionBox().waitFor();
    const fields=permissionBox().locator('input[type="checkbox"]');
    await fields.first().waitFor();
    assert.equal(await fields.count(),groupIds.length);
    assert.deepEqual(await fields.evaluateAll(nodes=>nodes.map(node=>node.value)),groupIds);
    assert.deepEqual(await fields.evaluateAll(nodes=>nodes.filter(node=>node.checked).map(node=>node.value)),imageGroupIds);
    assert.equal(await fields.first().isEnabled(),true);
   };
   const savePermissions=async()=>{
    await live.page.locator('#bot-qq-groups-save').click();
    await live.page.locator('#bot-qq-groups-feedback').filter({hasText:'群聊设置已保存'}).waitFor();
   };
   const processes=[];
   const stop=async()=>{
    const stats=await live.inspector.evaluate('({requests:__integratedMacSmoke.requests,blockedNetwork:__integratedMacSmoke.blockedNetwork,blockedChildren:__integratedMacSmoke.blockedChildren,vaultWrites:__integratedMacSmoke.syntheticVaultStats.encrypt})');
    assert.deepEqual(stats,{requests:0,blockedNetwork:0,blockedChildren:0,vaultWrites:0});
    const exit=await live.close();live=null;
    assert.deepEqual(exit,{code:0,signal:null});processes.push({exit,...stats});
   };
   await launch('group-images-first');
   assert.equal(await live.page.evaluate(()=>arcade.platform.os),'darwin');
   const loadedModules=await live.inspector.evaluate(`(()=>{
    const root=process.resourcesPath+'/app.asar/';
    const require=process.getBuiltinModule('module').createRequire(root+'package.json');
    return ${JSON.stringify(modules)}.filter(file=>require.cache[root+file]?.loaded===true);
   })()`);
   assert.deepEqual(loadedModules,modules);
   await live.page.evaluate(async({accountId,ownerId,groupIds})=>{
    const state=await arcade.snapshot();
    await arcade.botConfigure({profileId:state.accounts.selectedId,expectedMode:state.bot.mode,expectedChannel:state.bot.channel,
     channel:'qq',qqAccountId:accountId,qqOwnerId:ownerId,qqGroups:{enabled:true,groupIds,proactive:false}});
   },{accountId,ownerId,groupIds});
   const defaults=await readBack([]);
   await openGroupForm();await verifyCheckboxes([]);
   await permissionBox().locator('input').first().check();await verifyCheckboxes(permitted);
   await readBack([]);
   await savePermissions();const saved=await readBack(permitted);
   await permissionBox().scrollIntoViewIfNeeded();await shot('group-images-one-opt-in');
   pass('Actual packaged preload and main IPC save image consent for one of two ordinary QQ groups after explicit Save. Defaults stay off and changing a checkbox alone does not persist.');
   await stop();
   await launch('group-images-reopen');
   const reopened=await readBack(permitted);await openGroupForm();await verifyCheckboxes(permitted);
   await permissionBox().scrollIntoViewIfNeeded();await shot('group-images-cold-readback');
   pass('A clean Quit and cold start retain exactly the approved QQ group in main state and the visible checkbox list.');
   await permissionBox().locator('input').first().uncheck();await savePermissions();const cleared=await readBack([]);
   await verifyCheckboxes([]);await stop();
   await launch('group-images-cleared-reopen');
   const clearedAfterRestart=await readBack([]);await openGroupForm();await verifyCheckboxes([]);
   await permissionBox().scrollIntoViewIfNeeded();await shot('group-images-cleared');
   await stop();
   assert.equal(provider.fixture.calls.length,0);assert.deepEqual(receipt.errors,[]);
   assert.equal(sha(archive),receipt.artifacts[0].asarSha256);
   receipt.groupImages={actualPackagedRenderer:true,actualPreloadIPC:true,loadedModules,groupIds,defaults,saved,reopened,cleared,clearedAfterRestart,processes,providerRequests:0,realQQ:false};
   pass('Turning image consent off clears the persisted optional setting, and a second cold start shows both groups off. No key, QQ bridge traffic or model call is used.');
   receipt.passed=true;
   console.log(JSON.stringify({passed:true,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output}));
   return;
  }
  if(options.groupVoiceOnly){
   assert.equal(receipt.artifacts[0].verificationOnly,true,'Use a keyless verification artifact for the group voice fixture.');
   const required=['/src/bot/group-voice-pipeline.cjs','/src/voice/posix-python-process-proof.cjs','/src/ui/qq-voice.js'];
   const entries=asar.listPackage(archive);assert(required.every(file=>entries.includes(file)),'Group voice verification requires the complete packaged source.');
   const wavPath=path.join(root,'synthetic-group-recording.wav'),wav=Buffer.alloc(8044);
   wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
   wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
   wav.write('data',36);wav.writeUInt32LE(8000,40);wav.writeInt16LE(112,44);fs.writeFileSync(wavPath,wav,{mode:0o600});
   const wavHash=sha(wavPath),groupIds=['500001','500002'],accountId='600001',ownerId='600002';
   const groupVoicePicker=()=>live.page.locator('#bot-qq-group-voice');
   const asrStatus=()=>groupVoicePicker().locator('#bot-qq-group-voice-asr');
   const voiceCheck=groupId=>groupVoicePicker().locator(`input[value="${groupId}"]`);
   const bridge=()=>live.inspector.evaluate('structuredClone(__integratedMacSmoke.groupVoice)');
   const assertIsolation=async()=>{
    const stats=await live.inspector.evaluate('({requests:__integratedMacSmoke.requests,blockedNetwork:__integratedMacSmoke.blockedNetwork,blockedChildren:__integratedMacSmoke.blockedChildren})');
    assert.deepEqual(stats,{requests:0,blockedNetwork:0,blockedChildren:0});
    assert.equal(provider.fixture.calls.length,0);
    return stats;
   };
   await launch('group-voice-first');
   assert.equal(await live.page.evaluate(()=>arcade.platform.os),'darwin');
   const card=await live.page.evaluate(async({accountId,ownerId,groupIds,key})=>{
    const read=()=>arcade.snapshot();
    const context=({accounts,bot})=>({profileId:accounts.selectedId,expectedMode:bot.mode,expectedChannel:bot.channel});
    await arcade.botConfigure({...context(await read()),channel:'qq',mode:'deepseek',qqUrl:'ws://127.0.0.1:41434/',
     qqAccountId:accountId,qqOwnerId:ownerId,qqToken:'fixture-group-voice-loopback-token',qqGroups:{enabled:true,groupIds,proactive:false}});
    await arcade.botConfigure({...context(await read()),key});
    await arcade.socialConfigure({enabled:true,proactiveMessages:false,qzonePosts:false});
    const card=await arcade.charactersAddExample({name:'合成群语音角色',description:'只用于隔离安装包测试。'});
    const scope={...context(await read()),expectedAccountId:accountId,groupId:groupIds[1],cardId:card.id};
    const {approval}=await arcade.groupRolePreview(scope);await arcade.groupRoleSet({...scope,approval});
    return {id:card.id,name:card.name};
   },{accountId,ownerId,groupIds,key:FAKE_KEY});
   assert.match(card.id,/^[a-f0-9]{16}$/);
   assert.deepEqual((await snapshot()).bot.qq.groups.asrAvailability,{available:false,reason:'asr_unavailable'});
   await openGroupForm();await asrStatus().filter({hasText:'本机语音识别尚未配置'}).waitFor();
   assert.equal(await voiceCheck(groupIds[0]).isChecked(),false);assert.equal(await voiceCheck(groupIds[1]).isChecked(),false);
   await voiceCheck(groupIds[0]).check();await live.page.locator('#bot-qq-groups-save').click();
   await live.page.locator('#bot-qq-groups-feedback').filter({hasText:'群聊设置已保存'}).waitFor();
   assert.deepEqual((await snapshot()).bot.qq.groups.voiceGroupIds,[groupIds[0]]);
   await groupVoicePicker().scrollIntoViewIfNeeded();await shot('group-voice-asr-missing');
   assert.deepEqual(await bridge(),{admissions:0,memberChecks:[],nameChecks:[],sends:[],pickers:0,unexpected:0});
   await assertIsolation();assert.deepEqual(await live.close(),{code:0,signal:null});live=null;
   const pythonPath=path.join(root,'configuration-only-python'),modelPath=path.join(root,'configuration-only-model');
   fs.writeFileSync(pythonPath,'synthetic path marker, never executed\n',{mode:0o600});fs.mkdirSync(modelPath,{mode:0o700});
   fs.writeFileSync(path.join(home,'local-voice.json'),JSON.stringify({version:1,asrPython:pythonPath,asrModel:modelPath}),{mode:0o600});
   await launch('group-voice-reopen');
   const reopened=(await snapshot()).bot.qq.groups;
   assert.deepEqual(reopened.voiceGroupIds,[groupIds[0]]);
   assert.deepEqual(reopened.asrAvailability,{configured:true,available:false,reason:'asr_unverified'});
   await openGroupForm();await asrStatus().filter({hasText:'等待一次成功转写'}).waitFor();
   assert(await voiceCheck(groupIds[0]).isChecked());assert.equal(await voiceCheck(groupIds[1]).isChecked(),false);
   await groupVoicePicker().scrollIntoViewIfNeeded();await shot('group-voice-asr-unverified');
   pass('Packaged preload/main persist consent for only the selected group. Cold start reports configured ASR paths as unverified, with no worker launch or live transcription.');
   await live.page.evaluate(async()=>{await arcade.botConnect();switchView('bot');});
   await live.page.waitForFunction(async()=>{const s=await arcade.snapshot();return s.bot.status==='connected'&&s.bot.voiceMedia.groupTargets?.length===2;});
   const {bot,accounts}=await snapshot(),target=bot.voiceMedia.groupTargets.find(row=>row.groupId===groupIds[1]);
   assert.equal(target.role,card.name);assert.match(target.roleId,new RegExp('^card-'+card.id+'(?:-|$)'));
   assert.equal((await bridge()).admissions,1);
   const privateCode=await live.page.evaluate(async accountId=>(await arcade.qqVoiceAvailability({accountId,panelId:'fixture-refuse-owner'})).code,accounts.selectedId);
   assert.equal(privateCode,'group_unavailable');
   await live.page.evaluate(()=>{
    const state=window.syntheticGroupPlayback={starts:0};
    window.Audio=class{constructor(){this.muted=true;}play(){state.starts++;return Promise.resolve();}pause(){}removeAttribute(name){if(name==='src')this.src='';}load(){}};
   });
   const drawer=live.page.locator('#qq-voice'),entry=live.page.locator('#qq-voice-open'),select=drawer.locator('#qq-voice-target');
   const send=drawer.locator('#qq-voice-send'),player=drawer.locator('.qq-voice-player');
   await entry.click();await drawer.waitFor();assert.equal(await select.inputValue(),'');assert(await send.isDisabled());
   assert.deepEqual((await bridge()).memberChecks,[]);
   await select.selectOption(groupIds[1]);
   await drawer.getByText(/语音生成尚未配置|此平台暂不能生成语音/).waitFor();
   assert.equal(await drawer.locator('#qq-voice-generate').count(),0);
   const recipient=drawer.locator('.qq-voice-recipient');assert.match(await recipient.innerText(),/合成群语音角色[\s\S]*600001[\s\S]*500002/);
   await drawer.locator('#qq-voice-choose').click();await player.waitFor();assert(await send.isEnabled());
   assert.equal(await live.page.evaluate(()=>syntheticGroupPlayback.starts),0);
   assert.match(await recipient.innerText(),/500002 · 合成试用群/);
   // The group name belongs to the direct picker response, not periodic snapshots.
   assert.deepEqual((await snapshot()).bot.voiceMedia.draft.recipient,{accountId,...target});
   const beforeSend=await bridge();assert.deepEqual(beforeSend.memberChecks,[500002]);assert.deepEqual(beforeSend.nameChecks,[500002]);
   assert.deepEqual(beforeSend.sends,[]);assert.equal(beforeSend.pickers,1);
   await player.scrollIntoViewIfNeeded();await shot('group-voice-preview');
   await send.click();await drawer.locator('#qq-voice-status').filter({hasText:'QQ 已接受'}).waitFor();
   const details=drawer.locator('#qq-voice-receipt');await details.locator('summary').click();
   assert.match(await details.innerText(),/8301[\s\S]*600001[\s\S]*500002 · 合成试用群[\s\S]*合成群语音角色/);
   assert.equal(await details.locator('[data-field="ownerId"]').count(),0);assert(await send.isDisabled());assert.equal(await player.count(),0);
   const submitted=await bridge();
   assert(submitted.nameChecks.length>0&&submitted.nameChecks.every(id=>id===500002));
   assert.deepEqual(submitted,{admissions:1,memberChecks:[500002,500002],nameChecks:submitted.nameChecks,sends:[{groupId:500002,bytes:8044,sha256:wavHash}],pickers:1,unexpected:0});
   assert.equal(await live.page.evaluate(()=>syntheticGroupPlayback.starts),0);
   await shot('group-voice-accepted-receipt');await drawer.locator('#qq-voice-close').click();
   await assertIsolation();assert.deepEqual(await live.close(),{code:0,signal:null});live=null;
   assert.equal(sha(wavPath),wavHash);assert.equal(sha(archive),receipt.artifacts[0].asarSha256);assert.deepEqual(receipt.errors,[]);
   pass('Actual packaged main/preload picker and send verify the exact group and role. An unplayed clip yields one canonical WAV submission only after explicit Send. The verified group name and numeric ID match the synthetic OneBot receipt.');
   receipt.groupVoice={actualPackagedRenderer:true,actualPreloadIPC:true,syntheticOneBot:true,syntheticPicker:true,listeningOptional:true,playbackStarts:0,macOwnerRefused:true,macGenerationConfiguredInFixture:false,
    optedInForTranscription:[groupIds[0]],asrReadback:reopened.asrAvailability,realAsr:false,groupVoiceTransport:submitted,providerRequests:0,realQQ:false,isolatedQuit:true};
   receipt.passed=true;
   console.log(JSON.stringify({passed:true,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output}));
   return;
  }
  if(options.groupWorldbooksOnly){
   assert.equal(receipt.artifacts[0].verificationOnly,true,'Use a keyless verification artifact for the group world-book fixture.');
   const required=['/src/bot/st/lorebooks.cjs','/src/bot/group-public-lorebook.cjs'];
   assert(required.every(file=>asar.listPackage(archive).includes(file)),'Group world books must be present in the packaged source.');
   const accountId='600001',ownerId='600002',groupIds=['500001','500002'],groupId=groupIds[1];
   const library=()=>live.page.evaluate(()=>arcade.lorebooksList());
   const roleDisclosure=()=>live.page.locator('#bot-qq-group-roles');
   const bookDisclosure=()=>live.page.locator('#bot-qq-group-lorebooks');
   const approved=()=>bookDisclosure().locator('#bot-qq-group-lorebook-approved');
   const preview=()=>bookDisclosure().locator('#bot-qq-group-lorebook-preview');
   const chooser=()=>bookDisclosure().locator('#bot-qq-group-lorebook-book');
   const openBooks=async id=>{
    await openGroupForm();
    await roleDisclosure().locator(':scope > summary').click();
    await roleDisclosure().locator('#bot-qq-group-role-group').selectOption(id);
    await bookDisclosure().locator(':scope > summary').click();
   };
   const review=async book=>{
    await chooser().locator(`option[value="${book.id}"]`).waitFor({state:'attached'});
    await chooser().selectOption(book.id);
    await bookDisclosure().locator('#bot-qq-group-lorebook-review').click();
    await preview().waitFor();
   };
   const approve=async book=>{
    await bookDisclosure().locator('#bot-qq-group-lorebook-approve').click();
    await approved().getByText(book.name,{exact:true}).waitFor();
   };
   const quit=async()=>{
    const stats=await live.inspector.evaluate('({requests:__integratedMacSmoke.requests,blockedNetwork:__integratedMacSmoke.blockedNetwork,blockedChildren:__integratedMacSmoke.blockedChildren,credentialWrites:__integratedMacSmoke.syntheticVaultStats.encrypt})');
    assert.deepEqual(stats,{requests:0,blockedNetwork:0,blockedChildren:0,credentialWrites:0});
    const stop=await live.close();live=null;assert.deepEqual(stop,{code:0,signal:null});
    return stop;
   };
   await launch('world-books-first');
   assert.equal(await live.page.evaluate(()=>arcade.platform.os),'darwin');
   const [large,small]=await live.inspector.evaluate(`(${seedPackagedGroupWorldbooks.toString()})(${JSON.stringify(home)})`);
   assert.equal(large.entries,500);assert.equal(small.entries,2);assert.notEqual(large.id,small.id);
   for(const book of [large,small])assert.match(book.id,/^[0-9a-f]{16}$/);
   assert.deepEqual((await library()).map(({id,name,entries})=>({id,name,entries})).sort((a,b)=>a.id.localeCompare(b.id)),
    [large,small].sort((a,b)=>a.id.localeCompare(b.id)));
   const role=await live.page.evaluate(async({accountId,ownerId,groupIds,groupId})=>{
    const context=({accounts,bot})=>({profileId:accounts.selectedId,expectedMode:bot.mode,expectedChannel:bot.channel});
    await arcade.botConfigure({...context(await arcade.snapshot()),channel:'qq',qqAccountId:accountId,qqOwnerId:ownerId,qqGroups:{enabled:true,groupIds,proactive:false}});
    const card=await arcade.charactersAddExample({name:'合成世界书角色',description:'只用于隔离的双世界书安装包测试。'});
    const scope={...context(await arcade.snapshot()),expectedAccountId:accountId,groupId,cardId:card.id};
    const {approval}=await arcade.groupRolePreview(scope);
    await arcade.groupRoleSet({...scope,approval});
    return {cardId:card.id,name:card.name,roleId:'card-'+card.id};
   },{accountId,ownerId,groupIds,groupId});
   const roles=[{groupId,cardId:role.cardId,name:role.name}],bindings=[large,small].map(book=>({groupId,roleId:role.roleId,bookId:book.id,name:book.name}));
   const readBack=async expected=>{
    const {bot}=await snapshot();
    assert.equal(bot.channel,'qq');assert.equal(bot.status,'disconnected');assert.equal(bot.hasKey,false);assert.equal(bot.qq.hasToken,false);
    assert.equal(bot.qq.expectedAccountId,accountId);assert.deepEqual(bot.qq.groups.groupIds,groupIds);
    assert.deepEqual(bot.qq.groups.roles,roles);assert.deepEqual(bot.qq.groups.lorebooks,expected);
   };
   await readBack([]);await openBooks(groupId);await review(large);
   const pageState=()=>preview().locator('#bot-qq-group-lorebook-page-state'),entries=()=>preview().locator('#bot-qq-group-lorebook-entries');
   assert.match(await pageState().innerText(),/第 1 \/ 50 页 · 共 500 条启用条目/);
   assert.match(await preview().innerText(),/600001 · 群 500002[\s\S]*合成世界书角色/);
   assert.equal(await entries().locator('section').count(),10);
   await bookDisclosure().locator('#bot-qq-group-lorebook-page').selectOption({value:'49'});
   await pageState().filter({hasText:'第 50 / 50 页 · 共 500 条启用条目'}).waitFor();
   assert.equal(await entries().locator('section').count(),10);
   const finalEntry=entries().getByText('合成末页正文字面 <b>第 500 条</b>',{exact:true});
   await finalEntry.waitFor();
   assert.equal(await entries().locator('b').count(),0);
   await pageState().scrollIntoViewIfNeeded();await shot('world-book-page-50');
   await finalEntry.scrollIntoViewIfNeeded();await shot('world-book-entry-500');
   await readBack([]);await approve(large);await readBack([bindings[0]]);
   await review(small);await approve(small);await readBack(bindings);
   assert.equal(await approved().locator('li').count(),2);await approved().scrollIntoViewIfNeeded();await shot('world-books-two-approved');
   pass('Unmodified packaged main/preload/renderer read a 500-entry real library book by page and one separate smaller book. Explicit approval creates two independent rows for exactly one saved group role.');
   const exits=[await quit()];
   await launch('world-books-reopen');await readBack(bindings);await openBooks(groupIds[0]);
   await bookDisclosure().locator('#bot-qq-group-lorebook-current').filter({hasText:'此群尚未批准世界书'}).waitFor();
   await roleDisclosure().locator('#bot-qq-group-role-group').selectOption(groupId);
   for(const book of [large,small])await approved().getByText(book.name,{exact:true}).waitFor();
   await approved().scrollIntoViewIfNeeded();await shot('world-books-cold-readback');
   pass('A cold launch retains both approvals only on the same QQ account, group and role; the second group reads back no approvals.');
   const revoke=approved().locator(`button[data-book-id="${large.id}"][data-role-id="${role.roleId}"]`);
   await revoke.click();await revoke.waitFor({state:'detached'});await readBack([bindings[1]]);
   assert.equal((await library()).length,2);exits.push(await quit());
   await launch('world-books-revoke-reopen');await readBack([bindings[1]]);await openBooks(groupId);
   await approved().getByText(small.name,{exact:true}).waitFor();assert.equal(await approved().locator('li').count(),1);
   assert.deepEqual((await library()).map(book=>book.id).sort(),[large.id,small.id].sort());
   await approved().scrollIntoViewIfNeeded();await shot('world-books-single-revoke-cold');
   exits.push(await quit());
   assert.equal(provider.fixture.calls.length,0);assert.deepEqual(receipt.errors,[]);
   assert.equal(sha(archive),receipt.artifacts[0].asarSha256);
   receipt.groupWorldbooks={actualPackagedRenderer:true,actualPreloadIPC:true,actualPackagedLibrary:true,seededEntries:[500,2],sampledPages:[1,50],
    scopedApprovals:bindings,coldReadback:bindings,revokeColdReadback:[bindings[1]],libraryBooksRetained:2,isolatedQuits:exits,
    realQQ:false,providerRequests:0,credentialWrites:0,nativeDialogs:false};
   pass('Revoking the exact book preserves the second approval and both library files. A further cold launch retains the one remaining approval without starting a bridge or model.');
   receipt.passed=true;
   console.log(JSON.stringify({passed:true,checks:receipt.checks.length,screenshots:receipt.screenshots.length,output}));
   return;
  }
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
  if(receipt.artifacts[0].verificationOnly){
   const before=provider.fixture.calls.length;
   const result=await live.inspector.evaluate(`(${packagedGroupFlow.toString()})()`);
   const calls=provider.fixture.calls.slice(before),reply=calls.at(-1)?.messages?.at(-1)?.content||'';
   assert.equal(result.sent,2);assert.equal(result.members,2);assert.equal(calls.length,4);
   assert(reply.includes('SYNTHETIC_PUBLIC_BEACH_PLAN')&&reply.includes('SYNTHETIC_PUBLIC_RAIN_QUESTION'));
   assert(reply.includes(result.firstReply),'The packaged reply must include its own confirmed earlier group response.');
   assert(calls.every(call=>call.keyMatched&&call.noTools));
   receipt.publicGroup={synthetic:true,actualPackagedModules:true,realQQ:false,requests:calls.length,members:result.members,sent:result.sent,humanTopicInFinalRequest:true,confirmedCharacterReplyInFinalRequest:true};
   pass('Actual packaged group modules and DeepSeek runner carry two synthetic members plus the confirmed AI reply into the next HTTP stand-in request; no QQ message is sent.');
  }
  if(asar.listPackage(archive).includes('/src/pets/index.html')){
   receipt.desktopPets=await checkDesktopPets({live,output,provider,send,completeReply,ensureChatReady,pass,shot});
  }
  const stats=await live.inspector.evaluate('({identityCalls:__integratedMacSmoke.identityCalls,blockedNetwork:__integratedMacSmoke.blockedNetwork,blockedChildren:__integratedMacSmoke.blockedChildren,requests:__integratedMacSmoke.requests,vaultMode:"synthetic-no-os",syntheticStorageReads:__integratedMacSmoke.syntheticStorageReads,syntheticVaultStats:__integratedMacSmoke.syntheticVaultStats})');receipt.processProbe=stats;assert.equal(stats.blockedNetwork,0);assert.equal(stats.blockedChildren,0);assert.deepEqual(receipt.errors,[]);
  const exitStatus=await live.close();live=null;
  if(receipt.desktopPets){assert.deepEqual(exitStatus,{code:0,signal:null});receipt.desktopPets.quit=exitStatus;}
  assert.equal(sha(archive),receipt.artifacts[0].asarSha256);for(const row of receipt.artifacts)assert.equal(sha(path.join(row.bundle,'Contents/Resources/app.asar')),row.asarSha256);
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
async function checkDesktopPets({live,output,provider,send,completeReply,ensureChatReady,pass,shot}){
 const ids=['claude','gpt','codex','deepseek','gemini','doubao','sprout'];
 const entry=action=>live.inspector.evaluate(`(${petWindowAction.toString()})(${JSON.stringify(action)})`);
 const wait=async predicate=>{
  const deadline=Date.now()+25000;
  let rows;
  while(Date.now()<deadline){
   rows=await entry({kind:'read'});
   if(predicate(rows))return rows;
   await delay(60);
  }
  throw Error('Unexpected desktop pet windows: '+JSON.stringify(rows));
 };
 const settings=async()=>live.page.evaluate(()=>switchView('settings'));
 const toggle=id=>live.page.locator('#desktop-pet-'+id);
 const initialAccount=await live.page.evaluate(async()=>{
  const {accounts}=await arcade.snapshot();
  await arcade.stConfigure({profileId:accounts.selectedId,builtinPersonaId:null,characterId:null,groupId:null});
  return accounts.selectedId;
 });
 await settings();
 for(const id of ids)assert.equal(await toggle(id).isChecked(),false);
 assert.deepEqual(await entry({kind:'read'}),[]);
 const idleMetrics=await entry({kind:'metrics'});
 for(const id of ids)await toggle(id).check();
 const loaded=await wait(rows=>rows.length===ids.length&&rows.every(row=>row.meshes>0&&row.mode==='idle'));
 assert(loaded.every(row=>row.draggable==='drag'&&row.visible&&row.movable&&row.sandboxed));
 assert.equal(new Set(loaded.map(row=>JSON.stringify(row.bounds))).size,ids.length);
 assert.equal(new Set(loaded.map(row=>row.asset)).size,6);
 await shot('desktop-pet-settings');
 for(const id of ids)await entry({kind:'capture',id,file:path.join(output,'pet-'+id+'.png')});
 pass('The installed-code Settings toggles default off. Seven independent native windows load six real offline meshes in sandboxed renderers.');
 const beforeMove=loaded.find(row=>row.id==='gpt').bounds;
 await entry({kind:'move',id:'gpt'});
 const moved=await wait(rows=>rows.some(row=>row.id==='gpt'&&JSON.stringify(row.bounds)!==JSON.stringify(beforeMove)));
 assert.deepEqual(moved.find(row=>row.id==='codex').bounds,loaded.find(row=>row.id==='codex').bounds);
 await entry({kind:'turn',id:'gpt'});
 await delay(300);
 await entry({kind:'capture',id:'gpt',file:path.join(output,'pet-gpt-turned.png')});
 assert.notEqual(sha(path.join(output,'pet-gpt.png')),sha(path.join(output,'pet-gpt-turned.png')));
 await live.page.evaluate(async()=>{
  await arcade.accountCreate('Synthetic GPT pet profile');
  await arcade.botConfigure({mode:'gpt'});
  const {accounts}=await arcade.snapshot();
  await arcade.stConfigure({profileId:accounts.selectedId,builtinPersonaId:'deepseek-whale',characterId:null,groupId:null});
 });
 const rebound=await wait(rows=>rows.some(row=>row.id==='gpt'&&row.asset.endsWith('/deepseek-whale.glb')&&row.meshes>0&&row.mode==='idle'));
 assert.equal(rebound.find(row=>row.id==='codex').asset,'/models/codex-dragon.glb');
 await entry({kind:'capture',id:'gpt',file:path.join(output,'pet-gpt-selected-whale.png')});
 await live.page.evaluate(async()=>{
  const {accounts}=await arcade.snapshot();
  await arcade.stConfigure({profileId:accounts.selectedId,builtinPersonaId:null,characterId:null,groupId:null});
 });
 await wait(rows=>rows.some(row=>row.id==='gpt'&&row.asset.endsWith('/codex-dragon.glb')&&row.meshes>0&&row.mode==='idle'));
 pass('Model orbit and window positioning are independent. Selecting Whale for GPT hot-swaps its packaged mesh and restoring default returns Dragon, while Codex keeps its own Dragon window.');
 await live.page.evaluate(async id=>{
  await arcade.accountSelect(id);
  switchView('bot');
 },initialAccount);
 await ensureChatReady();
 provider.fixture.mode='hold';
 await send('SYNTHETIC_PET_REPLY',{finish:false});
 const busy=await wait(rows=>rows.some(row=>row.id==='deepseek'&&row.mode==='busy'));
 assert(busy.filter(row=>row.id!=='deepseek').every(row=>row.mode==='idle'));
 provider.fixture.mode='reply';
 await completeReply(provider.fixture.serial);
 const replied=await wait(rows=>rows.some(row=>row.id==='deepseek'&&row.mode==='reply'));
 assert(replied.filter(row=>row.id!=='deepseek').every(row=>row.mode==='idle'));
 await entry({kind:'capture',id:'deepseek',file:path.join(output,'pet-deepseek-reply.png')});
 await wait(rows=>rows.every(row=>row.mode==='idle'));
 await entry({kind:'metrics'});
 await delay(1200);
 const sevenWindowMetrics=await entry({kind:'metrics'});
 await entry({kind:'close',id:'codex'});
 await wait(rows=>rows.length===6&&!rows.some(row=>row.id==='codex'));
 await settings();
 assert.equal(await toggle('codex').isChecked(),false);
 assert.equal(await toggle('gpt').isChecked(),true);
 pass('A real App IPC conversation using the loopback model drives only the bound provider pet from busy to reply to idle. Closing one pet updates its persisted toggle and leaves other pets visible.');
 return {synthetic:true,windows:loaded,profilesWithActualKeys:0,roleChange:true,scopedReply:true,independentClose:true,idleMetrics,sevenWindowMetrics};
}

// Main-process inspector wrapper, only in the disposable package test copy.
async function petWindowAction(action){
 const require=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');
 const {app,BrowserWindow}=require('electron');
 const windows=BrowserWindow.getAllWindows().filter(win=>win.webContents.getURL()==='arcade-pet://local/index.html');
 const read=window=>window.webContents.executeJavaScript(`({
  id:document.body.dataset.pet,mode:document.body.dataset.mode,asset:document.body.dataset.model,
  meshes:Number(document.body.dataset.meshes||0),
  draggable:getComputedStyle(document.querySelector('header')).webkitAppRegion
 })`);
 if(action.kind==='read'){
  const rows=await Promise.all(windows.map(async window=>({
   ...await read(window),visible:window.isVisible(),movable:window.isMovable(),bounds:window.getBounds(),
   sandboxed:window.webContents.getLastWebPreferences().sandbox===true,
  })));
  return rows.filter(row=>row.id);
 }
 if(action.kind==='metrics')return app.getAppMetrics().map(value=>({type:value.type,cpu:value.cpu?.percentCPUUsage,workingSetKB:value.memory?.workingSetSize}));
 for(const window of windows){
  if((await read(window)).id!==action.id)continue;
  if(action.kind==='capture'){
   const image=await window.webContents.capturePage();
   require('node:fs').writeFileSync(action.file,image.toPNG());
   return true;
  }
  if(action.kind==='move'){
   const [x,y]=window.getPosition();window.setPosition(x-18,y-12);return true;
  }
  if(action.kind==='turn')return window.webContents.executeJavaScript(`for(let i=0;i<4;i++)document.getElementById('model').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));true;`);
  if(action.kind==='close'){
   window.webContents.executeJavaScript("document.getElementById('close').click();true").catch(()=>{});
   return true;
  }
 }
 throw Error('The fixture pet window is unavailable.');
}

// With file import intentionally skipped, seed the actual packaged library
// under the exact disposable app root, then exercise normal read/review IPC.
function seedPackagedGroupWorldbooks(home){
 const require=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');
 const fs=require('node:fs'),path=require('node:path');
 if(!globalThis.__integratedMacSmoke?.verificationPoliciesInjected||!__integratedMacSmoke.app.isPackaged||
    process.env.AGENT_ARCADE_HOME!==home||fs.realpathSync(home)!==home||path.basename(home)!=='data'||
    !path.basename(path.dirname(home)).startsWith('arcade-integrated-mac-'))throw Error('Expected the exact disposable group world-book profile.');
 const root=path.join(home,'lorebooks');
 if(fs.existsSync(root)&&(!fs.lstatSync(root).isDirectory()||fs.realpathSync(root)!==root))throw Error('Invalid fixture library path.');
 const {LorebookLibrary,importWorldInfoFile}=require('./src/bot/st/lorebooks.cjs');
 const library=new LorebookLibrary({root});
 if(library.list().length!==0)throw Error('Expected an empty disposable group world-book library.');
 const entry=(id,content)=>({id,keys:['潮汐'],secondary_keys:['港口'],content,enabled:true});
 const rows=[['合成潮汐档案',Array.from({length:500},(_,index)=>entry(index+1,index===499?'合成末页正文字面 <b>第 500 条</b>':'合成潮汐条目 '+(index+1)))],
  ['合成港口值班录',[entry(1,'合成值班说明一'),entry(2,'合成值班说明二')]]];
 return rows.map(([name,entries])=>{
  const saved=library.add({name,book:importWorldInfoFile({name,entries}).book});
  return {id:saved.id,name:saved.name,entries:saved.book.entries.length};
 });
}

// Executed only in the already isolated verification App. Both the route and
// API runner come from its unchanged ASAR; sends are local receipt stand-ins.
async function packagedGroupFlow(){
 const require=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json');
 const path=require('node:path'),fs=require('node:fs');
 const src=path.join(process.resourcesPath,'app.asar','src','bot');
 const {GroupCompanionRoute}=require(path.join(src,'group-companion-route.cjs'));
 const {createDeepSeekRunner}=require(path.join(src,'deepseek-runner.cjs'));
 const root=path.join(process.env.AGENT_ARCADE_HOME,'synthetic-packaged-group');fs.mkdirSync(root,{recursive:true});
 const sent=[];
 const route=new GroupCompanionRoute({root,platform:'qq-onebot',accountId:'100001',mode:'deepseek',
  configuration:{enabled:true,groupIds:['500001'],proactive:false},persona:{characterId:'deepseek-whale',name:'Synthetic whale',description:'Synthetic public character'},
  createExecute:memberRoot=>{const workspace=path.join(memberRoot,'workspace');fs.mkdirSync(workspace,{recursive:true});return createDeepSeekRunner({workspace,key:'fixture-integrated-mac-api-key',model:'deepseek-flash',conversationOnly:true,persona:{enabled:false,selection:'default'}});},
  send:async(binding,text)=>{sent.push({sender:binding.senderId,text});return {id:'synthetic-group-receipt-'+sent.length};},flow:{debounceMs:0,bubbleDelayMs:0}});
 try{
  for(const [id,from,text]of [['package-a','200001','SYNTHETIC_PUBLIC_BEACH_PLAN'],['package-b','200002','SYNTHETIC_PUBLIC_RAIN_QUESTION']]){
   await route.receive({id,from,text,route:'group',accountId:'100001',groupId:'500001',contextToken:'synthetic-'+id});
   await Promise.all([...route.actors.values()].map(actor=>actor.engine.whenIdle()));
  }
  return {sent:sent.length,members:route.actors.size,firstReply:sent[0]?.text};
 }finally{await route.stop();}
}
module.exports={artifactType,parseArgs,contained,preludeExpression,fixturePrelude,isolatedEnvironment,Inspector,restoreSyntheticBackup,createSyntheticVault};
if(require.main===module)run(parseArgs(process.argv.slice(2))).catch(error=>{console.error(error.message);process.exitCode=1;});
