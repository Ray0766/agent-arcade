'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const writePng=require('./vendor/pngjs/packer-sync.js');
const readPng=require('./vendor/pngjs/parser-sync.js');

test('photo thumbnail HTTP reads respect the current account, membership and visible message even with a warm cache',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store,{}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    store.db.close();
  });
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  async function client(number){
    const registration=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName:number,password:'synthetic only'})});
    assert.equal(registration.status,200);
    const cookie=registration.headers.get('set-cookie').split(';')[0];
    return path=>fetch(base+path,{headers:{Cookie:cookie}});
  }
  const [owner,guest,outside]=await Promise.all(['owner','guest','outside'].map(client));
  store.decide('guest',store.request('owner','guest').id,true);
  const group=store.createGroup('owner','河边散步',['guest']).id;
  const direct=store.direct('owner','guest').id;
  const width=120,height=240;
  const data=Buffer.alloc(width*height*4,255);
  for(let offset=0;offset<data.length;offset+=4){
    data[offset]=offset%255;
    data[offset+1]=(offset>>>3)%255;
    data[offset+2]=(offset>>>5)%255;
  }
  const bytes=writePng({width,height,data},{});
  const picture={bytes,width,height,mime:'image/png',digest:createHash('sha256').update(bytes).digest('hex')};
  const groupPhoto=store.sendImage('owner',group,'walk-old-photo',picture).id;
  store.send('owner',group,{clientId:'walk-new-text',text:'桥边见。'});
  const directPhoto=store.sendImage('owner',direct,'walk-direct-photo',picture).id;
  const sticker=store.sendHumanSticker('owner',direct,'walk-sticker',{...picture,label:'天气晴'}).id;
  const revision=(chat,account='guest')=>store.access(account,chat).membershipRevision;
  const asset=(chat,id)=>'/conversations/'+chat+'/messages/'+id;
  const url=(chat,id,rev=revision(chat),account='guest')=>asset(chat,id)+'/album-thumbnail?'+
    new URLSearchParams({account,revision:rev});
  async function image(path,fetchAsset=guest){
    const response=await fetchAsset(path);
    assert.equal(response.status,200,path);
    assert.equal(response.headers.get('content-type'),'image/png');
    assert.match(response.headers.get('cache-control'),/no-store/u);
    return Buffer.from(await response.arrayBuffer());
  }
  const thumb=await image(url(group,groupPhoto));
  const resized=readPng(thumb,{});
  assert.deepEqual([resized.width,resized.height],[96,192]);
  assert(thumb.length<bytes.length);
  assert.deepEqual(await image(asset(group,groupPhoto)+'/image'),bytes);
  assert.deepEqual(await image(url(direct,directPhoto)),thumb);
  // A generated blue rectangle with a small contrasting block, encoded as JPEG.
  const jpeg=Buffer.from([
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMU',
    'FRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
    'FBQUFBQUFBT/wAARCAB4APADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF',
    'BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW',
    'V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi',
    '4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC',
    'AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm',
    'Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq',
    '8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKA',
    'CiiigAooooAKKKKACiiigAooooAKKKKAK9/K0FpI6Hawxg/iKx/7Vuv+ev8A46P8K1dV/wCPCX8P5iufr+Y/E7N8xy/OKVLB4mdO',
    'LpRdozlFX55q9k1rotfI/oTw8yvAY3KqlTFUITkqjV5Ri3blhpdp6alv+1br/nr/AOOj/Cj+1br/AJ6/+Oj/AAqpRX5D/rLnn/Qd',
    'V/8ABk/8z9Q/1fyf/oDpf+C4/wCRp2F/PPdxo8m5TnIwPQ1sVz+lf8f8X4/yNdBX9OeGOOxWYZPVq4yrKpJVZK8pOTtyQdrtvTV6',
    'eZ/PXiHg8Ngs1p08LTjCLpp2iklfmnrZW10Ciiiv14/MAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKK',
    'KKAKmq/8eEv4fzFc/XQar/x4S/h/MVz9fyZ4tf8AI8o/9eo/+l1D+l/DP/kT1f8Ar6//AEmAUUUV+KH62W9K/wCP+L8f5Gugrn9K',
    '/wCP+L8f5Gugr+s/CX/kR1v+vsv/AEimfzR4mf8AI4pf9el/6VMKKKK/az8kCiiigAooooAKKKKACiiigAooooAKKKKACiiigAoo',
    'ooAKKKKACiiigAooooAqar/x4S/h/MVz9dBqv/HhL+H8xXP1/Jni1/yPKP8A16j/AOl1D+l/DP8A5E9X/r6//SYBRRRX4ofrZb0r',
    '/j/i/H+RroK5/Sv+P+L8f5Gugr+s/CX/AJEdb/r7L/0imfzR4mf8jil/16X/AKVMKKKK/az8kCiiigAooooAKKKKACiiigAooooA',
    'KKKKACiiigAooooAKKKKACiiigAooooAqar/AMeEv4fzFc/XQar/AMeEv4fzFc/X8meLX/I8o/8AXqP/AKXUP6X8M/8AkT1f+vr/',
    'APSYBRRRX4ofrZb0r/j/AIvx/ka6Cuf0r/j/AIvx/ka6Cv6z8Jf+RHW/6+y/9Ipn80eJn/I4pf8AXpf+lTCiiiv2s/JAooooAKKK',
    'KACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAKmq/8AHhL+H8xXP10Gq/8AHhL+H8xXP1/Jni1/yPKP/XqP/pdQ',
    '/pfwz/5E9X/r6/8A0mAUUUV+KH62W9K/4/4vx/ka6Cuf0r/j/i/H+RroK/rPwl/5Edb/AK+y/wDSKZ/NHiZ/yOKX/Xpf+lTCiiiv',
    '2s/JAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAI7iBbmFo2JCt6dap/2JB/fk/Mf4VoUV87mPD2',
    'VZtVVfHYeNSaVk32u3b72z3MDnmZZZTdHB13CLd7Lvor/gjP/sSD+/J+Y/wo/sSD+/J+Y/wrQory/wDUrh3/AKA4fj/mej/rbnv/',
    'AEFy/D/Ip2+lxW0yyKzll9SMfyq5RRX0WXZXgsppOhgaSpwbu0u9kr/ckeHjsxxeZ1FWxlRzkla77au34sKKKK9Q84KKKKACiiig',
    'AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooo',
    'oAKKKKACiiigD//Z'
  ].join(''),'base64');
  const jpegId=store.sendImage('owner',direct,'walk-direct-jpeg',{
    bytes:jpeg,width:240,height:120,mime:'image/jpeg',digest:createHash('sha256').update(jpeg).digest('hex')
  }).id;
  const jpegThumbnail=readPng(await image(url(direct,jpegId)),{});
  assert.deepEqual([jpegThumbnail.width,jpegThumbnail.height],[192,96]);
  assert.deepEqual(await image(url(group,groupPhoto,revision(group,'owner'),'owner'),owner),thumb);
  assert.equal((await guest(url(direct,sticker))).status,404);
  assert.equal((await guest(url(group,directPhoto))).status,404);
  assert.equal((await guest(url(group,groupPhoto,revision(group),'owner'))).status,409);
  assert.equal((await outside(url(group,groupPhoto,revision(group),'outside'))).status,404);

  const originalMembership=revision(group);
  store.remove('owner',group,'guest',false);
  assert.equal((await guest(url(group,groupPhoto,originalMembership))).status,404);
  store.addMembers('owner',group,['guest']);
  assert.equal((await guest(url(group,groupPhoto))).status,404);
  const fresh=store.sendImage('owner',group,'walk-new-photo',picture).id;
  assert.equal((await guest(url(group,fresh,originalMembership))).status,404);
  assert.deepEqual(await image(url(group,fresh)),thumb);
  store.run('UPDATE messages SET removed=1 WHERE id=?',fresh);
  assert.equal((await guest(url(group,fresh))).status,404);
  store.removeFriend('guest',direct,{expectedAccount:'guest',number:'owner',revision:revision(direct)});
  assert.equal((await guest(url(direct,directPhoto))).status,404);
});
