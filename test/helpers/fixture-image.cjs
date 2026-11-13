'use strict';
const {deflateSync}=require('node:zlib');
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value&1)?(value>>>1)^0xedb88320:value>>>1;}return (value^0xffffffff)>>>0;}
function chunk(name,bytes){const kind=Buffer.from(name),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(bytes.length);check.writeUInt32BE(crc(Buffer.concat([kind,bytes])));return Buffer.concat([size,kind,bytes,check]);}
function png(width=2,height=2,{metadata=true,animated=false}={}){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((width*4+1)*height,0x7f);for(let y=0;y<height;y++)rows[y*(width*4+1)]=0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(metadata?[chunk('tEXt',Buffer.from('Comment\0PRIVATE_FIXTURE_METADATA'))]:[]),...(animated?[chunk('acTL',Buffer.from([0,0,0,1,0,0,0,0]))]:[]),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
function native(){return {createFromBuffer(bytes){const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);const image=(w,h)=>({isEmpty:()=>false,getSize:()=>({width:w,height:h}),resize:({width:w,height:h})=>image(w,h),toPNG:()=>png(w,h)});return image(width,height);}};}
module.exports={png,chunk,native};
