'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {readCardFromPng,writeCardToPng,isPng,crc32,MAX_PNG_BYTES,MAX_JSON_BYTES}=require('../src/vendor/sillytavern/character-card-parser.cjs');
const {png,chunk,textChunk,cardChunk,SIGNATURE}=require('./st-png-fixture.cjs');
const v2={spec:'chara_card_v2',spec_version:'2.0',data:{name:'测试角色 Test',description:'合成样例 ✓'}};

test('CRC-32 matches the zlib implementation',()=>{
  for(const sample of [Buffer.alloc(0),Buffer.from('IEND'),Buffer.from('合成样例 synthetic','utf8')]) assert.equal(crc32(sample),zlib.crc32(sample));
});
test('write then read round-trips UTF-8 JSON and keeps the image chunks',()=>{
  const base=png([textChunk('Software','synthetic')]);
  const json=JSON.stringify(v2);
  const written=writeCardToPng(base,json);
  assert.ok(isPng(written));
  // ccv3 is written alongside chara and preferred on read, as upstream does.
  assert.deepEqual(JSON.parse(readCardFromPng(written)),{...v2,spec:'chara_card_v3',spec_version:'3.0'});
  assert.ok(written.includes(chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,128,0])))));
  assert.ok(written.includes(textChunk('Software','synthetic')));
  assert.ok(written.subarray(-12).equals(chunk('IEND')));
});
test('existing chara / ccv3 chunks are replaced, not duplicated',()=>{
  const base=png([cardChunk('chara',{old:1}),cardChunk('CCV3',{old:3})]);
  const written=writeCardToPng(writeCardToPng(base,JSON.stringify(v2)),JSON.stringify({...v2,data:{name:'second'}}));
  assert.equal(written.toString('latin1').split('tEXtchara\0').length-1,1);
  assert.equal(written.toString('latin1').split('tEXtccv3\0').length-1,1);
  assert.equal(written.toString('latin1').includes('tEXtCCV3'),false);
  assert.equal(JSON.parse(readCardFromPng(written)).data.name,'second');
});
test('ccv3 is preferred over chara; chara alone is read; non-JSON text only gets a chara chunk',()=>{
  assert.equal(readCardFromPng(png([cardChunk('chara','{"from":"chara"}'),cardChunk('ccv3','{"from":"ccv3"}')])),'{"from":"ccv3"}');
  assert.equal(readCardFromPng(png([cardChunk('Chara','{"from":"chara"}')])),'{"from":"chara"}');
  assert.equal(readCardFromPng(writeCardToPng(png(),'not json')),'not json');
});
test('rejects bad signature, truncation, bad CRC, missing data and oversized input',()=>{
  const good=png([cardChunk('chara',v2)]);
  const invalid=fn=>assert.throws(fn,{code:'character_card_invalid'});
  invalid(()=>readCardFromPng(Buffer.from('{"spec":"chara_card_v2"}')));
  invalid(()=>readCardFromPng(Buffer.concat([Buffer.from([0x88]),good.subarray(1)])));
  invalid(()=>readCardFromPng('not a buffer'));
  invalid(()=>readCardFromPng(good.subarray(0,good.length-20)));
  invalid(()=>readCardFromPng(good.subarray(0,good.length-12)));
  const longLength=Buffer.from(good);longLength.writeUInt32BE(0x7fffffff,SIGNATURE.length+25);
  invalid(()=>readCardFromPng(longLength));
  invalid(()=>readCardFromPng(png([cardChunk('chara',v2,{crc:0x12345678})])));
  invalid(()=>writeCardToPng(png([cardChunk('chara',v2,{crc:1})]),'{}'));
  invalid(()=>readCardFromPng(png()));
  invalid(()=>readCardFromPng(png([textChunk('Comment','no card')])));
  invalid(()=>readCardFromPng(png([chunk('tEXt',Buffer.from('nokeywordterminator'))])));
  invalid(()=>readCardFromPng(Buffer.concat([SIGNATURE,chunk('IDAT'),chunk('IEND')])));
  invalid(()=>readCardFromPng(Buffer.concat([good,Buffer.alloc(MAX_PNG_BYTES)])));
  invalid(()=>readCardFromPng(png([cardChunk('chara',' '.repeat(MAX_JSON_BYTES+3))])));
  invalid(()=>writeCardToPng(png(),' '.repeat(MAX_JSON_BYTES+1)));
  invalid(()=>writeCardToPng(png(),''));
});
