'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {ensureUpdateBackup,buildIdentity,STATE_FILE,BACKUP_DIR}=require('../src/core/update-backup.cjs');
const A='a'.repeat(64),B='b'.repeat(64);
function fixture(t){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-update-backup-'))),root=path.join(home,'data');fs.mkdirSync(root);
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const backups=()=>fs.existsSync(path.join(root,BACKUP_DIR))?fs.readdirSync(path.join(root,BACKUP_DIR)).filter(name=>!name.startsWith('.')):[];
 return {home,root,backups,run:options=>ensureUpdateBackup({root,buildId:A,...options})};
}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const contents=directory=>Object.fromEntries(fs.readdirSync(directory).filter(name=>fs.lstatSync(path.join(directory,name)).isFile()).map(name=>[name,hash(path.join(directory,name))]));

test('fresh profiles establish identity without a fake backup; existing profiles snapshot before stamping',t=>{
 const f=fixture(t);assert.deepEqual(f.run(),{backedUp:false,reason:'fresh_profile',buildId:A});assert.deepEqual(f.backups(),[]);
 fs.writeFileSync(path.join(f.root,'bot-vault.json'),'{"data":"ENCRYPTED_ONLY"}');
 assert.equal(f.run().reason,'same_build');
 const result=f.run({buildId:B});assert.equal(result.backedUp,true);assert.equal(result.reason,'build_changed');assert.equal(result.files,2);
 const manifest=JSON.parse(fs.readFileSync(path.join(result.backupPath,'manifest.json')));
 assert.equal(manifest.previousBuildId,A);assert.equal(manifest.buildId,B);
 assert.equal(fs.readFileSync(path.join(result.backupPath,'root-0','bot-vault.json'),'utf8'),'{"data":"ENCRYPTED_ONLY"}');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,STATE_FILE))).lastBackup,result.backupId);
 assert.equal(f.run({buildId:B}).reason,'same_build');assert.equal(f.backups().length,1);
});

test('first installation of the guard protects an existing profile and never prunes earlier snapshots',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'config.json'),'{"language":"zh"}');
 const first=f.run();assert.equal(first.reason,'first_existing_data');assert.equal(first.files,1);
 const original=fs.readFileSync(path.join(first.backupPath,'root-0','config.json'));
 const second=f.run({buildId:B});assert.equal(second.reason,'build_changed');assert.equal(f.backups().length,2);
 assert(fs.readFileSync(path.join(first.backupPath,'root-0','config.json')).equals(original));
 assert(!JSON.parse(fs.readFileSync(path.join(second.backupPath,'manifest.json'))).files.some(row=>row.path.includes(BACKUP_DIR)));
});

test('actual WAL-only rows and user_version survive the copy without touching the source databases',t=>{
 const f=fixture(t),store=path.join(f.root,'local-companion');fs.mkdirSync(store);const file=path.join(store,'social-memory.sqlite'),db=new DatabaseSync(file);
 t.after(()=>db.close());db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=6; CREATE TABLE messages(text TEXT); INSERT INTO messages VALUES ('WAL-only message')");
 const before=contents(store),result=f.run();assert.equal(result.databases,1);assert.deepEqual(contents(store),before);
 const backup=new DatabaseSync(path.join(result.backupPath,'root-0','local-companion','social-memory.sqlite'),{readOnly:true});
 try{assert.equal(backup.prepare('SELECT text FROM messages').get().text,'WAL-only message');assert.equal(backup.prepare('PRAGMA user_version').get().user_version,6);}finally{backup.close();}
 assert.deepEqual(contents(store),before);
});

test('registered external companion roots are included once and private files keep restrictive permissions',t=>{
 const f=fixture(t),other=path.join(f.home,'separate profile');fs.mkdirSync(other);fs.mkdirSync(path.join(f.root,'nested'));
 fs.writeFileSync(path.join(other,'bot-vault.json'),'ciphertext');fs.writeFileSync(path.join(f.root,'nested','history.json'),'[]',{mode:0o700});
 fs.writeFileSync(path.join(f.root,'companions.json'),JSON.stringify({version:1,accounts:[{id:'primary',root:f.root},{id:'outside',root:other},{id:'inside',root:path.join(f.root,'nested')}]}));
 const result=f.run(),manifest=JSON.parse(fs.readFileSync(path.join(result.backupPath,'manifest.json')));
 assert.equal(manifest.roots.length,2);assert.equal(manifest.files.filter(row=>row.path.endsWith('history.json')).length,1);
 assert.equal(JSON.stringify(result).includes('ciphertext'),false);
 if(process.platform!=='win32'){
  assert.equal(fs.statSync(result.backupPath).mode&0o777,0o700);
  for(const row of manifest.files)if(row.kind==='file')assert.equal(fs.statSync(path.join(result.backupPath,`root-${row.root}`,row.path)).mode&0o777,0o600);
  assert.equal(fs.statSync(path.join(result.backupPath,'manifest.json')).mode&0o777,0o600);
  assert.equal(fs.statSync(path.join(f.root,STATE_FILE)).mode&0o777,0o600);
  assert.equal(manifest.files.find(row=>row.path.endsWith('history.json')).sourceMode,0o700);
 }
});

test('changing input during validation rejects a mixed snapshot and leaves the prior build marker untouched',t=>{
 const f=fixture(t);f.run();fs.writeFileSync(path.join(f.root,'social-memory.sqlite'),'fixture bytes');
 assert.throws(()=>f.run({buildId:B,verifyDatabase:()=>{fs.writeFileSync(path.join(f.root,'new-message.json'),'new external input');}}),{code:'source_changed'});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,STATE_FILE))).buildId,A);
 assert.deepEqual(f.backups(),[]);assert.equal(fs.readdirSync(path.join(f.root,BACKUP_DIR)).length,0);
});

test('corrupt SQLite, invalid registry and byte limits prevent migration without replacing source files',t=>{
 const f=fixture(t),file=path.join(f.root,'social-memory.sqlite');fs.writeFileSync(file,'broken SQLite');const before=hash(file);
 assert.throws(()=>f.run(),{code:'sqlite_invalid'});assert.equal(hash(file),before);assert(!fs.existsSync(path.join(f.root,STATE_FILE)));
 assert.throws(()=>f.run({limits:{bytes:1}}),{code:'backup_limit'});assert.equal(hash(file),before);
 fs.writeFileSync(path.join(f.root,'companions.json'),'{bad');assert.throws(()=>f.run(),{code:'registry_unavailable'});
 assert.equal(hash(file),before);assert(!fs.existsSync(path.join(f.root,STATE_FILE)));
});

test('a failed state publication retains the completed backup and retries on the next start',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'config.json'),'{}');const rename=fs.renameSync;
 fs.renameSync=(source,target)=>{if(target===path.join(f.root,STATE_FILE))throw Object.assign(Error('synthetic readonly marker'),{code:'EACCES'});return rename(source,target);};
 try{assert.throws(()=>f.run(),{code:'state_write_failed'});}finally{fs.renameSync=rename;}
 assert.equal(f.backups().length,1);assert(!fs.existsSync(path.join(f.root,STATE_FILE)));
 assert.equal(f.run().backedUp,true);assert.equal(f.backups().length,2);
});

test('links are preserved without copying their outside target; a linked destination is refused',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),outside=path.join(f.home,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'not-app-data.txt'),'not copied');
 fs.symlinkSync(outside,path.join(f.root,'link'));const result=f.run();
 assert.equal(fs.readlinkSync(path.join(result.backupPath,'root-0','link')),outside);
 const manifest=JSON.parse(fs.readFileSync(path.join(result.backupPath,'manifest.json')));assert.equal(manifest.files.length,1);assert.equal(manifest.files[0].kind,'symlink');
 fs.symlinkSync(outside,path.join(f.home,'linked-backups'));assert.throws(()=>f.run({buildId:B,backupRoot:path.join(f.home,'linked-backups')}),{code:'unsafe_path'});
 assert.deepEqual(fs.readdirSync(outside),['not-app-data.txt']);
});

test('an explicit data-root alias shares the canonical snapshot and build marker',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),alias=path.join(f.home,'data alias');fs.symlinkSync(f.root,alias);
 fs.writeFileSync(path.join(f.root,'bot-vault.json'),'encrypted');
 const first=ensureUpdateBackup({root:alias,buildId:A});assert.equal(first.reason,'first_existing_data');
 assert.equal(JSON.parse(fs.readFileSync(path.join(first.backupPath,'manifest.json'))).roots[0],f.root);
 assert.equal(path.dirname(first.backupPath),path.join(f.root,BACKUP_DIR));
 assert.equal(f.run().reason,'same_build');assert.equal(ensureUpdateBackup({root:alias,buildId:A}).reason,'same_build');
 assert.equal(f.backups().length,1);assert.equal(fs.readFileSync(path.join(f.root,'bot-vault.json'),'utf8'),'encrypted');
 const second=ensureUpdateBackup({root:alias,buildId:B});assert.equal(second.reason,'build_changed');assert.equal(f.backups().length,2);
});

test('new data under an aliased ancestor is created canonically; dangling and file roots remain refused',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),alias=path.join(f.home,'ancestor alias');fs.symlinkSync(f.root,alias);
 const root=path.join(alias,'new','profile');assert.equal(ensureUpdateBackup({root,buildId:A}).reason,'fresh_profile');
 assert(fs.existsSync(path.join(f.root,'new','profile',STATE_FILE)));
 fs.writeFileSync(path.join(f.root,'not-directory'),'not a directory');
 fs.symlinkSync(path.join(f.root,'not-directory'),path.join(f.home,'file alias'));
 assert.throws(()=>ensureUpdateBackup({root:path.join(f.home,'file alias'),buildId:A}),{code:'unsafe_path'});
 const missing=path.join(f.home,'must not create'),dangling=path.join(f.home,'dangling root');fs.symlinkSync(missing,dangling);
 assert.throws(()=>ensureUpdateBackup({root:dangling,buildId:A}),{code:'unsafe_path'});assert(!fs.existsSync(missing));
});

test('whole-home/filesystem and native-credential roots are refused before traversal; external profiles need App markers',t=>{
 const f=fixture(t),home=fs.realpathSync(os.homedir()),sensitive=['.claude','.codex','.aws'].map(name=>path.join(home,name));
 for(const unsafe of [path.parse(home).root,home,path.dirname(home),...sensitive]){
  assert.throws(()=>ensureUpdateBackup({root:unsafe,buildId:A}),{code:'unsafe_path'});
  fs.writeFileSync(path.join(f.root,'companions.json'),JSON.stringify({version:1,accounts:[{id:'other',root:unsafe}]}));
  assert.throws(()=>f.run(),error=>['unsafe_path','registry_unavailable'].includes(error.code));
  assert(!fs.existsSync(path.join(f.root,STATE_FILE)));assert.deepEqual(f.backups(),[]);
 }
 const external=path.join(f.home,'unrelated directory');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'not-app.txt'),'not an App profile');
 fs.writeFileSync(path.join(f.root,'companions.json'),JSON.stringify({version:1,accounts:[{id:'other',root:external}]}));
 assert.throws(()=>f.run(),{code:'registry_unavailable'});assert.deepEqual(f.backups(),[]);
 fs.writeFileSync(path.join(external,'bot-config.json'),'{}');assert.equal(f.run().backedUp,true);
});

test('nested native-credential directories cause refusal rather than a silent partial backup',t=>{
 const f=fixture(t),nested=path.join(f.root,'nested');fs.mkdirSync(nested);
 for(const name of ['.claude','.codex','.aws']){
  const dir=path.join(nested,name);fs.mkdirSync(dir);const file=path.join(dir,'credential-fixture.json');fs.writeFileSync(file,'synthetic outside-scope content');const original=hash(file);
  assert.throws(()=>f.run(),{code:'unsafe_path'});assert.equal(hash(file),original);assert(!fs.existsSync(path.join(f.root,STATE_FILE)));assert.deepEqual(f.backups(),[]);
  fs.rmSync(dir,{recursive:true});
 }
});

test('build identity detects same-version code or lock changes and ignores generated icons',t=>{
 const f=fixture(t),app=path.join(f.home,'app');fs.mkdirSync(path.join(app,'src','assets'),{recursive:true});
 fs.writeFileSync(path.join(app,'package.json'),'{"version":"1.0"}');fs.writeFileSync(path.join(app,'package-lock.json'),'{}');fs.writeFileSync(path.join(app,'src','main.cjs'),'module.exports=1;');
 const before=buildIdentity({appPath:app});assert.match(before,/^[a-f0-9]{64}$/);
 fs.writeFileSync(path.join(app,'src','assets','app.ico'),'generated');assert.equal(buildIdentity({appPath:app}),before);
 fs.writeFileSync(path.join(app,'src','main.cjs'),'module.exports=2;');const code=buildIdentity({appPath:app});assert.notEqual(code,before);
 fs.writeFileSync(path.join(app,'package-lock.json'),'{"lockfileVersion":3}');assert.notEqual(buildIdentity({appPath:app}),code);
});
