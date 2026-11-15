'use strict';
// Default local builds stay ad-hoc. Distribution can explicitly select the
// same installed signing identity on every release, without editing package.json.
const {spawnSync,execFileSync}=require('node:child_process');
function signingSelection(env){
  const identity=env.AGENT_ARCADE_MAC_SIGN_IDENTITY;
  if(identity!==undefined&&(typeof identity!=='string'||!identity.trim()||identity.length>200||/[\r\n\0]/.test(identity)||identity==='-'))throw Error('Set a consistent installed macOS signing identity, or leave AGENT_ARCADE_MAC_SIGN_IDENTITY unset for an ad-hoc build.');
  return identity?.trim();
}
function macArgs(args,env=process.env){
  if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw Error('Invalid build arguments.');
  const identity=signingSelection(env);
  if(identity&&args.some(arg=>/^(?:-c|--config)\.(?:mac\.(?:identity|sign)|forceCodeSigning)(?:=|$)/.test(arg)))throw Error('Do not override the selected macOS signing identity or required signing policy.');
  return ['--mac',...args,...(identity?['--config.mac.identity='+identity,'--config.forceCodeSigning=true']:[])];
}
// Reads certificate/identity metadata only. Never exports a private key, unlocks
// a Keychain, reads safeStorage or starts the application.
function installedIdentities({platform=process.platform,exec=execFileSync}={}){
  if(platform!=='darwin')throw Error('Installed Mac signing identities must be checked on macOS.');
  const output=exec('/usr/bin/security',['find-identity','-v','-p','codesigning'],{encoding:'utf8',timeout:15000,maxBuffer:128*1024,stdio:['ignore','pipe','pipe']});
  const identities=new Map();
  for(const line of String(output).split(/\r?\n/)){
    const match=/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"\r\n]+)"\s*$/.exec(line);
    if(match)identities.set(match[1].toUpperCase(),{sha1:match[1].toUpperCase(),name:match[2]});
  }
  return [...identities.values()];
}
function prepareMacBuild(argv,env=process.env,inspection){
  const checkOnly=argv.includes('--check-signing'),required=argv.includes('--require-stable-signing');
  const args=argv.filter(arg=>arg!=='--check-signing'&&arg!=='--require-stable-signing');
  if(checkOnly&&args.length)throw Error('--check-signing does not accept build arguments.');
  macArgs(args,env); // Validate before reading any signing metadata.
  const requested=signingSelection(env);
  if(!requested&&!required&&!checkOnly)return {args:macArgs(args,env),identity:null,checkOnly:false};
  const identities=installedIdentities(inspection);
  if(!requested){
    if(checkOnly)return {checkOnly:true,ready:false,identities,reason:identities.length?'Select an exact certificate SHA-1 with AGENT_ARCADE_MAC_SIGN_IDENTITY.':'No valid installed code-signing identities found.'};
    throw Error(identities.length?'Stable signing requires an explicitly selected certificate SHA-1; no identity was selected.':'No valid installed code-signing identities found. Stable packaging stopped before electron-builder.');
  }
  const matches=identities.filter(row=>row.sha1===requested.toUpperCase()||row.name===requested);
  if(matches.length!==1)throw Error(matches.length?'Signing name is ambiguous; select its exact certificate SHA-1.':'Selected signing identity is not valid and installed. Stable packaging stopped before electron-builder.');
  const identity=matches[0];
  // The builder rejects Apple certificate name prefixes and otherwise accepts
  // substring matches. Resolve the exact installed name/hash to a pinned hash.
  return {args:macArgs(args,{...env,AGENT_ARCADE_MAC_SIGN_IDENTITY:identity.sha1}),identity,checkOnly,ready:true};
}
if(require.main===module){
  try{
    const plan=prepareMacBuild(process.argv.slice(2));
    if(plan.checkOnly){console.log(JSON.stringify(plan));process.exitCode=plan.ready?0:1;}
    else{
      const env={...process.env};
      if(plan.identity)for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','CSC_INSTALLER_LINK','CSC_INSTALLER_KEY_PASSWORD','CSC_NAME'])delete env[key];
      const result=spawnSync(process.execPath,[require.resolve('electron-builder/cli.js'),...plan.args],{stdio:'inherit',env,shell:false});
      process.exitCode=result.error?1:result.status??1;
    }
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={macArgs,installedIdentities,prepareMacBuild};
