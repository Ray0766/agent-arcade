'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
const {FileMatcher}=require('app-builder-lib/out/fileMatcher');
const build=require('../package.json').build,base=path.resolve('/synthetic-arcade-package');
const filter=patterns=>new FileMatcher(base,base+'-output',s=>s,patterns).createFilter();
const check=(patterns,rows)=>{const match=filter(patterns);for(const [name,expected]of rows)assert.equal(match(path.join(base,...name.split('/')),{isDirectory:()=>false}),expected,name);};
test('actual electron-builder file filtering preserves source, notices and proprietary SDK exclusion',()=>{
 check(build.files,[['src/main.cjs',true],['src/.fixture.json',true],['src/assets/portrait.png',true],['package.json',true],['LICENSE',true],['LICENSE-MIT-HISTORICAL',true],['THIRD_PARTY_NOTICES.md',true],['LICENSES/example.txt',true],['node_modules/@anthropic-ai/claude-agent-sdk/dist/index.js',false],['node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/bin/claude',false],['work/profile/bot-vault.json',false],['outputs/example.png',false],['README.md',false]]);
});
test('actual asar-unpack matching keeps the existing native/voice/persona boundaries',()=>{
 check(build.asarUnpack,[['node_modules/ws/index.js',true],['src/assets/voice/serena-reference.wav',true],['src/bot/native-channel.cjs',true],['src/core/personas.cjs',true],['src/ui/accounts.js',false],['src/bootstrap.cjs',false]]);
});
test('both affected build consumers resolve the patched matcher while older major APIs remain independent',()=>{
 for(const name of ['app-builder-lib','@electron/universal']){
  const load=createRequire(require.resolve(name+'/package.json'));assert.equal(load('minimatch/package.json').version,'11.0.1');const mm=load('minimatch');assert.equal(typeof mm.Minimatch,'function');assert.equal(typeof mm.minimatch,'function');
  for(const [file,pattern,expected]of [['Frameworks/libfixture.dylib','*.dylib',true],['MacOS/helper','helper',true],['Frameworks/Example.framework/Resources/Info.plist','**/Info.plist',true],['Resources/Info.plist','*.plist',true],['../outside','*.plist',false],['x64/helper','arm64/*',false]])assert.equal(mm.minimatch(file,pattern,{matchBase:true}),expected,name+' '+file);
 }
 const glob=createRequire(require.resolve('glob/package.json'));assert.match(glob('minimatch/package.json').version,/^3\./);const filelist=createRequire(require.resolve('filelist/package.json'));assert.match(filelist('minimatch/package.json').version,/^5\./);
});
