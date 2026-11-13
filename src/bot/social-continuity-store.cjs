'use strict';
const {randomUUID}=require('node:crypto');

const invalid=message=>Object.assign(Error(message),{code:'social_invalid_input'});
const bounded=(value,max,label,empty=false)=>{
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b-\x1f\x7f]/.test(value))throw invalid(`Invalid ${label}.`);
  return value;
};
const timestamp=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw invalid(`Invalid ${label}.`);return value;};
const identifiers=(value,label)=>{
  if(!Array.isArray(value)||value.length>8||new Set(value).size!==value.length)throw invalid(`Invalid ${label}.`);
  return value.map(id=>bounded(id,180,label));
};
const timeZone=value=>{
  bounded(value,80,'time zone');
  try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}catch{throw invalid('Choose a valid IANA time zone.');}
};
const limit=(value,max)=>{if(!Number.isInteger(value)||value<1||value>max)throw invalid('Invalid record limit.');return value;};
const factRow=row=>row?{id:row.id,key:row.fact_key,text:row.text,sourceIds:JSON.parse(row.source_ids),sourceAt:row.source_at,createdAt:row.created_at,updatedAt:row.updated_at,revision:row.revision}:null;
const followupRow=row=>row?{id:row.id,text:row.text,dueAt:row.due_at,expiresAt:row.expires_at,timeZone:row.time_zone,state:row.state,sourceIds:JSON.parse(row.source_ids),factIds:JSON.parse(row.fact_ids),createdAt:row.created_at,updatedAt:row.updated_at,receipt:row.receipt,revision:row.revision}:null;
const publicRow=row=>row?{id:row.id,text:row.text,at:row.at,updatedAt:row.updated_at,state:row.state,postId:row.post_id,receipt:row.post_id}:null;
const noticeRow=row=>row?{id:row.id,source:row.source,kind:row.kind,importance:row.importance,payload:row.payload,at:row.at,expiresAt:row.expires_at,state:row.state,batch:row.batch,createdAt:row.created_at,updatedAt:row.updated_at}:null;
const NOTICE_PENDING=30,NOTICE_ROWS=300,NOTICE_RETENTION=7*86400000;

function initializeContinuity(db,now,{branches=false}={}){
  // All additions share SocialStore's transaction. No shadow copy of private
  // memory is retained that could outlive a later correction or erasure.
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version>6)throw invalid('This character memory was created by a newer app.');
  // Version 5 adds the conversation-branch tables, created by SocialStore only for a store
  // opened with branches:true (the App conversation). Any other store keeps the number it
  // found, so the QQ companion database stays at 4 and readable by an earlier build.
  // Version 6 adds the speaker columns of group conversations to messages, again only for the
  // App conversation's store (see SocialStore's constructor).
  const target=branches?6:Math.max(4,version);
  db.exec(`CREATE TABLE IF NOT EXISTS facts (
    scope TEXT NOT NULL,id TEXT NOT NULL,fact_key TEXT NOT NULL,text TEXT NOT NULL,
    source_ids TEXT NOT NULL,source_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL,
    PRIMARY KEY(scope,id),UNIQUE(scope,fact_key));
    CREATE TABLE IF NOT EXISTS followups (
    scope TEXT NOT NULL,id TEXT NOT NULL,text TEXT NOT NULL,due_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,time_zone TEXT NOT NULL,
    state TEXT NOT NULL,source_ids TEXT NOT NULL,fact_ids TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,receipt TEXT NOT NULL,revision INTEGER NOT NULL,
    PRIMARY KEY(scope,id));
    CREATE INDEX IF NOT EXISTS followup_due ON followups(scope,state,due_at);
    CREATE TABLE IF NOT EXISTS public_journal (
    scope TEXT NOT NULL,id TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,updated_at INTEGER NOT NULL,state TEXT NOT NULL,post_id TEXT NOT NULL,
    PRIMARY KEY(scope,id));
    CREATE INDEX IF NOT EXISTS public_journal_order ON public_journal(scope,at);
    CREATE TABLE IF NOT EXISTS source_notices (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,kind TEXT NOT NULL,importance TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    state TEXT NOT NULL,batch TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS source_notice_state ON source_notices(state,created_at);
    PRAGMA user_version=${target};`);
  db.prepare("UPDATE followups SET state='unknown',updated_at=? WHERE state='attempting'").run(now);
  db.prepare("UPDATE public_journal SET state='unknown',updated_at=? WHERE state='attempting'").run(now);
  // An offline deadline is shown for review, not replayed on the next launch.
  db.prepare("UPDATE followups SET state='missed',updated_at=? WHERE state='pending' AND due_at<?").run(now,now);
  // Version 3: owner-enabled source notices. They are not relationship memory,
  // so they carry no scope. An interrupted attempt is ambiguous and is never
  // replayed; a pending notice survives a restart until its own expiry.
  db.prepare("UPDATE source_notices SET state='unknown',payload='',updated_at=? WHERE state='attempting'").run(now);
}

function sources(db,scope,ids,now){
  identifiers(ids,'source identifiers');
  const rows=ids.map(id=>db.prepare("SELECT id,at FROM messages WHERE scope=? AND id=? AND role='user'").get(scope,id));
  if(rows.some(row=>!row))throw invalid('Memory sources must be retained owner messages in this relationship.');
  return {sourceIds:ids,sourceAt:rows.length?Math.min(...rows.map(row=>row.at)):now};
}
function discardDerived(store,db,scope,fact,preservedIds=[]){
  // A reply may paraphrase a fact without repeating its exact value. Drop the
  // complete recent conversation, including earlier mentions, rather than
  // pretending text matching can find every derivative. Independent structured
  // facts remain available; records containing this exact old fact do not.
  const suffix=db.prepare('SELECT id FROM messages WHERE scope=?').all(scope);
  for(const row of suffix)if(!preservedIds.includes(row.id))db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(scope,row.id);
  db.prepare('DELETE FROM scoped_notes WHERE scope=?').run(scope);
  // Version 4 (table created by SocialStore): lorebook timing state is derived
  // from the conversation that was just removed.
  db.prepare('DELETE FROM scope_state WHERE scope=?').run(scope);
  // Version 5: every branch of this conversation is a copy that may hold the same derived
  // text, so their conversations and lorebook state go in the same transaction.
  if(store.branchesEnabled)for(const branch of db.prepare('SELECT scope FROM branches WHERE root=?').all(scope)){
    for(const row of db.prepare('SELECT id FROM messages WHERE scope=?').all(branch.scope))if(!preservedIds.includes(row.id))db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(branch.scope,row.id);
    db.prepare('DELETE FROM scope_state WHERE scope=?').run(branch.scope);
  }
  db.prepare("UPDATE actions SET text='' WHERE scope=? AND kind IN ('reply','message','decision')").run(scope);
  const previousText=fact.text.trim().replace(/\s+/g,' ');
  const duplicates=db.prepare('SELECT id,text FROM facts WHERE scope=? AND id<>?').all(scope,fact.id).filter(row=>row.text.trim().replace(/\s+/g,' ').includes(previousText));
  const removedFacts=new Set([fact.id,...duplicates.map(row=>row.id)]);
  for(const row of duplicates)db.prepare('DELETE FROM facts WHERE scope=? AND id=?').run(scope,row.id);
  const deletedIds=new Set(suffix.filter(row=>!preservedIds.includes(row.id)).map(row=>row.id));
  const followups=db.prepare('SELECT * FROM followups WHERE scope=?').all(scope);
  for(const row of followups){
    const dependent=JSON.parse(row.fact_ids).some(id=>removedFacts.has(id))||JSON.parse(row.source_ids).some(id=>deletedIds.has(id))||row.text.includes(fact.text)||row.created_at>=fact.sourceAt;
    if(!dependent)continue;
    const state=row.state==='attempting'?'unknown':row.state==='pending'?'cancelled':row.state;
    db.prepare("UPDATE followups SET state=?,text='',source_ids='[]',fact_ids='[]',updated_at=?,revision=revision+1 WHERE scope=? AND id=?").run(state,store.now(),scope,row.id);
  }
  return {clearedConversation:true,clearedNotes:true};
}

const continuityMethods={
  facts(scope,count=100){
    const key=this.scope(scope);limit(count,100);
    return this.withDb(db=>db.prepare('SELECT * FROM facts WHERE scope=? ORDER BY updated_at DESC,rowid DESC LIMIT ?').all(key,count).map(factRow));
  },
  remember(scope,{id=randomUUID(),key:factKey=id,text,sourceIds=[]}={}){
    const key=this.scope(scope);bounded(id,180,'fact identifier');bounded(factKey,120,'fact key');bounded(text,600,'fact');identifiers(sourceIds,'source identifiers');
    return this.withDb(db=>{
      this.ensureScope(db,key);const origin=sources(db,key,sourceIds,this.now());
      const existing=db.prepare('SELECT * FROM facts WHERE scope=? AND (id=? OR fact_key=?)').get(key,id,factKey);
      if(existing){if(existing.text===text&&existing.id===id)return factRow(existing);throw invalid('This fact already exists; correct it explicitly.');}
      const duplicate=db.prepare('SELECT * FROM facts WHERE scope=? AND text=?').get(key,text);
      if(duplicate)return factRow(duplicate);
      if(db.prepare('SELECT count(*) AS count FROM facts WHERE scope=?').get(key).count>=100)throw invalid('The relationship has 100 facts. Forget one before adding another.');
      const now=this.now();db.prepare('INSERT INTO facts(scope,id,fact_key,text,source_ids,source_at,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,1)').run(key,id,factKey,text,JSON.stringify(sourceIds),origin.sourceAt,now,now);
      return factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
    });
  },
  upsertFact(scope,value={}){
    if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('Invalid fact.');
    const existing=value.id?this.facts(scope).find(fact=>fact.id===value.id):value.key?this.facts(scope).find(fact=>fact.key===value.key):null;
    if(existing){if(existing.text===value.text)return existing;return this.correctFact(scope,existing.id,value);}
    return this.remember(scope,value);
  },
  // keepIds: messages to retain besides the sources (a correction typed in a branch, whose
  // message is not in this scope and so cannot be one of the fact's sources).
  correctFact(scope,id,{text,sourceIds=[],revision,keepIds=[]}={}){
    const key=this.scope(scope);bounded(id,180,'fact identifier');bounded(text,600,'fact');identifiers(sourceIds,'source identifiers');identifiers(keepIds,'message identifiers');
    return this.withDb(db=>{
      const previous=factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
      if(!previous)throw invalid('The fact was not found.');
      if(revision!==undefined&&revision!==previous.revision)throw invalid('The fact changed; review the current value.');
      const origin=sources(db,key,sourceIds,this.now());
      discardDerived(this,db,key,previous,[...sourceIds,...keepIds]);
      db.prepare('UPDATE facts SET text=?,source_ids=?,source_at=?,updated_at=?,revision=revision+1 WHERE scope=? AND id=?').run(text,JSON.stringify(sourceIds),origin.sourceAt,this.now(),key,id);
      return factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
    });
  },
  forgetFact(scope,id,{revision}={}){
    const key=this.scope(scope);bounded(id,180,'fact identifier');
    return this.withDb(db=>{
      const previous=factRow(db.prepare('SELECT * FROM facts WHERE scope=? AND id=?').get(key,id));
      if(!previous)throw invalid('The fact was not found.');
      // A confirmation shown for an older value must not erase its correction.
      if(revision!==undefined&&revision!==previous.revision)throw invalid('The fact changed; review the current value.');
      const impact=discardDerived(this,db,key,previous);
      db.prepare('DELETE FROM facts WHERE scope=? AND id=?').run(key,id);
      return {forgotten:true,...impact};
    });
  },
  scheduleFollowup(scope,{id=randomUUID(),text,dueAt,timeZone:zone,expiresAt=dueAt+86400000,sourceIds=[],factIds=[]}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');bounded(text,600,'follow-up');timestamp(dueAt,'due time');timestamp(expiresAt,'expiry');zone=timeZone(zone);identifiers(sourceIds,'source identifiers');identifiers(factIds,'fact identifiers');
    if(dueAt<this.now()||dueAt>this.now()+366*86400000||expiresAt<=dueAt||expiresAt>dueAt+7*86400000)throw invalid('Choose a future follow-up within one year and an expiry within seven days.');
    return this.withDb(db=>{
      this.ensureScope(db,key);sources(db,key,sourceIds,this.now());
      if(factIds.some(factId=>!db.prepare('SELECT 1 FROM facts WHERE scope=? AND id=?').get(key,factId)))throw invalid('Follow-up facts must belong to this relationship.');
      if(db.prepare('SELECT 1 FROM followups WHERE scope=? AND id=?').get(key,id))throw invalid('This follow-up identifier was already recorded.');
      if(db.prepare("SELECT count(*) AS count FROM followups WHERE scope=? AND state IN ('pending','attempting')").get(key).count>=30)throw invalid('There are already 30 pending follow-ups.');
      const count=db.prepare('SELECT count(*) AS count FROM followups WHERE scope=?').get(key).count;
      if(count>=100){
        // Keep uncertain send identifiers for seven days to avoid accidental
        // recreation by a stale caller; remove only older terminal receipts.
        const old=db.prepare("SELECT id FROM followups WHERE scope=? AND state NOT IN ('pending','attempting') AND updated_at<? ORDER BY updated_at LIMIT 1").get(key,this.now()-7*86400000);
        if(!old)throw invalid('Follow-up history is full. Wait for old receipts to retire.');
        db.prepare('DELETE FROM followups WHERE scope=? AND id=?').run(key,old.id);
      }
      const now=this.now();db.prepare("INSERT INTO followups(scope,id,text,due_at,expires_at,time_zone,state,source_ids,fact_ids,created_at,updated_at,receipt,revision) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,1)").run(key,id,text,dueAt,expiresAt,zone,JSON.stringify(sourceIds),JSON.stringify(factIds),now,now,'');
      return followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
    });
  },
  followups(scope,{state,status,dueBefore,count=100,limit:requestedLimit}={}){
    const key=this.scope(scope);count=requestedLimit??count;limit(count,100);state=state??status;
    if(state!==undefined&&!['pending','attempting','sent','cancelled','unknown','failed','missed'].includes(state))throw invalid('Invalid follow-up state.');
    if(dueBefore!==undefined)timestamp(dueBefore,'due filter');
    return this.withDb(db=>{
      db.prepare("UPDATE followups SET state='missed',updated_at=? WHERE scope=? AND state='pending' AND expires_at<=?").run(this.now(),key,this.now());
      return db.prepare('SELECT * FROM followups WHERE scope=? ORDER BY due_at,rowid').all(key).filter(row=>(state===undefined||row.state===state)&&(dueBefore===undefined||row.due_at<=dueBefore)).slice(0,count).map(followupRow);
    });
  },
  updateFollowup(scope,id,patch={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['text','dueAt','expiresAt','timeZone','revision'].includes(k)))throw invalid('Invalid follow-up change.');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous||previous.state!=='pending')throw invalid('Only a pending follow-up can change.');
      if(patch.revision!==undefined&&patch.revision!==previous.revision)throw invalid('The follow-up changed; review its current time.');
      const next={...previous,...patch};bounded(next.text,600,'follow-up');timestamp(next.dueAt,'due time');next.timeZone=timeZone(next.timeZone);
      if(patch.dueAt!==undefined&&patch.expiresAt===undefined)next.expiresAt=next.dueAt+86400000;
      timestamp(next.expiresAt,'expiry');
      if(next.dueAt<this.now()||next.dueAt>this.now()+366*86400000||next.expiresAt<=next.dueAt||next.expiresAt>next.dueAt+7*86400000)throw invalid('Invalid follow-up time or expiry.');
      db.prepare('UPDATE followups SET text=?,due_at=?,expires_at=?,time_zone=?,updated_at=?,revision=revision+1 WHERE scope=? AND id=?').run(next.text,next.dueAt,next.expiresAt,next.timeZone,this.now(),key,id);
      return followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
    });
  },
  claimFollowup(scope,id,{revision}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous||previous.state!=='pending'||previous.dueAt>this.now()||previous.expiresAt<=this.now()||(revision!==undefined&&revision!==previous.revision))return null;
      db.prepare("UPDATE followups SET state='attempting',updated_at=? WHERE scope=? AND id=? AND state='pending'").run(this.now(),key,id);
      return {...previous,state:'attempting',updatedAt:this.now()};
    });
  },
  finishFollowup(scope,id,{state,receipt=''}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');bounded(receipt,300,'receipt',true);
    if(!['sent','unknown','cancelled','failed'].includes(state))throw invalid('Invalid final follow-up state.');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous||previous.state!=='attempting')throw invalid('Only an attempted follow-up can finish; finished and unknown sends cannot retry.');
      db.prepare('UPDATE followups SET state=?,receipt=?,updated_at=? WHERE scope=? AND id=?').run(state,receipt,this.now(),key,id);
      return {...previous,state,receipt,updatedAt:this.now()};
    });
  },
  cancelFollowup(scope,id,{reason}={}){
    const key=this.scope(scope);bounded(id,180,'follow-up identifier');
    return this.withDb(db=>{
      const previous=followupRow(db.prepare('SELECT * FROM followups WHERE scope=? AND id=?').get(key,id));
      if(!previous)throw invalid('The follow-up was not found.');
      if(!['pending','attempting'].includes(previous.state))return previous;
      const state=previous.state==='attempting'?'unknown':reason==='missed'?'missed':'cancelled';
      db.prepare('UPDATE followups SET state=?,updated_at=?,revision=revision+1 WHERE scope=? AND id=?').run(state,this.now(),key,id);
      return {...previous,state,updatedAt:this.now(),revision:previous.revision+1};
    });
  },
  publicEntries(scope,count=30){
    const key=this.scope(scope);limit(count,100);
    return this.withDb(db=>db.prepare('SELECT * FROM public_journal WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT ?').all(key,count).map(publicRow));
  },
  journal(scope,count=30){
    const key=this.scope(scope);limit(count,100);
    // Drafts and uncertain attempts must neither enter public context nor hide
    // the published history that still exists inside the bounded store.
    return this.withDb(db=>db.prepare("SELECT * FROM public_journal WHERE scope=? AND state='published' ORDER BY at DESC,rowid DESC LIMIT ?").all(key,count).map(publicRow));
  },
  addPublicEntry(scope,{id=randomUUID(),text,at=this.now(),postId='',receipt=postId,state='draft'}={}){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');bounded(text,1000,'public entry');timestamp(at,'public entry time');bounded(receipt,300,'post receipt',true);
    if(!['draft','published'].includes(state)||(state==='published'&&!receipt))throw invalid('Published public entries require a real post receipt.');
    return this.withDb(db=>{
      this.ensureScope(db,key);
      const existing=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(existing){if(existing.text===text&&existing.post_id===receipt&&existing.state===state)return publicRow(existing);throw invalid('This public entry identifier was already used.');}
      const now=this.now();db.prepare('INSERT INTO public_journal(scope,id,text,at,updated_at,state,post_id) VALUES(?,?,?,?,?,?,?)').run(key,id,text,at,now,state,receipt);
      db.prepare("DELETE FROM public_journal WHERE scope=? AND id<>? AND state<>'attempting' AND rowid NOT IN (SELECT rowid FROM public_journal WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 100)").run(key,id,key);
      return {id,text,at,updatedAt:now,state,postId:receipt,receipt};
    });
  },
  appendJournal(scope,value={}){return this.addPublicEntry(scope,{...value,state:'published'});},
  claimPublicEntry(scope,id){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous||previous.state!=='draft')return null;
      db.prepare("UPDATE public_journal SET state='attempting',updated_at=? WHERE scope=? AND id=?").run(this.now(),key,id);
      return {...publicRow(previous),state:'attempting',updatedAt:this.now()};
    });
  },
  finishPublicEntry(scope,id,{state,postId='',receipt=postId}={}){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');bounded(receipt,300,'post receipt',true);
    if(!['published','unknown','failed','cancelled'].includes(state)||(state==='published'&&!receipt))throw invalid('Invalid public publication result.');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous||previous.state!=='attempting')throw invalid('Only an attempted public entry can finish. Unknown and finished publications cannot retry.');
      db.prepare('UPDATE public_journal SET state=?,post_id=?,updated_at=? WHERE scope=? AND id=?').run(state,receipt,this.now(),key,id);
      return {...publicRow(previous),state,postId:receipt,receipt,updatedAt:this.now()};
    });
  },
  publishPublicEntry(scope,id,{postId}={}){return this.finishPublicEntry(scope,id,{state:'published',postId});},
  // Source notices: bounded, deduplicated by event id, one attempt per batch.
  // Finished rows keep only identity/state for the duplicate barrier and limits.
  addNotice({id,source,kind,importance,payload,at,expiresAt}={}){
    bounded(id,128,'notice identifier');bounded(source,64,'notice source');bounded(kind,40,'notice kind');bounded(payload,4000,'notice payload');timestamp(at,'notice time');timestamp(expiresAt,'notice expiry');
    if(!['low','normal','high'].includes(importance))throw invalid('Invalid notice importance.');
    return this.withDb(db=>{
      const now=this.now();
      if(db.prepare('SELECT 1 FROM source_notices WHERE id=?').get(id))return {accepted:false,reason:'duplicate'};
      if(expiresAt<=now)return {accepted:false,reason:'expired'};
      db.prepare("UPDATE source_notices SET state='missed',payload='',updated_at=? WHERE state='pending' AND expires_at<=?").run(now,now);
      db.prepare("DELETE FROM source_notices WHERE state NOT IN ('pending','attempting') AND updated_at<?").run(now-NOTICE_RETENTION);
      if(db.prepare("SELECT count(*) AS count FROM source_notices WHERE state IN ('pending','attempting')").get().count>=NOTICE_PENDING){
        const old=db.prepare("SELECT id FROM source_notices WHERE state='pending' AND importance='low' ORDER BY created_at,rowid LIMIT 1").get();
        if(!old)return {accepted:false,reason:'full'};
        db.prepare("UPDATE source_notices SET state='dropped',payload='',updated_at=? WHERE id=?").run(now,old.id);
      }
      const extra=db.prepare('SELECT count(*) AS count FROM source_notices').get().count-NOTICE_ROWS+1;
      if(extra>0)db.prepare("DELETE FROM source_notices WHERE rowid IN (SELECT rowid FROM source_notices WHERE state NOT IN ('pending','attempting') ORDER BY updated_at,rowid LIMIT ?)").run(extra);
      db.prepare("INSERT INTO source_notices(id,source,kind,importance,payload,at,expires_at,state,batch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending','',?,?)").run(id,source,kind,importance,payload,at,expiresAt,now,now);
      return {accepted:true};
    });
  },
  pendingNotices(){
    return this.withDb(db=>{
      const now=this.now();
      // An expired notice is recorded as missed. It is never delivered late.
      db.prepare("UPDATE source_notices SET state='missed',payload='',updated_at=? WHERE state='pending' AND expires_at<=?").run(now,now);
      return db.prepare("SELECT * FROM source_notices WHERE state='pending' ORDER BY created_at,rowid").all().map(noticeRow);
    });
  },
  noticeAttempts(){
    return this.withDb(db=>db.prepare("SELECT batch,max(updated_at) AS at,max(state='sent') AS sent FROM source_notices WHERE batch<>'' AND state IN ('attempting','sent','failed','unknown') GROUP BY batch ORDER BY at").all().map(row=>({batch:row.batch,at:row.at,sent:!!row.sent})));
  },
  claimNotices(ids,batch){
    if(!Array.isArray(ids)||!ids.length||ids.length>NOTICE_PENDING||new Set(ids).size!==ids.length)throw invalid('Invalid notice batch.');
    ids.forEach(id=>bounded(id,128,'notice identifier'));bounded(batch,128,'notice batch');
    return this.withDb(db=>{
      const now=this.now();
      if(db.prepare('SELECT 1 FROM source_notices WHERE batch=?').get(batch))return null;
      const rows=ids.map(id=>db.prepare("SELECT * FROM source_notices WHERE id=? AND state='pending' AND expires_at>?").get(id,now));
      if(rows.some(row=>!row))return null;
      for(const id of ids)db.prepare("UPDATE source_notices SET state='attempting',batch=?,updated_at=? WHERE id=?").run(batch,now,id);
      return rows.map(row=>({...noticeRow(row),state:'attempting',batch,updatedAt:now}));
    });
  },
  finishNotices(batch,{state}={}){
    bounded(batch,128,'notice batch');
    if(!['sent','failed','unknown'].includes(state))throw invalid('Invalid final notice state.');
    return this.withDb(db=>Number(db.prepare("UPDATE source_notices SET state=?,payload='',updated_at=? WHERE batch=? AND state='attempting'").run(state,this.now(),batch).changes));
  },
  // Only for an attempt that verifiably produced nothing (owner interrupted it).
  releaseNotices(batch){
    bounded(batch,128,'notice batch');
    return this.withDb(db=>Number(db.prepare("UPDATE source_notices SET state='pending',batch='',updated_at=? WHERE batch=? AND state='attempting'").run(this.now(),batch).changes));
  },
  updatePublicEntry(scope,id,{text}={}){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');bounded(text,1000,'public entry');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous)throw invalid('The public entry was not found.');
      if(previous.state==='attempting')throw invalid('Wait for the current publication result before editing.');
      db.prepare('UPDATE public_journal SET text=?,updated_at=? WHERE scope=? AND id=?').run(text,this.now(),key,id);
      return {...publicRow(previous),text,updatedAt:this.now(),externalPostUnchanged:previous.state==='published'};
    });
  },
  deletePublicEntry(scope,id){
    const key=this.scope(scope);bounded(id,180,'public entry identifier');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT * FROM public_journal WHERE scope=? AND id=?').get(key,id);
      if(!previous)throw invalid('The public entry was not found.');
      if(previous.state==='attempting')throw invalid('Wait for the current publication result before deleting.');
      db.prepare('DELETE FROM public_journal WHERE scope=? AND id=?').run(key,id);
      return {deleted:true,externalPostUnchanged:previous.state==='published'};
    });
  }
};
module.exports={initializeContinuity,continuityMethods};
