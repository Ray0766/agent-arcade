'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {encode}=require('silk-wasm');
const {decodeGroupSilk}=require('../src/bot/qq-silk.cjs');

test('the group codec bounds frames before loading invalid SILK and rejects a cancelled decode',async()=>{
 const head=Buffer.from('\x02#!SILK_V3','ascii');
 await assert.rejects(decodeGroupSilk(Buffer.concat([head,Buffer.from([4,0,7])])),{code:'voice_format'});
 await assert.rejects(decodeGroupSilk(Buffer.concat([head,Buffer.from([0xff,0xff])])),{code:'voice_format'});
 const tooMany=Buffer.concat([head,Buffer.alloc(1501*3,Buffer.from([1,0,7]))]);
 await assert.rejects(decodeGroupSilk(tooMany),{code:'duration_limit'});
 const encoded=Buffer.from((await encode(Buffer.alloc(32000),16000)).data);
 const controller=new AbortController();controller.abort();
 await assert.rejects(decodeGroupSilk(encoded,{signal:controller.signal}),{code:'cancelled'});
});
