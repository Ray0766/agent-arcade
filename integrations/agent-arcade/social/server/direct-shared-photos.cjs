'use strict';

const {fail}=require('./store.cjs');
const {ordinaryDirectPhoto,requireDirectPhotoAlbum}=require('./photo-thumbnail.cjs');
const pageSize=24;

function directSharedPhotos(store,account,chatId,params){
  const chat=store.access(account,chatId);
  requireDirectPhotoAlbum(store,chat);
  const cursor=params.get('before');
  const before=cursor===null?Number.MAX_SAFE_INTEGER:Number(cursor);
  if(cursor!==null&&(!/^[1-9]\d*$/u.test(cursor)||!Number.isSafeInteger(before)))
    fail(400,'cursor','附件位置无效，请重新打开列表');
  const rows=store.all(`SELECT m.* FROM messages m JOIN message_images a ON a.message=m.id
    WHERE m.chat=? AND m.id>? AND m.id<? AND m.removed=0${ordinaryDirectPhoto}
    ORDER BY m.id DESC LIMIT ?`,
    chatId,chat.since,before,chat.first_user,chat.second_user,pageSize+1);
  const page=rows.slice(0,pageSize);
  return {items:page.map(row=>store.message(row)),nextBefore:rows.length>pageSize?page.at(-1).id:null,
    membershipRevision:chat.membershipRevision};
}

module.exports={directSharedPhotos};
