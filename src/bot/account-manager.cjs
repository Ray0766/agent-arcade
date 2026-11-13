'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {atomicJSON,readJSON}=require('../core/files.cjs');
const {personaForBackend}=require('../core/personas.cjs');
const {BotService}=require('./service.cjs');
const {validateQQUrl,validateQQOwner}=require('./qq.cjs');
const {validateXId}=require('./x-channel-policy.cjs');
const {validateId:validateMessengerId}=require('./messenger-channel-policy.cjs');

const MAX_ACCOUNTS=6;
function label(value){if(typeof value!=='string'||!value.trim()||value.length>40||/[\x00-\x1f]/.test(value))throw Error('Give this companion a name of 1–40 characters.');return value.trim();}
function canonical(root){if(typeof root!=='string'||!path.isAbsolute(root)||!fs.statSync(root).isDirectory())throw Error('Choose an existing Agent Arcade data folder.');return fs.realpathSync(root);}
function qqContext(config){
  try{
    const ownerId=validateQQOwner(config.qqOwnerId),expectedAccountId=config.qqAccountId===undefined?'':validateQQOwner(config.qqAccountId);
    if(ownerId===expectedAccountId)return null;
    return {url:validateQQUrl(config.qqUrl),ownerId,expectedAccountId};
  }catch{return null;}
}
function readQQBinding(binding){
  if(binding===undefined)return undefined;
  try{
    if(!binding||typeof binding!=='object'||Array.isArray(binding)||typeof binding.accountId!=='string'||typeof binding.url!=='string'||!Number.isSafeInteger(binding.verifiedAt)||binding.verifiedAt<1)throw Error();
    const base={accountId:validateQQOwner(binding.accountId),url:validateQQUrl(binding.url),verifiedAt:binding.verifiedAt};
    // Versionless metadata predates owner/expected-account association. Retain
    // it on disk, but never infer that it belongs to today's configuration.
    if(binding.contextVersion===undefined&&binding.ownerId===undefined&&binding.expectedAccountId===undefined)return base;
    if(binding.contextVersion!==1||typeof binding.ownerId!=='string'||typeof binding.expectedAccountId!=='string')throw Error();
    const ownerId=validateQQOwner(binding.ownerId),expectedAccountId=binding.expectedAccountId===''?'':validateQQOwner(binding.expectedAccountId);
    if(ownerId===base.accountId||expectedAccountId&&expectedAccountId!==base.accountId)throw Error();
    return {...base,contextVersion:1,ownerId,expectedAccountId};
  }catch{throw Error('Companion registry contains an invalid QQ identity record.');}
}

// Each service retains its own vault, journal, conversation and cancellation.
// Import references an existing data folder; credentials are never exported.
class AccountManager {
  constructor({root,onChange=()=>{},serviceFactory=options=>new BotService(options),...serviceOptions}){
    fs.mkdirSync(root,{recursive:true});this.root=canonical(root);this.file=path.join(root,'companions.json');this.onChange=onChange;this.serviceFactory=serviceFactory;this.serviceOptions=serviceOptions;this.services=new Map();this.claims=new Map();this.credentialMigrations=new Set();
    let stored=null;
    if(fs.existsSync(this.file)){try{if(fs.statSync(this.file).size>64000)throw Error();stored=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!stored||typeof stored!=='object')throw Error();}catch{throw Error('Companion registry is invalid. Your account data has not been changed.');}}
    if(stored){
      if(stored.version!==1)throw Error('Companion registry version is unsupported. Your account data has not been changed.');
      if(!Array.isArray(stored.accounts)||!stored.accounts.length||stored.accounts.length>MAX_ACCOUNTS)throw Error('Companion registry is invalid. Your account data has not been changed.');
      const ids=new Set(),roots=new Set();
      this.accounts=stored.accounts.map(item=>{
        if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(item.id)||ids.has(item.id))throw Error('Companion registry contains an invalid identity.');
        if(item.managedVault!==undefined&&typeof item.managedVault!=='boolean')throw Error('Companion registry contains an invalid managed credential flag.');
        ids.add(item.id);const resolved=canonical(item.root),key=resolved.toLowerCase();if(roots.has(key))throw Error('A companion data folder is registered twice.');roots.add(key);
        const binding=readQQBinding(item.qqBinding);
        return {id:item.id,name:label(item.name),root:resolved,managedVault:item.managedVault===true,...(binding?{qqBinding:binding}:{})};
      });
      this.selectedId=ids.has(stored.selectedId)?stored.selectedId:this.accounts[0].id;
    }else{this.accounts=[{id:'primary',name:'我的搭档',root:this.root,managedVault:false}];this.selectedId='primary';}
    for(const entry of this.accounts)this.makeService(entry);
  }
  save(){atomicJSON(this.file,{version:1,selectedId:this.selectedId,accounts:this.accounts});}
  makeService(entry,{register=true}={}){
    const service=this.serviceFactory({...this.serviceOptions,root:entry.root,vaultFile:entry.managedVault?path.join(this.managedCredentialRoot(entry.id),'bot-vault.json'):undefined,onChange:()=>this.onChange(),claimIdentity:identity=>this.claim(entry.id,identity)});
    if(register)this.services.set(entry.id,service);return service;
  }
  managedCredentialRoot(id,{create=false}={}){
    if(!this.accounts.some(entry=>entry.id===id))throw Error('Companion was not found.');
    const parent=path.join(this.root,'credential-profiles'),target=path.join(parent,id);
    for(const dir of [parent,target]){
      if(fs.existsSync(dir)){const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Managed credential folders cannot be links or files.');}
      else if(create)fs.mkdirSync(dir,{mode:0o700});
    }
    return target;
  }
  captureCredentialMigration(id){
    const service=this.get(id),entry=this.accounts.find(item=>item.id===id);
    service.assertNotForgetting();
    if(this.credentialMigrations.has(id))throw Error('Credential migration is already in progress for this companion.');
    if(service.status!=='disconnected'||service.snapshot().credentialState!=='locked')throw Error('Only a disconnected companion with locked credentials can be migrated.');
    return {id,service,entry,generation:service.generation,config:JSON.stringify(service.config)};
  }
  assertCredentialMigration(ticket){
    if(!ticket||this.services.get(ticket.id)!==ticket.service||!this.accounts.includes(ticket.entry)||ticket.service.status!=='disconnected'||ticket.service.snapshot().credentialState!=='locked'||ticket.service.generation!==ticket.generation||JSON.stringify(ticket.service.config)!==ticket.config)throw Error('The companion changed while credentials were being migrated. Please review it and try again.');
    ticket.service.assertNotForgetting();
  }
  async migrateCredentials(ticket,migrate){
    this.assertCredentialMigration(ticket);const {id,service,entry}=ticket;
    if(this.credentialMigrations.has(id))throw Error('Credential migration is already in progress for this companion.');
    if(typeof migrate!=='function')throw Error('A credential migration operation is required.');
    const targetRoot=this.managedCredentialRoot(id,{create:true}),targetFile=path.join(targetRoot,'bot-vault.json');
    let recoveryFingerprint;
    if(fs.existsSync(targetFile)){
      try{
        const stat=fs.lstatSync(targetFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64000)throw Error();
        const bytes=fs.readFileSync(targetFile),saved=JSON.parse(bytes.toString('utf8'));
        if(!saved||typeof saved.data!=='string'||!saved.data||!/^[A-Za-z0-9+/]+={0,2}$/.test(saved.data))throw Error();
        recoveryFingerprint=createHash('sha256').update(bytes).digest('hex');
      }catch{throw Error('An existing credential copy could not be verified. It was not overwritten.');}
    }
    const previousManaged=entry.managedVault;let replacement,result,newFingerprint;
    this.credentialMigrations.add(id);this.onChange();
    try{
      result=await migrate({sourceRoot:entry.root,targetRoot,registeredRoots:this.accounts.map(item=>item.root),...(recoveryFingerprint?{recoverTargetSha256:recoveryFingerprint}:{})});
      if(result?.migrated!==true)throw Error('Credential migration was not completed.');
      if(!!recoveryFingerprint!==(result.recovered===true))throw Error('The existing credential copy has no verified recovery receipt.');
      if(typeof result.targetVaultSha256!=='string'||!/^[a-f0-9]{64}$/.test(result.targetVaultSha256))throw Error('The migrated credential copy has no verifiable receipt.');
      newFingerprint=result.targetVaultSha256;
      if(recoveryFingerprint&&newFingerprint!==recoveryFingerprint)throw Error('The existing credential copy changed during recovery.');
      if(fs.statSync(targetFile).size>64000||createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex')!==newFingerprint)throw Error('The migrated credential copy changed before it could be adopted.');
      this.assertCredentialMigration(ticket);
      replacement=this.makeService({...entry,managedVault:true},{register:false});
      if(replacement.status!=='disconnected'||replacement.snapshot().credentialState!=='ready')throw Error('The new credential copy could not be opened in this app profile.');
      await service.localStop?.();this.assertCredentialMigration(ticket);entry.managedVault=true;
      try{this.save();}catch(error){entry.managedVault=previousManaged;throw error;}
      this.services.set(id,replacement);try{service.journal?.close?.();}catch{/* The replacement and registry are already committed. */}return {migrated:true,...(recoveryFingerprint?{recovered:true}:{})};
    }catch(error){
      entry.managedVault=previousManaged;
      try{replacement?.journal?.close?.();}catch{/* Preserve the original migration failure. */}
      // Roll back only the exact newly created encrypted copy. The source
      // vault and every registered data folder remain untouched.
      if(!recoveryFingerprint&&newFingerprint&&fs.existsSync(targetFile)){
        try{if(createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex')===newFingerprint)fs.unlinkSync(targetFile);}catch{/* Preserve an uncertain copy rather than delete another writer's file. */}
      }
      throw error;
    }finally{this.credentialMigrations.delete(id);this.onChange();}
  }
  current(){return this.get(this.selectedId);}
  get(id){const service=this.services.get(id);if(!service)throw Error('Companion was not found.');return service;}
  claim(id,{channel,accountId}){
    const service=this.get(id),entry=this.accounts.find(item=>item.id===id);
    let context;
    if(channel==='messenger'){
      accountId=validateMessengerId(accountId);
      if(accountId!==service.config.messengerPageId||accountId===service.config.messengerOwnerId)throw Object.assign(Error('The Messenger Page does not match this companion.'),{code:'page_changed'});
    }
    if(channel==='x'){
      accountId=validateXId(accountId);
      if(accountId!==service.config.xAccountId||accountId===service.config.xOwnerId)throw Object.assign(Error('The X account does not match this companion.'),{code:'account_mismatch'});
    }
    if(channel==='qq'){
      accountId=validateQQOwner(accountId);context=qqContext(service.config);
      if(!context)throw Error('The QQ owner and connection settings must be valid before claiming an account.');
      if(accountId===context.ownerId)throw Object.assign(Error('The companion cannot be its owner QQ account.'),{code:'owner_is_agent_account'});
      if(context.expectedAccountId&&accountId!==context.expectedAccountId)throw Object.assign(Error('The QQ account does not match this companion.'),{code:'account_mismatch'});
    }
    const key=`${channel}:${accountId}`;
    const owner=this.claims.get(key);if(owner&&owner.id!==id)throw Object.assign(Error('This social account is already connected by another companion.'),{code:'account_in_use'});
    // Retain an observed identity for the account page across restarts. This is
    // display metadata, not an online state or authorization to route messages.
    if(channel==='qq'){
      const previous=entry.qqBinding;
      entry.qqBinding={accountId,...context,contextVersion:1,verifiedAt:Date.now()};
      try{this.save();}catch(error){if(previous)entry.qqBinding=previous;else delete entry.qqBinding;throw error;}
    }
    const lease={id,token:randomUUID()};this.claims.set(key,lease);
    return ()=>{if(this.claims.get(key)===lease)this.claims.delete(key);};
  }
  snapshot(){return {selectedId:this.selectedId,maxAccounts:MAX_ACCOUNTS,accounts:this.accounts.map(entry=>{
    const service=this.get(entry.id),state=typeof service.accountSnapshot==='function'?service.accountSnapshot():service.snapshot(),settings=state.social?.config;
    const backend=({native:'claude-native',claude:'claude-native',api:'claude-api',codex:'codex',deepseek:'deepseek',gpt:'gpt',gemini:'gemini',doubao:'doubao'})[state.mode]||'claude-api';
    const defaultCharacter=personaForBackend(backend).id;
    const characterId=settings?.enabled&&state.social.supported?settings.characterId||defaultCharacter:defaultCharacter;
    const context=qqContext(service.config),saved=entry.qqBinding;
    const binding=state.channel==='qq'&&context&&saved?.contextVersion===1&&saved.url===context.url&&saved.ownerId===context.ownerId&&saved.expectedAccountId===context.expectedAccountId?{accountId:saved.accountId,verifiedAt:saved.verifiedAt,source:'last_verified'}:null;
    const checked=state.qq?.check,lease=checked?.accountId&&this.claims.get(`qq:${checked.accountId}`);
    const accountId=state.channel==='qq'&&state.status==='connected'&&checked?.state==='checked'&&lease?.id===entry.id&&binding?.accountId===checked.accountId?checked.accountId:'';
    return {id:entry.id,name:entry.name,root:entry.root,mode:state.mode,channel:state.channel,status:state.status,credentialState:state.credentialState||'empty',credentialMigration:this.credentialMigrations.has(entry.id),problem:state.problem,characterId,companion:!!settings?.enabled,accountId,qqOwnerId:context?.ownerId||'',expectedQQAccountId:context?.expectedAccountId||'',qqBinding:binding,incomingCount:state.incomingCount,outgoingAccepted:state.outgoingAccepted,busy:!!state.social?.busy};
  })};}
  select(id){this.get(id);const previous=this.selectedId;this.selectedId=id;try{this.save();}catch(error){this.selectedId=previous;throw error;}this.onChange();return this.current();}
  rename(id,name){this.get(id);const item=this.accounts.find(item=>item.id===id),previous=item.name;item.name=label(name);try{this.save();}catch(error){item.name=previous;throw error;}this.onChange();}
  add({name,root}={}){
    if(this.accounts.length>=MAX_ACCOUNTS)throw Error(`At most ${MAX_ACCOUNTS} companions can be managed together.`);
    const id=randomUUID();const displayName=label(name);
    if(root){root=canonical(root);if(!fs.existsSync(path.join(root,'bot-config.json')))throw Error('This folder does not contain an Agent Arcade connection.');}
    else{root=path.join(this.root,'companions',id);fs.mkdirSync(root,{recursive:true});}
    if(this.accounts.some(item=>item.root.toLowerCase()===root.toLowerCase()))throw Error('This companion data folder is already registered.');
    const previous=this.selectedId,entry={id,name:displayName,root,managedVault:false};const service=this.makeService(entry);this.accounts.push(entry);this.selectedId=id;try{this.save();}catch(error){this.accounts.pop();this.selectedId=previous;this.services.delete(id);throw error;}this.onChange();return service;
  }
  remove(id){
    if(this.credentialMigrations.has(id))throw Error('Wait for this companion’s credential migration to finish.');
    const service=this.get(id);if(id==='primary'||this.accounts.length===1)throw Error('The primary companion cannot be removed.');
    if(service.status!=='disconnected')throw Error('Disconnect this companion before removing it from the list.');
    service.assertLocalStopped?.();
    const previous=this.accounts,selected=this.selectedId;this.accounts=this.accounts.filter(item=>item.id!==id);if(this.selectedId===id)this.selectedId=this.accounts[0].id;try{this.save();}catch(error){this.accounts=previous;this.selectedId=selected;throw error;}this.services.delete(id);this.onChange();
    // Removing a registry entry deliberately keeps its files and encrypted key.
  }
  async connect(id,{assertCurrent}={}){
    if(assertCurrent!==undefined&&typeof assertCurrent!=='function')throw Object.assign(Error('Invalid connection guard.'),{code:'invalid_request'});
    if(this.credentialMigrations.has(id))throw Error('Wait for this companion’s credential migration to finish.');
    const service=this.get(id);for(const [otherId,other] of this.services){if(otherId!==id&&other.status!=='disconnected'&&service.config.channel==='qq'&&other.config.channel==='qq'&&validateQQUrl(other.config.qqUrl)===validateQQUrl(service.config.qqUrl))throw Error('This QQ bridge is already connected by another companion.');}
    const guard=assertCurrent?state=>{if(this.services.get(id)!==service||this.credentialMigrations.has(id))throw Object.assign(Error('The companion changed.'),{code:'changed'});return assertCurrent(state);}:undefined;
    await service.connect(guard?{assertCurrent:guard}:undefined);this.onChange();return service.snapshot();
  }
  async disconnect(id){await this.get(id).disconnect();this.onChange();}
  async close(){await Promise.allSettled([...this.services.values()].map(service=>service.disconnect()));}
}
module.exports={AccountManager,MAX_ACCOUNTS};
