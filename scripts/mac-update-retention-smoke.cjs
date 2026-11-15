'use strict';
// Two actual ad-hoc signed packages, actual Keychain and SQLite, fake key only.
// Test-only entry remaps the Keychain name and enters production main directly
// so it cannot focus/control the owner's running application. No product bypass.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
// Optional local staging avoids a synchronised Desktop dependency tree. The
// caller must stage current src/package files and the pinned runtime modules.
const buildProject=process.env.ARCADE_RETENTION_BUILD_PROJECT?fs.realpathSync(process.env.ARCADE_RETENTION_BUILD_PROJECT):project;
const {_electron:electron}=require(require.resolve('playwright',{paths:[buildProject]}));
const {buildIdentity}=require('../src/core/update-backup.cjs');
async function command(args,log){
  const fd=fs.openSync(log,'w');
  try{await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:project,env:process.env,stdio:['ignore',fd,fd],shell:false});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Build failed; see isolated build log.')));});}finally{fs.closeSync(fd);}
}
function fixtureEntry(){
  const {app}=require('electron'),path=require('node:path');
  const src=path.join(process.resourcesPath,'app.asar','src');
  const identity=require(path.join(src,'core/app-identity.cjs')),configure=identity.configureAppIdentity;
  identity.configureAppIdentity=()=>configure({setName:name=>{if(name!=='agent-arcade')throw Error('Unexpected production identity');app.setName(process.env.ARCADE_FIXTURE_NAME);}},{platform:'darwin'});
  globalThis.retentionProbe={requests:0,keyMatched:false};
  globalThis.fetch=async(url,init)=>{
    if(url!=='https://api.deepseek.com/chat/completions')throw Error('Network blocked by retention probe');
    const p=globalThis.retentionProbe,body=JSON.parse(init.body);p.requests++;p.keyMatched=init.headers.Authorization==='Bearer fixture-update-retention-key';
    const text='隔离更新测试：聊天和记忆都保留。';
    if(!body.stream)return Response.json({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]});
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  require(path.join(src,'main.cjs'));
}
(async()=>{
  assert.equal(process.platform,'darwin');
  const sourceIdentity=buildIdentity({appPath:project});
  assert.equal(buildIdentity({appPath:buildProject}),sourceIdentity,'Staged code/package metadata must match current source.');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-update-retention-'))),home=path.join(root,'data'),profile=path.join(root,'profile');
  fs.mkdirSync(home,{mode:0o700});fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({language:'zh',notifications:false}));
  const out=process.env.ARCADE_RETENTION_OUTPUT?path.resolve(process.env.ARCADE_RETENTION_OUTPUT):path.join(project,'outputs/update-retention');fs.mkdirSync(out,{recursive:true});
  const entry=path.join(root,'retention-fixture.cjs');fs.writeFileSync(entry,`(${fixtureEntry.toString()})();\n`);
  const fixtureName='agent-arcade-retention-fixture-'+Date.now();
  const receipt={syntheticProvider:true,realUserData:false,realCredentials:false,stagedBuild:buildProject!==project,sourceIdentity,keychainService:fixtureName+' Safe Storage',checks:[],packages:[]};
  const env={...process.env,AGENT_ARCADE_HOME:home,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'observer.json'),ARCADE_FIXTURE_NAME:fixtureName};delete env.ELECTRON_RUN_AS_NODE;
  const packageBase=JSON.parse(fs.readFileSync(path.join(project,'package.json'))).build;
  let app,page;
  const launch=async executable=>{
    app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env,timeout:30000});page=await app.firstWindow();page.setDefaultTimeout(15000);
    assert.equal(await app.evaluate(({app})=>app.name),fixtureName);
  };
  const send=async text=>{await page.locator('#desktop-chat-input').fill(text);await page.locator('#desktop-chat-send').click();await page.waitForFunction(async()=>{const s=await arcade.snapshot();return !s.desktopChat.busy&&!s.bot.local.streaming&&s.bot.local.history.at(-1)?.role==='assistant';});};
  try{
    for(const round of ['A','B']){
      const output=path.join(root,'build-'+round),config=path.join(root,'config-'+round+'.json');
      fs.writeFileSync(config,JSON.stringify({...packageBase,directories:{output},...(buildProject!==project?{npmRebuild:false}:{}),files:[...packageBase.files,{from:path.dirname(entry),to:'.',filter:['retention-fixture.cjs']}],extraMetadata:{main:'retention-fixture.cjs',retentionFixture:round},mac:{...packageBase.mac,extendInfo:{CFBundleVersion:round==='A'?'20261115.1':'20261115.2'}}}));
      await command([require.resolve('electron-builder/cli.js',{paths:[buildProject]}),'--projectDir='+buildProject,'--dir','--mac','--config='+config],path.join(out,'build-'+round+'.log'));
      const bundle=path.join(output,'mac-arm64','Agent Arcade.app'),executable=path.join(bundle,'Contents/MacOS/Agent Arcade');
      execFileSync('codesign',['--verify','--deep','--strict',bundle]);
      // codesign writes successful display output to stderr.
      const display=spawn('codesign',['-dv','--verbose=4',bundle],{stdio:['ignore','pipe','pipe']});let info='';for await(const chunk of display.stderr)info+=chunk;
      receipt.packages.push({round,cdHash:/CDHash=(\w+)/.exec(info)?.[1]||'',signature:/Signature=([^\n]+)/.exec(info)?.[1]||'',path:bundle});
      await launch(executable);
      if(round==='A'){
        await page.locator('#first-run-card [data-provider="deepseek"]').click();await page.locator('#first-run-key').fill('fixture-update-retention-key');await page.locator('#first-run-save').click();await page.locator('#desktop-chat-input').waitFor();
        await send('记住：更新测试偏好是松针绿。');await send('这是更新前的聊天。');
        const s=await page.evaluate(()=>arcade.snapshot());receipt.beforeHistory=s.bot.local.history.map(m=>m.text);
        receipt.checks.push('Package A saved fake key through Keychain and persisted chat/memory.');
      }else{
        await page.locator('#desktop-chat-input').waitFor();const s=await page.evaluate(()=>arcade.snapshot());
        assert.equal(s.bot.credentialState,'ready');assert.deepEqual(s.bot.local.history.map(m=>m.text),receipt.beforeHistory);
        await send('更新后继续聊天。');assert.equal(await app.evaluate(()=>globalThis.retentionProbe.keyMatched),true);
        const status=(await page.evaluate(()=>arcade.snapshot())).bot.local.memory;
        assert(JSON.stringify(status).includes('松针绿'));
        receipt.checks.push('Package B reopened the same fake key, chat and memory, and replied via stand-in.');
        assert(fs.readdirSync(path.join(home,'update-backups')).filter(n=>!n.startsWith('.')).length>=2);
        receipt.checks.push('Same-version changed build identity created a pre-open data snapshot.');
      }
      await page.screenshot({path:path.join(out,'package-'+round+'.png'),fullPage:true,animations:'disabled'});
      await app.close();app=null;
    }
    assert(receipt.packages.every(p=>p.cdHash));assert.notEqual(receipt.packages[0].cdHash,receipt.packages[1].cdHash);
    delete receipt.beforeHistory;receipt.passed=true;
  }finally{
    if(app){await page?.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});await app.close().catch(()=>{});}
    // Only synthetic content was used; omit its transcript from the receipt too.
    delete receipt.beforeHistory;fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  }
  console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,distinctAdHocHashes:receipt.packages.length===2&&receipt.packages[0].cdHash!==receipt.packages[1].cdHash}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
