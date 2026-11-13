'use strict';
// Synthetic metadata with real isolated NTFS objects. The fixed native pins
// remain in metadata; these small code bytes are deliberately not official code.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const M=require('../../src/bot/qq-managed-node-repair-metadata.cjs'),F=require('../../src/bot/qq-node-repair-fs.cjs');
function metadataFixture(t,{installations=2,missingCode=false}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-node-code-repair-')),root=path.join(temp,'components');fs.mkdirSync(root);const p=M.paths(root);fs.mkdirSync(p.versionRoot,{recursive:true});if(!missingCode){fs.mkdirSync(p.codeRoot);fs.writeFileSync(path.join(p.codeRoot,'index.js'),'SYNTHETIC_DAMAGED_CODE');}
 const files=Object.entries(require('../../src/bot/qq-managed-node-setup.cjs').NODE_FILES).map(([file,pin])=>({path:file,...pin}));files.push({path:'napcat/static/synthetic.txt',size:1,sha256:F.sha('x')});files.sort((a,b)=>a.path<b.path?-1:1);
 const manifest={schema:'qq_node_component_prepared_v1',component:'napcat-node',versionId:M.RELEASE_ID,version:M.VERSION,source:M.SOURCE,preparedAt:'2026-11-07T00:00:00.000Z',requiredFiles:[...M.REQUIRED],directories:['napcat','napcat/static'],files};const raw=Buffer.from(JSON.stringify(manifest)+'\n');fs.writeFileSync(p.manifestPath,raw);
 const records=[];for(let i=0;i<installations;i++){const setupId=randomUUID(),ip=M.paths(root,setupId);fs.mkdirSync(ip.instancesRoot,{recursive:true});const value={schema:'qq_managed_node_v1',setupId,installationId:F.sha(ip.installationRoot.toLowerCase()),engine:'managed-node',dataPolicy:'isolated-new',createdAt:'2026-11-07T00:00:00.000Z',publication:{method:'exclusive-link-v1',temporaryFile:`installation.${randomUUID()}.part`},...M.metadataValues(),current:{kind:'prepared',version:M.VERSION,versionId:M.RELEASE_ID,manifestSha256:F.sha(raw)},previous:null};fs.writeFileSync(ip.descriptor,JSON.stringify(value)+'\n');records.push({setupId,paths:ip,value,descriptorSha256:F.sha(fs.readFileSync(ip.descriptor))});}
 const state={epoch:0,rows:[],onSnapshot:null,clock:Date.parse('2026-11-07T00:00:00Z'),mono:1000,checks:0},captureSelection=()=>({setupId:records[0].setupId,descriptorSha256:records[0].descriptorSha256,selectionDigest:F.sha('SYNTHETIC_SELECTION'),epoch:state.epoch,contextKey:F.sha('SYNTHETIC_CONTEXT_'+state.epoch),knownRegisteredProfiles:[{profileId:'synthetic-profile',label:'Synthetic companion'}]});
 const processHost={snapshot:async()=>{state.checks++;await state.onSnapshot?.();return structuredClone(state.rows);}},io=Object.create(fs);
 const cleanup=()=>{const actual=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());if(!actual.toLowerCase().startsWith(parent.toLowerCase()+path.sep))throw Error('Invalid temporary root');fs.rmSync(actual,{recursive:true,force:true});};t?.after(cleanup);
 return {temp,root,p,manifest,manifestRaw:raw,records,state,io,captureSelection,processHost,cleanup,options:{root,captureSelection,processHost,io,now:()=>state.clock,monotonic:()=>state.mono}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
// Real transaction/gate/history with small original fixture bytes. ONLY the
// archive preparation and supplied expected code manifest are synthetic seams;
// the original fixed prepared metadata is still validated before projection.
function fixture(t,options={}){
 const f=metadataFixture(null,options),bodies={'index.js':Buffer.from('SYNTHETIC_REPAIRED_CODE'),'napcat/static/data.bin':Buffer.from([0,255,1,2])};
 const expected={...f.manifest,directories:['napcat','napcat/static'],files:Object.entries(bodies).map(([name,bytes])=>({path:name,size:bytes.length,sha256:F.sha(bytes)})).sort((a,b)=>a.path<b.path?-1:1)};
 f.state.stageCalls=0;f.state.stageError=null;f.state.stageHeld=null;f.state.closeError=false;f.state.partial=false;
 f.options.metadataReader=input=>({...M.readManagedNodeRepairMetadata(input),manifest:structuredClone(expected)});
 f.options.packages={verify:async()=>({state:'verified-staged'}),stage:async()=>{throw Error('Synthetic fixture must not download');}};
 f.options.stageFactory=()=>{let owned=null,root=null;return {
  async prepare({operationDir,signal,assertCurrent}){f.state.stageCalls++;root=path.join(operationDir,'staged-code');F.current({signal,assertCurrent});fs.mkdirSync(path.join(root,'napcat','static'),{recursive:true});for(const [name,bytes]of Object.entries(bodies)){fs.writeFileSync(path.join(root,...name.split('/')),bytes);if(f.state.partial)break;}owned=F.tree(root);await f.state.stageHeld?.promise;F.current({signal,assertCurrent});if(f.state.stageError)throw Object.assign(Error('Synthetic preparation failure'),{code:f.state.stageError});return {path:root,proof:owned,source:{verification:'full-pinned-archive-and-manifest',archiveBytes:M.SOURCE.size,fileCount:owned.files,totalBytes:owned.bytes}};},
  captureOwnedTree(){if(!owned)throw Error('No captured created tree');F.assertTree(root,owned);return F.tree(root);},
  async close(){if(f.state.closeError)throw Object.assign(Error('Synthetic close failure'),{code:'node_repair_cleanup_unconfirmed'});return {closed:true};}
 };};
 const helpers=[];f.make=override=>{const h=new(require('../../src/bot/qq-managed-node-code-repair.cjs').QQManagedNodeCodeRepair)({...f.options,...override});helpers.push(h);return h;};f.helper=f.make();f.expected=expected;f.bodies=bodies;
 t?.after(async()=>{for(const h of helpers)await h.close();f.cleanup();});return f;
}
module.exports={metadataFixture,fixture,deferred};
