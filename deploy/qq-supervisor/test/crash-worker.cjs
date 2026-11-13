'use strict';
// Test-only intentional exit of this exact owned supervisor process.
const fs=require('node:fs'),{createService}=require('../../../src/qq-supervisor/server.cjs'),{managedRuntime}=require('./runtime-fixture.cjs'),{material}=require('./helpers.cjs');
async function main(){const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),mode=process.argv[3];const r=managedRuntime(config,{realProcess:true}),service=await createService({config,tls:material,runtimeFactory:()=>r.adapter,...(mode==='attempted'?{storeOptions:{hook:phase=>{if(phase==='afterCommit')process.exit(86);}}}:{})});await service.listen();process.stdout.write(JSON.stringify({port:service.server.address().port,ledgerId:service.store.ledgerId})+'\n');process.stdin.once('data',()=>process.exit(86));}
main().catch(()=>{process.stderr.write('synthetic_worker_failed\n');process.exitCode=1;});
