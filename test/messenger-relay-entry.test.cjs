'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawnSync}=require('node:child_process');
const {configuration,startRelay}=require('../scripts/messenger-relay.cjs');
const env=dir=>({MESSENGER_APP_ID:'110001',MESSENGER_PAGE_ID:'220001',MESSENGER_OWNER_ID:'330001',MESSENGER_RELAY_DATABASE:path.join(dir,'relay.sqlite'),MESSENGER_APP_SECRET:'a'.repeat(32),MESSENGER_VERIFY_TOKEN:'v'.repeat(32),MESSENGER_RELAY_TOKEN:'r'.repeat(43)});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-messenger-entry-'));t.after(()=>{assert(fs.realpathSync(dir).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
test('relay configuration requires three separate secrets and a private absolute database; no host override exists',t=>{
  const dir=fixture(t),value=env(dir);assert.equal(configuration({...value,MESSENGER_RELAY_HOST:'0.0.0.0'}).port,8787);
  for(const change of [{MESSENGER_RELAY_DATABASE:'relative.sqlite'},{MESSENGER_RELAY_PORT:'0'},{MESSENGER_RELAY_PORT:'1e3'},{MESSENGER_OWNER_ID:value.MESSENGER_PAGE_ID},{MESSENGER_RELAY_TOKEN:value.MESSENGER_APP_SECRET},{MESSENGER_APP_SECRET:'short'}])assert.throws(()=>configuration({...value,...change}),{code:'invalid_config'});
});
test('explicit entry starts only loopback, supports authenticated status and closes without a lingering listener',async t=>{
  const dir=fixture(t),value=configuration(env(dir)),running=await startRelay({...value,port:0});
  try{assert.equal(running.host,'127.0.0.1');const url=`http://${running.host}:${running.port}/v1/status`;
    assert.equal((await fetch(url)).status,403);const result=await fetch(url,{headers:{authorization:`Bearer ${value.authToken}`}});assert.equal(result.status,200);assert.equal((await result.json()).pageId,value.pageId);
  }finally{assert.deepEqual(await running.close(),{closed:true});assert.deepEqual(await running.close(),{closed:true});}
  await assert.rejects(fetch(`http://127.0.0.1:${running.port}/v1/status`));
});
test('occupied port failure closes its database and does not fall back to another address or port',async t=>{
  const dir=fixture(t),occupied=net.createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));
  try{await assert.rejects(startRelay({...configuration(env(dir)),port:occupied.address().port}),{code:'listen_failed'});}
  finally{await new Promise(r=>occupied.close(r));}
  const next=await startRelay({...configuration(env(dir)),port:0});await next.close();
});
test('CLI failure emits only a fixed code, without secrets or database paths',t=>{
  const dir=fixture(t),values=env(dir);values.MESSENGER_RELAY_PORT='bad';
  const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/messenger-relay.cjs')],{env:{...process.env,...values},encoding:'utf8',windowsHide:true,timeout:5000});
  assert.equal(result.status,1);assert.match(result.stderr,/invalid_config/);assert(!result.stderr.includes(dir));assert(!result.stderr.includes(values.MESSENGER_APP_SECRET));assert.equal(result.stdout,'');
});
