'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProviderLogin,discoverExecutable,loginEnvironment,parseStatus,buildWindowsLogin,launchOriginalLogin}=require('../src/bot/provider-login.cjs');
const nativePath=provider=>`C:\\Program Files\\${provider}\\${provider}.exe`;
const sourceEnv={SystemRoot:'C:\\Windows',USERPROFILE:'C:\\Users\\Example',PATH:'C:\\safe',ANTHROPIC_API_KEY:'private',OPENAI_API_KEY:'private',CLAUDE_CODE_OAUTH_TOKEN:'private'};
const signedOut=provider=>provider==='claude'?{stdout:JSON.stringify({loggedIn:false,authMethod:'none'}),stderr:''}:{stdout:'',stderr:'Not logged in\n'};
function fixture(options={}){
  const calls=[],launches=[];let clock=1000;
  const runImpl=async(executable,args,settings)=>{
    calls.push({executable,args,settings});
    if(args[0]==='--version')return {stdout:'2.1.317 (native CLI)\n',stderr:''};
    const provider=executable.includes('claude')?'claude':'codex';
    if(options.runStatus)return options.runStatus(provider,args);
    throw Object.assign(Error('DO NOT EXPORT PRIVATE DATA'),{code:1,...signedOut(provider)});
  };
  const login=createProviderLogin({platform:'win32',env:sourceEnv,runImpl,discoverImpl:nativePath,now:()=>clock,launchImpl:async command=>{launches.push(command);return {opened:true};},...options});
  return {login,calls,launches,advance:ms=>{clock+=ms;}};
}

test('status uses only fixed original CLI status/version commands with bounded hidden output',async()=>{
  const f=fixture();
  for(const provider of ['claude','codex']){
    const result=await f.login.status(provider);
    assert.deepEqual(result,{provider,installed:true,state:'signed_out',method:null,version:'2.1.317',checkedAt:1000,code:null});
  }
  assert.deepEqual(f.calls.map(call=>call.args),[['--version'],['auth','status','--json'],['--version'],['login','status']]);
  for(const call of f.calls){assert.equal(call.settings.shell,false);assert.equal(call.settings.windowsHide,true);assert.ok(call.settings.timeout<=10000);assert.ok(call.settings.maxBuffer<=65536);assert.equal(call.settings.env.OPENAI_API_KEY,undefined);assert.equal(call.settings.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);}
  assert.equal(f.launches.length,0);
});

test('Claude structured status exposes auth kind without account or token data',()=>{
  for(const [authMethod,method]of [['claude.ai','claude.ai'],['api_key','api_key'],['api_key_helper','api_key'],['oauth_token','other'],['third_party','other']]){
    const result=parseStatus('claude',{exitCode:0,stdout:JSON.stringify({loggedIn:true,authMethod,email:'private@example.test',apiKey:'secret'}),stderr:'hidden'});
    assert.deepEqual(result,{state:'signed_in',method,code:null});
  }
  assert.equal(parseStatus('claude',{exitCode:0,stdout:'{"loggedIn":true,"authMethod":"future"}'}).state,'unknown');
  assert.equal(parseStatus('claude',{exitCode:1,stdout:'{"loggedIn":true,"authMethod":"claude.ai"}'}).state,'unknown');
});

test('Codex official zero exit is stored-login evidence, not a model availability check',()=>{
  assert.deepEqual(parseStatus('codex',{exitCode:0,stderr:'Logged in using ChatGPT\n'}),{state:'signed_in',method:'chatgpt',code:null});
  assert.deepEqual(parseStatus('codex',{exitCode:0,stderr:'Logged in using an API key - sk-private'}),{state:'signed_in',method:'api_key',code:null});
  assert.deepEqual(parseStatus('codex',{exitCode:0,stdout:'future auth implementation'}),{state:'signed_in',method:'other',code:null});
  assert.deepEqual(parseStatus('codex',{exitCode:1,stderr:'Not logged in\n'}),{state:'signed_out',method:null,code:null});
  assert.equal(parseStatus('codex',{exitCode:null,stderr:'Access denied\nNot logged in'}).state,'unknown');
});

test('malformed, oversized and failed status output cannot masquerade as signed out',async()=>{
  for(const stdout of ['', 'null','[]','{"loggedIn":"false"}','x'.repeat(65537)])assert.equal(parseStatus('claude',{exitCode:1,stdout}).state,'unknown');
  const f=fixture({runStatus:()=>{throw Object.assign(Error('SECRET'),{code:'ETIMEDOUT',stdout:'SECRET',stderr:'SECRET'});}});
  for(const provider of ['claude','codex']){const result=await f.login.status(provider);assert.equal(result.installed,true);assert.equal(result.state,'unknown');assert.equal(JSON.stringify(result).includes('SECRET'),false);}
});

test('Claude authentication does not advertise an older or unrecognized CLI as program-runner ready',async()=>{
  for(const [version,code]of [['2.1.316','unsupported_version'],['2.0.999','unsupported_version'],['2.1.317',null],['2.2.0',null],['3.0.0',null],['unknown','unknown_version'],['2.1.317'+'x'.repeat(8193),'unknown_version']]){
    const f=fixture({runImpl:async(executable,args)=>args[0]==='--version'?{stdout:version}:{stdout:'{"loggedIn":true,"authMethod":"claude.ai"}'}});
    const result=await f.login.status('claude');assert.equal(result.state,'signed_in');assert.equal(result.method,'claude.ai');assert.equal(result.code,code);assert.ok(result.version===null||result.version.length<32);
  }
});

test('environment excludes API and OAuth injection while retaining OS and original Codex home',()=>{
  const env={...sourceEnv,CODEX_HOME:path.resolve('work','safe-home'),CLAUDE_CONFIG_DIR:'other',ANTHROPIC_AUTH_TOKEN:'private',ANTHROPIC_BASE_URL:'https://private',CODEX_API_KEY:'private',OPENAI_BASE_URL:'https://private',OPENAI_ACCESS_TOKEN:'private',CLAUDE_CODE_USE_BEDROCK:'1',NODE_OPTIONS:'--require evil',HTTP_PROXY:'private',AWS_SECRET_ACCESS_KEY:'private',CUSTOM_ENV:'private'};
  const codex=loginEnvironment(env,'codex'),claude=loginEnvironment(env,'claude');
  assert.equal(codex.CODEX_HOME,env.CODEX_HOME);assert.equal(claude.CODEX_HOME,undefined);
  for(const key of Object.keys(env).filter(key=>!['SystemRoot','USERPROFILE','PATH','CODEX_HOME'].includes(key))){assert.equal(codex[key],undefined,key);assert.equal(claude[key],undefined,key);}
  assert.equal(codex.SystemRoot,sourceEnv.SystemRoot);assert.equal(codex.DISABLE_TELEMETRY,'1');
  assert.equal(loginEnvironment({CODEX_HOME:'relative'},'codex').CODEX_HOME,undefined);
});

test('discovery only returns sanitized executable metadata and distinguishes absence from errors',async()=>{
  const f=fixture();assert.deepEqual(await f.login.discover('claude'),{provider:'claude',installed:true,version:'2.1.317',code:null});
  const missing=fixture({discoverImpl:()=>null});assert.equal((await missing.login.status('claude')).state,'not_installed');assert.equal((await missing.login.login('claude')).code,'not_installed');assert.equal(missing.launches.length,0);
  const broken=fixture({discoverImpl:()=>{throw Error('PRIVATE PATH');}});assert.equal((await broken.login.status('codex')).state,'unknown');assert.equal((await broken.login.status('codex')).code,'discovery_failed');
});

test('native executable discovery locates installed native binaries without opening auth files',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-login-'));
  try{
    const file=path.join(temp,process.platform==='win32'?'claude.exe':'claude');fs.writeFileSync(file,'not executable fixture');
    // directories:[] keeps the search on the fixture PATH: on macOS and Linux the
    // default also looks in the usual install locations, where a developer's real
    // claude may exist. Windows searches PATH only, with or without this option.
    assert.equal(discoverExecutable('claude',{env:{PATH:temp},directories:[]}),file);
    assert.equal(discoverExecutable('claude',{env:{PATH:path.join(temp,'missing')},directories:[]}),null);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('existing native login is preserved, including API-key auth rather than silently replacing it',async()=>{
  const f=fixture({runStatus:provider=>provider==='claude'?{stdout:'{"loggedIn":true,"authMethod":"claude.ai"}'}:{stderr:'Logged in using an API key - secret'}});
  for(const provider of ['claude','codex']){const result=await f.login.login(provider);assert.equal(result.opened,false);assert.equal(result.code,'already_signed_in');assert.equal(result.status.state,'signed_in');}
  assert.equal(f.launches.length,0);
});

test('login opens only fixed official commands and returns pending state, never success before user completion',async()=>{
  const f=fixture();
  for(const provider of ['claude','codex']){const result=await f.login.login(provider);assert.equal(result.opened,true);assert.equal(result.code,'opened');assert.equal(result.status.state,'signed_out');}
  assert.deepEqual(f.launches.map(item=>item.args),[['auth','login'],['login']]);
  for(const launch of f.launches){assert.equal(launch.executable,nativePath(launch.provider));assert.equal(launch.env.OPENAI_API_KEY,undefined);assert.equal(launch.env.ANTHROPIC_API_KEY,undefined);}
});

test('concurrent status and login requests coalesce; launch cooldown prevents duplicate windows',async()=>{
  const f=fixture();
  await Promise.all([f.login.status('claude'),f.login.status('claude')]);assert.equal(f.calls.filter(call=>call.args[0]==='auth').length,1);
  await Promise.all([f.login.login('claude'),f.login.login('claude')]);assert.equal(f.launches.length,1);
  assert.equal((await f.login.login('claude')).code,'login_in_progress');assert.equal(f.launches.length,1);
  f.advance(30001);assert.equal((await f.login.login('claude')).code,'opened');assert.equal(f.launches.length,2);
});

test('signed-in refresh ends the pending login cooldown',async()=>{
  let loggedIn=false;
  const f=fixture({runStatus:()=>{if(loggedIn)return {stdout:'{"loggedIn":true,"authMethod":"claude.ai"}'};throw Object.assign(Error('out'),{code:1,...signedOut('claude')});}});
  await f.login.login('claude');loggedIn=true;assert.equal((await f.login.status('claude')).state,'signed_in');
  loggedIn=false;assert.equal((await f.login.login('claude')).code,'opened');assert.equal(f.launches.length,2);
});

test('failure to launch is sanitized and non-Windows visible launching is explicitly unsupported',async()=>{
  for(const launchImpl of [async()=>{throw Error('secret token');},async()=>({opened:false})]){const f=fixture({launchImpl});const result=await f.login.login('claude');assert.equal(result.code,'launch_failed');assert.equal(JSON.stringify(result).includes('secret token'),false);}
  const f=fixture({platform:'linux',discoverImpl:()=>'/usr/bin/claude'});assert.equal((await f.login.login('claude')).code,'unsupported_platform');assert.equal(f.launches.length,0);
});

test('untrusted provider names and executable/argument injection cannot reach process execution',async()=>{
  const f=fixture();for(const provider of ['openai','claude --help','codex; exit',null,{}]){assert.throws(()=>f.login.status(provider));assert.throws(()=>f.login.login(provider));await assert.rejects(f.login.discover(provider));}
  assert.equal(f.calls.length,0);assert.equal(f.launches.length,0);
  for(const executable of ['claude.exe','C:\\x\\claude.cmd','C:\\x\\evil.exe\n'])assert.throws(()=>buildWindowsLogin(executable,['auth','login']));
  for(const args of [['login','--with-api-key'],['auth','logout'],['auth','login',';evil'],['--help']])assert.throws(()=>buildWindowsLogin(nativePath('claude'),args));
});

test('Windows launch quotes executable as data; visible official CLI uses no ps1 or execution policy change',async()=>{
  const executable="C:\\Apps O'Name; $env:PRIVATE\\claude.exe";
  const args=buildWindowsLogin(executable,['auth','login']);
  assert.deepEqual(args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);
  const script=Buffer.from(args[4],'base64').toString('utf16le');
  assert.ok(script.includes("-FilePath 'C:\\Apps O''Name; $env:PRIVATE\\claude.exe'"));assert.ok(script.includes("-ArgumentList @('auth','login')"));assert.ok(script.includes('-WindowStyle Normal'));
  assert.equal(/ExecutionPolicy|\.ps1|Invoke-Expression|cmd\.exe/.test(script),false);
  let helper;
  const result=await launchOriginalLogin({executable,args:['auth','login'],env:{SystemRoot:'C:\\Windows'},platform:'win32',runImpl:async(...call)=>{helper=call;return {stdout:'12345'};}});
  assert.deepEqual(result,{opened:true});assert.equal(helper[0],'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.equal(helper[2].windowsHide,true);assert.equal(helper[2].shell,false);assert.equal(helper[2].timeout,15000);
});

test('Windows helper must confirm process creation and cannot run without a trusted system shell location',async()=>{
  const command={executable:nativePath('codex'),args:['login'],env:{SystemRoot:'C:\\Windows'},platform:'win32'};
  for(const stdout of ['', '0','PID secret','123\nextra'])await assert.rejects(launchOriginalLogin({...command,runImpl:async()=>({stdout})}));
  await assert.rejects(launchOriginalLogin({...command,env:{SystemRoot:'relative'},runImpl:async()=>{assert.fail('must not execute');}}));
});
