'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const helperFile=path.resolve(__dirname,'../src/bot/qq-node-webui.cjs'),helper=require(helperFile);
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-node-webui-'));t.after(()=>{const target=fs.realpathSync(dir);assert(target.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});return {dir,file:path.join(dir,'webui.json')};}
function injectedFs(overrides){const realRequire=createRequire(helperFile),module={exports:{}};vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(helperFile,'utf8')}\n})`,{Buffer})(name=>name==='node:fs'?{...fs,...overrides}:realRequire(name),module,module.exports);return module.exports;}
test('exclusive host-only seed preserves existing credentials and returns no secret fields',t=>{
  const {file}=fixture(t);assert.deepEqual(helper.seedLocalWebUI(file),{created:true});assert.deepEqual(JSON.parse(fs.readFileSync(file)),{host:'127.0.0.1'});
  const previous=Buffer.from('{"host":"::1","token":"synthetic-secret","enable2FA":true,"totpSecret":"synthetic-totp","theme":{"dark":{},"light":{}}}\n');fs.writeFileSync(file,previous);assert.deepEqual(helper.seedLocalWebUI(file),{created:false});assert(fs.readFileSync(file).equals(previous));const result=helper.readLocalWebUI(file);assert.equal(result.host,'::1');assert(!JSON.stringify(result).includes('synthetic'));assert.deepEqual(Object.keys(result).sort(),['digest','host','identity']);
});
test('an exclusive creation race preserves the other complete file byte for byte',t=>{
  const {file}=fixture(t),original=Buffer.from('{"host":"::","token":"other-writer"}');const seeded=injectedFs({openSync(target,flags,...args){if(target===file&&flags==='wx')fs.writeFileSync(file,original,{flag:'wx'});return fs.openSync(target,flags,...args);}});
  assert.equal(seeded.seedLocalWebUI(file).created,false);assert(fs.readFileSync(file).equals(original));assert.throws(()=>helper.readLocalWebUI(file),{code:'webui_config_not_local'});
});
test('partial seed write failure leaves no configuration that can pass startup validation',t=>{
  const {file}=fixture(t),seeded=injectedFs({writeFileSync(fd,value,...args){if(typeof fd==='number'){fs.writeSync(fd,value.subarray(0,9));throw Object.assign(new Error('synthetic write failure'),{code:'EIO'});}return fs.writeFileSync(fd,value,...args);}});
  assert.throws(()=>seeded.seedLocalWebUI(file),{code:'webui_config_not_local'});const partial=fs.readFileSync(file);assert(partial.length>0);assert.throws(()=>helper.readLocalWebUI(file),{code:'webui_config_not_local'});assert.equal(helper.seedLocalWebUI(file).created,false);assert(fs.readFileSync(file).equals(partial));
});
test('malformed optional fields, UTF-8, BOM, unsupported fields and unbounded input cannot fall back upstream',t=>{
  const {file}=fixture(t),invalid=[Buffer.from([0xff]),Buffer.from('\ufeff{"host":"127.0.0.1"}'),Buffer.from('{"host":"127.0.0.1"'),...[
    {host:'::'},{host:'127.0.0.1',port:'6099'},{host:'127.0.0.1',token:null},{host:'127.0.0.1',enable2FA:'false'},
    {host:'127.0.0.1',theme:{dark:{},light:{color:4}}},{host:'127.0.0.1',theme:{fontMode:'system'}},
    {host:'127.0.0.1',loginRate:-1},{host:'127.0.0.1',accessControlMode:'unknown'},{host:'127.0.0.1',ipWhitelist:[{}]},
    {host:'127.0.0.1',futureUnknown:true},{host:'127.0.0.1',token:'x'.repeat(256*1024)}
  ].map(value=>Buffer.from(JSON.stringify(value)))];
  for(const value of invalid){fs.writeFileSync(file,value);assert.throws(()=>helper.readLocalWebUI(file),{code:'webui_config_not_local'});assert(fs.readFileSync(file).equals(value));}
});
test('hard-linked configurations and replaced identical-byte files remain unverified',t=>{
  const {file,dir}=fixture(t);helper.seedLocalWebUI(file);const before=helper.readLocalWebUI(file),linked=path.join(dir,'linked.json');fs.linkSync(file,linked);assert.throws(()=>helper.readLocalWebUI(file),{code:'webui_config_not_local'});fs.unlinkSync(linked);
  const value=fs.readFileSync(file);fs.renameSync(file,linked);fs.writeFileSync(file,value,{flag:'wx'});const after=helper.readLocalWebUI(file);assert.equal(after.digest,before.digest);assert.throws(()=>helper.assertSameWebUI(before,after),{code:'webui_config_not_local'});
});
