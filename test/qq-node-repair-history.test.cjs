'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const F=require('../src/bot/qq-node-repair-fs.cjs'),{paths}=require('../src/bot/qq-managed-node-repair-metadata.cjs'),{QQNodeRepairHistory}=require('../src/bot/qq-node-repair-history.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-history-')),p=paths(root),id=randomUUID(),op=path.join(p.operationsRoot,id),old=path.join(op,'old-code'),live=path.join(p.codeRoot,'live.txt');
 fs.mkdirSync(path.join(old,'nested'),{recursive:true});fs.mkdirSync(p.codeRoot,{recursive:true});fs.writeFileSync(live,'current-code');fs.writeFileSync(path.join(old,'a.txt'),'old-a');fs.writeFileSync(path.join(old,'nested','b.txt'),'old-b');
 for(const name of ['prepared.json','intent.json','terminal.json'])fs.writeFileSync(path.join(op,name),JSON.stringify({synthetic:name}));
 const capture={operationId:id,operationRoot:op,operationIdentity:F.identity(F.directory(op)),endedAt:Date.now(),terminalOutcome:'completed',trees:[{slot:'old-code',path:old,proof:F.tree(old)}],metadataFiles:['prepared.json','intent.json','terminal.json'].map(name=>({name,proof:F.read(path.join(op,name),{bytes:false})})),live:{versionParentIdentity:F.identity(F.directory(p.versionRoot)),codeIdentity:F.identity(F.directory(p.codeRoot)),manifestSha256:'a'.repeat(64),descriptors:[{setupId:randomUUID(),descriptorSha256:'b'.repeat(64)}]}};
 let clock=100,liveChecks=0;const io=Object.create(fs),opts={root,io,monotonic:()=>clock,captureOperation:()=>structuredClone(capture),assertLive:(c,{check})=>{check();liveChecks++;assert(F.sameIdentity(c.live.versionParentIdentity,F.directory(p.versionRoot)));assert(F.sameIdentity(c.live.codeIdentity,F.directory(p.codeRoot)));assert.equal(fs.readFileSync(live,'utf8'),'current-code');}};
 const histories=[],make=override=>{const h=new QQNodeRepairHistory({...opts,...override});histories.push(h);return h;},history=make();
 t.after(async()=>{for(const h of histories)await h.close();fs.rmSync(root,{recursive:true,force:true});});return {root,p,id,op,old,live,capture,io,history,make,tick:n=>clock+=n,checks:()=>liveChecks};
}
test('explicit confirmed retirement removes only captured backups and metadata, freeing the actual operation slot',async t=>{
 const f=fixture(t),before=fs.readFileSync(f.live),p=await f.history.preview({operationId:f.id});assert.equal(p.resume,false);assert.equal(p.retainedFileCount,2);assert(fs.existsSync(f.op));
 const r=await f.history.confirm(p);assert.equal(r.committed,true);assert.equal(r.retired,true);assert.equal(r.cleanupVerified,true);assert(!fs.existsSync(f.op));assert(!fs.existsSync(path.join(f.p.retirementsRoot,f.id+'.json')));assert(fs.readFileSync(f.live).equals(before));assert(f.checks()>5);await assert.rejects(f.history.confirm(p),{code:'preview_required'});
});
test('preview, discard, expiry and cancellation never delete the captured code',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id});f.history.discardPreview();await assert.rejects(f.history.confirm(p),{code:'preview_required'});
 const expired=await f.history.preview({operationId:f.id});f.tick(300000);const r=await f.history.confirm(expired);assert.equal(r.committed,false);assert.equal(r.code,'preview_expired');assert.equal(r.cleanupRequired,false);assert.equal(fs.readFileSync(path.join(f.old,'a.txt'),'utf8'),'old-a');
 const p2=await f.history.preview({operationId:f.id}),controller=new AbortController();controller.abort();const cancelled=await f.history.confirm({...p2,signal:controller.signal});assert.equal(cancelled.committed,false);assert.equal(cancelled.code,'cancelled');assert(fs.existsSync(f.op));
});
test('partial deletion persists an independent intent and resumes only after a new preview in a new instance',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id}),removed=[];let failed=false;
 f.io.unlinkSync=file=>{fs.unlinkSync(file);removed.push(path.basename(file));if(!failed){failed=true;throw Object.assign(Error('Injected post-delete I/O failure'),{code:'EIO'});}};
 const r=await f.history.confirm(p);assert.equal(r.committed,null);assert.equal(r.cleanupRequired,true);assert.equal(f.history.inspect(f.id).canResumeRetirement,true);assert(fs.existsSync(f.op));await f.history.close();
 f.io.unlinkSync=file=>{removed.push(path.basename(file));fs.unlinkSync(file);};const next=f.make({captureOperation:()=>assert.fail('Partial recovery must not require old terminal')});
 const resumed=await next.preview({operationId:f.id});assert.equal(resumed.resume,true);assert.equal(resumed.retainedFileCount,1);assert.equal((await next.confirm(resumed)).retired,true);
 assert(removed.indexOf('intent.json')<removed.indexOf('terminal.json'));assert(!fs.existsSync(f.op));assert.equal(fs.readFileSync(f.live,'utf8'),'current-code');
});
test('same-bytes replacement after preview is preserved',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id}),target=path.join(f.old,'a.txt'),replacement=path.join(f.root,'replacement');fs.writeFileSync(replacement,fs.readFileSync(target));const original=F.stat(target);fs.renameSync(replacement,target);assert(!F.sameIdentity(original,F.stat(target)));
 const r=await f.history.confirm(p);assert.equal(r.committed,false);assert(fs.existsSync(target));assert(!fs.existsSync(path.join(f.p.retirementsRoot,f.id+'.json')));
});
test('a live reference changed while hashing the last file blocks the following unlink',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id});let injected=false;
 f.io.readSync=(...args)=>{const n=fs.readSync(...args);if(!injected&&fs.existsSync(path.join(f.p.retirementsRoot,f.id+'.json'))&&n===5){injected=true;fs.renameSync(f.p.codeRoot,path.join(f.root,'moved-live'));fs.mkdirSync(f.p.codeRoot);fs.writeFileSync(f.live,'current-code');}return n;};
 const r=await f.history.confirm(p);assert(injected);assert.equal(r.committed,false);assert(fs.existsSync(path.join(f.old,'a.txt')));assert(fs.existsSync(path.join(f.old,'nested','b.txt')));assert.equal(r.cleanupRequired,true);
});
test('failed initial fstat and close retain an unverified owned descriptor instead of falsely closing',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id});let ownedFd,inject=true;
 f.io.openSync=(file,flags,...rest)=>{const fd=fs.openSync(file,flags,...rest);if(flags==='wx')ownedFd=fd;return fd;};
 f.io.fstatSync=(fd,...args)=>{if(fd===ownedFd&&inject)throw Object.assign(Error('Injected fstat failure'),{code:'EIO'});return fs.fstatSync(fd,...args);};
 f.io.closeSync=fd=>{if(fd===ownedFd&&inject)throw Object.assign(Error('Injected close failure'),{code:'EIO'});return fs.closeSync(fd);};
 const r=await f.history.confirm(p);assert.equal(r.committed,false);assert.equal(f.history.handles.size,1);inject=false;
 await assert.rejects(f.history.close(),{code:'node_repair_cleanup_unconfirmed'});assert.equal(f.history.handles.size,1);assert(fs.existsSync(path.join(f.old,'a.txt')));
 // Test-only exact descriptor cleanup. Production cannot invent its lost proof.
 fs.closeSync(ownedFd);await f.history.close();assert.equal(f.history.handles.size,0);
});
test('last journal unlink applied then threw is settled only by exact-parent absence readback',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id});f.io.unlinkSync=file=>{fs.unlinkSync(file);if(file===path.join(f.p.retirementsRoot,f.id+'.json'))throw Object.assign(Error('Injected final unlink failure'),{code:'EIO'});};
 const r=await f.history.confirm(p);assert.equal(r.committed,true);assert.equal(r.retired,true);assert.equal(r.cleanupRequired,false);assert(!fs.existsSync(f.op));assert(!fs.existsSync(path.join(f.p.retirementsRoot,f.id+'.json')));
});
test('abandoned preparation can retire its own stage while the originally absent current code stays absent',async t=>{
 const f=fixture(t);fs.renameSync(f.p.codeRoot,path.join(f.root,'unrelated-preserved-code'));f.capture.live.codeIdentity=null;f.capture.terminalOutcome='abandoned';const staged=path.join(f.op,'staged-code');fs.renameSync(f.old,staged);f.capture.trees=[{slot:'staged-code',path:staged,proof:F.tree(staged)}];
 const h=f.make({assertLive:(c,{check})=>{check();assert.equal(c.live.codeIdentity,null);assert(!fs.existsSync(f.p.codeRoot));assert(F.sameIdentity(c.live.versionParentIdentity,F.directory(f.p.versionRoot)));}});
 const p=await h.preview({operationId:f.id});assert.equal((await h.confirm(p)).retired,true);assert(!fs.existsSync(f.p.codeRoot));assert(fs.existsSync(path.join(f.root,'unrelated-preserved-code','live.txt')));
});
test('foreign child added during retirement remains and prevents a successful result',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id});let once=false;f.io.unlinkSync=file=>{fs.unlinkSync(file);if(!once){once=true;fs.writeFileSync(path.join(f.old,'foreign.txt'),'keep-me');}};
 const r=await f.history.confirm(p);assert.equal(r.committed,null);assert.equal(fs.readFileSync(path.join(f.old,'foreign.txt'),'utf8'),'keep-me');assert.equal(f.history.inspect(f.id).canResumeRetirement,false);await assert.rejects(f.history.preview({operationId:f.id}));
});
test('journal close failure retains exact descriptor and deliberate close retries without deleting backup',async t=>{
 const f=fixture(t),p=await f.history.preview({operationId:f.id});let fdToFail,failed=false;f.io.openSync=(file,flags,...args)=>{const fd=fs.openSync(file,flags,...args);if(flags==='wx'&&file.endsWith(f.id+'.json'))fdToFail=fd;return fd;};f.io.closeSync=fd=>{if(fd===fdToFail&&!failed){failed=true;throw Object.assign(Error('Injected close failure'),{code:'EIO'});}return fs.closeSync(fd);};
 const r=await f.history.confirm(p);assert.equal(r.committed,false);assert.equal(r.cleanupRequired,true);assert.equal(f.history.handles.size,1);assert(fs.existsSync(path.join(f.old,'a.txt')));await f.history.close();assert.equal(f.history.handles.size,0);assert.equal(fs.readFileSync(f.live,'utf8'),'current-code');
});
test('untrusted capture cannot redirect retirement to current code or another operation',async t=>{
 const f=fixture(t);for(const change of [c=>c.operationRoot=f.p.codeRoot,c=>c.trees[0].path=f.p.codeRoot,c=>c.trees[0].slot='../../code',c=>c.metadataFiles[0].name='../live.txt']){
  const h=f.make({captureOperation:()=>{const c=structuredClone(f.capture);change(c);return c;}});await assert.rejects(h.preview({operationId:f.id}));assert.equal(fs.readFileSync(f.live,'utf8'),'current-code');
 }
});
test('a captured preparation-owner record is retired before the terminal and unknown metadata still rejects',async t=>{
 const f=fixture(t),file=path.join(f.op,'preparing.json');fs.writeFileSync(file,'synthetic-owned-preparation');f.capture.metadataFiles.push({name:'preparing.json',proof:F.read(file,{bytes:false})});const removed=[];f.io.unlinkSync=p=>{removed.push(path.basename(p));fs.unlinkSync(p);};
 const p=await f.history.preview({operationId:f.id});assert.equal((await f.history.confirm(p)).retired,true);assert(removed.indexOf('preparing.json')<removed.indexOf('terminal.json'));
});
