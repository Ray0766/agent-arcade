'use strict';
// Bounded local picker-file reader shared by image and voice preparation.
const fs=require('node:fs'),path=require('node:path');
const CODES=new Set(['invalid_request','media_format','media_too_large','unsafe_file','file_changed','file_unavailable','cancelled']);
class QQMediaFileError extends Error{constructor(code){const fixed=CODES.has(code)?code:'file_unavailable';super(`Selected media could not be read (${fixed}).`);this.code=fixed;}}
const fail=code=>{throw new QQMediaFileError(code);};
const check=signal=>{if(signal?.aborted)fail('cancelled');};
function localFile(file,extensions,maxBytes){
  if(typeof file!=='string'||file.length>1024||!path.isAbsolute(file)||/^[/\\]{2}/.test(file)||/[\x00-\x1f]/.test(file)||file.slice(path.parse(file).root.length).includes(':'))fail('unsafe_file');
  const normalized=path.resolve(file);if(!extensions.includes(path.extname(normalized).toLowerCase()))fail('media_format');
  const root=path.parse(normalized).root;let current=root;
  for(const part of path.relative(root,normalized).split(path.sep)){current=path.join(current,part);const stat=fs.lstatSync(current);if(stat.isSymbolicLink())fail('unsafe_file');if(current!==normalized&&!stat.isDirectory())fail('unsafe_file');}
  const stat=fs.lstatSync(normalized);if(!stat.isFile()||stat.nlink!==1)fail('unsafe_file');if(stat.size<1||stat.size>maxBytes)fail('media_too_large');return {file:normalized,stat};
}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1&&b.isFile();
async function readSelectedMedia(file,{signal,extensions,maxBytes}={}){
  if(!Array.isArray(extensions)||!extensions.length||extensions.length>4||extensions.some(value=>typeof value!=='string'||!/^\.[a-z0-9]{1,8}$/.test(value))||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8*1024*1024)fail('invalid_request');
  let handle,bytes;
  try{
    check(signal);const before=localFile(file,extensions,maxBytes);handle=await fs.promises.open(before.file,'r');const opened=await handle.stat();if(!sameFile(before.stat,opened))fail('file_changed');check(signal);
    bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,Math.min(256*1024,bytes.length-offset),offset);check(signal);if(!bytesRead)fail('file_changed');offset+=bytesRead;}
    const after=await handle.stat(),current=localFile(before.file,extensions,maxBytes);if(!sameFile(opened,after)||!sameFile(opened,current.stat))fail('file_changed');check(signal);return bytes;
  }catch(error){bytes?.fill(0);if(error instanceof QQMediaFileError)throw error;fail('file_unavailable');}finally{await handle?.close().catch(()=>{});}
}
module.exports={readSelectedMedia,QQMediaFileError};
