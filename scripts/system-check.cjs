'use strict';
// Native Windows integration probe; isolated settings, one synthetic notification.
const {_electron:electron}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-system-'));
 const env={...process.env,AGENT_ARCADE_HOME:root,AGENT_ARCADE_CLAUDE_SETTINGS:path.join(root,'settings.json')};delete env.ELECTRON_RUN_AS_NODE;
 const executablePath=process.env.ARCADE_EXECUTABLE||require('electron');
 const app=await electron.launch({executablePath,args:process.env.ARCADE_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env});
 try{
  const page=await app.firstWindow();await page.locator('#connect').waitFor();
  const native=await app.evaluate(async({BrowserWindow,Notification,screen})=>{
   const win=BrowserWindow.getAllWindows()[0];win.close();
   const closeToTray=!win.isDestroyed()&&!win.isVisible();
   if(win.isDestroyed())return {closeToTray};
   const nativeNotification=await new Promise(resolve=>{
    if(!Notification.isSupported())return resolve('unsupported');
    const n=new Notification({title:'Agent Arcade',body:'Synthetic acceptance notification',silent:true});
    let settled=false;const finish=status=>{if(settled)return;settled=true;clearTimeout(timeout);n.close();resolve(status);};
    const timeout=setTimeout(()=>finish('show event not received'),5000);
    n.once('show',()=>finish('native show event received'));n.once('failed',()=>finish('native failed event received'));n.show();
   });
   const hiddenAfterNotification=!win.isVisible();win.show();
   return {closeToTray,nativeNotification,hiddenAfterNotification,displays:screen.getAllDisplays().map(d=>({id:d.id,scaleFactor:d.scaleFactor,workArea:d.workArea}))};
  });
  assert(native.closeToTray,'Close did not preserve the tray application');assert(native.hiddenAfterNotification,'Notification unexpectedly revealed app window');
  fs.mkdirSync('outputs',{recursive:true});
  const displayChecks=[];
  for(const [index,display]of native.displays.entries()){
   await app.evaluate(({BrowserWindow},area)=>BrowserWindow.getAllWindows()[0].setBounds({x:area.x+20,y:area.y+20,width:Math.min(1200,area.width-40),height:Math.min(830,area.height-40)}),display.workArea);
   await page.waitForTimeout(800);
   const check=await page.evaluate(()=>({devicePixelRatio,innerWidth,innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(check.horizontalOverflow,false);displayChecks.push({...display,...check});
   await page.screenshot({path:`outputs/system-display-${index}.png`});
  }
  const report={measuredAt:new Date().toISOString(),platform:process.platform,packaged:Boolean(process.env.ARCADE_EXECUTABLE),...native,displayChecks,limitations:['Native show event means the OS accepted the notification, not proof that a human saw a banner.','Does not change Windows focus/notification settings, simulate physical sleep, or audit accessibility.','One installed display configuration; no claim about untested monitor/scaling combinations.']};
  fs.writeFileSync('outputs/system-check-private.json',JSON.stringify(report,null,2));
  const summary={platform:report.platform,packaged:report.packaged,closeToTray:report.closeToTray,nativeNotification:report.nativeNotification,hiddenAfterNotification:report.hiddenAfterNotification,displayCount:report.displays.length,testScale:report.displayChecks[0]?.devicePixelRatio,horizontalOverflow:report.displayChecks.some(d=>d.horizontalOverflow),limitations:report.limitations,privacy:'Display identifiers, bounds and exact collection times omitted.'};
  fs.mkdirSync('docs/evidence',{recursive:true});fs.writeFileSync('docs/evidence/system-check.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 }finally{await app.close();if(!root.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
