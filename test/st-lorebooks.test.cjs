'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LorebookLibrary,importWorldInfoFile,MAX_BOOK_BYTES}=require('../src/bot/st/lorebooks.cjs');
const {scanWorldInfo}=require('../src/vendor/sillytavern/world-info.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-lorebooks-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const worldInfo=()=>({name:'Harbour',entries:{
  0:{uid:0,key:['lighthouse'],keysecondary:['storm'],comment:'light',content:'The lighthouse is old.',constant:false,selective:true,selectiveLogic:3,order:50,position:4,depth:2,role:1,disable:false,
    probability:80,useProbability:true,group:'places',groupOverride:true,groupWeight:40,sticky:2,cooldown:3,delay:1,scanDepth:5,caseSensitive:true,matchWholeWords:true,excludeRecursion:true,preventRecursion:true,
    delayUntilRecursion:2,ignoreBudget:true,vectorized:true,automationId:'x',displayIndex:0},
  1:{uid:1,key:['harbour'],content:'The harbour is busy.',disable:true},
  2:{uid:2,key:'gull',content:'Gulls everywhere.'},
  3:'junk'}});
const book=()=>importWorldInfoFile(JSON.stringify(worldInfo())).book;

test('a SillyTavern world-info export is converted with upstream defaults',()=>{
  const result=importWorldInfoFile(JSON.stringify(worldInfo()));
  assert.equal(result.format,'world_info');assert.equal(result.book.name,'Harbour');assert.equal(result.book.entries.length,3);
  assert.deepEqual(result.book.entries[0],{id:0,keys:['lighthouse'],secondaryKeys:['storm'],content:'The lighthouse is old.',enabled:true,constant:false,selective:true,insertionOrder:50,position:'after_char',
    caseSensitive:true,comment:'light',priority:null,placement:'at_depth',depth:2,role:'user',selectiveLogic:'and_all',probability:80,useProbability:true,group:'places',groupOverride:true,groupWeight:40,
    sticky:2,cooldown:3,delay:1,scanDepth:5,matchWholeWords:true,excludeRecursion:true,preventRecursion:true,delayUntilRecursion:2,ignoreBudget:true});
  // Missing fields take the upstream template values: enabled, selective, order 100, before the character definitions.
  const [, disabled, plain]=result.book.entries;
  assert.equal(disabled.enabled,false);
  assert.deepEqual({enabled:plain.enabled,selective:plain.selective,insertionOrder:plain.insertionOrder,position:plain.position,placement:plain.placement,keys:plain.keys,probability:plain.probability},
    {enabled:true,selective:true,insertionOrder:100,position:'before_char',placement:'before',keys:['gull'],probability:100});
  assert.ok(result.warnings.some(text=>text.includes('not an object')));assert.ok(Object.isFrozen(result.book));
  // The imported book feeds the activation engine directly.
  assert.deepEqual(scanWorldInfo({entries:result.book.entries,messages:[{role:'user',text:'a gull by the harbour'}]}).before,['Gulls everywhere.']);
});
test('a character_book object, a buffer and a parsed object are accepted; other input is rejected',()=>{
  const characterBook={name:'Book',scan_depth:3,token_budget:300,recursive_scanning:true,entries:[{id:4,keys:['k'],content:'c',enabled:true,insertion_order:7,position:'before_char',extensions:{probability:20}}]};
  const fromObject=importWorldInfoFile(characterBook);
  assert.equal(fromObject.format,'character_book');assert.equal(fromObject.book.entries[0].probability,20);assert.equal(fromObject.book.scanDepth,3);assert.equal(fromObject.book.tokenBudget,300);
  assert.deepEqual(importWorldInfoFile(Buffer.from('﻿'+JSON.stringify(characterBook))).book,fromObject.book);
  const invalid=value=>assert.throws(()=>importWorldInfoFile(value),{code:'lorebook_invalid'});
  invalid('{bad');invalid('[]');invalid('{}');invalid({entries:'x'});invalid(7);invalid(null);invalid(' '.repeat(MAX_BOOK_BYTES+1));invalid(Buffer.alloc(MAX_BOOK_BYTES+1,0x20));invalid(Buffer.from([0xff,0xfe]));
  // Hostile keys do not pollute prototypes.
  importWorldInfoFile('{"entries":{"__proto__":{"uid":1,"key":["k"],"content":"c","polluted":true}}}');
  assert.equal({}.polluted,undefined);
});
test('add, list, get, update and remove keep one bounded JSON file per book',t=>{
  const root=temp(t);
  let clock=1000;
  const library=new LorebookLibrary({root,now:()=>clock++});
  assert.deepEqual(library.list(),[]);assert.equal(library.get('0123456789abcdef'),null);
  const first=library.add({name:' Zeta ',book:book()});
  const second=library.add({book:book()});
  assert.match(first.id,/^[0-9a-f]{16}$/);assert.notEqual(first.id,second.id);assert.equal(first.name,'Zeta');assert.equal(second.name,'Harbour');
  assert.deepEqual(library.list(),[{id:second.id,name:'Harbour',entries:3,enabledEntries:2,addedAt:1001,updatedAt:1001},{id:first.id,name:'Zeta',entries:3,enabledEntries:2,addedAt:1000,updatedAt:1000}]);
  assert.deepEqual(fs.readdirSync(root).sort(),[first.id+'.json',second.id+'.json'].sort());
  assert.deepEqual(library.get(first.id),first);assert.deepEqual(library.get(first.id).book,book());
  const edited={...book(),entries:[{...book().entries[2],content:'x'.repeat(9000),keys:['gull','tern']}]};
  const updated=library.update(first.id,{name:'Alpha',book:edited});
  assert.equal(updated.name,'Alpha');assert.equal(updated.addedAt,1000);assert.equal(updated.updatedAt,1002);assert.equal(updated.book.entries.length,1);
  assert.equal(updated.book.entries[0].content.length,8000);assert.deepEqual(library.get(first.id).book.entries[0].keys,['gull','tern']);
  assert.equal(library.update(first.id,{name:'Beta'}).book.entries.length,1);
  assert.deepEqual(library.remove(first.id),{removed:true});assert.deepEqual(library.remove(first.id),{removed:false,reason:'not_found'});
  assert.deepEqual(library.list().map(item=>item.id),[second.id]);
});
test('invalid ids, names, books and updates are rejected; the book count is capped',t=>{
  const root=temp(t);
  const library=new LorebookLibrary({root,maxBooks:2});
  for(const id of ['','..','../x','0123456789ABCDEF','0123456789abcde','0123456789abcdef0',5,null]) {
    assert.throws(()=>library.get(id),{code:'lorebook_id_invalid'});assert.throws(()=>library.remove(id),{code:'lorebook_id_invalid'});assert.throws(()=>library.update(id,{name:'x'}),{code:'lorebook_id_invalid'});
  }
  assert.throws(()=>library.add({name:'x',book:null}),{code:'lorebook_invalid'});assert.throws(()=>library.add({name:'x',book:{entries:'no'}}),{code:'lorebook_invalid'});
  assert.throws(()=>library.add({name:'n'.repeat(61),book:book()}),{code:'lorebook_invalid'});assert.throws(()=>library.add({name:7,book:book()}),{code:'lorebook_invalid'});
  assert.throws(()=>library.add(),{code:'lorebook_invalid'});
  assert.deepEqual(fs.existsSync(root)?fs.readdirSync(root):[],[]);
  const kept=library.add({name:'one',book:book()});library.add({name:'two',book:book()});
  assert.throws(()=>library.add({name:'three',book:book()}),{code:'lorebook_library_full'});
  assert.throws(()=>library.update(kept.id,{id:'x'}),{code:'lorebook_update_invalid'});assert.throws(()=>library.update(kept.id,null),{code:'lorebook_update_invalid'});
  assert.throws(()=>library.update(kept.id,{name:''}),{code:'lorebook_invalid'});assert.throws(()=>library.update('0123456789abcdef',{name:'x'}),{code:'lorebook_not_found'});
  assert.equal(library.get(kept.id).name,'one');
  for(const options of [{},{root:'relative'},{root,maxBooks:0},{root,maxBooks:201},{root,maxBooks:1.5}]) assert.throws(()=>new LorebookLibrary(options),{code:'lorebook_library_invalid'});
});
test('corrupt, foreign and oversized files are skipped by list, reported by get, and never deleted',t=>{
  const root=temp(t);
  const library=new LorebookLibrary({root});
  const good=library.add({name:'good',book:book()});
  const write=(name,content)=>fs.writeFileSync(path.join(root,name),content);
  write('aaaaaaaaaaaaaaaa.json','{not json');
  write('bbbbbbbbbbbbbbbb.json',JSON.stringify({id:'cccccccccccccccc',name:'wrong id',book:book(),addedAt:1,updatedAt:1}));
  write('dddddddddddddddd.json',JSON.stringify({id:'dddddddddddddddd',name:'no times',book:book()}));
  write('eeeeeeeeeeeeeeee.json',' '.repeat(MAX_BOOK_BYTES+1));
  write('notes.txt','keep me');write('ffffffffffffffff.json.bak','keep me');fs.mkdirSync(path.join(root,'1111111111111111.json'));
  assert.deepEqual(library.list().map(item=>item.id),[good.id]);
  for(const id of ['aaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbb','dddddddddddddddd','eeeeeeeeeeeeeeee']) assert.throws(()=>library.get(id),{code:'lorebook_library_corrupt'});
  assert.equal(library.get('1111111111111111'),null);assert.deepEqual(library.remove('1111111111111111'),{removed:false,reason:'not_found'});
  // Stored text is re-bounded on read: a hand-edited file cannot smuggle oversized or extra fields through.
  const file=path.join(root,good.id+'.json');
  const stored=JSON.parse(fs.readFileSync(file,'utf8'));
  stored.book.entries[0].content='y'.repeat(20000);stored.book.entries[0].run='require("child_process")';stored.book.entries[0].probability=900;
  fs.writeFileSync(file,JSON.stringify(stored));
  const reread=library.get(good.id).book.entries[0];
  assert.equal(reread.content.length,8000);assert.equal('run' in reread,false);assert.equal(reread.probability,100);
  assert.deepEqual(library.remove(good.id),{removed:true});
  assert.deepEqual(fs.readdirSync(root).sort(),['1111111111111111.json','aaaaaaaaaaaaaaaa.json','bbbbbbbbbbbbbbbb.json','dddddddddddddddd.json','eeeeeeeeeeeeeeee.json','ffffffffffffffff.json.bak','notes.txt']);
});
