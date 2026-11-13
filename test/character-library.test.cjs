'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CharacterLibrary,MAX_CHARACTERS}=require('../src/bot/character-library.cjs');
const {normalizeCard}=require('../src/vendor/sillytavern/character-card.cjs');
const {png}=require('./st-png-fixture.cjs');

const card=(name,extra={})=>normalizeCard({spec:'chara_card_v2',spec_version:'2.0',data:{name,description:'合成样例',first_mes:'你好',alternate_greetings:['早'],tags:['t'],creator:'tester',extensions:{},...extra}});
function temp(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-characters-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}

test('add, list, get, update and remove in a temporary directory',t=>{
  const root=path.join(temp(t),'characters');
  let clock=1000;
  const library=new CharacterLibrary({root,now:()=>clock});
  assert.deepEqual(library.list(),[]);
  const b=library.add({card:card('Beta',{character_book:{entries:[{keys:['k'],content:'c',enabled:true,insertion_order:1,extensions:{}}],extensions:{}}}),portrait:png()});
  const a=library.add({card:card('Alpha')});
  assert.match(a.id,/^[0-9a-f]{16}$/);assert.notEqual(a.id,b.id);
  assert.deepEqual(fs.readdirSync(path.join(root,b.id)).sort(),['card.json','portrait.png']);
  assert.deepEqual(fs.readdirSync(path.join(root,a.id)),['card.json']);
  assert.deepEqual(library.list(),[
    {id:a.id,name:'Alpha',creator:'tester',tags:['t'],hasPortrait:false,hasBook:false,greetings:2,addedAt:1000,updatedAt:1000},
    {id:b.id,name:'Beta',creator:'tester',tags:['t'],hasPortrait:true,hasBook:true,greetings:2,addedAt:1000,updatedAt:1000},
  ]);
  const stored=library.get(b.id);
  assert.equal(stored.name,'Beta');assert.equal(stored.firstMessage,'你好');assert.equal(stored.characterBook.entries[0].content,'c');assert.equal(stored.hasPortrait,true);
  assert.equal(library.portraitPath(b.id),path.join(root,b.id,'portrait.png'));assert.equal(library.portraitPath(a.id),null);
  assert.ok(fs.readFileSync(library.portraitPath(b.id)).equals(png()));
  assert.equal(library.get('0123456789abcdef'),null);

  clock=2000;
  const updated=library.update(a.id,{name:'Zeta',description:'d'.repeat(20001),portrait:png()});
  assert.equal(updated.name,'Zeta');assert.equal(updated.description.length,20000);assert.equal(updated.addedAt,1000);assert.equal(updated.updatedAt,2000);assert.equal(updated.hasPortrait,true);
  assert.deepEqual(library.list().map(item=>item.name),['Beta','Zeta']);
  assert.equal(library.update(a.id,{portrait:null}).hasPortrait,false);assert.equal(library.portraitPath(a.id),null);
  assert.throws(()=>library.update(a.id,{id:'ffffffffffffffff'}),{code:'character_update_invalid'});
  assert.throws(()=>library.update(a.id,{name:''}),{code:'character_card_invalid'});
  assert.throws(()=>library.update(a.id,{portrait:Buffer.from('not png')}),{code:'character_portrait_invalid'});
  assert.throws(()=>library.update('0123456789abcdef',{name:'x'}),{code:'character_not_found'});
  assert.equal(library.get(a.id).name,'Zeta');

  assert.deepEqual(library.remove(b.id),{removed:true});assert.equal(fs.existsSync(path.join(root,b.id)),false);
  assert.deepEqual(library.remove(b.id),{removed:false,reason:'not_found'});
  assert.deepEqual(library.list().map(item=>item.id),[a.id]);
});
test('ids that could traverse paths are rejected everywhere',t=>{
  const root=path.join(temp(t),'characters');
  const outside=path.join(path.dirname(root),'outside');
  fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'card.json'),'{}');
  const library=new CharacterLibrary({root});
  for(const id of ['../outside','..','','0123456789ABCDEF','0123456789abcde','0123456789abcdef0','0123456789abcdef/..',path.join(outside),null,undefined,7])
    for(const call of [()=>library.get(id),()=>library.update(id,{name:'x'}),()=>library.remove(id),()=>library.portraitPath(id)])
      assert.throws(call,{code:'character_id_invalid'});
  assert.equal(fs.existsSync(path.join(outside,'card.json')),true);
  assert.throws(()=>new CharacterLibrary({root:'relative/dir'}),{code:'character_library_invalid'});
});
test('corrupt and foreign directories are skipped by list and reported by get',t=>{
  const root=temp(t);
  const library=new CharacterLibrary({root});
  const good=library.add({card:card('Good')});
  const write=(id,content)=>{fs.mkdirSync(path.join(root,id));fs.writeFileSync(path.join(root,id,'card.json'),content);};
  write('aaaaaaaaaaaaaaaa','{not json');
  write('bbbbbbbbbbbbbbbb',JSON.stringify({...card('Wrong id'),id:'cccccccccccccccc',addedAt:1,updatedAt:1}));
  write('dddddddddddddddd',JSON.stringify({id:'dddddddddddddddd',addedAt:1,updatedAt:1,name:''}));
  fs.mkdirSync(path.join(root,'eeeeeeeeeeeeeeee'));
  write('not-an-id',JSON.stringify({name:'foreign'}));
  fs.writeFileSync(path.join(root,'ffffffffffffffff'),'a file, not a directory');
  assert.deepEqual(library.list().map(item=>item.id),[good.id]);
  assert.throws(()=>library.get('aaaaaaaaaaaaaaaa'),{code:'character_library_corrupt'});
  assert.throws(()=>library.get('bbbbbbbbbbbbbbbb'),{code:'character_library_corrupt'});
  assert.equal(library.get('eeeeeeeeeeeeeeee'),null);
});
test('the character limit is enforced and add validates its input',t=>{
  const root=temp(t);
  const library=new CharacterLibrary({root,maxCharacters:3});
  assert.equal(MAX_CHARACTERS,200);
  for(let i=0;i<3;i++) library.add({card:card('C'+i)});
  assert.throws(()=>library.add({card:card('one too many')}),{code:'character_library_full'});
  assert.equal(fs.readdirSync(root).length,3);
  library.remove(library.list()[0].id);
  library.add({card:card('fits again')});
  assert.throws(()=>new CharacterLibrary({root,maxCharacters:201}),{code:'character_library_invalid'});
  const other=new CharacterLibrary({root:path.join(root,'other')});
  assert.throws(()=>other.add({card:{name:''}}),{code:'character_card_invalid'});
  assert.throws(()=>other.add({card:card('x'),portrait:Buffer.from('nope')}),{code:'character_portrait_invalid'});
  assert.deepEqual(other.list(),[]);
});
test('remove leaves a directory that holds unexpected content',t=>{
  const root=temp(t);
  const library=new CharacterLibrary({root});
  const one=library.add({card:card('Keep'),portrait:png()});
  fs.writeFileSync(path.join(root,one.id,'notes.txt'),'user file');
  assert.deepEqual(library.remove(one.id),{removed:false,reason:'unexpected_files'});
  assert.deepEqual(fs.readdirSync(path.join(root,one.id)).sort(),['card.json','notes.txt','portrait.png']);
  fs.unlinkSync(path.join(root,one.id,'notes.txt'));
  fs.mkdirSync(path.join(root,one.id,'portrait.png.d'));
  assert.deepEqual(library.remove(one.id),{removed:false,reason:'unexpected_files'});
  fs.rmdirSync(path.join(root,one.id,'portrait.png.d'));
  // A leftover of this library's own interrupted atomic write does not block removal.
  fs.writeFileSync(path.join(root,one.id,'card.json.123e4567-e89b-12d3-a456-426614174000.tmp'),'{}');
  assert.deepEqual(library.remove(one.id),{removed:true});
  assert.equal(fs.existsSync(path.join(root,one.id)),false);
});
