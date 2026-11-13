'use strict';
const {until}=require('./helpers/until.cjs');
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,deferred}=require('./helpers/qq-node-repair-fixture.cjs'),F=require('../src/bot/qq-node-repair-fs.cjs'),M=require('../src/bot/qq-managed-node-repair-metadata.cjs');
const prep=async f=>f.helper.preview({observationId:(await f.helper.inspect()).observationId});
const ticket=p=>({ticketId:p.ticketId,expectedDigest:p.expectedDigest});
const error=code=>Object.assign(Error('Synthetic failure'),{code});
test('damaged shared code repair preserves both descriptors, manifest and account directory objects; old tree retires explicitly',async t=>{
 const f=fixture(t),before=f.records.map(r=>fs.readFileSync(r.paths.descriptor)),manifest=fs.readFileSync(f.p.manifestPath);const p=await prep(f);assert.equal(p.scope.installations.length,2);assert.equal(fs.readFileSync(path.join(f.p.codeRoot,'index.js'),'utf8'),'SYNTHETIC_DAMAGED_CODE');
 const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,true);assert.equal(r.readback,'full-manifest');assert.equal(r.oldTreeRetained,true);assert(fs.readFileSync(f.p.manifestPath).equals(manifest));f.records.forEach((v,i)=>assert(fs.readFileSync(v.paths.descriptor).equals(before[i])));assert.equal(M.assertManagedNodeRepairReady({root:f.root}),undefined);
 assert.throws(()=>f.helper.confirm(ticket(p)),{code:'preview_required'});const i=await f.helper.inspect();assert.equal(i.state,'healthy');const retired=await f.helper.retireConfirm(ticket(await f.helper.retirePreview({operationId:p.operationId})));assert.equal(retired.retired,true);assert.equal((await f.helper.inspect()).retention.records,0);
});
test('missing original publishes without an old-tree rename and preserves an absent-original receipt',async t=>{
 const f=fixture(t,{missingCode:true}),p=await prep(f);assert.equal(p.previousTree,'absent');const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,true);assert.equal(r.oldTreeRetained,false);assert.equal(r.liveCode,'same-version-verified');
});
test('missing original can dismiss, explicitly abandon, then retire the staged tree without creating live code',async t=>{
 const f=fixture(t,{missingCode:true}),p=await prep(f);await f.helper.dismiss();const i=await f.helper.inspect();assert.deepEqual(i.pending[0].decisions,['abandon-prepared']);const q=await f.helper.reconcilePreview({operationId:p.operationId,decision:'abandon-prepared'});assert.equal(q.effects.removesOwnedDisposableStage,false);const r=await f.helper.reconcileConfirm(ticket(q));assert.equal(r.committed,true);assert.equal(r.readback,'original-proof');assert(!fs.existsSync(f.p.codeRoot));const retired=await f.helper.retireConfirm(ticket(await f.helper.retirePreview({operationId:p.operationId})));assert.equal(retired.retired,true);assert(!fs.existsSync(f.p.codeRoot));
});
test('expiry, scope change and a later running process each prevent first live mutation',async t=>{
 for(const mode of ['expiry','scope','running']){const f=fixture(t),p=await prep(f);if(mode==='expiry')f.state.mono+=300000;else if(mode==='scope')f.state.epoch++;else f.state.rows=[{pid:123,name:'node.exe',executable:path.join(f.p.codeRoot,'node.exe')}];const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,false,mode);assert.equal(r.liveCode,'unchanged');assert.equal(fs.readFileSync(path.join(f.p.codeRoot,'index.js'),'utf8'),'SYNTHETIC_DAMAGED_CODE');}
});
test('final process await rechecks source membership/stat before moving, even with unchanged file size',async t=>{
 const f=fixture(t),p=await prep(f);let n=0;f.state.onSnapshot=()=>{if(++n===2)fs.writeFileSync(path.join(f.p.codeRoot,'index.js'),'SYNTHETIC_CHANGED_CODE');};const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,false);assert.equal(r.recoveryRequired,true);assert.equal(fs.readFileSync(path.join(f.p.codeRoot,'index.js'),'utf8'),'SYNTHETIC_CHANGED_CODE');assert.throws(()=>M.assertManagedNodeRepairReady({root:f.root}),{code:'node_repair_recovery_required'});
});
test('same-byte prepared-record replacement is not adopted by an already issued ticket',async t=>{
 const f=fixture(t),p=await prep(f),file=path.join(f.p.operationsRoot,p.operationId,'prepared.json'),replacement=path.join(f.temp,'same-bytes');fs.writeFileSync(replacement,fs.readFileSync(file));fs.renameSync(replacement,file);const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,false);assert.equal(r.code,'node_repair_changed');
});
test('durable intent without pending link still reports startup recovery required',async t=>{
 const f=fixture(t),p=await prep(f);f.io.linkSync=()=>{throw error('EIO');};const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,false);assert.equal(r.recoveryRequired,true);assert.throws(()=>M.assertManagedNodeRepairReady({root:f.root}),{code:'node_repair_recovery_required'});f.io.linkSync=fs.linkSync;
});
test('a failed second rename leaves explicit complete/restore choices and ordinary startup blocked',async t=>{
 const f=fixture(t),p=await prep(f);f.io.renameSync=(from,to)=>{if(path.basename(from)==='staged-code')throw error('EIO');return fs.renameSync(from,to);};const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,null);assert(!fs.existsSync(f.p.codeRoot));f.io.renameSync=fs.renameSync;await f.helper.close();f.helper=f.make();const i=await f.helper.inspect();assert.deepEqual(i.pending[0].decisions,['complete-prepared','restore-original']);const q=await f.helper.reconcilePreview({operationId:p.operationId,decision:'complete-prepared'});assert.equal((await f.helper.reconcileConfirm(ticket(q))).readback,'full-manifest');
});
test('restore original after an interrupted first move preserves damaged bytes and does not claim repaired',async t=>{
 const f=fixture(t),p=await prep(f);f.io.renameSync=(from,to)=>{if(path.basename(from)==='staged-code')throw error('EIO');return fs.renameSync(from,to);};await f.helper.confirm(ticket(p));f.io.renameSync=fs.renameSync;const q=await f.helper.reconcilePreview({operationId:p.operationId,decision:'restore-original'});const r=await f.helper.reconcileConfirm(ticket(q));assert.equal(r.committed,true);assert.equal(r.liveCode,'original-restored');assert.equal(r.oldTreeRetained,false);assert.equal(r.readback,'original-proof');assert.equal((await f.helper.inspect()).state,'damaged');assert.equal((await f.helper.retireConfirm(ticket(await f.helper.retirePreview({operationId:p.operationId})))).retired,true);
});
test('reconcile rename applied then throws retains known publication and offers acknowledgement without replay',async t=>{
 const f=fixture(t),p=await prep(f);f.io.renameSync=(from,to)=>{if(path.basename(from)==='staged-code')throw error('EIO');return fs.renameSync(from,to);};await f.helper.confirm(ticket(p));f.io.renameSync=fs.renameSync;const q=await f.helper.reconcilePreview({operationId:p.operationId,decision:'complete-prepared'});let moves=0;f.io.renameSync=(from,to)=>{moves++;fs.renameSync(from,to);throw error('EIO');};const r=await f.helper.reconcileConfirm(ticket(q));assert.equal(r.committed,true);assert.equal(r.readback,'full-manifest');assert.equal(r.recoveryRequired,true);f.io.renameSync=()=>assert.fail('Acknowledgement must not rename');const next=await f.helper.reconcilePreview({operationId:p.operationId,decision:'acknowledge-complete'});assert.equal((await f.helper.reconcileConfirm(ticket(next))).committed,true);assert.equal(moves,1);f.io.renameSync=fs.renameSync;
});
test('post-publication content damage is committed but unverified, never claimed full-manifest',async t=>{
 const f=fixture(t),p=await prep(f);f.io.renameSync=(from,to)=>{fs.renameSync(from,to);if(path.basename(from)==='staged-code')fs.writeFileSync(path.join(to,'index.js'),'SYNTHETIC_LATE_DAMAGE');};const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,true);assert.equal(r.liveCode,'unverified');assert.equal(r.readback,'unavailable');assert.equal(r.recoveryRequired,true);
});
test('ticket deadline after the first move cannot erase a fully verified publication',async t=>{
 const f=fixture(t),p=await prep(f);f.io.renameSync=(from,to)=>{fs.renameSync(from,to);f.state.mono+=300001;};const r=await f.helper.confirm(ticket(p));assert.equal(r.committed,true);assert.equal(r.readback,'full-manifest');
});
test('ordinary known preparation failure and cancelled held preparation become explicitly retireable history',async t=>{
 for(const mode of ['failure','cancel']){const f=fixture(t);if(mode==='failure'){f.state.partial=true;f.state.stageError='archive_invalid';await assert.rejects(prep(f),{code:'archive_invalid'});}else{const i=await f.helper.inspect();f.state.stageHeld=deferred();const preparing=f.helper.preview({observationId:i.observationId});await until(()=>f.state.stageCalls);const dismiss=f.helper.dismiss();f.state.stageHeld.resolve();await assert.rejects(preparing,{code:'cancelled'});await dismiss;}const i=await f.helper.inspect();assert.equal(i.pending.length,0,mode);assert.equal(i.history.length,1);assert.equal(i.history[0].state,'abandoned');assert.equal(i.history[0].canRetire,true);const q=await f.helper.retirePreview({operationId:i.history[0].operationId});assert.equal((await f.helper.retireConfirm(ticket(q))).retired,true);}
});
test('partial history retirement remains discoverable after operation directory removal; ordinary startup stays ready',async t=>{
 const f=fixture(t),p=await prep(f);await f.helper.confirm(ticket(p));const q=await f.helper.retirePreview({operationId:p.operationId});let failed=false;f.io.unlinkSync=file=>{if(file===path.join(f.p.retirementsRoot,p.operationId+'.json')&&!failed){failed=true;throw error('EIO');}return fs.unlinkSync(file);};const r=await f.helper.retireConfirm(ticket(q));assert.equal(r.committed,null);assert(!fs.existsSync(path.join(f.p.operationsRoot,p.operationId)));assert.equal(M.assertManagedNodeRepairReady({root:f.root}),undefined);const i=await f.helper.inspect();assert.equal(i.history[0].canResumeRetirement,true);f.io.unlinkSync=fs.unlinkSync;const again=await f.helper.retirePreview({operationId:p.operationId});assert.equal(again.resume,true);assert.equal((await f.helper.retireConfirm(ticket(again))).retired,true);
});
test('an ended earlier backup remains retireable after a later same-version repair',async t=>{
 const f=fixture(t),a=await prep(f);await f.helper.confirm(ticket(a));fs.writeFileSync(path.join(f.p.codeRoot,'index.js'),'NEW_DAMAGE');const b=await prep(f);await f.helper.confirm(ticket(b));const i=await f.helper.inspect();assert.equal(i.history.length,2);assert(i.history.every(x=>x.canRetire));const q=await f.helper.retirePreview({operationId:a.operationId});assert.equal((await f.helper.retireConfirm(ticket(q))).retired,true);
});
test('dismiss/close retains failed stage ownership and permits exact cleanup retry',async t=>{
 const f=fixture(t);await prep(f);f.state.closeError=true;await assert.rejects(f.helper.close(),{code:'node_repair_cleanup_unconfirmed'});assert.equal(f.helper.closed,false);assert.equal(f.helper.stages.size,1);f.state.closeError=false;assert.equal((await f.helper.close()).closed,true);
});
test('completed, restored and abandoned terminals with an unremoved pending link reopen for explicit settlement only',async t=>{
 for(const mode of ['completed','restored','abandoned']){const f=fixture(t),p=await prep(f);let first;
  if(mode==='restored'){f.io.renameSync=(from,to)=>{if(path.basename(from)==='staged-code')throw error('EIO');fs.renameSync(from,to);};await f.helper.confirm(ticket(p));f.io.renameSync=fs.renameSync;}
  f.io.unlinkSync=file=>{if(file===f.p.pending)throw error('EIO');fs.unlinkSync(file);};
  if(mode==='completed')first=await f.helper.confirm(ticket(p));else first=await f.helper.reconcileConfirm(ticket(await f.helper.reconcilePreview({operationId:p.operationId,decision:mode==='restored'?'restore-original':'abandon-prepared'})));
  assert.equal(first.committed,true,mode);assert.equal(first.recoveryRequired,true);await f.helper.close();f.helper=f.make();const i=await f.helper.inspect();assert.deepEqual(i.pending[0].decisions,['acknowledge-complete'],mode);assert.equal(i.history.length,0);
  f.io.renameSync=()=>assert.fail('Settling a terminal must not repeat a move');const again=await f.helper.reconcileConfirm(ticket(await f.helper.reconcilePreview({operationId:p.operationId,decision:'acknowledge-complete'})));assert.equal(again.committed,true);assert.equal(again.recoveryRequired,true);
  f.io.unlinkSync=fs.unlinkSync;const settled=await f.helper.reconcileConfirm(ticket(await f.helper.reconcilePreview({operationId:p.operationId,decision:'acknowledge-complete'})));assert.equal(settled.committed,true);assert.equal(settled.recoveryRequired,false);assert.equal(settled.readback,mode==='completed'?'full-manifest':'original-proof');assert.equal(settled.liveCode,mode==='completed'?'same-version-verified':mode==='restored'?'original-restored':'unchanged');f.io.renameSync=fs.renameSync;
 }
});
