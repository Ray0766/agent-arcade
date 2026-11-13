'use strict';
const test=require('./helpers/platform-skip.cjs').windowsQceTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {captureQCEStartup,assertQCEStartup,LEGACY,MAX_CONFIG}=require('../src/bot/qq-qce-startup.cjs');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qce-startup-')),userProfile=path.join(root,'home'),base=path.join(userProfile,'.qq-chat-exporter'),config=path.join(base,'user-config.json');fs.mkdirSync(userProfile);t.after(()=>{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert(path.basename(resolved).startsWith('arcade-qce-startup-'));fs.rmSync(resolved,{recursive:true,force:true});});return{root,userProfile,base,config,write(value){fs.mkdirSync(base,{recursive:true});fs.writeFileSync(config,typeof value==='string'?value:JSON.stringify(value));},capture(){return captureQCEStartup({userProfile});}};}
test('fresh explicit home permits only absent legacy sources and does not create any QCE directory',t=>{
 const f=fixture(t),before=fs.readdirSync(f.userProfile),p=f.capture();assert.equal(p.userProfile,f.userProfile);assert.equal(p.mode,'legacy-absent');assert.equal(p.config,null);assert.equal(p.base.present,false);assert.equal(p.legacy.length,5);assert(p.legacy.every(x=>!x.present));assert.deepEqual(assertQCEStartup(JSON.parse(JSON.stringify(p))),p);assert.deepEqual(fs.readdirSync(f.userProfile),before);assert.equal(fs.existsSync(f.base),false);
});
test('each real legacy directory, including an empty one, blocks startup without moving bytes',t=>{
 const f=fixture(t);fs.mkdirSync(f.base);for(const name of LEGACY){const dir=path.join(f.base,name);fs.mkdirSync(dir);assert.throws(()=>f.capture(),{code:'qce_startup_migration_required'});const file=path.join(dir,'synthetic.txt');fs.writeFileSync(file,'Synthetic legacy export '+name);const before=hash(file);assert.throws(()=>f.capture(),{code:'qce_startup_migration_required'});assert.equal(hash(file),before);fs.rmSync(dir,{recursive:true});}assert.equal(fs.existsSync(path.join(f.userProfile,'Documents')),false);
});
test('both explicit safe custom directories skip migration and preserve old artifacts and config bytes',t=>{
 const f=fixture(t),output=path.join(f.root,'output'),scheduled=path.join(f.root,'scheduled');f.write(' { "customOutputDir": '+JSON.stringify(' "'+output+'" ')+', "customScheduledExportDir": '+JSON.stringify(" '"+scheduled+"' ")+', "unknown": {"keep":true}, "autoOpenBrowser":true }\r\n');
 for(const name of LEGACY){fs.mkdirSync(path.join(f.base,name));fs.writeFileSync(path.join(f.base,name,'synthetic.txt'),'Synthetic retained '+name);}
 const before=hash(f.config),bytes=LEGACY.map(n=>hash(path.join(f.base,n,'synthetic.txt'))),p=f.capture();assert.equal(p.mode,'custom-directories');assert.equal(p.legacy,null);assert.equal(p.customOutput.path,output);assert.equal(p.customScheduled.path,scheduled);assertQCEStartup(p);assert.equal(hash(f.config),before);assert.deepEqual(LEGACY.map(n=>hash(path.join(f.base,n,'synthetic.txt'))),bytes);assert.equal(fs.existsSync(output),false);assert.equal(fs.existsSync(scheduled),false);assert(!JSON.stringify(p).includes('unknown'));assert(!JSON.stringify(p).includes('autoOpenBrowser'));
});
test('one custom directory cannot bypass existing old data; null defaults only pass when all old sources are absent',t=>{
 const f=fixture(t);f.write({customOutputDir:path.join(f.root,'out'),customScheduledExportDir:null});fs.mkdirSync(path.join(f.base,'exports'));assert.throws(()=>f.capture(),{code:'qce_startup_migration_required'});fs.rmdirSync(path.join(f.base,'exports'));assert.equal(f.capture().mode,'legacy-absent');
});
test('malformed, duplicate, invalid UTF8, oversized and wrong-type configs fail closed without rewriting',t=>{
 const f=fixture(t);for(const raw of ['{"customOutputDir":','{"customOutputDir":null,"customOutputDir":null}','{"nested":{"x":1,"x":2}}','[]','{"customScheduledExportDir":false}','{"customOutputDir":42}',Buffer.from([123,34,120,34,58,34,255,34,125]),' '.repeat(MAX_CONFIG+1)]){f.write('{}');fs.writeFileSync(f.config,raw);const before=hash(f.config);assert.throws(()=>f.capture(),{code:'qce_startup_unverified'});assert.equal(hash(f.config),before);}
});
test('relative, dangerous, aliased or ambiguous custom paths never become a skip-migration proof',t=>{
 const f=fixture(t);for(const value of ['relative','C:relative','\\relative','\\\\server\\share','C:\\Windows\\System32\\exports','C:\\Windows\\SysWOW64\\exports','C:\\a\\..\\b','C:\\trailing.','C:\\file:stream','""']){f.write({customOutputDir:value,customScheduledExportDir:path.join(f.root,'scheduled')});const before=hash(f.config);assert.throws(()=>f.capture(),{code:'qce_startup_unverified'},value);assert.equal(hash(f.config),before);}
 for(const userProfile of [null,'','relative','C:relative','\\\\server\\share'])assert.throws(()=>captureQCEStartup({userProfile}),{code:'qce_startup_unverified'});
});
test('JS-only JSON numbers or lone surrogates cannot falsely prove Rust loaded custom dirs',t=>{
 const f=fixture(t),prefix='{"customOutputDir":'+JSON.stringify(path.join(f.root,'out'))+',"customScheduledExportDir":'+JSON.stringify(path.join(f.root,'scheduled'))+',';
 for(const extra of ['"unknown":1e400','"unknown":"\\ud800"','"\\udc00":true','"nested":[-1e400]']){f.write(prefix+extra+'}');const before=hash(f.config);assert.throws(()=>f.capture(),{code:'qce_startup_unverified'});assert.equal(hash(f.config),before);}
 f.write(prefix+'"unknown":"\\ud83d\\ude42"}');assert.equal(f.capture().mode,'custom-directories');
});
test('real NTFS junction and multiply-linked config are rejected',t=>{
 const f=fixture(t),target=path.join(f.root,'target');fs.mkdirSync(target);fs.symlinkSync(target,f.base,'junction');assert.throws(()=>f.capture(),{code:'qce_startup_unverified'});fs.unlinkSync(f.base);f.write('{}');fs.linkSync(f.config,path.join(f.root,'alias.json'));assert.throws(()=>f.capture(),{code:'qce_startup_unverified'});assert.equal(fs.readFileSync(f.config,'utf8'),'{}');
});
test('pre-spawn recheck detects new legacy data, changed bytes and same-byte replacement identities',t=>{
 const f=fixture(t);f.write('{}');let proof=f.capture();fs.mkdirSync(path.join(f.base,'exports'));assert.throws(()=>assertQCEStartup(proof),{code:'qce_startup_changed'});fs.rmdirSync(path.join(f.base,'exports'));
 proof=f.capture();f.write('{"unrelated":true}');assert.throws(()=>assertQCEStartup(proof),{code:'qce_startup_changed'});
 proof=f.capture();const next=path.join(f.base,'replacement.json');fs.writeFileSync(next,fs.readFileSync(f.config));fs.renameSync(f.config,path.join(f.base,'old.json'));fs.renameSync(next,f.config);assert.throws(()=>assertQCEStartup(proof),{code:'qce_startup_changed'});
});
test('replacement parent directory and tampered proof do not get silently adopted',t=>{
 const f=fixture(t);f.write('{}');const p=f.capture();fs.renameSync(f.base,path.join(f.userProfile,'old-base'));f.write('{}');assert.throws(()=>assertQCEStartup(p),{code:'qce_startup_changed'});const now=f.capture();assert.throws(()=>assertQCEStartup({...now,mode:'custom-directories'}),{code:'qce_startup_changed'});assert.throws(()=>assertQCEStartup({schema:'other'}),{code:'qce_startup_unverified'});
});
