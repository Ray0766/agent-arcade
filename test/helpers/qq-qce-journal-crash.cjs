'use strict';

// Report progress only after each synchronous journal operation returns.
process.send('ready');
const {QCEExportJobs}=require('../../src/bot/qq-qce-export-jobs.cjs');
const {vault}=require('./qq-transfer-fixture.cjs');
const {root,scope,input}=JSON.parse(process.env.QCE_SYNTHETIC_CHILD);
const journal=new QCEExportJobs({root,vault:vault(Buffer.alloc(32,19))});
const row=journal.begin(scope,input);
process.send('prepared');
journal.change(scope,row.operationId,row.revision,'attempted');
process.send('attempted',error=>{
  if(error)throw error;
  process.exit(86);
});
