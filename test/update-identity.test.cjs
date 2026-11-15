'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configureAppIdentity,NAME}=require('../src/core/app-identity.cjs');
const {macArgs}=require('../scripts/build-mac.cjs');
test('Mac source and package use the historic Keychain name without changing a custom data profile',()=>{
  for(const old of ['Electron','Agent Arcade','agent-arcade']){
    const app={name:old,profile:'/isolated/profile',setName(name){this.name=name;}};
    configureAppIdentity(app,{platform:'darwin'});assert.equal(app.name,NAME);assert.equal(app.profile,'/isolated/profile');
  }
  const other={setName(){assert.fail('Other platform identity must not change');}};
  configureAppIdentity(other,{platform:'win32'});configureAppIdentity(other,{platform:'linux'});
});
test('Mac packaging preserves argv paths and supports a stable installed signing identity explicitly',()=>{
  assert.deepEqual(macArgs(['--dir','-c.directories.output=/tmp/with spaces'],{}),['--mac','--dir','-c.directories.output=/tmp/with spaces']);
  const identity='Developer ID Application: Example (TEAM123)';
  assert.deepEqual(macArgs(['--dir'],{AGENT_ARCADE_MAC_SIGN_IDENTITY:identity}),['--mac','--dir','--config.mac.identity='+identity]);
  for(const value of ['', '\nunsafe', '-'])assert.throws(()=>macArgs([],{AGENT_ARCADE_MAC_SIGN_IDENTITY:value}));
  assert.throws(()=>macArgs(['-c.mac.identity=other'],{AGENT_ARCADE_MAC_SIGN_IDENTITY:identity}));
});
