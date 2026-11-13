'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createNativeLaunch}=require('../src/bot/native-launch.cjs');
test('native launch fixture: private MCP capability never enters copied command or project settings',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"arcade native ' 中文-"));t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const token='f'.repeat(64),cli=process.execPath,workspace=path.join(root,"project ' test");fs.mkdirSync(workspace);
  const launch=createNativeLaunch({root,workspace,token,url:'http://127.0.0.1:41321',node:process.execPath,cli,sourceDir:path.resolve('src/bot')});
  const cfg=JSON.parse(fs.readFileSync(launch.file,'utf8')).mcpServers['agent-arcade-wechat'];
  assert.equal(cfg.env.ARCADE_BRIDGE_TOKEN,token);assert.equal(cfg.command,process.execPath);assert(fs.existsSync(cfg.args[0]));
  assert.equal(cfg.env.ARCADE_PERSONA_VOICE,'1');assert.equal(cfg.env.ARCADE_PERSONA_SELECTION,'default');
  assert.equal(launch.command.includes(token),false);assert.equal(launch.command.includes('--bare'),false);assert.equal(launch.command.includes('ANTHROPIC_API_KEY'),false);
  assert.match(launch.command,/--allowedTools mcp__agent-arcade-wechat__reply --permission-mode default/);
  assert.doesNotMatch(launch.command,/--dangerously-skip-permissions|--permission-mode (?:bypassPermissions|acceptEdits)|mcp__agent-arcade-wechat__\*/);
  assert(launch.command.includes('--dangerously-load-development-channels'));assert.equal(fs.existsSync(path.join(workspace,'.mcp.json')),false);
  assert.equal(launch.cli,cli);assert.equal(launch.workspace,path.resolve(workspace));
  assert.equal(launch.args[launch.args.indexOf('--session-id')+1],launch.sessionId);
  assert.equal(launch.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF,'1');assert.equal(launch.resume,false);
  if(process.platform==='win32')assert(launch.command.includes("project '' test"));
  launch.cleanup();assert.equal(fs.existsSync(launch.file),false);
});

test('native resume binds an exact UUID and never selects the most recent conversation',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-native-resume-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={root,workspace:root,token:'f'.repeat(64),url:'http://127.0.0.1:41321',node:process.execPath,cli:process.execPath,sourceDir:path.resolve('src/bot')};
  for(const value of ['--all','latest','', '1; exit'])assert.throws(()=>createNativeLaunch({...options,resumeSessionId:value}),/exact session UUID/);
  const sessionId='11111111-1111-4111-8111-111111111111';
  const launch=createNativeLaunch({...options,resumeSessionId:sessionId});
  assert.equal(launch.resume,true);assert.equal(launch.sessionId,sessionId);assert.equal(launch.args[launch.args.indexOf('--resume')+1],sessionId);
  assert(!launch.args.includes('--continue'));assert(!launch.args.includes('--session-id'));launch.cleanup();
});

test('native launch passes only fixed persona controls and can disable conversational style',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-persona-launch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const [persona,enabled,selection] of [[{enabled:false,selection:'sprout'},'0','sprout'],[{enabled:'injected instruction',selection:'https://example.invalid'},'0','default']]) {
    const launch=createNativeLaunch({root,workspace:root,token:'f'.repeat(64),url:'http://127.0.0.1:41321',node:process.execPath,cli:process.execPath,sourceDir:path.resolve('src/bot'),persona});
    const cfg=JSON.parse(fs.readFileSync(launch.file,'utf8')).mcpServers['agent-arcade-wechat'];
    assert.equal(cfg.env.ARCADE_PERSONA_VOICE,enabled);assert.equal(cfg.env.ARCADE_PERSONA_SELECTION,selection);
    assert.doesNotMatch(JSON.stringify(cfg),/injected instruction|example.invalid/);
    assert.doesNotMatch(launch.command,/system-prompt|skip-permissions/);launch.cleanup();
  }
});
