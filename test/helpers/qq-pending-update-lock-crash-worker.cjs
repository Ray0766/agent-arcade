'use strict';
// Only this synthetic HTTPS test-service process deliberately exits 86.
const fs=require('node:fs');
const {fixture}=require('./qq-pending-update-lock-fixture.cjs');
const {QQRuntimeManager,createWindowsProcessHost}=require('../../src/bot/qq-runtime.cjs');
const {SupervisorRuntime}=require('../../src/qq-supervisor/runtime.cjs');
const {createService}=require('../../src/qq-supervisor/server.cjs');
const {SupervisorPendingUpdate}=require('../../src/qq-supervisor/pending-update.cjs');
const {SupervisorPendingLock}=require('../../src/qq-supervisor/pending-lock.cjs');
const {QQPendingUpdateRecovery}=require('../../src/bot/qq-pending-update-recovery.cjs');
const {QQPendingUpdateLockRecovery}=require('../../src/bot/qq-pending-update-lock-recovery.cjs');
const {material}=require('../../deploy/qq-supervisor/test/helpers.cjs');
(async()=>{const config=JSON.parse(fs.readFileSync(process.argv[2])),mode=process.argv[3],host=createWindowsProcessHost(),f=fixture({after(){}},{existingConfig:config,existing:mode==='guard',host}),io=Object.create(fs);
 io.linkSync=(from,to)=>{fs.linkSync(from,to);if(mode==='linked'&&from===f.marker)process.exit(86);};
 io.unlinkSync=file=>{fs.unlinkSync(file);if(mode==='unlinked'&&file===f.marker||mode==='guard'&&file===f.selection.lockFile)process.exit(86);};
 const runtime=new SupervisorRuntime(config,{managerFactory:options=>new QQRuntimeManager({...options,processHost:host,managedInstallation:()=>structuredClone(f.r.descriptor),componentSelectionFactory:()=>f.selection})});
 const service=await createService({config,tls:material,runtimeFactory:()=>runtime,pendingUpdateFactory:(c,args)=>new SupervisorPendingUpdate(c,{...args,helperFactory:options=>new QQPendingUpdateRecovery({...options,io})}),pendingUpdateLockFactory:(c,args)=>new SupervisorPendingLock(c,{...args,helperFactory:options=>new QQPendingUpdateLockRecovery({...options,io})})});
 await service.listen();process.stdout.write(JSON.stringify({port:service.server.address().port,ledgerId:service.store.ledgerId})+'\n');process.stdin.once('data',async()=>{await service.close();process.exitCode=0;process.stdin.destroy();});
})().catch(e=>{process.stderr.write(String(e.code||e.name)+'\n');process.exitCode=1;});
