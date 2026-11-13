'use strict';
// Original owner-only image preparation and single-use send controller.
// File paths enter only from a main-process picker, never a renderer request.
const path=require('node:path');
const {readSelectedMedia}=require('./qq-media-file.cjs');
const {randomUUID}=require('node:crypto');
const MAX_INPUT=8*1024*1024,MAX_OUTPUT=4*1024*1024,MAX_PIXELS=16*1024*1024,MAX_EDGE=8192,OUTPUT_EDGE=2048,PREVIEW_EDGE=480,MAX_PREVIEW=512*1024;
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CODES=new Set(['invalid_request','image_too_large','image_invalid','image_format','image_animated','unsafe_file','file_changed','file_unavailable','decoder_unavailable','media_unavailable','stale_ticket','expired_ticket','changed','disconnected','account_mismatch','account_changed','account_offline','status_unverified','bridge_unhealthy','cancelled','operation_in_progress','closed','send_unknown','media_failed']);
class QQMediaError extends Error{constructor(code){const fixed=CODES.has(code)?code:'media_failed';super(`QQ image operation failed (${fixed}).`);this.code=fixed;this.name=code==='cancelled'?'AbortError':'QQMediaError';}}
const fail=code=>{throw new QQMediaError(code);};
const safe=error=>CODES.has(error?.code)?error.code:error?.code==='aborted'?'cancelled':'media_failed';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const checkSignal=signal=>{if(signal?.aborted)fail('cancelled');};
function size(width,height){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)fail('image_too_large');return {width,height};}
function png(bytes,{canonical=false}={}){
  if(bytes.length<45||!bytes.subarray(0,8).equals(SIGNATURE))fail('image_invalid');
  let offset=8,dimensions,ended=false,data=false;const chunks=[];
  while(offset<bytes.length){
    if(offset+12>bytes.length)fail('image_invalid');const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)fail('image_invalid');
    const kind=bytes.toString('ascii',offset+4,offset+8);if(!/^[A-Za-z]{4}$/.test(kind))fail('image_invalid');
    if(offset===8){if(kind!=='IHDR'||length!==13)fail('image_invalid');dimensions=size(bytes.readUInt32BE(offset+8),bytes.readUInt32BE(offset+12));}
    else if(kind==='IHDR')fail('image_invalid');
    if(['acTL','fcTL','fdAT'].includes(kind))fail('image_animated');if(kind==='IDAT')data=true;
    if(kind==='IEND'){if(length!==0||end!==bytes.length||!data)fail('image_invalid');ended=true;}
    // Keep only pixel/essential palette and colour-transparency data in output.
    // Ancillary text, EXIF, timestamps and other original metadata are excluded.
    if(canonical&&['IHDR','PLTE','tRNS','IDAT','IEND'].includes(kind))chunks.push(bytes.subarray(offset,end));
    offset=end;
  }
  if(!ended)fail('image_invalid');return {...dimensions,...(canonical?{bytes:Buffer.concat([SIGNATURE,...chunks])}:{})};
}
function jpeg(bytes){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('image_invalid');
  let offset=2,dimensions;
  while(offset<bytes.length-2){
    if(bytes[offset++]!==255)fail('image_invalid');while(bytes[offset]===255)offset++;const marker=bytes[offset++];
    if(marker===218){if(!dimensions)fail('image_invalid');return dimensions;}
    if([0,1,216,217].includes(marker)||(marker>=208&&marker<=215)||offset+2>bytes.length)fail('image_invalid');
    const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)fail('image_invalid');
    if(marker>=192&&marker<=207&&![196,200,204].includes(marker)){
      if(![192,193,194].includes(marker)||dimensions||length<8||bytes[offset+2]!==8)fail('image_format');dimensions=size(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3));
    }
    offset+=length;
  }
  fail('image_invalid');
}
function dimensions(bytes,extension){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_INPUT)fail('image_too_large');
  if(extension==='.png')return png(bytes);
  if(['.jpg','.jpeg'].includes(extension))return jpeg(bytes);fail('image_format');
}
function validateImagePayload(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>MAX_OUTPUT)fail('image_too_large');const image=png(bytes,{canonical:true});
  if(image.width>OUTPUT_EDGE||image.height>OUTPUT_EDGE||!image.bytes.equals(bytes))fail('image_invalid');return {width:image.width,height:image.height};
}
async function readSelected(file,signal){
  try{return await readSelectedMedia(file,{signal,extensions:['.png','.jpg','.jpeg'],maxBytes:MAX_INPUT});}
  catch(error){throw new QQMediaError(({media_format:'image_format',media_too_large:'image_too_large'})[error?.code]||error?.code);}
}
function canonicalImage(bytes,extension,nativeImage){
  const declared=dimensions(bytes,extension);if(typeof nativeImage?.createFromBuffer!=='function')fail('decoder_unavailable');
  let image;try{image=nativeImage.createFromBuffer(bytes);}catch{fail('image_invalid');}
  if(!image||image.isEmpty())fail('image_invalid');const actual=image.getSize();size(actual.width,actual.height);if(actual.width!==declared.width||actual.height!==declared.height)fail('image_invalid');
  const fit=(item,max)=>{const value=item.getSize(),ratio=Math.min(1,max/value.width,max/value.height);return ratio<1?item.resize({width:Math.max(1,Math.round(value.width*ratio)),height:Math.max(1,Math.round(value.height*ratio)),quality:'good'}):item;};
  image=fit(image,OUTPUT_EDGE);let output,preview;
  try{output=png(image.toPNG(),{canonical:true});preview=png(fit(image,PREVIEW_EDGE).toPNG(),{canonical:true});}catch(error){if(error instanceof QQMediaError)throw error;fail('image_invalid');}
  if(output.bytes.length>MAX_OUTPUT||preview.bytes.length>MAX_PREVIEW)fail('image_too_large');return {bytes:output.bytes,width:output.width,height:output.height,preview:`data:image/png;base64,${preview.bytes.toString('base64')}`};
}
function binding(value){
  if(!value||value.status!=='connected'||value.channel!=='qq'||!Number.isSafeInteger(value.generation)||value.generation<0||!value.client)fail('disconnected');
  if(typeof value.scopeId!=='string'||!value.scopeId||value.scopeId.length>256||/[\p{Cc}\p{Cf}]/u.test(value.scopeId))fail('invalid_request');
  const qq=id=>typeof id==='string'&&/^[1-9]\d{4,14}$/.test(id)&&Number.isSafeInteger(Number(id));
  if(!qq(value.accountId)||!qq(value.ownerId)||value.accountId===value.ownerId||value.client.ownerId!==value.ownerId||value.client.accountId!==value.accountId)fail('account_mismatch');
  if(!value.client.ready||value.client.closed||value.client.socket?.readyState!==1)fail('disconnected');
  return {client:value.client,clientGeneration:value.client.generation,generation:value.generation,scopeId:value.scopeId,accountId:value.accountId,ownerId:value.ownerId,role:typeof value.role==='string'?value.role.replace(/[\p{Cc}\p{Cf}]/gu,'').slice(0,64):''};
}
function equalBinding(a,b){return a.client===b.client&&a.clientGeneration===b.clientGeneration&&a.generation===b.generation&&a.scopeId===b.scopeId&&a.accountId===b.accountId&&a.ownerId===b.ownerId&&a.role===b.role;}
function request(value){if(!plain(value)||Object.keys(value).length!==1||typeof value.ticketId!=='string'||!/^[a-f0-9-]{36}$/.test(value.ticketId))fail('invalid_request');return value.ticketId;}
class QQOwnerImage {
  constructor({nativeImage,getBinding,now=Date.now,onChange=()=>{}}={}){if(typeof getBinding!=='function'||typeof now!=='function'||typeof onChange!=='function')fail('invalid_request');this.nativeImage=nativeImage;this.getBinding=getBinding;this.now=now;this.onChange=onChange;this.ticket=null;this.operation=null;this.closed=false;this.last=null;}
  _notify(){try{this.onChange();}catch{}}
  _current(expected,signal){checkSignal(signal);if(this.closed)fail('closed');const current=binding(this.getBinding());if(expected&&!equalBinding(current,expected))fail('changed');return current;}
  _clear(){this.ticket?.bytes.fill(0);this.ticket=null;}
  snapshot(){if(this.ticket){try{this._current(this.ticket.binding);if(this.now()>=this.ticket.expiresAt)this._clear();}catch{this._clear();}}if(this.last){try{this._current(this.lastBinding);}catch{this.last=null;this.lastBinding=null;}}return {busy:!!this.operation,draft:this.ticket?this._public(this.ticket,{preview:false}):null,last:this.last?{...this.last}:null};}
  _public(ticket,{preview=true}={}){return {ticketId:ticket.id,kind:'image',width:ticket.width,height:ticket.height,bytes:ticket.bytes.length,expiresAt:ticket.expiresAt,...(preview?{preview:ticket.preview}:{}),recipient:{accountId:ticket.binding.accountId,ownerId:ticket.binding.ownerId,role:ticket.binding.role}};}
  async select(file,{signal}={}){
    if(this.operation)fail('operation_in_progress');const current=this._current(null,signal);this._clear();this.last=null;
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;
    op.promise=Promise.resolve().then(async()=>{let raw;try{raw=await readSelected(file,combined);this._current(current,combined);const image=canonicalImage(raw,path.extname(file).toLowerCase(),this.nativeImage);this._current(current,combined);this.ticket={...image,id:randomUUID(),binding:current,expiresAt:this.now()+5*60*1000};return this._public(this.ticket);}catch(error){throw new QQMediaError(safe(error));}finally{raw?.fill(0);if(this.operation===op)this.operation=null;this._notify();}});this._notify();return op.promise;
  }
  async send(value,{signal}={}){
    const id=request(value);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id)fail('stale_ticket');
    const ticket=this.ticket;this.ticket=null;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,op={controller,promise:null};this.operation=op;this.last=null;
    op.promise=Promise.resolve().then(async()=>{
      let submitted=false;
      try{
        if(this.now()>=ticket.expiresAt)fail('expired_ticket');this._current(ticket.binding,combined);const {client}=ticket.binding;
        if(typeof client.sendOwnerImage!=='function')fail('disconnected');
        submitted=true;const receipt=await client.sendOwnerImage(ticket.binding.ownerId,ticket.bytes,id,combined,{assertCurrent:()=>this._current(ticket.binding,combined)});
        if(!receipt||!['accepted','not_sent','unknown'].includes(receipt.outcome))fail('send_unknown');
        const messageId=typeof receipt.messageId==='string'&&/^-?\d{1,20}$/.test(receipt.messageId)?receipt.messageId:null;
        if(receipt.outcome==='accepted'&&!messageId)fail('send_unknown');
        // A matching accepted receipt stays accepted if the UI/account changes
        // later. It does not establish recipient display/read/delivery.
        const result={ticketId:id,outcome:receipt.outcome,...(receipt.outcome==='accepted'?{messageId}:{code:receipt.outcome==='unknown'?'send_unknown':safe(receipt)}),kind:'image'};try{this._current(ticket.binding);this.last=result;this.lastBinding=ticket.binding;}catch{}return result;
      }catch(error){const result={ticketId:id,outcome:submitted?'unknown':'not_sent',code:submitted?'send_unknown':safe(error),kind:'image'};try{this._current(ticket.binding);this.last=result;this.lastBinding=ticket.binding;}catch{}return result;}
      finally{ticket.bytes.fill(0);if(this.operation===op)this.operation=null;this._notify();}
    });this._notify();return op.promise;
  }
  discard(value){const id=request(value);if(this.operation)fail('operation_in_progress');if(!this.ticket||this.ticket.id!==id)fail('stale_ticket');this._clear();this._notify();return {discarded:true};}
  async close(){this.closed=true;this._clear();const op=this.operation;if(op){op.controller.abort();await op.promise.catch(()=>{});}this._notify();return {closed:true};}
}
module.exports={QQOwnerImage,QQMediaError,canonicalImage,dimensions,readSelected,validateImagePayload};
