'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runtimeSupport}=require('../src/bot/qq-runtime.cjs');
const {nodeObservationRequest,nodeObservationPids,validNodeObservation}=runtimeSupport;
const processRow=(pid,parentPid)=>({pid,parentPid,name:'node.exe',executable:process.execPath,createdAt:'2026-11-06T00:00:00Z'});
const request={roots:[1000],retainedPids:[1000,1001]};
function observation(){const rows=[processRow(1000,10),processRow(1001,1000),processRow(1002,1001)];return {before:structuredClone(rows),after:structuredClone(rows),inspected:structuredClone(rows),listeners:[{pid:1001,port:54000,address:'127.0.0.1'}]};}
test('native observation requests accept only bounded numeric PID sets, never paths or scripts',()=>{
  for(const value of [null,[],{}, {roots:[],retainedPids:[]},{roots:['1000'],retainedPids:[]},{roots:[0],retainedPids:[]},{roots:[2147483648],retainedPids:[]},{roots:[1000,1000],retainedPids:[]},{roots:[1000],retainedPids:[1001,1001]},{roots:[1000],retainedPids:[],script:'PRIVATE_NOT_EXECUTED'},{roots:Array.from({length:33},(_,i)=>i+1),retainedPids:[]},{roots:[1000],retainedPids:Array.from({length:2049},(_,i)=>i+1)}])assert.throws(()=>nodeObservationRequest(value),{code:'process_check_failed'});
  const copy=nodeObservationRequest(request);copy.roots[0]=2000;assert.equal(request.roots[0],1000);
});
test('the collector covers changed descendant candidates but cannot itself grant ownership',()=>{
  const before=[processRow(1000,10),processRow(1001,1000)],after=[processRow(1000,10),processRow(1002,1000),processRow(1003,1002)];
  assert.deepEqual(new Set(nodeObservationPids(request,before,after)),new Set([1000,1001,1002,1003]));
  // A deeper child is deliberately retained for the Node runtime to reject;
  // dropping it here would hide an unauthorized process from the proof.
  const value=validNodeObservation(observation(),request);assert(value.inspected.some(row=>row.pid===1002));
});
test('raw observations reject duplicate identities, extra exact PIDs, malformed listeners and overlarge data',()=>{
  const cases=[r=>{r.before.push({...r.before[0]});},r=>{r.after.push({...r.after[0]});},r=>{r.inspected.push({...r.inspected[0]});},r=>{r.inspected.push(processRow(9999,1));},r=>{r.after[0].createdAt='bad';},r=>{r.listeners[0].port=65536;},r=>{r.listeners[0].pid=-1;},r=>{r.listeners[0].address='x'.repeat(129);},r=>{r.before=Array.from({length:4097},(_,i)=>processRow(i+1,0));},r=>{r.listeners=Array.from({length:4097},()=>r.listeners[0]);},r=>{r.raw='PRIVATE_NOT_RETURNED';},r=>{delete r.inspected;}];
  for(const mutate of cases){const r=observation();mutate(r);assert.throws(()=>validNodeObservation(r,request),{code:'process_check_failed'});}
});
test('missing exact processes remain absent for the caller to reject, never fabricated from a snapshot',()=>{
  const r=observation();r.inspected=[];const result=validNodeObservation(r,request);assert.deepEqual(result.inspected,[]);assert.equal(result.after.length,3);
});
