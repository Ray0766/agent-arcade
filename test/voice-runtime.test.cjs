'use strict';
// Isolated configuration/provider/host boundaries only. No Python process,
// microphone, model, network connection or real account is used by these tests.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');

const runtimeFile=path.resolve(__dirname,'../src/voice/runtime.cjs');
const runtimeSource=fs.readFileSync(runtimeFile,'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-voice-runtime-'));
  const config={version:1,asrPython:path.join(root,'asr-python.exe'),asrModel:path.join(root,'asr-model'),ttsPython:path.join(root,'tts-python.exe'),ttsRepository:path.join(root,'tts-repository'),referenceAudio:path.join(root,'reference.wav')};
  for(const [key,value]of Object.entries(config))if(key!=='version'){
    if(['asrModel','ttsRepository'].includes(key))fs.mkdirSync(value);
    else fs.writeFileSync(value,'inert test fixture; never executed');
  }
  const save=value=>fs.writeFileSync(path.join(root,'local-voice.json'),typeof value==='string'?value:JSON.stringify(value));
  t.after(()=>{const absolute=path.resolve(root);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(absolute).startsWith('arcade-voice-runtime-'));fs.rmSync(absolute,{recursive:true,force:true});});
  return {root,config,save};
}
function harness({filesystem=fs,capabilities,close}={}){
  const instances=[],ttsInstances=[],asrInstances=[];
  class WindowsSpeech{
    constructor(){this.backend='windows';this.closes=0;instances.push(this);}
    async capabilities(){return capabilities?capabilities(this):{recognizers:[{locale:'zh-CN'}],voices:[{name:'Synthetic voice',locale:'zh-CN'}]};}
    async close(){this.closes++;return close?.(this);}
  }
  class QwenAsr{constructor(options){this.options=options;asrInstances.push(this);}}
  class GptSovitsSpeech{constructor(options){this.options=options;ttsInstances.push(this);}start(){throw Error('Discovery must not start a worker.');}capabilities(){throw Error('Discovery must not query devices.');}render(){throw Error('Construction must not run a model.');}}
  class QwenSpeech extends WindowsSpeech{constructor(options){super();this.backend='local-neural';this.options=options;}}
  const context={module:{exports:{}},require:id=>{
    if(id==='node:fs')return filesystem;
    if(id==='node:path')return path;
    if(id==='node:crypto')return require('node:crypto');
    if(id==='./windows-speech.cjs')return {WindowsSpeech};
    if(id==='./qwen-asr.cjs')return {QwenAsr,QwenSpeech};
    if(id==='./gpt-sovits.cjs')return {GptSovitsSpeech};
    throw Error('Unexpected dependency in isolated runtime test: '+id);
  }};
  vm.runInNewContext(runtimeSource,context,{filename:runtimeFile});
  return {...context.module.exports,instances,ttsInstances,asrInstances};
}

test('render availability is configuration-only and a TTS-only installation needs no ASR or device',t=>{
  const f=fixture(t),h=harness(),local={version:1,ttsPython:f.config.ttsPython,ttsRepository:f.config.ttsRepository,referenceAudio:f.config.referenceAudio};f.save(local);
  const status=h.voiceRenderAvailability({root:f.root});assert.equal(status.available,true);assert.deepEqual(Object.keys(status),['available']);
  assert.equal(h.ttsInstances.length,0);assert.equal(h.asrInstances.length,0);assert.equal(h.instances.length,0);
  const runtime=h.createVoiceRenderRuntime({root:f.root});assert.equal(runtime,h.ttsInstances[0]);assert.equal(h.ttsInstances.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.options)),{pythonPath:local.ttsPython,repoPath:local.ttsRepository,referencePath:local.referenceAudio});
  assert.equal(h.asrInstances.length,0);assert.equal(h.instances.length,0);
  assert.throws(()=>h.createVoiceRuntime({root:f.root,backend:'local-neural'}),/安装配置不完整/,'desktop mode still requires its recognition configuration');
});

test('render discovery ignores unrelated ASR paths and never forwards extra config fields',t=>{
  const f=fixture(t),inspected=[],h=harness({filesystem:{...fs,statSync:file=>{inspected.push(file);return fs.statSync(file);}}});
  f.save({...f.config,asrPython:'//unrelated/private',asrModel:'not-installed',key:'PRIVATE-UNRELATED-FIELD'});
  assert.equal(h.voiceRenderAvailability({root:f.root}).available,true);const runtime=h.createVoiceRenderRuntime({root:f.root});
  assert(!inspected.includes('//unrelated/private'));assert(!inspected.includes('not-installed'));assert.doesNotMatch(JSON.stringify(runtime.options),/PRIVATE|asr/);
});

test('missing, malformed or excessive render config fails with one public code and no fallback',t=>{
  const f=fixture(t),h=harness();
  const check=()=>{assert.deepEqual(JSON.parse(JSON.stringify(h.voiceRenderAvailability({root:f.root}))),{available:false,reason:'voice_render_unavailable'});assert.throws(()=>h.createVoiceRenderRuntime({root:f.root}),error=>error.code==='voice_render_unavailable'&&!error.message.includes(f.root));};
  check();for(const invalid of ['{ PRIVATE',null,[],{version:2},' '.repeat(8193),{...f.config,referenceAudio:path.join(f.root,'missing.wav')},{...f.config,ttsPython:f.config.ttsRepository},{...f.config,ttsRepository:f.config.ttsPython}]){f.save(invalid);check();}
  assert.equal(h.ttsInstances.length,0);assert.equal(h.asrInstances.length,0);assert.equal(h.instances.length,0);
});

test('render discovery rejects network, NUL and relative paths before accessing them',()=>{
  const root=path.resolve('fixture-render-root'),file=path.join(root,'local-voice.json');
  for(const key of ['ttsPython','ttsRepository','referenceAudio'])for(const invalid of ['//server/share','\\\\server\\share','relative-path','C:\\bad\0path']){
    const value={version:1,ttsPython:path.resolve('python.exe'),ttsRepository:path.resolve('repo'),referenceAudio:path.resolve('reference.wav'),[key]:invalid},inspected=[];
    const filesystem={readFileSync:()=>JSON.stringify(value),statSync:item=>{inspected.push(item);return {size:400,isDirectory:()=>true,isFile:()=>true};}},h=harness({filesystem});
    assert.equal(h.voiceRenderAvailability({root}).available,false);assert.deepEqual(inspected,[file]);assert.equal(h.ttsInstances.length,0);
  }
});

test('render factory rechecks files after availability and cannot silently use Windows when assets disappear',t=>{
  const f=fixture(t),h=harness();f.save(f.config);assert.equal(h.voiceRenderAvailability({root:f.root}).available,true);fs.unlinkSync(f.config.referenceAudio);
  assert.throws(()=>h.createVoiceRenderRuntime({root:f.root}),{code:'voice_render_unavailable'});assert.equal(h.ttsInstances.length,0);assert.equal(h.instances.length,0);
});

test('missing optional neural config keeps Windows available but an explicit neural choice fails closed',t=>{
  const f=fixture(t),h=harness();
  assert.equal(h.readRuntime(f.root),null);
  assert.equal(h.createVoiceRuntime({root:f.root,characterId:'claude-ju'}).backend,'windows');
  assert.throws(()=>h.createVoiceRuntime({root:f.root,characterId:'claude-ju',backend:'local-neural'}),/尚未安装/);
  assert.equal(h.instances.length,1,'failed neural selection must not construct a hidden Windows fallback');
});

test('valid local installation chooses Ju neural by default and honors explicit provider selection',t=>{
  const f=fixture(t),h=harness();f.save({...f.config,untrustedExtra:'not forwarded'});
  const ju=h.createVoiceRuntime({root:f.root,characterId:'claude-ju'});
  assert.equal(ju.backend,'local-neural');assert.equal(ju.speech.options.asr.options.pythonPath,f.config.asrPython);
  assert.equal(ju.speech.options.playback.options.referencePath,f.config.referenceAudio);
  assert.equal(JSON.stringify(ju.speech.options).includes('untrustedExtra'),false);
  assert.equal(h.createVoiceRuntime({root:f.root,characterId:'codex-dragon'}).backend,'windows');
  assert.equal(h.createVoiceRuntime({root:f.root,characterId:'claude-ju',backend:'windows'}).backend,'windows');
  assert.equal(h.createVoiceRuntime({root:f.root,characterId:'codex-dragon',backend:'local-neural'}).backend,'local-neural');
});

test('invalid config, missing assets and wrong path kinds never silently change the chosen neural provider',t=>{
  const f=fixture(t),h=harness();
  const invalid=['{broken',JSON.stringify({}),JSON.stringify({...f.config,version:2}),' '.repeat(8193),
    JSON.stringify({...f.config,asrPython:'relative-python.exe'}),JSON.stringify({...f.config,asrPython:f.config.asrModel}),
    JSON.stringify({...f.config,asrModel:f.config.asrPython}),JSON.stringify({...f.config,referenceAudio:path.join(f.root,'missing.wav')}),
    JSON.stringify({...f.config,ttsRepository:f.config.ttsRepository+'\0'})];
  for(const value of invalid){f.save(value);assert.throws(()=>h.createVoiceRuntime({root:f.root,characterId:'claude-ju',backend:'local-neural'}),/安装配置不完整/);}
  assert.equal(h.instances.length,0);
  assert.equal(h.createVoiceRuntime({root:f.root,backend:'windows'}).backend,'windows','explicit Windows remains usable despite a broken optional installation');
  assert.equal(h.instances.length,1);
});

test('unknown backend is rejected before inspecting files or constructing providers',()=>{
  let filesystemAccesses=0;const h=harness({filesystem:new Proxy({},{get(){filesystemAccesses++;throw Error('must not read');}})});
  assert.throws(()=>h.createVoiceRuntime({root:'unused',backend:'remote-provider'}),/available speech provider/);
  assert.equal(filesystemAccesses,0);assert.equal(h.instances.length,0);
});

test('both UNC slash spellings are rejected before statting any network path',()=>{
  const localRoot=path.resolve('synthetic-voice-root'),configFile=path.join(localRoot,'local-voice.json');
  for(const networkPath of ['\\\\synthetic-server\\share\\python.exe','//synthetic-server/share/python.exe']){
    const config={version:1,asrPython:networkPath,asrModel:path.resolve('model'),ttsPython:path.resolve('python.exe'),ttsRepository:path.resolve('repo'),referenceAudio:path.resolve('reference.wav')};
    const inspected=[];
    const filesystem={existsSync:()=>true,readFileSync:()=>JSON.stringify(config),statSync:file=>{inspected.push(file);return file===configFile?{size:400}:{isFile:()=>true,isDirectory:()=>true};}};
    const h=harness({filesystem});
    assert.throws(()=>h.createVoiceRuntime({root:localRoot,backend:'local-neural'}),/安装配置不完整/);
    assert.deepEqual(inspected,[configFile],'UNC must be refused before filesystem/network lookup');
    assert.equal(h.instances.length,0);
  }
});

test('capability results belong to their requested provider and every temporary provider is closed',async t=>{
  const f=fixture(t);f.save(f.config);const local=deferred(),windows=deferred();
  const h=harness({capabilities:speech=>speech.backend==='local-neural'?local.promise:windows.promise});
  const first=h.voiceCapabilities({root:f.root,characterId:'claude-ju',backend:'local-neural'});
  const second=h.voiceCapabilities({root:f.root,characterId:'claude-ju',backend:'windows'});
  windows.resolve({recognizers:[{locale:'en-US'}],voices:[],handsFree:true});const fallback=await second;
  assert.equal(fallback.selectedBackend,'windows');assert.equal(fallback.handsFree,true);
  local.resolve({recognizers:[{locale:'zh-CN'}],voices:[],handsFree:false,maxCaptureSeconds:60});const neural=await first;
  assert.equal(neural.selectedBackend,'local-neural');assert.equal(neural.handsFree,false);assert.equal(neural.maxCaptureSeconds,60);
  assert.equal(h.instances.length,2);assert(h.instances.every(speech=>speech.closes===1));
});

test('a failed asynchronous neural capability probe closes resources and does not probe Windows instead',async t=>{
  const f=fixture(t);f.save(f.config);const h=harness({capabilities:async()=>{throw Error('synthetic missing dependencies');}});
  await assert.rejects(h.voiceCapabilities({root:f.root,characterId:'claude-ju',backend:'local-neural'}),/synthetic missing dependencies/);
  assert.equal(h.instances.length,1);assert.equal(h.instances[0].backend,'local-neural');assert.equal(h.instances[0].closes,1);
});

test('host capability and provider-start calls keep their account/panel binding across account changes',async()=>{
  const nodes=[],calls=[],panels=[],document={body:{dataset:{view:'bot'}},querySelector:()=>({prepend(){},append(){}})};let counter=0;
  const window={arcade:Object.fromEntries(['voiceCapabilities','voiceStart','voiceClose','voiceFinish','voiceConfirm','voiceInterrupt','voiceEvidence'].map(name=>[name,async value=>{calls.push({name,value});return {status:'idle'};}])),ArcadeVoice:{createPanel({api}){const panel={api,element:{append(){},querySelector:()=>({append(){},after(){}}),scrollIntoView(){} },render(){},destroy(reason){void api.voiceClose(reason);}};panels.push(panel);return panel;}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/ui/voice-host.js'),'utf8'),{window,document,crypto:{randomUUID:()=>`panel-${++counter}`},$:()=>({append(){}}),el:(_tag,className)=>{const node={className,setAttribute(){},remove(){},focus(){}};nodes.push(node);return node;},action:fn=>fn()});
  const state=accountId=>({accounts:{selectedId:accountId},config:{language:'zh'},bot:{social:{active:true}}});
  window.renderVoice(state('ju'));nodes.findLast(n=>n.className==='secondary voice-entry').onclick();await panels[0].api.voiceCapabilities({backend:'local-neural',accountId:'injected',panelId:'injected'});
  window.renderVoice(state('dragon'));nodes.findLast(n=>n.className==='secondary voice-entry').onclick();await panels[1].api.voiceCapabilities({backend:'windows'});await panels[1].api.voiceStart({backend:'windows',mode:'push-to-talk'});
  const capabilities=calls.filter(x=>x.name==='voiceCapabilities');assert.equal(capabilities[0].value.accountId,'ju');assert.equal(capabilities[0].value.panelId,'panel-1');assert.equal(capabilities[0].value.backend,'local-neural');
  assert.equal(capabilities[1].value.accountId,'dragon');assert.equal(capabilities[1].value.panelId,'panel-2');
  const started=calls.find(x=>x.name==='voiceStart');assert.equal(started.value.accountId,'dragon');assert.equal(started.value.backend,'windows');assert.equal(started.value.mode,'push-to-talk');
  assert.equal(calls.find(x=>x.name==='voiceClose').value.accountId,'ju');
});

test('neural providers hold the shared lease until confirmed close while Windows never acquires it',async t=>{
  const {AsrGate}=require('../src/voice/asr-gate.cjs'),f=fixture(t),gate=new AsrGate(),closing=deferred();f.save(f.config);const h=harness({close:speech=>speech.backend==='local-neural'?closing.promise:undefined});let acquisitions=0;
  const acquireAsrLease=()=>{acquisitions++;return gate.acquire({scopeId:'synthetic-voice',jobId:'desktop'});};
  const runtime=h.createVoiceRuntime({root:f.root,backend:'local-neural',acquireAsrLease});assert.equal(acquisitions,1);assert.throws(()=>h.createVoiceRuntime({root:f.root,backend:'local-neural',acquireAsrLease}),{code:'busy'});assert.equal(h.asrInstances.length,1);
  const fallback=h.createVoiceRuntime({root:f.root,backend:'windows',acquireAsrLease:()=>assert.fail('Windows cannot reserve neural ASR')});await fallback.speech.close();
  const close=runtime.speech.close();assert.throws(()=>gate.acquire({scopeId:'qq',jobId:'record'}),{code:'busy'});closing.resolve();await close;const next=gate.acquire({scopeId:'qq',jobId:'record'});next.release();
});

test('a failed neural close retains ownership and the same speech can retry without releasing a newer lease',async t=>{
  const {AsrGate}=require('../src/voice/asr-gate.cjs'),f=fixture(t),gate=new AsrGate();f.save(f.config);let attempts=0;
  const h=harness({close:()=>{if(++attempts===1)throw Object.assign(Error('synthetic exit failure'),{code:'voice_exit_timeout'});}}),runtime=h.createVoiceRuntime({root:f.root,backend:'local-neural',acquireAsrLease:()=>gate.acquire({scopeId:'desktop',jobId:'old'})});
  await assert.rejects(runtime.speech.close(),{code:'voice_exit_timeout'});assert.throws(()=>gate.acquire({scopeId:'qq',jobId:'new'}),{code:'busy'});await runtime.speech.close();const next=gate.acquire({scopeId:'qq',jobId:'new'});await runtime.speech.close();next.assertCurrent();next.release();
});

test('capability probes close and release their lease on both successful and failed discovery',async t=>{
  const {AsrGate}=require('../src/voice/asr-gate.cjs');for(const failed of [false,true]){const f=fixture(t),gate=new AsrGate();f.save(f.config);const h=harness({capabilities:async()=>{if(failed)throw Error('synthetic discovery failure');return {recognizers:[],voices:[]};}}),options={root:f.root,backend:'local-neural',acquireAsrLease:()=>gate.acquire({scopeId:'caps',jobId:'probe'})};
    if(failed)await assert.rejects(h.voiceCapabilities(options),/synthetic discovery failure/);else assert.equal((await h.voiceCapabilities(options)).selectedBackend,'local-neural');assert.equal(h.instances[0].closes,1);const next=gate.acquire({scopeId:'qq',jobId:'new'});next.release();
  }
});

test('a capability-close failure keeps the exact provider reachable through gate recovery',async t=>{
  const {AsrGate}=require('../src/voice/asr-gate.cjs'),f=fixture(t),gate=new AsrGate();f.save(f.config);let attempts=0;
  const h=harness({close:()=>{if(++attempts===1)throw Object.assign(Error('synthetic close failure'),{code:'voice_exit_timeout'});}}),options={root:f.root,backend:'local-neural',acquireAsrLease:()=>gate.acquire({scopeId:'caps',jobId:'probe'})};
  await assert.rejects(h.voiceCapabilities(options),{code:'voice_exit_timeout'});assert.equal(h.instances.length,1);assert.throws(()=>gate.acquire({scopeId:'qq',jobId:'new'}),{code:'busy'});
  await Promise.all([gate.retryCleanup(),gate.retryCleanup()]);assert.equal(h.instances[0].closes,2);assert.equal(h.instances.length,1);const next=gate.acquire({scopeId:'qq',jobId:'new'});next.release();
});

test('QQ render revision is stable for unchanged files and changes with runtime/reference/model metadata',t=>{
 const f=fixture(t),h=harness(),base=path.join(f.config.ttsRepository,'GPT_SoVITS');f.save(f.config);
 const names=['TTS_infer_pack/TTS.py','pretrained_models/s1v3.ckpt','pretrained_models/v2Pro/s2Gv2ProPlus.pth','pretrained_models/sv/pretrained_eres2netv2w24s4ep4.ckpt','pretrained_models/chinese-hubert-base/pytorch_model.bin','pretrained_models/chinese-roberta-wwm-ext-large/pytorch_model.bin','text/G2PWModel/g2pW.onnx'];
 for(const name of names){const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic only');}
 let previous=h.voiceRenderRevision({root:f.root});assert.match(previous,/^[a-f0-9]{64}$/);assert.equal(h.voiceRenderRevision({root:f.root}),previous);
 for(const file of [f.config.referenceAudio,f.config.ttsPython,...names.map(n=>path.join(base,n))]){fs.appendFileSync(file,'changed');const next=h.voiceRenderRevision({root:f.root});assert.notEqual(next,previous);previous=next;}
 fs.unlinkSync(path.join(base,names[0]));assert.throws(()=>h.voiceRenderRevision({root:f.root}),{code:'voice_render_unavailable'});assert.equal(h.ttsInstances.length,0);assert.equal(h.asrInstances.length,0);
});

test('discovery delegates exact-runtime cleanup and lets its owner retry a failed close without replacement',async()=>{
  let attempts=0,owned;const h=harness({capabilities:async()=>{throw Error('synthetic discovery rejected');},close:async()=>{if(++attempts===1)throw Error('synthetic close unconfirmed');}});
  await assert.rejects(h.voiceCapabilities({backend:'windows',closeRuntime:speech=>{owned=speech;return speech.close();}}),/close unconfirmed/);
  assert.equal(owned,h.instances[0]);assert.equal(h.instances.length,1);assert.equal(attempts,1);
  await owned.close();assert.equal(attempts,2);assert.equal(h.instances.length,1);
});
