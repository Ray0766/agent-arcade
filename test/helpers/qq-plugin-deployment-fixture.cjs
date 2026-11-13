'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {QQPluginDeployment,tree}=require('../../src/bot/qq-plugin-deployment.cjs');
const ID='napcat-plugin-builtin';
function fixture(t,{installed=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-plugin-deploy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workDir=path.join(root,'work'),configDir=path.join(workDir,'config'),pluginRoot=path.join(workDir,'plugins'),current=path.join(pluginRoot,ID);fs.mkdirSync(path.join(configDir,'plugins',ID),{recursive:true});fs.mkdirSync(pluginRoot);
 fs.writeFileSync(path.join(configDir,'plugins.json'),JSON.stringify({[ID]:true}));fs.writeFileSync(path.join(configDir,'plugins',ID,'config.json'),'synthetic-private-config');
 const writePackage=(dir,ver,data)=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:ID,version:ver,main:'index.mjs'}));fs.writeFileSync(path.join(dir,'index.mjs'),'throw new Error("Synthetic plugin must never execute");');if(data!==undefined){fs.mkdirSync(path.join(dir,'data'),{recursive:true});fs.writeFileSync(path.join(dir,'data','state.txt'),data);}};
 if(installed)writePackage(current,'1.0.0','old-data');const codeRoot=path.join(root,'prepared','code');writePackage(codeRoot,'2.0.0','archive-data');
 const preparedId=randomUUID(),manifestSha256='a'.repeat(64),archiveSha256='b'.repeat(64),state={mono:0,now:1700000000000,stops:0,locks:0,resolve:0,stoppedHook:null,resolveHook:null,lockHook:null,scope:0};
 const artifacts={async resolve(id){if(id!==preparedId)throw Object.assign(Error('fixture'),{code:'prepared_invalid'});state.resolve++;await state.resolveHook?.();const value=tree(codeRoot);return {preparedId,id:ID,version:'2.0.0',codeRoot,manifestSha256,archiveSha256,verification:'full-manifest',containsData:true,files:value.rows.filter(x=>x.kind==='file').map(({path,size,sha256})=>({path,size,sha256})),authorAuthenticated:false};},list(){const value=tree(codeRoot);return {items:[{preparedId,id:ID,version:'2.0.0',manifestSha256,archiveSha256,containsData:true,files:value.files,bytes:value.bytes,authorAuthenticated:false}],issues:[]};},async prepareLocal(){return this.resolve(preparedId);}};
 const scope={kind:'installation',affectedProfiles:[{accountId:'fixture-profile',label:'Fixture'}]};
 const withDeploymentLock=async(options,fn)=>{state.locks++;await state.lockHook?.();options.assertCurrent();return fn({assertStopped:async()=>{state.stops++;await state.stoppedHook?.(state.stops);}});};
 const options={workDir,configDir,artifacts,scope,withDeploymentLock,now:()=>state.now,monotonic:()=>state.mono,assertCurrent:()=>{if(state.scope)throw Object.assign(Error('scope'),{code:'changed'});}};
 const controller=new QQPluginDeployment(options),read=()=>controller.read(),preview=async(operation='install',extra={})=>controller.preview({observationId:read().observationId,operation,pluginId:ID,...(operation==='install'?{preparedId}:{}),...extra});
 const configHash=()=>createHash('sha256').update(fs.readFileSync(path.join(configDir,'plugins.json'))).update(fs.readFileSync(path.join(configDir,'plugins',ID,'config.json'))).digest('hex');
 return {root,workDir,configDir,pluginRoot,current,codeRoot,preparedId,artifacts,state,options,controller,read,preview,configHash,writePackage};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
module.exports={fixture,ID,deferred};
