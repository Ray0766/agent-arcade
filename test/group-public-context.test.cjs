'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {GroupPublicContext,MAX_ROWS,MAX_BYTES,MAX_AGE}=require('../src/bot/group-public-context.cjs');
const digest=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-public-'))),file=path.join(root,'context.json'),scope=digest('group-role'),state={now:1800000000000};t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return{root,file,scope,state,open:()=>new GroupPublicContext({file,scope,now:()=>state.now}),row:(index,text='public input')=>({id:digest('row-'+index),kind:'member',speaker:'a'.repeat(16),replyTo:null,text,at:state.now})};}
test('public context persists complete attributed rows and refuses another scope',t=>{
 const f=fixture(t),store=f.open();store.append(f.row(1));store.append({...f.row(2,'confirmed reply'),kind:'character',speaker:'claude-ju',replyTo:'a'.repeat(16)});
 assert.deepEqual(f.open().view(),store.view());assert.throws(()=>new GroupPublicContext({file:f.file,scope:digest('other-group')}),{code:'group_storage_unavailable'});
 const copy=store.view();copy[0].text='mutated view';assert.equal(store.view()[0].text,'public input');
});
test('the projection bounds rows/UTF-8 bytes and expires active context without truncating JSON rows',t=>{
 const f=fixture(t),store=f.open();
 for(let i=0;i<MAX_ROWS+9;i++)store.append(f.row(i,('引号"和反斜线\\').repeat(160)));
 assert(store.view().length<=MAX_ROWS);assert(fs.statSync(f.file).size<=MAX_BYTES);assert.equal(store.view().at(-1).id,f.row(MAX_ROWS+8).id);
 assert.deepEqual(f.open().view(),store.view());assert(store.view().every(r=>r.text===('引号"和反斜线\\').repeat(160)));
 f.state.now+=MAX_AGE+1;assert.deepEqual(store.view(),[]);store.append(f.row(100,'fresh topic'));assert.equal(f.open().view().length,1);
});
test('malformed, oversized and linked context files fail closed without replacement',t=>{
 const f=fixture(t),store=f.open();store.append(f.row(1));const bytes=fs.readFileSync(f.file);fs.writeFileSync(f.file,'{"schema":1,"rows":[');assert.throws(f.open,{code:'group_storage_unavailable'});
 assert.equal(fs.readFileSync(f.file,'utf8'),'{"schema":1,"rows":[');
 fs.writeFileSync(f.file,'x'.repeat(MAX_BYTES+1));assert.throws(f.open,{code:'group_storage_unavailable'});
 const target=path.join(f.root,'target.json');fs.writeFileSync(target,bytes);fs.unlinkSync(f.file);fs.symlinkSync(target,f.file);assert.throws(f.open,{code:'group_storage_unavailable'});assert.deepEqual(fs.readFileSync(target),bytes);
});
test('failed persistence preserves the previous in-memory projection; reset is durable and scoped',t=>{
 const f=fixture(t),store=f.open();store.append(f.row(1));const old=store.view(),blocked=path.join(f.root,'not-a-directory');fs.writeFileSync(blocked,'owned fixture');store.file=path.join(blocked,'context.json');assert.throws(()=>store.append(f.row(2)),{code:'group_storage_unavailable'});assert.deepEqual(store.view(),old);
 store.file=f.file;store.reset();assert.deepEqual(f.open().view(),[]);
});
