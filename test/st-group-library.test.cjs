'use strict';
// On-disk library of group chats (several library characters in one App conversation): one
// bounded JSON file per group in a temporary directory. No network and no model.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {GroupLibrary}=require('../src/bot/st/group-library.cjs');
const {pickSpeakers}=require('../src/vendor/sillytavern/group-chat.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-st-group-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const A='aaaaaaaaaaaaaaaa',B='bbbbbbbbbbbbbbbb',C='cccccccccccccccc';

test('add, list, get, update and remove keep one bounded JSON file per group',t=>{
  const root=path.join(temp(t),'groups');let at=1000;const library=new GroupLibrary({root,now:()=>at++});
  assert.deepEqual(library.list(),[]);assert.equal(library.get(A),null);
  const added=library.add({name:' 茶会 ',members:[A,B,C],mutedMembers:[C],talkativeness:{[A]:1}});
  assert.match(added.id,/^[0-9a-f]{16}$/);
  assert.deepEqual(added,{id:added.id,name:'茶会',members:[A,B,C],mutedMembers:[C],talkativeness:{[A]:1,[B]:0.5,[C]:0.5},activationStrategy:'natural',allowSelfResponses:false,generationMode:'swap',disabledMembers:[C],addedAt:1000,updatedAt:1000,dispatcher:{enabled:false}});
  assert.deepEqual(fs.readdirSync(root),[added.id+'.json']);
  const stored=JSON.parse(fs.readFileSync(path.join(root,added.id+'.json'),'utf8'));
  assert.deepEqual(Object.keys(stored),['id','name','members','mutedMembers','talkativeness','activationStrategy','allowSelfResponses','generationMode','dispatcher','addedAt','updatedAt']);
  assert.deepEqual(library.get(added.id),added);assert.deepEqual(library.list(),[added]);
  // A record is accepted as it is by the speaker picker: the muted member never activates.
  assert.deepEqual(pickSpeakers({group:{...added,activationStrategy:'list'},characters:[A,B,C].map(id=>({id,name:id}))}),[A,B]);
  // update: only the given keys change; a member that left takes its mute flag and talkativeness along.
  const renamed=library.update(added.id,{name:'Tea',activationStrategy:'pooled',allowSelfResponses:true,generationMode:'join'});
  assert.deepEqual([renamed.name,renamed.activationStrategy,renamed.allowSelfResponses,renamed.generationMode,renamed.members,renamed.mutedMembers,renamed.addedAt,renamed.updatedAt],['Tea','pooled',true,'join',[A,B,C],[C],1000,1001]);
  const smaller=library.update(added.id,{members:[B,A]});
  assert.deepEqual([smaller.members,smaller.mutedMembers,smaller.disabledMembers,smaller.talkativeness],[[B,A],[],[],{[B]:0.5,[A]:1}]);
  assert.deepEqual(library.update(added.id,{mutedMembers:[A],talkativeness:{[B]:0}}).talkativeness,{[B]:0,[A]:0.5});
  assert.deepEqual(library.get(added.id).mutedMembers,[A]);
  const second=library.add({name:'Alpha',members:[A,B]});assert.deepEqual(library.list().map(item=>item.name),['Alpha','Tea']);
  assert.deepEqual(library.remove(second.id),{removed:true});assert.deepEqual(library.remove(second.id),{removed:false,reason:'not_found'});
  assert.deepEqual(library.list().map(item=>item.id),[added.id]);
});

test('invalid ids, groups and updates are rejected; the group count is capped',t=>{
  const root=path.join(temp(t),'groups'),library=new GroupLibrary({root,maxGroups:2});
  for(const value of [null,[],{},{name:'x'},{name:'',members:[A,B]},{name:'x'.repeat(61),members:[A,B]},{name:'a\nb',members:[A,B]},{name:'x',members:[]},{name:'x',members:[A,A]},{name:'x',members:[A,'nope']},
    {name:'x',members:[A,B,C,'dddddddddddddddd','eeeeeeeeeeeeeeee','ffffffffffffffff','0000000000000000','1111111111111111','2222222222222222']},{name:'x',members:[A,B],mutedMembers:[C]},{name:'x',members:[A,B],mutedMembers:[A,A]},
    {name:'x',members:[A,B],mutedMembers:[A],disabledMembers:[B]},{name:'x',members:[A,B],talkativeness:{[C]:0.5}},{name:'x',members:[A,B],talkativeness:{[A]:2}},{name:'x',members:[A,B],talkativeness:{[A]:'1'}},{name:'x',members:[A,B],talkativeness:[]},
    {name:'x',members:[A,B],activationStrategy:'loud'},{name:'x',members:[A,B],generationMode:2},{name:'x',members:[A,B],allowSelfResponses:1},{name:'x',members:[A,B],autoMode:true},{name:'x',members:[A,B],extra:1}])
    assert.throws(()=>library.add(value),{code:'group_invalid'},JSON.stringify(value));
  assert.deepEqual(library.list(),[]);
  const one=library.add({name:'one',members:[A,B]});library.add({name:'two',members:[A,B],disabledMembers:[B]});
  assert.throws(()=>library.add({name:'three',members:[A,B]}),{code:'group_library_full'});
  for(const id of [undefined,'','../x','AAAAAAAAAAAAAAAA',one.id+'0']){assert.throws(()=>library.get(id),{code:'group_id_invalid'});assert.throws(()=>library.remove(id),{code:'group_id_invalid'});}
  assert.throws(()=>library.update(C,{name:'x'}),{code:'group_not_found'});
  for(const patch of [null,{id:A},{addedAt:1},{name:''},{members:[A,'x']},{mutedMembers:[C]},{talkativeness:{[A]:-1}}])assert.throws(()=>library.update(one.id,patch),{code:'group_invalid'},JSON.stringify(patch));
  assert.deepEqual(library.get(one.id),one);
  for(const options of [{},{root:'relative'},{root,maxGroups:0},{root,maxGroups:101},{root,maxGroups:1.5}])assert.throws(()=>new GroupLibrary(options),{code:'group_library_invalid'});
});

test('corrupt, foreign and oversized files are skipped by list, reported by get, and never deleted',t=>{
  const root=path.join(temp(t),'groups'),library=new GroupLibrary({root});
  const good=library.add({name:'good',members:[A,B]});
  fs.writeFileSync(path.join(root,A+'.json'),'{not json');
  fs.writeFileSync(path.join(root,B+'.json'),JSON.stringify({...JSON.parse(fs.readFileSync(path.join(root,good.id+'.json'),'utf8')),id:C}));
  fs.writeFileSync(path.join(root,C+'.json'),JSON.stringify({id:C,name:'big',members:[A,B],mutedMembers:[],talkativeness:{},activationStrategy:'natural',allowSelfResponses:false,generationMode:'swap',addedAt:1,updatedAt:1,pad:'x'.repeat(70000)}));
  fs.writeFileSync(path.join(root,'notes.txt'),'foreign');
  assert.deepEqual(library.list().map(item=>item.id),[good.id]);
  for(const id of [A,B,C])assert.throws(()=>library.get(id),{code:'group_library_corrupt'});
  assert.equal(fs.readdirSync(root).length,5);
});
