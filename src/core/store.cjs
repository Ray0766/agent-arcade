'use strict';
const { EVENTS, validEvent } = require('./events.cjs');
const active = new Set(['running', 'waiting', 'error']);
const states = new Set(['idle', 'running', 'waiting', 'error', 'unknown', 'done', 'ended']);
const boundedText = (v, limit = 180) => typeof v === 'string' && v.length <= limit;
const timestamp = v => Number.isSafeInteger(v) && v > 0;
function restoreTask(t) {
  if (!t || typeof t !== 'object' || !boundedText(t.session) || !t.session || !boundedText(t.agent) ||
    t.id !== JSON.stringify([t.session, t.agent]) || !states.has(t.state) ||
    !['project', 'name', 'reason'].every(k => boundedText(t[k])) || !timestamp(t.createdAt) || !timestamp(t.updatedAt)) return null;
  // A partial/corrupt local save must not crash the renderer or resurrect
  // arbitrary fields. Retain well-formed stations and discard bad entries.
  const ids = values => Array.isArray(values) ? values.filter(v => boundedText(v)).slice(-100) : [];
  return { id: t.id, session: t.session, agent: t.agent, state: t.state, project: t.project,
    name: t.name, reason: t.reason, createdAt: t.createdAt, updatedAt: t.updatedAt,
    lastEvent: EVENTS.includes(t.lastEvent) ? t.lastEvent : '', tool: boundedText(t.tool) ? t.tool : '',
    result: typeof t.result === 'string' ? t.result.slice(0, 16000) : '', acknowledged: t.acknowledged === true,
    tools: ids(t.tools), waitFor: ids(t.waitFor), finishedTools: ids(t.finishedTools),
    calls: Array.isArray(t.calls) ? t.calls.filter(c => c && boundedText(c.id) && boundedText(c.key) && /^[a-f0-9]{64}$/.test(c.key)).slice(-100).map(c => ({ id: c.id, key: c.key, inferredPermission: c.inferredPermission === true })) : [],
    history: Array.isArray(t.history) ? t.history.filter(h => h && EVENTS.includes(h.event) && timestamp(h.at) && states.has(h.state) && boundedText(h.tool)).slice(-30) : [] };
}
class Store {
  constructor(saved = {}) {
    if (!saved || typeof saved !== 'object') saved = {};
    this.tasks = new Map((Array.isArray(saved.tasks) ? saved.tasks : []).slice(-200).map(restoreTask).filter(Boolean).map(t => [t.id, t]));
    this.seen = new Set(Array.isArray(saved.seen) ? saved.seen.filter(v => boundedText(v)).slice(-2000) : []);
    this.lastEventAt = timestamp(saved.lastEventAt) ? saved.lastEventAt : 0;
  }
  apply(e) {
    if (!validEvent(e) || this.seen.has(e.id)) return null;
    this.seen.add(e.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    this.lastEventAt = Math.max(this.lastEventAt, e.at);
    const id = JSON.stringify([e.session, e.agent || '']);
    const old = this.tasks.get(id);
    if (old && e.at < old.updatedAt) return null;
    // idle_prompt is a reminder 60s AFTER a response, not a request for approval.
    // Turning it into waiting would re-alert for a turn that already ended.
    if (e.event === 'Notification' && !['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input', 'quota_auto_resume_stale', 'quota_auto_resume_fired', 'elicitation_complete', 'elicitation_response'].includes(e.notification)) return null;
    const task = old ? structuredClone(old) : { id, session: e.session, agent: e.agent, project: e.project, name: e.agentType || 'Claude', state: 'idle', reason: 'session_ready', createdAt: e.at, updatedAt: e.at, history: [], result: '', tools: [], acknowledged: false };
    task.waitFor ||= []; task.finishedTools ||= []; task.calls ||= [];
    if (['PreToolUse','PermissionRequest'].includes(e.event) && e.toolId && task.finishedTools.includes(e.toolId)) return null;
    task.project = e.project; task.updatedAt = e.at; task.lastEvent = e.event;
    const set = (state, reason) => { task.state = state; task.reason = reason; };
    const unresolved = () => task.waitFor.some(id => id === 'unknown' || id.startsWith('unknown:'));
    const afterTool = (state, reason) => set(unresolved() ? 'unknown' : task.waitFor.length ? 'waiting' : state, unresolved() ? 'permission_unknown' : task.waitFor.length ? 'permission' : reason);
    switch (e.event) {
      case 'SessionStart': set('idle', 'session_ready'); task.tools = []; task.waitFor = []; task.finishedTools = []; task.calls = []; break;
      case 'UserPromptSubmit': set('running', 'working'); task.result = ''; task.tools = []; task.waitFor = []; task.finishedTools = []; task.calls = []; break;
      case 'SubagentStart': set('running', 'working'); break;
      case 'PreToolUse':
        if (e.toolId && !task.tools.includes(e.toolId)) task.tools.push(e.toolId);
        if (e.toolId && e.toolKey && !task.calls.some(c => c.id === e.toolId)) {
          const identical = task.calls.filter(c => c.key === e.toolKey);
          // An identical concurrent call makes an earlier ID-less permission
          // ambiguous too. Never clear it by guessing which call it belonged to.
          if (identical.some(c => c.inferredPermission && task.waitFor.includes(c.id))) {
            task.waitFor = task.waitFor.filter(id => !identical.some(c => c.inferredPermission && c.id === id));
            task.waitFor.push(`unknown:${e.toolKey}`);
          }
          task.calls.push({ id: e.toolId, key: e.toolKey });
        }
        task.calls = task.calls.slice(-100);
        if (e.tool === 'AskUserQuestion' && !task.waitFor.includes(e.toolId || 'unknown')) task.waitFor.push(e.toolId || 'unknown');
        afterTool('running', e.tool === 'AskUserQuestion' ? 'question' : 'tool_running');
        if (e.tool === 'AskUserQuestion' && e.toolId && task.waitFor.includes(e.toolId)) set('waiting', 'question');
        break;
      case 'PermissionRequest': {
        const candidates = e.toolKey ? task.calls.filter(c => c.key === e.toolKey) : [];
        const pending = e.toolId || (candidates.length === 1 ? candidates[0].id : e.toolKey ? `unknown:${e.toolKey}` : 'unknown');
        if (!e.toolId && candidates.length === 1) candidates[0].inferredPermission = true;
        if (!task.waitFor.includes(pending)) task.waitFor.push(pending);
        set('waiting', 'permission'); break;
      }
      case 'Notification':
        if (e.notification === 'quota_auto_resume_fired') set(task.waitFor.length ? 'waiting' : 'running', task.waitFor.length ? 'permission' : 'working');
        else if (['elicitation_complete', 'elicitation_response'].includes(e.notification)) {
          // These notifications resolve only an elicitation, not other approvals.
          if (task.reason !== 'question') return null;
          set(task.waitFor.length ? 'waiting' : 'running', task.waitFor.length ? 'permission' : 'working');
        } else set('waiting', e.notification === 'permission_prompt' ? 'permission' : ['agent_needs_input', 'quota_auto_resume_stale'].includes(e.notification) ? 'input' : 'question');
        break;
      case 'PostToolUse':
        task.tools = task.tools.filter(x => x !== e.toolId);
        task.calls = task.calls.filter(c => c.id !== e.toolId);
        task.waitFor = task.waitFor.filter(x => x !== e.toolId);
        if (e.toolId) task.finishedTools = [...task.finishedTools,e.toolId].slice(-100);
        afterTool('running', 'working'); break;
      case 'PostToolUseFailure':
        task.tools = task.tools.filter(x => x !== e.toolId);
        task.calls = task.calls.filter(c => c.id !== e.toolId);
        task.waitFor = task.waitFor.filter(x => x !== e.toolId);
        if (e.toolId) task.finishedTools = [...task.finishedTools,e.toolId].slice(-100);
        afterTool(e.interrupted ? 'unknown' : 'error', e.interrupted ? 'interrupted' : 'tool_error'); break;
      case 'StopFailure': set('error', 'turn_error'); task.tools = []; break;
      case 'Stop':
        task.result = e.result; task.tools = [];
        set(e.background ? 'running' : e.scheduled ? 'idle' : 'done', e.background ? 'background' : e.scheduled ? 'scheduled' : 'turn_ended'); break;
      case 'SubagentStop': task.result = e.result; task.tools = []; set('done', 'turn_ended'); break;
      case 'SessionEnd':
        set('ended', 'session_ended'); task.tools = [];
        for (const child of this.tasks.values()) if (child.session === e.session && child.id !== id && active.has(child.state)) { child.state = 'unknown'; child.reason = 'parent_ended'; child.updatedAt = e.at; }
        break;
    }
    if (['Stop','SubagentStop','StopFailure','SessionEnd'].includes(e.event)) { task.waitFor = []; task.calls = []; }
    task.tool = e.tool || task.tool || '';
    if (!old || old.state !== task.state || old.reason !== task.reason) task.acknowledged = false;
    task.history.push({ event: e.event, at: e.at, state: task.state, tool: e.tool });
    task.history = task.history.slice(-30);
    this.tasks.set(id, task);
    if (this.tasks.size > 200) {
      const removable = [...this.tasks.values()].sort((a,b) => a.updatedAt - b.updatedAt).find(t => !active.has(t.state)) || this.tasks.values().next().value;
      this.tasks.delete(removable.id);
    }
    return { task, previous: old?.state, previousReason: old?.reason, changed: old?.state !== task.state || old?.reason !== task.reason };
  }
  snapshot(now = Date.now(), staleMs = 5 * 60 * 1000) {
    return [...this.tasks.values()].map(t => ({ ...t, stale: active.has(t.state) && now - t.updatedAt > staleMs,
      displayState: active.has(t.state) && now - t.updatedAt > staleMs ? 'unknown' : t.state })).sort((a,b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  acknowledge(id) { const t = this.tasks.get(id); if (t) t.acknowledged = true; }
  clearFinished() { for (const [id,t] of this.tasks) if (['done','ended'].includes(t.state)) this.tasks.delete(id); }
  export() { return { tasks: [...this.tasks.values()], seen: [...this.seen], lastEventAt: this.lastEventAt }; }
}
module.exports = { Store };
