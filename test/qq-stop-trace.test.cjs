'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createQQStopTrace,MAX_EVENTS}=require('../src/bot/qq-stop-trace.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-stop-trace-'));t.after(()=>{assert(fs.realpathSync(root).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(root,{recursive:true,force:true});});return{root,directory:path.join(root,'diagnostics'),filename:'qq-stop-trace-synthetic.jsonl'};}
const event={operationId:'11111111-1111-4111-8111-111111111111',kind:'snapshot',phase:'confirm_stopped',origin:'stop-confirm',observedCount:4,selectedCount:1,truncated:false,processes:[{pid:123,parentPid:12,createdAt:'2026-11-06T01:00:00.1234567Z',executablePathSha256:'a'.repeat(64)}]};
test('main private diagnostics path works and records only exact safe fields',t=>{
 const f=fixture(t),sink=createQQStopTrace(f);assert.equal(sink.enabled,true);assert(sink.record({...event,accountHash:'SECRET_ACCOUNT',accountId:'PRIVATE_ACCOUNT',commandLine:'PRIVATE_TOKEN',logText:'PRIVATE_CHAT',processes:[{...event.processes[0],executable:'PRIVATE_PATH',commandLine:'PRIVATE_COMMAND'}]}));sink.close();
 const text=fs.readFileSync(path.join(f.directory,f.filename),'utf8'),row=JSON.parse(text);assert.doesNotMatch(text,/PRIVATE|SECRET_ACCOUNT/);assert.equal(row.processes[0].createdAt,event.processes[0].createdAt);assert.equal(row.origin,'stop-confirm');assert.equal(row.processes[0].executablePathSha256,'a'.repeat(64));
});
test('trace never overwrites existing or linked targets and never creates arbitrary parent trees',t=>{
 const f=fixture(t),first=createQQStopTrace(f);assert(first.record(event));first.close();const before=fs.readFileSync(path.join(f.directory,f.filename));const duplicate=createQQStopTrace(f);assert(!duplicate.enabled);assert(!duplicate.record(event));assert.deepEqual(fs.readFileSync(path.join(f.directory,f.filename)),before);
 assert(!createQQStopTrace({...f,directory:path.join(f.root,'missing','diagnostics')}).enabled);assert(!fs.existsSync(path.join(f.root,'missing')));assert(!createQQStopTrace({...f,filename:'../outside.jsonl'}).enabled);
 const outside=path.join(f.root,'outside');fs.mkdirSync(outside);const linked=path.join(f.root,'linked');fs.symlinkSync(outside,linked,'junction');assert(!createQQStopTrace({...f,directory:path.join(linked,'diagnostics')}).enabled);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('trace event bounds, write interference and malformed timestamps are inert',t=>{
 const f=fixture(t),sink=createQQStopTrace(f);assert(sink.record({...event,hostAt:'2026-11-06T00:00:00Z SECRET',processes:[{...event.processes[0],createdAt:'2026-11-06T00:00:00Z SECRET'}]}));for(let i=1;i<MAX_EVENTS;i++)assert(sink.record(event));assert(!sink.record(event));sink.close();const rows=fs.readFileSync(path.join(f.directory,f.filename),'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,MAX_EVENTS);assert.equal(rows[0].processes[0].createdAt,null);assert(!('hostAt'in rows[0]));
 const second=createQQStopTrace({...f,filename:'qq-stop-trace-second.jsonl'});fs.appendFileSync(path.join(f.directory,'qq-stop-trace-second.jsonl'),'FOREIGN');assert(!second.record(event));assert.equal(fs.readFileSync(path.join(f.directory,'qq-stop-trace-second.jsonl'),'utf8'),'FOREIGN');assert.doesNotThrow(()=>second.close());
});
