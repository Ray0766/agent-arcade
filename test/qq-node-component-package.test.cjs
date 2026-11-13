'use strict';
// Actual loopback HTTP streams, SHA-256 and temporary files; synthetic package
// bytes only. The VM changes only the immutable size/hash pins in its test copy.
// Production has no catalogue override and no asset is downloaded from GitHub.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {once}=require('node:events'),{Module}=require('node:module');
const moduleFile=path.resolve(__dirname,'../src/bot/qq-component-package.cjs');
const {QQComponentPackages:Production}=require(moduleFile);
const PIN={size:124162399,sha256:'77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed'};
const payload=Buffer.from('Agent Arcade original component transfer fixture.\n'.repeat(32));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const compiled=new Module(moduleFile,module);compiled.filename=moduleFile;compiled.paths=module.paths;compiled._compile(fs.readFileSync(moduleFile,'utf8').replace(`size:${PIN.size}`,`size:${payload.length}`).replace(PIN.sha256,sha(payload)),moduleFile);
const {QQComponentPackages}=compiled.exports;
const assetURL='https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.42/NapCat.Shell.Windows.Node.zip';
function metadata(pin={size:payload.length,sha256:sha(payload)}){return {id:428738017,tag_name:'v4.18.42',draft:false,prerelease:false,published_at:'2026-10-30T07:05:50Z',html_url:'https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42',assets:[{id:691263447,name:'NapCat.Shell.Windows.Node.zip',size:pin.size,digest:`sha256:${pin.sha256}`,state:'uploaded',browser_download_url:assetURL}]};}
async function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-package-'));const state={calls:[],bytes:payload,metadata:metadata(),headers:{},...options};
  const server=http.createServer((request,response)=>{
    const isMetadata=request.url==='/metadata';
    if(state.handle?.({request,response,isMetadata}))return;
    if(isMetadata){response.writeHead(200,{'content-type':'application/json'});response.end(typeof state.metadata==='string'?state.metadata:JSON.stringify(state.metadata));}
    else {response.writeHead(200,state.headers);response.write(state.bytes.subarray(0,17));response.end(state.bytes.subarray(17));}
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const transport=(url,{signal,headers})=>{
    state.calls.push(url);assert.equal(headers.Authorization,undefined);assert.equal(headers.Cookie,undefined);assert.equal(headers['Accept-Encoding'],'identity');
    return new Promise((resolve,reject)=>{const request=http.get({host:'127.0.0.1',port:server.address().port,path:url.includes('api.github.com')?'/metadata':'/asset',headers,signal},response=>resolve({statusCode:response.statusCode,headers:response.headers,body:response}));request.once('error',reject);});
  };
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,state,transport,manager:new QQComponentPackages({component:'napcat-node',root,transport,timeoutMs:1500}),dir:path.join(root,'qq-component-packages','napcat-node','4.18.42')};
}
test('production catalogue accepts only the exact official Node version, asset, size and API digest',async t=>{
  const f=await fixture(t,{metadata:metadata(PIN)}),manager=new Production({component:'napcat-node',root:f.root,transport:f.transport});const manifest=await manager.inspect();assert.equal(manifest.size,PIN.size);assert.equal(manifest.sha256,PIN.sha256);assert.equal(manifest.assetId,691263447);assert.equal(manifest.url,assetURL);assert.equal(f.state.calls.length,1);assert.deepEqual(fs.readdirSync(f.root),[]);
  for(const version of ['latest','4.18.43','../4.18.42','v4.18.42','4.18.42/../../bad'])await assert.rejects(manager.inspect({version}),{code:'invalid_request'});assert.equal(f.state.calls.length,1);
});
test('synthetic pinned bytes stream to a verified version and reuse rehashes without redownloading',async t=>{
  const f=await fixture(t),result=await f.manager.stage();assert.equal(result.state,'verified-staged');assert.equal(result.installed,false);assert.equal(result.executed,false);assert.equal(result.sha256,sha(payload));assert.deepEqual(fs.readFileSync(result.file),payload);assert.equal(result.reused,false);assert.deepEqual(fs.readdirSync(f.dir).sort(),['NapCat.Shell.Windows.Node.zip','verified.json']);assert.equal(fs.lstatSync(result.file).nlink,1);
  const second=await f.manager.stage();assert.equal(second.reused,true);assert.equal(f.state.calls.filter(url=>url===assetURL).length,1);assert.doesNotMatch(fs.readFileSync(path.join(f.dir,'verified.json'),'utf8'),/token|signed|installed/);
});
test('local verify requires the receipt, rehashes the archive and never performs network or filesystem writes',async t=>{
  const f=await fixture(t);await assert.rejects(f.manager.verify(),{code:'package_not_staged'});assert.equal(f.state.calls.length,0);assert.deepEqual(fs.readdirSync(f.root),[]);
  const staged=await f.manager.stage(),calls=f.state.calls.length,before=fs.statSync(staged.file);const verified=await f.manager.verify();assert.equal(verified.source,'local-stage-recheck');assert.equal(verified.file,staged.file);assert.equal(f.state.calls.length,calls);assert.equal(fs.statSync(staged.file).mtimeMs,before.mtimeMs);
  fs.writeFileSync(staged.file,Buffer.alloc(payload.length,1));await assert.rejects(f.manager.verify(),{code:'artifact_conflict'});assert.equal(f.state.calls.length,calls);
});
test('missing digest, replaced assets and other platform names are refused before asset transfer',async t=>{
  for(const change of [m=>delete m.assets[0].digest,m=>m.assets[0].digest='md5:abc',m=>m.assets[0].digest='sha256:'+'f'.repeat(64),m=>m.assets[0].id++,m=>m.assets[0].size++,m=>m.assets[0].name='NapCat.Framework.zip',m=>m.assets[0].name='NapCat.Framework.Windows.zip',m=>m.assets[0].browser_download_url=assetURL.replace('NapNeko','Other'),m=>m.assets.push({...m.assets[0]}),m=>m.tag_name='v4.18.43',m=>m.draft=true]){
    const f=await fixture(t);change(f.state.metadata);await assert.rejects(f.manager.stage(),error=>['digest_required','metadata_invalid'].includes(error.code));assert.equal(f.state.calls.length,1);assert.deepEqual(fs.readdirSync(f.root),[]);
  }
});
test('metadata is bounded, valid UTF-8 JSON and cannot supply arbitrary download URLs',async t=>{
  for(const value of ['x'.repeat(256*1024+1),'not JSON',[],{assets:[]}]){const f=await fixture(t,{metadata:value});await assert.rejects(f.manager.inspect(),{code:'metadata_invalid'});assert.equal(f.state.calls.length,1);}
});
test('short, oversized and digest-mismatching downloads do not become verified artifacts',async t=>{
  for(const [bytes,code]of [[payload.subarray(1),'size_mismatch'],[Buffer.concat([payload,Buffer.from('x')]),'size_mismatch'],[Buffer.alloc(payload.length,120),'digest_mismatch']]){
    const f=await fixture(t,{bytes});await assert.rejects(f.manager.stage(),{code});assert.deepEqual(fs.readdirSync(f.dir),[]);
  }
  const g=await fixture(t,{headers:{'content-length':String(payload.length+1)}});await assert.rejects(g.manager.stage(),{code:'size_mismatch'});assert.deepEqual(fs.readdirSync(g.dir),[]);
});
test('only fixed official HTTPS asset redirects are followed and redirect URLs are not persisted',async t=>{
  const f=await fixture(t);let redirects=0;f.state.handle=({isMetadata,response})=>{if(!isMetadata&&redirects++===0){response.writeHead(302,{location:'https://release-assets.githubusercontent.com/github-production-release-asset/12345/abcd-1234?sig=PRIVATE_FIXTURE_SIGNATURE'});response.end();return true;}};
  const result=await f.manager.stage();assert.equal(result.sha256,sha(payload));assert.equal(redirects,2);assert.doesNotMatch(JSON.stringify(result)+fs.readFileSync(path.join(f.dir,'verified.json'),'utf8'),/PRIVATE_FIXTURE|sig=/);
  for(const location of ['http://github.com/NapNeko/NapCatQQ/file','https://evil.example/x','https://release-assets.githubusercontent.com.evil.example/x','https://github.com/Other/Repo/file','https://user:pass@objects.githubusercontent.com/github-production-release-asset/123/a','https://objects.githubusercontent.com:444/github-production-release-asset/123/a']){
    const g=await fixture(t,{handle:({isMetadata,response})=>{if(!isMetadata){response.writeHead(302,{location});response.end();return true;}}});await assert.rejects(g.manager.stage(),{code:'transport_rejected'});assert.equal(g.state.calls.length,2);
  }
});
test('redirect loops and compressed responses are rejected with no hidden retries',async t=>{
  const f=await fixture(t,{handle:({isMetadata,response})=>{if(!isMetadata){response.writeHead(302,{location:assetURL});response.end();return true;}}});await assert.rejects(f.manager.stage(),{code:'transport_rejected'});assert.equal(f.state.calls.length,5);
  const g=await fixture(t,{headers:{'content-encoding':'gzip'}});await assert.rejects(g.manager.stage(),{code:'transport_rejected'});assert.equal(g.state.calls.length,2);
});
test('cancellation and total timeout clean only their own partial file and preserve unrelated data',async t=>{
  let begun;const started=new Promise(resolve=>{begun=resolve;});const f=await fixture(t,{handle:({isMetadata,response})=>{if(!isMetadata){response.writeHead(200);response.write(payload.subarray(0,7));begun();return true;}}});fs.writeFileSync(path.join(f.root,'keep-login-data'),'unchanged');
  const controller=new AbortController(),operation=f.manager.stage({signal:controller.signal});await started;controller.abort();await assert.rejects(operation,{code:'cancelled'});assert.deepEqual(fs.readdirSync(f.dir),[]);assert.equal(fs.readFileSync(path.join(f.root,'keep-login-data'),'utf8'),'unchanged');
  const timeout=new QQComponentPackages({component:'napcat-node',root:f.root,transport:()=>new Promise(()=>{}),timeoutMs:20});await assert.rejects(timeout.inspect(),{code:'timeout'});assert.equal(f.state.calls.length,2);
});
test('conflicting artifacts and receipts are never overwritten',async t=>{
  const f=await fixture(t);fs.mkdirSync(f.dir,{recursive:true});const file=path.join(f.dir,'NapCat.Shell.Windows.Node.zip');fs.writeFileSync(file,'original-installed-data-is-not-a-package');await assert.rejects(f.manager.stage(),{code:'artifact_conflict'});assert.equal(fs.readFileSync(file,'utf8'),'original-installed-data-is-not-a-package');assert.equal(f.state.calls.length,1);
  const g=await fixture(t);fs.mkdirSync(g.dir,{recursive:true});fs.writeFileSync(path.join(g.dir,'verified.json'),'unknown receipt');await assert.rejects(g.manager.stage(),{code:'artifact_conflict'});assert.equal(fs.readFileSync(path.join(g.dir,'verified.json'),'utf8'),'unknown receipt');assert.equal(g.state.calls.length,1);
});
test('linked directories and hardlinked artifact files are rejected without traversing them',async t=>{
  const f=await fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.root,'qq-component-packages'),'junction');await assert.rejects(f.manager.stage(),{code:'unsafe_directory'});assert.deepEqual(fs.readdirSync(outside),[]);
  const g=await fixture(t);fs.mkdirSync(g.dir,{recursive:true});const keep=path.join(g.root,'keep');fs.writeFileSync(keep,payload);fs.linkSync(keep,path.join(g.dir,'NapCat.Shell.Windows.Node.zip'));await assert.rejects(g.manager.stage(),{code:'unsafe_directory'});assert.deepEqual(fs.readFileSync(keep),payload);
});
test('an artifact appearing at promotion is preserved instead of being replaced',async t=>{
  const f=await fixture(t),copy=fs.promises.copyFile;fs.promises.copyFile=async(from,to,flags)=>{if(to===path.join(f.dir,'NapCat.Shell.Windows.Node.zip'))fs.writeFileSync(to,'concurrent foreign artifact');return copy(from,to,flags);};
  try{await assert.rejects(f.manager.stage(),{code:'artifact_conflict'});}finally{fs.promises.copyFile=copy;}
  assert.equal(fs.readFileSync(path.join(f.dir,'NapCat.Shell.Windows.Node.zip'),'utf8'),'concurrent foreign artifact');assert(!fs.existsSync(path.join(f.dir,'verified.json')));assert.equal(fs.readdirSync(f.dir).filter(name=>name.endsWith('.part')).length,0);
});
test('disk failure exposes only a fixed error and cannot alter an older package',async t=>{
  const f=await fixture(t),copy=fs.promises.copyFile;fs.writeFileSync(path.join(f.root,'older-package.zip'),'preserved');fs.promises.copyFile=async()=>{throw Object.assign(Error('PRIVATE_FILESYSTEM_PATH'),{code:'ENOSPC'});};
  try{await assert.rejects(f.manager.stage(),error=>error.code==='staging_failed'&&!error.message.includes('PRIVATE'));}finally{fs.promises.copyFile=copy;}
  assert.equal(fs.readFileSync(path.join(f.root,'older-package.zip'),'utf8'),'preserved');assert.deepEqual(fs.readdirSync(f.dir),[]);
});
test('one manager rejects overlapping staging and aborted input performs no transfer',async t=>{
  const f=await fixture(t);const controller=new AbortController();controller.abort();await assert.rejects(f.manager.stage({signal:controller.signal}),{code:'cancelled'});assert.equal(f.state.calls.length,0);
  const first=f.manager.stage();await assert.rejects(f.manager.stage(),{code:'staging_busy'});await first;assert.equal(f.state.calls.length,2);
  assert.throws(()=>new QQComponentPackages({component:'napcat-node',root:'//server/share'}),{code:'unsafe_directory'});assert.throws(()=>new QQComponentPackages({component:'napcat-node',root:f.root,timeoutMs:600001}),{code:'invalid_request'});
});
