'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{load}=require('./helpers/qq-passkey-production-modules.cjs');
const N=load('src/qq-supervisor/native-passkeys-policy.cjs'),P=load('src/qq-supervisor/policy.cjs'),{OfflineNativePasskeys}=load('src/bot/qq-native-passkey-maintenance.cjs');
const path=require('node:path'),synthetic=name=>path.resolve(path.sep,'Synthetic',name);
// The policy only checks that these are absolute, normalised local paths; nothing is created.
const base={instanceId:'11111111-1111-4111-8111-111111111111',expectedQQ:'12345001',stateDir:synthetic('state'),token:'synthetic_token_for_origin_1234567890abcdefghijkl',installation:{componentStoreRoot:synthetic('components'),lockRoot:synthetic('locks'),setupId:'22222222-2222-4222-8222-222222222222'}};
const selection={withPendingUpdateRecovery(){throw Error('Origin validation must not touch installation');},pendingUpdateRecoveryContext(){throw Error('Origin validation must not touch installation');}};
test('all three origin boundaries reject IPv4, bracketed IPv6 and non-origin URLs',()=>{
 for(const origin of ['https://127.0.0.1','https://192.168.1.20:9443','https://[::1]','https://[2001:db8::1]:9443','https://[::ffff:192.0.2.1]','http://webui.example.invalid','https://user@webui.example.invalid','https://webui.example.invalid/','https://webui.example.invalid/?x=1']){
  assert.throws(()=>N.origin(origin),undefined,origin);assert.throws(()=>P.config({...base,passkeys:{enabled:true,origin,recoveryRouteDeclared:false}}),undefined,origin);assert.throws(()=>new OfflineNativePasskeys({selection,origin,enabled:true}),undefined,origin);
 }
});
test('DNS HTTPS origin and explicit nondefault port remain exactly bound',()=>{for(const origin of ['https://webui.example.invalid','https://webui.example.invalid:9443']){assert.equal(N.origin(origin),origin);assert.equal(P.config({...base,passkeys:{enabled:false,origin,recoveryRouteDeclared:false}}).passkeys.origin,origin);assert.equal(new OfflineNativePasskeys({selection,origin}).origin,origin);}});
