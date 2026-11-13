'use strict';
// Deterministic check that a quote is the owner's own wording in the message it cites.
const test=require('node:test'),assert=require('node:assert/strict');
const {flat,fragments,inOrder,verifyQuote,verifyEvidence,QUOTE_CHARS}=require('../src/bot/wiki/quote-verify.cjs');

test('quotes are compared without whitespace, punctuation and case; a dot between digits stays',()=>{
  assert.equal(flat('  不对，  我说的 是：“明天”！ (OK?) '),'不对我说的是明天ok');
  assert.equal(flat('v1.2 is not v12. End.'),'v1.2isnotv12end');assert.equal(flat('a…b~c～d、e；f'),'abcdef');assert.equal(flat(null),'');
  assert.deepEqual(fragments('别再…加表情了'),['别再','加表情了']);assert.deepEqual(fragments('stop... adding …… emoji'),['stop','adding','emoji']);assert.deepEqual(fragments('…'),[]);
  assert.equal(inOrder(['ab','cd'],'xxabyycdzz'),true);assert.equal(inOrder(['cd','ab'],'xxabyycdzz'),false);assert.equal(inOrder(['ab','ab'],'xxab'),false);assert.equal(inOrder([],'x'),true);
});

test('a quote must be found in that one message: verbatim, or as in-order fragments around an ellipsis',()=>{
  const said='不对，我说的是明天上午去，不是今天。还有，别再给我加那么多表情了！Use port 2222, not v1.2.';
  for(const quote of ['我说的是明天上午去','不对,我说的是明天','别再给我加那么多表情了','我说的是明天…不是今天','不对...别再给我加...表情了','use PORT 2222','not v1.2',' 别再 给我加 '])assert.equal(verifyQuote(quote,said),true,quote);
  for(const quote of ['我说的是后天','不是今天…我说的是明天','别再加表情了','use port 22222','not v12','','   ','…','。','天',5,null,'去'.repeat(QUOTE_CHARS+1)])assert.equal(verifyQuote(quote,said),false,String(quote));
  assert.equal(verifyQuote('明天',null),false);
  // Paraphrase is not a quote.
  assert.equal(verifyQuote('请不要再使用表情',said),false);
});

test('evidence must cite an existing owner message by id',()=>{
  const messages=new Map([['local:1',{role:'user',text:'以后回答先给结论，再说理由。'}],['local-out:2',{role:'assistant',text:'好的，我以后先给结论。'}],['local:3',{role:'user',text:'另外别用英文缩写'}]]);
  const result=verifyEvidence([
    {messageId:'local:1',quote:'先给结论，再说理由'},
    {messageId:'local:3',quote:'先给结论'},
    {messageId:'local-out:2',quote:'我以后先给结论'},
    {messageId:'local:404',quote:'先给结论'},
    {messageId:'local:1',quote:'先给结论…别用英文缩写'},
    {messageId:7,quote:'x'},null,'local:1',
  ],messages);
  assert.deepEqual(result.verified,[{messageId:'local:1',quote:'先给结论，再说理由'}]);
  assert.deepEqual(result.failed.map(item=>item.reason),['quote_not_found','not_owner_message','unknown_message','quote_not_found','malformed','malformed','malformed']);
  assert.deepEqual(verifyEvidence(null,messages),{verified:[],failed:[]});assert.deepEqual(verifyEvidence({length:1},messages),{verified:[],failed:[]});
  // At most twenty items are looked at.
  assert.equal(verifyEvidence(Array.from({length:30},()=>({messageId:'local:3',quote:'别用英文缩写'})),messages).verified.length,20);
});
