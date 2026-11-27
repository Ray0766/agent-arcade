'use strict';

const path=require('node:path');
const {Worker}=require('node:worker_threads');
const {fail}=require('./store.cjs');

const ordinaryDirectPhoto=` AND m.body='' AND m.sender IN (?,?)
  AND NOT EXISTS (SELECT 1 FROM message_stickers s WHERE s.message=m.id)
  AND NOT EXISTS (SELECT 1 FROM message_drawings d WHERE d.message=m.id)`;

function requireDirectPhotoAlbum(store,chat){
  if(chat.type!=='direct'||chat.friendRemoved||
    [chat.first_user,chat.second_user].some(number=>store.user(number).kind!=='human'))
    fail(404,'direct_photos_unavailable','这段私聊的共享照片不可查看');
}

function authorizedPhoto(store,account,chat,id,revision){
  const membership=store.access(account,chat);
  if(membership.membershipRevision!==revision)fail(404,'unknown_image','照片不可查看');
  const direct=membership.type==='direct';
  if(direct)requireDirectPhotoAlbum(store,membership);
  const ordinary=direct?ordinaryDirectPhoto:'';
  const image=store.one(`SELECT i.digest FROM messages m JOIN message_images i ON i.message=m.id
    WHERE m.chat=? AND m.id=? AND m.id>? AND m.removed=0${ordinary}`,
    chat,id,membership.since,...(direct?[membership.first_user,membership.second_user]:[]));
  if(!image)fail(404,'unknown_image','照片不可查看');
  return image.digest;
}
function resize(image){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'photo-thumbnail-worker.cjs'),{
      workerData:{mime:image.mime,bytes:image.bytes,edge:192},resourceLimits:{maxOldGenerationSizeMb:256}
    });
    const timer=setTimeout(()=>void worker.terminate(),12000);
    worker.once('message',bytes=>resolve(Buffer.from(bytes)));
    worker.once('error',reject);
    worker.once('exit',()=>{clearTimeout(timer);reject(new Error('thumbnail unavailable'));});
  });
}

function createPhotoThumbnails(store){
  const cached=new Map(),pending=new Map();
  let queue=Promise.resolve();
  return async function read(account,chat,id,revision){
    const check=()=>authorizedPhoto(store,account,chat,id,revision);
    const digest=check();
    if(cached.has(digest))return cached.get(digest);
    if(!pending.has(digest)){
      if(pending.size>=32)fail(503,'thumbnail_busy','预览图暂时不可用');
      const job=queue.then(async()=>{
        check();
        const image=store.messageImage(account,chat,id);
        const result=await resize(image);
        if(cached.size>=128)cached.delete(cached.keys().next().value);
        cached.set(digest,result);
        return result;
      });
      pending.set(digest,job);
      queue=job.catch(()=>{}).finally(()=>pending.delete(digest));
    }
    let result;
    try{result=await pending.get(digest);}
    catch(error){if(error.status)throw error;fail(422,'thumbnail_unavailable','预览图暂时不可用');}
    check();
    return result;
  };
}

module.exports={createPhotoThumbnails,ordinaryDirectPhoto,requireDirectPhotoAlbum};
