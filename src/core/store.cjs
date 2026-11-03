'use strict';
const { validEvent } = require('./events.cjs');
const active = new Set(['running', 'waiting', 'error']);
class Store {
  constructor(saved = {}) {
    if (!saved || typeof saved !== 'object') saved = {};
    this.tasks = new Map((Array.isArray(saved.tasks) ? saved.tasks : []).slice(-200).map(t => [t.id, t]));
    this.seen = new Set(Array.isArray(saved.seen) ? saved.seen.slice(-2000) : []);
    this.lastEventAt = saved.lastEventAt || 0;
  }
  apply(e) {
    if (!validEvent(e) || this.seen.has(e.id)) return null;
    this.seen.add(e.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    this.lastEventAt = Math.max(this.lastEventAt, e.at);
    const id = JSON.stringify([e.session, e.agent || '']);
    const old = this.tasks.get(id);
    if (old && e.at < old.updatedAt) return null;
    if (e.event === 'Notification' && !['permission_prompt', 'idle_prompt', 'elicitation_dialog'].includes(e.notification)) return null;
    const task = old ? structuredClone(old) : { id, session: e.session, agent: e.agent, project: e.project, name: e.agentType || 'Claude', state: 'idle', reason: 'session_ready', createdAt: e.at, updatedAt: e.at, history: [], result: '', tools: [], acknowledged: false };
    task.waitFor ||= []; task.finishedTools ||= [];
    if (['PreToolUse','PermissionRequest'].includes(e.event) && e.toolId && task.finishedTools.includes(e.toolId)) return null;
    task.project = e.project; task.updatedAt = e.at; task.lastEvent = e.event;
    const set = (state, reason) => { task.state = state; task.reason = reason; };
    switch (e.event) {
      case 'SessionStart': set('idle', 'session_ready'); task.tools = []; task.waitFor = []; task.finishedTools = []; break;
      case 'UserPromptSubmit': set('running', 'working'); task.result = ''; task.tools = []; task.waitFor = []; task.finishedTools = []; break;
      case 'SubagentStart': set('running', 'working'); break;
      case 'PreToolUse':
        if (e.toolId && !task.tools.includes(e.toolId)) task.tools.push(e.toolId);
        if (e.tool === 'AskUserQuestion' && !task.waitFor.includes(e.toolId || 'unknown')) task.waitFor.push(e.toolId || 'unknown');
        set(task.waitFor.length ? 'waiting' : 'running', task.waitFor.length ? (e.tool === 'AskUserQuestion' ? 'question' : 'permission') : 'tool_running'); break;
      case 'PermissionRequest': if (!task.waitFor.includes(e.toolId || 'unknown')) task.waitFor.push(e.toolId || 'unknown'); set('waiting', 'permission'); break;
      case 'Notification': set('waiting', e.notification === 'idle_prompt' ? 'input' : 'permission'); break;
      case 'PostToolUse':
        task.tools = task.tools.filter(x => x !== e.toolId);
        task.waitFor = task.waitFor.filter(x => x !== (e.toolId || 'unknown'));
        if (e.toolId) task.finishedTools = [...task.finishedTools,e.toolId].slice(-100);
        set(task.waitFor.length ? 'waiting' : 'running', task.waitFor.length ? 'permission' : 'working'); break;
      case 'PostToolUseFailure':
        task.tools = task.tools.filter(x => x !== e.toolId);
        task.waitFor = task.waitFor.filter(x => x !== (e.toolId || 'unknown'));
        if (e.toolId) task.finishedTools = [...task.finishedTools,e.toolId].slice(-100);
        set(task.waitFor.length ? 'waiting' : e.interrupted ? 'unknown' : 'error', task.waitFor.length ? 'permission' : e.interrupted ? 'interrupted' : 'tool_error'); break;
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
    if (['Stop','SubagentStop','StopFailure','SessionEnd'].includes(e.event)) task.waitFor = [];
    task.tool = e.tool || task.tool || '';
    if (!old || old.state !== task.state || old.reason !== task.reason) task.acknowledged = false;
    task.history.push({ event: e.event, at: e.at, state: task.state, tool: e.tool });
    task.history = task.history.slice(-30);
    this.tasks.set(id, task);
    if (this.tasks.size > 200) {
      const removable = [...this.tasks.values()].sort((a,b) => a.updatedAt - b.updatedAt).find(t => !active.has(t.state)) || this.tasks.values().next().value;
      this.tasks.delete(removable.id);
    }
    return { task, previous: old?.state, changed: old?.state !== task.state || old?.reason !== task.reason };
  }
  snapshot(now = Date.now(), staleMs = 5 * 60 * 1000) {
    return [...this.tasks.values()].map(t => ({ ...t, stale: active.has(t.state) && now - t.updatedAt > staleMs,
      displayState: active.has(t.state) && now - t.updatedAt > staleMs ? 'unknown' : t.state })).sort((a,b) => b.updatedAt - a.updatedAt);
  }
  acknowledge(id) { const t = this.tasks.get(id); if (t) t.acknowledged = true; }
  clearFinished() { for (const [id,t] of this.tasks) if (['done','ended'].includes(t.state)) this.tasks.delete(id); }
  export() { return { tasks: [...this.tasks.values()], seen: [...this.seen], lastEventAt: this.lastEventAt }; }
}
module.exports = { Store };
