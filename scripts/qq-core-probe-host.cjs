'use strict';
// Original installation-only prototype. This host never starts QQ, imports a
// QQ addon, opens a socket, or touches an account/profile. It is not a QQ core.
const {TextDecoder}=require('node:util');
const {probeInstallation}=require('./qq-install-probe.cjs');
const PROTOCOL='arcade-qq-install-probe-v1';
const MAX_LINE_BYTES=1024,MAX_REQUESTS=16,MAX_INSPECTIONS=2,MAX_OUTPUT_BYTES=131072;
const BASELINE=Object.freeze({
  version:'9.9.36-53644',
  // Observed local installation fingerprints, not Tencent-signed SDK approval.
  hashes:Object.freeze({
    'QQ.exe':'fb2d3b4ee2a372752edd1fda620e9aae27b7dea9903f7ecf5b84cb6483ecd7c5',
    'QQNT.dll':'75b19e58a123b0513e99df4df3ebc6524478535ba44651024d6a20821f5086e5',
    'wrapper.node':'0d8b94448f4dafe7337b88d6a568b004224c37fcbe2bd1142c1af7624fbd534c',
    'major.node':'4564e402d1cf43a0f15982411596cf38b8d9b8fbc78f5e7ca717e27c24c74a07',
    'ipc.node':'376445321157383bc1fb09cd3592809437b7d0ff24ca480c9bbd370244d8825e',
    'initIpc_x64.node':'f4adeab476de65ede3bff22607d48d4b754f66f200403a8ea06b63e7419bbead',
    'application.asar':'e2a43308e5a373f7225318cb3792e264f88799a0bdebde2fcdd61f734550f10b'
  })
});
const CAPABILITIES=Object.freeze({installationMetadata:'implemented',versionFingerprint:'implemented',ordinaryAccountAuthentication:'not_implemented',privateMessageEvents:'not_implemented',sendText:'not_implemented',qzone:'not_implemented'});

function evaluateFingerprint(report){
  if(report.package.version!==BASELINE.version)return {state:'unobserved_version',baseline:BASELINE.version,protocolCompatible:'unverified'};
  const entries=[...report.nativeFiles,{relativePath:report.applicationArchive.relativePath,sha256:report.applicationArchive.sha256}];
  const changed=Object.keys(BASELINE.hashes).filter(name=>!entries.some(entry=>entry.relativePath.replaceAll('\\','/').split('/').at(-1)===name&&entry.sha256===BASELINE.hashes[name]));
  return {state:changed.length?'same_version_different_files':'matches_observed_installation',baseline:BASELINE.version,changed,protocolCompatible:'unverified'};
}

function createProbeSession({installRoot,version,inspect=probeInstallation}){
  const ids=new Set();let inspections=0,closed=false,last=null;
  const response=(id,body)=>({protocol:PROTOCOL,id,...body});
  return {
    get closed(){return closed;},
    handle(request){
      if(closed)return response(null,{ok:false,error:'SESSION_CLOSED'});
      if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!=='id,method,protocol'||request.protocol!==PROTOCOL||typeof request.id!=='string'||!/^[-A-Za-z0-9_]{1,48}$/.test(request.id)||typeof request.method!=='string')return response(null,{ok:false,error:'INVALID_REQUEST'});
      if(ids.has(request.id))return response(request.id,{ok:false,error:'DUPLICATE_REQUEST'});
      if(ids.size>=MAX_REQUESTS){closed=true;return response(request.id,{ok:false,error:'REQUEST_LIMIT'});}
      ids.add(request.id);
      if(request.method==='close'){closed=true;return response(request.id,{ok:true,result:{state:'closed'}});}
      if(request.method==='capabilities')return response(request.id,{ok:true,result:{capabilities:CAPABILITIES,mode:'installation_only',qqProtocolValidated:false}});
      if(request.method==='status')return response(request.id,{ok:true,result:{state:last?'installation_observed':'installation_not_inspected',accountState:'unverified',fingerprint:last,qqProtocolValidated:false}});
      if(request.method!=='inspect-installation')return response(request.id,{ok:false,error:'CAPABILITY_NOT_IMPLEMENTED'});
      if(inspections>=MAX_INSPECTIONS)return response(request.id,{ok:false,error:'INSPECTION_LIMIT'});
      inspections++;
      try{
        const report=inspect(installRoot,version);last=evaluateFingerprint(report);
        // Files are selected once by the parent; IPC cannot select any path.
        const {installationRoot,...metadata}=report;
        return response(request.id,{ok:true,result:{...metadata,fingerprint:last}});
      }catch{last=null;return response(request.id,{ok:false,error:'INSTALLATION_PROBE_FAILED'});}
    }
  };
}

function serve({input=process.stdin,output=process.stdout,installRoot,version,inspect,timeoutMs=30000}){
  const session=createProbeSession({installRoot,version,inspect});let buffer=Buffer.alloc(0),finished=false,requestCount=0;
  const write=value=>{const line=JSON.stringify(value)+'\n';if(Buffer.byteLength(line)>MAX_OUTPUT_BYTES)return false;output.write(line);return true;};
  const done=()=>{if(finished)return;finished=true;clearTimeout(deadline);input.off('data',onData);input.off('end',onEnd);input.pause();};
  const fail=error=>{write({protocol:PROTOCOL,id:null,ok:false,error});done();};
  const onEnd=()=>{if(buffer.length)fail('INCOMPLETE_FRAME');else done();};
  const onData=chunk=>{
    if(finished)return;
    // Node may batch several short lines in one chunk; enforce each frame and
    // a bounded total number before retaining or parsing any peer-provided data.
    if(chunk.length>(MAX_REQUESTS+1)*(MAX_LINE_BYTES+1))return fail('INPUT_LIMIT');
    buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
    for(let newline;!finished&&(newline=buffer.indexOf(10))>=0;){
      if(newline>MAX_LINE_BYTES)return fail('FRAME_LIMIT');
      if(++requestCount>MAX_REQUESTS)return fail('REQUEST_LIMIT');
      const frame=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);
      let request;try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));}catch{return fail('INVALID_JSON');}
      if(!write(session.handle(request)))return fail('OUTPUT_LIMIT');
      if(session.closed)done();
    }
    if(!finished&&buffer.length>MAX_LINE_BYTES)fail('FRAME_LIMIT');
  };
  const deadline=setTimeout(()=>fail('SESSION_TIMEOUT'),timeoutMs);
  input.on('data',onData);input.once('end',onEnd);
  write({protocol:PROTOCOL,event:'ready',mode:'installation_only',capabilities:CAPABILITIES,qqProtocolValidated:false});
  return {close:done};
}

if(require.main===module){
  if(process.argv.length!==4){process.stderr.write('Usage: node scripts/qq-core-probe-host.cjs <QQ installation directory> <9.x.x-build>\n');process.exitCode=1;}
  else{process.stdout.on('error',()=>process.exit(1));serve({installRoot:process.argv[2],version:process.argv[3]});}
}
module.exports={PROTOCOL,BASELINE,CAPABILITIES,MAX_LINE_BYTES,evaluateFingerprint,createProbeSession,serve};
