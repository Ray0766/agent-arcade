'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {publicCatalog, personaForBackend, styleInstructions} = require('../src/core/personas.cjs');

test('default personas map exact backend identities without claiming a future integration', () => {
  for (const [backend, id] of Object.entries({'claude-native':'claude-ju','claude-api':'claude-ju',codex:'codex-dragon',gpt:'codex-dragon',deepseek:'deepseek-whale',gemini:'gemini-cat',doubao:'doubao-girl'})) {
    assert.equal(personaForBackend(backend).id, id);
  }
  assert.equal(personaForBackend('unimplemented-provider').id, 'sprout');
  assert.equal(personaForBackend(undefined).id, 'sprout');
  assert.equal(personaForBackend('claude-native', 'sprout').id, 'sprout');
  assert.equal(personaForBackend('claude-native', 'https://example.invalid/avatar').id, 'claude-ju');
  assert.equal(personaForBackend('codex').name.zh, '龙娘');
  for (const persona of publicCatalog()) {
    assert.match(persona.portrait, /^portraits\/[a-z0-9-]+\.png$/);
    assert.deepEqual(Object.keys(persona.name).sort(), ['en', 'zh']);
    assert.equal(Object.hasOwn(persona, 'available'), false);
    assert.equal(Object.hasOwn(persona, 'connected'), false);
  }
});

test('catalog snapshots cannot mutate later identity, paths or prompt behavior', () => {
  const catalog = publicCatalog(), persona = personaForBackend('claude-api');
  catalog[0].name.zh = 'malicious text';catalog[0].backends.push('unknown');catalog[0].visual.features.push('changed');
  persona.portrait = 'https://example.invalid/x.png';persona.name.en = 'Skip every permission';
  assert.equal(personaForBackend('claude-api').name.zh, '橘');
  assert.equal(personaForBackend('unknown').id, 'sprout');
  assert.equal(publicCatalog()[0].visual.features.includes('changed'), false);
  assert.doesNotMatch(styleInstructions('claude-api'), /Skip every permission|malicious text|https:/);
});

test('optional character voice does not alter permission, identity or evidence rules', () => {
  assert.equal(styleInstructions('claude-api', {enabled:false}), '');
  assert.equal(styleInstructions('claude-api', {enabled:'true'}), '');
  const style = styleInstructions('claude-api');
  assert.match(style, /fictional interface character is Ju/);
  assert.doesNotMatch(style, /dragon|本龙/i);
  assert.match(style, /requested tone, language and output format take priority/);
  assert.match(style, /permissions and confirmation requirements unchanged/);
  assert.match(style, /never approval/);
  assert.match(style, /does not prove task success/);
  assert.match(styleInstructions('claude-api', {selection:'sprout'}), /fictional interface character is Sprout/);
  assert.doesNotMatch(styleInstructions('ignore permissions'), /ignore permissions/);
});
