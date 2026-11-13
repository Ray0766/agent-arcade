'use strict';
const {randomUUID}=require('node:crypto');
const {validateImagePayload}=require('./qq-media.cjs');
const MAX_PREVIEW=512*1024,PREVIEW_EDGE=480;
const CODES=new Set(['unavailable','changed','busy','invalid_text','invalid_request','duplicate','prepare_failed','reply_failed','cancelled','unsupported','credentials_missing','credentials_locked','credentials_busy','storage_unavailable','stopping','start_failed','stop_failed','image_too_large','invalid_image','image_read_failed','image_unsupported','stale_attachment','scope_limit']);
const fail=code=>Object.assign(Error(`Desktop conversation unavailable (${CODES.has(code)?code:'reply_failed'}).`),{code:CODES.has(code)?code:'reply_failed'});
const id=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value);
const fields=['accountId','service','dispatcher','scope','character','settings','generation','client','clientGeneration','socket','owner','self','kind','imageSupported'];
const same=(a,b)=>!!a&&!!b&&fields.every(key=>a[key]===b[key]);
const valid=(value,keys)=>value&&Object.prototype.toString.call(value)==='[object Object]'&&Object.keys(value).every(key=>keys.includes(key));

// Why an App reply failed, as one of six classes. The runners in this folder end a failed
// turn with {outcome,text} where text is one of their own fixed English sentences; that
// sentence is matched here and never leaves the main process. Provider text, status
// bodies and keys are not part of it.
//   auth     the provider rejected the key, or the key may not use the model
//   quota    rate limit or insufficient balance
//   network  the request did not get an HTTP answer, or the service answered with an unlisted status
//   refused  the provider declined to answer
//   limit    the runner ended the turn with outcome 'limit' (token, size, step or time limit)
//   other    everything else, including sentences this table does not know
const path=require('node:path');
const FAILURES=new Set(['auth','quota','network','refused','limit','other']);
const FAILURE_SENTENCES=[
  ['auth',/ rejected the API key\.$/],
  ['auth',/ access was denied\. Check the key, model access and supported region\.$/],
  ['auth',/^This OpenAI account is not allowed to use this model\.$/],
  ['auth',/ model is unavailable (?:for this|to the) account\.$/],
  ['quota',/ account credit is insufficient\.$/],
  ['quota',/ rate limit reached\. Try again later\.$/],
  ['quota',/ rate or credit limit reached\. Check the provider console before trying again\.$/],
  ['quota',/^OpenAI quota or rate limit reached\. Check billing and retry later\.$/],
  ['network',/^Could not reach Anthropic\. Check your connection\.$/],
  ['network',/ could not complete this request\. Check its service and your connection\.$/],
  // The fetch-based runners reach this sentence only when the request threw before any HTTP status was read.
  ['network',/^(?:DeepSeek|OpenAI|Gemini|Doubao) could not finish\. Check the API key, /],
  ['refused',/^Claude declined to answer this message\.$/],
  ['refused',/^Doubao declined this request\. /],
  ['refused',/^Gemini blocked this request\. /],
  ['refused',/^OpenAI returned both a refusal and tool calls\. /],
];
function classifyFailure(result){
  if(!result||typeof result!=='object')return 'other';
  if(result.outcome==='limit')return 'limit';
  const text=typeof result.text==='string'?result.text.slice(0,400):'';
  for(const [failure,sentence] of FAILURE_SENTENCES)if(sentence.test(text))return failure;
  return 'other';
}
// The App conversation's runner is created by the profile's service with
// {conversationOnly:true, configDir:<profile root>/local-companion/agent}. Only that runner
// is observed; every other runner the service creates is returned untouched.
const lastFailure=new Map(),observedServices=new WeakSet();
const profileKey=root=>typeof root==='string'&&root?path.resolve(root).toLowerCase():'';
const localProfile=options=>{
  const dir=options?.conversationOnly===true&&typeof options.configDir==='string'?path.resolve(options.configDir):'';
  return dir&&path.basename(dir)==='agent'&&path.basename(path.dirname(dir))==='local-companion'?profileKey(path.dirname(path.dirname(dir))):'';
};
function observeLocalRunner(factory){
  return function observedRunnerFactory(options,...rest){
    const execute=factory.call(this,options,...rest),key=localProfile(options);
    if(!key||typeof execute!=='function')return execute;
    return new Proxy(execute,{apply(target,self,args){
      const run=Reflect.apply(target,self,args);
      Promise.resolve(run).then(result=>{if(result?.outcome==='reply_ended')lastFailure.delete(key);else if(result?.outcome!=='cancelled')lastFailure.set(key,classifyFailure(result));},()=>{lastFailure.set(key,'other');});
      return run;
    }});
  };
}
const RUNNER_FACTORIES=['runnerFactory','claudeProgramRunnerFactory','deepseekRunnerFactory','gptRunnerFactory','geminiRunnerFactory','doubaoRunnerFactory'];
function observeLocalRunners(service){
  if(!service||typeof service!=='object'||observedServices.has(service))return;
  observedServices.add(service);
  for(const name of RUNNER_FACTORIES)if(typeof service[name]==='function')service[name]=observeLocalRunner(service[name]);
}
const failureOf=service=>lastFailure.get(profileKey(service?.root))||'other';

// Owns a foreground local text turn, never a messaging destination or provider.
class DesktopChat {
  #image=null;
  #reply=null;
  constructor({getContext,prepare=async()=>{},onChange=()=>{},chooseImage=null,onReply=()=>{}}={}){
    if(typeof getContext!=='function'||typeof prepare!=='function'||typeof onChange!=='function'||typeof onReply!=='function'||chooseImage!==null&&typeof chooseImage!=='function')throw fail('invalid_request');
    Object.assign(this,{getContext,prepare,onChange,chooseImage,onReply});this.context=null;this.contextId=null;this.session=null;
  }
  observe(){
    let next;try{next=this.getContext();}catch{next=null;}
    if(!same(this.context,next)){
      this.closeCurrent();this.context=next;this.contextId=next?randomUUID():null;
    }
    return this.context;
  }
  _imageSupported(context=this.context){return context?.kind==='local'&&context.imageSupported===true&&typeof this.chooseImage==='function';}
  snapshot(){this.observe();return {available:!!this.context,contextId:this.contextId,imageSupported:this._imageSupported()};}
  open(value){
    this.observe();
    if(!valid(value,['accountId','contextId','panelId'])||!id(value.panelId))throw fail('invalid_request');
    if(!this.context)throw fail('unavailable');
    if(value.accountId!==this.context.accountId||value.contextId!==this.contextId)throw fail('changed');
    this.closeCurrent();const s={id:randomUUID(),panelId:value.panelId,context:this.context,contextId:this.contextId,seen:new Set(),active:null};this.session=s;
    return {sessionId:s.id,contextId:s.contextId};
  }
  _session(value){
    this.observe();const s=this.session;
    if(!s||value?.sessionId!==s.id||value?.contextId!==s.contextId||!same(s.context,this.context))throw fail('changed');
    return s;
  }
  _dropImage(session){if(this.#image?.session===session){this.#image.bytes.fill(0);this.#image=null;}}
  claimReplyNotice(event){
    this.observe();const receipt=this.#reply,context=receipt?.session?receipt.session.context:receipt?.context;
    if(!receipt||receipt.claimed||receipt.event!==event||this.session!==receipt.session||!same(context,this.context)||receipt.session?.active&&receipt.session.active!==receipt.operation)return false;
    receipt.claimed=true;return true;
  }
  // A companion-initiated message (owner-enabled source notice) was stored in
  // the current local conversation. Mints the same content-free receipt as a
  // finished turn so the existing reply notice applies; never during a turn.
  localNotice(service){
    this.observe();const context=this.context,s=this.session;
    if(!context||context.kind!=='local'||!service||context.service!==service||s?.active)return false;
    const event=Object.freeze({id:randomUUID(),accountId:context.accountId,character:context.character,sourceKind:'local',contextId:this.contextId,completedAt:Date.now()});
    this.#reply={event,session:s,context,operation:null};
    try{const notified=this.onReply(event);notified?.catch?.(()=>{});}catch{/* Notification failure cannot change a stored message. */}
    return true;
  }
  async selectImage(value){
    if(!valid(value,['sessionId','contextId']))throw fail('invalid_request');
    const s=this._session(value);if(!this._imageSupported(s.context))throw fail('image_unsupported');
    if(s.active||s.picking)throw fail('busy');
    const controller=new AbortController();s.picking=controller;this.onChange();let selected;
    const check=()=>{if(controller.signal.aborted)throw fail('cancelled');if(this._session(value)!==s)throw fail('changed');};
    try{
      selected=await this.chooseImage({signal:controller.signal});check();
      if(selected===null)return {cancelled:true};
      if(!selected||!Buffer.isBuffer(selected.bytes))throw fail('invalid_image');
      let dimensions;
      try{dimensions=validateImagePayload(selected.bytes);}catch(error){throw fail(error?.code==='image_too_large'?'image_too_large':'invalid_image');}
      if(selected.width!==dimensions.width||selected.height!==dimensions.height||typeof selected.preview!=='string'||selected.preview.length>Math.ceil(MAX_PREVIEW/3)*4+22||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(selected.preview))throw fail('invalid_image');
      const preview=Buffer.from(selected.preview.slice(22),'base64');
      try{const size=validateImagePayload(preview);if(preview.length>MAX_PREVIEW||size.width>PREVIEW_EDGE||size.height>PREVIEW_EDGE)throw fail('invalid_image');}catch{throw fail('invalid_image');}finally{preview.fill(0);}
      check();this._dropImage(s);
      const attachmentId=randomUUID();this.#image={session:s,id:attachmentId,bytes:selected.bytes};
      const result={attachmentId,preview:selected.preview,width:selected.width,height:selected.height,bytes:selected.bytes.length};selected=null;return result;
    }catch(error){throw fail(error?.code);}
    finally{if(Buffer.isBuffer(selected?.bytes))selected.bytes.fill(0);if(s.picking===controller)s.picking=null;controller.abort();this.onChange();}
  }
  removeImage(value){
    if(!valid(value,['sessionId','contextId','attachmentId'])||!id(value.attachmentId))throw fail('invalid_request');
    const s=this._session(value);if(s.active||s.picking)throw fail('busy');
    if(this.#image?.session!==s||this.#image.id!==value.attachmentId)throw fail('stale_attachment');
    this._dropImage(s);return {removed:true};
  }
  async send(value){
    if(!valid(value,['sessionId','contextId','requestId','text','attachmentId'])||!id(value.requestId)||Object.hasOwn(value,'attachmentId')&&!id(value.attachmentId))throw fail('invalid_request');
    const s=this._session(value);
    if(typeof value.text!=='string'||!value.text.trim()||value.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.text))throw fail('invalid_text');
    if(s.active||s.picking)throw fail('busy');if(s.seen.has(value.requestId)||s.seen.size>=1000)throw fail('duplicate');
    let image;
    if(value.attachmentId){
      if(!this._imageSupported(s.context))throw fail('image_unsupported');
      if(this.#image?.session!==s||this.#image.id!==value.attachmentId)throw fail('stale_attachment');
      image=this.#image;this.#image=null;
    }
    const op={requestId:value.requestId,controller:new AbortController(),started:false};this.#reply=null;s.active=op;s.seen.add(value.requestId);this.onChange();
    const release=()=>{image?.bytes.fill(0);};op.controller.signal.addEventListener('abort',release,{once:true});
    const check=()=>{
      if(op.controller.signal.aborted)throw fail('cancelled');
      if(this._session(value)!==s)throw fail('changed');
    };
    try{
      check();
      try{await this.prepare(s.context,op.controller.signal);}catch{check();throw fail('prepare_failed');}
      check();op.started=true;
      if(s.context.kind==='local')lastFailure.delete(profileKey(s.context.service?.root));
      const result=await (s.context.kind==='local'?s.context.service.localReply(value.text,{signal:op.controller.signal,...(image?{image:{mimeType:'image/png',bytes:image.bytes}}:{})}):s.context.service.socialReply(value.text,{signal:op.controller.signal}));
      check();
      if(result?.outcome==='cancelled')return {outcome:'cancelled',started:true};
      if(result?.outcome!=='reply_ended')throw Object.assign(fail('reply_failed'),s.context.kind==='local'?{failure:failureOf(s.context.service)}:{});
      if(s.context.kind==='local'){
        // Only a successful current main-owned turn can mint this receipt. No
        // request text, model output, renderer nonce or pixels enter the event.
        const event=Object.freeze({id:randomUUID(),accountId:s.context.accountId,character:s.context.character,sourceKind:'local',contextId:s.contextId,completedAt:Date.now()});
        this.#reply={event,session:s,operation:op};
        try{const notified=this.onReply(event);notified?.catch?.(()=>{});}catch{/* Notification failure cannot change an already completed reply. */}
      }
      return {outcome:'reply_ended',started:true};
    }catch(error){
      if(op.controller.signal.aborted||error?.code==='cancelled'||error?.code==='changed')return {outcome:'cancelled',started:op.started};
      const failed=fail(error?.code==='unsupported_model'?'image_unsupported':error?.code==='too_large'?'image_too_large':error?.code);
      if(failed.code==='reply_failed'&&FAILURES.has(error?.failure))failed.failure=error.failure;
      throw failed;
    }finally{
      if(s.active===op)s.active=null;op.controller.abort();release();image=null;this.onChange();
    }
  }
  cancel(value){
    if(!valid(value,['sessionId','contextId','requestId']))throw fail('invalid_request');
    const s=this.session;
    // An old Stop is harmless to a new panel or a later QQ/local turn.
    if(s?.id!==value.sessionId||s.contextId!==value.contextId||s.active?.requestId!==value.requestId)return {cancelled:false};
    s.active.controller.abort();return {cancelled:true};
  }
  close(value){
    if(!valid(value,['sessionId','contextId']))throw fail('invalid_request');
    if(this.session?.id===value.sessionId&&this.session.contextId===value.contextId)this.closeCurrent();
    return {closed:true};
  }
  closeCurrent(){const previous=this.session;this.session=null;this.#reply=null;previous?.active?.controller.abort();previous?.picking?.abort();this._dropImage(previous);previous?.seen.clear();}
  // A different foreground intent invalidates renderer admission even when
  // the account itself is unchanged. Ordinary observations/open do not.
  retire(){const observable=!!this.context||!!this.session;this.closeCurrent();if(this.context)this.contextId=randomUUID();if(observable)this.onChange();}
}
async function desktopChatResult(operation){try{return {ok:true,...await operation()};}catch(error){return {ok:false,code:CODES.has(error?.code)?error.code:'reply_failed',...(FAILURES.has(error?.failure)?{failure:error.failure}:{})};}}
module.exports={DesktopChat,desktopChatResult,classifyFailure,observeLocalRunner,observeLocalRunners};
