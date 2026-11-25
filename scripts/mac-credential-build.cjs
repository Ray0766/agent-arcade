'use strict';
const {install}=require('./setup-mac-credential-broker.cjs');
function macRuntimeArguments(){
 return ['--config.mac.hardenedRuntime=true',
  '--config.electronFuses.runAsNode=false',
  '--config.electronFuses.enableNodeOptionsEnvironmentVariable=false',
  '--config.electronFuses.enableNodeCliInspectArguments=false',
  '--config.electronFuses.enableEmbeddedAsarIntegrityValidation=true',
  '--config.electronFuses.onlyLoadAppFromAsar=true',
  // This fuse is already false in the retained candidate; preserve that format.
  '--config.electronFuses.enableCookieEncryption=false'];
}
function brokerBuildArguments({identitySha1,readProfile=install}={}){
 const {profile}=readProfile();if(profile.identitySha1.toUpperCase()!==identitySha1.toUpperCase())throw Error('App signer differs from its fixed credential component.');
 const metadata={protocol:1,identitySha1:profile.identitySha1,helperSha256:profile.helperSha256,helperCdHash:profile.helperCdHash,sourceSha256:profile.sourceSha256};
 return [...macRuntimeArguments(),...Object.entries(metadata).map(([key,value])=>`--config.extraMetadata.macCredentialBroker.${key}=${value}`)];
}
module.exports={brokerBuildArguments,macRuntimeArguments};
