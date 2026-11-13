'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { createWindowsProcessHost } = require('../src/bot/qq-runtime.cjs');

async function supervisor(t) {
  const startedAt=performance.now(), id = randomUUID(), host = createWindowsProcessHost(), workerPids = [], proofs = [];
  const diagnostics = { schema:'native-shell-host-fixture-v2', id, test:t.name, at:new Date().toISOString(), spawned:null, captures:[], cleanup:[], originalCleanupFailure:null, privateIPCShutdown:null, finalObservation:null, realQQ:false };
  const child = fork(path.join(__dirname, 'helpers', 'qq-respawn-process.cjs'), [], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  diagnostics.spawned = { parentPid:child.pid, supervisorScript:path.join(__dirname,'helpers','qq-respawn-process.cjs') };
  let exited = false;
  const exit = new Promise(resolve => child.once('exit', (code,signal) => { exited=true; resolve({code,signal}); }));
  const key = row => `${row.pid}\0${row.createdAt}\0${row.executable.toLowerCase()}`;
  const inspect = async stage => { const pids=[...new Set([child.pid,...workerPids,...proofs.map(p=>p.pid)])].filter(Number.isSafeInteger);const rows=pids.length?await host.inspect(pids):[];diagnostics.cleanup.push({stage,rows});return rows; };
  const exact = rows => proofs.filter((proof,index) => proofs.findIndex(p=>key(p)===key(proof))===index && rows.some(row=>key(row)===key(proof)));
  // Register before startup waiting, CIM capture or any assertion can fail.
  t.after(async () => {
    let failure;
    try {
      const rows = await inspect('before-stop');
      // An assertion may have failed after the helper announced a replacement
      // but before its body captured that row. The private IPC announcement plus
      // a still-matching parent and observed parent chain is a new exact proof.
      if(proofs[0]&&rows.some(row=>key(row)===key(proofs[0])))for(const row of rows){
        if(workerPids.includes(row.pid)&&row.parentPid===child.pid&&row.executable.toLowerCase()===proofs[0].executable.toLowerCase()&&!proofs.some(p=>key(p)===key(row))){const proof={pid:row.pid,createdAt:row.createdAt,executable:row.executable};proofs.push(proof);diagnostics.captures.push({stage:'cleanup-owned-replacement',rows:[row]});}
      }
      diagnostics.cleanup.push({stage:'proof-disposition',proofs:proofs.map(proof=>({proof,observation:rows.some(row=>key(row)===key(proof))?'matching':rows.some(row=>row.pid===proof.pid)?'different-identity-left-untouched':'absent'}))});
      if (proofs.length < 2 && !exited) throw Error('fixture setup did not capture the complete owned pair');
      const current = exact(rows);
      if (current.length) {
        const trace=[];diagnostics.cleanup.push({stage:'host-stop',proofs:current,trace});
        try { await host.stop(current,{onTrace:event=>trace.push(event)}); }
        catch(error) { diagnostics.originalCleanupFailure={name:error.name,code:error.code||null,message:error.message};throw error; }
      }
      const after = await inspect('after-stop');
      assert.equal(exact(after).length,0,'captured fixture process still alive');
      if (!exited) await Promise.race([exit,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('supervisor exit not observed')),1500);timer.unref();})]);
    } catch(error) {
      failure=error;
      // A failed production stop still fails this test. The isolated fixture's
      // original fork IPC may only ask its own supervisor to close its handles.
      if (!exited && child.connected) {
        try {
          child.send({type:'stop-fixture'});
          const terminal=await Promise.race([exit,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('private fixture shutdown timed out')),3000);timer.unref();})]);
          diagnostics.privateIPCShutdown={exited:true,...terminal};
        } catch(settlement) { diagnostics.privateIPCShutdown={exited:false,message:settlement.message}; }
      }
      // A partial stop may already have ended the supervisor. In that case its
      // IPC cannot help. A single exact remaining-proof retry is bounded by the
      // original test budget; it never erases the first stop failure.
      if(exited&&performance.now()-startedAt<6500){
        try{const remaining=exact(await inspect('settlement-after-parent-exit'));if(remaining.length){const trace=[];diagnostics.cleanup.push({stage:'exact-survivor-settlement',proofs:remaining,trace});await host.stop(remaining,{onTrace:event=>trace.push(event)});}}
        catch(settlement){diagnostics.cleanup.push({stage:'exact-survivor-settlement-failed',code:settlement.code||null,message:settlement.message});}
      }
    } finally {
      // IPC release must not depend on host.stop succeeding.
      if (child.connected) child.disconnect();
      try { const rows=await inspect('final-independent-observation');diagnostics.finalObservation={rows,matchingProofs:exact(rows)};if(exact(rows).length&&!failure)failure=Error('fixture cleanup left exact owned processes'); }
      catch(error) { diagnostics.finalObservation={code:error.code||null,message:error.message};if(!failure)failure=error; }
      const directory=path.resolve(__dirname,'../outputs');fs.mkdirSync(directory,{recursive:true});
      const receipt=path.join(directory,`qq-shell-host-fixture-${id}.json`);fs.writeFileSync(receipt,JSON.stringify(diagnostics,null,2)+'\n',{flag:'wx'});t.diagnostic(`Native fixture identities and cleanup: ${receipt}`);
    }
    if (failure) throw failure;
  });
  child.on('message', value => {
    if (Number.isSafeInteger(value?.workerPid)) workerPids.push(value.workerPid);
    if(value?.type==='fixture-stopped'||value?.type==='fixture-shutdown-failed')diagnostics.cleanup.push({stage:'private-fixture-message',message:value});
  });
  const workerPid = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('worker startup timed out')), 5000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('message', value => { clearTimeout(timeout); resolve(value.workerPid); });
  });
  const rows = await host.inspect([child.pid, workerPid]);
  diagnostics.captures.push({stage:'initial',rows});
  const parent = rows.find(row => row.pid === child.pid);
  const worker = rows.find(row => row.pid === workerPid);
  assert(parent && worker);
  assert.equal(worker.parentPid, parent.pid);
  proofs.push(...[parent, worker].map(({ pid, createdAt, executable }) => ({ pid, createdAt, executable })));
  return { host, child, workerPids, proofs, diagnostics };
}

test('native Shell stop prevents a live supervisor from replacing its worker', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async t => {
  const fixture = await supervisor(t), events = [];
  await fixture.host.stop(fixture.proofs, { onTrace: event => events.push(event) });
  const rows = await fixture.host.inspect(fixture.proofs.map(p => p.pid));
  assert.equal(rows.length, 0);
  assert.deepEqual(fixture.workerPids, [fixture.proofs[1].pid]);
  const terminated = events.filter(event => event.step === 'terminate').map(event => event.pid);
  assert.equal(terminated[0], fixture.proofs[0].pid);
  // Some Windows hosts also reap a dependent worker when its parent exits.
  // The contract is no replacement and no survivors, not redundant Kill calls.
  assert(terminated.every(pid => fixture.proofs.some(proof => proof.pid === pid)));
});

test('the fixture reproduces replacement when a worker stops before its supervisor', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async t => {
  const fixture = await supervisor(t);
  const replacement = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('replacement not observed')), 5000);
    fixture.child.once('message', value => { clearTimeout(timer); resolve(value.workerPid); });
  });
  await fixture.host.stop([fixture.proofs[1]]);
  const replacementPid = await replacement;
  const [row] = await fixture.host.inspect([replacementPid]);
  fixture.diagnostics.captures.push({stage:'replacement',rows:row?[row]:[]});
  assert(row); assert.equal(row.parentPid, fixture.proofs[0].pid);
  fixture.proofs.push({ pid: row.pid, createdAt: row.createdAt, executable: row.executable });
  assert.equal(fixture.workerPids.length, 2);
});

test('native Shell identity mismatch leaves both live fixture processes untouched', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async t => {
  const fixture = await supervisor(t);
  const wrong = fixture.proofs.map(proof => ({ ...proof }));
  wrong[1].createdAt = '2000-01-01T00:00:00.0000000Z';
  await assert.rejects(fixture.host.stop(wrong), { code: 'stop_failed' });
  const remaining = await fixture.host.inspect(fixture.proofs.map(p => p.pid));
  assert.equal(remaining.length, 2);
  assert.deepEqual(fixture.workerPids, [fixture.proofs[1].pid]);
});
