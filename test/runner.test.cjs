'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { environment, optionsFor, createRunner } = require('../src/bot/runner.cjs');

// Synthetic contracts only: queryImpl never launches the SDK, a model, or a shell.
const workspace = path.resolve(__dirname, '..');
const configDir = path.join(workspace, 'work', 'runner-fixture-config');
const key = 'fixture-not-an-anthropic-key';
const questionInput = () => ({ questions: [{
  question: 'Which synthetic output should be prepared?', header: 'Output',
  options: [{ label: 'Preview', description: 'Synthetic preview' }, { label: 'Report', description: 'Synthetic report' }],
  multiSelect: false,
}] });
const prepare = extra => optionsFor({workspace, key, configDir, request: async () => ({allow:false}), ...extra});

function queryFixture(events, {error, start} = {}) {
  const seen = {closed:0, messages:[], options:null};
  const queryImpl = ({prompt, options}) => {
    seen.options = options;
    const stream = (async function* () {
      for await (const message of prompt) seen.messages.push(message);
      if (start) await start(options);
      for (const event of events) yield event;
      if (error) throw error;
    })();
    stream.close = () => { seen.closed++; };
    return stream;
  };
  return {seen, queryImpl};
}

test('fixture environment keeps OS essentials while excluding ambient credentials and launch overrides', () => {
  const source = {PATH:'fixture-path', SystemRoot:'fixture-system', TEMP:'fixture-temp',
    ANTHROPIC_API_KEY:'ambient-key', ANTHROPIC_AUTH_TOKEN:'ambient-auth', CLAUDE_CODE_OAUTH_TOKEN:'ambient-oauth',
    ANTHROPIC_BASE_URL:'https://fixture.invalid', CLAUDE_CODE_USE_BEDROCK:'1', CLAUDE_CODE_USE_VERTEX:'1',
    CLAUDE_CODE_USE_FOUNDRY:'1', AWS_ACCESS_KEY_ID:'ambient-aws', GH_TOKEN:'ambient-gh', GITHUB_TOKEN:'ambient-github',
    HTTP_PROXY:'http://fixture.invalid', HTTPS_PROXY:'https://fixture.invalid', ALL_PROXY:'socks://fixture.invalid',
    NODE_OPTIONS:'--require=fixture.cjs', NODE_EXTRA_CA_CERTS:'fixture.pem', ELECTRON_RUN_AS_NODE:'1',
    CLAUDE_CONFIG_DIR:'ambient-config'};
  const env = environment(source, key, configDir);
  assert.equal(env.PATH, source.PATH);
  assert.equal(env.SystemRoot, source.SystemRoot);
  assert.equal(env.TEMP, source.TEMP);
  assert.equal(env.ANTHROPIC_API_KEY, key);
  assert.equal(env.CLAUDE_CONFIG_DIR, configDir);
  for (const name of Object.keys(source).filter(name => !['PATH','SystemRoot','TEMP','ANTHROPIC_API_KEY','CLAUDE_CONFIG_DIR'].includes(name))) {
    assert.equal(Object.hasOwn(env, name), false, `${name} must not enter the agent environment`);
  }
  assert.equal(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, '1');
  assert.equal(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1');
  assert.equal(env.DISABLE_TELEMETRY, '1');
  assert.equal(source.ANTHROPIC_API_KEY, 'ambient-key');
});

test('fixture tool policy asks before known actions and denies unavailable tools', async () => {
  const updates = [];
  const prepared = prepare({onUpdate:update => updates.push(update)});
  try {
    const matcher = prepared.options.hooks.PreToolUse[0];
    assert.equal(matcher.onFailure, 'block');
    const gate = matcher.hooks[0];
    for (const tool_name of ['Read','Edit','Write','Bash','AskUserQuestion']) {
      const result = await gate({hook_event_name:'PreToolUse',tool_name,tool_input:{}});
      assert.equal(result.hookSpecificOutput.permissionDecision, 'ask', tool_name);
    }
    for (const tool_name of ['Agent','mcp__fixture__send','UnknownTool']) {
      const result = await gate({hook_event_name:'PreToolUse',tool_name,tool_input:{}});
      assert.equal(result.hookSpecificOutput.permissionDecision, 'deny', tool_name);
    }
    assert.equal(updates.length, 5);
    assert.deepEqual(prepared.options.settingSources, []);
    assert.deepEqual(prepared.options.mcpServers, {});
    assert.equal(prepared.options.strictMcpConfig, true);
    assert.equal(prepared.options.permissionMode, 'default');
    assert.equal(prepared.options.permissionPrompts, 'host');
  } finally { prepared.cleanup(); }
});

test('fixture cancelled permission and question requests reject both early and late approvals', async t => {
  for (const tool of ['Write','AskUserQuestion']) {
    for (const timing of ['before-request','during-tool-request','during-task-request']) {
      await t.test(`${tool}: ${timing}`, async () => {
        const task = new AbortController(), toolRequest = new AbortController();
        let requests = 0;
        const prepared = prepare({signal:task.signal, request:async () => {
          requests++;
          if (timing === 'during-task-request') task.abort(); else toolRequest.abort();
          return {allow:true, answer:'Preview'};
        }});
        if (timing === 'before-request') toolRequest.abort();
        try {
          const input = tool === 'AskUserQuestion' ? questionInput() : {file_path:'fixture.txt',content:'Synthetic; never written'};
          const result = await prepared.options.canUseTool(tool, input, {signal:toolRequest.signal});
          assert.equal(result.behavior, 'deny');
          assert.equal(requests, timing === 'before-request' ? 0 : 1);
          assert.equal(Object.hasOwn(result, 'updatedPermissions'), false);
        } finally { prepared.cleanup(); }
      });
    }
  }
});

test('fixture one-time permission does not create an always-allow rule', async () => {
  const input = {command:'synthetic command; never executed'};
  const prepared = prepare({request:async () => ({allow:true})});
  try {
    const reply = await prepared.options.canUseTool('Bash', input, {signal:new AbortController().signal});
    assert.equal(reply.behavior, 'allow');
    assert.deepEqual(reply.updatedInput, input);
    assert.equal(Object.hasOwn(reply, 'updatedPermissions'), false);
  } finally { prepared.cleanup(); }
});

test('fixture AskUserQuestion accepts exactly one question and preserves its answer mapping', async () => {
  let requests = 0, received;
  const prepared = prepare({request:async payload => { requests++; received=payload; return {allow:true, answer:'Preview'}; }});
  const toolSignal = new AbortController().signal;
  try {
    for (const input of [{}, {questions:[]}, {questions:[{question:42}]}, {questions:[{question:'One?'},{question:'Two?'}]}]) {
      const result = await prepared.options.canUseTool('AskUserQuestion', input, {signal:toolSignal});
      assert.equal(result.behavior, 'deny');
    }
    assert.equal(requests, 0);
    const input = questionInput();
    const result = await prepared.options.canUseTool('AskUserQuestion', input, {signal:toolSignal});
    assert.equal(requests, 1);
    assert.equal(received.kind, 'question');
    assert.deepEqual(received.questions, input.questions);
    assert.equal(result.behavior, 'allow');
    assert.deepEqual(result.updatedInput.questions, input.questions);
    assert.deepEqual(result.updatedInput.answers, {[input.questions[0].question]:'Preview'});
  } finally { prepared.cleanup(); }
});

test('fixture query outcomes separate a reply boundary, agent errors and execution limits', async t => {
  const cases = [
    {name:'error-free turn', subtype:'success', is_error:false, outcome:'reply_ended'},
    {name:'success subtype with error flag', subtype:'success', is_error:true, outcome:'error'},
    {name:'execution failure', subtype:'error_during_execution', is_error:true, outcome:'error'},
    {name:'turn limit', subtype:'error_max_turns', is_error:true, outcome:'limit'},
    {name:'budget limit', subtype:'error_max_budget_usd', is_error:true, outcome:'limit'},
  ];
  for (const fixture of cases) await t.test(fixture.name, async () => {
    const mock = queryFixture([{type:'system',subtype:'init',session_id:'fixture-session'},
      {type:'result',subtype:fixture.subtype,is_error:fixture.is_error,session_id:'fixture-session',result:'Synthetic response'}]);
    const execute = createRunner({workspace,key,configDir,queryImpl:mock.queryImpl});
    const result = await execute({prompt:'Synthetic prompt',resume:'fixture-resume',request:async () => ({allow:false})});
    assert.equal(result.outcome, fixture.outcome);
    assert.equal(result.sessionId, 'fixture-session');
    assert.equal(result.text, 'Synthetic response');
    assert.equal(mock.seen.options.resume, 'fixture-resume');
    assert.equal(mock.seen.options.persistSession, true);
    assert.equal(mock.seen.messages[0].message.content, 'Synthetic prompt');
    assert.equal(mock.seen.closed, 1);
    assert.equal(mock.seen.options.abortController.signal.aborted, true);
    assert.notEqual(result.outcome, 'success');
  });
});

test('fixture missing results and transport failures remain errors and always close the query', async () => {
  for (const error of [undefined, new Error('Synthetic transport failure')]) {
    const mock = queryFixture([{type:'system',subtype:'init',session_id:'fixture-session'}], {error});
    const execute = createRunner({workspace,key,configDir,queryImpl:mock.queryImpl});
    const result = await execute({prompt:'Synthetic prompt',request:async () => ({allow:false})});
    assert.equal(result.outcome, 'error');
    assert.equal(result.sessionId, 'fixture-session');
    assert.equal(mock.seen.closed, 1);
    assert.equal(mock.seen.options.abortController.signal.aborted, true);
  }
});

test('fixture cancellation takes precedence over a late reply or an aborted transport', async () => {
  for (const error of [undefined, new Error('Synthetic aborted transport')]) {
    const task = new AbortController();
    const mock = queryFixture([{type:'result',subtype:'success',is_error:false,session_id:'fixture-session',result:'Late synthetic reply'}],
      {start:() => task.abort(), error});
    const execute = createRunner({workspace,key,configDir,queryImpl:mock.queryImpl});
    const result = await execute({prompt:'Synthetic prompt',signal:task.signal,request:async () => ({allow:false})});
    assert.equal(result.outcome, 'cancelled');
    assert.equal(mock.seen.options.abortController.signal.aborted, true);
    assert.equal(mock.seen.closed, 1);
  }
});

test('fixture ten-minute timeout uses a synthetic clock and cannot become task success', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const mock = queryFixture([{type:'result',subtype:'success',is_error:false,session_id:'fixture-session',result:'Late synthetic reply'}],
    {start:() => t.mock.timers.tick(600001)});
  const execute = createRunner({workspace,key,configDir,queryImpl:mock.queryImpl});
  const result = await execute({prompt:'Synthetic prompt',request:async () => ({allow:false})});
  assert.equal(result.outcome, 'limit');
  assert.match(result.text, /ten-minute/);
  assert.equal(mock.seen.closed, 1);
});
