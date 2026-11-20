'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {readExifOrientation,orientNativeImage}=require('../src/bot/qq-jpeg-orientation.cjs');

function app1(orientation,{le=true,type=3,items=1}={}){
  const value=Buffer.alloc(32);
  value.write('Exif\0\0');
  value.write(le?'II':'MM',6);
  const view=new DataView(value.buffer,value.byteOffset,value.length);
  view.setUint16(8,42,le);
  view.setUint32(10,8,le);
  view.setUint16(14,1,le);
  view.setUint16(16,0x0112,le);
  view.setUint16(18,type,le);
  view.setUint32(20,items,le);
  view.setUint16(24,orientation,le);
  return value;
}

test('reads only a bounded, single EXIF orientation value from either TIFF byte order',()=>{
  for(const le of [true,false]){
    for(let orient=1;orient<=8;orient++)assert.equal(readExifOrientation(app1(orient,{le})),orient);
  }
  for(const value of [app1(9),app1(6,{type:4}),app1(6,{items:2}),app1(6).subarray(0,23),Buffer.from('Exif\0\0')]){
    assert.equal(readExifOrientation(value),undefined);
  }
  const offset=app1(6);
  offset.writeUInt32LE(0xffffffff,10);
  assert.equal(readExifOrientation(offset),undefined);
});

test('preserves packed pixels while applying all eight orientation transforms',()=>{
  const source=Buffer.from('AaAaBbBbCcCcDdDdEeEeFfFf');
  const image={getSize:()=>({width:3,height:2}),toBitmap:()=>source};
  const nativeImage={createFromBitmap:(bytes,{width,height})=>({
    getSize:()=>({width,height}),isEmpty:()=>false,toBitmap:()=>bytes,
  })};
  for(const [index,order] of ['ABCDEF','CBAFED','FEDCBA','DEFABC','ADBECF','DAEBFC','FCEBDA','CFBEAD'].entries()){
    const output=orientNativeImage(image,index+1,nativeImage);
    assert.deepEqual(output.getSize(),index<4?{width:3,height:2}:{width:2,height:3});
    assert.equal(output.toBitmap().filter((_,offset)=>offset%4===0).toString(),order);
  }
  assert.equal(source.toString(),'AaAaBbBbCcCcDdDdEeEeFfFf');
});
