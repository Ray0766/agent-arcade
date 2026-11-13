'use strict';

// A small local queue controls pacing. Neither delays nor model punctuation are
// evidence that a message was delivered; the caller journals each actual send.
const DEFAULT_FLOW = Object.freeze({debounceMs:1800,maxBatchMs:4000,bubbleDelayMs:450,maxBatchMessages:8,maxBatchChars:2800,maxBubbles:4});
function flowOptions(value={}) {
  const result={...DEFAULT_FLOW};
  for(const key of Object.keys(result)) {
    if(value[key]!==undefined) {
      const max=key.endsWith('Ms')?10000:key==='maxBatchChars'?2800:key==='maxBatchMessages'?8:4;
      const min=key.endsWith('Ms')?0:1;
      if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)throw Error('Invalid conversation pacing.');
      result[key]=value[key];
    }
  }
  result.maxBatchMs=Math.max(result.debounceMs,result.maxBatchMs);
  return result;
}
function delay(ms,signal) {
  if(signal?.aborted||ms<=0)return Promise.resolve(!signal?.aborted);
  return new Promise(resolve=>{
    let timer;
    const done=value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);};
    const abort=()=>done(false);
    timer=setTimeout(()=>done(true),ms);signal?.addEventListener('abort',abort,{once:true});
  });
}
function splitBubbles(text,max=4) {
  const source=String(text).trim();if(!source)return [];
  const paragraphs=source.split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean),result=[];
  for(const paragraph of paragraphs) {
    if(paragraph.length<=500){result.push(paragraph);continue;}
    const sentences=paragraph.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g)||[paragraph];
    let buffer='';
    for(const sentence of sentences){
      if(buffer&&buffer.length+sentence.length>500){result.push(buffer.trim());buffer='';}
      buffer+=sentence;
    }
    if(buffer.trim())result.push(buffer.trim());
  }
  // Never split an unbroken code, URL or word just to meet a cosmetic length.
  return result.length<=max?result:[...result.slice(0,max-1),result.slice(max-1).join('\n\n')];
}
function findCode(items,code) {
  if(typeof code!=='string'||!/^[\w-]{6,180}$/.test(code))return null;
  const matches=items.filter(item=>item.id===code||item.id.startsWith(code));
  return matches.length===1?matches[0]:null;
}
module.exports={DEFAULT_FLOW,flowOptions,delay,splitBubbles,findCode};
