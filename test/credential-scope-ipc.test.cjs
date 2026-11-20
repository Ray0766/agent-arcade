'use strict';
// Actual main handlers and production account/service storage in fresh temp
// directories. Synthetic encryption only; no live vault, login or network.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const fields=['key','qqToken','qqOfficialSecret','feishuAppSecret','xAccessToken','messengerPageAccessToken','messengerRelayToken'];
const changed={code:'credential_scope_changed'},synthetic='synthetic-credential-scope-value-with-32chars';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-credential-scope-')),handlers=new Map();let encryptions=0;
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>{encryptions++;return Buffer.from(s);},decryptString:b=>b.toString()};
  const manager=new AccountManager({root,vault}),first=manager.current(),second=manager.add({name:'Synthetic second'}),otherId=manager.selectedId;manager.select('primary');
  const contents={mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  const line=name=>{const value=source.split('\n').find(v=>v.trimStart().startsWith(`register('${name}',`));assert(value,name);return value;};
  vm.runInNewContext(source+`\nmodule.exports={setup:(m,c)=>{accounts=m;bot=m.current();win={webContents:c};publish=()=>{};fullSnapshot=()=>({selectedId:accounts.selectedId});},select:id=>{bot=accounts.select(id);},setBot:s=>{bot=s;},holdClose:p=>{closeVoice=()=>p;},bind:()=>{${['botConfigure','botForget','accountSelect','accountRetryCredentials','accountResetCredentials'].map(line).join('\n')}}};`,context,{filename:main});
  const api=context.module.exports;api.setup(manager,contents);api.bind();const event={sender:contents,senderFrame:contents.mainFrame};
  t.after(async()=>{await manager.close();assert(root.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,manager,first,second,otherId,api,event,encryptions:()=>encryptions,scope:()=>({profileId:manager.selectedId,expectedMode:manager.current().config.mode||'api',expectedChannel:manager.current().config.channel||'wechat'}),invoke:(name,value,e=event)=>handlers.get(`arcade:${name}`)(e,value)};
}
test('each credential own-property requires profile scope even when empty, null or undefined',async t=>{
  const f=fixture(t);for(const field of fields)for(const value of [undefined,null,'',synthetic])await assert.rejects(f.invoke('botConfigure',{[field]:value}),changed);
  assert.equal(f.encryptions(),0);assert.deepEqual(f.first.secret,{});assert.deepEqual(f.second.secret,{});
});
test('invalid requests and foreign or missing registered scopes fail before encryption',async t=>{
  const f=fixture(t);for(const value of [undefined,null,[],new Date(),synthetic,{}, {profileId:f.otherId},{profileId:'missing'},{profileId:7}]){
    const patch=value&&Object.prototype.toString.call(value)==='[object Object]'?{...value,key:synthetic,expectedMode:'api'}:value;
    await assert.rejects(f.invoke('botConfigure',patch),changed);
  }assert.equal(f.encryptions(),0);
});
test('all fixed credential fields save only to the exact service and scope metadata is stripped',async t=>{
  const f=fixture(t);const result=await f.invoke('botConfigure',{...f.scope(),key:synthetic,qqToken:synthetic,qqOfficialSecret:synthetic,feishuAppSecret:synthetic,xAccessToken:synthetic,messengerPageAccessToken:synthetic,messengerRelayToken:synthetic});
  assert.equal(f.encryptions(),1);assert.equal(result.hasKey,true);assert.equal(f.first.secret.key,synthetic);assert.deepEqual(f.second.secret,{});
  const config=JSON.parse(fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8'));for(const name of ['profileId','expectedMode','expectedChannel'])assert.equal(Object.hasOwn(config,name),false);
  assert(!JSON.stringify(result).includes(synthetic));
});
test('queued selection changes the active service before cleanup finishes, and old scoped saves cannot reach it',async t=>{
  const f=fixture(t),old=f.scope(),gate=deferred();f.api.holdClose(gate.promise);const switching=f.invoke('accountSelect',f.otherId);
  try{assert.equal(f.manager.selectedId,f.otherId);await assert.rejects(f.invoke('botConfigure',{...old,key:synthetic}),changed);assert.equal(f.encryptions(),0);assert.deepEqual(f.second.secret,{});}finally{gate.resolve();await switching;}
});
test('a save already handled before selection remains committed to its original service',async t=>{
  const f=fixture(t),saved=f.invoke('botConfigure',{...f.scope(),key:synthetic});f.api.select(f.otherId);assert.equal((await saved).hasKey,true);assert.equal(f.first.secret.key,synthetic);assert.deepEqual(f.second.secret,{});
});
test('same-profile backend changes reject the old key instead of writing the new provider slot',async t=>{
  const f=fixture(t),old=f.scope();await f.invoke('botConfigure',{mode:'gpt'});await assert.rejects(f.invoke('botConfigure',{...old,key:synthetic}),changed);assert.equal(f.encryptions(),0);assert.deepEqual(f.first.secret,{});
  await f.invoke('botConfigure',{...f.scope(),key:synthetic});assert.equal(f.first.secret.openaiKey,synthetic);assert.equal(f.first.secret.key,undefined);
});
test('same-profile channel changes reject every stale channel secret',async t=>{
  const f=fixture(t),old=f.scope();await f.invoke('botConfigure',{channel:'qq'});for(const field of fields.slice(1))await assert.rejects(f.invoke('botConfigure',{...old,[field]:synthetic}),changed);assert.equal(f.encryptions(),0);
});
test('required backend/channel scope and every supplied scope are checked, including mixed-mode key requests',async t=>{
  const f=fixture(t);for(const patch of [{profileId:'primary',key:synthetic},{profileId:'primary',qqToken:synthetic},{...f.scope(),key:synthetic,mode:'gpt'},{...f.scope(),expectedMode:'gpt',qqToken:synthetic},{...f.scope(),expectedChannel:'qq',key:synthetic},{profileId:f.otherId,mode:'gpt'}])await assert.rejects(f.invoke('botConfigure',patch),changed);
  assert.equal(f.encryptions(),0);await f.invoke('botConfigure',{mode:'gpt'});assert.equal(f.first.config.mode,'gpt');
});
test('selected ID alone cannot authorize a replaced service object',async t=>{
  const f=fixture(t),scope=f.scope();f.api.setBot(f.second);await assert.rejects(f.invoke('botConfigure',{...scope,key:synthetic}),changed);await assert.rejects(f.invoke('botForget',{profileId:'primary'}),changed);assert.equal(f.encryptions(),0);
});
test('forget requires one exact profile field and preserves another profile after a queued selection',async t=>{
  const f=fixture(t);f.first.configure({key:synthetic});f.second.configure({key:synthetic+'-other'});const before=fs.readFileSync(f.second.file);
  for(const value of [undefined,null,{},[],{profileId:'primary',key:synthetic},{profileId:f.otherId}])await assert.rejects(f.invoke('botForget',value),changed);
  f.api.select(f.otherId);await assert.rejects(f.invoke('botForget',{profileId:'primary'}),changed);assert.deepEqual(fs.readFileSync(f.second.file),before);assert.equal(f.first.secret.key,synthetic);
});
test('in-flight forget retains its captured service and returns its own snapshot after selection',async t=>{
  const f=fixture(t),gate=deferred();f.first.configure({key:synthetic});f.second.configure({key:synthetic+'-other'});const before=fs.readFileSync(f.second.file),original=f.first.disconnect.bind(f.first);
  f.first.disconnect=async()=>{await gate.promise;return original();};const pending=f.invoke('botForget',{profileId:'primary'});f.api.select(f.otherId);
  gate.resolve();const result=await pending;assert.equal(result.hasKey,false);assert.equal(f.second.snapshot().hasKey,true);assert.deepEqual(fs.readFileSync(f.second.file),before);assert(!fs.existsSync(f.first.file));
});
test('a second disconnect cannot reopen credential editing while the original forget still owns cleanup',async t=>{
  const f=fixture(t),gate=deferred();f.first.configure({key:synthetic});f.first.friendRequests={close:()=>gate.promise};
  const forgetting=f.invoke('botForget',{profileId:'primary'});
  try{
    await f.first.disconnect();assert.equal(f.first.status,'disconnected');
    const encrypted=f.encryptions();await assert.rejects(f.invoke('botConfigure',{...f.scope(),key:synthetic+'-replacement'}),{code:'credentials_busy'});
    await assert.rejects(f.invoke('botForget',{profileId:'primary'}),{code:'credentials_busy'});assert.equal(f.encryptions(),encrypted);
    f.api.select(f.otherId);await f.invoke('botConfigure',{...f.scope(),key:synthetic+'-other'});assert.equal(f.second.snapshot().hasKey,true);
  }finally{gate.resolve();await forgetting;}
  f.api.select('primary');await f.invoke('botConfigure',{...f.scope(),key:synthetic+'-after'});assert.equal(f.first.secret.key,synthetic+'-after');
});
test('trusted sender guard precedes credential scope validation and fixed failures never echo secrets',async t=>{
  const f=fixture(t);await assert.rejects(f.invoke('botConfigure',{...f.scope(),key:synthetic},{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);
  await assert.rejects(f.invoke('botConfigure',{profileId:f.otherId,key:synthetic}),e=>e.code==='credential_scope_changed'&&!e.message.includes(synthetic)&&/Reopen/.test(e.message));assert.equal(f.encryptions(),0);
});
test('preload forwards the explicit forgetting scope without inventing one',async()=>{
  let api;const calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);}}})});
  const scope={profileId:'primary'};api.botForget(scope);assert.deepEqual(calls,[['arcade:botForget',scope]]);
});


test('credential recovery IPC requires exact profile/backend/channel before any recovery action',async t=>{
 const f=fixture(t);let attempts=0;
 f.first.retryCredentials=async()=>{attempts++;return {recovered:false};};
 f.first.prepareCredentialReset=()=>{attempts++;return {prepared:false};};
 for(const value of [undefined,null,{},[],{profileId:'primary'},{...f.scope(),profileId:f.otherId},{...f.scope(),expectedMode:'gpt'},{...f.scope(),expectedChannel:'qq'},{...f.scope(),key:'not-allowed'}]){
  await assert.rejects(f.invoke('accountRetryCredentials',value),changed);
  const reset=value&&typeof value==='object'&&!Array.isArray(value)?{...value,action:'prepare'}:value;
  await assert.rejects(f.invoke('accountResetCredentials',reset),changed);
 }
 assert.equal(attempts,0);
 await f.invoke('accountRetryCredentials',f.scope());await f.invoke('accountResetCredentials',{...f.scope(),action:'prepare'});assert.equal(attempts,2);
});
test('a pending recovery observes selection changes and cannot unlock the replacement profile',async t=>{
 const f=fixture(t),gate=deferred();let allowed;
 f.first.retryCredentials=async({isCurrent})=>{await gate.promise;allowed=isCurrent();return {recovered:allowed};};
 const pending=f.invoke('accountRetryCredentials',f.scope());f.api.select(f.otherId);gate.resolve();
 assert.equal((await pending).recovered,false);assert.equal(allowed,false);
 assert.deepEqual(f.second.secret,{});
});
