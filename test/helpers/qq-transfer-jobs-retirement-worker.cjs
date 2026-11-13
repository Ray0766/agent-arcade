'use strict';
// Owned test child; only the supplied temporary SQLite store is opened.
const {QQTransferJobs}=require('../../src/bot/qq-transfer-jobs.cjs');
const {vault}=require('./qq-transfer-fixture.cjs');
const [root,mode,id,revision]=process.argv.slice(2);
const jobs=new QQTransferJobs({root,vault:vault(Buffer.alloc(32,0x5a))});
(async()=>{
 if(mode==='hold'){
  await jobs.withJob(id,{},async()=>{process.stdout.write('held\n');await new Promise(resolve=>process.stdin.once('data',resolve));});
  jobs.close();process.stdout.write('closed\n');return;
 }
 if(!['before-commit','after-commit'].includes(mode))throw new Error('Invalid synthetic worker mode.');
 const exec=jobs.db.exec.bind(jobs.db);
 jobs.db.exec=sql=>{if(sql==='COMMIT'){if(mode==='after-commit')exec(sql);process.exit(86);}return exec(sql);};
 await jobs.archive(id,revision);
 throw new Error('Synthetic crash was not reached.');
})().catch(()=>{process.exitCode=1;try{jobs.close();}catch{};});
