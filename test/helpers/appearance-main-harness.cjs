'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'../..'),sourceRoot=process.env.ARCADE_APPEARANCE_ROOT||root;
const core=require(path.join(sourceRoot,'src/core/appearance.cjs'));
class NativeThemeFixture extends EventEmitter{
 constructor(dark=false){super();this.osDark=dark;this.source='system';this.writes=[];}
 get themeSource(){return this.source;}
 set themeSource(value){this.source=value;this.writes.push(value);this.emit('updated');}
 get shouldUseDarkColors(){return this.source==='system'?this.osDark:this.source==='dark';}
 changeSystem(dark){this.osDark=dark;this.emit('updated');}
}
function harness({directory,initial={},dark=false}={}){
 const configFile=path.join(directory,'config.json');if(!fs.existsSync(configFile))fs.writeFileSync(configFile,JSON.stringify(initial));
 const config={theme:'workshop',compact:false,language:'zh',alwaysOnTop:false,...JSON.parse(fs.readFileSync(configFile,'utf8'))};config.appearance=core.normalizeAppearance(config.appearance);
 const nativeTheme=new NativeThemeFixture(dark),state={fail:false,writes:0,published:0,backgrounds:[],top:[],resized:0};
 const controller=new core.AppearanceController({nativeTheme,preference:()=>config.appearance,onChange:appearance=>state.backgrounds.push(core.appearanceBackground(appearance.colorScheme))});controller.refresh();
 const mainFile=path.join(sourceRoot,'src/main.cjs'),source=fs.readFileSync(mainFile,'utf8'),start=source.indexOf("    register('config', patch => {"),end=source.indexOf("    register('install',",start);if(start<0||end<start)throw Error('Production config registration not found.');
 let configure;const ctx={config,bot:{status:'disconnected'},themes:new Map([['workshop',{}],['moonbase',{}]]),Object,Error,...core,appearanceController:controller,
  saveConfig(){if(state.fail)throw Error('SYNTHETIC_PRIVATE_SAVE_FAILURE');fs.writeFileSync(configFile,JSON.stringify(config));state.writes++;},
  atomicJSON(){throw Error('No observer text change expected');},live:{tasks:new Map()},root:directory,path,
  win:{setAlwaysOnTop:value=>state.top.push(value)},applyWindow:()=>state.resized++,publish:()=>state.published++,
  snapshot:()=>({config:{...config},appearance:core.appearanceSnapshot(config.appearance,nativeTheme.shouldUseDarkColors)}),register:(name,fn)=>{if(name!=='config')throw Error('Unexpected registration');configure=fn;}};
 vm.runInNewContext(source.slice(start,end),ctx,{filename:mainFile});
 return {config,nativeTheme,state,controller,configure,snapshot:ctx.snapshot,configFile,mainFile,close:()=>controller.close()};
}
module.exports={harness,NativeThemeFixture};
