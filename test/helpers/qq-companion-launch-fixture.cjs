'use strict';
// Synthetic lifecycle only. No process, credential, network or model is used.
const {randomUUID}=require('node:crypto');
const {QQCompanionLaunch}=require('../../src/bot/qq-companion-launch.cjs');
const PROFILE='launch-fixture',QQ='123456789',REVISION='00000000-0000-4000-8000-000000000001';
const error=code=>Object.assign(Error('Synthetic launch failure.'),{code});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function stopped(){return {accountId:QQ,management:'stopped',processRunning:false,canStart:true,recoveryRequired:false,reason:null,login:{state:'stopped',online:false}};}
function running(state='online'){return {accountId:QQ,management:'owned',processRunning:true,canStart:false,recoveryRequired:false,reason:null,runtimeRevision:REVISION,login:state==='online'?{state,online:true,identityVerified:true,accountId:QQ}:{state,online:false,identityVerified:false}};}
function fixture(t,overrides={}){
  const state={time:0,current:true,row:stopped(),refreshes:0,starts:0,connects:0,sleeps:[],phases:[],guards:[]};
  const snapshot=()=>({configured:true,desktopRunning:false,instances:[structuredClone(state.row)]});
  const options={
    capture:({accountId})=>{if(accountId!==PROFILE)throw error('changed');return {accountId,qqAccountId:QQ,contextKey:'a'.repeat(64),assertCurrent:value=>{state.guards.push(value);if(!state.current)throw error('changed');}};},
    refresh:async(_cap,options)=>{state.refreshes++;options.assertCurrent();return snapshot();},
    start:async(_cap,options)=>{options.assertCurrent();state.starts++;state.row=running();return {state:snapshot()};},
    connect:async(cap,options)=>{options.assertCurrent({phase:'preflight',generation:0,controller:null});state.connects++;options.assertCurrent({phase:'connecting',generation:1,controller:{}});return {accountId:cap.accountId,qqAccountId:cap.qqAccountId,status:'connected'};},
    monotonic:()=>state.time,sleep:async ms=>{state.sleeps.push(ms);state.time+=ms;},onChange:value=>state.phases.push(value?.phase||null),...overrides,
  };
  const coordinator=new QQCompanionLaunch(options);t?.after(()=>coordinator.close());
  return {coordinator,state,options,snapshot,input:()=>({accountId:PROFILE,operationId:randomUUID()}),profileId:PROFILE,qqAccountId:QQ};
}
module.exports={fixture,stopped,running,deferred,error,PROFILE,QQ,REVISION};
