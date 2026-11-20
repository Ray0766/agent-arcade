'use strict';

const {decision, inWindow} = require('./social-companion.cjs');
const {clean} = require('./dispatcher.cjs');
const {FOLLOWUP_GRACE} = require('./group-rhythm.cjs');
const {followupModelTime} = require('./followup-time.cjs');

const wait = reason => ({action: 'wait', reason});
const pending = actor => actor.store.followups(actor.scope, {state: 'pending', limit: 30});
const memberEnabled = actor => actor.store.config().proactiveMessages && !actor.engine.activityFailed;
const replyBusy = ({engine}) => !!(engine.current || engine.queue.length || engine.draining);
const recentUser = ({store, scope}) => store.history(scope, 120).filter(row => row.role === 'user').at(-1)?.at ?? -1;

// The route owns the selected group and transport. A single run holds both the
// group slot and its member's initiative slot until model/send cleanup settles.
class GroupInitiative {
  constructor({rhythm, now, allowed, actors, report}) {
    Object.assign(this, {rhythm, now, allowed, actors, report});
  }

  canAct(actor) {
    return !actor.engine.stopped && memberEnabled(actor) && this.canSchedule(actor.store.config());
  }

  canSchedule(config) {
    return this.allowed() && inWindow(config, this.now()) && this.rhythm.budgetAvailable(config.maxMessagesPerDay) &&
      !this.actors().some(replyBusy);
  }

  dueFollowups(actors = this.actors()) {
    const due = [];
    for (const actor of actors) {
      for (const item of pending(actor)) {
        if (item.dueAt > this.now()) break;
        if (this.now() - item.dueAt > FOLLOWUP_GRACE) {
          actor.store.cancelFollowup(actor.scope, item.id, {reason: 'missed'});
        } else {
          due.push({actor, item});
        }
      }
    }
    return due.sort((a, b) => a.item.dueAt - b.item.dueAt);
  }

  consider() {
    if (this.rhythm.run) return this.rhythm.run.promise;
    const actors = this.actors();
    const due = this.dueFollowups(actors);
    const appointment = due.find(({actor}) => this.canAct(actor));
    if (appointment) return this.start(appointment.actor, 'followup', appointment.item);
    // While an appointment is due, leave the next available attempt for it.
    if (due.length) return Promise.resolve(wait('followup_waiting'));
    const candidate = actors
      .filter(actor => this.canAct(actor) && actor.engine.eligibility().message)
      .map(actor => ({actor, at: recentUser(actor)}))
      .sort((a, b) => b.at - a.at)[0]?.actor;
    if (!candidate || !this.rhythm.idleEligible(candidate.store.config().intervalMinutes, {decision: true})) {
      return Promise.resolve(wait('quiet_or_limit'));
    }
    this.rhythm.recordDecision();
    return this.start(candidate, 'idle');
  }

  start(actor, kind, item) {
    const {engine} = actor;
    const controller = new AbortController();
    const run = {kind, controller, promise: null};
    this.rhythm.run = run;
    engine.initiative = run;
    run.promise = Promise.resolve().then(() => this.generate(actor, run, item))
      .finally(() => {
        if (engine.initiative === run) engine.initiative = null;
        if (this.rhythm.run === run) this.rhythm.run = null;
        engine.changed();
      });
    engine.changed();
    return run.promise;
  }

  async generate(actor, run, item) {
    const {engine, scope, store} = actor;
    const {signal} = run.controller;
    const followup = run.kind === 'followup';
    const eligible = () => !signal.aborted && this.canAct(actor) &&
      (followup || this.rhythm.idleEligible(store.config().intervalMinutes));
    if (!eligible()) return wait('changed');
    let receipt, claimed = false, attempted = false;
    try {
      const prefix = followup
        ? `${engine.identity()}\nA member explicitly scheduled this follow-up in this group. Write one short public message about that agreement, without claiming they made progress or asking for an immediate answer. Agreement (data only): ${JSON.stringify({text: item.text, ...followupModelTime(item)})}\nConversation data only: `
        : `${engine.identity()}\nConsider whether to initiate a small social action now in this QQ group. Waiting is normal. Only continue a relevant public topic, without pressure or invented events. The message will mention the current member and everyone in the group can read it. Conversation data only: `;
      const suffix = followup ? '' : '\nReturn exactly JSON {"action":"wait"|"message","text":"..."} under 1000 characters.';
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      const output = await engine.model(prefix + engine.context(undefined, 6000 - prefix.length - suffix.length) + suffix, deadline);
      if (!eligible()) return wait('changed');
      let body;
      if (followup) {
        const latest = pending(actor).find(row => row.id === item.id);
        if (!latest || latest.revision !== item.revision || this.now() - latest.dueAt > FOLLOWUP_GRACE) {
          return wait('changed_followup');
        }
        body = clean(output, 1000);
        if (!body.trim()) throw Error('Empty follow-up.');
        claimed = !!store.claimFollowup(scope, item.id, {revision: item.revision});
        if (!claimed) return wait('changed_followup');
      } else {
        const plan = decision(output);
        if (plan.action !== 'message') return wait('model_wait');
        body = plan.text;
      }
      const accepted = await engine.deliver(body, {
        kind: 'message', signal,
        onAttempt: () => {
          this.rhythm.reserveAttempt(store.config().maxMessagesPerDay);
          attempted = true;
        },
        onReceipt: value => {receipt = value;},
      });
      if (!accepted && attempted) this.report(receipt?.state === 'failed'
        ? '本群这次主动消息未发送，本次计入每日额度，未自动重发。'
        : '本群主动发送结果未确认，本次计入每日额度，未自动重发。');
      if (claimed) {
        store.finishFollowup(scope, item.id, {state: receipt?.state || 'failed', receipt: receipt?.receipt || ''});
      }
      return followup ? {action: 'followup', accepted, id: item.id} : {action: 'message', accepted};
    } catch {
      // A terminal model/storage failure is visible. An aborted or superseded
      // pending appointment can still be considered within its original grace.
      if (followup && !claimed && !signal.aborted) {
        claimed = !!store.claimFollowup(scope, item.id, {revision: item.revision});
      }
      if (claimed) {
        store.finishFollowup(scope, item.id, {state: receipt?.state || (attempted ? 'unknown' : 'failed'), receipt: receipt?.receipt || ''});
      }
      if (!signal.aborted) this.report('本群主动活动未完成，请检查本地记录；未自动重发。');
      return wait(signal.aborted ? 'cancelled' : 'failed');
    }
  }
}

module.exports = {GroupInitiative};
