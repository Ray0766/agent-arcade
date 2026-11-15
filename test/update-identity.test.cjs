'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {configureAppIdentity,NAME}=require('../src/core/app-identity.cjs');
const {macArgs,installedIdentities,prepareMacBuild,localSigningProfile,runMacBuild}=require('../scripts/build-mac.cjs');
const noProfileHome=path.join(os.tmpdir(),'arcade-signing-no-profile-'+process.pid);
test('Mac source and package use the historic Keychain name without changing a custom data profile',()=>{
  for(const old of ['Electron','Agent Arcade','agent-arcade']){
    const app={name:old,profile:'/isolated/profile',setName(name){this.name=name;}};
    configureAppIdentity(app,{platform:'darwin'});assert.equal(app.name,NAME);assert.equal(app.profile,'/isolated/profile');
  }
  const other={setName(){assert.fail('Other platform identity must not change');}};
  configureAppIdentity(other,{platform:'win32'});configureAppIdentity(other,{platform:'linux'});
});
test('Mac packaging preserves argv paths and supports a stable installed signing identity explicitly',()=>{
  assert.deepEqual(macArgs(['--dir','-c.directories.output=/tmp/with spaces'],{}),['--mac','--dir','-c.directories.output=/tmp/with spaces']);
  const identity='Developer ID Application: Example (TEAM123)';
  assert.deepEqual(macArgs(['--dir'],{AGENT_ARCADE_MAC_SIGN_IDENTITY:identity}),['--mac','--dir','--config.mac.identity='+identity,'--config.forceCodeSigning=true']);
  for(const value of ['', '\nunsafe', '-'])assert.throws(()=>macArgs([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:value}));
  assert.throws(()=>macArgs(['-c.mac.identity=other'],{AGENT_ARCADE_MAC_SIGN_IDENTITY:identity}));
});
const SHA_A='A'.repeat(40),SHA_B='B'.repeat(40),NAME_A='Developer ID Application: Example (TEAM123)';
function inspection(output){return {platform:'darwin',home:noProfileHome,exec:(file,args,options)=>{
  assert.equal(file,'/usr/bin/security');assert.deepEqual(args,['find-identity','-v','-p','codesigning']);
  assert.equal(options.timeout,15000);return output;
}};}
const identityRows=`  1) ${SHA_A} "${NAME_A}"\n  1 valid identities found\n`;
test('stable preflight resolves an exact installed name to its hash and forces signing',()=>{
  const plan=prepareMacBuild(['--require-stable-signing','--mac','dmg:arm64','zip:arm64'],{AGENT_ARCADE_MAC_SIGN_IDENTITY:NAME_A},inspection(identityRows));
  assert.equal(plan.identity.sha1,SHA_A);assert(plan.args.includes('--config.mac.identity='+SHA_A));assert(plan.args.includes('--config.forceCodeSigning=true'));
  assert(!plan.args.includes('--require-stable-signing'));assert(!plan.args.some(arg=>arg.includes(NAME_A)));
  assert.equal(prepareMacBuild(['--check-signing'],{AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_A.toLowerCase()},inspection(identityRows)).ready,true);
});
test('missing, expired, ambiguous and substring selections cannot become an ad-hoc update',()=>{
  assert.throws(()=>prepareMacBuild(['--require-stable-signing'],{},inspection('0 valid identities found')),/No valid installed/);
  for(const requested of [NAME_A,SHA_A])assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:requested},inspection('0 valid identities found')),/not valid and installed/);
  assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:'Example'},inspection(identityRows)),/not valid and installed/);
  assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:NAME_A},inspection(identityRows+`2) ${SHA_B} "${NAME_A}"\n`)),/ambiguous/);
  assert.equal(installedIdentities(inspection(`1) ${SHA_A} "Expired" (CSSMERR_TP_CERT_EXPIRED)\n`)).length,0);
});
test('explicit stable signing rejects weaker CLI overrides and metadata failures',()=>{
  for(const option of ['-c.mac.identity=-','--config.mac.sign=false','-c.forceCodeSigning=false'])assert.throws(()=>prepareMacBuild([option],{AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_A},inspection(identityRows)),/Do not override/);
  assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_A},{platform:'darwin',home:noProfileHome,exec(){throw Error('Keychain metadata unavailable');}}),/metadata is unavailable/);
  assert.throws(()=>installedIdentities({platform:'linux',exec(){assert.fail();}}),/macOS/);
});
test('read-only inventory never builds or auto-selects a certificate; existing local ad-hoc mode remains explicit in its result',()=>{
  const empty=prepareMacBuild(['--check-signing'],{},inspection('0 valid identities found'));assert.equal(empty.ready,false);assert.deepEqual(empty.identities,[]);
  const available=prepareMacBuild(['--check-signing'],{},inspection(identityRows));assert.equal(available.ready,false);assert.equal(available.identities.length,1);
  const local=prepareMacBuild(['--dir'],{}, {platform:'darwin',home:noProfileHome,exec(){assert.fail('Ad-hoc mode must not query Keychain');}});assert.equal(local.identity,null);assert.deepEqual(local.args,['--mac','--dir']);
  assert.throws(()=>prepareMacBuild(['--check-signing','--dir'],{},inspection(identityRows)),/does not accept/);
});
function fixture(t){
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-signing-fixture-')));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const directory=path.join(home,'Library','Application Support','Agent Arcade Signing'),keychainFile=path.join(home,'Library','Keychains','agent-arcade-local-signing.keychain-db');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);fs.mkdirSync(path.dirname(keychainFile),{recursive:true});fs.writeFileSync(keychainFile,'fixture dedicated keychain',{mode:0o600});
  const profileFile=path.join(directory,'local-signing.json'),credentialsFile=path.join(directory,'credentials.json'),certificateFile=path.join(directory,'local-signing.pem'),password='FIXTURE-ONLY-signing-password';
  fs.writeFileSync(credentialsFile,JSON.stringify({keychainPassword:password}),{mode:0o600});fs.writeFileSync(certificateFile,'fixture public certificate',{mode:0o600});
  const profile={schema:1,localOnly:true,identitySha1:SHA_A.toLowerCase(),identityName:NAME_A,keychainFile,credentialsFile,certificateFile,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2036-01-01T00:00:00Z'};
  const certificate={fingerprint:SHA_A.match(/../g).join(':'),subject:'CN=Fixture local signing',issuer:'CN=Fixture local signing',ca:false,keyUsage:['1.3.6.1.5.5.7.3.3'],validFrom:'2026-01-01T00:00:00Z',validTo:'2036-01-01T00:00:00Z',publicKey:{},verify(key){return key===this.publicKey;}};
  const save=()=>{fs.writeFileSync(profileFile,JSON.stringify(profile),{mode:0o600});fs.chmodSync(profileFile,0o600);};save();
  const inspect={platform:'darwin',home,now:Date.parse('2026-11-15T00:00:00Z'),certParse(bytes){assert.equal(bytes.toString(),'fixture public certificate');return certificate;},exec:(file,args,options)=>{
    assert.equal(file,'/usr/bin/security');assert.deepEqual(args,['find-identity','-v','-p','codesigning',keychainFile]);assert.equal(options.timeout,15000);return identityRows;
  }};
  return {home,directory,keychainFile,profileFile,credentialsFile,certificateFile,password,profile,certificate,save,inspect};
}
test('Darwin automatically pins the persistent profile and scopes inventory to its dedicated Keychain',t=>{
  const f=fixture(t),plan=prepareMacBuild(['--dir'],{},f.inspect);
  assert.equal(plan.identity.sha1,SHA_A);assert.equal(plan.profile.profileFile,f.profileFile);assert.equal(plan.profile.keychainFile,f.keychainFile);
  assert.throws(()=>{plan.profile.identitySha1=SHA_B;},TypeError);
  for(const arg of ['--dir','--config.mac.identity='+SHA_A,'--config.forceCodeSigning=true','--config.mac.timestamp=none','--config.mac.notarize=false','--publish=never'])assert(plan.args.includes(arg));
  assert(!JSON.stringify(plan).includes(f.password));
  assert.equal(localSigningProfile({}, {...f.inspect,platform:'linux'}),null);
  assert.equal(prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_A.toLowerCase()},f.inspect).identity.sha1,SHA_A);
  for(const identity of [SHA_B,NAME_A])assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:identity},f.inspect),/differs from the pinned/);
});
test('an explicit private fixture profile is supported; absent or invalid selection never silently downgrades',t=>{
  const f=fixture(t),custom=path.join(f.directory,'custom-profile.json');fs.renameSync(f.profileFile,custom);
  const env={AGENT_ARCADE_MAC_SIGNING_PROFILE:custom};assert.equal(prepareMacBuild(['--dir'],env,f.inspect).profile.profileFile,custom);
  for(const selected of ['', 'relative.json',path.join(f.directory,'missing.json')])assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGNING_PROFILE:selected},f.inspect));
  fs.writeFileSync(custom,'invalid fixture JSON');assert.throws(()=>prepareMacBuild([],env,f.inspect),/could not be read safely/);
});
test('local profile schema, expiry and dedicated paths fail closed before metadata lookup',t=>{
  const f=fixture(t),original={...f.profile};
  for(const patch of [{schema:2},{localOnly:false},{identitySha1:'-'},{extra:'not-allowed'},{certificateTrust:'trust-any-root'},{expiresAt:'2020-01-01T00:00:00Z'},{createdAt:'2030-01-01T00:00:00Z'},{keychainFile:path.join(f.home,'Library','Keychains','login.keychain-db')},{keychainFile:'/Library/Keychains/System.keychain'},{keychainFile:path.join(f.home,'old-signing.keychain-db')},{credentialsFile:f.certificateFile},{certificateFile:f.credentialsFile}]){
    Object.keys(f.profile).forEach(key=>delete f.profile[key]);Object.assign(f.profile,original,patch);f.save();
    assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,exec(){assert.fail('Invalid profile must not inspect identities');}}));
  }
});
test('profile and credential permissions and symlinks are refused', {skip:process.platform==='win32'},t=>{
  const f=fixture(t);
  for(const file of [f.profileFile,f.credentialsFile]){fs.chmodSync(file,0o640);assert.throws(()=>localSigningProfile({},f.inspect),/restricted permissions|read safely/);fs.chmodSync(file,0o600);}
  fs.chmodSync(f.directory,0o750);assert.throws(()=>localSigningProfile({},f.inspect),/restricted permissions|read safely/);fs.chmodSync(f.directory,0o700);
  for(const file of [f.profileFile,f.credentialsFile,f.keychainFile]){
    const retained=file+'.retained';fs.renameSync(file,retained);fs.symlinkSync(retained,file);assert.throws(()=>localSigningProfile({},f.inspect));fs.unlinkSync(file);fs.renameSync(retained,file);
  }
});
test('--check-signing checks only metadata, without reading password content, unlocking or building',t=>{
  const f=fixture(t);fs.writeFileSync(f.credentialsFile,'deliberately not JSON; metadata check must not read it');
  const result=runMacBuild(['--check-signing'],{}, {inspection:f.inspect,exec(){assert.fail('Check must not unlock');},spawn(){assert.fail('Check must not build');},builder(){assert.fail('Check must not load builder');}});
  assert.equal(result.status,0);assert.equal(result.plan.ready,true);assert(!JSON.stringify(result).includes(f.password));
});
test('actual fixture build unlocks only its dedicated Keychain, strips import credentials and prevents external signing services',t=>{
  const f=fixture(t),calls=[];
  const env={CSC_LINK:'fixture-p12-link',CSC_KEY_PASSWORD:'fixture-p12-pass',CSC_INSTALLER_LINK:'fixture-installer',CSC_INSTALLER_KEY_PASSWORD:'fixture-installer-pass',CSC_NAME:'other',CSC_KEYCHAIN:'/old/chain',CSC_IDENTITY_AUTO_DISCOVERY:'false',WIN_CSC_LINK:'fixture-win-p12',APPLE_ID:'fixture@example.invalid',APPLE_API_KEY:'fixture-api-key',KEEP_THIS:'yes'};
  const result=runMacBuild(['--dir'],env,{inspection:f.inspect,builder:()=>'/fixture/builder.cjs',exec(file,args,options){assert.equal(file,'/usr/bin/security');assert.deepEqual(args,['unlock-keychain','-p',f.password,f.keychainFile]);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);calls.push('unlock');},spawn(file,args,options){
    calls.push('build');assert.equal(file,process.execPath);assert.equal(args[0],'/fixture/builder.cjs');assert.equal(options.env.CSC_KEYCHAIN,f.keychainFile);assert.equal(options.env.KEEP_THIS,'yes');assert.equal(options.shell,false);
    assert.deepEqual(Object.keys(options.env).filter(key=>/^(?:CSC_|WIN_CSC_|APPLE_)/.test(key)),['CSC_KEYCHAIN']);assert(!JSON.stringify(options.env).includes(f.password));return {status:0};
  }});
  assert.equal(result.status,0);assert.deepEqual(calls,['unlock','build']);assert(!JSON.stringify(result).includes(f.password));
});
test('a cold profile build validates policy, unlocks, inventories the pinned identity, then builds',t=>{
  const f=fixture(t),calls=[];let unlocked=false;
  const inspect={...f.inspect,exec(file,args,options){calls.push('inventory');assert.equal(unlocked,true,'Inventory must follow the dedicated unlock');return f.inspect.exec(file,args,options);}};
  const result=runMacBuild(['--dir'],{}, {inspection:inspect,exec(file,args){assert.deepEqual(args,['unlock-keychain','-p',f.password,f.keychainFile]);calls.push('unlock');unlocked=true;},builder:()=>'/fixture/builder.cjs',spawn(){calls.push('build');return {status:0};}});
  assert.equal(result.status,0);assert.deepEqual(calls,['unlock','inventory','build']);
  for(const args of [['--publish','always'],['-c.mac.identity=-']])assert.throws(()=>runMacBuild(args,{}, {inspection:f.inspect,exec(){assert.fail('Invalid policy must not unlock');},builder(){assert.fail('Invalid policy must not load builder');},spawn(){assert.fail();}}));
  assert.throws(()=>runMacBuild([], {AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_B}, {inspection:f.inspect,exec(){assert.fail('A mismatched pin must not unlock');},spawn(){assert.fail();}}),/differs from the pinned/);
});
test('plain preparation and check-only never invoke the cold-build unlock hook',t=>{
  const f=fixture(t),hook={beforeIdentityInspection(){assert.fail('Metadata-only preparation must not unlock');}};
  const plain=prepareMacBuild([],{},f.inspect);assert.equal(plain.ready,true);
  const checked=prepareMacBuild(['--check-signing'],{},f.inspect,hook);assert.equal(checked.ready,true);
  let inventory=0;
  assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,exec(){inventory++;return '0 valid identities found';}}),/not valid and installed/);
  assert.equal(inventory,1);
});
test('unlock and metadata errors cannot expose passwords, stderr, argv or an implicit ad-hoc fallback',t=>{
  const f=fixture(t),unsafe='failed argv '+f.password+' stderr fixture';
  assert.throws(()=>runMacBuild([],{}, {inspection:f.inspect,builder:()=>'/fixture/builder.cjs',exec(){throw Object.assign(Error(unsafe),{stderr:unsafe,cmd:unsafe});},spawn(){assert.fail('Failed unlock must stop build');}}),error=>error.message==='Could not unlock the dedicated local signing Keychain. Packaging stopped.'&&!JSON.stringify(error).includes(f.password)&&!error.cause);
  assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,exec(){throw Error(unsafe);}}),error=>error.message==='Signing identity metadata is unavailable.'&&!JSON.stringify(error).includes(f.password));
  for(const text of ['invalid JSON',JSON.stringify({keychainPassword:''}),JSON.stringify({keychainPassword:f.password,other:'unexpected'})]){fs.writeFileSync(f.credentialsFile,text);assert.throws(()=>runMacBuild([],{}, {inspection:f.inspect,builder:()=>'/fixture/builder.cjs',exec(){assert.fail('Invalid credentials must not unlock');},spawn(){assert.fail();}}),/Could not unlock/);}
});
test('a pinned profile rejects policy overrides, other installed identities and publication',t=>{
  const f=fixture(t);
  for(const args of [['--config=other.yml'],['-c','other.yml'],['-c.mac.identity=-'],['--config.mac.sign=false'],['-c.forceCodeSigning=false'],['-c.mac.timestamp=https://example.invalid'],['-c.mac.notarize=true'],['--publish=always'],['--publish','always'],['-p','always'],['-p=always']])assert.throws(()=>prepareMacBuild(args,{},f.inspect));
  for(const output of ['0 valid identities found',`1) ${SHA_B} "Other"`, `1) ${SHA_A} "Changed name"`])assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,exec:()=>output}));
});
test('the real builder receives one publish-never value when npm and profile both specify it',t=>{
  const f=fixture(t),builder=require('electron-builder/out/builder');
  for(const flags of [[],['--publish','never'],['--publish=never'],['-p','never'],['-p=never'],['--publish','never','--publish=never']]){
    const plan=prepareMacBuild([...flags,'--mac','dmg:arm64','zip:arm64'],{},f.inspect);
    const parsed=builder.normalizeOptions(builder.configureBuildCommand(builder.createYargs()).parse(plan.args));
    assert.equal(parsed.publish,'never');assert.equal(parsed.config.mac.identity,SHA_A);
    assert.equal(plan.args.filter(arg=>arg==='--publish=never').length,1);
  }
  assert.throws(()=>prepareMacBuild(['-pnever'],{},f.inspect),/Use --publish never/);
});
test('only a verified pinned local self-leaf may have the exact NOT_TRUSTED metadata suffix',t=>{
  const f=fixture(t),untrusted=`1) ${SHA_A} "${NAME_A}" (CSSMERR_TP_NOT_TRUSTED)\n1 valid identities found\n`;
  f.profile.certificateTrust='pinned-self-signed-local-only';f.save();
  assert.equal(prepareMacBuild(['--check-signing'],{}, {...f.inspect,exec:()=>untrusted}).ready,true);
  assert.equal(installedIdentities(inspection(untrusted)).length,0);
  assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_A},inspection(untrusted)),/not valid and installed/);
  for(const output of [untrusted.replace(SHA_A,SHA_B),untrusted.replace(NAME_A,'Other name'),untrusted.replace('CSSMERR_TP_NOT_TRUSTED','CSSMERR_TP_CERT_EXPIRED'),untrusted.replace('CSSMERR_TP_NOT_TRUSTED','CSSMERR_TP_NOT_TRUSTED CSSMERR_TP_CERT_EXPIRED')])assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,exec:()=>output}),/not valid and installed/);
});
test('certificate pin, self-signature, non-CA, sole code-signing EKU and validity are independently required',t=>{
  const f=fixture(t),original={...f.certificate},bad=[{fingerprint:SHA_B},{subject:'CN=Different issuer'},{verify(){return false;}},{ca:true},{keyUsage:[]},{keyUsage:['1.3.6.1.5.5.7.3.1']},{keyUsage:['1.3.6.1.5.5.7.3.3','1.3.6.1.5.5.7.3.1']},{validFrom:'2030-01-01T00:00:00Z'},{validTo:'2020-01-01T00:00:00Z'},{validTo:'invalid'},{validTo:'2035-01-01T00:00:00Z'}];
  for(const patch of bad){Object.assign(f.certificate,original,patch);assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,exec(){assert.fail('Invalid certificate must not inspect identities');}}),/valid self-signed, non-CA, code-signing-only/);}
  Object.assign(f.certificate,original);assert.throws(()=>prepareMacBuild([],{}, {...f.inspect,certParse(){throw Error('fixture parser detail');}}),/valid self-signed, non-CA, code-signing-only/);
});
