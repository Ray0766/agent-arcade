'use strict';

const {fail}=require('./store.cjs');
const pageSize=24;

function groupSharedFiles(store,account,chatId,params){
  const chat=store.group(account,chatId);
  const cursor=params.get('before');
  const before=cursor===null?Number.MAX_SAFE_INTEGER:Number(cursor);
  if(cursor!==null&&(!/^[1-9]\d*$/u.test(cursor)||!Number.isSafeInteger(before)))
    fail(400,'cursor','附件位置无效，请重新打开列表');
  const query=(params.get('q')??'').trim();
  if(query.length>100)fail(400,'group_file_query','文件名关键词最多 100 字');
  const rows=store.all(
    `SELECT m.* FROM messages m JOIN message_files f ON f.message=m.id
     WHERE m.chat=? AND m.id>? AND m.id<? AND m.removed=0
       AND (?='' OR instr(lower(f.name),lower(?))>0)
     ORDER BY m.id DESC LIMIT ?`,chatId,chat.since,before,query,query,pageSize+1);
  const page=rows.slice(0,pageSize);
  return {items:page.map(row=>store.message(row)),nextBefore:rows.length>pageSize?page.at(-1).id:null,
    membershipRevision:chat.membershipRevision};
}
module.exports={groupSharedFiles};
