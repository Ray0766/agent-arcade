'use strict';
// Original inert native programs and isolated metadata; never installed QQ.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto');
const {directories}=require('../../deploy/qq-supervisor/test/helpers.cjs'),{managedRuntime}=require('../../deploy/qq-supervisor/test/runtime-fixture.cjs');
const {QQRuntimeManager,createWindowsProcessHost}=require('../../src/bot/qq-runtime.cjs'),{QQComponentSelection,REQUIRED}=require('../../src/bot/qq-component-selection.cjs');
const fixtureGate=require('./qq-native-process-test-gate.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>a.pid===b.pid&&a.createdAt===b.createdAt&&a.executable.toLowerCase()===b.executable.toLowerCase();
function classifyRecordedAbsence(proofs,rows){
 const instant=value=>{assert(typeof value==='string','creation time is required');const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})$/.exec(value),ms=Date.parse(value);assert(m&&Number.isFinite(ms),'complete creation time is required');const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];assert(year>0&&month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<=23&&minute<=59&&second<=59,'invalid creation calendar/time');return BigInt(Math.floor(ms/1000))*10000000n+BigInt((m[7]||'').padEnd(7,'0'));};
 const valid=(row,label)=>{assert(row&&Number.isSafeInteger(row.pid)&&row.pid>0,label+' PID is required');instant(row.createdAt);assert(typeof row.executable==='string'&&!/[\x00-\x1f]/.test(row.executable)&&(/^[a-z]:[\\/]/i.test(row.executable)||/^\\\\[^\\/]+\\[^\\/]+\\[^\\/]+/.test(row.executable)),label+' fully qualified executable is required');};
 assert(Array.isArray(proofs)&&Array.isArray(rows),'identity arrays are required');const wanted=new Map();for(const row of proofs){valid(row,'recorded');assert(!wanted.has(row.pid),'duplicate recorded PID');wanted.set(row.pid,row);}
 const found=new Map(),remaining=[],replacements=[];for(const row of rows){valid(row,'observed');assert(wanted.has(row.pid),'unrequested observed PID');assert(!found.has(row.pid),'duplicate observed PID');const original=wanted.get(row.pid),oldTime=instant(original.createdAt),newTime=instant(row.createdAt);found.set(row.pid,row);if(newTime===oldTime){assert.equal(row.executable.toLowerCase(),original.executable.toLowerCase(),'same creation time has conflicting executable');remaining.push({...row});}else{assert(newTime>oldTime,'observed creation time does not establish a replacement');replacements.push({...row});}}
 const live=new Set(remaining.map(row=>row.pid));return {remaining,replacements,absent:proofs.filter(row=>!live.has(row.pid)).map(row=>({...row}))};
}
// This cleanup helper only acts on the original recorded creation identity.
async function stopRecordedCleanup(proofs,rows,stop,onObservation=()=>{}){
 const observation=classifyRecordedAbsence(proofs,rows),targets=observation.remaining;onObservation(observation);
 for(const row of targets)assert(same(row,proofs.find(proof=>proof.pid===row.pid)),'cleanup identity changed');
 if(targets.length)await stop([...targets].sort((a,b)=>a.parentPid===b.pid?1:b.parentPid===a.pid?-1:0));
 return observation;
}
const source=`using System;using System.IO;using System.Diagnostics;using System.Threading;
class ArcadeInert {
 static int Main(string[] args) {
  if (Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName).Equals("QQ.exe",StringComparison.OrdinalIgnoreCase)) { while(true) Thread.Sleep(1000); }
  if(args.Length!=3 || !File.Exists(args[0]) || !File.Exists(args[1])) return 2;
  var work=Environment.GetEnvironmentVariable("NAPCAT_WORKDIR");if(String.IsNullOrEmpty(work)||!Directory.Exists(work))return 3;
  var info=new ProcessStartInfo(args[0]);info.UseShellExecute=false;info.CreateNoWindow=true;info.WorkingDirectory=work;
  var child=Process.Start(info);File.WriteAllText(Path.Combine(work,"inert-owned.json"),"{\\"launcher\\":"+Process.GetCurrentProcess().Id+",\\"child\\":"+child.Id+"}");
  while(true) Thread.Sleep(1000);
 }
}`;
function prepare(config){
 const seed=managedRuntime(config),compiled=path.join(path.dirname(config.stateDir),'original-inert.exe'),sourcePath=path.join(path.dirname(config.stateDir),'original-inert.cs');fs.writeFileSync(sourcePath,source);
 const csc=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');assert(fs.existsSync(csc),'Windows framework compiler is required for actual process acceptance');execFileSync(csc,['/nologo','/target:winexe','/out:'+compiled,sourcePath],{windowsHide:true,stdio:'pipe'});
 fs.copyFileSync(compiled,seed.paths.qqExe);fs.copyFileSync(compiled,path.join(seed.paths.codeRoot,'NapCatWinBootMain.exe'));
 const files=[...REQUIRED,'static/index.html'].sort().map(p=>{const b=fs.readFileSync(path.join(seed.paths.codeRoot,p));return {path:p,size:b.length,sha256:hash(b)};}),manifestPath=path.join(path.dirname(seed.paths.codeRoot),'prepared.json'),manifest={schema:'qq_component_prepared_v1',component:'napcat-shell',version:'4.18.42',versionId:seed.descriptor.current.versionId,files},manifestBytes=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(manifestPath,manifestBytes);
 const descriptor=structuredClone(seed.descriptor),program=fs.readFileSync(seed.paths.qqExe);descriptor.qq.size=program.length;descriptor.qq.sha256=hash(program);descriptor.current.manifestSha256=hash(manifestBytes);fs.writeFileSync(path.join(descriptor.installationRoot,'installation.json'),JSON.stringify(descriptor));
 return {seed,descriptor};
}
function load(config,{detached=false}={}){
 const installationRoot=path.join(config.installation.componentStoreRoot,'qq-installations',config.installation.setupId),descriptorPath=path.join(installationRoot,'installation.json');
 const read=()=>{const bytes=fs.readFileSync(descriptorPath),d=JSON.parse(bytes);d.descriptorSha256=hash(bytes);return d;},descriptor=read(),codeRoot=path.join(config.installation.componentStoreRoot,'qq-component-versions','napcat-shell',descriptor.current.versionId,'code'),manifestPath=path.join(path.dirname(codeRoot),'prepared.json');
 const manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes),prepared={resolvePrepared:async()=>({version:'4.18.42',versionId:descriptor.current.versionId,codeRoot,manifestPath,manifestSha256:hash(manifestBytes),files:manifest.files})},host=createWindowsProcessHost();
 if(detached)host.start=plan=>new Promise((resolve,reject)=>{
  // Test-only Windows lifetime seam. Everything after spawn uses production
  // manager proof, native CIM observation, and held-handle termination.
  const checked=plan.beforeSpawn?.();if(checked?.then)return reject(Error('synchronous guard required'));
  const child=spawn(plan.file,plan.args,{cwd:plan.cwd,env:plan.env,windowsHide:true,shell:false,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({pid:child.pid});});child.once('exit',()=>plan.onExit?.());
 });
 const actualStart=host.start.bind(host);host.start=async plan=>{const result=await actualStart(plan),metadata=path.join(descriptor.workDir,'inert-process-proofs.json');const root=await host.inspect([result.pid]);assert.equal(root.length,1);assert.equal(root[0].parentPid,process.pid);fs.writeFileSync(metadata,JSON.stringify(root));const until=Date.now()+15000,ready=path.join(descriptor.workDir,'inert-owned.json');while(!fs.existsSync(ready)){if(Date.now()>until)throw Error('native child readiness timeout');await new Promise(r=>setTimeout(r,20));}const ids=JSON.parse(fs.readFileSync(ready));assert.equal(ids.launcher,result.pid);const rows=await host.inspect([ids.launcher,ids.child]);assert.equal(rows.length,2);assert.equal(rows.find(p=>p.pid===ids.child).parentPid,result.pid);fs.writeFileSync(metadata,JSON.stringify(rows));return result;};
 const manager=new QQRuntimeManager({root:path.join(config.stateDir,'runtime'),componentStoreRoot:config.installation.componentStoreRoot,lockRoot:config.installation.lockRoot,processHost:host,managedInstallation:read,componentSelectionFactory:o=>new QQComponentSelection({...o,prepared})});
 return {manager,host,descriptor,codeRoot,manifestPath,marker:path.join(descriptor.configDir,'napcat-update.json'),leasePath:manager._lockPath(config.expectedQQ),selection:manager.componentSelection()};
}
async function waitNative(r){
 const p=path.join(r.descriptor.workDir,'inert-owned.json'),until=Date.now()+15000;while(!fs.existsSync(p)){if(Date.now()>until)throw Error('inert child readiness timeout');await new Promise(resolve=>setTimeout(resolve,20));}
 const ids=JSON.parse(fs.readFileSync(p)),rows=await r.host.inspect([ids.launcher,ids.child]);assert.equal(rows.length,2);assert.equal(rows.find(x=>x.pid===ids.child).parentPid,ids.launcher);assert.equal(rows.find(x=>x.pid===ids.launcher).executable.toLowerCase(),path.join(r.codeRoot,'NapCatWinBootMain.exe').toLowerCase());assert.equal(rows.find(x=>x.pid===ids.child).executable.toLowerCase(),r.descriptor.qq.file.toLowerCase());return rows;
}
async function fixture(t,options={}){return fixtureGate.withFixture(t,scope=>buildFixture(scope,options));}
async function buildFixture(t,{detached=false}={}){
 const f=directories(t),{seed}=prepare(f.config);await seed.adapter.close();const r=load(f.config,{detached}),owned=new Map(),workers=[],managers=[r.manager],observer=createWindowsProcessHost(),evidence={detachedTestStart:detached,created:[],independentlyAbsent:[],foreignPreserved:[],managerExitCodes:[],cleanupAttempts:[]};let closed=false;
 const diagnosticFile=path.resolve(__dirname,'../../outputs',`qq-native-fixture-cleanup-${process.pid}-${randomUUID()}.json`);evidence.diagnosticFile=diagnosticFile;
 const remember=rows=>{for(const row of rows){assert(Number.isInteger(row.pid));owned.set(row.pid,row);if(!evidence.created.includes(row.pid))evidence.created.push(row.pid);}return rows;};
 const close=async()=>{if(closed)return;
  const attempt={number:evidence.cleanupAttempts.length+1,startedAt:new Date().toISOString(),phase:'read-recorded-proofs',recorded:[],finalObserved:null};evidence.cleanupAttempts.push(attempt);let failure=null;
  try{
  const captured=path.join(r.descriptor.workDir,'inert-process-proofs.json');if(fs.existsSync(captured)){const bytes=fs.readFileSync(captured);assert(bytes.length<=16384);const rows=JSON.parse(bytes);assert(Array.isArray(rows)&&rows.length<=2);for(const row of rows){assert([path.join(r.codeRoot,'NapCatWinBootMain.exe').toLowerCase(),r.descriptor.qq.file.toLowerCase()].includes(row.executable.toLowerCase()));assert(Number.isFinite(Date.parse(row.createdAt)));}remember(rows);}
  attempt.recorded=[...owned.values()].map(row=>({...row}));attempt.phase='close-workers';
  for(const w of workers)if(w.child.exitCode===null){const row=(await observer.inspect([w.child.pid]))[0];if(row&&same(row,w.proof))await observer.stop([row]);await w.exited;}
  // Cleanup only recorded exact private children; never scan/kill by executable name.
  attempt.phase='inspect-before-observer-stop';const rows=owned.size?await observer.inspect([...owned.keys()]):[];attempt.observedBeforeStop=rows.map(row=>({...row}));await stopRecordedCleanup([...owned.values()],rows,async targets=>{attempt.phase='observer-stop';await observer.stop(targets);},observation=>{attempt.preStopIdentityObservation=observation;});
  attempt.phase='close-managers';attempt.managerResults=[];for(const manager of managers){const result=await manager.close();attempt.managerResults.push(result);assert.equal(result.closed,true,'manager cleanup must be confirmed');}
  if(owned.size){attempt.phase='inspect-final-identities';const after=await observer.inspect([...owned.keys()]);attempt.finalObserved=after.map(row=>({...row}));const observation=classifyRecordedAbsence([...owned.values()],after);attempt.finalIdentityObservation=observation;assert.equal(observation.remaining.length,0,'recorded native identity still present');evidence.independentlyAbsent=observation.absent.map(row=>row.pid);}closed=true;attempt.phase='confirmed';attempt.status='passed';
  }catch(error){failure=error;attempt.status='failed';attempt.error={name:error.name,code:error.code||null,message:error.message,stack:error.stack};throw error;}
  finally{attempt.finishedAt=new Date().toISOString();try{fs.mkdirSync(path.dirname(diagnosticFile),{recursive:true});fs.writeFileSync(diagnosticFile,JSON.stringify({schema:'native-fixture-cleanup-observations/1',fixtureRoot:f.dir,closed,evidence},null,2)+'\n');}catch(error){evidence.diagnosticError={code:error.code||null,message:error.message};if(!failure)throw error;}}
 };f.cleanup.push(close);
 return {...f,...r,observer,evidence,remember,close,async start(){await r.manager.start(f.config.expectedQQ);const rows=remember(await waitNative(r));await r.manager.discover();return rows;},reload(config=f.config){const next=load(config);managers.push(next.manager);return next;},async worker(){
  const file=path.join(f.dir,'owner-worker-config.json');fs.writeFileSync(file,JSON.stringify(f.config));const child=spawn(process.execPath,[path.join(__dirname,'qq-shell-owner-live-worker.cjs'),file,detached?'detached':'default'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let error='';child.stderr.on('data',b=>error+=b);const exited=new Promise(resolve=>child.once('close',code=>resolve(code))),w={child,exited,proof:null};workers.push(w);const readiness=new Promise((resolve,reject)=>{let bytes='';const timer=setTimeout(()=>reject(Error('manager ready timeout')),45000);child.stdout.on('data',b=>{bytes+=b;if(bytes.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(bytes.split('\n')[0]));}catch(e){reject(e);}}});child.once('error',reject);child.once('close',()=>{clearTimeout(timer);reject(Error('manager exited before ready: '+error));});});
  readiness.catch(()=>{});const proof=(await observer.inspect([child.pid]))[0];assert(proof);w.proof=proof;remember([proof]);const ready=await readiness;remember(ready.rows);Object.assign(w,{ready,async crash(){child.stdin.write('crash\n');const code=await exited;assert.equal(code,86);assert.equal((await observer.inspect([child.pid])).length,0);evidence.managerExitCodes.push(code);return code;}});return w;
 },createOtherInstallation(){
  const config=structuredClone(f.config);config.installation.setupId=randomUUID();const d=structuredClone(r.descriptor),root=path.join(config.installation.componentStoreRoot,'qq-installations',config.installation.setupId);Object.assign(d,{setupId:config.installation.setupId,installationRoot:root,installationId:hash(root.toLowerCase()),workDir:path.join(root,'work'),configDir:path.join(root,'work','config'),qqDataDir:path.join(root,'qq-data')});for(const dir of [d.configDir,d.qqDataDir])fs.mkdirSync(dir,{recursive:true});fs.copyFileSync(path.join(r.descriptor.configDir,`onebot11_${config.expectedQQ}.json`),path.join(d.configDir,`onebot11_${config.expectedQQ}.json`));fs.writeFileSync(path.join(d.qqDataDir,'sentinel'),'OTHER_DATA_UNCHANGED');fs.writeFileSync(path.join(root,'installation.json'),JSON.stringify(d));return config;
 },addMarker(){const bytes=Buffer.from('SYNTHETIC_UPDATE_MARKER\0do not interpret');fs.writeFileSync(r.marker,bytes);return bytes;},addDeadComponentLock(proof){const bytes=Buffer.from(JSON.stringify({schema:'qq_component_lock_v2',installationId:r.selection.installationId,owner:{pid:proof.pid,createdAt:proof.createdAt,executable:proof.executable},token:randomUUID(),at:new Date().toISOString()}));fs.writeFileSync(r.selection.lockFile,bytes);return bytes;}};
}
module.exports={fixture,load,waitNative,hash,same,classifyRecordedAbsence,stopRecordedCleanup};
