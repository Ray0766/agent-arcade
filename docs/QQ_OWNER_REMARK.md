# Edit the QQ owner's friend remark

Implemented, 2026-11-06. The selected QQ companion can manually change the friend
remark it assigns to its configured owner. Current source uses a separate
management connection, so AI may remain disconnected. This disconnected-AI
entry passed a bounded real packaged flow on 2026-11-06: draft/close, one
explicit change, fresh read and explicit restoration, with independent matching
cache reads and the owned management connection removed on close.
The earlier connected-AI package passed one explicit change, fresh read and
explicit restoration, with matching independent cache reads. That evidence does
not establish synchronization to another QQ client or validate the new entry.
This changes a QQ contact label, not the person's QQ nickname, the character's
name or companion memory. Other friends remain read-only. The separate
[group-name editor](QQ_GROUP_PROFILE.md) has its own scope and permissions.

## Use

1. Select the intended companion with its QQ account and fixed owner already
   saved. QQ must be online and verified in the local manager; AI can remain
   disconnected. In **QQ accounts → Friends and groups → Friends**, open that
   exact QQ account's directory.
2. Choose **Edit remark / 修改备注** on the uniquely identified **Owner / 主人**
   row. The app reads this owner's exact cached remark separately from the
   directory's display text. If the runtime account is different from the
   selected companion's saved QQ, editing is unavailable; browsing does not
   silently select or connect another companion.
3. Review the sending QQ and owner identity, then enter a remark and choose
   **Save remark / 保存备注**. An empty value changes the action to **Clear
   remark / 清除备注**. Spaces are preserved. The application allows at most
   **60 Unicode code points / 120 UTF-16 units**, without controls, format
   characters, line breaks or unpaired surrogates; this is not a claimed QQ limit.
4. Read the result. **Accepted** means the bridge accepted the change. The
   separate observation can be a matching cache value, a different value, or
   unavailable. It does not establish synchronization to another QQ client.
   **Unknown** means a change may have occurred: use **Read current remark /
   读取当前备注** before deciding on another action. There is no automatic retry.
5. To undo within this open panel, explicitly read again. If that observation
   still matches this panel's attempted change, choose **Restore the previous
   remark / 恢复本次修改前备注**, review the retained original and choose
   **Confirm restore / 确认恢复**. Restoration is a separate one-use write.

The original is retained only in the current panel's main-process memory.
Closing, going back, changing accounts, replacing a connection or ending the
application discards that restoration state. Closing does not undo an already
submitted edit. An unsupported original stays read-only and is withheld; it is
never shortened or stripped to make it writable or apparently restorable.
Closing stops only this panel's management connection, not QQ or a separate AI
connection. Availability is a local eligibility check; the explicit read still
checks actual QQ identity, online state and friendship.

## What is checked

- Main derives the recipient from the selected registered profile and configured
  owner. Renderer requests cannot supply another friend, QQ action, endpoint,
  token or restoration value. The current account, service/client generations,
  profile/character, selected companion, installation and runtime identity are
  rechecked. Both connected and disconnected AI require the saved QQ binding;
  an active AI's actual account must also match. The panel opens its own
  request-only client after fresh runtime verification. It does not queue
  normal chats, voice or friend requests, or dispatch model work.
- Each explicit read creates one ticket valid for five minutes by the local
  clock. Set or Restore consumes it before asynchronous work. The fixed client
  checks actual login, online/good state, friendship and the exact baseline
  before submitting once. A changed baseline requires a new read.
- After acceptance, one bounded cache read may observe the result. Failure or
  cancellation of that observation does not erase known acceptance. Timeout,
  disconnect or an invalid response after submission stays unknown, without
  reconnecting to replay the change.
- The comparison is **not atomic server-side compare-and-set**. Another client
  can change the remark between the read and write, and the bridge cache can
  lag. A cache match is not proof of remote persistence or owner-client display.
- Remark contents and restoration values do not enter global snapshots, model
  prompts, memories, public logs, exports or browser storage. This operation
  sends no chat message and does not call an AI. JavaScript string references are
  discarded on close; secure memory erasure is not claimed.

`qq-owner-remark.cjs` owns private baselines and tickets; the fixed methods in
`qq.cjs` perform the protocol checks. `qq-owner-remark-session.cjs` owns the
independent socket, fresh runtime checks and exact socket/generation guards;
`qq-owner-remark-panel.cjs` retains the private controller and projects bounded
direct IPC results. Existing friend-request capture rules are unchanged. The
existing directory drawer provides the editor; its sanitized directory remark
is never used as the write or restore baseline.

## Evidence and official contract

Package `single-window-group-owner-20261106` passed the new independent-session
flow with the selected Whale companion's AI disconnected. The actual directory
showed its unique owner row; reading the empty original opened one app-owned
management socket. Closing an unsaved draft returned that count to zero and an
independent production-client read confirmed the original hash. A subsequent
explicit set and separately reviewed restore each displayed accepted/cache-match;
independent observations matched the 30-byte test value and exact empty original.
Closing again removed the owned socket. No chat or model action came from this
remark flow. The earlier saved AI configuration then reconnected without key
entry. Private receipts are `outputs/qq-group-owner-packaged-ui-20261106.json`
and `outputs/qq-owner-remark-session-live-20261106.json`. Screenshots were
inspected during desktop operation, not saved as additional image files. This is
bridge/cache acceptance, not remote-client synchronization or server-side CAS.

That package passed 361 syntax files and 2409 total tests / 2408 passed / one
skipped / zero failed. Its identity receipt matched 186 source files, two notices,
11 metadata fields and three unpacked resources. The skip was an opt-in Windows
process-tree exercise, not a passed live check.

The independent-session source adds **13** production-client localhost tests
and **nine** actual main-handler tests, plus six adapted legacy remark checks.
They cover AI-disconnected operation, exact socket identity, ticket consumption
before awaited verification, close/reopen, late accepted/unknown results and
preservation of a separate AI connection. No real QQ account is involved.
The adjacent run passed 186 of 187 checks; the sole failure was an old lifecycle
test's literal method-name assertion. Updating it from permanent `close()` to
reusable `closeCurrent()` passed all seven tests in that affected file. These
results are separate from the earlier packaged evidence below.

The final production renderer smoke passed **23 checks / five inspected
synthetic screenshots**, including the real session/panel/controller/client
localhost chain and migrated legacy editor assertions. The old smoke entry now
runs this suite; its earlier 20-check/eight-image evidence is not an additional
current test run. It covers empty and unsupported originals, explicit restore,
uncertain writes, expiry, scope changes and closing only the owned connection.

Reproduce the session and main-handler checks with:

```sh
node --test test/qq-owner-remark-session.test.cjs test/qq-owner-remark-session-ipc.test.cjs test/qq-owner-remark-ipc.test.cjs
node scripts/qq-owner-remark-management-ui-smoke.cjs
```

The new controller/transport tests cover exact originals, unsupported values,
one-use/expired tickets, identity changes, conflicting baselines, explicit clear
and restore, uncertain writes, cancellation and cache observations. Together
with adjacent QQ/image/voice regressions, the initial **92/92** checkpoint passed
(`outputs/qq-owner-remark-targeted-20261106.txt`). The first actual package then
changed the remark and explicitly restored the original, with separate cached
reads matching each phase, but incorrectly displayed both successful requests as
unknown. That package flow is **not accepted**; its failure evidence remains in
`outputs/qq-owner-remark-live-20261106.json` and the original screenshots.

The protocol regression reproduced the false unknown before the fix. After
accepting only the two supported empty-result forms described below, **95/95**
targeted and adjacent tests passed (`outputs/qq-owner-remark-void-fixed-20261106.txt`);
the failing reproduction is retained separately. These use synthetic accounts on
a real loopback WebSocket. A test pass does not retroactively validate the
earlier UI. Subsequently, local candidate **0.4.0-preview.1**, package
`single-window-owner-remark-ready-20261106`, passed the real Whale/owner flow:
read original → explicit edit → accepted with cache match → fresh read → review
original → explicit restore → accepted with cache match. Separate production
client reads confirmed the target and exact original. A typed draft remained
open for 30.753 seconds across three ordinary polling intervals. The directory
now pauses future management polls while open; already in-flight results may
still invalidate it. No chat message was sent by this contact operation.

Private receipt `outputs/qq-owner-remark-live-summary-20261106.json` links five
actual screenshots and three independent observations. The package matched 121
source files. The full regression checkpoint was 1201 tests / 1200 passed / one
skipped, followed by 38 affected tests for the small version-label correction.
This remains a cache/bridge acceptance, not proof of another QQ client's display,
remote atomic comparison, all account compatibility or public release.

Checked 2026-11-06 against NapCat **4.18.42**, commit
`9335843246e3b7a17944861f3ac8731a259732c2`.
[`SetFriendRemark`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/SetFriendRemark.ts)
accepts string `user_id` / `remark` and checks friendship. Although its return
schema declares null, the actual handler returns `Promise<void>`.
[`OneBotAction.websocketHandle`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/OneBotAction.ts#L96-L107)
passes that result directly to the response envelope, so JSON can omit `data`.
Only null or omitted data is accepted, after the existing exact echo, successful
status and numeric zero return-code checks. Objects, arrays, scalar payloads,
failed or unmatched envelopes still produce an uncertain outcome after
submission. A generic failure cannot by itself identify the precise cause.
[`GetFriendList`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/GetFriendList.ts)
uses a base friend map; `no_cache` on its detail lookup does not guarantee a fresh
remote remark. These are interface references for original application code;
no upstream implementation was copied. See [the directory](QQ_DIRECTORY.md) for
the wider read-only view and [the integration inventory](QQ_INTEGRATION.md) for
unfinished contact/group capabilities.
