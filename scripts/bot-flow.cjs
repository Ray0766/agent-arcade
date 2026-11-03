'use strict';

// Deterministic integration fixture: production routing, mocked Weixin and SDK.
// Does not contact a network, authenticate an account, call a model, or run a shell.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { BotService } = require('../src/bot/service.cjs');
const { WeixinClient, DEFAULT_BASE_URL } = require('../src/bot/weixin.cjs');
const { createRunner } = require('../src/bot/runner.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Fixture timed out: ${description}`);
}
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

async function main() {
  // Workspace temp avoids protected Windows sandbox temp-directory rename rules.
  const tempParent = path.resolve('outputs');
  fs.mkdirSync(tempParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempParent, 'arcade-bot-flow-'));
  const queue = [], sent = [], states = [], permissions = [], prompts = [];
  let updates = 0, queryClosed = 0, messageSequence = 0, service;
  // This vault only handles the synthetic credentials below. It is not encryption.
  const fixtureVault = { isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString('utf8') };

  function receive(text) {
    queue.push({ message_id: `fixture-message-${++messageSequence}`, from_user_id: 'fixture-owner',
      message_type: 1, message_state: 2, create_time_ms: Date.now(), context_token: 'fixture-context',
      item_list: [{ type: 1, text_item: { text } }] });
  }

  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, DEFAULT_BASE_URL);
    assert.equal(options.redirect, 'error');
    if (options.signal.aborted) throw new Error('Synthetic cancellation');
    const endpoint = new URL(url).pathname;
    if (endpoint.endsWith('/get_bot_qrcode')) {
      return json({ qrcode: 'fixture-qrcode', qrcode_img_content: 'https://fixture.invalid/scan' });
    }
    if (endpoint.endsWith('/get_qrcode_status')) {
      return json({ status: 'confirmed', bot_token: 'fixture-token-never-contact-weixin',
        ilink_bot_id: 'fixture-bot', ilink_user_id: 'fixture-owner', baseurl: DEFAULT_BASE_URL });
    }
    assert.equal(options.headers.Authorization, 'Bearer fixture-token-never-contact-weixin');
    const body = JSON.parse(options.body);
    if (endpoint.endsWith('/getupdates')) {
      return json({ ret: 0, msgs: queue.splice(0), get_updates_buf: `fixture-cursor-${++updates}` });
    }
    if (endpoint.endsWith('/sendmessage')) {
      assert.equal(body.msg.to_user_id, 'fixture-owner');
      assert.equal(body.msg.context_token, 'fixture-context');
      sent.push(body.msg.item_list.map(item => item.text_item.text).join('\n'));
      return json({ ret: 0, message_id: `fixture-sent-${sent.length}` });
    }
    throw new Error('Unexpected fixture endpoint');
  };

  const queryImpl = ({ prompt, options }) => {
    const stream = (async function* () {
      let text = '';
      for await (const message of prompt) text += message.message.content;
      prompts.push(text);
      yield { type: 'system', subtype: 'init', session_id: `fixture-session-${prompts.length}` };
      const input = { command: "printf 'fixture-only'" };
      const gate = await options.hooks.PreToolUse[0].hooks[0]({ hook_event_name: 'PreToolUse',
        tool_name: 'Bash', tool_input: input });
      assert.equal(gate.hookSpecificOutput.permissionDecision, 'ask');
      const permission = await options.canUseTool('Bash', input, { signal: options.abortController.signal });
      permissions.push({ behavior: permission.behavior, cancelled: options.abortController.signal.aborted });
      // Even the cancellation case deliberately yields a late success-shaped result.
      // The real runner must prefer the task cancellation signal over this boundary.
      yield { type: 'result', subtype: 'success', is_error: false,
        session_id: `fixture-session-${prompts.length}`,
        result: 'Synthetic report prepared. No shell was executed; actual task outcome is unverified.' };
    })();
    stream.close = () => { queryClosed++; };
    return stream;
  };

  try {
    service = new BotService({ root, vault: fixtureVault, qrEncoder: async () => 'fixture-local-qr',
      clientFactory: options => new WeixinClient({ ...options, fetchImpl }),
      runnerFactory: options => createRunner({ ...options, queryImpl }),
      onChange: () => {
        if (!service) return;
        const state = service.snapshot();
        if (states.at(-1) !== state.status) states.push(state.status);
      } });
    service.configure({ workspace: root, key: 'fixture-key-never-contact-anthropic', budget: 0.1 });
    await service.login();
    assert.equal(service.snapshot().paired, true);
    await service.connect();
    await waitFor(() => service.snapshot().status === 'connected', 'connected fixture');

    receive('Prepare the synthetic report. Ask before the fixture print action.');
    await waitFor(() => sent.some(text => /\/allow\s+\S+/.test(text)), 'one-time approval request');
    const approval = sent.find(text => /\/allow\s+\S+/.test(text)).match(/\/allow\s+(\S+)/)[1];
    receive(`/allow ${approval}`);
    await waitFor(() => permissions.length === 1 && sent.some(text => text.includes('Synthetic report prepared.')), 'reply delivery');
    assert.equal(permissions[0].behavior, 'allow');
    assert.equal(permissions[0].cancelled, false);

    const sentBeforeReplay = sent.length;
    receive(`/allow ${approval}`);
    await waitFor(() => sent.length > sentBeforeReplay, 'stale approval rejection');
    assert.match(sent.at(-1), /未批准任何操作/);
    assert.equal(prompts.length, 1);
    assert.equal(permissions.length, 1);

    const sentBeforeCancel = sent.length;
    receive('Prepare another synthetic report; this task will be cancelled while waiting.');
    await waitFor(() => sent.slice(sentBeforeCancel).some(text => /\/allow\s+\S+/.test(text)), 'second approval request');
    const cancelledCode = sent.slice(sentBeforeCancel).find(text => /\/allow\s+\S+/.test(text)).match(/\/allow\s+(\S+)/)[1];
    receive('/cancel');
    await waitFor(() => permissions.length === 2 && queryClosed === 2, 'cancelled SDK fixture closes');
    assert.equal(permissions[1].behavior, 'deny');
    assert.equal(permissions[1].cancelled, true);
    await waitFor(() => sent.some(text => /本轮已取消/.test(text)), 'cancelled final label');
    const sentBeforeCancelledReplay = sent.length;
    receive(`/allow ${cancelledCode}`);
    await waitFor(() => sent.length > sentBeforeCancelledReplay, 'cancelled nonce rejection');
    assert.match(sent.at(-1), /未批准任何操作/);
    assert.equal(permissions.length, 2);
    assert.equal(prompts.length, 2);

    const finalSnapshot = service.dispatcher.snapshot();
    assert.deepEqual(finalSnapshot.tasks.map(task => task.state), ['reply_ended', 'cancelled']);
    assert.equal(finalSnapshot.currentTaskId, null);
    assert.equal(finalSnapshot.queue.length, 0);
    assert.equal(finalSnapshot.pending.length, 0);
    assert(sent.some(text => text.includes('回复结束（任务结果未验证）')));
    const publicText = text => {
      let output = text.replace(/\/(allow|deny|answer)\s+\S+/g, '/$1 [nonce]');
      for (let index = 0; index < finalSnapshot.tasks.length; index++) {
        output = output.replaceAll(finalSnapshot.tasks[index].id.slice(0, 8), `fixture-${index + 1}`);
      }
      return output;
    };
    const receipt = {
      schema: 1, fixture: 'WeChat task dispatch and one-time approval',
      mocked_transport_and_model: true,
      real_network_requests: 0, real_model_requests: 0, real_shell_executions: 0,
      pipeline: ['BotService', 'WeixinClient protocol parsing', 'Dispatcher', 'createRunner',
        'SDK canUseTool callback fixture', 'WeixinClient result serialization'],
      checks: { paired_fixture: true, owner_message_dispatched: true, explicit_tool_approval: true,
        stale_nonce_rejected_without_new_task: true, cancel_denied_pending_tool: true,
        cancellation_overrode_late_success_shaped_result: true, cancelled_nonce_rejected: true,
        reply_boundary_label_keeps_outcome_unverified: true, queries_closed: queryClosed },
      counts: { received_messages: messageSequence, model_fixtures: prompts.length,
        permission_callbacks: permissions.length, sent_messages: sent.length },
      connection_states: states,
      sent_messages: sent.map(publicText),
      dispatcher_final: { current_task: null, queued: finalSnapshot.queue.length,
        pending_confirmations: finalSnapshot.pending.length,
        tasks: finalSnapshot.tasks.map(task => ({ state: task.state, outcome: task.outcome,
          text: task.text, delivery_failed: task.deliveryFailed })) },
      limitations: ['Transport and model are mocked; this is not live WeChat or Claude acceptance.',
        'No actual Bash command is run.', 'A reply boundary is not independent evidence that work succeeded.']
    };
    // Keep paths and credentials out of the portable evidence receipt.
    const serialized = JSON.stringify(receipt, null, 2);
    assert(!serialized.includes(root));
    assert(!serialized.includes('fixture-key-never-contact-anthropic'));
    assert(!serialized.includes('fixture-token-never-contact-weixin'));
    fs.mkdirSync(path.resolve('outputs'), { recursive: true });
    fs.writeFileSync(path.resolve('outputs', 'bot-flow.json'), `${serialized}\n`);
    process.stdout.write(`Bot protocol fixture passed: ${prompts.length} task turns, ${sent.length} outgoing messages.\n`);
    process.stdout.write('Evidence: outputs/bot-flow.json (mock transport and model; no live account acceptance).\n');
  } finally {
    await service?.disconnect();
    await service?.loop;
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), tempParent);
    assert(path.basename(resolved).startsWith('arcade-bot-flow-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => {
  // Synthetic failure details are safe, but never print ambient environment values.
  process.stderr.write(`Bot protocol fixture failed: ${error.message}\n`);
  process.exitCode = 1;
});
