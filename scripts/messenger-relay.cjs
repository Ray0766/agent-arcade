#!/usr/bin/env node
'use strict';
// Explicit standalone relay entry. Importing it does not bind a socket.
const http=require('node:http'),path=require('node:path');
const {MessengerRelay}=require('../src/bot/messenger-relay.cjs');
const {MessengerError,id,secret}=require('../src/bot/messenger-transport.cjs');
function configuration(env=process.env){
  const appId=env.MESSENGER_APP_ID,pageId=env.MESSENGER_PAGE_ID,ownerId=env.MESSENGER_OWNER_ID;
  const databaseFile=env.MESSENGER_RELAY_DATABASE,port=env.MESSENGER_RELAY_PORT===undefined?8787:Number(env.MESSENGER_RELAY_PORT);
  if(!id(appId)||!id(pageId)||!id(ownerId)||pageId===ownerId||typeof databaseFile!=='string'||!path.isAbsolute(databaseFile)||
    !Number.isInteger(port)||port<1||port>65535||env.MESSENGER_RELAY_PORT!==undefined&&!/^\d{1,5}$/.test(env.MESSENGER_RELAY_PORT))throw new MessengerError('invalid_config');
  const appSecret=secret(env.MESSENGER_APP_SECRET),verifyToken=secret(env.MESSENGER_VERIFY_TOKEN),authToken=secret(env.MESSENGER_RELAY_TOKEN);
  if(new Set([appSecret,verifyToken,authToken]).size!==3)throw new MessengerError('invalid_config');
  return {databaseFile,appId,pageId,ownerId,appSecret,verifyToken,authToken,port};
}
async function startRelay(options){
  if(!options||!Number.isInteger(options.port)||options.port<0||options.port>65535)throw new MessengerError('invalid_config');
  const relay=new MessengerRelay(options),server=http.createServer({maxHeaderSize:8192,headersTimeout:5000,requestTimeout:6000,keepAliveTimeout:2000},relay.handler());
  server.maxConnections=32;server.maxRequestsPerSocket=100;server.on('clientError',(error,socket)=>socket.destroy());
  let closing,timer;
  const close=()=>{
    if(closing)return closing;
    clearInterval(timer);relay.close();
    closing=new Promise(resolve=>{server.close(()=>resolve({closed:true}));server.closeAllConnections();});return closing;
  };
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});}
  catch{relay.close();server.close();throw new MessengerError('listen_failed');}
  // At most ~30 seconds beyond logical TTL while this process is running.
  // No messages or upstream tokens are logged by this maintenance operation.
  timer=setInterval(()=>{try{relay.prune();}catch{void close();}},30000);timer.unref();
  server.on('error',()=>{void close();});
  return {host:'127.0.0.1',port:server.address().port,close};
}
async function main(){
  let running;
  try{running=await startRelay(configuration());}
  catch(error){const code=['invalid_config','scope_changed','unsafe_store','listen_failed'].includes(error?.code)?error.code:'relay_start_failed';process.stderr.write(`Messenger relay did not start (${code}).\n`);process.exitCode=1;return;}
  process.stdout.write(`Messenger relay is listening on 127.0.0.1:${running.port}. A separately configured HTTPS proxy is required.\n`);
  const stop=()=>{void running.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(require.main===module)void main();
module.exports={configuration,startRelay};
