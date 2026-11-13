'use strict';
// Line-level BM25 search over wiki pages: tokeniser, ranking, date decay, folding to pages and
// the cached index. Pure values and an in-memory page source: no files, no network, no model.
const test=require('node:test'),assert=require('node:assert/strict');
const {tokens,ageDays,decay,Index,foldPages,WikiSearch,TTL_MS}=require('../src/bot/wiki/wiki-search.cjs');
const NOW=new Date(2026,10,13,12,0,0).getTime();
const front=(description,body)=>`---\nname: x\ndescription: ${description}\nscope: s\n---\n${body}`;

test('tokeniser: Chinese runs as two-character pieces, Latin words of two or more, numbers of three or more digits',()=>{
  assert.deepEqual(tokens('服务器端口'),['服务','务器','器端','端口']);
  assert.deepEqual(tokens('猫'),[]);
  assert.deepEqual(tokens('SSH 端口是 2222，不是 22'),['端口','口是','不是','ssh','2222']);
  assert.deepEqual(tokens('port 8080 and 80, v1.2 a id_9 x-ray .env'),['port','8080','and','v1.2','id_9','x-ray','env']);
  assert.deepEqual(tokens('NapCat OneBot ws://127.0.0.1:3001'),['napcat','onebot','ws','127','3001']);
  assert.deepEqual(tokens('日本語のテキスト'),['日本','本語']);
  assert.deepEqual(tokens(''),[]);assert.deepEqual(tokens(null),[]);
});

test('BM25 ranks lines: rarer terms and shorter lines win, short lines and front matter are not indexed',()=>{
  const pages=[
    {rel:'infra/server.md',text:front('SSH port and backups','# server\n## 关键事实\n- SSH listens on port 2222 of the home server\n- The home server backs up every night to the NAS\n- ok\n')},
    {rel:'infra/network.md',text:front('Router and port forwarding','## 关键事实\n- The router forwards port 443 to the home server and port 2222 stays closed from outside\n- Wi-Fi uses channel 36\n')},
    {rel:'life/food.md',text:front('口味','## 关键事实\n- 喜欢吃辣的川菜和火锅\n- 不吃\n- 周末常去那家川菜馆子\n')},
  ];
  const index=new Index(pages,NOW);
  // Lines shorter than six characters and the front matter are left out; a heading is a line like any other.
  assert.equal(index.lines.some(row=>row.text==='- ok'||row.text==='- 不吃'||row.text.startsWith('description:')||row.text==='---'),false);assert.equal(index.lines.some(row=>row.text==='# server'),true);
  assert.deepEqual(index.desc.get('infra/network.md'),'Router and port forwarding');
  const hits=index.search('which port does ssh use?');
  // "ssh" occurs on one line only; "port" on two: the SSH line first, then the long router line.
  assert.deepEqual(hits.map(hit=>[hit.rel,hit.line]),[['infra/server.md',8],['infra/network.md',7]]);assert(hits[0].score>hits[1].score);
  assert.deepEqual(index.search('川菜').map(hit=>[hit.rel,hit.line,hit.text]),[['life/food.md',7,'- 喜欢吃辣的川菜和火锅'],['life/food.md',9,'- 周末常去那家川菜馆子']]);
  // Port numbers are terms of their own.
  assert.deepEqual(index.search('2222').map(hit=>hit.line).sort(),[7,8]);assert.deepEqual(index.search('443').map(hit=>hit.rel),['infra/network.md']);
  assert.deepEqual(index.search('nothing matches this zebra'),[]);assert.deepEqual(index.search(''),[]);
  assert.equal(index.search('home server port router backs night',1).length,1);
  // Identical scores keep line order: deterministic.
  const twin=new Index([{rel:'a/a.md',text:'- same words here\n- same words here\n'}],NOW);
  assert.deepEqual(twin.search('same words').map(hit=>hit.line),[1,2]);
  // An empty index answers nothing.
  assert.deepEqual(new Index([],NOW).search('port'),[]);
});

test('date decay: none for 7 days, then halving every 14 days down to 0.3; settled lines are exempt',()=>{
  assert.equal(ageDays('no date here',NOW),null);
  assert.equal(ageDays('done (2026-11-13)',NOW),0);assert.equal(ageDays('done (2026-11-06)',NOW),7);assert.equal(ageDays('done (2026-10-23)',NOW),21);
  // The newest date on the line counts; a future date does not.
  assert.equal(ageDays('2026-01-01 started, 2026-11-10 finished',NOW),3);assert.equal(ageDays('due 2026-12-24',NOW),null);
  // Month-day without a year: this year, or last year when that would be in the future.
  assert.equal(ageDays('fixed on 11-12',NOW),1);assert.equal(ageDays('fixed on 12-13',NOW),335);
  // Not dates: version-like digit groups and impossible days.
  assert.equal(ageDays('range 100-200-300 and 2026-02-31',NOW),null);
  assert.equal(decay('running (2026-11-13)',NOW),1);assert.equal(decay('running (2026-11-06)',NOW),1);
  assert.equal(decay('running (2026-10-23)',NOW),0.5);assert.equal(decay('running (2026-10-09)',NOW),0.3);assert.equal(decay('running (2020-01-01)',NOW),0.3);
  assert(Math.abs(decay('running (2026-10-30)',NOW)-0.5**0.5)<1e-12);assert.equal(decay('a fact without any date',NOW),1);
  for(const marker of ['定案','已定','常驻','[settled]','[PINNED]'])assert.equal(decay(`old but ${marker}: use SQLite (2020-01-01)`,NOW),1,marker);
  // In the ranking: the same words, the dated-old line falls behind the fresh one, the settled one does not.
  const index=new Index([{rel:'a/old.md',text:'- the bridge uses port 3001 (2026-08-01)\n'},{rel:'a/new.md',text:'- the bridge uses port 3001 (2026-11-12)\n'},{rel:'a/pin.md',text:'- the bridge uses port 3001 (2026-08-01) 定案\n'}],NOW);
  const hits=index.search('bridge port 3001');
  assert.deepEqual(hits.map(hit=>hit.rel),['a/new.md','a/pin.md','a/old.md']);assert(hits[2].score<hits[0].score*0.31&&hits[2].score>hits[0].score*0.29);
});

test('the top lines fold into at most three pages in order of first appearance',()=>{
  const hits=[{rel:'a/1.md',line:5,text:'  - first  '},{rel:'b/2.md',line:9,text:'- second'},{rel:'a/1.md',line:7,text:'- third'},{rel:'c/3.md',line:1,text:'- fourth'},{rel:'d/4.md',line:2,text:'- fifth'},{rel:'b/2.md',line:3,text:'- sixth '+'x'.repeat(400)}];
  const desc=new Map([['a/1.md','About one '+'d'.repeat(200)],['c/3.md','Three']]);
  const pages=foldPages(hits,desc);
  assert.deepEqual(pages.map(page=>[page.page,page.lines.map(line=>line.line)]),[['a/1.md',[5,7]],['b/2.md',[9,3]],['c/3.md',[1]]]);
  assert.equal(pages[0].desc.length,120);assert.equal(pages[1].desc,'');assert.equal(pages[0].lines[0].text,'- first');assert.equal(pages[1].lines[1].text.length,300);
  assert.deepEqual(foldPages(hits,desc,1).map(page=>page.page),['a/1.md']);assert.deepEqual(foldPages([],desc),[]);
});

test('the cached index is rebuilt when a page changed on disk or after 300 seconds',()=>{
  const files=new Map([['a/one.md',{text:'- the garden gate code is kept in the blue notebook\n',mtimeMs:1,size:50}]]);let now=NOW,reads=0;
  const store={pages:()=>[...files].map(([rel,file])=>({rel,mtimeMs:file.mtimeMs,size:file.size})),pageText:rel=>{reads++;return files.get(rel)?.text??null;}};
  const search=new WikiSearch({store,now:()=>now});
  assert.deepEqual(search.search('garden gate').map(page=>page.page),['a/one.md']);assert.equal(search.builds,1);
  search.search('garden');search.search('notebook');assert.equal(search.builds,1);assert.equal(reads,1);
  // A changed mtime or size, a new page or a removed page rebuilds at once.
  files.get('a/one.md').text='- the garden gate code moved to the red notebook\n';files.get('a/one.md').mtimeMs=2;
  assert.equal(search.search('red notebook')[0].lines[0].text,'- the garden gate code moved to the red notebook');assert.equal(search.builds,2);
  files.set('b/two.md',{text:'- the bicycle lock key hangs by the door\n',mtimeMs:1,size:40});
  assert.deepEqual(search.search('bicycle').map(page=>page.page),['b/two.md']);assert.equal(search.builds,3);
  files.delete('a/one.md');assert.deepEqual(search.search('garden'),[]);assert.equal(search.builds,4);
  // Unchanged files: still rebuilt once the index is 300 seconds old (dates age).
  now+=TTL_MS-1;search.search('bicycle');assert.equal(search.builds,4);
  now+=1;search.search('bicycle');assert.equal(search.builds,5);
  // An unreadable page is skipped.
  files.set('c/bad.md',{text:null,mtimeMs:1,size:1});Object.defineProperty(files.get('c/bad.md'),'text',{get(){return null;}});
  assert.deepEqual(search.search('bicycle').map(page=>page.page),['b/two.md']);
  // At most ten lines are folded.
  const many=new WikiSearch({store:{pages:()=>[{rel:'m/many.md',mtimeMs:1,size:1}],pageText:()=>Array.from({length:30},(_,i)=>`- keyword line number ${i} here`).join('\n')},now:()=>now});
  assert.equal(many.search('keyword')[0].lines.length,10);
});
