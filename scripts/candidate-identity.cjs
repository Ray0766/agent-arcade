'use strict';
// Static identities only: never launches an App, reads a profile or rebuilds.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const CODE=/\.(?:cjs|mjs|js|css|html|json)$/i;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function bytes(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Identity input must be an ordinary file.');const value=fs.readFileSync(file);if(value.length!==st.size)throw Error('Identity input is incomplete; materialize cloud files first.');return value;}
function treeHash(files){return sha(Buffer.from(JSON.stringify(files)));}
function gitIdentity(root){
 const run=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},stdio:['ignore','pipe','ignore']});
 try{if(fs.realpathSync(run(['rev-parse','--show-toplevel']).trim())!==fs.realpathSync(root))return null;return {head:run(['rev-parse','HEAD']).trim(),branch:run(['branch','--show-current']).trim(),dirtyPaths:run(['status','--porcelain=v1','-z']).split('\0').filter(Boolean).map(row=>({status:row.slice(0,2),path:row.slice(3)})).filter(row=>row.path!=='node_modules')};}catch{return null;}
}
function captureSource(root){
 root=fs.realpathSync(root);const files=[],legacyFiles=[];
 const walk=relative=>{for(const name of fs.readdirSync(path.join(root,relative)).sort()){const rel=path.join(relative,name),file=path.join(root,rel),st=fs.lstatSync(file);if(st.isSymbolicLink())throw Error('Source code links are not identity inputs.');if(st.isDirectory())walk(rel);else if(CODE.test(name)){const data=bytes(file);const canonical=rel.split(path.sep).join('/');files.push({path:canonical,bytes:data.length,sha256:sha(data)});legacyFiles.push([canonical,data]);}}};
 walk('src');files.sort((a,b)=>a.path.localeCompare(b.path,'en'));const pkgBytes=bytes(path.join(root,'package.json')),pkg=JSON.parse(pkgBytes);
 const lockBytes=bytes(path.join(root,'package-lock.json')),legacy=crypto.createHash('sha256');for(const [name,data]of [['package.json',pkgBytes],['package-lock.json',lockBytes],...legacyFiles]){legacy.update(name+'\0'+data.length+'\0');legacy.update(data);}
 return {git:gitIdentity(root),legacyBuildFingerprint:legacy.digest('hex'),package:{name:pkg.name,version:pkg.version,main:pkg.main,sha256:sha(pkgBytes)},lockSha256:sha(lockBytes),codeTreeSha256:treeHash(files),codeFiles:files};
}
function captureArchive(file){
 const asar=require('@electron/asar'),files=[];
 for(const entry of asar.listPackage(file)){
  const name=entry.split(path.sep).join('/').replace(/^\//,'');
  if(!name.startsWith('src/')||!CODE.test(name)||asar.statFile(file,name).files)continue;
  const data=asar.extractFile(file,name);
  files.push({path:name,bytes:data.length,sha256:sha(data)});
 }
 files.sort((a,b)=>a.path.localeCompare(b.path,'en'));const pkg=JSON.parse(asar.extractFile(file,'package.json'));
 return {sha256:sha(bytes(file)),bytes:fs.statSync(file).size,package:{name:pkg.name,version:pkg.version,main:pkg.main},codeTreeSha256:treeHash(files),codeFiles:files};
}
function snapshotReference(file,root){
 const data=bytes(file),record=JSON.parse(data);
 if(!/^[a-f0-9]{40}$/.test(record.head)||!Array.isArray(record.files)||record.files.length!==record.dirtyCount)throw Error('Invalid frozen source inventory.');
 for(const item of record.files){if(typeof item.path!=='string'||path.isAbsolute(item.path)||item.path.split(/[\\/]/).includes('..')||sha(bytes(path.join(root,item.path)))!==item.sha256)throw Error('Frozen inventory no longer matches source.');}
 return {head:record.head,branch:record.branch,dirtyCount:record.dirtyCount,capturedAt:record.capturedAt,inventorySha256:sha(data),committed:false};
}
function makeManifest({source,archive,snapshot,evidence=[]}){
 const s=captureSource(source),a=archive?captureArchive(archive):null,reference=snapshot?snapshotReference(snapshot,source):null;
 return {schema:1,kind:'static-candidate-identity',source:{...s,...(reference?{frozenReference:reference}:{})},candidate:a?{...a,matchesSource:a.codeTreeSha256===s.codeTreeSha256&&['name','version','main'].every(k=>a.package[k]===s.package[k]),rebuiltByThisCheck:false}:null,priorEvidence:evidence.map(file=>{const data=bytes(file);let declared=null;try{const value=JSON.parse(data);if(/^[a-f0-9]{64}$/.test(value.sourceIdentity||''))declared=value.sourceIdentity;}catch{}return {file:path.basename(file),sha256:sha(data),classification:'imported-maintenance-record-not-rerun',declaredSourceMatches:declared===null?null:declared===s.legacyBuildFingerprint};}),acceptance:{realModels:false,humanAcceptance:false,publicRelease:false}};
}
function cli(argv){
 const opts={evidence:[]};for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];if(!['--source','--asar','--snapshot','--evidence','--output'].includes(key)||!value)throw Error('Use --source DIR [--asar FILE] [--snapshot FILE] [--evidence FILE] --output FILE.');if(key==='--evidence')opts.evidence.push(value);else opts[key.slice(2)]=value;}
 if(!opts.source||!opts.output)throw Error('A source directory and explicit output file are required.');
 const result=makeManifest({source:opts.source,archive:opts.asar,snapshot:opts.snapshot,evidence:opts.evidence});
 fs.mkdirSync(path.dirname(path.resolve(opts.output)),{recursive:true});fs.writeFileSync(opts.output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({sourceTree:result.source.codeTreeSha256,sourceFiles:result.source.codeFiles.length,candidateMatches:result.candidate?.matchesSource??null,priorRecords:result.priorEvidence.length}));
 if(result.candidate&&!result.candidate.matchesSource)process.exitCode=1;
}
if(require.main===module)try{cli(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={captureSource,captureArchive,makeManifest,treeHash};
