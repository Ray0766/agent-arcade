'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {groupGenerationView, groupReplySampling, groupGateSampling} = require('../src/bot/group-generation.cjs');

test('group generation lists effective provider defaults and independent gate limits', () => {
  const modes = [
    ['deepseek', 4096, 256, []],
    ['gemini', 8192, 512, []],
    ['doubao', 4096, 256, []],
    ['gpt', 8192, 1024, ['temperature', 'topP']],
    ['api', 16000, 256, ['temperature', 'topP']],
    ['claude', null, null, ['temperature', 'topP', 'maxTokens']],
    ['api-sdk', null, null, ['temperature', 'topP', 'maxTokens']],
  ];
  for (const [mode, maxTokens, gateMaxTokens, unsupported] of modes) {
    assert.deepEqual(groupGenerationView(mode), {
      sampling: {}, effective: {temperature: null, topP: null, maxTokens}, unsupported, gateMaxTokens,
    });
    assert.deepEqual(groupGateSampling(mode), gateMaxTokens === null ? undefined : {maxTokens: gateMaxTokens});
  }
});

test('configured sampling is retained for review while only provider-supported explicit values are applied', () => {
  const configured = {temperature: 0, topP: 0, maxTokens: 64};
  const complete = ['deepseek', 'gemini', 'doubao'];
  const maxOnly = ['gpt', 'api'];
  for (const mode of [...complete, ...maxOnly, 'claude', 'api-sdk']) {
    const expected = complete.includes(mode) ? configured : maxOnly.includes(mode) ? {maxTokens: 64} : {};
    assert.deepEqual(groupReplySampling(mode, configured), expected);
    assert.deepEqual(groupGenerationView(mode, configured).sampling, configured);
    assert.deepEqual(groupGenerationView(mode, configured).effective, {temperature: null, topP: null, maxTokens: null, ...expected});
    assert.deepEqual(groupReplySampling(mode, {temperature: null, topP: null, maxTokens: null}), {});
  }
});

test('group configuration reuses shared numeric sampling limits', () => {
  for (const bad of [{temperature: -1}, {topP: 1.1}, {maxTokens: 63}, {maxTokens: 64.5}, {maxTokens: 16000}, {context: 'private'}]) {
    assert.throws(() => groupGenerationView('deepseek', bad), /Invalid sampling settings/);
    assert.throws(() => groupReplySampling('deepseek', bad), /Invalid sampling settings/);
  }
  assert.deepEqual(groupReplySampling('deepseek', {temperature: 2, topP: 1, maxTokens: 8192}), {temperature: 2, topP: 1, maxTokens: 8192});
});
