'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {QQClient} = require('../src/bot/qq.cjs');
const {png} = require('./helpers/fixture-image.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', MEMBER = '44443333', OPERATOR = '33334444';
const GROUP = '55556666', OTHER = '77778888', OUTSIDE = '66665555';
const NOW = 1800000000000;
const text = body => ({type:'text',data:{text:body}});
const reply = id => ({type:'reply',data:{id}});

async function fixture(t, {onRecall, groupImageIds = [], sendId = 900} = {}) {
  const events = [], calls = [], state = {now:NOW};
  let socket;
  class Socket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => {this.readyState=1;this.emit('open');});
    }
    frame(row) {this.emit('message', JSON.stringify(row), false);}
    send(raw, callback) {
      const request = JSON.parse(raw);
      calls.push(request);
      callback();
      let data;
      switch (request.action) {
        case 'get_login_info': data={user_id:Number(ACCOUNT)};break;
        case 'get_status': data={online:true,good:true};break;
        case 'get_group_member_info': data={group_id:request.params.group_id,user_id:Number(ACCOUNT)};break;
        case 'send_group_msg': data={message_id:sendId};break;
        default: throw Error(`Unexpected action ${request.action}`);
      }
      this.frame({echo:request.echo,status:'ok',retcode:0,data});
    }
    terminate() {this.readyState=3;}
    ping() {this.emit('pong');}
  }
  const client = new QQClient({
    token:'synthetic-group-recall-token', ownerId:OWNER, expectedAccountId:ACCOUNT,
    groupIds:[GROUP,OTHER], groupImageIds, now:()=>state.now, timeoutMs:100, pollTimeoutMs:2,
    socketFactory:()=>{socket=new Socket();return socket;},
    onGroupRecall(event, scope) {
      events.push(event);
      assert.equal(scope.client,client);
      assert.equal(scope.generation,client.generation);
      return onRecall?.(event,scope);
    },
  });
  t.after(()=>client.close());
  await client.connect();
  calls.length=0;
  const emit = (id, message, groupId=GROUP, author=MEMBER) => socket.frame({
    post_type:'message',message_type:'group',sub_type:'normal',self_id:Number(ACCOUNT),group_id:Number(groupId),
    user_id:Number(author),sender:{user_id:Number(author)},message_id:id,time:Math.floor(state.now/1000),message,
  });
  const recall = fields => socket.frame({
    post_type:'notice',notice_type:'group_recall',self_id:Number(ACCOUNT),group_id:Number(GROUP),
    user_id:Number(MEMBER),operator_id:Number(OPERATOR),message_id:700,time:Math.floor(state.now/1000),...fields,
  });
  return {client,events,calls,state,emit,recall,poll:async()=> (await client.getUpdates()).messages};
}

test('a native recall removes only the exact queued original and disables its same-group reply context', async t => {
  const f=await fixture(t);
  f.emit(700,[text('撤回的正文')]);
  f.emit(700,[text('另一个群里的正文')],OTHER);
  f.emit(701,[reply(700),text('撤回之前已经收到的跟帖')]);
  f.emit(702,[text('无关的同群正文')]);
  const stale = [...f.client.groupContexts].find(([,row])=>row.groupId===GROUP&&row.rawId==='700')[0];
  f.recall({untrusted:'do not copy this field'});
  f.recall({operator_id:Number(MEMBER)});
  f.emit(700,[text('撤回原帖重新出现')]);
  f.emit(703,[reply(700),text('撤回之后收到的跟帖')]);
  f.emit(704,[reply(700),text('另一个群的普通跟帖')],OTHER);
  const messages=await f.poll();
  assert.deepEqual(messages.map(row=>row.id),[
    `group:${OTHER}:700`,`group:${GROUP}:701`,`group:${GROUP}:702`,`group:${GROUP}:703`,`group:${OTHER}:704`,
  ]);
  for(const index of [1,3]) assert.deepEqual(messages[index].addressing,{mentions:[],reference:'unknown',quoteConflict:true});
  assert.deepEqual(messages[4].addressing,{mentions:[],reference:'other'});
  assert.deepEqual(f.events,[
    {accountId:ACCOUNT,groupId:GROUP,authorId:MEMBER,operatorId:OPERATOR,messageId:'700',observed:true},
    {accountId:ACCOUNT,groupId:GROUP,authorId:MEMBER,operatorId:MEMBER,messageId:'700',observed:false},
  ]);
  await assert.rejects(f.client.sendGroupText({groupId:GROUP,senderId:MEMBER},'不应发送',stale),{code:'stale_context'});
  assert.deepEqual(f.calls, []);
  const receipt=await f.client.sendGroupText({groupId:OTHER,senderId:MEMBER},'正常发送',messages[0].contextToken,'synthetic');
  assert.deepEqual(receipt,{id:'900',clientId:'synthetic'});
  assert.deepEqual(f.calls.map(call=>call.action),['send_group_msg']);
});

test('wrong group, author, operator, stale time and typed text cannot authorize a group recall',async t=>{
  const f=await fixture(t,{onRecall:()=>true});
  f.emit(700,[text('原来的消息')]);
  const now=NOW/1000;
  for(const fields of [
    {group_id:OUTSIDE},{user_id:OPERATOR},{operator_id:0},{message_id:'../../wrong'}, {time:now-1},
    {time:now+61},{time:String(now)},{self_id:undefined},
    {post_type:'message',message_type:'group',sub_type:'normal',message:[text('撤回 700')]},
  ]) f.recall(fields);
  assert.equal(f.events.length,0);
  assert.equal((await f.poll()).some(row=>row.text==='原来的消息'),true);
  assert.deepEqual(f.calls,[]);
});

test('a missing local source needs strict synchronous durable proof and repeated confirmation stays idempotent',async t=>{
  const f=await fixture(t,{onRecall:event=>{
    if(event.messageId==='810')return true;
    if(event.messageId==='811')return 1;
    if(event.messageId==='812')return Promise.reject(Error('synthetic incompatible callback'));
    return false;
  }});
  for(const id of [810,811,812,813])f.recall({message_id:id});
  f.recall({message_id:810,operator_id:MEMBER});
  for(const id of [810,811,812,813])f.emit(id,[text('同一原始短消息编号')]);
  f.emit(814,[reply(810),text('已确认的撤回引用')]);
  f.emit(815,[reply(811),text('未确认的撤回引用')]);
  const messages=await f.poll();
  assert.deepEqual(f.events.map(({messageId,observed})=>[messageId,observed]),[
    ['810',false],['811',false],['812',false],['813',false],['810',false],
  ]);
  assert.deepEqual(messages.map(row=>row.id),[811,812,813,814,815].map(id=>`group:${GROUP}:${id}`));
  assert.equal(messages[3].addressing.quoteConflict,true);
  assert.deepEqual(messages[4].addressing,{mentions:[],reference:'other'});
  assert.deepEqual(f.calls,[]);
});

test('an exact duplicate may retry a failed durable callback without repeating transport removal',async t=>{
  let failed=true;
  const f=await fixture(t,{onRecall:()=>{
    if(failed){failed=false;throw Error('synthetic pending atomic write');}
    return true;
  }});
  f.emit(700,[text('撤回失败重试的正文')]);
  f.recall();
  f.recall({user_id:OPERATOR});
  f.emit(701,[reply(700),text('撤回后的独立跟帖')]);
  f.recall();
  const rows=await f.poll();
  assert.deepEqual(rows.map(row=>row.id),[`group:${GROUP}:701`]);
  assert.deepEqual(rows[0].addressing,{mentions:[],reference:'unknown',quoteConflict:true});
  assert.deepEqual(f.events.map(({authorId,observed})=>[authorId,observed]),[[MEMBER,true],[MEMBER,false]]);
  assert.deepEqual(f.calls,[]);
});

test('a conflicting author or colliding own receipt cannot activate durable recall',async t=>{
  const f=await fixture(t,{onRecall:()=>true,sendId:700});
  const bytes=png(2,2,{metadata:false});
  await f.client.sendGroupImage(GROUP,bytes,'synthetic-receipt');
  f.recall({user_id:MEMBER});
  f.emit(700,[text('与已确认回执编号冲突的另一个作者')]);
  f.recall({user_id:MEMBER});
  f.recall({user_id:ACCOUNT});
  assert.deepEqual(f.events,[]);
  const [row]=await f.poll();
  assert.equal(row.text,'与已确认回执编号冲突的另一个作者');
});

test('an observed own-image recall clears its retained PNG and closes exact quote access without erasing the accepted send',async t=>{
  const f=await fixture(t,{groupImageIds:[GROUP],sendId:700});
  const scopeId='synthetic-group-role',bytes=png(2,2,{metadata:false});
  const sent=await f.client.sendGroupImage(GROUP,bytes,'synthetic-image',undefined,{scopeId});
  f.emit(701,[reply(700),text('请描述刚刚的图')]);
  const [quoted]=await f.poll();
  const {source}=quoted.image;
  assert.equal(source.kind,'qq-group-sent-image');
  const binding=f.client.bindGroupImageRead(quoted,undefined,{sentScopeId:scopeId});
  try{
    assert.equal(f.client.hasCurrentGroupSentImage(source,scopeId),true);
    const before=f.calls.length;
    f.recall({user_id:ACCOUNT});
    assert.equal(binding.signal.aborted,true);
    assert.equal(f.client.hasCurrentGroupSentImage(source,scopeId),false);
    assert.throws(()=>binding.readSentImage(),{code:'cancelled'});
    assert.deepEqual(sent,{outcome:'accepted',messageId:'700'});
    assert.equal(f.calls.length,before);
    assert.deepEqual(f.events,[{accountId:ACCOUNT,groupId:GROUP,authorId:ACCOUNT,operatorId:OPERATOR,messageId:'700',observed:true}]);
    f.emit(702,[reply(700),text('请问那张图')]);
    const [late]=await f.poll();
    assert.equal(late.image,undefined);
    assert.deepEqual(late.addressing,{mentions:[],reference:'unknown',quoteConflict:true});
  }finally{binding.release();}
});
