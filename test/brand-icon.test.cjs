'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const icon=require('../src/core/icon.cjs');
function failingSource() {
  const location=path.resolve(__dirname,'../src/core/icon.cjs'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(location,'utf8'),{module,exports:module.exports,Buffer,__dirname:path.dirname(location),require:name=>name==='node:fs'?{readFileSync(){throw new Error('fixture_missing_brand');}}:name.startsWith('.')?require(path.resolve(path.dirname(location),name)):require(name)},{filename:location});
  return module.exports;
}
test('the preview candidate source is exact and retains its non-square canvas',()=>{
  const source=icon.readBrandSource();assert.equal(createHash('sha256').update(source).digest('hex'),icon.BRAND.sha256);
  assert.equal(source.readUInt32BE(16),icon.BRAND.width);assert.equal(source.readUInt32BE(20),icon.BRAND.height);
  assert.equal(icon.BRAND.fit,'contain');assert(icon.BRAND.width>icon.BRAND.height);assert.equal(icon.BRAND.viewport,undefined);
});
test('strict packaging rejects missing source without substituting the old brand',()=>{
  let decodes=0;assert.throws(()=>failingSource().createBrandIcon({createFromBuffer(){decodes++;}},32,{allowFallback:false}),/fixture_missing_brand/);assert.equal(decodes,0);
});
test('runtime may fall back to the original Sprout when the candidate brand is unavailable',()=>{
  let fallback;const expected={isEmpty:()=>false};const result=failingSource().createBrandIcon({createFromBuffer(bytes){fallback=bytes;return{resize:options=>{assert.equal(options.width,32);assert.equal(options.height,32);return expected;}};}},32);
  assert.equal(result,expected);assert(fallback.equals(icon.createIcon()));
});

test('native contain preserves every resized pixel and centers it on transparent padding',()=>{
  for(const [size,height] of [[48,40],[32,27]]){
    const bitmap=Buffer.from(Array.from({length:size*height*4},(_,i)=>(i*17+29)%256));let square;
    const expected={isEmpty:()=>false,getSize:()=>({width:size,height:size})};
    const native={createFromBuffer(bytes){assert(bytes.equals(icon.readBrandSource()));return{isEmpty:()=>false,getSize:()=>({width:icon.BRAND.width,height:icon.BRAND.height}),resize(options){assert.deepEqual(options,{width:size,quality:'best'});return{isEmpty:()=>false,getSize:()=>({width:size,height}),toBitmap(options){assert.deepEqual(options,{scaleFactor:1});return bitmap;}};}};},createFromBitmap(bytes,options){assert.deepEqual(options,{width:size,height:size,scaleFactor:1});square=bytes;return expected;}};
    assert.equal(icon.createBrandIcon(native,size,{allowFallback:false}),expected);
    const top=Math.floor((size-height)/2),start=top*size*4,end=start+bitmap.length;
    assert(square.subarray(start,end).equals(bitmap));assert(square.subarray(0,start).every(x=>x===0));assert(square.subarray(end).every(x=>x===0));assert.equal(square.length,size*size*4);
  }
});

test('strict packaging refuses malformed bitmap dimensions or byte length',()=>{
  for(const [width,height,length] of [[49,40,49*40*4],[48,0,0],[48,40,10]]){
    const native={createFromBuffer:()=>({isEmpty:()=>false,getSize:()=>({width:icon.BRAND.width,height:icon.BRAND.height}),resize:()=>({isEmpty:()=>false,getSize:()=>({width,height}),toBitmap:()=>Buffer.alloc(length)})}),createFromBitmap(){assert.fail('Malformed pixels must not reach output');}};
    assert.throws(()=>icon.createBrandIcon(native,48,{allowFallback:false}),/brand_(resize_failed|bitmap_invalid)/);
  }
});
test('strict packaging rejects empty native decoding, and size validation precedes fallback',()=>{
  assert.throws(()=>icon.createBrandIcon({createFromBuffer:()=>({isEmpty:()=>true})},32,{allowFallback:false}),/brand_decode_failed/);
  assert.throws(()=>icon.createBrandIcon({},0),/brand_size_invalid/);assert.throws(()=>icon.createBrandIcon({},Infinity),/brand_size_invalid/);
});
test('ICO offsets preserve every native-sized PNG including the 256 dimension byte',()=>{
  const frames=icon.ICON_SIZES.map(size=>({size,png:icon.createIcon(size/16)})),result=icon.encodeIco(frames);
  assert.equal(result.readUInt16LE(2),1);assert.equal(result.readUInt16LE(4),frames.length);let expected=6+16*frames.length;
  for(let i=0;i<frames.length;i++){const at=6+16*i,{size,png}=frames[i];assert.equal(result[at]||256,size);assert.equal(result[at+1]||256,size);assert.equal(result.readUInt16LE(at+4),1);assert.equal(result.readUInt16LE(at+6),32);assert.equal(result.readUInt32LE(at+8),png.length);assert.equal(result.readUInt32LE(at+12),expected);assert(result.subarray(expected,expected+png.length).equals(png));expected+=png.length;}
  assert.equal(expected,result.length);assert.throws(()=>icon.encodeIco(frames.slice(1)),/brand_frames_invalid/);
  assert.throws(()=>icon.encodeIco(frames.map((f,i)=>i===0?{size:f.size,png:Buffer.alloc(40)}:f)),/brand_frame_invalid/);
});
