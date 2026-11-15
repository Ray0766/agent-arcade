'use strict';
// Default local builds stay ad-hoc. Distribution can explicitly select the
// same installed signing identity on every release, without editing package.json.
const {spawnSync}=require('node:child_process');
function macArgs(args,env=process.env){
  if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw Error('Invalid build arguments.');
  const identity=env.AGENT_ARCADE_MAC_SIGN_IDENTITY;
  if(identity!==undefined&&(!identity.trim()||identity.length>200||/[\r\n\0]/.test(identity)||identity==='-'))throw Error('Set a consistent installed macOS signing identity, or leave AGENT_ARCADE_MAC_SIGN_IDENTITY unset for an ad-hoc build.');
  if(identity&&args.some(arg=>/^(?:-c|--config)(?:\.|=).*mac\.identity|^--config\.mac\.identity/.test(arg)))throw Error('Do not specify a second macOS signing identity.');
  return ['--mac',...args,...(identity?['--config.mac.identity='+identity]:[])];
}
if(require.main===module){
  try{
    const args=macArgs(process.argv.slice(2));
    const result=spawnSync(process.execPath,[require.resolve('electron-builder/cli.js'),...args],{stdio:'inherit',env:process.env,shell:false});
    process.exitCode=result.error?1:result.status??1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={macArgs};
