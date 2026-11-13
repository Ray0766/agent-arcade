'use strict';
// Installation metadata only. Never loads a QQ module, starts a process, opens
// a network connection, or reads account/profile/session files.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const asar=require('@electron/asar');

function inspectPe(file){
  const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size;
  const read=(offset,length)=>{
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>16384||offset+length>size)throw Error('Invalid bounded PE metadata');
    const bytes=Buffer.alloc(length);if(fs.readSync(fd,bytes,0,length,offset)!==length)throw Error('Incomplete PE metadata');return bytes;
  };
  try{
    const dos=read(0,64);if(dos.readUInt16LE(0)!==0x5a4d)throw Error('Not a PE file');
    const peOffset=dos.readUInt32LE(60);if(peOffset>1048576)throw Error('Unexpected PE offset');
    const pe=read(peOffset,24);if(pe.readUInt32LE(0)!==0x4550)throw Error('Missing PE signature');
    const machine=pe.readUInt16LE(4),count=pe.readUInt16LE(6),optionalSize=pe.readUInt16LE(20);
    if(count>96||optionalSize<112||optionalSize>4096)throw Error('Unexpected PE header');
    const optional=read(peOffset+24,optionalSize),magic=optional.readUInt16LE(0),directoryOffset=magic===0x20b?112:magic===0x10b?96:0;
    if(!directoryOffset||directoryOffset+8>optional.length)throw Error('Unsupported PE layout');
    const table=read(peOffset+24+optionalSize,count*40),sections=[];
    for(let index=0;index<count;index++){
      const offset=index*40;sections.push({virtualSize:table.readUInt32LE(offset+8),rva:table.readUInt32LE(offset+12),rawSize:table.readUInt32LE(offset+16),raw:table.readUInt32LE(offset+20)});
    }
    const atRva=(rva,length)=>{
      if(rva<optional.readUInt32LE(60))return read(rva,length);
      const section=sections.find(item=>rva>=item.rva&&rva-item.rva+length<=item.rawSize);
      if(!section)throw Error('PE export outside mapped file');return read(section.raw+rva-section.rva,length);
    };
    const exportRva=optional.readUInt32LE(directoryOffset),registrationExports=[];
    let functionCount=0,namedExportCount=0,longNameCount=0;
    if(exportRva){
      const exports=atRva(exportRva,40),namesCount=exports.readUInt32LE(24),namesRva=exports.readUInt32LE(32);functionCount=exports.readUInt32LE(20);namedExportCount=namesCount;
      if(namesCount>4096)throw Error('PE export count exceeds probe limit');
      const names=atRva(namesRva,namesCount*4);
      for(let index=0;index<namesCount;index++){
        const rva=names.readUInt32LE(index*4);let value='';
        for(let offset=0;offset<64;offset++){const code=atRva(rva+offset,1)[0];if(!code)break;if(code<32||code>126)throw Error('Non-ASCII PE export');value+=String.fromCharCode(code);}
        // Long C++ symbols are not copied. Only short standard Node registration
        // exports are relevant to this probe; none declares a QQ message API.
        if(value.length===64)longNameCount++;
        if(/^(napi_register_module_v\d+|node_register_module_v\d+|node_api_module_get_api_version_v\d+)$/.test(value))registrationExports.push(value);
      }
    }
    return {format:magic===0x20b?'PE32+':'PE32',machine:`0x${machine.toString(16)}`,architecture:({0x8664:'x64',0xaa64:'arm64',0x14c:'x86'})[machine]||'unknown',functionCount,namedExportCount,registrationExports,longNamePrefixesDiscarded:longNameCount};
  }finally{fs.closeSync(fd);}
}

function hashFile(file){
  const fd=fs.openSync(file,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1048576);
  try{let read;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,read));return hash.digest('hex');}finally{fs.closeSync(fd);}
}

function probeInstallation(installRoot,version){
  if(typeof installRoot!=='string'||!path.isAbsolute(installRoot)||/^[/\\]{2}/.test(installRoot)||installRoot.includes('\0')||typeof version!=='string'||!/^\d+\.\d+\.\d+-\d{1,8}$/.test(version))throw Error('Select one local QQ installation and an explicit version.');
  const root=fs.realpathSync(installRoot);
  if(fs.lstatSync(installRoot).isSymbolicLink()||!fs.statSync(root).isDirectory())throw Error('Installation must be a local directory.');
  const inside=relative=>{
    const candidate=path.resolve(root,relative),resolved=fs.realpathSync(candidate),rel=path.relative(root,resolved);
    if(rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))throw Error('Installation path escaped its selected root.');return resolved;
  };
  const versionDir=`versions/${version}`,appDir=`${versionDir}/resources/app`;
  const manifestFile=inside(`${appDir}/package.json`);
  if(fs.statSync(manifestFile).size>32768)throw Error('Manifest exceeds metadata limit.');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(manifest.name!=='qq-chat'||manifest.version!==version||typeof manifest.main!=='string'||manifest.main.length>240)throw Error('QQ installation manifest does not match the selected version.');
  const nativeFiles=['QQ.exe',`${versionDir}/QQNT.dll`,`${appDir}/wrapper.node`,`${appDir}/major.node`,`${appDir}/ipc.node`,`${appDir}/initIpc_x64.node`].map(relativePath=>{
    if(!fs.existsSync(path.join(root,relativePath)))return {relativePath,present:false};
    const file=inside(relativePath),stat=fs.statSync(file);if(!stat.isFile()||stat.size>1073741824)throw Error('Unexpected native installation file.');
    return {relativePath,present:true,bytes:stat.size,sha256:hashFile(file),pe:inspectPe(file)};
  });
  const archiveFile=inside(`${appDir}/application.asar`),archiveStat=fs.statSync(archiveFile);
  if(archiveStat.size>134217728)throw Error('Application archive exceeds probe limit.');
  const fd=fs.openSync(archiveFile,'r'),prefix=Buffer.alloc(8);
  try{if(fs.readSync(fd,prefix,0,8,0)!==8||prefix.readUInt32LE(4)>8388608)throw Error('Archive header exceeds probe limit.');}finally{fs.closeSync(fd);}
  const entries=asar.listPackage(archiveFile).map(value=>value.replaceAll('\\','/').replace(/^\//,''));
  if(entries.length>50000||entries.some(value=>value.length>1024))throw Error('Archive inventory exceeds probe limit.');
  const declarations=entries.filter(value=>/\.d\.ts$|\.hpp?$|(^|\/)(include|sdk|docs?)(\/|$)|(^|\/)readme\.(md|txt|rst)$/i.test(value));
  return {schema:'qq_install_metadata_probe_v1',observedAt:new Date().toISOString(),mode:'installation_only',installationRoot:root,
    package:{name:manifest.name,version:manifest.version,main:manifest.main},nativeFiles,
    applicationArchive:{relativePath:`${appDir}/application.asar`,bytes:archiveStat.size,sha256:hashFile(archiveFile),entryCount:entries.length,launcherPresent:entries.includes('app_launcher/index.js'),declarationOrDocumentationPaths:declarations.slice(0,80),declarationOrDocumentationCount:declarations.length,sourceExecuted:false},
    capabilities:{ordinaryAccountAuthentication:'unverified',privateMessageEvents:'unverified',sendText:'unverified',qzone:'unverified',independentProtocol:'not_implemented'},
    boundaries:{nativeModulesLoaded:false,processStarted:false,processInjected:false,credentialsRead:false,profileOrSessionRead:false,networkUsed:false,loginAttempted:false,messagesSent:0,qqProtocolValidated:false},
    conclusion:'Installed files and PE exports do not establish a supported authentication/message API. A normal-login adapter and real event/send validation remain unresolved.'};
}

if(require.main===module){
  try{if(process.argv.length!==4)throw Error('Usage: node scripts/qq-install-probe.cjs <QQ install directory> <9.x.x-build>');process.stdout.write(JSON.stringify(probeInstallation(process.argv[2],process.argv[3]),null,2)+'\n');}
  catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
module.exports={probeInstallation,inspectPe};
