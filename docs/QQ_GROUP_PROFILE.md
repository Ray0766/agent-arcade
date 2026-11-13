# QQ group profile and explicit name changes

Checkpoint: 2026-11-06. The fixed group-name controller, transport, independent
management session, fixed IPC and same-window editor are implemented. No real
group rename has been performed or accepted in this batch. A synthetic group
or successful package build is not account evidence.

This feature manages the name of an existing joined group. It does not enable
group conversations, group memory, automatic activity, membership changes or
other group administration. The configured owner's private-chat boundary is
unchanged.

## Same-window flow

1. Select the companion whose saved QQ binding matches the intended account.
   Open **QQ accounts → More → Friends and groups → Groups**, then choose
   **Group profile** on one returned group row. This does not select another AI
   or send a request to rename the group.
2. Choose **Read group profile**. Check the exact QQ account and group number.
   The app reads the name and this account's own group role. Ordinary members
   can view the result; only an observed owner/administrator can edit.
3. Enter a name and choose **Preview name change**. Review the exact original
   and proposed names before choosing **Confirm name change** once. Typing,
   reading, previewing and returning to editing do not write to QQ.
4. Read the bridge result and its separate subsequent observation. An uncertain
   outcome is never automatically resent. Read again before deciding on a new
   change.

An AI connection is not required. Reading creates a separately owned,
request-only bridge connection; it does not receive ordinary chat or invoke a
model. Closing the drawer releases only that connection. It does not stop QQ,
log out, disconnect the AI or undo a submitted name change. Returning to the
group list preserves its local search/page. Hiding the window, leaving the page
or changing the account/installation invalidates the private draft and ticket.

## Results and permission limits

| Result | Meaning |
| --- | --- |
| Bridge reported success | The matching OneBot action returned its pinned success response. The handler reports a successful native result; this alone is not remote-client synchronization proof |
| Observed match | A separate bounded read returned the proposed name; cached data may be included |
| Observed different | The read returned another name. It does not trigger automatic restoration |
| Readback unavailable | No usable subsequent observation was obtained. This does not erase an already known action acknowledgement |
| Not submitted | Pre-submit checks failed before invoking the write |
| Outcome unconfirmed | The request may have reached QQ, but its result is uncertain. The consumed ticket is not replayed |

The internal accepted marker is
`acknowledgement:'bridge-reported-success'`; observation is separately
`observed_match`, `observed_different` or `unavailable`. Do not collapse these
into a claim that every QQ client has updated.

Permissions are **observations, not an atomic server-side guarantee**. The app
rechecks membership, the original name and its own owner/admin role before
submission, but another client can change them afterward. The pinned bridge can
fall back to cached member data and can make an internal alternative native
attempt. One explicit confirmation permits one App-level OneBot action, not a
promise that the bridge performs exactly one native call. The app never exposes
an ordinary-member override.

## Bounds and isolation

- Names have an application limit of 60 Unicode code points and 120 UTF-16
  units. Blank-only names, control/format characters and isolated surrogates
  are rejected. Spaces are preserved. These are local limits, not a verified
  QQ platform maximum.
- Unsupported original names are withheld and remain read-only; the app never
  truncates or normalizes an original into a writable baseline.
- The selected group must appear in both bounded group-list observations.
  Duplicate IDs, wrong account/group/self-member IDs, conflicting list/detail
  names, unknown roles or a changed role/name reject the operation.
- Each preview lasts five minutes using a monotonic clock and is consumed
  before asynchronous confirmation. Returning to editing discards that ticket;
  a new read or context change also invalidates the old observation.
- Profile, panel, actual QQ, selected group, installation/runtime, endpoint,
  client and socket generation are bound independently. Renderer labels are
  not identity or permission evidence.
- Reads, pre-submit checks and readback use bounded operations. The group list
  is limited to 10,000 entries and the existing QQClient frame limit is 1 MiB.
- Timeout, disconnect, malformed replies and cancellation after invocation
  remain uncertain. Closing is not a remote rollback. There is no automatic
  retry or restore; a later restoration requires a new explicit change.
- Original/proposed names and tickets stay in the current private panel. They
  do not enter application-wide snapshots, diagnostics, journals, prompts or
  companion memory. IPC cannot select a URL, token or arbitrary OneBot action.

## Fixed upstream contract

The review used NapCat **4.18.42**, commit
`9335843246e3b7a17944861f3ac8731a259732c2`, and matching previously verified
official archive text without executing it.

[`get_group_list`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupList.ts)
accepts `no_cache:true`. The fixed
[`get_group_info`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupInfo.ts)
has no supported `no_cache` parameter and can fetch details for a group missing
from the account list; its success is not membership proof.
[`get_group_member_info`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupMemberInfo.ts)
can fall back to an existing member record even when a fresh detail is
unavailable. The app asks only for the actual account's own role and discards
unneeded personal fields.

[`set_group_name`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/SetGroupName.ts)
takes only `group_id` and `group_name`. It internally retries native result
1287 using `isNormalMember=true`, rejects a final nonzero result and explicitly
returns `null` on success. The app therefore requires matching outer
`echo/status/retcode` and exact `data:null`. An omitted or arbitrary payload
cannot be borrowed from another action's void-response compatibility.

## Verification boundary

The formal backend and adjacent regression passed **305/305** checks, including
24 controller/session cases and ten actual-main-handler cases. They use the
production QQClient and a real loopback WebSocket with synthetic accounts;
runtime/Electron dependencies remain inert. Covered boundaries include actual
profile/panel/group capture, fresh runtime proof across awaits, one-use writes,
late accepted/unknown outcomes, hidden-window cleanup and keeping the AI socket
independent.

The production renderer fixture passed **25 checks/seven inspected synthetic
screenshots**, including an actual session/controller/transport/QQClient
loopback response through the production renderer adapter. Registered profile
ID, actual QQ and group IDs are checked separately. The fixture also covers
IME, one-use/unknown replies, same-profile changes, account/installation
invalidation and narrow Chinese/English layouts. This is not a packaged
real-account flow.

From the repository root after `npm ci`:

```powershell
node --test test/qq-group-profile.test.cjs test/qq-group-profile-session.test.cjs test/qq-group-profile-ipc.test.cjs
node scripts/qq-group-profile-ui-smoke.cjs
```

The UI fixture uses Playwright Chromium with synthetic dependencies. If absent,
`npx playwright install chromium` is a separate development-browser download.
It does not control the real application window. Separately, the actual
`single-window-plugin-admin-20261106` package read Ju's one joined group and
23 members; self search returned 1/23 with role `member`. An independent
read-only check matched membership and account identity before/after
(`outputs/qq-plugin-package-group-read-20261106.json`). This establishes one
bounded directory/member observation, not a group-profile editor transaction.
Name preview/submission, live permission changes, large lists, pending-read
scope switches and remote-client synchronization remain unaccepted.
