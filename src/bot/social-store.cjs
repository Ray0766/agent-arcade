'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {atomicJSON} = require('../core/files.cjs');
const {publicCatalog} = require('../core/personas.cjs');
const {initializeContinuity,continuityMethods}=require('./social-continuity-store.cjs');
const {methods:manualQQMethods}=require('./manual-qq-receipts.cjs');
const {initializeBranches,branchMethods}=require('./st/branch-store.cjs');

const DEFAULTS = Object.freeze({enabled:false, characterId:'claude-ju', name:'橘',
  description:'温和、沉稳，认真听你把话说完。喜欢读书、音乐和日常的小发现。', notes:'',
  proactiveMessages:false, qzonePosts:false, qqVoiceMessages:false, qqImageMessages:true, activeStart:9, activeEnd:22,
  intervalMinutes:180, maxMessagesPerDay:2, maxPostsPerDay:1,
  // Source notices (owner-enabled data sources) in the App conversation. Their
  // hours and cap are separate from the QQ contact window above.
  sourceNotices:true, noticeStartHour:8, noticeEndHour:23, maxNoticesPerDay:8,
  speechExamples:Object.freeze([]),cardMetadata:Object.freeze({creator:'',version:'',license:'',sourceFormat:'arcade_character_v1'})});
const KINDS = new Set(['message','post','decision','reply']);
const STATES = new Set(['planned','attempting','sent','published','skipped','failed','unknown','cancelled']);
const storageError = () => Object.assign(Error('Local character memory is unavailable. Social activity is paused.'), {code:'social_storage_unavailable'});
const inputError = message => Object.assign(Error(message), {code:'social_invalid_input'});
const text = (value,max,label,empty=true) => {
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b-\x1f\x7f]/.test(value))throw inputError(`Invalid ${label}.`);
  return value;
};
const MESSAGE_DETAIL='id,role,text,at,swipes,swipe_index,edited_at';
// Version 6 (App conversation store only): which library character wrote a companion message
// of a group conversation, and its name at that time.
const SPEAKER_DETAIL=MESSAGE_DETAIL+',speaker,speaker_name';
const SPEAKER_ID=/^[0-9a-f]{16}$/;
const messageCap=value=>{if(!Number.isInteger(value)||value<1||value>8000)throw inputError('Invalid message limit.');return value;};
// Alternatives of one message; a row without (or with unreadable) alternatives has just its text.
function swipeList(row){
  if(row.swipes===null||row.swipes===undefined)return [row.text];
  let list;try{list=JSON.parse(row.swipes);}catch{list=null;}
  return Array.isArray(list)&&list.length&&list.length<=10&&list.every(item=>typeof item==='string')&&Number.isInteger(row.swipe_index)&&row.swipe_index>=0&&row.swipe_index<list.length?list:[row.text];
}
const messageDetail=row=>{const swipes=swipeList(row);return {id:row.id,role:row.role,text:row.text,at:row.at,edited:row.edited_at!==null&&row.edited_at!==undefined,swipeIndex:swipes.length>1?row.swipe_index:0,swipeCount:swipes.length,...(typeof row.speaker==='string'&&row.speaker?{speakerId:row.speaker,speakerName:row.speaker_name||''}:{})};};
function validateConfig(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(DEFAULTS,key)))throw inputError('Invalid character settings.');
  const next={...DEFAULTS,...value};
  for(const key of ['enabled','proactiveMessages','qzonePosts','qqVoiceMessages','qqImageMessages','sourceNotices'])if(typeof next[key]!=='boolean')throw inputError(`Invalid ${key}.`);
  if(!publicCatalog().some(character=>character.id===next.characterId))throw inputError('Choose an available character.');
  text(next.name,40,'character name',false);text(next.description,800,'character description',false);text(next.notes,1000,'memory notes');
  if(next.notes!=='')throw inputError('Memory notes require a verified account/contact/character scope.');
  if(!Array.isArray(next.speechExamples)||next.speechExamples.length>6)throw inputError('Invalid speech examples.');
  next.speechExamples=next.speechExamples.map(example=>{
    if(!example||typeof example!=='object'||Array.isArray(example)||Object.keys(example).some(key=>!['user','assistant'].includes(key)))throw inputError('Invalid speech example.');
    return {user:text(example.user,240,'example user',false),assistant:text(example.assistant,240,'example assistant',false)};
  });
  const metadata=next.cardMetadata;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).some(key=>!['creator','version','license','sourceFormat'].includes(key))||!['arcade_character_v1','chara_card_v2','chara_card_v3'].includes(metadata.sourceFormat))throw inputError('Invalid character attribution.');
  next.cardMetadata={creator:text(metadata.creator,120,'creator'),version:text(metadata.version,40,'version'),license:text(metadata.license,120,'license'),sourceFormat:metadata.sourceFormat};
  for(const [key,min,max] of [['activeStart',0,23],['activeEnd',0,24],['intervalMinutes',30,1440],['maxMessagesPerDay',0,10],['maxPostsPerDay',0,3],['noticeStartHour',0,23],['noticeEndHour',0,24],['maxNoticesPerDay',1,24]])
    if(!Number.isInteger(next[key])||next[key]<min||next[key]>max)throw inputError(`Invalid ${key}.`);
  if(next.activeStart===next.activeEnd)throw inputError('Choose an active window with different start and end hours.');
  if(next.noticeStartHour===next.noticeEndHour)throw inputError('Choose notice hours with different start and end hours.');
  return next;
}

// Opt-in social mode deliberately retains bounded conversation text. It is a
// separate database from the metadata-only dispatcher journal, and is never
// consulted by the coding dispatcher. Scope includes account, contact, character.
class SocialStore {
  #connectionFrame=null;
  #closeFailed=false;
  // maxScopes and branches are for the App conversation's own database (local-companion.cjs):
  // more conversation slots and the branch index of schema version 5. The defaults keep every
  // other store, including the QQ companion's, exactly as before.
  constructor({root,now=Date.now,loadSqlite=()=>require('node:sqlite'),maxScopes=20,branches=false}={}) {
    if(!Number.isInteger(maxScopes)||maxScopes<1||maxScopes>100||typeof branches!=='boolean')throw inputError('Invalid memory store options.');
    this.maxScopes=maxScopes;this.branchesEnabled=branches;this.detailColumns=branches?SPEAKER_DETAIL:MESSAGE_DETAIL;
    this.file=path.join(root,'social-memory.sqlite');this.configFile=path.join(root,'social-config.json');
    this.now=now;this.available=false;this.problem='';this.settings={...DEFAULTS};
    try{
      fs.mkdirSync(root,{recursive:true});
      if(fs.existsSync(this.configFile)){
        if(fs.statSync(this.configFile).size>20000)throw inputError('Character settings are oversized.');
        this.settings=validateConfig(JSON.parse(fs.readFileSync(this.configFile,'utf8')));
      }
      this.DatabaseSync=loadSqlite().DatabaseSync;
      this.withDb(db=>{
        db.exec(`CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS messages (scope TEXT NOT NULL,id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(scope,id));
          CREATE TABLE IF NOT EXISTS actions (scope TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,updated_at INTEGER NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope,id));
          CREATE TABLE IF NOT EXISTS scoped_notes (scope TEXT PRIMARY KEY,text TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS message_order ON messages(scope,at);
          CREATE INDEX IF NOT EXISTS action_order ON actions(scope,at);`);
        // A committed send intent without its receipt is ambiguous. Never replay.
        db.prepare("UPDATE actions SET state='unknown',updated_at=? WHERE state='attempting'").run(now());
        // Version 4 (the number is owned by initializeContinuity): message
        // alternatives and edit marks for the App conversation, and per-scope
        // lorebook timing state. Old rows keep NULL: unedited, one text.
        const columns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(column=>column.name));
        for(const [name,type] of [['swipes','TEXT'],['swipe_index','INTEGER'],['edited_at','INTEGER']])if(!columns.has(name))db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
        // Version 6, App conversation store only: old rows keep NULL (no recorded speaker).
        if(branches)for(const name of ['speaker','speaker_name'])if(!columns.has(name))db.exec(`ALTER TABLE messages ADD COLUMN ${name} TEXT`);
        db.exec('CREATE TABLE IF NOT EXISTS scope_state (scope TEXT PRIMARY KEY,world_info TEXT NOT NULL)');
        initializeContinuity(db,now(),{branches});
        if(branches)initializeBranches(db);
      },true);
      this.available=!this.#closeFailed;
    }catch{this.available=false;this.problem=storageError().message;}
  }
  // Internal synchronous projections only. This does not cancel a callback
  // that starts unrelated asynchronous work; no such callback belongs here.
  withConnection(operation) {
    this.#syncCallback(operation);
    if(this.#connectionFrame)return this.#syncResult(operation());
    const frame={db:null,transaction:false};this.#connectionFrame=frame;
    try{return this.#syncResult(operation());}
    finally{this.#connectionFrame=null;const db=frame.db;frame.db=null;this.#closeDb(db);}
  }
  #syncCallback(operation) {
    if(typeof operation!=='function'||Object.prototype.toString.call(operation)==='[object AsyncFunction]')throw inputError('Database callbacks must be synchronous.');
  }
  #syncResult(result) {
    if(result&&typeof result.then==='function'){
      // Report the misuse synchronously, and retain a delayed failure without
      // letting an unhandled rejection terminate the app. This is not cancellation.
      Promise.resolve(result).catch(()=>{this.available=false;this.problem=storageError().message;});
      throw inputError('Database callbacks must be synchronous.');
    }
    return result;
  }
  #closeDb(db) {
    try{db?.close();}catch{this.#closeFailed=true;this.available=false;this.problem=storageError().message;}
  }
  withDb(operation,initializing=false) {
    this.#syncCallback(operation);
    if(!initializing&&!this.available)throw storageError();
    const frame=this.#connectionFrame;
    if(frame?.transaction)throw inputError('Database transactions cannot be nested.');
    let db,failed=false;
    try{
      db=frame?.db||new this.DatabaseSync(this.file,{allowExtension:false});
      if(frame){frame.db=db;frame.transaction=true;}
      db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA secure_delete=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      const result=this.#syncResult(operation(db));db.exec('COMMIT');return result;
    }catch(error){
      failed=true;
      try{db?.exec('ROLLBACK');}catch{/* A failed BEGIN may have no transaction. */}
      if(frame&&frame.db===db)frame.db=null;
      if(error.code==='social_invalid_input')throw error;
      this.available=false;this.problem=storageError().message;throw storageError();
    }finally{
      if(frame)frame.transaction=false;
      if(!frame||failed)this.#closeDb(db);
    }
  }
  config(){return {...this.settings,speechExamples:this.settings.speechExamples.map(example=>({...example})),cardMetadata:{...this.settings.cardMetadata}};}
  configure(patch) {
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw inputError('Invalid character settings.');
    if(!this.available)throw storageError();
    const next=validateConfig({...this.settings,...patch});
    atomicJSON(this.configFile,next);this.settings=next;return this.config();
  }
  scope(value) {
    text(value,256,'memory scope',false);
    return createHash('sha256').update(value).digest('hex');
  }
  ensureScope(db,scope) {
    if(db.prepare('SELECT 1 FROM scopes WHERE id=?').get(scope))return;
    if(db.prepare('SELECT count(*) AS count FROM scopes').get().count>=this.maxScopes){
      // A cleared scope keeps its action receipts for rate limits and duplicate
      // barriers. Thirty days on they guard nothing, so the slot can be reused.
      // A registered character conversation or a branch is never reclaimed, however idle.
      const kept=this.branchesEnabled?'NOT EXISTS(SELECT 1 FROM conversation_scopes WHERE scope=s.id) AND NOT EXISTS(SELECT 1 FROM branches WHERE scope=s.id OR root=s.id) AND ':'';
      const idle=db.prepare("SELECT id FROM scopes s WHERE "+kept+"NOT EXISTS(SELECT 1 FROM messages WHERE scope=s.id) AND NOT EXISTS(SELECT 1 FROM scoped_notes WHERE scope=s.id) AND NOT EXISTS(SELECT 1 FROM facts WHERE scope=s.id) AND NOT EXISTS(SELECT 1 FROM public_journal WHERE scope=s.id) AND NOT EXISTS(SELECT 1 FROM followups WHERE scope=s.id AND (state IN ('pending','attempting') OR updated_at>=?)) AND NOT EXISTS(SELECT 1 FROM actions WHERE scope=s.id AND updated_at>=?) ORDER BY (SELECT max(updated_at) FROM actions WHERE scope=s.id) LIMIT 1").get(this.now()-30*86400000,this.now()-30*86400000);
      if(!idle)throw Object.assign(inputError('Character memory scope limit reached. Clear an unused scope first.'),{reason:'scope_limit'});
      for(const table of ['actions','followups','scope_state'])db.prepare(`DELETE FROM ${table} WHERE scope=?`).run(idle.id);
      db.prepare('DELETE FROM scopes WHERE id=?').run(idle.id);
    }
    db.prepare('INSERT INTO scopes(id) VALUES(?)').run(scope);
  }
  // maxChars is a per-call bound used by the App conversation's imported
  // characters; every other caller keeps the 2000-character default.
  // speaker / speakerName: the library character that wrote a companion message of a group
  // conversation (App conversation store only).
  append(scope,{id=randomUUID(),role,text:body,at=this.now(),speaker=null,speakerName=''}={},{maxChars=2000}={}) {
    const key=this.scope(scope);text(id,180,'message identifier',false);text(body,messageCap(maxChars),'message',false);
    if(speaker!==null&&(!this.branchesEnabled||role!=='assistant'||typeof speaker!=='string'||!SPEAKER_ID.test(speaker)))throw inputError('Invalid message speaker.');
    if(speaker!==null&&(typeof speakerName!=='string'||speakerName.length>80||/[\x00-\x1f\x7f]/.test(speakerName)))throw inputError('Invalid speaker name.');
    if(!['user','assistant'].includes(role)||!Number.isSafeInteger(at)||at<0)throw inputError('Invalid memory message.');
    return this.withDb(db=>{
      this.ensureScope(db,key);
      const previous=db.prepare('SELECT id,role,text,at FROM messages WHERE scope=? AND id=?').get(key,id);
      if(previous){
        if(previous.role!==role||previous.text!==body)throw inputError('Message identifier belongs to different content.');
        return {...previous};
      }
      if(speaker!==null)db.prepare('INSERT INTO messages(scope,id,role,text,at,speaker,speaker_name) VALUES(?,?,?,?,?,?,?)').run(key,id,role,body,at,speaker,speakerName);
      else db.prepare('INSERT INTO messages(scope,id,role,text,at) VALUES(?,?,?,?,?)').run(key,id,role,body,at);
      db.prepare('DELETE FROM messages WHERE scope=? AND rowid NOT IN (SELECT rowid FROM messages WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 120)').run(key,key);
      return {id,role,text:body,at,...(speaker!==null?{speakerId:speaker,speakerName}:{})};
    });
  }
  // details:true adds {edited,swipeIndex,swipeCount}; the default row shape is unchanged.
  history(scope,limit=30,{details=false}={}) {
    const key=this.scope(scope);
    if(!Number.isInteger(limit)||limit<1||limit>120)throw inputError('Invalid history limit.');
    return this.withDb(db=>db.prepare(`SELECT ${details?this.detailColumns:'id,role,text,at'} FROM messages WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT ?`).all(key,limit).reverse().map(row=>details?messageDetail(row):{...row}));
  }
  historyWindow(scope,limit=30,{details=false}={}) {
    const key=this.scope(scope);
    if(!Number.isInteger(limit)||limit<1||limit>120)throw inputError('Invalid history limit.');
    return this.withDb(db=>{
      const rows=db.prepare(`SELECT ${details?this.detailColumns:'id,role,text,at'} FROM messages WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT ?`).all(key,limit+1);
      return {messages:rows.slice(0,limit).reverse().map(row=>details?messageDetail(row):{...row}),hasEarlier:rows.length>limit};
    });
  }
  messageCount(scope) {
    const key=this.scope(scope);
    return this.withDb(db=>db.prepare('SELECT count(*) AS count FROM messages WHERE scope=?').get(key).count);
  }
  // Message operations (App conversation). Each changes exactly one stored row.
  #message(db,key,id) {
    text(id,180,'message identifier',false);
    const row=db.prepare(`SELECT ${this.detailColumns} FROM messages WHERE scope=? AND id=?`).get(key,id);
    if(!row)throw Object.assign(inputError('The message was not found.'),{reason:'message_not_found'});
    return row;
  }
  message(scope,id) {
    const key=this.scope(scope);
    return this.withDb(db=>{const row=this.#message(db,key,id);return {...messageDetail(row),swipes:swipeList(row)};});
  }
  editMessage(scope,id,body,{maxChars=2000,edited=true}={}) {
    const key=this.scope(scope);text(body,messageCap(maxChars),'message',false);
    return this.withDb(db=>{
      const row=this.#message(db,key,id),swipes=row.swipes===null?null:swipeList(row);
      if(swipes)swipes[Math.min(row.swipe_index??0,swipes.length-1)]=body;
      const next={...row,text:body,swipes:swipes?JSON.stringify(swipes):null,edited_at:edited?this.now():row.edited_at};
      db.prepare('UPDATE messages SET text=?,swipes=?,edited_at=? WHERE scope=? AND id=?').run(next.text,next.swipes,next.edited_at,key,id);
      return messageDetail(next);
    });
  }
  removeMessage(scope,id) {
    const key=this.scope(scope);
    return this.withDb(db=>{this.#message(db,key,id);db.prepare('DELETE FROM messages WHERE scope=? AND id=?').run(key,id);return {removed:true};});
  }
  // Adds an alternative text to a companion message and selects it. The first
  // call keeps the current text as alternative 0; the oldest is dropped past the cap.
  addSwipe(scope,id,body,{maxChars=2000,maxSwipes=10}={}) {
    const key=this.scope(scope);text(body,messageCap(maxChars),'message',false);
    if(!Number.isInteger(maxSwipes)||maxSwipes<2||maxSwipes>10)throw inputError('Invalid alternative limit.');
    return this.withDb(db=>{
      const row=this.#message(db,key,id);if(row.role!=='assistant')throw inputError('Only a companion message can have alternatives.');
      const swipes=[...swipeList(row),body].slice(-maxSwipes),next={...row,text:body,swipes:JSON.stringify(swipes),swipe_index:swipes.length-1};
      db.prepare('UPDATE messages SET text=?,swipes=?,swipe_index=? WHERE scope=? AND id=?').run(next.text,next.swipes,next.swipe_index,key,id);
      return messageDetail(next);
    });
  }
  selectSwipe(scope,id,index) {
    const key=this.scope(scope);
    return this.withDb(db=>{
      const row=this.#message(db,key,id),swipes=swipeList(row);
      if(!Number.isInteger(index)||index<0||index>=swipes.length)throw inputError('Invalid alternative.');
      const next={...row,text:swipes[index],swipes:JSON.stringify(swipes),swipe_index:index};
      db.prepare('UPDATE messages SET text=?,swipes=?,swipe_index=? WHERE scope=? AND id=?').run(next.text,next.swipes,next.swipe_index,key,id);
      return messageDetail(next);
    });
  }
  // Opaque per-scope lorebook timing state (JSON text owned by the caller).
  worldInfoState(scope) {
    const key=this.scope(scope);
    return this.withDb(db=>db.prepare('SELECT world_info FROM scope_state WHERE scope=?').get(key)?.world_info||'');
  }
  setWorldInfoState(scope,value) {
    const key=this.scope(scope);text(value,200000,'lorebook state');
    return this.withDb(db=>{
      if(!value){db.prepare('DELETE FROM scope_state WHERE scope=?').run(key);return '';}
      this.ensureScope(db,key);db.prepare('INSERT OR REPLACE INTO scope_state(scope,world_info) VALUES(?,?)').run(key,value);return value;
    });
  }
  getNotes(scope) {
    const key=this.scope(scope);
    return this.withDb(db=>db.prepare('SELECT text FROM scoped_notes WHERE scope=?').get(key)?.text||'');
  }
  setNotes(scope,notes) {
    const key=this.scope(scope);text(notes,1000,'memory notes');
    return this.withDb(db=>{
      this.ensureScope(db,key);
      db.prepare('INSERT OR REPLACE INTO scoped_notes(scope,text) VALUES(?,?)').run(key,notes);
      return notes;
    });
  }
  actions(scope,limit=20) {
    const key=this.scope(scope);
    if(!Number.isInteger(limit)||limit<1||limit>200)throw inputError('Invalid action limit.');
    return this.withDb(db=>db.prepare("SELECT id,kind,state,text,at,updated_at AS updatedAt,receipt FROM actions WHERE scope=? AND kind<>'manual' ORDER BY at DESC,rowid DESC LIMIT ?").all(key,limit).map(row=>({...row})));
  }
  recordAction(scope,{id=randomUUID(),kind,state,text:body='',at=this.now(),receipt=''}={}) {
    const key=this.scope(scope);text(id,180,'action identifier',false);text(body,2000,'action text');text(receipt,300,'receipt');
    if(!KINDS.has(kind)||!STATES.has(state)||!Number.isSafeInteger(at)||at<0)throw inputError('Invalid social action.');
    return this.withDb(db=>{
      this.ensureScope(db,key);
      if(db.prepare('SELECT 1 FROM actions WHERE scope=? AND id=?').get(key,id))throw inputError('This action identifier was already recorded.');
      const updatedAt=this.now();
      db.prepare('INSERT INTO actions(scope,id,kind,state,text,at,updated_at,receipt) VALUES(?,?,?,?,?,?,?,?)').run(key,id,kind,state,body,at,updatedAt,receipt);
      // Ordinary replies do not consume autonomous daily allowances. Retire old
      // reply receipts first so an active conversation has no 200-message cap.
      // Preserve recent proactive/decision attempts across that pruning, and
      // never the row just recorded: its sender still has to finish it.
      const count=db.prepare("SELECT count(*) AS count FROM actions WHERE scope=? AND kind<>'manual'").get(key).count;
      if(count>200){
        const old=db.prepare("SELECT rowid FROM actions WHERE scope=? AND kind<>'manual' AND id<>? AND (kind='reply' OR at<?) ORDER BY CASE WHEN kind='reply' THEN 0 ELSE 1 END,at,rowid LIMIT ?").all(key,id,this.now()-86400000,count-200);
        if(old.length<count-200&&kind!=='reply')throw inputError('Social action history is full for this day. Activity is paused.');
        for(const item of old)db.prepare('DELETE FROM actions WHERE rowid=?').run(item.rowid);
      }
      return {id,kind,state,text:body,at,updatedAt,receipt};
    });
  }
  updateAction(scope,id,patch) {
    const key=this.scope(scope);text(id,180,'action identifier',false);
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['state','receipt','text'].includes(k))||!STATES.has(patch.state))throw inputError('Invalid action update.');
    if(patch.receipt!==undefined)text(patch.receipt,300,'receipt');if(patch.text!==undefined)text(patch.text,2000,'action text');
    return this.withDb(db=>{
      const previous=db.prepare('SELECT id,kind,state,text,at,updated_at AS updatedAt,receipt FROM actions WHERE scope=? AND id=?').get(key,id);
      if(!previous)throw inputError('Social action was not found.');
      if(previous.state!=='attempting'&&previous.state!=='planned')throw inputError('A finished or ambiguous action cannot be retried.');
      const next={...previous,...patch,updatedAt:this.now()};
      db.prepare('UPDATE actions SET state=?,text=?,receipt=?,updated_at=? WHERE scope=? AND id=?').run(next.state,next.text,next.receipt,next.updatedAt,key,id);
      return next;
    });
  }
  clear(scope) {
    const key=this.scope(scope);
    this.manualQQEpochs||=new Map();this.manualQQEpochs.set(key,(this.manualQQEpochs.get(key)||0)+1);
    this.withDb(db=>{
      db.prepare('DELETE FROM messages WHERE scope=?').run(key);
      db.prepare("UPDATE actions SET text='' WHERE scope=?").run(key);
      db.prepare('DELETE FROM scoped_notes WHERE scope=?').run(key);
      db.prepare('DELETE FROM scope_state WHERE scope=?').run(key);
      db.prepare('DELETE FROM facts WHERE scope=?').run(key);
      db.prepare("UPDATE followups SET state=CASE WHEN state='attempting' THEN 'unknown' WHEN state='pending' THEN 'cancelled' ELSE state END,text='',source_ids='[]',fact_ids='[]',updated_at=? WHERE scope=?").run(this.now(),key);
      // Keep action receipts: forgetting a conversation must not reset rate
      // limits, duplicate-send barriers, or uncertain-send records.
      if(!db.prepare('SELECT 1 FROM actions WHERE scope=?').get(key)&&!db.prepare('SELECT 1 FROM followups WHERE scope=?').get(key)&&!db.prepare('SELECT 1 FROM public_journal WHERE scope=?').get(key))db.prepare('DELETE FROM scopes WHERE id=?').run(key);
    });
  }
}
Object.assign(SocialStore.prototype,continuityMethods,manualQQMethods,branchMethods);
module.exports={SocialStore,DEFAULTS,validateConfig};
