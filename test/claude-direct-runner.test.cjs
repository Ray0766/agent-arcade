'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const {createClaudeDirectRunner, MODEL} = require('../src/bot/claude-direct-runner.cjs');
const {createRunner} = require('../src/bot/runner.cjs');

// Synthetic client: no network, key or model is used.
const key = 'synthetic-not-an-anthropic-key';
function client(reply) {
  const calls = [];
  return {calls, factory:options => ({options, beta:{messages:{create:async (body, request) => { calls.push({body, request}); return reply(body, request); }}}})};
}

test('sends one tool-less request and returns the text blocks', async () => {
  const fake = client(() => ({stop_reason:'end_turn', content:[{type:'thinking', thinking:''}, {type:'text', text:'你好'}, {type:'text', text:'呀'}]}));
  const execute = createClaudeDirectRunner({key, clientFactory:fake.factory});
  assert.deepEqual(await execute({prompt:'在吗'}), {sessionId:'', outcome:'reply_ended', text:'你好呀'});
  const {body} = fake.calls[0];
  assert.equal(body.model, MODEL);
  assert.equal(body.tools, undefined);
  assert.deepEqual(body.messages, [{role:'user', content:'在吗'}]);
  assert.equal(body.fallbacks, 'default');
});

test('reports refusal, truncation and empty replies without inventing text', async () => {
  const run = async response => createClaudeDirectRunner({key, clientFactory:client(() => response).factory})({prompt:'x'});
  assert.equal((await run({stop_reason:'refusal', content:[]})).outcome, 'error');
  assert.deepEqual(await run({stop_reason:'max_tokens', content:[{type:'text', text:'半句'}]}), {sessionId:'', outcome:'limit', text:'半句'});
  assert.equal((await run({stop_reason:'end_turn', content:[{type:'thinking', thinking:''}]})).outcome, 'error');
});

test('maps API failures and cancellation; rejects resume and bad input', async () => {
  const failing = error => createClaudeDirectRunner({key, clientFactory:client(() => { throw error; }).factory});
  const auth = new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers());
  assert.match((await failing(auth)({prompt:'x'})).text, /rejected the API key/);
  const limited = new Anthropic.RateLimitError(429, {}, 'slow down', new Headers());
  assert.match((await failing(limited)({prompt:'x'})).text, /rate limit/);
  const controller = new AbortController();
  const waiting = createClaudeDirectRunner({key, clientFactory:client((body, request) => new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(Error('aborted'))))).factory});
  const pending = waiting({prompt:'x', signal:controller.signal});
  controller.abort();
  assert.equal((await pending).outcome, 'cancelled');
  const execute = createClaudeDirectRunner({key, clientFactory:client(() => ({})).factory});
  assert.equal((await execute({prompt:'x', resume:'s'})).outcome, 'error');
  assert.equal((await execute({prompt:''})).outcome, 'error');
  assert.throws(() => createClaudeDirectRunner({key:'short'}));
});

test('the Claude API runner works without the optional agent SDK', async () => {
  const workspace = path.resolve(__dirname, '..');
  const fake = client(() => ({stop_reason:'end_turn', content:[{type:'text', text:'ok'}]}));
  const companion = createRunner({workspace, key, conversationOnly:true, agentSdk:false, clientFactory:fake.factory});
  assert.equal((await companion({prompt:'hi'})).text, 'ok');
  const task = createRunner({workspace, key, agentSdk:false});
  const result = await task({prompt:'fix it'});
  assert.equal(result.outcome, 'error');
  assert.match(result.text, /optional Claude Agent SDK/);
});
