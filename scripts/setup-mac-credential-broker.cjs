'use strict';
// Explicit, once-only local installation. Ordinary App builds only read its pin.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const signing=require('./build-mac.cjs');
const {validateProfile,inspectHelper}=require('../src/core/mac-credential-vault.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const SOURCE=path.resolve(__dirname,'../src/mac/credential-helper.swift');
const DIRECTORY=path.join(os.homedir(),'Library','Application Support','Agent Arcade Credentials');
const PROFILE=path.join(DIRECTORY,'profile-v1.json');
function command(file,args,options={}){
 try{return execFileSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],...options});}
 catch{throw Error('Credential component preparation failed; no existing helper or vault was replaced.');}
}
function existingProfile(identity){
 const directory=fs.lstatSync(DIRECTORY),file=fs.lstatSync(PROFILE);
 if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid()||(directory.mode&0o7777)!==0o700||!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid()||(file.mode&0o7777)!==0o600||file.size>16384)throw Error('Unsafe credential component installation.');
 const profile=validateProfile(JSON.parse(fs.readFileSync(PROFILE,'utf8')),{trustedIdentity:identity});inspectHelper(profile);
 if(profile.sourceSha256!==sha(fs.readFileSync(SOURCE)))throw Error('The installed component source differs; use an explicit versioned migration, never an automatic replacement.');
 command('/usr/bin/codesign',['--verify','--strict','-R',`=identifier "io.github.agentarcade.credentials.v1" and certificate root=H"${identity}"`,profile.helperPath]);
 return profile;
}
function install({allowInstall=false}={}){
 if(process.platform!=='darwin')throw Error('This local credential component is macOS-only.');
 const local=signing.localSigningProfile();if(!local)throw Error('A pinned local signing profile is required.');
 if(fs.existsSync(PROFILE))return {installed:false,profile:existingProfile(local.identitySha1)};
 if(!allowInstall)throw Error('The fixed credential component is not installed. Run the explicit --install entry first.');
 if(fs.existsSync(DIRECTORY)&&fs.readdirSync(DIRECTORY).length)throw Error('An incomplete/existing credential installation was preserved; inspect it before continuing.');
 const stage=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'arcade-fixed-credential-build-'));fs.chmodSync(stage,0o700);
 const configuration=path.join(stage,'BrokerConfiguration.swift'),binary=path.join(stage,'helper-v1'),plist=path.join(stage,'Info.plist');
 const peer=`identifier "io.github.agentarcade.desktop" and certificate root = H"${local.identitySha1.toLowerCase()}"`;
 fs.writeFileSync(configuration,`enum BrokerConfiguration {\n static let peerRequirement = ${JSON.stringify(peer)}\n static let service = "agent-arcade Safe Storage"\n static let account = "agent-arcade"\n static let keychainPath = ""\n static let testing = false\n}\n`,{mode:0o600});
 fs.writeFileSync(plist,'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.github.agentarcade.credentials.v1</string><key>CFBundleName</key><string>Agent Arcade Credentials</string><key>CFBundleDisplayName</key><string>Agent Arcade Credentials</string><key>CFBundleVersion</key><string>1</string></dict></plist>',{mode:0o600});
 command('/usr/bin/swiftc',['-O','-parse-as-library','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos13.0`,'-module-cache-path',path.join(stage,'module-cache'),SOURCE,configuration,'-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',plist,'-o',binary]);
 signing.unlockLocalSigning(local);
 command('/usr/bin/codesign',['--force','--sign',local.identitySha1,'--keychain',local.keychainFile,'--identifier','io.github.agentarcade.credentials.v1','--options','runtime,hard,kill','--timestamp=none',binary]);
 command('/usr/bin/codesign',['--verify','--strict',binary]);
 // codesign display writes to stderr; capture it without relaying arbitrary errors.
 const shown=require('node:child_process').spawnSync('/usr/bin/codesign',['-d','--verbose=4',binary],{encoding:'utf8'});
 const match=/^CDHash=([a-fA-F0-9]{40})$/m.exec(String(shown.stdout)+String(shown.stderr));if(shown.status!==0||!match)throw Error('Cannot pin the credential component signature.');
 if(!fs.existsSync(DIRECTORY))fs.mkdirSync(DIRECTORY,{mode:0o700});
 const folder=fs.lstatSync(DIRECTORY);if(folder.isSymbolicLink()||folder.uid!==process.getuid()||(folder.mode&0o7777)!==0o700||fs.readdirSync(DIRECTORY).length)throw Error('Credential installation changed; existing files were preserved.');
 const helperPath=path.join(DIRECTORY,'helper-v1');fs.copyFileSync(binary,helperPath,fs.constants.COPYFILE_EXCL);fs.chmodSync(helperPath,0o500);
 const profile={schema:1,protocol:1,helperPath,helperSha256:sha(fs.readFileSync(helperPath)),helperCdHash:match[1].toLowerCase(),identitySha1:local.identitySha1,sourceSha256:sha(fs.readFileSync(SOURCE)),service:'agent-arcade Safe Storage',account:'agent-arcade'};
 const fd=fs.openSync(PROFILE,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(profile,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 existingProfile(local.identitySha1);
 return {installed:true,profile};
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length>1||args.some(x=>!['--install','--check'].includes(x)))throw Error('Use --check or explicit --install.');console.log(JSON.stringify(install({allowInstall:args.includes('--install')})));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={install,existingProfile,DIRECTORY,PROFILE};
