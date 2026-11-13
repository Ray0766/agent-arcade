'use strict';
// Synthetic 1x1 PNG built in code for tests. No community card or artwork is used.
const zlib=require('node:zlib');
const SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
function chunk(name,data=Buffer.alloc(0),{crc}={}) {
  const body=Buffer.concat([Buffer.from(name,'latin1'),data]);
  const out=Buffer.alloc(body.length+8);
  out.writeUInt32BE(data.length,0);body.copy(out,4);
  out.writeUInt32BE(crc??zlib.crc32(body),body.length+4);
  return out;
}
const textChunk=(keyword,text,options)=>chunk('tEXt',Buffer.concat([Buffer.from(keyword,'latin1'),Buffer.from([0]),Buffer.from(text,'latin1')]),options);
const cardChunk=(keyword,value,options)=>textChunk(keyword,Buffer.from(typeof value==='string'?value:JSON.stringify(value),'utf8').toString('base64'),options);
function png(extra=[]) {
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  return Buffer.concat([SIGNATURE,chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,128,0]))),...extra,chunk('IEND')]);
}
module.exports={SIGNATURE,chunk,textChunk,cardChunk,png};
