'use strict';
// A persistent, local-only profile pins personal builds to one dedicated
// Keychain. Without a profile the existing explicit/legacy behavior remains.
const {spawnSync,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {X509Certificate}=require('node:crypto');
const PROFILE_FIELDS=['schema','localOnly','identitySha1','identityName','keychainFile','credentialsFile','certificateFile','createdAt','expiresAt'];
const PINNED_SELF_SIGNED=Symbol('validated local-only self-signed certificate');
function signingError(message){return Error(message);}
function privateFile(file,{privateMode=true,maxBytes=16384}={}){
  try{
    const parent=fs.lstatSync(path.dirname(file)),stat=fs.lstatSync(file),uid=typeof process.getuid==='function'?process.getuid():null;
    if(!parent.isDirectory()||parent.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw Error();
    if(uid!==null&&(parent.uid!==uid||stat.uid!==uid||(parent.mode&0o7777)!==0o700||privateMode&&(stat.mode&0o077)!==0))throw Error();
    return stat;
  }catch{throw signingError('Local signing files must be owned regular files in a private directory with restricted permissions.');}
}
function readSigningFile(file,maxBytes,{privateMode=true}={}){
  const before=privateFile(file,{maxBytes,privateMode});let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const after=fs.fstatSync(fd);
    if(!after.isFile()||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.uid!==after.uid||privateMode&&typeof process.getuid==='function'&&(after.mode&0o077)!==0)throw Error();
    const bytes=Buffer.alloc(maxBytes+1);let count=0,read;
    while(count<bytes.length&&(read=fs.readSync(fd,bytes,count,bytes.length-count,null))>0)count+=read;
    if(count>maxBytes||count!==before.size)throw Error();
    return bytes.subarray(0,count);
  }catch{throw signingError('The local signing file could not be read safely.');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function readPrivateJSON(file,maxBytes){
  try{return JSON.parse(readSigningFile(file,maxBytes).toString('utf8'));}
  catch{throw signingError('The local signing JSON could not be read safely.');}
}
// Only metadata is read here. In particular --check-signing never opens the
// credential contents or unlocks any Keychain.
function localSigningProfile(env=process.env,{platform=process.platform,home=os.homedir(),now=Date.now(),certParse=bytes=>new X509Certificate(bytes)}={}){
  if(platform!=='darwin')return null;
  const explicit=env.AGENT_ARCADE_MAC_SIGNING_PROFILE;
  const file=explicit===undefined?path.join(home,'Library','Application Support','Agent Arcade Signing','local-signing.json'):explicit;
  if(typeof file!=='string'||!path.isAbsolute(file)||/[\r\n\0]/.test(file))throw signingError('Use an absolute local signing profile path.');
  try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT'&&explicit===undefined)return null;throw signingError('The selected local signing profile is unavailable.');}
  const profile=readPrivateJSON(file,16384);
  if(!profile||Array.isArray(profile)||Object.keys(profile).some(key=>![...PROFILE_FIELDS,'certificateTrust'].includes(key))||PROFILE_FIELDS.some(key=>!Object.hasOwn(profile,key))||Object.hasOwn(profile,'certificateTrust')&&profile.certificateTrust!=='pinned-self-signed-local-only'||profile.schema!==1||profile.localOnly!==true||typeof profile.identitySha1!=='string'||!/^[A-Fa-f0-9]{40}$/.test(profile.identitySha1)||typeof profile.identityName!=='string'||!profile.identityName.trim()||profile.identityName.length>200||/[\r\n\0]/.test(profile.identityName))throw signingError('The local signing profile has invalid pinned metadata.');
  for(const key of ['keychainFile','credentialsFile','certificateFile'])if(typeof profile[key]!=='string'||!path.isAbsolute(profile[key])||/[\r\n\0]/.test(profile[key]))throw signingError('The local signing profile has invalid file paths.');
  const directory=path.dirname(file),expectedChain=path.join(home,'Library','Keychains','agent-arcade-local-signing.keychain-db');
  if(profile.keychainFile!==expectedChain||profile.credentialsFile!==path.join(directory,'credentials.json')||path.dirname(profile.certificateFile)!==directory||new Set([file,profile.credentialsFile,profile.certificateFile,profile.keychainFile]).size!==4)throw signingError('Local signing must use its dedicated Keychain and separate profile-directory files.');
  const created=Date.parse(profile.createdAt),expires=Date.parse(profile.expiresAt);
  if(typeof profile.createdAt!=='string'||typeof profile.expiresAt!=='string'||!Number.isFinite(created)||!Number.isFinite(expires)||created>now||expires<=now||expires<=created)throw signingError('The local signing profile is expired or has invalid dates.');
  privateFile(profile.credentialsFile,{maxBytes:4096});privateFile(profile.certificateFile,{privateMode:false,maxBytes:128*1024});
  try{const stat=fs.lstatSync(profile.keychainFile);if(!stat.isFile()||stat.isSymbolicLink()||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error();}catch{throw signingError('The dedicated local signing Keychain is unavailable or unsafe.');}
  try{
    const certificate=certParse(readSigningFile(profile.certificateFile,128*1024,{privateMode:false})),from=Date.parse(certificate.validFrom),to=Date.parse(certificate.validTo);
    if(certificate.fingerprint.replace(/:/g,'').toUpperCase()!==profile.identitySha1.toUpperCase()||certificate.subject!==certificate.issuer||certificate.verify(certificate.publicKey)!==true||certificate.ca!==false||!Array.isArray(certificate.keyUsage)||certificate.keyUsage.length!==1||certificate.keyUsage[0]!=='1.3.6.1.5.5.7.3.3'||!Number.isFinite(from)||!Number.isFinite(to)||from>now||to<=now||to!==expires)throw Error();
  }catch{throw signingError('The pinned local certificate must be a valid self-signed, non-CA, code-signing-only certificate matching the profile.');}
  const validated={...profile,identitySha1:profile.identitySha1.toUpperCase(),profileFile:file};
  Object.defineProperty(validated,PINNED_SELF_SIGNED,{value:true});return Object.freeze(validated);
}
function signingSelection(env){
  const identity=env.AGENT_ARCADE_MAC_SIGN_IDENTITY;
  if(identity!==undefined&&(typeof identity!=='string'||!identity.trim()||identity.length>200||/[\r\n\0]/.test(identity)||identity==='-'))throw Error('Select a nonempty installed signing identity; an explicit ad-hoc identity is not accepted.');
  return identity?.trim();
}
function macArgs(args,env=process.env){
  if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw Error('Invalid build arguments.');
  const identity=signingSelection(env);
  if(identity&&args.some(arg=>/^(?:-c|--config)(?:=|$)|^(?:-c|--config)\.(?:mac(?:\.(?:identity|sign|timestamp|notarize))?|forceCodeSigning)(?:=|$)/.test(arg)))throw Error('Do not override the selected macOS signing identity or required signing policy.');
  return ['--mac',...args,...(identity?['--config.mac.identity='+identity,'--config.forceCodeSigning=true']:[])];
}
// Reads certificate/identity metadata only. Never exports a private key, unlocks
// a Keychain, reads safeStorage or starts the application.
function installedIdentities({platform=process.platform,exec=execFileSync,keychainFile,localProfile}={}){
  if(platform!=='darwin')throw Error('Installed Mac signing identities must be checked on macOS.');
  let output;
  try{output=exec('/usr/bin/security',['find-identity','-v','-p','codesigning',...(keychainFile?[keychainFile]:[])],{encoding:'utf8',timeout:15000,maxBuffer:128*1024,stdio:['ignore','pipe','pipe']});}
  catch{throw signingError('Signing identity metadata is unavailable.');}
  const identities=new Map();
  for(const line of String(output).split(/\r?\n/)){
    const match=/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"\r\n]+)"(?: \((CSSMERR_TP_NOT_TRUSTED)\))?\s*$/.exec(line);
    // This exception is pinned to a cryptographically checked local self-leaf,
    // never a generic allowance for untrusted/expired identities or roots.
    if(match&&(!match[3]||localProfile?.[PINNED_SELF_SIGNED]&&match[1].toUpperCase()===localProfile.identitySha1&&match[2]===localProfile.identityName))identities.set(match[1].toUpperCase(),{sha1:match[1].toUpperCase(),name:match[2]});
  }
  return [...identities.values()];
}
function prepareMacBuild(argv,env=process.env,inspection,{beforeIdentityInspection}={}){
  const checkOnly=argv.includes('--check-signing'),required=argv.includes('--require-stable-signing');
  const args=argv.filter(arg=>arg!=='--check-signing'&&arg!=='--require-stable-signing');
  if(checkOnly&&args.length)throw Error('--check-signing does not accept build arguments.');
  macArgs(args,env); // Validate before reading any signing metadata.
  const profile=localSigningProfile(env,inspection),explicit=signingSelection(env);
  if(profile&&explicit&&explicit.toUpperCase()!==profile.identitySha1)throw signingError('The explicit signing identity differs from the pinned local profile.');
  const requested=profile?.identitySha1||explicit;
  if(!requested&&!required&&!checkOnly)return {args:macArgs(args,env),identity:null,checkOnly:false};
  const selectedEnv={...env,AGENT_ARCADE_MAC_SIGN_IDENTITY:requested};
  if(profile){
    macArgs(args,selectedEnv);
    // npm's dist entry already supplies --publish never. Forward exactly one
    // value: yargs turns repeated values into an array, which is not "never".
    const filtered=[];
    for(let i=0;i<args.length;i++){
      if(['--publish','-p'].includes(args[i])){if(args[++i]!=='never')throw signingError('A local-only signing profile cannot publish a build.');}
      else if(/^(?:--publish|-p)=/.test(args[i])){if(!/^(?:--publish|-p)=never$/.test(args[i]))throw signingError('A local-only signing profile cannot publish a build.');}
      else if(/^-p.+/.test(args[i]))throw signingError('Use --publish never for local-only signing.');
      else filtered.push(args[i]);
    }
    args.splice(0,args.length,...filtered);
  }
  // Actual builds may need a cold dedicated Keychain unlocked before inventory.
  // This hook runs only after profile/pin/argv validation. Metadata-only callers
  // and --check-signing never unlock or read password contents.
  if(profile&&!checkOnly&&beforeIdentityInspection)beforeIdentityInspection(profile);
  const identities=installedIdentities({...inspection,keychainFile:profile?.keychainFile,localProfile:profile});
  if(!requested){
    if(checkOnly)return {checkOnly:true,ready:false,identities,reason:identities.length?'Select an exact certificate SHA-1 with AGENT_ARCADE_MAC_SIGN_IDENTITY.':'No valid installed code-signing identities found.'};
    throw Error(identities.length?'Stable signing requires an explicitly selected certificate SHA-1; no identity was selected.':'No valid installed code-signing identities found. Stable packaging stopped before electron-builder.');
  }
  const matches=identities.filter(row=>row.sha1===requested.toUpperCase()||row.name===requested);
  if(matches.length!==1)throw Error(matches.length?'Signing name is ambiguous; select its exact certificate SHA-1.':'Selected signing identity is not valid and installed. Stable packaging stopped before electron-builder.');
  const identity=matches[0];
  if(profile&&identity.name!==profile.identityName)throw signingError('Installed signing metadata does not match the pinned local profile.');
  // The builder rejects Apple certificate name prefixes and otherwise accepts
  // substring matches. Resolve the exact installed name/hash to a pinned hash.
  return {args:[...macArgs(args,{...env,AGENT_ARCADE_MAC_SIGN_IDENTITY:identity.sha1}),...(profile?['--config.mac.timestamp=none','--config.mac.notarize=false','--publish=never']:[])],identity,checkOnly,ready:true,...(profile?{profile}:{})};
}
function buildEnvironment(env,plan){
  const clean={...env};
  if(plan.identity)for(const key of Object.keys(clean))if(/^(?:CSC_|WIN_CSC_)/.test(key))delete clean[key];
  if(plan.profile){for(const key of Object.keys(clean))if(key.startsWith('APPLE_'))delete clean[key];clean.CSC_KEYCHAIN=plan.profile.keychainFile;}
  return clean;
}
function unlockLocalSigning(profile,{exec=execFileSync}={}){
  // The password lives only in this short-lived scope. Never return it, attach
  // the caught child-process error, or print argv/stderr (which may contain it).
  try{
    const credentials=readPrivateJSON(profile.credentialsFile,4096);
    if(!credentials||Object.keys(credentials).length!==1||typeof credentials.keychainPassword!=='string'||!credentials.keychainPassword||credentials.keychainPassword.length>1024||/[\r\n\0]/.test(credentials.keychainPassword))throw Error();
    exec('/usr/bin/security',['unlock-keychain','-p',credentials.keychainPassword,profile.keychainFile],{encoding:'utf8',timeout:15000,maxBuffer:16384,stdio:['ignore','pipe','pipe']});
  }catch{throw signingError('Could not unlock the dedicated local signing Keychain. Packaging stopped.');}
}
function runMacBuild(argv,env=process.env,{inspection,exec=execFileSync,spawn=spawnSync,builder=()=>require.resolve('electron-builder/cli.js'),credentialArgs}={}){
  const plan=prepareMacBuild(argv,env,inspection,{beforeIdentityInspection:profile=>unlockLocalSigning(profile,{exec})});
  if(plan.checkOnly)return {plan,status:plan.ready?0:1};
  const extra=credentialArgs?credentialArgs(plan.profile):[];
  const builderFile=builder();
  const result=spawn(process.execPath,[builderFile,...plan.args,...extra],{stdio:'inherit',env:buildEnvironment(env,plan),shell:false});
  return {plan,status:result.error?1:result.status??1};
}
// The CLI's credential preflight imports the explicit installer, which reuses
// these signing primitives. Publish them before entering that dependency chain.
module.exports={macArgs,installedIdentities,prepareMacBuild,localSigningProfile,buildEnvironment,unlockLocalSigning,runMacBuild};
if(require.main===module){
  try{
    const {plan,status}=runMacBuild(process.argv.slice(2),process.env,{credentialArgs:profile=>{
      if(!profile)throw Error('Mac credential packaging requires a pinned local signing profile and its fixed credential component.');
      if(process.argv.slice(2).some(value=>/(?:electronFuses|mac\.hardenedRuntime|mac\.additionalArguments|extraMetadata\.macCredentialBroker)/.test(value)))throw Error('The local credential runtime policy cannot be overridden.');
      return require('./mac-credential-build.cjs').brokerBuildArguments({identitySha1:profile.identitySha1});
    }});
    if(plan.checkOnly)console.log(JSON.stringify(plan));
    process.exitCode=status;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
