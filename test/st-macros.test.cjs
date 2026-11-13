'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {substituteMacros,MAX_INPUT,MAX_REPLACEMENTS}=require('../src/vendor/sillytavern/macros.cjs');
const now=new Date('2026-11-13T05:07:00Z');
const env={char:'橘',user:'Ray',persona:'a reader',description:'DESC',personality:'PERS',scenario:'SCEN',now,timeZone:'UTC',random:()=>0};
const sub=(text,extra={})=>substituteMacros(text,{...env,...extra});

test('names and card fields, case-insensitively, plus legacy forms',()=>{
  assert.equal(sub('{{char}} {{user}} {{persona}} {{description}} {{personality}} {{scenario}}'),'橘 Ray a reader DESC PERS SCEN');
  assert.equal(sub('{{CHAR}} {{User}} {{PERSONA}} {{Description}}'),'橘 Ray a reader DESC');
  assert.equal(sub('<USER> <user> <BOT> <bot> <CHAR> <Char>'),'Ray Ray 橘 橘 橘 橘');
  assert.equal(sub(''),'');assert.equal(substituteMacros(null),'');assert.equal(substituteMacros('{{char}}|{{user}}'),'|');
  assert.equal(sub('no macros'),'no macros');
});
test('date and time macros use the fixed clock and time zone',()=>{
  assert.equal(sub('{{time}}|{{date}}|{{weekday}}|{{isotime}}|{{isodate}}'),'5:07 AM|November 13, 2026|Friday|05:07|2026-11-13');
  assert.equal(sub('{{TIME}}|{{IsoDate}}|{{isotime}}',{timeZone:'Asia/Shanghai'}),'1:07 PM|2026-11-13|13:07');
  assert.equal(sub('{{isodate}} {{isotime}} {{time}}',{now:new Date('2026-12-31T23:30:00Z'),timeZone:'Australia/Sydney'}),'2027-01-01 10:30 10:30 AM');
  assert.equal(sub('{{time}}',{now:new Date('2026-01-01T12:00:00Z')}),'12:00 PM');
  assert.equal(sub('{{time}}',{now:new Date('2026-01-01T00:05:00Z')}),'12:05 AM');
  assert.match(sub('{{isodate}}',{timeZone:'Not/AZone'}),/^\d{4}-\d{2}-\d{2}$/);
});
test('newline, trim, noop and comments',()=>{
  assert.equal(sub('a{{newline}}b{{NEWLINE}}c'),'a\nb\nc');
  assert.equal(sub('a\n\r\n\n{{trim}}\r\n\nb'),'ab');assert.equal(sub('a {{Trim}} b'),'a  b');
  assert.equal(sub('a{{noop}}b{{NOOP}}'),'ab');
  assert.equal(sub('a{{// hidden {{char}}\n note}}b'),'ab');
  assert.equal(sub('a{{// never closed'),'a{{// never closed');
});
test('random and roll use the injected source',()=>{
  assert.equal(sub('{{random:a, b ,c}}'),'a');assert.equal(sub('{{random:a, b ,c}}',{random:()=>0.5}),'b');assert.equal(sub('{{RANDOM::x, y::z}}',{random:()=>0.99}),'z');
  assert.equal(sub('{{random::x, y::z}}'),'x, y');assert.equal(sub('{{random:a\\,b,c}}'),'a,b');assert.equal(sub('{{random :a,b}}',{random:()=>0.6}),'b');assert.equal(sub('{{random a,b}}'),'{{random a,b}}');
  assert.equal(sub('{{roll:d6}}'),'1');assert.equal(sub('{{roll:d6}}',{random:()=>0.999}),'6');assert.equal(sub('{{roll:2d6+3}}',{random:()=>0.5}),'11');
  assert.equal(sub('{{roll 20}}',{random:()=>0.5}),'11');assert.equal(sub('{{ROLL:3D4-1}}'),'2');
  assert.equal(sub('{{roll:nonsense}}'),'');assert.equal(sub('{{roll:999d6}}'),'');assert.equal(sub('{{roll:1d0}}'),'');
  // A misbehaving random source cannot index outside the list.
  assert.equal(sub('{{random:a,b}}',{random:()=>7}),'a');assert.equal(sub('{{random:a,b}}',{random:()=>NaN}),'a');
});
test('unknown and unported macros are left untouched',()=>{
  const text='{{setvar::x::1}}{{getvar::x}}{{pipe}}{{input}}{{lastMessage}}{{pick::a::b}}{{original}}{{unknown}}{{reverse:abc}}{{datetimeformat YYYY}}{{char';
  assert.equal(sub(text),text);
  assert.equal(sub('{{ char }} {char} {{charr}}'),'{{ char }} {char} {{charr}}');
});
test('upstream ordering: env values feed later passes, a pass does not rescan itself',()=>{
  assert.equal(sub('{{random::{{char}}::{{char}}}}'),'橘');
  assert.equal(sub('{{description}}',{description:'at {{isotime}}'}),'at 05:07');
  assert.equal(sub('{{char}}',{char:'{{char}}'}),'{{char}}');
  // {{user}} is substituted before {{char}}; a later value is not re-expanded by an earlier pass.
  assert.equal(sub('{{char}}',{char:'{{user}}'}),'{{user}}');
});
test('bounds: input size, replacement count, growth, and hostile nesting',()=>{
  assert.throws(()=>sub('x'.repeat(MAX_INPUT+1)),{code:'macro_input_invalid'});
  assert.throws(()=>sub(42),{code:'macro_input_invalid'});
  assert.equal(sub('{{noop}}'.repeat(MAX_REPLACEMENTS+5)),'{{noop}}'.repeat(5));
  const grown=sub('{{char}}'.repeat(20000),{char:'x'.repeat(50000)});
  assert.ok(grown.length<=400000);assert.ok(grown.includes('{{char}}'));
  const started=process.hrtime.bigint();
  for(const hostile of ['{{random:'.repeat(22000),'{{//'.repeat(50000),'\n'.repeat(MAX_INPUT-3)+'{{x','{{trim}}\n'.repeat(22000),'{{roll:'.repeat(28000),'{{random::{{random::'.repeat(10000),'{{'.repeat(100000),'{{random::'+'{{char}}::'.repeat(19000)+'}}'])
    assert.equal(typeof sub(hostile,{char:'{{random::a::b}}'}),'string');
  assert.ok(Number(process.hrtime.bigint()-started)/1e6<5000);
});
