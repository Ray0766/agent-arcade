'use strict';
// Production renderer with synthetic IPC in an isolated headless browser. No Electron,
// OS credential service, QQ bridge, model request or real user window is opened.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||path.join(root,'outputs/qq-groups-ui'));
fs.mkdirSync(out,{recursive:true});
const inputs=new Map(),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),read=file=>{const body=fs.readFileSync(file);inputs.set(file,hash(body));return body;};
const raw=read(path.join(root,'scripts/desktop-chat-ui-smoke.cjs')).toString(),start='await page.addInitScript(({catalog})=>{',a=raw.indexOf(start),b=raw.indexOf('},{catalog});',a);assert(a>0&&b>a);
const fixture=raw.slice(a+start.length,b),catalog=require(path.join(root,'src/core/personas.cjs')).publicCatalog();
const receipt={schema:'qq-groups-ui/1',passed:false,syntheticIPC:true,actualBackend:false,realQQ:false,realModel:false,actualUserWindow:false,checks:[],screenshots:[],errors:[],external:[]};
let page;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.ARCADE_HEADLESS_BROWSER?{executablePath:process.env.ARCADE_HEADLESS_BROWSER}:{})});
  try{
    page=await browser.newPage({viewport:{width:1180,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',error=>receipt.errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
    await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='http://127.0.0.1:41419'){receipt.external.push(url.href);return route.abort();}const relative=url.pathname==='/'?'src/ui/index.html':url.pathname.startsWith('/assets/')?'src'+url.pathname:'src/ui'+url.pathname,file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){receipt.external.push(url.pathname);return route.abort();}return route.fulfill({body:read(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':undefined});});
    await page.addInitScript({content:'const catalog='+JSON.stringify(catalog)+';'+fixture+`
      f.snapshot.config.appearance='light';f.snapshot.appearance={preference:'light',colorScheme:'light'};arcade.initialAppearance=f.snapshot.appearance;f.snapshot.desktopChat={kind:'channel',available:false,contextId:null};
      for(const bot of Object.values(f.bots)){bot.status='disconnected';bot.social.active=false;bot.social.config.proactiveMessages=false;bot.qq.groups={enabled:false,groupIds:[],proactive:false,active:false,incoming:0,sent:0,skipped:0};}
      arcade.socialConfigure=async options=>{f.calls.push({name:'socialConfigure',value:structuredClone(options)});Object.assign(f.bots[f.snapshot.accounts.selectedId].social.config,options);return f.publish();};
      arcade.socialPause=async()=>{f.calls.push({name:'socialPause'});f.bots[f.snapshot.accounts.selectedId].social.config.proactiveMessages=false;return f.publish();};
      const baseConfigure=arcade.botConfigure;
      arcade.botConfigure=async patch=>{if(!patch.qqGroups){if(patch.qqAccountId!==undefined)f.bots[patch.profileId].qq.expectedAccountId=patch.qqAccountId;return baseConfigure(patch);}f.calls.push({name:'botConfigure',value:structuredClone(patch)});if(f.rejectGroups)throw Error('Synthetic group save failure');if(f.holdGroups)await new Promise(resolve=>f.resolveGroups=resolve);const bot=f.bots[patch.profileId];delete bot.qq.groups.imageGroupIds;delete bot.qq.groups.voiceGroupIds;Object.assign(bot.qq.groups,patch.qqGroups);return f.publish();};
      const roleCards=[
        {id:'0123456789abcdef',name:'阿青',description:'河边的制图师 <i>依水而行</i>',examples:'晨雾与水线\\n第一段对白'},
        {id:'fedcba9876543210',name:'阿青',description:'午后的修表师',examples:'秒针听得见'}
      ];
      arcade.charactersList=async()=>roleCards.map(({id,name})=>({id,name}));
      arcade.groupRolePreview=async value=>{
        f.calls.push({name:'groupRolePreview',value:structuredClone(value)});
        const card=roleCards.find(card=>card.id===value.cardId);
        if(f.holdRolePreview)await new Promise(resolve=>f.resolveRolePreview=resolve);
        f.previewFinished=(f.previewFinished||0)+1;
        return {cardId:card.id,name:card.name,description:card.description,examples:card.examples,approval:'review-'+card.id+'-'+value.groupId};
      };
      arcade.groupRoleSet=async value=>{
        f.calls.push({name:'groupRoleSet',value:structuredClone(value)});
        const target=f.bots[value.profileId].qq;
        if(value.expectedAccountId!==target.expectedAccountId||!target.groups.groupIds.includes(value.groupId))throw Error('Synthetic binding changed');
        const roles=(target.groups.roles||[]).filter(row=>row.groupId!==value.groupId);
        if(value.cardId)roles.push({groupId:value.groupId,cardId:value.cardId,name:roleCards.find(card=>card.id===value.cardId).name});
        target.groups.roles=roles;
        return f.publish().bot;
      };
      const books=[{id:'1234567890abcdef',name:'潮汐档案',entries:500},{id:'fedc0987654321ab',name:'港口值班录',entries:1}];
      arcade.lorebooksList=async()=>books.map(book=>({...book,enabledEntries:book.entries}));
      const bookRole=(target,groupId)=>{
        const saved=(target.qq.groups.roles||[]).find(row=>row.groupId===groupId);
        return saved?{roleId:'card-'+saved.cardId,roleName:saved.name}:{roleId:target.social.config.characterId,roleName:'橘娘'};
      };
      arcade.groupLorebookPreview=async value=>{
        f.calls.push({name:'groupLorebookPreview',value:structuredClone(value)});
        const target=f.bots[value.profileId],book=books.find(book=>book.id===value.bookId),page=value.page??0;
        const binding=bookRole(target,value.groupId);
        const review=Array.from({length:Math.min(10,book.entries-page*10)},(_,offset)=>{
          const index=page*10+offset+1;
          return {keys:index===2?[]:['潮汐'],secondaryKeys:index===1?['海边']:[],constant:index===2,
           content:index===1?'海边地图 <b>应原样显示</b>\\n请阅读这一行。':'合成条目 '+index};
        });
        const result={groupId:value.groupId,bookId:book.id,name:book.name,...binding,page,
          pageCount:Math.ceil(book.entries/10),enabledEntries:book.entries,review,approval:'approve-'+book.id+'-'+value.groupId+'-'+binding.roleId+(f.changedBookHash?'-changed':'')};
        if(f.holdBookPreview)await new Promise(resolve=>f.resolveBookPreview=resolve);
        f.bookPreviewsFinished=(f.bookPreviewsFinished||0)+1;
        return result;
      };
      arcade.groupLorebookSet=async value=>{
        f.calls.push({name:'groupLorebookSet',value:structuredClone(value)});
        const target=f.bots[value.profileId],groups=target.qq.groups;
        if(value.expectedAccountId!==target.qq.expectedAccountId||!groups.groupIds.includes(value.groupId))throw Error('Synthetic binding changed');
        const rows=(groups.lorebooks||[]).filter(row=>row.groupId!==value.groupId||row.roleId!==value.roleId||row.bookId!==value.bookId);
        if(value.approval!==null){
          if(bookRole(target,value.groupId).roleId!==value.roleId)throw Error('Synthetic role changed');
          rows.push({groupId:value.groupId,roleId:value.roleId,bookId:value.bookId,name:books.find(book=>book.id===value.bookId).name});
        }
        groups.lorebooks=rows;
        return f.publish().bot;
      };
      const groupGenerationValues=new Map();
      const publish=f.publish;
      f.publish=()=>{
        for(const [profile,target] of Object.entries(f.bots)){
          const groups=target.qq.groups;
          groups.generation=groups.groupIds.map(groupId=>{
            const binding=bookRole(target,groupId),sampling=groupGenerationValues.get([profile,groupId,binding.roleId].join('/'))||{};
            const ignores=groupId==='678901';
            return {...binding,groupId,sampling,effective:{temperature:ignores?null:sampling.temperature??null,topP:sampling.topP??null,maxTokens:sampling.maxTokens??1024},
              unsupported:ignores?['temperature']:[],gateMaxTokens:ignores?64:null};
          });
        }
        return publish();
      };
      const generationTarget=value=>{
        const target=f.bots[value.profileId],groups=target.qq.groups;
        if(target.status!=='disconnected'||target.qq.expectedAccountId!==value.expectedAccountId||
           !groups.groupIds.includes(value.groupId)||bookRole(target,value.groupId).roleId!==value.roleId)throw Error('Synthetic generation scope changed');
        return [value.profileId,value.groupId,value.roleId].join('/');
      };
      arcade.groupGenerationPreset=async value=>{
        f.calls.push({name:'groupGenerationPreset',value:structuredClone(value)});
        generationTarget(value);
        if(f.holdGroupPreset)await new Promise(resolve=>f.resolveGroupPreset=resolve);
        f.finishedGroupPreset=(f.finishedGroupPreset||0)+1;
        return {groupId:value.groupId,roleId:value.roleId,sampling:{temperature:0,topP:0.55,maxTokens:640}};
      };
      arcade.groupGenerationSet=async value=>{
        f.calls.push({name:'groupGenerationSet',value:structuredClone(value)});
        const key=generationTarget(value);
        if(f.rejectGeneration)throw Error('Synthetic generation save failure');
        if(value.sampling===null)groupGenerationValues.delete(key);
        else groupGenerationValues.set(key,structuredClone(value.sampling));
        return f.publish().bot;
      };
      const feedIdentity='da4c227e-76af-46cc-bc41-5ec52f2397ca';
      const feedRows=[
        {id:'public-feed',name:'合成公开订阅 <b>原样显示</b>',target:'https://feed.example.test/public/rss.xml?token=PRIVATE_FEED_QUERY#PRIVATE_FRAGMENT',identity:feedIdentity},
        {id:'another-feed',name:'另一个公开订阅',target:'https://other.example.test/atom.xml',identity:'530d0151-c268-4073-9d98-50b82c560030'},
      ];
      f.feedRows=feedRows;
      const calendarRows=[
        {id:'community-calendar',name:'合成公开日历 <i>原样显示</i>',target:'community-events.ics',identity:'d48c8930-4141-46d2-adb6-2cbc2ed8ff26'},
        {id:'online-calendar',name:'另一个日历来源',target:'https://calendar.example.test/public/events.ics?token=PRIVATE_CALENDAR_QUERY#PRIVATE_CALENDAR_FRAGMENT',identity:'8cf64294-180e-4dde-83cd-ad47c4999cad'},
        {id:'unsafe-calendar',name:'Unexpected path',target:'/private/synthetic/PRIVATE_CALENDAR_PATH.ics',identity:'4d6bcddd-60e7-49cc-8385-670adfc2e866'},
      ];
      const folderRows=[
        {id:'public-press-kit',name:'合成公开素材 <b>原样显示</b>',target:'public press kit',identity:'f3adb15b-c166-42cd-a599-4b2f1dcbdf45'},
        {id:'other-public-folder',name:'合成公开素材 <b>原样显示</b>',target:'other press kit',identity:'5ab38527-c4de-47af-9d5f-7d59dbd1c034'},
        {id:'unsafe-local-folder',name:'Unexpected path',target:'/private/synthetic/PRIVATE_FOLDER_PATH',identity:'0b762d3d-c746-48e3-9a21-b65ed08d6846'},
        {id:'unsafe-remote-folder',name:'Unexpected URL',target:'https://files.example.test/folder?token=PRIVATE_FOLDER_QUERY',identity:'c6fb1cce-cd61-4c68-890b-50ec3d8678ac'},
      ];
      const pageRows=[
        {id:'community-page',name:'合成公开网页 <i>原样显示</i>',target:'community-page',identity:'9cb6b1c6-1a32-4ee8-85e3-c0c8f7894b8b'},
        {id:'another-page',name:'合成公开网页 <i>原样显示</i>',target:'another-page',identity:'ab726103-5b8a-4802-9d18-f44da91c8b74'},
        {id:'unsafe-page-target',name:'Unexpected raw page',target:'https://page.example.test/PRIVATE_PAGE_PATH?token=PRIVATE_PAGE_QUERY',identity:'6432cdfe-b41b-4012-8e4c-dfb931eec9e2'},
        {id:'wrong-page-target',name:'Unexpected target ID',target:'community-page',identity:'8bd29a2f-2176-4627-a264-1a491be39880'},
      ];
      for(const bot of Object.values(f.bots)){
        bot.qq.groups.feedNotices={feeds:structuredClone(feedRows),binding:null,lastOutcome:''};
        bot.qq.groups.calendarNotices={calendars:structuredClone(calendarRows),binding:null,lastOutcome:'',pending:0};
        bot.qq.groups.folderNotices={folders:structuredClone(folderRows),binding:null,lastOutcome:'',pending:0};
        bot.qq.groups.pageNotices={pages:structuredClone(pageRows),binding:null,lastOutcome:'',pending:0};
      }
      function groupNoticeFixture(method,kind,list){
        arcade[method]=async value=>{
          f.calls.push({name:method,value:structuredClone(value)});
          const target=f.bots[value.profileId],notices=target.qq.groups[kind];
          if(value.expectedAccountId!==target.qq.expectedAccountId||!['disconnected','connected'].includes(target.status))throw Error('PRIVATE_TEST_ERROR');
          if(f.rejectFeed&&kind==='feedNotices')throw Error('PRIVATE_TEST_ERROR');
          if(f.holdFeed&&kind==='feedNotices')await new Promise(resolve=>f.resolveFeed=resolve);
          if(value.enabled){
            const source=notices[list].find(row=>row.id===value.sourceId&&row.identity===value.identity);
            const role=target.qq.groups.generation.find(row=>row.groupId===value.groupId&&row.roleId===value.roleId);
            if(notices.binding||!source||!role)throw Error('PRIVATE_TEST_ERROR');
            notices.binding={groupId:value.groupId,roleId:value.roleId,sourceId:value.sourceId,identity:value.identity,sourceName:source.name,
              status:target.status==='connected'?'ready':'waiting_connection'};
          }else{
            if(!notices.binding||!['groupId','roleId','sourceId','identity'].every(key=>notices.binding[key]===value[key]))throw Error('PRIVATE_TEST_ERROR');
            notices.binding=null;
          }
          if(kind==='feedNotices')f.feedSettled=(f.feedSettled||0)+1;
          f.publish();
          return structuredClone(target);
        };
      }
      groupNoticeFixture('groupFeedSet','feedNotices','feeds');
      groupNoticeFixture('groupCalendarSet','calendarNotices','calendars');
      groupNoticeFixture('groupFolderSet','folderNotices','folders');
      groupNoticeFixture('groupPageSet','pageNotices','pages');
    `});
    await page.goto('http://127.0.0.1:41419/');await page.evaluate(()=>{roomFixture.publish();switchView('connections');});
    const pass=note=>receipt.checks.push(note),shot=async name=>{const file=path.join(out,name+'.png');await page.locator('#toast').waitFor({state:'hidden',timeout:7000});await page.waitForFunction(()=>document.getAnimations().every(a=>!((a.playState==='running'||a.pending)&&Number.isFinite(a.effect?.getComputedTiming().endTime))));await page.screenshot({path:file,animations:'disabled'});receipt.screenshots.push({path:file,sha256:hash(fs.readFileSync(file))});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));};
    const callCount=()=>page.evaluate(()=>roomFixture.calls.filter(x=>x.name==='botConfigure').length),groups=page.locator('#bot-qq-groups'),ids=page.locator('#bot-qq-group-ids'),enable=page.locator('#bot-qq-groups-enabled'),proactive=page.locator('#bot-qq-groups-proactive'),save=page.locator('#bot-qq-groups-save');
    await page.locator('#onboarding-qq-groups').click();await groups.waitFor();assert.equal(await enable.isChecked(),false);assert.equal(await proactive.isChecked(),false);assert(await proactive.isDisabled());assert.equal(await callCount(),0);assert(await page.locator('#bot-qq-manual').evaluate(el=>!el.open));assert.match(await groups.innerText(),/私聊仍只接指定主人|私聊设置保持不变/);assert.match(await groups.innerText(),/原生 macOS QQ 桥接登录尚未核实/);pass('The group entry is discoverable with a saved QQ connection, outside manual bridge details; opening it makes no IPC mutation and defaults remain off.');
    await enable.check();await ids.fill('345678\n456789');await page.evaluate(()=>roomFixture.publish());assert.equal(await ids.inputValue(),'345678\n456789');assert(await enable.isChecked());assert.equal(await proactive.isChecked(),false);await save.click();await page.getByText('群聊设置已保存；此次操作没有连接账号，真实群聊仍待验收。',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>roomFixture.calls.at(-1)),{name:'botConfigure',value:{profileId:'ju',expectedMode:'api',expectedChannel:'qq',qqGroups:{enabled:true,groupIds:['345678','456789'],proactive:false}}});assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.ownerId),'200001');assert.equal(await page.evaluate(()=>roomFixture.calls.filter(x=>/Connect|Login|QR/.test(x.name)).length),0);pass('Saving replies sends only the scoped group configuration, preserves the private owner and never connects, signs in or requests a QR code.');
    const before=await callCount();
    for(const value of ['', '345678\n345678','1234','034567','1234567890123456','345678\n456789\n567890\n678901\n789012\n890123','群名']){await ids.fill(value);await save.click();assert.equal(await callCount(),before);assert.equal(await ids.getAttribute('aria-invalid'),'true');assert(await ids.evaluate(el=>el===document.activeElement));}
    pass('Empty enabled selection, duplicate IDs, malformed IDs, group names and more than five groups fail before IPC and focus the invalid input.');
    await ids.fill('345678，456789');await proactive.check();await save.click();await page.getByText('群聊设置已保存；此次操作没有连接账号，真实群聊仍待验收。',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.groupIds),['345678','456789']);assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.proactive),true);pass('Proactive group messages require their separate explicit switch; Chinese comma input is normalized.');
    const rhythmNote=groups.locator('[data-bot="qqGroupsProactiveNote"]'),groupState=page.locator('#bot-qq-groups-state');
    assert.match(await groupState.innerText(),/主动群消息尚未开启.*相处/);
    assert.match(await rhythmNote.innerText(),/全群安静 15 分钟/);
    assert.match(await rhythmNote.innerText(),/回访优先.*到点后最多等 5 分钟/);
    assert.match(await rhythmNote.innerText(),/共用每群每日额度.*未确认.*普通回复不占用/);
    assert.equal(await proactive.getAttribute('aria-describedby'),await rhythmNote.getAttribute('id'));
    const savedCalls=await callCount();
    await page.evaluate(()=>{roomFixture.bots.ju.social.config.proactiveMessages=true;roomFixture.publish();});
    assert.match(await groupState.innerText(),/主动群消息已允许/);
    assert.equal(await proactive.isChecked(),true);
    assert.equal(await callCount(),savedCalls);
    pass('The saved group switch identifies its dependency on the companion setting, and its accessible description explains group-wide quiet time, follow-up expiry and send-attempt limits.');
    await page.evaluate(()=>{roomFixture.rejectGroups=true;});await ids.fill('567890');await save.click();await page.locator('#toast').filter({hasText:'Synthetic group save failure'}).waitFor();assert.equal(await ids.inputValue(),'567890');assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.groupIds[0]),'345678');assert.doesNotMatch(await page.locator('#bot-qq-groups-feedback').textContent(),/已保存/);pass('A failed save keeps the unsaved draft and does not claim success.');
    await page.evaluate(()=>{roomFixture.rejectGroups=false;roomFixture.snapshot.config.language='en';roomFixture.publish();});assert.equal(await ids.inputValue(),'567890');assert.match(await groups.innerText(),/Voice replies and task tools are not available in groups/);await save.click();await page.getByText('Group settings saved. The account has not been connected by this action; live group chat remains unverified.',{exact:true}).waitFor();await groups.scrollIntoViewIfNeeded();await shot('01-en-group-settings');pass('English translation preserves the draft and explicitly distinguishes unsupported group features and unverified live acceptance.');
    await page.evaluate(()=>{const bot=roomFixture.bots.ju;bot.status='connected';bot.qq.groups.active=true;bot.qq.groups.incoming=4;bot.qq.groups.sent=1;bot.qq.groups.skipped=3;roomFixture.publish();});for(const node of [ids,enable,proactive,save])assert(await node.isDisabled());assert.match(await page.locator('#bot-qq-groups-state').innerText(),/Disconnect before/);assert.match(await page.locator('#bot-qq-groups-runtime').innerText(),/received 4 · sent 1 · skipped 3/);assert.match(await page.locator('[data-bot="messageEntry"]').textContent(),/selected QQ groups/);
    assert.match(await rhythmNote.innerText(),/whole group has been quiet for 15 minutes/);
    assert.match(await rhythmNote.innerText(),/Follow-ups take priority.*expire 5 minutes/);
    assert.match(await rhythmNote.innerText(),/share one daily limit per group.*unconfirmed.*Replies do not use it/);
    assert.match(await groupState.innerText(),/Proactive group messages allowed/);
    const rhythmSettings=page.locator('#bot-qq-groups-companion-settings');
    const socialStart=page.locator('#social-proactiveMessages'),socialPause=page.locator('#social-pause');
    const socialNote=page.locator('.social-toggle-row').filter({has:socialStart}).locator('.social-hint');
    if(!await groups.isVisible())await page.locator('#bot-settings-toggle').click();
    await rhythmSettings.click();
    await socialNote.waitFor();
    assert.match(await socialNote.innerText(),/Private chat only contacts your bound QQ account.*Groups with proactive messages enabled.*hours and limits/);
    await page.waitForFunction(()=>document.activeElement?.id==='social-pause');
    assert.equal(await page.evaluate(()=>roomFixture.calls.filter(x=>x.name==='socialPause'||x.name==='socialConfigure').length),0);
    await socialPause.click();
    await page.getByText('Proactive activity paused. Conversation can continue.',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>roomFixture.calls.filter(x=>x.name==='socialPause'||x.name==='socialConfigure')), [{name:'socialPause'}]);
    await page.locator('#onboarding-qq-groups').click();
    await groups.waitFor();
    assert.match(await groupState.innerText(),/Proactive chat is off in Companion settings/);
    assert.equal(await proactive.isChecked(),true);
    pass('Connected state locks editing and renders counters without claiming acceptance. The direct entry opens the companion controls without mutation, and pausing there updates the group status without discarding the saved group permission.');
    await page.evaluate(()=>{roomFixture.bots.ju.status='disconnected';roomFixture.bots.ju.qq.groups.active=false;roomFixture.snapshot.config.language='zh';roomFixture.publish();});await ids.fill('678901');await page.evaluate(()=>{roomFixture.snapshot.accounts.selectedId='dragon';roomFixture.publish();});assert.equal(await ids.inputValue(),'');assert.equal(await enable.isChecked(),false);pass('Switching companions discards the prior companion’s unsaved group draft.');
    await enable.check();await ids.fill('789012');await page.evaluate(()=>{roomFixture.holdGroups=true;});await save.click();await page.waitForFunction(()=>!!roomFixture.resolveGroups);assert(await save.isDisabled());await page.evaluate(()=>{roomFixture.snapshot.accounts.selectedId='ju';roomFixture.publish();roomFixture.resolveGroups();roomFixture.holdGroups=false;});await save.waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('bot-qq-groups-save').disabled);assert.equal(await ids.inputValue(),'567890');assert.doesNotMatch(await page.locator('#bot-qq-groups-feedback').textContent(),/已保存/);assert.deepEqual(await page.evaluate(()=>roomFixture.bots.dragon.qq.groups.groupIds),['789012']);pass('An in-flight save remains scoped to its original companion; changing companions neither imports its result nor leaves the new form locked.');
    await page.setViewportSize({width:430,height:900});
    for(const [lang,proof] of [['zh','02-zh-narrow'],['en','03-en-narrow']]){
      await page.evaluate(language=>{roomFixture.snapshot.config.language=language;roomFixture.publish();},lang);
      for(const node of [ids,proactive,rhythmNote,save,rhythmSettings]){
        const box=await node.boundingBox();
        assert(box&&box.x>=0&&box.x+box.width<=431);
      }
      await rhythmNote.scrollIntoViewIfNeeded();
      await shot(proof);
    }
    pass('Both languages fit a 430 CSS pixel viewport with reduced motion; group IDs, proactive settings, rhythm explanation and save stay within the viewport.');
    await page.evaluate(()=>{roomFixture.snapshot.config.language='zh';roomFixture.publish();});
    await rhythmSettings.click();
    await socialNote.waitFor();
    assert.match(await socialNote.innerText(),/私聊只联系你绑定的 QQ 号.*单独允许主动消息的群.*联系时段和额度/);
    await page.waitForFunction(()=>document.activeElement?.id==='social-proactiveMessages');
    assert.equal(await socialStart.isEnabled(),true);
    await shot('04-zh-companion-settings-narrow');
    await page.locator('#onboarding-qq-groups').click();
    await groups.waitFor();
    pass('The same link reaches the editable Mandarin companion setting at narrow width, and the note states exactly which private contact and opted-in groups it affects.');
    await page.locator('#bot-qq-advanced').evaluate(node=>node.open=true);await page.locator('#bot-qq-manual').evaluate(node=>node.open=true);assert(await page.locator('#bot-qq-download').isDisabled());pass('The unavailable NapCat download cannot be activated.');
    const roles=page.locator('#bot-qq-group-roles'),account=page.locator('#bot-qq-expected-account'),roleGroup=page.locator('#bot-qq-group-role-group'),roleCard=page.locator('#bot-qq-group-role-card');
    const review=page.locator('#bot-qq-group-role-review'),approve=page.locator('#bot-qq-group-role-approve'),clear=page.locator('#bot-qq-group-role-clear'),preview=page.locator('#bot-qq-group-role-preview');
    const firstCard='0123456789abcdef',secondCard='fedcba9876543210',roleCalls=name=>page.evaluate(name=>roomFixture.calls.filter(call=>call.name===name),name);
    await roles.locator(':scope > summary').click();
    await roles.getByText(/保存搭档的 QQ 号/).waitFor();assert(!await roleGroup.isVisible());
    await account.fill('654321');await page.locator('#bot-qq-save').click();
    await page.waitForFunction(()=>roomFixture.bots.ju.qq.expectedAccountId==='654321');
    assert.equal((await roleCalls('botConfigure')).at(-1).value.qqAccountId,'654321');
    await account.fill('');await page.locator('#bot-qq-save').click();
    assert.equal((await roleCalls('botConfigure')).at(-1).value.qqAccountId,undefined);
    await page.waitForFunction(()=>document.getElementById('bot-qq-expected-account').value==='654321');
    await ids.fill('567890\n678901');assert(!await roleGroup.isVisible());await save.click();
    await roleGroup.waitFor();await roleGroup.selectOption('567890');
    await roleCard.locator('option').filter({hasText:firstCard}).waitFor({state:'attached'});
    assert.deepEqual(await roleCard.locator('option').allTextContents(),['选择角色卡','阿青 · '+firstCard,'阿青 · '+secondCard]);
    pass('The role form requires a saved companion QQ number and group list, omits a blank account patch, and distinguishes same-name cards by ID.');
    await roleCard.selectOption(firstCard);assert(!await approve.isVisible());await review.click();
    await preview.waitFor();assert.match(await preview.innerText(),/654321 · 群 567890/);assert.match(await preview.innerText(),/河边的制图师 <i>依水而行<\/i>/);
    assert.equal(await preview.locator('i').count(),0);assert.match(await preview.innerText(),/晨雾与水线\n第一段对白/);
    assert.deepEqual(await roleCalls('groupRoleSet'),[]);await preview.scrollIntoViewIfNeeded();await shot('05-zh-group-role-preview');
    await approve.click();await roles.getByText('已批准：阿青',{exact:true}).waitFor();
    const expected={profileId:'ju',expectedMode:'api',expectedChannel:'qq',expectedAccountId:'654321',groupId:'567890'};
    assert.deepEqual((await roleCalls('groupRoleSet')).at(-1).value,{...expected,cardId:firstCard,approval:'review-'+firstCard+'-567890'});
    pass('The preview renders exact public strings as text; only explicit approval saves, tied to the selected account, group and card.');
    await roleGroup.selectOption('678901');await roleCard.selectOption(firstCard);
    await page.evaluate(()=>roomFixture.holdRolePreview=true);await review.click();
    await page.waitForFunction(()=>!!roomFixture.resolveRolePreview);
    await roleCard.selectOption(secondCard);
    await page.evaluate(()=>{roomFixture.holdRolePreview=false;roomFixture.resolveRolePreview();});
    await page.waitForFunction(()=>roomFixture.previewFinished===2);assert(!await preview.isVisible());
    await review.click();await preview.waitFor();assert.match(await preview.innerText(),/午后的修表师/);assert.doesNotMatch(await preview.innerText(),/制图师/);
    await page.evaluate(()=>{roomFixture.snapshot.config.language='en';roomFixture.publish();});
    assert.match(await preview.innerText(),/Example dialogue/);await preview.scrollIntoViewIfNeeded();await shot('06-en-group-role-preview');
    await approve.click();await roles.getByText('Approved: 阿青',{exact:true}).waitFor();
    assert.equal((await roleCalls('groupRoleSet')).at(-1).value.cardId,secondCard);
    assert.equal((await roleCalls('groupRoleSet')).at(-1).value.groupId,'678901');
    assert.deepEqual(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.roles.map(row=>row.cardId)),[firstCard,secondCard]);
    pass('Switching cards discards late review data. The second group saves the second same-name card without revising the first.');
    await page.evaluate(()=>{const bot=roomFixture.bots.ju;bot.status='connected';bot.qq.groups.reviewRequiredGroupIds=['567890'];roomFixture.publish();});
    await page.evaluate(()=>switchView('connections'));await page.locator('#onboarding-qq-groups').click();
    const reviewAlert=page.locator('#bot-qq-group-role-alert');
    await reviewAlert.waitFor();assert.match(await reviewAlert.innerText(),/Replies are paused.*567890/);
    if(!await roles.evaluate(node=>node.open))await roles.locator(':scope > summary').click();
    await roleGroup.waitFor();assert(await review.isDisabled());assert(await clear.isDisabled());assert(!await approve.isVisible());
    await page.evaluate(()=>{const bot=roomFixture.bots.ju;bot.status='disconnected';bot.qq.groups.reviewRequiredGroupIds=[];roomFixture.publish();});
    await page.evaluate(()=>switchView('connections'));await page.locator('#onboarding-qq-groups').click();
    if(!await roles.evaluate(node=>node.open))await roles.locator(':scope > summary').click();
    await roleGroup.selectOption('567890');await roles.getByText('Approved: 阿青',{exact:true}).waitFor();await clear.click();
    await roles.getByText('This group uses the default companion role.',{exact:true}).waitFor();
    assert.deepEqual((await roleCalls('groupRoleSet')).at(-1).value,{...expected,cardId:null,approval:null});
    assert.deepEqual(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.roles.map(row=>row.cardId)),[secondCard]);
    pass('Connected role changes are locked and stale bindings are identified. Restoring the default clears exactly one group.');
    const groupImages=page.locator('#bot-qq-group-images'),firstImage=groupImages.locator('[value="567890"]'),secondImage=groupImages.locator('[value="678901"]');
    assert.equal(await firstImage.isChecked(),false);assert.equal(await secondImage.isChecked(),false);
    assert.match(await groupImages.innerText(),/one supported still image.*sent to your AI provider.*exact quote.*same group.*stay silent/);
    const beforeImages=await callCount();await firstImage.check();await page.evaluate(()=>roomFixture.publish());
    assert(await firstImage.isChecked());assert.equal(await secondImage.isChecked(),false);assert.equal(await callCount(),beforeImages);
    await groupImages.scrollIntoViewIfNeeded();await shot('07-en-group-images');
    await save.click();await groups.getByText('Group settings saved. The account has not been connected by this action; live group chat remains unverified.',{exact:true}).waitFor();
    assert.deepEqual((await roleCalls('botConfigure')).at(-1).value.qqGroups.imageGroupIds,['567890']);
    pass('Image permission starts off for each group, stays in draft through a status update, and saving sends only the selected group ID. The English copy explains provider disclosure, exact same-group quoting and silent reply decisions.');
    await secondImage.check();await page.evaluate(()=>{roomFixture.snapshot.accounts.selectedId='dragon';roomFixture.publish();});
    assert.equal(await groupImages.locator('input:checked').count(),0);
    await page.evaluate(()=>{roomFixture.snapshot.accounts.selectedId='ju';roomFixture.snapshot.config.language='zh';roomFixture.publish();});
    assert(await firstImage.isChecked());assert.equal(await secondImage.isChecked(),false);
    assert.match(await groupImages.innerText(),/发送给你选择的 AI 提供商.*可选择不回复.*仅影响群聊/);
    await groupImages.scrollIntoViewIfNeeded();await shot('08-zh-group-images');
    await ids.fill('678901');assert.equal(await firstImage.count(),0);
    await ids.fill('567890\n678901');assert.equal(await firstImage.isChecked(),false);
    await save.click();await groups.getByText('群聊设置已保存；此次操作没有连接账号，真实群聊仍待验收。',{exact:true}).waitFor();
    assert.equal(Object.hasOwn((await roleCalls('botConfigure')).at(-1).value.qqGroups,'imageGroupIds'),false);
    assert.equal(await page.evaluate(()=>!!roomFixture.bots.ju.qq.groups.imageGroupIds),false);
    pass('Changing profiles discards unsaved image choices. Removing a group and adding it again does not restore that group’s permission; saving an empty choice omits and clears the optional field.');
    await page.evaluate(()=>{roomFixture.bots.ju.status='connected';roomFixture.publish();switchView('connections');});
    await page.locator('#onboarding-qq-groups').click();await firstImage.waitFor();
    assert(await firstImage.isDisabled());assert(await secondImage.isDisabled());
    pass('Both image permission controls are locked while the group connection is active.');
    const groupVoice=page.locator('#bot-qq-group-voice'),firstVoice=groupVoice.locator('[value="567890"]'),secondVoice=groupVoice.locator('[value="678901"]');
    const voiceNote=groupVoice.locator('#bot-qq-group-voice-note'),voicePrivacy=groupVoice.locator('#bot-qq-group-voice-privacy');
    const firstVoiceSource=groupVoice.locator('#bot-qq-group-voice-source-567890'),secondVoiceSource=groupVoice.locator('#bot-qq-group-voice-source-678901');
    assert(await firstVoice.isDisabled());assert(await secondVoice.isDisabled());
    await page.evaluate(()=>{roomFixture.bots.ju.status='disconnected';roomFixture.snapshot.config.language='en';roomFixture.publish();switchView('connections');});
    await page.locator('#onboarding-qq-groups').click();await firstVoice.waitFor();
    assert.equal(await groupVoice.locator('input:checked').count(),0);
    assert.match(await voiceNote.innerText(),/Configure local speech recognition first.*verified inline WAV or QQ PTT link tied to the exact group message.*decoded locally from SILK.*filename alone cannot locate/);
    assert.match(await voicePrivacy.innerText(),/transcribed on this computer.*transcript may go to your AI provider.*cannot execute commands.*Private voice and voice sending use separate settings/);
    const beforeVoice=await callCount(),groupProactive=await proactive.isChecked();await secondVoice.check();await firstImage.check();await page.evaluate(()=>roomFixture.publish());
    assert(await secondVoice.isChecked());assert.equal(await firstVoice.isChecked(),false);assert.equal(await callCount(),beforeVoice);
    assert.equal(await secondVoiceSource.innerText(),'Voice source unverified.');assert(!await firstVoiceSource.isVisible());
    await groupVoice.scrollIntoViewIfNeeded();await shot('09-en-group-voice');
    await save.click();await groups.getByText('Group settings saved. The account has not been connected by this action; live group chat remains unverified.',{exact:true}).waitFor();
    assert.deepEqual((await roleCalls('botConfigure')).at(-1).value.qqGroups,{enabled:true,groupIds:['567890','678901'],proactive:groupProactive,imageGroupIds:['567890'],voiceGroupIds:['678901']});
    pass('Voice starts off, stays locked while connected, and saves only the explicitly selected group without changing the independent image list. English copy explains configured local recognition, verified WAV/PTT sources and transcript disclosure.');
    await firstVoice.check();await page.evaluate(()=>{roomFixture.snapshot.accounts.selectedId='dragon';roomFixture.publish();});
    assert.equal(await groupVoice.locator('input:checked').count(),0);
    await page.evaluate(()=>{roomFixture.snapshot.accounts.selectedId='ju';roomFixture.snapshot.config.language='zh';roomFixture.publish();});
    assert(await secondVoice.isChecked());assert.equal(await firstVoice.isChecked(),false);
    assert.match(await voiceNote.innerText(),/配置本机语音识别.*原群消息核对一致的内嵌 WAV 或 QQ PTT 链接.*本机解码 SILK.*仅凭文件名无法定位录音/);
    assert.match(await voicePrivacy.innerText(),/语音在本机转写.*可能发给你选择的 AI 提供商.*不能用来执行指令.*私聊语音和语音发送使用各自的设置/);
    assert.equal(await secondVoiceSource.innerText(),'语音来源尚未核实。');
    await groupVoice.scrollIntoViewIfNeeded();await shot('10-zh-group-voice');
    await page.evaluate(()=>{const bot=roomFixture.bots.ju;bot.status='connected';bot.qq.groups.voiceSources={'567890':'inline-wav','678901':'qq-ptt'};roomFixture.publish();switchView('connections');});
    await page.locator('#onboarding-qq-groups').click();await secondVoiceSource.waitFor();
    assert.equal(await secondVoiceSource.innerText(),'本次连接已核实：QQ PTT 已在本机解码。');assert(!await firstVoiceSource.isVisible());
    assert.equal(await secondVoice.getAttribute('aria-describedby'),'bot-qq-group-voice-source-678901');
    await groupVoice.scrollIntoViewIfNeeded();await shot('11-zh-verified-qq-ptt');
    await page.evaluate(()=>{roomFixture.snapshot.config.language='en';roomFixture.bots.ju.qq.groups.voiceSources['678901']='inline-wav';roomFixture.publish();});
    assert.equal(await secondVoiceSource.innerText(),'Verified this connection: inline WAV.');
    await page.evaluate(()=>{roomFixture.bots.ju.qq.groups.voiceSources['678901']='unavailable';roomFixture.publish();});
    assert.match(await secondVoiceSource.innerText(),/Voice unavailable.*local speech recognition.*ask the sender to use text/);
    await groupVoice.scrollIntoViewIfNeeded();await shot('12-en-voice-unavailable');
    await page.evaluate(()=>{const bot=roomFixture.bots.ju;bot.status='disconnected';bot.qq.groups.voiceSources['678901']='qq-ptt';roomFixture.snapshot.config.language='zh';roomFixture.publish();switchView('connections');});
    await page.locator('#onboarding-qq-groups').click();await secondVoiceSource.waitFor();
    assert.equal(await secondVoiceSource.innerText(),'语音来源尚未核实。');
    pass('Observed verified sources and actionable failure are scoped to the opted-in group and current connection; reconnect settings show unverified even with stale last-connection data in the fixture.');
    await ids.fill('567890');assert.equal(await secondVoice.count(),0);
    await ids.fill('567890\n678901');assert.equal(await secondVoice.isChecked(),false);assert(await firstImage.isChecked());
    await save.click();await groups.getByText('群聊设置已保存；此次操作没有连接账号，真实群聊仍待验收。',{exact:true}).waitFor();
    const clearedVoice=(await roleCalls('botConfigure')).at(-1).value.qqGroups;
    assert.equal(Object.hasOwn(clearedVoice,'voiceGroupIds'),false);assert.deepEqual(clearedVoice.imageGroupIds,['567890']);
    assert.equal(await page.evaluate(()=>!!roomFixture.bots.ju.qq.groups.voiceGroupIds),false);
    pass('Voice drafts cannot move to another profile or return after a group is removed and re-added. Empty voice permission clears the field while preserving image permission, and the Chinese copy describes the same boundary.');
    const asrText=groupVoice.locator('#bot-qq-group-voice-asr');assert(!await asrText.isVisible());
    const preAsrCalls=await page.evaluate(()=>roomFixture.calls.length);
    const asrStatus=async(os,language,availability)=>{
      await page.evaluate(({os,language,availability})=>{
        arcade.platform={os};roomFixture.snapshot.config.language=language;
        roomFixture.bots.ju.qq.groups.asrAvailability=availability;roomFixture.publish();
      },{os,language,availability});
      return asrText.innerText();
    };
    const configured={configured:true,available:false,reason:'asr_unverified'},verified={configured:true,available:true};
    assert.equal(await asrStatus('darwin','zh',{available:false,reason:'asr_unavailable'}),'本机语音识别尚未配置。');
    assert.equal(await asrStatus('darwin','en',configured),'Local speech recognition is configured. Waiting for a successful transcription.');
    assert.equal(await asrStatus('darwin','zh',configured),'本机语音识别已配置，等待一次成功转写。');
    await groupVoice.scrollIntoViewIfNeeded();await shot('13-zh-asr-unverified');
    assert.equal(await asrStatus('darwin','zh',verified),'本机语音识别已通过实际转写验证。');
    assert.equal(await asrStatus('darwin','en',verified),'Local speech recognition verified with a successful transcription.');
    await groupVoice.scrollIntoViewIfNeeded();await shot('14-en-asr-verified');
    assert.equal(await asrStatus('win32','en',{available:true}),'Local speech recognition is configured.');
    assert.equal(await page.evaluate(()=>roomFixture.calls.length),preAsrCalls);
    pass('Group voice renders unavailable, configured-but-unverified, and successful Mac transcription states in both languages. Windows reports configuration only, and reading any state makes zero settings or playback calls.');
    const bookDetails=page.locator('#bot-qq-group-lorebooks'),books=bookDetails.locator('#bot-qq-group-lorebook-book'),bookPreview=bookDetails.locator('#bot-qq-group-lorebook-preview');
    const bookReview=bookDetails.locator('#bot-qq-group-lorebook-review'),bookApprove=bookDetails.locator('#bot-qq-group-lorebook-approve'),bookPages=bookDetails.locator('#bot-qq-group-lorebook-page');
    const reviewedEntries=bookDetails.locator('#bot-qq-group-lorebook-entries'),bookReadback=bookDetails.locator('#bot-qq-group-lorebook-approved');
    const tide='1234567890abcdef',port='fedc0987654321ab',bookWarning=page.locator('#bot-qq-group-lorebook-alert');
    if(!await roles.evaluate(node=>node.open))await roles.locator(':scope > summary').click();
    await roleGroup.selectOption('678901');
    if(!await bookDetails.evaluate(node=>node.open))await bookDetails.locator('summary').click();
    await books.locator('option').filter({hasText:'潮汐档案'}).waitFor({state:'attached'});await books.selectOption(tide);
    await bookReview.click();await bookPreview.waitFor();
    const bookScope={...expected,groupId:'678901'},roleId='card-'+secondCard;
    assert.deepEqual((await roleCalls('groupLorebookPreview')).at(-1).value,{...bookScope,bookId:tide,page:0});
    assert.match(await bookPreview.innerText(),/654321 · group 678901[\s\S]*World book · 潮汐档案[\s\S]*Saved role · 阿青[\s\S]*Page 1 of 50 · 500 enabled entries/);
    assert.equal(await reviewedEntries.locator('section').count(),10);
    assert.match(await reviewedEntries.innerText(),/Primary keys[\s\S]*Secondary keys[\s\S]*海边地图 <b>应原样显示<\/b>\n请阅读这一行。[\s\S]*Always eligible/);
    assert.equal(await reviewedEntries.locator('b').count(),0);assert.deepEqual(await roleCalls('groupLorebookSet'),[]);
    await bookPages.selectOption({value:'49'});await bookPreview.getByText('Page 50 of 50 · 500 enabled entries',{exact:true}).waitFor();
    assert.match(await reviewedEntries.innerText(),/合成条目 500/);assert(await bookDetails.locator('#bot-qq-group-lorebook-next').isDisabled());
    assert.equal((await roleCalls('groupLorebookPreview')).at(-1).value.page,49);
    await bookPreview.scrollIntoViewIfNeeded();await shot('15-en-world-book-last-page');
    await page.evaluate(()=>roomFixture.changedBookHash=true);await bookDetails.locator('#bot-qq-group-lorebook-prev').click();
    await bookDetails.getByText(/world book changed or could not be read/).waitFor();assert(!await bookApprove.isVisible());assert.deepEqual(await roleCalls('groupLorebookSet'),[]);
    pass('A full 500-entry world book is reviewed in accessible ten-entry pages. Entries render primary/secondary keys, always eligibility and exact text without HTML. An inconsistent page hash discards approval.');
    await page.evaluate(()=>{roomFixture.changedBookHash=false;roomFixture.snapshot.config.language='zh';roomFixture.publish();});
    await bookReview.click();await bookPreview.waitFor();
    assert.match(await bookPreview.innerText(),/整本世界书|共 500 条启用条目/);assert(await bookApprove.isEnabled());
    await bookPreview.scrollIntoViewIfNeeded();await shot('16-zh-world-book-preview');
    await bookApprove.click();await bookReadback.getByText('潮汐档案',{exact:true}).waitFor();
    assert.deepEqual((await roleCalls('groupLorebookSet')).at(-1).value,{...bookScope,bookId:tide,roleId,approval:'approve-'+tide+'-678901-'+roleId});
    await books.selectOption(port);await bookReview.click();await bookPreview.waitFor();await bookApprove.click();
    await bookReadback.getByText('港口值班录',{exact:true}).waitFor();assert.equal(await bookReadback.locator('li').count(),2);
    await roleGroup.selectOption('567890');assert(!await bookReadback.isVisible());
    await books.locator('option').filter({hasText:'港口值班录'}).waitFor({state:'attached'});await books.selectOption(port);await bookReview.click();await bookPreview.waitFor();await bookApprove.click();
    await bookReadback.getByText('港口值班录',{exact:true}).waitFor();
    assert.equal((await roleCalls('groupLorebookSet')).at(-1).value.roleId,'claude-ju');
    pass('Multiple independent books can be approved one at a time for one role and group. A different group uses its saved built-in role and receives no approvals by default.');
    await roleGroup.selectOption('678901');
    await books.locator('option').filter({hasText:'潮汐档案'}).waitFor({state:'attached'});await books.selectOption(tide);
    const previewsBefore=await page.evaluate(()=>roomFixture.bookPreviewsFinished);
    await page.evaluate(()=>roomFixture.holdBookPreview=true);await bookReview.click();await page.waitForFunction(()=>!!roomFixture.resolveBookPreview);
    await page.evaluate(cardId=>{
      const groups=roomFixture.bots.ju.qq.groups;
      groups.roles=groups.roles.map(row=>row.groupId==='678901'?{...row,cardId}:row);
      roomFixture.publish();roomFixture.holdBookPreview=false;roomFixture.resolveBookPreview();
    },firstCard);
    await page.waitForFunction(before=>roomFixture.bookPreviewsFinished===before+1,previewsBefore);
    assert(!await bookApprove.isVisible());assert.match(await bookReadback.innerText(),/为旧角色批准/);
    const removeTide=bookReadback.locator('[data-book-id="'+tide+'"]');await removeTide.click();await removeTide.waitFor({state:'detached'});
    assert.deepEqual((await roleCalls('groupLorebookSet')).at(-1).value,{...bookScope,bookId:tide,roleId,approval:null});
    assert.deepEqual(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.lorebooks.map(row=>[row.groupId,row.bookId])),[['678901',port],['567890',port]]);
    await page.evaluate(()=>{
      const bot=roomFixture.bots.ju;bot.status='connected';bot.qq.groups.lorebookReviewRequiredGroupIds=['678901'];roomFixture.publish();switchView('connections');
    });
    await page.locator('#onboarding-qq-groups').click();await bookWarning.waitFor();assert.match(await bookWarning.innerText(),/678901.*断开连接/);
    if(!await roles.evaluate(node=>node.open))await roles.locator(':scope > summary').click();
    await roleGroup.selectOption('678901');
    if(!await bookDetails.evaluate(node=>node.open))await bookDetails.locator('summary').click();
    assert(await bookReview.isDisabled());assert(await bookReadback.locator('[data-book-id="'+port+'"]').isDisabled());
    pass('A stale same-name role response cannot be approved. The exact earlier book approval can be revoked without removing other group books. Review and revoke lock while connected, and a stale world book has a visible warning.');
    await page.evaluate(()=>{
      const bot=roomFixture.bots.ju;bot.status='disconnected';roomFixture.snapshot.config.language='zh';roomFixture.publish();switchView('connections');
    });
    await page.locator('#onboarding-qq-groups').click();
    if(!await roles.evaluate(node=>node.open))await roles.locator(':scope > summary').click();
    await roleGroup.selectOption('678901');
    if(await bookDetails.evaluate(node=>node.open))await bookDetails.locator(':scope > summary').click();
    const generation=page.locator('#bot-qq-group-generation'),parameter=key=>generation.locator('#bot-qq-group-generation-'+key);
    await generation.getByText('群回复生成参数',{exact:true}).click();
    const temperature=parameter('temperature'),topP=parameter('topP'),maxTokens=parameter('maxTokens'),copy=parameter('copy'),saveGeneration=parameter('save'),reset=parameter('reset');
    const scope={...bookScope,roleId:'card-'+firstCard};
    await parameter('scope').getByText('搭档 QQ 654321 · 群 678901 · 阿青',{exact:true}).waitFor();
    assert.match(await parameter('effective').innerText(),/Top-P 服务默认.*回复 token 上限 1024/);
    assert.equal(await parameter('unsupported').innerText(),'当前后端忽略的参数 · 温度');
    assert.equal(await parameter('gate').innerText(),'独立接话判断的 token 上限 · 64');
    assert.equal(await temperature.inputValue(),'');assert.equal(await topP.inputValue(),'');assert.equal(await maxTokens.inputValue(),'');
    for(const [field,bad] of [[temperature,'2.1'],[topP,'-0.1'],[maxTokens,'64.5'],[maxTokens,'63'],[maxTokens,'8193']]){
      await field.fill(bad);await saveGeneration.click();
      assert.deepEqual(await roleCalls('groupGenerationSet'),[]);
      assert.equal(await field.getAttribute('aria-invalid'),'true');
      assert(await field.evaluate(input=>input===document.activeElement));
      await field.fill('');
    }
    await copy.click();await parameter('feedback').getByText(/点击保存后才会应用/).waitFor();
    assert.deepEqual((await roleCalls('groupGenerationPreset')).at(-1).value,scope);
    assert.deepEqual(await roleCalls('groupGenerationSet'),[]);
    assert.equal(await temperature.inputValue(),'0');assert.equal(await topP.inputValue(),'0.55');assert.equal(await maxTokens.inputValue(),'640');
    assert.match(await parameter('effective').innerText(),/1024/);
    await generation.scrollIntoViewIfNeeded();await shot('17-zh-group-generation-draft');
    pass('Group reply generation renders the exact saved role, effective reply settings, ignored values and independent gate. Invalid values never reach IPC. Copying numeric preset values preserves zero and leaves settings unchanged until Save.');
    await page.evaluate(()=>roomFixture.rejectGeneration=true);
    await saveGeneration.click();await parameter('feedback').getByText(/未能保存回复参数/).waitFor();
    assert.equal(await maxTokens.inputValue(),'640');assert.match(await parameter('effective').innerText(),/1024/);
    await page.evaluate(()=>roomFixture.rejectGeneration=false);await temperature.fill('');await saveGeneration.click();
    await parameter('feedback').getByText(/已保存此群角色/).waitFor();
    assert.deepEqual((await roleCalls('groupGenerationSet')).at(-1).value,{...scope,sampling:{topP:0.55,maxTokens:640}});
    assert.match(await parameter('effective').innerText(),/Top-P 0.55.*640/);
    await roleGroup.selectOption('567890');
    assert.equal(await topP.inputValue(),'');assert.equal(await maxTokens.inputValue(),'');assert(!await parameter('unsupported').isVisible());
    assert.equal(await parameter('gate').innerText(),'独立接话判断的 token 上限 · 由服务决定');
    await roleGroup.selectOption('678901');assert.equal(await maxTokens.inputValue(),'640');
    await reset.click();await parameter('feedback').getByText(/已恢复此群角色/).waitFor();
    assert.deepEqual((await roleCalls('groupGenerationSet')).at(-1).value,{...scope,sampling:null});
    assert.equal(await maxTokens.inputValue(),'');assert.match(await parameter('effective').innerText(),/1024/);
    pass('Saving after a failed attempt uses only nonempty fields. Another group keeps independent defaults, and reset restores the first group through an exact scoped null without editing the gate.');
    const presetFinished=await page.evaluate(()=>roomFixture.finishedGroupPreset);
    await page.evaluate(()=>roomFixture.holdGroupPreset=true);await copy.click();await page.waitForFunction(()=>!!roomFixture.resolveGroupPreset);
    await roleGroup.selectOption('567890');
    await page.evaluate(()=>{roomFixture.holdGroupPreset=false;roomFixture.resolveGroupPreset();});
    await page.waitForFunction(before=>roomFixture.finishedGroupPreset===before+1,presetFinished);
    assert.equal(await maxTokens.inputValue(),'');assert.equal(await parameter('feedback').innerText(),'');
    await page.evaluate(()=>{const bot=roomFixture.bots.ju;bot.status='connected';roomFixture.snapshot.config.language='en';roomFixture.publish();switchView('connections');});
    await page.locator('#onboarding-qq-groups').click();
    if(!await roles.evaluate(node=>node.open))await roles.locator(':scope > summary').click();
    await roleGroup.selectOption('678901');
    if(!await generation.evaluate(node=>node.open))await generation.locator(':scope > summary').click();
    await parameter('scope').getByText('Companion QQ 654321 · group 678901 · 阿青',{exact:true}).waitFor();
    for(const node of [temperature,topP,maxTokens,copy,saveGeneration,reset])assert(await node.isDisabled());
    assert.equal(await parameter('unsupported').innerText(),'Ignored by the current backend · Temperature');
    assert.equal(await parameter('gate').innerText(),'Separate decision gate token cap · 64');
    await generation.scrollIntoViewIfNeeded();await shot('18-en-group-generation-locked');
    pass('A deferred preset cannot follow a group switch. Connected mode presents the real saved values in English while locking every edit.');
    const runtime=page.locator('#bot-qq-groups-runtime');
    const publishIssues=async ({language='en',providerIssues,runtimeProblem,problem='',active=true}={})=>{
      await page.evaluate(({language,providerIssues,runtimeProblem,problem,active})=>{
        const bot=roomFixture.bots.ju;
        roomFixture.snapshot.config.language=language;
        Object.assign(bot.qq.groups,{active,problem,runtimeProblem,providerIssues});roomFixture.publish();
      },{language,providerIssues,runtimeProblem,problem,active});
      return runtime.innerText();
    };
    const gate429={groupId:'678901',phase:'gate',code:'rate_limited'},formal429={groupId:'678901',phase:'reply',code:'rate_limited'};
    assert.match(await publishIssues({providerIssues:[],runtimeProblem:''}),/Group connection active/);
    assert.doesNotMatch(await runtime.innerText(),/failed|429/);
    assert.match(await publishIssues({providerIssues:[gate429],runtimeProblem:''}),/QQ group 678901.*reply decision failed.*stayed quiet.*429.*quota, billing or rate limits.*send a new message/);
    assert.doesNotMatch(await runtime.innerText(),/generation failed/);
    assert.match(await publishIssues({providerIssues:[formal429],runtimeProblem:''}),/QQ group 678901.*reply generation failed.*No reply was sent.*429/);
    assert.doesNotMatch(await runtime.innerText(),/decision failed/);
    const both={providerIssues:[gate429,gate429,formal429,{...gate429,groupId:'567890'},
      {...formal429,groupId:'999999'},{...formal429,groupId:'RAW_ID_DO_NOT_RENDER'},{...formal429,code:'<b>DO_NOT_RENDER</b>'}],
      runtimeProblem:'Local group storage needs attention.',problem:'RAW_PROVIDER_BODY_DO_NOT_RENDER'};
    const reported=await publishIssues(both);
    const lines=reported.split('\n');
    assert.equal(lines[0],'Local group storage needs attention.');
    const scopeA=lines.find(line=>line.startsWith('QQ group 678901.'));
    const scopeB=lines.find(line=>line.startsWith('QQ group 567890.'));
    assert.equal(lines.length,3);assert.match(scopeA,/reply decision failed.*reply generation failed.*429/);
    assert.match(scopeB,/reply decision failed.*429/);assert.doesNotMatch(scopeB,/generation failed/);
    assert.equal(scopeA.match(/429/g).length,1);
    assert.equal(reported.match(/678901/g).length,1);assert.equal(reported.match(/567890/g).length,1);
    assert.doesNotMatch(reported,/999999|RAW_PROVIDER_BODY_DO_NOT_RENDER|DO_NOT_RENDER/);
    assert.equal(await runtime.locator('b').count(),0);
    await runtime.scrollIntoViewIfNeeded();await shot('19-en-qq-provider-limits');
    const chinese=await publishIssues({...both,language:'zh',runtimeProblem:'群聊存储需要检查。'});
    assert.match(chinese,/群聊存储需要检查[\s\S]*QQ 群 678901.*接话判断失败.*正式回复生成失败.*429.*额度.*限流/);
    assert.equal(await runtime.getAttribute('role'),'status');
    await runtime.scrollIntoViewIfNeeded();await shot('20-zh-qq-provider-limits');
    for(const [code,reason] of [['billing',/balance.*billing/],['credentials',/API key.*permissions/],['invalid_response',/unusable response.*selected model/],['unavailable',/temporarily unavailable.*connection/]]){
      assert.match(await publishIssues({providerIssues:[{groupId:'678901',phase:'reply',code}],runtimeProblem:''}),reason);
    }
    assert.equal(await publishIssues({problem:'Legacy route warning.'}),'Legacy route warning.');
    await publishIssues({providerIssues:[],runtimeProblem:'',active:false});
    assert(!await runtime.isVisible());
    pass('Normal silence keeps ordinary counters. Gate and formal provider failures show fixed bilingual guidance once for each exact configured group, preserve other route warnings and ignore unknown or duplicate fields without showing provider response text.');
    const feed=page.locator('#bot-qq-group-feed'),feedNode=key=>feed.locator('#bot-qq-group-feed-'+key);
    const feedGroup=feedNode('group'),feedSource=feedNode('source'),allowFeed=feedNode('allow'),revokeFeed=feedNode('revoke');
    await page.evaluate(()=>{
      const bot=roomFixture.bots.ju;bot.qq.groups.active=true;bot.status='connected';
      roomFixture.snapshot.config.language='zh';roomFixture.publish();switchView('connections');
    });
    await page.locator('#onboarding-qq-groups').click();
    await feed.locator(':scope > summary').click();
    await feedNode('choices').waitFor();
    assert.equal(await feedNode('account').innerText(),'搭档 QQ 654321');
    assert.equal(await feedGroup.inputValue(),'');assert(await feedSource.isDisabled());assert(await allowFeed.isDisabled());
    assert.deepEqual(await roleCalls('groupFeedSet'),[]);
    await feedGroup.selectOption('678901');await feedSource.selectOption('public-feed');
    assert.match(await feedNode('selection').innerText(),/QQ 群 678901 · 阿青.*https:\/\/feed.example.test\/public\/rss.xml/);
    assert.doesNotMatch(await feed.textContent(),/PRIVATE_FEED_QUERY|PRIVATE_FRAGMENT/);
    assert.equal(await feed.locator('b').count(),0);
    assert.deepEqual(await roleCalls('groupFeedSet'),[]);
    await page.evaluate(()=>{
      const rows=roomFixture.bots.ju.qq.groups.feedNotices.feeds;
      rows[0].identity='a29e23e4-52d8-4090-b084-461ca4fad838';roomFixture.publish();
    });
    assert.equal(await feedSource.inputValue(),'');assert(await allowFeed.isDisabled());
    assert.match(await feedNode('feedback').innerText(),/订阅或角色已变化/);
    await feedSource.selectOption('public-feed');
    await allowFeed.scrollIntoViewIfNeeded();await shot('21-zh-public-feed-review');
    await page.evaluate(()=>roomFixture.rejectFeed=true);
    await allowFeed.click();await feedNode('feedback').filter({hasText:'未能更改许可'}).waitFor();
    assert.equal(await feedSource.inputValue(),'public-feed');assert.doesNotMatch(await feed.textContent(),/PRIVATE_TEST_ERROR/);
    await page.evaluate(()=>roomFixture.rejectFeed=false);
    await allowFeed.click();await feedNode('binding').waitFor();
    const currentRole=await page.evaluate(()=>roomFixture.bots.ju.qq.groups.generation.find(row=>row.groupId==='678901').roleId);
    const exact={profileId:'ju',expectedMode:'api',expectedChannel:'qq',expectedAccountId:'654321',groupId:'678901',
      roleId:currentRole,sourceId:'public-feed',identity:'a29e23e4-52d8-4090-b084-461ca4fad838'};
    assert.deepEqual((await roleCalls('groupFeedSet')).at(-1).value,{...exact,enabled:true});
    assert(!await feedNode('choices').isVisible());assert(await revokeFeed.isEnabled());
    assert.match(await feedNode('saved-details').innerText(),/678901 · 阿青 · 合成公开订阅 <b>原样显示<\/b>/);
    pass('Feed consent defaults off, offers only explicit saved account/group/role/source review, hides query and fragment, commits no change before explicit consent, and invalidates review if the feed identity changes.');
    await page.evaluate(()=>{
      const notices=roomFixture.bots.ju.qq.groups.feedNotices;notices.binding.status='source_changed';notices.lastOutcome='unknown';
      notices.feeds=[];roomFixture.snapshot.config.language='en';roomFixture.publish();
    });
    assert.match(await feedNode('state').innerText(),/feed changed.*Turn off the old permission/);
    assert.match(await feedNode('outcome').innerText(),/unconfirmed.*Check QQ/);
    assert(await revokeFeed.isEnabled());
    await revokeFeed.scrollIntoViewIfNeeded();await shot('22-en-public-feed-stale');
    await revokeFeed.click();await feedNode('binding').waitFor({state:'hidden'});
    assert.deepEqual((await roleCalls('groupFeedSet')).at(-1).value,{...exact,enabled:false});
    assert.match(await feedNode('feedback').innerText(),/Feed permission turned off/);
    await feedNode('sources').click();await page.waitForFunction(()=>document.body.dataset.view==='notices');
    pass('Live connected revoke uses the exact saved permission after the source changes or disappears, reports unknown delivery conservatively, and uses the existing sources page.');
    await page.evaluate(()=>{
      const bot=roomFixture.bots.ju;bot.qq.groups.feedNotices.feeds=structuredClone(roomFixture.feedRows);roomFixture.publish();switchView('connections');
    });
    await page.locator('#onboarding-qq-groups').click();
    if(!await feed.evaluate(panel=>panel.open))await feed.locator(':scope > summary').click();
    await feedGroup.selectOption('678901');await feedSource.selectOption('another-feed');
    const feedBefore=await page.evaluate(()=>roomFixture.feedSettled);
    await page.evaluate(()=>roomFixture.holdFeed=true);
    await allowFeed.click();await page.waitForFunction(()=>!!roomFixture.resolveFeed);
    await page.evaluate(()=>{
      roomFixture.snapshot.accounts.selectedId='dragon';roomFixture.publish();
      roomFixture.snapshot.accounts.selectedId='ju';roomFixture.publish();
      roomFixture.holdFeed=false;roomFixture.resolveFeed();
    });
    await page.waitForFunction(before=>roomFixture.feedSettled===before+1,feedBefore);
    assert.equal(await feedNode('feedback').innerText(),'');
    assert.equal(await page.evaluate(()=>roomFixture.bots.dragon.qq.groups.feedNotices.binding),null);
    assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.feedNotices.binding.sourceId),'another-feed');
    pass('A late permission result stays with its original companion. An intervening companion switch clears the draft and this view does not adopt a stale result label.');
    const calendar=page.locator('#bot-qq-group-calendar'),calendarNode=key=>calendar.locator('#bot-qq-group-calendar-'+key);
    const calendarGroup=calendarNode('group'),calendarSource=calendarNode('source');
    const allowCalendar=calendarNode('allow'),revokeCalendar=calendarNode('revoke');
    await page.evaluate(()=>{
      roomFixture.snapshot.config.language='zh';roomFixture.publish();switchView('connections');
    });
    await page.locator('#onboarding-qq-groups').click();
    await calendar.locator(':scope > summary').click();
    await calendarNode('choices').waitFor();
    assert.match(await calendar.locator('[data-bot="qqGroupCalendarNote"]').innerText(),/默认关闭.*明确标记为 CLASS:PUBLIC.*私密及未标记/);
    assert.equal(await calendarGroup.inputValue(),'');assert(await calendarSource.isDisabled());assert(await allowCalendar.isDisabled());
    assert.deepEqual(await roleCalls('groupCalendarSet'),[]);
    await calendarGroup.selectOption('678901');
    await calendarSource.selectOption('online-calendar');
    assert.match(await calendarNode('selection').innerText(),/QQ 群 678901 · 阿青.*https:\/\/calendar.example.test\/public\/events.ics/);
    assert.doesNotMatch(await calendar.textContent(),/PRIVATE_CALENDAR_QUERY|PRIVATE_CALENDAR_FRAGMENT|PRIVATE_CALENDAR_PATH|Unexpected path/);
    await calendarSource.selectOption('community-calendar');
    assert.match(await calendarNode('selection').innerText(),/QQ 群 678901 · 阿青.*community-events\.ics/);
    assert.equal(await calendar.locator('i').count(),0);
    assert.match(await allowCalendar.innerText(),/仅允许明确标记为公开的日程通知/);
    assert.deepEqual(await roleCalls('groupCalendarSet'),[]);
    await allowCalendar.scrollIntoViewIfNeeded();await shot('23-zh-public-calendar-review');
    await allowCalendar.click();await calendarNode('binding').waitFor();
    const exactCalendar={...exact,sourceId:'community-calendar',identity:'d48c8930-4141-46d2-adb6-2cbc2ed8ff26'};
    assert.deepEqual((await roleCalls('groupCalendarSet')).at(-1).value,{...exactCalendar,enabled:true});
    assert.match(await calendarNode('saved-details').innerText(),/678901 · 阿青 · 合成公开日历 <i>原样显示<\/i>/);
    assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.feedNotices.binding.sourceId),'another-feed');
    assert.equal(await page.evaluate(()=>roomFixture.bots.dragon.qq.groups.calendarNotices.binding),null);
    pass('Calendar sharing defaults off and only explicitly PUBLIC events are offered. Local basenames and sanitized HTTPS locations are visible; personal paths, query strings, fragments and markup stay undisclosed. Explicit consent binds the exact account, group, role and selected calendar separately from RSS or another companion.');

    const folder=page.locator('#bot-qq-group-folder'),folderNode=key=>folder.locator('#bot-qq-group-folder-'+key);
    const folderGroup=folderNode('group'),folderSource=folderNode('source');
    const allowFolder=folderNode('allow'),revokeFolder=folderNode('revoke');
    await folder.locator(':scope > summary').click();
    await folderNode('choices').waitFor();
    assert.match(await folder.locator('[data-bot="qqGroupFolderNote"]').innerText(),/默认关闭.*顶层文件的文件名及变动类型.*完整路径.*文件内容.*子文件夹.*上传文件/);
    assert.equal(await folderNode('account').innerText(),'搭档 QQ 654321');
    assert.equal(await folderGroup.inputValue(),'');assert(await folderSource.isDisabled());assert(await allowFolder.isDisabled());
    await folderGroup.selectOption('678901');
    await folderSource.selectOption('other-public-folder');
    assert.match(await folderNode('selection').innerText(),/QQ 群 678901 · 阿青.*other press kit/);
    await folderSource.selectOption('public-press-kit');
    assert.match(await folderNode('selection').innerText(),/QQ 群 678901 · 阿青.*public press kit/);
    assert.doesNotMatch(await folder.textContent(),/PRIVATE_FOLDER_PATH|PRIVATE_FOLDER_QUERY|Unexpected path|Unexpected URL/);
    assert.equal(await folder.locator('b').count(),0);
    assert.deepEqual(await roleCalls('groupFolderSet'),[]);
    await page.evaluate(()=>{
      const row=roomFixture.bots.ju.qq.groups.folderNotices.folders.find(row=>row.id==='public-press-kit');
      row.identity='7bc1f54a-02db-4cd0-85f6-f2c6d1493181';roomFixture.publish();
    });
    assert.equal(await folderSource.inputValue(),'');assert(await allowFolder.isDisabled());
    assert.match(await folderNode('feedback').innerText(),/文件夹或角色已变化/);
    await folderSource.selectOption('public-press-kit');
    assert.equal(await allowFolder.innerText(),'确认文件名可公开并允许通知');
    await folder.evaluate(panel=>panel.scrollIntoView({block:'center'}));await shot('25-zh-public-folder-review');
    await allowFolder.click();await folderNode('binding').waitFor();
    const exactFolder={...exact,sourceId:'public-press-kit',identity:'7bc1f54a-02db-4cd0-85f6-f2c6d1493181'};
    assert.deepEqual((await roleCalls('groupFolderSet')).map(call=>call.value),[{...exactFolder,enabled:true}]);
    assert.match(await folderNode('saved-details').innerText(),/678901 · 阿青 · 合成公开素材 <b>原样显示<\/b>/);
    assert.equal(await page.evaluate(()=>roomFixture.bots.dragon.qq.groups.folderNotices.binding),null);
    pass('Folder consent defaults off. It explicitly reviews the exact group, role and folder for filenames and change type only. Same-name folders show distinct basenames, an identity change clears the draft, and malformed paths, URLs, query strings and markup are not disclosed.');

    const pagePanel=page.locator('#bot-qq-group-page'),pageNode=key=>pagePanel.locator('#bot-qq-group-page-'+key);
    const pageGroup=pageNode('group'),pageSource=pageNode('source');
    const allowPage=pageNode('allow'),revokePage=pageNode('revoke');
    await pagePanel.locator(':scope > summary').click();
    await pageNode('choices').waitFor();
    assert.equal(await pagePanel.locator(':scope > summary').innerText(),'公开网页更新');
    assert.match(await pagePanel.locator('[data-bot="qqGroupPageNote"]').innerText(),/默认关闭.*确认可以公开访问.*网页名称和更新提示.*页面内容、地址或查询参数/);
    assert.equal(await pageNode('account').innerText(),'搭档 QQ 654321');
    assert.equal(await pageGroup.inputValue(),'');assert(await pageSource.isDisabled());assert(await allowPage.isDisabled());
    await pageGroup.selectOption('678901');
    assert(await allowPage.isDisabled());
    await pageSource.selectOption('another-page');
    assert.match(await pageNode('selection').innerText(),/QQ 群 678901 · 阿青.*another-page/);
    await pageSource.selectOption('community-page');
    assert.match(await pageNode('selection').innerText(),/QQ 群 678901 · 阿青.*community-page/);
    assert.doesNotMatch(await pagePanel.textContent(),/page\.example\.test|PRIVATE_PAGE_PATH|PRIVATE_PAGE_QUERY|Unexpected raw page|Unexpected target ID/);
    assert.equal(await pagePanel.locator('i').count(),0);
    assert.deepEqual(await roleCalls('groupPageSet'),[]);
    assert.equal(await allowPage.innerText(),'确认网页可公开访问并允许通知');
    await pagePanel.evaluate(panel=>panel.scrollIntoView({block:'center'}));await shot('27-zh-public-page-review');
    await allowPage.click();await pageNode('binding').waitFor();
    const exactPage={...exact,sourceId:'community-page',identity:'9cb6b1c6-1a32-4ee8-85e3-c0c8f7894b8b'};
    assert.deepEqual((await roleCalls('groupPageSet')).map(call=>call.value),[{...exactPage,enabled:true}]);
    assert.match(await pageNode('saved-details').innerText(),/678901 · 阿青 · 合成公开网页 <i>原样显示<\/i>/);
    assert.match(await pageNode('state').innerText(),/许可生效/);
    assert.equal(await page.evaluate(()=>roomFixture.bots.dragon.qq.groups.pageNotices.binding),null);
    pass('Page sharing defaults off. The explicit public consent confirms the saved companion, group, role and page name. Same-name pages are identified by their safe source IDs. Raw addresses, paths, query strings, invalid targets and markup do not appear as selectable page metadata.');

    await page.evaluate(()=>{
      const notices=roomFixture.bots.ju.qq.groups.pageNotices;
      notices.binding.status='source_disabled';notices.lastOutcome='unknown';
      notices.pages=notices.pages.filter(row=>row.id!=='community-page');
      roomFixture.snapshot.config.language='en';roomFixture.publish();
    });
    assert.equal(await pagePanel.locator(':scope > summary').innerText(),'Public page changes');
    assert.match(await pagePanel.locator('[data-bot="qqGroupPageNote"]').innerText(),/publicly viewable.*saved page name.*Page contents, addresses and query parameters/);
    assert.match(await pageNode('state').innerText(),/web page is disabled or removed/);
    assert.equal(await pageNode('feedback').innerText(),'');
    assert(await revokePage.isEnabled());
    await page.evaluate(()=>{
      const notices=roomFixture.bots.ju.qq.groups.pageNotices;
      notices.binding.status='source_changed';
      notices.pages.push({id:'community-page',name:'Replacement page',target:'community-page',identity:'e90b9316-dce6-4b16-b505-75daefa2212f'});
      roomFixture.publish();
    });
    assert.match(await pageNode('state').innerText(),/page source changed.*Turn off the old permission/);
    assert.match(await pageNode('outcome').innerText(),/unconfirmed.*Check QQ/);
    assert(!await pageNode('choices').isVisible());
    await pagePanel.evaluate(panel=>panel.scrollIntoView({block:'center'}));await shot('28-en-public-page-replaced');
    await revokePage.click();await pageNode('binding').waitFor({state:'hidden'});
    assert.deepEqual((await roleCalls('groupPageSet')).at(-1).value,{...exactPage,enabled:false});
    assert.match(await pageNode('feedback').innerText(),/Web page permission turned off/);
    assert.equal(await pageGroup.inputValue(),'');assert(await allowPage.isDisabled());
    assert.deepEqual(await page.evaluate(()=>[
      roomFixture.bots.ju.qq.groups.feedNotices.binding.sourceId,
      roomFixture.bots.ju.qq.groups.calendarNotices.binding.sourceId,
      roomFixture.bots.ju.qq.groups.folderNotices.binding.sourceId,
    ]),['another-feed','community-calendar','public-press-kit']);
    pass('Localized page status distinguishes a disabled source from replacement, and a connected owner can revoke the exact old grant. A replacement requires fresh consent. RSS, calendar and folder grants remain independent.');

    await page.evaluate(()=>{
      const notices=roomFixture.bots.ju.qq.groups.folderNotices;
      notices.binding.status='source_disabled';notices.lastOutcome='unknown';notices.folders=[];
      roomFixture.snapshot.config.language='en';roomFixture.publish();
    });
    assert.match(await folderNode('state').innerText(),/folder is disabled or removed/);
    assert.match(await folderNode('outcome').innerText(),/unconfirmed.*Check QQ/);
    assert(await revokeFolder.isEnabled());
    assert.equal(await folderNode('feedback').innerText(),'');
    await folder.evaluate(panel=>panel.scrollIntoView({block:'center'}));await shot('26-en-public-folder-disabled');
    await revokeFolder.click();await folderNode('binding').waitFor({state:'hidden'});
    assert.deepEqual((await roleCalls('groupFolderSet')).at(-1).value,{...exactFolder,enabled:false});
    assert.match(await folderNode('feedback').innerText(),/Folder permission turned off/);
    assert.deepEqual(await page.evaluate(()=>[
      roomFixture.bots.ju.qq.groups.feedNotices.binding.sourceId,
      roomFixture.bots.ju.qq.groups.calendarNotices.binding.sourceId,
    ]),['another-feed','community-calendar']);
    pass('Connected folder revoke clears only the exact saved grant after a source disappears. RSS and calendar remain independent, and uncertain delivery is shown with localized guidance.');

    await page.evaluate(()=>{
      const notices=roomFixture.bots.ju.qq.groups.calendarNotices;
      notices.binding.status='source_changed';notices.lastOutcome='unknown';notices.calendars=[];
      roomFixture.snapshot.config.language='en';roomFixture.publish();
    });
    assert.match(await calendarNode('state').innerText(),/calendar source changed.*Turn off the old permission/);
    assert.match(await calendarNode('outcome').innerText(),/unconfirmed.*Check QQ/);
    assert(await revokeCalendar.isEnabled());
    await revokeCalendar.scrollIntoViewIfNeeded();await shot('24-en-public-calendar-stale');
    await revokeCalendar.click();await calendarNode('binding').waitFor({state:'hidden'});
    assert.deepEqual((await roleCalls('groupCalendarSet')).at(-1).value,{...exactCalendar,enabled:false});
    assert.match(await calendarNode('feedback').innerText(),/Calendar permission turned off/);
    assert.equal(await page.evaluate(()=>roomFixture.bots.ju.qq.groups.feedNotices.binding.sourceId),'another-feed');
    pass('A changed or missing calendar can be revoked while connected using its exact saved grant, leaving the RSS permission intact. Unconfirmed delivery and stale source guidance are localized.');
    assert.deepEqual(receipt.errors,[]);assert.deepEqual(receipt.external,[]);assert.equal(await page.evaluate(()=>roomFixture.calls.filter(x=>/Connect|Login|QR/.test(x.name)).length),0);pass('No renderer errors, external requests, real account actions, real model calls or actual user window.');
    receipt.inputs=[...inputs].map(([file,sha256])=>({file,sha256,after:hash(fs.readFileSync(file))}));assert(receipt.inputs.every(input=>input.sha256===input.after));receipt.passed=true;
  }catch(error){receipt.failure=error.stack||String(error);if(page)await page.screenshot({path:path.join(out,'failed.png')}).catch(()=>{});throw error;}
  finally{fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();}
  console.log(JSON.stringify({passed:receipt.passed,checks:receipt.checks.length,screenshots:receipt.screenshots.length,receipt:path.join(out,'receipt.json')}));
})().catch(error=>{console.error(error);process.exitCode=1;});
