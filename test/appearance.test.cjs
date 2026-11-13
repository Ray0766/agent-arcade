'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {harness}=require('./helpers/appearance-main-harness.cjs');
function setup(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-appearance-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const h=harness({directory,...options});t.after(()=>h.close());return h;}
test('Old settings default to system; actual main saves/reloads appearance without touching independent settings',t=>{
 const h=setup(t,{initial:{theme:'moonbase',language:'en',compact:true,customSetting:'kept'},dark:true});assert.equal(h.config.appearance,'system');assert.equal(h.snapshot().appearance.colorScheme,'dark');
 h.configure({appearance:'light'});const saved=JSON.parse(fs.readFileSync(h.configFile,'utf8'));assert.equal(saved.appearance,'light');assert.equal(saved.theme,'moonbase');assert.equal(saved.customSetting,'kept');assert.equal(saved.language,'en');assert.equal(saved.compact,true);
 const reopened=harness({directory:path.dirname(h.configFile),dark:true});t.after(()=>reopened.close());assert.equal(reopened.snapshot().appearance.colorScheme,'light');assert.equal(reopened.nativeTheme.themeSource,'light');assert.equal(reopened.state.backgrounds.at(-1),'#faf6f9');assert.equal(h.state.resized,0);
});
test('Explicit night/day and system changes keep native source, effective snapshot and window background aligned',t=>{
 const h=setup(t);h.configure({appearance:'dark'});assert.equal(h.nativeTheme.themeSource,'dark');assert.equal(h.snapshot().appearance.colorScheme,'dark');assert.equal(h.state.backgrounds.at(-1),'#211d27');
 const count=h.state.backgrounds.length;h.nativeTheme.changeSystem(true);h.nativeTheme.changeSystem(false);assert.equal(h.state.backgrounds.length,count);
 h.configure({appearance:'system'});assert.equal(h.nativeTheme.themeSource,'system');assert.equal(h.snapshot().appearance.colorScheme,'light');const writes=h.state.writes;
 h.nativeTheme.changeSystem(true);assert.equal(h.snapshot().appearance.colorScheme,'dark');assert.equal(h.state.backgrounds.at(-1),'#211d27');assert.equal(h.state.writes,writes);assert.equal(JSON.parse(fs.readFileSync(h.configFile)).appearance,'system');
 h.configure({appearance:'light'});h.configure({theme:'moonbase'});assert.equal(h.config.theme,'moonbase');assert.equal(h.snapshot().appearance.colorScheme,'light');
});
test('Invalid mode rejects before changing any config; failed persistence keeps the former palette and selection',t=>{
 const h=setup(t,{initial:{appearance:'light'}});for(const value of ['auto','constructor',null,{},true])assert.throws(()=>h.configure({appearance:value,language:'en'}),/Invalid appearance/);assert.equal(h.config.language,'zh');assert.equal(h.state.writes,0);
 const before=fs.readFileSync(h.configFile);h.state.fail=true;assert.throws(()=>h.configure({appearance:'dark'}),/SYNTHETIC_PRIVATE/);assert.equal(h.config.appearance,'light');assert.equal(h.nativeTheme.themeSource,'light');assert.deepEqual(fs.readFileSync(h.configFile),before);
});
test('Invalid saved appearance recovers to system and native listeners detach on close without changing OS preference',t=>{
 const h=setup(t,{initial:{appearance:{bad:true}},dark:true});assert.equal(h.config.appearance,'system');assert.equal(h.nativeTheme.osDark,true);assert.equal(h.nativeTheme.listenerCount('updated'),1);h.close();h.close();const count=h.state.backgrounds.length;h.nativeTheme.changeSystem(false);assert.equal(h.nativeTheme.listenerCount('updated'),0);assert.equal(h.state.backgrounds.length,count);
});
test('Actual preload seed applies saved light before styles despite dark system; invalid arguments never become CSS',()=>{
 const vm=require('node:vm'),sourceRoot=process.env.ARCADE_APPEARANCE_ROOT||path.resolve(__dirname,'..');let arcade;
 const preload=fs.readFileSync(path.join(sourceRoot,'src/preload.cjs'),'utf8'),renderer=fs.readFileSync(path.join(sourceRoot,'src/ui/appearance.js'),'utf8');
 // Loaded as Electron's sandbox loads it: `process` is an argument, not a global (helpers/sandboxed-preload.cjs).
 const expose=args=>{arcade=require('./helpers/sandboxed-preload.cjs').runSandboxedPreload({argv:args,source:preload}).arcade;};
 expose(['electron','--arcade-appearance=dark','--arcade-color-scheme=dark','--arcade-appearance=light','--arcade-color-scheme=light']);const root={dataset:{},style:{}},events=[];let mediaListener;const window={arcade,matchMedia:()=>({matches:true,addEventListener:(_name,fn)=>mediaListener=fn}),dispatchEvent:event=>events.push(event)};
 vm.runInNewContext(renderer,{window,document:{documentElement:root},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});assert.equal(root.dataset.colorScheme,'light');assert.equal(root.style.colorScheme,'light');assert.equal(root.dataset.appearance,'light');mediaListener();assert.equal(root.dataset.colorScheme,'light');assert.equal(events.length,1);
 expose(['--arcade-appearance=constructor','--arcade-color-scheme=url(private)']);assert.equal(arcade.initialAppearance.preference,'system');assert.equal(arcade.initialAppearance.colorScheme,null);
});
test('Fixed viewer accepts bounded host theme only from initialized parent and the parent CSP authorizes exactly that script',()=>{
 const vm=require('node:vm'),crypto=require('node:crypto'),sourceRoot=process.env.ARCADE_APPEARANCE_ROOT||path.resolve(__dirname,'..');
 const code=fs.readFileSync(path.join(sourceRoot,'src/mcp/result-app.js'),'utf8').replace(/\r\n/g,'\n'),index=fs.readFileSync(path.join(sourceRoot,'src/ui/index.html'),'utf8'),hash=crypto.createHash('sha256').update(code).digest('base64');assert(index.includes("'sha256-"+hash+"'"));assert(!index.includes("script-src 'self' 'unsafe-inline'"));
 const nodes=new Map(),root={dataset:{},style:{},lang:'en'},parent={postMessage(){}},document={documentElement:root,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',addEventListener(){}});return nodes.get(id);}};let receive;vm.runInNewContext(code,{document,parent,addEventListener:(_name,fn)=>receive=fn});
 const theme={jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}};receive({source:parent,data:theme});assert.equal(root.dataset.colorScheme,undefined);
 receive({source:parent,data:{jsonrpc:'2.0',id:'arcade-initialize',result:{protocolVersion:'2026-01-26',hostContext:{theme:'light',locale:'zh-CN'}}}});assert.equal(root.dataset.colorScheme,'light');assert.equal(root.lang,'zh-CN');receive({source:{},data:theme});assert.equal(root.dataset.colorScheme,'light');receive({source:parent,data:theme});assert.equal(root.dataset.colorScheme,'dark');receive({source:parent,data:{...theme,params:{locale:'en'}}});assert.equal(root.dataset.colorScheme,'dark');assert.equal(root.lang,'en');receive({source:parent,data:{...theme,params:{theme:'url(private)'}}});assert.equal(root.dataset.colorScheme,'dark');
});
