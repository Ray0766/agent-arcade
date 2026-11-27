'use strict';

const {createHash} = require('node:crypto');
const {requiresExternalWorker,textTask} = require('./text-delivery.cjs');

// Friends owns the intake, claim and deliverable. A stock Bridge is a transport,
// not an idempotent remote job API. Never replay a possibly dispatched claim.
function stockTaskReceiver(store,directory) {
  if (!directory) return;
  const workers = new Map();
  let closed = false;
  const identity = async (account,number) => {
    const found = await directory.list(account,number);
    if (found.directoryStatus === 'offline') throw Error('Bothouse offline');
    const role = found.contacts.find(r=>r.number===number || r.legacyNumber===number);
    return role?.configured ? role.id : undefined;
  };

  async function execute(job,text,controller,permitted) {
    let state = 'uncertain', result = null;
    // Other service processes can distinguish a long running turn from a lost worker.
    const renewal=setInterval(()=>{
      if (!closed && !controller.signal.aborted) {
        try {store.run("UPDATE bothouse_task_claims SET updated=? WHERE prompt=? AND attempt=? AND state='running'",
          Date.now(),job.prompt,job.attempt);} catch {controller.abort();}
      }
    },20000).unref();
    try {
      const transform = textTask(text);
      if (await identity(job.human,job.ai)!==job.identity || !permitted() || controller.signal.aborted) return;
      const answer = await directory.runTextTask({
        account:job.human, number:job.ai, project:job.identity, direct:job.direct,
        messageId:job.request+'-'+job.attempt, scope:[job.chat,job.scope,job.request],
        text:transform.prompt
      },controller.signal);
      if (closed || controller.signal.aborted || !permitted() || await identity(job.human,job.ai)!==job.identity) return;
      if (answer?.defer==='backend') state = 'waiting_backend';
      else if (answer?.text?.trim()==='[NEEDS_WORKER]') state = 'waiting_external';
      else if (answer?.text?.trim()==='[NEEDS_INPUT]') state = 'waiting_input';
      else if (typeof answer?.text==='string') {
        state='failed';
        result=transform.render(answer.text);
        state='returned';
      }
    } catch {
      // Malformed answers may be retried explicitly; network uncertainty may not.
    } finally {
      clearInterval(renewal);
      workers.delete(job.request);
      if (!closed && !controller.signal.aborted && permitted())
        store.run("UPDATE bothouse_task_claims SET state=?,result=? WHERE prompt=? AND attempt=? AND state='running'",
          state,result,job.prompt,job.attempt);
    }
  }

  async function step(action,job,text,permitted) {
    const receipt = {key:job.request,role:job.identity,boardId:job.board_id??job.prompt};
    if (action!=='status') {
      store.run("INSERT OR IGNORE INTO bothouse_task_claims(prompt,attempt,state,updated) VALUES(?,?,'accepted',?)",
        job.prompt,job.attempt,Date.now());
      return {...receipt,state:'accepted'};
    }
    const claim = store.one('SELECT state,result,updated FROM bothouse_task_claims WHERE prompt=? AND attempt=?',job.prompt,job.attempt);
    if (!claim) return {...receipt,state:'uncertain'}; // Pre-migration board owns this request.
    const state=claim.state;
    if (state==='returned') return {...receipt,state,text:claim.result,sha256:createHash('sha256').update(claim.result).digest('hex')};
    if (state==='running' && !workers.has(job.request) && Date.now()-claim.updated>90000)
      return {...receipt,state:'uncertain'};
    if (state!=='waiting_backend' && state!=='accepted') return {...receipt,state};
    if (requiresExternalWorker(text)) return {...receipt,state:'waiting_external'};
    const turn={account:job.human,number:job.ai,project:job.identity};
    const capability=await directory.textTaskCapability(turn);
    if (!capability?.available) return {...receipt,state:'waiting_backend'};
    if (workers.size>=4 || closed || !permitted()) return {...receipt,state:'accepted'};
    const claimed=store.run(
      "UPDATE bothouse_task_claims SET state='running',updated=? WHERE prompt=? AND attempt=? AND state IN ('accepted','waiting_backend')",
      Date.now(),job.prompt,job.attempt);
    if (claimed.changes) {
      const controller=new AbortController();
      workers.set(job.request,controller);
      void execute(job,text,controller,permitted).catch(()=>{});
    }
    return {...receipt,state:'running'};
  }

  const available=async turn=>(await directory.textTaskCapability?.(turn))?.available===true;
  return {identity,available,step,cancel(key){workers.get(key)?.abort();},stop(){
    closed=true;
    for(const controller of workers.values())controller.abort();
  }};
}
module.exports={stockTaskReceiver};
