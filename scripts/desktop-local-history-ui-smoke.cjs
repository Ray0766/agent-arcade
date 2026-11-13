'use strict';
// Actual application renderer; bounded local history IPC is synthetic. No model, QQ or user profile is opened.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{chromium}=require('playwright');
const root=path.resolve(process.env.ARCADE_HISTORY_UI_BASE||path.join(__dirname,'..'));
const overlay=path.resolve(process.env.ARCADE_HISTORY_UI_OVERLAY||root),out=path.resolve(process.argv[2]||path.join(root,'outputs/desktop-local-history-ui'));
fs.mkdirSync(out,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),inputs=new Map();
const read=file=>{const b=fs.readFileSync(file);inputs.set(file,hash(b));return b;};
const fixtureSource=read(path.join(root,'scripts/desktop-chat-ui-smoke.cjs')).toString(),start='await page.addInitScript(({catalog})=>{',from=fixtureSource.indexOf(start),to=fixtureSource.indexOf('},{catalog});',from);assert(from>0&&to>from);
const fixture=fixtureSource.slice(from+start.length,to),catalogPath=path.join(root,'src/core/personas.cjs');read(catalogPath);const catalog=require(catalogPath).publicCatalog();
const receipt={schema:'desktop-local-history-renderer/1',passed:false,actualBackend:false,realModel:false,realQQ:false,actualUserWindow:false,checks:[],screenshots:[],errors:[],external:[]};
let page,mode='ok';const calls=[],pending=[];
async function historyCall(value){
  calls.push(structuredClone(value));const captured=mode;
  if(captured.startsWith('hold'))await new Promise(resolve=>pending.push(resolve));
  if(captured==='hold-fail'||captured==='fail')throw Error('PRIVATE_HISTORY_FAILURE');
  return page.evaluate(value=>{
    const f=roomFixture,b=f.bots[value.accountId];
    if(f.snapshot.accounts.selectedId!==value.accountId||f.kinds[value.accountId]!=='local'||b.local.historyId!==value.historyId)return {ok:false,code:'changed'};
    b.local.historyLimit=Math.min(120,b.local.historyLimit+30);f.publish();return {ok:true,historyId:value.historyId,historyLimit:b.local.historyLimit};
  },value);
}
(async()=>{const browser=await chromium.launch({headless:true});try{
  page=await browser.newPage({viewport:{width:1180,height:900}});page.setDefaultTimeout(7000);page.on('pageerror',e=>receipt.errors.push(e.message));await page.exposeFunction('historyCall',historyCall);
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:41403'){receipt.external.push(u.href);return route.abort();}
    const relative=u.pathname==='/'?'src/ui/index.html':u.pathname.startsWith('/assets/')?'src'+u.pathname:'src/ui'+u.pathname;
    const file=[overlay,root].map(base=>path.join(base,relative)).find(fs.existsSync);if(!file){receipt.external.push(u.pathname);return route.abort();}
    return route.fulfill({body:read(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':undefined});
  });
  await page.addInitScript({content:'const catalog='+JSON.stringify(catalog)+';'+fixture+`
    const original=f.publish;f.kinds={ju:'local',dragon:'local',whale:'local'};f.histories={};
    f.snapshot.config.appearance='light';f.snapshot.appearance={preference:'light',colorScheme:'light'};arcade.initialAppearance=f.snapshot.appearance;
    for(const [id,b]of Object.entries(f.bots)){
      b.status='disconnected';b.social.active=false;
      b.local={supported:true,available:true,canStart:false,state:'active',reason:null,historyId:'history-'+id,historyLimit:30,hasEarlierHistory:true,history:[],characterId:b.social.config.characterId,generation:1};
      f.histories[id]=Array.from({length:104},(_,i)=>({id:id+'-history-'+String(i+1).padStart(3,'0'),role:i%2?'assistant':'user',text:id+' · 第 '+(i+1)+' 条合成对话。'+(i%2?'今天先慢一点，等雨停了再一起聊聊窗外的风景。':'今天路过海边，想把这件小事讲给你听。'),at:1794000000000+i*60000}));
    }
    f.publish=()=>{const s=f.snapshot,b=f.bots[s.accounts.selectedId],kind=f.kinds[s.accounts.selectedId];for(const [id,item]of Object.entries(f.bots)){item.local.history=f.histories[id].slice(-item.local.historyLimit);item.local.hasEarlierHistory=f.histories[id].length>item.local.historyLimit;}
      s.desktopChat={kind,available:kind==='local'?b.local.available:b.status==='connected',contextId:s.accounts.selectedId+'-'+kind};return original();};
    Object.assign(arcade,{desktopLocalHistory:v=>historyCall(v),desktopChatOpen:async()=>{throw Error('Unexpected model admission');},desktopChatSend:async()=>{throw Error('Unexpected model send');},desktopChatClose:async()=>({ok:true}),desktopChatCancel:async()=>({ok:true}),desktopConversationSelect:async v=>{f.kinds[v.accountId]=v.kind;f.publish();return {ok:true,kind:v.kind};}});
  `});
  await page.goto('http://127.0.0.1:41403/');await page.evaluate(()=>{roomFixture.publish();switchView('bot');});
  await page.waitForFunction(()=>document.querySelectorAll('.companion-tabs button').length===3&&Array.from(document.querySelectorAll('.companion-tabs button')).every(n=>n.textContent.trim())&&Array.from(document.querySelectorAll('nav .nav')).every(n=>n.textContent.trim()));
  await page.locator('#desktop-chat-input').waitFor();
  const pass=text=>receipt.checks.push(text),shot=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});receipt.screenshots.push(name+'.png');};
  const earlier=page.locator('#desktop-history-earlier'),rows=page.locator('#bot-messages .bot-message'),pane=page.locator('#bot-thread-scroll');
  const noComposerOverlap=async()=>{
    const result=await page.evaluate(()=>{const latest=document.getElementById('bot-latest'),input=document.getElementById('desktop-chat-input'),send=document.getElementById('desktop-chat-send'),rect=n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};return {visible:!latest.hidden,latest:rect(latest),input:rect(input),send:rect(send),font:getComputedStyle(latest).fontSize};});
    assert(result.visible,'Latest should be visible while reading earlier rows');assert(result.latest.bottom<=result.input.top+1,JSON.stringify(result));assert(result.latest.bottom<=result.send.top+1,JSON.stringify(result));assert.equal(result.font,'12px');return result;
  };
  const top=()=>pane.evaluate(n=>{n.scrollTop=0;});
  const anchor=()=>page.evaluate(()=>{const p=document.getElementById('bot-thread-scroll'),box=p.getBoundingClientRect(),row=Array.from(document.querySelectorAll('#bot-messages .bot-message')).find(n=>n.getBoundingClientRect().bottom>box.top&&n.getBoundingClientRect().top<box.bottom);return row&&{id:row.dataset.messageId,offset:row.getBoundingClientRect().top-box.top};});
  const checkAnchor=async expected=>{const actual=await page.evaluate(id=>{const p=document.getElementById('bot-thread-scroll'),row=Array.from(document.querySelectorAll('#bot-messages .bot-message')).find(n=>n.dataset.messageId===id);return row&&row.getBoundingClientRect().top-p.getBoundingClientRect().top;},expected.id);assert(actual!==null&&Math.abs(actual-expected.offset)<2,JSON.stringify({expected,actual}));};
  const order=()=>rows.evaluateAll(nodes=>nodes.map(n=>n.dataset.messageId));
  const reset=async(id='ju',suffix='reset')=>page.evaluate(({id,suffix})=>{const f=roomFixture;f.snapshot.accounts.selectedId=id;f.kinds[id]='local';f.bots[id].local.historyId='history-'+id+'-'+suffix;f.bots[id].local.historyLimit=30;f.publish();},{id,suffix});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));receipt.initialScroll=await pane.evaluate(n=>({scroll:n.scrollTop,height:n.scrollHeight,client:n.clientHeight}));
  assert.equal(await rows.count(),30);assert.equal(calls.length,0);assert(await page.locator('#desktop-history-feedback').isHidden());assert(await pane.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<64),JSON.stringify(receipt.initialScroll));await top();await shot('01-light-recent');
  pass('Initial App history shows only its current 30 rows with one explicit earlier action; opening does not call history, AI, microphone or QQ.');

  mode='hold';await earlier.click();await page.waitForFunction(()=>document.querySelector('#desktop-history-earlier').disabled);const before=await anchor();assert(before);const firstNode=await rows.first().elementHandle();
  await page.evaluate(()=>{roomFixture.publish();roomFixture.publish();});assert.equal(calls.length,1);await checkAnchor(before);assert.equal(await rows.count(),30);await shot('02-loading');
  pending.shift()();await page.waitForFunction(()=>document.querySelectorAll('#bot-messages .bot-message').length===60);assert.equal(await firstNode.evaluate(n=>n.isConnected),true);await checkAnchor(before);
  assert.deepEqual(await order(),await page.evaluate(()=>roomFixture.bots.ju.local.history.map(m=>m.id)));assert.equal(await earlier.isDisabled(),false);await shot('03-earlier-anchor');
  pass('One pending request is disabled against duplicates; ordinary snapshots preserve the visible row. Loading 60 prepends in source order, keeps existing nodes and holds the same reading offset.');

  mode='ok';await top();await earlier.focus();await earlier.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('#bot-messages .bot-message').length===90&&!document.querySelector('#desktop-history-earlier').disabled);assert(await earlier.evaluate(n=>n===document.activeElement));
  await top();const anchor90=await anchor();await earlier.click();await page.waitForFunction(()=>document.querySelectorAll('#bot-messages .bot-message').length===104);await checkAnchor(anchor90);assert(await earlier.isHidden());assert.equal(await page.textContent('#desktop-history-feedback'),'已显示本机保留的聊天记录');assert.deepEqual(await order(),await page.evaluate(()=>roomFixture.bots.ju.local.history.map(m=>m.id)));await top();await shot('04-retained-end');
  pass('Keyboard and pointer expansion reach 90 then 120-limit/104-retained rows without duplicates; only after expansion is the bounded on-device end label shown.');

  await pane.evaluate(n=>{n.scrollTop=380;});const reading=await anchor();await page.evaluate(()=>{roomFixture.histories.ju.push({id:'ju-app-new',role:'assistant',text:'合成的新回复，不应把阅读位置拉到底部。',at:1794010000000});roomFixture.publish();});await checkAnchor(reading);assert(await page.locator('#bot-latest').isVisible());receipt.latestGeometry=[await noComposerOverlap()];await page.locator('#desktop-chat-input').fill('输入框里的下一句不会被返回最新按钮盖住。');await shot('09-latest-outside-composer');await page.click('#bot-latest');assert(await pane.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<64));
  await page.evaluate(()=>{roomFixture.histories.ju.push({id:'ju-app-new-2',role:'assistant',text:'底部继续收到的合成回复。',at:1794010001000});roomFixture.publish();});assert(await pane.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight<64));
  pass('An arriving reply preserves older reading and exposes Latest; readers already at the bottom continue following new replies.');

  await reset('ju','failure');mode='hold-fail';await top();await earlier.click();await page.waitForFunction(()=>document.querySelector('#desktop-history-earlier').disabled);const failAnchor=await anchor();pending.shift()();await page.getByText('暂时无法读取，请重试。',{exact:true}).waitFor();await checkAnchor(failAnchor);assert(await earlier.isEnabled());assert.doesNotMatch(await page.textContent('#desktop-history'),/PRIVATE_HISTORY_FAILURE/);assert.equal(await rows.count(),30);await shot('05-light-retry');
  mode='ok';await earlier.click();await page.waitForFunction(()=>document.querySelectorAll('#bot-messages .bot-message').length===60);assert(await page.locator('#desktop-history-feedback').isHidden());
  pass('A rejected read keeps current rows, shows fixed retry copy instead of raw errors, and a deliberate retry succeeds.');

  await reset('ju','switch');mode='hold-fail';await top();await earlier.click();await page.waitForFunction(()=>document.querySelector('#desktop-history-earlier').disabled);await page.evaluate(()=>arcade.accountSelect('dragon'));await rows.first().waitFor();assert((await order()).every(x=>x.startsWith('dragon-')));pending.shift()();await page.waitForTimeout(20);assert(await page.locator('#desktop-history-feedback').isHidden());assert(await earlier.isEnabled());
  await page.click('#desktop-conversation-channel');assert.equal(await page.locator('#desktop-history').count(),0);assert.doesNotMatch(await page.textContent('#bot-messages'),/dragon ·/);await page.click('#desktop-conversation-local');assert((await order()).every(x=>x.startsWith('dragon-')));
  pass('An old account failure cannot affect the new account; channel mode has no App history controls or rows, and returning uses only the selected local snapshot.');

  mode='ok';await page.evaluate(()=>{const b=roomFixture.bots.dragon;b.local.available=false;b.local.canStart=true;b.local.state='stopped';roomFixture.publish();});await top();await earlier.click();await page.waitForFunction(()=>document.querySelectorAll('#bot-messages .bot-message').length===60);assert.equal(await page.locator('#desktop-chat-input').count(),0);assert.match(await page.textContent('#bot-status'),/已暂停/);
  pass('A paused App conversation can read saved earlier rows without starting its AI or requiring a connected QQ account.');

  await reset('ju','forget');mode='hold';await top();await earlier.click();await page.waitForFunction(()=>document.querySelector('#desktop-history-earlier').disabled);
  await page.evaluate(()=>{roomFixture.histories.ju=[];roomFixture.publish();});assert.equal(await rows.count(),0);assert(await page.locator('#desktop-history').isHidden());pending.shift()();await page.waitForTimeout(20);assert.equal(await rows.count(),0);assert(await page.locator('#desktop-history').isHidden());assert.doesNotMatch(await page.textContent('#bot-messages'),/ju · 第/);
  pass('Forgetting while a read is pending removes every old row immediately; a later successful metadata response cannot resurrect message text or show a false full-history label.');

  await reset('dragon','old-character');mode='hold';await top();await earlier.click();await page.waitForFunction(()=>document.querySelector('#desktop-history-earlier').disabled);await page.evaluate(()=>{const b=roomFixture.bots.dragon;b.local.historyId='new-character-history';b.local.characterId='deepseek-whale';roomFixture.histories.dragon=[{id:'new-character-one',role:'assistant',text:'新角色自己的合成对话',at:1794010002000}];roomFixture.publish();});pending.shift()();await page.waitForTimeout(20);assert.deepEqual(await order(),['new-character-one']);assert(await page.locator('#desktop-history').isHidden());
  pass('Changing history identity/character discards old control state, and a delayed old acknowledgement neither moves nor restores the new character’s rows.');

  await reset('whale','dark');mode='fail';await page.evaluate(()=>{roomFixture.snapshot.config.appearance='dark';roomFixture.snapshot.appearance={preference:'dark',colorScheme:'dark'};roomFixture.publish();});await top();await earlier.click();await page.getByText('暂时无法读取，请重试。',{exact:true}).waitFor();await shot('06-dark-retry');
  mode='ok';await earlier.click();await page.waitForFunction(()=>document.querySelectorAll('#bot-messages .bot-message').length===60);await page.setViewportSize({width:430,height:640});await top();await earlier.focus();await shot('07-narrow-dark');
  const geometry=async()=>{const g=await page.evaluate(()=>{const p=document.getElementById('desktop-history'),button=document.getElementById('desktop-history-earlier'),body=document.querySelector('.message-body'),r=p.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,button:getComputedStyle(button).fontSize,body:getComputedStyle(body).fontSize};});assert(g.left>=0&&g.right<=g.width+1&&!g.overflow,JSON.stringify(g));assert.equal(g.button,'14px');assert.equal(g.body,'14px');};await geometry();receipt.latestGeometry.push(await noComposerOverlap());
  await page.evaluate(()=>{roomFixture.snapshot.config.language='en';roomFixture.snapshot.config.appearance='light';roomFixture.snapshot.appearance={preference:'light',colorScheme:'light'};roomFixture.publish();document.documentElement.style.zoom='1.5';});await top();await earlier.scrollIntoViewIfNeeded();await geometry();await earlier.focus();await shot('08-english-zoom');assert.equal(await earlier.textContent(),'View earlier messages');receipt.latestGeometry.push(await noComposerOverlap());
  pass('Latest occupies a separate row above the textarea and Send at normal, 430px and 150% sizes; its original 12px styling and explicit bottom action remain.');
  pass('Day/night, 430×640 and 150% English retain the original 14px text, readable quiet controls and keyboard access without horizontal overflow.');
  await page.evaluate(()=>{document.documentElement.style.zoom='';});await page.setViewportSize({width:1180,height:900});
  const portraits=await page.evaluate(()=>Object.fromEntries(roomFixture.snapshot.personas.map(p=>[p.id,p.portrait]))),capsule=id=>page.locator('.companion-tab[data-account-id="'+id+'"] img');
  const initialOtherPortraits=await Promise.all(['ju','dragon'].map(id=>capsule(id).getAttribute('src'))),profileName=await page.locator('.companion-tab[data-account-id="whale"] strong').textContent();
  await page.evaluate(()=>{const b=roomFixture.bots.whale;b.social.config.enabled=false;b.social.config.characterId='claude-ju';b.social.config.name='Ju';b.local.characterId='claude-ju';roomFixture.publish();});
  assert.equal(await capsule('whale').getAttribute('src'),portraits['claude-ju']);assert.equal(await page.locator('#bot-mascot img').getAttribute('src'),portraits['claude-ju']);assert.equal(await page.locator('.companion-tab[data-account-id="whale"] strong').textContent(),profileName);
  assert.deepEqual(await Promise.all(['ju','dragon'].map(id=>capsule(id).getAttribute('src'))),initialOtherPortraits);await shot('10-selected-app-character');
  pass('With social mode disabled, the selected App capsule and heading use its configured character while the explicit profile name and other account portraits are unchanged.');

  await page.evaluate(()=>{const b=roomFixture.bots.whale;b.local.state='stopped';b.local.available=false;b.local.canStart=true;roomFixture.publish();});
  await page.locator('.companion-tab[data-account-id="whale"]').focus();
  await page.evaluate(()=>{const b=roomFixture.bots.whale;b.social.config.characterId='deepseek-whale';b.local.characterId='deepseek-whale';roomFixture.publish();});
  assert.equal(await capsule('whale').getAttribute('src'),portraits['deepseek-whale']);assert(await page.locator('.companion-tab[data-account-id="whale"]').evaluate(n=>n===document.activeElement));
  await page.evaluate(()=>{const b=roomFixture.bots.whale;b.social.config.characterId='claude-ju';b.local.characterId='claude-ju';roomFixture.publish();});
  assert.equal(await capsule('whale').getAttribute('src'),portraits['claude-ju']);assert.equal(await page.locator('#bot-mascot img').getAttribute('src'),portraits['claude-ju']);await shot('11-paused-app-character');
  pass('A character-only change while paused repaints the capsule and preserves its keyboard focus; it does not depend on an App state transition.');

  await page.click('#desktop-conversation-channel');assert.equal(await capsule('whale').getAttribute('src'),portraits['deepseek-whale']);assert.deepEqual(await Promise.all(['ju','dragon'].map(id=>capsule(id).getAttribute('src'))),initialOtherPortraits);
  await page.click('#desktop-conversation-local');assert.equal(await capsule('whale').getAttribute('src'),portraits['claude-ju']);
  assert.equal(await page.locator('.companion-tab[data-account-id="whale"] strong').textContent(),profileName);
  pass('Returning to channel mode uses the unchanged account/backend portrait; selecting App restores its separate persona without altering other accounts or the profile label.');
  assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.external,[]);assert(calls.every(c=>Object.keys(c).sort().join(',')==='accountId,historyId'));
  receipt.historyCalls=calls;receipt.inputs=[...inputs].map(([file,sha256])=>({file,sha256,stable:hash(fs.readFileSync(file))===sha256}));assert(receipt.inputs.every(x=>x.stable));receipt.passed=true;
 }catch(error){receipt.failure=String(error.stack||error);if(page)await page.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length,inputs:receipt.inputs?.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
