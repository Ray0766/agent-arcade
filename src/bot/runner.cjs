'use strict';
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = ['Read','Glob','Grep','Edit','Write','Bash','AskUserQuestion'];
function environment(source, key, configDir) {
  const env = {};
  for (const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','PATHEXT']) {
    if (typeof source[name] === 'string') env[name] = source[name];
  }
  return { ...env, ANTHROPIC_API_KEY:key, CLAUDE_CONFIG_DIR:configDir,
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST:'1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB:'1', CLAUDE_AGENT_SDK_CLIENT_APP:'agent-arcade',
    DISABLE_TELEMETRY:'1', DISABLE_ERROR_REPORTING:'1' };
}
function executablePath() {
  const platform = process.platform, arch = process.arch;
  if (!['win32','darwin','linux'].includes(platform) || !['x64','arm64'].includes(arch)) throw Error('Unsupported agent platform');
  const binary = platform === 'win32' ? 'claude.exe' : 'claude';
  // Native binaries cannot execute from an Electron asar archive.
  return require.resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/${binary}`).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
function optionsFor({workspace,key,configDir,budget=1,resume,signal,request,onUpdate=()=>{}}) {
  if (typeof key !== 'string' || key.length < 10) throw Error('Set an Anthropic API key first');
  if (!path.isAbsolute(workspace) || !fs.statSync(workspace).isDirectory()) throw Error('Choose an existing project folder');
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  const hooks = {
    PreToolUse:[{ onFailure:'block', hooks:[async input => {
      if (!TOOLS.includes(input.tool_name)) return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'This tool is not available in the WeChat preview.'}};
      onUpdate({state:'running',tool:input.tool_name});
      // Always ask, including reads: cwd is not a Windows security sandbox.
      // This hook also prevents remembered/default allow rules from bypassing review.
      return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'ask',permissionDecisionReason:'Review this remote task action.'}};
    }]}],
  };
  return {
    cleanup:()=>signal?.removeEventListener('abort',abort), abortController,
    options:{cwd:workspace,env:environment(process.env,key,configDir),pathToClaudeCodeExecutable:executablePath(),
      settingSources:[],mcpServers:{},strictMcpConfig:true,permissionMode:'default',permissionPrompts:'host',
      tools:TOOLS,persistSession:true,...(resume?{resume}:{}),abortController,maxTurns:24,maxBudgetUsd:budget,hooks,
      systemPrompt:'You are Agent Arcade, a local coding agent controlled by one user through WeChat. Work in the selected project. Ask one question at a time using AskUserQuestion. Each tool action needs an explicit one-time approval. Never claim a task passed validation merely because your reply ended. Report files changed, actual checks, and unresolved limits. Do not send messages to third parties.',
      canUseTool:async (tool,input,{signal:toolSignal}) => {
        if (toolSignal.aborted || abortController.signal.aborted) return {behavior:'deny',message:'Task cancelled.',interrupt:true};
        if (tool === 'AskUserQuestion') {
          const questions=input?.questions;
          if (!Array.isArray(questions) || questions.length !== 1 || typeof questions[0]?.question !== 'string') return {behavior:'deny',message:'Ask exactly one question at a time.'};
          const reply=await request({kind:'question',tool,input,questions,signal:toolSignal});
          return reply.allow && !toolSignal.aborted && !abortController.signal.aborted ? {behavior:'allow',updatedInput:{...input,answers:{[questions[0].question]:reply.answer || ''}}} : {behavior:'deny',message:'Question cancelled.'};
        }
        const reply=await request({kind:'permission',tool,input,signal:toolSignal});
        return reply.allow && !toolSignal.aborted && !abortController.signal.aborted ? {behavior:'allow',updatedInput:input} : {behavior:'deny',message:'The user did not approve this action.'};
      },
    },
  };
}
function createRunner({workspace,key,configDir,budget=1,queryImpl}) {
  return async ({prompt,resume,signal,request,onUpdate}) => {
    const prepared=optionsFor({workspace,key,configDir,budget,resume,signal,request,onUpdate});
    const timer=setTimeout(()=>prepared.abortController.abort(),10*60*1000);
    let sessionId=resume || '', result, query;
    try {
      const run=queryImpl || (await import('@anthropic-ai/claude-agent-sdk')).query;
      async function* input() { yield {type:'user',message:{role:'user',content:prompt},parent_tool_use_id:null,session_id:sessionId}; }
      query=run({prompt:input(),options:prepared.options});
      for await (const message of query) {
        if (typeof message.session_id === 'string') sessionId=message.session_id;
        if (message.type === 'result') result=message;
      }
      if (signal?.aborted) return {sessionId,text:'Task cancelled.',outcome:'cancelled'};
      if (prepared.abortController.signal.aborted) return {sessionId,text:'The ten-minute task limit was reached.',outcome:'limit'};
      if (!result) return {sessionId,text:'The agent exited without a result. Outcome unknown.',outcome:'error'};
      const outcome=result.subtype === 'success' && !result.is_error ? 'reply_ended' : /max_|budget|limit/.test(result.subtype) ? 'limit' : 'error';
      return {sessionId,outcome,text:typeof result.result === 'string' ? result.result.slice(0,12000) : outcome==='limit' ? 'The agent reached its turn or cost limit.' : 'The agent reported an execution error. Review the local project before retrying.'};
    } catch {
      return {sessionId,outcome:signal?.aborted?'cancelled':prepared.abortController.signal.aborted?'limit':'error',text:signal?.aborted?'Task cancelled.':'The agent could not finish. Check the API key, network, account credit, and local project before retrying.'};
    } finally { clearTimeout(timer); prepared.abortController.abort(); query?.close(); prepared.cleanup(); }
  };
}
module.exports={createRunner,optionsFor,environment,executablePath};
