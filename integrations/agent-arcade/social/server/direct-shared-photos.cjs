'use strict';

const {fail}=require('./store.cjs');
const {ordinaryDirectPhoto,requireDirectPhotoAlbum}=require('./photo-thumbnail.cjs');
const pageSize=24;

const monthReaders=new WeakSet();
function albumTimeZone(store,value){
  if(!value||value.length>100)fail(400,'album_time_zone','相册时区无效，请重新打开相册');
  try{
    value=new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;
  }catch{
    fail(400,'album_time_zone','相册时区无效，请重新打开相册');
  }
  if(!monthReaders.has(store.db)){
    let formatter;
    let lastZone;
    store.db.function('album_local_month',{deterministic:true},(created,zone)=>{
      if(zone!==lastZone){
        formatter=new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit'});
        lastZone=zone;
      }
      const date=new Date(created);
      if(!Number.isFinite(date.getTime()))return null;
      const parts=formatter.formatToParts(date);
      const year=parts.find(part=>part.type==='year').value.padStart(4,'0');
      return year+'-'+parts.find(part=>part.type==='month').value;
    });
    monthReaders.add(store.db);
  }
  return value;
}

function directSharedPhotos(store,account,chatId,params){
  const chat=store.access(account,chatId);
  requireDirectPhotoAlbum(store,chat);
  const month=params.get('month');
  const months=params.has('months');
  if(month!==null&&!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(month))
    fail(400,'album_month','相册月份无效，请重新选择');
  const timeZone=months||month!==null?albumTimeZone(store,params.get('timeZone')):null;
  const visible=`FROM messages m JOIN message_images a ON a.message=m.id
    WHERE m.chat=? AND m.id>? AND m.removed=0${ordinaryDirectPhoto}`;
  const membership=[chatId,chat.since,chat.first_user,chat.second_user];
  if(months){
    const rows=store.all(`SELECT DISTINCT album_local_month(m.created,?) AS month ${visible}
      ORDER BY month DESC`,timeZone,...membership);
    return {membershipRevision:chat.membershipRevision,months:rows.flatMap(row=>row.month?[row.month]:[])};
  }
  const cursor=params.get('before');
  const before=cursor===null?Number.MAX_SAFE_INTEGER:Number(cursor);
  if(cursor!==null&&(!/^[1-9]\d*$/u.test(cursor)||!Number.isSafeInteger(before)))
    fail(400,'cursor','附件位置无效，请重新打开列表');
  const monthMatch=month===null?'':' AND album_local_month(m.created,?)=?';
  const rows=store.all(`SELECT m.* ${visible} AND m.id<?${monthMatch} ORDER BY m.id DESC LIMIT ?`,
    ...membership,before,...(month===null?[]:[timeZone,month]),pageSize+1);
  const page=rows.slice(0,pageSize);
  return {items:page.map(row=>store.message(row)),nextBefore:rows.length>pageSize?page.at(-1).id:null,
    membershipRevision:chat.membershipRevision};
}

module.exports={directSharedPhotos};
