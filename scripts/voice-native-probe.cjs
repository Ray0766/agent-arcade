'use strict';
// Explicit local-device probe. No microphone capture, model call or QQ send.
const fs=require('node:fs');
const path=require('node:path');
const {WindowsSpeech}=require('../src/voice/windows-speech.cjs');
(async()=>{
  const speech=new WindowsSpeech();
  const result={at:new Date().toISOString(),kind:'native-windows-speech-probe',microphoneTested:false,realUserSpeechTested:false,liveCompanionTurnTested:false,audibilityConfirmedByUser:false};
  try{
    const available=await speech.capabilities();result.recognizers=available.recognizers;result.voices=available.voices;
    if(process.argv.includes('--playback')){
      const controller=new AbortController();let started;
      speech.once('playback-start',()=>{started=Date.now();setTimeout(()=>controller.abort(),400);});
      try{await speech.speak('这是语音打断测试。这句话应该在中途停止，不会完整播报。',{signal:controller.signal});result.cancelled=false;}
      catch(error){if(error.name!=='AbortError')throw error;result.cancelled=true;}
      await speech.interrupt();result.playbackStarted=!!started;result.interruptAcknowledged=true;result.elapsedFromPlaybackStartMs=started?Date.now()-started:null;
    }
    result.diagnostics=speech.diagnostics();
    fs.mkdirSync(path.join(__dirname,'..','outputs'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'..','outputs','voice-native-probe.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  }finally{await speech.close();}
})().catch(error=>{console.error(error.code||'voice_probe_failed',error.message);process.exitCode=1;});
