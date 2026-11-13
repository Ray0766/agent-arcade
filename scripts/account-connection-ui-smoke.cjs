'use strict';
// Real renderer, synthetic connection timing. No desktop, profiles or network.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const executablePath=process.env.ARCADE_HEADLESS_BROWSER||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const out=path.resolve(__dirname,'../outputs');fs.mkdirSync(out,{recursive:true});
 const receipt={synthetic:true,realConnections:false,checks:0,screenshots:[]};
 try{
  const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route(/^https?:/,route=>route.abort());
  await page.setContent('<html lang="zh-CN"><body><main><header>Agent Arcade · synthetic timing fixture</header></main></body></html>');
  for(const file of ['style.css','companions.css'])await page.addStyleTag({content:fs.readFileSync(path.resolve(__dirname,'../src/ui',file),'utf8')});
  await page.evaluate(()=>{
   window.view='bot';window.el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
   window.switchView=name=>{window.view=name;document.getElementById('accounts-view').hidden=name!=='accounts';};
   window.action=async fn=>await fn();
   window.fixture={config:{language:'zh'},personas:[],accounts:{selectedId:'wechat',accounts:[{id:'wechat',name:'微信 · 合成账号',channel:'wechat',mode:'claude',status:'disconnected',credentialState:'ready'}]}};
   window.arcade={snapshot:async()=>structuredClone(window.fixture),accountConnect:async()=>{window.fixture.accounts.accounts[0].status='connecting';},accountDisconnect:async()=>{window.fixture.accounts.accounts[0].status='disconnected';}};
  });
  await page.addScriptTag({path:path.resolve(__dirname,'../src/ui/accounts.js')});await page.evaluate(()=>window.renderAccounts(window.fixture));
  await page.getByRole('button',{name:'管理搭档',exact:true}).click();await page.getByRole('button',{name:'连接',exact:true}).click();
  const feedback=page.locator('#companion-manager-feedback');await feedback.getByText(/正在连接/).waitFor();assert.equal(await feedback.getAttribute('role'),'status');assert.doesNotMatch(await feedback.innerText(),/连接未完成/);receipt.checks+=2;
  const name=page.getByRole('textbox',{name:'搭档名称',exact:true});await name.fill('未保存的名字');
  await page.evaluate(()=>{window.fixture.accounts.accounts[0].status='connected';window.renderAccounts(window.fixture);});
  assert.match(await feedback.innerText(),/社交账号已连接/);assert.equal(await feedback.getAttribute('role'),'status');assert.equal(await name.inputValue(),'未保存的名字');assert.match(await page.locator('.companion-manage-status').innerText(),/已连接/);receipt.checks+=4;
  const image=path.join(out,'account-connection-settled-20261106.png');await page.screenshot({path:image});receipt.screenshots.push(image);
  await page.locator('#companion-manager').getByRole('button',{name:'关闭',exact:true}).click();
  await page.evaluate(()=>{window.fixture.accounts.accounts[0].status='disconnected';window.renderAccounts(window.fixture);});
  await page.getByRole('button',{name:'管理搭档',exact:true}).click();await page.getByRole('button',{name:'连接',exact:true}).click();
  await page.evaluate(()=>{window.fixture.accounts.accounts[0].status='disconnected';window.renderAccounts(window.fixture);});
  assert.match(await feedback.innerText(),/连接未完成/);assert.equal(await feedback.getAttribute('role'),'alert');receipt.checks+=2;
  await page.evaluate(()=>{window.fixture.config.language='en';window.renderAccounts(window.fixture);});
  await page.getByRole('button',{name:'Connect',exact:true}).click();assert.match(await feedback.innerText(),/Connecting; waiting/);assert.equal(await feedback.getAttribute('role'),'status');receipt.checks+=2;
  await page.getByRole('button',{name:'Disconnect',exact:true}).click();assert.match(await feedback.innerText(),/Disconnected/);
  await page.evaluate(()=>{window.fixture.accounts.accounts[0].status='connected';window.renderAccounts(window.fixture);});assert.match(await feedback.innerText(),/Disconnected/);receipt.checks++;
  assert.deepEqual(errors,[]);receipt.checks++;receipt.result='passed';fs.writeFileSync(path.join(out,'account-connection-ui-20261106.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
