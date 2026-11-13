'use strict';
// Wiki proposals: a model may only add pending rows after deterministic checks; a page changes
// only when the owner approves one proposal. Real wiki files and SQLite in a temporary
// directory; the model is an injected function. No network and no model.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {WikiStore}=require('../src/bot/wiki/wiki-store.cjs');
const {WikiSearch}=require('../src/bot/wiki/wiki-search.cjs');
const {WikiProposals,LIMITS,SCHEMA_VERSION}=require('../src/bot/wiki/wiki-proposals.cjs');
const {proposeFromConversation,RULES}=require('../src/bot/wiki/wiki-propose.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-wiki-proposals-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const NOW=new Date(2026,10,13,20,0,0).getTime();
const setup=t=>{
  const dir=temp(t),clock={value:NOW},store=new WikiStore({root:path.join(dir,'wiki'),now:()=>clock.value});
  store.createDomain({name:'infra',description:'Machines and services'});store.createPage({domain:'infra',topic:'server',description:'The home server: ports and backups.'});store.createPage({domain:'infra',topic:'network',description:'Router and Wi-Fi.'});
  store.applyChange({page:'infra/server.md',section:'关键事实',op:'add',text:'SSH listens on port 22'});
  const proposals=new WikiProposals({file:path.join(dir,'wiki-proposals.sqlite'),store,now:()=>clock.value}),search=new WikiSearch({store,now:()=>clock.value});
  return {dir,clock,store,proposals,search,page:rel=>fs.readFileSync(path.join(dir,'wiki',rel),'utf8')};
};
const rows=(...texts)=>texts.flatMap((text,index)=>[{id:`local:m${index+1}`,role:'user',text,at:NOW-100000+index*1000},{id:`local-out:r${index+1}`,role:'assistant',text:'知道了。',at:NOW-100000+index*1000+500}]);
const code=operation=>{try{operation();return null;}catch(error){return error.code;}};
const evidence=[{messageId:'local:m1',quote:'SSH 端口改成 2222'}];
const dataOf=prompt=>JSON.parse(prompt.split('\n').find((line,index,lines)=>lines[index-1]==='BEGIN WIKI_PROPOSAL_DATA'));

test('the proposal store: validation, caps, and a rejected proposal suppresses the same change later',t=>{
  const s=setup(t),sha=s.store.pageSha('infra/server.md'),base={characterId:'claude-ju',page:'infra/server.md',section:'关键事实',op:'add',text:'SSH listens on port 2222',pageSha:sha,evidence};
  {const peek=new DatabaseSync(s.proposals.file);assert.equal(peek.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);peek.close();}
  for(const patch of [{characterId:'Bad Id'},{page:''},{section:'Notes'},{op:'rewrite'},{text:''},{text:'x'.repeat(301)},{text:'two\nlines'},{pageSha:'abc'},{evidence:[]},{evidence:[{messageId:'m',quote:''}]},{evidence:[{messageId:'m',quote:'q'.repeat(121)}]},{evidence:Array.from({length:6},()=>evidence[0])},{targetLine:11},
    {op:'replace'},{op:'replace',targetLine:11,targetText:''},{op:'remove',targetLine:11,targetText:'- x'},{op:'remove',text:'',targetLine:0,targetText:'- x'}])
    assert.equal(code(()=>s.proposals.add({...base,...patch})),'wiki_proposal_invalid',JSON.stringify(patch).slice(0,60));
  const {id}=s.proposals.add(base);
  const stored=s.proposals.get(id);
  assert.deepEqual(stored,{id,characterId:'claude-ju',page:'infra/server.md',section:'关键事实',op:'add',text:'SSH listens on port 2222',targetLine:null,targetText:'',pageSha:sha,evidence,state:'pending',note:'',createdAt:NOW,decidedAt:null,revision:1});
  // The same change again (whitespace, punctuation and case aside): not stored twice.
  assert.deepEqual(s.proposals.add({...base,text:'ssh listens on port 2222.'}),{skipped:'duplicate'});
  assert.deepEqual(s.proposals.list({state:'pending'}).map(item=>item.id),[id]);assert.equal(s.proposals.pendingCount(),1);
  // Reject: kept with its note, and never proposed again.
  const rejected=s.proposals.reject(id,'not true any more');
  assert.deepEqual([rejected.state,rejected.proposal.state,rejected.proposal.note,rejected.proposal.decidedAt,rejected.proposal.revision],['rejected','rejected','not true any more',NOW,2]);
  assert.deepEqual(s.proposals.add(base),{skipped:'rejected_before'});assert.deepEqual(s.proposals.rejectedTexts(),['SSH listens on port 2222']);
  assert.equal(code(()=>s.proposals.reject(id)),'wiki_proposal_decided');assert.equal(code(()=>s.proposals.approve(id)),'wiki_proposal_decided');
  assert.equal(code(()=>s.proposals.approve('nope')),'wiki_proposal_not_found');assert.equal(code(()=>s.proposals.reject('nope','x'.repeat(201))),'wiki_proposal_invalid');
  assert.equal(code(()=>s.proposals.list({state:'unknown'})),'wiki_proposal_invalid');assert.equal(s.proposals.get('nope'),null);
  assert.equal(s.page('infra/server.md').includes('2222'),false);
  // At most 50 pending.
  for(let i=1;i<=LIMITS.pending;i++)assert.match(s.proposals.add({...base,text:'fact number '+i}).id,/^[0-9a-f-]{36}$/);
  assert.equal(code(()=>s.proposals.add({...base,text:'one more'})),'wiki_proposals_full');assert.equal(s.proposals.pendingCount(),50);assert.equal(s.proposals.list().length,51);
  // Rejected rows are kept up to 500; the oldest go first.
  const bulk=setup(t);let at=NOW;bulk.clock.value=at;
  for(let i=0;i<3;i++){bulk.clock.value=++at;const made=bulk.proposals.add({...base,pageSha:bulk.store.pageSha('infra/server.md'),text:'rejected fact '+i});bulk.proposals.reject(made.id);}
  // Older decisions written in one transaction (the same rows the store writes), then one more through the store.
  const fill=new DatabaseSync(bulk.proposals.file),template=fill.prepare("SELECT * FROM proposals WHERE text='rejected fact 1'").get();
  fill.exec('BEGIN');const insert=fill.prepare('INSERT INTO proposals(id,character_id,page,section,op,text,target_line,target_text,page_sha,evidence,fingerprint,state,note,created_at,decided_at,revision) VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,2)');
  for(let i=3;i<LIMITS.rejected+2;i++){++at;insert.run('bulk-'+i,template.character_id,template.page,template.section,template.op,'rejected fact '+i,'',template.page_sha,template.evidence,'print-'+i,'rejected','',at,at);}
  fill.exec('COMMIT');fill.close();
  bulk.clock.value=++at;bulk.proposals.reject(bulk.proposals.add({...base,pageSha:bulk.store.pageSha('infra/server.md'),text:'rejected fact last'}).id);
  const db=new DatabaseSync(bulk.proposals.file);
  assert.equal(db.prepare("SELECT count(*) AS count FROM proposals WHERE state='rejected'").get().count,LIMITS.rejected);
  assert.equal(db.prepare("SELECT count(*) AS count FROM proposals WHERE text IN ('rejected fact 0','rejected fact 2')").get().count,0);db.close();
  assert.deepEqual(bulk.proposals.add({...base,pageSha:bulk.store.pageSha('infra/server.md'),text:'rejected fact last'}),{skipped:'rejected_before'});
  assert.match(bulk.proposals.add({...base,pageSha:bulk.store.pageSha('infra/server.md'),text:'rejected fact 0'}).id,/^[0-9a-f-]{36}$/);
});

test('approve applies through the wiki store only while the page is unchanged; a lint failure writes nothing',t=>{
  const s=setup(t),sha=s.store.pageSha('infra/server.md'),base={characterId:'claude-ju',page:'infra/server.md',section:'关键事实',pageSha:sha,evidence};
  const add=s.proposals.add({...base,op:'add',text:'Backups run at 03:00'}).id;
  const replace=s.proposals.add({...base,op:'replace',text:'SSH listens on port 2222',targetLine:11,targetText:'- SSH listens on port 22'}).id;
  const todo=s.proposals.add({...base,section:'待办',op:'add',text:'Replace the fan'}).id;
  // Approve with the owner's own wording.
  const approved=s.proposals.approve(add,{text:'  Backups run at 03:30 every night  '});
  assert.deepEqual([approved.state,approved.proposal.state,approved.proposal.text,approved.applied.line],['approved','approved','Backups run at 03:30 every night',12]);
  assert(s.page('infra/server.md').includes('- SSH listens on port 22\n- Backups run at 03:30 every night\n'));
  // Our own approved change does not strand the other proposals made against the same text.
  assert.deepEqual(s.proposals.approve(replace).state,'approved');assert(s.page('infra/server.md').includes('- SSH listens on port 2222\n- Backups run at 03:30'));
  // The owner edits the page in an editor: the remaining proposal is superseded, nothing is written.
  const edited=s.page('infra/server.md').replace('## 待办\n','## 待办\n- Call the electrician\n');fs.writeFileSync(path.join(s.dir,'wiki','infra','server.md'),edited);
  const stale=s.proposals.approve(todo);
  assert.deepEqual([stale.state,stale.proposal.state,stale.applied],['superseded','superseded',undefined]);assert.equal(s.page('infra/server.md'),edited);
  assert.equal(code(()=>s.proposals.approve(todo)),'wiki_proposal_decided');
  assert.deepEqual(s.proposals.list().map(item=>item.state).sort(),['approved','approved','superseded']);
  // A replace whose target line moved or changed under an approved change: followed when unique, superseded otherwise.
  const now=s.store.pageSha('infra/server.md'),lines=s.page('infra/server.md').split('\n'),backupLine=lines.indexOf('- Backups run at 03:30 every night')+1;
  const moving=s.proposals.add({...base,pageSha:now,op:'remove',targetLine:backupLine,targetText:'- Backups run at 03:30 every night'}).id;
  const first=s.proposals.add({...base,pageSha:now,op:'remove',targetLine:backupLine-1,targetText:'- SSH listens on port 2222'}).id;
  s.proposals.approve(first);
  assert.equal(s.proposals.get(moving).targetLine,backupLine-1);assert.equal(s.proposals.approve(moving).state,'approved');assert.equal(s.page('infra/server.md').includes('Backups'),false);
  // Lint failure: the proposal stays pending, the page and the log are untouched, the error says why.
  for(let i=s.store.readPage('infra/server.md').lines;i<60;i++)s.store.applyChange({page:'infra/server.md',section:'现状',op:'add',text:'filler '+i});
  const full=s.proposals.add({...base,pageSha:s.store.pageSha('infra/server.md'),op:'add',text:'One line too many'}).id,before=s.page('infra/server.md'),log=s.page('log.md');
  let refused=null;try{s.proposals.approve(full);}catch(error){refused=error;}
  assert.deepEqual([refused?.code,refused?.details.map(item=>item.code)],['wiki_lint_failed',['page_budget']]);
  assert.equal(s.page('infra/server.md'),before);assert.equal(s.page('log.md'),log);assert.equal(s.proposals.get(full).state,'pending');
  // Invalid owner wording is refused before anything happens; a remove takes no wording.
  assert.equal(code(()=>s.proposals.approve(full,{text:'two\nlines'})),'wiki_proposal_invalid');assert.equal(code(()=>s.proposals.approve(full,{text:''})),'wiki_proposal_invalid');
  // A page that was deleted: superseded.
  fs.unlinkSync(path.join(s.dir,'wiki','infra','server.md'));assert.equal(s.proposals.approve(full).state,'superseded');
});

test('a proposal run: strict JSON, verified quotes, existing pages only, secrets never offered or accepted',async t=>{
  const s=setup(t),prompts=[];
  const conversation=[...rows('SSH 端口改成 2222 了，记一下。password: hunter2secret','以后备份都放到 NAS 上','今天天气不错'),{id:'local:cmd',role:'user',text:'记住：我喜欢蓝色',at:NOW-5000},{id:'local-out:command:1',role:'assistant',text:'记住了：我喜欢蓝色',at:NOW-4999}];
  const answer=[
    {page:'infra/server.md',section:'关键事实',op:'replace',text:'SSH listens on port 2222 (2026-11-13)',targetLine:11,evidence:[{messageId:'local:m1',quote:'SSH 端口改成 2222 了'}]},
    {page:'infra/server.md',section:'关键事实',op:'add',text:'Backups go to the NAS',targetLine:null,evidence:[{messageId:'local:m2',quote:'备份都放到 NAS 上'}]},
    // Dropped: a paraphrase passed off as a quote (and not repaired below).
    {page:'infra/server.md',section:'待办',op:'add',text:'Buy a second NAS',evidence:[{messageId:'local:m2',quote:'再买一台 NAS'}]},
    // Dropped: the quote is the companion's, an unknown page, an unknown section, a secret, a heading, extra keys, a target outside the section.
    {page:'infra/server.md',section:'现状',op:'add',text:'Acknowledged',evidence:[{messageId:'local-out:r1',quote:'知道了'}]},
    {page:'infra/new-page.md',section:'现状',op:'add',text:'A new page',evidence:[{messageId:'local:m2',quote:'备份都放到 NAS 上'}]},
    {page:'../outside.md',section:'现状',op:'add',text:'Traversal',evidence:[{messageId:'local:m2',quote:'备份都放到 NAS 上'}]},
    {page:'infra/server.md',section:'Notes',op:'add',text:'Wrong section',evidence:[{messageId:'local:m2',quote:'备份都放到 NAS 上'}]},
    {page:'infra/server.md',section:'关键事实',op:'add',text:'The login is password: hunter2secret',evidence:[{messageId:'local:m1',quote:'SSH 端口改成 2222 了'}]},
    {page:'infra/server.md',section:'关键事实',op:'add',text:'ok',approve:true,evidence:[{messageId:'local:m2',quote:'备份都放到 NAS 上'}]},
    {page:'infra/server.md',section:'待办',op:'remove',targetLine:11,evidence:[{messageId:'local:m1',quote:'SSH 端口改成 2222 了'}]},
  ];
  const ask=async prompt=>{prompts.push(prompt);return prompts.length===1?JSON.stringify(answer):'[]';};
  const result=await proposeFromConversation({characterId:'claude-ju',rows:conversation,store:s.store,search:s.search,proposals:s.proposals,ask,now:NOW});
  assert.deepEqual(result,{problem:null,read:3,proposed:2,dropped:8});
  // Nothing was written to the wiki.
  assert.equal(s.page('infra/server.md').includes('2222'),false);assert.equal(s.page('infra/server.md').includes('NAS'),false);
  const pending=s.proposals.list({state:'pending'}).sort((a,b)=>a.op.localeCompare(b.op));
  assert.deepEqual(pending.map(item=>[item.characterId,item.page,item.section,item.op,item.text,item.targetLine,item.targetText,item.evidence,item.pageSha===s.store.pageSha('infra/server.md')]),[
    ['claude-ju','infra/server.md','关键事实','add','Backups go to the NAS',null,'',[{messageId:'local:m2',quote:'备份都放到 NAS 上'}],true],
    ['claude-ju','infra/server.md','关键事实','replace','SSH listens on port 2222 (2026-11-13)',11,'- SSH listens on port 22',[{messageId:'local:m1',quote:'SSH 端口改成 2222 了'}],true]]);
  // The prompt: our rules, then one line of data; the secret is redacted, the memory command and the companion's replies are left out.
  assert.equal(prompts.length,2);const [prompt]=prompts,data=dataOf(prompt);
  assert(prompt.startsWith(RULES+'\nBEGIN WIKI_PROPOSAL_DATA\n'));assert(prompt.endsWith('\nEND WIKI_PROPOSAL_DATA'));assert.equal(prompt.split('\n').length,RULES.split('\n').length+3);
  assert(RULES.includes('untrusted text')&&RULES.includes('nothing is saved unless they approve it')&&RULES.includes('at most 10 items'));
  assert(!prompt.includes('hunter2secret'));assert(!prompt.includes('我喜欢蓝色'));assert(!prompt.includes('知道了'));
  assert.deepEqual(Object.keys(data),['today','pages','shownPages','rejectedBefore','ownerMessages']);
  assert.deepEqual(data.ownerMessages.map(item=>[item.id,item.text]),[['local:m1','SSH 端口改成 2222 了，记一下。password: [REDACTED]'],['local:m2','以后备份都放到 NAS 上'],['local:m3','今天天气不错']]);
  assert.deepEqual(data.pages.map(item=>item.page),['infra/network.md','infra/server.md']);assert.equal(data.today,'2026-11-13');
  assert.deepEqual(data.shownPages.map(item=>item.page),['infra/server.md']);assert.deepEqual(data.shownPages[0].lines[10],[11,'- SSH listens on port 22']);
  // The repair round names only the item with the unverifiable quote.
  assert.deepEqual(dataOf(prompts[1]).discarded.map(item=>item.text),['Buy a second NAS','Acknowledged']);
  // The next run reads only newer messages; with none there is no model call.
  assert.deepEqual(await proposeFromConversation({characterId:'claude-ju',rows:conversation,store:s.store,search:s.search,proposals:s.proposals,ask:()=>assert.fail('no call'),now:NOW}),{problem:'no_new_messages',read:0,proposed:0,dropped:0});
  // Another character has its own cursor.
  assert.equal(s.proposals.cursor('claude-ju'),conversation[4].at);assert.equal(s.proposals.cursor('0123456789abcdef'),null);
});

test('a proposal run: one repair round, rejected changes are not proposed again, invalid output discards the run',async t=>{
  const s=setup(t),conversation=rows('路由器换成了 AX6000，Wi-Fi 密码没变','服务器风扇该换了');
  // Repair: the second answer fixes the quote; a third call never happens.
  let calls=0;
  const repaired=await proposeFromConversation({characterId:'claude-ju',rows:conversation,store:s.store,search:s.search,proposals:s.proposals,now:NOW,ask:async()=>{calls++;
    return calls===1?JSON.stringify([{page:'infra/network.md',section:'关键事实',op:'add',text:'Router is an AX6000',evidence:[{messageId:'local:m1',quote:'路由器是 AX6000'}]},{page:'infra/server.md',section:'待办',op:'add',text:'Replace the server fan',evidence:[{messageId:'local:m2',quote:'风扇坏了'}]}])
      :'```json\n'+JSON.stringify([{page:'infra/network.md',section:'关键事实',op:'add',text:'Router is an AX6000',evidence:[{messageId:'local:m1',quote:'路由器换成了 AX6000'}]},{page:'infra/server.md',section:'待办',op:'add',text:'Replace the server fan',evidence:[{messageId:'local:m2',quote:'风扇已经坏了'}]}])+'\n```';}});
  assert.deepEqual([repaired,calls],[{problem:null,read:2,proposed:1,dropped:1},2]);
  const [router]=s.proposals.list({state:'pending'});assert.equal(router.text,'Router is an AX6000');
  // The owner rejects it; a later run proposing the same line stores nothing and is told about it as data.
  s.proposals.reject(router.id);
  const later=[...conversation,{id:'local:m9',role:'user',text:'路由器换成了 AX6000，真的',at:NOW-10}];let seen='';
  const again=await proposeFromConversation({characterId:'claude-ju',rows:later,store:s.store,search:s.search,proposals:s.proposals,now:NOW,ask:async prompt=>{seen=prompt;return JSON.stringify([{page:'infra/network.md',section:'关键事实',op:'add',text:'router is an AX6000.',evidence:[{messageId:'local:m9',quote:'路由器换成了 AX6000'}]}]);}});
  assert.deepEqual(again,{problem:null,read:1,proposed:0,dropped:1});assert.deepEqual(dataOf(seen).rejectedBefore,['Router is an AX6000']);assert.equal(s.proposals.pendingCount(),0);
  // Not JSON, not an array, more than ten items, or prose around the array: the whole run is discarded and the cursor stays.
  const fresh=[...later,{id:'local:m10',role:'user',text:'NAS 的地址是 192.168.1.20',at:NOW-5}],cursor=s.proposals.cursor('claude-ju');
  const good={page:'infra/network.md',section:'关键事实',op:'add',text:'NAS is at 192.168.1.20',evidence:[{messageId:'local:m10',quote:'NAS 的地址是 192.168.1.20'}]};
  for(const output of ['I would add one line: '+JSON.stringify([good]),JSON.stringify({proposals:[good]}),JSON.stringify(Array.from({length:11},()=>good)),'[{"page":','',null,'```\n[]\n```\nDone.']){
    assert.deepEqual(await proposeFromConversation({characterId:'claude-ju',rows:fresh,store:s.store,search:s.search,proposals:s.proposals,now:NOW,ask:async()=>output}),{problem:'invalid_output',read:1,proposed:0,dropped:0},String(output).slice(0,30));
  }
  assert.deepEqual(await proposeFromConversation({characterId:'claude-ju',rows:fresh,store:s.store,search:s.search,proposals:s.proposals,now:NOW,ask:async()=>{throw Error('offline');}}),{problem:'runner_failed',read:1,proposed:0,dropped:0});
  assert.equal(s.proposals.cursor('claude-ju'),cursor);assert.equal(s.proposals.pendingCount(),0);
  // The same messages are read again by a valid run; an empty array is a valid answer and moves the cursor.
  assert.deepEqual(await proposeFromConversation({characterId:'claude-ju',rows:fresh,store:s.store,search:s.search,proposals:s.proposals,now:NOW,ask:async()=>JSON.stringify([good,good])}),{problem:null,read:1,proposed:1,dropped:1});
  // An empty wiki cannot be proposed to: no model call.
  const empty={store:new WikiStore({root:path.join(temp(t),'wiki')})};
  assert.deepEqual(await proposeFromConversation({characterId:'claude-ju',rows:fresh,store:empty.store,search:new WikiSearch({store:empty.store}),proposals:s.proposals,now:NOW,ask:()=>assert.fail('no call')}),{problem:'wiki_empty',read:0,proposed:0,dropped:0});
  // A long conversation is cut to the newest messages that fit the runner's prompt limit.
  const long=Array.from({length:60},(_,index)=>({id:'local:long'+index,role:'user',text:`第${index}条 `+'长'.repeat(1900),at:NOW+1000+index}));let size=0,kept=0;
  await proposeFromConversation({characterId:'claude-ju',rows:long,store:s.store,search:s.search,proposals:s.proposals,now:NOW+5000,ask:async prompt=>{size=prompt.length;kept=dataOf(prompt).ownerMessages;return '[]';}});
  assert(size<=24000&&size>18000);assert.equal(kept.at(-1).id,'local:long59');assert(kept.length<12&&kept.length>5);
});
