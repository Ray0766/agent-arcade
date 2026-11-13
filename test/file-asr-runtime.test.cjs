'use strict';
// Inert temporary paths and injected factories. No Python/audio/model execution.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const file=path.resolve(__dirname,'../src/voice/file-asr-runtime.cjs'),source=fs.readFileSync(file,'utf8');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-file-asr-')),config={version:1,asrPython:path.join(root,'python.exe'),asrModel:path.join(root,'model')};fs.writeFileSync(config.asrPython,'inert');fs.mkdirSync(config.asrModel);
  const save=value=>fs.writeFileSync(path.join(root,'local-voice.json'),typeof value==='string'?value:JSON.stringify(value));
  t.after(()=>{const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('arcade-file-asr-'));fs.rmSync(resolved,{recursive:true,force:true});});return {root,config,save};
}
function harness(filesystem=fs){const made=[],dependencies=[];const context={module:{exports:{}},require:name=>{dependencies.push(name);if(name==='node:fs')return filesystem;if(name==='node:path')return path;if(name==='./qwen-file-asr.cjs')return {QwenFileAsr:class{constructor(options){this.options=options;made.push(options);}transcribe(){assert.fail('Configuration must not execute a model');}}};assert.fail('Unexpected runtime dependency');}};vm.runInNewContext(source,context,{filename:file});return {...context.module.exports,made,dependencies};}
test('ASR-only discovery validates just two paths and never imports TTS, sound devices or the model worker',t=>{
  const f=fixture(t),lookups=[],h=harness({...fs,statSync:value=>{lookups.push(value);return fs.statSync(value);}});f.save({...f.config,ttsPython:'//private/ignored',ttsRepository:'missing',referenceAudio:'missing',secret:'PRIVATE'});
  assert.deepEqual(JSON.parse(JSON.stringify(h.fileAsrAvailability({root:f.root}))),{available:true});assert.equal(h.made.length,0);assert(!h.dependencies.includes('./qwen-file-asr.cjs'));assert.deepEqual(lookups,[path.join(f.root,'local-voice.json'),f.config.asrPython,f.config.asrModel]);
  const result=h.createFileAsr({root:f.root});assert.deepEqual(JSON.parse(JSON.stringify(result.options)),{pythonPath:f.config.asrPython,modelPath:f.config.asrModel});assert.doesNotMatch(JSON.stringify(result.options),/PRIVATE|tts|reference/);assert.equal(h.made.length,1);
});
test('missing, malformed, oversized and wrong-kind assets return one safe unavailable code',t=>{
  const f=fixture(t),h=harness();const check=()=>{assert.equal(h.fileAsrAvailability({root:f.root}).available,false);assert.throws(()=>h.createFileAsr({root:f.root}),error=>error.code==='asr_unavailable'&&!error.message.includes(f.root)&&!error.message.includes('PRIVATE'));};
  check();for(const value of [null,[],{},'{PRIVATE',{},' '.repeat(8193),{...f.config,version:2},{...f.config,asrPython:f.config.asrModel},{...f.config,asrModel:f.config.asrPython},{...f.config,asrModel:path.join(f.root,'not-installed')}]){f.save(value);check();}assert.equal(h.made.length,0);
});
test('relative, UNC and NUL paths are rejected without filesystem access to that path',()=>{
  const root=path.resolve('synthetic-asr-root');for(const key of ['asrPython','asrModel'])for(const invalid of ['//server/private','\\\\server\\private','relative-path','C:\\path\0']){
    const config={version:1,asrPython:path.resolve('python.exe'),asrModel:path.resolve('model'),[key]:invalid},lookups=[],h=harness({readFileSync:()=>JSON.stringify(config),statSync:value=>{lookups.push(value);return {size:500,isFile:()=>true,isDirectory:()=>true};}});assert.equal(h.fileAsrAvailability({root}).available,false);assert(!lookups.includes(invalid));assert.equal(h.made.length,0);
  }
});
test('factory rechecks the configuration after availability instead of retaining stale paths',t=>{
  const f=fixture(t),h=harness();f.save(f.config);assert.equal(h.fileAsrAvailability({root:f.root}).available,true);fs.unlinkSync(f.config.asrPython);assert.throws(()=>h.createFileAsr({root:f.root}),{code:'asr_unavailable'});assert.equal(h.made.length,0);
});
