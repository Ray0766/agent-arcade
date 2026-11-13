'use strict';
// The owner's memory wiki as files in a temporary directory: layout, budgets, structural checks,
// path safety and deterministic line changes. No network and no model.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {WikiStore,SECTIONS,LIMITS,lintPage,parsePage}=require('../src/bot/wiki/wiki-store.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-wiki-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const wiki=(t,now={value:new Date(2026,10,13,9,5,0).getTime()})=>{const root=path.join(temp(t),'wiki');return {root,now,store:new WikiStore({root,now:()=>now.value}),read:rel=>fs.readFileSync(path.join(root,rel),'utf8'),write:(rel,text)=>{fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),text);}};};
const code=operation=>{try{operation();return null;}catch(error){return error.code;}};
const codes=findings=>findings.map(item=>item.code);
const page=(body,front='name: server\ndescription: The home server.\nscope: Hardware and services of the home server.')=>`---\n${front}\n---\n# server\n\n${body}`;

test('an absent wiki is empty and valid; creating a domain and a topic builds the layered layout',t=>{
  const w=wiki(t);
  assert.deepEqual([w.store.tree().exists,w.store.tree().domains,w.store.tree().pages],[false,[],0]);
  assert.deepEqual(w.store.lint(),{ok:true,errors:[],warnings:[],pages:0,bytes:0});assert.deepEqual(w.store.pages(),[]);
  assert.equal(fs.existsSync(w.root),false);
  assert.deepEqual(w.store.createDomain({name:'infra',description:'Machines, network and services'}),{domain:'infra'});
  const created=w.store.createPage({domain:'infra',topic:'server',description:'The home server.',scope:'Hardware and services of the home server.'});
  assert.equal(created.page,'infra/server.md');assert.match(created.sha,/^[0-9a-f]{64}$/);
  assert.equal(w.read('MEMORY.md'),'- [infra](infra/README.md) — Machines, network and services\n');
  assert.equal(w.read('infra/README.md'),'- [server](server.md) — The home server.\n');
  assert.equal(w.read('infra/server.md'),'---\nname: server\ndescription: The home server.\nscope: Hardware and services of the home server.\n---\n# server\n\n## 现状\n\n## 关键事实\n\n## 决策与踩坑\n\n## 待办\n');
  assert.deepEqual(SECTIONS,['现状','关键事实','决策与踩坑','待办']);
  const tree=w.store.tree();
  assert.deepEqual(tree.domains,[{name:'infra',description:'Machines, network and services',listed:true,hasReadme:true,topics:[{name:'server',path:'infra/server.md',description:'The home server.',listed:true,bytes:Buffer.byteLength(w.read('infra/server.md'))}]}]);
  assert.equal(tree.pages,1);assert.deepEqual(tree.sections,SECTIONS);
  assert.deepEqual(w.store.lint(),{ok:true,errors:[],warnings:[],pages:1,bytes:tree.bytes});
  const read=w.store.readPage('infra/server.md');
  assert.deepEqual([read.path,read.truncated,read.sha,read.front,read.lines,read.sections.map(section=>[section.name,section.line,section.end])],['infra/server.md',false,created.sha,{name:'server',description:'The home server.',scope:'Hardware and services of the home server.'},14,[['现状',8,9],['关键事实',10,11],['决策与踩坑',12,13],['待办',14,14]]]);
  assert.equal(w.store.readPage('infra/server.md',{maxChars:10}).text,'---\nname: ');assert.equal(w.store.readPage('infra/server.md',{maxChars:10}).truncated,true);
  assert.deepEqual(w.read('log.md').split('\n'),['- [2026-11-13 09:05] create | infra/','- [2026-11-13 09:05] create | infra/server.md','']);
  // Names: no separators, no leading dot, at most 40 characters, nothing reserved; duplicates are refused case-insensitively.
  for(const name of ['','..','a/b','a\\b','.hidden','x'.repeat(41),'has space','a.b','con','README','log','名字?',5,null])assert.equal(code(()=>w.store.createDomain({name})),'wiki_name_invalid',String(name));
  for(const topic of ['../x','.git','readme','a/b'])assert.equal(code(()=>w.store.createPage({domain:'infra',topic,description:'x'})),'wiki_name_invalid',topic);
  assert.equal(code(()=>w.store.createDomain({name:'Infra'})),'wiki_exists');assert.equal(code(()=>w.store.createPage({domain:'infra',topic:'Server',description:'x'})),'wiki_exists');
  assert.equal(code(()=>w.store.createPage({domain:'nowhere',topic:'x',description:'x'})),'wiki_not_found');
  assert.equal(code(()=>w.store.createPage({domain:'infra',topic:'x',description:''})),'wiki_text_invalid');assert.equal(code(()=>w.store.createPage({domain:'infra',topic:'x',description:'two\nlines'})),'wiki_text_invalid');
  assert.equal(code(()=>w.store.createDomain({name:'long',description:'d'.repeat(70)})),'wiki_line_too_long');
  // Chinese names work.
  w.store.createDomain({name:'生活'});assert.equal(w.store.createPage({domain:'生活',topic:'饮食-偏好',description:'口味。'}).page,'生活/饮食-偏好.md');assert.equal(w.store.lint().ok,true);
});

test('budgets: 8 domains plus misc, 15 topics, 60 lines, 4000 characters, 300 characters per line; warnings from 80 percent',t=>{
  const w=wiki(t);
  for(let i=0;i<8;i++)w.store.createDomain({name:'d'+i});
  assert.equal(code(()=>w.store.createDomain({name:'d8'})),'wiki_domains_full');
  w.store.createDomain({name:'misc'});assert.equal(w.store.lint().ok,true);
  for(let i=0;i<15;i++){w.store.createPage({domain:'d0',topic:'t'+i,description:'topic '+i});if(i===10)assert.deepEqual(w.store.lint().warnings,[]);if(i===11)assert.deepEqual(codes(w.store.lint().warnings),['topics_near_budget']);}
  assert.equal(code(()=>w.store.createPage({domain:'d0',topic:'t15',description:'x'})),'wiki_topics_full');
  // A sixteenth topic written by hand is a lint error, as are over-long index and README lines.
  w.write('d0/t15.md',page('## 现状\n- x\n'));fs.appendFileSync(path.join(w.root,'d0','README.md'),'- [t15](t15.md) — '+'x'.repeat(110)+'\n');
  fs.appendFileSync(path.join(w.root,'MEMORY.md'),'- [d9](d9/README.md) — '+'y'.repeat(70)+'\n');w.write('d9/README.md','');
  assert.deepEqual(codes(w.store.lint().errors).sort(),['index_line_too_long','readme_line_too_long','too_many_domains','too_many_topics']);
  // Page budgets.
  const bullets=count=>'## 关键事实\n'+Array.from({length:count},(_,i)=>`- fact ${i}`).join('\n')+'\n';
  // The page helper has 8 lines before the bullets: 47 lines is below 80 %, 48 is a warning, 60 fits, 61 does not.
  assert.deepEqual([codes(lintPage('a/b.md',page(bullets(39))).errors),codes(lintPage('a/b.md',page(bullets(39))).warnings)],[[],[]]);
  assert.deepEqual([codes(lintPage('a/b.md',page(bullets(40))).errors),codes(lintPage('a/b.md',page(bullets(40))).warnings)],[[],['page_near_budget']]);
  assert.deepEqual(codes(lintPage('a/b.md',page(bullets(52))).errors),[]);assert.deepEqual(codes(lintPage('a/b.md',page(bullets(53))).errors),['page_budget']);
  assert.deepEqual(codes(lintPage('a/b.md',page('## 现状\n- '+'字'.repeat(298)+'\n')).errors),[]);assert.deepEqual(codes(lintPage('a/b.md',page('## 现状\n- '+'字'.repeat(299)+'\n')).errors),['line_too_long']);
  assert.deepEqual(codes(lintPage('a/b.md',page('## 现状\n'+('- '+'y'.repeat(290)+'\n').repeat(14))).errors),['page_budget']);
  assert.deepEqual([LIMITS.pages,LIMITS.bytes],[500,2*1024*1024]);
});

test('structural checks: front matter, section names, orphan and missing pages, unlisted domains, stray files',t=>{
  const w=wiki(t);w.store.createDomain({name:'infra'});w.store.createPage({domain:'infra',topic:'server',description:'The home server.'});
  assert.deepEqual(codes(lintPage('a/b.md','# no front matter\n').errors),['front_matter']);
  assert.deepEqual(codes(lintPage('a/b.md',page('## 现状\n','name: x\ndescription: y')).errors),['front_matter']);
  // Upstream's indented `metadata:` block is accepted when reading.
  assert.deepEqual(codes(lintPage('a/b.md',page('## 现状\n','name: x\ndescription: y\nmetadata:\n  scope: z')).errors),[]);
  assert.deepEqual(codes(lintPage('a/b.md',page('## 现状（2026-11-13）\n- ok\n## 相关会话\n- no\n## Notes\n')).errors),['section_illegal','section_illegal']);
  assert.deepEqual(codes(lintPage('a/b.md',page(Array.from({length:9},(_,i)=>'line '+i).join('\n')+'\n')).errors),['no_sections']);
  assert.deepEqual(parsePage(['## 待办','- a','# title','- b','## 现状','- c']).sections.map(section=>[section.name,section.line,section.end]),[['待办',1,2],['现状',5,6]]);
  w.write('infra/orphan.md',page('## 现状\n- [[server]] and [[nowhere]]\n'));
  fs.appendFileSync(path.join(w.root,'infra','README.md'),'- [gone](gone.md) — missing\n');
  w.write('loose/README.md','');w.write('notes.md','# stray\n');w.write('infra/data/raw.md','ignored');w.write('infra/photo.png','x');
  fs.appendFileSync(path.join(w.root,'MEMORY.md'),'\n# a heading the owner typed\nfree text\n- [ghost](ghost/README.md)\n');
  const lint=w.store.lint();
  assert.equal(lint.ok,false);
  assert.deepEqual(lint.errors.map(item=>[item.code,item.path]).sort(),[['domain_unlisted','loose/'],['index_other_lines','MEMORY.md'],['missing_page','infra/README.md'],['orphan_page','infra/orphan.md'],['readme_missing','ghost/README.md'],['top_level_page','notes.md']]);
  assert.deepEqual(lint.warnings.map(item=>[item.code,item.path]).sort(),[['link_without_page','infra/orphan.md'],['subdirectory_ignored','infra/data/']]);
  // The same file name in two domains makes [[name]] ambiguous.
  const dup=wiki(t);dup.store.createDomain({name:'a'});dup.store.createDomain({name:'b'});dup.store.createPage({domain:'a',topic:'same',description:'x'});dup.store.createPage({domain:'b',topic:'same',description:'y'});
  assert.deepEqual(codes(dup.store.lint().errors),['page_name_duplicate']);
});

test('reads tolerate anything the owner left in the folder',t=>{
  const w=wiki(t);w.store.createDomain({name:'infra'});w.store.createPage({domain:'infra',topic:'server',description:'The home server.'});
  w.write('MEMORY.md',Buffer.concat([Buffer.from([0xff,0xfe,0x00,0x41,0x0a,0x2d,0x20,0x5b,0x0a]),Buffer.from('- [infra](infra/README.md)\n')]));
  w.write('infra/README.md','- [server](server.md\n- [](\n]]]((((\n- [x](y.md) — z\r\n');
  w.write('infra/binary.md',Buffer.from(Array.from({length:4000},(_,i)=>i%256)));
  w.write('infra/huge.md','x'.repeat(LIMITS.fileBytes+1));
  w.write('infra/crlf.md','\uFEFF---\r\nname: crlf\r\ndescription: Windows line ends.\r\nscope: test\r\n---\r\n## 现状\r\n- fine\r\n');
  w.write('infra/empty.md','');
  fs.mkdirSync(path.join(w.root,'infra','dir.md'));
  const lint=w.store.lint(),tree=w.store.tree();
  assert.equal(lint.ok,false);assert(lint.errors.length>3&&lint.errors.length<=LIMITS.findings);
  assert(lint.errors.every(item=>typeof item.code==='string'&&typeof item.path==='string'&&item.detail.length<=160));
  assert(lint.errors.some(item=>item.code==='page_budget'&&item.path==='infra/huge.md'));
  assert.deepEqual(tree.domains.map(domain=>[domain.name,domain.listed]),[['infra',true]]);assert.equal(tree.pages,5);
  assert(['index_other_lines','orphan_page','missing_page','front_matter'].every(expected=>lint.errors.some(item=>item.code===expected)));
  assert.equal(code(()=>w.store.readPage('infra/huge.md')),'wiki_file_too_large');assert.equal(w.store.pageText('infra/huge.md'),null);assert.equal(w.store.pageSha('infra/huge.md'),null);
  assert.equal(code(()=>w.store.readPage('infra/dir.md')),'wiki_path_refused');assert.equal(code(()=>w.store.readPage('infra/none.md')),'wiki_not_found');
  // CRLF and a BOM are read; the oversized page is not offered to the search index.
  assert.deepEqual(w.store.readPage('infra/crlf.md').front,{name:'crlf',description:'Windows line ends.',scope:'test'});
  assert.deepEqual(w.store.pages().map(item=>item.rel),['infra/binary.md','infra/crlf.md','infra/empty.md','infra/server.md']);
  assert.equal(typeof w.store.readPage('infra/binary.md').text,'string');
  // A root that is a file is reported, not followed.
  const blocked=wiki(t);fs.writeFileSync(blocked.root,'not a directory');
  assert.equal(code(()=>blocked.store.tree()),'wiki_unavailable');assert.equal(code(()=>blocked.store.lint()),'wiki_unavailable');assert.deepEqual(blocked.store.pages(),[]);
});

test('every path stays inside the wiki root; traversal, hidden names and links are refused',t=>{
  const w=wiki(t);w.store.createDomain({name:'infra'});w.store.createPage({domain:'infra',topic:'server',description:'The home server.'});
  const outside=path.join(path.dirname(w.root),'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.md'),page('## 现状\n- OUTSIDE_SECRET\n'));fs.writeFileSync(path.join(outside,'README.md'),'- [secret](secret.md) — x\n');
  for(const rel of ['../outside/secret.md','infra/../../outside/secret.md','/etc/passwd','C:/Windows/win.ini','..\\outside\\secret.md','infra\\server.md','.git/config','infra/.hidden.md','infra//server.md','','a/b/c/d.md','infra/server.md\u0000x','infra/con:stream','infra/server.md ',null,7])
    assert.equal(code(()=>w.store.readPage(rel)),'wiki_path_invalid',String(rel));
  for(const rel of ['../outside/secret.md','infra/README.md','MEMORY.md','infra','infra/sub/x.md'])assert.equal(code(()=>w.store.applyChange({page:rel,section:'现状',op:'add',text:'x'})),'wiki_path_invalid',rel);
  // A junction / directory link inside the wiki is never followed, listed or written through.
  let linked=true;try{fs.symlinkSync(outside,path.join(w.root,'linked'),'junction');}catch{linked=false;}
  if(linked){
    assert.equal(code(()=>w.store.readPage('linked/secret.md')),'wiki_path_refused');
    assert.equal(code(()=>w.store.applyChange({page:'linked/secret.md',section:'现状',op:'add',text:'x'})),'wiki_path_refused');
    assert.deepEqual(w.store.tree().domains.map(domain=>domain.name),['infra']);assert.deepEqual(w.store.pages().map(item=>item.rel),['infra/server.md']);
    assert.deepEqual(codes(w.store.lint().errors),['link_refused']);
    assert(!JSON.stringify(w.store.tree()).includes('secret'));
  }
  // A file link, where the platform allows creating one.
  let fileLinked=true;try{fs.symlinkSync(path.join(outside,'secret.md'),path.join(w.root,'infra','alias.md'),'file');}catch{fileLinked=false;}
  if(fileLinked){
    assert.equal(code(()=>w.store.readPage('infra/alias.md')),'wiki_path_refused');assert.equal(w.store.pageText('infra/alias.md'),null);
    assert(!w.store.pages().some(item=>item.rel==='infra/alias.md'));assert(w.store.lint().errors.some(item=>item.code==='link_refused'&&item.path==='infra/alias.md'));
  }
  assert.equal(fs.readFileSync(path.join(outside,'secret.md'),'utf8').includes('OUTSIDE_SECRET'),true);
  // A wiki root that is itself a link is unavailable.
  if(linked){const store=new WikiStore({root:path.join(w.root,'linked')});assert.equal(code(()=>store.tree()),'wiki_unavailable');assert.deepEqual(store.pages(),[]);}
  assert.throws(()=>new WikiStore({root:'relative/wiki'}),{code:'wiki_unavailable'});
});

test('applyChange: add, replace and remove one line of one section, atomically, with a log line',t=>{
  const w=wiki(t);w.store.createDomain({name:'infra'});const {sha:first}=w.store.createPage({domain:'infra',topic:'server',description:'The home server.'});
  const added=w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'add',text:'SSH listens on port 2222 (2026-11-13)',expectedSha:first});
  assert.deepEqual([added.page,added.line,added.logged],['infra/server.md',11,true]);assert.equal(added.sha,w.store.pageSha('infra/server.md'));
  // A leading bullet marker in the text is not doubled; the bullet goes after the last line of the section.
  assert.equal(w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'add',text:'- Backups run nightly'}).line,12);
  assert.equal(w.store.applyChange({page:'infra/server.md',section:'待办',op:'add',text:'Replace the fan'}).line,17);
  assert.equal(w.read('infra/server.md').split('---\n')[2],'# server\n\n## 现状\n\n## 关键事实\n- SSH listens on port 2222 (2026-11-13)\n- Backups run nightly\n\n## 决策与踩坑\n\n## 待办\n- Replace the fan\n');
  const replaced=w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'replace',text:'SSH listens on port 2200 (2026-11-14)',targetLine:11});
  assert.equal(replaced.line,11);assert.equal(w.read('infra/server.md').split('\n')[10],'- SSH listens on port 2200 (2026-11-14)');
  assert.equal(w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'remove',targetLine:12}).line,null);
  assert(!w.read('infra/server.md').includes('Backups'));
  // The target must be a content line of the named section.
  for(const targetLine of [10,12,13,17,0,99,1.5,null,'11'])assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'replace',text:'x',targetLine})),'wiki_target_invalid',String(targetLine));
  assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'现状',op:'remove',targetLine:11})),'wiki_target_invalid');
  for(const input of [{section:'Notes',op:'add',text:'x'},{section:'现状（旧）',op:'add',text:'x'}])assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',...input})),'wiki_section_invalid');
  assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'现状',op:'rewrite',text:'x'})),'wiki_invalid_request');
  for(const text of ['','   ','two\nlines','tab\there','x'.repeat(299),'# heading','--- rule','```code',5,undefined])assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'现状',op:'add',text})),'wiki_text_invalid',String(text).slice(0,20));
  assert.equal(code(()=>w.store.applyChange({page:'infra/none.md',section:'现状',op:'add',text:'x'})),'wiki_not_found');
  assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'现状',op:'add',text:'x',expectedSha:first})),'wiki_page_changed');
  // A missing section is created in its fixed place, and the owner's CRLF line ends are kept.
  w.write('infra/win.md','---\r\nname: win\r\ndescription: d\r\nscope: s\r\n---\r\n# win\r\n\r\n## 现状\r\n- now\r\n\r\n## 待办\r\n- later\r\n');fs.appendFileSync(path.join(w.root,'infra','README.md'),'- [win](win.md) — d\n');
  assert.equal(w.store.applyChange({page:'infra/win.md',section:'决策与踩坑',op:'add',text:'chosen'}).line,12);
  assert.equal(w.store.applyChange({page:'infra/win.md',section:'关键事实',op:'add',text:'fact'}).line,12);
  assert.equal(w.read('infra/win.md'),'---\r\nname: win\r\ndescription: d\r\nscope: s\r\n---\r\n# win\r\n\r\n## 现状\r\n- now\r\n\r\n## 关键事实\r\n- fact\r\n\r\n## 决策与踩坑\r\n- chosen\r\n\r\n## 待办\r\n- later\r\n');
  w.write('infra/bare.md','---\nname: bare\ndescription: d\nscope: s\n---\n# bare');fs.appendFileSync(path.join(w.root,'infra','README.md'),'- [bare](bare.md) — d\n');
  w.store.applyChange({page:'infra/bare.md',section:'待办',op:'add',text:'first'});
  assert.equal(w.read('infra/bare.md'),'---\nname: bare\ndescription: d\nscope: s\n---\n# bare\n\n## 待办\n- first\n');
  assert.equal(w.store.lint().ok,true);
  // No temporary file is left behind and log.md has one line per applied change, nothing for a refused one.
  assert.deepEqual(fs.readdirSync(path.join(w.root,'infra')).sort(),['README.md','bare.md','server.md','win.md']);
  const log=w.read('log.md').trimEnd().split('\n');
  assert.equal(log.length,2+8);assert.equal(log[2],'- [2026-11-13 09:05] add | infra/server.md | 关键事实 | SSH listens on port 2222 (2026-11-13)');assert.equal(log[6],'- [2026-11-13 09:05] remove | infra/server.md | 关键事实');
});

test('a change that would fail the page checks writes nothing',t=>{
  const w=wiki(t);w.store.createDomain({name:'infra'});w.store.createPage({domain:'infra',topic:'server',description:'The home server.'});
  // Fill the page to exactly 60 lines; the next line is refused and the file and log stay as they are.
  for(let line=14;line<60;line++)w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'add',text:'fact number '+line});
  assert.equal(w.store.readPage('infra/server.md').lines,60);assert.deepEqual(codes(w.store.lint().warnings),['page_near_budget']);
  const before=w.read('infra/server.md'),log=w.read('log.md'),listing=fs.readdirSync(path.join(w.root,'infra'));
  let refused=null;try{w.store.applyChange({page:'infra/server.md',section:'待办',op:'add',text:'one too many'});}catch(error){refused=error;}
  assert.equal(refused?.code,'wiki_lint_failed');assert.deepEqual(refused.details.map(item=>item.code),['page_budget']);
  assert.equal(w.read('infra/server.md'),before);assert.equal(w.read('log.md'),log);assert.deepEqual(fs.readdirSync(path.join(w.root,'infra')),listing);
  // Removing a line is still possible, and so is a replace that keeps the page within its budgets.
  w.store.applyChange({page:'infra/server.md',section:'关键事实',op:'remove',targetLine:11});assert.equal(w.store.readPage('infra/server.md').lines,59);
  // A page the owner broke (an unknown section) must be fixed by the owner before a change is applied to it.
  w.write('infra/server.md',before.replace('## 待办','## Notes'));
  assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'现状',op:'remove',targetLine:9})),'wiki_target_invalid');
  w.write('infra/server.md',page('## 现状\n- ok\n## Notes\n- mine\n'));
  let broken=null;try{w.store.applyChange({page:'infra/server.md',section:'现状',op:'add',text:'more'});}catch(error){broken=error;}
  assert.deepEqual([broken?.code,broken?.details.map(item=>item.code)],['wiki_lint_failed',['section_illegal']]);assert.equal(w.read('infra/server.md'),page('## 现状\n- ok\n## Notes\n- mine\n'));
  // The 2 MiB bound of the whole wiki.
  for(let i=0;i<8;i++)w.write(`infra/pad${i}.md`,'x'.repeat(LIMITS.fileBytes));
  w.write('infra/server.md',page('## 现状\n- ok\n'));
  assert.equal(code(()=>w.store.applyChange({page:'infra/server.md',section:'现状',op:'add',text:'more'})),'wiki_full');
  assert.equal(code(()=>w.store.createPage({domain:'infra',topic:'another',description:'x'})),'wiki_full');
  assert(w.store.lint().errors.some(item=>item.code==='wiki_too_large'));
});
