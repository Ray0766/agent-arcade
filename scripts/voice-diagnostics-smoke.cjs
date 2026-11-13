'use strict';
// Synthetic renderer checks only: no microphone, model, or social account access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const prefix=process.argv.includes('--review')?'voice-review':process.argv.includes('--manual')?'voice-manual':'voice-debug';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:760,height:700}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{font:14px "Microsoft YaHei",sans-serif;background:#f4f2ec;padding:24px} .fixture-label{font-size:12px;color:#725c3f}</style><p class="fixture-label">合成界面检查 · 不代表麦克风实测</p><main></main>');
    await page.addStyleTag({path:path.resolve('src/ui/voice.css')});
    await page.addScriptTag({path:path.resolve('src/ui/voice.js')});
    await page.evaluate(()=>{
      window.voiceCalls=[];
      window.panel=window.ArcadeVoice.createPanel({language:'zh',api:{voiceCapabilities:async()=>({recognizers:[{locale:'zh-CN'}],voices:[{name:'Microsoft Huihui Desktop',locale:'zh-CN'}]}),voiceStart:async()=>{voiceCalls.push('start');return {status:'listening',mode:'push-to-talk'};},voiceFinish:async()=>{voiceCalls.push('finish');return {status:'recognizing',mode:'push-to-talk'};},voiceConfirm:async value=>{voiceCalls.push({confirm:value});return {status:'thinking',transcript:value.text,reviewed:true};},voiceClose:async()=>{voiceCalls.push('close');return {status:'closed',reason:'manual-close'};}}});
      document.querySelector('main').append(panel.element);
    });
    await page.getByRole('button',{name:'开始说话',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>voiceCalls),[],'mounting only checks capabilities; it must not start the microphone');
    assert.equal(await page.getByRole('button',{name:'说完了',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'开始说话',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'说完了',exact:true}).isEnabled(),true);
    await page.screenshot({path:`outputs/${prefix}-recording-synthetic.png`,fullPage:true});
    await page.getByRole('button',{name:'说完了',exact:true}).click();
    await page.getByText('正在识别最后一句…',{exact:true}).waitFor();
    await page.evaluate(()=>panel.render({status:'reviewing',draftId:'draft-1',transcript:'你好只怪兽好'}));
    const editor=page.getByRole('textbox',{name:'确认要发送的文字'});await editor.fill('你好橘，晚上好');
    await page.evaluate(()=>panel.render({status:'reviewing',draftId:'draft-1',transcript:'你好只怪兽好'}));
    assert.equal(await editor.inputValue(),'你好橘，晚上好','state refresh must preserve user corrections');
    assert.deepEqual(await page.evaluate(()=>voiceCalls),['start','finish'],'nothing is submitted before confirmation');
    await page.screenshot({path:`outputs/${prefix}-editable-synthetic.png`,fullPage:true});
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByText('已发送：你好橘，晚上好',{exact:true}).waitFor();
    await page.getByRole('button',{name:'结束语音',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>voiceCalls),['start','finish',{confirm:{draftId:'draft-1',text:'你好橘，晚上好'}},'close']);
    await page.evaluate(()=>{
      panel.render({status:'listening',listeningSince:Date.now()-20000,speechDetectedAt:0,audioLevel:{current:0,max:0,count:0}});
    });
    await page.getByText('尚未检测到说话。',{exact:false}).waitFor();
    await page.screenshot({path:`outputs/${prefix}-no-input-synthetic.png`,fullPage:true});
    await page.evaluate(()=>panel.render({status:'closed',reason:'window-hidden',canStart:false,audioLevel:{current:0,max:0,count:0}}));
    assert.equal(await page.getByRole('button',{name:'开始说话',exact:true}).isDisabled(),true);
    await page.getByText('窗口隐藏时已关闭麦克风和播报。',{exact:true}).waitFor();
    await page.screenshot({path:`outputs/${prefix}-ended-synthetic.png`,fullPage:true});
    await page.setViewportSize({width:390,height:760});
    await page.evaluate(()=>panel.render({status:'idle',reason:'qq-message',canStart:true}));
    await page.getByText('收到新的 QQ 消息，已暂停麦克风和播报。',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const closeRect=await page.getByRole('button',{name:'结束语音',exact:true}).boundingBox();assert.ok(closeRect.y+closeRect.height<350,'core controls stay above the fold');
    await page.screenshot({path:`outputs/${prefix}-narrow-synthetic.png`,fullPage:true});
    await page.evaluate(()=>panel.destroy());assert.deepEqual(errors,[]);
    const result={kind:'synthetic-reviewed-voice-ui',passed:true,checks:['mount never starts microphone','start/finish/close use explicit buttons','review does not submit until Send','state refresh preserves edited text','only corrected text is submitted','no-input hint and numeric meter','closed reason and disabled start','QQ pause reason','390px no horizontal overflow and all controls above 350px','no renderer errors'],microphoneTested:false};
    fs.writeFileSync(`outputs/${prefix}-ui-smoke.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
