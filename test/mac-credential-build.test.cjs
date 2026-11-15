'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {brokerBuildArguments}=require('../scripts/mac-credential-build.cjs');
const PIN='61B339CA14A652471B585499FE49F8C3615CDEBD';
const profile={identitySha1:PIN,helperSha256:'a'.repeat(64),helperCdHash:'b'.repeat(40),sourceSha256:'c'.repeat(64)};
test('real builder schema converts CLI fuse values to the intended booleans and preserves public helper pins',async()=>{
 const builder=require('electron-builder/out/builder'),{validateConfiguration}=require('app-builder-lib/out/util/config/config');
 const args=brokerBuildArguments({identitySha1:PIN,readProfile:()=>({profile})});
 const config=builder.normalizeOptions(builder.configureBuildCommand(builder.createYargs()).parse(['--mac',...args])).config;
 await validateConfiguration(config,{isEnabled:false,add(){}});
 assert.deepEqual(config.electronFuses,{runAsNode:false,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,enableEmbeddedAsarIntegrityValidation:true,onlyLoadAppFromAsar:true,enableCookieEncryption:false});
 assert.deepEqual(config.extraMetadata.macCredentialBroker,{protocol:1,...profile});assert.equal(config.mac.hardenedRuntime,true);
});
test('a new App signer cannot silently replace or use a differently signed installed component',()=>{
 assert.throws(()=>brokerBuildArguments({identitySha1:'D'.repeat(40),readProfile:()=>({profile})}),/differs/);
});
