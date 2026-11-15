'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {artifactType,parseArgs,contained,preludeExpression,isolatedEnvironment,Inspector,restoreSyntheticBackup,createSyntheticVault}=require('../scripts/integrated-mac-package-smoke.cjs');

test('package smoke accepts actual archive inputs and refuses developer App as final delivery',()=>{
 assert.equal(artifactType('/tmp/final.zip'),'zip');assert.equal(artifactType('/tmp/final.dmg'),'dmg');
 assert.throws(()=>artifactType('/tmp/Agent Arcade.app'),/final/);
 assert.throws(()=>parseArgs([]),/one or two/);assert.throws(()=>parseArgs(['--artifact','a.zip','--artifact','a.zip']),/distinct/);
 const result=parseArgs(['--artifact','a.zip','--artifact','a.dmg','--seed-app','old.app']);assert.equal(result.artifacts.length,2);assert(result.seedApp.endsWith('old.app'));
});

test('package smoke rejects symlink extraction escaping its disposable tree',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-smoke-boundary-')),inner=path.join(root,'inner');fs.mkdirSync(inner);fs.symlinkSync(os.tmpdir(),path.join(inner,'outside'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));assert.equal(contained(inner,root),fs.realpathSync(inner));assert.throws(()=>contained(path.join(inner,'outside'),root),/leaves disposable/);
});

test('smoke environment strips inherited credentials while preserving HOME and CODEX_HOME',()=>{
 const result=isolatedEnvironment('/private/tmp/test','/private/tmp/test/data',{HOME:'/owner/home',CODEX_HOME:'/owner/codex',PATH:'/host/path',ANTHROPIC_API_KEY:'fixture',OPENAI_TOKEN:'fixture',NODE_OPTIONS:'--require original.cjs',AGENT_ARCADE_HOME:'/original'});
 assert.equal(result.HOME,'/owner/home');assert.equal(result.CODEX_HOME,'/owner/codex');assert.equal(result.PATH,'/host/path');assert.equal(result.ANTHROPIC_API_KEY,undefined);assert.equal(result.OPENAI_TOKEN,undefined);assert.equal(result.NODE_OPTIONS,undefined);assert.equal(result.AGENT_ARCADE_HOME,'/private/tmp/test/data');assert.equal(result.AGENT_ARCADE_CLAUDE_SETTINGS,'/private/tmp/test/tool-config/claude-settings.json');
});

test('paused-bootstrap prelude keeps the real guard and a throwing native safeStorage getter is never read',async()=>{
 let appName='Initial',guardOptions,guardCalls=0,nativeCalls=0,loginOptions,forwarded,webGuard,nativeVaultReads=0;
 const app={isPackaged:true,setName:value=>{appName=value;},getName:()=>appName,setPath:(name,value)=>{assert.equal(name,'userData');assert.equal(value,'/private/tmp/fixture/profile');},whenReady:()=>Promise.resolve()};
 const identity={configureAppIdentity:application=>{application.setName('agent-arcade');return {name:'agent-arcade',bundleId:'production'};}};
 const single={acquireSingleInstance:async options=>{guardCalls++;guardOptions=options;return {primary:true,close(){}};},instanceEndpoint:options=>'/tmp/'+options.namespace+'.sock'};
 const native={discoverNative:async()=>{nativeCalls++;}},login={createProviderLogin:options=>{loginOptions=options;return options;}},child={};
 const modules={'core/app-identity.cjs':identity,'core/single-instance.cjs':single,'bot/native-launch.cjs':native,'bot/provider-login.cjs':login};
 const electron={app,session:{defaultSession:{webRequest:{onBeforeRequest:(_filter,callback)=>{webGuard=callback;}}}}};Object.defineProperty(electron,'safeStorage',{configurable:true,get(){nativeVaultReads++;throw Error('NATIVE KEYCHAIN GETTER MUST NOT BE READ');}});
 let contextRequire;const loader={_load:name=>contextRequire(name),createRequire:file=>{assert.equal(file,'/private/tmp/fixture/resources/app.asar/package.json');return name=>loader._load(name);}};
 const context=vm.createContext({process:{platform:'darwin',resourcesPath:'/private/tmp/fixture/resources',env:{AGENT_ARCADE_HOME:'/private/tmp/fixture/data'},getBuiltinModule:name=>{assert.equal(name,'module');return loader;}},require:name=>loader._load(name),fetch:async(url,init)=>{forwarded={url,init};return {ok:true};}});
 contextRequire=name=>{
  if(name==='node:path'||name==='node:crypto'||name==='node:buffer')return require(name);if(name==='node:child_process')return child;
  if(name==='electron')return electron;
  const key=Object.keys(modules).find(file=>name.endsWith(file));if(key)return modules[key];throw Error('Unexpected fixture import.');
 };
 const config={root:'/private/tmp/fixture',profile:'/private/tmp/fixture/profile',name:'agent-arcade-test-only',bundleId:'io.test.only',namespace:'arcade-test-only',provider:'http://127.0.0.1:12345/deepseek'};
 const installed=vm.runInContext(preludeExpression(config),context);assert.equal(installed.installed,true);identity.configureAppIdentity(app);identity.configureAppIdentity(app);assert.equal(appName,config.name);assert.equal(context.__integratedMacSmoke.identityCalls,2);
 const raise=()=>{};await single.acquireSingleInstance({onRaise:raise});assert.equal(guardCalls,1);assert.equal(guardOptions.namespace,config.namespace);assert.equal(guardOptions.onRaise,raise);assert.equal(context.__integratedMacSmoke.guard.primary,true);
 await assert.rejects(native.discoverNative(),/disabled/);assert.equal(nativeCalls,0);login.createProviderLogin();assert.equal(await loginOptions.discoverImpl(),null);
 await context.fetch('https://api.deepseek.com/chat/completions',{body:'synthetic'});assert.equal(forwarded.url,config.provider);assert.equal(forwarded.init.body,'synthetic');assert.throws(()=>context.fetch('https://api.anthropic.com/'),/blocked/);assert.throws(()=>child.spawn('claude'),/disabled/);
 const synthetic=loader._load('electron').safeStorage;const cipher=synthetic.encryptString(JSON.stringify({deepseekKey:'fixture-integrated-mac-api-key'}));assert.equal(JSON.parse(synthetic.decryptString(cipher)).deepseekKey,'fixture-integrated-mac-api-key');assert.equal(await synthetic.isAsyncEncryptionAvailable(),true);assert.equal(nativeVaultReads,0);assert.equal(context.__integratedMacSmoke.syntheticStorageReads,1);
 await Promise.resolve();let blocked;webGuard({},result=>{blocked=result.cancel;});assert.equal(blocked,true);
});

function paused(url,id){return {callFrames:[{callFrameId:id,url,location:{scriptId:id,lineNumber:0}}]};}
test('an initial non-bootstrap pause installs early isolation before its first resume',async()=>{
 const probe=Object.create(Inspector.prototype),events=[];probe.pauses=[paused('node:electron/js2c/browser_init','first')];probe.scripts=new Map();
 probe.send=async(method,params)=>{
  events.push({method,params});
  if(method==='Debugger.evaluateOnCallFrame'){assert.equal(params.callFrameId,'first');assert.match(params.expression,/getBuiltinModule/);return {result:{value:{installed:true,earlyIsolation:true}}};}
  if(method==='Debugger.resume'&&events.filter(item=>item.method===method).length===1)probe.pauses.push(paused('file:///private/tmp/test.app/Contents/Resources/app.asar/src/bootstrap.cjs','bootstrap'));
  return {};
 };
 const proof=await probe.inject({root:'/private/tmp/test'});assert.equal(proof.early.url,'node:electron/js2c/browser_init');assert.match(proof.url,/bootstrap/);
 const install=events.findIndex(item=>item.method==='Debugger.evaluateOnCallFrame'),resume=events.findIndex(item=>item.method==='Debugger.resume');assert(install>=0&&install<resume);assert.equal(events.filter(item=>item.method==='Debugger.evaluateOnCallFrame').length,1);
 const breakpoint=events.find(item=>item.method==='Debugger.setBreakpointByUrl');assert(new RegExp(breakpoint.params.urlRegex).test(proof.url));
});
test('early-isolation failure never resumes the paused child',async()=>{
 const probe=Object.create(Inspector.prototype),events=[];probe.pauses=[paused('node:electron/js2c/browser_init','first')];probe.scripts=new Map();
 probe.send=async method=>{events.push(method);return method==='Debugger.evaluateOnCallFrame'?{exceptionDetails:{text:'early failure'}}:{};};
 await assert.rejects(probe.inject({root:'/private/tmp/test'}),/Early isolation failed/);assert.equal(events.includes('Debugger.resume'),false);assert.equal(events.includes('Debugger.disable'),false);
});

test('manual synthetic recovery preserves the newer directory and restores full WAL/SHM and original modes at the same root',t=>{
 const owned=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-smoke-restore-'))),data=path.join(owned,'data'),backup=path.join(data,'update-backups','saved'),numbered=path.join(backup,'root-0');
 fs.mkdirSync(numbered,{recursive:true,mode:0o700});fs.writeFileSync(path.join(data,'newer.txt'),'keep newer data');
 const files=[['chat.sqlite','fake database'],['chat.sqlite-wal','fake pending rows'],['chat.sqlite-shm','fake shared index'],['bot-vault.json','fake ciphertext']];
 const rows=files.map(([name,text])=>{fs.writeFileSync(path.join(numbered,name),text,{mode:0o600});return {root:0,path:name,kind:'file',mode:0o600,sourceMode:0o640,sha256:require('node:crypto').createHash('sha256').update(text).digest('hex')};});
 t.after(()=>fs.rmSync(owned,{recursive:true,force:true}));
 assert.throws(()=>restoreSyntheticBackup({temporaryRoot:owned,dataRoot:data,backupFolder:backup,manifest:{roots:[path.join(owned,'other')],files:rows}}),/exact/);assert.equal(fs.readFileSync(path.join(data,'newer.txt'),'utf8'),'keep newer data');
 const restored=restoreSyntheticBackup({temporaryRoot:owned,dataRoot:data,backupFolder:backup,manifest:{roots:[data],files:rows}});assert.equal(restored.restoredRoot,data);assert.equal(fs.readFileSync(path.join(restored.retained,'newer.txt'),'utf8'),'keep newer data');assert.equal(restored.walFiles,1);assert.equal(restored.shmFiles,1);assert.equal(fs.existsSync(path.join(data,'newer.txt')),false);
 for(const [name,text] of files){assert.equal(fs.readFileSync(path.join(data,name),'utf8'),text);if(process.platform!=='win32')assert.equal(fs.statSync(path.join(data,name)).mode&0o777,0o640);}
});

test('no-OS vault accepts only exact fixture credentials and never falls back for native or damaged ciphertext',async()=>{
 const crypto=require('node:crypto'),{vault,stats}=createSyntheticVault('arcade-test-only',crypto,Buffer),text=JSON.stringify({deepseekKey:'fixture-integrated-mac-api-key'});
 const first=vault.encryptString(text);assert.deepEqual(vault.encryptString(text),first);assert.equal(vault.decryptString(first),text);assert.equal(await vault.decryptStringAsync(await vault.encryptStringAsync(text)),text);assert.equal(vault.decryptString(vault.encryptString('{}')),'{}');assert.equal(vault.getSelectedStorageBackend(),'synthetic-no-os');
 assert.throws(()=>vault.encryptString(JSON.stringify({deepseekKey:'sk-a-real-looking-value'})),/Only this harness/);assert.throws(()=>vault.encryptString(JSON.stringify({deepseekKey:'fixture-integrated-mac-api-key',token:'unknown'})),/Only this harness/);assert.throws(()=>vault.decryptString(Buffer.from('v10-native-looking-ciphertext')),/Only this harness/);
 const tampered=Buffer.from(first);tampered[tampered.length-1]^=1;assert.throws(()=>vault.decryptString(tampered),/Only this harness/);assert.throws(()=>createSyntheticVault('another-fixture',crypto,Buffer).vault.decryptString(first),/Only this harness/);assert(stats.rejected>=4);
});
