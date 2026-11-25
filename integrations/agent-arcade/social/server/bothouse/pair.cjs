'use strict';
const {databasePath}=require('../config.cjs');
const {SocialStore}=require('../store.cjs');
const {localInstance}=require('./directory.cjs');
const {issue,revoke,shareProject}=require('./pairing.cjs');

async function main([operation,account,mode,...values]) {
  const request=localInstance();
  if(operation==='projects'){
    const result=await request({action:'authority'});
    if(!result?.projects)throw Error('本机 Bothouse 目录暂不可用');
    console.log(JSON.stringify(result.projects.map(({id,displayName,selectable})=>({id,displayName,selectable})),null,2));
    return;
  }
  if ((operation==='share'||operation==='unshare') && account && mode && !values.length) {
    const store=new SocialStore(databasePath());
    try {console.log(JSON.stringify(await shareProject(store,request,operation,account,mode)));}
    finally {store.db.close();}
    return;
  }
  if(!account || (operation!=='revoke' && (operation!=='issue' ||
      !((mode==='--identity' && values.length===1) || (mode==='--projects' && values.length>0)))))
    throw Error('Usage: node pair.cjs projects | issue ACCOUNT --identity USER_ID | issue ACCOUNT --projects PROJECT... | share ACCOUNT PROJECT | unshare ACCOUNT PROJECT | revoke ACCOUNT');
  const store=new SocialStore(databasePath());
  try{
    if(operation==='revoke'){
      revoke(store,account.toLowerCase());
      console.log('已解除本账号配对');
    }else{
      const grant=await issue(store,request,account,mode==='--identity'?{identity:values[0]}:{projects:values});
      console.log(JSON.stringify(grant));
    }
  }finally{store.db.close();}
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
