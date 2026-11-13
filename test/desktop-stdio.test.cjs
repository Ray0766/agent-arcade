'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const {guardDesktopOutput}=require('../src/core/desktop-stdio.cjs');
test('desktop survives a closed launcher output pipe without replacing its stream',()=>{
 const stdout=new EventEmitter(),stderr=new EventEmitter();
 guardDesktopOutput([stdout,stderr]);guardDesktopOutput([stdout,stderr]);
 assert.equal(stdout.listenerCount('error'),1);
 assert.doesNotThrow(()=>stdout.emit('error',Object.assign(new Error('closed'),{code:'EPIPE'})));
 assert.doesNotThrow(()=>stderr.emit('error',Object.assign(new Error('closed'),{code:'EPIPE'})));
});
test('desktop does not swallow unrelated output stream failures',()=>{
 const output=new EventEmitter();guardDesktopOutput([output]);
 const failure=Object.assign(new Error('device failed'),{code:'EIO'});
 assert.throws(()=>output.emit('error',failure),error=>error===failure);
});
for(const target of ['stdout','stderr'])test(`real closed ${target} pipe cannot crash the detached desktop`,{timeout:8000},async t=>{
 const child=spawn(process.execPath,['-e',`
  require(${JSON.stringify(require.resolve('../src/core/desktop-stdio.cjs'))}).guardDesktopOutput();
  const stream=process[${JSON.stringify(target)}];
  stream.on('error',error=>process.send({pipeError:error.code}));
  process.on('message',()=>stream.write('synthetic desktop diagnostic\\n',()=>setTimeout(()=>process.send({alive:true},()=>process.exit(0)),30)));
  process.send({ready:true});
 `],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 const messages=[];
 await new Promise((resolve,reject)=>{
  child.on('error',reject);
  child.on('message',message=>{messages.push(message);if(message.ready)child[target].destroy(null,()=>child.send('write'));});
  child.on('exit',(code,signal)=>{try{assert.equal(signal,null);assert.equal(code,0);resolve();}catch(error){reject(error);}});
 });
 assert.ok(messages.some(row=>row.pipeError==='EPIPE'));
 assert.ok(messages.some(row=>row.alive));
});
