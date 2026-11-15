'use strict';
// This repository's verification workflows must remain read-only and never
// turn a merge, version bump or dispatch into publication.
const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
function violations(document){
 const problems=[];
 if(document?.permissions?.contents!=='read')problems.push('Workflow contents permission must be explicitly read.');
 for(const [name,job]of Object.entries(document?.jobs||{})){
  if(job.permissions==='write-all'||job.permissions?.contents==='write')problems.push(name+': release-write permission is forbidden in verification.');
  for(const step of job.steps||[]){
   if(/\bgh\s+release\s+(?:create|upload|edit|delete)\b/i.test(step.run||''))problems.push(name+': release command does not belong in verification.');
   if(/(?:softprops\/action-gh-release|ncipollo\/release-action|actions\/create-release|actions\/upload-release-asset)/i.test(step.uses||''))problems.push(name+': publishing action does not belong in verification.');
  }
 }
 return problems;
}
function check(root=path.resolve(__dirname,'..')){
 const directory=path.join(root,'.github/workflows'),files=fs.readdirSync(directory).filter(f=>/\.ya?ml$/.test(f)),problems=[];
 for(const file of files)for(const message of violations(yaml.load(fs.readFileSync(path.join(directory,file),'utf8'))))problems.push(file+': '+message);
 return {files:files.length,problems};
}
if(require.main===module){try{const result=check();if(result.problems.length){console.error(result.problems.join('\n'));process.exitCode=1;}else console.log(`Release safety: ${result.files} verification workflow(s), read-only, no publication steps.`);}catch{console.error('Release safety configuration could not be validated.');process.exitCode=1;}}
module.exports={violations,check};
