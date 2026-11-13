'use strict';
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const {createHash,randomBytes}=require('node:crypto');

const PROTOCOL='agent-arcade-window-v1';
const MAX_BYTES=512;
const DEADLINE_MS=1500;
const failure=code=>Object.assign(new Error(code==='INSTANCE_UNKNOWN'
  ?'The existing Agent Arcade window could not be verified. Close it normally and try again.'
  :'Agent Arcade could not reserve its single application window. Close any older copy normally and try again.'),{code});

function instanceEndpoint({namespace='agent-arcade',platform=process.platform,user=os.userInfo(),hostname=os.hostname()}={}){
  if(!/^[a-z0-9-]{1,64}$/.test(namespace)||!user||typeof user.username!=='string'||!user.username||typeof user.homedir!=='string'||!user.homedir||typeof hostname!=='string'||!hostname)throw failure('INSTANCE_UNAVAILABLE');
  // userInfo().homedir comes from the OS, unlike environment/profile overrides.
  // No application profile, vault or command-line argument contributes to this name.
  const identity=JSON.stringify([platform,hostname,user.username,user.homedir]);
  const digest=createHash('sha256').update(identity).digest('hex').slice(0,32);
  const name=`${namespace}-${digest}`;
  if(platform==='win32')return `\\\\.\\pipe\\${name}`;
  if(platform==='linux')return `\0${name}`;
  return `/tmp/${name}.sock`;
}

function valid(row,field,value,nonce){
  return !!row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===3
    &&row.protocol===PROTOCOL&&row[field]===value&&typeof row.nonce==='string'
    &&/^[a-f0-9]{32}$/.test(row.nonce)&&(nonce===undefined||row.nonce===nonce);
}

function notifyPrimary(endpoint){
  return new Promise((resolve,reject)=>{
    const nonce=randomBytes(16).toString('hex'),socket=net.createConnection(endpoint);
    let buffer=Buffer.alloc(0),settled=false,connected=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(failure('INSTANCE_UNKNOWN')),DEADLINE_MS);
    socket.on('connect',()=>{connected=true;socket.write(JSON.stringify({protocol:PROTOCOL,command:'raise',nonce})+'\n');});
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length>MAX_BYTES){finish(failure('INSTANCE_UNKNOWN'));return;}
      const end=buffer.indexOf(10);if(end<0)return;
      try{if(end!==buffer.length-1||!valid(JSON.parse(buffer.subarray(0,end).toString('utf8')),'event','ack',nonce))throw failure('INSTANCE_UNKNOWN');finish();}
      catch{finish(failure('INSTANCE_UNKNOWN'));}
    });
    socket.on('error',error=>{
      // A primary can finish quitting between bind failure and connection. Only
      // the absence of a listener permits one bounded retry; bad peers do not.
      if(!connected&&['ENOENT','ECONNREFUSED'].includes(error.code))finish(Object.assign(failure('INSTANCE_UNAVAILABLE'),{retry:true}));
      else finish(failure('INSTANCE_UNKNOWN'));
    });
    socket.on('close',()=>{if(!settled)finish(failure('INSTANCE_UNKNOWN'));});
  });
}

function bindPrimary(endpoint,onRaise,onLost){
  return new Promise((resolve,reject)=>{
    const sockets=new Set();let closed=false,lost=false,closing;
    const server=net.createServer(socket=>{
      if(closed){socket.destroy();return;}
      sockets.add(socket);socket.on('error',()=>{});
      const timer=setTimeout(()=>socket.destroy(),DEADLINE_MS);let buffer=Buffer.alloc(0),handled=false;
      socket.on('close',()=>{clearTimeout(timer);sockets.delete(socket);});
      socket.on('data',chunk=>{
        if(handled){socket.destroy();return;}
        buffer=Buffer.concat([buffer,chunk]);if(buffer.length>MAX_BYTES){socket.destroy();return;}
        const end=buffer.indexOf(10);if(end<0)return;handled=true;
        try{
          const row=JSON.parse(buffer.subarray(0,end).toString('utf8'));
          if(end!==buffer.length-1||!valid(row,'command','raise'))throw failure('INSTANCE_UNKNOWN');
          onRaise();socket.end(JSON.stringify({protocol:PROTOCOL,event:'ack',nonce:row.nonce})+'\n');
        }catch{socket.destroy();}
      });
    });
    server.maxConnections=8;
    const close=()=>{
      if(closing)return closing;closed=true;
      closing=new Promise(done=>{for(const socket of sockets)socket.destroy();server.close(()=>done());});
      return closing;
    };
    const failed=error=>{server.close(()=>{});reject(error);};server.once('error',failed);
    server.listen(endpoint,()=>{
      server.removeListener('error',failed);
      // The desktop must quit normally if ownership is unexpectedly lost. Keep
      // a still-listening pipe until its normal close, including service cleanup.
      const ownershipLost=()=>{if(!closed&&!lost){lost=true;onLost();}};
      server.on('error',ownershipLost);server.on('close',ownershipLost);
      resolve({primary:true,close});
    });
  });
}

// Windows pipes and Linux abstract sockets vanish with their owner. A macOS (or
// other Unix) socket is a file that survives a crash or a forced kill, and its
// leftover would block every later start. Remove it only when it is a socket
// file owned by this user; the caller has just seen that nothing is listening.
function removeStaleSocket(endpoint,{platform=process.platform,fileSystem=fs,uid=typeof process.getuid==='function'?process.getuid():undefined}={}){
  if(platform==='win32'||typeof endpoint!=='string'||!endpoint.startsWith('/'))return false;
  try{
    const stat=fileSystem.lstatSync(endpoint);
    if(!stat.isSocket()||!Number.isInteger(uid)||stat.uid!==uid)return false;
    fileSystem.unlinkSync(endpoint);return true;
  }catch{return false;}
}

async function acquireSingleInstance({namespace='agent-arcade',onRaise=()=>{},onLost=()=>{}}={}){
  if(typeof onRaise!=='function'||typeof onLost!=='function')throw failure('INSTANCE_UNAVAILABLE');
  const endpoint=instanceEndpoint({namespace});
  for(let attempt=0;attempt<2;attempt++){
    try{return await bindPrimary(endpoint,onRaise,onLost);}
    catch(error){if(!['EADDRINUSE','EACCES','EPERM'].includes(error.code))throw failure('INSTANCE_UNAVAILABLE');}
    try{await notifyPrimary(endpoint);return {primary:false,close:async()=>{}};}
    catch(error){if(!error.retry||attempt===1)throw error;removeStaleSocket(endpoint);}
  }
  throw failure('INSTANCE_UNAVAILABLE');
}

module.exports={acquireSingleInstance,instanceEndpoint,removeStaleSocket};
