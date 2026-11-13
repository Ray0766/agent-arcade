'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RegexLibrary,FILE_NAME,MAX_FILE_BYTES}=require('../src/bot/st/regex-library.cjs');
const {applyRegexScripts,importRegexScripts}=require('../src/vendor/sillytavern/regex-scripts.cjs');
const temp=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'aa-regex-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const script=(scriptName,findRegex,replaceString,extra={})=>({scriptName,findRegex,replaceString,placement:[2],...extra});

test('add, list in run order, get, update, reorder and remove',t=>{
  const root=temp(t);let clock=1000;
  const library=new RegexLibrary({root,now:()=>clock++});
  assert.deepEqual(library.list(),[]);
  const a=library.add(script('A','cat','dog',{id:'ffffffffffffffff',trimStrings:['x']}));
  const b=library.add(importRegexScripts(script('B','dog','bird')).scripts[0]);
  assert.match(a.id,/^[0-9a-f]{16}$/);assert.notEqual(a.id,'ffffffffffffffff');assert.notEqual(a.id,b.id);
  assert.deepEqual(a,{id:a.id,scriptName:'A',findRegex:'cat',replaceString:'dog',trimStrings:['x'],placement:['ai_output'],disabled:false,markdownOnly:false,promptOnly:false,runOnEdit:false,substituteRegex:'none',minDepth:null,maxDepth:null,addedAt:1000,updatedAt:1000});
  assert.deepEqual(library.list().map(item=>item.scriptName),['A','B']);
  assert.deepEqual(library.get(b.id),b);assert.equal(library.get('0000000000000000'),null);
  // A fresh instance reads the same file; the stored list feeds the engine directly.
  const again=new RegexLibrary({root});
  assert.equal(applyRegexScripts('cat',{scripts:again.list(),placement:'ai_output'}).text,'bird');
  assert.deepEqual(library.reorder([b.id,a.id]),[b.id,a.id]);
  assert.equal(applyRegexScripts('cat',{scripts:again.list(),placement:'ai_output'}).text,'dog');
  const updated=library.update(a.id,{disabled:true,placement:['user_input','ai_output']});
  assert.deepEqual([updated.disabled,updated.placement,updated.addedAt,updated.updatedAt,updated.findRegex],[true,['user_input','ai_output'],1000,1002,'cat']);
  assert.deepEqual(library.list().map(item=>item.id),[b.id,a.id]);
  assert.deepEqual(library.remove(b.id),{removed:true});assert.deepEqual(library.remove(b.id),{removed:false,reason:'not_found'});
  assert.deepEqual(library.list().map(item=>item.id),[a.id]);
  assert.deepEqual(fs.readdirSync(root),[FILE_NAME]);
});
test('rejects invalid input without changing the file',t=>{
  const root=temp(t);
  const library=new RegexLibrary({root,maxScripts:2});
  const a=library.add(script('A','a','b'));
  const before=fs.readFileSync(path.join(root,FILE_NAME),'utf8');
  assert.throws(()=>library.add({findRegex:'a'}),{code:'regex_script_invalid'});
  assert.throws(()=>library.add(script('X','a'.repeat(1001),'')),{code:'regex_script_invalid'});
  assert.throws(()=>library.update(a.id,{id:'0000000000000000'}),{code:'regex_script_update_invalid'});
  assert.throws(()=>library.update(a.id,{}),{code:'regex_script_update_invalid'});
  assert.throws(()=>library.update(a.id,{scriptName:''}),{code:'regex_script_invalid'});
  assert.throws(()=>library.update('0000000000000000',{disabled:true}),{code:'regex_script_not_found'});
  for(const id of ['../x','',5,'ABCDEFABCDEFABCD'])assert.throws(()=>library.get(id),{code:'regex_script_id_invalid'});
  for(const order of [[],[a.id,a.id],['0000000000000000'],'x'])assert.throws(()=>library.reorder(order),{code:'regex_script_order_invalid'});
  assert.equal(fs.readFileSync(path.join(root,FILE_NAME),'utf8'),before);
  library.add(script('B','a','b'));
  assert.throws(()=>library.add(script('C','a','b')),{code:'regex_library_full'});
  assert.throws(()=>new RegexLibrary({root:'relative'}),{code:'regex_library_invalid'});
  assert.throws(()=>new RegexLibrary({root,maxScripts:101}),{code:'regex_library_invalid'});
});
test('a corrupt, oversized or foreign store is reported, never half-read',t=>{
  const root=temp(t);
  const library=new RegexLibrary({root});
  const file=path.join(root,FILE_NAME);
  const good={id:'00000000000000aa',scriptName:'A',findRegex:'a',replaceString:'b',placement:['ai_output'],addedAt:1,updatedAt:1};
  for(const content of ['{',JSON.stringify([]),JSON.stringify({version:2,scripts:[]}),JSON.stringify({version:1,scripts:[good,good]}),
    JSON.stringify({version:1,scripts:[{...good,id:'x'}]}),JSON.stringify({version:1,scripts:[{...good,addedAt:'1'}]}),
    JSON.stringify({version:1,scripts:[{...good,findRegex:'a'.repeat(1001)}]}),' '.repeat(MAX_FILE_BYTES+1)]) {
    fs.writeFileSync(file,content);
    assert.throws(()=>library.list(),{code:'regex_library_corrupt'});
    assert.throws(()=>library.add(script('B','a','b')),{code:'regex_library_corrupt'});
  }
  // Stored data is re-normalized on read: unknown fields are not carried.
  fs.writeFileSync(file,JSON.stringify({version:1,scripts:[{...good,extra:'<script>',placement:[2,3]}]}));
  assert.deepEqual(Object.keys(library.list()[0]).includes('extra'),false);
  assert.deepEqual(library.list()[0].placement,['ai_output']);
});
