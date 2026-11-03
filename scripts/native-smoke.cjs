'use strict';
// Real Electron UI, system Node, stdio MCP and local broker. Model/WeChat are fixtures.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {z}=require('zod');
const {NativeBroker}=require('../src/bot/native-broker.cjs');
const {createNativeLaunch}=require('../src/bot/native-launch.cjs');
async function until(predicate){const end=Date.now()+7000;while(!predicate()){if(Date.now()>end)throw Error('Native fixture timed out');await new Promise(r=>setTimeout(r,10));}}
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"arcade native ' 中文-"));
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({language:'en'}));
  const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'observer.json')};delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=process.env.ARCADE_EXECUTABLE||require('electron'),profile=`--user-data-dir=${path.join(root,'electron-profile')}`;
  const app=await electron.launch({executablePath,args:process.env.ARCADE_EXECUTABLE?[profile]:[path.resolve(__dirname,'..'),profile],env});
  let broker,client,launch;
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('#bot-mode').waitFor();assert.equal(await page.locator('.version').textContent(),'v0.3');
    assert.equal(await page.locator('#bot-mode').inputValue(),'api');
    await page.locator('#bot-key').fill('fixture-invalid-api-key');await page.locator('#bot-save').click();
    await page.waitForFunction(async()=> (await window.arcade.snapshot()).bot.hasKey);
    await page.locator('#bot-mode').selectOption('native');await page.locator('#bot-native-options').waitFor();
    assert.equal(await page.locator('#bot-api-options').isVisible(),false);
    assert.equal((await page.evaluate(()=>window.arcade.snapshot())).bot.hasKey,true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'bot-config.json'),'utf8')).mode,'native');
    await page.locator('#bot-mode').selectOption('api');await page.locator('#bot-api-options').waitFor();
    assert.equal((await page.evaluate(()=>window.arcade.snapshot())).bot.hasKey,true);
    await page.locator('#bot-mode').selectOption('native');await page.locator('#language').click();
    await page.locator('#bot-native-options').filter({hasText:'Ctrl+C'}).waitFor();
    await page.evaluate(()=>window.arcade.botForget());assert.equal(fs.existsSync(path.join(root,'bot-vault.json')),false);
    const outbound=[];broker=await new NativeBroker({send:async text=>outbound.push(text)}).start();const capability=broker.token;
    const appRoot=await app.evaluate(({app})=>app.getAppPath());
    launch=createNativeLaunch({root,workspace:root,node:process.execPath,cli:process.execPath,sourceDir:path.join(appRoot,'src','bot'),url:broker.url,token:capability});
    assert(!launch.command.includes(capability));
    const config=JSON.parse(fs.readFileSync(launch.file,'utf8')).mcpServers['agent-arcade-wechat'];
    const transport=new StdioClientTransport({...config,stderr:'pipe'});let protocol='',stderr='';transport.setProtocolVersion=v=>{protocol=v;};
    transport.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
    client=new Client({name:'arcade-native-package-fixture',version:'0.0.0'},{capabilities:{}});const received=[];
    client.setNotificationHandler(z.object({method:z.literal('notifications/claude/channel'),params:z.object({content:z.string(),meta:z.record(z.string(),z.string())})}),e=>{received.push(e);});
    client.setNotificationHandler(z.object({method:z.literal('notifications/claude/channel/permission'),params:z.object({request_id:z.string(),behavior:z.enum(['allow','deny'])})}),e=>{received.push(e);});
    await client.connect(transport);await until(()=>broker.nativeSnapshot().attached);assert.equal(protocol,'2025-11-25');
    await broker.receive({id:'fixture-1',text:'Synthetic package check, no model task.',contextToken:'fixture-context'});
    await until(()=>received.some(e=>e.method==='notifications/claude/channel'));
    assert.deepEqual(outbound,[],'Receiving a normal message must not send a transport acknowledgement to WeChat');
    const id=received.find(e=>e.method==='notifications/claude/channel').params.meta.task_id;
    const reply=await client.callTool({name:'reply',arguments:{id,text:'Synthetic response; no task success is claimed.'}});assert(!reply.isError);
    assert.deepEqual(outbound,['Synthetic response; no task success is claimed.'],'The owner receives only the reply body, without a fixed diagnostic prefix');
    await client.notification({method:'notifications/claude/channel/permission_request',params:{request_id:'abcde',tool_name:'Write',description:'Synthetic fixture',input_preview:'{"file_path":"fixture.txt"}'}});
    await until(()=>broker.pending.size===1);const code=broker.snapshot().pending[0].code;
    await broker.receive({id:'fixture-approval',text:`/allow ${code}`,contextToken:'fixture-context'});
    await until(()=>received.some(e=>e.method==='notifications/claude/channel/permission'));
    assert.equal(received.at(-1).params.behavior,'allow');assert.equal(broker.replies,1);assert(!stderr.includes(capability));
    // Revoke from the application side. A forcibly killed CLI/MCP process can
    // only be detected by the broker lease; it cannot promise a final detach.
    await broker.close();await client.close();client=null;launch.cleanup();assert.equal(fs.existsSync(launch.file),false);
    const state={...await page.evaluate(()=>window.arcade.snapshot())};
    await page.evaluate(next=>{
      data=next;renderBot({...data,bot:{...data.bot,mode:'native',workspace:'F:\\Example\\orbit-api',status:'connected',paired:true,hasKey:false,native:{command:"Set-Location -LiteralPath 'F:\\Example\\orbit-api'\nclaude --allowedTools mcp__agent-arcade-wechat__reply --permission-mode default --mcp-config 'F:\\Example\\private-mcp.json' --dangerously-load-development-channels server:agent-arcade-wechat",attached:true,forwarded:1,replies:1},tasks:{messages:[{role:'user',text:'合成样例：你好，能帮我做什么？'},{role:'assistant',text:'合成样例：可以查看项目、修改文件、检查结果。直接把任务发给我就好。'}],pending:[],tasks:[]}}});document.querySelector('.bot-preview').textContent='合成界面样例 · 未连接微信或Claude模型。';
    },state);
    assert.equal(await page.locator('#bot-api-options').isVisible(),false);assert.equal(await page.locator('#bot-mascot').getAttribute('class'),'scene idle');
    assert.equal(await page.locator('#bot-connection-details').getAttribute('open'),null);
    assert.equal(await page.locator('#bot-connection-state').isVisible(),false);
    assert.doesNotMatch(await page.locator('#bot-task-state').textContent(),/MCP|CLI 回传|平台受理|已提交本机通道/);
    await page.locator('#toast').waitFor({state:'hidden'});fs.mkdirSync('outputs',{recursive:true});
    await page.screenshot({path:process.env.ARCADE_EXECUTABLE?'outputs/native-packaged.png':'outputs/native-source.png',fullPage:true});
    assert.deepEqual(errors,[]);
    const receipt={stage:process.env.ARCADE_EXECUTABLE?'packaged':'source',ui:'passed',modeSwitch:'API key retained; native configuration persisted',nativeMcp:'real system Node + stdio + authenticated local HTTP',protocol,reply:'accepted by fixture transport',permissionRelay:'fixture native request and one-use allow',cleanup:'broker revoked and private configuration removed',liveClaudeRegistration:false,liveModel:false,liveWeChat:false};
    fs.writeFileSync(process.env.ARCADE_EXECUTABLE?'outputs/native-packaged.json':'outputs/native-source.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }finally{
    await client?.close();await broker?.close();launch?.cleanup();await app.close();assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
