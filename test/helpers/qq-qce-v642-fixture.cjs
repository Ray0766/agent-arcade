'use strict';
// Original fixed-version fixtures, no upstream source or user credential.
const exportsFixture=require('./qq-qce-export-fixture.cjs'),native=require('./qq-qce-native-plans-fixture.cjs');
function fixed(f){f.state.version='6.4.2';f.binding.pluginVersion='6.4.2';return f;}
const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({success:status===200,data,timestamp:new Date().toISOString(),requestId:'synthetic-642'}));};
async function exporting(t){
 const f=fixed(await exportsFixture.fixture(t));f.state.before=(row,req,res)=>{
  if(row.path==='/api/messages/export'){
   f.state.writes.push(row);const id=`export_${f.state.now}_${(f.state.nextTask++).toString(36)}`,request=row.body,name='synthetic.json';
   const record={id,taskId:id,peer:request.peer,format:request.format,filter:request.filter,options:request.options,status:'queued',progress:0,messageCount:0,createdAt:new Date(f.state.now).toISOString(),fileName:name,startTime:request.filter.startTime,endTime:request.filter.endTime};f.state.tasks.set(id,record);
   if(f.state.mode==='create-disconnect'){res.destroy();return;}
   send(res,{taskId:id,fileName:name,status:'queued',messageCount:0,startTime:record.startTime,endTime:record.endTime});
  }else if(row.path.endsWith('/cancel')){
   f.state.writes.push(row);const task=f.state.tasks.get(row.path.split('/')[3]);
   if(!task||['completed','cancelled','failed'].includes(task.status)){send(res,{},400);return;}
   task.status='cancelled';task.completedAt=new Date(f.state.now).toISOString();
   send(res,f.state.mode==='wrong-cancel-peer'?{...task,peer:{...task.peer,peerUid:'wrong'}}:task);
  }
 };
 return f;
}
async function plans(t){
 const f=fixed(await native.fixture(t));f.state.before=(row,res,sendNative,error)=>{
  if(row.method==='POST'&&row.path==='/api/scheduled-exports/trigger-all'){
   f.state.writes.push(row);const selected=[...f.state.plans.values()].filter(x=>row.body.includeDisabled||x.enabled);sendNative({triggeredCount:selected.length,triggered:selected.map(x=>({id:x.id,name:x.name}))});return true;
  }
  if(['POST','PUT'].includes(row.method)&&row.path.startsWith('/api/scheduled-exports')&&row.body&&(row.body.cronExpression===null||row.body.customTimeRange===null)){error('INVALID_NULL',400);return true;}
 };
 return f;
}
module.exports={fixed,exporting,plans};
