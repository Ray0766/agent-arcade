'use strict';
// Executes the actual trusted main handler source. No UI, auth flow or model call.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {BotService}=require('../src/bot/service.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const vault={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-provider-ipc-')),service=new BotService({root,vault}),handlers=new Map(),opened=[];
  const contents={mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},shell:{openExternal:async url=>{opened.push(url);}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  const start=source.indexOf("    register('providerGuide',"),end=source.indexOf("    register('socialConfigure',",start);assert(start>=0&&end>start);
  vm.runInNewContext(source+`\nmodule.exports={setup:(service,contents)=>{bot=service;accounts={selectedId:'primary',get:id=>id==='primary'?service:null};win={webContents:contents};},bind:()=>{${source.slice(start,end)}}};`,context,{filename:main});
  context.module.exports.setup(service,contents);context.module.exports.bind();const event={sender:contents,senderFrame:contents.mainFrame};
  t.after(async()=>{await service.disconnect();assert(root.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,service,handlers,opened,event,invoke:(name,value,eventOverride=event)=>handlers.get(`arcade:${name}`)(eventOverride,name==='botConfigure'?{profileId:'primary',expectedMode:service.config.mode||'api',expectedChannel:service.config.channel||'wechat',...value}:value)};
}
test('new API guide routes only fixed official pages, never a renderer-provided URL',async t=>{
  const f=fixture(t);await f.invoke('providerGuide','gemini');await f.invoke('providerGuide','doubao');assert.deepEqual(f.opened,['https://aistudio.google.com/apikey','https://console.volcengine.com/ark/']);
  for(const input of ['https://untrusted.invalid','gemini?token=x',{},null])await assert.rejects(f.invoke('providerGuide',input),/available/);assert.equal(f.opened.length,2);
});
test('trusted configure IPC saves separate new provider keys and exposes only readiness',async t=>{
  const f=fixture(t);await f.invoke('botConfigure',{mode:'gemini'});const first=await f.invoke('botConfigure',{mode:'gemini',key:'synthetic-gemini-ipc-key',geminiModel:'gemini-3.6-flash'});assert.equal(first.hasKey,true);assert.equal(first.mode,'gemini');assert.equal(first.geminiModel,'gemini-3.6-flash');assert(!JSON.stringify(first).includes('synthetic-gemini-ipc-key'));
  await f.invoke('botConfigure',{mode:'doubao'});const second=await f.invoke('botConfigure',{mode:'doubao',key:'synthetic-doubao-ipc-key'});assert.equal(second.hasKey,true);assert.equal(f.service.secret.geminiKey,'synthetic-gemini-ipc-key');assert.equal(f.service.secret.doubaoKey,'synthetic-doubao-ipc-key');assert(!JSON.stringify(second).includes('synthetic-doubao-ipc-key'));
  await assert.rejects(f.invoke('botConfigure',{mode:'gemini',key:'synthetic-foreign-key'},{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);assert.equal(f.service.secret.geminiKey,'synthetic-gemini-ipc-key');
});
test('unsupported provider model cannot overwrite a prior vault through IPC',async t=>{
  const f=fixture(t);await f.invoke('botConfigure',{mode:'gemini'});await f.invoke('botConfigure',{mode:'gemini',key:'synthetic-original-key'});const before=fs.readFileSync(path.join(f.root,'bot-vault.json'));
  await assert.rejects(f.invoke('botConfigure',{mode:'gemini',key:'synthetic-rejected-key',geminiModel:'gemini-latest'}),/available/);assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-vault.json')),before);
});
test('Feishu app secret uses its own encrypted slot and cannot create a fake Channels login',async t=>{
  const f=fixture(t);await f.invoke('botConfigure',{mode:'doubao'});const value=await f.invoke('botConfigure',{mode:'doubao',key:'synthetic-doubao-key',channel:'feishu',feishuAppId:'cli_0123456789abcdef',feishuOwnerId:'ou_synthetic_owner',feishuAppSecret:'synthetic-feishu-secret'});
  assert.equal(value.paired,true);assert.equal(value.status,'disconnected');assert.equal(value.feishu.hasSecret,true);assert.equal(f.service.secret.doubaoKey,'synthetic-doubao-key');assert(!JSON.stringify(value).includes('synthetic-feishu-secret'));
  const config=fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8');assert(!config.includes('synthetic-feishu-secret'));
  await assert.rejects(f.invoke('botConfigure',{mode:'native'}),/does not support/);
  await assert.rejects(f.invoke('botConfigure',{feishuAppId:'cli_fedcba9876543210'}),/new Feishu application/);assert.equal(f.service.config.feishuAppId,'cli_0123456789abcdef');
});
