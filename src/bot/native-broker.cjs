'use strict';
const http=require('node:http'),crypto=require('node:crypto');
const {clean}=require('./dispatcher.cjs');
const MAX_EVENTS=128,MAX_RECORDS=100,MAX_BODY=64000,TTL=300000;
const validText=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
class NativeBroker {
  constructor({send,onChange=()=>{},onClose=()=>{},now=Date.now}={}){
    Object.assign(this,{send,onChange,onClose,now});this.token=crypto.randomBytes(32).toString('hex');this.clientId='';
    this.closed=false;this.paused=false;this.seq=0;this.floor=0;this.ackSeq=0;this.events=[];this.records=new Map();this.seen=new Set();this.messages=[];
    this.pending=new Map();this.usedRequests=new Set();this.sendChain=Promise.resolve();this.sending=0;this.forwarded=0;this.replies=0;this.lastContext='';this.command='';this.createdAt=now();this.lastSeen=now();
  }
  snapshot(){return {tasks:[],messages:this.messages.map(x=>({...x})),pending:[...this.pending.values()].map(x=>({code:x.code,kind:'permission',tool:x.tool,expiresAt:x.expiresAt})),currentTaskId:null,queue:[]};}
  nativeSnapshot(){return {command:this.command,attached:!!this.clientId&&!this.closed,forwarded:this.forwarded,replies:this.replies,paused:this.paused,closed:this.closed};}
  change(){try{this.onChange();}catch{/* Presentation cannot approve or interrupt a channel. */}}
  message(role,text,deliveryFailed=false){const m={id:crypto.randomUUID(),role,text:clean(text),deliveryFailed};this.messages.push(m);this.messages=this.messages.slice(-60);this.change();return m;}
  deliver(text,context=this.lastContext,guard=()=>true){
    if(!context||this.closed||this.sending>=32)return Promise.resolve(false);
    this.sending++;const entry=this.message('assistant',text),body=entry.text;
    const next=this.sendChain.then(async()=>{
      if(this.closed||!guard()){entry.deliveryFailed=true;this.change();return false;}
      try{await this.send(body,context);return true;}catch{entry.deliveryFailed=true;this.change();return false;}
    }).finally(()=>{this.sending--;});this.sendChain=next.catch(()=>false);return next;
  }
  event(value){
    const e={...value,seq:++this.seq};this.events.push(e);
    while(this.events.length>MAX_EVENTS){this.floor=this.events.shift().seq;}
    if(this.waiter)this.flush();this.change();return e;
  }
  async receive({id,text,contextToken}={}){
    if(this.closed||!validText(id,180)||!validText(text,6000)||!validText(contextToken,8192))return;
    if(this.seen.has(id))return;if(this.seen.size>=10000){await this.deliver('本次连接达到消息上限，请断开后重新连接。',contextToken);return;}
    this.seen.add(id);this.lastContext=contextToken;this.message('user',text);this.expire();const body=text.trim();
    if(body.startsWith('/')){
      if(body==='/status'){
        const connection=this.paused?'消息转发已暂停。请先在电脑上停止旧会话，再到 Agent Arcade 断开重连。':this.clientId?'电脑端已连接，可以继续发消息。':'电脑端还没接上。请在 Agent Arcade 复制启动命令，到终端运行并完成确认。';
        await this.deliver(`${connection}${this.pending.size?`还有 ${this.pending.size} 条确认提示未在微信处理；若已在电脑上处理，可忽略。`:''}要确认任务进展，请查看电脑上的 Claude Code。`);return;
      }
      if(body==='/cancel'){
        this.paused=true;for(const p of [...this.pending.values()])this.resolve(p,'deny');
        this.events=this.events.filter(e=>e.type!=='message');
        await this.deliver('已暂停转发，并向待确认的操作发送拒绝。电脑上的 Claude Code 可能还在运行；要停止它，请在终端按 Ctrl+C。已经转交的消息无法撤回。');return;
      }
      const match=body.match(/^\/(allow|deny)\s+([a-f0-9]{32})$/i);
      if(match){const p=this.pending.get(match[2].toLowerCase());
        if(p&&!this.paused&&p.expiresAt>this.now()){
          const behavior=match[1].toLowerCase()==='allow'?'allow':'deny';this.resolve(p,behavior);
          await this.deliver(`已发送${behavior==='allow'?'批准':'拒绝'}。若你已在电脑上处理，这次回复可能不再生效。`);
        }else await this.deliver('确认码无效或已过期，这条回复没有批准操作。请在电脑上检查当前请求，并使用最新提示中的确认码。');return;
      }
      if(/^\/(?:allow|deny)\b/i.test(body)){
        await this.deliver('这条确认没有执行。请从权限提示复制以 /allow 或 /deny 开头的一整行，包含后面的32位确认码，单独发送。不要附带说明或另一条命令。');return;
      }
      await this.deliver('这条指令没有执行。可发送 /status 查看连接，或 /cancel 暂停转发。批准或拒绝操作时，请复制权限提示中对应的一整行；新建会话和停止 Claude Code 请在电脑终端操作。');return;
    }
    if(this.paused||!this.clientId){await this.deliver(this.paused?'消息转发已暂停。请先在电脑上停止旧会话，再到 Agent Arcade 断开重连。':'电脑端还没接上。请在 Agent Arcade 复制启动命令，到终端运行并完成确认，再发一次消息。');return;}
    if(this.seq-this.ackSeq>=100){await this.deliver('电脑端有太多消息尚未接收，这条没有转发。请检查 Claude Code 是否仍在运行，稍后再发一次。');return;}
    const opaque=crypto.randomUUID();this.records.set(opaque,{context:contextToken,replies:0});while(this.records.size>MAX_RECORDS)this.records.delete(this.records.keys().next().value);
    this.event({type:'message',id:opaque,text});
  }
  async reply({id,text}){
    const record=this.records.get(id);if(this.closed||!record||!validText(text,12000)||record.replies>=20)throw Error('invalid_reply');
    const accepted=await this.deliver(text,record.context);
    if(!accepted)throw Error('send_failed');record.replies++;this.replies++;this.change();return {accepted:true,read_confirmed:false};
  }
  async permission({request_id,tool_name,input,description=''}){
    if(this.closed)throw Error('channel_closed');
    if(!/^[a-km-z]{5}$/.test(request_id||'')||!validText(tool_name,100)||typeof input!=='string'||typeof description!=='string')throw Error('invalid_permission');
    if(this.usedRequests.has(request_id))throw Error('duplicate_permission');
    if(this.usedRequests.size>=2000)throw Error('permission_limit');this.usedRequests.add(request_id);
    if(!this.lastContext)return {code:null,relayed:false};
    const preview=`${tool_name}\n${description}\n${input}`;
    const refusal=this.paused?'消息转发已暂停':this.pending.size>=8?'待确认的操作太多':Buffer.byteLength(preview,'utf8')>3000?'这次操作的参数预览太长':clean(preview)!==preview||/\[REDACTED\]|unserializable|code points elided|\u2026|\u22ef/i.test(preview)?'参数预览含省略或敏感内容':'';
    if(refusal){
      this.event({type:'permission_reply',request_id,behavior:'deny'});await this.deliver(`${refusal}，无法在微信中确认，已向 Claude Code 发送拒绝。请在电脑上查看完整操作并处理。`);return {code:null,relayed:true};
    }
    const p={code:crypto.randomBytes(16).toString('hex'),request_id,tool:tool_name,expiresAt:this.now()+TTL};
    this.pending.set(p.code,p);this.change();
    await this.deliver(`Claude Code 请求你确认操作，批准可能影响本机项目以外的数据。下面是它提供的参数预览，不能保证是完整原参数：\n${preview}\n\n五分钟内有效，只能用一次。选择一种，只复制对应的一整行发送（含32位确认码）：\n批准：\n/allow ${p.code}\n拒绝：\n/deny ${p.code}\n若你已在电脑上处理，这次回复可能不再生效。`,this.lastContext,()=>this.pending.get(p.code)===p&&!this.paused&&p.expiresAt>this.now());
    return {code:p.code,relayed:true};
  }
  resolve(p,behavior){if(!this.pending.delete(p.code))return;this.event({type:'permission_reply',request_id:p.request_id,behavior});}
  expire(){for(const p of [...this.pending.values()])if(p.expiresAt<=this.now())this.resolve(p,'deny');}
  batch(after){
    if(after<this.floor||after>this.seq)throw Error('resync_required');let bytes=0;
    const values=[];for(const event of this.events){if(event.seq<=after)continue;const size=Buffer.byteLength(JSON.stringify(event));if(values.length>=100||bytes+size>110000)break;bytes+=size;values.push(event);}
    return values;
  }
  markForwarded(events){for(const e of events){const record=e.type==='message'&&this.records.get(e.id);if(record&&!record.forwarded){record.forwarded=true;this.forwarded++;}}this.change();}
  flush(){
    const w=this.waiter;if(!w)return;this.waiter=null;clearTimeout(w.timer);
    try{const events=this.batch(w.after);this.respond(w.res,200,{events,closed:this.closed});this.markForwarded(events);}
    catch{this.respond(w.res,409,{error:'resync_required'});}
  }
  respond(res,status,value){if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}}
  async body(req){
    let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BODY)throw Error('body_too_large');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('invalid_json');}
  }
  async request(req,res){
    const header=req.headers.authorization||'',expected=`Bearer ${this.token}`;
    if(this.closed||req.headers.origin||req.headers.host!==new URL(this.url).host||Buffer.byteLength(header)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(header),Buffer.from(expected))){this.respond(res,403,{error:'forbidden'});return;}
    const url=new URL(req.url,this.url);
    if(req.method==='POST'&&url.pathname==='/attached'){
      if(this.clientId){this.respond(res,409,{error:'already_attached'});return;}
      this.clientId=crypto.randomBytes(16).toString('hex');this.lastSeen=this.now();this.ackSeq=0;this.change();this.respond(res,200,{client_id:this.clientId});return;
    }
    if(!this.clientId||req.headers['x-arcade-client']!==this.clientId){this.respond(res,403,{error:'wrong_client'});return;}this.lastSeen=this.now();this.expire();
    if(req.method==='GET'&&url.pathname==='/events'){
      const raw=url.searchParams.get('after');if(!/^\d{1,12}$/.test(raw||'')){this.respond(res,400,{error:'invalid_cursor'});return;}
      const after=Number(raw);let events;try{events=this.batch(after);}catch{this.respond(res,409,{error:'resync_required'});return;}
      this.ackSeq=Math.max(this.ackSeq,after);
      if(this.waiter){this.respond(res,409,{error:'concurrent_poll'});return;}
      if(events.length){this.respond(res,200,{events,closed:false});this.markForwarded(events);return;}
      const waiter={res,after,timer:setTimeout(()=>this.flush(),20000)};this.waiter=waiter;
      res.on('close',()=>{if(this.waiter===waiter){clearTimeout(waiter.timer);this.waiter=null;}});return;
    }
    if(req.method!=='POST'){this.respond(res,404,{error:'not_found'});return;}
    try{
      const data=await this.body(req);let result;
      if(this.closed||req.headers['x-arcade-client']!==this.clientId){this.respond(res,403,{error:'channel_closed'});return;}
      if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_input');
      if(url.pathname==='/reply')result=await this.reply(data);
      else if(url.pathname==='/permission')result=await this.permission(data);
      else if(url.pathname==='/detached'){this.respond(res,200,{closed:true});void this.close();return;}
      else{this.respond(res,404,{error:'not_found'});return;}
      this.respond(res,200,result);
    }catch(error){const allowed=['resync_required','invalid_reply','send_failed','invalid_permission','duplicate_permission','permission_limit','body_too_large','invalid_json','invalid_input'];this.respond(res,error.message==='send_failed'?502:400,{error:allowed.includes(error.message)?error.message:'invalid_request'});}
  }
  async start(){
    this.server=http.createServer((req,res)=>{this.request(req,res).catch(()=>this.respond(res,500,{error:'request_failed'}));});
    this.server.headersTimeout=5000;this.server.requestTimeout=5000;this.server.keepAliveTimeout=1000;this.server.maxHeadersCount=30;this.server.maxConnections=8;
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
    this.url=`http://127.0.0.1:${this.server.address().port}`;
    this.timer=setInterval(()=>{this.expire();if(this.now()-(this.clientId?this.lastSeen:this.createdAt)>(this.clientId?90000:300000))void this.close();},1000);this.timer.unref();return this;
  }
  close(){
    if(this.closePromise)return this.closePromise;
    let done;this.closePromise=new Promise(resolve=>{done=resolve;});this.finishClose().then(done,done);return this.closePromise;
  }
  async finishClose(){
    for(const p of [...this.pending.values()])this.resolve(p,'deny');this.closed=true;this.command='';clearInterval(this.timer);this.flush();this.records.clear();this.pending.clear();this.change();try{this.onClose();}catch{/* No callback can keep a revoked broker open. */}
    if(this.server){this.server.closeIdleConnections();await new Promise(resolve=>{const timeout=setTimeout(()=>{this.server.closeAllConnections();resolve();},100);this.server.close(()=>{clearTimeout(timeout);resolve();});});}this.token='';
  }
  stop(){return this.close();}
  whenIdle(){return this.sendChain;}
}
module.exports={NativeBroker};
