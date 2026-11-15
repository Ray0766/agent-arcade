'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configureAppIdentity,NAME}=require('../src/core/app-identity.cjs');
const {macArgs,installedIdentities,prepareMacBuild}=require('../scripts/build-mac.cjs');
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
function inspection(output){return {platform:'darwin',exec:(file,args,options)=>{
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
  assert.throws(()=>prepareMacBuild([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:SHA_A},{platform:'darwin',exec(){throw Error('Keychain metadata unavailable');}}),/metadata unavailable/);
  assert.throws(()=>installedIdentities({platform:'linux',exec(){assert.fail();}}),/macOS/);
});
test('read-only inventory never builds or auto-selects a certificate; existing local ad-hoc mode remains explicit in its result',()=>{
  const empty=prepareMacBuild(['--check-signing'],{},inspection('0 valid identities found'));assert.equal(empty.ready,false);assert.deepEqual(empty.identities,[]);
  const available=prepareMacBuild(['--check-signing'],{},inspection(identityRows));assert.equal(available.ready,false);assert.equal(available.identities.length,1);
  const local=prepareMacBuild(['--dir'],{}, {exec(){assert.fail('Ad-hoc mode must not query Keychain');}});assert.equal(local.identity,null);assert.deepEqual(local.args,['--mac','--dir']);
  assert.throws(()=>prepareMacBuild(['--check-signing','--dir'],{},inspection(identityRows)),/does not accept/);
});
