'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {applicationCredentialVault,loadBrokerProfile}=require('../src/core/application-credential-vault.cjs');
const {credentialStartupAllowed}=require('../src/core/credential-startup-policy.cjs');
const PIN='A'.repeat(40),HASH='b'.repeat(64),CD='c'.repeat(40);
function fixture(t){
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-app-vault-'))),dir=path.join(home,'Library','Application Support','Agent Arcade Credentials');fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);
 const profile={schema:1,protocol:1,helperPath:path.join(dir,'helper-v1'),helperSha256:HASH,helperCdHash:CD,identitySha1:PIN,sourceSha256:HASH,service:'agent-arcade Safe Storage',account:'agent-arcade Key'};
 const file=path.join(dir,'profile-v1.json');fs.writeFileSync(file,JSON.stringify(profile),{mode:0o600});
 const metadata={macCredentialBroker:{protocol:1,identitySha1:PIN,helperSha256:HASH,helperCdHash:CD,sourceSha256:HASH}};
 const modes=new Map([[dir,0o700],[file,0o600]]);
 const setMode=(target,mode)=>{fs.chmodSync(target,mode);modes.set(target,mode);};
 // NTFS does not expose the POSIX owner/mode used by this macOS-only broker.
 // Keep the real file contents, descriptor checks and link metadata on every OS.
 if(process.platform==='win32'){
  process.getuid=()=>501;
  t.after(()=>{delete process.getuid;});
  const lstat=fs.lstatSync;
  t.mock.method(fs,'lstatSync',(target,...args)=>{
   const st=lstat(target,...args);
   if(modes.has(target)){st.uid=501;st.mode=(st.mode&~0o7777)|modes.get(target);}
   return st;
  });
 }
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {home,dir,file,profile,metadata,setMode};
}
test('Windows/Linux and source fixtures retain their native vault, without broker access',()=>{
 const native={marker:'native'};
 for(const platform of ['win32','linux'])assert.equal(applicationCredentialVault({platform,app:{isPackaged:true},nativeVault:native,create(){assert.fail();}}),native);
 assert.equal(applicationCredentialVault({platform:'darwin',app:{isPackaged:false},nativeVault:native,create(){assert.fail();}}),native);
});
test('packaged Mac with no signed broker pin locks credentials instead of touching native safeStorage',()=>{
 const native=new Proxy({},{get(){assert.fail('No native Keychain fallback');}});
 const vault=applicationCredentialVault({platform:'darwin',app:{isPackaged:true},nativeVault:native,metadata:{}});
 assert.equal(vault.isEncryptionAvailable(),false);assert.throws(()=>vault.encryptString('synthetic'),{code:'UNAVAILABLE'});assert.throws(()=>vault.decryptString(Buffer.from('synthetic')),{code:'UNAVAILABLE'});
});
test('signed App metadata must match the fixed private broker profile before factory admission',t=>{
 const f=fixture(t),expected={marker:'broker'};
 assert.equal(applicationCredentialVault({platform:'darwin',app:{isPackaged:true},home:f.home,metadata:f.metadata,create(options){assert.equal(options.profile.helperPath,f.profile.helperPath);assert.equal(options.trustedIdentity,PIN);return expected;}}),expected);
 for(const field of ['identitySha1','helperSha256','helperCdHash','sourceSha256']){
  const metadata=structuredClone(f.metadata);metadata.macCredentialBroker[field]='d'.repeat(f.metadata.macCredentialBroker[field].length);
  const vault=applicationCredentialVault({platform:'darwin',app:{isPackaged:true},home:f.home,metadata,create(){assert.fail('Changed pin admitted');}});assert.equal(vault.isEncryptionAvailable(),false);
 }
});
test('unsafe profile mode, directory mode, symlink and oversized profile never reach the factory',t=>{
 const f=fixture(t),read=()=>loadBrokerProfile({home:f.home,metadata:f.metadata});
 assert.equal(read().helperPath,f.profile.helperPath);
 f.setMode(f.file,0o644);assert.throws(read,{code:'INVALID_PROFILE'});f.setMode(f.file,0o600);
 f.setMode(f.dir,0o755);assert.throws(read,{code:'INVALID_PROFILE'});f.setMode(f.dir,0o700);
 fs.renameSync(f.file,f.file+'.saved');
 try{fs.symlinkSync(f.file+'.saved',f.file);}
 catch(error){
  if(process.platform!=='win32'||error.code!=='EPERM')throw error;
  fs.symlinkSync(f.home,f.file,'junction');
 }
 assert.throws(read,{code:'INVALID_PROFILE'});fs.unlinkSync(f.file);fs.renameSync(f.file+'.saved',f.file);
 fs.writeFileSync(f.file,'x'.repeat(16385));assert.throws(read,{code:'INVALID_PROFILE'});
});
test('packaged startup rejects interpreter, inspector, Chromium remote-debugging and unsafe code loading',()=>{
 for(const flag of ['--inspect','--inspect-brk=0','--inspect-publish-uid=stderr','--remote-debugging-port=9222','--remote-debugging-pipe','--remote-debugging-address=0.0.0.0','--js-flags=x','--load-extension=/tmp/x','--disable-web-security','--no-sandbox','--require=x','--eval=x','-r','-e'])assert.equal(credentialStartupAllowed(['app',flag]),false,flag);
 assert.equal(credentialStartupAllowed(['app','--arcade-credential-authorize-worker']),true);
 assert.equal(credentialStartupAllowed(['app','--arcade-credential-self-test']),true);
 assert.equal(credentialStartupAllowed(['app','--demo']),true);
});
