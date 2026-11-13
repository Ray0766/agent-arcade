'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const P=require('../src/bot/qq-qce-security-policy.cjs');
const saved=(rules,disabled=false)=>({value:{rules,disabled,isDocker:false,configPath:'C:\\Synthetic-QCE\\security.json',currentClientIP:'127.0.0.1',displayHost:'127.0.0.1'},ids:rules.map(()=>randomUUID())});
test('new rules are strict while IPv6 literal spelling is preserved',()=>{
 for(const value of ['127.0.0.1','192.0.2.3/24','0.0.0.0','*','::1','2001:DB8:0:0:0:0:0:1'])assert.equal(P.rule(value),value);
 for(const value of ['127.00.0.1','127x.0.0.1/8','127.0.0.1/08','::1/128','fe80::1%1','example.invalid',' https://example.invalid','127.0.0.1\n'])assert.throws(()=>P.rule(value),{code:'invalid_rule'});
});
test('empty, disabled and both wildcards mean all; IPv4 CIDR is not all IPv6',()=>{
 for(const value of [saved([]),saved(['*']),saved(['0.0.0.0']),saved(['::1'],true)])assert.equal(P.allowsAll(value.value),true);
 assert.equal(P.allowsAll(saved(['0.0.0.0/0']).value),false);assert.equal(P.allowsLoopback(saved(['127oops.0.0.1/8junk']).value),true);assert.equal(P.allowsLoopback(saved(['::1']).value),false);
});
test('opaque removal retains legacy values and removes only first duplicate',()=>{
 const s=saved(['127.0.0.1','not-an-ip','not-an-ip','bad\nrule']),m=P.mutation(s,'removeRule',s.ids[2]);assert.deepEqual(m.expected.rules,['127.0.0.1','not-an-ip','bad\nrule']);assert.equal(m.command.value,'not-an-ip');assert.equal(m.after.rules[1].ruleId,s.ids[2]);assert.equal(m.after.rules[2].value,'bad\\u000arule');assert.equal(m.after.rules[2].supported,false);
});
test('legacy empty literal is visible but cannot be removed by fixed native API',()=>{const s=saved(['127.0.0.1','']);assert.equal(P.project(s.value,s.ids).rules[1].removable,false);assert.throws(()=>P.mutation(s,'removeRule',s.ids[1]),{code:'invalid_rule'});});
test('preview distinguishes restrict self-lock from remove-last allow-all and disabled changes',()=>{
 let s=saved(['127.0.0.1','::1']),m=P.mutation(s,'removeRule',s.ids[0]);assert.equal(m.effects.mayBlockThisConnection,true);assert.equal(m.effects.restricts,true);
 s=saved(['127.0.0.1']);m=P.mutation(s,'removeRule',s.ids[0]);assert.equal(m.effects.afterAllowsAll,true);assert.equal(m.effects.broadens,true);assert.equal(m.effects.mayBlockThisConnection,false);
 m=P.mutation(saved(['::1'],true),'setDisabled',false);assert.equal(m.effects.restricts,true);assert.equal(m.effects.mayBlockThisConnection,true);
});
test('host is display-only and requests reject authority, oversized and invalid fields',()=>{
 for(const value of ['example.invalid','localhost','192.0.2.1','2001:db8::1'])assert.equal(P.host(value),value);
 for(const value of ['https://example.invalid','example.invalid:40653','x@y','a/../b','999.999.999.999','a.'])assert.throws(()=>P.host(value),{code:'invalid_host'});
 const s=saved(['127.0.0.1']);s.value.displayHost='example.invalid';const m=P.mutation(s,'setDisplayHost','0.0.0.0');assert.equal(m.after.displayHost,'127.0.0.1');assert.equal(m.effects.listenerChanged,false);
 const input={accountId:'synthetic',panelId:randomUUID()};assert.throws(()=>P.qceSecurityRequest({...input,url:'http://example.invalid'}),{code:'invalid_request'});assert.throws(()=>P.rawRules(Array(129).fill('*')),{code:'invalid_response'});
});
