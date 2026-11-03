'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {atomicJSON}=require('../core/files.cjs');
const run=promisify(execFile);
function psLiteral(value){return `'${value.replace(/'/g,"''")}'`;}
async function discoverNative(){
  const runtime=JSON.parse((await run('node',['-p','JSON.stringify({path:process.execPath,version:process.versions.node})'],{timeout:5000,windowsHide:true})).stdout.trim());
  const node=runtime.path,parts=runtime.version?.split('.').map(Number);
  if(!path.isAbsolute(node)||!parts||parts[0]<22||parts[0]===22&&parts[1]<13)throw Error('Install Node.js 22.13+ and restart the app.');
  let cli;
  if(process.platform==='win32'){
    const local=path.join(process.env.USERPROFILE||'','.local','bin','claude.exe');
    if(fs.existsSync(local))cli=local;
    else{const found=(await run('where.exe',['claude.exe'],{timeout:5000,windowsHide:true})).stdout.split(/\r?\n/).find(p=>path.isAbsolute(p)&&fs.existsSync(p));cli=found;}
  }else cli=(await run('which',['claude'],{timeout:5000})).stdout.trim();
  if(!cli||!path.isAbsolute(cli))throw Error('Install the native Claude Code CLI and log in through its own terminal.');
  const version=(await run(cli,['--version'],{timeout:10000,windowsHide:true})).stdout;
  const numbers=version.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if(!numbers||numbers[0]<2||(numbers[0]===2&&numbers[1]===1&&numbers[2]<317)||numbers[0]===2&&numbers[1]<1)throw Error('Claude Code 2.1.317+ is required for this native preview.');
  return {node,cli};
}
function createNativeLaunch({root,workspace,url,token,node,cli,sourceDir}){
  const script=path.join(sourceDir,'native-channel.cjs').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  if(!fs.existsSync(script))throw Error('The native channel script is missing from the application package.');
  const folder=path.join(root,'native-launch',crypto.randomUUID()),file=path.join(folder,'mcp.json');
  atomicJSON(file,{mcpServers:{'agent-arcade-wechat':{command:node,args:[script],env:{ARCADE_BRIDGE_URL:url,ARCADE_BRIDGE_TOKEN:token}}}});
  let command;
  if(process.platform==='win32')command=`Set-Location -LiteralPath ${psLiteral(workspace)}\n& ${psLiteral(cli)} --permission-mode default --strict-mcp-config --mcp-config ${psLiteral(file)} --dangerously-load-development-channels server:agent-arcade-wechat`;
  else{const quote=s=>`'${s.replace(/'/g,"'\\''")}'`;command=`cd -- ${quote(workspace)}\n${quote(cli)} --permission-mode default --strict-mcp-config --mcp-config ${quote(file)} --dangerously-load-development-channels server:agent-arcade-wechat`;}
  return {command,file,cleanup:()=>{try{fs.unlinkSync(file);fs.rmdirSync(folder);}catch{/* Another process may still have a read handle. The broker capability is already revoked. */}}};
}
module.exports={discoverNative,createNativeLaunch,psLiteral};
