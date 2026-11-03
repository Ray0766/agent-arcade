'use strict';
const { deflateSync } = require('node:zlib');
const theme = require('../themes/workshop.json');
function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function chunk(type, bytes) { const data=Buffer.concat([Buffer.from(type),bytes]),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(data));return Buffer.concat([size,data,crc]); }
function createIcon(scale=2) {
  const size=16*scale, rows=[];
  for(let y=0;y<size;y++) { const row=Buffer.alloc(1+size*4);for(let x=0;x<size;x++){const key=theme.sprites.idle[Math.floor(y/scale)][Math.floor(x/scale)];if(key==='.'){row.set([32,60,52,255],1+x*4);continue;}const color=theme.palette[key];row.set([parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16),255],1+x*4);}rows.push(row); }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={createIcon};
