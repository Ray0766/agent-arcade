'use strict';

const {fail}=require('./store.cjs');
const invalid=()=>fail(422,'video_invalid','请选择完整的普通 MP4，包含 H.264 画面与 AAC-LC 声音');
const limit=()=>fail(413,'video_limits','短视频最长 60 秒，最长边 4096 像素，总像素不超过 8847360');
function dimensions(width,height){
  if(width<=0||height<=0)invalid();
  if(Math.max(width,height)>4096||width*height>4096*2160)limit();
}

function bits(buffer){
  let bit=0;
  function read(n){
    if(bit+n>buffer.length*8)invalid();
    let value=0;
    while(n--){value=value*2+((buffer[bit>>3]>>(7-bit%8))&1);bit++;}
    return value;
  }
  function ue(){
    let n=0;
    while(!read(1)){if(++n>24)invalid();}
    return 2**n-1+read(n);
  }
  const se=()=>{const v=ue();return v%2?(v+1)/2:-v/2;};
  return {read,ue,se,left:()=>buffer.length*8-bit};
}

// Derive actual cropped dimensions from the sequence parameter set, independently
// of the MP4 sample-entry width/height. Accept 8-bit 4:2:0 AVC only.
function checkSps(nal,width,height,config){
  const profile=config[1];
  if(nal.length<5||nal.length>65535||(nal[0]&0x9f)!==7||!nal.subarray(1,4).equals(config.subarray(1,4)))invalid();
  const rbsp=[];
  for(let i=1;i<nal.length;i++){
    if(i>=3&&nal[i]===3&&nal[i-1]===0&&nal[i-2]===0){if(i+1>=nal.length||nal[i+1]>3)invalid();continue;}
    rbsp.push(nal[i]);
  }
  const {read,ue,se}=bits(rbsp);
  read(24);ue();
  if(profile===100){
    if(ue()!==1||ue()!==0||ue()!==0)invalid();
    read(1);
    if(read(1)){
      for(let i=0;i<8;i++)if(read(1)){
        let last=8,next=8;
        for(let j=0;j<(i<6?16:64);j++){
          if(next)next=(last+se()+256)%256;
          last=next||last;
        }
      }
    }
  }
  ue();
  const order=ue();
  if(order===0)ue();
  else if(order===1){
    read(1);se();se();
    const count=ue();if(count>255)invalid();
    for(let i=0;i<count;i++)se();
  }else if(order!==2)invalid();
  ue();read(1);
  const w=(ue()+1)*16,h=(ue()+1)*16,progressive=read(1);
  if(!progressive)read(1);
  read(1);
  let cropW=0,cropH=0;
  if(read(1)){cropW=(ue()+ue())*2;cropH=(ue()+ue())*2*(2-progressive);}
  dimensions(w,h*(2-progressive));
  if(w-cropW!==width||h*(2-progressive)-cropH!==height)invalid();
}

function avcConfig(data,width,height){
  if(data.length<7||data[0]!==1||![66,77,100].includes(data[1]))invalid();
  const lengthSize=(data[4]&3)+1,sps=data[5]&31;
  if(lengthSize===3||!sps)invalid();
  let pos=6;
  function parameter(){
    if(pos+2>data.length)invalid();
    const n=data.readUInt16BE(pos);pos+=2;
    if(!n||pos+n>data.length)invalid();
    const result=data.subarray(pos,pos+n);pos+=n;return result;
  }
  for(let i=0;i<sps;i++)checkSps(parameter(),width,height,data);
  const pps=data[pos++];if(!pps)invalid();
  for(let i=0;i<pps;i++)if((parameter()[0]&0x9f)!==8)invalid();
  if(pos!==data.length){
    if(data[1]!==100||data.length!==pos+4||(data[pos]&3)!==1||(data[pos+1]&7)!==0||
      (data[pos+2]&7)!==0||data[pos+3]!==0)invalid();
  }
  return lengthSize;
}

function aacConfig(data){
  function descriptor(start,end,tag){
    if(data[start++]!==tag)invalid();
    let len=0;
    for(let i=0;i<4&&start<end;i++){
      const v=data[start++];len=len*128+(v&127);
      if(!(v&128)){if(start+len>end)invalid();return {start,end:start+len};}
    }
    invalid();
  }
  const es=descriptor(4,data.length,3);
  if(es.start+3>es.end)invalid();
  const flags=data[es.start+2];
  let pos=es.start+3;
  if(flags&128)pos+=2;
  if(flags&64)pos+=1+data[pos];
  if(flags&32)pos+=2;
  const dec=descriptor(pos,es.end,4);
  if(dec.start+13>dec.end||data[dec.start]!==0x40||data[dec.start+1]>>2!==5)invalid();
  const cfg=descriptor(dec.start+13,dec.end,5),b=bits(data.subarray(cfg.start,cfg.end));
  if(b.read(5)!==2||b.read(4)>12||![1,2].includes(b.read(4)))invalid();
  // Common AAC-LC general audio configuration. A sync extension may explicitly
  // declare that spectral band replication is absent.
  if(b.read(3)!==0)invalid();
  if(b.left()>=17){
    if(b.read(11)!==0x2b7||b.read(5)!==5||b.read(1)!==0)invalid();
  }
  while(b.left())if(b.read(1))invalid();
}

function inspectMp4(buf){
  let boxCount=0,nalCount=0;
  function boxes(data){
    const list=[];
    for(let pos=0;pos<data.length;){
      if(++boxCount>4096||data.length-pos<8)invalid();
      let n=data.readUInt32BE(pos),header=8;
      const type=data.toString('latin1',pos+4,pos+8);
      if(n===1){
        if(data.length-pos<16)invalid();
        n=Number(data.readBigUInt64BE(pos+8));header=16;
      }else if(n===0)n=data.length-pos;
      if(n<header||n>data.length-pos)invalid();
      list.push({type,data:data.subarray(pos+header,pos+n)});
      pos+=n;
    }
    return list;
  }
  function one(list,type){
    const match=list.filter(b=>b.type===type);
    if(match.length!==1)invalid();
    return match[0].data;
  }
  const full=(b,n)=>{if(b.length<n||b[0]!==0)invalid();return b;};
  function table(list,type,step){
    const b=full(one(list,type),8),count=b.readUInt32BE(4);
    if(!count||count>65536||8+count*step!==b.length)invalid();
    return b;
  }
  function timeline(b){
    const wide=b[0]===1;
    if(b[0]>1||b.length<(wide?32:20))invalid();
    const scale=b.readUInt32BE(wide?20:12),duration=wide?Number(b.readBigUInt64BE(24)):b.readUInt32BE(16);
    if(!scale||!duration||!Number.isSafeInteger(duration))invalid();
    return {duration,scale,ms:duration*1000/scale};
  }
  const root=boxes(buf),ftyp=one(root,'ftyp');
  if(ftyp.length<8||ftyp.length%4||root.some(b=>b.type==='moof'))invalid();
  const brands=[ftyp.toString('latin1',0,4)];
  for(let i=8;i<ftyp.length;i+=4){
    if(i>1024)invalid();
    brands.push(ftyp.toString('latin1',i,i+4));
  }
  if(!brands.some(b=>/^(?:isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(b)))invalid();
  const movie=boxes(one(root,'moov')),tracks=movie.filter(b=>b.type==='trak');
  const movieClock=timeline(one(movie,'mvhd')),durationMs=Math.ceil(movieClock.ms);
  if(durationMs>60000)limit();
  const media=root.filter(b=>b.type==='mdat').map(b=>[b.data.byteOffset-buf.byteOffset,b.data.byteOffset-buf.byteOffset+b.data.length]);
  if(media.length!==1||tracks.length!==2||movie.some(b=>['mvex','rmra'].includes(b.type)))invalid();
  const [mediaStart,mediaEnd]=media[0],ranges=[];
  let picture,hasAudio=false,longest=0;
  for(const track of tracks){
    const trak=boxes(track.data),mdia=boxes(one(trak,'mdia')),minf=boxes(one(mdia,'minf'));
    const dref=full(one(boxes(one(minf,'dinf')),'dref'),8),urls=boxes(dref.subarray(8));
    if(dref.readUInt32BE(4)!==1||urls.length!==1||!one(urls,'url ').equals(Buffer.from([0,0,0,1])))invalid();
    const stbl=boxes(one(minf,'stbl')),stsd=full(one(stbl,'stsd'),8),formats=boxes(stsd.subarray(8));
    if(stsd.readUInt32BE(4)!==1||formats.length!==1)invalid();
    const handler=full(one(mdia,'hdlr'),12).toString('latin1',8,12),format=formats[0];
    const tkhd=one(trak,'tkhd'),wideHeader=tkhd[0]===1,p=wideHeader?52:40;
    if(tkhd[0]>1||tkhd.length<p+44)invalid();
    const trackDuration=wideHeader?Number(tkhd.readBigUInt64BE(28)):tkhd.readUInt32BE(20);
    if(!trackDuration||trackDuration>movieClock.duration)invalid();
    const video=handler==='vide';
    let lengthSize=0;
    if(format.data.length<8||format.data.readUInt16BE(6)!==1)invalid();
    if(video){
      if(picture||format.type!=='avc1'||format.data.length<78)invalid();
      const width=format.data.readUInt16BE(24),height=format.data.readUInt16BE(26);
      dimensions(width,height);lengthSize=avcConfig(one(boxes(format.data.subarray(78)),'avcC'),width,height);
      dimensions(Math.ceil(tkhd.readUInt32BE(p+36)/65536),Math.ceil(tkhd.readUInt32BE(p+40)/65536));
      const m=Array.from({length:9},(_,i)=>tkhd.readInt32BE(p+i*4));
      const matrix=[m[0],m[1],m[3],m[4]].map(v=>v/65536).join(',');
      if(!['1,0,0,1','0,1,-1,0','-1,0,0,-1','0,-1,1,0'].includes(matrix)||m[2]||m[5]||m[8]!==1073741824)invalid();
      picture=m[0]?{width,height}:{width:height,height:width};
    }else{
      if(handler!=='soun'||hasAudio||format.type!=='mp4a'||format.data.length<28||format.data.readUInt16BE(8)!==0)invalid();
      aacConfig(one(boxes(format.data.subarray(28)),'esds'));hasAudio=true;
    }
    const timing=timeline(one(mdia,'mdhd'));longest=Math.max(longest,timing.ms);
    if(timing.ms>60250)limit(); // Allow encoder priming trimmed by the movie timeline.
    if(trak.some(b=>b.type==='edts')){
      const edits=one(boxes(one(trak,'edts')),'elst'),wide=edits[0]===1,step=wide?20:12;
      if(edits.length<8||edits[0]>1)invalid();
      const count=edits.readUInt32BE(4);
      if(!count||count>2||edits.length!==8+step*count)invalid();
      let total=0;
      for(let i=8;i<edits.length;i+=step){
        const duration=wide?Number(edits.readBigUInt64BE(i)):edits.readUInt32BE(i);
        const start=wide?Number(edits.readBigInt64BE(i+8)):edits.readInt32BE(i+4);
        if(!duration||edits.readUInt32BE(i+step-4)!==65536||start< -1||start>=timing.duration||
            (start===-1&&i+step===edits.length))invalid();
        total+=duration;
      }
      if(total!==trackDuration)invalid();
    }
    const stts=table(stbl,'stts',8),stsc=table(stbl,'stsc',12),stsz=full(one(stbl,'stsz'),12);
    const count=stsz.readUInt32BE(8),fixed=stsz.readUInt32BE(4);
    if(!count||count>65536||stsz.length!==12+(fixed?0:count*4))invalid();
    let samples=0,ticks=0;
    for(let i=8;i<stts.length;i+=8){
      const n=stts.readUInt32BE(i),delta=stts.readUInt32BE(i+4);
      if(!n||!delta)invalid();samples+=n;ticks+=n*delta;
    }
    if(samples!==count||ticks!==timing.duration)invalid();
    if(stbl.some(b=>b.type==='ctts')){
      const times=one(stbl,'ctts');
      if(times.length<8||times[0]>1||times.length!==8+times.readUInt32BE(4)*8)invalid();
      let covered=0;
      for(let i=8;i<times.length;i+=8){
        covered+=times.readUInt32BE(i);
        const offset=times[0]?times.readInt32BE(i+4):times.readUInt32BE(i+4);
        if(Math.abs(offset)>timing.duration)invalid();
      }
      if(covered!==count)invalid();
    }
    const wide=stbl.some(b=>b.type==='co64'),step=wide?8:4;
    if(wide&&stbl.some(b=>b.type==='stco'))invalid();
    const offsets=table(stbl,wide?'co64':'stco',step),chunks=offsets.readUInt32BE(4);
    let lastChunk=0;
    for(let p=8;p<stsc.length;p+=12){
      const first=stsc.readUInt32BE(p);
      if(first<=lastChunk||first>chunks||(!lastChunk&&first!==1)||!stsc.readUInt32BE(p+4)||stsc.readUInt32BE(p+8)!==1)invalid();
      lastChunk=first;
    }
    let idx=0,run=8,idr=false;
    for(let i=0;i<chunks;i++){
      if(run+12<stsc.length&&stsc.readUInt32BE(run+12)===i+1)run+=12;
      const n=stsc.readUInt32BE(run+4);
      let pos=wide?Number(offsets.readBigUInt64BE(8+i*step)):offsets.readUInt32BE(8+i*step);
      const start=pos;
      if(n>count-idx||pos<mediaStart||pos>=mediaEnd)invalid();
      for(let j=0;j<n;j++,idx++){
        const size=fixed||stsz.readUInt32BE(12+idx*4),end=pos+size;
        if(!size||end>mediaEnd)invalid();
        if(video){
          let slice=false;
          while(pos<end){
            if(++nalCount>131072||pos+lengthSize>end)invalid();
            const len=buf.readUIntBE(pos,lengthSize);pos+=lengthSize;
            if(!len||len>end-pos||(buf[pos]&128))invalid();
            const type=buf[pos]&31;
            if(![1,5,6,9,12].includes(type))invalid();
            if(type===5)idr=true;
            if(type===1||type===5)slice=true;
            pos+=len;
          }
          if(!slice)invalid();
        }else pos=end;
      }
      ranges.push([start,pos]);
    }
    if(idx!==count||(video&&!idr))invalid();
  }
  if(!picture||!hasAudio||Math.abs(durationMs-longest)>250)invalid();
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])invalid();
  return {...picture,durationMs};
}
module.exports={inspectMp4};
