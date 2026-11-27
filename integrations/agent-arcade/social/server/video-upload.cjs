'use strict';

const {fail}=require('./store.cjs');
const {readAttachment}=require('./image-upload.cjs');
const {uploadFileName}=require('./file-upload.cjs');

const invalid=()=>fail(422,'video_invalid','请选择含 VP8 画面和 Opus 声音的完整 WebM 短片');
const limit=()=>fail(413,'video_limits','视频限 60 秒，画面最长边 4096 像素，最多 8847360 像素');

// Read a bounded subset of WebM. Chromium MediaRecorder can omit Duration and use
// unknown-length Segments and Clusters. In that case measure the media blocks.
function inspectWebm(bytes){
  let elements=0;
  function vint(pos,end,id=false){
    const head=bytes[pos];
    if(pos>=end||!head)invalid();
    const length=Math.clz32(head)-23;
    if(pos+length>end||length>(id?4:8))invalid();
    const mask=0xff>>length;
    let value=id?head:head&mask,unknown=!id&&value===mask;
    for(let i=1;i<length;i++){value=value*256+bytes[pos+i];unknown=unknown&&bytes[pos+i]===255;}
    if(!unknown&&!Number.isSafeInteger(value))invalid();
    return {value:unknown?-1:value,next:pos+length};
  }
  function element(pos,end){
    if(++elements>50000)invalid();
    const id=vint(pos,end,true),size=vint(id.next,end);
    if(size.value<0&&![0x18538067,0x1f43b675].includes(id.value))invalid();
    if(size.value>end-size.next)invalid();
    return {id:id.value,start:size.next,end:size.value<0?end:size.next+size.value,unknown:size.value<0};
  }
  function each(start,end,fn){
    for(let pos=start;pos<end;){
      const field=element(pos,end);
      pos=fn(field)??field.end;
    }
  }
  function uint(field){
    const n=field.end-field.start;
    if(n<1||n>6)invalid();
    return bytes.readUIntBE(field.start,n);
  }
  const string=f=>bytes.toString('utf8',f.start,f.end);
  const header=element(0,bytes.length);
  if(header.id!==0x1a45dfa3)invalid();
  let webm=false;
  each(header.start,header.end,f=>{if(f.id===0x4282)webm=string(f)==='webm';});
  const segment=element(header.end,bytes.length);
  if(!webm||segment.id!==0x18538067||segment.end!==bytes.length)invalid();

  const tracks=new Map();
  let scale=1000000,declared,infoSeen=false,tracksSeen=false,started=false;
  function track(entry){
    const t={frames:0,last:null,lastStep:0};
    each(entry.start,entry.end,f=>{
      if(f.id===0xd7)t.number=uint(f);
      else if(f.id===0x83)t.type=uint(f);
      else if(f.id===0x86)t.codec=string(f);
      else if(f.id===0x23e383)t.frameMs=uint(f)/1e6;
      else if(f.id===0x63a2)t.private=bytes.subarray(f.start,f.end);
      else if(f.id===0x6d80)invalid(); // Encoded or encrypted tracks.
      else if(f.id===0xe0)each(f.start,f.end,v=>{
        if(v.id===0xb0)t.width=uint(v);
        if(v.id===0xba)t.height=uint(v);
      });
    });
    if(!t.number||tracks.has(t.number)||tracks.size===2)invalid();
    if(t.type===1&&t.codec==='V_VP8'){
      if(!t.width||!t.height)invalid();
      if(Math.max(t.width,t.height)>4096||t.width*t.height>4096*2160)limit();
    }else if(t.type===2&&t.codec==='A_OPUS'){
      if(!t.private||t.private.length<19||t.private.toString('ascii',0,8)!=='OpusHead'||!t.private[9])invalid();
    }else invalid();
    tracks.set(t.number,t);
  }
  let endMs=0;
  function block(f,clusterTime){
    const number=vint(f.start,f.end),t=tracks.get(number.value);
    const p=number.next+3;
    if(!t||clusterTime===undefined||p>=f.end||(bytes[p-1]&6))invalid(); // Non-laced packets.
    const ms=(clusterTime+bytes.readInt16BE(number.next))*scale/1e6;
    if(ms < -120 || ms>60000)limit();
    if(t.last!==null&&ms<t.last)invalid();
    if(t.last!==null&&ms>t.last)t.lastStep=ms-t.last;
    t.last=ms;t.frames++;
    if(t.type===1){
      if(p+3>f.end)invalid();
      const tag=bytes.readUIntLE(p,3),key=(tag&1)===0;
      if((tag>>5)+(key?10:3)>f.end-p||(!key&&t.frames===1))invalid();
      if(key&&(p+10>f.end||bytes.readUIntBE(p+3,3)!==0x9d012a||
        (bytes.readUInt16LE(p+6)&0x3fff)!==t.width||(bytes.readUInt16LE(p+8)&0x3fff)!==t.height))invalid();
    }else{
      const toc=bytes[p],config=toc>>3,code=toc&3;
      const frame=config<12?[10,20,40,60][config%4]:config<16?[10,20][config%2]:[2.5,5,10,20][config%4];
      const count=code===0?1:code===3?(p+1<f.end?bytes[p+1]&63:0):2;
      if(!count||frame*count>120)invalid();
      endMs=Math.max(endMs,ms+frame*count);
    }
  }
  const levelOne=new Set([0x1f43b675,0x1549a966,0x1654ae6b,0x114d9b74,0x1c53bb6b,0x1254c367,0x1043a770,0x1941a469]);
  each(segment.start,segment.end,f=>{
    if(f.id===0x1549a966){
      if(infoSeen||started)invalid();
      infoSeen=true;
      each(f.start,f.end,v=>{
        if(v.id===0x2ad7b1){scale=uint(v);if(!scale)invalid();}
        if(v.id===0x4489){
          const n=v.end-v.start;
          if(n!==4&&n!==8)invalid();
          declared=n===4?bytes.readFloatBE(v.start):bytes.readDoubleBE(v.start);
          if(!Number.isFinite(declared)||declared<=0)invalid();
        }
      });
    }else if(f.id===0x1654ae6b){
      if(tracksSeen||started)invalid();
      tracksSeen=true;
      each(f.start,f.end,v=>{if(v.id===0xae)track(v);});
    }else if(f.id===0x1f43b675){
      started=true;
      let clusterTime;
      for(let pos=f.start;pos<f.end;){
        const v=element(pos,f.end);
        if(f.unknown&&levelOne.has(v.id))return pos;
        if(v.id===0xe7)clusterTime=uint(v);
        if(v.id===0xa3)block(v,clusterTime);
        if(v.id===0xa0)each(v.start,v.end,g=>{if(g.id===0xa1)block(g,clusterTime);});
        pos=v.end;
      }
    }
  });
  const video=[...tracks.values()].find(t=>t.type===1),audio=[...tracks.values()].find(t=>t.type===2);
  if(!infoSeen||!video?.frames||!audio?.frames)invalid();
  endMs=Math.max(endMs,video.last+(video.frameMs||video.lastStep||1));
  if(declared!==undefined){
    const ms=declared*scale/1e6;
    if(ms>60000)limit();
    // Audio encoders can pad the final packet. Prefer the container's verified
    // duration but reject a timeline that materially exceeds it.
    if(ms<Math.max(video.last,audio.last)-120||Math.abs(ms-endMs)>Math.max(250,video.lastStep))invalid();
    endMs=ms;
  }
  const durationMs=Math.ceil(endMs);
  if(durationMs>60000)limit();
  if(durationMs<=0)invalid();
  return {width:video.width,height:video.height,durationMs};
}
function readVideoUpload(req){
  const name=uploadFileName(req);
  return readAttachment(req,{kind:'video',formats:['video/webm'],maxBytes:16*1024*1024,
    formatError:'目前支持 WebM（VP8 和 Opus）短视频',sizeError:'视频不能超过 16 MiB',
    validate:bytes=>({...inspectWebm(bytes),name})});
}

module.exports={readVideoUpload,inspectWebm};
