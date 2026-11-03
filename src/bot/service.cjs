'use strict';
const fs=require('node:fs'),path=require('node:path');
const {atomicJSON,readJSON}=require('../core/files.cjs');
const {Dispatcher}=require('./dispatcher.cjs');
const {WeixinClient}=require('./weixin.cjs');
const {createRunner}=require('./runner.cjs');
function pause(ms,signal){return new Promise(resolve=>{if(signal.aborted)return resolve();const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});});}

// Electron's OS-backed vault is deliberately injected. No plaintext fallback.
class BotService {
  constructor({root,vault,onChange=()=>{},clientFactory=opts=>new WeixinClient(opts),runnerFactory=createRunner,qrEncoder}) {
    Object.assign(this,{root,vault,onChange,clientFactory,runnerFactory,qrEncoder});
    this.file=path.join(root,'bot-vault.json'); this.config=readJSON(path.join(root,'bot-config.json'));
    this.secret={}; this.status='disconnected'; this.problem=''; this.dispatcher=null; this.qr=null;this.generation=0;this.incomingCount=0;this.outgoingAccepted=0;
    try { const stored=readJSON(this.file,null); if(stored&&vault.isEncryptionAvailable()) this.secret=JSON.parse(vault.decryptString(Buffer.from(stored.data,'base64'))); } catch { this.problem='Saved credentials could not be opened. Reconnect WeChat and set the API key again.'; }
  }
  persist(next=this.secret){
    if(!this.vault.isEncryptionAvailable()) throw Error('OS credential encryption is unavailable. Credentials were not saved.');
    atomicJSON(this.file,{data:this.vault.encryptString(JSON.stringify(next)).toString('base64')});this.secret=next;
  }
  snapshot(){return {status:this.status,problem:this.problem,workspace:this.config.workspace||'',budget:this.config.budget||1,hasKey:!!this.secret.key,paired:!!this.secret.token,qr:this.qr,incomingCount:this.incomingCount,outgoingAccepted:this.outgoingAccepted,tasks:this.dispatcher?.snapshot()||null};}
  changed(){this.onChange();}
  configure({key,workspace,budget}={}){
    if(this.status!=='disconnected')throw Error('Disconnect before changing the project or API key.');
    if(workspace!==undefined){if(typeof workspace!=='string'||!path.isAbsolute(workspace)||!fs.statSync(workspace).isDirectory())throw Error('Choose an existing project folder.');this.config.workspace=fs.realpathSync(workspace);}
    if(budget!==undefined){if(typeof budget!=='number'||!Number.isFinite(budget)||budget<0.05||budget>5)throw Error('Task budget must be between $0.05 and $5.');this.config.budget=budget;}
    if(key!==undefined){if(typeof key!=='string'||key.length>500||key.length<10)throw Error('Enter a valid Anthropic API key.');this.persist({...this.secret,key});}
    atomicJSON(path.join(this.root,'bot-config.json'),this.config);this.changed();
  }
  async login(){
    await this.disconnect();const generation=++this.generation,controller=new AbortController(),signal=controller.signal;
    const current=()=>this.generation===generation&&!signal.aborted;
    this.status='pairing';this.problem='';this.loginController=controller;this.dispatcher=null;this.incomingCount=0;this.outgoingAccepted=0;this.changed();
    try {
      const client=this.clientFactory({});const code=await client.startLogin(signal);if(!current())return;
      const qr=await this.qrEncoder(code.qrContent);if(!current())return;this.qr=qr;this.changed();
      const expires=Date.now()+180000;
      while(current()&&Date.now()<expires){
        const state=await client.pollLogin(code.qrcode,signal);
        if(!current())return;
        if(state.status==='confirmed'){
          if(!state.token||!state.ownerId)throw Error('Incomplete login');
          this.persist({...this.secret,token:state.token,ownerId:state.ownerId,baseUrl:state.baseUrl});
          this.qr=null;this.status='disconnected';this.changed();return;
        }
        if(['expired','need_verifycode','verify_code_blocked','binded_redirect'].includes(state.status)){
          this.problem=state.status==='need_verifycode'?'This WeChat login requires phone verification, which this preview does not support. Try pairing again or use the official Tencent client.':'WeChat could not complete pairing. Request a new code.';return;
        }
        await pause(1000,signal);
      }
      if(!signal.aborted)throw Error('Login timed out');
    }catch{if(current())this.problem='WeChat login did not complete. Request a new code and scan it in WeChat.';}
    finally{if(this.generation===generation){this.qr=null;if(this.status==='pairing')this.status='disconnected';this.changed();}}
  }
  async connect(){
    if(this.status==='connected'||this.status==='connecting')return;
    if(this.status!=='disconnected')throw Error('Finish pairing or wait for the previous task to stop first.');
    if(!this.secret.token||!this.secret.ownerId||!this.secret.key||!this.config.workspace)throw Error('Choose a project, save an API key, and pair WeChat first.');
    if(!fs.statSync(this.config.workspace).isDirectory())throw Error('Project folder is unavailable.');
    this.status='connecting';this.problem='';this.controller=new AbortController();
    const signal=this.controller.signal,generation=++this.generation,ownerId=this.secret.ownerId;
    this.incomingCount=0;this.outgoingAccepted=0;
    let client;
    try{
      client=this.clientFactory({token:this.secret.token,ownerId,baseUrl:this.secret.baseUrl});
      const execute=this.runnerFactory({workspace:this.config.workspace,key:this.secret.key,configDir:path.join(this.root,'bot-agent'),budget:this.config.budget||1});
      this.dispatcher=new Dispatcher({execute,send:async(text,contextToken)=>{
        await client.sendText(ownerId,text,contextToken,undefined,signal);
        if(generation===this.generation&&!signal.aborted){this.outgoingAccepted++;this.changed();}
      },onChange:()=>{if(generation===this.generation)this.changed();}});
    }catch{this.controller.abort();this.status='disconnected';this.problem='Could not start the bot. Check the project and saved connection.';this.changed();return;}
    this.changed();
    // No auto-connect or replay after app restart. Old approvals cannot survive.
    this.loop=this.poll(client,signal,this.dispatcher,generation);return;
  }
  async poll(client,signal,dispatcher,generation){
    let cursor='',failures=0;
    while(!signal.aborted){
      try {
        const batch=await client.getUpdates(cursor,signal);if(signal.aborted)break;
        cursor=batch.cursor;failures=0;this.status='connected';this.problem='';this.changed();
        for(const message of batch.messages){if(signal.aborted)break;this.incomingCount++;this.changed();await dispatcher.receive(message);}
        await pause(500,signal);
      }catch(error){
        if(signal.aborted)break;
        failures++;this.status='connecting';this.problem='WeChat is unavailable. Retrying; the task state is preserved locally.';this.changed();
        if(error.code==='session_expired'){this.problem='WeChat authorization expired. Pair WeChat again.';break;}
        if(failures>=5){this.problem='WeChat connection stopped after five failures. Check the network or pair again.';break;}
        await pause(Math.min(30000,1000*2**failures),signal);
      }
    }
    if(!signal.aborted&&generation===this.generation){
      this.controller.abort();dispatcher.stop();this.status='disconnecting';this.changed();await dispatcher.whenIdle();
      if(generation===this.generation){this.status='disconnected';this.changed();}
    }
  }
  async disconnect(){
    const generation=++this.generation,dispatcher=this.dispatcher;
    this.loginController?.abort();this.controller?.abort();dispatcher?.stop();
    this.status='disconnecting';this.qr=null;this.changed();
    await dispatcher?.whenIdle();
    if(generation===this.generation){this.status='disconnected';this.changed();}
  }
  async forget(){await this.disconnect();this.secret={};if(fs.existsSync(this.file))fs.unlinkSync(this.file);this.dispatcher=null;this.incomingCount=0;this.outgoingAccepted=0;this.changed();}
}
module.exports={BotService};
