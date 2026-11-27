'use strict';

const {parentPort,workerData}=require('node:worker_threads');
const {dimensions}=require('../../src/core/static-image.cjs');
const readPng=require('./vendor/pngjs/parser-sync.js');
const writePng=require('./vendor/pngjs/packer-sync.js');
const readJpeg=require('./vendor/jpeg-js/decoder.js');

function thumbnail({mime,bytes,edge}){
  const input=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const jpeg=mime==='image/jpeg';
  const {orientation=1}=dimensions(input,jpeg?'.jpg':'.png',{includeOrientation:true});
  const {width,height,data}=jpeg?readJpeg(input,{maxResolutionInMP:17,maxMemoryUsageInMB:256}):readPng(input,{});
  const scale=Math.min(1,edge/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const transpose=orientation>=5;
  const output={width:transpose?h:w,height:transpose?w:h,data:Buffer.alloc(w*h*4)};
  const flipX=[2,3,6,7].includes(orientation),flipY=[3,4,7,8].includes(orientation);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const column=transpose?y:x,row=transpose?x:y;
    const dx=flipX?output.width-1-column:column,dy=flipY?output.height-1-row:row;
    const index=(dy*output.width+dx)*4;
    // Average a small grid over the source area represented by this pixel.
    const sums=[0,0,0,0];
    for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
      const iy=Math.floor((y+(sy+0.5)/4)*height/h);
      const ix=Math.floor((x+(sx+0.5)/4)*width/w);
      const offset=(iy*width+ix)*4,alpha=data[offset+3];
      for(let c=0;c<3;c++)sums[c]+=data[offset+c]*alpha;
      sums[3]+=alpha;
    }
    for(let c=0;c<3;c++)output.data[index+c]=Math.round(sums[c]/(sums[3]||1));
    output.data[index+3]=Math.round(sums[3]/16);
  }
  return writePng(output,{});
}

parentPort.postMessage(thumbnail(workerData));
