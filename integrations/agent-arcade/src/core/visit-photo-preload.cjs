'use strict';

const {contextBridge,ipcRenderer}=require('electron');
const worldPage=process.argv.find(arg=>arg.startsWith('--arcade-world-page='))?.slice('--arcade-world-page='.length);
if(process.isMainFrame&&location.href===worldPage){
  contextBridge.exposeInMainWorld('arcadeGameWindow',{
    onMinimizedChange(listener){
      if(typeof listener!=='function')throw new TypeError('Expected a listener');
      const changed=(_event,minimized)=>{if(typeof minimized==='boolean')listener(minimized);};
      ipcRenderer.on('arcade:worldMinimized',changed);
      return ()=>ipcRenderer.removeListener('arcade:worldMinimized',changed);
    },
  });
}
const target=process.argv.find(arg=>arg.startsWith('--arcade-photo-page='))?.slice('--arcade-photo-page='.length);
if(process.isMainFrame&&location.href===target){
  contextBridge.exposeInMainWorld('arcadeVisitPhoto',{
    async bringBack(bytes){
      if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength)return {ok:false,reason:'invalid_image'};
      if(bytes.byteLength>4194304)return {ok:false,reason:'too_large'};
      try{return await ipcRenderer.invoke('arcade:bringBackVisitPhoto',bytes);}
      catch{return {ok:false,reason:'unavailable'};}
    },
  });
}
