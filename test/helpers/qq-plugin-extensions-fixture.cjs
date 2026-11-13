'use strict';
// Synthetic fixed cleaner protocol; never imports or executes installed plugins.
const base=require('./qq-plugin-config-fixture.cjs');
const {CLEANER,CLEANER_KEYS:KEYS}=require('../../src/bot/qq-plugin-config-policy.cjs');
module.exports={...base,CLEANER,KEYS,fixture:t=>base.fixture(t,{pluginId:CLEANER}),sessionFixture:t=>base.sessionFixture(t,{pluginId:CLEANER})};
