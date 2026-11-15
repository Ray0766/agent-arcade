'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PassThrough,Writable}=require('node:stream');
test('packaged Mac rejects the legacy caller-supplied decrypt oracle before any vault or source access',async()=>{
 const input=new PassThrough(),frames=[],exits=[];let pending='';
 const stdout=new Writable({write(chunk,_encoding,done){pending+=chunk.toString();for(let newline;(newline=pending.indexOf('\n'))!==-1;){frames.push(JSON.parse(pending.slice(0,newline)));pending=pending.slice(newline+1);}done();}});
 class Failure extends Error{constructor(code){super(code);this.code=code;}}
 const context={module:{exports:{}},process:{platform:'darwin'},Buffer,setTimeout,clearTimeout,require(id){
  if(id==='node:fs')return {};
  if(id==='./vault-migration.cjs')return {MAX_REQUEST:16384,validateRequest:value=>value,VaultMigrationError:Failure,CODES:new Set(['INVALID_MIGRATION']),readSource(){assert.fail('No arbitrary source reads');},directory(){assert.fail('No profile access');}};
  if(id==='../core/application-credential-vault.cjs')return {applicationCredentialVault(){return new Proxy({},{get(){assert.fail('No credential API');}});}};
  throw Error('Unexpected dependency');
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/bot/vault-migration-worker.cjs'),'utf8'),context);
 const running=context.module.exports.run({electron:{app:{isPackaged:true,exit:code=>exits.push(code)}},stdin:input,stdout});
 input.end('{"sourceRoot":"synthetic-caller-controlled-root","publicKey":"synthetic-caller-key"}');await running;
 assert.deepEqual(frames,[{version:1,status:'ready'},{version:1,status:'error',code:'INVALID_MIGRATION'}]);assert.deepEqual(exits,[1]);
});
