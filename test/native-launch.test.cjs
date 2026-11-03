'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createNativeLaunch}=require('../src/bot/native-launch.cjs');
test('native launch fixture: private MCP capability never enters copied command or project settings',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"arcade native ' 中文-"));t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const token='f'.repeat(64),cli=process.execPath,workspace=path.join(root,"project ' test");fs.mkdirSync(workspace);
  const launch=createNativeLaunch({root,workspace,token,url:'http://127.0.0.1:41321',node:process.execPath,cli,sourceDir:path.resolve('src/bot')});
  const cfg=JSON.parse(fs.readFileSync(launch.file,'utf8')).mcpServers['agent-arcade-wechat'];
  assert.equal(cfg.env.ARCADE_BRIDGE_TOKEN,token);assert.equal(cfg.command,process.execPath);assert(fs.existsSync(cfg.args[0]));
  assert.equal(launch.command.includes(token),false);assert.equal(launch.command.includes('--bare'),false);assert.equal(launch.command.includes('ANTHROPIC_API_KEY'),false);
  assert(launch.command.includes('--dangerously-load-development-channels'));assert.equal(fs.existsSync(path.join(workspace,'.mcp.json')),false);
  if(process.platform==='win32')assert(launch.command.includes("project '' test"));
  launch.cleanup();assert.equal(fs.existsSync(launch.file),false);
});
