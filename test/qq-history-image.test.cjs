'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),{deflateSync}=require('node:zlib');
const {WebSocketServer,WebSocket}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs');
const {QQOwnerHistorySession}=require('../src/bot/qq-owner-history-session.cjs');
const {HistoryImageTransport,capture,extract,historyImageResult}=require('../src/bot/qq-history-image.cjs');
const {imageSource}=require('../src/bot/qq-image-source.cjs');
const SELF='100001',OWNER='200001',PANEL=randomUUID(),URL_A='https://multimedia.nt.qq.com.cn/download?appid=1406&fileid=resource-A&rkey=synthetic-A';
function crc(b){let c=0xffffffff;for(const x of b){c^=x;for(let n=0;n<8;n++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(k,b){const out=Buffer.alloc(b.length+12);out.writeUInt32BE(b.length);out.write(k,4);b.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,8+b.length)),8+b.length);return out;}
function png(){const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,255,0,100,255]))),chunk('IEND',Buffer.alloc(0))]);}
const PIXEL=png();
const picture=(sender=SELF,extra={})=>({self_id:SELF,user_id:sender,sender:{user_id:sender},message_type:'private',sub_type:'friend',message_id:123,real_seq:'100',time:1700000000,message:[{type:'image',data:{file:'same-name.png',file_size:PIXEL.length,sub_type:0,summary:'[图片]',url:URL_A}}],...extra});
const wait=()=>new Promise(r=>setImmediate(r));
async function until(f){for(let n=0;n<2000;n++){if(f())return;await wait();}throw Error('Bounded fixture wait did not reach state');}
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={requests:[],downloads:[],decoded:[],released:0,now:1,account:SELF,owner:OWNER,online:true,row:picture(),history:null,verify:async()=>({verified:true}),prepares:0};
 server.on('connection',socket=>socket.on('message',async b=>{try{const q=JSON.parse(b);state.requests.push(q);let data;
  if(q.action==='get_login_info')data={user_id:state.account};else if(q.action==='get_status')data={online:state.online,good:true};else if(q.action==='get_friend_list')data=[{user_id:state.owner}];else if(q.action==='get_friend_msg_history'){data=state.history?await state.history(q):{messages:[structuredClone(state.row)]};}else throw Error('Unexpected network action '+q.action);
  if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:q.echo,data}));
 }catch(e){state.serverError=e;socket.close();}}));
 const stable={profileId:'synthetic',profile:{},generation:1,characterId:'whale',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'rev',endpointId:'endpoint',qqAccountId:SELF,ownerId:OWNER,url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-private-token',channel:'qq',status:'disconnected'};
 const clients=[],transport=new HistoryImageTransport({createDownloader:()=>({download:async(url,options)=>{assert.equal(url,URL_A.replace('rkey=synthetic-A','rkey='+new URL(url).searchParams.get('rkey')));options.assertCurrent();const bytes=Buffer.from(PIXEL);state.downloads.push(bytes);await state.download?.(options);return {bytes,extension:'.png',resourceDigest:imageSource(url).resourceDigest};},close(){state.released++;}}),prepare:async bytes=>{state.prepares++;const prepared=Buffer.from(bytes);state.decoded.push(prepared);await state.prepare?.();return {bytes:prepared,width:1,height:1};}});
 const manager=new QQOwnerHistorySession({capture:v=>({...stable,panelId:v.panelId}),verifyContext:(_b,o)=>state.verify(o),clientFactory:options=>{const c=new QQClient({...options,timeoutMs:1000,socketFactory:(url,options)=>new WebSocket(url,options)});clients.push(c);return c;},imageTransport:transport,monotonic:()=>state.now});
 const input={accountId:'synthetic',panelId:PANEL};
 t.after(async()=>{state.release?.();await manager.close();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));assert(!state.serverError,state.serverError?.message);});
 const read=async(cursor=null)=>manager.read({...input,cursor}),selection=p=>({...input,pageId:p.page.pageId,imageId:p.page.rows.find(r=>r.parts.some(p=>p.imageId)).parts.find(p=>p.imageId).imageId,requestId:randomUUID()});
 return {state,stable,manager,clients,input,read,selection};
}
test('owner history offers opaque one-image handles without media I/O, and explicit outgoing preview fixes the owner peer',async t=>{
 const f=await fixture(t),p=await f.read(),args=f.selection(p);assert.equal(f.state.downloads.length,0);assert.equal(f.state.prepares,0);assert.doesNotMatch(JSON.stringify(p),/https:|same-name|resource-A|synthetic-private|real_seq/);assert.equal(p.page.mediaLoaded,false);
 const r=await f.manager.imagePreview(args);assert.equal(r.qqAccountId,SELF);assert.equal(r.ownerId,OWNER);assert.equal(r.requestId,args.requestId);assert.equal(r.preview.dataUrl,'data:image/png;base64,'+PIXEL.toString('base64'));assert.equal(r.preview.bytes,PIXEL.length);assert.equal(f.clients[0].receiveOwnerMessages,false);
 const mediaQueries=f.state.requests.filter(q=>q.action==='get_friend_msg_history'&&q.params.disable_get_url===false);assert.equal(mediaQueries.length,2);for(const q of mediaQueries)assert.deepEqual(q.params,{user_id:OWNER,count:20,message_seq:'123',reverse_order:true,reverseOrder:true,disable_get_url:false,parse_mult_msg:false,quick_reply:false});assert(f.state.requests.every(q=>['get_login_info','get_status','get_friend_list','get_friend_msg_history'].includes(q.action)));assert(f.state.downloads[0].every(v=>v===0));assert(f.state.decoded[0].every(v=>v===0));
 await assert.rejects(f.manager.imagePreview(args),{code:'invalid_request'});
});
test('incoming and outgoing exact rows are supported; mismatched identity/sequence/segments never resolve a resource',()=>{
 for(const sender of [SELF,OWNER]){const r=picture(sender),d=capture(r,{accountId:SELF,ownerId:OWNER});assert.equal(extract({messages:[r]},d,{accountId:SELF,ownerId:OWNER}).resourceDigest,imageSource(URL_A).resourceDigest);
  for(const patch of [{self_id:'300001'},{user_id:'300001'},{sender:{user_id:'300001'}},{message_type:'group'},{sub_type:'group'},{group_id:99},{message_id:124},{real_seq:'101'},{time:r.time+1},{message:[{type:'text',data:{text:'changed'}},...r.message]}])assert.throws(()=>extract({messages:[{...r,...patch}]},d,{accountId:SELF,ownerId:OWNER}),{code:'image_changed'});
  assert.throws(()=>extract({messages:[r,r]},d,{accountId:SELF,ownerId:OWNER}),{code:'image_changed'});
 }
 for(const row of [picture(SELF,{message_id:0}),picture(SELF,{real_seq:null}),picture(SELF,{message:[...picture().message,...picture().message]}),picture(SELF,{message:'[CQ:image,file=same-name.png]'})])assert.throws(()=>capture(row,{accountId:SELF,ownerId:OWNER}));
});
test('unsupported multiple/animated-format metadata stays a placeholder without broadening initial history',async t=>{
 const f=await fixture(t);f.state.row.message.push({type:'image',data:{...f.state.row.message[0].data}});const p=await f.read();assert(p.page.rows[0].parts.every(part=>!part.imageId));assert.equal(f.state.downloads.length,0);
});
test('same filename but changed CDN resource on second owner observation rejects and destroys downloaded bytes',async t=>{
 const f=await fixture(t),p=await f.read();let n=0;f.state.history=q=>{const row=structuredClone(f.state.row);if(++n===2)row.message[0].data.url=URL_A.replace('resource-A','resource-B');return {messages:[row]};};await assert.rejects(f.manager.imagePreview(f.selection(p)),{code:'image_changed'});assert.equal(f.state.prepares,0);assert(f.state.downloads[0].every(v=>v===0));assert.equal(f.state.released,1);
});
test('short-lived URL signature changes retain the exact resource while account/friend changes reject before pixels',async t=>{
 const f=await fixture(t),p=await f.read();let n=0;f.state.history=()=>{const row=structuredClone(f.state.row);row.message[0].data.url=URL_A.replace('synthetic-A','signature-'+(++n));return {messages:[row]};};assert((await f.manager.imagePreview(f.selection(p))).preview);
 for(const change of ['account','online','owner']){const g=await fixture(t),page=await g.read();g.state.download=()=>{if(change==='account')g.state.account='300001';else if(change==='owner')g.state.owner='300001';else g.state.online=false;};await assert.rejects(g.manager.imagePreview(g.selection(page)));assert(g.state.downloads[0].every(v=>v===0));assert.equal(g.state.prepares,0);}
});
test('refresh, cached page selection, expiry and renderer-injected URLs cannot authorize an image read',async t=>{
 const f=await fixture(t),first=await f.read(),args=f.selection(first);await assert.rejects(f.manager.imagePreview({...args,url:URL_A}),{code:'invalid_request'});
 const second=await f.read();await assert.rejects(f.manager.imagePreview(args),{code:'changed'});assert.throws(()=>f.manager.imagePage({...f.input,pageId:first.page.pageId}),{code:'changed'});
 f.state.now+=300000;await assert.rejects(f.manager.imagePreview(f.selection(second)),{code:'image_expired'});assert.equal(f.state.downloads.length,0);
});
test('switching cached pages revokes an active selection; selecting A again does not revive the prior request',async t=>{
 const f=await fixture(t),first=await f.read();f.state.row=picture(OWNER,{message_id:122,real_seq:'99'});const second=await f.read(first.page.nextCursor);f.manager.imagePage({...f.input,pageId:first.page.pageId});let release;f.state.verify=()=>new Promise(r=>{release=r;f.state.release=()=>r({verified:true});});
 const args=f.selection(first),pending=f.manager.imagePreview(args);await until(()=>release);f.manager.imagePage({...f.input,pageId:second.page.pageId});f.manager.imagePage({...f.input,pageId:first.page.pageId});release({verified:true});await assert.rejects(pending);assert.equal(f.state.downloads.length,0);
});
test('cancel before preflight completion prevents network and the following preview waits for old preparation to finish',async t=>{
 const f=await fixture(t),p=await f.read(),a=f.selection(p);let release;f.state.prepare=()=>new Promise(r=>{release=r;f.state.release=r;});const first=f.manager.imagePreview(a);await until(()=>release);const closed=f.manager.imageClose({...f.input,pageId:a.pageId,requestId:a.requestId});
 const before=f.state.requests.length,b=f.selection(p),second=f.manager.imagePreview(b);await wait();assert.equal(f.state.requests.length,before,'Second preflight waits for owned old decode/cleanup');assert.equal(f.state.downloads.length,1);
 const lateOldClose=f.manager.imageClose({...f.input,pageId:a.pageId,requestId:a.requestId});await lateOldClose;f.state.prepare=null;release();await assert.rejects(first);await closed;assert((await second).preview);assert(f.state.decoded.every(bytes=>bytes.every(v=>v===0)));
});
test('closing during second observation waits for cleanup and cannot expose late image pixels',async t=>{
 const f=await fixture(t),p=await f.read();let release,queries=0;f.state.history=()=>++queries===2?new Promise(r=>{release=()=>r({messages:[structuredClone(f.state.row)]});f.state.release=release;}):{messages:[structuredClone(f.state.row)]};
 const pending=f.manager.imagePreview(f.selection(p));await until(()=>release);const closing=f.manager.closeOwned(f.input);release();await assert.rejects(pending);await closing;assert(f.state.downloads[0].every(v=>v===0));assert.equal(f.state.prepares,0);assert.equal(f.clients[0].closed,true);
});
test('scope changes after download and decode errors remain sanitized and release all owned buffers',async t=>{
 for(const kind of ['changed','decoder']){const f=await fixture(t),p=await f.read();f.state.prepare=()=>{if(kind==='changed')f.stable.generation++;else throw Object.assign(Error('PRIVATE_DECODER_PATH'),{code:'image_invalid'});};const r=await historyImageResult(f.selection(p),()=>f.manager.imagePreview(f.selection(p)));assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|token|resource-A|same-name/);assert(f.state.downloads[0].every(v=>v===0));if(kind==='changed')assert(f.state.decoded[0].every(v=>v===0));}
});
test('old panel release cannot close the new panel or download an arbitrary message',async t=>{
 const f=await fixture(t),p=await f.read(),a=f.selection(p);await f.manager.closeOwned(f.input);const input={...f.input,panelId:randomUUID()},fresh=await f.manager.read({...input,cursor:null});await f.manager.imageClose({...f.input,pageId:a.pageId,requestId:a.requestId});const part=fresh.page.rows[0].parts[0];assert((await f.manager.imagePreview({...input,pageId:fresh.page.pageId,imageId:part.imageId,requestId:randomUUID()})).preview);await assert.rejects(f.manager.imagePreview({...input,pageId:fresh.page.pageId,imageId:randomUUID(),requestId:randomUUID()}),{code:'changed'});
});
