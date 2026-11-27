'use strict';

const {randomUUID}=require('node:crypto');
const {dimensions}=require('./static-image.cjs');

// One departure per window. The shell carries only a one-use return receipt.
function createVisitPhotoReturn(){
  let source, pending, timer, epoch=0;
  function clear(){
    ++epoch;
    source=pending=undefined;
    clearTimeout(timer);
  }
  return {
    clear,
    depart(binding){clear();source=binding;},
    claim(friend){
      const bound=source;
      if(!bound||!bound.current()||!friend||bound.visitId!==friend.visitId||
          bound.account!==friend.account||bound.number!==friend.number)return;
      source=undefined;
      const visit=epoch;
      return {
        current:()=>visit===epoch&&bound.current(),
        stage(bytes,planet){
          if(visit!==epoch||!bound.current()||pending)return;
          const receipt=randomUUID();
          pending={bound,receipt,bytes,planet};
          timer=setTimeout(clear,15000);
          timer.unref();
          return receipt;
        },
      };
    },
    cancel(receipt){if(receipt&&pending?.receipt===receipt)clear();},
    receive(receipt){
      if(!pending||pending.receipt!==receipt)return;
      const {bound,bytes,planet}=pending;
      clear();
      if(bound.current())bound.deliver(bytes,planet);
    },
  };
}

// Installed only on the WebContents of an authorized friend visit.
function installVisitPhoto({wc,binding,page,planet,current,authorize,onReturn,
  decodePng=buffer=>!require('electron').nativeImage.createFromBuffer(buffer).isEmpty()}){
  const frame=wc.mainFrame;
  let live=true,busy=false,receipt;
  const valid=()=>live&&current()&&!wc.isDestroyed()&&wc.mainFrame===frame&&
    frame.url===page&&binding.current();
  wc.on('did-start-navigation',(_event,_url,_inPlace,isMain)=>{if(isMain)live=false;});
  wc.ipc.handle('arcade:bringBackVisitPhoto',async(event,bytes)=>{
    if(event.sender!==wc||event.senderFrame!==frame||!valid()||receipt)return {ok:false,reason:'expired'};
    if(busy)return {ok:false,reason:'unavailable'};
    if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength)return {ok:false,reason:'invalid_image'};
    if(bytes.byteLength>4194304)return {ok:false,reason:'too_large'};
    try{
      const buffer=Buffer.from(bytes);
      dimensions(buffer,'.png');
      if(!decodePng(buffer))return {ok:false,reason:'invalid_image'};
    }
    catch(error){return {ok:false,reason:error.code==='image_too_large'?'too_large':'invalid_image'};}
    busy=true;
    try{
      if(!await authorize()||!valid())return {ok:false,reason:'expired'};
      receipt=binding.stage(bytes,planet);
      if(!receipt)return {ok:false,reason:'expired'};
      onReturn(receipt);
      return {ok:true};
    }catch{return {ok:false,reason:valid()?'unavailable':'expired'};}
    finally{busy=false;}
  });
  return ()=>receipt;
}

module.exports={createVisitPhotoReturn,installVisitPhoto};
