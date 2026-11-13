'use strict';
const zlib=require('node:zlib');
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,bytes){const kind=Buffer.from(type),header=Buffer.alloc(4),crc=Buffer.alloc(4);header.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,bytes])));return Buffer.concat([header,kind,bytes,crc]);}
function picture(width=1,height=1){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width*4;x++)raw[y*(width*4+1)+x+1]=(x*31+y*47)%256;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw,{level:0})),chunk('IEND',Buffer.alloc(0))]);}
module.exports={picture};
