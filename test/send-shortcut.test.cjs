'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const shortcut=require('../src/core/send-shortcut.cjs'),appearance=require('../src/core/appearance.cjs'),files=require('../src/core/files.cjs');
const mainFile=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(mainFile,'utf8');
function slice(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
function harness(t,initial={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-send-shortcut-')),configFile=path.join(root,'config.json');files.atomicJSON(configFile,initial);
 t.after(()=>{const p=path.resolve(root);assert.equal(path.dirname(p),path.resolve(os.tmpdir()));assert(path.basename(p).startsWith('arcade-send-shortcut-'));fs.rmSync(p,{recursive:true,force:true});});
 const state={fail:false,writes:0,published:0,appearanceRefreshes:0,windowCalls:0},ctx={...shortcut,...appearance,path,root,readJSON:files.readJSON,Object,Error,bot:{status:'connected'},themes:new Map([['workshop',{}],['moonbase',{}]]),live:{tasks:new Map()},atomicJSON(file,value){if(state.fail)throw Object.assign(Error('Synthetic settings write failure'),{code:'EACCES'});files.atomicJSON(file,value);state.writes++;},appearanceController:{refresh:()=>state.appearanceRefreshes++},win:{setAlwaysOnTop:()=>state.windowCalls++},applyWindow:()=>state.windowCalls++,publish:()=>state.published++,register:(name,fn)=>{assert.equal(name,'config');ctx.configure=fn;}};
 vm.createContext(ctx);const boot=slice('let config = {','const live = new Store('),save=slice('function saveConfig() {','\n');
 vm.runInContext(boot+'\n'+save+'\nfunction snapshot(){return {config:{...config}};}\n'+slice("    register('config', patch => {","    register('install',"),ctx,{filename:mainFile});
 return {state,configure:ctx.configure,configFile,current:()=>vm.runInContext('snapshot().config',ctx),reload:()=>{vm.runInContext("config={...readJSON(path.join(root,'config.json'))};config.sendShortcut=normalizeSendShortcut(config.sendShortcut);",ctx);return vm.runInContext('snapshot().config',ctx);}};
}
test('Only the two send shortcuts are accepted; legacy/invalid saved values normalize to Enter',()=>{
 for(const value of ['enter','ctrl-enter']){assert.equal(shortcut.validSendShortcut(value),true);assert.equal(shortcut.normalizeSendShortcut(value),value);}
 for(const value of [undefined,null,'Enter','ctrl+enter','constructor','__proto__',true,0,{},[],new String('enter')]){assert.equal(shortcut.validSendShortcut(value),false);assert.equal(shortcut.normalizeSendShortcut(value),'enter');}
});
test('Actual main defaults to Enter and persists/reloads explicit Ctrl+Enter without changing unrelated configuration',t=>{
 const h=harness(t,{appearance:'dark',language:'zh',theme:'moonbase',customSetting:'kept'});assert.equal(h.current().sendShortcut,'enter');const result=h.configure({sendShortcut:'ctrl-enter'});assert.equal(result.config.sendShortcut,'ctrl-enter');assert.equal(h.state.writes,1);const saved=files.readJSON(h.configFile);assert.equal(saved.customSetting,'kept');assert.equal(saved.appearance,'dark');assert.equal(saved.theme,'moonbase');assert.equal(saved.language,'zh');assert.equal(h.reload().sendShortcut,'ctrl-enter');h.configure({sendShortcut:'enter'});assert.equal(h.reload().sendShortcut,'enter');
});
test('Actual main validates shortcut before mutation or publication and does not consume inherited settings',t=>{
 const h=harness(t,{sendShortcut:'ctrl-enter',appearance:'light',language:'zh'}),before=fs.readFileSync(h.configFile);
 for(const value of [null,{},[],true,'constructor','ctrl+enter'])assert.throws(()=>h.configure({sendShortcut:value,appearance:'dark',language:'en'}),/Invalid send shortcut/);
 assert.equal(h.current().sendShortcut,'ctrl-enter');assert.equal(h.current().appearance,'light');assert.equal(h.current().language,'zh');assert.equal(h.state.writes,0);assert.equal(h.state.published,0);assert.deepEqual(fs.readFileSync(h.configFile),before);
 h.configure(Object.create({sendShortcut:'enter'}));assert.equal(h.current().sendShortcut,'ctrl-enter');
});
test('Actual main restores shortcut and appearance after failed persistence without announcing the unsaved selection',t=>{
 const h=harness(t,{sendShortcut:'ctrl-enter',appearance:'light'}),before=fs.readFileSync(h.configFile);h.state.fail=true;
 assert.throws(()=>h.configure({sendShortcut:'enter',appearance:'dark'}),/Synthetic settings write failure/);assert.equal(h.current().sendShortcut,'ctrl-enter');assert.equal(h.current().appearance,'light');assert.deepEqual(fs.readFileSync(h.configFile),before);assert.equal(h.state.published,0);assert.equal(h.state.appearanceRefreshes,0);assert.equal(h.state.windowCalls,0);
 h.state.fail=false;assert.equal(h.configure({sendShortcut:'enter'}).config.sendShortcut,'enter');assert.equal(h.state.published,1);
});
test('Actual startup normalizes an invalid saved shortcut without rewriting the file or losing unrelated fields',t=>{
 const h=harness(t,{sendShortcut:{invalid:true},customSetting:'kept'}),before=fs.readFileSync(h.configFile);assert.equal(h.current().sendShortcut,'enter');assert.equal(h.current().customSetting,'kept');assert.equal(h.state.writes,0);assert.deepEqual(fs.readFileSync(h.configFile),before);
});
