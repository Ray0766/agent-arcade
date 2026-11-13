'use strict';
// Bounded, read-only observation of real transitions, not a message sender.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const profiles={whale:'work/api-preview-home',ju:'work/qq-trio/claude/home',dragon:'work/qq-trio/codex/home'};
const profile=process.argv[2],duration=Number(process.argv[3]||60000);
if(!Object.hasOwn(profiles,profile)||!Number.isFinite(duration)||duration<1000||duration>180000)throw Error('Choose whale/ju/dragon and 1000–180000 milliseconds.');
const root=path.resolve(__dirname,'..'),startedAt=Date.now(),observations=[];
const db=new DatabaseSync(path.join(root,profiles[profile],'bot-recovery.sqlite'),{readOnly:true});
const query=db.prepare('SELECT id,state,created_at,updated_at,task_id FROM inbound WHERE created_at>=? ORDER BY created_at LIMIT 60');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
let last='';
const capture=()=>{const rows=query.all(startedAt-1000).map(row=>({idHash:hash(row.id),taskHash:row.task_id?hash(row.task_id):null,state:row.state,receivedAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}));const key=JSON.stringify(rows);if(key!==last){last=key;observations.push({at:new Date().toISOString(),rows});}};
capture();
const timer=setInterval(capture,100);
console.log('Read-only transition observation started. No messages or model calls.');
setTimeout(()=>{clearInterval(timer);capture();db.close();const file=path.join(root,'outputs',`companion-${profile}-interruption-${startedAt}.json`);fs.writeFileSync(file,JSON.stringify({profile,startedAt:new Date(startedAt).toISOString(),endedAt:new Date().toISOString(),readOnly:true,observations},null,2));console.log(file);console.log(JSON.stringify(observations));},duration);
