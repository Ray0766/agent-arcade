'use strict';
// Fresh-profile package startup only. No keys, model calls or production data.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const asar=require('@electron/asar');
(async()=>{
  const executable=process.env.ARCADE_EXECUTABLE;if(!executable||!path.isAbsolute(executable))throw Error('Set ARCADE_EXECUTABLE to the packaged Mac executable.');
  const contents=path.dirname(path.dirname(executable)),archive=path.join(contents,'Resources','app.asar');
  const changed=execFileSync('git',['diff','--name-only','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  for(const file of changed)assert.deepEqual(asar.extractFile(archive,file),fs.readFileSync(file),file+' differs from source');
  assert(!asar.listPackage(archive).some(file=>/@anthropic-ai\/claude-agent-sdk/.test(file)));
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-package-mac-'))),out=path.resolve('outputs/mac-package-smoke');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'zh'}));
  const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'settings.json')};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${path.join(root,'profile')}`],env});
  const receipt={realModel:false,realCredentials:false,packaged:true,changedSourcesMatched:changed.length,proprietarySDKAbsent:true,errors:[]};
  try{
    const page=await app.firstWindow();page.on('pageerror',e=>receipt.errors.push(e.message));await page.locator('#first-run-card').waitFor();
    assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
    const capabilities=await page.evaluate(()=>({os:arcade.platform.os,voice:arcade.platform.voice,qq:Object.keys(arcade).filter(k=>/^qq[A-Z]/.test(k))}));
    assert.deepEqual(capabilities,{os:'darwin',voice:false,qq:[]});
    assert.equal(await page.locator('#first-run-key').inputValue(),'');
    assert(await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.some(item=>item.submenu?.items.some(child=>child.role==='copy'))));
    await page.screenshot({path:path.join(out,'first-run.png'),fullPage:true});
    assert.deepEqual(receipt.errors,[]);receipt.passed=true;
  }finally{await app.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');}
  console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(error);process.exitCode=1;});
