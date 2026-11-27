'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createSocialView}=require('./social-view.cjs');
test('current group camera seat, account, frame, route and one-shot permission',async()=>{
 const origin='http://127.0.0.1:9002',gid='649ee7c6-84a7-4966-906c-5dcf1f7c27f1';
 const frame={url:origin+'/#chat/'+gid},number='visitor',id='335cf3f3-4250-4143-a15d-fd9a972f4c52',self='50e35674-4108-4852-a927-3e37e7301acf';
 let get,one,prepare,active=true,change=false;
 let room={chat:gid,id,self,participants:[{id:self,video:true,number}]};
 const isolated=Object.assign(new EventEmitter(),{webRequest:{onBeforeRequest(){}},setPermissionCheckHandler(fn){get=fn},setPermissionRequestHandler(fn){one=fn},
 async fetch(url,options){
   const requested=new URL(url);
   assert.equal(requested.origin,origin);
   assert.equal(requested.pathname,'/api/v1/conversations/'+gid+'/group-voice/'+input.device);
   assert.deepEqual(Object.fromEntries(requested.searchParams),{revision:input.revision,roomId:id,self});
   assert.equal(options.headers['X-Social-Account'],number);
   if(change)frame.url=origin+'/';
   return {ok:true,json:async()=>({room})};
 }});
 class Guest{constructor(){this.webContents=Object.assign(new EventEmitter(),{mainFrame:frame,isDestroyed:()=>false,setWindowOpenHandler(){},ipc:{handle(name,fn){if(name==='arcade:prepareCallCamera')prepare=fn}}})}}
 const {view}=createSocialView({WebContentsView:Guest,session:{fromPartition:()=>isolated},configuration:{origin,mode:'test'},isActive:()=>active});
 const sender=view.webContents,event={sender,senderFrame:frame};
 const input={kind:'group',account:number,self,roomId:id,revision:'known',device:'c444dde1-41fb-4698-93ea-62b303c6ff94'};
 const details={mediaType:'video',mediaTypes:['video'],isMainFrame:true,requestingUrl:origin+'/'};
 assert.equal(get(sender,'media',origin,details),false);
 for(const invalid of [null,{...room,self:id},{...room,id:self},{...room,chat:'other'},{...room,participants:[{id:self,video:true,number:'other_user'}]},{...room,participants:[{id:self,video:false,number}]}]){
   const saved=room;room=invalid;assert.equal(await prepare(event,input),false);room=saved;
 }
 assert.equal(await prepare({...event,senderFrame:{url:frame.url}},input),false);
 active=false;assert.equal(await prepare(event,input),false);active=true;
 change=true;assert.equal(await prepare(event,input),false);change=false;frame.url=origin+'/#chat/'+gid;
 assert.equal(await prepare(event,input),true);
 one(sender,'media',v=>assert.equal(v,true),details);
 one(sender,'media',v=>assert.equal(v,false),details);
});
