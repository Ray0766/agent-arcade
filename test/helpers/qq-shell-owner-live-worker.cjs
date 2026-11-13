'use strict';
// A real manager process, exited explicitly after durable runtime proof.
const fs=require('node:fs'),{load,waitNative}=require('./qq-shell-owner-live-fixture.cjs');
async function main(){const config=JSON.parse(fs.readFileSync(process.argv[2])),r=load(config,{detached:process.argv[3]==='detached'});await r.manager.start(config.expectedQQ);const rows=await waitNative(r);await r.manager.discover();const lease=JSON.parse(fs.readFileSync(r.leasePath));if(!lease.runtime||lease.runtimeTree.length<2)throw Error('complete runtime proof required');process.stdout.write(JSON.stringify({rows,leaseVersion:lease.version})+'\n');process.stdin.once('data',()=>process.exit(86));}
main().catch(e=>{process.stderr.write(String(e.code||e.message)+'\n');process.exitCode=1;});
