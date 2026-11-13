'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),tls=require('node:tls');
const {QQSSQQMedia,mediaSource,MAX_ACTIVE,MAX_PENDING}=require('../src/bot/qq-ssqq-media.cjs');
const {QQImageDownloader}=require('../src/bot/qq-image-download.cjs');
const material=require('./helpers/qq-ssqq-media-tls-fixture.cjs');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1FcAAAAASUVORK5CYII=','base64');
const AVATAR='https://q1.qlogo.cn/g?b=qq&s=0&nk=100001',GROUP='https://p.qlogo.cn/gh/100002/100002/0',IMAGE='https://multimedia.nt.qq.com.cn/download?appid=1406&fileid=synthetic&rkey=synthetic-key';
const tick=()=>new Promise(r=>setImmediate(r));
test('only fixed upstream avatar and existing message-resource forms are accepted',async()=>{
 for(const url of [AVATAR,GROUP,IMAGE])assert.match(mediaSource(url).resourceDigest,/^[a-f0-9]{64}$/);
 for(const url of [AVATAR+'&x=extra',AVATAR+'&nk=100002',AVATAR.replace('s=0','s=640'),AVATAR.replace('https:','http:'),AVATAR.replace('q1.','q2.'),AVATAR.replace('qlogo.cn','qlogo.cn.evil.invalid'),AVATAR.replace('q1.','user:secret@q1.'),AVATAR+'#x',GROUP.replace('/100002/0','/100003/0'),GROUP+'?x=1','https://p.qlogo.cn/gdynamic/x/0/','https://q1.qlogo.cn/script.js','file:///C:/secret'])assert.throws(()=>mediaSource(url),{code:'image_source_unsupported'});
 await assert.rejects(new QQImageDownloader().download(AVATAR,{assertCurrent:()=>{},expectedResourceDigest:mediaSource(AVATAR).resourceDigest}),{code:'image_source_unsupported'});
});
test('actual TLS downloader accepts selected avatars and PNG; sends no browser or bridge headers',async t=>{
 const requests=[],sockets=new Set(),server=https.createServer({key:material['leaf-key.pem'],cert:material['leaf.pem']},(req,res)=>{requests.push({url:req.url,headers:req.headers});res.writeHead(200,{'content-type':'image/png'});res.end(PNG);});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const media=new QQSSQQMedia({assertCurrent:()=>{},createDownloader:({onSocket})=>new QQImageDownloader({sourceParser:mediaSource,onSocket,lookup:async()=>[{address:'8.8.8.8',family:4}],connect:o=>{const s=tls.connect({...o,host:'127.0.0.1',port:server.address().port,ca:material['ca.pem']});Object.defineProperty(s,'remoteAddress',{get:()=>o.host});Object.defineProperty(s,'remotePort',{get:()=>443});return s;}})});
 t.after(async()=>{await media.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 for(const url of [AVATAR,GROUP,IMAGE]){const result=await media.read(url);assert.deepEqual(result.bytes,PNG);assert.equal(result.mimeType,'image/png');result.bytes.fill(0);}
 assert.equal(requests.length,3);for(const r of requests)for(const key of ['cookie','authorization','proxy-authorization','referer','origin'])assert.equal(r.headers[key],undefined);
});
test('bounded concurrency and queued cancellation do not start extra downloads; close waits owned jobs',async()=>{
 let active=0,max=0,started=0;const media=new QQSSQQMedia({assertCurrent:()=>{},createDownloader:()=>({download(_url,{signal}){started++;active++;max=Math.max(max,active);return new Promise((_r,reject)=>signal.addEventListener('abort',()=>{active--;reject(Object.assign(Error('cancelled'),{code:'cancelled'}));},{once:true}));},close(){}})});
 const jobs=Array.from({length:MAX_PENDING},()=>media.read(AVATAR));for(const p of jobs)p.catch(()=>{});assert.equal(started,MAX_ACTIVE);assert.throws(()=>media.read(AVATAR),{code:'busy'});await media.close();await Promise.allSettled(jobs);assert.equal(max,MAX_ACTIVE);assert.equal(started,MAX_ACTIVE);assert.equal(active,0);assert.equal(media.queue.length,0);assert.equal(media.active.size,0);assert.throws(()=>media.read(AVATAR),{code:'closed'});
});
test('late uncooperative result after scope invalidation is zeroed and never returned',async()=>{
 let resolve,current=true;const raw=Buffer.from(PNG);const media=new QQSSQQMedia({assertCurrent:()=>{if(!current)throw Object.assign(Error('changed'),{code:'changed'});},createDownloader:()=>({download:()=>new Promise(r=>{resolve=r;}),close(){}})});
 const p=media.read(AVATAR);current=false;resolve({bytes:raw,extension:'.png',resourceDigest:mediaSource(AVATAR).resourceDigest});await assert.rejects(p,{code:'changed'});assert(raw.every(v=>v===0));await media.close();
});
test('already aborted request and queued request cancellation cannot reach downloader',async()=>{
 let starts=0;const media=new QQSSQQMedia({assertCurrent:()=>{},createDownloader:()=>{starts++;throw Error('must not start');}}),a=new AbortController();a.abort();await assert.rejects(media.read(AVATAR,{signal:a.signal}),{code:'cancelled'});assert.equal(starts,0);await media.close();await tick();
});
