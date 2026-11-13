'use strict';
// Actual main/preload boundary with an isolated registry and a synthetic remote.
// No existing vault, QQ account, TLS destination or model is contacted.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const sessionModule=require('../src/bot/qq-remote-session.cjs');
const transferModule=require('../src/bot/qq-transfer-session.cjs'),{randomUUID}=require('node:crypto');
const {caPem}=require('./helpers/qq-remote-tls-fixture.cjs');
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hold=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
async function until(fn){const end=Date.now()+3000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('synthetic wait exceeded');}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-remote-main-')),handlers=new Map(),events={};
 const state={visible:true,minimized:false,picker:null,picks:0,auths:0,reads:0,mutations:0,readGate:null,proofs:0,proofGate:null,helperReads:0,helperLists:0,helperGate:null,dialogOptions:null,network:{host:'0.0.0.0',port:6099,loginRate:10,disableWebUI:false,accessControlMode:'none',ipWhitelist:[],ipBlacklist:[],enableXForwardedFor:false}};
 const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(b=>b^0x5a),decryptString:value=>Buffer.from(value).map(b=>b^0x5a).toString()};
 const services=new Map([['first',{generation:1}],['second',{generation:1}]]);for(const service of services.values())Object.defineProperty(service,'secret',{get(){throw Error('remote management must not read companion credentials');}});
 const accounts={selectedId:'first',get(id){if(!services.has(id))throw Error('missing');return services.get(id);},snapshot:()=>({accounts:[]})};
 const win={id:1,isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>false,on:(name,fn)=>{events[name]=fn;},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(){}}};
 class BoundSession extends sessionModule.QQRemoteSession{constructor(options){super({...options,clientFactory:entry=>({async authenticate(options){options.assertCurrent();state.auths++;return {authenticated:true};},async read(options){state.reads++;await state.readGate?.promise;options.assertCurrent();return {actualQQ:entry.expectedQQ,identity:'matched',version:'4.18.42',network:structuredClone(state.network),twoFactor:{enabled:false,hasSecret:false}};},async fileIdentity(options){state.proofs++;await state.proofGate?.promise;options.assertCurrent();return {actualQQ:entry.expectedQQ,identity:'matched',version:'4.18.42'};},async mutate(op,value,options){options.assertCurrent();options.onAttempt?.();state.mutations++;if(op==='network')state.network={...state.network,...value.patch};return {submission:'submitted',bridgeResponse:'received',outcome:'acknowledged'};},generate2FA(){throw Error('not used');},close(){}})});}}
 class BoundTransfer extends transferModule.QQTransferSession{constructor(options){super({...options,clientFactory:entry=>({async capabilities(o){o.assertCurrent();state.helperReads++;return {instanceId:entry.instanceId};},async roots(o){o.assertCurrent();state.helperReads++;return [{rootId:'shared',label:'Shared files',read:true,upload:true}];},async list(_input,o){o.assertCurrent();state.helperLists++;await state.helperGate?.promise;o.assertCurrent();return {directory:{directoryId:randomUUID(),rootId:'shared',name:'Shared files',parentId:null},entries:[]};},async close(){return {closed:true};}})});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{AGENT_ARCADE_HOME:root,LOCALAPPDATA:root}},URL,AbortController,structuredClone,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},safeStorage:vault,ipcMain:{handle(name,fn){handlers.set(name,fn);}},dialog:{async showOpenDialog(_owner,options){state.picks++;state.dialogOptions=options;return state.picker?state.picker.promise:{canceled:true,filePaths:[]};}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-remote-session.cjs'?{...sessionModule,QQRemoteSession:BoundSession}:id==='./bot/qq-transfer-session.cjs'?{...transferModule,QQTransferSession:BoundTransfer}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closeRemoteManagement'));
 vm.runInNewContext(source+`\nmodule.exports={setup:(a,w)=>{accounts=a;win=w;initializeRemoteManagement();${hide}},registerRemoteHandlers,closeRemoteManagement,fullSnapshot,observe:()=>{remotePanel.observe();transferPanel.observe();},panel:()=>remotePanel,transfer:()=>transferPanel};`,context,{filename:main});
 const api=context.module.exports;api.setup(accounts,win);api.registerRemoteHandlers();const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const invoke=(name,value={panelId:PANEL},ev=event)=>handlers.get('arcade:qqRemote'+name)(ev,value);
 const transfer=(name,value,ev=event)=>handlers.get('arcade:qqTransfer'+name)(ev,value);
 t.after(async()=>{state.picker?.resolve({canceled:true,filePaths:[]});state.readGate?.resolve();state.proofGate?.resolve();state.helperGate?.resolve();await api.closeRemoteManagement({permanent:true});fs.rmSync(root,{recursive:true,force:true});});
 return {root,handlers,events,state,services,accounts,win,event,api,invoke,transfer};
}
const registration=()=>({label:'Synthetic server',origin:'https://remote.arcade.invalid/',expectedQQ:'1000001',token:'synthetic-admin-token-1',trust:{},associatedProfileId:null});
async function add(f){assert.equal((await f.invoke('List')).ok,true);const result=await f.invoke('Create',{panelId:PANEL,value:registration()});assert.equal(result.ok,true,JSON.stringify(result));return {...result.registration,panelId:PANEL};}
const base=row=>({panelId:row.panelId,remoteId:row.remoteId});

test('actual remote IPC registration retains secrets only in the independent encrypted container',async t=>{
 const f=fixture(t),row=await add(f);assert.equal(f.state.auths,0);assert.equal(f.state.reads,0);assert.equal(f.state.mutations,0);
 assert.doesNotMatch(JSON.stringify(row),/synthetic-admin-token|caPem/);assert.equal(fs.existsSync(path.join(f.root,'bot-vault.json')),false);
 assert.doesNotMatch(fs.readFileSync(path.join(f.root,'qq-remote-registry.json'),'utf8'),/synthetic-admin-token|remote\.arcade/);
 assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/remote\.arcade|synthetic-admin-token|1000001/);
 await assert.rejects(f.invoke('List',{panelId:PANEL},{sender:{},senderFrame:{}}),/Untrusted sender/);
});
test('all fixed remote and optional-helper IPC methods are present in the actual preload',t=>{
 const f=fixture(t),preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');
 assert.equal([...f.handlers.keys()].filter(k=>k.startsWith('arcade:qqRemote')).length,37);
 assert.equal([...f.handlers.keys()].filter(k=>k.startsWith('arcade:qqTransfer')&&!k.startsWith('arcade:qqTransferLocal')).length,17);
 assert.equal([...f.handlers.keys()].filter(k=>k.startsWith('arcade:qqTransferLocal')).length,8);
 const supervisor=['List','Create','Forget','PickCA','Read','Preview','Confirm','RecoveryRead','RecoveryPreview','RecoveryConfirm','LockRead','LockPreview','LockConfirm','NativePasskeyRead','NativePasskeyPreview','NativePasskeyConfirm','OrphanRead','OrphanPreview','OrphanConfirm','OrphanDiscard','ComponentRepairRead','ComponentRepairPreview','ComponentRepairConfirm','ComponentRepairDiscard','ProfileBackupRead','ProfileBackupPreview','ProfileBackupConfirm','Query','EndRecovery','Dismiss','Close'].map(name=>'arcade:qqSupervisor'+name);
 assert.deepEqual([...f.handlers.keys()].filter(k=>k.startsWith('arcade:qqSupervisor')).sort(),supervisor.sort());
 assert.equal(f.handlers.size,93);
 for(const key of f.handlers.keys())assert(preload.includes(`'${key}'`),key);
});
test('explicit remote read and exact network preview/confirm do not connect companion AI',async t=>{
 const f=fixture(t),row=await add(f),read=await f.invoke('Read',base(row));assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.profile.identity,'matched');
 const preview=await f.invoke('Preview',{...base(row),observationId:read.profile.observationId,operation:'network',value:{patch:{loginRate:12}}});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(f.state.mutations,0);
 const change=await f.invoke('Confirm',{...base(row),ticketId:preview.preview.ticketId,expectedDigest:preview.preview.expectedDigest});assert.equal(change.ok,true,JSON.stringify(change));assert.equal(change.change.outcome,'acknowledged');assert.equal(change.change.persistenceVerified,false);assert.equal(f.state.mutations,1);
 assert.equal((await f.invoke('Confirm',{...base(row),ticketId:preview.preview.ticketId,expectedDigest:preview.preview.expectedDigest})).ok,false);assert.equal(f.state.mutations,1);
});
test('invalid arbitrary routes and paths leave the current registry intact',async t=>{const f=fixture(t),row=await add(f);assert.equal((await f.invoke('Read',{...base(row),url:'https://another.invalid'})).ok,false);assert.equal((await f.invoke('Create',{panelId:PANEL,value:{...registration(),certPath:'C:\\synthetic.pem'}})).ok,false);assert.equal(f.api.panel().registry.list().items.length,1);assert.equal(f.state.auths,0);});
test('selected-profile change invalidates a delayed remote read before any mutation',async t=>{const f=fixture(t),row=await add(f);f.state.readGate=hold();const pending=f.invoke('Read',base(row));await until(()=>f.state.reads===1);f.accounts.selectedId='second';f.api.observe();f.state.readGate.resolve();assert.equal((await pending).ok,false);assert.equal(f.state.mutations,0);});
test('hide immediately retires previews and stale close cannot retire another registry panel',async t=>{const f=fixture(t),row=await add(f);assert.equal((await f.invoke('Read',base(row))).ok,true);await f.invoke('List',{panelId:NEXT});await f.invoke('RegistryClose',{panelId:PANEL});assert.equal(f.api.panel().panel.panelId,NEXT);f.state.visible=false;f.events.hide();assert.equal(f.api.panel().panel,null);assert.equal((await f.invoke('Read',{...base(row),panelId:NEXT})).ok,false);});
test('native CA pick result is scoped and does not return file contents or paths',async t=>{const f=fixture(t);await f.invoke('List');const file=path.join(f.root,'synthetic-ca.pem');fs.writeFileSync(file,caPem);f.state.picker=hold();const pending=f.invoke('PickCA');await until(()=>f.state.picks===1);f.state.picker.resolve({canceled:false,filePaths:[file]});const result=await pending;assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.ca.subject,/SYNTHETIC/);assert.doesNotMatch(JSON.stringify(result),/BEGIN CERTIFICATE|synthetic-ca\.pem/);});
test('closing native selection blocks the late file result without reading its path',async t=>{const f=fixture(t);await f.invoke('List');f.state.picker=hold();const pending=f.invoke('PickCA');await until(()=>f.state.picks===1);const closing=f.invoke('RegistryClose');f.state.picker.resolve({canceled:false,filePaths:[path.join(f.root,'never-read.pem')]});assert.equal((await pending).ok,false);await closing;assert.equal(f.api.panel().ca,null);});

const helperValue=()=>({label:'Synthetic optional helper',origin:'https://transfer.example',instanceId:randomUUID(),token:'synthetic-helper-token-never-real-0000000000000001',trust:{}});
async function helper(f,{read=true}={}){const row=await add(f);if(read)assert.equal((await f.invoke('Read',base(row))).ok,true);assert.equal((await f.transfer('Settings',base(row))).ok,true);const r=await f.transfer('Create',{...base(row),value:helperValue()});assert.equal(r.ok,true,JSON.stringify(r));return {row,link:r.link,B:{...base(row),helperId:r.link.helperId}};}
test('actual main helper settings save locally, preserve hidden keys and never inspect AI credentials',async t=>{
 const f=fixture(t),h=await helper(f,{read:false});assert.equal(f.state.auths,0);assert.equal(f.state.helperReads,0);const original=f.api.transfer().links.capture(h.link.helperId).token;
 const changed=await f.transfer('Update',{...h.B,revision:h.link.revision,patch:{label:'Updated helper'}});assert.equal(changed.ok,true,JSON.stringify(changed));assert.equal(f.api.transfer().links.capture(h.link.helperId).token,original);assert.doesNotMatch(JSON.stringify(await f.transfer('Settings',base(h.row))),/synthetic-helper-token|caPem/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/transfer\.example|synthetic-helper-token/);assert.doesNotMatch(fs.readFileSync(path.join(f.root,'qq-transfer-links.json'),'utf8'),/transfer\.example|synthetic-helper-token/);
});
test('actual main explicit helper open reuses parent authentication and requires fresh proof',async t=>{
 const f=fixture(t),h=await helper(f);const r=await f.transfer('Open',{...h.B,revision:h.link.revision});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.roots[0].rootId,'shared');assert.equal(f.state.auths,1);assert.equal(f.state.proofs,1);assert.equal(f.state.helperReads,2);assert.equal(f.state.mutations,0);
 const invalid=await f.transfer('Open',{...h.B,revision:h.link.revision,url:'https://untrusted.example'});assert.equal(invalid.ok,false);assert.equal(f.state.helperReads,2);
 await assert.rejects(f.transfer('Settings',base(h.row),{sender:{},senderFrame:{}}),/Untrusted sender/);
});
test('actual main refuses an unopened parent before any helper request',async t=>{const f=fixture(t),h=await helper(f,{read:false});const r=await f.transfer('Open',{...h.B,revision:h.link.revision});assert.equal(r.ok,false);assert.equal(f.state.auths,0);assert.equal(f.state.proofs,0);assert.equal(f.state.helperReads,0);});
test('actual main helper picker is single-file and cancelling retains the parent session',async t=>{
 const f=fixture(t),h=await helper(f),r=await f.transfer('Open',{...h.B,revision:h.link.revision});assert.equal(r.ok,true,JSON.stringify(r));const picked=await f.transfer('PickUpload',{...h.B,viewId:r.viewId,operationId:randomUUID()});assert.equal(picked.ok,true,JSON.stringify(picked));assert.equal(picked.cancelled,true);assert.equal(f.state.dialogOptions.properties.includes('multiSelections'),false);const closed=await f.transfer('Close',base(h.row));assert.equal(closed.ok,true);assert.equal(f.api.panel().session.remoteId,h.row.remoteId);assert.equal(f.state.auths,1);
});
test('actual main parent close cancels an in-flight child proof before helper connection',async t=>{
 const f=fixture(t),h=await helper(f);f.state.proofGate=hold();const opening=f.transfer('Open',{...h.B,revision:h.link.revision});await until(()=>f.state.proofs===1);const closing=f.invoke('RegistryClose',{panelId:PANEL});f.state.proofGate.resolve();assert.equal((await opening).ok,false);assert.equal((await closing).ok,true);assert.equal(f.state.helperReads,0);assert.equal(f.api.transfer().panel,null);assert.equal(f.api.panel().panel,null);
});
test('same-panel parent reread settles the child first and discards its late helper result',async t=>{
 const f=fixture(t),h=await helper(f),opened=await f.transfer('Open',{...h.B,revision:h.link.revision}),parent=f.api.panel().session.session;
 f.state.helperGate=hold();const listing=f.transfer('List',{...h.B,viewId:opened.viewId,rootId:'shared',directoryId:null,operationId:randomUUID()});await until(()=>f.state.helperLists===1);
 const reading=f.invoke('Read',base(h.row));f.state.helperGate.resolve();assert.equal((await listing).ok,false);assert.equal((await reading).ok,true);assert.notEqual(f.api.panel().session.session,parent);assert.equal(f.api.transfer().session.view,null);assert.equal(f.state.helperLists,1);assert.equal(f.state.mutations,0);
});
test('actual parent session/client generation invalidates child binding even without registry changes',async t=>{
 const f=fixture(t),h=await helper(f);await f.transfer('Open',{...h.B,revision:h.link.revision});const child=f.api.transfer().session.view,revision=f.api.panel().registry.capture(h.row.remoteId).revision;
 assert.equal((await f.invoke('Read',{...base(h.row),url:'https://invalid.example'})).ok,false);assert.equal(f.api.transfer().session.view,child);
 await f.api.panel().session.read(base(h.row));assert.equal(f.api.panel().registry.capture(h.row.remoteId).revision,revision);assert.throws(()=>f.api.transfer().session._assert(child));assert.equal(f.state.helperReads,2);
});
test('late close for another remote does not retire the active helper in the same panel',async t=>{
 const f=fixture(t),h=await helper(f);await f.transfer('Open',{...h.B,revision:h.link.revision});const child=f.api.transfer().session.view;
 assert.equal((await f.invoke('Close',{panelId:PANEL,remoteId:randomUUID()})).ok,true);assert.equal(f.api.transfer().session.view,child);assert.equal(f.api.transfer().panel.remoteId,h.row.remoteId);f.api.transfer().session._assert(child);
});
function completedRecord(f,h,{remoteId=h.B.remoteId,state='completed',cleanupPending=false}={}){
 const target=path.join(f.root,'retained-completed-output.txt');fs.writeFileSync(target,'done');
 return f.api.transfer().jobs.create({jobId:randomUUID(),kind:'download',name:'retained-completed-output.txt',state,scope:{remoteId,remoteRevision:h.link.remoteRevision,helperId:h.link.helperId,helperRevision:h.link.revision,origin:h.link.origin,instanceId:h.link.instanceId,rootId:'shared',trustRevision:h.link.trustRevision,credentialRevision:h.link.credentialRevision},totalBytes:4,completedBytes:4,sha256:'a'.repeat(64),archive:false,published:false,saved:true,cleanupPending,source:{entryIds:[]},target:{target},remote:null,pending:null,expiresAt:Date.now()+86400000,code:null});
}
test('actual main removes only selected completed metadata while retaining files and helper credentials',{skip:require('./helpers/platform-skip.cjs').ownedIpcSkip()},async t=>{
 const f=fixture(t),h=await helper(f,{read:false}),j=completedRecord(f,h),before=fs.readFileSync(path.join(f.root,'qq-transfer-links.json'));const result=await f.transfer('ForgetJob',{...base(h.row),jobId:j.jobId});assert.deepEqual(result,{ok:true,...base(h.row),forgotten:true,jobId:j.jobId});assert.equal(f.api.transfer().jobs.list().length,0);assert.equal(fs.readFileSync(j.target.target,'utf8'),'done');assert.deepEqual(fs.readFileSync(path.join(f.root,'qq-transfer-links.json')),before);assert.equal(f.state.helperReads,0);assert.equal(f.state.auths,0);
});
test('actual main cannot forget another remote or an uncertain/unclosed job',async t=>{
 const f=fixture(t),h=await helper(f,{read:false});for(const v of [{remoteId:randomUUID()},{state:'reconcile_required'},{cleanupPending:true}]){const j=completedRecord(f,h,v);assert.equal((await f.transfer('ForgetJob',{...base(h.row),jobId:j.jobId})).ok,false);assert.equal(f.api.transfer().jobs.get(j.jobId).jobId,j.jobId);}assert.equal(f.api.transfer().jobs.list().length,3);assert.equal(f.state.helperReads,0);
});
