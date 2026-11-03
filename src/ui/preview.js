// Standalone, clearly marked visual demo when index.html is opened without Electron.
if (!window.arcade) {
  const now = Date.now();
  const previewData = { demo:true, installed:false, problem:'', lastEventAt:0,
    config:{language:'en',quiet:false,compact:false,notifications:false,captureResults:false,theme:'workshop'},
    themes:Object.entries(window.arcadePreviewThemes).map(([id,t])=>({id,name:t.name})),
    theme:window.arcadePreviewThemes.workshop,
    tasks:['running','waiting','error','done'].map((s,i)=>({id:`preview-${i}`,session:`demo-${i}`,agent:'',project:['orbit-api','field-notes','checkout','agent-arcade'][i],name:'Claude',state:s,displayState:s,reason:['tool_running','permission','tool_error','turn_ended'][i],updatedAt:now-i*15000,createdAt:now-90000,history:[],tool:'Bash',result:i===3?'Documentation is ready.\n\nThis is a demonstration result. Live results appear here only after enabling local result capture.':'',acknowledged:false}))
  };
  let listener=()=>{};
  const update=()=>{listener(structuredClone(previewData));return Promise.resolve(structuredClone(previewData));};
  const desktop=()=>Promise.reject(Error('Open the desktop app to connect live Claude Code sessions.'));
  window.arcade={snapshot:update,subscribe:fn=>{listener=fn;return()=>{};},demo:value=>value?update():desktop(),configure:patch=>{Object.assign(previewData.config,patch);previewData.theme=window.arcadePreviewThemes[previewData.config.theme];return update();},clear:()=>{previewData.tasks=previewData.tasks.filter(t=>t.state!=='done');return update();},acknowledge:id=>{const t=previewData.tasks.find(t=>t.id===id);if(t)t.acknowledged=true;return update();},install:desktop,uninstall:desktop,importTheme:desktop};
}
