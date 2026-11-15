'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {runCases,referenceContext,oracleContext,contextObservation,cli}=require('../scripts/companion-cases.cjs');
const sourceRoot=path.resolve(__dirname,'..'),fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/companion-cases.json'),'utf8'));

test('the fixed cases declare ten memory, six notice and four recovery scenarios',()=>{
 assert.equal(fixture.cases.length,20);assert.equal(new Set(fixture.cases.map(row=>row.id)).size,20);
 for(const [group,count] of [['M',10],['N',6],['E',4]])assert.equal(fixture.cases.filter(row=>row.id.startsWith(group)).length,count);
 assert.equal(fixture.cases.find(row=>row.id==='M09').exploratory,true);assert.equal(fixture.budgetChars,6000);
});

test('the history-only reference has exactly its declared count and character bounds',()=>{
 const history=Array.from({length:30},(_,index)=>({role:'user',text:'CASE_'+index+' '+ 'x'.repeat(500)}));
 const context=referenceContext(history,fixture);assert(context.length<=6000);const rendered=JSON.parse(context),rows=rendered.messages;assert.deepEqual(rendered.persona,fixture.persona);const oracle=JSON.parse(oracleContext(['CURRENT_FACT'],fixture));assert.deepEqual(oracle.persona,fixture.persona);assert.deepEqual(oracle.facts,[{text:'CURRENT_FACT'}]);
 assert(rows.length<=20);assert(!context.includes('CASE_0 '));assert.equal(rows.at(-1).text,history.at(-1).text);
 const observed=contextObservation('corrected value',['corrected'],['obsolete']);assert.equal(observed.required[0].found,true);assert.equal(observed.forbidden[0].found,false);
 assert.deepEqual(cli(['--cases','M01,M03','--source-root','/tmp/source']),{sourceRoot:'/tmp/source',output:null,caseIds:['M01','M03']});assert.throws(()=>cli(['--source-root']));
});

test('the harness exercises real service persistence, refusal, correction, event dedupe and SQLite recovery',async()=>{
 const report=await runCases({sourceRoot,caseIds:['M01','M03','M04','N01','E04']});
 assert.equal(report.summary.cases,5);assert.equal(report.summary.errors,0,JSON.stringify(report.cases.filter(row=>row.error)));
 assert.equal(report.summary.requiredFailures,0,JSON.stringify(report.cases.filter(row=>row.status!=='pass')));
 assert.equal(report.boundaries.unexpectedFetchAttempts,0);assert.equal(report.boundaries.realModels,false);assert.equal(report.boundaries.temporaryDataRemoved,true);
 assert(report.source.loadedFiles.some(row=>row.file==='src/bot/local-companion.cjs'));assert.match(report.fixtureSha256,/^[a-f0-9]{64}$/);
 const recall=report.cases.find(row=>row.id==='M01');assert(recall.contexts[0].required[0].found);assert.equal(recall.reference.historyOnly.required[0].found,false);assert.equal(recall.reference.oracle.required[0].found,true);
});

test('recurring notebook cases report a missing production context as a required failure, rather than a successful synthetic answer',async()=>{
 const report=await runCases({sourceRoot,caseIds:['M10']});const row=report.cases[0];assert.equal(report.summary.errors,0,JSON.stringify(row.error));assert.equal(row.contexts.length,2);
 const bothPresent=row.contexts.every(context=>context.required.every(item=>item.found));
 assert.equal(row.status,bothPresent?'pass':'fail');assert.equal(row.reference.oracle.kind,'explicit-owner-approved-notebook-reference');
 assert.equal(Object.hasOwn(row,'modelAnswerCorrect'),false);
});
