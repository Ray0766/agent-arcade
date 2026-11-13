'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readSelectedMedia}=require('../src/bot/qq-media-file.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-media-reader-')),file=path.join(dir,'synthetic.wav');fs.writeFileSync(file,Buffer.alloc(1024,7));t.after(()=>{assert(fs.realpathSync(dir).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return {dir,file};}
const opts={extensions:['.wav'],maxBytes:4096};
test('shared reader preserves the exact selected source and rejects policy broadening and network/ADS paths',async t=>{const f=fixture(t),before=fs.readFileSync(f.file);assert((await readSelectedMedia(f.file,opts)).equals(before));for(const file of ['https://example.test/voice.wav','//server/share/voice.wav',`${f.file}:stream`])await assert.rejects(readSelectedMedia(file,opts),{code:'unsafe_file'});await assert.rejects(readSelectedMedia(f.file,{...opts,maxBytes:9*1024*1024}),{code:'invalid_request'});assert(fs.readFileSync(f.file).equals(before));});
test('source changes after reading cannot become a sendable preview and read buffers are cleared',async t=>{const f=fixture(t),open=fs.promises.open;let observed;
  fs.promises.open=async(...args)=>{const handle=await open.call(fs.promises,...args),read=handle.read.bind(handle);handle.read=async(...values)=>{observed=values[0];const result=await read(...values);fs.appendFileSync(f.file,Buffer.from([9]));return result;};return handle;};
  try{await assert.rejects(readSelectedMedia(f.file,opts),{code:'file_changed'});assert(observed.every(value=>value===0));}finally{fs.promises.open=open;}
});
test('cancellation during final stat cannot publish already-read media',async t=>{const f=fixture(t),open=fs.promises.open,abort=new AbortController();let observed;
  fs.promises.open=async(...args)=>{const handle=await open.call(fs.promises,...args),stat=handle.stat.bind(handle),read=handle.read.bind(handle);let calls=0;handle.stat=async()=>{const result=await stat();if(++calls===2)abort.abort();return result;};handle.read=async(...values)=>{observed=values[0];return read(...values);};return handle;};
  try{await assert.rejects(readSelectedMedia(f.file,{...opts,signal:abort.signal}),{code:'cancelled'});assert(observed.every(value=>value===0));}finally{fs.promises.open=open;}
});
